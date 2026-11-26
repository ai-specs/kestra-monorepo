// Synthetic asynchronous execution/permit model, not production service proof.
import test from 'node:test'
import assert from 'node:assert/strict'
import {runAmisSyncCases} from '../amis-apps-sync-cases.mjs'

function fixture(fault) {
  const counts=new Map(),executions=new Map(),inventory=new Map([['existing_isolated_execution',{id:'existing_isolated_execution',namespace:'company.amis',flowId:'baseline',state:'SUCCESS'}]]),reports=[],requests=[]
  let permit=false,sequence=0,cancelEvents=0
  const target={namespace:'company.amis',normalFlowId:'normal',timeoutFlowId:'slow',capacityFlowId:'capacity',apiId:'run',marker:'synthetic',maxSyncConcurrency:1}
  const make=(path,marker,ready=true)=>{
    const execution=executions.get(marker)
    if(ready && execution.state!=='KILLED') execution.state=fault==='failure-state'&&marker.endsWith('-normal')?'FAILED':'SUCCESS'
    return new Response(JSON.stringify({version:1,status:fault==='failure-state'&&marker.endsWith('-normal')?1:0,
      executionId:fault==='poll-wrong-id'&&ready&&marker.endsWith('-timeout')?'unrelated_execution':execution.id,executionUrl:path+'/executions/'+(fault==='poll-wrong-id'&&ready&&marker.endsWith('-timeout')?'unrelated_execution':execution.id),
      executionState:ready?(fault==='failure-state'&&marker.endsWith('-normal')?'FAILED':'SUCCESS'):'RUNNING',
      resultReady:ready,data:ready?{message:fault==='wrong-result'?'wrong':marker}:{}}),{status:ready?200:202})
  }
  const submit=(marker,path)=>{const value={id:'execution_'+(++sequence),marker,complete:false,namespace:target.namespace,flowId:fault==='wrong-flow-binding'?'other-flow':path.split('/')[2],state:'RUNNING'};executions.set(marker,value);inventory.set(value.id,value);counts.set(marker,(counts.get(marker)??0)+(fault==='count-two'?2:1));return value}
  const client={request:async(path,options={})=>{
    requests.push({path,method:options.method??'GET'})
    if((options.method??'GET')==='GET'){
      const execution=[...executions.values()].find(value=>path.endsWith('/executions/'+value.id))
      assert(execution,'Polling unknown execution')
      execution.complete=true
      return make(path.slice(0,path.indexOf('/executions/')),execution.marker)
    }
    assert.equal(options.method,'POST');assert.equal(options.headers['Content-Type'],'application/json')
    const marker=JSON.parse(options.body).name
    assert(path===`/${target.namespace}/${target.normalFlowId}/apis/run`||path===`/${target.namespace}/${target.timeoutFlowId}/apis/run`||path===`/${target.namespace}/${target.capacityFlowId}/apis/run`)
    if(path.includes('/normal/')){submit(marker,path);return make(path,marker)}
    if(path.includes('/slow/')){submit(marker,path);await new Promise(resolve=>setTimeout(resolve,2));return make(path,marker,false)}
    if(permit){if(fault==='capacity-submits')submit(marker,path);if(fault==='unmarked-side-effect')submit('unrelated-marker',path);return new Response('capacity',{status:429})}
    submit(marker,path);permit=true
    if(marker.endsWith('-cancelled-http'))return new Promise((resolve,reject)=>{
      assert(options.signal,'HTTP cancellation signal required')
      const aborted=()=>{cancelEvents++;if(fault!=='cancel-no-release')permit=false;if(fault==='cancel-kills-execution')executions.get(marker).state='KILLED';reject(fault==='cancel-unrelated-error'?new Error('Synthetic infrastructure failure'):new DOMException('Synthetic cancelled HTTP wait','AbortError'))}
      options.signal.addEventListener('abort',aborted,{once:true});if(options.signal.aborted)aborted()
    })
    await new Promise(resolve=>setTimeout(resolve,4));permit=false
    return make(path,marker)
  }}
  return {options:{mode:'B',client,target,effects:{waitForIdle:async()=>{for(const value of executions.values()){value.complete=true;if(value.state==='RUNNING')value.state='SUCCESS'};if(fault==='late-duplicate'&&counts.has('synthetic-cancelled-http'))counts.set('synthetic-cancelled-http',2);if(fault==='late-normal-duplicate'&&counts.has('synthetic-after-cancel'))counts.set('synthetic-normal',2)}},executionCount:async marker=>counts.get(marker)??0,executionDetails:async marker=>{const row=executions.get(marker);return row?[{id:row.id,namespace:row.namespace,flowId:row.flowId,state:row.state}]:[]},executionInventory:async()=>[...inventory.keys()],persist:async report=>reports.push(report)},counts,executions,reports,requests,get cancelEvents(){return cancelEvents}}
}
test('synthetic SYNC timeout/poll capacity and HTTP cancel preserve one execution each',async()=>{
  const f=fixture(),report=await runAmisSyncCases(f.options)
  assert.equal(report.completed,true);assert.equal(report.checks.length,4)
  assert.deepEqual([...f.counts.values()],[1,1,1,1,1]);assert.equal(f.counts.get('synthetic-capacity-denied')??0,0)
  assert.equal(f.cancelEvents,1);assert.equal(f.requests.filter(row=>row.method==='GET').length,1)
  assert.equal(f.reports.at(-1).completed,true)
  const inventory=await f.options.executionInventory()
  assert.equal(inventory.length,6)
  assert.equal(new Set(inventory).size,6)
  assert(inventory.includes('existing_isolated_execution'))
  for(const [suffix,flowId]of [['normal','normal'],['timeout','slow'],['holding','capacity'],['cancelled-http','capacity'],['after-cancel','capacity']]) {
    const rows=await f.options.executionDetails('synthetic-'+suffix)
    assert.equal(rows.length,1)
    assert.deepEqual(rows[0],{id:rows[0].id,namespace:'company.amis',flowId,state:'SUCCESS'})
    assert(inventory.includes(rows[0].id))
  }
})
for(const [name,fault]of [['wrong response','wrong-result'],['duplicate execution count','count-two'],['capacity reject submitted execution','capacity-submits'],['late duplicate after HTTP cancellation','late-duplicate']])
  test('reject '+name+' and retain partial failure',async()=>{
    const f=fixture(fault);await assert.rejects(runAmisSyncCases(f.options),error=>Boolean(error.report)&&error.report.completed===false)
    assert(f.reports.at(-1).failure);assert.equal(f.reports.at(-1).completed,false)
  })
test('HTTP cancellation that fails to release permit is rejected within the helper deadline',async t=>{
  const f=fixture('cancel-no-release');let now=0
  t.mock.method(Date,'now',()=>{now+=6000;return now})
  await assert.rejects(runAmisSyncCases(f.options),/Cancellation did not release the permit/)
  assert.equal(f.cancelEvents,1);assert.equal(f.counts.get('synthetic-cancelled-http'),1);assert.equal(f.counts.get('synthetic-after-cancel')??0,0)
})
test('FAILED execution must not pass even when response data echoes the expected marker',async()=>{
  const f=fixture('failure-state')
  await assert.rejects(runAmisSyncCases(f.options),error=>Boolean(error.report?.failure))
})
test('poll response must retain the initially issued execution identifier',async()=>{
  const f=fixture('poll-wrong-id')
  await assert.rejects(runAmisSyncCases(f.options),error=>Boolean(error.report?.failure))
})
test('counted execution in another Flow must not satisfy a target Flow request',async()=>{
  const f=fixture('wrong-flow-binding')
  await assert.rejects(runAmisSyncCases(f.options),error=>Boolean(error.report?.failure))
})
test('unrelated infrastructure error must not prove HTTP cancellation propagation',async()=>{
  const f=fixture('cancel-unrelated-error')
  await assert.rejects(runAmisSyncCases(f.options),error=>Boolean(error.report?.failure))
})
test('HTTP cancellation must not pass when the underlying execution was killed',async()=>{
  const f=fixture('cancel-kills-execution')
  await assert.rejects(runAmisSyncCases(f.options),error=>Boolean(error.report?.failure))
})
test('final observation must detect delayed duplicate normal execution',async()=>{
  const f=fixture('late-normal-duplicate')
  await assert.rejects(runAmisSyncCases(f.options),error=>Boolean(error.report?.failure))
})
test('capacity denial must not pass when an execution is submitted without the rejected marker',async()=>{
  const f=fixture('unmarked-side-effect')
  await assert.rejects(runAmisSyncCases(f.options),error=>Boolean(error.report?.failure))
})
