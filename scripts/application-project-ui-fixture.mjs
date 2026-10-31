/** Root-only UI preparation. Uses production APIs after the REST/MCP matrices.
 * No browser/taskspace is created here. Importing this module has no side effects.
 * Candidate filter steps come from the PUBLIC npm design-system distribution;
 * their runtime DOM compatibility is deliberately not reported as verified.
 */
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {randomBytes,createHash} from 'node:crypto'
import {join,isAbsolute} from 'node:path'
import {applicationProject,scopeNames} from './application-project-cases.mjs'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {runTargetGroupBrowser,targetUiCheckIds} from './application-project-target-ui.mjs'
import {flowSource} from './application-project-fixture.mjs'
import {applicationProjectUiLocales,applicationProjectUiThemes,applicationProjectUiCaseIds,sanitizeApplicationProjectUiEvidence,waitForNativeStyleSettlement} from './application-project-ui-cases.mjs'
import {createEgoApplicationProjectAdapter,runApplicationProjectBrowser} from './application-project-browser-adapters.mjs'
export {frozenBaselinePlan,prepareFrozenBaseline,runPreparedFrozenBaselineUi} from './access-control-v3-frozen.mjs'

const api='/api/v1/main/extensions/rbac'
const key=value=>'~'+Buffer.from(value).toString('base64url')
const copy=value=>structuredClone(value)
const sha=value=>createHash('sha256').update(value).digest('hex')
const canonical=value=>Array.isArray(value)?value.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([name,item])=>[name,canonical(item)])):value
const equal=(a,b)=>assert.deepEqual(canonical(a),canonical(b))
const click=selector=>({action:'click',selector})
const fill=(selector,value)=>({action:'fill',selector,value})
const option=text=>click('[role="option"]:text-is('+JSON.stringify(text)+')')
export const uiScopeNames=Object.freeze({edit:'acceptance-ui-edit-v1',reference:'acceptance-ui-reference-v1'})
export const uiNamespaces=Object.freeze({initial:'scope.acceptance.ui.initial',edited:'scope.acceptance.ui.edited',reference:'scope.acceptance.ui.reference'})
export const uiLanguageNames=Object.freeze({en:'English',fr:'French',de:'German',pl:'Polish',it:'Italian',es:'Spanish',pt:'Portuguese',pt_BR:'Portuguese (Brazil)',ru:'Russian',zh_CN:'Chinese',ja:'Japanese',ko:'Korean',hi:'Hindi'})
// Reviewed translation expectations, embedded to avoid a runtime source dependency.
export const uiLocaleText=Object.freeze({
  "en": {
    "projects": "Application groups",
    "scopes": "scope",
    "clients": "Applications",
    "assignments": "Scope grants",
    "search": "Search",
    "save": "Save changes"
  },
  "de": {
    "projects": "Anwendungsgruppen",
    "scopes": "scope",
    "clients": "Anwendungen",
    "assignments": "Scope-Zuweisungen",
    "search": "Suchen",
    "save": "Änderungen speichern"
  },
  "es": {
    "projects": "Grupos de aplicaciones",
    "scopes": "scope",
    "clients": "Aplicaciones",
    "assignments": "Asignaciones de scopes",
    "search": "Buscar",
    "save": "Guardar cambios"
  },
  "fr": {
    "projects": "Groupes d’applications",
    "scopes": "scope",
    "clients": "Applications",
    "assignments": "Attributions de scopes",
    "search": "Rechercher",
    "save": "Enregistrer les modifications"
  },
  "hi": {
    "projects": "एप्लिकेशन समूह",
    "scopes": "scope",
    "clients": "अनुप्रयोग",
    "assignments": "Scope आवंटन",
    "search": "खोजें",
    "save": "बदलाव सहेजें"
  },
  "it": {
    "projects": "Gruppi di applicazioni",
    "scopes": "scope",
    "clients": "Applicazioni",
    "assignments": "Assegnazioni scope",
    "search": "Cerca",
    "save": "Salva modifiche"
  },
  "ja": {
    "projects": "アプリケーショングループ",
    "scopes": "scope",
    "clients": "アプリケーション",
    "assignments": "scope の付与",
    "search": "検索",
    "save": "変更を保存"
  },
  "ko": {
    "projects": "애플리케이션 그룹",
    "scopes": "scope",
    "clients": "애플리케이션",
    "assignments": "scope 부여",
    "search": "검색",
    "save": "변경 사항 저장"
  },
  "pl": {
    "projects": "Grupy aplikacji",
    "scopes": "scope",
    "clients": "Aplikacje",
    "assignments": "Przypisania scope",
    "search": "Szukaj",
    "save": "Zapisz zmiany"
  },
  "pt": {
    "projects": "Grupos de aplicações",
    "scopes": "scope",
    "clients": "Aplicações",
    "assignments": "Atribuições de scopes",
    "search": "Pesquisar",
    "save": "Guardar alterações"
  },
  "pt_BR": {
    "projects": "Grupos de aplicativos",
    "scopes": "scope",
    "clients": "Aplicativos",
    "assignments": "Atribuições de scopes",
    "search": "Pesquisar",
    "save": "Salvar alterações"
  },
  "ru": {
    "projects": "Группы приложений",
    "scopes": "scope",
    "clients": "Приложения",
    "assignments": "Назначения scope",
    "search": "Поиск",
    "save": "Сохранить изменения"
  },
  "zh_CN": {
    "projects": "应用组",
    "scopes": "scope",
    "clients": "应用",
    "assignments": "scope 授予",
    "search": "搜索",
    "save": "保存更改"
  }
})


const nsGrant=(namespace,resource,actions)=>({scope:'NAMESPACE',tenant:'main',namespace,descendants:false,resource,actions,ids:[],allIds:true})
const tenantGrant=resource=>({scope:'TENANT',tenant:'main',namespace:null,descendants:false,resource,actions:['READ','LIST'],ids:[],allIds:true})
const scopeDefinition=(description,grants)=>({description,enabled:true,grants,managementGrants:[]})
export function planApplicationProjectUi() {
  const ids=Array.from({length:28},(_,i)=>String(i+1).padStart(3,'0'))
  const edit=scopeDefinition('UI initial explicit application policy',[nsGrant(uiNamespaces.initial,'FLOW',['READ','LIST'])])
  const reference=scopeDefinition('UI reference page access',[
    ...['FLOW','EXECUTION','NAMESPACE','LOG','METRIC','TRIGGER','KVSTORE','NAMESPACE_FILE'].map(resource=>nsGrant(uiNamespaces.reference,resource,resource==='FLOW'?['READ','LIST','CREATE']:['READ','LIST'])),tenantGrant('METADATA'),tenantGrant('MCP_SERVER')])
  const accessDefinitions=Object.fromEntries([['identity-read','IDENTITY','READ'],['identity-manage','IDENTITY','MANAGE'],['local-read','LOCAL_POLICY','READ'],['local-manage','LOCAL_POLICY','MANAGE']].map(([name,domain,action])=>['acceptance-ui-'+name,{description:'UI separate '+domain+' '+action,enabled:true,grants:[],managementGrants:[{domain,actions:[action],applicationGroupIds:domain==='LOCAL_POLICY'?[applicationProject]:[]}]}]))
  accessDefinitions['acceptance-ui-local-read-manage']={description:'UI LOCAL_POLICY READ and MANAGE without IDENTITY.READ',enabled:true,grants:[],managementGrants:[{domain:'LOCAL_POLICY',actions:['READ','MANAGE'],applicationGroupIds:[applicationProject]}]}
  const directory=(key,definition)=>({key,name:key.replace(/^acceptance-/, '').split('-').map(word=>word[0].toUpperCase()+word.slice(1)).join(' '),description:definition.description})
  return {projects:ids.map(id=>({id:'ui-acceptance-group-'+id,tenant:'main',displayName:'UI acceptance group '+id,description:''})),
    scopes:[directory(uiScopeNames.edit,edit),directory(uiScopeNames.reference,reference),...Object.entries(accessDefinitions).map(([key,definition])=>directory(key,definition)),...ids.map(id=>directory('acceptance-ui-filter-'+id,scopeDefinition('UI filter scope '+id,[nsGrant(uiNamespaces.initial,'FLOW',['READ','LIST'])])))],
    users:ids.map(id=>({username:'ui-acceptance-user-'+id,name:'UI acceptance user '+id,email:'ui-acceptance-user-'+id+'@acceptance.invalid'})),
    clients:ids.map(id=>({client_name:'UI acceptance client '+id,redirect_uris:['http://127.0.0.1:19997/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:'openid'})),
    accessDefinitions,applicationPolicies:{[uiScopeNames.edit]:edit,[uiScopeNames.reference]:reference,...accessDefinitions},zeroAccount:{username:'ui-acceptance-zero',subject:'ui-acceptance-zero',name:'UI zero authorization',email:'ui-acceptance-zero@acceptance.invalid'}}
}

/** Concrete candidate actions from public KsFilter 0.5.0 dist components.
 * Each plan resets existing conditions via the real advanced filter control.
 * No URL query, router, sessionStorage or synthetic event is used to set filters.
 */
export function uiFilterPlans(records) {
  const fields={projects:{label:'Application group ID',field:'id'},permissions:{label:'Permission key',field:'key'},users:{label:'subject',field:'subject'},subjects:{label:'subject',field:'subject',records:'assignments'}}
  const plans={}
  for(const [section,definition]of Object.entries(fields)) {
    const {label,field}=definition,items=records[definition.records??section]
    assert(items.length>25,'actual directory must exceed 25: '+section)
    const first=items[25][field]
    const open=[fill('.ks-search input',''),{action:'open-advanced'},click('.adv-clear'),click('.adv-footer .adv-add:nth-child(1)')]
    const condition=(index,fieldLabel,comparator,value,enumerated=true)=>{
      const root='.adv-body .adv-row:nth-child('+index+')'
      const operation=section==='projects'?[click(root+' .cond-op .kel-select__wrapper'),option(comparator)]:[{action:'assert-comparator',selector:root+' .cond-op',value:comparator}]
      return [click(root+' .cond-field .kel-select__wrapper'),option(fieldLabel),...operation,...(enumerated?[click(root+' .cond-value-select .kel-select__wrapper'),option(value)]:[fill(root+' .cond-value-input input',value)]),{action:'wait-query-value',value}]
    }
    const close=click('.adv-header-close')
    plans[section]={equals:{steps:[...open,...condition(1,label,'Equals',first,section!=='projects'),close],expectedIds:[first]}}
    if(section==='projects') {
      const needle=first.slice(0,-1)
      plans[section].contains={steps:[...open,...condition(1,label,'Contains',needle,false),close],expectedIds:items.filter(item=>item.id.includes(needle)).map(item=>item.id)}
      plans[section].and={steps:[...open,...condition(1,label,'Contains',needle,false),click('.adv-footer .adv-add:nth-child(1)'),...condition(2,label,'Equals',first,false),close],expectedIds:[first]}
    }
    if(section==='permissions') {
      const name=items[25].name
      plans[section].contains={steps:[...open,...condition(1,'Permission name','Contains',name,false),close],expectedIds:items.filter(item=>item.name.includes(name)).map(item=>item.key)}
      plans[section].and={steps:[...open,...condition(1,'Permission name','Contains',name,false),click('.adv-footer .adv-add:nth-child(1)'),...condition(2,label,'Equals',first),close],expectedIds:[first]}
    }
  }
  return plans
}

export function uiBrowserFixture({base,admin,zeroAccount,clientId,subject,records,referenceEvidence}) {
  const pagination=Object.fromEntries(Object.entries({projects:'id',scopes:'key',clients:'clientId',assignments:'subject'}).map(([section,field])=>[section,records[section][25][field]]))
  return {admin:copy(admin),zeroAccount:copy(zeroAccount),applicationGroupId:applicationProject,currentApplicationClientId:'kestra-ui',scope:uiScopeNames.edit,clientId,subject,newScopeKey:'acceptance-ui-declared-empty',referenceScopeKey:uiScopeNames.reference,referenceNamespace:uiNamespaces.reference,
    edit:{description:'UI saved explicit namespace/action change',namespace:uiNamespaces.edited,actions:['READ','UPDATE']},
    loginFinalPath:'/ui/main/dashboards',reauthenticationPath:'/ui/access-denied',reauthenticationSteps:[click('[data-testid="return-to-login"]')],
    preferences:{path:'/ui/main/preferences',themes:{'dark-2':[click('.theme-picker button:nth-child(1)')],dark:[click('.theme-picker button:nth-child(2)')],light:[click('.theme-picker button:nth-child(3)')],system:[click('.theme-picker button:nth-child(4)')]},
      locales:Object.fromEntries(applicationProjectUiLocales.map(locale=>[locale,[click('.settings-block:last-child .setting-row:first-child .kel-select__wrapper'),option(uiLanguageNames[locale])]]))},
    localeText:copy(uiLocaleText),translationEvidence:{kind:'target-wording-expectations',status:'runtime-validation-required',artifactBinding:'parent acceptance image and jar hashes'},
    references:{mcpPath:'/ui/main/admin/mcp-servers/edit/default/edit',namespacesPath:'/ui/main/namespaces',flowsPath:'/ui/main/flows',kvPath:'/ui/main/kv',tab:'#tab-edit',button:'button.kel-button--primary',search:'.ks-search input',tableHeader:'.kel-table th',tableCell:'.kel-table tbody td'},
    records:copy(records),referenceEvidence,pagination,filters:uiFilterPlans(records),filterEvidence:{status:'candidate-public-component-structure; runtime DOM not yet verified',components:['CustomizeFilters','AdvancedFilterBuilder','ConditionRow'],package:'@kestra-io/design-system',version:'0.5.0'},
    expectedRequestErrors:[],
    base,expectedBrowserErrors:[]}
}

async function prepareUiData({base,management,planned,completedFragments,isolation,record}) {
  assert.equal(typeof record,'function','persistent preparation report required')
  assert.equal(management.base,base);assert.equal(planned.base,base)
  assert(completedFragments?.rest?.completed&&completedFragments.rest.matrix?.length===56&&completedFragments.rest.matrix.every(row=>row.passed&&row.status==='passed'&&row.skipped===undefined&&row.transport==='rest'),'prepare UI only after actual REST56 completion')
  assert(completedFragments?.mcp?.checks?.length>=11&&completedFragments.mcp.checks.some(row=>['passed','failed'].includes(row.status)),'actual MCP execution evidence must be retained before independent UI checks')
  assert(completedFragments?.frozenUiBaseline?.completed===true&&completedFragments.frozenUiBaseline.passed===true&&completedFragments.frozenUiBaseline.status==='passed'&&completedFragments.frozenUiBaseline.phase==='before-boundary-data','run the independent frozen UI baseline before adding boundary test data; final random totals are not frozen-data evidence')
  assert(/^application-projects-bb-[0-9]+-[0-9]+$/.test(isolation?.composeProject??''),'own isolated Compose UI data preparation required')
  assert(typeof management.saveTypedPermission==='function'&&typeof management.readPermissions==='function'&&typeof management.reauthenticateGroup==='function'&&management.registeredClientIds instanceof Map,'v3 application-group management helper required')
  const origin=new URL(base);assert.equal(origin.origin,base);assert(['localhost','127.0.0.1'].includes(origin.hostname));assert(Number(origin.port)>1024)
  const inspect=(format,id)=>execFileSync('docker',['inspect','-f',format,id],{encoding:'utf8'}).trim()
  for(const id of [isolation.kestraContainer,isolation.postgresContainer]){assert(/^[a-f0-9]{12,64}$/.test(id??''));assert.equal(inspect('{{index .Config.Labels "com.docker.compose.project"}}',id),isolation.composeProject)}
  const ports=JSON.parse(inspect('{{json .NetworkSettings.Ports}}',isolation.kestraContainer))
  assert(ports['8080/tcp']?.some(binding=>binding.HostPort===origin.port&&binding.HostIp==='127.0.0.1'),'UI API base is not the owned loopback deployment port')
  const spec=planApplicationProjectUi(),events=[]
  const credentialSecrets=[planned.admin.password]
  const emit=async event=>{events.push(event);await record(sanitizeApplicationProjectUiEvidence({completed:false,events,requests:[...management.requests]},credentialSecrets))}
  const baseline=copy(planned.policy.applicationGroups[applicationProject].scopes)
  const protectedScopes={}
  await management.login()
  for(const scope of [scopeNames.identityManager,scopeNames.policyManager])protectedScopes[scope]=await management.request(api+'/application-groups/'+applicationProject+'/scopes/'+encodeURIComponent(scope))
  let failure
  try {
    for(const project of spec.projects) {
      await management.login()
      const before=await management.readPermissions(applicationProject)
      await management.request(api+'/application-groups','POST',project)
      await management.reauthenticateGroup(applicationProject)
      const after=await management.readPermissions(applicationProject)
      equal(after,before)
      await emit({kind:'application-group-created',applicationGroupId:project.id,actualPolicyCreated:false,parentRevision:after.parentRevision})
    }
    for(const scope of spec.scopes) {
      await management.login()
      const project=await management.request(api+'/application-groups/'+applicationProject)
      await management.mutateDirectory(api+'/application-groups/'+applicationProject+'/scopes','POST',scope,project.revision)
      const actual=spec.applicationPolicies[scope.key]
      if(actual) {
        await management.saveTypedPermission(applicationProject,scope.key,actual)
        planned.policy.applicationGroups[applicationProject].scopes[scope.key]=copy(actual)
      }
      await emit({kind:'ui-scope-created',scopeKey:scope.key,actualPolicySaved:Boolean(actual)})
    }
    await management.login()
    const uiPath=api+'/application-groups/'+applicationProject+'/applications/'+key('kestra-ui')
    const ui=await management.request(uiPath)
    assert(ui.clientId==='kestra-ui'&&!Object.hasOwn(ui,'approved'))
    for(const scope of spec.scopes) {
      if(!spec.applicationPolicies[scope.key])await management.saveTypedPermission(applicationProject,scope.key,scopeDefinition(scope.description,[]))
    }
    const clients=[]
    for(const registrationInput of spec.clients) {
      const client=await management.login()
      const response=await client.request('/oidc/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(registrationInput)})
      assert.equal(response.status,201);const registered=await response.json()
      assert(registered.client_id&&!registered.client_secret);assert.equal(registered.token_endpoint_auth_method,'none')
      await management.registerOrdinaryClient({clientId:registered.client_id,audiences:[base+'/api/v1/main/mcp/default'],applicationGroupScopes:[uiScopeNames.edit],registeredProtocolScopes:['openid'],requestedProtocolScopes:['openid']})
      planned.policy.applicationGroups[applicationProject].audiences=['kestra-ui',base+'/api/v1/main/mcp/default']
      if(clients.length<2){
        const owner=new ProductionOAuthClient(base)
        const issued=await owner.issueMcpScopes(['openid'],undefined,current=>current.login(planned.admin.username,planned.admin.password),{registeredClient:registered})
        assert.deepEqual(issued.issuedScopes,['openid'])
        const owned=await owner.request('/'+'oidc/clients/'+encodeURIComponent(registered.client_id))
        assert.equal(owned.status,200)
        const details=await owned.json();assert.equal(details.client_id??details.clientId,registered.client_id)
        await emit({kind:'ui-client-owner-consent-completed',clientId:registered.client_id,productionS256:true,issuedScopes:issued.issuedScopes,ownerOnlyDetailStatus:owned.status})
      }
      clients.push(registered.client_id);await emit({kind:'ui-member-created',clientId:registered.client_id,supportedScopeKeys:[uiScopeNames.edit]})
    }
    const unassignedClientId=clients.shift()
    await management.removeOrdinaryClient(unassignedClientId)
    await emit({kind:'ui-existing-client-reserved-for-browser-registration',clientId:unassignedClientId})
    const subjects=[]
    for(const user of spec.users) {
      await management.login();const created=await management.request(api+'/users','POST',user)
      assert.equal(created.subject,user.username);assert.equal(typeof created.temporaryPassword,'string');credentialSecrets.push(created.temporaryPassword);await management.reauthenticateGroup(applicationProject)
      const project=await management.request(api+'/application-groups/'+applicationProject)
      await management.mutateDirectory(api+'/application-groups/'+applicationProject+'/scope-grants','POST',{issuer:base,subject:created.subject,scopeKeys:[uiScopeNames.edit]},project.revision)
      subjects.push(created.subject);await emit({kind:'ui-subject-assigned',subject:created.subject,scopeKeys:[uiScopeNames.edit]})
    }
    const accessAccounts={}
    for(const scopeKey of Object.keys(spec.accessDefinitions)) {
      const username='ui-'+scopeKey,password=randomBytes(24).toString('base64url')+'Aa1!'
      await management.login();const created=await management.request(api+'/users','POST',{username,name:username,email:username+'@acceptance.invalid'})
      assert.equal(typeof created.temporaryPassword,'string');credentialSecrets.push(created.temporaryPassword,password)
      const client=new ProductionOAuthClient(base);await client.changeTemporaryPassword(username,created.temporaryPassword,password)
      await management.login();const group=await management.request(api+'/application-groups/'+applicationProject)
      await management.mutateDirectory(api+'/application-groups/'+applicationProject+'/scope-grants','POST',{issuer:base,subject:created.subject,scopeKeys:[scopeKey]},group.revision)
      accessAccounts[scopeKey.replace('acceptance-ui-','')]={username,subject:created.subject,password}
      await emit({kind:'ui-read-manage-separate-account-prepared',subject:created.subject,scopeKey})
    }
    await management.login();const zero=spec.zeroAccount
    const zeroCreated=await management.request(api+'/users','POST',{username:zero.username,name:zero.name,email:zero.email});assert.equal(zeroCreated.subject,zero.subject)
    assert.equal(typeof zeroCreated.temporaryPassword,'string');credentialSecrets.push(zeroCreated.temporaryPassword)
    zero.password=randomBytes(24).toString('base64url')+'Aa1!';credentialSecrets.push(zero.password)
    const zeroClient=new ProductionOAuthClient(base)
    await zeroClient.changeTemporaryPassword(zero.username,zeroCreated.temporaryPassword,zero.password)
    await management.reauthenticateGroup(applicationProject)
    const assigned=await management.request(api+'/application-groups/'+applicationProject+'/scope-grants/detail?subject='+encodeURIComponent(planned.admin.subject))
    await management.mutateDirectory(api+'/application-groups/'+applicationProject+'/scope-grants/detail?subject='+encodeURIComponent(planned.admin.subject),'PUT',{issuer:base,subject:planned.admin.subject,scopeKeys:[...new Set([...assigned.scopeKeys,uiScopeNames.reference])]},assigned.revision)
    const adminClient=await management.login()
    const adminIdentity=await adminClient.verifiedUiIdentity({applicationGroupId:applicationProject,subject:planned.admin.subject,audience:'kestra-ui'})
    assert(adminIdentity.applicationGroupScopes.includes(uiScopeNames.reference),'new reference scope was not signed after declaration and user assignment')
    const seeded=await adminClient.request('/api/v1/main/flows',{method:'POST',headers:{'Content-Type':'application/x-yaml'},body:flowSource(uiNamespaces.reference,'ui-reference-row')})
    assert(seeded.ok,'reference flow creation denied with status '+seeded.status)
    await seeded.body?.cancel()
    const actualZero=await zeroClient.verifiedUiIdentity({applicationGroupId:applicationProject,subject:zero.subject,audience:'kestra-ui'});assert.deepEqual(actualZero.applicationGroupScopes,[])
    const zeroDenied=await zeroClient.request('/api/v1/main/flows/search?size=1');assert.equal(zeroDenied.status,403);await zeroDenied.body?.cancel()
    await emit({kind:'zero-account-production-identity',subject:zero.subject,applicationGroupScopes:actualZero.applicationGroupScopes,businessStatus:403,firstPasswordChange:'http-form-preparation-not-T5'})
    await management.login()
    const all=async path=>{
      const items=[];let total,revision
      for(let page=1;;page++) {const value=await management.request(path+'?page='+page+'&size=100');assert(Array.isArray(value.items)&&Number.isSafeInteger(value.total));const current=value.directoryRevision;assert(Number.isSafeInteger(current)||path===api+'/users'&&page===1&&value.total<=100,'directory snapshot revision missing');total??=value.total;revision??=current;assert.equal(value.total,total);assert.equal(current,revision,'directory snapshot drift');items.push(...value.items);if(items.length===total)return items;assert(value.items.length&&items.length<total,'directory pagination stalled')}
    }
    const records={projects:await all(api+'/application-groups'),scopes:await all(api+'/application-groups/'+applicationProject+'/scopes'),clients:await all(api+'/application-groups/'+applicationProject+'/applications'),assignments:await all(api+'/application-groups/'+applicationProject+'/scope-grants'),users:await all(api+'/users'),permissions:(await management.readPermissions(applicationProject)).items}
    for(const [section,items]of Object.entries(records))assert(items.length>25,'insufficient real UI data: '+section)
    for(const scope of [scopeNames.identityManager,scopeNames.policyManager])equal(await management.request(api+'/application-groups/'+applicationProject+'/scopes/'+encodeURIComponent(scope)),protectedScopes[scope])
    for(const [scope,definition]of Object.entries(baseline))equal(planned.policy.applicationGroups[applicationProject].scopes[scope],definition)
    const fixture=uiBrowserFixture({base,admin:planned.admin,zeroAccount:zero,clientId:clients[0],subject:subjects[0],records,referenceEvidence:{status:'measure-current-formal-host-through-same-adapter; no historical styles consumed'}})
    fixture.unassignedClientId=unassignedClientId
    fixture.accessAccounts=accessAccounts
    fixture.frozenUiBaseline=completedFragments.frozenUiBaseline??null
    fixture.firstPasswordChange={path:'/oidc/password',newPassword:'input[name="password"]',confirmPassword:'input[name="confirmation"]',submit:'button[type="submit"]'}
    await record({completed:true,events,requests:[...management.requests],counts:Object.fromEntries(Object.entries(records).map(([section,items])=>[section,items.length])),created:{projects:spec.projects.length,scopes:spec.scopes.length,clients:clients.length,assignments:subjects.length},filtersRuntimeVerified:false,zeroBrowserLogoutVerified:false})
    return fixture
  }catch(error){failure=String(error.message);throw error}
  finally{if(failure)await record({completed:false,events,requests:[...management.requests],failure})}
}

/** Keep precondition failures as well as partial API evidence for local callers. */
export async function prepareApplicationProjectUi(options) {
  assert.equal(typeof options.record,'function','persistent UI preparation report callback required')
  let last={completed:false,events:[],requests:[]}
  const record=async fragment=>{last=copy(fragment);await options.record(fragment)}
  await record(last)
  try{return await prepareUiData({...options,record})}
  catch(error){
    const text=String(error.message).replaceAll(options.planned?.admin?.password??'\u0000','[redacted]').replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted-jwt]')
    await options.record({...last,completed:false,failure:text});throw new Error(text)
  }
}

export function initialApplicationProjectUiReport() {
  return {completed:false,ui:applicationProjectUiCaseIds.map(name=>{
    const combination=name.match(/^ui-theme-language-(light|dark-2|dark|system)-(.+)$/)
    return {name,case:combination?'theme-language':name,...(combination?{theme:combination[1],locale:combination[2]}:{}),passed:false,status:'not_run'}
  }),zeroGrant:{case:'ui-zero-grant-logout-switch',passed:false,status:'not_run'},target:{completed:false,checks:targetUiCheckIds.map(id=>({id,name:id,case:id,passed:false,status:'not_run',evidence:{}}))}}
}
export async function runZeroGrantBrowser(page,base,fixture) {
  const source=()=>page.evaluate(()=>({path:location.pathname,url:location.origin+location.pathname,queryKeys:[...new URL(location.href).searchParams.keys()],timeOrigin:performance.timeOrigin}))
  const sameDocumentPath=(event,document)=>{try{const url=new URL(event.url);return url.origin+url.pathname===document.url}catch{return false}}
  const previous=new Set((await page.diagnostics()).events.map(event=>event.id))
  async function signOut(requireClick) {
    await page.goto(base+'/ui/access-denied')
    await page.waitForFunction(()=>Boolean(document.querySelector('input[name="username"]'))||Boolean(document.querySelector('[data-testid="return-to-login"]')))
    const alreadyAnonymous=await page.evaluate(()=>Boolean(document.querySelector('input[name="username"]')))
    assert(!requireClick||!alreadyAnonymous,'zero-account session vanished before the required real logout click')
    if(!alreadyAnonymous)await page.click('[data-testid="return-to-login"]')
    await page.waitForFunction(()=>Boolean(document.querySelector('input[name="username"]'))&&Boolean(document.querySelector('input[name="password"]')))
    return !alreadyAnonymous
  }
  const login=async account=>{
    await page.fill('input[name="username"]',account.username);await page.fill('input[name="password"]',account.password);await page.click('button[type="submit"]')
  }
  await signOut(false)
  await login(fixture.zeroAccount)
  await page.waitForFunction(()=>location.pathname==='/ui/access-denied'&&!document.querySelector('input[name="password"]')&&Boolean(document.querySelector('[data-testid="return-to-login"]')))
  const rejectedDocument=await source()
  const beforeDenial=(await page.diagnostics()).events
  rejectedDocument.documentId=[...beforeDenial].reverse().find(event=>['document-navigation','document-route'].includes(event.kind)&&sameDocumentPath(event,rejectedDocument))?.documentId
  assert(rejectedDocument.documentId,'zero-grant document identity missing')
  const path='/api/v1/main/flows/search?size=1'
  const denial=await page.evaluate(async path=>{const response=await fetch(path,{credentials:'same-origin',redirect:'manual'});await response.body?.cancel();return {status:response.status}},path)
  assert.equal(denial.status,403,'zero-account session acquired business access')
  const clicked=await signOut(true)
  const anonymousDocument=await source()
  const anonymousEvents=(await page.diagnostics()).events
  anonymousDocument.documentId=[...anonymousEvents].reverse().find(event=>['document-navigation','document-route'].includes(event.kind)&&sameDocumentPath(event,anonymousDocument))?.documentId
  assert(anonymousDocument.documentId,'anonymous login document identity missing')
  const anonymous=await page.evaluate(async path=>{const response=await fetch(path,{credentials:'same-origin',redirect:'manual'});await response.body?.cancel();return {status:response.status}},path)
  assert([0,401].includes(anonymous.status),'logout did not clear authenticated access; 403 alone cannot establish session clearing')
  await login(fixture.admin)
  await page.waitForFunction(path=>location.pathname===path&&!document.querySelector('input[name="password"]'),'/'+['ui','main','dashboards'].join('/'))
  const verified=await page.evaluate(async path=>{const response=await fetch(path,{credentials:'same-origin',redirect:'manual'});return {status:response.status,body:await response.json()}},api+'/capabilities')
  assert.equal(verified.status,200);assert.equal(verified.body.subject,fixture.admin.subject);assert.equal(verified.body.allowed,true)
  assert.notEqual(fixture.zeroAccount.subject,fixture.admin.subject)
  const events=(await page.diagnostics()).events.filter(event=>!previous.has(event.id))
  const expectedUrl=base+path
  const errors=events.filter(event=>['console-error','page-error','request-failed','http-error','diagnostic-integrity-error'].includes(event.kind))
  const expectedHttp=errors.filter(event=>event.kind==='http-error'&&event.url===expectedUrl&&((event.status===403&&event.documentId===rejectedDocument.documentId)||(anonymous.status===401&&event.status===401&&event.documentId===anonymousDocument.documentId)))
  const logoutCapabilityDenial=errors.filter(event=>event.kind==='http-error'&&event.status===401&&event.method==='GET'
    &&event.url===base+api+'/capabilities'&&event.documentId===anonymousDocument.documentId
    &&event.documentUrl===base+'/ui/access-denied'&&anonymous.status===401)
  const zeroLoginConfigDenial=errors.filter(event=>event.kind==='http-error'&&event.status===403&&event.method==='GET'&&event.url===base+'/'+['api','v1','configs'].join('/')&&event.documentUrl===base+'/'+['ui',''].join('/'))
  const classifiedConsole=errors.filter(event=>event.kind==='console-error'&&event.source==='network'&&event.requestId&&/^Failed to load resource: the server responded with a status of (401|403) /.test(event.message)&&[...expectedHttp,...zeroLoginConfigDenial,...logoutCapabilityDenial].some(http=>http.requestId===event.requestId&&http.documentId===event.documentId&&http.url===event.url))
  const teardownPaths=[path,'/'+['api','v1','main','extensions','rbac','capabilities'].join('/'),'/'+['api','v1','main','dashboards','charts','preview'].join('/')]
  const abortedNavigation=errors.filter(event=>event.kind==='request-failed'&&event.message==='net::ERR_ABORTED'&&(teardownPaths.some(value=>event.url===base+value)||event.resourceType==='Script'&&event.url.startsWith(base+'/'+['ui','assets',''].join('/'))||event.url.startsWith('https://api.kestra.io/v1/feeds?'))&&events.some(item=>item.kind==='document-navigation'&&item.documentId!==event.documentId&&Math.abs(Date.parse(item.observedAt)-Date.parse(event.observedAt))<1000))
  const teardownConsole=errors.filter(event=>event.kind==='console-error'&&event.url.startsWith(base+'/'+['ui','main','dashboards'].join('/'))&&event.message.includes('TypeError: Failed to fetch')&&abortedNavigation.some(item=>item.documentId===event.documentId))
  const unexpected=errors.filter(event=>!expectedHttp.includes(event)&&!zeroLoginConfigDenial.includes(event)&&!logoutCapabilityDenial.includes(event)&&!classifiedConsole.includes(event)&&!abortedNavigation.includes(event)&&!teardownConsole.includes(event))
  assert.equal(unexpected.length,0,'zero-grant browser has unclassified document/request errors: '+JSON.stringify(unexpected))
  return {case:'ui-zero-grant-logout-switch',passed:true,status:'passed',evidence:{subject:fixture.zeroAccount.subject,rejectedDocument,businessStatus:denial.status,realSignOutClicked:clicked,anonymousStatus:anonymous.status,anonymousDocument,replacementSubject:verified.body.subject,final:await source(),expectedErrorEventIds:[...expectedHttp,...zeroLoginConfigDenial,...logoutCapabilityDenial,...classifiedConsole,...abortedNavigation,...teardownConsole].map(event=>event.id),events}}
}

export async function runPreparedApplicationProjectUi(adapter,base,fixture,record) {
  assert.equal(typeof record,'function')
  adapter.redactSecrets([fixture.admin.password,fixture.zeroAccount.password])
  const safe=error=>String(error.message??error).replaceAll(fixture.admin.password,'[redacted]').replaceAll(fixture.zeroAccount.password,'[redacted]').replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted-jwt]')
  const report=initialApplicationProjectUiReport()
  const merge=fragment=>{
    report.shared=fragment
    const pending=initialApplicationProjectUiReport().ui
    for(const row of fragment.ui??[]) {const index=pending.findIndex(item=>item.case===row.case&&item.theme===row.theme&&item.locale===row.locale);if(index>=0)pending[index]=row;else pending.push(row)}
    report.ui=pending
  }
  let failure
  await record(copy(report))
  try{await runApplicationProjectBrowser(adapter,base,fixture,async fragment=>{merge(fragment);await record(copy(report))});report.currentHostReferences=await measureCurrentHostReferences(adapter,base,fixture,async evidence=>{report.currentHostReferences=evidence;await record(copy(report))});await record(copy(report))}catch(error){failure=error;report.failure=safe(error)}
  try{report.zeroGrant=await runZeroGrantBrowser(adapter,base,fixture)}catch(error){report.zeroGrant={case:'ui-zero-grant-logout-switch',passed:false,status:'failed',error:safe(error)};failure??=error;await adapter.captureFailure(error,'zero-grant-browser-failure')}
  finally{
    report.ui.push(report.zeroGrant)
    if(fixture.targetRuntime){
      try{report.target=await runTargetGroupBrowser(adapter,base,fixture,fixture.targetRuntime,async fragment=>{report.target=fragment;await record(copy(report))})}
      catch(error){report.target={completed:false,checks:targetUiCheckIds.map(id=>({id,passed:false,status:'failed',evidence:{error:safe(error)}}))};failure??=error}
    }else report.target={completed:false,checks:targetUiCheckIds.map(id=>({id,passed:false,status:'not_run',evidence:{reason:'caller must provide real root targetRuntime management/planned context'}}))}
    report.ui.push(...report.target.checks.map(row=>({...row,case:row.id,name:row.id})))
    report.completed=report.target.completed===true&&report.shared?.completed===true&&report.zeroGrant.passed===true&&!failure
    report.adapterDiagnostics=await adapter.diagnosticEvidenceReference().catch(error=>({captureFailure:String(error.message)}))
    if(report.adapterDiagnostics.captureFailure||report.adapterDiagnostics.integrity!==0)report.completed=false
    report.adapterArtifacts=adapter.artifactReferences();await record(copy(report))
  }
  if(failure)throw new Error(safe(failure))
  assert(report.completed,'shared UI or zero-grant checks incomplete')
  return report
}

/** The caller supplies an EXISTING Ego Page. Does not create a space or own it. */
export async function runApplicationProjectUiWithEgo(page,base,fixture,{artifactDirectory,record,browserCdp}={}) {
  assert.equal(typeof browserCdp,'function','full Ego UI requires existing Task-level browserCdp(method,params)')
  const adapter=await createEgoApplicationProjectAdapter(page,{artifactDirectory,browserCdp,secrets:[fixture.admin.password,fixture.zeroAccount.password]})
  try{return await runPreparedApplicationProjectUi(adapter,base,fixture,record)}finally{await adapter.dispose()}
}

export async function runFrozenBaselineWithEgo(page,base,prepared,{artifactDirectory,record,browserCdp}={}) {
  assert(isAbsolute(artifactDirectory),'explicit absolute Ego artifact directory required')
  const adapter=await createEgoApplicationProjectAdapter(page,{artifactDirectory,browserCdp,secrets:[prepared.admin.password]})
  try {
    const {runPreparedFrozenBaselineUi}=await import('./access-control-v3-frozen.mjs')
    return await runPreparedFrozenBaselineUi(adapter,base,prepared,record)
  }finally{await adapter.dispose()}
}

/** Derive only equivalent root checks from actual complete browser evidence. */
export function uiRootChecks(report) {
  const rows=report?.ui??[]
  const groups={
    'production-ui-login-canonical-path':['production-ui-login-canonical-path'],
    'ui-permission-typed-save-refresh':['ui-permission-typed-save-refresh'],
    'ui-application-register-remove':['ui-application-register-remove'],
    'ui-subject-grant-revoke':['ui-subject-grant-revoke'],
    'ui-zero-grant-logout-switch':['ui-zero-grant-logout-switch'],
    'ui-permission-runtime-projection':['ui-permission-runtime-projection'],
    'ui-subject-runtime-revoke':['ui-subject-runtime-revoke'],
    'ui-narrow':applicationProjectUiThemes.flatMap(theme=>applicationProjectUiLocales.map(locale=>'ui-theme-language-'+theme+'-'+locale)),
    'ui-filter-search-pagination':['ui-filter-any-and-deeplink','ui-pagination-total-snapshot','ui-sidebar-search-pagination','ui-card-search-pagination','ui-filter-native-deeplink-coexistence','ui-filter-native-history',...applicationProjectUiCaseIds.filter(name=>name.startsWith('ui-native-filter-'))],
    'ui-empty-loading-error-conflict':['ui-empty-grants-no-policy-change','ui-scope-create-delete-reference-guard','ui-409-412-no-side-effects','ui-loading-transition','ui-403-no-side-effects','ui-503-retry-no-side-effects'],
  }
  for(const name of applicationProjectUiCaseIds.filter(name=>!name.startsWith('ui-theme-language-')))groups[name]??=[name]
  for(const theme of applicationProjectUiThemes)groups['ui-'+theme]=applicationProjectUiLocales.map(locale=>'ui-theme-language-'+theme+'-'+locale)
  groups['ui-languages']=applicationProjectUiThemes.flatMap(theme=>groups['ui-'+theme])
  groups['ui-keyboard-focus']=[...groups['ui-languages'],'ui-four-drawers-focus-discard','ui-four-drawers-draft-discard']
  return Object.entries(groups).map(([id,names])=>{
    const selected=names.map(name=>rows.find(row=>(row.name??row.case)===name))
    const passed=selected.every(row=>row?.passed===true&&row.status==='passed')
    return {id,passed,status:passed?'passed':selected.some(row=>row?.status==='failed')?'failed':'not_run',evidence:{source:'actual-shared-ui-and-zero-grant-rows',rows:names,observed:selected.filter(Boolean).length}}
  })
}

/** Root Compose + UI entry for a caller-owned existing task-space Page.
 * No new Page/TaskSpace is opened and user focus is retained.
 * onReport receives the persisted report path and a credential-free snapshot.
 * The caller remains responsible for starting with a real anonymous UI session.
 */
export async function runRootApplicationProjectWithEgo(page,argv,{artifactDirectory,onReport,browserCdp}={}) {
  assert(isAbsolute(artifactDirectory),'explicit absolute Ego artifact directory required')
  assert.equal(typeof browserCdp,'function','full Ego UI requires existing Task-level browserCdp(method,params)')
  const adapter=await createEgoApplicationProjectAdapter(page,{artifactDirectory,browserCdp})
  try {
    const {main}=await import('./blackbox-application-projects.mjs')
    return await main(argv,{uiAdapter:adapter,onReport})
  } finally {await adapter.dispose()}
}

/** Measure the current deployment using the SAME authenticated adapter after
 * canonical login has already been asserted by the shared matrix. Shared cases
 * additionally measure these pages during EACH theme/language combination.
 */
export async function measureCurrentHostReferences(adapter,base,fixture,record=async()=>{}) {
  const definitions=[['mcp',fixture.references.mcpPath,{tab:fixture.references.tab,button:fixture.references.button}],['namespaces',fixture.references.namespacesPath,{search:fixture.references.search}],['flows',fixture.references.flowsPath,{header:fixture.references.tableHeader,cell:fixture.references.tableCell}]]
  const measured={status:'running',pages:[]}
  const known=new Set((await adapter.diagnostics()).events.map(event=>event.id))
  await record(copy(measured))
  for(const [kind,path,selectors]of definitions) {
    await adapter.goto(new URL(path,base).href)
    await adapter.waitForFunction(({path,selectors})=>location.pathname===path&&Object.values(selectors).every(selector=>{const node=document.querySelector(selector);return node&&node.getClientRects().length>0}),{path,selectors})
    await waitForNativeStyleSettlement(adapter,selectors,{shadow:false})
    const evidence=await adapter.evaluate(({selectors})=>({path:location.pathname,url:location.href,timeOrigin:performance.timeOrigin,styles:Object.fromEntries(Object.entries(selectors).map(([name,selector])=>{
      const node=document.querySelector(selector),style=getComputedStyle(node),box=node.getBoundingClientRect()
      return [name,{selector,tag:node.tagName,role:node.getAttribute('role'),text:node.textContent.trim(),fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,color:style.color,background:style.backgroundColor,padding:style.padding,borderRadius:style.borderRadius,borderBottomStyle:style.borderBottomStyle,borderBottomWidth:style.borderBottomWidth,width:box.width,height:box.height}]
    }))}),{selectors})
    assert.equal(evidence.path,path);measured.pages.push({kind,...evidence});await record(copy(measured))
  }
  measured.events=(await adapter.diagnostics()).events.filter(event=>!known.has(event.id))
  const navigationAborts=measured.events.filter(event=>event.kind==='request-failed'&&event.message==='net::ERR_ABORTED'&&event.url.startsWith('https://api.kestra.io/v1/feeds?')&&measured.events.some(request=>request.kind==='request'&&request.requestId===event.requestId&&request.documentId===event.documentId&&request.url===event.url)&&measured.events.some(next=>next.kind==='document-navigation'&&next.documentId!==event.documentId&&Math.abs(Date.parse(next.observedAt)-Date.parse(event.observedAt))<1000))
  measured.expectedErrorEventIds=navigationAborts.map(event=>event.id)
  const failures=measured.events.filter(event=>['console-error','page-error','http-error','request-failed','diagnostic-integrity-error'].includes(event.kind)&&!navigationAborts.includes(event))
  if(failures.length){measured.status='failed';await record(copy(measured));throw new Error('current host reference pages produced source-attributed errors')}
  measured.status='measured-current-runtime';await record(copy(measured));return measured
}
