/**
 * Real MCP acceptance fragment. No browser launch, token decoding or SQL grants.
 * runApplicationProjectMcp(base,fixture,record)
 * fixture.accounts[name]={username,password,subject}; observerAccount likewise.
 * names: allowed,capabilityOnly,projectOnly,knownUnbound,localRevoke,
 * directoryRevoke,subjectRevoke. Each is a separately prepared real subject.
 * fixture.scenarios[name]={applicationGroupScopes:[scopeNames...],protocolScopes:[...],
 *   expectedTools:[complete exact names],call:{name,arguments,namespace,flowId,
 *   executionIdPath:'result.structuredContent.executionId',expectedExecutionFields}}
 * The executionIdPath MUST describe the published tool result, not a guessed ID.
 * fixture.management({kind,phase,client,account,registration?,scope?,subject?})
 * performs ONLY formal management HTTP calls using ProductionOAuthClient.request.
 * It MUST return {requests:[{method,path,status,requestId?}],
 * reauthentication:{subject,callbackPath,authenticated:true}, restore?:async()=>receipt}.
 * No prewritten passed flag is consumed. Module independently checks fresh trusted
 * UI identity with expectedUiAudience after callbacks; callback receipts alone
 * never establish actual authorization success. Mutations restore in finally.
 * kind: approve-client, revoke-application-scope-policy, revoke-supported-scope,
 * revoke-subject-scopes. phase: mutate; approval gets the real DCR registration.
 * fixture.databaseExecution({id,namespace,flowId}) is a READ-ONLY observer returning
 * {id,namespace,flowId,state,...}; compare with real observer API execution.
 * fixture.denialErrors:[{code:<published numeric RPC code>,message:<exact text>}],
 * fixture.denialToolCodes:[<published structuredContent.code strings>] explicitly
 * classify authorization errors. Unknown-method/invalid-params/general errors do
 * not count as authorization denial merely because an error object exists.
 * fixture.effects: ProjectSideEffects instance/config; revokeWindowMs<=60000,
 * effectsWindowMs>=5000. fixture.missingExtension optionally supplies a SEPARATE
 * {base,account,scenario,management,effects,expectedUiAudience,databaseExecution}
 * isolated published deployment missing the jar; it never changes this deployment.
 * Missing-mode is mandatory here: no skip may satisfy missing-extension.
 * record persists every failed/pending check and final fragment. No fabricated
 * checks for UI/REST or every requiredProjectChecks entry: only listed ownership.
 */
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {McpSessionCleanup} from './mcp-session-cleanup.mjs'
import {ProjectSideEffects} from './application-project-effects.mjs'
import {scopeNames,requiredProjectChecks,applicationProject} from './application-project-cases.mjs'

const owned=Object.freeze(['mcp-production-dcr-owner-pkce-consent','mcp-tools-list-call','mcp-inflight-output-revoke',
  'mcp-capability-without-application-scope','mcp-application-scope-without-capability','mcp-known-plus-unbound-list','mcp-known-plus-unbound-call',
  'mcp-same-session-application-policy-revoke','mcp-same-session-supported-scope-revoke','mcp-user-scope-revoke','refresh-cannot-restore-revoked-scope','mcp-missing-extension'])
const sorted=value=>[...value].sort()
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(name=>[name,canonical(value[name])])):value
const jsonEqual=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b))
const get=(value,path)=>path.split('.').reduce((object,name)=>object?.[name],value)
export async function runApplicationProjectMcp(base,fixture,record) {
  assert.equal(typeof record,'function','persistent report callback required')
  const report={schemaVersion:1,completed:false,checks:owned.map(id=>({id,passed:false,status:'not_run',evidence:{}})),sessions:[],mutations:[],rpc:[],failures:0,skipped:0,notRun:owned.length}
  const restorations=[];const revoked=[];const sessionCleanup=new McpSessionCleanup();let rpcId=1;let effects;let observer;let issuance
  const allSecrets=Object.values(fixture.accounts??{}).map(account=>account.password).concat(fixture.observerAccount?.password).filter(Boolean)
  const safe=error=>allSecrets.reduce((text,secret)=>text.replaceAll(secret,'[redacted]'),String(error?.message??error)).replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted-jwt]')
  async function persist(){report.failures=report.checks.filter(check=>check.status==='failed').length;report.notRun=report.checks.filter(check=>check.status==='not_run').length;await record(structuredClone(report))}
  async function check(id,operation){const row=report.checks.find(item=>item.id===id);assert(row,'unknown owned check');row.status='running';try{const value=await operation();row.evidence=value;row.passed=true;row.status='passed'}catch(error){row.status='failed';row.error=safe(error);if(error.evidence)row.evidence=error.evidence;if(error.sideEffects)row.evidence.sideEffects=error.sideEffects}finally{await persist()}}
  async function login(client,account){assert(account?.subject&&account.username&&account.password,'configured real credentials required');const result=await client.login(account.username,account.password);assert(result.authenticated&&['/ui/','/ui/main/dashboards','/ui/access-denied'].includes(result.callbackPath),'production OAuth callback path invalid');return result}
  async function receipt(value,client,account,config=fixture){
    assert(Array.isArray(value?.requests)&&value.requests.length,'management HTTP request evidence missing')
    for(const request of value.requests){assert(['POST','PUT','DELETE'].includes(request.method)&&request.path?.startsWith('/api/')&&!request.path.startsWith('//'),'formal management HTTP path required');assert(request.status>=200&&request.status<300,'management mutation did not succeed')}
    assert(value.reauthentication?.authenticated===true&&value.reauthentication.subject===account.subject,'production reauthentication receipt missing')
    assert(['/ui/','/ui/main/dashboards','/ui/access-denied'].includes(value.reauthentication.callbackPath),'unexpected reauthentication callback path')
    const verified=await client.verifiedUiIdentity({applicationGroupId:applicationProject,subject:account.subject,audience:config.expectedUiAudience})
    assert.equal(verified.subject,account.subject)
    return {requests:value.requests,reauthentication:{subject:verified.subject,callbackPath:value.reauthentication.callbackPath,authenticated:true,authorizationVersion:verified.authorizationVersion}}
  }
  async function session(name,config=fixture,target=base){
    const account=config.accounts?.[name]??config.account;const spec=config.scenarios?.[name]??config.scenario
    assert(spec&&Array.isArray(spec.applicationGroupScopes)&&Array.isArray(spec.protocolScopes)&&Array.isArray(spec.expectedTools),'explicit scopes and full expected tool names required')
    assert(spec.applicationGroupScopes.every(scope=>Object.values(scopeNames).includes(scope)),'scenario scope outside unified scopeNames')
    const client=new ProductionOAuthClient(target);await login(client,account)
    const issued=await client.issueMcpScopes([...spec.protocolScopes,...spec.applicationGroupScopes],async registration=>{
      assert.equal(typeof config.management,'function','formal management callback required')
      const value=await config.management({kind:'approve-client',phase:'mutate',client,account,registration})
      // The helper invokes reauthentication after approval; retain receipt now,
      // independently verify after that login rather than accepting a flag.
      assert(value&&Array.isArray(value.requests),'approval request evidence missing')
      if(value.restore)restorations.push({label:'approve-'+name,restore:value.restore,client,account,config})
      client.__approvalReceipt=value
    },async current=>{await login(current,account);if(client.__approvalReceipt){report.mutations.push({kind:'approve-client',scenario:name,...await receipt(client.__approvalReceipt,current,account,config)});delete client.__approvalReceipt}}, {registeredClient:config.registeredClient})
    const identity=await client.verifiedAccessIdentity({applicationGroupId:applicationProject,subject:account.subject,expectedApplicationGroupScopes:spec.applicationGroupScopes,expectedProtocolScopes:spec.protocolScopes})
    assert.deepEqual(sorted(issued.issuedScopes),sorted([...spec.applicationGroupScopes,...spec.protocolScopes]),'issued scope set differs from explicit grant')
    const register=session=>sessionCleanup.register({client,session,scenario:name,subject:account.subject,clientId:identity.clientId,reauthorize:async()=>{
      await client.renewMcpAuthorization([...spec.protocolScopes,...spec.applicationGroupScopes],current=>login(current,account))
      const renewed=await client.verifiedAccessIdentity({applicationGroupId:applicationProject,subject:account.subject,expectedApplicationGroupScopes:spec.applicationGroupScopes,expectedProtocolScopes:spec.protocolScopes})
      assert.equal(renewed.clientId,identity.clientId,'MCP cleanup must retain the original registered client')
      return renewed
    }})
    const initialized=await client.rpc(null,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'application-project-acceptance',version:'1'}},rpcId++,{onInitializedSession:register})
    assert.equal(initialized.status,200);assert(initialized.session&&initialized.message?.result&&!initialized.message.error,'real MCP session initialization failed')
    const notification=await client.rpc(initialized.session,'notifications/initialized',undefined,undefined)
    assert([200,202,204].includes(notification.status),'initialized notification rejected')
    const result={client,spec,account,identity,session:initialized.session,config,target,registerSession:register}
    report.sessions.push({scenario:name,subject:identity.subject,identity,clientId:issued.clientId,protocol:'2025-06-18',sessionSha256:createHash('sha256').update(initialized.session).digest('hex')})
    return result
  }
  async function rpc(s,method,params,options={}){const value=await s.client.rpc(s.session,method,params,rpcId++,{signal:AbortSignal.timeout(20000),...options});report.rpc.push({subject:s.account.subject,method,status:value.status,message:JSON.parse(safe(JSON.stringify(value.message??null)))});await persist();assert.equal(value.session,s.session,'same-session test unexpectedly changed MCP session');return value}
  function denied(value,config=fixture){assert(value.status!==500&&value.status!==404,'500/404 is not authorization denial');if([401,403].includes(value.status))return true;if(value.status!==200)return false;const error=value.message?.error;if(error)return ![-32700,-32600,-32601,-32602,-32603].includes(error.code)&&(config.denialErrors??[]).some(rule=>rule.code===error.code&&rule.message===error.message);const result=value.message?.result;return result?.isError===true&&(typeof result.structuredContent?.code==='string'&&(config.denialToolCodes??[]).includes(result.structuredContent.code)||(config.denialToolResults??[]).some(expected=>jsonEqual(result,expected)))}
  async function tools(s,expected=s.spec.expectedTools){
    const names=[];let cursor;const seen=new Set()
    do{const result=await rpc(s,'tools/list',cursor?{cursor}:{});assert.equal(result.status,200);assert(!result.message?.error&&Array.isArray(result.message?.result?.tools),'actual tools/list result missing');for(const tool of result.message.result.tools){assert(tool.name&&!names.includes(tool.name),'duplicate tool');names.push(tool.name)}cursor=result.message.result.nextCursor;if(cursor){assert(!seen.has(cursor),'tool cursor cycle');seen.add(cursor)}}while(cursor)
    assert.deepEqual(sorted(names),sorted(expected),'actual complete tool list differs from fixture');return names
  }
  async function denyList(s){const result=await rpc(s,'tools/list',{});assert(denied(result,s.config)||result.status===200&&!result.message?.error&&Array.isArray(result.message?.result?.tools)&&result.message.result.tools.length===0,'revoked/unbound identity still lists tools');return {status:result.status,empty:result.message?.result?.tools?.length===0,error:!!result.message?.error}}
  function hiddenToolDenied(s,result){return !s.identity.protocolScopes.includes('mcp:flows:read')&&s.spec.expectedTools.length===0&&result.status===200&&jsonEqual(result.message?.error,{code:-32602,message:'Unknown tool: invalid_tool_name',data:'Tool not found: '+s.spec.call.name})}
  function missingProviderFailure(session,result){const proof=session.config.componentAbsence;return proof?.jarAbsent===true&&proof.featureEnabled===true&&Array.isArray(proof.mounts)&&proof.mounts.every(mount=>mount.destination!=='/app/libs'&&!mount.destination.startsWith('/app/libs/'))&&/^[a-f0-9]{64}$/.test(proof.hostExecutableSha256??'')&&result.status===200&&result.message?.result?.isError===true&&session.config.componentFailureToolResult?.isError===true&&jsonEqual(result.message?.result,session.config.componentFailureToolResult)}
  async function denyCall(s,observerEffects=effects,componentMissing=false){assert(s.spec.call?.name&&s.spec.call.arguments,'exact real tool name and arguments required');const value=await observerEffects.observeDenied(()=>rpc(s,'tools/call',{name:s.spec.call.name,arguments:s.spec.call.arguments}),result=>assert(denied(result,s.config)||hiddenToolDenied(s,result)||componentMissing&&missingProviderFailure(s,result),'tool write was not explicitly denied or proven to fail closed without the provider'),{windowMs:s.config.effectsWindowMs??5000,intervalMs:250});return {status:value.response.status,rpcError:!!value.response.message?.error,toolError:value.response.message?.result?.isError===true,hiddenByProtocolCapability:hiddenToolDenied(s,value.response),missingProviderFailure:componentMissing&&missingProviderFailure(s,value.response),sideEffects:value.observation}}
  async function observedCall(s,{minimumDurationMs=0,onPaused=async()=>{},evidence={}}={}) {
    await login(observer,fixture.observerAccount)
    const call=s.spec.call,controller=new AbortController()
    // One deadline covers the original POST, body consumption and all observations.
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(90000)])
    const path='/api/v1/main/executions'
    const listing=async()=>{
      const response=await observer.request(path+'?'+new URLSearchParams({namespace:call.namespace,flowId:call.flowId,size:'1000'}),{signal})
      assert.equal(response.status,200,'execution observer list rejected')
      const value=await response.json()
      assert(Array.isArray(value.results)&&Number.isInteger(value.total)&&value.total===value.results.length,'complete dedicated-flow execution list required')
      assert(value.results.every(row=>row.namespace===call.namespace&&row.flowId===call.flowId),'execution observer returned another flow')
      return value.results
    }
    try {
      return await observeMcpExecution({signal,evidence,minimumDurationMs,
        listExecutions:listing,
        readExecution:async id=>{
          const response=await observer.request(path+'/'+encodeURIComponent(id),{signal})
          assert.equal(response.status,200,'execution observer detail rejected')
          const stored=await response.json()
          assert.equal(stored.id,id);assert.equal(stored.namespace,call.namespace);assert.equal(stored.flowId,call.flowId)
          assert.equal(stored.inputs?.marker,call.arguments.marker,'observed execution has another marker')
          return stored
        },
        invoke:()=>rpc(s,'tools/call',{name:call.name,arguments:call.arguments},{signal}),
        onPaused,record:async()=>{report.inflightObservation=evidence;await persist()}})
    } finally {
      controller.abort()
    }
  }
  async function execute(s){await login(observer,fixture.observerAccount);const call=s.spec.call;assert(call?.name&&call.namespace&&call.flowId&&call.executionIdPath&&call.expectedExecutionFields,'complete tool/execution expectations required');const observed=await observedCall(s,{minimumDurationMs:60000});const value=observed.response;assert.equal(value.status,200);assert(value.message?.result&&!value.message.error&&value.message.result.isError!==true,'allowed tool execution failed');const id=get(value.message,call.executionIdPath);assert(typeof id==='string'&&id,'published execution ID missing from actual tool result');assert.equal(id,observed.execution.id,'MCP output ID differs from independently observed execution');const deadline=Date.now()+(fixture.executionTimeoutMs??60000);let stored;do{const response=await observer.request('/api/v1/main/executions/'+encodeURIComponent(id));assert.equal(response.status,200);stored=await response.json();assert.equal(stored.namespace,call.namespace);assert.equal(stored.flowId,call.flowId);if(stored.state?.current==='SUCCESS')break;assert(!['FAILED','KILLED','CANCELLED'].includes(stored.state?.current),'execution failed');await sleep(250)}while(Date.now()<deadline);assert.equal(stored.state?.current,'SUCCESS');for(const [path,expected]of Object.entries(call.expectedExecutionFields))assert(jsonEqual(get(stored,path),expected),'persisted execution field mismatch: '+path);assert(call.expectedOutputs&&Object.keys(call.expectedOutputs).length,'explicit persisted output expectations required');const outputResponse=await observer.request('/'+'api/v1/main/outputs/executions/'+encodeURIComponent(id));assert.equal(outputResponse.status,200);const outputs=await outputResponse.json();for(const [path,expected]of Object.entries(call.expectedOutputs))assert(jsonEqual(get(outputs,path),expected),'persisted flow output mismatch: '+path);assert.equal(outputs.executionId,id);assert(jsonEqual(value.message.result.structuredContent,outputs),'MCP output differs from persisted output API');assert.equal(typeof fixture.databaseExecution,'function','read-only DB observer required');const db=await fixture.databaseExecution({id,namespace:call.namespace,flowId:call.flowId});assert.equal(db.id,id);assert.equal(db.namespace,stored.namespace);assert.equal(db.flowId,stored.flowId);assert.equal(db.state,'SUCCESS');assert.equal(db.outputsStored,true,'execution output storage record missing');return {id,namespace:stored.namespace,flowId:stored.flowId,state:stored.state.current,dbVerified:true,persistedOutputs:outputs,longWait:observed.evidence}}
  async function inflightOutputRevoke() {
    const s=await session('localRevoke'),evidence={scenario:'localRevoke',sameSession:true}
    let restoration
    await tools(s)
    try {
      const observed=await observedCall(s,{evidence,onPaused:async()=>{
        const kind='revoke-application-scope-policy'
        const value=await fixture.management({kind,phase:'mutate',client:s.client,account:s.account,scope:s.spec.applicationGroupScopes[0],subject:s.account.subject})
        assert.equal(typeof value.restore,'function','inflight revoke requires formal restoration')
        restoration={label:'inflight-'+kind,restore:value.restore,client:s.client,account:s.account,config:fixture}
        restorations.push(restoration)
        evidence.revokedAt=new Date().toISOString()
        evidence.mutation=await receipt(value,s.client,s.account)
        report.mutations.push({kind,scenario:'inflight-output',...evidence.mutation})
        await persist()
      }})
      assert(restoration,'revocation must occur while the original call is waiting')
      assert(denied(observed.response,s.config),'original pending call did not return a published authorization denial')
      const payload=JSON.stringify(observed.response.message??null)
      assert(!payload.includes(s.spec.call.arguments.marker)&&!payload.includes(observed.execution.id),'revoked MCP response exposed execution output')
      const db=await fixture.databaseExecution({id:observed.execution.id,namespace:s.spec.call.namespace,flowId:s.spec.call.flowId})
      assert.equal(db.id,observed.execution.id);assert.equal(db.state,'SUCCESS');assert.equal(db.outputsStored,true)
      evidence.outputDenied=true;evidence.dbVerified=true
      evidence.response={status:observed.response.status,message:observed.response.message}
      evidence.reconnect={attemptedAt:new Date().toISOString(),sameClient:true,originalCredentials:true}
      const initialized=await s.client.rpc(null,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'inflight-reconnect',version:'1'}},rpcId++,{
        signal:AbortSignal.timeout(20000),
        onInitializedSession:session=>{
          s.registerSession(session)
          evidence.reconnect.sessionSha256=createHash('sha256').update(session).digest('hex')
        }})
      evidence.reconnect.initializeStatus=initialized.status
      await persist()
      assert([200,401,403].includes(initialized.status),'reinitialize failed without explicit authorization denial')
      if(initialized.status===200) {
        assert(initialized.session&&initialized.message?.result&&!initialized.message.error,'reinitialize returned invalid session')
        assert.notEqual(initialized.session,s.session,'reinitialize unexpectedly reused the original session')
        const next={...s,session:initialized.session}
        const notified=await s.client.rpc(next.session,'notifications/initialized',undefined,undefined,{signal:AbortSignal.timeout(20000)})
        assert([200,202,204].includes(notified.status),'reinitialized session notification rejected')
        evidence.reconnect.list=await denyList(next)
        evidence.reconnect.call=await denyCall(next)
      }
      evidence.reconnect.authorizationDenied=true
      return evidence
    } catch(error) {
      evidence.originalFailure=safe(error)
      error.evidence=evidence;throw error
    } finally {
      // Restore this scope before the original localRevoke/refresh cases run.
      if(restoration) {
        try {
          const restored=await restoration.restore()
          evidence.restoration=await receipt(restored,s.client,s.account)
          report.mutations.push({kind:'restore',label:restoration.label,...evidence.restoration})
          restorations.splice(restorations.indexOf(restoration),1)
        } catch(error) {error.evidence=evidence;throw error}
        finally {await persist()}
      }
    }
  }
  async function revoke(name,kind){const s=await session(name);await tools(s);assert(s.spec.expectedTools.includes(s.spec.call.name),'revoke fixture tool must be visible before mutation');const value=await fixture.management({kind,phase:'mutate',client:s.client,account:s.account,scope:s.spec.applicationGroupScopes[0],subject:s.account.subject});assert.equal(typeof value.restore,'function','revocation must provide formal restoration callback');restorations.push({label:kind,restore:value.restore,client:s.client,account:s.account,config:fixture});const mutation=await receipt(value,s.client,s.account);report.mutations.push({kind,...mutation});const start=Date.now();const listed=await denyList(s);const called=await denyCall(s);assert(Date.now()-start<=(fixture.revokeWindowMs??60000),'revocation exceeded declared window');revoked.push({...s,revocationKind:kind});return {identity:s.identity,mutation,sameSession:true,list:listed,call:called,elapsedMs:Date.now()-start}}
  try{
    assert(Array.isArray(fixture.denialErrors)&&Array.isArray(fixture.denialToolCodes),'published exact authorization error classification required');assert(typeof fixture.expectedUiAudience==='string'&&fixture.expectedUiAudience,'actual UI client audience required');assert((fixture.executionTimeoutMs??60000)<=60000&&(fixture.revokeWindowMs??60000)<=60000)
    effects=fixture.effects instanceof ProjectSideEffects?fixture.effects:new ProjectSideEffects(fixture.effects)
    observer=new ProductionOAuthClient(base);await login(observer,fixture.observerAccount)
    await check('mcp-production-dcr-owner-pkce-consent',async()=>{issuance=await session('allowed');return {identity:issuance.identity,realDcr:true,ownerLogin:true,pkce:'S256',explicitConsent:true,protocol:'2025-06-18'}})
    await check('mcp-tools-list-call',async()=>{assert(issuance,'DCR session unavailable');return {tools:await tools(issuance),execution:await execute(issuance)}})
    await check('mcp-inflight-output-revoke',inflightOutputRevoke)
    assert(!restorations.some(value=>value.label.startsWith('inflight-')),'inflight policy restoration failed; do not run subsequent revoke cases against a disabled scope')
    await check('mcp-capability-without-application-scope',async()=>{const s=await session('capabilityOnly');assert.equal(s.identity.applicationGroupScopes.length,0);assert(s.identity.protocolScopes.includes('mcp:flows:read')&&s.identity.protocolScopes.includes('mcp:executions:write'));return {identity:s.identity,list:await denyList(s),call:await denyCall(s)}})
    await check('mcp-application-scope-without-capability',async()=>{const s=await session('projectOnly');assert(s.identity.applicationGroupScopes.length&&!s.identity.protocolScopes.includes('mcp:executions:write')&&!s.identity.protocolScopes.includes('mcp:flows:read'));return {identity:s.identity,list:await denyList(s),call:await denyCall(s)}})
    let unbound
    await check('mcp-known-plus-unbound-list',async()=>{unbound=await session('knownUnbound');assert(unbound.identity.applicationGroupScopes.includes(scopeNames.unbound)&&unbound.identity.applicationGroupScopes.some(scope=>scope!==scopeNames.unbound));return {identity:unbound.identity,list:await denyList(unbound)}})
    await check('mcp-known-plus-unbound-call',async()=>{assert(unbound,'unbound session unavailable');return {identity:unbound.identity,call:await denyCall(unbound)}})
    await check('mcp-same-session-application-policy-revoke',()=>revoke('localRevoke','revoke-application-scope-policy'))
    await check('mcp-same-session-supported-scope-revoke',()=>revoke('directoryRevoke','revoke-supported-scope'))
    await check('mcp-user-scope-revoke',()=>revoke('subjectRevoke','revoke-subject-scopes'))
    await check('refresh-cannot-restore-revoked-scope',async()=>{assert.equal(revoked.length,3,'all three revocation modes must reach refresh checks');const results=[];for(const s of revoked){const status=await s.client.refresh();assert(status<500&&status!==404,'refresh infrastructure failure is not revocation');if(status===200){const actual=await s.client.verifiedAccessIdentity({applicationGroupId:applicationProject,subject:s.account.subject});if(s.revocationKind==='revoke-application-scope-policy'){assert.deepEqual(sorted(actual.applicationGroupScopes),sorted(s.spec.applicationGroupScopes),'local grants change must not rewrite identity assignments')}else assert(!actual.applicationGroupScopes.some(scope=>s.spec.applicationGroupScopes.includes(scope)),'refresh restored a revoked identity project scope')}else assert([400,401,403].includes(status),'unexpected refresh status');results.push({subject:s.account.subject,status,list:await denyList(s),call:await denyCall(s)})}return {results}})
    await check('mcp-missing-extension',async()=>{
      const config=fixture.missingExtension
      assert(config?.base&&config.base!==base,'separate isolated missing-jar deployment required')
      assert(config.componentAbsence?.jarAbsent===true&&config.componentAbsence.featureEnabled===true,'actual enabled runtime and absent jar evidence required')
      assert(config.issuedClient&&config.authorizationDenied?.error==='invalid_scope'&&config.authorizationDenied.codeIssued===false,'missing provider must reject new ordinary client credentials')
      const client=config.issuedClient
      const identity=await client.verifiedAccessIdentity({applicationGroupId:applicationProject,subject:config.account.subject,
        expectedApplicationGroupScopes:config.issuedIdentity.applicationGroupScopes,expectedProtocolScopes:config.scenario.protocolScopes})
      assert(identity.applicationGroupScopes.length>0,'pre-removal credential must contain a real previously allowed group scope')
      const oldList=await client.rpc(config.previousSession,'tools/list',{},rpcId++)
      assert(denied(oldList,config),'missing provider accepted the old authenticated MCP session')
      assert([400,401,403].includes(await client.refresh()),'missing provider refreshed old group credentials')
      const initialized=await client.rpc(null,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'missing-extension',version:'1'}},rpcId++,{onInitializedSession:session=>sessionCleanup.register({client,session,scenario:'missing-extension',subject:config.account.subject})})
      assert([200,401,403].includes(initialized.status),'missing component returned an unexpected initialize status')
      if(initialized.status===200)assert(initialized.session&&initialized.message?.result&&!initialized.message.error,'missing component returned invalid MCP session')
      const sessionId=initialized.status===200?initialized.session:null
      const listing=await client.rpc(sessionId,'tools/list',{},rpcId++)
      assert(denied(listing,config)||listing.status===200&&!listing.message?.error&&Array.isArray(listing.message?.result?.tools)&&listing.message.result.tools.length===0,'missing component exposed tools')
      const otherEffects=config.effects instanceof ProjectSideEffects?config.effects:new ProjectSideEffects(config.effects)
      const call=await otherEffects.observeDenied(()=>client.rpc(sessionId,'tools/call',
        {name:config.scenario.call.name,arguments:config.scenario.call.arguments},rpcId++),
        response=>assert(denied(response,config)||response.status===200&&response.message?.result?.isError===true&&jsonEqual(response.message.result,config.componentFailureToolResult),
          'missing component executed a protected tool'),{windowMs:config.effectsWindowMs??5000,intervalMs:250})
      const termination=await client.terminateMcpSession(config.previousSession)
      assert.equal(termination.status,401,'Missing projection must not permit old-session DELETE authentication')
      report.unavailableSessionCleanup={scenario:'missing-extension-before-removal',sessionSha256:createHash('sha256').update(config.previousSession).digest('hex'),status:termination.status,protocolTerminated:false,disposition:'owned-isolated-database-teardown',reason:'published projection unavailable; original bearer fails closed'}
      return {identity,componentAbsence:config.componentAbsence,authorizationDenied:config.authorizationDenied,oldSessionRejected:true,initializeStatus:initialized.status,
        list:{status:listing.status,empty:listing.message?.result?.tools?.length===0},
        call:{status:call.response.status,sideEffects:call.observation}}
    })
  }catch(error){report.preconditionFailure=safe(error)}
  finally{
    const restore=async value=>{try{const restored=await value.restore();const verified=await receipt(restored,value.client,value.account,value.config);report.mutations.push({kind:'restore',label:value.label,...verified})}catch(error){report.checks.push({id:'cleanup-'+value.label,passed:false,status:'failed',error:safe(error),evidence:{}})}}
    const reverse=[...restorations].reverse()
    // All denial/effect assertions have finished. Restore revoked policy before
    // using each original client; remove its registered application only afterwards.
    for(const value of reverse.filter(value=>!value.label.startsWith('approve-')))await restore(value)
    report.sessionCleanup=await sessionCleanup.closeAll()
    for(const row of report.sessionCleanup)if(!row.passed)report.checks.push({id:'session-cleanup-'+row.scenario,passed:false,status:'failed',evidence:row})
    if(report.sessionCleanup.length&&report.sessionCleanup.every(row=>row.passed)) {
      try {
        assert.equal(typeof fixture.observeSessionCleanup,'function','Owned session storage and heartbeat observer required')
        report.sessionCleanupObservation=await fixture.observeSessionCleanup(report.sessionCleanup)
      } catch(error) {
        report.checks.push({id:'session-cleanup-observation',passed:false,status:'failed',error:safe(error),evidence:{}})
      }
    }
    for(const value of reverse.filter(value=>value.label.startsWith('approve-')))await restore(value)
    report.requiredCheckCoverage=owned.filter(id=>requiredProjectChecks.includes(id));report.completed=!report.preconditionFailure&&report.checks.every(row=>row.passed);await persist()
  }
  return report
}

/** Observe an already-authorized submission independently of its MCP output.
 * Test doubles may exercise this state machine offline; production supplies real HTTP observers.
 */
export async function observeMcpExecution({listExecutions,readExecution,invoke,onPaused=async()=>{},record=async()=>{},signal,evidence={},minimumDurationMs=0,intervalMs=250}) {
  let outcome
  const update=async()=>record(evidence)
  try {
    signal.throwIfAborted()
    const before=await listExecutions(),beforeIds=new Set(before.map(row=>row.id))
    assert.equal(beforeIds.size,before.length,'duplicate pre-existing execution IDs')
    evidence.beforeExecutionIds=[...beforeIds];evidence.states=[]
    const started=Date.now();evidence.submittedAt=new Date(started).toISOString()
    // Install both handlers immediately so failure/cancellation cannot leak a rejection.
    void Promise.resolve().then(invoke).then(response=>{outcome={response,at:Date.now()}},error=>{outcome={error,at:Date.now()}})
    await update()
    let paused=false,execution
    for(;;) {
      signal.throwIfAborted()
      const created=(await listExecutions()).filter(row=>!beforeIds.has(row.id))
      assert(created.length<=1,'MCP call created more than one execution')
      if(created.length) {
        const current=await readExecution(created[0].id)
        if(execution)assert.equal(current.id,execution.id,'observed execution changed')
        execution=current;evidence.executionId=current.id
        const state=current.state?.current
        if(evidence.states.at(-1)?.state!==state){evidence.states.push({state,at:new Date().toISOString()});await update()}
        assert(!['FAILED','KILLED','CANCELLED','WARNING'].includes(state),'legitimate execution did not succeed: '+state)
        if(state==='PAUSED'&&!paused) {
          assert(!outcome,'MCP call completed before the PAUSED synchronization point')
          paused=true;evidence.pausedAt=new Date().toISOString();await update()
          await onPaused(current)
          await update()
        }
        if(state==='SUCCESS'&&outcome) {
          assert(paused,'execution completed without an observed PAUSED synchronization point')
          if(outcome.error)throw outcome.error
          evidence.terminalAt=evidence.states.find(row=>row.state==='SUCCESS').at
          evidence.responseAt=new Date(outcome.at).toISOString()
          evidence.totalDurationMs=outcome.at-started
          assert(minimumDurationMs===0||evidence.totalDurationMs>minimumDurationMs,'MCP response did not span the required long wait')
          const final=(await listExecutions()).filter(row=>!beforeIds.has(row.id))
          assert.equal(final.length,1,'expected exactly one legitimate submission')
          assert.equal(final[0].id,execution.id)
          evidence.newExecutionCount=final.length
          await update()
          return {response:outcome.response,execution,evidence}
        }
      }
      if(outcome?.error)throw outcome.error
      // Poll observed state. Elapsed time alone never establishes success.
      await new Promise((resolve,reject)=>{
        const abort=()=>{clearTimeout(timer);reject(signal.reason)}
        const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},intervalMs)
        signal.addEventListener('abort',abort,{once:true})
        if(signal.aborted){signal.removeEventListener('abort',abort);abort()}
      })
    }
  } catch(error) {
    evidence.failedAt=new Date().toISOString()
    evidence.failure=error.name??'Error'
    error.evidence=evidence
    await update()
    throw error
  }
}
