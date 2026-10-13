#!/usr/bin/env node
// Compose harness worker. No mock identity, direct SQL user creation, or decoded-JWT authorization.
import {writeFileSync} from 'node:fs';
import {createHash, randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {Readable} from 'node:stream';
const [base, directory, phase] = process.argv.slice(2);
if (!base || !directory || !['seed','enabled','missing','disabled'].includes(phase)) {
  throw Error('usage: blackbox-rbac.mjs BASE TEMP_DIRECTORY seed|enabled|missing|disabled');
}
const check = (ok, label) => { if (!ok) throw Error(label); console.log(`PASS ${label}`); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const users = {reader:['rbac-reader','ReaderPass123!'],writer:['rbac-writer','WriterPass123!'],admin:['tester','Passw0rd!']};
const jars = new Map();
const form = values => ({method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(values)});
function jar(user) { if (!jars.has(user)) jars.set(user,new Map()); return jars.get(user); }
async function request(user, path, options={}) {
  const cookies = user ? jar(user) : null;
  const url = new URL(path,base);
  if(url.origin !== new URL(base).origin) throw Error('request leaves test instance');
  const response = await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(90000),...options,
    headers:{...(cookies ? {Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')} : {}),...options.headers}});
  if(cookies) for(const cookie of response.headers.getSetCookie()) {
    const pair=cookie.split(';')[0], sep=pair.indexOf('='); cookies.set(pair.slice(0,sep),pair.slice(sep+1));
  }
  return response;
}
async function login(user) {
  let r=await request(user,'/oauth/login/kestra');
  check(r.status===302,`${user} UI OAuth start`);
  r=await request(user,r.headers.get('location'));
  check([303,307].includes(r.status),`${user} authorize redirects to production login`);
  const loginUrl=new URL(r.headers.get('location'),base);
  check(loginUrl.pathname==='/oidc/login',`${user} real password login required`);
  r=await request(user,'/oidc/login',form({username:users[user][0],password:users[user][1],from:loginUrl.searchParams.get('from')}));
  check(r.status===303,`${user} password accepted`);
  for(let hop=0;hop<10 && [301,302,303,307,308].includes(r.status);hop++) r=await request(user,r.headers.get('location'));
  const html=await r.text();
  const csrf=html.match(/name="csrf-token"[^>]*content="([^"]+)"/)?.[1] || html.match(/content="([^"]+)"[^>]*name="csrf-token"/)?.[1];
  check(r.status===200 && csrf && jar(user).has('JWT'),`${user} OAuth callback/UI/CSRF cookie`);
  return csrf;
}
const yaml = (id,ns,tool=null) => `id: ${id}\nnamespace: ${ns}\ntasks:\n  - id: result\n    type: io.kestra.plugin.core.storage.Write\n    content: verified\noutputs:\n  - id: file\n    type: STRING\n    value: "{{ outputs.result.uri }}"\n${tool ? `triggers:\n  - id: mcp\n    type: io.kestra.plugin.core.trigger.McpToolTrigger\n    mcpServer: default\n    toolName: ${tool}\n    title: RBAC acceptance\n    toolDescription: RBAC acceptance flow\n` : ''}`;
async function create(user,csrf,id,ns,tool=null,chunked=false) {
  const text=yaml(id,ns,tool);
  return upload(user,csrf,text,'POST','/api/v1/main/flows',chunked);
}
async function upload(user,csrf,text,method='POST',path='/api/v1/main/flows',chunked=false) {
  const options={method,headers:{'Content-Type':'application/x-yaml','X-CSRF-TOKEN':csrf},body:text};
  if(chunked) {
    options.body=Readable.from((async function*(){yield text.slice(0,25);await pause(150);yield text.slice(25);})());
    options.duplex='half';
  }
  return request(user,path,options);
}
async function refused(response,label) {
  check([400,403,404].includes(response.status),`${label}: canonicalization/tenant refusal (HTTP ${response.status})`);
  if(response.status===403) await denied(response,label); else await response.body?.cancel();
}
async function denied(response,label,status=403) {
  check(response.status===status,`${label}: HTTP ${status} (got ${response.status})`);
  check(response.headers.get('content-type')?.includes('application/problem+json'),`${label}: problem JSON`);
  const problem=await response.json();
  check(problem && (problem.status===status || problem.statusCode===status),`${label}: problem status`);
}
function sql(query) {
  if(!process.env.BB_RBAC_PG) throw Error('BB_RBAC_PG must identify the isolated Compose postgres container');
  return execFileSync('docker',['exec',process.env.BB_RBAC_PG,'psql','-U','kestra','-d','kestra','-v','ON_ERROR_STOP=1','-Atc',query],{encoding:'utf8'}).trim();
}
function snapshot() {
  // Queue records may be pruned; executions and execution_queued independently catch persisted side effects.
  return sql(`SELECT json_build_object('executions',(SELECT count(*) FROM executions WHERE value->>'namespace' IN ('rbac.allowed','rbac.denied')),'pending',(SELECT count(*) FROM execution_queued WHERE value::text LIKE '%rbac.%'),'commands',(SELECT count(*) FROM queues WHERE value::text LIKE '%rbac.%' AND type ILIKE '%execution%'),'flows',(SELECT md5(coalesce(string_agg(value::text,'|' ORDER BY key),'')) FROM flows WHERE value->>'namespace' IN ('rbac.allowed','rbac.denied')))::text`);
}
async function noSideEffect(label,operation,asyncExecution=false) {
  const before=snapshot(); await operation();
  // Repeated checks cover asynchronous persistence, not only the immediate HTTP response.
  check(snapshot()===before,`${label}: no flow/execution/pending/queue side effects`);
  if(asyncExecution){await pause(1000);check(snapshot()===before,`${label}: no delayed execution side effect`);}
}
async function token(user,scope) {
  const challenge=await request(null,'/api/v1/main/mcp/default',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  check(challenge.status===401,`${user} MCP unauthenticated challenge`);
  const metadata=challenge.headers.get('www-authenticate')?.match(/resource_metadata="([^"]+)"/)?.[1];
  check(metadata,`${user} protected resource discovery`);
  const resourceResponse=await request(null,metadata);
  check(resourceResponse.status===200,'resource metadata available');
  const resource=(await resourceResponse.json()).resource;
  check(resource===`${base}/api/v1/main/mcp/default`,'exact MCP resource');
  let r=await request(null,'/oidc/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({redirect_uris:['http://127.0.0.1:19997/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],scope,client_name:'RBAC Compose acceptance'})});
  check(r.status===201,`${user} independent public client DCR`);
  const client=await r.json(), verifier=randomBytes(48).toString('base64url'), state=randomBytes(20).toString('hex');
  const query=new URLSearchParams({client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',scope,state,nonce:randomBytes(20).toString('hex'),code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',resource});
  r=await request(user,`/oidc/authorize?${query}`);
  const page=await r.text(), interaction=page.match(/name="interaction" value="([^"]+)"/)?.[1];
  check(r.status===200 && interaction,`${user} real consent interaction`);
  r=await request(user,'/oidc/consent',{...form({interaction,decision:'approve',...Object.fromEntries(scope.split(' ').map(s=>[`scope-${s}`,'yes']))}),headers:{Origin:base,'Content-Type':'application/x-www-form-urlencoded'}});
  check(r.status===303,`${user} consent binds owner`);
  const callback=new URL(r.headers.get('location'));
  check(callback.origin==='http://127.0.0.1:19997' && callback.searchParams.get('state')===state,`${user} PKCE callback/state`);
  r=await request(null,'/oidc/token',form({grant_type:'authorization_code',client_id:client.client_id,redirect_uri:client.redirect_uris[0],code:callback.searchParams.get('code'),code_verifier:verifier,resource}));
  check(r.status===200,`${user} S256 token exchange`);
  const tokens=await r.json();
  // Decoding only checks fixture issuance; all authorization is performed by the real server.
  const claims=JSON.parse(Buffer.from(tokens.access_token.split('.')[1],'base64url'));
  check(claims.sub===users[user][0] && claims.roles?.includes(user),`${user} token has expected authenticated subject/role`);
  const audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  check(audiences.length===1 && audiences[0]===resource,`${user} exact audience`);
  return tokens.access_token;
}
async function rpc(tokenValue,session,method,params,id) {
  const response=await request(null,'/api/v1/main/mcp/default',{method:'POST',headers:{Authorization:`Bearer ${tokenValue}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(session?{'Mcp-Session-Id':session,'MCP-Protocol-Version':'2025-06-18'}:{})},body:JSON.stringify({jsonrpc:'2.0',...(id===undefined?{}:{id}),method,...(params?{params}:{})})});
  const sessionId=response.headers.get('mcp-session-id') || session;
  if(id===undefined){check([200,202,204].includes(response.status),'MCP initialized notification accepted');await response.body?.cancel();return {session:sessionId};}
  check(response.status===200,`${method} accepted protocol request (HTTP ${response.status})`);
  if(response.headers.get('content-type')?.includes('text/event-stream')) {
    const reader=response.body.getReader(), decoder=new TextDecoder(); let buffer='';
    try {
      while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');let split;
        while((split=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,split);buffer=buffer.slice(split+2);const data=event.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data)continue;const message=JSON.parse(data);if(message.id===id)return {message,session:sessionId};}
      }
      throw Error(`${method}: SSE ended without matching JSON-RPC response`);
    } finally {await reader.cancel();}
  }
  const message=await response.json();check(message.id===id,`${method} response id`);return {message,session:sessionId};
}
async function mcp(tokenValue) {
  const init=await rpc(tokenValue,null,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'rbac-compose-blackbox',version:'1'}},1);
  check(init.message.result && !init.message.error,'MCP initialize succeeds');
  await rpc(tokenValue,init.session,'notifications/initialized');
  return {list:async()=> (await rpc(tokenValue,init.session,'tools/list',{},2)).message,
    call:async name=> (await rpc(tokenValue,init.session,'tools/call',{name,arguments:{}},3)).message};
}
function callDenied(message,label){check(Boolean(message.error || message.result?.isError),label);}
if(phase==='seed') {
  const csrf=await login('admin');
  for(const [ns,tool] of [['rbac.allowed','rbac-allowed-tool'],['rbac.denied','rbac-denied-tool']]) {
    const r=await create('admin',csrf,'rbac-mcp',ns,tool);check(r.ok,`seed ${ns} real flow/MCP trigger`);
  }
  const dangerous=yaml('rbac-dangerous','rbac.allowed','rbac-dangerous-tool') + `inputs:
  - id: guarded
    type: STRING
    defaults: "{{ secret('RBAC_PROBE_MUST_NOT_RENDER') }}"
`;
  check((await upload('admin',csrf,dangerous)).ok,'seed dangerous expression fixture without execution');
  const oldRevision=yaml('rbac-revision','rbac.allowed') + `inputs:
  - id: guarded
    type: STRING
    defaults: "{{ secret('RBAC_PROBE_MUST_NOT_RENDER') }}"
`;
  check((await upload('admin',csrf,oldRevision)).ok,'seed revision 1 with dangerous input');
  check((await upload('admin',csrf,yaml('rbac-revision','rbac.allowed'),'PUT','/api/v1/main/flows/rbac.allowed/rbac-revision')).ok,'seed safe latest revision without deleting dangerous revision');
  const namespaceFile=new FormData();namespaceFile.set('fileContent',new Blob(['cross-domain-sentinel']),'rbac-probe.txt');
  check((await request('admin','/api/v1/main/namespaces/rbac.denied/files?path=%2Frbac-probe.txt',
    {method:'POST',headers:{'X-CSRF-TOKEN':csrf},body:namespaceFile})).ok,'seed real forbidden-namespace file');
  const sentinel=await request('admin','/api/v1/main/namespaces/rbac.denied/files?path=%2Frbac-probe.txt');
  check(sentinel.ok && (await sentinel.text())==='cross-domain-sentinel','forbidden-namespace sentinel genuinely exists');
  const server=await request('admin','/api/v1/main/mcp-servers/default');check(server.ok,'bootstrap default MCP server exists');
  const value=await server.json();
  if(value.disabled || value.authType!=='OAUTH') {
    const r=await request('admin','/api/v1/main/mcp-servers/default',{method:'PUT',headers:{'Content-Type':'application/json','X-CSRF-TOKEN':csrf},body:JSON.stringify({...value,authType:'OAUTH',disabled:false})});check(r.ok,'enable default MCP server through production API');
  }
} else {
  const readerCsrf=await login('reader'), writerCsrf=await login('writer');
  const anonymous=await request(null,'/api/v1/main/flows/rbac.allowed/rbac-mcp',{headers:{Accept:'application/json'}});
  check(anonymous.status===401,'REST without token is 401');
  if(phase==='enabled') {
    await noSideEffect('reader write deny',async()=>denied(await create('reader',readerCsrf,'reader-denied-write','rbac.allowed'),'reader create'));
    const search=await request('reader','/api/v1/main/flows/search?filters%5Bnamespace%5D%5BEQUALS%5D=rbac.allowed&page=1&size=100');
    check(search.status===200,'reader authorized-domain search 200');
    const results=await search.json(), rows=Array.isArray(results)?results:results.results;
    check(Array.isArray(rows) && rows.some(f=>f.id==='rbac-mcp') && rows.every(f=>f.namespace==='rbac.allowed' || f.namespace?.startsWith('rbac.allowed.')),'search returns fixture and only authorized domain');
    await denied(await request('reader','/api/v1/main/flows/rbac.denied/rbac-mcp'),'cross-domain flow detail');
    const forbiddenSearch=await request('reader','/api/v1/main/flows/search?filters%5Bnamespace%5D%5BEQUALS%5D=rbac.denied');
    check(forbiddenSearch.ok,'cross-domain search uses authorized query scope');
    const forbiddenResults=await forbiddenSearch.json();
    check(forbiddenResults.total===0 && forbiddenResults.results?.length===0,'cross-domain search reveals no rows or counts');
    const unrestrictedSearch=await request('reader','/api/v1/main/flows/search');
    check(unrestrictedSearch.ok,'unfiltered UI search uses authorized query scope');
    const restrictedResults=await unrestrictedSearch.json();
    check(restrictedResults.results?.length>0 && restrictedResults.results.every(flow=>flow.namespace==='rbac.allowed'||flow.namespace?.startsWith('rbac.allowed.')),'unfiltered search contains only authorized namespaces');
    const created=await create('writer',writerCsrf,'writer-created','rbac.allowed',null,true);check(created.ok,'writer chunked YAML create 2xx/body branch does not stall');
    const saved=await request('writer','/api/v1/main/flows/rbac.allowed/writer-created?source=true');const savedFlow=await saved.json();check(saved.ok && savedFlow.id==='writer-created' && typeof savedFlow.source==='string' && savedFlow.source.includes('content: verified'),'controller reads complete audited chunked body/source=true contract');
    await noSideEffect('writer cross-domain create deny',async()=>denied(await create('writer',writerCsrf,'writer-denied-write','rbac.denied'),'writer outside allowed domain'));
    await noSideEffect('batch/unknown deny',async()=>{
      await denied(await request('writer','/api/v1/main/flows/delete/by-ids',{method:'DELETE',headers:{'Content-Type':'application/json','X-CSRF-TOKEN':writerCsrf},body:JSON.stringify([{namespace:'rbac.allowed',id:'rbac-mcp'},{namespace:'rbac.denied',id:'rbac-mcp'}])}),'unmapped batch');
      await denied(await request('writer','/api/v1/main/rbac-unknown-path'),'unknown route');
    });
    await noSideEffect('alias and encoded REST routes deny',async()=>{
      for(const path of ['/api/v1/alias/flows/rbac.allowed/rbac-mcp','/api/v1/main/flows/rbac%2Eallowed/rbac-mcp','/api/v1/main/flows/rbac.allowed/%72bac-mcp'])
        await refused(await request('writer',path),`noncanonical ${path}`);
    });
    await noSideEffect('REST dangerous revision/wait cannot bypass preflight',async()=>{
      for(const path of ['/api/v1/main/executions/rbac.allowed/rbac-dangerous',
        '/api/v1/main/executions/rbac.allowed/rbac-revision?revision=1',
        '/api/v1/main/executions/rbac.allowed/rbac-revision?revision=1&wait=true'])
        await denied(await request('writer',path,{method:'POST',headers:{'X-CSRF-TOKEN':writerCsrf},body:new FormData()}),`dangerous REST ${path}`);
    },true);
    // A readiness assertion for the completed execution boundary, not an unknown-route bypass.
    const executionResponse=await request('writer','/api/v1/main/executions/rbac.allowed/rbac-revision?wait=true',{method:'POST',headers:{'X-CSRF-TOKEN':writerCsrf},body:new FormData()});
    check(executionResponse.ok,'writer safe latest REST execution 2xx (requires supported execution boundary)');
    const execution=await executionResponse.json();
    check(typeof execution.id==='string' && execution.flowId==='rbac-revision' && execution.flowRevision>=2,'REST executed safe latest revision');
    let stored;
    for(let attempt=0;attempt<45;attempt++) {
      const r=await request('writer',`/api/v1/main/executions/${execution.id}`);check(r.status===200,'writer EXECUTION id READ+ACCESS_OUTPUTS');stored=await r.json();
      if(stored.state?.current==='SUCCESS')break;
      check(!['FAILED','KILLED','CANCELLED'].includes(stored.state?.current),'safe REST execution did not fail');await pause(1000);
    }
    check(stored?.state?.current==='SUCCESS','safe REST execution persisted SUCCESS');
    check(/^[A-Za-z0-9_-]+$/.test(execution.id),'execution id safe for fixture SQL lookup');
    const outputBytes=sql(`SELECT encode(value,'base64') FROM execution_outputs WHERE key='${execution.id}'`);
    const ion=Buffer.from(outputBytes,'base64').toString('utf8');
    // Host stores flow outputs as text Ion, not JSON. This fixture has one quoted URI scalar.
    const match=ion.match(/(?:\"file\"|\bfile)\s*:\s*(\"(?:[^\"\\]|\\.)*\")/);
    check(Boolean(match),'persisted text-Ion fixture file output exists');
    const uri=JSON.parse(match[1]);
    check(typeof uri==='string' && uri.startsWith('kestra://'),'real execution storage output URI');
    const download=await request('writer',`/api/v1/main/executions/${execution.id}/file?${new URLSearchParams({path:uri})}`);
    check(download.status===200 && (await download.text())==='verified','writer EXECUTION ACCESS_OUTPUTS downloads actual artifact');
    const outputUrl=new URL(uri), path=outputUrl.pathname;
    const executionSegment=`/executions/${execution.id}`;
    check(path.includes(executionSegment+'/'),'output URI has exact current execution segment');
    const forbiddenFiles=[
      ['local file','file:///etc/passwd'],
      ['other namespace real file','nsfile://rbac.denied/rbac-probe.txt'],
      ['own namespace file','nsfile:///rbac-probe.txt'],
      ['flow state',`kestra://${path.split('/executions/')[0]}/state/rbac-probe.txt`],
      ['other execution',uri.replace(executionSegment,'/executions/other-execution')],
      ['execution prefix sibling',uri.replace(executionSegment,executionSegment+'-sibling')],
      ['other namespace storage',uri.replace('/rbac/allowed/','/rbac/denied/')],
      ['unexpected authority',`kestra://untrusted.invalid${path}`],
      ['URI query',uri+'?alternate=1'],['URI fragment',uri+'#alternate'],
      ['encoded path',uri.replace('/executions/','/%65xecutions/')],
      ['traversal',`kestra://${path.slice(0,path.lastIndexOf('/'))}/../rbac-probe.txt`],
      ['encoded traversal',`kestra://${path.slice(0,path.lastIndexOf('/'))}/%2e%2e/rbac-probe.txt`],
      ['duplicate path',uri+'/',uri],
    ];
    for(const [label,candidate,second] of forbiddenFiles) {
      const query=new URLSearchParams({path:candidate});if(second)query.append('path',second);
      for(const endpoint of ['file','file/metas'])
        await denied(await request('writer',`/api/v1/main/executions/${execution.id}/${endpoint}?${query}`),`file confinement ${label} / ${endpoint}`);
    }
    check((await request('reader',`/api/v1/main/executions/${execution.id}`)).ok,'reader can read authorized execution details');
    for(const suffix of [`/file?${new URLSearchParams({path:uri})}`])
      await denied(await request('reader',`/api/v1/main/executions/${execution.id}${suffix}`),'reader READ-only cannot access execution id/output without ACCESS_OUTPUTS');
    const full='openid mcp:flows:read mcp:executions:write';
    const reader=await mcp(await token('reader',full)), writer=await mcp(await token('writer',full));
    const visible=await reader.list();check(visible.result?.tools?.some(t=>t.name==='rbac-allowed-tool') && !visible.result.tools.some(t=>t.name==='rbac-denied-tool'),'reader tools list applies per-resource RBAC');
    await noSideEffect('same reader/resource REST+MCP deny',async()=>{
      await denied(await request('reader','/api/v1/main/executions/rbac.allowed/rbac-mcp',{method:'POST',headers:{'X-CSRF-TOKEN':readerCsrf},body:new FormData()}),'reader REST execute');
      callDenied(await reader.call('rbac-allowed-tool'),'reader MCP execute deny despite full OAuth scope');
      callDenied(await reader.call('rbac-denied-tool'),'reader cannot call hidden cross-domain tool');
    },true);
    await noSideEffect('writer MCP cross-domain/dangerous expression deny',async()=>{
      callDenied(await writer.call('rbac-denied-tool'),'writer MCP cross-domain deny');
      callDenied(await writer.call('rbac-dangerous-tool'),'writer MCP dangerous input expression denied before execution');
    },true);
    for(const scope of ['openid mcp:flows:read','openid mcp:executions:write']) {
      const client=await mcp(await token('writer',scope));
      await noSideEffect(`writer RBAC allow / scope deny (${scope})`,async()=>callDenied(await client.call('rbac-allowed-tool'),'missing conjunctive scope denies tool execution'),true);
    }
    const before=Number(sql("SELECT count(*) FROM executions WHERE value->>'namespace'='rbac.allowed' AND value->>'flowId'='rbac-mcp'"));
    const result=await writer.call('rbac-allowed-tool');check(result.result && result.result.isError!==true && !result.error,'writer RBAC+full scope real MCP execution succeeds');
    check(Number(sql("SELECT count(*) FROM executions WHERE value->>'namespace'='rbac.allowed' AND value->>'flowId'='rbac-mcp' AND value->'state'->>'current'='SUCCESS'"))===before+1,'successful MCP execution persisted exactly once');
  } else if(phase==='missing') {
    await noSideEffect('missing jar globally fail closed',async()=>{
      for(const user of ['reader','writer']) await denied(await request(user,'/api/v1/main/flows/rbac.allowed/rbac-mcp'),`${user} no-jar REST read`);
      await denied(await create('writer',writerCsrf,'missing-jar-write','rbac.allowed'),'no-jar REST create');
      const client=await mcp(await token('writer','openid mcp:flows:read mcp:executions:write'));
      const listed=await client.list();check(Array.isArray(listed.result?.tools) && listed.result.tools.length===0,'no jar tools hidden');
      callDenied(await client.call('rbac-allowed-tool'),'no jar MCP execute denied');
    },true);
  } else {
    for(const path of ['/api/v1/main/flows/rbac.denied/rbac-mcp','/api/v1/main/flows/search?filters%5Bnamespace%5D%5BEQUALS%5D=rbac.denied']) check((await request('reader',path)).ok,'disabled RBAC authenticated vanilla read/search');
    check((await create('reader',readerCsrf,'disabled-reader-write','rbac.denied')).ok,'disabled RBAC authenticated write regression');
  }
}
writeFileSync(`${directory}/${phase}.passed`,'passed\n',{mode:0o600});
console.log(`RBAC COMPOSE ${phase.toUpperCase()} ALL GREEN`);
