/** Isolated test configuration and formal management operations. No SQL writes. */
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {applicationProject,projectScopeCases,namespaceDomains,scopeNames} from './application-project-cases.mjs'
import {localApplicationPolicy,directoryScopeInputs,applicationPermission,applicationPermissionRecords} from './application-project-policy.mjs'

export function planFixture(base) {
  assert.equal(new URL(base).origin,base)
  const password=()=>randomBytes(24).toString('base64url')+'aA1!'
  const admin={username:'project-acceptance-manager',subject:'project-acceptance-manager',password:password()}
  const accounts=Object.fromEntries(projectScopeCases.map((item,index)=>[item.id,{username:'project-acceptance-'+index,subject:'project-acceptance-'+index,password:password()}]))
  const policy=localApplicationPolicy({issuer:base,audiences:[base+'/api/v1/main/mcp/default']})
  const observerScope='acceptance-observer-complete'
  policy.applicationGroups[applicationProject].scopes[observerScope]={description:'Isolated test data observer',enabled:true,
    grants:[namespaceDomains.a,namespaceDomains.b,namespaceDomains.outside,namespaceDomains.a+'2'].flatMap(namespace=>[
      {scope:'NAMESPACE',tenant:'main',namespace,descendants:true,resource:'FLOW',actions:['READ','LIST','CREATE','UPDATE','DELETE','EXECUTE'],ids:[],allIds:true},
      {scope:'NAMESPACE',tenant:'main',namespace,descendants:true,resource:'EXECUTION',actions:['READ','LIST','CREATE','DELETE','ACCESS_OUTPUTS'],ids:[],allIds:true},
      {scope:'NAMESPACE',tenant:'main',namespace,descendants:true,resource:'TRIGGER',actions:['READ','LIST'],ids:[],allIds:true},
      {scope:'NAMESPACE',tenant:'main',namespace,descendants:true,resource:'KVSTORE',actions:['READ','LIST'],ids:[],allIds:true},
      {scope:'NAMESPACE',tenant:'main',namespace,descendants:true,resource:'NAMESPACE',actions:['READ','LIST'],ids:[],allIds:true},
    ]).concat([{scope:'TENANT',tenant:'main',namespace:null,descendants:false,resource:'METADATA',actions:['READ','LIST'],ids:[],allIds:true},
      {scope:'TENANT',tenant:'main',namespace:null,descendants:false,resource:'MCP_SERVER',actions:['READ','LIST'],ids:['default'],allIds:false}]),managementGrants:[]}
  const mcp=planMcpScenarios()
  for(const [name,scope]of Object.entries(mcp.revocationScopes)) {
    const flowId=mcp.scenarios[name].call.flowId
    const definition=structuredClone(policy.applicationGroups[applicationProject].scopes[scopeNames.writeB])
    definition.description={localRevoke:'MCP operator for application policy revocation',directoryRevoke:'MCP operator for supported scope revocation',subjectRevoke:'MCP operator for user scope revocation'}[name]
    assert(definition.description,'Explicit MCP role description required')
    for(const grant of definition.grants)if(grant.resource==='FLOW'){grant.allIds=false;grant.ids=[flowId]}
    policy.applicationGroups[applicationProject].scopes[scope]=definition
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
  assert.deepEqual([...names].sort(),fixture.directoryScopes.map(item=>item.key).sort(),'explicit scope catalog differs from generated definitions')
  return {formatVersion:2,installationId,issuer:fixture.base,uiClientId:'kestra-ui',builtInApplicationGroupId:applicationProject,applicationGroups:[{
      applicationGroup:{id:applicationProject,displayName:'Acceptance',description:'Isolated access-control acceptance',active:true,revision:1,authorizationVersion:1},
      scopes:fixture.directoryScopes.map(scope=>({...scope,revision:1})),
      applications:[{clientId:'kestra-ui',description:'Acceptance UI',audiences:[fixture.base+'/api/v1/main/mcp/default'],permissions:applicationPermissionRecords(fixture,names,{kestraPolicy:true}),revision:1}],
      userGrants:[{issuer:fixture.base,subject:fixture.admin.subject,
        scopeKeys:[scopeNames.identityManager,scopeNames.policyManager,fixture.observerScope],revision:1}]}]}
}

export class ApplicationGroupManagement {
  constructor(base,account) {
    assert.equal(arguments.length,2,'Complete policy recovery callbacks are not supported')
    this.base=base;this.account=account;this.requests=[];this.registeredClientIds=new Map()
  }
  async login() {
    this.client=new ProductionOAuthClient(this.base)
    const login=await this.client.login(this.account.username,this.account.password)
    assert.equal(login.authenticated,true)
    this.reauthentication={...login,subject:this.account.subject}
    return this.client
  }
  async request(path,method='GET',body,revision) {
    assert(path.startsWith('/api/v1/main/extensions/rbac/'),'only formal same-origin management API accepted')
    const relative=path.slice('/api/v1/main/extensions/rbac'.length)
    assert(!/^\/(?:identity|projects|policy|roles|bindings|role-mappings)(?:[/?]|$)/.test(relative),'obsolete management API is not accepted')
    assert(!relative.includes('/runtime-permissions')&&!relative.includes('/scope-declarations'),'retired parallel permission APIs are not accepted')
    assert(this.client,'fresh authenticated client required')
    const response=await this.client.request(path,{method,headers:{Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'}),...(revision===undefined?{}:{'If-Match':'"'+revision+'"'})},...(body===undefined?{}:{body:JSON.stringify(body)})})
    this.requests.push({path,method,status:response.status})
    if(this.onRequest)await this.onRequest(this.requests.at(-1))
    assert(response.ok,'management HTTP '+response.status+' '+method+' '+path)
    return response.status===204?null:response.json()
  }
  groupPath(group) {
    assert(typeof group==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(group),'exact application-group identifier required')
    return '/api/v1/main/extensions/rbac/application-groups/'+encodeURIComponent(group)
  }
  applicationPath(group,clientId='kestra-ui') {return this.groupPath(group)+'/applications/~'+Buffer.from(clientId).toString('base64url')}
  permissionsPath(group,clientId='kestra-ui') {return this.applicationPath(group,clientId)+'/permissions'}
  async readPermissions(group,clientId='kestra-ui') {
    const items=[];let total,parentRevision
    for(let page=1;;page++) {
      const response=await this.request(this.permissionsPath(group,clientId)+'?page='+page+'&size=100')
      assert(Array.isArray(response.items)&&Number.isSafeInteger(response.total)&&response.total>=0)
      assert(Number.isSafeInteger(response.parentRevision)&&response.parentRevision>0)
      if(total===undefined){total=response.total;parentRevision=response.parentRevision}
      else {assert.equal(response.total,total,'permission total drift');assert.equal(response.parentRevision,parentRevision,'permission snapshot drift')}
      items.push(...response.items)
      assert(items.length<=total,'permission list exceeds its authorized total')
      if(items.length===total)break
      assert(response.items.length>0,'permission pagination ended before total')
    }
    assert.equal(new Set(items.map(permission=>permission.key)).size,items.length,'duplicate permission across pages')
    return {items,total,parentRevision}
  }
  async reauthenticateGroup(group,{previousGroup}={}) {
    await this.login()
    const current=await this.request(this.groupPath(group))
    assert.equal(current.id,group)
    assert(Number.isSafeInteger(current.revision)&&current.revision>0)
    assert(Number.isSafeInteger(current.authorizationVersion)&&current.authorizationVersion>0)
    if(previousGroup) {
      assert(current.revision>previousGroup.revision,'directory mutation did not advance its object revision')
      assert(current.authorizationVersion>=previousGroup.authorizationVersion,'directory mutation decreased its revocation epoch')
    }
    const verified=await this.client.verifiedUiIdentity({applicationGroupId:applicationProject,subject:this.account.subject,audience:'kestra-ui'})
    if(group===applicationProject)assert.equal(verified.authorizationVersion,current.authorizationVersion,'fresh signed identity epoch differs')
    return {requests:[...this.requests],reauthentication:this.reauthentication,directoryRevision:current.revision,authorizationVersion:current.authorizationVersion}
  }
  async saveTypedPermission(group,scopeKey,definition) {
    assert(/^[a-z][a-z0-9-]{0,63}$/.test(scopeKey))
    assert.deepEqual(Object.keys(definition).sort(),['description','enabled','grants','managementGrants'])
    const path=this.permissionsPath(group),before=await this.readPermissions(group)
    const metadata=applicationPermission(scopeKey),existing=before.items.find(permission=>permission.key===metadata.key)
    const application=await this.request(this.applicationPath(group))
    const input={key:metadata.key,name:existing?.name??metadata.name,scopeKeys:[scopeKey],...structuredClone(definition)}
    const saved=await this.request(path+(existing?'/'+encodeURIComponent(metadata.key):''),existing?'PUT':'POST',input,existing?.revision??application.revision)
    assert.deepEqual(Object.keys(saved).sort(),['key','parentRevision','revision']);assert.equal(saved.key,metadata.key)
    assert(Number.isSafeInteger(saved.revision)&&saved.revision>=(existing?existing.revision+1:1))
    if(!existing || !semantic(existing.scopeKeys).includes(scopeKey) || semantic(existing.scopeKeys).length!==1)await this.reauthenticateGroup(group)
    const after=await this.readPermissions(group),stored=after.items.find(permission=>permission.key===metadata.key)
    assert(stored);assert.equal(stored.revision,saved.revision)
    assert.deepEqual(semantic(stored.scopeKeys),[scopeKey])
    for(const field of ['description','enabled','grants','managementGrants'])assert.deepEqual(semantic(stored[field]),semantic(definition[field]))
    for(const other of before.items.filter(permission=>permission.key!==metadata.key)) {
      const unchanged=after.items.find(permission=>permission.key===other.key)
      assert(unchanged,'editing one permission removed another')
      const content=permission=>Object.fromEntries(Object.entries(permission).filter(([field])=>field!=='parentRevision'))
      assert.deepEqual(semantic(content(unchanged)),semantic(content(other)))
    }
    return saved
  }
  async registerOrdinaryClient({clientId,audiences,applicationGroupScopes,registeredProtocolScopes,requestedProtocolScopes}) {
    assert(clientId&&clientId!=='kestra-ui','ordinary client must never inherit first-party UI selector')
    assert(!applicationGroupScopes.includes('kestra:application-group-scopes')&&!requestedProtocolScopes.includes('kestra:application-group-scopes'),'UI selector is first-party only')
    assert(requestedProtocolScopes.every(scope=>registeredProtocolScopes.includes(scope)),'requested protocol capability exceeds registered scope')
    assert.deepEqual(audiences,[this.base+'/api/v1/main/mcp/default'],'MCP audience must match the exact protected resource')
    await this.login()
    const path=this.groupPath(applicationProject),current=await this.request(path)
    await this.mutateDirectory(path+'/applications','POST',
      {clientId,description:'Ordinary acceptance application',audiences:[...audiences]},current.revision)
    for(const scopeKey of applicationGroupScopes) {
      await this.login()
      const application=await this.request(this.applicationPath(applicationProject,clientId))
      await this.request(this.permissionsPath(applicationProject,clientId),'POST',
        {...applicationPermission(scopeKey),scopeKeys:[scopeKey],details:''},application.revision)
    }
    this.registeredClientIds.set(clientId,[...applicationGroupScopes])
    return this.reauthenticateGroup(applicationProject,{previousGroup:current})
  }
  async removeOrdinaryClient(clientId) {
    assert(typeof clientId==='string'&&clientId&&clientId!=='kestra-ui','only an ordinary test application can be removed')
    await this.login()
    const path=this.applicationPath(applicationProject,clientId)
    const member=await this.request(path)
    assert.equal(member.clientId,clientId)
    const result=await this.mutateDirectory(path,'DELETE',undefined,member.revision)
    this.registeredClientIds.delete(clientId)
    return result
  }
  async mutateDirectory(path,method,body,revision,group=applicationProject) {
    const groupPath=this.groupPath(group)
    assert(path===groupPath||path.startsWith(groupPath+'/'),'exact application-group directory target required')
    assert(!path.includes('/permissions'),'directory mutation cannot update application permission data')
    assert(['POST','PUT','DELETE'].includes(method))
    await this.login()
    const before=await this.request(groupPath)
    await this.request(path,method,body,revision)
    return this.reauthenticateGroup(group,{previousGroup:before})
  }
}

export const fixtureGaps=Object.freeze([
  'formal application-group overlay promotion and compatible plugin CI artifact',
  'actual UI DOM, full theme/language/filter and zero-grant browser execution against formal products',
  'new-install group identity boundaries, supported scope intersection, revocation, refresh, dependency faults and no-side-effect checks against formal artifacts',
])

const semantic=value=>Array.isArray(value)?value.map(semantic).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):value&&typeof value==='object'?Object.fromEntries(Object.entries(value.scope==='TENANT'&&value.namespace===undefined?{...value,namespace:null}:value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,semantic(item)])):value
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
  const definitions=fixture.policy.applicationGroups[applicationProject].scopes
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

async function reusePreparedAccount(planned,management,account,prepared) {
  assert(prepared.verified&&prepared.passwordChangeCompleted,'Previously prepared account has not completed production password change')
  assert.equal(prepared.subject,account.subject);assert.equal(prepared.username,account.username)
  assert.equal(prepared.password,account.password,'Prepared account credential does not match the current isolated test configuration')
  const saved=await management.request(api+'/users/detail?subject='+encodeURIComponent(account.subject))
  assert.equal(saved.subject,account.subject);assert.equal(saved.active,true)
  assert(saved.revision>=prepared.revision,'Prepared account revision moved backwards')
  const login=await new ProductionOAuthClient(planned.base).login(account.username,account.password)
  assert.equal(login.authenticated,true)
  return {transport:'reused-frozen-production-account',passwordChangedBeforeBoundaryData:true,authenticated:true}
}

export async function provisionFixture({planned,effects,observer,preparedAccounts={},record=async()=>{}}) {
  assert(planned&&effects,'own activated deployment and observer required')
  const events=[]
  const management=new ApplicationGroupManagement(planned.base,planned.admin)
  management.registeredClientIds=new Map()
  management.onRequest=async()=>record({events,requests:[...management.requests],completed:false})
  await management.login()
  const emit=async event=>{events.push(event);await record({events,requests:[...management.requests],completed:false})}
  for(const test of projectScopeCases) {
    const account=planned.accounts[test.id]
    await management.login()
    let prepared
    if(Object.hasOwn(preparedAccounts,account.subject))prepared=await reusePreparedAccount(planned,management,account,preparedAccounts[account.subject])
    else {
      const created=await management.request(api+'/users','POST',{username:account.username,name:'Acceptance '+test.id,email:account.username+'@acceptance.invalid'})
      assert.equal(created.subject,account.subject,'created account subject differs')
      prepared=await new ProductionOAuthClient(planned.base).changeTemporaryPassword(account.username,created.temporaryPassword,account.password)
      delete created.temporaryPassword
    }
    const saved=await management.request(api+'/users/detail?subject='+encodeURIComponent(account.subject))
    assert.equal(saved.subject,account.subject);assert.equal(saved.active,true)
    await emit({kind:'account-created',caseId:test.id,subject:account.subject,revision:saved.revision,passwordPreparation:prepared})
    await management.reauthenticateGroup(applicationProject)
    const project=await management.request(api+'/application-groups/'+applicationProject)
    const receipt=await management.mutateDirectory(api+'/application-groups/'+applicationProject+'/scope-grants','POST',
      {issuer:planned.base,subject:account.subject,scopeKeys:[...test.scopes]},project.revision)
    await emit({kind:'subject-assigned',caseId:test.id,subject:account.subject,scopes:[...test.scopes],directoryRevision:receipt.directoryRevision,reauthentication:receipt.reauthentication})
  }
  const client=await management.login()
  const observerIdentity=await client.verifiedUiIdentity({applicationGroupId:applicationProject,subject:planned.admin.subject,audience:planned.expectedAudience})
  assert(observerIdentity.applicationGroupScopes.includes(planned.observerScope),'observer did not receive its explicit scope')
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
    await emit({kind:'output-execution-seed-response',namespace:probe.namespace,flowId:data.flowId,status:response.status})
    assert(response.ok,'output execution seed failed HTTP '+response.status+' for '+probe.namespace+'/'+data.flowId);const started=await response.json();assert(started.id)
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
  const prepareMcp=async()=>provisionMcpFixture({planned,management,effects,observer,preparedAccounts,record:async fragment=>record({events,requests:[...management.requests],seededFlows:resources.seeds.length,quiescentWindowMs:5000,mcp:fragment,completed:true})})
  return {prepareMcp,setEffects:current=>{effects=current},rest:{accounts:planned.accounts,observerAccount:planned.admin,expectedAudience:planned.expectedAudience,flowWrite:planned.flowWrite,probes:resources.probes,effects,effectsWindowMs:5000},management,planned}
}

export const mcpScenarioNames=Object.freeze(['allowed','capabilityOnly','projectOnly','knownUnbound','localRevoke','directoryRevoke','subjectRevoke'])
export const mcpRegisteredProtocolScopes=Object.freeze(['openid','mcp:flows:read','mcp:executions:write'])
export const mcpProtocolEvidence=Object.freeze({
  overlayCommit:'4b017f6d07d5689d971050cfbdcf30dcd9ec0f55',
  output:'patches/webserver/0170-mcp-capability-authorizer.patch: McpToolService returns ExecutionOutputService outputs as structuredContent',
  arguments:'webserver/src/main/java/io/kestra/mcp/McpToolService.java: buildCallHandler matches argument keys to flow input IDs',
  rpcDenial:{code:-32003,message:'Authorization denied'},
  toolDenial:{isError:true,content:[{type:'text',text:'Not permitted to execute this tool'}]},
  missingProviderFailure:{isError:true,content:[{type:'text',text:'Failed to execute flow'}]},
})
export function planMcpScenarios() {
  // Independent complete scopes are explicitly registered by the shared test
  // catalog. Existing REST scope semantics are never expanded.
  const revocationScopes={localRevoke:scopeNames.mcpLocalOperate,directoryRevoke:scopeNames.mcpDirectoryOperate,subjectRevoke:scopeNames.mcpSubjectOperate}
  for(const scope of Object.values(revocationScopes))assert(typeof scope==='string'&&scope.length,'explicit shared MCP revocation scope required')
  const target={allowed:'mcp-allowed',capabilityOnly:'mcp-allowed',projectOnly:'mcp-allowed',knownUnbound:'mcp-allowed',localRevoke:'mcp-local',directoryRevoke:'mcp-directory',subjectRevoke:'mcp-subject'}
  const tools=['acceptance-mcp-allowed','acceptance-mcp-local','acceptance-mcp-directory','acceptance-mcp-subject']
  const scopes={allowed:[scopeNames.writeB],capabilityOnly:[],projectOnly:[scopeNames.writeB],knownUnbound:[scopeNames.writeB,scopeNames.unbound],localRevoke:[revocationScopes.localRevoke],directoryRevoke:[revocationScopes.directoryRevoke],subjectRevoke:[revocationScopes.subjectRevoke]}
  const scenarios=Object.fromEntries(mcpScenarioNames.map(name=>[name,{applicationGroupScopes:scopes[name],protocolScopes:name==='projectOnly'?['openid']:[...mcpRegisteredProtocolScopes],expectedTools:name==='allowed'?tools:name==='capabilityOnly'||name==='projectOnly'||name==='knownUnbound'?[]:['acceptance-'+target[name]],
    call:{name:'acceptance-'+target[name],arguments:{marker:'mcp-acceptance-marker'},namespace:namespaceDomains.b,flowId:target[name],executionIdPath:'result.structuredContent.executionId',expectedExecutionFields:{'inputs.marker':'mcp-acceptance-marker','state.current':'SUCCESS'},expectedOutputs:{marker:'mcp-acceptance-marker'}}}]))
  const seeds=['allowed','localRevoke','directoryRevoke','subjectRevoke'].map(name=>({namespace:namespaceDomains.b,id:target[name],toolName:scenarios[name].call.name,source:mcpFlowSource(namespaceDomains.b,target[name],scenarios[name].call.name)}))
  return {scenarios,seeds,revocationScopes}
}
export function mcpFlowSource(namespace,id,toolName) {
  return `id: ${id}\nnamespace: ${namespace}\ndescription: Explicit MCP acceptance tool\ninputs:\n  - id: marker\n    type: STRING\n    required: true\ntasks:\n  - id: identity\n    type: io.kestra.plugin.core.debug.Return\n    format: "{{ execution.id }}"\n  - id: echo\n    type: io.kestra.plugin.core.debug.Return\n    format: "{{ inputs.marker }}"\noutputs:\n  - id: executionId\n    type: STRING\n    value: "{{ outputs.identity.value }}"\n  - id: marker\n    type: STRING\n    value: "{{ outputs.echo.value }}"\ntriggers:\n  - id: mcp\n    type: io.kestra.plugin.core.trigger.McpToolTrigger\n    mcpServer: default\n    toolName: ${toolName}\n    title: Explicit MCP acceptance\n    toolDescription: Executes a controlled flow and returns its persisted execution ID\n`
}

export async function provisionMcpFixture({planned,management,effects,observer,preparedAccounts={},record=async()=>{}}) {
  const pendingScopes=Object.values(planned.mcp.revocationScopes).filter(value=>!Object.values(scopeNames).includes(value))
  assert.equal(pendingScopes.length,0,'main-owned shared scopeNames must explicitly accept independent MCP revocation scopes: '+pendingScopes.join(', '))
  const journal=[]
  const emit=async event=>{journal.push(event);await record({events:journal,completed:false})}
  const refreshActor=async(client,account)=>{
    const login=await client.login(account.username,account.password)
    assert.equal(login.authenticated,true)
    const identity=await client.verifiedUiIdentity({applicationGroupId:applicationProject,subject:account.subject,audience:planned.expectedAudience})
    return {subject:identity.subject,authenticated:true,callbackPath:login.callbackPath}
  }
  const receipt=async(start,client,account)=>({requests:management.requests.slice(start).filter(row=>['POST','PUT','DELETE'].includes(row.method)),reauthentication:await refreshActor(client,account)})
  for(const name of mcpScenarioNames) {
    const account=planned.mcpAccounts[name]
    await management.login()
    let prepared
    if(Object.hasOwn(preparedAccounts,account.subject))prepared=await reusePreparedAccount(planned,management,account,preparedAccounts[account.subject])
    else {
      const created=await management.request(api+'/users','POST',{username:account.username,name:'MCP acceptance '+name,email:account.username+'@acceptance.invalid'})
      assert.equal(created.subject,account.subject)
      prepared=await new ProductionOAuthClient(planned.base).changeTemporaryPassword(account.username,created.temporaryPassword,account.password)
      delete created.temporaryPassword
    }
    await emit({kind:'mcp-account-password-prepared',scenario:name,subject:account.subject,transport:prepared.transport})
    await management.reauthenticateGroup(applicationProject)
    const project=await management.request(api+'/application-groups/'+applicationProject)
    await management.mutateDirectory(api+'/application-groups/'+applicationProject+'/scope-grants','POST',{issuer:planned.base,subject:account.subject,scopeKeys:[...planned.mcp.scenarios[name].applicationGroupScopes]},project.revision)
    await emit({kind:'mcp-account-assigned',scenario:name,subject:account.subject,scopeKeys:[...planned.mcp.scenarios[name].applicationGroupScopes]})
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
    const response=await management.saveTypedPermission(applicationProject,name,definition)
    planned.policy.applicationGroups[applicationProject].scopes[name]=structuredClone(definition)
    return response
  }
  const callback=async({kind,phase,client,account,registration,scope,subject})=>{
    assert.equal(phase,'mutate')
    const scenario=mcpScenarioNames.find(name=>planned.mcpAccounts[name].subject===account.subject)
    assert(scenario,'callback identity outside explicit MCP test account list')
    const spec=planned.mcp.scenarios[scenario];const start=management.requests.length
    if(kind==='approve-client') {
      assert(registration?.clientId&&registration.audiences?.length)
      assert.deepEqual([...registration.scopes].sort(),[...spec.applicationGroupScopes,...spec.protocolScopes].sort())
      assert(spec.protocolScopes.every(value=>mcpRegisteredProtocolScopes.includes(value)),'request exceeds the production helper DCR protocol registration')
      await management.registerOrdinaryClient({clientId:registration.clientId,audiences:registration.audiences,applicationGroupScopes:spec.applicationGroupScopes,registeredProtocolScopes:mcpRegisteredProtocolScopes,requestedProtocolScopes:spec.protocolScopes})
      const result=await receipt(start,client,account)
      result.restore=async()=>{
        const restoreStart=management.requests.length
        await management.removeOrdinaryClient(registration.clientId)
        return receipt(restoreStart,client,account)
      }
      await emit({kind,scenario,clientId:registration.clientId,applicationGroupScopes:[...spec.applicationGroupScopes]})
      return result
    }
    assert.equal(scope,spec.applicationGroupScopes[0]);assert.equal(subject,account.subject)
    assert(Object.values(planned.mcp.revocationScopes).includes(scope),'revoke only dedicated test scopes')
    if(kind==='revoke-application-scope-policy') {
      const original=structuredClone(planned.policy.applicationGroups[applicationProject].scopes[scope])
      await localScope(scope,{...original,enabled:false})
      const result=await receipt(start,client,account)
      result.restore=async()=>{const at=management.requests.length;await localScope(scope,original);return receipt(at,client,account)}
      await emit({kind,scenario,scope});return result
    }
    if(kind==='revoke-supported-scope') {
      const identity=await client.verifiedAccessIdentity({applicationGroupId:applicationProject,subject:account.subject})
      assert(identity.clientId&&management.registeredClientIds.has(identity.clientId),'revocation requires an actually registered application')
      await management.login()
      const applicationPath=management.applicationPath(applicationProject,identity.clientId)
      const originalApplication=await management.request(applicationPath)
      assert(originalApplication.supportedScopeKeys.includes(scope),'application did not register the scope being revoked')
      const path=management.permissionsPath(applicationProject,identity.clientId)+'/'+applicationPermission(scope).key
      const original=await management.request(path)
      const input={key:original.key,name:original.name,scopeKeys:original.scopeKeys.filter(key=>key!==scope),details:original.details}
      await management.request(path,'PUT',input,original.revision)
      await management.reauthenticateGroup(applicationProject)
      const reduced=await management.request(applicationPath)
      assert(!reduced.supportedScopeKeys.includes(scope),'last permission reference did not remove support')
      const result=await receipt(start,client,account)
      result.restore=async()=>{
        const at=management.requests.length;await management.login();const current=await management.request(path)
        await management.request(path,'PUT',{...input,scopeKeys:[...original.scopeKeys]},current.revision)
        await management.reauthenticateGroup(applicationProject)
        return receipt(at,client,account)
      }
      await emit({kind,scenario,scope,clientId:identity.clientId});return result
    }
    assert.equal(kind,'revoke-subject-scopes')
    await management.login()
    const path=api+'/application-groups/'+applicationProject+'/scope-grants/detail?subject='+encodeURIComponent(subject)
    const original=await management.request(path)
    await management.mutateDirectory(path,'PUT',{issuer:planned.base,subject,scopeKeys:[]},original.revision)
    const result=await receipt(start,client,account)
    result.restore=async()=>{const at=management.requests.length;await management.login();const current=await management.request(path);await management.mutateDirectory(path,'PUT',{issuer:planned.base,subject,scopeKeys:[...original.scopeKeys]},current.revision);return receipt(at,client,account)}
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
      const sql=`SELECT json_build_object('id',value->>'id','namespace',value->>'namespace','flowId',value->>'flowId','state',value->'state'->>'current','outputsStored',EXISTS(SELECT 1 FROM execution_outputs WHERE key='${id}' AND tenant_id='main' AND (octet_length(value)>0 OR length(uri)>0)))::text FROM executions WHERE value->>'id'='${id}' AND value->>'namespace'='${namespace}' AND value->>'flowId'='${flowId}'`
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
  for(const pattern of [/^(    enabled: )(true|false)$/m,/(    evaluation:\n      enabled: )(true|false)/,/(    application-groups:\n      enabled: )(true|false)/]) {
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
  const standard=['openid','profile','email'],allowed=[...standard,'kestra:application-group-scopes']
  assert(tokens.length===new Set(tokens).size&&tokens.every(value=>allowed.includes(value))&&standard.every(value=>tokens.includes(value)),'UI scopes must contain exactly the standard set, optionally the project selector')
  const scopes=enabled?'[openid, profile, email, "kestra:application-group-scopes"]':'[openid, profile, email]'
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

