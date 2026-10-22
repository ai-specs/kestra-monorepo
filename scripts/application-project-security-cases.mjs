/** Real HTTP security checks for an explicitly isolated application-project deployment.
 * Call after provisionFixture, before MCP/UI mutations, with no concurrent writers:
 * runApplicationProjectSecurity(base,{planned,management,effects,observer,release},record).
 * observer={composeProject,postgresContainer,kestraContainer}; IDs are docker IDs.
 * secondaryIssuer={base,account} uses the driver's second issuer with the
 * published jar before that same deployment switches to missing-jar mode;
 * its production UI must issue group kestra / audience kestra-ui /
 * known writeB scope. This module supplies all cross-issuer business assertions.
 * release.pluginPublished must be true only after the caller verified/downloaded the
 * successful plugin CI artifact. Missing release evidence leaves every row not_run.
 * Only allowlisted temporary table renames for isolated fault injection; no row writes,
 * token fabrication, user .env edits, volume edits or deployment changes.
 * Missing runtime prerequisites remain explicit not_run, never inferred
 * from a different denial. record receives a complete partial fragment after each step.
 */
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createHash,randomBytes} from 'node:crypto'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {planRestResources} from './application-project-fixture.mjs'
import {applicationProject,scopeNames,namespaceDomains} from './application-project-cases.mjs'
import {mcpFlowSource,mcpProtocolEvidence} from './application-project-fixture.mjs'
import {applicationPermission} from './application-project-policy.mjs'
import {runApplicationProjectOauth,oauthCheckIds} from './application-project-oauth-cases.mjs'

export const securityCheckIds=Object.freeze([
  'legacy-write-api-removed',
  'last-application-group-administrator','last-application-policy-administrator',
  'application-policy-unregistered-group-denied','management-target-action-cross-scope-denied',
  'scope-metadata-independent-of-application-policy','rest-subject-revoke','wrong-tenant',
  'wrong-issuer','wrong-audience','wrong-application-group','directory-unavailable','policy-unavailable',
  ...oauthCheckIds,
])
const api='/api/v1/main/extensions/rbac'
const groupPath=api+'/application-groups/'+encodeURIComponent(applicationProject)
const runtimePath=groupPath+'/applications/~'+Buffer.from('kestra-ui').toString('base64url')+'/runtime-permissions'
const key=value=>'~'+Buffer.from(value).toString('base64url')
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex')
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
// Public grant/action/ID collections are sets; JSON array order is not semantic.
const semantic=value=>Array.isArray(value)?value.map(semantic).sort((a,b)=>String(JSON.stringify(a)).localeCompare(String(JSON.stringify(b)))):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([name,item])=>!(name==='namespace'&&item===null&&value.scope==='TENANT')).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,semantic(v)])):value
const same=(actual,expected,message)=>assert.deepEqual(semantic(actual),semantic(expected),message)
const scopeInput=(scopeKey,value)=>({scopeKey,...structuredClone(value)})
const directoryScopeInput=value=>Object.fromEntries(['key','name','description'].map(name=>[name,structuredClone(value[name])]))
class Unavailable extends Error {}

export async function runApplicationProjectSecurity(base,fixture={},record) {
  assert.equal(typeof record,'function','persistent fragment recorder required')
  const report={schemaVersion:1,completed:false,checks:securityCheckIds.map(id=>({id,passed:false,status:'not_run',evidence:{}})),requests:[],logins:[],cleanup:[],failures:0,notRun:securityCheckIds.length}
  const {planned,management,effects,observer,release}=fixture
  const passwords=[planned?.admin,...Object.values(planned?.accounts??{})].map(a=>a?.password).filter(Boolean)
  const safe=error=>passwords.reduce((s,p)=>s.replaceAll(p,'[redacted]'),String(error?.message??error)).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g,'[redacted-jwt]')
  const persist=async()=>{report.failures=report.checks.filter(row=>row.status==='failed').length+(report.preconditionFailure?1:0)+report.cleanup.filter(row=>!row.passed).length;report.notRun=report.checks.filter(row=>row.status==='not_run').length;await record(structuredClone(report))}
  await persist()
  let active
  async function step(name,evidence) {active.evidence.steps??=[];active.evidence.steps.push({name,at:new Date().toISOString(),...evidence});await persist()}
  async function check(id,run) {
    active=report.checks.find(row=>row.id===id)
    active.evidence.startedAt=new Date().toISOString();active.status='running';await persist()
    try {await run();active.passed=true;active.status='passed'}
    catch(error){active.status=error instanceof Unavailable?'not_run':'failed';active.evidence.error=safe(error);if(error.sideEffects)active.evidence.sideEffects=error.sideEffects}
    active.evidence.finishedAt=new Date().toISOString();await persist()
  }
  async function request(client,path,method='GET',body,revision,{contentType='application/json'}={}) {
    const started=performance.now()
    let response
    try{response=await client.request(path,{method,signal:AbortSignal.timeout(20_000),headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':contentType}),...(revision===undefined?{}:{'If-Match':'"'+revision+'"'})},...(body===undefined?{}:{body:contentType==='application/json'?JSON.stringify(body):body})})}
    catch(error){report.requests.push({check:active?.id,path,method,status:null,error:safe(error),elapsedMs:Math.ceil(performance.now()-started),at:new Date().toISOString()});await persist();throw error}
    report.requests.push({check:active?.id,path,method,status:response.status,elapsedMs:Math.ceil(performance.now()-started),at:new Date().toISOString()})
    // Never persist response bodies (accounts or provider error pages can contain secrets).
    const text=await response.text();let value
    try{value=text?JSON.parse(text):null}catch{value=null}
    await persist();return {status:response.status,ok:response.ok,value}
  }
  async function get(client,path) {const r=await request(client,path);assert.equal(r.status,200,'allowed GET baseline '+path);return r.value}
  async function login(account,label) {
    assert(account?.username&&account.password&&account.subject,'actual production account required')
    const client=new ProductionOAuthClient(base)
    const login=await client.login(account.username,account.password)
    const identity=await client.verifiedUiIdentity({applicationGroupId:applicationProject,subject:account.subject,audience:planned.expectedAudience})
    report.logins.push({check:active?.id,label,callbackPath:login.callbackPath,authenticated:login.authenticated,identity})
    await persist();return client
  }
  const manager=()=>login(planned.admin,'manager')
  const sql=query=>execFileSync('docker',['exec',observer.postgresContainer,'psql','-X','-U','kestra','-d','kestra','-v','ON_ERROR_STOP=1','-Atc',query],{encoding:'utf8',timeout:20_000,maxBuffer:1024*1024}).trim()
  function securitySnapshot() {
    // Published table layouts are read only. Session/token tables are deliberately
    // excluded: production login changes them; group state and policy must not.
    const state=sql(`SELECT json_build_object(
      'invalidation',(SELECT md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY group_id),'')) FROM rbac_application_group_invalidation t),
      'directory',(SELECT md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY group_id),'')) FROM rbac_application_group_state t),
      'directoryBootstrap',(SELECT md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY singleton_id),'')) FROM rbac_application_group_bootstrap t),
      'retiredGroups',(SELECT md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY group_id),'')) FROM rbac_application_group_retired t),
      'applicationDeclarations',(SELECT md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY application_group_id,client_id,scope_key),'')) FROM rbac_application_scope_declaration t),
      'accounts',(SELECT md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY username),'')) FROM (SELECT username,name,email,email_verified,user_state,password_change_required,roles,directory_revision,authentication_version FROM oidc_user) t),
      'authenticationMethods',(SELECT md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY id),'')) FROM (SELECT id,user_id,type,state,credential,name FROM oidc_user_auth_method) t),
      'policyHead',(SELECT md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY policy_id),'')) FROM rbac_application_group_policy_head t),
      'policySnapshots',(SELECT md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY revision),'')) FROM rbac_application_group_policy_snapshot t))::text`)
    const business=effects.snapshot()
    const sources={security:hash(state),business:business.hash,...business.sources}
    return {hash:hash(sources),sources}
  }
  async function deny(client,path,method,body,revision,{statuses=[403],code,invalidTenant=false,windowMs=fixture.effectsWindowMs??5000,contentType='application/json'}={}) {
    assert(windowMs>=5000&&windowMs<=60000,'bounded delayed-effect window required')
    const before=securitySnapshot(),started=performance.now()
    const evidence={expectedStatuses:statuses,expectedCode:code,before:before.hash,beforeSources:before.sources,windowMs,samples:[]}
    await step('before-denied-request',evidence)
    let result,requestFailure
    try{result=await request(client,path,method,body,revision,{contentType});evidence.status=result.status;evidence.code=result.value?.error??result.value?.code}
    catch(error){requestFailure=error;evidence.requestError=safe(error)}
    // Persist response failure AND all delayed hashes rather than throwing early.
    await step('denied-response',evidence)
    const observe=()=>{const current=securitySnapshot();evidence.samples.push({elapsedMs:Math.ceil(performance.now()-started),hash:current.hash,sources:current.sources})}
    observe()
    while(evidence.samples.at(-1).elapsedMs<windowMs){await delay(250);observe();await persist()}
    await step('denied-effects',evidence)
    if(requestFailure)throw requestFailure
    assert(statuses.includes(result.status),'unexpected denial HTTP '+result.status)
    if(result.status===400&&invalidTenant){assert(/tenant/i.test(JSON.stringify(result.value)),'400 must explicitly reject the tenant');evidence.tenantValidationRejected=true}
    if(code)assert.equal(evidence.code,code,'specific rejection reason required')
    assert(evidence.samples.every(sample=>sample.hash===before.hash),'denied operation changed identity, policy or business state')
    return evidence
  }
  async function quiesceBusiness(label) {
    const start=performance.now();let stableSince=start,last=effects.snapshot().hash
    const samples=[]
    do {
      await delay(250);const current=effects.snapshot().hash,now=performance.now()
      if(current!==last){stableSince=now;last=current}
      samples.push({elapsedMs:Math.ceil(now-start),hash:current})
      assert(now-start<=30000,'business persistence did not become quiescent before '+label)
    }while(performance.now()-stableSince<5000)
    await step('business-quiescent',{label,stableWindowMs:5000,hash:last,samples})
  }
  async function restore(name,run) {
    try{await run();report.cleanup.push({check:active.id,name,passed:true});await persist()}
    catch(error){report.cleanup.push({check:active.id,name,passed:false,error:safe(error)});await persist();throw error}
  }
  async function saveScope(client,name,definition) {
    const before=await get(client,runtimePath)
    assert.equal(before.applicationGroupId,applicationProject);assert.equal(before.clientId,'kestra-ui')
    const saved=await request(client,runtimePath+'/scopes/'+encodeURIComponent(name),'PUT',scopeInput(name,definition),before.revision)
    assert.equal(saved.status,200,'allowed scope save');assert.deepEqual(Object.keys(saved.value),['revision'])
    assert(saved.value.revision>before.revision)
    const after=await get(client,runtimePath)
    assert.equal(after.applicationGroupId,applicationProject);assert.equal(after.clientId,'kestra-ui');assert(after.revision>=saved.value.revision)
    same(after.policy.scopes[name],definition)
    for(const other of Object.keys(before.policy.scopes))if(other!==name)same(after.policy.scopes[other],before.policy.scopes[other])
    return saved.value
  }
  try {
    assert.equal(new URL(base).origin,base);assert.equal(planned?.base,base)
    if(!release?.pluginPublished)throw new Unavailable('No verified successful plugin CI artifact; runtime security checks not executed')
    assert(planned&&management&&effects?.snapshot&&observer,'planned, management, effects and explicit isolated observer required')
    assert.equal(management.base,base)
    assert(/^application-projects-bb-[0-9]+-[0-9]+$/.test(observer.composeProject),'isolated Compose project required')
    for(const id of [observer.postgresContainer,observer.kestraContainer]) {
      assert(/^[a-f0-9]{12,64}$/.test(id),'actual Docker container ID required')
      const label=execFileSync('docker',['inspect','-f','{{index .Config.Labels "com.docker.compose.project"}}',id],{encoding:'utf8',timeout:20000}).trim()
      assert.equal(label,observer.composeProject,'must not inspect user deployment')
    }
    const instance=new URL(base)
    assert(['127.0.0.1','localhost','[::1]'].includes(instance.hostname),'direct loopback isolated base required for destructive fault checks')
    const ports=JSON.parse(execFileSync('docker',['inspect','-f','{{json .NetworkSettings.Ports}}',observer.kestraContainer],{encoding:'utf8',timeout:20000}))
    assert(Object.values(ports).some(bindings=>(bindings??[]).some(binding=>binding.HostPort===(instance.port||'80'))),'base port must belong to the labelled isolated Kestra container')
    securitySnapshot()
  }catch(error){for(const row of report.checks)row.evidence.reason=safe(error);report.preconditionFailure=error instanceof Unavailable?null:safe(error);await persist();return report}

  await check('last-application-group-administrator',async()=>{
    let client=await manager()
    // Prove an actual identity-directory write is allowed, then restore its field.
    const baselinePath=groupPath+'/scopes/'+encodeURIComponent(scopeNames.readA)
    const baselineScope=await get(client,baselinePath)
    try {
      await management.mutateDirectory(baselinePath,'PUT',{...directoryScopeInput(baselineScope),description:baselineScope.description+' [identity allowed baseline]'},baselineScope.revision)
      const saved=await get(await manager(),baselinePath)
      assert.notEqual(saved.description,baselineScope.description)
      await step('allow-write-baseline',{scope:scopeNames.readA,savedDescription:true})
    }finally{await restore('identity-directory-baseline-description',async()=>{
      const current=await get(await manager(),baselinePath)
      await management.mutateDirectory(baselinePath,'PUT',directoryScopeInput(baselineScope),current.revision)
      assert.equal((await get(await manager(),baselinePath)).description,baselineScope.description)
    })}
    client=await manager()
    const builtin=await get(client,groupPath)
    assert.equal(builtin.builtIn,true,'installation group must have explicit persisted builtin identity')
    await deny(client,groupPath,'DELETE',undefined,builtin.revision,{statuses:[400],code:'invalid_request'})
    assert.equal((await get(await manager(),groupPath)).id,builtin.id,'builtin group deletion changed the catalog')
    const assignments=await get(client,groupPath+'/scope-grants?page=1&size=100')
    assert(assignments.items&&assignments.total===assignments.items.length,'complete assignment baseline required')
    const scopes=await get(client,groupPath+'/scopes?page=1&size=100')
    assert(scopes.items&&scopes.total===scopes.items.length,'complete scope baseline required')
    const actual=await get(client,runtimePath)
    const known=new Set(scopes.items.map(scope=>scope.key))
    const managers=new Set(Object.entries(actual.policy.scopes).filter(([name,scope])=>known.has(name)&&scope.enabled&&scope.managementGrants.some(grant=>grant.domain==='IDENTITY'&&grant.actions.includes('MANAGE'))).map(([name])=>name))
    const administrators=assignments.items.filter(a=>a.scopeKeys.some(s=>managers.has(s)))
    if(administrators.length!==1||administrators[0].subject!==planned.admin.subject)throw new Unavailable('Test requires sole assigned identity administrator; refusing to alter other accounts')
    const path=groupPath+'/scope-grants/detail?subject='+encodeURIComponent(planned.admin.subject)
    const original=await get(client,path)
    await step('allow-baseline',{subject:original.subject,administratorCount:1,applicationGroupScopes:original.scopeKeys})
    try{await deny(client,path,'PUT',{issuer:base,subject:original.subject,scopeKeys:original.scopeKeys.filter(s=>!managers.has(s))},original.revision,{statuses:[409],code:'last_administrator'})}
    finally{await restore('last-application-group-administrator-unchanged',async()=>{
      same(await get(await manager(),path),original)
      await step('restoration-verified',{unchanged:true,subject:original.subject})
    })}
  })

  await check('last-application-policy-administrator',async()=>{
    const client=await manager(),projection=await get(client,runtimePath)
    const managerScopes=Object.entries(projection.policy.scopes).filter(([,s])=>s.enabled&&s.managementGrants.some(g=>g.domain==='LOCAL_POLICY'&&g.actions.includes('MANAGE')&&(!(g.applicationGroupIds?.length)||g.applicationGroupIds.includes(applicationProject))))
    if(managerScopes.length!==1)throw new Unavailable('Exactly one local management binding required; no bulk administrator removal')
    const [name,original]=managerScopes[0]
    // A real, reversible allowed write proves write authentication, CSRF and CAS.
    try {
      await saveScope(client,name,{...original,description:original.description+' [security allowed baseline]'})
      await step('allow-baseline',{scope:name,savedDescription:true})
    }finally{await restore('local-manager-description',async()=>{await saveScope(await manager(),name,original)})}
    const fresh=await manager(),policy=await get(fresh,runtimePath)
    try{await deny(fresh,runtimePath+'/scopes/'+encodeURIComponent(name),'PUT',scopeInput(name,{...original,enabled:false}),policy.revision,{statuses:[409],code:'last_administrator'})}
    finally{await restore('last-local-administrator-unchanged',async()=>{
      same(await get(await manager(),runtimePath+'/scopes/'+encodeURIComponent(name)),original)
      await step('restoration-verified',{unchanged:true,scope:name})
    })}
  })

  await check('application-policy-unregistered-group-denied',async()=>{
    const id='security-unregistered-'+randomBytes(6).toString('hex'),path=api+'/application-groups/'+id
    let attempted=false
    const before=await get(await manager(),runtimePath)
    try {
      attempted=true
      const response=await request(await manager(),api+'/application-groups','POST',{id,tenant:'main',displayName:'Isolated group without current application'})
      assert.equal(response.status,200)
      const group=await get(await manager(),path)
      assert.equal(group.id,id);assert.equal(group.active,true)
      same(await get(await manager(),runtimePath),before,'group creation changed application policy storage')
      await step('allow-baseline',{groupCreateStatus:200,groupRead:true,applicationGroupId:id,policyRevision:before.revision})
      const target=path+'/applications/'+key('kestra-ui')+'/runtime-permissions'
      await deny(await manager(),target,'POST',{issuer:base,audiences:['kestra-ui'],enabled:true},before.revision,{statuses:[403,404]})
      same(await get(await manager(),runtimePath),before)
    } finally {
      if(attempted)await restore('delete-empty-unregistered-application-group',async()=>{
        const client=await manager(),existing=await request(client,path)
        if(existing.status===200) {
          const deletion=await request(client,path,'DELETE',undefined,existing.value.revision)
          assert.equal(deletion.status,200,'empty ordinary group deletion must be supported')
        }else assert([403,404].includes(existing.status),'unexpected cleanup group state')
        const groups=await get(await manager(),api+'/application-groups?page=1&size=100')
        assert.equal(groups.total,groups.items.length,'complete group cleanup list required')
        assert(!groups.items.some(group=>group.id===id),'ordinary group was not deleted')
        same(await get(await manager(),runtimePath),before)
        await step('restoration-verified',{applicationGroupId:id,deleted:true,policyUnchanged:true})
      })
    }
  })

  await check('scope-metadata-independent-of-application-policy',async()=>{
    const directoryPath=groupPath+'/scopes/'+encodeURIComponent(scopeNames.readA)
    const before=await get(await manager(),runtimePath)
    const original=await get(await manager(),directoryPath)
    const peer=await get(await manager(),groupPath+'/scopes/'+encodeURIComponent(scopeNames.writeB))
    const reader=planned.accounts.reader
    const allowed='/api/v1/main/flows/'+encodeURIComponent(namespaceDomains.a)+'/allowed-id'
    const outside='/api/v1/main/flows/'+encodeURIComponent(namespaceDomains.b)+'/other-id'
    const baseline=await login(reader,'metadata-before-change')
    assert.equal((await request(baseline,allowed)).status,200);assert.equal((await request(baseline,outside)).status,403)
    let attempted=false
    try {
      attempted=true
      await management.mutateDirectory(directoryPath,'PUT',{key:original.key,name:original.name+' metadata review',description:original.description+' [metadata only]'},original.revision)
      const changed=await get(await manager(),directoryPath)
      assert.equal(changed.key,original.key);assert.notEqual(changed.name,original.name);assert.notEqual(changed.description,original.description)
      same(await get(await manager(),runtimePath),before,'group metadata changed application policy or its revision')
      const fresh=await login(reader,'metadata-after-change')
      assert.equal((await request(fresh,allowed)).status,200);assert.equal((await request(fresh,outside)).status,403)
      const client=await manager()
      await deny(client,directoryPath,'PUT',{key:'renamed-scope',name:changed.name,description:changed.description},changed.revision,{statuses:[400]})
      await deny(client,directoryPath,'PUT',{key:changed.key,name:peer.name,description:changed.description},changed.revision,{statuses:[400],code:'invalid_request'})
      await deny(client,directoryPath,'DELETE',undefined,changed.revision,{statuses:[412]})
      same(await get(await manager(),directoryPath),changed)
      same(await get(await manager(),runtimePath),before)
      await step('metadata-independent-allow-deny',{scopeKey:changed.key,policyRevision:before.revision,roleNameChanged:true,descriptionChanged:true,resourceAllowed:200,resourceOutsideDenied:403,keyRenameRejected:true,duplicateNameRejected:true,referencedDeleteRejected:true})
    } finally {
      if(attempted)await restore('scope-metadata-restored-without-policy-save',async()=>{
        const current=await get(await manager(),directoryPath)
        await management.mutateDirectory(directoryPath,'PUT',directoryScopeInput(original),current.revision)
        const restored=await get(await manager(),directoryPath)
        same(directoryScopeInput(restored),directoryScopeInput(original))
        same(await get(await manager(),runtimePath),before)
        await step('restoration-verified',{scopeKey:original.key,policyRevisionUnchanged:true})
      })
    }
  })

  await check('rest-subject-revoke',async()=>{
    const account=planned.accounts.reader
    const path=groupPath+'/scope-grants/detail?subject='+encodeURIComponent(account.subject)
    const businessPath='/api/v1/main/flows/'+encodeURIComponent(namespaceDomains.a)+'/allowed-id'
    const oldClient=await login(account,'subject-before-revoke')
    assert.equal((await request(oldClient,businessPath)).status,200)
    const original=await get(await manager(),path)
    assert(original.scopeKeys.includes(scopeNames.readA))
    const bound=fixture.revokeWindowMs??60000
    assert(bound>0&&bound<=60000,'explicit bounded revocation contract required')
    let changed=false
    try {
      await management.login()
      const start=performance.now(),at=new Date().toISOString()
      changed=true // A transport failure may occur after the transaction committed.
      await management.request(path,'PUT',{issuer:base,subject:account.subject,scopeKeys:[]},original.revision)
      const mutationReturnedMs=Math.ceil(performance.now()-start)
      const samples=[];let denied=false
      while(performance.now()-start<bound) {
        const response=await request(oldClient,businessPath)
        samples.push({elapsedMs:Math.ceil(performance.now()-start),status:response.status})
        if([401,403].includes(response.status)){denied=true;break}
        assert.equal(response.status,200,'infrastructure failure cannot prove revocation');await delay(100)
      }
      await step('old-cookie-revocation',{subject:account.subject,revokedAt:at,mutationReturnedMs,boundMs:bound,samples})
      assert(denied&&samples.at(-1).elapsedMs<=bound,'revocation deadline exceeded')
      await management.reauthenticateGroup(applicationProject)
      await deny(oldClient,businessPath,'GET',undefined,undefined,{statuses:[401,403]})
      const fresh=await login(account,'subject-after-revoke')
      const identity=await fresh.verifiedUiIdentity({applicationGroupId:applicationProject,subject:account.subject,audience:planned.expectedAudience})
      same(identity.applicationGroupScopes,[])
      await deny(fresh,businessPath,'GET',undefined,undefined,{statuses:[403]})
      await step('fresh-identity-denied',{subject:account.subject,applicationGroupScopes:identity.applicationGroupScopes})
    }finally{
      if(changed)await restore('subject-project-scopes',async()=>{
        await management.reauthenticateGroup(applicationProject);const current=await management.request(path)
        await management.mutateDirectory(path,'PUT',{issuer:base,subject:account.subject,scopeKeys:original.scopeKeys},current.revision)
        const response=await request(await login(account,'subject-restored'),businessPath);assert.equal(response.status,200)
        same((await get(await manager(),path)).scopeKeys,original.scopeKeys)
        await step('restoration-verified',{allowedStatus:response.status,subject:account.subject})
      })
    }
  })

  await check('management-target-action-cross-scope-denied',async()=>{
    const suffix=randomBytes(5).toString('hex'),target='security-manage-b-'+suffix
    const readScope='security-'+suffix+'-read-own',manageScope='security-'+suffix+'-manage-other-write-a'
    const account={username:'security-split-'+suffix,subject:'security-split-'+suffix,password:randomBytes(24).toString('base64url')+'aA1!'}
    passwords.push(account.password)
    const original=await get(await manager(),runtimePath),originalScopes=structuredClone(original.policy.scopes)
    const groupMetadata=api+'/application-groups/'+target,uiPath=groupPath+'/applications/'+key('kestra-ui')
    const assignmentPath=groupPath+'/scope-grants/detail?subject='+encodeURIComponent(account.subject)
    const policyFor=(namespace,actions,managementActions,targets)=>({description:'Independent exact security scope '+namespace,enabled:true,
      grants:[{scope:'NAMESPACE',tenant:'main',namespace,descendants:false,resource:'FLOW',actions,ids:[],allIds:true}],
      managementGrants:[{domain:'LOCAL_POLICY',actions:managementActions,applicationGroupIds:targets}]})
    const definitions={[readScope]:policyFor(namespaceDomains.b,['READ','LIST'],['READ'],[applicationProject]),
      [manageScope]:policyFor(namespaceDomains.a,['READ','LIST','UPDATE'],['MANAGE'],[target])}
    const createdScopes=[],declarations=[],cleanupFailures=[]
    let targetAttempted=false,userAttempted=false,assignmentAttempted=false,uiOriginal,uiAttempted=false,businessOriginal,businessAttempted=false
    const readBusiness='/api/v1/main/flows/'+encodeURIComponent(namespaceDomains.b)+'/other-id'
    const writeBusiness='/api/v1/main/flows/'+encodeURIComponent(namespaceDomains.a)+'/allowed-id'
    const cleanupAttempt=async(name,run)=>{try{await restore(name,run)}catch(error){cleanupFailures.push(safe(error))}}
    try {
      targetAttempted=true
      const created=await request(await manager(),api+'/application-groups','POST',{id:target,tenant:'main',displayName:'Security management target without Kestra membership'})
      assert.equal(created.status,200);assert.equal(created.value.id,target)
      same(await get(await manager(),runtimePath),original,'group creation must not save any application policy')
      for(const name of [readScope,manageScope]) {
        const current=await get(await manager(),groupPath);createdScopes.push(name)
        await management.mutateDirectory(groupPath+'/scopes','POST',{key:name,name:'Security role '+name,description:'Declared scope metadata only'},current.revision)
        await management.saveRuntimeScope(applicationProject,name,definitions[name])
      }
      uiOriginal=await get(await manager(),uiPath);uiAttempted=true
      await management.mutateDirectory(uiPath,'PUT',{clientId:uiOriginal.clientId,approved:uiOriginal.approved,audiences:uiOriginal.audiences,
        supportedScopeKeys:[...new Set([...uiOriginal.supportedScopeKeys,readScope,manageScope])]},uiOriginal.revision)
      for(const name of [readScope,manageScope]) {
        declarations.push(name)
        const declared=await request(await manager(),groupPath+'/applications/'+key('kestra-ui')+'/scope-declarations/'+name,'POST',{permissions:[applicationPermission(name)]})
        assert.equal(declared.status,201)
      }
      userAttempted=true
      const user=await request(await manager(),api+'/users','POST',{username:account.username,name:'Security split scope test account',email:account.username+'@acceptance.invalid',password:account.password})
      assert.equal(user.status,201);assert.equal(user.value.subject,account.subject)
      const current=await get(await manager(),groupPath);assignmentAttempted=true
      await management.mutateDirectory(groupPath+'/scope-grants','POST',{issuer:base,subject:account.subject,scopeKeys:[readScope,manageScope]},current.revision)
      const actor=await login(account,'split-scope-real-issuance')
      const identity=await actor.verifiedUiIdentity({applicationGroupId:applicationProject,subject:account.subject,audience:planned.expectedAudience})
      same(identity.applicationGroupScopes,[readScope,manageScope])
      const readable=await get(actor,runtimePath)
      assert.equal(readable.applicationGroupId,applicationProject);assert.equal(readable.clientId,'kestra-ui')
      for(const name of [readScope,manageScope])same(readable.policy.scopes[name],definitions[name])
      const readOriginal=await get(actor,readBusiness+'?source=true');businessOriginal=await get(actor,writeBusiness+'?source=true')
      assert(/^description:.*$/m.test(readOriginal.source)&&/^description:.*$/m.test(businessOriginal.source),'real source descriptions required')
      const description='Security allowed A write '+suffix
      const edited=businessOriginal.source.replace(/^description:.*$/m,'description: '+description)
      assert.notEqual(edited,businessOriginal.source);businessAttempted=true
      assert.equal((await request(actor,writeBusiness,'PUT',edited,undefined,{contentType:'application/x-yaml'})).status,200)
      assert.equal((await get(actor,writeBusiness+'?source=true')).description,description)
      await quiesceBusiness('cross-scope-after-allowed-a-write')
      await step('allow-baseline',{identity,applicationGroupId:applicationProject,otherManagementTarget:target,applicationPolicyRead:200,businessAWrite:200,businessBRead:200,persistedDescription:description,
        managementGrants:{[readScope]:definitions[readScope].managementGrants,[manageScope]:definitions[manageScope].managementGrants}})
      async function listFlows(client,namespace) {
        const records=[],seen=new Set();let total
        for(let page=1;;page++) {
          const query=new URLSearchParams({page:String(page),size:'25',...(namespace?{'filters[namespace][EQUALS]':namespace}:{})})
          const value=await get(client,'/api/v1/main/flows/search?'+query)
          assert(Array.isArray(value.results)&&Number.isSafeInteger(value.total)&&value.total>=0)
          total??=value.total;assert.equal(value.total,total,'authorized flow total changed during pagination')
          for(const row of value.results) {
            assert(typeof row.namespace==='string'&&typeof row.id==='string')
            const identifier=row.namespace+'/'+row.id;assert(!seen.has(identifier),'duplicate authorized list row');seen.add(identifier)
            records.push({namespace:row.namespace,id:row.id})
          }
          if(records.length===total)return {records,total}
          assert(value.results.length&&records.length<total&&page<1000,'authorized list pagination stalled')
        }
      }
      const expectedA=await listFlows(await manager(),namespaceDomains.a),expectedB=await listFlows(await manager(),namespaceDomains.b)
      assert(expectedA.records.every(row=>row.namespace===namespaceDomains.a));assert(expectedB.records.every(row=>row.namespace===namespaceDomains.b))
      const actual=await listFlows(actor)
      assert(actual.records.every(row=>[namespaceDomains.a,namespaceDomains.b].includes(row.namespace)),'multi-role list leaked an outside or descendant namespace')
      same(actual.records,[...expectedA.records,...expectedB.records]);assert.equal(actual.total,expectedA.total+expectedB.total)
      assert(actual.records.some(row=>row.namespace===namespaceDomains.a&&row.id==='allowed-id'))
      assert(actual.records.some(row=>row.namespace===namespaceDomains.b&&row.id==='other-id'))
      const outsideSeed=planRestResources(planned).seeds.find(row=>row.namespace===namespaceDomains.outside)
      assert(outsideSeed,'real outside namespace sentinel required')
      const outsidePath='/api/v1/main/flows/'+encodeURIComponent(outsideSeed.namespace)+'/'+encodeURIComponent(outsideSeed.id)
      assert.equal((await get(await manager(),outsidePath)).id,outsideSeed.id)
      await deny(actor,outsidePath,'GET',undefined,undefined,{statuses:[403]})
      await step('multi-role-list-boundary',{total:actual.total,actual:actual.records,namespaceAWrite:200,namespaceBRead:200,outsideReadDenied:403})
      const before=await get(await manager(),runtimePath)
      await deny(actor,runtimePath+'/scopes/'+readScope,'PUT',scopeInput(readScope,{...definitions[readScope],description:'Denied A policy write '+suffix}),before.revision,{statuses:[403]})
      const deniedReadRangeWrite=readOriginal.source.replace(/^description:.*$/m,'description: Denied B business write '+suffix)
      await deny(actor,readBusiness,'PUT',deniedReadRangeWrite,undefined,{statuses:[403],contentType:'application/x-yaml'})
      const targetPolicy=groupMetadata+'/applications/'+key('kestra-ui')+'/runtime-permissions'
      await deny(actor,targetPolicy,'POST',{issuer:base,audiences:['kestra-ui'],enabled:false},before.revision,{statuses:[404]})
      same(await get(actor,runtimePath),readable,'cross-scope attempts changed the readable application policy')
      assert.equal((await get(actor,readBusiness+'?source=true')).source,readOriginal.source)
      assert.equal((await get(actor,writeBusiness+'?source=true')).description,description)
    } finally {
      if(businessAttempted&&businessOriginal)await cleanupAttempt('split-business-a-source',async()=>{
        assert.equal((await request(await manager(),writeBusiness,'PUT',businessOriginal.source,undefined,{contentType:'application/x-yaml'})).status,200)
        assert.equal((await get(await manager(),writeBusiness+'?source=true')).source,businessOriginal.source)
      })
      if(assignmentAttempted)await cleanupAttempt('split-user-scope-grant-removed',async()=>{
        const existing=await request(await manager(),assignmentPath)
        if(existing.status===200)await management.mutateDirectory(assignmentPath,'DELETE',undefined,existing.value.revision)
        else assert.equal(existing.status,404)
        assert.equal((await request(await manager(),assignmentPath)).status,404)
      })
      if(userAttempted)await cleanupAttempt('split-test-account-disabled',async()=>{
        const path=api+'/users/detail?subject='+encodeURIComponent(account.subject),existing=await request(await manager(),path)
        if(existing.status===404)return
        assert.equal(existing.status,200)
        assert.equal((await request(await manager(),api+'/users/state','PUT',{subject:account.subject,active:false},existing.value.revision)).status,200)
        assert.equal((await get(await manager(),path)).active,false)
      })
      for(const name of declarations)await cleanupAttempt('split-application-declaration-'+name,async()=>{
        const path=groupPath+'/applications/'+key('kestra-ui')+'/scope-declarations/'+name,existing=await request(await manager(),path)
        if(existing.status===200)assert.equal((await request(await manager(),path,'DELETE',undefined,existing.value.revision)).status,200)
        else assert.equal(existing.status,404)
      })
      if(uiAttempted&&uiOriginal)await cleanupAttempt('split-application-support-restored',async()=>{
        const current=await get(await manager(),uiPath)
        await management.mutateDirectory(uiPath,'PUT',{clientId:uiOriginal.clientId,approved:uiOriginal.approved,audiences:uiOriginal.audiences,supportedScopeKeys:uiOriginal.supportedScopeKeys},current.revision)
        same((await get(await manager(),uiPath)).supportedScopeKeys,uiOriginal.supportedScopeKeys)
      })
      for(const name of createdScopes)await cleanupAttempt('split-actual-policy-'+name,async()=>{
        const current=await get(await manager(),runtimePath)
        if(Object.hasOwn(current.policy.scopes,name)) {
          const saved=await request(await manager(),runtimePath+'/scopes/'+name,'DELETE',undefined,current.revision)
          assert.equal(saved.status,200);assert(saved.value.revision>current.revision)
        }
        assert(!Object.hasOwn((await get(await manager(),runtimePath)).policy.scopes,name))
      })
      for(const name of createdScopes)await cleanupAttempt('split-group-scope-'+name,async()=>{
        const path=groupPath+'/scopes/'+name,existing=await request(await manager(),path)
        if(existing.status===200)await management.mutateDirectory(path,'DELETE',undefined,existing.value.revision)
        else assert.equal(existing.status,404)
        assert.equal((await request(await manager(),path)).status,404)
      })
      if(targetAttempted)await cleanupAttempt('split-empty-management-target-deleted',async()=>{
        const current=await request(await manager(),groupMetadata)
        if(current.status===200)assert.equal((await request(await manager(),groupMetadata,'DELETE',undefined,current.value.revision)).status,200)
        else assert([403,404].includes(current.status))
        const groups=await get(await manager(),api+'/application-groups?page=1&size=100')
        assert.equal(groups.total,groups.items.length);assert(!groups.items.some(group=>group.id===target))
      })
      if(cleanupFailures.length)throw new Error('Cross-scope cleanup failed: '+cleanupFailures.join('; '))
      same((await get(await manager(),runtimePath)).policy.scopes,originalScopes)
      await step('restoration-verified',{originalScopeHash:hash(originalScopes),temporaryScopesRemoved:true,temporaryGroupDeleted:true,testAccountDisabled:userAttempted})
    }
  })

  await check('wrong-audience',async()=>{
    const account=planned.accounts.writer,client=await login(account,'audience-owner')
    const rest='/api/v1/main/flows/'+encodeURIComponent(namespaceDomains.b)+'/allowed-id'
    const baseline=await get(client,rest+'?source=true')
    assert.equal(baseline.namespace,namespaceDomains.b);assert.equal(baseline.id,'allowed-id');assert(baseline.source)
    let membershipPath,membershipClientId,approved=false,session,originalRequest=client.request.bind(client)
    const bearerHashes=[],cleanupFailures=[]
    const toolId='security-audience-'+randomBytes(5).toString('hex'),toolName='acceptance-'+toolId
    const toolPath='/api/v1/main/flows/'+encodeURIComponent(namespaceDomains.b)+'/'+toolId
    let toolCreated=false
    try {
      const observer=await manager()
      assert.equal((await request(observer,toolPath)).status,404)
      const created=await observer.request('/api/v1/main/flows',{method:'POST',headers:{'Content-Type':'application/x-yaml'},body:mcpFlowSource(namespaceDomains.b,toolId,toolName),signal:AbortSignal.timeout(20000)})
      assert([200,201].includes(created.status));toolCreated=true;await created.body?.cancel()
      assert.equal((await get(observer,toolPath+'?source=true')).id,toolId)
      const issued=await client.issueMcpScopes(['openid','mcp:flows:read',scopeNames.writeB],async registration=>{
        membershipPath=groupPath+'/applications/'+key(registration.clientId)
        membershipClientId=registration.clientId
        management.approvedClientIds.set(registration.clientId,[scopeNames.writeB]);approved=true
        await management.approveOrdinaryClient({clientId:registration.clientId,audiences:registration.audiences,applicationGroupScopes:[scopeNames.writeB],registeredProtocolScopes:['openid','mcp:flows:read','mcp:executions:write'],requestedProtocolScopes:['openid','mcp:flows:read']})
      },async current=>{await current.login(account.username,account.password)})
      const identity=await client.verifiedAccessIdentity({applicationGroupId:applicationProject,subject:account.subject,expectedApplicationGroupScopes:[scopeNames.writeB],expectedProtocolScopes:['openid','mcp:flows:read']})
      same(identity.audiences,[base+'/api/v1/main/mcp/default'])
      // Observe, never expose or replace, the real Authorization header emitted by rpc.
      client.request=async(path,options,includeSession)=>{
        if(options?.headers?.Authorization){assert.equal(includeSession,false);bearerHashes.push(hash(options.headers.Authorization))}
        return originalRequest(path,options,includeSession)
      }
      const initialized=await client.rpc(null,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'audience-security',version:'1'}},8101)
      assert.equal(initialized.status,200);assert(initialized.session&&initialized.message?.result&&!initialized.message.error);session=initialized.session
      assert([200,202,204].includes((await client.rpc(session,'notifications/initialized')).status))
      const listed=await client.rpc(session,'tools/list',{},8102)
      assert.equal(listed.status,200);assert(Array.isArray(listed.message?.result?.tools));assert(!listed.message.error)
      assert(listed.message.result.tools.some(tool=>tool.name===toolName),'real complete project scope must expose the seeded tool')
      await quiesceBusiness('wrong-audience-seeded-tool-visible')
      await step('allow-baseline',{identity,clientId:issued.clientId,restCookieRead:200,mcpInitialize:200,mcpToolsList:200,toolName,toolCount:listed.message.result.tools.length})
      async function redirected(method,body,id) {
        let actualStatus
        client.request=async(path,options,includeSession)=>{
          assert.equal(new URL(path,base).pathname,'/api/v1/main/mcp/default')
          assert.equal(includeSession,false);assert(options.headers.Authorization?.startsWith('Bearer '))
          bearerHashes.push(hash(options.headers.Authorization))
          const response=await originalRequest(rest,{...options,method,headers:{Authorization:options.headers.Authorization,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/x-yaml'})},body},false)
          actualStatus=response.status;return response
        }
        // rpc provides the actual Bearer header; the wrapper changes only the same-origin target.
        const before=securitySnapshot()
        let result
        try{result=await effects.observeDenied(()=>client.rpc(session,'tools/list',{},id),response=>assert([401,403].includes(response.status),'MCP audience accepted by REST'),{windowMs:fixture.effectsWindowMs??5000,intervalMs:250})}
        finally{const after=securitySnapshot();await step('real-bearer-security-state',{path:rest,method,before:before.hash,after:after.hash,beforeSources:before.sources,afterSources:after.sources});assert.equal(after.hash,before.hash,'wrong-audience request changed persistent state')}
        await step('real-bearer-rest-denied',{path:rest,method,status:actualStatus,sideEffects:result.observation})
      }
      await redirected('GET',undefined,8103)
      const source=baseline.source.replace(/^description:.*$/m,'description: wrong audience must never save')
      assert.notEqual(source,baseline.source,'explicit changed YAML field required')
      await redirected('PUT',source,8104)
      assert(bearerHashes.length>=5&&new Set(bearerHashes).size===1,'baseline and redirected requests must use the exact same issued token')
      await step('unchanged-real-token',{requestCount:bearerHashes.length,bearerSha256:bearerHashes[0],noCookieOnBearerRequests:true})
      client.request=originalRequest
      const recovered=await client.rpc(session,'tools/list',{},8105)
      assert.equal(recovered.status,200);assert(recovered.message?.result?.tools?.some(tool=>tool.name===toolName))
      assert.equal((await get(await login(account,'audience-rest-cookie-restored'),rest+'?source=true')).source,baseline.source)
      await step('restoration-verified',{mcpToolsList:200,restCookieRead:200,sourceUnchanged:true})
    }finally{
      client.request=originalRequest
      if(approved)await restore('remove-security-mcp-membership',async()=>{
        await management.removeOrdinaryClient(membershipClientId)
        assert.equal((await request(await manager(),membershipPath)).status,404)
      }).catch(error=>cleanupFailures.push(safe(error)))
      if(toolCreated)await restore('remove-security-audience-flow',async()=>{
        const response=await request(await manager(),toolPath,'DELETE');assert([200,204].includes(response.status))
        assert.equal((await request(await manager(),toolPath)).status,404);await quiesceBusiness('wrong-audience-flow-deleted')
      }).catch(error=>cleanupFailures.push(safe(error)))
      if(cleanupFailures.length)throw new Error('Wrong-audience restoration failed: '+cleanupFailures.join('; '))
    }
  })

  await check('wrong-issuer',async()=>{
    const secondary=fixture.secondaryIssuer
    if(!secondary?.base||!secondary.account)throw new Unavailable('Driver must provide the cached isolated missing-extension issuer as secondaryIssuer:{base,account}')
    assert.equal(new URL(secondary.base).origin,secondary.base);assert.notEqual(secondary.base,base)
    assert(['127.0.0.1','localhost','[::1]'].includes(new URL(secondary.base).hostname),'explicit loopback secondary issuer required')
    passwords.push(secondary.account.password)
    const foreign=new ProductionOAuthClient(secondary.base),originalRequest=foreign.request.bind(foreign)
    let jwtCookie,csrf
    foreign.request=async(path,options,includeSession)=>{
      const response=await originalRequest(path,options,includeSession)
      for(const cookie of response.headers.getSetCookie()) {
        const pair=cookie.split(';')[0]
        if(pair.startsWith('JWT=')&&pair.length>4)jwtCookie=pair
      }
      if(response.status===200&&response.headers.get('content-type')?.includes('text/html')) {
        const html=await response.clone().text()
        csrf=html.match(/name="csrf-token"[^>]*content="([^"]+)"/)?.[1]??html.match(/content="([^"]+)"[^>]*name="csrf-token"/)?.[1]??csrf
      }
      return response
    }
    try {
      const signedIn=await foreign.login(secondary.account.username,secondary.account.password)
      assert(signedIn.authenticated&&jwtCookie,'secondary issuer must sign in through production UI and emit JWT Cookie')
      const identity=await foreign.verifiedUiIdentity({applicationGroupId:applicationProject,subject:secondary.account.subject,audience:planned.expectedAudience})
      assert.equal(identity.issuer,secondary.base);assert(identity.applicationGroupScopes.includes(scopeNames.writeB))
      assert([planned.admin,...Object.values(planned.accounts)].some(account=>account.subject===identity.subject),'foreign cookie must use an existing main subject, not an unknown user')
      assert(identity.applicationGroupScopes.every(scope=>Object.hasOwn(planned.policy.applicationGroups[applicationProject].scopes,scope)),'all foreign project scopes must be known locally; unknown scope must not confound issuer rejection')
      same(identity.audiences,[planned.expectedAudience])
      const client=await login(planned.accounts.writer,'trusted-issuer-baseline')
      const path='/api/v1/main/flows/'+encodeURIComponent(namespaceDomains.b)+'/allowed-id'
      const original=await get(client,path+'?source=true');assert(original.source)
      const changed=original.source.replace(/^description:.*$/m,'description: wrong issuer must never save')
      assert.notEqual(changed,original.source)
      const allowedSource=original.source.replace(/^description:.*$/m,'description: trusted issuer actual write baseline')
      try{
        const allowed=await client.request(path,{method:'PUT',headers:{'Content-Type':'application/x-yaml'},body:allowedSource,signal:AbortSignal.timeout(20000)})
        assert.equal(allowed.status,200);await allowed.body?.cancel()
        assert.equal((await get(client,path+'?source=true')).description,'trusted issuer actual write baseline')
      }finally{await restore('trusted-issuer-baseline-source',async()=>{
        const restored=await client.request(path,{method:'PUT',headers:{'Content-Type':'application/x-yaml'},body:original.source,signal:AbortSignal.timeout(20000)})
        assert.equal(restored.status,200);await restored.body?.cancel();assert.equal((await get(client,path+'?source=true')).source,original.source)
      })}
      await quiesceBusiness('trusted-issuer-baseline-restored')
      await step('allow-baseline',{mainIssuer:base,readStatus:200,persistedChangedFieldWriteStatus:200,foreignIdentity:identity,foreignLogin:signedIn.authenticated,cookieSha256:hash(jwtCookie),rawCookieReplay:true})
      const replay=new ProductionOAuthClient(base)
      for(const [method,body]of [['GET',undefined],['PUT',changed]]) {
        const before=securitySnapshot();let denied
        try{denied=await effects.observeDenied(()=>replay.request(path,{method,headers:{Cookie:jwtCookie,Accept:'application/json',Origin:base,...(body===undefined?{}:{'Content-Type':'application/x-yaml',...(csrf?{'X-CSRF-TOKEN':csrf}:{})})},body,signal:AbortSignal.timeout(20000)},false),async response=>{
          assert([401,403].includes(response.status),'foreign signed issuer cookie was accepted');await response.body?.cancel()
        },{windowMs:fixture.effectsWindowMs??5000,intervalMs:250})}
        finally{const after=securitySnapshot();await step('foreign-cookie-security-state',{method,path,before:before.hash,after:after.hash,beforeSources:before.sources,afterSources:after.sources});assert.equal(after.hash,before.hash)}
        await step('foreign-cookie-denied',{method,path,status:denied.response.status,sideEffects:denied.observation,sameAudience:true,sameProject:true,sameKnownScope:scopeNames.writeB,cookieUnmodified:true})
      }
      assert.equal((await get(await login(planned.accounts.writer,'trusted-issuer-restored'),path+'?source=true')).source,original.source)
      await step('restoration-verified',{mainReadStatus:200,sourceUnchanged:true,secondaryDeploymentReused:true})
    }finally{foreign.request=originalRequest;jwtCookie=undefined;csrf=undefined}
  })

  await check('wrong-application-group',async()=>{
    const suffix=randomBytes(5).toString('hex'),id='security-business-group-'+suffix
    const account=planned.accounts.writer,groupApi=api+'/application-groups/'+id
    const flowId='security-group-token-'+suffix,toolName='security-group-token-'+suffix
    const flowPath='/api/v1/main/flows/'+encodeURIComponent(namespaceDomains.b)+'/'+flowId
    const owner=new ProductionOAuthClient(base),foreign=new ProductionOAuthClient(base)
    let groupCreated=false,mainMemberPath,mainClientId,foreignMemberPath,foreignClientId,mainApproved=false,foreignApproved=false,assigned=false,flowCreated=false
    const cleanupFailures=[]
    const cleanup=async(name,run)=>{try{await restore(name,run)}catch(error){cleanupFailures.push(safe(error))}}
    const protocolScopes=['openid','mcp:flows:read','mcp:executions:write']
    const directoryScope=planned.directoryScopes.find(scope=>scope.key===scopeNames.writeB)
    assert(directoryScope?.key&&directoryScope.name,'same-name group scope metadata required')
    const denied=result=>[401,403].includes(result.status)||result.status===200&&(
      result.message?.error?.code===mcpProtocolEvidence.rpcDenial.code&&result.message.error.message===mcpProtocolEvidence.rpcDenial.message
      ||result.message?.result?.isError===true&&JSON.stringify(semantic(result.message.result))===JSON.stringify(semantic(mcpProtocolEvidence.toolDenial)))
    async function initialize(client,requestId) {
      const result=await client.rpc(null,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'group-isolation-security',version:'1'}},requestId)
      assert.equal(result.status,200);assert(result.session&&result.message?.result&&!result.message.error)
      assert([200,202,204].includes((await client.rpc(result.session,'notifications/initialized')).status));return result.session
    }
    try {
      // A real main-group token and persisted tool execution establish the
      // complete resource/protocol allow baseline before testing another group.
      await owner.login(account.username,account.password)
      await owner.issueMcpScopes([...protocolScopes,scopeNames.writeB],async registration=>{
        mainMemberPath=groupPath+'/applications/'+key(registration.clientId)
        mainClientId=registration.clientId
        management.approvedClientIds.set(registration.clientId,[scopeNames.writeB]);mainApproved=true
        await management.approveOrdinaryClient({clientId:registration.clientId,audiences:registration.audiences,applicationGroupScopes:[scopeNames.writeB],registeredProtocolScopes:protocolScopes,requestedProtocolScopes:protocolScopes})
      },async client=>{await client.login(account.username,account.password)})
      const mainIdentity=await owner.verifiedAccessIdentity({applicationGroupId:applicationProject,subject:account.subject,expectedApplicationGroupScopes:[scopeNames.writeB],expectedProtocolScopes:protocolScopes})
      const managerClient=await manager()
      assert.equal((await request(managerClient,flowPath)).status,404,'dedicated security flow must be absent')
      const seeded=await managerClient.request('/api/v1/main/flows',{method:'POST',headers:{'Content-Type':'application/x-yaml'},body:mcpFlowSource(namespaceDomains.b,flowId,toolName),signal:AbortSignal.timeout(20000)})
      assert([200,201].includes(seeded.status));flowCreated=true;await seeded.body?.cancel()
      const stored=await get(managerClient,flowPath+'?source=true');assert.equal(stored.id,flowId);assert(stored.triggers.some(trigger=>trigger.toolName===toolName))
      const mainSession=await initialize(owner,8201)
      const list=await owner.rpc(mainSession,'tools/list',{},8202)
      assert.equal(list.status,200);assert(list.message?.result?.tools?.some(tool=>tool.name===toolName))
      const marker='group-boundary-'+suffix
      const called=await owner.rpc(mainSession,'tools/call',{name:toolName,arguments:{marker}},8203)
      await step('main-tool-call-response',{status:called.status,message:called.message})
      assert.equal(called.status,200);assert(!called.message?.error&&called.message?.result?.isError!==true)
      const executionId=called.message?.result?.structuredContent?.executionId
      assert(typeof executionId==='string'&&executionId)
      const started=performance.now();let execution
      do {
        execution=await get(managerClient,'/api/v1/main/executions/'+encodeURIComponent(executionId))
        assert.equal(execution.namespace,namespaceDomains.b);assert.equal(execution.flowId,flowId)
        if(execution.state?.current==='SUCCESS')break
        assert(!['FAILED','KILLED','CANCELLED'].includes(execution.state?.current));await delay(250)
      }while(performance.now()-started<60000)
      assert.equal(execution.state?.current,'SUCCESS');assert.equal(execution.inputs.marker,marker)
      assert(/^[A-Za-z0-9_-]+$/.test(executionId),'safe read-only execution lookup required')
      const databaseExecution=JSON.parse(sql(`SELECT json_build_object('id',value->>'id','namespace',value->>'namespace','flowId',value->>'flowId','marker',value->'inputs'->>'marker','state',value->'state'->>'current')::text FROM executions WHERE value->>'id'='${executionId}'`))
      same(databaseExecution,{id:executionId,namespace:namespaceDomains.b,flowId,marker,state:'SUCCESS'})
      await quiesceBusiness('wrong-project-allowed-execution')
      const policyBefore=await get(await manager(),runtimePath)
      const created=await request(await manager(),api+'/application-groups','POST',{id,tenant:'main',displayName:'Isolated same-name business scope group'})
      assert.equal(created.status,200);groupCreated=true
      let group=await get(await manager(),groupApi)
      const scope=await request(await manager(),groupApi+'/scopes','POST',{...structuredClone(directoryScope),description:'Same scope key and name in a distinct group; no copied runtime permissions'},group.revision)
      assert.equal(scope.status,200);assert.equal(scope.value.key,scopeNames.writeB)
      group=await get(await manager(),groupApi)
      assigned=true
      const assignment=await request(await manager(),groupApi+'/scope-grants','POST',{issuer:base,subject:account.subject,scopeKeys:[scopeNames.writeB]},group.revision)
      assert.equal(assignment.status,200)
      await foreign.login(account.username,account.password)
      const issued=await foreign.issueMcpScopes([...protocolScopes,scopeNames.writeB],async registration=>{
        foreignMemberPath=groupApi+'/applications/'+key(registration.clientId)
        foreignClientId=registration.clientId
        const current=await get(await manager(),groupApi)
        foreignApproved=true
        const approved=await request(await manager(),groupApi+'/applications','POST',{clientId:registration.clientId,approved:true,audiences:registration.audiences,supportedScopeKeys:[scopeNames.writeB]},current.revision)
        assert.equal(approved.status,200)
        const declaration=await request(await manager(),api+'/application-groups/'+id+'/applications/'+key(registration.clientId)+'/scope-declarations/'+scopeNames.writeB,
          'POST',{permissions:[applicationPermission(scopeNames.writeB)]})
        assert.equal(declaration.status,201)
      },async client=>{await client.login(account.username,account.password)})
      const identity=await foreign.verifiedAccessIdentity({applicationGroupId:id,subject:account.subject,expectedApplicationGroupScopes:[scopeNames.writeB],expectedProtocolScopes:protocolScopes})
      assert.notEqual(identity.applicationGroupId,mainIdentity.applicationGroupId);assert.notEqual(identity.clientId,mainIdentity.clientId)
      assert.equal(identity.issuer,mainIdentity.issuer);same(identity.audiences,mainIdentity.audiences);same(identity.applicationGroupScopes,mainIdentity.applicationGroupScopes);same(identity.protocolScopes,mainIdentity.protocolScopes)
      same(await get(await manager(),runtimePath),policyBefore,'foreign group metadata changed runtime policy storage')
      const members=await get(await manager(),groupApi+'/applications?page=1&size=100')
      assert.equal(members.total,members.items.length);assert(!members.items.some(member=>member.clientId==='kestra-ui'))
      await step('allow-baseline',{mainIdentity,foreignIdentity:identity,sameNameScope:scopeNames.writeB,foreignClientId:issued.clientId,mainToolsList:200,mainToolCall:200,executionId,executionState:'SUCCESS',databaseVerified:true,persistedMarker:marker,policyRevisionUnchanged:true,currentApplicationJoinedForeignGroup:false})
      const foreignSession=await initialize(foreign,8211)
      const beforeList=securitySnapshot();let listRefusal
      try{listRefusal=await effects.observeDenied(()=>foreign.rpc(foreignSession,'tools/list',{},8212),result=>assert(denied(result)||result.status===200&&!result.message?.error&&Array.isArray(result.message?.result?.tools)&&result.message.result.tools.length===0,'foreign group borrowed main group tool visibility'),{windowMs:fixture.effectsWindowMs??5000,intervalMs:250})}
      finally{const afterList=securitySnapshot();await step('foreign-group-list-state',{before:beforeList.hash,after:afterList.hash,beforeSources:beforeList.sources,afterSources:afterList.sources});assert.equal(afterList.hash,beforeList.hash)}
      const foreignList=listRefusal.response
      await step('foreign-group-list-denied',{status:foreignList.status,emptyList:foreignList.message?.result?.tools?.length===0,sideEffects:listRefusal.observation,error:foreignList.message?.error?{code:foreignList.message.error.code,message:foreignList.message.error.message}:undefined})
      const before=securitySnapshot();let refusal
      try{refusal=await effects.observeDenied(()=>foreign.rpc(foreignSession,'tools/call',{name:toolName,arguments:{marker:'must-not-execute-'+suffix}},8213),async result=>{await step('foreign-group-call-response',{status:result.status,message:result.message});assert(denied(result),'foreign group borrowed main group write grant')},{windowMs:fixture.effectsWindowMs??5000,intervalMs:250})}
      finally{const after=securitySnapshot();await step('foreign-group-state',{before:before.hash,after:after.hash,beforeSources:before.sources,afterSources:after.sources});assert.equal(after.hash,before.hash)}
      await step('foreign-group-call-denied',{status:refusal.response.status,sideEffects:refusal.observation})
      const recovered=await owner.rpc(mainSession,'tools/list',{},8220)
      assert.equal(recovered.status,200);assert(recovered.message?.result?.tools?.some(tool=>tool.name===toolName))
      same(await get(await manager(),runtimePath),policyBefore)
      await step('main-group-still-allowed',{status:200,toolName})
    }finally{
      if(groupCreated&&assigned)await cleanup('wrong-group-assignment-removed',async()=>{
        const path=groupApi+'/scope-grants/detail?subject='+encodeURIComponent(account.subject),existing=await request(await manager(),path)
        if(existing.status===200)assert.equal((await request(await manager(),path,'DELETE',undefined,existing.value.revision)).status,200)
        else assert.equal(existing.status,404)
      })
      if(foreignApproved)await cleanup('wrong-group-member-removed',async()=>{
        const declarationPath=api+'/application-groups/'+id+'/applications/'+key(foreignClientId)+'/scope-declarations/'+scopeNames.writeB
        const declaration=await request(await manager(),declarationPath)
        if(declaration.status===200)assert.equal((await request(await manager(),declarationPath,'DELETE',undefined,declaration.value.revision)).status,200)
        else assert.equal(declaration.status,404)
        const member=await request(await manager(),foreignMemberPath)
        if(member.status===200)assert.equal((await request(await manager(),foreignMemberPath,'DELETE',undefined,member.value.revision)).status,200)
        else assert.equal(member.status,404)
      })
      if(groupCreated)await cleanup('wrong-group-scope-and-empty-group-removed',async()=>{
        const path=groupApi+'/scopes/'+encodeURIComponent(scopeNames.writeB),scope=await request(await manager(),path)
        if(scope.status===200)assert.equal((await request(await manager(),path,'DELETE',undefined,scope.value.revision)).status,200)
        else assert.equal(scope.status,404)
        const current=await get(await manager(),groupApi)
        assert.equal((await request(await manager(),groupApi,'DELETE',undefined,current.revision)).status,200)
        const groups=await get(await manager(),api+'/application-groups?page=1&size=100')
        assert.equal(groups.total,groups.items.length);assert(!groups.items.some(group=>group.id===id))
      })
      if(flowCreated)await cleanup('wrong-group-security-flow-removed',async()=>{
        const response=await request(await manager(),flowPath,'DELETE');assert([200,204].includes(response.status))
        assert.equal((await request(await manager(),flowPath)).status,404);await quiesceBusiness('wrong-group-flow-deleted')
      })
      if(mainApproved)await cleanup('wrong-group-main-member-removed',async()=>{
        await management.removeOrdinaryClient(mainClientId)
        assert.equal((await request(await manager(),mainMemberPath)).status,404)
      })
      if(cleanupFailures.length)throw new Error('Wrong-group cleanup failed: '+cleanupFailures.join('; '))
      await step('restoration-verified',{applicationGroupId:id,foreignGroupDeleted:true,foreignAssignmentRemoved:true,foreignMembershipRemoved:true,mainMembershipRemoved:true,securityFlowRemoved:true})
    }
  })

  async function dependencyFault(id,table) {
    await check(id,async()=>{
      const client=await manager(),path='/api/v1/main/flows/'+encodeURIComponent(namespaceDomains.b)+'/allowed-id'
      const original=await get(client,path+'?source=true');assert(original.source)
      const source=description=>{
        const changed=original.source.replace(/^description:.*$/m,'description: '+description)
        assert.notEqual(changed,original.source,'allowed baseline must actually change a field');return changed
      }
      async function write(source,expected) {
        const response=await client.request(path,{method:'PUT',headers:{'Content-Type':'application/x-yaml',Accept:'application/json'},body:source,signal:AbortSignal.timeout(20000)})
        const status=response.status;await response.body?.cancel();assert.equal(status,200,'allowed business update failed')
        const stored=await get(client,path+'?source=true');if(expected)assert.equal(stored.description,expected)
        return status
      }
      try{await write(source('fault baseline '+id),'fault baseline '+id)}
      finally{await restore(id+'-baseline-flow-source',async()=>{await write(original.source);assert.equal((await get(client,path+'?source=true')).source,original.source)})}
      await quiesceBusiness(id+'-before-table-fault')
      const temporary='security_fault_'+table+'_'+randomBytes(5).toString('hex')
      assert(['rbac_application_group_state','rbac_application_group_policy_head'].includes(table),'allowlisted fault table required')
      assert(/^[a-z0-9_]+$/.test(temporary))
      function rename(from,to) {
        const label=execFileSync('docker',['inspect','-f','{{index .Config.Labels "com.docker.compose.project"}}',observer.postgresContainer],{encoding:'utf8',timeout:20000}).trim()
        assert.equal(label,observer.composeProject,'fault injection must not touch user database')
        assert([table,temporary].includes(from)&&[table,temporary].includes(to)&&from!==to)
        sql(`SET lock_timeout='5s'; SET statement_timeout='10s'; ALTER TABLE public.${from} RENAME TO ${to}`)
      }
      const before=securitySnapshot()
      const tableHash=name=>sql(`SELECT md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY row_to_json(t)::text),'')) FROM public.${name} t`)
      const beforeTableHash=tableHash(table)
      assert.equal(sql(`SELECT to_regclass('public.${temporary}') IS NULL`),'t','temporary fault table must not exist')
      let attempted=false
      try {
        attempted=true;rename(table,temporary)
        assert.equal(tableHash(temporary),beforeTableHash,'renaming must preserve table contents')
        await step('fault-injected',{path,method:'PUT',table,temporary,before:before.hash,beforeSources:before.sources,tableHash:beforeTableHash,allowedWriteBaseline:200})
        // Only the independent business observer runs while a security table is
        // absent. securitySnapshot intentionally cannot run until restoration.
        const denied=await effects.observeDenied(()=>client.request(path,{method:'PUT',headers:{'Content-Type':'application/x-yaml',Accept:'application/json'},body:source('fault must deny '+id),signal:AbortSignal.timeout(20000)}),async response=>{
          const status=response.status;await response.body?.cancel()
          assert([401,403,500,503].includes(status),'dependency failure allowed write or unexpected routing error')
        },{windowMs:fixture.effectsWindowMs??5000,intervalMs:250})
        await step('fault-write-rejected',{status:denied.response.status,sideEffects:denied.observation,duringTableHash:tableHash(temporary)})
        assert.equal(tableHash(temporary),beforeTableHash,'fault request altered renamed table contents')
      }finally{
        if(attempted)await restore(id+'-table-name',async()=>{
          // A timed out ALTER might have committed. Inspect both names first.
          const names=JSON.parse(sql(`SELECT json_build_object('original',to_regclass('public.${table}') IS NOT NULL,'temporary',to_regclass('public.${temporary}') IS NOT NULL)::text`))
          if(!names.original&&names.temporary)rename(temporary,table)
          else assert(names.original&&!names.temporary,'ambiguous fault table names; refusing unsafe rename')
          assert.equal(tableHash(table),beforeTableHash)
          const after=securitySnapshot();assert.equal(after.hash,before.hash,'failed dependency write changed persistent state')
          await step('fault-restored',{after:after.hash,afterSources:after.sources,tableHash:tableHash(table),exactBeforeAfterMatch:true})
        })
      }
      assert.equal((await get(client,path+'?source=true')).source,original.source)
      try{await write(source('recovered '+id),'recovered '+id);await step('allow-after-restoration',{writeStatus:200,persistedChangedField:true})}
      finally{await restore(id+'-recovered-flow-source',async()=>{await write(original.source);assert.equal((await get(client,path+'?source=true')).source,original.source);await quiesceBusiness(id+'-after-recovery')})}
    })
  }
  await check('legacy-write-api-removed',async()=>{
    const client=await manager()
    await quiesceBusiness('legacy-write-api-removed')
    for(const [method,path,body]of [
      ['POST',api+'/roles',{id:'removed-role',name:'Removed role',grants:[]}],
      ['PUT',api+'/roles/removed-role',{id:'removed-role',name:'Removed role',grants:[]}],
      ['DELETE',api+'/roles/removed-role',undefined],
      ['PUT',api+'/bindings',{subject:planned.admin.subject,roles:['removed-role']}],
      ['PUT',api+'/role-mappings',{trustedRole:'admin',roles:['removed-role']}],
      ['GET',api+'/policy',undefined],
      ['GET',api+'/projects',undefined],
      ['GET',api+'/identity/projects',undefined],
    ])await deny(client,path,method,body,undefined,{statuses:[403,404]})
  })
  await dependencyFault('directory-unavailable','rbac_application_group_state')
  await dependencyFault('policy-unavailable','rbac_application_group_policy_head')

  await check('wrong-tenant',async()=>{
    let client=await manager(),projection=await get(client,runtimePath)
    const name=scopeNames.readA,definition=structuredClone(projection.policy.scopes[name])
    assert(definition&&definition.grants.length,'actual scope policy required for a valid tenant write baseline')
    try {
      await saveScope(client,name,{...definition,description:definition.description+' [allowed main tenant baseline]'})
      await step('allow-write-baseline',{tenant:'main',scopeKey:name,explicitDescriptionChanged:true})
    }finally{await restore('main-tenant-scope-description',async()=>{await saveScope(await manager(),name,definition)})}
    client=await manager();projection=await get(client,runtimePath)
    const allowed='/api/v1/main/flows/'+encodeURIComponent(namespaceDomains.a)+'/allowed-id'
    assert.equal((await request(client,allowed)).status,200)
    await step('allow-baseline',{tenant:'main',flowRead:200,managementRead:200,policyRevision:projection.revision})
    await deny(client,allowed.replace('/main/','/security-other-tenant/'),'GET',undefined,undefined,{statuses:[400,403,404],invalidTenant:true})
    const writePath=runtimePath+'/scopes/'+encodeURIComponent(name)
    await deny(client,writePath.replace('/main/','/security-other-tenant/'),'PUT',scopeInput(name,definition),projection.revision,{statuses:[400,403,404],invalidTenant:true})
    assert.equal((await request(client,allowed)).status,200)
    same(await get(client,runtimePath),projection)
    await step('restoration-verified',{mainTenantAllowed:true,unchanged:true,scopeKey:name})
  })

  await runApplicationProjectOauth(base,{planned,snapshot:securitySnapshot},async fragment=>{report.oauth=fragment;for(const row of fragment.checks){const index=report.checks.findIndex(item=>item.id===row.id);report.checks[index]=row}await persist()})
  report.completed=!report.preconditionFailure&&report.checks.every(row=>row.passed)
  await persist();return report
}
