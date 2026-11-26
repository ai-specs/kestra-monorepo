import assert from 'node:assert/strict'
import test from 'node:test'
import {setTimeout as wait} from 'node:timers/promises'
import {runAmisRevocationCases} from '../amis-apps-revocation-cases.mjs'

// Stateful synthetic transport. Does not claim production identity, storage or policy.
const base='http://127.0.0.1:18129'
const target={namespace:'company.amis.a',flowId:'greeting',apiId:'greet',marker:'revocation-test'}
const api='/company.amis.a/greeting/apis/greet'
const actors=['revoke-entry','revoke-flow','revoke-grant'].map(key=>({key,username:'actor-'+key,scopeKeys:['entry','flow']}))
function fixture(options={}) {
  const states=new Map(actors.map(a=>[a.key,{granted:true,generation:0,restored:false,executions:0,refreshes:0}]))
  const sessions=new Map(),events=[],persisted=[],operations=new Map()
  const effects={
    async waitForIdle(){events.push('idle')},async waitForStable(){events.push('stable')},
    async observeDenied(action,verify){
      const before=[...states.values()].reduce((sum,s)=>sum+s.executions,0)
      const started=performance.now(),response=await action()
      let failure
      try{await verify(response)}catch(error){failure=error}
      // Actual delayed callback; 5ms is a unit transport window, NOT the production 5s gate.
      while(performance.now()-started<5) await wait(1)
      const after=[...states.values()].reduce((sum,s)=>sum+s.executions,0)
      const observation={synthetic:true,windowMs:performance.now()-started,before,after}
      events.push('observe-denied')
      if(after!==before||failure){const error=failure??new Error('synthetic delayed mutation');error.observation=observation;throw error}
      return {response,observation}
    }
  }
  async function revoke({operationId,permissionKey,subject}){
    const key=subject?actors.find(a=>a.username===subject).key:permissionKey.endsWith('entry')?'revoke-entry':'revoke-flow'
    const state=states.get(key)
    assert.equal(state.executions,1,'Must issue and use credentials before policy edit')
    assert.equal(state.granted,true);assert(!operations.has(operationId))
    operations.set(operationId,key)
    if(!options.noRevocation)state.granted=false
    state.generation++;events.push(key+':revoke')
    return {operationId,enabled:false}
  }
  const controls={revokePermission:revoke,revokeSubjectGrants:revoke,
    async restore({operationId}){
      const key=operations.get(operationId);assert(key)
      const state=states.get(key)
      events.push(key+':restore')
      if(options.restoreThrows)throw new Error('synthetic restore failure')
      if(options.restoreFalse)return {operationId,restored:false}
      if(options.restoreWrongOperation)return {operationId:'different-operation',restored:true}
      state.granted=true;state.restored=true
      return {operationId,restored:true}
    },publicEvidence(){return {synthetic:true,events:[...events]}}}
  const login=async actor=>{assert(actors.includes(actor));const session={key:actor.key};sessions.set(actor.key,session);events.push(actor.key+':login');return session}
  const oauthFactory=async({client,expectedSubject,expectedScopeKeys})=>{
    const actor=actors.find(a=>a.key===client.key),state=states.get(client.key)
    assert.equal(sessions.get(actor.key),client);assert.equal(expectedSubject,actor.username)
    assert.deepEqual(expectedScopeKeys,actor.scopeKeys)
    const issuedGeneration=state.generation
    let refreshed=false
    const evidence=()=>({synthetic:true,subject:actor.username,scopeKeys:actor.scopeKeys,generation:issuedGeneration})
    return {evidence,async requestAccess(path,request={}){
      assert(path===api||path===api+'/executions/execution_'+actor.key)
      const method=request.method??'GET'
      if(state.generation>issuedGeneration){assert.equal(state.restored,false);events.push(actor.key+':'+(refreshed?'refreshed':'issued')+'-request')}
      const allowed=state.granted||(refreshed&&options.refreshAuthorizes)
      if(!allowed){
        if(options.delayedMutation&&method==='POST')setTimeout(()=>{state.executions++},1)
        return new Response('',{status:options.wrongDenialStatus??403})
      }
      if(method==='POST'){
        const input=JSON.parse(request.body);state.executions++
        return Response.json({version:1,status:0,resultReady:true,executionState:'SUCCESS',executionId:'execution_'+actor.key,
          executionUrl:api+'/executions/execution_'+actor.key,data:{message:input.name}},{status:200})
      }
      return new Response('{}',{status:options.unrevokedStatus??200})
    },async refresh(){
      assert(state.generation>issuedGeneration);assert.equal(state.granted,false)
      state.refreshes++;refreshed=true;events.push(actor.key+':refresh')
      if(options.refreshFailure)return {success:false,status:options.refreshFailure}
      const scopeKeys=actor.key==='revoke-grant'&&!options.retainRevokedGrant?[]:actor.scopeKeys
      return {success:true,status:200,rotated:true,after:{scopeKeys},before:evidence()}
    }}
  }
  const run=()=>runAmisRevocationCases({base,admin:{username:'synthetic-admin'},actors,clientSecret:'synthetic-only',target,effects,
    login,controls,oauthFactory,deadlineMs:1000,intervalMs:25,persist:async report=>persisted.push(structuredClone(report))})
  return {run,states,events,persisted}
}

test('issued positive control, revoke, old access denial, delayed effect check, refresh denial and restoration are ordered',async()=>{
  const f=fixture(),report=await f.run()
  assert.equal(report.completed,true);assert.equal(report.cases.length,3)
  assert(report.cases.every(row=>row.status==='passed'&&row.restoration.restored))
  for(const actor of actors){
    const state=f.states.get(actor.key)
    assert.equal(state.executions,1);assert.equal(state.refreshes,1);assert(state.granted&&state.restored)
    assert(f.events.indexOf(actor.key+':revoke')>f.events.indexOf(actor.key+':login'))
    assert(f.events.indexOf(actor.key+':refresh')>f.events.indexOf(actor.key+':issued-request'))
    assert(f.events.indexOf(actor.key+':restore')>f.events.indexOf(actor.key+':refreshed-request'))
  }
  assert(report.cases.every(row=>row.checks[1].sideEffects.windowMs>=5))
  assert.equal(f.persisted.at(-1).completed,true)
})

test('wrong denial status fails and persists current failure while restoring policy',async()=>{
  const f=fixture({wrongDenialStatus:500})
  await assert.rejects(f.run(),error=>{
    assert.equal(error.report.completed,false);assert.equal(error.report.cases[0].status,'failed');return true
  })
  assert(f.states.get('revoke-entry').restored)
  assert.equal(f.persisted.at(-1).cases[0].status,'failed')
})

test('unchanged policy cannot pass the existing issued-credential revocation deadline',async()=>{
  const f=fixture({noRevocation:true})
  await assert.rejects(f.run(),error=>{
    assert.match(error.report.cases[0].failure.message,/remained authorized/);return true
  })
  assert(f.states.get('revoke-entry').restored)
})

test('refresh retaining removed subject grants fails with previous passed cases preserved',async()=>{
  const f=fixture({retainRevokedGrant:true})
  await assert.rejects(f.run(),error=>{
    assert.deepEqual(error.report.cases.map(row=>row.status),['passed','passed','failed'])
    assert.match(error.report.cases[2].failure.message,/retain revoked user grants/);return true
  })
  assert(f.states.get('revoke-grant').restored)
  assert.equal(f.persisted.at(-1).completed,false)
})

test('refreshed credentials regaining access and delayed writes are detected by observer callbacks',async()=>{
  for(const options of [{refreshAuthorizes:true},{delayedMutation:true}]){
    const f=fixture(options)
    await assert.rejects(f.run(),error=>{
      assert.equal(error.report.cases[0].status,'failed')
      assert(error.report.cases[0].failure.observation);return true
    })
    assert(f.states.get('revoke-entry').restored)
  }
})

test('unrelated refresh failure and thrown restoration failures remain failed in persisted report',async()=>{
  for(const options of [{refreshFailure:503},{restoreThrows:true},{restoreWrongOperation:true}]){
    const f=fixture(options)
    await assert.rejects(f.run(),error=>{
      assert.equal(error.report.cases[0].status,'failed');return true
    })
    assert.equal(f.persisted.at(-1).cases[0].status,'failed')
  }
})

test('a restoration receipt explicitly reporting false must fail rather than mark all cases passed',async()=>{
  const f=fixture({restoreFalse:true})
  await assert.rejects(f.run())
  assert.equal(f.persisted.at(-1).cases[0].status,'failed')
})
