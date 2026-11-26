import assert from 'node:assert/strict'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {amisApiPath} from './amis-apps-http.mjs'

const names = ['anonymous-api-denied-without-side-effects','cookie-write-missing-and-invalid-csrf',
  'same-site-cross-origin-cookie-write-denied','body-cannot-replace-route-identity',
  'foreign-execution-and-output-access-denied','sibling-authority-traversal-and-invalid-schema-denied']
const sourceNames = ['database','queue','storage']
const counterNames = ['flowLookup','flowMeta','schemaStorage','namespaceResolve','flowAuthorization']
const listenerNames = ['flowRepositoryListener','flowMetaStoreListener','storageListener','namespaceFactoryListener','authorizationListener']
const digest = /^[a-f0-9]{64}$/

function probeValue(value) {
  assert(typeof value?.generation==='string'&&value.generation,'Probe generation required')
  assert.equal(value.integrity,'ok','Probe integrity failed')
  for(const name of listenerNames)assert.equal(value.readiness?.[name],true,`Probe listener not ready: ${name}`)
  for(const name of counterNames)assert(Number.isSafeInteger(value[name])&&value[name]>=0,`Missing probe counter ${name}`)
  return structuredClone(value)
}
function sideEffects(value) {
  assert(value?.windowMs>=5000,'Denied effects window must be >=5000ms')
  assert.deepEqual([...(value.sources??[])].sort(),sourceNames)
  assert(digest.test(value.before)&&value.immediate===value.before,'Immediate denied effects changed')
  for(const source of sourceNames)assert(digest.test(value.beforeSources?.[source]),`Missing before ${source}`)
  assert(Array.isArray(value.samples)&&value.samples.length>0,'Actual delayed samples required')
  assert(value.samples.at(-1).elapsedMs>=value.windowMs,'Delayed effects observation too short')
  let previous=-1
  for(const sample of value.samples) {
    assert(Number.isFinite(sample.elapsedMs)&&sample.elapsedMs>=previous,'Invalid sample timing');previous=sample.elapsedMs
    assert.equal(sample.hash,value.before,'Delayed denied effects changed')
    for(const source of sourceNames)assert.equal(sample.sources?.[source],value.beforeSources[source],`Denied ${source} missing or changed`)
  }
}

/** Only request-boundary observations over a caller-owned, already seeded deployment. */
export async function runAmisSecurityCases({mode,base,account,clientFactory=()=>new ProductionOAuthClient(base),publicTransport=fetch,effects,probe,target,persist,schemaAdminClient}) {
  assert(['A','B'].includes(mode));assert.equal(new URL(base).origin,base)
  assert(typeof account?.username==='string'&&account.username&&typeof account?.password==='string'&&account.password)
  assert.equal(typeof publicTransport,'function');assert.equal(typeof persist,'function')
  for(const name of ['waitForIdle','waitForStable','observeDenied'])assert.equal(typeof effects?.[name],'function',`effects.${name} required`)
  assert.equal(typeof probe?.snapshot,'function','Real public-contract probe required')
  if(mode==='B'||account.expectedScopeKeys!==undefined) {
    assert(Array.isArray(account.expectedScopeKeys)&&account.expectedScopeKeys.every(key=>typeof key==='string'&&key),'Explicit expectedScopeKeys required')
    assert.equal(new Set(account.expectedScopeKeys).size,account.expectedScopeKeys.length)
    assert.equal(account.groupId??'main','main')
  }
  const apiPath=amisApiPath(target)
  assert(typeof target.conflictingApiId==='string'&&/^[A-Za-z0-9_][A-Za-z0-9_-]{0,99}$/.test(target.conflictingApiId)&&target.conflictingApiId!==target.apiId,'Explicit conflicting API binding required')
  const markerKeys=['anonymous','missingCsrf','invalidCsrf','crossOrigin','routeIdentity']
  for(const key of markerKeys)assert(typeof target.markers?.[key]==='string'&&target.markers[key].trim(),`Caller unique POST marker required: ${key}`)
  assert.equal(new Set(markerKeys.map(key=>target.markers[key])).size,markerKeys.length,'POST markers must be distinct')
  const origin=new URL(base)
  const crossOrigin=new URL(base); crossOrigin.port=String(origin.port==='65535'?65534:65535)
  assert.equal(crossOrigin.hostname,origin.hostname);assert.notEqual(crossOrigin.origin,origin.origin)
  const requestPath=value=>{
    assert(typeof value==='string'&&value.startsWith('/')&&!value.startsWith('//')&&!value.includes('\\'),'Same-origin absolute path required')
    const url=new URL(value,base)
    assert.equal(url.origin,base,'Never send cookie to external origin')
    assert(!url.hash&&url.pathname+url.search===value,'Client URL normalization would alter seeded request path')
    for(const key of url.searchParams.keys())assert(!/^(password|temporarypassword|token|accesstoken|idtoken|refreshtoken|clientsecret|authorization|cookie)$/.test(key.toLowerCase().replace(/[^a-z]/g,'')),'Credentials must not be encoded in seeded request paths')
    return value
  }
  assert(Array.isArray(target.foreignCases)&&target.foreignCases.length===2,'Explicit foreign-execution and output-access seeded cases required')
  assert.deepEqual(target.foreignCases.map(row=>row.kind).sort(),['foreign-execution','output-access'])
  for(const row of target.foreignCases) {
    assert.equal(row.seeded,true,'Foreign target must be caller-seeded');assert([403,404].includes(row.expectedStatus),'Explicit foreign denial 403/404 required')
    const binding=amisApiPath(row)
    assert(/^[A-Za-z0-9_][A-Za-z0-9_-]{0,99}$/.test(row.executionId),'Real caller execution ID required')
    assert(typeof row.marker==='string'&&row.marker.trim(),'Foreign output marker required')
    requestPath(row.path)
    assert(row.path===apiPath+'/executions/'+row.executionId||row.path===binding+'/executions/'+row.executionId,'Foreign request must bind an explicitly supplied execution')
    if(row.kind==='foreign-execution')assert(row.namespace!==target.namespace||row.flowId!==target.flowId,'Foreign execution must come from another Flow')
    if (row.account) {
      assert.equal(row.kind, 'output-access')
      assert.equal(mode, 'B')
      assert(typeof row.account.username === 'string' && row.account.username && typeof row.account.password === 'string' && row.account.password)
      assert.notEqual(row.account.username, account.username, 'Output denial requires a distinct least-privilege actor')
      assert(Array.isArray(row.account.expectedScopeKeys))
    }
  }
  assert(Array.isArray(target.schemaCases)&&target.schemaCases.length>=4,'Caller seeded schema matrix required')
  const kinds=['sibling','authority','traversal','invalid-schema']
  for(const kind of kinds)assert(target.schemaCases.some(row=>row.kind===kind),`Missing seeded schema case ${kind}`)
  for(const row of target.schemaCases) {
    assert(kinds.includes(row.kind)&&row.seeded===true,'Explicit seeded schema case required')
    if (['authority','traversal'].includes(row.kind)) assert.equal(row.phase, 'declaration-validation',
      'Malformed schema references must exercise authoring validation, not a missing runtime path')
    assert([400,403,404,413,422].includes(row.expectedStatus),'Explicit schema denial status required')
    assert(typeof row.id==='string'&&/^[a-z0-9-]+$/.test(row.id));requestPath(row.path)
    if (row.phase === 'declaration-validation') {
      assert(['authority','traversal'].includes(row.kind), 'Only invalid reference declarations use the authoring boundary')
      assert.equal(row.path, '/api/v1/main/flows')
      assert.equal(typeof schemaAdminClient?.request, 'function', 'Explicit authenticated schema author required')
      assert(typeof row.source === 'string' && row.source.length > 0 && row.source.length <= 1048576)
      assert.equal(row.expectedStatus, 422, 'Malformed declarations must use the native validation-failed response, not authorization')
    } else assert(row.phase === undefined || row.phase === 'runtime', 'Unknown schema rejection phase')
  }
  assert.equal(new Set(target.schemaCases.map(row=>row.id)).size,target.schemaCases.length)
  const secrets=[account.password,...target.foreignCases.map(row=>row.account?.password).filter(Boolean)]
  const clean=value=>{
    if(typeof value==='string') {
      for(const secret of secrets)value=value.replaceAll(secret,'[redacted]').replaceAll(encodeURIComponent(secret),'[redacted]')
      return value.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted-jwt]').replace(/Bearer\s+[^\s,;]+/gi,'Bearer [redacted]')
    }
    if(Array.isArray(value))return value.map(clean)
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!/^(password|temporarypassword|token|accesstoken|idtoken|refreshtoken|cookie|cookies|headers|body|authorization|clientsecret)$/.test(key.toLowerCase().replace(/[^a-z]/g,''))).map(([key,item])=>[key,clean(item)]))
    return value
  }
  const report={schemaVersion:1,mode,completed:false,scope:'REST security request-boundary fragment; not browser behavior, UI acceptance or complete 44-case/P0 verdict',cases:names.map(name=>({id:mode+'-'+name,status:'not_run',observations:[]})),limits:['Caller seeded target existence and owns cleanup; no resource is created by this helper','Effects and probe evidence supplied by caller; no SQL, private RBAC or deployment inspection','Synthetic transport unit results do not establish production authentication/authorization behavior']}
  const save=()=>persist(clean(structuredClone(report)))
  const snapshot=async()=>probeValue(await probe.snapshot())
  const baseline=async()=>{
    const idle=await effects.waitForIdle();assert.equal(idle?.active,0,'Target namespace not idle')
    const stable=await effects.waitForStable()
    assert(stable?.windowMs>=5000&&Array.isArray(stable.samples)&&stable.samples.length,'Stable effect samples required')
    for(const sample of stable.samples) {
      assert(digest.test(sample.hash),'Stable hash missing')
      for(const source of sourceNames)assert(digest.test(sample.sources?.[source]),`Stable ${source} missing`)
    }
    return {idle,stable}
  }
  const login=async(actor=account)=>{
    const client=clientFactory();assert.equal(typeof client?.request,'function')
    const exit=await client.request('/oidc/logout');assert([200,302,303,307,308].includes(exit.status),'Production logout failed');await exit.body?.cancel()
    const result=await client.login(actor.username,actor.password)
    assert(result.authenticated===true&&result.credentialsSubmitted===true,'Fresh credential submission required')
    if(mode==='B'||actor.expectedScopeKeys!==undefined) {
      const identity=await client.verifiedUiIdentity({applicationGroupId:'main',subject:actor.username,audience:'kestra-ui'})
      assert.deepEqual([...identity.applicationGroupScopes].sort(),[...actor.expectedScopeKeys].sort(),'Signed exact scopes mismatch')
      assert(Number.isSafeInteger(identity.authorizationVersion)&&identity.authorizationVersion>0,'Signed authorization version required')
      return {client,identity:{subject:actor.username,scopeKeys:identity.applicationGroupScopes,authorizationVersion:identity.authorizationVersion}}
    }
    return {client,identity:{subject:actor.username,credentialsSubmitted:true,rbacClaim:'Not required for Mode A'}}
  }
  let row
  const deny=async({label,path=apiPath,method='POST',status,send,forbiddenMarker,marker,nativeDeclarationValidation=false})=>{
    const observation={label,path:requestPath(path),method,expectedStatus:status,completed:false}
    if(method==='POST')observation.marker=marker
    row.observations.push(observation)
    observation.baseline=await baseline();observation.before=await snapshot()
    try {
      const result=await effects.observeDenied(send,async response=>{
        observation.status=response.status
        assert.equal(response.status,status,`Unexpected denial status for ${label}`)
        if (nativeDeclarationValidation) {
          const problem=await response.json()
          assert.equal(problem.type,'https://kestra.io/docs/api-reference/problems/validation-failed')
          assert.equal(problem.title,'Validation failed')
          assert(typeof problem.detail==='string' && problem.detail.includes('triggers[0].schema:'), 'Schema declaration must be the rejected field')
          observation.validation={type:problem.type,field:'triggers[0].schema'}
        } else
        if(forbiddenMarker) {
          const text=await response.text();assert(text.length<=1048576,'Denial response too large')
          let decoded='';try{decoded=JSON.stringify(JSON.parse(text))}catch{}
          assert(!text.includes(forbiddenMarker)&&!decoded.includes(forbiddenMarker),'Denied response leaked foreign output marker')
          observation.outputMarkerAbsent=true
        } else await response.body?.cancel()
      },{windowMs:5000,intervalMs:250})
      observation.sideEffects=result.observation
      sideEffects(result.observation)
      observation.after=await snapshot();assert.equal(observation.after.generation,observation.before.generation,'Probe generation changed during denial')
      for(const name of counterNames)assert(observation.after[name]>=observation.before[name],`Probe counter decreased: ${name}`)
      observation.counterDelta=Object.fromEntries(counterNames.map(name=>[name,observation.after[name]-observation.before[name]]))
      observation.safeError='Expected request rejection; response payload intentionally not retained'
      observation.completed=true
    }catch(error){if(error.sideEffects)observation.sideEffects=error.sideEffects;throw error}
  }
  const post=(client,key,headers={},extra={})=>()=>client.request(apiPath,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({name:target.markers[key],...extra})})
  await save()
  for(row of report.cases) {
    try {
      row.baseline=await baseline()
      const name=row.id.slice(2)
      if(name===names[0]) {
        await deny({label:'anonymous-api',status:401,marker:target.markers.anonymous,send:()=>publicTransport(base+apiPath,{method:'POST',credentials:'omit',redirect:'manual',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json'},body:JSON.stringify({name:target.markers.anonymous})})})
      }else{
        const {client,identity}=await login();row.identity=identity
        if(name===names[1]) {
          await deny({label:'missing-csrf',status:403,marker:target.markers.missingCsrf,send:post(client,'missingCsrf',{'X-CSRF-TOKEN':''})})
          await deny({label:'invalid-csrf',status:403,marker:target.markers.invalidCsrf,send:post(client,'invalidCsrf',{'X-CSRF-TOKEN':'AMIS-SECURITY-INVALID-CSRF-TEST'})})
        }
        if(name===names[2])await deny({label:'same-site-cross-origin-cookie-write',status:403,marker:target.markers.crossOrigin,send:post(client,'crossOrigin',{'X-CSRF-TOKEN':'',Origin:crossOrigin.origin,'Sec-Fetch-Site':'same-site'})})
        if(name===names[3])await deny({label:'body-api-binding-conflict',status:400,marker:target.markers.routeIdentity,send:post(client,'routeIdentity',{}, {apiId:target.conflictingApiId})})
        if(name===names[4])for(const targetCase of target.foreignCases) {
          const session = targetCase.account ? await login(targetCase.account) : {client}
          await deny({label:targetCase.kind,path:targetCase.path,method:'GET',status:targetCase.expectedStatus,forbiddenMarker:targetCase.marker,send:()=>session.client.request(targetCase.path,{method:'GET',headers:{Accept:'application/json'}})})
          if (session.identity) row.observations.at(-1).identity = session.identity
        }
        if(name===names[5])for(const targetCase of target.schemaCases) {
          const declaration = targetCase.phase === 'declaration-validation'
          await deny({label:targetCase.id,path:targetCase.path,method:declaration?'POST':'GET',status:targetCase.expectedStatus,nativeDeclarationValidation:declaration,
            send:()=> declaration
              ? schemaAdminClient.request(targetCase.path,{method:'POST',headers:{'Content-Type':'application/x-yaml'},body:targetCase.source})
              : client.request(targetCase.path,{method:'GET',headers:{Accept:'application/json'}})})
          row.observations.at(-1).phase = declaration ? 'declaration-validation' : 'runtime'
        }
      }
      row.status='passed';await save()
    }catch(error){
      row.status='failed';row.safeError=String(error.message)
      report.failure={id:row.id,message:String(error.message)}
      report.counts={passed:report.cases.filter(value=>value.status==='passed').length,failed:1,notRun:report.cases.filter(value=>value.status==='not_run').length,skipped:0}
      const retained=clean(structuredClone(report));try{await persist(retained)}catch(failure){retained.persistenceFailure=clean(String(failure.message))}
      const failure=new Error(clean(`AMIS security fragment ${row.id}: ${error.message}`));failure.report=retained;throw failure
    }
  }
  report.completed=true;report.counts={passed:6,failed:0,notRun:0,skipped:0}
  try{await save()}catch(error){
    report.completed=false;report.failure={id:'report-persistence',message:String(error.message)}
    const failure=new Error(clean(`Security report persistence failed: ${error.message}`));failure.report=clean(structuredClone(report));throw failure
  }
  return clean(structuredClone(report))
}
