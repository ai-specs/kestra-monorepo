import assert from 'node:assert/strict'

const passed=(rows,id)=>{
  const matches=rows.filter(row=>row.id===id)
  assert.equal(matches.length,1,'P6 evidence missing or duplicated: '+id)
  assert.equal(matches[0].status,'passed',id)
  assert.equal(matches[0].passed,true,id)
  return matches[0].evidence
}
const time=value=>{const result=Date.parse(value);assert(Number.isFinite(result),'P6 timestamp missing');return result}
function stable(observation) {
  assert(observation&&observation.windowMs>=5000,'P6 delayed side-effect observation missing')
  assert.equal(observation.before,observation.immediate)
  assert(observation.samples.length>0)
  assert(observation.samples.at(-1).elapsedMs>=observation.windowMs)
  for(const sample of observation.samples)assert.equal(sample.hash,observation.before)
  assert.deepEqual([...observation.sources].sort(),['database','queue','storage'])
}
function waited(evidence) {
  const start=time(evidence.submittedAt),pause=time(evidence.pausedAt),end=time(evidence.terminalAt),response=time(evidence.responseAt)
  assert(start<=pause&&pause<=end&&pause<response,'P6 execution/response ordering invalid')
  assert.equal(evidence.newExecutionCount,1,'P6 duplicate or missing submission')
  assert(typeof evidence.executionId==='string'&&evidence.executionId.length)
  const states=evidence.states.map(row=>row.state)
  assert(states.includes('PAUSED')&&states.at(-1)==='SUCCESS','P6 real waiting/terminal state missing')
  assert.equal(evidence.totalDurationMs,response-start)
  return {pause,response}
}

/** Audit downloaded production evidence; does not execute or manufacture checks. */
export function assertP6Evidence(report) {
  const ai=passed(report.fragments.security.checks,'ai-no-provider-fails-closed')
  const steps=ai.steps.filter(row=>row.name==='ai-unavailable-no-side-effects')
  assert.equal(steps.length,1)
  const evidence=steps[0]
  assert.equal(evidence.providerConfigured,false,'P6 runtime provider evidence missing')
  assert.deepEqual(evidence.after,evidence.before,'P6 AI/execution storage changed')
  assert.deepEqual(Object.keys(evidence.before).sort(),['ai_agent_message','ai_agent_thread','execution_queued','executions'])
  for(const [table,value] of Object.entries(evidence.before)) {
    assert.equal(typeof value.present,'boolean',table)
    if(value.present){assert(Number.isSafeInteger(value.count)&&value.count>=0);assert(/^[a-f0-9]{32}$/.test(value.hash))}
    else assert(!['executions','execution_queued'].includes(table),'P6 production execution table missing')
  }
  assert.equal(evidence.statuses.length,12,'P6 AI operations incomplete')
  for(const role of ['manager','reader']) {
    const rows=evidence.statuses.filter(row=>row.role===role)
    assert.equal(rows.length,6,'P6 AI role coverage missing')
    assert.deepEqual(rows.map(row=>[row.method,row.path]),[
      ['POST','/api/v1/main/ai/threads'],['GET','/api/v1/main/ai/threads/p6-unavailable'],
      ['POST','/api/v1/main/ai/threads/p6-unavailable/chat'],
      ...Array.from({length:3},()=>['POST','/api/v1/main/ai/threads/p6-unavailable/confirm']),
    ])
    assert.deepEqual(rows.map(row=>row.decision),[null,null,null,'APPROVE','REJECT','APPROVE'])
    for(const row of rows){assert([403,503].includes(row.status));assert.equal(row.boundary,row.status===403?'http-forbidden':'provider-unavailable')}
  }
  assert.equal(evidence.providerBranchExercised,evidence.statuses.some(row=>row.boundary==='provider-unavailable'))
  assert.equal(evidence.coverage,evidence.providerBranchExercised?'provider-unavailable':'http-rejection-only; provider branch not exercised')
  assert(evidence.aiObservation.observedMs>=5000&&evidence.aiObservation.samples.length>=2)
  for(const sample of evidence.aiObservation.samples)assert.deepEqual(sample.snapshot,evidence.before,'P6 sampled AI/execution mutation')
  stable(evidence.observation)
  const mcp=report.fragments.mcp
  const allowed=passed(mcp.checks,'mcp-tools-list-call').execution
  waited(allowed.longWait)
  assert(allowed.longWait.totalDurationMs>60000,'P6 allowed call did not outlive default policy snapshot')
  assert.equal(allowed.id,allowed.longWait.executionId)
  const revoked=passed(mcp.checks,'mcp-inflight-output-revoke')
  const timing=waited(revoked)
  assert(timing.pause<=time(revoked.revokedAt)&&time(revoked.revokedAt)<timing.response,'P6 revocation was not in flight')
  assert.equal(revoked.outputDenied,true);assert.equal(revoked.dbVerified,true)
  assert(revoked.mutation.requests.length>0)
  for(const row of revoked.mutation.requests)assert(row.status>=200&&row.status<300)
  assert(revoked.restoration.requests.length>0,'P6 policy restoration evidence missing')
  for(const row of revoked.restoration.requests)assert(row.status>=200&&row.status<300)
  const reconnect=revoked.reconnect
  assert.equal(reconnect.sameClient,true);assert.equal(reconnect.originalCredentials,true)
  assert.equal(reconnect.authorizationDenied,true)
  assert([200,401,403].includes(reconnect.initializeStatus))
  if(reconnect.initializeStatus===200){
    assert(/^[a-f0-9]{64}$/.test(reconnect.sessionSha256))
    assert(reconnect.list.empty||reconnect.list.error||[401,403].includes(reconnect.list.status))
    assert(reconnect.call.rpcError||reconnect.call.toolError||[401,403].includes(reconnect.call.status))
    stable(reconnect.call.sideEffects)
    assert(mcp.sessionCleanup.some(row=>row.sessionSha256===reconnect.sessionSha256&&row.passed),'P6 reinitialized session was not cleaned')
  }
}
