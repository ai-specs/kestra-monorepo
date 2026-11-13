import test from 'node:test'
import assert from 'node:assert/strict'
import {ProductionOAuthClient} from '../production-oauth-client.mjs'

test('MCP termination requires a real initialized identity before any request',async()=>{
 const client=new ProductionOAuthClient('http://localhost:18128')
 await assert.rejects(()=>client.terminateMcpSession('owned-session'))
})

import {McpSessionCleanup} from '../mcp-session-cleanup.mjs'
test('cleanup attempts every original client despite rejection and redacts private handles',async()=>{
 const cleanup=new McpSessionCleanup(),calls=[]
 const client={terminateMcpSession:async session=>{calls.push(session);if(session==='private-failing')throw new Error('token private-failing');return {status:200,oldSessionStatus:404}}}
 cleanup.register({client,session:'private-good',scenario:'allowed',subject:'test-account'})
 cleanup.register({client,session:'private-failing',scenario:'revoked',subject:'test-account'})
 const rows=await cleanup.closeAll()
 assert.deepEqual(calls,['private-failing','private-good']);assert.deepEqual(rows.map(r=>r.passed),[false,true])
 assert(!JSON.stringify(rows).includes('private-'));assert(!JSON.stringify(rows).includes('token'))
 assert.deepEqual(await cleanup.closeAll(),[])
})
test('HTTP authorization refusal remains cleanup failure',async()=>{
 const cleanup=new McpSessionCleanup()
 cleanup.register({client:{terminateMcpSession:async()=>({status:403})},session:'session',scenario:'denied',subject:'test-account'})
 const [row]=await cleanup.closeAll();assert.equal(row.passed,false);assert.equal(row.status,403)
})
test('original credential refresh precedes termination and refusal does not fall back to admin',async()=>{
 const calls=[],cleanup=new McpSessionCleanup()
 cleanup.register({client:{refresh:async()=>{calls.push('refresh');return 200},terminateMcpSession:async()=>{calls.push('delete');return {status:200,oldSessionStatus:404}}},session:'owned',scenario:'restored',subject:'original',refresh:true})
 cleanup.register({client:{refresh:async()=>{calls.push('denied-refresh');return 403},terminateMcpSession:async()=>{throw Error('must not run')}},session:'revoked',scenario:'revoked',subject:'original',refresh:true})
 const rows=await cleanup.closeAll();assert.deepEqual(calls,['denied-refresh','refresh','delete']);assert.deepEqual(rows.map(r=>r.passed),[false,true])
})
test('cleanup registry includes a session even when initialized notification later fails',async()=>{
 const cleanup=new McpSessionCleanup(),calls=[]
 const client={terminateMcpSession:async session=>{calls.push(session);return {status:200,oldSessionStatus:404}}}
 try {
  cleanup.register({client,session:'newly-initialized',scenario:'initialize-notification-failure',subject:'test-account'})
  throw new Error('notification rejected')
 }catch{}finally{
  const rows=await cleanup.closeAll();assert.equal(rows[0].passed,true)
 }
 assert.deepEqual(calls,['newly-initialized'])
})
test('DELETE uses the original issued bearer and protocol headers without UI cookies',async()=>{
 const base='http://localhost:18128';let state,termination
 class Client extends ProductionOAuthClient {
  async request(path,options={},includeSession=true){
   const url=new URL(path,base)
   if(options.method==='DELETE'){termination={url:url.href,options,includeSession};return new Response(null,{status:200})}
   if(url.pathname==='/api/v1/main/mcp/default'&&options.headers?.['Mcp-Session-Id'])return new Response(null,{status:404})
   if(url.pathname==='/api/v1/main/mcp/default')return new Response(null,{status:401,headers:{'www-authenticate':`Bearer resource_metadata="${base}/resource"`}})
   if(url.pathname==='/resource')return Response.json({resource:base+'/api/v1/main/mcp/default'})
   if(url.pathname==='/.well-known/openid-configuration')return Response.json({issuer:base,authorization_endpoint:base+'/oidc/authorize',token_endpoint:base+'/oidc/token',jwks_uri:base+'/jwks'})
   if(url.pathname==='/oidc/authorize'){state=url.searchParams.get('state');return new Response('<input name="interaction" value="interaction">')}
   if(url.pathname==='/oidc/consent')return new Response(null,{status:303,headers:{location:'http://127.0.0.1:19997/callback?code=code&state='+state}})
   if(url.pathname==='/oidc/token')return Response.json({access_token:'original-test-bearer',refresh_token:'test-refresh',scope:'mcp:flows:read'})
   throw Error('unexpected path')
  }
 }
 const client=new Client(base)
 await client.issueMcpScopes(['mcp:flows:read'],undefined,async()=>{}, {registeredClient:{client_id:'original-client',token_endpoint_auth_method:'none',redirect_uris:['http://127.0.0.1:19997/callback']}})
 assert.deepEqual(await client.terminateMcpSession('original-session'),{status:200,oldSessionStatus:404})
 assert.equal(termination.includeSession,false);assert.equal(termination.options.headers.Authorization,'Bearer original-test-bearer')
 assert.equal(termination.options.headers['Mcp-Session-Id'],'original-session');assert.equal(termination.options.headers['MCP-Protocol-Version'],'2025-06-18')
 assert.equal(termination.options.signal.aborted,false)
})
test('cleanup reauthorization must retain original subject and still attempts other sessions',async()=>{
 const calls=[],cleanup=new McpSessionCleanup(),client={terminateMcpSession:async()=>{calls.push('delete');return {status:200,oldSessionStatus:404}}}
 cleanup.register({client,session:'good',scenario:'original',subject:'alice',reauthorize:async()=>({subject:'alice'})})
 cleanup.register({client,session:'bad',scenario:'wrong-subject',subject:'alice',reauthorize:async()=>({subject:'admin'})})
 const rows=await cleanup.closeAll();assert.deepEqual(rows.map(x=>x.passed),[false,true]);assert.deepEqual(calls,['delete'])
})
test('initialize session header is registered before a malformed JSON body throws',async()=>{
 const base='http://localhost:18128',seen=[]
 class IssuedClient extends ProductionOAuthClient {
  async request(path,options={},includeSession=true){
   const url=new URL(path,base)
   if(url.pathname==='/api/v1/main/mcp/default'&&JSON.parse(options.body??'{}').method==='initialize')return new Response('{broken',{status:200,headers:{'mcp-session-id':'allocated-before-body'}})
   if(url.pathname==='/api/v1/main/mcp/default')return new Response(null,{status:401,headers:{'www-authenticate':`Bearer resource_metadata="${base}/resource"`}})
   if(url.pathname==='/resource')return Response.json({resource:base+'/api/v1/main/mcp/default'})
   if(url.pathname==='/.well-known/openid-configuration')return Response.json({issuer:base,authorization_endpoint:base+'/oidc/authorize',token_endpoint:base+'/oidc/token',jwks_uri:base+'/jwks'})
   if(url.pathname==='/oidc/authorize'){this.state=url.searchParams.get('state');return new Response('<input name="interaction" value="interaction">')}
   if(url.pathname==='/oidc/consent')return new Response(null,{status:303,headers:{location:'http://127.0.0.1:19997/callback?code=code&state='+this.state}})
   if(url.pathname==='/oidc/token')return Response.json({access_token:'test-bearer',refresh_token:'test-refresh',scope:'mcp:flows:read'})
   throw Error('unexpected path')
  }
 }
 const issued=new IssuedClient(base)
 await issued.issueMcpScopes(['mcp:flows:read'],undefined,async()=>{}, {registeredClient:{client_id:'client',token_endpoint_auth_method:'none',redirect_uris:['http://127.0.0.1:19997/callback']}})
 await assert.rejects(()=>issued.rpc(null,'initialize',{},1,{onInitializedSession:session=>seen.push(session)}),SyntaxError)
 assert.deepEqual(seen,['allocated-before-body'])
})
