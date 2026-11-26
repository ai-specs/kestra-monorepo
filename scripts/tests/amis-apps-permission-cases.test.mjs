import assert from 'node:assert/strict'
import test from 'node:test'
import {planAmisActors} from '../amis-apps-actors.mjs'
import {runAmisPermissionCases,amisPermissionCaseIds} from '../amis-apps-permission-cases.mjs'

// Synthetic stateful transport and observations. Never production acceptance evidence.
const base='https://permission-unit.invalid'
const target={namespaceA:'company.amis.a',namespaceB:'company.amis.b',namespaceOutside:'company2.amis.a',flowId:'Greeting.v1',pageId:'_home',apiId:'greet',marker:'UNIT-MARKER',missingPath:'/company.amis.a/known-missing/pages/home',intervalMs:1,timeoutMs:1000}
const hash='a'.repeat(64)
const sources={database:'b'.repeat(64),queue:'c'.repeat(64),storage:'d'.repeat(64)}
function fixture(settings={}) {
  const plan=planAmisActors({namespaceA:target.namespaceA,namespaceB:target.namespaceB})
  const actors=plan.actors.map(actor=>({...actor,password:'PRIVATE-UNIT-PASSWORD-'+actor.key}))
  const observations=[]; const actions=[]; const persisted=[]; let currentSession='previous-user'; let sequence=0
  const counter={generation:'synthetic-generation',integrity:'ok',readiness:{flowRepositoryListener:true,flowMetaStoreListener:true,storageListener:true,namespaceFactoryListener:true,authorizationListener:true},flowLookup:0,flowMeta:0,schemaStorage:0,namespaceResolve:0,flowAuthorization:0}
  const executions=new Map()
  const response=(status,value={})=>({status,body:{cancel:async()=>{}},json:async()=>structuredClone(value),text:async()=>JSON.stringify(value)})
  const clientFactory=()=>{
    let subject; let loggedOut=false
    return {
      async login(username,password){
        assert(loggedOut,'actual logout must precede login')
        assert.equal(currentSession,null,'logout must clear session')
        const actor=actors.find(actor=>actor.username===username)
        assert.equal(password,actor.password)
        subject=actor; currentSession=username; actions.push({kind:'login',actor:actor.key})
        return {authenticated:true,credentialsSubmitted:!settings.reusedLogin}
      },
      async verifiedUiIdentity(expected){
        assert.deepEqual(expected,{applicationGroupId:'main',subject:subject.username,audience:'kestra-ui'})
        return {applicationGroupScopes:settings.wrongScopes?['admin']:subject.scopeKeys,authorizationVersion:7}
      },
      async request(path,options={}) {
        const method=options.method??'GET'
        if(path==='/oidc/logout'){loggedOut=true;currentSession=null;actions.push({kind:'logout'});return response(303)}
        assert(subject,'signed-in actor required')
        actions.push({kind:'request',actor:subject.key,path,method})
        const poll=executions.get(path)
        if(poll){assert.equal(method,'GET');return response(200,{version:1,status:0,msg:'result',data:{message:poll.marker},executionId:poll.id,executionUrl:path,executionState:'SUCCESS',resultReady:true})}
        const match=/^\/([a-z0-9_.]+)\/([A-Za-z0-9._-]+)\/(pages|schemas|apis)\/([A-Za-z0-9_-]+)$/.exec(path)
        assert(match,'exact production AMIS path')
        const [,namespace,flowId,kind,id]=match
        assert.equal(method,kind==='apis'?'POST':'GET')
        assert.equal(id,kind==='apis'?target.apiId:kind==='pages'&&flowId==='known-missing'?'home':target.pageId)
        assert.equal(flowId,flowId==='known-missing'?'known-missing':target.flowId)
        const grants=plan.scopes.filter(scope=>subject.scopeKeys.includes(scope.key)).flatMap(scope=>scope.grants)
        const matches=pattern=>{
          const negate=pattern.startsWith('!'); const raw=negate?pattern.slice(1):pattern
          const fits=raw.endsWith('.*')?(namespace===raw.slice(0,-2)||namespace.startsWith(raw.slice(0,-1))):namespace===raw
          return negate?!fits:fits
        }
        const entry=grants.some(grant=>grant.resource==='EXTENSION_ROUTE'&&(matches(grant.namespace)||(settings.leakMixedRange&&subject.key==='mixed-ranges'))&&grant.ids.includes('amis-apps'))
        if(!entry)return response(settings.wrongStatus?200:403)
        counter.namespaceResolve++;counter.flowLookup++
        if(flowId==='known-missing')return response(404)
        counter.flowMeta++;counter.flowAuthorization++
        const flow=grants.some(grant=>grant.resource==='FLOW'&&matches(grant.namespace)&&grant.actions.includes('EXECUTE'))
        if(!flow)return response(403)
        if(kind==='schemas') {
          assert.equal(subject.key,'split','Explicit allowed schema control identity')
          if(settings.frozenSchemaNamespace)counter.namespaceResolve--
          if(!settings.frozenSchemaStorage)counter.schemaStorage++
          if(settings.schemaGenerationChange)counter.generation='schema-restarted'
          return response(200,{type:settings.invalidSchema?'form':'page',body:[]})
        }
        assert.equal(kind,'apis','No non-API allow expected in this REST fragment')
        assert.equal(options.headers['Content-Type'],'application/json')
        const body=JSON.parse(options.body);assert.deepEqual(Object.keys(body),['name']);assert(body.name.startsWith(target.marker))
        if(settings.noPositiveCounters){counter.flowLookup--;counter.flowMeta--;counter.flowAuthorization--}
        const executionId='execution-'+(++sequence);const executionUrl=path+'/executions/'+executionId
        executions.set(executionUrl,{id:executionId,marker:settings.wrongMarker?'WRONG':body.name})
        return response(202,{version:1,status:0,msg:'pending',data:{},executionId,executionUrl,executionState:'CREATED',resultReady:false})
      }
    }
  }
  const effects={
    async waitForIdle(){observations.push('idle');return {active:0,waitedMs:0}},
    async waitForStable(){observations.push('stable');return {windowMs:5000,samples:[{elapsedMs:5000,hash,sources}]}},
    async observeDenied(action,verify,options){
      assert(options.windowMs>=5000); observations.push('denied-window')
      const result=await action();let failure
      try{await verify(result)}catch(error){failure=error}
      const observation={before:hash,immediate:hash,sources:Object.keys(sources),beforeSources:structuredClone(sources),windowMs:5000,samples:[{elapsedMs:5000,hash,sources:structuredClone(sources)}]}
      if(settings.missingEffects)delete observation.samples[0].sources.storage
      if(settings.changedEffects)observation.samples[0].sources.database='f'.repeat(64)
      if(settings.shortWindow)observation.samples[0].elapsedMs=4999
      if(settings.generationChange)counter.generation='changed-generation'
      if(settings.illegalLookup)counter.schemaStorage++
      if(failure){failure.sideEffects=observation;throw failure}
      return {response:result,observation}
    }
  }
  const probe={async snapshot(){
    const value=structuredClone(counter)
    if(settings.notReady)value.readiness.storageListener=false
    if(settings.missingCounter)delete value.flowAuthorization
    return value
  }}
  return {options:{base,actors,clientFactory,target:{...target},effects,probe,persist:async report=>{persisted.push(report)}},actions,persisted,observations}
}

test('SYNTHETIC TRANSPORT complete seven REST case IDs, signed scopes, actual API polling and strict isolated range rules',async()=>{
  const f=fixture();const report=await runAmisPermissionCases(f.options)
  assert.equal(report.completed,true);assert.deepEqual(report.cases.map(row=>row.id),amisPermissionCaseIds)
  assert.deepEqual(report.counts,{passed:7,failed:0,notRun:0,skipped:0})
  assert(report.positiveControl.after.flowLookup>report.positiveControl.before.flowLookup)
  assert(report.schemaPositiveControl.completed)
  assert.equal(report.schemaPositiveControl.identity.actor,'split')
  assert.equal(report.schemaPositiveControl.schemaType,'page')
  assert(report.schemaPositiveControl.after.namespaceResolve>report.schemaPositiveControl.before.namespaceResolve)
  assert(report.schemaPositiveControl.after.schemaStorage>report.schemaPositiveControl.before.schemaStorage)
  for(const row of report.cases.slice(0,2)) {
    const denial=row.observations.find(value=>value.kind==='deny')
    assert.equal(denial.before.generation,report.schemaPositiveControl.after.generation)
    assert.equal(denial.positiveControls.schemaPath,'/company.amis.a/Greeting.v1/schemas/_home')
    assert.equal(denial.positiveControls.schemaIdentity.actor,'split')
  }
  for(const row of report.cases)for(const observation of row.observations.filter(value=>value.kind==='deny')){
    assert.equal(observation.sideEffects.windowMs,5000)
    if(observation.zeroLookups)assert(Object.values(observation.difference).every(value=>value===0))
  }
  const mixed=f.actions.filter(action=>action.actor==='mixed-ranges'&&action.kind==='request')
  assert.deepEqual(mixed.map(row=>[row.method,row.path]),[['POST','/company.amis.a/Greeting.v1/apis/greet'],['POST','/company.amis.b/Greeting.v1/apis/greet']])
  const boundary=report.cases.at(-1).observations
  assert(boundary.some(value=>value.kind==='deny'&&value.path==='/company.amis.a.child/Greeting.v1/apis/greet'))
  assert(boundary.some(value=>value.kind==='deny'&&value.path==='/company.amis.b.child/Greeting.v1/apis/greet'))
  assert(boundary.some(value=>value.kind==='deny'&&value.path==='/company2.amis.a/Greeting.v1/apis/greet'))
  assert(!JSON.stringify(f.persisted).includes('PRIVATE-UNIT-PASSWORD'))
  assert.match(report.scope,/REST permission fragment only/)
})

for(const [name,settings,message]of[
  ['wrong status',{wrongStatus:true},/Unexpected GET/],
  ['missing effects field',{missingEffects:true},/storage changed or missing/],
  ['delayed mutation',{changedEffects:true},/database changed or missing/],
  ['too short observation',{shortWindow:true},/too early/],
  ['probe listener not ready',{notReady:true},/listener not ready/],
  ['probe missing counter',{missingCounter:true},/Missing probe counter/],
  ['probe generation changes',{generationChange:true},/generation changed/],
  ['first-gate lookup',{illegalLookup:true},/queried schemaStorage/],
  ['no positive control',{noPositiveCounters:true},/Positive control did not exercise/],
  ['wrong result marker',{wrongMarker:true},/Expected values/],
  ['reused login',{reusedLogin:true},/Fresh credential/],
  ['signed scopes too broad',{wrongScopes:true},/Signed exact scopes/]
])test(`SYNTHETIC TRANSPORT rejects ${name} and persists failed case`,async()=>{
  const f=fixture(settings)
  await assert.rejects(runAmisPermissionCases(f.options),error=>{
    assert.match(error.message,message)
    assert.equal(error.report.cases[0].status,'failed')
    assert.equal(error.report.completed,false)
    assert.equal(f.persisted.at(-1).counts.failed,1)
    assert.equal(error.report.cases[1].status,'not_run')
    assert(!JSON.stringify(error.report).includes('PRIVATE-UNIT-PASSWORD'))
    return true
  })
})

test('SYNTHETIC TRANSPORT a later failure retains earlier actual observations',async()=>{
  const f=fixture();let denied=0;const original=f.options.effects.observeDenied
  f.options.effects.observeDenied=async(...args)=>{denied++;if(denied===3)throw new Error('bounded observer unavailable');return original(...args)}
  await assert.rejects(runAmisPermissionCases(f.options),error=>{
    assert.deepEqual(error.report.cases.slice(0,3).map(row=>row.status),['passed','passed','failed'])
    assert(error.report.cases[0].observations.length>0)
    assert.equal(error.report.counts.passed,2)
    return true
  })
})

test('SYNTHETIC TRANSPORT absent probe cannot default to zeros and no guessed missing path',async()=>{
  for(const mutate of [f=>{f.options.probe=undefined},f=>{delete f.options.target.missingPath},f=>{f.options.actors.find(actor=>actor.key==='entry-only').scopeKeys.push('amis-flow-a')},f=>{f.options.actors.pop()}]){
    const f=fixture();mutate(f);await assert.rejects(runAmisPermissionCases(f.options));assert.equal(f.actions.length,0)
  }
})

test('SYNTHETIC TRANSPORT injected cross-scope range leakage fails mixed case and retains prior five results',async()=>{
  const f=fixture({leakMixedRange:true})
  await assert.rejects(runAmisPermissionCases(f.options),error=>{
    assert.equal(error.report.failure.id,'B-multiple-scopes-distinct-resource-ranges')
    assert.equal(error.report.counts.passed,5)
    const attempts=error.report.cases[5].observations
    assert(attempts.some(row=>row.kind==='deny'&&row.path.includes('/company.amis.b/')&&row.status===202&&row.completed===false))
    return true
  })
})

test('SYNTHETIC TRANSPORT probe restart between cases invalidates prior positive control',async()=>{
  const f=fixture();let denials=0
  const observe=f.options.effects.observeDenied
  f.options.effects.observeDenied=async(...args)=>{denials++;return observe(...args)}
  const snapshot=f.options.probe.snapshot
  f.options.probe.snapshot=async()=>{const result=await snapshot();if(denials>=1&&f.persisted.some(report=>report.cases[0].status==='passed'))result.generation='new-process-generation';return result}
  await assert.rejects(runAmisPermissionCases(f.options),error=>{
    assert.equal(error.report.cases[0].status,'passed')
    assert.equal(error.report.cases[1].status,'failed')
    assert.match(error.message,/generation differs from positive control/)
    return true
  })
})

test('SYNTHETIC TRANSPORT unstable or incomplete baseline cannot be counted as a ready namespace',async()=>{
  for(const change of [f=>{f.options.effects.waitForIdle=async()=>({active:1})},f=>{f.options.effects.waitForStable=async()=>({windowMs:5000,samples:[]})},f=>{f.options.effects.waitForStable=async()=>({windowMs:5000,samples:[{hash,sources:{database:sources.database,queue:sources.queue}}]})}]){
    const f=fixture();change(f)
    await assert.rejects(runAmisPermissionCases(f.options),error=>{
      assert.equal(error.report.cases[0].status,'failed')
      assert.equal(error.report.positiveControl,null)
      assert.equal(f.actions.length,0)
      return true
    })
  }
})

for(const [name,settings,message]of [
  ['ready namespace counter frozen',{frozenSchemaNamespace:true},/Schema positive control did not exercise namespaceResolve/],
  ['ready storage counter frozen',{frozenSchemaStorage:true},/Schema positive control did not exercise schemaStorage/],
  ['schema not page',{invalidSchema:true},/must return an AMIS page/],
  ['schema generation restart',{schemaGenerationChange:true},/generation changed during schema/],
])test('SYNTHETIC TRANSPORT rejects '+name+' before zero-lookup cases',async()=>{
  const f=fixture(settings)
  await assert.rejects(runAmisPermissionCases(f.options),error=>{
    assert.match(error.message,message)
    assert.equal(error.report.cases[0].status,'failed')
    assert.equal(error.report.cases[1].status,'not_run')
    assert(error.report.positiveControl)
    const schema=error.report.cases[0].observations.find(row=>row.kind==='allow-schema')
    assert(schema && schema.identity.actor==='split' && schema.completed===false)
    assert(!error.report.cases[0].observations.some(row=>row.kind==='deny'))
    assert.equal(f.persisted.at(-1).completed,false)
    return true
  })
})
