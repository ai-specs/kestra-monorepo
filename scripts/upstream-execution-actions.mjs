import assert from 'node:assert/strict'
// Actual production session and controller/engine calls. No transport substitute.
export async function runUpstreamExecutionActions(client,{mode='A',record=async()=>{},observeDenied}={}) {
  const namespace='company.upgradeactions', suffix=Date.now().toString(36)
  const report={mode,completed:false,checks:[]}
  const send=async(path,method='GET',body,contentType)=>{
    const response=await client.request(path,{method,...(body===undefined?{}:{body}),headers:contentType?{'Content-Type':contentType}:{},signal:AbortSignal.timeout(90000)})
    const text=await response.text();let value;try{value=JSON.parse(text)}catch{}
    assert(response.ok,`Execution action HTTP ${response.status} at ${path.split('?')[0]}`)
    return value
  }
  const check=async(name,action)=>{const row={name,status:'running'};report.checks.push(row);await record(report);try{row.evidence=await action();row.status='passed';await record(report);return row.evidence}catch(error){row.status='failed';row.error=String(error.message);await record(report);throw error}}
  const wait=async(id,state,minHistories=0)=>{
    const deadline=Date.now()+90000
    while(Date.now()<deadline){const value=await send('/api/v1/main/executions/'+id);if(value?.state?.current===state&&(value.state.histories?.length??0)>=minHistories)return value;await new Promise(done=>setTimeout(done,250))}
    assert.fail(`Execution did not reach ${state}`)
  }
  const createFlow=async(id,tasks)=>send('/api/v1/main/flows','POST',`id: ${id}\nnamespace: ${namespace}\ntasks:\n${tasks}\n`,'application/x-yaml')
  const createExecution=async id=>send(`/api/v1/main/executions/${namespace}/${id}`,'POST',new FormData())
  const failedId='upgrade-failed-'+suffix
  await createFlow(failedId,'  - id: failed\n    type: io.kestra.plugin.core.execution.Fail')
  let failed
  await check('create',async()=>{const value=await createExecution(failedId);failed=await wait(value.id,'FAILED');return {id:failed.id,state:failed.state.current}})
  if(mode==='B') {
    assert.equal(typeof observeDenied,'function','Mode B requires database/queue/storage refusal observation')
    report.denialObservation=await observeDenied(async()=>{
      for(const name of ['restart','replay','pause','resume','kill']) await check(name,async()=>{
        const before=await send('/api/v1/main/executions/'+failed.id)
        const response=await client.request(`/api/v1/main/executions/${failed.id}/actions/${name}`,{method:name==='kill'?'DELETE':'POST',...(name==='resume'?{body:new FormData()}:{}),signal:AbortSignal.timeout(90000)})
        await response.body?.cancel();assert.equal(response.status,403,'Unregistered REST control must fail closed in mode B')
        const after=await send('/api/v1/main/executions/'+failed.id);assert.deepEqual(after,before,'Refused control mutated execution')
        return {id:failed.id,state:after.state.current,responseStatus:response.status,behavior:'fail-closed-unregistered-rest-route'}
      })
    })
    report.completed=true;await record(report);return report
  }
  assert.equal(mode,'A')
  await check('restart',async()=>{const before=failed.state.histories.length;const value=await send(`/api/v1/main/executions/${failed.id}/actions/restart`,'POST');assert.equal(value.id,failed.id);failed=await wait(value.id,'FAILED',before+1);return {id:value.id,state:failed.state.current,historyIncreased:true}})
  await check('replay',async()=>{const value=await send(`/api/v1/main/executions/${failed.id}/actions/replay`,'POST');assert.notEqual(value.id,failed.id);const current=await wait(value.id,'FAILED');return {id:value.id,state:current.state.current,newExecution:true}})
  const controlledId='upgrade-controlled-'+suffix
  await createFlow(controlledId,'  - id: wait\n    type: io.kestra.plugin.core.flow.Sleep\n    duration: PT20S\n  - id: done\n    type: io.kestra.plugin.core.log.Log\n    message: upgrade-actions-completed')
  const controlled=await createExecution(controlledId);await wait(controlled.id,'RUNNING')
  await check('pause',async()=>{await send(`/api/v1/main/executions/${controlled.id}/actions/pause`,'POST');const current=await wait(controlled.id,'PAUSED');return {id:current.id,state:current.state.current}})
  await check('resume',async()=>{await send(`/api/v1/main/executions/${controlled.id}/actions/resume`,'POST',new FormData());const current=await wait(controlled.id,'SUCCESS');return {id:current.id,state:current.state.current}})
  await check('kill',async()=>{const value=await createExecution(controlledId);await wait(value.id,'RUNNING');await send(`/api/v1/main/executions/${value.id}/actions/kill`,'DELETE');const current=await wait(value.id,'KILLED');return {id:value.id,state:current.state.current}})
  report.completed=true;await record(report);return report
}
