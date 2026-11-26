import assert from 'node:assert/strict'
import test from 'node:test'
import {runAmisSecurityCases} from '../amis-apps-security-cases.mjs'
import {amisFixtureFlow} from '../amis-apps-fixture.mjs'

// Explicit synthetic transport. Nothing in this suite connects to a service.
const base='https://security-unit.invalid:18129'
const apiPath='/company.amis.a/Greeting.v1/apis/greet'
const password='SYNTHETIC-PRIVATE-ACCOUNT-PASSWORD'
const sources={database:'b'.repeat(64),queue:'c'.repeat(64),storage:'d'.repeat(64)}
const hash='a'.repeat(64)
function fixture(mode='B',fault={}) {
  const requests=[];const recorded=[];const transitions=[]
  let sequence=0;let session='previous-session';let signedIn=false
  const target={namespace:'company.amis.a',flowId:'Greeting.v1',apiId:'greet',conflictingApiId:'wrong-api',
    markers:{anonymous:'UNIQUE-ANONYMOUS',missingCsrf:'UNIQUE-MISSING-CSRF',invalidCsrf:'UNIQUE-INVALID-CSRF',crossOrigin:'UNIQUE-ORIGIN',routeIdentity:'UNIQUE-ROUTE'},
    foreignCases:[
      {kind:'foreign-execution',seeded:true,namespace:'company.amis.b',flowId:'OtherFlow',apiId:'greet',executionId:'foreign-exec',path:apiPath+'/executions/foreign-exec',expectedStatus:404,marker:'PRIVATE-FOREIGN-OUTPUT-MARKER'},
      {kind:'output-access',seeded:true,namespace:'company.amis.a',flowId:'Greeting.v1',apiId:'greet',executionId:'output-denied-exec',path:apiPath+'/executions/output-denied-exec',expectedStatus:403,marker:'PRIVATE-DENIED-OUTPUT-MARKER'}],
    schemaCases:[
      {kind:'sibling',id:'sibling-schema',seeded:true,path:'/company.amis.a/Greeting.v1/schemas/sibling',expectedStatus:403},
      {kind:'authority',id:'authority-schema',seeded:true,phase:'declaration-validation',path:'/api/v1/main/flows',source:amisFixtureFlow({namespace:'company.amis.a',flowId:'invalid-authority'}).replace('nsfile:///amis/home.json','nsfile://company.amis.b/amis/home.json'),expectedStatus:400},
      {kind:'traversal',id:'traversal-schema',seeded:true,phase:'declaration-validation',path:'/api/v1/main/flows',source:amisFixtureFlow({namespace:'company.amis.a',flowId:'invalid-traversal'}).replace('nsfile:///amis/home.json','nsfile:///amis/../private.json'),expectedStatus:400},
      {kind:'invalid-schema',id:'invalid-json-schema',seeded:true,path:'/company.amis.a/Greeting.v1/schemas/invalid',expectedStatus:400}]
  }
  const counter={generation:'SYNTHETIC-process-1',integrity:'ok',readiness:{flowRepositoryListener:true,flowMetaStoreListener:true,storageListener:true,namespaceFactoryListener:true,authorizationListener:true},flowLookup:0,flowMeta:0,schemaStorage:0,namespaceResolve:0,flowAuthorization:0}
  const response=(status,text='{"code":"safe_rejection"}')=>({status,body:{cancel:async()=>{}},text:async()=>text})
  const account={username:'security-test',password,...(mode==='B'?{groupId:'main',expectedScopeKeys:['amis-entry-a','amis-flow-a']}:{})}
  const clientFactory=()=>({
    async login(username,secret){
      assert.equal(session,null,'Logout must clear actual prior session')
      assert.equal(username,account.username);assert.equal(secret,password)
      session='SYNTHETIC-SESSION';signedIn=true;transitions.push('credentials-submitted')
      return {authenticated:true,credentialsSubmitted:!fault.reusedSession}
    },
    async verifiedUiIdentity(expected){
      assert.equal(mode,'B','Mode A without group must not demand RBAC identity claim')
      assert(signedIn)
      assert.deepEqual(expected,{applicationGroupId:'main',subject:account.username,audience:'kestra-ui'})
      transitions.push('verified-signed-identity')
      return {authorizationVersion:7,applicationGroupScopes:fault.wrongScopes?['admin']:account.expectedScopeKeys}
    },
    async request(path,options={}) {
      const method=options.method??'GET'
      if(path==='/oidc/logout'){
        transitions.push('logout');if(!fault.logoutNotCleared)session=null;signedIn=false
        return response(fault.logoutStatus??303)
      }
      assert.equal(signedIn,true);assert.equal(session,'SYNTHETIC-SESSION')
      // Model the actual client's automatic Cookie and default CSRF injection;
      // explicit empty X-CSRF-TOKEN must override the valid default.
      const headers={Cookie:'SYNTHETIC-COOKIE',...(method==='POST'?{'X-CSRF-TOKEN':'SYNTHETIC-VALID-CSRF'}:{}),...options.headers}
      requests.push({path,method,headers,body:options.body});sequence++
      if(fault.clientException)throw new Error(`client ${password} Bearer SYNTHETIC-TOKEN-LEAK`)
      if(path===apiPath){
        assert.equal(method,'POST');assert.equal(headers['Content-Type'],'application/json')
        const body=JSON.parse(options.body)
        const key=Object.keys(target.markers).find(key=>target.markers[key]===body.name);assert(key)
        assert.notEqual(key,'anonymous','Anonymous must not use cookie transport')
        if(key==='missingCsrf')assert.equal(headers['X-CSRF-TOKEN'],'')
        if(key==='invalidCsrf')assert.equal(headers['X-CSRF-TOKEN'],'AMIS-SECURITY-INVALID-CSRF-TEST')
        if(key==='crossOrigin'){
          assert.equal(headers['X-CSRF-TOKEN'],'');assert.equal(headers['Sec-Fetch-Site'],'same-site')
          assert.equal(new URL(headers.Origin).hostname,new URL(base).hostname)
          assert.notEqual(new URL(headers.Origin).port,new URL(base).port)
        }
        if(key==='routeIdentity'){
          assert.equal(headers['X-CSRF-TOKEN'],'SYNTHETIC-VALID-CSRF')
          assert.equal(body.apiId,target.conflictingApiId)
        }
        return response(fault.wrongCookieStatus??(key==='routeIdentity'?400:403))
      }
      const foreign=target.foreignCases.find(row=>row.path===path)
      if(foreign){
        assert.equal(method,'GET');assert.equal(headers.Accept,'application/json')
        const text=fault.leakOutput?JSON.stringify({message:foreign.marker}):'{"code":"safe_rejection"}'
        return response(fault.wrongForeignStatus??foreign.expectedStatus,text)
      }
      const schema=target.schemaCases.find(row=>row.path===path)
      assert(schema,'Only exact caller seeded schema paths may be requested')
      assert.equal(method,'GET');assert.equal(headers.Accept,'application/json')
      return response(fault.wrongSchemaStatus??schema.expectedStatus)
    }
  })
  const publicTransport=async(url,options)=>{
    assert.equal(url,base+apiPath);assert.equal(options.method,'POST');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'manual')
    assert(options.signal instanceof AbortSignal)
    assert(!Object.keys(options.headers).some(key=>['cookie','authorization','x-csrf-token'].includes(key.toLowerCase())),'Anonymous request must not carry session credentials')
    assert.equal(JSON.parse(options.body).name,target.markers.anonymous)
    assert.equal(session,'previous-session','Anonymous fetch does not manipulate actor session')
    requests.push({public:true,url,...options});sequence++
    return response(fault.anonymousStatus??401)
  }
  const effects={
    async waitForIdle(){transitions.push('idle');return {active:fault.notIdle?1:0}},
    async waitForStable(){transitions.push('stable');return {windowMs:5000,samples:[{hash,sources}]}},
    async observeDenied(action,verify,options){
      assert.equal(options.windowMs,5000);assert.equal(options.intervalMs,250)
      transitions.push('observe-denied')
      const result=await action()
      let error;try{await verify(result)}catch(failure){error=failure}
      const observation={windowMs:5000,before:hash,immediate:hash,sources:Object.keys(sources),beforeSources:{...sources},samples:[{elapsedMs:5000,hash,sources:{...sources}}]}
      if(fault.missingEffects)delete observation.samples[0].sources.queue
      if(fault.changedEffects)observation.samples[0].hash='f'.repeat(64)
      if(fault.shortWindow)observation.samples[0].elapsedMs=4000
      if(fault.generationChange)counter.generation='SYNTHETIC-process-2'
      if(error){error.sideEffects=observation;throw error}
      return {response:result,observation}
    }
  }
  const probe={async snapshot(){
    const value=structuredClone(counter)
    if(fault.notReady)value.readiness.storageListener=false
    if(fault.missingCounter)delete value.flowAuthorization
    return value
  }}
  const schemaAdminClient={async request(path,options){
    assert.equal(path,'/api/v1/main/flows');assert.equal(options.method,'POST')
    assert.equal(options.headers['Content-Type'],'application/x-yaml')
    assert(target.schemaCases.some(row=>row.phase==='declaration-validation'&&row.source===options.body),'Exact malformed declaration must be submitted')
    requests.push({path,method:'POST',body:options.body,transport:'SYNTHETIC-authenticated-author'});sequence++
    return response(fault.wrongSchemaStatus??400)
  }}
  return {options:{mode,base,account,clientFactory,publicTransport,effects,probe,target,schemaAdminClient,persist:async report=>recorded.push(report)},requests,recorded,transitions,get sequence(){return sequence}}
}

for(const mode of ['A','B'])test(`SYNTHETIC ${mode}: exact six case IDs and eleven strict method/path requests, real helper CSRF overrides`,async()=>{
  const f=fixture(mode);const report=await runAmisSecurityCases(f.options)
  assert.equal(report.completed,true);assert.deepEqual(report.counts,{passed:6,failed:0,notRun:0,skipped:0})
  assert.deepEqual(report.cases.map(row=>row.id),[
    'anonymous-api-denied-without-side-effects','cookie-write-missing-and-invalid-csrf','same-site-cross-origin-cookie-write-denied',
    'body-cannot-replace-route-identity','foreign-execution-and-output-access-denied','sibling-authority-traversal-and-invalid-schema-denied'
  ].map(id=>mode+'-'+id))
  assert.equal(f.sequence,11)
  assert.equal(f.transitions.filter(value=>value==='logout').length,5)
  assert.equal(f.transitions.filter(value=>value==='credentials-submitted').length,5)
  assert.equal(f.transitions.filter(value=>value==='verified-signed-identity').length,mode==='B'?5:0)
  assert(report.cases.every(row=>row.observations.every(observation=>observation.completed&&observation.sideEffects.samples.at(-1).elapsedMs>=5000)))
  assert(report.cases[4].observations.every(observation=>observation.outputMarkerAbsent===true))
  assert(!JSON.stringify(f.recorded).includes(password));assert(!JSON.stringify(report).includes('SYNTHETIC-COOKIE'))
  assert(!Object.keys(report.cases[5].observations[0]).includes('body'))
})

for(const [name,fault,phase,pattern]of[
  ['anonymous login redirect is not API401',{anonymousStatus:302},0,/Unexpected denial status/],
  ['authenticated wrong status',{wrongCookieStatus:200},1,/Unexpected denial status/],
  ['missing effects field',{missingEffects:true},0,/queue missing or changed/],
  ['delayed mutation',{changedEffects:true},0,/Delayed denied effects/],
  ['insufficient observation',{shortWindow:true},0,/too short/],
  ['listener not ready',{notReady:true},0,/listener not ready/],
  ['probe counter missing',{missingCounter:true},0,/Missing probe counter/],
  ['generation change',{generationChange:true},0,/generation changed/],
  ['active namespace',{notIdle:true},0,/not idle/],
  ['reused login',{reusedSession:true},1,/Fresh credential/],
  ['logout did not clear session',{logoutNotCleared:true},1,/Logout must clear/],
  ['logout failed',{logoutStatus:503},1,/logout failed/],
  ['signed scopes excessive',{wrongScopes:true},1,/Signed exact scopes mismatch/],
  ['foreign returns arbitrary error',{wrongForeignStatus:503},4,/Unexpected denial status/],
  ['foreign marker leaked',{leakOutput:true},4,/leaked foreign output/],
  ['schema wrong status',{wrongSchemaStatus:503},5,/Unexpected denial status/],
  ['client throws credentials',{clientException:true},1,/redacted/]
])test(`SYNTHETIC rejects ${name}; retains prior observations and failure samples`,async()=>{
  const f=fixture('B',fault)
  await assert.rejects(runAmisSecurityCases(f.options),error=>{
    assert.match(error.message,pattern)
    assert.equal(error.report.completed,false)
    assert.equal(error.report.cases[phase].status,'failed')
    assert.equal(error.report.counts.passed,phase)
    assert.equal(f.recorded.at(-1).counts.failed,1)
    assert(error.report.cases.slice(0,phase).every(row=>row.status==='passed'))
    assert(!JSON.stringify(error.report).includes(password))
    assert(!JSON.stringify(error.report).includes('Bearer SYNTHETIC-TOKEN-LEAK'))
    return true
  })
})

test('SYNTHETIC anonymous credential injection is rejected by strict public transport',async()=>{
  const f=fixture();const original=f.options.publicTransport
  f.options.publicTransport=(url,options)=>original(url,{...options,headers:{...options.headers,Cookie:'INJECTED'}})
  await assert.rejects(runAmisSecurityCases(f.options),error=>{
    assert.match(error.message,/must not carry session credentials/)
    assert.equal(error.report.cases[0].status,'failed')
    return true
  })
})

test('SYNTHETIC rejects incomplete, unseeded, off-origin or normalized targets before network requests',async()=>{
  for(const mutate of [
    f=>delete f.options.target.markers.anonymous,
    f=>{f.options.target.markers.invalidCsrf=f.options.target.markers.missingCsrf},
    f=>{f.options.target.schemaCases[0].seeded=false},
    f=>{f.options.target.schemaCases[0].path='//evil.invalid/schema'},
    f=>{f.options.target.schemaCases[0].path='/a/../schema'},
    f=>{f.options.target.schemaCases.pop()},
    f=>{f.options.target.foreignCases[0].expectedStatus=500},
    f=>{f.options.target.foreignCases[0].seeded=false},
    f=>{delete f.options.account.expectedScopeKeys},
    f=>{delete f.options.probe}
  ]){
    const f=fixture();mutate(f);await assert.rejects(runAmisSecurityCases(f.options));assert.equal(f.requests.length,0)
  }
})

test('SYNTHETIC malformed schema references use authenticated authoring validation and retain its phase',async()=>{
  const f=fixture(), authoring=[]
  for(const row of f.options.target.schemaCases.filter(row=>['authority','traversal'].includes(row.kind))) {
    Object.assign(row,{phase:'declaration-validation',path:'/api/v1/main/flows',source:'id: invalid-'+row.kind+'\nnamespace: company.amis.a\n'})
  }
  f.options.schemaAdminClient={async request(path,options){
    assert.equal(path,'/api/v1/main/flows');assert.equal(options.method,'POST')
    assert.equal(options.headers['Content-Type'],'application/x-yaml')
    assert(options.body.startsWith('id: invalid-'));authoring.push(options.body)
    return new Response('',{status:400})
  }}
  const report=await runAmisSecurityCases(f.options)
  assert.equal(report.completed,true);assert.equal(authoring.length,2)
  assert.equal(report.cases.at(-1).observations.filter(row=>row.phase==='declaration-validation').length,2)
})

test('SYNTHETIC declaration rejection cannot be replaced by an authorization error',async()=>{
  const f=fixture(),row=f.options.target.schemaCases.find(row=>row.kind==='authority')
  Object.assign(row,{phase:'declaration-validation',path:'/api/v1/main/flows',source:'id: invalid\n',expectedStatus:403})
  f.options.schemaAdminClient={request:async()=>new Response('',{status:403})}
  await assert.rejects(runAmisSecurityCases(f.options),/fail validation, not authorization/)
  assert.equal(f.requests.length,0)
})

// Separate authoring and runtime state. A missing route is always 404; it never
// borrows the caller's expectedStatus. No service or production parser is used.
function schemaPhaseFixture(mode='B',{authorStatus=400,authorMutation=false,runtimeFailure}={}) {
  const f=fixture(mode), events=[], submitted=[], stored=new Map()
  const authoritySource=amisFixtureFlow({namespace:'company.amis.a',flowId:'authority-rejected'}).replace('nsfile:///amis/home.json','nsfile://company.amis.b/amis/sibling.json')
  const traversalSource=authoritySource.replace('authority-rejected','traversal-rejected').replace('nsfile://company.amis.b/amis/sibling.json','nsfile:///amis/../private.json')
  const declarations=[
    {id:'authority-declaration',kind:'authority',source:authoritySource},
    {id:'traversal-declaration',kind:'traversal',source:traversalSource},
  ].map(row=>({...row,phase:'declaration-validation',seeded:true,path:'/api/v1/main/flows',expectedStatus:400}))
  // These two explicit stored resources are distinct from malformed declarations.
  const runtime=new Map([
    ['/company.amis.a/sibling-reference/schemas/home',{kind:'sibling',status:403,bytes:'SYNTHETIC sibling resource exists'}],
    ['/company.amis.a/invalid-schema/schemas/home',{kind:'invalid-schema',status:400,bytes:'{invalid-json'}],
  ])
  f.options.target.schemaCases=[...declarations,...[...runtime].map(([path,row])=>({id:row.kind==='sibling'?'runtime-sibling':'runtime-invalid-json',kind:row.kind,phase:'runtime',seeded:true,path,expectedStatus:row.status}))]
  const originalFactory=f.options.clientFactory
  f.options.clientFactory=()=>{
    const client=originalFactory(),request=client.request
    return {...client,async request(path,options={}){
      const row=runtime.get(path)
      if(row){
        assert.equal(options.method,'GET');assert.equal(options.headers.Accept,'application/json')
        events.push({phase:'runtime',path,kind:row.kind,storedBytes:row.bytes})
        return new Response('',{status:runtimeFailure===row.kind?404:row.status})
      }
      if(path.includes('/schemas/')){events.push({phase:'absent-runtime',path});return new Response('',{status:404})}
      return request(path,options)
    }}
  }
  // Caller supplies a separately authenticated schema administrator. This flag is
  // synthetic state, not evidence that a real production login was exercised.
  const authorSession={authenticated:true,csrf:'SYNTHETIC-ADMIN-CSRF'}
  f.options.schemaAdminClient={async request(path,options){
    assert.equal(authorSession.authenticated,true);assert.equal(authorSession.csrf,'SYNTHETIC-ADMIN-CSRF')
    assert.equal(path,'/api/v1/main/flows');assert.equal(options.method,'POST')
    assert.equal(options.headers['Content-Type'],'application/x-yaml')
    const declaration=declarations.find(row=>row.source===options.body)
    assert(declaration,'Exact malformed YAML declaration must reach the authoring boundary')
    assert.match(options.body,/schema: nsfile:/)
    submitted.push(options.body);events.push({phase:'declaration-validation',id:declaration.id,path,method:'POST'})
    if(authorMutation||authorStatus===200)stored.set(declaration.id,options.body)
    return new Response('',{status:authorStatus})
  }}
  const observe=f.options.effects.observeDenied
  f.options.effects.observeDenied=async(action,verify,options)=>{
    const before=JSON.stringify([...stored]);const result=await observe(action,verify,options)
    if(JSON.stringify([...stored])!==before)result.observation.samples[0].sources.database='e'.repeat(64)
    return result
  }
  return {...f,events,submitted,stored,runtime,declarations,authorSession}
}

for(const mode of ['A','B'])test(`SYNTHETIC ${mode}: malformed declarations POST400 and separate existing runtime sibling/invalid evidence`,async()=>{
  const f=schemaPhaseFixture(mode),report=await runAmisSecurityCases(f.options)
  assert.equal(report.completed,true);assert.equal(f.submitted.length,2);assert.equal(f.stored.size,0)
  assert.deepEqual(f.submitted,f.declarations.map(row=>row.source))
  assert.deepEqual(f.events.map(row=>row.phase),['declaration-validation','declaration-validation','runtime','runtime'])
  const checks=report.cases[5].observations
  assert.deepEqual(checks.map(row=>[row.label,row.method,row.status,row.phase]),[
    ['authority-declaration','POST',400,'declaration-validation'],['traversal-declaration','POST',400,'declaration-validation'],
    ['runtime-sibling','GET',403,'runtime'],['runtime-invalid-json','GET',400,'runtime'],
  ])
  for(const row of checks){assert.equal(row.completed,true);assert.equal(row.sideEffects.windowMs,5000);assert.equal(row.sideEffects.samples.at(-1).elapsedMs,5000);assert(row.before.generation===row.after.generation)}
  assert(checks[2].path!==checks[3].path);assert.equal(f.events.filter(row=>row.phase==='absent-runtime').length,0)
  const text=JSON.stringify(f.recorded);assert(!text.includes('SYNTHETIC-ADMIN-CSRF'));assert(!text.includes(f.declarations[0].source))
})

for(const status of [200,302,403,404,422,503])test(`SYNTHETIC authoring ${status} cannot stand in for actual declaration POST400`,async()=>{
  const f=schemaPhaseFixture('B',{authorStatus:status})
  await assert.rejects(runAmisSecurityCases(f.options),error=>{
    assert.equal(error.report.counts.passed,5);assert.equal(error.report.cases[5].status,'failed')
    const row=error.report.cases[5].observations.at(-1)
    assert.equal(row.method,'POST');assert.equal(row.path,'/api/v1/main/flows');assert.equal(row.status,status)
    assert.equal(row.completed,false);assert.equal(row.sideEffects.samples.at(-1).elapsedMs,5000)
    return true
  })
  assert.equal(f.submitted.length,1);assert.equal(f.events.filter(row=>row.phase==='runtime').length,0)
  assert.equal(f.recorded.at(-1).completed,false)
})
for(const kind of ['sibling','invalid-schema'])test(`SYNTHETIC missing ${kind} runtime path cannot replace an existing resource rejection`,async()=>{
  const f=schemaPhaseFixture('B',{runtimeFailure:kind})
  await assert.rejects(runAmisSecurityCases(f.options),error=>{
    const rows=error.report.cases[5].observations
    assert(rows.slice(0,2).every(row=>row.status===400&&row.method==='POST'&&row.phase==='declaration-validation'&&row.completed))
    assert.equal(rows.at(-1).status,404);assert.equal(rows.at(-1).completed,false)
    assert.equal(rows.at(-1).method,'GET');assert.equal(error.report.counts.passed,5)
    return true
  })
  assert.equal(f.submitted.length,2);assert.equal(f.stored.size,0)
})
test('SYNTHETIC declaration rejection with persisted mutation fails three-source side-effect evidence',async()=>{
  const f=schemaPhaseFixture('B',{authorMutation:true})
  await assert.rejects(runAmisSecurityCases(f.options),error=>{
    assert.match(error.message,/Denied database missing or changed/)
    assert.equal(error.report.cases[5].observations[0].status,400);assert.equal(error.report.counts.passed,5)
    return true
  })
  assert.equal(f.stored.size,1)
})
test('SYNTHETIC declaration phase requires supplied authenticated author client before any requests',async()=>{
  const f=schemaPhaseFixture();delete f.options.schemaAdminClient
  await assert.rejects(runAmisSecurityCases(f.options),/authenticated schema author/)
  assert.equal(f.requests.length,0);assert.equal(f.events.length,0)
})

test('SYNTHETIC regression: missing runtime404 must not count as malformed declaration validation',async()=>{
  const f=schemaPhaseFixture()
  for(const row of f.options.target.schemaCases.filter(row=>['authority','traversal'].includes(row.kind))) {
    delete row.phase;delete row.source
    row.path='/company.amis.a/nonexistent-declaration/schemas/'+row.kind
    row.expectedStatus=404
  }
  // The stateful server has no such declarations or routes, and returns genuine
  // synthetic 404. A validator must reject this input rather than count it green.
  await assert.rejects(runAmisSecurityCases(f.options),/declaration|authoring|validation/i)
  assert.equal(f.submitted.length,0)
})

function noOutputActorFixture({wrongScopes=false,reusedSession=false}={}) {
  const f=schemaPhaseFixture('B'),events=[]
  const actor={username:'amis-no-output',password:'SYNTHETIC-NO-OUTPUT-PRIVATE',groupId:'main',expectedScopeKeys:['amis-entry-a','amis-no-output']}
  const output=f.options.target.foreignCases.find(row=>row.kind==='output-access');output.account=actor
  const originalFactory=f.options.clientFactory
  f.options.clientFactory=()=>{
    const ordinary=originalFactory();let selected,credentialsSubmitted=false,verified=false
    return {
      async login(username,secret){
        events.push({action:'login',subject:username})
        if(username===actor.username){
          assert.equal(secret,actor.password);selected=username;credentialsSubmitted=!reusedSession
          return {authenticated:true,credentialsSubmitted}
        }
        selected=username;return ordinary.login(username,secret)
      },
      async verifiedUiIdentity(expected){
        if(selected!==actor.username)return ordinary.verifiedUiIdentity(expected)
        assert(credentialsSubmitted,'No-output actor requires fresh credential submission')
        assert.deepEqual(expected,{applicationGroupId:'main',subject:actor.username,audience:'kestra-ui'})
        events.push({action:'signed',subject:selected});verified=true
        return {authorizationVersion:19,applicationGroupScopes:wrongScopes?f.options.account.expectedScopeKeys:actor.expectedScopeKeys}
      },
      async request(path,options={}){
        if(path==='/oidc/logout'){
          events.push({action:'logout',subject:selected??'previous-session'})
          selected=undefined;credentialsSubmitted=false;verified=false
          return ordinary.request(path,options)
        }
        if(path===output.path){
          events.push({action:'output-request',subject:selected,method:options.method,path})
          assert.equal(options.method,'GET');assert.equal(options.headers.Accept,'application/json')
          if(selected!==actor.username)return new Response('Allowed output for ordinary actor',{status:200})
          assert(credentialsSubmitted&&verified,'No-output request requires freshly verified signed identity')
          return new Response('{"code":"output_denied"}',{status:403})
        }
        return ordinary.request(path,options)
      },
    }
  }
  return {...f,actor,output,actorEvents:events}
}
test('SYNTHETIC B output-access switches to distinct no-output actor with fresh signed exact scopes',async()=>{
  const f=noOutputActorFixture(),report=await runAmisSecurityCases(f.options)
  assert.equal(report.completed,true)
  const row=report.cases[4].observations.find(row=>row.label==='output-access')
  assert.deepEqual(row.identity,{subject:f.actor.username,scopeKeys:f.actor.expectedScopeKeys,authorizationVersion:19})
  assert.equal(row.status,403);assert.equal(row.outputMarkerAbsent,true);assert.equal(row.completed,true)
  assert.equal(row.sideEffects.samples.at(-1).elapsedMs,5000)
  const index=f.actorEvents.findIndex(event=>event.action==='login'&&event.subject===f.actor.username)
  assert.equal(f.actorEvents[index-1].action,'logout')
  assert.deepEqual(f.actorEvents.slice(index,index+3).map(event=>event.action),['login','signed','output-request'])
  const evidence=JSON.stringify(f.recorded)
  assert(!evidence.includes(f.actor.password));assert(!evidence.includes(password))
  assert.equal(f.actorEvents.filter(event=>event.action==='output-request').length,1)
})
for(const fault of ['wrongScopes','reusedSession'])test(`SYNTHETIC no-output ${fault} fails before output request and retains foreign denial`,async()=>{
  const f=noOutputActorFixture({[fault]:true})
  await assert.rejects(runAmisSecurityCases(f.options),error=>{
    assert.match(error.message,fault==='wrongScopes'?/Signed exact scopes mismatch/:/Fresh credential submission/)
    assert.equal(error.report.counts.passed,4);assert.equal(error.report.cases[4].status,'failed')
    assert.equal(error.report.cases[4].observations[0].label,'foreign-execution')
    assert.equal(error.report.cases[4].observations[0].completed,true)
    assert(!JSON.stringify(error.report).includes(f.actor.password));return true
  })
  assert.equal(f.actorEvents.filter(event=>event.action==='output-request').length,0)
})
test('SYNTHETIC output-access cannot reuse ordinary allow account identity',async()=>{
  const f=noOutputActorFixture();f.output.account={...f.options.account}
  await assert.rejects(runAmisSecurityCases(f.options),/distinct least-privilege actor/)
  assert.equal(f.requests.length,0);assert.equal(f.actorEvents.length,0)
})
test('SYNTHETIC omitting no-output actor exposes ordinary allow200 rather than fake denied403',async()=>{
  const f=noOutputActorFixture();delete f.output.account
  await assert.rejects(runAmisSecurityCases(f.options),error=>{
    assert.match(error.message,/Unexpected denial status/)
    const observation=error.report.cases[4].observations.at(-1)
    assert.equal(observation.label,'output-access');assert.equal(observation.status,200);assert.equal(observation.completed,false)
    return true
  })
  assert.equal(f.actorEvents.find(event=>event.action==='output-request').subject,f.options.account.username)
})

test('SYNTHETIC original schema fixture still rejects authoring wrong status after sibling runtime passes',async()=>{
  const f=fixture(),author=f.options.schemaAdminClient
  let requests=0
  f.options.schemaAdminClient={async request(path,options){await author.request(path,options);requests++;return new Response('',{status:503})}}
  await assert.rejects(runAmisSecurityCases(f.options),error=>{
    assert.equal(error.report.counts.passed,5)
    const checks=error.report.cases[5].observations
    assert.equal(checks[0].label,'sibling-schema');assert.equal(checks[0].completed,true)
    assert.equal(checks[1].label,'authority-schema');assert.equal(checks[1].method,'POST');assert.equal(checks[1].status,503)
    assert.equal(checks[1].completed,false);return true
  })
  assert.equal(requests,1)
})
