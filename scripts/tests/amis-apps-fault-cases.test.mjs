// Synthetic stateful transport only. These tests are not real fault/recovery acceptance.
import test from 'node:test'
import assert from 'node:assert/strict'
import {amisFaultVariants,runAmisFaultCases} from '../amis-apps-fault-cases.mjs'
const names=['flowLookup','flowMeta','schemaStorage','storageCalls','namespaceResolve','flowAuthorization']
const ready=['flowRepositoryListener','flowMetaStoreListener','storageListener','namespaceFactoryListener','authorizationListener']
const paths=['/ui/main/page/x','/ui-extensions/app/pages/x','/api/v1/api/x','/oidc/app/pages/x','/oauth/app/pages/x','/.well-known/app/pages/x','/static/app/pages/x','/swagger/app/pages/x','/ping']
function setup(mode='B',problem) {
  let variant={},generation=0,sequence=0,faultSeen=false
  const events=[],reports=[]
  const counts=Object.fromEntries(names.map(name=>[name,0]))
  const hash='a'.repeat(64),source={database:hash,queue:hash,storage:hash}
  const observation=()=>({windowMs:5000,before:hash,immediate:hash,sources:Object.keys(source),beforeSources:{...source},samples:[{elapsedMs:0,hash,sources:source},{elapsedMs:5000,hash,sources:source}]})
  const statusFor = name => ['missing-extension','disabled-extension','missing-route-provider'].includes(name) ? mode==='A'?404:403 : name==='missing-authorization'?401:503
  const fault=()=>{const selected=amisFaultVariants(mode).find(row=>JSON.stringify(row.variant)===JSON.stringify(variant));return selected?{...selected,status:statusFor(selected.name)}:undefined}
  const effects={
    controlEvents(executionIds){return {schemaVersion:1,executionIds:[...executionIds].sort(),inventory:[...executionIds].sort(),events:[]}},
    async waitForIdle(){return {active:0}},
    async waitForStable(){return {windowMs:5000,samples:[{elapsedMs:5000,hash,sources:source}]}},
    async observeDenied(send,verify,options){assert.equal(options.windowMs,5000);events.push('observe');const response=await send();await verify(response);const value=observation();if(problem==='effects')delete value.beforeSources.database;return {response,observation:value}},
  }
  let clientNumber=0
  const clients=[]
  const createClient=()=>{
    let session=false,issuedGeneration
    const id=++clientNumber
    const client={
    async login(user,password){assert(!fault(),'Fault graph must not issue new login');issuedGeneration=generation;events.push('login-client-'+id);assert.equal(session,false,'Must logout before fresh login');assert.equal(user,'requested');assert.equal(password,'private-password');session=true;events.push('login');return {authenticated:true,credentialsSubmitted:problem!=='reused'}},
    async verifiedUiIdentity(){assert(!fault(),'Fault graph refuses new signed identity');events.push('signed-client-'+id);return {applicationGroupScopes:problem==='scopes'?['other']:['entry','flow'],authorizationVersion:7}},
    async request(path,options={}) {
      events.push(`${options.method??'GET'} ${path}`)
      if(path==='/oidc/logout'){assert(!fault(),'No logout in fault graph');session=false;return new Response(null,{status:302})}
      assert(session,'Authenticated request required')
      if(fault()){assert(issuedGeneration<generation,'Must use original graph session across JVM');events.push('fault-client-'+id)}
      if(paths.includes(path)) {
        if(fault()?.name==='missing-authorization'&&path==='/ui/main/page/x') {
          const headers={...(problem==='redirect-missing'?{}:{location:problem==='redirect-foreign'?'https://foreign.invalid/oidc/logout':'/oidc/logout'}),...(problem==='redirect-mime'?{'content-type':'text/html'}:{})}
          return new Response(null,{status:problem==='redirect-status'?302:307,headers})
        }
        return new Response('Native sentinel',{status:problem==='native-status'&&fault()?503:fault()?.name==='missing-authorization'?503:200,headers:{'content-type':'text/html'}})
      }
      assert(['/company.amis.a/greeting/pages/home','/company.amis.a/greeting/apis/greet'].includes(path),'Unexpected path')
      const selected=fault()
      if(selected){assert(['GET','POST'].includes(options.method));return new Response(null,{status:problem==='status'?200:selected.status})}
      assert.equal(options.method,'POST');assert.equal(JSON.parse(options.body).name,`control-${sequence}`)
      if(problem!=='positive')for(const name of names)counts[name]++
      const executionId='execution_'+sequence
      return Response.json({version:1,executionId,executionUrl:path+'/executions/'+executionId,executionState:'SUCCESS',resultReady:true,status:0,data:{marker:`control-${sequence}`}})
    },
    };clients.push(client);return client
  }
  const options={mode,base:'http://localhost:8080',account:{username:'requested',password:'private-password',...(mode==='B'?{expectedScopeKeys:['entry','flow']}:{})},
    target:{namespace:'company.amis.a',flowId:'greeting',pageId:'home',apiId:'greet',marker:'fault-marker'},originalVariant:{},
    nativeCases:paths.map(path=>({path,status:200,contentType:'text/html',marker:'Native sentinel'})),
    expectedFaultStatuses:Object.fromEntries(amisFaultVariants(mode).map(row=>[row.name,statusFor(row.name)])),
    env:{current:{mode,effects},async reconfigure(next){events.push({reconfigure:structuredClone(next)});variant=next;generation++;if(Object.keys(next).length){faultSeen=true;if(problem==='apply')throw new Error('apply failed')}else if(problem==='restore'&&faultSeen)throw new Error('restore failed')}},
    probe:{async snapshot(){const value={generation:String(generation),integrity:'ok',readiness:Object.fromEntries(ready.map(key=>[key,true])),...counts};if(fault()&&problem==='probe')value.readiness.storageListener=false;if(fault()&&problem==='lookup')counts.flowLookup++;if(fault()&&problem==='generation')value.generation=String(generation++);return value}},
    clientFactory:createClient,control:async()=>{sequence++;return {inputs:{name:`control-${sequence}`},expectedData:{marker:`control-${sequence}`}}},
    persist:async report=>reports.push(structuredClone(report)),
  }
  options.faultNativeCases=Object.fromEntries(amisFaultVariants(mode).map(fault=>[fault.name,options.nativeCases.map(row=>(fault.name==='missing-authorization'&&row.path==='/ui/main/page/x'?{path:row.path,status:307,contentType:null,location:'/oidc/logout'}:{...row,status:fault.name==='missing-authorization'?503:row.status}))]))
  return {options,events,reports,clients}
}
for(const mode of ['A','B'])test(`synthetic ${mode}: exact fault requests, observation and verified restoration`,async()=>{
  const {options,events,reports}=setup(mode)
  const result=await runAmisFaultCases(options)
  assert.equal(result.completed,true);assert.equal(result.counts.passed,mode==='A'?2:3)
  const faults=result.cases.flatMap(row=>row.faults)
  assert.equal(faults.length,mode==='A'?6:9)
  for(const fault of faults){
    assert.equal(fault.restoration.status,'passed');assert.equal(fault.checks.length,2)
    const expected=['missing-extension','disabled-extension','missing-route-provider'].includes(fault.name)?mode==='A'?404:403:fault.name==='missing-authorization'?401:503
    assert(fault.checks.every(check=>check.passed&&check.status===expected&&check.expectedStatus===expected))
    assert.equal(fault.crossJvm.newIdentityRequestedDuringFault,false)
  }
  const changes=events.filter(value=>typeof value==='object')
  assert.equal(changes.length,faults.length*2)
  for(let i=1;i<changes.length;i+=2)assert.deepEqual(changes[i].reconfigure,{})
  assert(!JSON.stringify(reports).includes('private-password'))
  if(mode==='A')assert(!JSON.stringify(changes).includes('rbacPresent'))
})
for(const problem of ['status','effects','probe','generation','lookup','apply','restore'])test(`synthetic ${problem}: retain failure and attempt original restoration`,async()=>{
  const {options,events,reports}=setup('B',problem)
  await assert.rejects(runAmisFaultCases(options),error=>{
    assert.equal(error.report.completed,false);assert.equal(error.report.cases[0].status,'failed')
    const fault=error.report.cases[0].faults[0]
    assert.equal(fault.restoration.status,problem==='restore'?'failed':'passed')
    return true
  })
  assert.deepEqual(events.filter(value=>typeof value==='object').at(-1),{reconfigure:{}})
  assert.equal(reports.at(-1).failure.fault,'missing-extension')
})
for(const problem of ['reused','scopes','positive'])test(`synthetic baseline ${problem}: no reconfigure on invalid control/identity`,async()=>{
  const {options,events,reports}=setup('B',problem)
  await assert.rejects(runAmisFaultCases(options),error=>{assert.equal(error.report.failure.phase,'baseline');return true})
  assert.equal(events.filter(value=>typeof value==='object').length,0)
  assert.equal(reports.at(-1).completed,false)
})
test('synthetic partial results survive later fault failure',async()=>{
  const {options,reports}=setup('A')
  const reconfigure=options.env.reconfigure
  options.env.reconfigure=async variant=>{await reconfigure(variant);if(variant.testJvmProperties?.['amis.acceptance.fault.route.mode']==='overlap')throw new Error('later failure')}
  await assert.rejects(runAmisFaultCases(options),error=>{
    assert.equal(error.report.cases[0].status,'passed');assert.equal(error.report.cases[1].faults[0].status,'passed')
    assert.equal(error.report.cases[1].faults[1].restoration.status,'passed');return true
  })
  assert.equal(reports.at(-1).counts.passed,1)
})
test('synthetic original configuration required before any action',async()=>{
  const {options,events}=setup();delete options.originalVariant
  await assert.rejects(runAmisFaultCases(options),/originalVariant/);assert.deepEqual(events,[])
})
test('synthetic Mode A has no authorization-fault matrix',()=>{
  assert.equal(amisFaultVariants('A').some(row=>row.family==='authorization'),false)
  assert.throws(()=>amisFaultVariants('C'))
})

for(const input of ['status-map','mode','unsafe-original'])test(`synthetic invalid ${input} fails before reconfigure`,async()=>{
  const {options,events}=setup()
  if(input==='status-map')delete options.expectedFaultStatuses
  if(input==='mode')options.env.current.mode='A'
  if(input==='unsafe-original')options.originalVariant={rbacPresent:false}
  await assert.rejects(runAmisFaultCases(options));assert.deepEqual(events,[])
})
test('synthetic effects observer replaced after reconfigure is actually used',async()=>{
  const {options}=setup('A');const original=options.env.reconfigure
  let calls=0
  options.env.reconfigure=async variant=>{
    await original(variant)
    const previous=options.env.current.effects
    options.env.current.effects={...previous,async observeDenied(...args){calls++;return previous.observeDenied(...args)}}
  }
  await runAmisFaultCases(options);assert(calls>=12)
})

test('synthetic private reconfigure error cannot leak bearer or arbitrary secret into report',async()=>{
  const {options,reports}=setup('A');const original=options.env.reconfigure
  options.env.reconfigure=async variant=>{await original(variant);if(Object.keys(variant).length)throw new Error('Bearer abcde custom-secret-123 private-password')}
  await assert.rejects(runAmisFaultCases(options),error=>{assert(!/abcde|custom-secret-123|private-password/.test(JSON.stringify(error.report)));return true})
  assert(!/abcde|custom-secret-123|private-password/.test(JSON.stringify(reports)))
})
test('synthetic persistence failure retains partial report on thrown error',async()=>{
  const {options}=setup('A');options.persist=async()=>{throw new Error('private persistence error')}
  await assert.rejects(runAmisFaultCases(options),error=>{assert.equal(error.report.persistenceFailure,true);assert.equal(error.report.completed,false);return true})
})

test('synthetic fault authorizer rejects new signatures while original signed session tests API and restoration fresh login succeeds',async()=>{
  const {options,events,clients}=setup('B'),original=options.env.reconfigure
  let rejectedNewSignatures=0
  options.env.reconfigure=async variant=>{
    await original(variant)
    if(Object.keys(variant).length){
      const existing=clients.at(-1)
      await assert.rejects(existing.verifiedUiIdentity(),/refuses new signed identity/)
      await assert.rejects(existing.login('requested','private-password'),/must not issue new login/)
      rejectedNewSignatures++
    }
  }
  const result=await runAmisFaultCases(options)
  assert.equal(rejectedNewSignatures,9)
  assert.equal(events.filter(row=>typeof row==='string'&&row.startsWith('login-client-')).length,19)
  assert.equal(events.filter(row=>typeof row==='string'&&row.startsWith('signed-client-')).length,19)
  for(const fault of result.cases.flatMap(row=>row.faults)){
    assert.deepEqual(fault.preFaultIdentity.applicationGroupScopes,['entry','flow'])
    assert.equal(fault.preFaultIdentity.authorizationVersion,7)
    assert.notEqual(fault.crossJvm.sourceGeneration,fault.crossJvm.faultGeneration)
    assert.equal(fault.crossJvm.newIdentityRequestedDuringFault,false)
    assert(fault.checks.every(row=>row.passed));assert.equal(fault.restoration.status,'passed')
  }
  const changes=events.map((row,index)=>typeof row==='object'?index:-1).filter(index=>index>=0)
  for(let i=0;i<changes.length;i+=2){
    const duringFault=events.slice(changes[i]+1,changes[i+1])
    assert(!duringFault.includes('GET /oidc/logout'))
    assert.equal(duringFault.filter(row=>typeof row==='string'&&row.startsWith('signed-client-')).length,0)
    assert.equal(new Set(duringFault.filter(row=>typeof row==='string'&&row.startsWith('fault-client-'))).size,1,'One retained client must send every fault request')
  }
})
test('synthetic missing-RBAC native statuses use explicit caller matrix, not all-200',async()=>{
  const {options}=setup('B'),result=await runAmisFaultCases(options)
  const missing=result.cases[2].faults.find(row=>row.name==='missing-authorization')
  assert.equal(missing.native.checks.find(row=>row.path==='/ping').status,503)
  assert.equal(missing.native.checks.find(row=>row.path==='/ui/main/page/x').status,307)
  const redirect=missing.native.checks.find(row=>row.path==='/ui/main/page/x')
  assert.equal(redirect.contentType,null);assert.equal(redirect.location,'/oidc/logout')
  assert(missing.checks.every(row=>row.status===401))
  assert.equal(missing.crossJvm.sessionSource,'original-graph-production-login')
  assert.equal(missing.crossJvm.newIdentityRequestedDuringFault,false)
  assert.equal(missing.native.status,'passed')
  // These synthetic values demonstrate explicit expectations only, not real host statuses.
})
test('synthetic native failure is retained and restoration still runs',async()=>{
  const {options,reports}=setup('B','native-status')
  await assert.rejects(runAmisFaultCases(options),error=>{
    const fault=error.report.cases[0].faults[0]
    assert.equal(fault.status,'failed');assert.equal(fault.native.status,'failed')
    assert.equal(fault.native.checks[0].status,503);assert.equal(fault.native.checks[0].expectedStatus,200)
    assert.equal(fault.restoration.status,'passed');assert.equal(error.report.completed,false)
    return true
  })
  assert.equal(reports.at(-1).cases[0].status,'failed')
})
test('synthetic per-fault native expectations required before login or reconfigure',async()=>{
  const {options,events}=setup('B');delete options.faultNativeCases['missing-authorization']
  await assert.rejects(runAmisFaultCases(options),/per-fault native matrix required/)
  assert.deepEqual(events,[])
})

for(const problem of ['redirect-status','redirect-foreign','redirect-missing','redirect-mime'])
  test(`synthetic missing-RBAC ${problem} rejects exact native response and restores`,async()=>{
    const {options}=setup('B',problem)
    await assert.rejects(runAmisFaultCases(options),error=>{
      assert.equal(error.report.failure.fault,'missing-authorization')
      const fault=error.report.cases[2].faults.find(row=>row.name==='missing-authorization')
      assert(fault.checks.every(row=>row.status===401&&row.passed))
      assert.equal(fault.native.status,'failed');assert.equal(fault.restoration.status,'passed')
      assert.equal(fault.crossJvm.newIdentityRequestedDuringFault,false)
      return true
    })
  })
for(const [mode,name,status] of [['A','missing-extension',403],['B','missing-extension',404],['B','missing-authorization',503],['B','overlap',403]])
  test(`synthetic ${mode}/${name} rejects obsolete configured ${status} before requests`,async()=>{
    const {options,events}=setup(mode);options.expectedFaultStatuses[name]=status
    await assert.rejects(runAmisFaultCases(options),/Unsupported fail-closed status/)
    assert.deepEqual(events,[])
  })
for(const [field,value]of [['location','https://foreign.invalid/oidc/logout'],['location',undefined],['contentType','text/html'],['status',302]])
  test(`synthetic missing-RBAC rejects incorrect configured redirect ${field}=${value}`,async()=>{
    const {options,events}=setup('B')
    const row=options.faultNativeCases['missing-authorization'][0]
    if(value===undefined)delete row[field];else row[field]=value
    await assert.rejects(runAmisFaultCases(options))
    assert.deepEqual(events,[])
  })

test('known positive control event additions are retained but cannot excuse strict effects failure',async()=>{
  const {options}=setup('B');let offset=0
  options.env.current.effects.controlEvents=executionIds=>({schemaVersion:1,executionIds:[...executionIds].sort(),inventory:[...executionIds].sort(),events:executionIds.length?[{type:'async_operation_processed_event',offset:String(++offset),created:'2026-11-26T12:00:00Z',tenantId:null,executionId:executionIds[0],operationId:'operation_1',outcome:'SUCCEEDED'}]:[]})
  options.env.current.effects.observeDenied=async(send,verify)=>{
    await verify(await send())
    const error=new Error('private payload password=never-publish');error.code='AMIS_EFFECTS_CHANGED';error.sideEffects={windowMs:5000};throw error
  }
  await assert.rejects(runAmisFaultCases(options),error=>{
    const fault=error.report.cases[0].faults[0],check=fault.checks[0]
    assert.equal(fault.status,'failed');assert.equal(fault.safeError,'AMIS_EFFECTS_CHANGED')
    assert(check.controlEventChanges.added.length>0);assert(check.controlEventChanges.removed.length>0)
    assert(check.eventSourcesBefore.executionIds.includes(check.controlEventChanges.added[0].executionId))
    assert(!JSON.stringify(error.report).includes('never-publish'))
    assert.equal(fault.restoration.status,'passed');return true
  })
})

test('malformed positive event metadata fails closed and never serializes the rejected field',async()=>{
  const {options}=setup('A')
  options.env.current.effects.controlEvents=executionIds=>({schemaVersion:1,executionIds:[...executionIds].sort(),inventory:[],events:[],payload:'private-never-publish'})
  await assert.rejects(runAmisFaultCases(options),error=>{
    assert.equal(error.report.completed,false);assert(!JSON.stringify(error.report).includes('private-never-publish'));return true
  })
})
