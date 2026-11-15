import test from 'node:test'
import assert from 'node:assert/strict'
import {observeMcpExecution} from '../application-project-mcp-cases.mjs'
import {mcpFlowSource,planMcpScenarios} from '../application-project-fixture.mjs'
import {plannedMcpCheckIds} from '../application-project-integration-cases.mjs'

// These are offline state-machine checks, not evidence of production authorization.
function scenario({duplicate=false,early=false,minimumDurationMs=0,cancel=false}={}) {
  const controller=new AbortController(),evidence={},events=[]
  let submitted=false,paused=false,finished=false,resolveCall
  const result={status:200,message:{result:{isError:true}}}
  const invocation=new Promise(resolve=>{resolveCall=resolve})
  const operation=observeMcpExecution({signal:controller.signal,evidence,minimumDurationMs,intervalMs:1,
    listExecutions:async()=>submitted?(duplicate?[{id:'one'},{id:'two'}]:[{id:'one'}]):[],
    readExecution:async()=>({id:'one',state:{current:finished?'SUCCESS':early?'SUCCESS':'PAUSED'}}),
    invoke:()=>{submitted=true;events.push('submit');if(early){finished=true;resolveCall(result)}return invocation},
    onPaused:async()=>{paused=true;events.push('revoke');if(cancel)controller.abort(new Error('cancelled'));else{finished=true;resolveCall(result)}},
    record:async()=>{if(evidence.states?.at(-1)?.state==='PAUSED')events.push('observed-pause')},
  })
  return {operation,evidence,events,get paused(){return paused}}
}
test('only allowed and localRevoke seeds receive the controlled 65 second pause',()=>{
  const planned=planMcpScenarios()
  for(const seed of planned.seeds)assert.equal(seed.source.includes('pauseDuration: PT65S'),['mcp-allowed','mcp-local'].includes(seed.id))
  assert(!mcpFlowSource('example','flow','tool').includes('Pause'))
  assert(plannedMcpCheckIds.includes('mcp-inflight-output-revoke'))
  assert.equal(plannedMcpCheckIds.length,12)
})
test('revocation runs only after independent PAUSED observation and retains one execution',async()=>{
  const s=scenario();const result=await s.operation
  assert(s.paused);assert(s.events.indexOf('observed-pause')<s.events.indexOf('revoke'))
  assert.equal(result.execution.id,'one');assert.equal(s.evidence.newExecutionCount,1)
  assert.deepEqual(s.evidence.states.map(row=>row.state),['PAUSED','SUCCESS'])
  for(const key of ['submittedAt','pausedAt','terminalAt','responseAt'])assert(Number.isFinite(Date.parse(s.evidence[key])))
})
test('a second submitted execution is a failure with partial evidence',async()=>{
  const s=scenario({duplicate:true})
  await assert.rejects(s.operation,/more than one execution/)
  assert(!s.paused);assert(s.evidence.failedAt);assert(s.evidence.submittedAt)
})
test('an already-completed call cannot serve as waiting-output revocation evidence',async()=>{
  const s=scenario({early:true})
  await assert.rejects(s.operation,/without an observed PAUSED/)
  assert(!s.paused);assert(s.evidence.failedAt)
})
test('quick successful completion cannot satisfy the greater-than-60-second positive gate',async()=>{
  const s=scenario({minimumDurationMs:60000})
  await assert.rejects(s.operation,/required long wait/)
  assert(s.paused);assert(s.evidence.totalDurationMs<60000)
})
test('cancellation preserves the actual paused execution ID and failure evidence',async()=>{
  const s=scenario({cancel:true})
  await assert.rejects(s.operation,/cancelled/)
  assert.equal(s.evidence.executionId,'one');assert(s.evidence.failedAt)
})

test('RPC forwards the caller deadline through response body consumption',async()=>{
  const {ProductionOAuthClient}=await import('../production-oauth-client.mjs')
  const base='http://localhost:18128',controller=new AbortController()
  let actualSignal
  class Client extends ProductionOAuthClient {
    async request(path,options={}) {
      const url=new URL(path,base)
      if(url.pathname==='/api/v1/main/mcp/default'&&options.method==='POST'&&options.signal) {
        actualSignal=options.signal
        return new Response(new ReadableStream({start(stream){actualSignal.addEventListener('abort',()=>stream.error(actualSignal.reason),{once:true})}}),{headers:{'Content-Type':'text/event-stream'}})
      }
      if(url.pathname==='/api/v1/main/mcp/default')return new Response(null,{status:401,headers:{'www-authenticate':`Bearer resource_metadata="${base}/resource"`}})
      if(url.pathname==='/resource')return Response.json({resource:base+'/api/v1/main/mcp/default'})
      if(url.pathname==='/.well-known/openid-configuration')return Response.json({issuer:base,authorization_endpoint:base+'/oidc/authorize',token_endpoint:base+'/oidc/token',jwks_uri:base+'/jwks'})
      if(url.pathname==='/oidc/authorize'){this.state=url.searchParams.get('state');return new Response('<input name="interaction" value="interaction">')}
      if(url.pathname==='/oidc/consent')return new Response(null,{status:303,headers:{location:'http://127.0.0.1:19997/callback?code=code&state='+this.state}})
      if(url.pathname==='/oidc/token')return Response.json({access_token:'offline-bearer',refresh_token:'offline-refresh',scope:'mcp:flows:read'})
      throw Error('unexpected offline path')
    }
  }
  const client=new Client(base)
  await client.issueMcpScopes(['mcp:flows:read'],undefined,async()=>{}, {registeredClient:{client_id:'offline-client',token_endpoint_auth_method:'none',redirect_uris:['http://127.0.0.1:19997/callback']}})
  const pending=client.rpc('offline-session','tools/call',{name:'offline-tool'},1,{signal:controller.signal})
  await Promise.resolve();controller.abort(new Error('offline-deadline'))
  await assert.rejects(pending,/offline-deadline/)
  assert.equal(actualSignal,controller.signal)
})
