/** Isolated test configuration and formal management operations. No SQL writes. */
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {applicationProject,projectScopeCases,namespaceDomains,scopeNames} from './application-project-cases.mjs'
import {localApplicationPolicy,directoryScopeInputs} from './application-project-policy.mjs'

export function planFixture(base) {
  assert.equal(new URL(base).origin,base)
  const password=()=>randomBytes(24).toString('base64url')+'aA1!'
  const admin={username:'project-acceptance-manager',subject:'project-acceptance-manager',password:password()}
  const accounts=Object.fromEntries(projectScopeCases.map((item,index)=>[item.id,{username:'project-acceptance-'+index,subject:'project-acceptance-'+index,password:password()}]))
  const policy=localApplicationPolicy({issuer:base,audiences:['kestra-ui'],directoryRevision:1})
  const observerScope='kestra:acceptance:observer-complete'
  policy.applicationProjects[applicationProject].scopes[observerScope]={description:'Isolated test data observer',enabled:true,
    grants:[namespaceDomains.a,namespaceDomains.b,namespaceDomains.outside,namespaceDomains.a+'2'].flatMap(namespace=>[
      {scope:'NAMESPACE',tenant:'main',namespace,descendants:true,resource:'FLOW',actions:['READ','LIST','CREATE','UPDATE','DELETE','EXECUTE'],ids:[],allIds:true},
      {scope:'NAMESPACE',tenant:'main',namespace,descendants:true,resource:'EXECUTION',actions:['READ','LIST','CREATE','DELETE','ACCESS_OUTPUTS'],ids:[],allIds:true},
    ]).concat([{scope:'TENANT',tenant:'main',namespace:null,descendants:false,resource:'METADATA',actions:['READ','LIST'],ids:[],allIds:true}]),managementGrants:[]}
  const mcp=planMcpScenarios()
  for(const [name,scope]of Object.entries(mcp.revocationScopes)) {
    const flowId=mcp.scenarios[name].call.flowId
    const definition=structuredClone(policy.applicationProjects[applicationProject].scopes[scopeNames.writeB])
    definition.description='Explicit MCP '+name+' complete scope'
    for(const grant of definition.grants)if(grant.resource==='FLOW'){grant.allIds=false;grant.ids=[flowId]}
    policy.applicationProjects[applicationProject].scopes[scope]=definition
  }
  const mcpAccounts=Object.fromEntries(mcpScenarioNames.map(name=>[name,{username:'project-mcp-'+name.toLowerCase(),subject:'project-mcp-'+name.toLowerCase(),password:password()}]))
  const projectScopeCatalog=[scopeNames.readA,scopeNames.writeB,scopeNames.readOnlyA,scopeNames.listOnlyA,scopeNames.listOnlyB,scopeNames.exactA,scopeNames.restrictedId,scopeNames.restrictedIdB,scopeNames.readOnlyIdA,scopeNames.listOnlyOtherIdA,scopeNames.unbound,scopeNames.deleteB,scopeNames.outputsA,scopeNames.identityManager,scopeNames.policyManager,observerScope,...Object.values(mcp.revocationScopes)]
  return {base,admin,accounts,policy,observerScope,mcp,mcpAccounts,projectScopeCatalog,directoryScopes:directoryScopeInputs(policy),expectedAudience:'kestra-ui',flowWrite:{transport:'yaml'},effectsWindowMs:5000}
}

/** Bootstrap plan only: caller must obtain installationId from its OWN volume.
 * Creating this JSON does not prove CLI execution or a published CLI contract.
 */
export function directoryActivationPlan(fixture,installationId) {
  assert(/^[0-9a-f-]{36}$/i.test(installationId),'actual installation UUID required')
  const names=[...fixture.projectScopeCatalog]
  assert.deepEqual([...names].sort(),fixture.directoryScopes.map(item=>item.scope).sort(),'explicit scope catalog differs from generated definitions')
  return {formatVersion:1,installationId,uiClientId:'kestra-ui',sourceRevision:0,
    sourceHash:'4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',projects:[{
      project:{id:applicationProject,tenant:'main',issuer:fixture.base,displayName:'Acceptance',active:true,revision:1,authorizationVersion:1},
      scopes:fixture.directoryScopes.map(scope=>({...scope,projectId:applicationProject,revision:1})),
      memberships:[{projectId:applicationProject,clientId:'kestra-ui',approved:true,audiences:['kestra-ui'],allowedProjectScopes:names,firstPartyUi:true,revision:1}],
      assignments:[{projectId:applicationProject,issuer:fixture.base,subject:fixture.admin.subject,
        projectScopes:[scopeNames.identityManager,scopeNames.policyManager,fixture.observerScope],revision:1,authorizationVersion:1}],directoryRevision:1}]}
}

/** Production management helper: a directory mutation invalidates the old epoch.
 * Re-login, read the entire projection, submit the entire reviewed local project,
 * verify Project.revision independently of authorizationVersion, then re-login.
 */
export class ProjectManagement {
  constructor(base,account,reviewProject) {this.base=base;this.account=account;this.reviewProject=reviewProject;this.requests=[]}
  async login() {
    this.client=new ProductionOAuthClient(this.base)
    const login=await this.client.login(this.account.username,this.account.password)
    assert.equal(login.authenticated,true)
    this.reauthentication={...login,subject:this.account.subject}
    return this.client
  }
  async request(path,method='GET',body,revision) {
    assert(path.startsWith('/api/v1/main/extensions/rbac/'),'only formal same-origin management API accepted')
    assert(this.client,'fresh authenticated client required')
    const response=await this.client.request(path,{method,headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),...(revision===undefined?{}:{'If-Match':'"'+revision+'"'})},...(body===undefined?{}:{body:JSON.stringify(body)})})
    this.requests.push({path,method,status:response.status})
    if(this.onRequest)await this.onRequest(this.requests.at(-1))
    assert(response.ok,'management HTTP '+response.status+' '+method+' '+path)
    return response.status===204?null:response.json()
  }
  async reconcile(projectId,{previousProject}={}) {
    assert.equal(typeof this.reviewProject,'function','explicit full-project review required; no automatic revision-only confirmation')
    await this.login()
    const path='/api/v1/main/extensions/rbac/projects/'+encodeURIComponent(projectId)+'/reconciliation'
    const projection=await this.request(path)
    assert.equal(projection.upperBound?.project?.id,projectId)
    assert.equal(projection.directoryRevision,projection.upperBound.project.revision,'directoryRevision must equal Project.revision')
    if(previousProject) {
      assert(projection.upperBound.project.revision>previousProject.revision,'identity revision did not advance')
    }
    assert(Number.isSafeInteger(projection.policyRevision)&&Number.isSafeInteger(projection.directoryRevision))
    const candidate=await this.reviewProject(structuredClone(projection))
    assert.equal(candidate.id,projectId)
    assert.equal(candidate.directoryRevision,projection.directoryRevision)
    assert(candidate.scopes&&typeof candidate.scopes==='object','complete scopes required')
    const saved=await this.request(path,'PUT',candidate,projection.policyRevision)
    assert.equal(saved.policy?.schemaVersion,2)
    assert.deepEqual(saved.policy.applicationProjects[projectId],Object.fromEntries(Object.entries(candidate).filter(([key])=>key!=='id')))
    await this.login()
    const confirmed=await this.request(path)
    assert.equal(confirmed.directoryRevision,confirmed.upperBound.project.revision)
    assert.equal(confirmed.project.directoryRevision,confirmed.directoryRevision)
    assert.deepEqual(confirmed.project,{...candidate})
    const verified=await this.client.verifiedUiIdentity({projectId:applicationProject,subject:this.account.subject,audience:'kestra-ui'})
    // The public OAuth helper exposes epoch, not directoryRevision. Directory
    // revision was verified above against the full authoritative projection.
    const shared=await this.request('/api/v1/main/extensions/rbac/identity/projects/'+encodeURIComponent(projectId))
    assert.equal(verified.authorizationVersion,shared.authorizationVersion,'fresh signed identity epoch differs')
    if(previousProject)assert(shared.authorizationVersion>previousProject.authorizationVersion,'each identity change must advance epoch')
    return {requests:[...this.requests],reauthentication:this.reauthentication,directoryRevision:confirmed.directoryRevision,authorizationVersion:shared.authorizationVersion}
  }
  async approveOrdinaryClient({clientId,audiences,projectScopes,registeredProtocolScopes,requestedProtocolScopes}) {
    assert(clientId&&clientId!=='kestra-ui','ordinary client must never inherit first-party UI selector')
    assert(!projectScopes.includes('kestra:project-scopes')&&!requestedProtocolScopes.includes('kestra:project-scopes'),'UI selector is first-party only')
    assert(requestedProtocolScopes.every(scope=>registeredProtocolScopes.includes(scope)),'requested protocol capability exceeds registered scope')
    assert.deepEqual(audiences,[this.base+'/api/v1/main/mcp/default'],'MCP audience must match the exact protected resource')
    await this.login()
    const current=await this.request('/api/v1/main/extensions/rbac/identity/projects/'+applicationProject)
    return this.mutateIdentity('/api/v1/main/extensions/rbac/identity/projects/'+applicationProject+'/clients','POST',
      {clientId,approved:true,firstPartyUi:false,audiences:[...audiences],allowedProjectScopes:[...projectScopes]},current.revision)
  }
  async mutateIdentity(path,method,body,revision,projectId=applicationProject) {
    assert(/\/identity\/projects(?:\/|$)/.test(path),'identity project API required')
    await this.login()
    const before=await this.request('/api/v1/main/extensions/rbac/identity/projects/'+encodeURIComponent(projectId))
    await this.request(path,method,body,revision)
    // Ordinary identity GET is forbidden while local directoryRevision is
    // stale. Reauthenticate, then use ONLY the reconciliation exception.
    return this.reconcile(projectId,{previousProject:before})
  }
}

export const fixtureGaps=Object.freeze([
  'formal application-project overlay promotion and compatible plugin CI artifact',
  'actual UI DOM, full theme/language/filter and zero-grant browser execution against formal products',
  'migration stale/partial/rollback and old token/session scenarios; wrong identity and dependency fault scenarios',
])

const semantic=value=>Array.isArray(value)?value.map(semantic).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,semantic(item)])):value
const api='/api/v1/main/extensions/rbac'
const flowPath=(namespace,id)=>'/api/v1/main/flows/'+encodeURIComponent(namespace)+'/'+encodeURIComponent(id)
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
export const flowSource=(namespace,id,description='seeded acceptance flow')=>`id: ${id}\nnamespace: ${namespace}\ndescription: ${description}\ntasks:\n  - id: result\n    type: io.kestra.plugin.core.storage.Write\n    content: verified\noutputs:\n  - id: file\n    type: STRING\n    value: "{{ outputs.result.uri }}"\n`

/** Produce deterministic resource identities and exact list expectations, while
 * simulating the SAME sequential mutations as the shared REST fragment. */
export function planRestResources(fixture) {
  const probes={};const seeds=new Map();const creates=new Set()
  for(const test of projectScopeCases)for(const [index,probe]of test.probes.entries()) {
    const flowId=probe.resourceId??('probe-'+test.id+'-'+index)
    const key=probe.namespace+'/'+flowId
    const description='explicit saved change '+test.id+' '+index
    probes[test.id+':'+index]={flowId,source:flowSource(probe.namespace,flowId,description),expectedSourceFragment:'description: '+description,expectedFields:{description},expectedExecutionFields:{'state.current':'SUCCESS'}}
    if(probe.action==='CREATE')creates.add(key)
    else seeds.set(key,{namespace:probe.namespace,id:flowId,source:flowSource(probe.namespace,flowId)})
  }
  // Ensure cross-product ID sentinels and child namespace cases are real.
  for(const namespace of [namespaceDomains.a,namespaceDomains.b])for(const id of ['allowed-id','other-id'])seeds.set(namespace+'/'+id,{namespace,id,source:flowSource(namespace,id)})
  for(const key of creates)assert(!seeds.has(key),'CREATE target reused by a pre-existing probe')
  const current=new Map(seeds)
  const definitions=fixture.policy.applicationProjects[applicationProject].scopes
  for(const test of projectScopeCases)for(const [index,probe]of test.probes.entries()) {
    const data=probes[test.id+':'+index]
    if(probe.action==='LIST'&&probe.allowed) {
      const granted=item=>test.scopes.some(scope=>(definitions[scope]?.grants??[]).some(grant=>grant.resource==='FLOW'&&grant.actions.includes('READ')&&grant.actions.includes('LIST')&&(grant.namespace===item.namespace||grant.descendants&&item.namespace.startsWith(grant.namespace+'.'))&&(grant.allIds||grant.ids.includes(item.id))))
      const domain=item=>item.namespace===probe.namespace||item.namespace.startsWith(probe.namespace+'.')
      data.expectedList=[...current.values()].filter(item=>domain(item)&&granted(item)).map(({namespace,id})=>({namespace,id}))
      data.outsideList=[...current.values()].filter(item=>!domain(item)||!granted(item)).map(({namespace,id})=>({namespace,id}))
      data.allowedNamespaces=[...new Set(data.expectedList.map(item=>item.namespace))]
      data.includeDescendants=probe.expectedIds?false:true
      assert(data.expectedList.length&&data.outsideList.length,'real list and excluded sentinels required')
    }
    if(probe.allowed&&probe.action==='CREATE')current.set(probe.namespace+'/'+data.flowId,{namespace:probe.namespace,id:data.flowId})
    if(probe.allowed&&probe.action==='DELETE')current.delete(probe.namespace+'/'+data.flowId)
  }
  return {probes,seeds:[...seeds.values()]}
}

export async function provisionFixture({planned,effects,observer,record=async()=>{}}) {
  assert(planned&&effects,'own activated deployment and observer required')
  const events=[]
  const management=new ProjectManagement(planned.base,planned.admin,projection=>{
    const original=projection.project
    assert.equal(original.id,applicationProject)
    // No silent semantic widening: review all local scopes against the exact
    // generated input. Only confirmed directory revision may change.
    assert.deepEqual(semantic(original.scopes),semantic(planned.policy.applicationProjects[applicationProject].scopes))
    const candidate={...original,scopes:structuredClone(original.scopes),directoryRevision:projection.directoryRevision}
    for(const [name,definition]of management.reconciliationEdits??[])candidate.scopes[name]=structuredClone(definition)
    if(management.approvedClientIds?.size)candidate.audiences=['kestra-ui',planned.base+'/api/v1/main/mcp/default']
    else candidate.audiences=['kestra-ui']
    return candidate
  })
  management.reconciliationEdits=new Map();management.approvedClientIds=new Map()
  const originalReconcile=management.reconcile.bind(management)
  management.reconcile=async(...args)=>{
    const receipt=await originalReconcile(...args)
    for(const [name,definition]of management.reconciliationEdits)planned.policy.applicationProjects[applicationProject].scopes[name]=structuredClone(definition)
    management.reconciliationEdits.clear()
    planned.policy.applicationProjects[applicationProject].audiences=management.approvedClientIds.size?['kestra-ui',planned.base+'/api/v1/main/mcp/default']:['kestra-ui']
    return receipt
  }
  management.onRequest=async()=>record({events,requests:[...management.requests],completed:false})
  await management.login()
  const emit=async event=>{events.push(event);await record({events,requests:[...management.requests],completed:false})}
  for(const test of projectScopeCases) {
    const account=planned.accounts[test.id]
    await management.login()
    const created=await management.request(api+'/users','POST',{username:account.username,name:'Acceptance '+test.id,email:account.username+'@acceptance.invalid',password:account.password})
    assert.equal(created.subject,account.subject,'created account subject differs')
    const saved=await management.request(api+'/users/detail?subject='+encodeURIComponent(account.subject))
    assert.equal(saved.subject,account.subject);assert.equal(saved.active,true)
    await emit({kind:'account-created',caseId:test.id,subject:account.subject,revision:saved.revision})
    // Account creation may invalidate the manager's epoch in the published
    // implementation: always re-login and fully reconcile before assignment.
    await management.reconcile(applicationProject)
    const project=await management.request(api+'/identity/projects/'+applicationProject)
    const receipt=await management.mutateIdentity(api+'/identity/projects/'+applicationProject+'/assignments','POST',
      {issuer:planned.base,subject:account.subject,projectScopes:[...test.scopes]},project.revision)
    await emit({kind:'subject-assigned',caseId:test.id,subject:account.subject,scopes:[...test.scopes],directoryRevision:receipt.directoryRevision,reauthentication:receipt.reauthentication})
  }
  const client=await management.login()
  const observerIdentity=await client.verifiedUiIdentity({projectId:applicationProject,subject:planned.admin.subject,audience:planned.expectedAudience})
  assert(observerIdentity.projectScopes.includes(planned.observerScope),'observer did not receive its explicit scope')
  const resources=planRestResources(planned)
  for(const seed of resources.seeds) {
    const response=await client.request('/api/v1/main/flows',{method:'POST',headers:{'Content-Type':'application/x-yaml'},body:seed.source})
    assert([200,201].includes(response.status),'real flow seed failed '+seed.namespace+'/'+seed.id+' HTTP '+response.status)
    await response.body?.cancel()
    const check=await client.request(flowPath(seed.namespace,seed.id)+'?source=true');assert.equal(check.status,200)
    const stored=await check.json();assert.equal(stored.namespace,seed.namespace);assert.equal(stored.id,seed.id);assert(stored.source.includes('seeded acceptance flow'))
    await emit({kind:'flow-seeded',namespace:seed.namespace,id:seed.id})
  }
  for(const test of projectScopeCases)for(const [index,probe]of test.probes.entries())if(probe.action==='ACCESS_OUTPUTS') {
    const data=resources.probes[test.id+':'+index]
    const response=await client.request('/api/v1/main/executions/'+encodeURIComponent(probe.namespace)+'/'+encodeURIComponent(data.flowId),{method:'POST',body:new FormData()})
    assert(response.ok,'output execution seed failed');const started=await response.json();assert(started.id)
    let stored;const deadline=Date.now()+60000
    do {
      const response=await client.request('/api/v1/main/executions/'+encodeURIComponent(started.id));assert.equal(response.status,200);stored=await response.json()
      if(stored.state?.current==='SUCCESS')break
      assert(!['FAILED','KILLED','CANCELLED'].includes(stored.state?.current),'seed output execution failed')
      await wait(250)
    }while(Date.now()<deadline)
    assert.equal(stored.state?.current,'SUCCESS','seed execution timeout')
    assert.equal(stored.namespace,probe.namespace);assert.equal(stored.flowId,data.flowId)
    assert(/^[A-Za-z0-9_-]+$/.test(stored.id),'safe output execution identity required')
    const label=execFileSync('docker',['inspect','-f','{{index .Config.Labels "com.docker.compose.project"}}',observer.postgresContainer],{encoding:'utf8'}).trim()
    assert.equal(label,observer.composeProject)
    const encoded=execFileSync('docker',['exec',observer.postgresContainer,'psql','-X','-U','kestra','-d','kestra','-v','ON_ERROR_STOP=1','-Atc',`SELECT encode(value,'base64') FROM execution_outputs WHERE key='${stored.id}'`],{encoding:'utf8'}).trim()
    const output=Buffer.from(encoded.replace(/\s/g,''),'base64').toString('utf8')
    const match=output.match(/(?:"file"|\bfile)\s*:\s*("(?:[^"\\]|\\.)*")/)
    assert(match,'persisted text-Ion output URI missing')
    data.executionId=stored.id;data.outputUri=JSON.parse(match[1]);data.outputText='verified'
    assert(typeof data.outputUri==='string'&&data.outputUri.startsWith('kestra://'),'real storage URI missing')
    const file=await client.request('/api/v1/main/executions/'+encodeURIComponent(stored.id)+'/file?'+new URLSearchParams({path:data.outputUri}))
    assert.equal(file.status,200);assert.equal(await file.text(),data.outputText)
    await emit({kind:'execution-output-seeded',id:stored.id,namespace:probe.namespace,flowId:data.flowId,bytesVerified:true})
  }
  // Require observed stability over a bounded window; no fixed sleep is treated
  // as evidence that asynchronous seed writes have stopped.
  const deadline=Date.now()+30000;let last=effects.snapshot().hash;let stableSince=Date.now()
  for(;;){await wait(500);const next=effects.snapshot().hash;if(next!==last){last=next;stableSince=Date.now()}if(Date.now()-stableSince>=5000)break;assert(Date.now()<deadline,'seed database/queue/storage did not become quiescent')}
  await record({events,requests:[...management.requests],completed:true,seededFlows:resources.seeds.length,quiescentWindowMs:5000})
  const prepareMcp=async()=>provisionMcpFixture({planned,management,effects,observer,record:async fragment=>record({events,requests:[...management.requests],seededFlows:resources.seeds.length,quiescentWindowMs:5000,mcp:fragment,completed:true})})
  return {prepareMcp,rest:{accounts:planned.accounts,observerAccount:planned.admin,expectedAudience:planned.expectedAudience,flowWrite:planned.flowWrite,probes:resources.probes,effects,effectsWindowMs:5000},management,planned}
}

export const mcpScenarioNames=Object.freeze(['allowed','capabilityOnly','projectOnly','knownUnbound','localRevoke','directoryRevoke','subjectRevoke'])
export const mcpRegisteredProtocolScopes=Object.freeze(['openid','mcp:flows:read','mcp:executions:write'])
export const mcpProtocolEvidence=Object.freeze({
  overlayCommit:'4b017f6d07d5689d971050cfbdcf30dcd9ec0f55',
  output:'patches/webserver/0170-mcp-capability-authorizer.patch: McpToolService returns ExecutionOutputService outputs as structuredContent',
  arguments:'webserver/src/main/java/io/kestra/mcp/McpToolService.java: buildCallHandler matches argument keys to flow input IDs',
  rpcDenial:{code:-32003,message:'Authorization denied'},
  toolDenial:{isError:true,content:[{type:'text',text:'Not permitted to execute this tool'}]},
})
export function planMcpScenarios() {
  // Independent complete scopes are explicitly registered by the shared test
  // catalog. Existing REST scope semantics are never expanded.
  const revocationScopes={localRevoke:scopeNames.mcpLocalOperate,directoryRevoke:scopeNames.mcpDirectoryOperate,subjectRevoke:scopeNames.mcpSubjectOperate}
  for(const scope of Object.values(revocationScopes))assert(typeof scope==='string'&&scope.length,'explicit shared MCP revocation scope required')
  const target={allowed:'mcp-allowed',capabilityOnly:'mcp-allowed',projectOnly:'mcp-allowed',knownUnbound:'mcp-allowed',localRevoke:'mcp-local',directoryRevoke:'mcp-directory',subjectRevoke:'mcp-subject'}
  const tools=['acceptance-mcp-allowed','acceptance-mcp-local','acceptance-mcp-directory','acceptance-mcp-subject']
  const scopes={allowed:[scopeNames.writeB],capabilityOnly:[],projectOnly:[scopeNames.writeB],knownUnbound:[scopeNames.writeB,scopeNames.unbound],localRevoke:[revocationScopes.localRevoke],directoryRevoke:[revocationScopes.directoryRevoke],subjectRevoke:[revocationScopes.subjectRevoke]}
  const scenarios=Object.fromEntries(mcpScenarioNames.map(name=>[name,{projectScopes:scopes[name],protocolScopes:name==='projectOnly'?['openid']:[...mcpRegisteredProtocolScopes],expectedTools:name==='allowed'?tools:name==='capabilityOnly'||name==='projectOnly'||name==='knownUnbound'?[]:['acceptance-'+target[name]],
    call:{name:'acceptance-'+target[name],arguments:{marker:'mcp-acceptance-marker'},namespace:namespaceDomains.b,flowId:target[name],executionIdPath:'result.structuredContent.executionId',expectedExecutionFields:{'inputs.marker':'mcp-acceptance-marker','outputs.marker':'mcp-acceptance-marker','state.current':'SUCCESS'}}}]))
  const seeds=['allowed','localRevoke','directoryRevoke','subjectRevoke'].map(name=>({namespace:namespaceDomains.b,id:target[name],toolName:scenarios[name].call.name,source:mcpFlowSource(namespaceDomains.b,target[name],scenarios[name].call.name)}))
  return {scenarios,seeds,revocationScopes}
}
export function mcpFlowSource(namespace,id,toolName) {
  return `id: ${id}\nnamespace: ${namespace}\ndescription: Explicit MCP acceptance tool\ninputs:\n  - id: marker\n    type: STRING\n    required: true\ntasks:\n  - id: identity\n    type: io.kestra.plugin.core.debug.Return\n    format: "{{ execution.id }}"\n  - id: echo\n    type: io.kestra.plugin.core.debug.Return\n    format: "{{ inputs.marker }}"\noutputs:\n  - id: executionId\n    type: STRING\n    value: "{{ outputs.identity.value }}"\n  - id: marker\n    type: STRING\n    value: "{{ outputs.echo.value }}"\ntriggers:\n  - id: mcp\n    type: io.kestra.plugin.core.trigger.McpToolTrigger\n    mcpServer: default\n    toolName: ${toolName}\n    title: Explicit MCP acceptance\n    toolDescription: Executes a controlled flow and returns its persisted execution ID\n`
}

export async function provisionMcpFixture({planned,management,effects,observer,record=async()=>{}}) {
  const pendingScopes=Object.values(planned.mcp.revocationScopes).filter(value=>!Object.values(scopeNames).includes(value))
  assert.equal(pendingScopes.length,0,'main-owned shared scopeNames must explicitly accept independent MCP revocation scopes: '+pendingScopes.join(', '))
  const journal=[]
  const emit=async event=>{journal.push(event);await record({events:journal,completed:false})}
  const refreshActor=async(client,account)=>{
    const login=await client.login(account.username,account.password)
    assert.equal(login.authenticated,true)
    const identity=await client.verifiedUiIdentity({projectId:applicationProject,subject:account.subject,audience:planned.expectedAudience})
    return {subject:identity.subject,authenticated:true,callbackPath:login.callbackPath}
  }
  const receipt=async(start,client,account)=>({requests:management.requests.slice(start).filter(row=>['POST','PUT','DELETE'].includes(row.method)),reauthentication:await refreshActor(client,account)})
  for(const name of mcpScenarioNames) {
    const account=planned.mcpAccounts[name]
    await management.login()
    const created=await management.request(api+'/users','POST',{username:account.username,name:'MCP acceptance '+name,email:account.username+'@acceptance.invalid',password:account.password})
    assert.equal(created.subject,account.subject)
    await management.reconcile(applicationProject)
    const project=await management.request(api+'/identity/projects/'+applicationProject)
    await management.mutateIdentity(api+'/identity/projects/'+applicationProject+'/assignments','POST',{issuer:planned.base,subject:account.subject,projectScopes:[...planned.mcp.scenarios[name].projectScopes]},project.revision)
    await emit({kind:'mcp-account-assigned',scenario:name,subject:account.subject,projectScopes:[...planned.mcp.scenarios[name].projectScopes]})
  }
  const writer=await management.login()
  for(const seed of planned.mcp.seeds) {
    const response=await writer.request('/api/v1/main/flows',{method:'POST',headers:{'Content-Type':'application/x-yaml'},body:seed.source})
    assert([200,201].includes(response.status),'MCP flow seed rejected HTTP '+response.status);await response.body?.cancel()
    const storedResponse=await writer.request(flowPath(seed.namespace,seed.id)+'?source=true');assert.equal(storedResponse.status,200)
    const stored=await storedResponse.json();assert.equal(stored.id,seed.id);assert.equal(stored.namespace,seed.namespace)
    assert(stored.source?.includes('mcpServer: default')&&stored.triggers?.some(trigger=>trigger.type==='io.kestra.plugin.core.trigger.McpToolTrigger'&&trigger.toolName===seed.toolName&&(trigger.mcpServer??'default')==='default'),'stored flow lacks exact MCP tool trigger')
    await emit({kind:'mcp-tool-seeded',namespace:seed.namespace,id:seed.id,toolName:seed.toolName})
  }
  async function localScope(name,definition) {
    await management.login()
    const view=await management.request(api+'/policy')
    const response=await management.request(api+'/projects/'+applicationProject+'/scopes/~'+Buffer.from(name).toString('base64url'),'PUT',{name,...definition},view.revision)
    assert.deepEqual(semantic(response.policy.applicationProjects[applicationProject].scopes[name]),semantic(definition))
    planned.policy.applicationProjects[applicationProject].scopes[name]=structuredClone(definition)
  }
  const callback=async({kind,phase,client,account,registration,scope,subject})=>{
    assert.equal(phase,'mutate')
    const scenario=mcpScenarioNames.find(name=>planned.mcpAccounts[name].subject===account.subject)
    assert(scenario,'callback identity outside explicit MCP test account list')
    const spec=planned.mcp.scenarios[scenario];const start=management.requests.length
    if(kind==='approve-client') {
      assert(registration?.clientId&&registration.audiences?.length)
      assert.deepEqual([...registration.scopes].sort(),[...spec.projectScopes,...spec.protocolScopes].sort())
      assert(spec.protocolScopes.every(value=>mcpRegisteredProtocolScopes.includes(value)),'request exceeds the production helper DCR protocol registration')
      management.approvedClientIds.set(registration.clientId,[...spec.projectScopes])
      await management.approveOrdinaryClient({clientId:registration.clientId,audiences:registration.audiences,projectScopes:spec.projectScopes,registeredProtocolScopes:mcpRegisteredProtocolScopes,requestedProtocolScopes:spec.protocolScopes})
      const result=await receipt(start,client,account)
      result.restore=async()=>{
        const restoreStart=management.requests.length
        await management.login()
        const path=api+'/identity/projects/'+applicationProject+'/clients/~'+Buffer.from(registration.clientId).toString('base64url')
        const member=await management.request(path)
        management.approvedClientIds.delete(registration.clientId)
        await management.mutateIdentity(path,'DELETE',undefined,member.revision)
        return receipt(restoreStart,client,account)
      }
      await emit({kind,scenario,clientId:registration.clientId,projectScopes:[...spec.projectScopes]})
      return result
    }
    assert.equal(scope,spec.projectScopes[0]);assert.equal(subject,account.subject)
    assert(Object.values(planned.mcp.revocationScopes).includes(scope),'revoke only dedicated test scopes')
    if(kind==='revoke-local-scope') {
      const original=structuredClone(planned.policy.applicationProjects[applicationProject].scopes[scope])
      await localScope(scope,{...original,enabled:false})
      const result=await receipt(start,client,account)
      result.restore=async()=>{const at=management.requests.length;await localScope(scope,original);return receipt(at,client,account)}
      await emit({kind,scenario,scope});return result
    }
    if(kind==='revoke-directory-scope') {
      await management.login()
      const path=api+'/identity/projects/'+applicationProject+'/scopes/~'+Buffer.from(scope).toString('base64url')
      const original=await management.request(path)
      const local=structuredClone(planned.policy.applicationProjects[applicationProject].scopes[scope])
      management.reconciliationEdits.set(scope,{...local,enabled:false})
      await management.mutateIdentity(path,'PUT',{scope:original.scope,description:original.description,active:false,resourceIntents:original.resourceIntents,managementIntents:original.managementIntents},original.revision)
      const result=await receipt(start,client,account)
      result.restore=async()=>{
        const at=management.requests.length;await management.login();const current=await management.request(path)
        management.reconciliationEdits.set(scope,local)
        await management.mutateIdentity(path,'PUT',{scope:original.scope,description:original.description,active:original.active,resourceIntents:original.resourceIntents,managementIntents:original.managementIntents},current.revision)
        return receipt(at,client,account)
      }
      await emit({kind,scenario,scope});return result
    }
    assert.equal(kind,'revoke-subject-scopes')
    await management.login()
    const path=api+'/identity/projects/'+applicationProject+'/assignments/detail?subject='+encodeURIComponent(subject)
    const original=await management.request(path)
    await management.mutateIdentity(path,'PUT',{issuer:planned.base,subject,projectScopes:[]},original.revision)
    const result=await receipt(start,client,account)
    result.restore=async()=>{const at=management.requests.length;await management.login();const current=await management.request(path);await management.mutateIdentity(path,'PUT',{issuer:planned.base,subject,projectScopes:[...original.projectScopes]},current.revision);return receipt(at,client,account)}
    await emit({kind,scenario,subject});return result
  }
  await record({events:journal,completed:true,seededTools:planned.mcp.seeds.map(seed=>seed.toolName)})
  return {accounts:planned.mcpAccounts,observerAccount:planned.admin,expectedUiAudience:planned.expectedAudience,scenarios:planned.mcp.scenarios,management:callback,effects,effectsWindowMs:5000,revokeWindowMs:60000,executionTimeoutMs:60000,
    denialErrors:[mcpProtocolEvidence.rpcDenial],denialToolCodes:[],denialToolResults:[mcpProtocolEvidence.toolDenial],protocolEvidence:mcpProtocolEvidence,
    databaseExecution:async({id,namespace,flowId})=>{
      for(const value of [id,namespace,flowId])assert(/^[A-Za-z0-9_.-]+$/.test(value),'unsafe read-only execution lookup')
      const postgres=observer?.postgresContainer
      assert(postgres,'explicit own PostgreSQL container ID required')
      const label=execFileSync('docker',['inspect','-f','{{index .Config.Labels "com.docker.compose.project"}}',postgres],{encoding:'utf8'}).trim()
      assert.equal(label,observer.composeProject)
      const sql=`SELECT json_build_object('id',value->>'id','namespace',value->>'namespace','flowId',value->>'flowId','state',value->'state'->>'current')::text FROM executions WHERE value->>'id'='${id}' AND value->>'namespace'='${namespace}' AND value->>'flowId'='${flowId}'`
      return JSON.parse(execFileSync('docker',['exec',postgres,'psql','-X','-U','kestra','-d','kestra','-v','ON_ERROR_STOP=1','-Atc',sql],{encoding:'utf8'}).trim())
    }}
}

/** Switch RBAC plus the first-party OAuth request together. Initial setup only
 * registers the three standard UI scopes; the project selector is enabled only
 * after explicit directory activation. Unknown layouts fail before startup. */
export function applicationProjectFeature(configuration,enabled) {
  assert.equal(typeof enabled,'boolean','explicit feature state required')
  const begin=configuration.indexOf('  rbac:');const end=configuration.indexOf('  oidc:',begin)
  assert(begin>=0&&end>begin,'known RBAC configuration boundaries required')
  let section=configuration.slice(begin,end)
  for(const pattern of [/^(    enabled: )(true|false)$/m,/(    evaluation:\n      enabled: )(true|false)/,/(    application-projects:\n      enabled: )(true|false)/]) {
    assert(pattern.test(section),'explicit feature switch missing')
    section=section.replace(pattern,(_,prefix)=>prefix+String(enabled))
  }
  const changed=configuration.slice(0,begin)+section+configuration.slice(end)
  const oauthStart=changed.indexOf('oauth2:')
  assert(oauthStart>=0,'explicit first-party OAuth2 UI client required')
  const prefix=changed.slice(0,oauthStart),oauth=changed.slice(oauthStart)
  assert(/clients:\s*\n\s+kestra:/.test(oauth),'known first-party kestra OAuth client required')
  const lists=[...oauth.matchAll(/^([ \t]*scopes:)[ \t]*\[([^\n]*)\][ \t]*$/gm)]
  assert.equal(lists.length,1,'exactly one inline UI scopes list required')
  const client=oauth.match(/^([ \t]*)kestra:[ \t]*$/m)
  assert(client&&lists[0].index>client.index,'UI scopes must belong to the kestra client')
  assert.equal(lists[0][1].match(/^[ \t]*/)[0].length,client[1].length+2,'UI scopes must be a direct kestra client property')
  const tokens=lists[0][2].split(',').map(value=>value.trim().replace(/^(?:"([^"\\]*)"|'([^'\\]*)')$/,'$1$2'))
  const standard=['openid','profile','email'],allowed=[...standard,'kestra:project-scopes']
  assert(tokens.length===new Set(tokens).size&&tokens.every(value=>allowed.includes(value))&&standard.every(value=>tokens.includes(value)),'UI scopes must contain exactly the standard set, optionally the project selector')
  const scopes=enabled?'[openid, profile, email, "kestra:project-scopes"]':'[openid, profile, email]'
  return prefix+oauth.replace(/^([ \t]*scopes:)[ \t]*\[[^\n]*\][ \t]*$/m,(_,name)=>name+' '+scopes)
}


/** Pure topology transformation, independently checkable without Docker or an
 * image. The caller's publication gate establishes image/jar provenance. */
export function missingExtensionTopology({sourceConfig,sourceBase,base,port,directory,planned}) {
  const config=structuredClone(sourceConfig)
  assert.deepEqual(Object.keys(config.services).sort(),['kestra','postgres'])
  const host=config.services.kestra
  const formalJar=host.volumes.find(item=>item.target==='/app/libs/kestra-rbac-authorizer.jar')?.source
  assert(formalJar,'verified source jar mount required for offline CLI only')
  const own=host.volumes.filter(item=>item.type==='volume')
  own.push({type:'bind',source:directory,target:'/work',read_only:true})
  host.volumes=own
  host.ports=[{target:8080,published:String(port),host_ip:'127.0.0.1',protocol:'tcp'}]
  host.environment.KESTRA_CONFIGURATION=applicationProjectFeature(host.environment.KESTRA_CONFIGURATION.replaceAll(sourceBase,base),false)
  Object.assign(host.environment,{KESTRA_OIDC_BOOTSTRAP_USERNAME:planned.admin.username,KESTRA_OIDC_BOOTSTRAP_PASSWORD:planned.admin.password,RBAC_POLICY_OPERATOR_SUBJECT:planned.admin.subject})
  config.services.maintenance={...structuredClone(host),profiles:['maintenance'],ports:[],restart:'no',volumes:[...structuredClone(own),{type:'bind',source:formalJar,target:'/app/libs/kestra-rbac-authorizer.jar',read_only:true}]}
  assert(!host.volumes.some(item=>item.target==='/app/libs'||item.target.startsWith('/app/libs/')))
  assert(config.services.maintenance.volumes.some(item=>item.source===formalJar&&item.read_only===true))
  return config
}

