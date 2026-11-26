import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {amisApiPath, invokeAmisApi} from './amis-apps-http.mjs'
import {runAmisNativeCases} from './amis-apps-native-cases.mjs'
import {validateAmisControlEvents} from './amis-apps-effects.mjs'

const listeners=['flowRepositoryListener','flowMetaStoreListener','storageListener','namespaceFactoryListener','authorizationListener']
const counters=['flowLookup','flowMeta','schemaStorage','storageCalls','namespaceResolve','flowAuthorization']
const sources=['database','queue','storage'], sha=/^[a-f0-9]{64}$/
function snapshot(raw) {
  assert(raw?.generation&&raw.integrity==='ok','Probe generation/integrity required')
  for(const key of listeners)assert.equal(raw.readiness?.[key],true,`Probe not ready: ${key}`)
  for(const key of counters)assert(Number.isSafeInteger(raw[key])&&raw[key]>=0,`Probe counter missing: ${key}`)
  return structuredClone(raw)
}
function observation(value) {
  assert(value?.windowMs>=5000,'Denied observation requires >=5000ms')
  assert.deepEqual([...value.sources].sort(),sources)
  assert(sha.test(value.before)&&value.immediate===value.before,'Immediate side effects changed')
  for(const key of sources)assert(sha.test(value.beforeSources?.[key]),`Missing effects source ${key}`)
  assert(value.samples?.length&&value.samples.at(-1).elapsedMs>=value.windowMs,'Delayed samples missing')
  let elapsed=-1
  for(const sample of value.samples) {
    assert(sample.elapsedMs>=elapsed,'Sample times out of order');elapsed=sample.elapsedMs
    assert.equal(sample.hash,value.before,'Delayed side effects changed')
    for(const key of sources)assert.equal(sample.sources?.[key],value.beforeSources[key],`Changed source ${key}`)
  }
  return value
}
// These names are read from OwnedFaultRouteProvider and Owned*Authorization probe classes.
export function amisFaultVariants(mode) {
  assert(['A','B'].includes(mode))
  const route=kind=>({testJvmProperties:{'amis.acceptance.fault.route.enabled':'true','amis.acceptance.fault.route.mode':kind,'amis.acceptance.fault.route.id':'owned-amis-fault'}})
  return [
    {name:'missing-extension',family:'native',variant:{amisPresent:false},status:404},
    {name:'disabled-extension',family:'native',variant:{amisEnabled:false},status:404},
    {name:'missing-route-provider',family:'route',variant:{amisEnabled:false},status:404},
    ...['overlap','duplicate-id','throw-match'].map(kind=>({name:kind,family:'route',variant:route(kind),status:503})),
    ...(mode==='B'?[
      {name:'missing-authorization',family:'authorization',variant:{rbacPresent:false},status:503},
      {name:'duplicate-authorization',family:'authorization',variant:{testJvmProperties:{'amis.acceptance.fault.auth.duplicate':'true'}},status:503},
      {name:'unavailable-authorization',family:'authorization',variant:{testJvmProperties:{'amis.acceptance.fault.auth.unavailable':'true'}},status:503},
    ]:[]),
  ]
}

/** Request-layer fragments only. env must be on its original mode plan; originalVariant
 * explicitly describes that plan ({} for managed-compose's original graph). Each fault
 * restores it in finally. No deployment is created here. nativeCases is the existing
 * nine-path native HTTP matrix; control supplies a unique caller-owned marker per use.
 * Effects are obtained after every restart, never cached across reconfigure().
 * expectedFaultStatuses maps every amisFaultVariants(mode).name to the exact
 * published status: absent/disabled reaches the native missing-route policy
 * (A404/B403); a removed RBAC projection invalidates the existing identity
 * (401). Ambiguous or unavailable providers return 503. No success or arbitrary
 * error counts as denial. Native redirects require an explicit local target.
 * faultNativeCases[name] explicitly supplies the same nine native paths and their
 * exact status/MIME/optional marker under that fault; no all-200 default. Login
 * and signature verification occur only on the original graph, before each fault
 * and after restoration. A pre-fault client/session crosses the JVM restart. */
export async function runAmisFaultCases({mode,base,env,originalVariant,account,target,nativeCases,faultNativeCases,probe=env?.probe,
  clientFactory=()=>new ProductionOAuthClient(base),control,expectedFaultStatuses,persist}) {
  assert(['A','B'].includes(mode),'Explicit A/B mode required')
  assert.equal(new URL(base).origin,base)
  assert.equal(typeof env?.reconfigure,'function')
  assert.equal(env.current.mode,mode,'Active deployment mode mismatch')
  const variants=amisFaultVariants(mode)
  for(const fault of variants) {
    const status=expectedFaultStatuses?.[fault.name]
    assert(Number.isInteger(status),'Caller exact published fault status required: '+fault.name)
    const accepted = fault.name === 'missing-authorization' ? [401]
      : fault.status === 404 ? [mode === 'B' ? 403 : 404] : [503]
    assert(accepted.includes(status),'Unsupported fail-closed status')
    fault.status=status
    const matrix=faultNativeCases?.[fault.name]
    assert(Array.isArray(nativeCases)&&nativeCases.length===9&&Array.isArray(matrix),'Explicit per-fault native matrix required: '+fault.name)
    assert.deepEqual(matrix.map(row=>row.path),nativeCases.map(row=>row.path),'Fault native paths must match original nine-path matrix')
    for(const row of matrix){
      assert(Number.isInteger(row.status)&&row.status>=200&&row.status<=599,'Exact native status required')
      const redirected = row.status === 307
      if (redirected) {
        assert.equal(row.contentType, null, 'Native redirect must have the verified absent MIME')
        assert.equal(row.location, '/oidc/logout', 'Invalidated native session must use the exact local logout entry')
      } else assert(typeof row.contentType==='string'&&row.contentType,'Exact native MIME required')
      if(row.marker!==undefined)assert(typeof row.marker==='string'&&row.marker,'Native marker required')
    }
  }
  assert(originalVariant&&typeof originalVariant==='object'&&!Array.isArray(originalVariant),'Explicit originalVariant required')
  assert(originalVariant.amisPresent!==false&&originalVariant.amisEnabled!==false,'Original AMIS graph must be enabled')
  assert(mode==='A'?originalVariant.rbacPresent!==true:originalVariant.rbacPresent!==false,'Original RBAC mode must be preserved')
  assert(!originalVariant.testJvmProperties||Object.keys(originalVariant.testJvmProperties).length===0,'Original graph must have faults disabled')
  assert.equal(typeof control,'function','Caller allowed API control required')
  assert.equal(typeof persist,'function')
  assert(account?.username&&account.password,'Private production account required')
  if(mode==='B')assert(Array.isArray(account.expectedScopeKeys),'Signed exact scopes required for B')
  const path=amisApiPath(target)
  assert(typeof target.marker==='string'&&target.marker,'Caller fault POST marker required')
  const page=`/${target.namespace}/${target.flowId}/pages/${target.pageId}`
  assert(/^[A-Za-z0-9_][A-Za-z0-9_-]{0,99}$/.test(target.pageId))
  const report={mode,scope:'HTTP fault fragments; not browser or complete acceptance44 evidence',cases:[],completed:false}
  const clean=value=>{
    if(typeof value==='string')return value.split(account.password).join('[redacted]').replace(/Bearer\s+[^\s"']+/gi,'Bearer [redacted]')
    if(Array.isArray(value))return value.map(clean)
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!/password|token|cookie|secret/i.test(key)).map(([key,item])=>[key,clean(item)]))
    return value
  }
  const safeFailure=error=>['AMIS_EFFECTS_CHANGED','AMIS_OBSERVER_FAILED','AMIS_RESPONSE_ASSERTION','AMIS_REQUEST_FAILED'].includes(error.code)?error.code:error instanceof assert.AssertionError?'AssertionError':error.message==='Native HTTP regression failed'?error.message:'Operation failed; private runner diagnostics retained by caller'
  const save=async()=>{
    try{await persist(clean(structuredClone(report)))}catch(cause){
      report.completed=false;report.persistenceFailure=true
      const error=new Error('Fault report persistence failed');error.report=clean(structuredClone(report));error.cause=cause;throw error
    }
  }
  const login=async()=>{
    const client=await clientFactory()
    const exit=await client.request('/oidc/logout',{redirect:'manual'})
    assert([200,302,303,307,308].includes(exit.status),'Production logout failed');await exit.body?.cancel()
    const auth=await client.login(account.username,account.password)
    assert(auth?.authenticated===true&&auth.credentialsSubmitted===true,'Fresh credentials submission required')
    let identity={authenticated:true,subject:account.username,credentialsSubmitted:true}
    if(mode==='B'||account.expectedScopeKeys!==undefined) {
      const signed=await client.verifiedUiIdentity({applicationGroupId:'main',subject:account.username,audience:'kestra-ui'})
      assert.deepEqual([...signed.applicationGroupScopes].sort(),[...account.expectedScopeKeys].sort(),'Signed scope mismatch')
      assert(Number.isSafeInteger(signed.authorizationVersion)&&signed.authorizationVersion>0,'Signed revision missing')
      identity={...identity,applicationGroupScopes:signed.applicationGroupScopes,authorizationVersion:signed.authorizationVersion}
    }
    return {client,identity}
  }
  const effects=()=>env.current.effects
  const controlIds=[]
  const provenance=()=>validateAmisControlEvents(effects().controlEvents([...controlIds]),controlIds)
  const eventChanges=(before,after)=>{
    const keyed=value=>new Map(value.events.map(row=>[row.offset,JSON.stringify(row)]))
    const previous=keyed(before),current=keyed(after)
    return {added:after.events.filter(row=>previous.get(row.offset)!==JSON.stringify(row)),removed:before.events.filter(row=>current.get(row.offset)!==JSON.stringify(row)),inventoryAdded:after.inventory.filter(id=>!before.inventory.includes(id)),inventoryRemoved:before.inventory.filter(id=>!after.inventory.includes(id)),scope:'Known prior positive control IDs only; never an exemption from strict whole-queue comparison'}
  }
  const stable=async()=>{
    assert.equal(env.current.mode,mode,'Deployment mode changed')
    const idle=await effects().waitForIdle();assert.equal(idle.active,0,'Active executions remain')
    const value=await effects().waitForStable();assert(value.windowMs>=5000&&value.samples?.length&&value.samples.at(-1).elapsedMs>=value.windowMs,'Stable baseline missing')
    for(const sample of value.samples){assert(sha.test(sample.hash),'Stable sample hash missing');for(const key of sources)assert(sha.test(sample.sources?.[key]),'Stable source missing: '+key)}
    return {idle,stable:value}
  }
  const native=async(session)=>{
    const result=await runAmisNativeCases({mode,base,nativeCases,probe,authClient:session.client,identityEvidence:session.identity,persist:async()=>{}})
    if(result.status!=='passed'){const error=new Error('Native HTTP regression failed');error.nativeReport=result;throw error}
    return result
  }
  const allowed=async(session)=>{
    const spec=await control({mode,client:session.client,target})
    assert(spec?.inputs&&Object.hasOwn(spec,'expectedData'),'Explicit allowed control inputs/result required')
    const before=snapshot(await probe.snapshot())
    const result=await invokeAmisApi(session.client,{...spec,namespace:target.namespace,flowId:target.flowId,apiId:target.apiId})
    assert(!controlIds.includes(result.executionId),'Positive control execution ID reused')
    controlIds.push(result.executionId)
    await stable()
    const after=snapshot(await probe.snapshot());assert.equal(after.generation,before.generation)
    for(const key of ['flowLookup','flowMeta',...(mode==='B'?['flowAuthorization']:[])])assert(after[key]>before[key],`Positive control did not exercise ${key}`)
    return {executionId:result.executionId,before,after,eventSources:provenance()}
  }
  // Establish that the original graph can actually allow execution, rather than all-deny.
  report.baseline={};await save()
  try {const session=await login();report.baseline.identity=session.identity;await stable();report.baseline.control=await allowed(session);report.baseline.native=await native(session);await save()}
  catch(error){report.failure={phase:'baseline',message:safeFailure(error)};await save();const failure=new Error('Fault baseline failed');failure.report=clean(report);failure.cause=error;throw failure}
  for(const family of ['native','route',...(mode==='B'?['authorization']:[])]) {
    const id=`${mode}-${family==='native'?'missing-and-disabled-extension-native-regression':family==='route'?'missing-duplicate-and-faulted-route-provider-fail-closed':'missing-duplicate-and-faulted-authorization-fail-closed'}`
    const row={id,status:'running',faults:[]};report.cases.push(row)
    for(const fault of variants.filter(item=>item.family===family)) {
      const entry={name:fault.name,status:'running',variant:fault.variant,checks:[],restoration:{status:'pending'}};row.faults.push(entry)
      let failed
      try {
        const session=await login()
        entry.preFaultIdentity=structuredClone(session.identity)
        entry.preFaultProbe=snapshot(await probe.snapshot())
        await env.reconfigure(structuredClone(fault.variant))
        const faultProbe=snapshot(await probe.snapshot())
        entry.crossJvm={sourceGeneration:entry.preFaultProbe.generation,faultGeneration:faultProbe.generation,sessionSource:'original-graph-production-login',newIdentityRequestedDuringFault:false}
        assert.notEqual(faultProbe.generation,entry.preFaultProbe.generation,'Fault did not start a new JVM generation')
        entry.baseline=await stable()
        for(const [method,url]of [['GET',page],['POST',path]]) {
          const check={method,path:url,expectedStatus:fault.status};entry.checks.push(check)
          check.before=snapshot(await probe.snapshot())
          check.eventSourcesBefore=provenance()
          try {
            const denied=await effects().observeDenied(()=>session.client.request(url,{method,redirect:'manual',signal:AbortSignal.timeout(30000),...(method==='POST'?{headers:{'Content-Type':'application/json'},body:JSON.stringify({name:target.marker})}:{})}),async response=>{
              check.status=response.status;assert.equal(response.status,fault.status,'Unexpected fault response status');await response.body?.cancel()
            },{windowMs:5000,intervalMs:250})
            check.sideEffects=observation(denied.observation)
          }catch(error){
            if(error.sideEffects)check.sideEffects=error.sideEffects
            try {check.eventSourcesAfter=provenance();check.controlEventChanges=eventChanges(check.eventSourcesBefore,check.eventSourcesAfter)} catch {check.eventSourceObservationFailed=true}
            throw error
          }
          check.eventSourcesAfter=provenance()
          check.controlEventChanges=eventChanges(check.eventSourcesBefore,check.eventSourcesAfter)
          check.after=snapshot(await probe.snapshot());assert.equal(check.after.generation,check.before.generation,'Probe generation changed during request')
          for(const key of counters)assert.equal(check.after[key],check.before[key],`Fault reached protected lookup: ${key}`)
          check.passed=true;await save()
        }
        entry.native={status:'running',checks:[]}
        const nativeBefore=snapshot(await probe.snapshot())
        for(const expected of faultNativeCases[fault.name]) {
          const check={path:expected.path,expectedStatus:expected.status};entry.native.checks.push(check)
          const response=await session.client.request(expected.path,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(30000)})
          check.status=response.status;check.contentType=response.headers.get('content-type')
          if(expected.location !== undefined) {check.location=response.headers.get('location');assert.equal(check.location,expected.location,'Native redirect target mismatch')}
          const bytes=Buffer.from(await response.arrayBuffer());check.sha256=createHash('sha256').update(bytes).digest('hex')
          assert.equal(check.status,expected.status,'Fault native status mismatch');assert.equal(check.contentType,expected.contentType,'Fault native MIME mismatch')
          const text=bytes.toString('utf8');assert(!text.includes('amis-bootstrap'),'AMIS intercepted native path')
          if(expected.marker)assert(text.includes(expected.marker),'Fault native marker missing')
          check.passed=true
        }
        const nativeAfter=snapshot(await probe.snapshot());assert.equal(nativeAfter.generation,nativeBefore.generation,'Native generation changed')
        for(const key of counters)assert.equal(nativeAfter[key],nativeBefore[key],'Native request reached AMIS lookup: '+key)
        entry.native.status='passed'
        entry.status='passed'
      }catch(error){failed=error;entry.status='failed';entry.safeError=safeFailure(error);if(entry.native?.status==='running')entry.native.status='failed';if(error.nativeReport)entry.native=error.nativeReport}
      finally {
        try {
          await env.reconfigure(structuredClone(originalVariant))
          const session=await login();entry.restoration.identity=session.identity;entry.restoration.probe=snapshot(await probe.snapshot());await stable()
          entry.restoration.control=await allowed(session);entry.restoration.native=await native(session)
          entry.restoration.status='passed'
        }catch(error){entry.restoration.status='failed';entry.restoration.safeError=safeFailure(error);if(error.nativeReport)entry.restoration.native=error.nativeReport;failed??=error}
      }
      if(failed){entry.status='failed';row.status='failed';report.failure={id,fault:fault.name,message:safeFailure(failed)};report.counts={passed:report.cases.filter(item=>item.status==='passed').length,failed:1,notRun:(mode==='B'?3:2)-report.cases.length,skipped:0};await save();const error=new Error(`AMIS fault fragment failed: ${fault.name}`);error.report=clean(structuredClone(report));error.cause=failed;throw error}
      await save()
    }
    row.status='passed';await save()
  }
  report.completed=true;report.counts={passed:report.cases.length,failed:0,notRun:0,skipped:0};await save()
  return clean(structuredClone(report))
}
