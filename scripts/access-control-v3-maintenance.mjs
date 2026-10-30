import assert from 'node:assert/strict'

export const maintenanceCheckId='login-client-maintenance-lifecycle'

export async function runLoginClientMaintenance({clientId,originalSecret,command,stop,start,login,record}) {
  assert(typeof clientId==='string'&&clientId)
  assert(typeof originalSecret==='string'&&originalSecret)
  for(const operation of [command,stop,start,login,record])assert.equal(typeof operation,'function')
  const report={id:maintenanceCheckId,status:'running',passed:false,steps:[],cleanup:[],completed:false}
  const persist=()=>record(structuredClone(report))
  let phase='none',revision,activeSecret=originalSecret
  const step=async(id,evidence)=>{report.steps.push({id,...evidence});await persist()}
  const status=async()=>{
    const value=await command('status',clientId)
    assert.equal(value.clientId,clientId)
    assert.equal(value.rotationMode,'DEPLOYMENT_MAINTENANCE')
    assert.equal(value.clientType,'CONFIDENTIAL');assert.equal(value.secretSet,true)
    assert(Number.isSafeInteger(value.credentialRevision)&&value.credentialRevision>=0)
    return value
  }
  const prepare=async()=>{
    phase='pending'
    const issued=await command('prepare',clientId,String(revision))
    assert.equal(issued.clientId,clientId);assert.equal(issued.credentialRevision,revision)
    assert(typeof issued.clientSecret==='string'&&issued.clientSecret.length>=32)
    const value=issued.clientSecret
    issued.clientSecret=undefined
    return value
  }
  const verifyLogin=async(id)=>{
    const value=await login()
    assert.equal(value.authenticated,true)
    await step(id,{authenticated:true,callbackPath:value.callbackPath})
  }
  await persist()
  try {
    revision=(await status()).credentialRevision
    await verifyLogin('baseline-production-login')
    let candidate=await prepare()
    assert.notEqual(candidate,originalSecret)
    assert.equal((await status()).credentialRevision,revision)
    await verifyLogin('prepare-preserves-current-login')
    await command('cancel',clientId,String(revision));phase='none';candidate=undefined
    assert.equal((await status()).credentialRevision,revision)
    await step('cancel-preserves-current-revision',{credentialRevision:revision})
    await verifyLogin('cancel-preserves-current-login')

    candidate=await prepare()
    await stop()
    phase='activation-attempted'
    const activated=await command('activate',clientId,String(revision))
    assert.equal(activated.credentialRevision,revision+1)
    revision=activated.credentialRevision;phase='active'
    activeSecret=candidate
    await start(activeSecret)
    await verifyLogin('activated-secret-production-login')
    await stop()
    await start(originalSecret)
    let oldConfigurationRejected=false,rejectedStatus,rejectionEvidence
    try {await login({expectedInvalidConsumer:true})}catch(error){
      const callbackFailure=error.code==='ERR_ASSERTION'&&error.message.startsWith('Production OAuth callback reaches an application document')
      const configurationFailure=error.credentialFailure==='CONFIGURED_CLIENT_MISMATCH'
        &&error.protocolRejection?.source==='production-host-error-log'
        &&error.protocolRejection.path==='/oauth/login/kestra'&&error.protocolRejection.status===500
        &&typeof error.protocolRejection.traceId==='string'&&error.protocolRejection.traceId.length>0
      assert(callbackFailure&&[401,403,500].includes(error.actual)||configurationFailure,'Unclassified transport or infrastructure failure is not credential rejection evidence')
      oldConfigurationRejected=true;rejectedStatus=error.actual;rejectionEvidence=error.protocolRejection
    }
    assert(oldConfigurationRejected,'Old consumer secret still completed production OAuth login')
    await step('old-consumer-configuration-rejected',{rejected:true,status:rejectedStatus,...(rejectionEvidence?{protocolRejection:rejectionEvidence}:{})})
    await stop()
    const rolledBack=await command('rollback',clientId,String(revision))
    assert.equal(rolledBack.credentialRevision,revision+1)
    revision=rolledBack.credentialRevision;phase='none';activeSecret=originalSecret;candidate=undefined
    await start(originalSecret)
    await verifyLogin('rollback-original-configuration-login')

    candidate=await prepare()
    await stop();phase='activation-attempted'
    const final=await command('activate',clientId,String(revision))
    assert.equal(final.credentialRevision,revision+1)
    revision=final.credentialRevision;phase='active';activeSecret=candidate
    await start(activeSecret)
    await verifyLogin('final-activated-secret-production-login')
    await command('confirm',clientId,String(revision));phase='confirmed'
    const confirmed=await status()
    assert.equal(confirmed.credentialRevision,revision)
    assert.equal(confirmed.maskedHint,activeSecret.slice(0,3)+'••••••••'+activeSecret.slice(-4))
    let rollbackRejected=false
    try {await command('rollback',clientId,String(revision))}catch(error){assert.equal(error.credentialFailure,'CONFLICT','Only an explicit maintenance conflict proves rollback material was removed');rollbackRejected=true}
    assert(rollbackRejected,'Confirmed maintenance retained rollback material')
    assert.equal((await status()).credentialRevision,revision)
    await step('confirmed-rollback-material-removed',{credentialRevision:revision,rollbackRejected:true,failure:'CONFLICT'})
    await verifyLogin('confirmed-production-login')
    report.status='passed';report.passed=true;report.completed=true
  }catch{
    report.status='failed';report.error='Login client maintenance failed; retained step receipts contain no credential values'
    try {
      await stop()
      const current=await status()
      if(phase==='pending')await command('cancel',clientId,String(current.credentialRevision))
      else if(phase==='activation-attempted'&&current.credentialRevision===revision) {
        await command('cancel',clientId,String(current.credentialRevision))
      }else if(phase==='active'||phase==='activation-attempted') {
        await command('rollback',clientId,String(current.credentialRevision))
        activeSecret=originalSecret
      }
      await start(activeSecret)
      const recovered=await login()
      assert.equal(recovered.authenticated,true)
      report.cleanup.push({id:'recover-matching-consumer-configuration',passed:true})
    }catch{report.cleanup.push({id:'recover-matching-consumer-configuration',passed:false})}
  }finally{await persist()}
  return report
}
