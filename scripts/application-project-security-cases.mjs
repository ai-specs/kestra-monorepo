/** Real HTTP security checks for an explicitly isolated application-project deployment.
 * Call after provisionFixture, before MCP/UI mutations, with no concurrent writers:
 * runApplicationProjectSecurity(base,{planned,management,effects,observer,release},record).
 * observer={composeProject,postgresContainer,kestraContainer}; IDs are docker IDs.
 * secondaryIssuer={base,account} reuses the driver's cached isolated missing-jar
 * topology; its production UI must issue project kestra / audience kestra-ui /
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
import {applicationProject,scopeNames,namespaceDomains} from './application-project-cases.mjs'
import {mcpFlowSource,mcpProtocolEvidence} from './application-project-fixture.mjs'

export const securityCheckIds=Object.freeze([
  'last-identity-administrator','last-local-policy-administrator',
  'local-policy-unapproved-project-denied','management-target-action-cross-scope-denied',
  'reconciliation-complete-project-atomic','rest-subject-revoke','wrong-tenant',
  'wrong-issuer','wrong-audience','wrong-project','directory-unavailable','policy-unavailable',
])
const api='/api/v1/main/extensions/rbac'
const projectPath=api+'/projects/'+encodeURIComponent(applicationProject)
const identityPath=api+'/identity/projects/'+encodeURIComponent(applicationProject)
const recoveryPath=projectPath+'/reconciliation'
const key=value=>'~'+Buffer.from(value).toString('base64url')
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex')
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
// Public grant/action/ID collections are sets; JSON array order is not semantic.
const semantic=value=>Array.isArray(value)?value.map(semantic).sort((a,b)=>String(JSON.stringify(a)).localeCompare(String(JSON.stringify(b)))):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,semantic(v)])):value
const same=(actual,expected,message)=>assert.deepEqual(semantic(actual),semantic(expected),message)
const scopeInput=(name,value)=>({name,...structuredClone(value)})
const directoryScopeInput=value=>Object.fromEntries(['scope','description','active','resourceIntents','managementIntents'].map(name=>[name,structuredClone(value[name])]))
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
  async function request(client,path,method='GET',body,revision) {
    const started=performance.now()
    let response
    try{response=await client.request(path,{method,signal:AbortSignal.timeout(20_000),headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),...(revision===undefined?{}:{'If-Match':'"'+revision+'"'})},...(body===undefined?{}:{body:JSON.stringify(body)})})}
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
    const identity=await client.verifiedUiIdentity({projectId:applicationProject,subject:account.subject,audience:planned.expectedAudience})
    report.logins.push({check:active?.id,label,callbackPath:login.callbackPath,authenticated:login.authenticated,identity})
    await persist();return client
  }
  const manager=()=>login(planned.admin,'manager')
  const sql=query=>execFileSync('docker',['exec',observer.postgresContainer,'psql','-X','-U','kestra','-d','kestra','-v','ON_ERROR_STOP=1','-Atc',query],{encoding:'utf8',timeout:20_000,maxBuffer:1024*1024}).trim()
  function securitySnapshot() {
    // Published table layouts are read only. Session/token tables are deliberately
    // excluded: production login changes them; project state and policy must not.
    const state=sql(`SELECT json_build_object(
      'invalidation',(SELECT md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY singleton),'')) FROM oidc_project_invalidation t),
      'directory',(SELECT md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY project_id),'')) FROM oidc_project_state t),
      'policyHead',(SELECT md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY policy_id),'')) FROM rbac_project_policy_head t),
      'policySnapshots',(SELECT md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY revision),'')) FROM rbac_project_policy_snapshot t))::text`)
    const business=effects.snapshot()
    const sources={security:hash(state),business:business.hash,...business.sources}
    return {hash:hash(sources),sources}
  }
  async function deny(client,path,method,body,revision,{statuses=[403],code,windowMs=fixture.effectsWindowMs??5000}={}) {
    assert(windowMs>=5000&&windowMs<=60000,'bounded delayed-effect window required')
    const before=securitySnapshot(),started=performance.now()
    const evidence={expectedStatuses:statuses,expectedCode:code,before:before.hash,beforeSources:before.sources,windowMs,samples:[]}
    await step('before-denied-request',evidence)
    let result,requestFailure
    try{result=await request(client,path,method,body,revision);evidence.status=result.status;evidence.code=result.value?.error??result.value?.code}
    catch(error){requestFailure=error;evidence.requestError=safe(error)}
    // Persist response failure AND all delayed hashes rather than throwing early.
    await step('denied-response',evidence)
    const observe=()=>{const current=securitySnapshot();evidence.samples.push({elapsedMs:Math.ceil(performance.now()-started),hash:current.hash,sources:current.sources})}
    observe()
    while(evidence.samples.at(-1).elapsedMs<windowMs){await delay(250);observe();await persist()}
    await step('denied-effects',evidence)
    if(requestFailure)throw requestFailure
    assert(statuses.includes(result.status),'unexpected denial HTTP '+result.status)
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
    const policy=await get(client,api+'/policy')
    const saved=await request(client,projectPath+'/scopes/'+key(name),'PUT',scopeInput(name,definition),policy.revision)
    assert.equal(saved.status,200,'allowed scope save');same(saved.value.policy.applicationProjects[applicationProject].scopes[name],definition)
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

  await check('last-identity-administrator',async()=>{
    let client=await manager()
    // Prove an actual identity-directory write is allowed, then restore its field.
    const baselinePath=identityPath+'/scopes/'+key(scopeNames.readA)
    const baselineScope=await get(client,baselinePath)
    try {
      await management.mutateIdentity(baselinePath,'PUT',{...directoryScopeInput(baselineScope),description:baselineScope.description+' [identity allowed baseline]'},baselineScope.revision)
      const saved=await get(await manager(),baselinePath)
      assert.notEqual(saved.description,baselineScope.description)
      await step('allow-write-baseline',{scope:scopeNames.readA,savedDescription:true})
    }finally{await restore('identity-directory-baseline-description',async()=>{
      const current=await get(await manager(),baselinePath)
      await management.mutateIdentity(baselinePath,'PUT',directoryScopeInput(baselineScope),current.revision)
      assert.equal((await get(await manager(),baselinePath)).description,baselineScope.description)
    })}
    client=await manager()
    const assignments=await get(client,identityPath+'/assignments?page=1&size=100')
    assert(assignments.items&&assignments.total===assignments.items.length,'complete assignment baseline required')
    const scopes=await get(client,identityPath+'/scopes?page=1&size=100')
    assert(scopes.items&&scopes.total===scopes.items.length,'complete scope baseline required')
    const managers=new Set(scopes.items.filter(s=>s.active&&s.managementIntents.some(g=>g.domain==='IDENTITY'&&g.actions.includes('MANAGE'))).map(s=>s.scope))
    const administrators=assignments.items.filter(a=>a.projectScopes.some(s=>managers.has(s)))
    if(administrators.length!==1||administrators[0].subject!==planned.admin.subject)throw new Unavailable('Test requires sole assigned identity administrator; refusing to alter other accounts')
    const path=identityPath+'/assignments/detail?subject='+encodeURIComponent(planned.admin.subject)
    const original=await get(client,path)
    await step('allow-baseline',{subject:original.subject,administratorCount:1,projectScopes:original.projectScopes})
    try{await deny(client,path,'PUT',{issuer:base,subject:original.subject,projectScopes:original.projectScopes.filter(s=>!managers.has(s))},original.revision,{statuses:[409],code:'last_administrator'})}
    finally{await restore('last-identity-administrator-unchanged',async()=>{
      same(await get(await manager(),path),original)
      await step('restoration-verified',{unchanged:true,subject:original.subject})
    })}
  })

  await check('last-local-policy-administrator',async()=>{
    const client=await manager(),projection=await get(client,recoveryPath)
    const managerScopes=Object.entries(projection.project.scopes).filter(([,s])=>s.enabled&&s.managementGrants.some(g=>g.domain==='LOCAL_POLICY'&&g.actions.includes('MANAGE')&&(!(g.projectIds?.length)||g.projectIds.includes(applicationProject))))
    if(managerScopes.length!==1)throw new Unavailable('Exactly one local management binding required; no bulk administrator removal')
    const [name,original]=managerScopes[0]
    // A real, reversible allowed write proves write authentication, CSRF and CAS.
    try {
      await saveScope(client,name,{...original,description:original.description+' [security allowed baseline]'})
      await step('allow-baseline',{scope:name,savedDescription:true})
    }finally{await restore('local-manager-description',async()=>{await saveScope(await manager(),name,original)})}
    const fresh=await manager(),policy=await get(fresh,api+'/policy')
    try{await deny(fresh,projectPath+'/scopes/'+key(name),'PUT',scopeInput(name,{...original,enabled:false}),policy.revision,{statuses:[409],code:'last_administrator'})}
    finally{await restore('last-local-administrator-unchanged',async()=>{
      same(await get(await manager(),projectPath+'/scopes/'+key(name)),original)
      await step('restoration-verified',{unchanged:true,scope:name})
    })}
  })

  await check('local-policy-unapproved-project-denied',async()=>{
    const client=await manager(),id='security-unapproved-'+randomBytes(6).toString('hex'),path=api+'/identity/projects/'+id
    let created=false
    try {
      const response=await request(client,api+'/identity/projects','POST',{id,tenant:'main',displayName:'Isolated unapproved local-policy target'})
      assert.equal(response.status,200);created=true
      const shared=await get(await manager(),path)
      assert.equal(shared.id,id);assert.equal(shared.active,true)
      await step('allow-baseline',{identityCreateStatus:response.status,identityRead:true,targetProject:id})
      const current=await manager(),policy=await get(current,api+'/policy')
      assert(!policy.policy.applicationProjects[id],'target must not have local binding')
      await deny(current,api+'/projects','POST',{id,issuer:base,audiences:['kestra-ui'],enabled:true,directoryRevision:shared.revision},policy.revision)
      assert(!(await get(await manager(),api+'/policy')).policy.applicationProjects[id])
    }finally{
      if(created)await restore('deactivate-isolated-identity-project',async()=>{
        const client=await manager(),shared=await get(client,path)
        const response=await request(client,path,'PUT',{displayName:shared.displayName,active:false},shared.revision)
        assert.equal(response.status,200);assert.equal((await get(await manager(),path)).active,false)
        // The public API has no project DELETE. Retain a named inactive project,
        // only in this disposable Compose deployment; never delete DB rows.
        await step('restoration-verified',{targetProject:id,active:false,retainedInactive:true,reason:'public project delete is unsupported'})
      })
    }
  })

  await check('reconciliation-complete-project-atomic',async()=>{
    let client=await manager()
    const directoryPath=identityPath+'/scopes/'+key(scopeNames.readA)
    const directoryOriginal=await get(client,directoryPath)
    const originalProjection=await get(client,recoveryPath)
    const original=structuredClone(originalProjection.project)
    let directoryChanged=false,localChanged=false
    try {
      // Advance the real directory revision without silently reconciling it.
      const change=await request(client,directoryPath,'PUT',{...directoryScopeInput(directoryOriginal),description:directoryOriginal.description+' [atomic security review]'},directoryOriginal.revision)
      assert.equal(change.status,200);directoryChanged=true
      client=await manager()
      const projection=await get(client,recoveryPath)
      assert(projection.directoryRevision>original.directoryRevision)
      assert.equal(projection.project.directoryRevision,original.directoryRevision)
      const candidate={...structuredClone(projection.project),directoryRevision:projection.directoryRevision}
      candidate.scopes[scopeNames.readA].description+=' [atomic A]'
      candidate.scopes[scopeNames.writeB].description+=' [atomic B]'
      // One valid edit plus another out-of-bound binding must commit NOTHING,
      // including the new directoryRevision and the first valid description.
      const invalid=structuredClone(candidate)
      invalid.scopes[scopeNames.writeB].grants.find(g=>g.resource==='FLOW').namespace=namespaceDomains.outside
      await step('allow-baseline',{reconciliationRead:true,staleRevision:original.directoryRevision,targetRevision:projection.directoryRevision,scopeCount:Object.keys(candidate.scopes).length})
      await deny(client,recoveryPath,'PUT',invalid,projection.policyRevision,{statuses:[400]})
      const rejected=await get(client,recoveryPath)
      assert.equal(rejected.policyRevision,projection.policyRevision);same(rejected.project,projection.project)
      const saved=await request(client,recoveryPath,'PUT',candidate,projection.policyRevision)
      assert.equal(saved.status,200);localChanged=true
      const actual=await get(await manager(),recoveryPath)
      same(actual.project,candidate);assert.equal(actual.policyRevision,projection.policyRevision+1)
      await step('atomic-allow-saved',{revision:actual.policyRevision,projectHash:hash(actual.project),bothDescriptionsSaved:true,directoryRevision:actual.directoryRevision})
    }finally{
      if(directoryChanged||localChanged)await restore('complete-project-and-directory',async()=>{
        const client=await manager(),projection=await get(client,recoveryPath)
        const restored={...structuredClone(original),directoryRevision:projection.directoryRevision}
        const saved=await request(client,recoveryPath,'PUT',restored,projection.policyRevision);assert.equal(saved.status,200)
        const current=await get(await manager(),directoryPath)
        // Original full policy semantics match planned; normal reviewed helper
        // may now reconcile the next directory revision without inventing grants.
        await management.mutateIdentity(directoryPath,'PUT',directoryScopeInput(directoryOriginal),current.revision)
        const confirmed=await get(await manager(),recoveryPath)
        same(confirmed.project.scopes,original.scopes)
        assert.equal(confirmed.project.directoryRevision,confirmed.directoryRevision)
        assert.equal((await get(await manager(),directoryPath)).description,directoryOriginal.description)
        await step('restoration-verified',{scopesHash:hash(confirmed.project.scopes),directoryRevision:confirmed.directoryRevision})
      })
    }
  })

  await check('rest-subject-revoke',async()=>{
    const account=planned.accounts.reader
    const path=identityPath+'/assignments/detail?subject='+encodeURIComponent(account.subject)
    const businessPath='/api/v1/main/flows/'+encodeURIComponent(namespaceDomains.a)+'/allowed-id'
    const oldClient=await login(account,'subject-before-revoke')
    assert.equal((await request(oldClient,businessPath)).status,200)
    const original=await get(await manager(),path)
    assert(original.projectScopes.includes(scopeNames.readA))
    const bound=fixture.revokeWindowMs??60000
    assert(bound>0&&bound<=60000,'explicit bounded revocation contract required')
    let changed=false
    try {
      await management.login()
      const start=performance.now(),at=new Date().toISOString()
      // Record commit return separately; do not wait for reconciliation before
      // measuring denial on the old, still-held production UI cookie.
      changed=true // A transport failure may occur after the transaction committed.
      await management.request(path,'PUT',{issuer:base,subject:account.subject,projectScopes:[]},original.revision)
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
      await management.reconcile(applicationProject)
      await deny(oldClient,businessPath,'GET',undefined,undefined,{statuses:[401,403]})
      const fresh=await login(account,'subject-after-revoke')
      const identity=await fresh.verifiedUiIdentity({projectId:applicationProject,subject:account.subject,audience:planned.expectedAudience})
      same(identity.projectScopes,[])
      await deny(fresh,businessPath,'GET',undefined,undefined,{statuses:[403]})
      await step('fresh-identity-denied',{subject:account.subject,projectScopes:identity.projectScopes})
    }finally{
      if(changed)await restore('subject-project-scopes',async()=>{
        await management.reconcile(applicationProject);const current=await management.request(path)
        await management.mutateIdentity(path,'PUT',{issuer:base,subject:account.subject,projectScopes:original.projectScopes},current.revision)
        const response=await request(await login(account,'subject-restored'),businessPath);assert.equal(response.status,200)
        same((await get(await manager(),path)).projectScopes,original.projectScopes)
        await step('restoration-verified',{allowedStatus:response.status,subject:account.subject})
      })
    }
  })

  await check('management-target-action-cross-scope-denied',async()=>{
    const suffix=randomBytes(5).toString('hex')
    const targetA='security-read-a-'+suffix,targetB='security-manage-b-'+suffix
    const readScope='kestra:security:'+suffix+':target-a',manageScope='kestra:security:'+suffix+':target-b'
    const account={username:'security-split-'+suffix,subject:'security-split-'+suffix,password:randomBytes(24).toString('base64url')+'aA1!'}
    passwords.push(account.password)
    const originalProjection=await get(await manager(),recoveryPath)
    const originalScopes=structuredClone(originalProjection.project.scopes)
    let expectedScopes=structuredClone(originalScopes),userCreated=false,assignmentCreated=false,uiOriginal,uiChanged=false
    const targets=[],directoryScopes=[],cleanupFailures=[]
    const cleanupAttempt=async(name,run)=>{try{await restore(name,run)}catch(error){cleanupFailures.push(safe(error))}}
    const uiPath=identityPath+'/clients/'+key(planned.expectedAudience)
    const assignmentPath=identityPath+'/assignments/detail?subject='+encodeURIComponent(account.subject)
    const localDefinition=(target,actions)=>({description:'Independent exact security management target '+target,enabled:true,grants:[],managementGrants:[{domain:'LOCAL_POLICY',actions:[...actions].sort(),projectIds:[target]}]})
    const sharedDefinition=(name,local)=>({scope:name,description:local.description,active:true,resourceIntents:[],managementIntents:structuredClone(local.managementGrants)})
    async function syncMain(desired=expectedScopes) {
      const client=await manager(),projection=await get(client,recoveryPath)
      same(projection.project.scopes,expectedScopes,'concurrent local changes must not be overwritten')
      const candidate={...structuredClone(projection.project),scopes:structuredClone(desired),directoryRevision:projection.directoryRevision}
      const shared=new Map(projection.upperBound.scopes.map(scope=>[scope.scope,scope]))
      for(const name of [readScope,manageScope])if(candidate.scopes[name]) {
        assert(shared.has(name),'explicit shared scope must exist before local binding')
        const local=candidate.scopes[name],ceiling=shared.get(name)
        for(const grant of local.managementGrants)assert(ceiling.managementIntents.some(bound=>bound.domain===grant.domain&&grant.actions.every(action=>bound.actions.includes(action))&&grant.projectIds.every(id=>bound.projectIds.includes(id))),'same-scope exact management upper bound required')
      }
      const saved=await request(client,recoveryPath,'PUT',candidate,projection.policyRevision)
      assert.equal(saved.status,200,'complete reviewed main policy reconciliation required')
      expectedScopes=structuredClone(desired)
      same((await get(await manager(),recoveryPath)).project.scopes,expectedScopes)
    }
    async function directoryWrite(path,method,body,revision) {
      const result=await request(await manager(),path,method,body,revision)
      assert.equal(result.status,200,'public identity operation failed');await syncMain();return result.value
    }
    async function deactivateTarget(target,actor) {
      if(!target.localCreated)return
      const path=api+'/projects/'+target.id+'/reconciliation'
      const projection=await get(actor,path)
      const shared=await get(await manager(),api+'/identity/projects/'+target.id)
      if(shared.active)await request(await manager(),api+'/identity/projects/'+target.id,'PUT',{displayName:shared.displayName,active:false},shared.revision).then(r=>assert.equal(r.status,200))
      // The login project is main; only the target epoch changed. Current exact
      // target management remains available for this complete disabled binding.
      const fresh=await get(actor,path)
      const candidate={...fresh.project,enabled:false,directoryRevision:fresh.directoryRevision}
      const saved=await request(actor,path,'PUT',candidate,fresh.policyRevision);assert.equal(saved.status,200)
      const confirmed=await get(actor,path);assert.equal(confirmed.project.enabled,false);assert.equal(confirmed.project.directoryRevision,confirmed.directoryRevision)
      await step('target-restored',{target:target.id,localEnabled:false,directoryActive:false,retainedInactive:true,reason:'public project DELETE is unsupported',previousRevision:projection.directoryRevision,currentRevision:confirmed.directoryRevision})
    }
    try {
      for(const id of [targetA,targetB]) {
        const created=await request(await manager(),api+'/identity/projects','POST',{id,tenant:'main',displayName:'Security split target '+id})
        assert.equal(created.status,200)
        const target={id,localCreated:false};targets.push(target)
        // Each target owns a distinct real DCR client; never join the UI client
        // to another project or relax unique client ownership.
        const registered=await request(await manager(),'/oidc/register','POST',{redirect_uris:['http://127.0.0.1:19997/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code'],response_types:['code'],scope:'openid',client_name:'Security target '+id})
        assert.equal(registered.status,201);assert(registered.value.client_id&&!registered.value.client_secret)
        target.clientId=registered.value.client_id;target.audience=base+'/security-target/'+id
        const shared=await get(await manager(),api+'/identity/projects/'+id)
        const member=await request(await manager(),api+'/identity/projects/'+id+'/clients','POST',{clientId:target.clientId,approved:true,firstPartyUi:false,audiences:[target.audience],allowedProjectScopes:[]},shared.revision)
        assert.equal(member.status,200)
      }
      const r=localDefinition(targetA,['READ','MANAGE']),m=localDefinition(targetB,['MANAGE'])
      for(const [name,definition]of [[readScope,r],[manageScope,m]]) {
        const project=await get(await manager(),identityPath)
        directoryScopes.push(name)
        await directoryWrite(identityPath+'/scopes','POST',sharedDefinition(name,definition),project.revision)
      }
      uiOriginal=await get(await manager(),uiPath)
      const uiBody={clientId:uiOriginal.clientId,approved:uiOriginal.approved,firstPartyUi:uiOriginal.firstPartyUi,audiences:uiOriginal.audiences,allowedProjectScopes:[...new Set([...uiOriginal.allowedProjectScopes,readScope,manageScope])]}
      uiChanged=true;await directoryWrite(uiPath,'PUT',uiBody,uiOriginal.revision)
      await syncMain({...expectedScopes,[readScope]:r,[manageScope]:m})
      const user=await request(await manager(),api+'/users','POST',{username:account.username,name:'Security split target test account',email:account.username+'@acceptance.invalid',password:account.password})
      assert.equal(user.status,201);userCreated=true;assert.equal(user.value.subject,account.subject);await syncMain()
      const project=await get(await manager(),identityPath)
      assignmentCreated=true
      await directoryWrite(identityPath+'/assignments','POST',{issuer:base,subject:account.subject,projectScopes:[readScope,manageScope]},project.revision)
      let actor=await login(account,'split-scope-setup')
      for(const target of targets) {
        const shared=await get(await manager(),api+'/identity/projects/'+target.id),policy=await get(await manager(),api+'/policy')
        const created=await request(actor,api+'/projects','POST',{id:target.id,issuer:base,audiences:[target.audience],enabled:false,directoryRevision:shared.revision},policy.revision)
        assert.equal(created.status,200);target.localCreated=true
        const confirmed=await get(actor,api+'/projects/'+target.id+'/reconciliation')
        assert.equal(confirmed.project.enabled,false);assert.equal(confirmed.project.id,target.id)
      }
      // Narrow this NEW scope. Existing published scope semantics stay unchanged.
      const readOnly=localDefinition(targetA,['READ'])
      await syncMain({...expectedScopes,[readScope]:readOnly})
      const shared=await get(await manager(),identityPath+'/scopes/'+key(readScope))
      await directoryWrite(identityPath+'/scopes/'+key(readScope),'PUT',sharedDefinition(readScope,readOnly),shared.revision)
      actor=await login(account,'split-scope-final-real-issuance')
      const identity=await actor.verifiedUiIdentity({projectId:applicationProject,subject:account.subject,audience:planned.expectedAudience})
      same([...identity.projectScopes].sort(),[readScope,manageScope].sort())
      same(await get(actor,api+'/projects/'+targetA+'/scopes'),{})
      const b=await get(actor,api+'/projects/'+targetB+'/reconciliation')
      // Actual allowed write: turn target B on. Complete same-scope management
      // grants and the real assigned member provide the required reachability.
      const enabled={...b.project,enabled:true}
      const allowed=await request(actor,api+'/projects/'+targetB+'/reconciliation','PUT',enabled,b.policyRevision)
      assert.equal(allowed.status,200)
      assert.equal((await get(actor,api+'/projects/'+targetB+'/reconciliation')).project.enabled,true)
      await step('allow-baseline',{identity,targetA,targetB,readTargetA:200,manageTargetB:200,scopeBindings:{[readScope]:readOnly.managementGrants,[manageScope]:m.managementGrants}})
      const policy=await get(await manager(),api+'/policy')
      const a=targets.find(t=>t.id===targetA),sharedA=await get(await manager(),api+'/identity/projects/'+targetA)
      // Valid target A metadata, changing a real field. Only scope READ(A) and
      // scope MANAGE(B) are signed; their conditions must never be combined.
      await deny(actor,api+'/projects/'+targetA,'PUT',{id:targetA,issuer:base,audiences:[a.audience],enabled:true,directoryRevision:sharedA.revision},policy.revision)
      await deny(actor,api+'/projects/'+targetA+'/reconciliation','GET')
      same(await get(actor,api+'/projects/'+targetA+'/scopes'),{})
    }finally{
      // Restore target bindings while the account still has exact management
      // reachability. Scope A was narrowed to READ, so use a fresh, separately
      // created cleanup scope, never widen that scope back or infer admin bypass.
      if(targets.some(t=>t.localCreated))await cleanupAttempt('split-targets-inactive',async()=>{
        const cleanupScope='kestra:security:'+suffix+':cleanup'
        const cleanupDefinition={description:'Explicit isolated cleanup authority',enabled:true,grants:[],managementGrants:[{domain:'LOCAL_POLICY',actions:['MANAGE'],projectIds:targets.filter(t=>t.localCreated).map(t=>t.id).sort()}]}
        const project=await get(await manager(),identityPath)
        directoryScopes.push(cleanupScope)
        await directoryWrite(identityPath+'/scopes','POST',sharedDefinition(cleanupScope,cleanupDefinition),project.revision)
        const ui=await get(await manager(),uiPath)
        await directoryWrite(uiPath,'PUT',{clientId:ui.clientId,approved:ui.approved,firstPartyUi:ui.firstPartyUi,audiences:ui.audiences,allowedProjectScopes:[...ui.allowedProjectScopes,cleanupScope]},ui.revision)
        await syncMain({...expectedScopes,[cleanupScope]:cleanupDefinition})
        const assignment=await get(await manager(),assignmentPath)
        await directoryWrite(assignmentPath,'PUT',{issuer:base,subject:account.subject,projectScopes:[cleanupScope]},assignment.revision)
        const actor=await login(account,'explicit-split-cleanup')
        // Disable local target first under the still active directory; otherwise
        // the other active target would make complete candidate validation fail.
        for(const target of targets.filter(t=>t.localCreated)) {
          const path=api+'/projects/'+target.id+'/reconciliation',projection=await get(actor,path)
          if(projection.project.enabled){const saved=await request(actor,path,'PUT',{...projection.project,enabled:false},projection.policyRevision);assert.equal(saved.status,200)}
        }
        for(const target of targets.filter(t=>t.localCreated))await deactivateTarget(target,actor)
      })
      if(assignmentCreated)await cleanupAttempt('split-subject-zero-grants',async()=>{
        const current=await get(await manager(),assignmentPath)
        await directoryWrite(assignmentPath,'PUT',{issuer:base,subject:account.subject,projectScopes:[]},current.revision)
        same((await get(await manager(),assignmentPath)).projectScopes,[])
      })
      if(userCreated)await cleanupAttempt('split-account-disabled',async()=>{
        const user=await get(await manager(),api+'/users/detail?subject='+encodeURIComponent(account.subject))
        const disabled=await request(await manager(),api+'/users/state','PUT',{subject:account.subject,active:false},user.revision)
        assert.equal(disabled.status,200);await syncMain()
        assert.equal((await get(await manager(),api+'/users/detail?subject='+encodeURIComponent(account.subject))).active,false)
      })
      await cleanupAttempt('split-local-scopes-restored',async()=>{await syncMain(originalScopes)})
      if(uiChanged&&uiOriginal)await cleanupAttempt('split-ui-client-membership',async()=>{
        const current=await get(await manager(),uiPath)
        await directoryWrite(uiPath,'PUT',{clientId:uiOriginal.clientId,approved:uiOriginal.approved,firstPartyUi:uiOriginal.firstPartyUi,audiences:uiOriginal.audiences,allowedProjectScopes:uiOriginal.allowedProjectScopes},current.revision)
      })
      for(const name of directoryScopes)await cleanupAttempt('split-directory-scope-disabled-'+name,async()=>{
        const path=identityPath+'/scopes/'+key(name),scope=await get(await manager(),path)
        await directoryWrite(path,'PUT',{...directoryScopeInput(scope),active:false},scope.revision)
      })
      // Targets created before local binding setup can also be deactivated.
      for(const target of targets.filter(t=>!t.localCreated))await cleanupAttempt('split-unused-target-'+target.id,async()=>{
        const path=api+'/identity/projects/'+target.id,shared=await get(await manager(),path)
        const saved=await request(await manager(),path,'PUT',{displayName:shared.displayName,active:false},shared.revision);assert.equal(saved.status,200)
      })
      if(cleanupFailures.length)throw new Error('Cross-scope restoration failed: '+cleanupFailures.join('; '))
      await step('restoration-verified',{originalScopeHash:hash(originalScopes),localScopeHash:hash((await get(await manager(),recoveryPath)).project.scopes),retainedDisabledTargets:targets.map(t=>t.id),retainedDisabledScopes:directoryScopes,testAccount:account.subject})
    }
  })

  await check('wrong-audience',async()=>{
    const account=planned.accounts.writer,client=await login(account,'audience-owner')
    const rest='/api/v1/main/flows/'+encodeURIComponent(namespaceDomains.b)+'/allowed-id'
    const baseline=await get(client,rest+'?source=true')
    assert.equal(baseline.namespace,namespaceDomains.b);assert.equal(baseline.id,'allowed-id');assert(baseline.source)
    let membershipPath,approved=false,session,originalRequest=client.request.bind(client)
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
        membershipPath=identityPath+'/clients/'+key(registration.clientId)
        management.approvedClientIds.set(registration.clientId,[scopeNames.writeB]);approved=true
        await management.approveOrdinaryClient({clientId:registration.clientId,audiences:registration.audiences,projectScopes:[scopeNames.writeB],registeredProtocolScopes:['openid','mcp:flows:read','mcp:executions:write'],requestedProtocolScopes:['openid','mcp:flows:read']})
      },async current=>{await current.login(account.username,account.password)})
      const identity=await client.verifiedAccessIdentity({projectId:applicationProject,subject:account.subject,expectedProjectScopes:[scopeNames.writeB],expectedProtocolScopes:['openid','mcp:flows:read']})
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
        // First recover a possibly committed approval before any ordinary GET.
        await management.reconcile(applicationProject)
        const member=await management.request(membershipPath)
        management.approvedClientIds.delete(member.clientId)
        await management.mutateIdentity(membershipPath,'DELETE',undefined,member.revision)
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
      const identity=await foreign.verifiedUiIdentity({projectId:applicationProject,subject:secondary.account.subject,audience:planned.expectedAudience})
      assert.equal(identity.issuer,secondary.base);assert(identity.projectScopes.includes(scopeNames.writeB))
      assert([planned.admin,...Object.values(planned.accounts)].some(account=>account.subject===identity.subject),'foreign cookie must use an existing main subject, not an unknown user')
      assert(identity.projectScopes.every(scope=>Object.hasOwn(planned.policy.applicationProjects[applicationProject].scopes,scope)),'all foreign project scopes must be known locally; unknown scope must not confound issuer rejection')
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

  await check('wrong-project',async()=>{
    const suffix=randomBytes(5).toString('hex'),id='security-business-project-'+suffix
    const account=planned.accounts.writer,projectApi=api+'/identity/projects/'+id
    const flowId='security-project-token-'+suffix,toolName='security-project-token-'+suffix
    const flowPath='/api/v1/main/flows/'+encodeURIComponent(namespaceDomains.b)+'/'+flowId
    const owner=new ProductionOAuthClient(base),foreign=new ProductionOAuthClient(base)
    let projectCreated=false,mainMemberPath,foreignMemberPath,mainApproved=false,foreignApproved=false,assigned=false,flowCreated=false
    const cleanupFailures=[]
    const cleanup=async(name,run)=>{try{await restore(name,run)}catch(error){cleanupFailures.push(safe(error))}}
    const protocolScopes=['openid','mcp:flows:read','mcp:executions:write']
    const directoryScope=planned.directoryScopes.find(scope=>scope.scope===scopeNames.writeB)
    assert(directoryScope?.resourceIntents?.length,'same-name complete directory business scope required')
    const denied=result=>[401,403].includes(result.status)||result.status===200&&(
      result.message?.error?.code===mcpProtocolEvidence.rpcDenial.code&&result.message.error.message===mcpProtocolEvidence.rpcDenial.message
      ||result.message?.result?.isError===true&&JSON.stringify(result.message.result)===JSON.stringify(mcpProtocolEvidence.toolDenial))
    async function initialize(client,requestId) {
      const result=await client.rpc(null,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'project-isolation-security',version:'1'}},requestId)
      assert.equal(result.status,200);assert(result.session&&result.message?.result&&!result.message.error)
      assert([200,202,204].includes((await client.rpc(result.session,'notifications/initialized')).status));return result.session
    }
    try {
      // A real main-project token and persisted tool execution establish the
      // complete resource/protocol allow baseline before testing another project.
      await owner.login(account.username,account.password)
      await owner.issueMcpScopes([...protocolScopes,scopeNames.writeB],async registration=>{
        mainMemberPath=identityPath+'/clients/'+key(registration.clientId)
        management.approvedClientIds.set(registration.clientId,[scopeNames.writeB]);mainApproved=true
        await management.approveOrdinaryClient({clientId:registration.clientId,audiences:registration.audiences,projectScopes:[scopeNames.writeB],registeredProtocolScopes:protocolScopes,requestedProtocolScopes:protocolScopes})
      },async client=>{await client.login(account.username,account.password)})
      const mainIdentity=await owner.verifiedAccessIdentity({projectId:applicationProject,subject:account.subject,expectedProjectScopes:[scopeNames.writeB],expectedProtocolScopes:protocolScopes})
      const managerClient=await manager()
      assert.equal((await request(managerClient,flowPath)).status,404,'dedicated security flow must be absent')
      const seeded=await managerClient.request('/api/v1/main/flows',{method:'POST',headers:{'Content-Type':'application/x-yaml'},body:mcpFlowSource(namespaceDomains.b,flowId,toolName),signal:AbortSignal.timeout(20000)})
      assert([200,201].includes(seeded.status));flowCreated=true;await seeded.body?.cancel()
      const stored=await get(managerClient,flowPath+'?source=true');assert.equal(stored.id,flowId);assert(stored.triggers.some(trigger=>trigger.toolName===toolName))
      const mainSession=await initialize(owner,8201)
      const list=await owner.rpc(mainSession,'tools/list',{},8202)
      assert.equal(list.status,200);assert(list.message?.result?.tools?.some(tool=>tool.name===toolName))
      const marker='project-boundary-'+suffix
      const called=await owner.rpc(mainSession,'tools/call',{name:toolName,arguments:{marker}},8203)
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
      const created=await request(await manager(),api+'/identity/projects','POST',{id,tenant:'main',displayName:'Isolated same-name business scope project'})
      assert.equal(created.status,200);projectCreated=true
      let project=await get(await manager(),projectApi)
      const scope=await request(await manager(),projectApi+'/scopes','POST',{...structuredClone(directoryScope),description:'Same name and complete intents; distinct project'},project.revision)
      assert.equal(scope.status,200);assert.equal(scope.value.scope,scopeNames.writeB)
      project=await get(await manager(),projectApi)
      assigned=true
      const assignment=await request(await manager(),projectApi+'/assignments','POST',{issuer:base,subject:account.subject,projectScopes:[scopeNames.writeB]},project.revision)
      assert.equal(assignment.status,200)
      await foreign.login(account.username,account.password)
      const issued=await foreign.issueMcpScopes([...protocolScopes,scopeNames.writeB],async registration=>{
        foreignMemberPath=projectApi+'/clients/'+key(registration.clientId)
        const current=await get(await manager(),projectApi)
        foreignApproved=true
        const approved=await request(await manager(),projectApi+'/clients','POST',{clientId:registration.clientId,approved:true,firstPartyUi:false,audiences:registration.audiences,allowedProjectScopes:[scopeNames.writeB]},current.revision)
        assert.equal(approved.status,200)
      },async client=>{await client.login(account.username,account.password)})
      const identity=await foreign.verifiedAccessIdentity({projectId:id,subject:account.subject,expectedProjectScopes:[scopeNames.writeB],expectedProtocolScopes:protocolScopes})
      assert.equal(identity.issuer,mainIdentity.issuer);same(identity.audiences,mainIdentity.audiences);same(identity.projectScopes,mainIdentity.projectScopes);same(identity.protocolScopes,mainIdentity.protocolScopes)
      const local=await get(await manager(),api+'/policy');assert(!local.policy.applicationProjects[id],'wrong-project target must have no local binding')
      await step('allow-baseline',{mainIdentity,foreignIdentity:identity,sameNameScope:scopeNames.writeB,foreignClientId:issued.clientId,mainToolsList:200,mainToolCall:200,executionId,executionState:'SUCCESS',databaseVerified:true,persistedMarker:marker,localBindingAbsent:true,uiClientJoinedForeignProject:false})
      const foreignSession=await initialize(foreign,8211)
      const beforeList=securitySnapshot();let listRefusal
      try{listRefusal=await effects.observeDenied(()=>foreign.rpc(foreignSession,'tools/list',{},8212),result=>assert(denied(result)||result.status===200&&!result.message?.error&&Array.isArray(result.message?.result?.tools)&&result.message.result.tools.length===0,'foreign project borrowed main project tool visibility'),{windowMs:fixture.effectsWindowMs??5000,intervalMs:250})}
      finally{const afterList=securitySnapshot();await step('foreign-project-list-state',{before:beforeList.hash,after:afterList.hash,beforeSources:beforeList.sources,afterSources:afterList.sources});assert.equal(afterList.hash,beforeList.hash)}
      const foreignList=listRefusal.response
      await step('foreign-project-list-denied',{status:foreignList.status,emptyList:foreignList.message?.result?.tools?.length===0,sideEffects:listRefusal.observation,error:foreignList.message?.error?{code:foreignList.message.error.code,message:foreignList.message.error.message}:undefined})
      const before=securitySnapshot();let refusal
      try{refusal=await effects.observeDenied(()=>foreign.rpc(foreignSession,'tools/call',{name:toolName,arguments:{marker:'must-not-execute-'+suffix}},8213),result=>assert(denied(result),'foreign project borrowed main project write grant'),{windowMs:fixture.effectsWindowMs??5000,intervalMs:250})}
      finally{const after=securitySnapshot();await step('foreign-project-state',{before:before.hash,after:after.hash,beforeSources:before.sources,afterSources:after.sources});assert.equal(after.hash,before.hash)}
      await step('foreign-project-call-denied',{status:refusal.response.status,sideEffects:refusal.observation})
      const recovered=await owner.rpc(mainSession,'tools/list',{},8220)
      assert.equal(recovered.status,200);assert(recovered.message?.result?.tools?.some(tool=>tool.name===toolName))
      await step('main-project-still-allowed',{status:200,toolName})
    }finally{
      if(projectCreated&&assigned)await cleanup('wrong-project-assignment-revoked',async()=>{
        const path=projectApi+'/assignments/detail?subject='+encodeURIComponent(account.subject),assignment=await get(await manager(),path)
        const revoked=await request(await manager(),path,'PUT',{issuer:base,subject:account.subject,projectScopes:[]},assignment.revision);assert.equal(revoked.status,200)
      })
      if(foreignApproved)await cleanup('wrong-project-member-removed',async()=>{
        const member=await get(await manager(),foreignMemberPath)
        assert.equal((await request(await manager(),foreignMemberPath,'DELETE',undefined,member.revision)).status,200)
      })
      if(projectCreated)await cleanup('wrong-project-disabled',async()=>{
        const current=await get(await manager(),projectApi)
        assert.equal((await request(await manager(),projectApi,'PUT',{displayName:current.displayName,active:false},current.revision)).status,200)
        assert.equal((await get(await manager(),projectApi)).active,false)
      })
      if(flowCreated)await cleanup('wrong-project-security-flow-removed',async()=>{
        const response=await request(await manager(),flowPath,'DELETE');assert([200,204].includes(response.status))
        assert.equal((await request(await manager(),flowPath)).status,404);await quiesceBusiness('wrong-project-flow-deleted')
      })
      if(mainApproved)await cleanup('wrong-project-main-member-restored',async()=>{
        await management.reconcile(applicationProject);const member=await management.request(mainMemberPath)
        management.approvedClientIds.delete(member.clientId)
        await management.mutateIdentity(mainMemberPath,'DELETE',undefined,member.revision)
      })
      if(cleanupFailures.length)throw new Error('Wrong-project restoration failed: '+cleanupFailures.join('; '))
      await step('restoration-verified',{project:id,projectActive:false,foreignAssignmentEmpty:true,foreignMembershipRemoved:true,mainMembershipRemoved:true,securityFlowRemoved:true,retainedInactiveProject:true})
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
      assert(['oidc_project_state','rbac_project_policy_head'].includes(table),'allowlisted fault table required')
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
  await dependencyFault('directory-unavailable','oidc_project_state')
  await dependencyFault('policy-unavailable','rbac_project_policy_head')

  await check('wrong-tenant',async()=>{
    const client=await manager(),projection=await get(client,recoveryPath)
    const allowed='/api/v1/main/flows/'+encodeURIComponent(namespaceDomains.a)+'/allowed-id'
    assert.equal((await request(client,allowed)).status,200)
    await step('allow-baseline',{tenant:'main',flowRead:200,managementRead:200})
    // Real URI tenant, same production identity and CSRF. No synthetic identity headers.
    await deny(client,allowed.replace('/main/','/security-other-tenant/'),'GET',undefined,undefined,{statuses:[403,404]})
    await deny(client,recoveryPath.replace('/main/','/security-other-tenant/'),'PUT',projection.project,projection.policyRevision,{statuses:[403,404]})
    assert.equal((await request(client,allowed)).status,200)
    same((await get(client,recoveryPath)).project,projection.project)
    await step('restoration-verified',{mainTenantAllowed:true,unchanged:true})
  })

  report.completed=!report.preconditionFailure&&report.checks.every(row=>row.passed)
  await persist();return report
}
