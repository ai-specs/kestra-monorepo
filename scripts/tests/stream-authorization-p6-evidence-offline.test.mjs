import test from 'node:test'
import assert from 'node:assert/strict'
import {assertP6Evidence} from '../stream-authorization-p6-evidence.mjs'

// Synthetic reports exercise the checker only; they are not production evidence.
const t=ms=>new Date(1700000000000+ms).toISOString()
const row=(id,evidence)=>({id,status:'passed',passed:true,evidence})
function fixture() {
  const observation={before:'stable',immediate:'stable',windowMs:5000,sources:['database','queue','storage'],samples:[{elapsedMs:5001,hash:'stable'}]}
  const storage={ai_agent_thread:{present:false},ai_agent_message:{present:false},executions:{present:true,count:1,hash:'a'.repeat(32)},execution_queued:{present:true,count:0,hash:'b'.repeat(32)}}
  const paths=[['POST','/api/v1/main/ai/threads'],['GET','/api/v1/main/ai/threads/p6-unavailable'],['POST','/api/v1/main/ai/threads/p6-unavailable/chat'],...Array.from({length:3},()=>['POST','/api/v1/main/ai/threads/p6-unavailable/confirm'])]
  const ai={providerConfigured:false,providerBranchExercised:false,coverage:'http-rejection-only; provider branch not exercised',aiObservation:{observedMs:5001,samples:[{snapshot:structuredClone(storage)},{snapshot:structuredClone(storage)}]},before:storage,after:structuredClone(storage),observation,statuses:['manager','reader'].flatMap(role=>paths.map(([method,path],index)=>({role,method,path,decision:[null,null,null,'APPROVE','REJECT','APPROVE'][index],status:403,boundary:'http-forbidden'})))}
  const waiting={executionId:'execution',submittedAt:t(0),pausedAt:t(100),terminalAt:t(65000),responseAt:t(65010),totalDurationMs:65010,newExecutionCount:1,states:[{state:'PAUSED'},{state:'SUCCESS'}]}
  const revoked={...structuredClone(waiting),revokedAt:t(1000),outputDenied:true,dbVerified:true,mutation:{requests:[{status:200}]},restoration:{requests:[{status:200}]},reconnect:{sameClient:true,originalCredentials:true,authorizationDenied:true,initializeStatus:403}}
  return {fragments:{security:{checks:[row('ai-no-provider-fails-closed',{steps:[{name:'ai-unavailable-no-side-effects',...ai}]})]},mcp:{checks:[row('mcp-tools-list-call',{execution:{id:'execution',longWait:waiting}}),row('mcp-inflight-output-revoke',revoked)],sessionCleanup:[]}}}
}
const ai=r=>r.fragments.security.checks[0].evidence.steps[0]
const revoked=r=>r.fragments.mcp.checks[1].evidence

test('P6 checker accepts complete synthetic negative AI and waiting MCP evidence',()=>assert.doesNotThrow(()=>assertP6Evidence(fixture())))
for(const [name,mutate]of [
  ['missing runtime provider flag',r=>delete ai(r).providerConfigured],
  ['sampled AI mutation',r=>{ai(r).aiObservation.samples[0].snapshot.executions.count++}],
  ['false provider branch claim',r=>{ai(r).providerBranchExercised=true}],
  ['missing AI role',r=>{ai(r).statuses=ai(r).statuses.filter(row=>row.role!=='manager')}],
  ['AI request succeeded',r=>{ai(r).statuses[0].status=200}],
  ['AI execution table hidden',r=>{ai(r).before.executions={present:false};ai(r).after.executions={present:false}}],
  ['AI storage mutation',r=>{ai(r).after.executions.count++}],
  ['delayed side effect',r=>{ai(r).observation.samples[0].hash='changed'}],
  ['allowed long wait missing',r=>{r.fragments.mcp.checks[0].evidence.execution.longWait.totalDurationMs=100}],
  ['missing actual pause',r=>{revoked(r).states=[{state:'SUCCESS'}]}],
  ['duplicate submission',r=>{revoked(r).newExecutionCount=2}],
  ['revocation after output',r=>{revoked(r).revokedAt=t(66000)}],
  ['output not denied',r=>{revoked(r).outputDenied=false}],
  ['policy not restored',r=>{revoked(r).restoration.requests=[]}],
  ['reconnect infrastructure failure',r=>{revoked(r).reconnect.initializeStatus=500}],
  ['reconnect cleanup omitted',r=>{revoked(r).reconnect={sameClient:true,originalCredentials:true,authorizationDenied:true,initializeStatus:200,sessionSha256:'c'.repeat(64),list:{empty:true},call:{rpcError:true,sideEffects:structuredClone(ai(r).observation)}}}],
])test('P6 checker rejects '+name,()=>{const report=fixture();mutate(report);assert.throws(()=>assertP6Evidence(report))})
