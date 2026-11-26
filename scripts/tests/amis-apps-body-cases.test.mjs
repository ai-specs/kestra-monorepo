// Synthetic streaming closure and isolated observations only; no HTTP listener or service.
import test from 'node:test'
import assert from 'node:assert/strict'
import {runAmisBodyCases} from '../amis-apps-body-cases.mjs'
const base='http://127.0.0.1:18999',hash='a'.repeat(64)
function fixture(t,fault,mode='B') {
  let clock=0,sequence=0
  t.mock.method(performance,'now',()=>clock)
  const executions=['baseline'],reports=[],calls=[]
  const sources={database:hash,queue:hash,storage:hash}
  const observation=()=>({windowMs:5000,before:hash,immediate:hash,sources:Object.keys(sources),beforeSources:{...sources},samples:[{elapsedMs:5000,hash,sources:{...sources}}]})
  const options={mode,base,identityEvidence:{subject:'actor',issuer:base,exactAudiences:['kestra-ui'],...(mode==='A'?{productionLogin:true}:{group:'main',scopeKeys:['entry','execute'],authVersion:7})},ownershipEvidence:{verified:true,base,mode,owner:'synthetic-owned',containerId:'a'.repeat(64)},target:{namespace:'company.amis',flowId:'flow',apiId:'run',marker:'synthetic',bodyTimeoutMs:30000},executionInventory:async()=>[...executions],persist:async report=>reports.push(report),effects:{waitForIdle:async()=>({active:0}),observeDenied:async(send,verify)=>{
    const response=await send();await verify(response)
    const result=observation();if(fault==='effect-change')result.samples[0].sources.database='b'.repeat(64)
    if(fault==='short-observation')result.samples[0].elapsedMs=4999
    return {response,observation:result}
  }},client:{requestStreaming:async(path,{chunks,signal,timeoutMs})=>{
    assert.equal(path,'/company.amis/flow/apis/run');assert.equal(timeoutMs,45000);assert(signal instanceof AbortSignal)
    const iterator=chunks[Symbol.asyncIterator](),first=await iterator.next();calls.push(first.value.toString())
    const cancel=first.value.includes('body-cancel-before-submission'),slow=first.value.includes('body-read-timeout')
    if(cancel){
      if(fault==='cancel-response')return new Response(null,{status:400})
      try {await iterator.next();assert.fail('Cancelled generator unexpectedly ended')}catch(error){if(fault==='cancel-unrelated')throw new Error('private transport secret');throw error}
    }
    if(slow){clock+=fault==='early-timeout'?100:30000;await iterator.return();return new Response(null,{status:fault==='slow-wrong-status'?400:408})}
    let bytes=first.value.length
    for(;;){const next=await iterator.next();if(next.done)break;bytes+=next.value.length}
    assert(bytes>1_048_576)
    if(fault==='execution-side-effect')executions.push('unwanted')
    return new Response(null,{status:fault==='oversize-413'?413:400})
  },requestAccess:async(path,request)=>{
    assert.equal(path,'/company.amis/flow/apis/run');assert.equal(request.method,'POST')
    const marker=JSON.parse(request.body).name,id='execution_'+(++sequence)
    executions.push(id);if(fault==='positive-duplicate')executions.push('duplicate_'+sequence)
    return Response.json({version:1,status:0,data:{message:marker},executionId:id,executionUrl:path+'/executions/'+id,executionState:'SUCCESS',resultReady:true})
  }}}
  return {options,reports,executions,calls}
}
test('synthetic three streaming boundaries preserve inventory and same-actor positive recovers each time',async t=>{
  const f=fixture(t),report=await runAmisBodyCases(f.options)
  assert(report.completed);assert.equal(report.checks.length,3);assert(report.checks.every(row=>row.status==='passed'))
  assert.deepEqual(report.checks.map(row=>row.expectedStatus),[400,408,null]);assert.equal(f.executions.length,4)
  assert(report.checks[2].stream.cancelRequested);assert.equal(report.checks[2].stream.chunksSent,1)
  assert(!JSON.stringify(report).includes('private transport secret'))
})
for(const fault of ['oversize-413','slow-wrong-status','early-timeout','cancel-response','cancel-unrelated','execution-side-effect','effect-change','short-observation','positive-duplicate'])
  test('synthetic rejects '+fault+' and retains partial report',async t=>{
    const f=fixture(t,fault)
    await assert.rejects(runAmisBodyCases(f.options),error=>{
      assert.equal(error.report.completed,false);assert(error.report.checks.some(row=>row.status==='failed'))
      assert(!JSON.stringify(error.report).includes('private transport secret'));return true
    })
    assert.equal(f.reports.at(-1).completed,false)
  })
test('reject foreign base, absent streaming mechanism, wrong timeout before any upload',async t=>{
  for(const change of [f=>{f.options.base='http://foreign.invalid'},f=>{delete f.options.client.requestStreaming},f=>{f.options.deadlineMs=30000},f=>{f.options.target.bodyTimeoutMs=1000},f=>{f.options.ownershipEvidence.verified=false}]){
    const f=fixture(t);change(f);await assert.rejects(runAmisBodyCases(f.options));assert.equal(f.calls.length,0)
  }
})
test('Mode A production login without application group executes the identical three body boundaries',async t=>{
  const f=fixture(t,undefined,'A'),report=await runAmisBodyCases(f.options)
  assert.equal(report.mode,'A');assert.equal(report.completed,true)
  assert.deepEqual(report.checks.map(row=>row.expectedStatus),[400,408,null])
  assert(report.checks.every(row=>row.status==='passed'))
  assert.equal(report.identity.productionLogin,true);assert(!Object.hasOwn(report.identity,'group'))
  assert.equal(f.executions.length,4)
})
for(const [mode,name,change]of [
  ['A','missing production login',identity=>{delete identity.productionLogin}],
  ['A','invented group',identity=>{identity.group='main'}],
  ['B','missing signed group',identity=>{delete identity.group}],
  ['B','missing signed scopes',identity=>{delete identity.scopeKeys}],
  ['B','duplicate signed scopes',identity=>{identity.scopeKeys=['entry','entry']}],
  ['B','missing authorization version',identity=>{delete identity.authVersion}],
  ['A','wrong audience',identity=>{identity.exactAudiences=['other']}],
  ['B','wrong issuer',identity=>{identity.issuer='http://foreign.invalid'}],
])test(`reject ${mode} ${name} before streaming`,async t=>{
  const f=fixture(t,undefined,mode);change(f.options.identityEvidence)
  await assert.rejects(runAmisBodyCases(f.options));assert.equal(f.calls.length,0)
})
