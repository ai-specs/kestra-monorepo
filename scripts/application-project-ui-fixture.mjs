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
import {runTargetProjectBrowser,targetUiCheckIds} from './application-project-target-ui.mjs'
import {flowSource} from './application-project-fixture.mjs'
import {applicationProjectUiLocales,applicationProjectUiThemes} from './application-project-ui-cases.mjs'
import {createEgoApplicationProjectAdapter,runApplicationProjectBrowser} from './application-project-browser-adapters.mjs'

const api='/api/v1/main/extensions/rbac'
const key=value=>'~'+Buffer.from(value).toString('base64url')
const copy=value=>structuredClone(value)
const sha=value=>createHash('sha256').update(value).digest('hex')
const canonical=value=>Array.isArray(value)?value.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([name,item])=>[name,canonical(item)])):value
const equal=(a,b)=>assert.deepEqual(canonical(a),canonical(b))
const click=selector=>({action:'click',selector})
const fill=(selector,value)=>({action:'fill',selector,value})
const option=text=>click('[role="option"]:text-is('+JSON.stringify(text)+')')
export const uiScopeNames=Object.freeze({edit:'kestra:acceptance:ui-edit-v1',reference:'kestra:acceptance:ui-reference-v1'})
export const uiNamespaces=Object.freeze({initial:'ui.acceptance.initial',edited:'ui.acceptance.edited',reference:'ui.acceptance.reference'})
export const uiLanguageNames=Object.freeze({en:'English',fr:'French',de:'German',pl:'Polish',it:'Italian',es:'Spanish',pt:'Portuguese',pt_BR:'Portuguese (Brazil)',ru:'Russian',zh_CN:'Chinese',ja:'Japanese',ko:'Korean',hi:'Hindi'})
// Reviewed translation expectations, embedded to avoid a runtime source dependency.
export const uiLocaleText=Object.freeze({
  "en": {
    "projects": "Projects",
    "scopes": "Project scopes",
    "clients": "Member clients",
    "assignments": "Scope assignments",
    "saveLocal": "Save local permissions",
    "search": "Search"
  },
  "de": {
    "projects": "Projekte",
    "scopes": "Projekt-Scopes",
    "clients": "Mitgliedsclients",
    "assignments": "Scope-Zuweisungen",
    "saveLocal": "Lokale Berechtigungen speichern",
    "search": "Suchen"
  },
  "es": {
    "projects": "Proyectos",
    "scopes": "Scopes del proyecto",
    "clients": "Clientes miembros",
    "assignments": "Asignaciones de scopes",
    "saveLocal": "Guardar permisos locales",
    "search": "Buscar"
  },
  "fr": {
    "projects": "Projets",
    "scopes": "Scopes du projet",
    "clients": "Clients membres",
    "assignments": "Attributions de scopes",
    "saveLocal": "Enregistrer les permissions locales",
    "search": "Rechercher"
  },
  "hi": {
    "projects": "परियोजनाएँ",
    "scopes": "परियोजना स्कोप",
    "clients": "सदस्य क्लाइंट",
    "assignments": "स्कोप आवंटन",
    "saveLocal": "स्थानीय अनुमतियाँ सहेजें",
    "search": "खोजें"
  },
  "it": {
    "projects": "Progetti",
    "scopes": "Scope del progetto",
    "clients": "Client membri",
    "assignments": "Assegnazioni scope",
    "saveLocal": "Salva permessi locali",
    "search": "Cerca"
  },
  "ja": {
    "projects": "プロジェクト",
    "scopes": "プロジェクトスコープ",
    "clients": "メンバークライアント",
    "assignments": "スコープ付与",
    "saveLocal": "ローカル権限を保存",
    "search": "検索"
  },
  "ko": {
    "projects": "프로젝트",
    "scopes": "프로젝트 범위",
    "clients": "구성원 클라이언트",
    "assignments": "범위 부여",
    "saveLocal": "로컬 권한 저장",
    "search": "검색"
  },
  "pl": {
    "projects": "Projekty",
    "scopes": "Zakresy projektu",
    "clients": "Klienci projektu",
    "assignments": "Przypisania zakresów",
    "saveLocal": "Zapisz uprawnienia lokalne",
    "search": "Szukaj"
  },
  "pt": {
    "projects": "Projetos",
    "scopes": "Scopes do projeto",
    "clients": "Clientes membros",
    "assignments": "Atribuições de scopes",
    "saveLocal": "Guardar permissões locais",
    "search": "Pesquisar"
  },
  "pt_BR": {
    "projects": "Projetos",
    "scopes": "Escopos do projeto",
    "clients": "Clientes membros",
    "assignments": "Atribuições de escopos",
    "saveLocal": "Salvar permissões locais",
    "search": "Pesquisar"
  },
  "ru": {
    "projects": "Проекты",
    "scopes": "Области проекта",
    "clients": "Клиенты проекта",
    "assignments": "Назначения областей",
    "saveLocal": "Сохранить локальные разрешения",
    "search": "Поиск"
  },
  "zh_CN": {
    "projects": "项目",
    "scopes": "项目 scope",
    "clients": "成员 client",
    "assignments": "scope 授予",
    "saveLocal": "保存本地权限",
    "search": "搜索"
  }
})
export const uiTranslationSourceHashes=Object.freeze({
  "en": "138c2c0d6259121a352d7246700d4eada6fbb4aa4c711c581fe9de5acb5990a3",
  "de": "a128d3935ea560976afbc9d635ed8a6f11ab29648b7514fdfe98edd61b492295",
  "es": "25f7ca7dd3ec8171315ba8495ae24e8a588602e6829a85545d77791275d34d8c",
  "fr": "22b6d17492887bf084a44925bc64c97dd4d1ac72d5587561b0d667909ca07b09",
  "hi": "1d6d73f6d2f41df02e7e519df4a3272a4aec7c56189c2e4ee3adf64e5d76cceb",
  "it": "c68308506fd900e600860169f1c50d6884746d5f0c165f03f5ffc15013b99d55",
  "ja": "c78e97511c4d1e97901f06e9d4088fcfd138003f87e0d4a102e0c018f71f483d",
  "ko": "0623d72a0a732da98a5318039afa4f95d149ba6e3110182140cb8022a26ecbde",
  "pl": "c9773a58939791e357a34df25d5b31fb939cd735c22d155adbb09dc3a15ca94c",
  "pt": "3a9802dcd88d1f811bf5da444e19972dcfa436fe8fd346746b35e3bae4a6685e",
  "pt_BR": "056f09c67dfeeccc9458c585beb23a92bd779a22692a6323225c662ba7cdd511",
  "ru": "93b63adbb5d02c8a20d88baa2146bf9d340844c0791b24209c9d6495eacdf032",
  "zh_CN": "94de42468a1832911ef3881942bd3fba230e27d712958afccf0a268028e15849"
})

const nsGrant=(namespace,resource,actions)=>({scope:'NAMESPACE',tenant:'main',namespace,descendants:false,resource,actions,ids:[],allIds:true})
const tenantGrant=resource=>({scope:'TENANT',tenant:'main',namespace:null,descendants:false,resource,actions:['READ','LIST'],ids:[],allIds:true})
const scopeDefinition=(description,grants)=>({description,enabled:true,grants,managementGrants:[]})
const intentFor=grant=>({vocabularyVersion:'kestra-resources-v1',resourceType:grant.resource,namespaces:grant.scope==='TENANT'?{kind:'ALL',exact:[],subtrees:[]}:{kind:'RESTRICTED',exact:[grant.namespace],subtrees:[]},resourceIds:{kind:'ALL',ids:[]},actions:[...grant.actions]})
export function planApplicationProjectUi() {
  const ids=Array.from({length:26},(_,i)=>String(i+1).padStart(3,'0'))
  const edit=scopeDefinition('UI initial explicit binding',[nsGrant(uiNamespaces.initial,'FLOW',['READ','LIST'])])
  const ceiling=scopeDefinition('UI editable resource ceiling',[nsGrant(uiNamespaces.initial,'FLOW',['READ','LIST','UPDATE']),nsGrant(uiNamespaces.edited,'FLOW',['READ','LIST','UPDATE'])])
  const reference=scopeDefinition('UI reference page access',[
    ...['FLOW','EXECUTION','NAMESPACE','LOG','METRIC','TRIGGER','KVSTORE','NAMESPACE_FILE'].map(resource=>nsGrant(uiNamespaces.reference,resource,resource==='FLOW'?['READ','LIST','CREATE']:['READ','LIST'])),tenantGrant('METADATA'),tenantGrant('MCP_SERVER')])
  const directory=(name,definition)=>({scope:name,description:definition.description,active:true,resourceIntents:definition.grants.map(intentFor),managementIntents:[]})
  return {projects:ids.map(id=>({id:'ui-acceptance-project-'+id,tenant:'main',displayName:'UI acceptance project '+id})),
    scopes:[directory(uiScopeNames.edit,ceiling),directory(uiScopeNames.reference,reference),...ids.map(id=>directory('kestra:acceptance:ui-filter-'+id,scopeDefinition('UI filter scope '+id,[nsGrant(uiNamespaces.initial,'FLOW',['READ','LIST'])])))],
    users:ids.map(id=>({username:'ui-acceptance-user-'+id,name:'UI acceptance user '+id,email:'ui-acceptance-user-'+id+'@acceptance.invalid',password:randomBytes(24).toString('base64url')+'Aa1!'})),
    clients:ids.map(id=>({client_name:'UI acceptance client '+id,redirect_uris:['http://127.0.0.1:19997/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:'openid'})),
    localBindings:{[uiScopeNames.edit]:edit,[uiScopeNames.reference]:reference},zeroAccount:{username:'ui-acceptance-zero',subject:'ui-acceptance-zero',name:'UI zero authorization',email:'ui-acceptance-zero@acceptance.invalid',password:randomBytes(24).toString('base64url')+'Aa1!'}}
}

/** Concrete candidate actions from public KsFilter 0.5.0 dist components.
 * Each plan resets existing conditions via the real advanced filter control.
 * No URL query, router, sessionStorage or synthetic event is used to set filters.
 */
export function uiFilterPlans(records) {
  const fields={projects:{label:'Project ID',field:'id'},scopes:{label:'OAuth2 scope',field:'scope'},clients:{label:'Client ID',field:'clientId'},assignments:{label:'User identity',field:'subject'}}
  const plans={}
  for(const [section,{label,field}]of Object.entries(fields)) {
    assert(records[section].length>25,'actual directory must exceed 25: '+section)
    const first=records[section][25][field],second=records[section][26]?.[field]??records[section][24][field]
    const prefix=first.slice(0,-1)
    const contains=records[section].filter(item=>String(item[field]).toLocaleLowerCase().includes(prefix.toLocaleLowerCase())).map(item=>item[field])
    // Limit expected results to a page because shared assertions compare visible
    // rows; choose the exact first ID if a generated client prefix is too broad.
    const needle=contains.length<=25?prefix:first
    const rows=records[section].filter(item=>String(item[field]).toLocaleLowerCase().includes(needle.toLocaleLowerCase())).map(item=>item[field])
    const open=[fill('.ks-search input',''),click('.customize-button'),click('button[aria-label="Add advanced filter"]'),click('.adv-clear'),click('.adv-footer .adv-add:nth-child(1)')]
    const condition=(index,comparator,value)=>{
      const root='.adv-body .adv-row:nth-child('+index+')'
      return [click(root+' .cond-field .kel-select__wrapper'),option(label),click(root+' .cond-op .kel-select__wrapper'),option(comparator),fill(root+' .cond-value-input input',value)]
    }
    const close=click('.adv-header-close')
    plans[section]={
      equals:{steps:[...open,...condition(1,'Equals',first),close],expectedIds:[first]},
      contains:{steps:[...open,...condition(1,'Contains',needle),close],expectedIds:rows},
      and:{steps:[...open,...condition(1,'Contains',needle),click('.adv-footer .adv-add:nth-child(1)'),...condition(2,'Equals',first),close],expectedIds:[first]},
      or:{steps:[...open,...condition(1,'Equals',first),click('.adv-footer .adv-add:nth-child(2)'),...condition(2,'Equals',second),close],expectedIds:[first,second]},
    }
  }
  return plans
}

export function uiBrowserFixture({base,admin,zeroAccount,clientId,subject,records,referenceEvidence}) {
  const pagination=Object.fromEntries(Object.entries({projects:'id',scopes:'scope',clients:'clientId',assignments:'subject'}).map(([section,field])=>[section,records[section][25][field]]))
  return {admin:copy(admin),zeroAccount:copy(zeroAccount),projectId:applicationProject,scope:uiScopeNames.edit,clientId,subject,unknownScope:'kestra:acceptance:ui-unknown-never-created',
    edit:{description:'UI saved explicit namespace/action change',namespace:uiNamespaces.edited,actions:['READ','UPDATE']},
    loginFinalPath:'/ui/main/dashboards',reauthenticationPath:'/ui/access-denied',reauthenticationSteps:[click('button:text-is("Sign out")')],
    preferences:{path:'/ui/main/preferences',themes:{'dark-2':[click('.theme-picker button:nth-child(1)')],dark:[click('.theme-picker button:nth-child(2)')],light:[click('.theme-picker button:nth-child(3)')],system:[click('.theme-picker button:nth-child(4)')]},
      locales:Object.fromEntries(applicationProjectUiLocales.map(locale=>[locale,[click('.settings-block:last-child .setting-row:first-child .kel-select__wrapper'),option(uiLanguageNames[locale])]]))},
    localeText:copy(uiLocaleText),translationEvidence:{sourceHashes:uiTranslationSourceHashes,status:'source-reviewed; actual rendering asserted by shared browser matrix'},
    references:{mcpPath:'/ui/main/admin/mcp-servers/edit/default/edit',namespacesPath:'/ui/main/namespaces',flowsPath:'/ui/main/flows',tab:'#tab-edit',button:'button.kel-button--primary',search:'.ks-search input',tableHeader:'.kel-table th',tableCell:'.kel-table tbody td'},
    referenceEvidence,pagination,filters:uiFilterPlans(records),filterEvidence:{status:'candidate-public-component-structure; runtime DOM not yet verified',components:['CustomizeFilters','AdvancedFilterBuilder','ConditionRow'],package:'@kestra-io/design-system',version:'0.5.0'},
    expectedRequestErrors:[...['ui-client-membership-approval','ui-subject-grant-revoke','cleanup-restore-client','cleanup-restore-assignment'].flatMap(name=>[401,403].map(status=>({case:name,method:'GET',path:'/api/v1/main/extensions/rbac/capabilities',status}))),{case:'ui-unknown-scope-no-policy-change',method:'POST',path:'/api/v1/main/extensions/rbac/projects/'+applicationProject+'/scopes',status:400},{case:'ui-unknown-scope-no-policy-change',method:'GET',path:'/api/v1/main/extensions/rbac/identity/projects/'+applicationProject+'/scopes/'+key('kestra:acceptance:ui-unknown-never-created'),status:404},{case:'ui-412-conflict-no-policy-change',method:'PUT',path:'/api/v1/main/extensions/rbac/projects/'+applicationProject+'/scopes/'+key(uiScopeNames.edit),status:412}],
    base,expectedBrowserErrors:[]}
}

async function prepareUiData({base,management,planned,completedFragments,isolation,record}) {
  assert.equal(typeof record,'function','persistent preparation report required')
  assert.equal(management.base,base);assert.equal(planned.base,base)
  assert(completedFragments?.rest?.completed&&completedFragments.rest.matrix?.length===56&&completedFragments.rest.matrix.every(row=>row.passed&&row.status==='passed'&&row.skipped===undefined&&row.transport==='rest'),'prepare UI only after actual REST56 completion')
  assert(completedFragments?.mcp?.checks?.length>=11&&completedFragments.mcp.checks.some(row=>['passed','failed'].includes(row.status)),'actual MCP execution evidence must be retained before independent UI checks')
  assert(/^application-projects-bb-[0-9]+-[0-9]+$/.test(isolation?.composeProject??''),'own isolated Compose UI data preparation required')
  assert(management.reconciliationEdits instanceof Map&&management.approvedClientIds instanceof Map,'root full-reconciliation management helper required')
  const origin=new URL(base);assert.equal(origin.origin,base);assert(['localhost','127.0.0.1'].includes(origin.hostname));assert(Number(origin.port)>1024)
  const inspect=(format,id)=>execFileSync('docker',['inspect','-f',format,id],{encoding:'utf8'}).trim()
  for(const id of [isolation.kestraContainer,isolation.postgresContainer]){assert(/^[a-f0-9]{12,64}$/.test(id??''));assert.equal(inspect('{{index .Config.Labels "com.docker.compose.project"}}',id),isolation.composeProject)}
  const ports=JSON.parse(inspect('{{json .NetworkSettings.Ports}}',isolation.kestraContainer))
  assert(ports['8080/tcp']?.some(binding=>binding.HostPort===origin.port&&binding.HostIp==='127.0.0.1'),'UI API base is not the owned loopback deployment port')
  const spec=planApplicationProjectUi(),events=[]
  const emit=async event=>{events.push(event);await record({completed:false,events,requests:[...management.requests]})}
  const baseline=copy(planned.policy.applicationProjects[applicationProject].scopes)
  const protectedScopes={}
  await management.login()
  for(const scope of [scopeNames.identityManager,scopeNames.policyManager])protectedScopes[scope]=await management.request(api+'/identity/projects/'+applicationProject+'/scopes/'+key(scope))
  let failure
  try {
    for(const project of spec.projects) {
      await management.login()
      await management.request(api+'/identity/projects','POST',project)
      // A new target is not the console project. Reauthenticate and confirm the
      // console's full binding even if its epoch did not change in this action.
      await management.reconcile(applicationProject)
      const view=await management.request(api+'/policy')
      assert.equal(view.policy.applicationProjects[project.id],undefined,'identity project creation silently created a local binding')
      await emit({kind:'identity-project-created',projectId:project.id,localBindingCreated:false})
    }
    for(const scope of spec.scopes) {
      await management.login()
      const project=await management.request(api+'/identity/projects/'+applicationProject)
      if(spec.localBindings[scope.scope])management.reconciliationEdits.set(scope.scope,copy(spec.localBindings[scope.scope]))
      await management.mutateIdentity(api+'/identity/projects/'+applicationProject+'/scopes','POST',scope,project.revision)
      await emit({kind:'ui-scope-created',scope:scope.scope,explicitLocalBinding:Boolean(spec.localBindings[scope.scope])})
    }
    // Preserve every existing manager scope and receipt-backed UI flag.
    await management.login()
    const uiPath=api+'/identity/projects/'+applicationProject+'/clients/'+key('kestra-ui')
    const ui=await management.request(uiPath)
    assert(ui.approved===true&&ui.firstPartyUi===true)
    await management.mutateIdentity(uiPath,'PUT',{clientId:ui.clientId,approved:true,firstPartyUi:true,audiences:ui.audiences,allowedProjectScopes:[...new Set([...ui.allowedProjectScopes,...spec.scopes.map(scope=>scope.scope)])]},ui.revision)
    const clients=[]
    for(const registrationInput of spec.clients) {
      const client=await management.login()
      const response=await client.request('/oidc/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(registrationInput)})
      assert.equal(response.status,201);const registered=await response.json()
      assert(registered.client_id&&!registered.client_secret);assert.equal(registered.token_endpoint_auth_method,'none')
      management.approvedClientIds.set(registered.client_id,[uiScopeNames.edit])
      await management.approveOrdinaryClient({clientId:registered.client_id,audiences:[base+'/api/v1/main/mcp/default'],projectScopes:[uiScopeNames.edit],registeredProtocolScopes:['openid'],requestedProtocolScopes:['openid']})
      clients.push(registered.client_id);await emit({kind:'ui-member-created',clientId:registered.client_id,firstPartyUi:false,projectScopes:[uiScopeNames.edit]})
    }
    const subjects=[]
    for(const user of spec.users) {
      await management.login();const created=await management.request(api+'/users','POST',user)
      assert.equal(created.subject,user.username);await management.reconcile(applicationProject)
      const project=await management.request(api+'/identity/projects/'+applicationProject)
      await management.mutateIdentity(api+'/identity/projects/'+applicationProject+'/assignments','POST',{issuer:base,subject:created.subject,projectScopes:[uiScopeNames.edit]},project.revision)
      subjects.push(created.subject);await emit({kind:'ui-subject-assigned',subject:created.subject,projectScopes:[uiScopeNames.edit]})
    }
    await management.login();const zero=spec.zeroAccount
    const zeroCreated=await management.request(api+'/users','POST',{username:zero.username,name:zero.name,email:zero.email,password:zero.password});assert.equal(zeroCreated.subject,zero.subject)
    await management.reconcile(applicationProject)
    const assigned=await management.request(api+'/identity/projects/'+applicationProject+'/assignments/detail?subject='+encodeURIComponent(planned.admin.subject))
    await management.mutateIdentity(api+'/identity/projects/'+applicationProject+'/assignments/detail?subject='+encodeURIComponent(planned.admin.subject),'PUT',{issuer:base,subject:planned.admin.subject,projectScopes:[...new Set([...assigned.projectScopes,uiScopeNames.reference])]},assigned.revision)
    const adminClient=await management.login()
    const seeded=await adminClient.request('/api/v1/main/flows',{method:'POST',headers:{'Content-Type':'application/x-yaml'},body:flowSource(uiNamespaces.reference,'ui-reference-row')});assert(seeded.ok);await seeded.body?.cancel()
    const zeroClient=new ProductionOAuthClient(base);await zeroClient.login(zero.username,zero.password)
    const actualZero=await zeroClient.verifiedUiIdentity({projectId:applicationProject,subject:zero.subject,audience:'kestra-ui'});assert.deepEqual(actualZero.projectScopes,[])
    const denied=await zeroClient.request('/api/v1/main/flows/search?size=1');assert.equal(denied.status,403);await denied.body?.cancel()
    await emit({kind:'zero-account-production-identity',subject:zero.subject,projectScopes:actualZero.projectScopes,businessStatus:403})
    await management.login()
    const all=async path=>{
      const items=[];let total
      for(let page=1;;page++) {const value=await management.request(path+'?page='+page+'&size=100');assert(Array.isArray(value.items)&&Number.isSafeInteger(value.total));total??=value.total;assert.equal(value.total,total);items.push(...value.items);if(items.length===total)return items;assert(value.items.length&&items.length<total,'directory pagination stalled')}
    }
    const records={projects:await all(api+'/identity/projects'),scopes:await all(api+'/identity/projects/'+applicationProject+'/scopes'),clients:await all(api+'/identity/projects/'+applicationProject+'/clients'),assignments:await all(api+'/identity/projects/'+applicationProject+'/assignments')}
    for(const [section,items]of Object.entries(records))assert(items.length>25,'insufficient real UI data: '+section)
    for(const scope of [scopeNames.identityManager,scopeNames.policyManager])equal(await management.request(api+'/identity/projects/'+applicationProject+'/scopes/'+key(scope)),protectedScopes[scope])
    for(const [scope,definition]of Object.entries(baseline))equal(planned.policy.applicationProjects[applicationProject].scopes[scope],definition)
    const fixture=uiBrowserFixture({base,admin:planned.admin,zeroAccount:zero,clientId:clients[0],subject:subjects[0],records,referenceEvidence:{status:'measure-current-formal-host-through-same-adapter; no historical styles consumed'}})
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
  return {completed:false,ui:applicationProjectUiThemes.flatMap(theme=>applicationProjectUiLocales.map(locale=>({case:'theme-language',theme,locale,passed:false,status:'not_run'}))),zeroGrant:{case:'ui-zero-grant-logout-switch',passed:false,status:'not_run'}}
}
export async function runZeroGrantBrowser(page,base,fixture) {
  const source=()=>page.evaluate(()=>({path:location.pathname,url:location.href,timeOrigin:performance.timeOrigin}))
  const previous=new Set((await page.diagnostics()).events.map(event=>event.id))
  async function signOut(requireClick) {
    await page.goto(base+'/ui/access-denied')
    await page.waitForFunction(()=>Boolean(document.querySelector('input[name="username"]'))||[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Sign out'))
    const alreadyAnonymous=await page.evaluate(()=>Boolean(document.querySelector('input[name="username"]')))
    assert(!requireClick||!alreadyAnonymous,'zero-account session vanished before the required real logout click')
    if(!alreadyAnonymous)await page.click('button:text-is("Sign out")')
    await page.waitForFunction(()=>Boolean(document.querySelector('input[name="username"]'))&&Boolean(document.querySelector('input[name="password"]')))
    return !alreadyAnonymous
  }
  const login=async account=>{
    await page.fill('input[name="username"]',account.username);await page.fill('input[name="password"]',account.password);await page.click('button[type="submit"]')
  }
  await signOut(false)
  await login(fixture.zeroAccount)
  await page.waitForFunction(()=>location.pathname==='/ui/access-denied'&&!document.querySelector('input[name="password"]')&&[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Sign out'))
  const rejectedDocument=await source()
  const beforeDenial=(await page.diagnostics()).events
  rejectedDocument.documentId=[...beforeDenial].reverse().find(event=>['document-navigation','document-route'].includes(event.kind)&&event.url===rejectedDocument.url)?.documentId
  assert(rejectedDocument.documentId,'zero-grant document identity missing')
  const path='/api/v1/main/flows/search?size=1'
  const denial=await page.evaluate(async path=>{const response=await fetch(path,{credentials:'same-origin',redirect:'manual'});await response.body?.cancel();return {status:response.status}},path)
  assert.equal(denial.status,403,'zero-account session acquired business access')
  const clicked=await signOut(true)
  const anonymousDocument=await source()
  const anonymousEvents=(await page.diagnostics()).events
  anonymousDocument.documentId=[...anonymousEvents].reverse().find(event=>['document-navigation','document-route'].includes(event.kind)&&event.url===anonymousDocument.url)?.documentId
  assert(anonymousDocument.documentId,'anonymous login document identity missing')
  const anonymous=await page.evaluate(async path=>{const response=await fetch(path,{credentials:'same-origin',redirect:'manual'});await response.body?.cancel();return {status:response.status}},path)
  assert([0,401].includes(anonymous.status),'logout did not clear authenticated access; 403 alone cannot establish session clearing')
  await login(fixture.admin)
  await page.waitForFunction(path=>location.pathname===path&&!document.querySelector('input[name="password"]'),fixture.loginFinalPath)
  const verified=await page.evaluate(async path=>{const response=await fetch(path,{credentials:'same-origin',redirect:'manual'});return {status:response.status,body:await response.json()}},api+'/capabilities')
  assert.equal(verified.status,200);assert.equal(verified.body.subject,fixture.admin.subject);assert.equal(verified.body.allowed,true)
  assert.notEqual(fixture.zeroAccount.subject,fixture.admin.subject)
  const events=(await page.diagnostics()).events.filter(event=>!previous.has(event.id))
  const expectedUrl=base+path
  const errors=events.filter(event=>['console-error','page-error','request-failed','http-error','diagnostic-integrity-error'].includes(event.kind))
  const unexpected=errors.filter(event=>!(event.kind==='http-error'&&event.url===expectedUrl&&((event.status===403&&event.documentId===rejectedDocument.documentId)||(anonymous.status===401&&event.status===401&&event.documentId===anonymousDocument.documentId))))
  assert.equal(unexpected.length,0,'zero-grant browser has unclassified document/request errors; inspect retained diagnostics')
  return {case:'ui-zero-grant-logout-switch',passed:true,status:'passed',evidence:{subject:fixture.zeroAccount.subject,rejectedDocument,businessStatus:denial.status,realSignOutClicked:clicked,anonymousStatus:anonymous.status,anonymousDocument,replacementSubject:verified.body.subject,final:await source(),events}}
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
      try{report.target=await runTargetProjectBrowser(adapter,base,fixture,fixture.targetRuntime,async fragment=>{report.target=fragment;await record(copy(report))})}
      catch(error){report.target={completed:false,checks:targetUiCheckIds.map(id=>({id,passed:false,status:'failed',evidence:{error:safe(error)}}))};failure??=error}
    }else report.target={completed:false,checks:targetUiCheckIds.map(id=>({id,passed:false,status:'not_run',evidence:{reason:'caller must provide real root targetRuntime management/planned context'}}))}
    report.ui.push(...report.target.checks.map(row=>({...row,case:row.id,name:row.id})))
    report.completed=report.target.completed===true&&report.shared?.completed===true&&report.zeroGrant.passed===true&&!failure
    report.adapterDiagnostics=await adapter.diagnosticEvidence().catch(error=>({captureFailure:String(error.message)}))
    if(report.adapterDiagnostics.captureFailure)report.completed=false
    report.adapterArtifacts=adapter.artifactReferences();await record(copy(report))
  }
  if(failure)throw new Error(safe(failure))
  assert(report.completed,'shared UI or zero-grant checks incomplete')
  return report
}

/** The caller supplies an EXISTING Ego Page. Does not create a space or own it. */
export async function runApplicationProjectUiWithEgo(page,base,fixture,{artifactDirectory,record}={}) {
  const adapter=await createEgoApplicationProjectAdapter(page,{artifactDirectory,secrets:[fixture.admin.password,fixture.zeroAccount.password]})
  try{return await runPreparedApplicationProjectUi(adapter,base,fixture,record)}finally{await adapter.dispose()}
}

/** Derive only equivalent root checks from actual complete browser evidence. */
export function uiRootChecks(report) {
  const rows=report?.ui??[]
  const groups={
    'production-ui-login-canonical-path':['production-ui-login-canonical-path'],
    'ui-role-grant-edit-refresh':['ui-role-grant-edit-refresh'],
    'ui-client-membership-approval':['ui-client-membership-approval'],
    'ui-subject-grant-revoke':['ui-subject-grant-revoke'],
    'ui-zero-grant-logout-switch':['ui-zero-grant-logout-switch'],
    'ui-create-project-explicit-local-policy-target':['ui-create-project-explicit-local-policy-target'],
    'ui-subject-revoke':['ui-subject-revoke'],
    'ui-narrow':['ui-narrow-and-keyboard-focus'],
    'ui-filter-search-pagination':['projects','scopes','clients','assignments'].flatMap(section=>['ui-search-filter-pagination-'+section,...['equals','contains','and','or'].map(operator=>'ui-filter-'+section+'-'+operator)]),
    'ui-empty-loading-error-conflict':['ui-empty-grants-no-policy-change','ui-unknown-scope-no-policy-change','ui-412-conflict-no-policy-change','ui-loading-transition',...['projects','scopes','clients','assignments'].map(section=>'ui-search-filter-pagination-'+section)],
  }
  for(const theme of applicationProjectUiThemes)groups['ui-'+theme]=applicationProjectUiLocales.map(locale=>'ui-theme-language-'+theme+'-'+locale)
  groups['ui-languages']=applicationProjectUiThemes.flatMap(theme=>groups['ui-'+theme])
  groups['ui-keyboard-focus']=[...groups['ui-languages'],'ui-narrow-and-keyboard-focus']
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
export async function runRootApplicationProjectWithEgo(page,argv,{artifactDirectory,onReport}={}) {
  assert(isAbsolute(artifactDirectory),'explicit absolute Ego artifact directory required')
  const adapter=await createEgoApplicationProjectAdapter(page,{artifactDirectory})
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
    const evidence=await adapter.evaluate(({selectors})=>({path:location.pathname,url:location.href,timeOrigin:performance.timeOrigin,styles:Object.fromEntries(Object.entries(selectors).map(([name,selector])=>{
      const node=document.querySelector(selector),style=getComputedStyle(node),box=node.getBoundingClientRect()
      return [name,{selector,tag:node.tagName,role:node.getAttribute('role'),text:node.textContent.trim(),fontFamily:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,color:style.color,background:style.backgroundColor,padding:style.padding,borderRadius:style.borderRadius,borderBottomStyle:style.borderBottomStyle,borderBottomWidth:style.borderBottomWidth,width:box.width,height:box.height}]
    }))}),{selectors})
    assert.equal(evidence.path,path);measured.pages.push({kind,...evidence});await record(copy(measured))
  }
  measured.events=(await adapter.diagnostics()).events.filter(event=>!known.has(event.id))
  const failures=measured.events.filter(event=>['console-error','page-error','http-error','request-failed','diagnostic-integrity-error'].includes(event.kind))
  if(failures.length){measured.status='failed';await record(copy(measured));throw new Error('current host reference pages produced source-attributed errors')}
  measured.status='measured-current-runtime';await record(copy(measured));return measured
}
