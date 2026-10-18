/** Additional real browser checks. Uses the caller-owned adapter exclusively. */
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {applicationProject} from './application-project-cases.mjs'

const api='/api/v1/main/extensions/rbac',key=value=>'~'+Buffer.from(value).toString('base64url')
const root='[data-test="extension-container"]'
const clone=value=>structuredClone(value)
// DTO collection order is not a published contract. Sorting preserves exact
// contents and duplicate counts; no action or target is dropped or inferred.
export const canonicalTargetValue=value=>Array.isArray(value)?value.map(canonicalTargetValue).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([name,item])=>[name,canonicalTargetValue(item)])):value
const semanticEqual=(actual,expected,message)=>assert.deepEqual(canonicalTargetValue(actual),canonicalTargetValue(expected),message)

export const targetUiCheckIds=Object.freeze(['ui-create-project-explicit-local-policy-target','ui-subject-revoke'])
export async function runTargetProjectBrowser(page,base,fixture,{management,planned,effects},record) {
  assert.equal(typeof record,'function')
  const report={completed:false,checks:targetUiCheckIds.map(id=>({id,passed:false,status:'not_run',evidence:{}})),requests:[],logins:[],cleanup:[]}
  const id='ui-target-'+randomBytes(6).toString('hex'),scope='kestra:acceptance:'+id+'-manage-v1',targetScope='kestra:acceptance:'+id+'-read-v1'
  const namespace='ui.acceptance.target',audience=base+'/api/v1/main/mcp/default'
  let memberOriginal,assignmentOriginal,createdScope=false,createdTarget=false,subjectOriginal,revokedAccount,originalConsoleScopes,targetCleanupState
  const secrets=new Set([planned.admin,fixture.zeroAccount,...Object.values(planned.accounts??{}),...Object.values(planned.mcpAccounts??{})].map(account=>account?.password).filter(Boolean))
  const safe=error=>{
    let text=String(error?.message??error)
    for(const secret of secrets)text=text.replaceAll(secret,'[redacted]')
    return text.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted-jwt]').replace(/Bearer\s+[^\s,;]+/gi,'Bearer [redacted]').replace(/([?&](?:code|state|access_token|refresh_token|id_token|password|client_secret)=)[^&#\s]*/gi,'$1[redacted]')
  }
  const safeValue=value=>typeof value==='string'?safe(value):Array.isArray(value)?value.map(safeValue):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([name,item])=>[name,safeValue(item)])):value
  const requestOffset=management.requests.length
  const persist=()=>{report.managementRequests=management.requests.slice(requestOffset);return record(safeValue(clone(report)))}
  const read=async path=>{await management.login();return management.request(api+path)}
  async function login(account) {
    await page.goto(base+'/ui/access-denied')
    await page.waitForFunction(()=>Boolean(document.querySelector('input[name="username"]'))||[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Sign out'))
    if(!await page.evaluate(()=>Boolean(document.querySelector('input[name="username"]'))))await page.click('button:text-is("Sign out")')
    await page.waitForFunction(()=>Boolean(document.querySelector('input[name="username"]'))&&Boolean(document.querySelector('input[name="password"]')))
    await page.fill('input[name="username"]',account.username);await page.fill('input[name="password"]',account.password);await page.click('button[type="submit"]')
    await page.waitForFunction(()=>!document.querySelector('input[name="password"]')&&['/ui/main/dashboards','/ui/access-denied'].includes(location.pathname))
    report.logins.push({subject:account.subject,path:await page.evaluate(()=>location.pathname)});await persist()
  }
  async function open(path,selector) {await page.goto(base+'/ui/main/extensions/rbac/'+path);await page.waitForFunction(({root,selector})=>Boolean(document.querySelector(root)?.shadowRoot?.querySelector(selector))&&document.querySelector(root).shadowRoot.querySelector('main')?.getAttribute('aria-busy')==='false',{root,selector})}
  async function checked(selector,value) {
    const state=await page.evaluate(({root,selector})=>{const nodes=[...document.querySelector(root).shadowRoot.querySelectorAll(selector)];if(nodes.length!==1)throw new Error('expected exactly one checkbox');return nodes[0].checked},{root,selector})
    if(state!==value)await page.click(selector)
  }
  async function sameCookie(path,method='GET',body,revision) {
    const result=await page.evaluate(async({path,method,body,revision})=>{
      const headers={Accept:'application/json'}
      if(body!==undefined)headers['Content-Type']='application/json'
      if(revision!==undefined)headers['If-Match']='"'+revision+'"'
      if(method!=='GET'){headers['X-CSRF-TOKEN']=document.querySelector('meta[name="csrf-token"]')?.content;if(!headers['X-CSRF-TOKEN'])throw new Error('real UI CSRF meta missing')}
      const response=await fetch(path,{method,headers,credentials:'same-origin',redirect:'manual',...(body===undefined?{}:{body:JSON.stringify(body)})})
      return {status:response.status,body:await response.json().catch(()=>null)}
    },{path:api+path,method,body,revision});report.requests.push({path:api+path,method,status:result.status});await persist();return result
  }
  async function save(selector) {
    const token='save-'+randomBytes(8).toString('hex')
    // Observe before the native click, so a fast busy transition cannot be
    // missed. Annotation and observation never dispatch UI events.
    await page.evaluate(({root,token})=>{
      const shadow=document.querySelector(root)?.shadowRoot
      if(!shadow)throw new Error('current editor missing before save')
      const markers=()=>[...shadow.querySelectorAll('p.message[role="status"],[data-test="saved-result"],[data-test="reauthenticate"]')]
      const prior=new Map(markers().map(node=>[node,node.textContent]))
      const state={busy:false,changed:false,observer:null}
      const observe=()=>{
        if(shadow.querySelector('main')?.getAttribute('aria-busy')==='true')state.busy=true
        if(markers().some(node=>!prior.has(node)||prior.get(node)!==node.textContent))state.changed=true
      }
      state.observer=new MutationObserver(records=>{
        if(records.some(record=>record.type==='attributes'&&record.attributeName==='aria-busy'&&record.oldValue==='true'))state.busy=true
        observe()
      })
      state.observer.observe(shadow,{subtree:true,childList:true,characterData:true,attributes:true,attributeOldValue:true,attributeFilter:['aria-busy']})
      window.__applicationProjectTargetSave??={};window.__applicationProjectTargetSave[token]=state
    },{root,token})
    try {
      await page.click(selector)
      await page.waitForFunction(({root,token})=>{
        const shadow=document.querySelector(root)?.shadowRoot,state=window.__applicationProjectTargetSave?.[token]
        if(!shadow||!state||shadow.querySelector('main')?.getAttribute('aria-busy')!=='false')return false
        const completed=Boolean(shadow.querySelector('p.message[role="status"],[data-test="saved-result"],[data-test="reauthenticate"]'))
        return completed&&(state.busy||state.changed)
      },{root,token})
    } finally {
      await page.evaluate(token=>{const state=window.__applicationProjectTargetSave?.[token];state?.observer?.disconnect();if(window.__applicationProjectTargetSave)delete window.__applicationProjectTargetSave[token]},token)
    }
  }
  async function reconcileConsole(extra) {
    // Read only from the formal projection. All writes are real form actions.
    await management.login();const projection=await management.request(api+'/projects/'+applicationProject+'/reconciliation')
    assert.equal(projection.directoryRevision,projection.upperBound.project.revision)
    await login(planned.admin);await open('projects/'+applicationProject+'/reconciliation','[data-test="project-reconciliation-editor"]')
    if(extra) {
      await page.fill('[name="reconciliation-new-scope"]',scope)
      await page.click('button:text-is("Add local scope binding")')
      const section='[data-reconciliation-scope="'+scope+'"]'
      await page.fill(section+' [name="reconciliation-scope-description"]','Explicit target-only management')
      await checked(section+' > label.checkbox input',true)
      await page.click(section+' button:text-is("Add management grant")')
      await page.selectOption(section+' .grant select','LOCAL_POLICY')
      await page.fill(section+' [name="management-project-ids"]',id)
      await checked(section+' .grant input[value="READ"]',true);await checked(section+' .grant input[value="MANAGE"]',true)
    }
    await page.fill('[name="reconciliation-directory-revision"]',String(projection.directoryRevision))
    await checked('[data-test="approve-project-reconciliation"]',true)
    await save('[data-test="save-project-reconciliation"]')
    const response=await sameCookie('/projects/'+applicationProject+'/reconciliation')
    assert.equal(response.status,200);assert.equal(response.body.project.directoryRevision,projection.directoryRevision)
    if(extra) {
      const saved=response.body.project.scopes[scope]
      assert.equal(saved.enabled,true);assert.deepEqual(saved.grants,[])
      semanticEqual(saved.managementGrants,[{domain:'LOCAL_POLICY',actions:['READ','MANAGE'],projectIds:[id]}])
      planned.policy.applicationProjects[applicationProject].scopes[scope]=clone(saved)
    }
    await login(planned.admin)
  }
  async function identity(path,method,body,revision) {
    await management.login();const before=await management.request(api+'/identity/projects/'+applicationProject)
    const result=await management.request(api+path,method,body,revision)
    await management.login()
    const projection=await management.request(api+'/projects/'+applicationProject+'/reconciliation')
    assert(projection.upperBound.project.authorizationVersion>before.authorizationVersion)
    await reconcileConsole(false)
    return result
  }
  await persist()
  try {
    const row=report.checks[0];row.status='running';await persist()
    await login(planned.admin)
    const existing=await read('/policy');originalConsoleScopes=clone(existing.policy.applicationProjects[applicationProject].scopes);assert.equal(existing.policy.applicationProjects[id],undefined)
    await open('projects/new','[name="project-id"]')
    await page.fill('[name="project-id"]',id);await page.fill('[name="project-display-name"]','Browser-created explicit target')
    await save('[data-test="save-identity-project"]');createdTarget=true
    await login(planned.admin)
    const created=await read('/identity/projects/'+id);assert.equal(created.id,id);assert.equal(created.displayName,'Browser-created explicit target')
    assert.equal((await read('/policy')).policy.applicationProjects[id],undefined,'shared project save must not create a local binding')
    await reconcileConsole(false)
    // New stable scope; no old management scope meaning is expanded.
    await open('projects/'+applicationProject+'/scopes/new','[name="identity-scope"]')
    await page.fill('[name="identity-scope"]',scope);await page.fill('[name="identity-scope-description"]','Explicit target-only management')
    await page.click('#identity-scope-title + form button:text-is("Add management intent")')
    const intent='section[aria-labelledby="identity-scope-title"] .grant'
    await page.selectOption(intent+' select','LOCAL_POLICY');await page.fill(intent+' [name="management-project-ids"]',id)
    await checked(intent+' input[value="READ"]',true);await checked(intent+' input[value="MANAGE"]',true)
    await save('[data-test="save-identity-scope"]');createdScope=true
    await login(planned.admin)
    const shared=await read('/identity/projects/'+applicationProject+'/scopes/'+key(scope))
    semanticEqual(shared.managementIntents,[{domain:'LOCAL_POLICY',actions:['READ','MANAGE'],projectIds:[id]}])
    await reconcileConsole(true)
    memberOriginal=await read('/identity/projects/'+applicationProject+'/clients/'+key('kestra-ui'))
    await identity('/identity/projects/'+applicationProject+'/clients/'+key('kestra-ui'),'PUT',{clientId:'kestra-ui',approved:true,firstPartyUi:true,audiences:memberOriginal.audiences,allowedProjectScopes:[...memberOriginal.allowedProjectScopes,scope]},memberOriginal.revision)
    assignmentOriginal=await read('/identity/projects/'+applicationProject+'/assignments/detail?subject='+encodeURIComponent(planned.admin.subject))
    await identity('/identity/projects/'+applicationProject+'/assignments/detail?subject='+encodeURIComponent(planned.admin.subject),'PUT',{issuer:base,subject:planned.admin.subject,projectScopes:[...assignmentOriginal.projectScopes,scope]},assignmentOriginal.revision)
    const client=await management.login()
    const registered=await client.request('/oidc/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({redirect_uris:['http://127.0.0.1:19997/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:'openid',client_name:'Browser target membership'})})
    assert.equal(registered.status,201);const registration=await registered.json();assert(registration.client_id&&!registration.client_secret)
    await management.login();const target=await management.request(api+'/identity/projects/'+id)
    await management.request(api+'/identity/projects/'+id+'/scopes','POST',{scope:targetScope,description:'Target business read',active:true,resourceIntents:[{vocabularyVersion:'kestra-resources-v1',resourceType:'FLOW',namespaces:{kind:'RESTRICTED',exact:[namespace],subtrees:[]},resourceIds:{kind:'ALL',ids:[]},actions:['READ','LIST']}],managementIntents:[]},target.revision)
    await management.login();const currentTarget=await management.request(api+'/identity/projects/'+id)
    await management.request(api+'/identity/projects/'+id+'/clients','POST',{clientId:registration.client_id,approved:true,firstPartyUi:false,audiences:[audience],allowedProjectScopes:[targetScope]},currentTarget.revision)
    await login(planned.admin)
    await open('projects/'+id,'[name="local-issuer"]')
    await page.fill('[name="local-issuer"]',base)
    await page.fill('section[aria-labelledby="local-project-title"] textarea',audience)
    await checked('section[aria-labelledby="local-project-title"] label.checkbox input',true)
    await save('[data-test="save-local-project"]')
    const bound=await sameCookie('/policy');assert.equal(bound.status,200)
    semanticEqual(bound.body.policy.applicationProjects[id].audiences,[audience]);assert.equal(bound.body.policy.applicationProjects[id].enabled,true)
    await open('projects/'+id+'/bindings/new','[name="binding-scope"]')
    await page.selectOption('[name="binding-scope"]',targetScope)
    await page.fill('[name="local-scope-description"]','Browser-saved target read binding')
    await checked('form label.checkbox input',true)
    await page.click('[data-test="add-grant"]');await page.fill('[name="grant-namespace"]',namespace);await page.selectOption('[name="grant-resource"]','FLOW')
    await checked('.grant input[value="READ"]',true);await checked('.grant input[value="LIST"]',true)
    await save('[data-test="save-new-local-binding"]')
    const saved=await sameCookie('/projects/'+id+'/scopes/'+key(targetScope));assert.equal(saved.status,200)
    const actual=saved.body.scope??saved.body;assert.equal(actual.description,'Browser-saved target read binding')
    assert(actual.grants.some(grant=>grant.namespace===namespace&&grant.resource==='FLOW'&&grant.actions.includes('READ')&&grant.actions.includes('LIST')))
    row.passed=true;row.status='passed';row.evidence={targetId:id,scope,sharedCreatedByBrowser:true,newScopeTargetIds:[id],uiMemberExplicitlyApproved:true,subjectExplicitlyGranted:true,targetAudience:audience,localProjectSavedByBrowser:true,bindingSavedByBrowser:true,policyRevision:bound.body.revision}
  }catch(error){report.checks[0].status='failed';report.checks[0].evidence.error=safe(error)}finally{await persist()}
  try {
    const row=report.checks[1];row.status='running';await persist()
    // UI-only account has exactly the reference scope, not an old REST fixture.
    const password=randomBytes(24).toString('base64url')+'Aa1!',username='ui-revoke-'+randomBytes(6).toString('hex')
    secrets.add(password);page.redactSecrets([password])
    await management.login();const created=await management.request(api+'/users','POST',{username,name:'UI runtime revocation',email:username+'@acceptance.invalid',password})
    await management.reconcile(applicationProject)
    const project=await management.request(api+'/identity/projects/'+applicationProject)
    const reference='kestra:acceptance:ui-reference-v1'
    await management.mutateIdentity(api+'/identity/projects/'+applicationProject+'/assignments','POST',{issuer:base,subject:created.subject,projectScopes:[reference]},project.revision)
    const account={username,password,subject:created.subject};revokedAccount=account
    await login(account)
    await page.goto(base+'/ui/main/flows');await page.waitForFunction(()=>location.pathname==='/ui/main/flows'&&Boolean(document.querySelector('.kel-table tbody td')))
    const baseline=await page.evaluate(async()=>{const response=await fetch('/api/v1/main/flows/search?size=1',{credentials:'same-origin',redirect:'manual'});return {status:response.status,body:await response.json()}})
    assert.equal(baseline.status,200);assert(baseline.body.results.some(flow=>flow.namespace==='ui.acceptance.reference'))
    await management.login();const assignmentPath=api+'/identity/projects/'+applicationProject+'/assignments/detail?subject='+encodeURIComponent(account.subject)
    subjectOriginal=await management.request(assignmentPath)
    const beforeEffects=effects.snapshot()
    const start=performance.now()
    await management.request(assignmentPath,'PUT',{issuer:base,subject:account.subject,projectScopes:[]},subjectOriginal.revision)
    // Do NOT sign out or replace this old browser cookie before probing it.
    const samples=[];let rejected=false
    while(performance.now()-start<60000) {
      const status=await page.evaluate(async()=>{const response=await fetch('/api/v1/main/flows/search?size=1',{credentials:'same-origin',redirect:'manual'});await response.body?.cancel();return response.status})
      samples.push({elapsedMs:Math.ceil(performance.now()-start),status});if([0,401,403].includes(status)){rejected=true;break}assert.equal(status,200);await new Promise(resolve=>setTimeout(resolve,100))
    }
    const afterEffects=effects.snapshot();assert.equal(afterEffects.hash,beforeEffects.hash,'UI subject revocation changed business persistence')
    assert(rejected,'old real UI cookie did not lose access within deadline')
    await management.reconcile(applicationProject)
    await login(account)
    await page.waitForFunction(()=>location.pathname==='/ui/access-denied'&&[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Sign out'))
    await page.click('button:text-is("Sign out")');await page.waitForFunction(()=>Boolean(document.querySelector('input[name="username"]')))
    await page.fill('input[name="username"]',planned.admin.username);await page.fill('input[name="password"]',planned.admin.password);await page.click('button[type="submit"]')
    await page.waitForFunction(()=>location.pathname==='/ui/main/dashboards'&&!document.querySelector('input[name="password"]'))
    const caps=await sameCookie('/capabilities');assert.equal(caps.status,200);assert.equal(caps.body.subject,planned.admin.subject)
    row.passed=true;row.status='passed';row.evidence={subject:account.subject,baselineStatus:200,oldCookieKeptDuringRevocation:true,beforeEffects:beforeEffects.hash,afterEffects:afterEffects.hash,sources:Object.keys(beforeEffects.sources),samples,freshZeroScopeDeniedPage:true,realSignOutClicked:true,replacementSubject:caps.body.subject}
  }catch(error){report.checks[1].status='failed';report.checks[1].evidence.error=safe(error)}finally{await persist()}
  // New identities/scopes/projects stay disabled for reproducible evidence: the
  // public directory has no project DELETE. Do not restore grants to test users.
  try {
    // Disable the target local project while explicit target authority is still
    // granted. Its identity project may then be disabled without an enabled
    // local binding exceeding the shared upper bound.
    if(createdTarget&&assignmentOriginal){
      await login(planned.admin);await open('projects/'+id,'[data-test="save-local-project"]')
      await checked('section[aria-labelledby="local-project-title"] label.checkbox input',false)
      await save('[data-test="save-local-project"]')
      const view=await sameCookie('/policy');assert.equal(view.status,200)
      if(view.body.policy.applicationProjects[id])assert.equal(view.body.policy.applicationProjects[id].enabled,false)
    }
    // Retain the exact target manager grant until both directory and local
    // policy agree. Disabled local projects still require a current revision.
    if(createdTarget){
      await management.login()
      const targetPath=api+'/identity/projects/'+id,reconciliationPath=api+'/projects/'+id+'/reconciliation'
      const before=await management.request(targetPath)
      if(before.active)await management.request(targetPath,'PUT',{displayName:before.displayName,active:false},before.revision)
      await management.login()
      const shared=await management.request(targetPath)
      assert.equal(shared.active,false)
      if(before.active){assert(shared.revision>before.revision);assert(shared.authorizationVersion>before.authorizationVersion)}
      const policy=await management.request(api+'/policy')
      if(policy.policy.applicationProjects[id]){
        const projection=await management.request(reconciliationPath)
        assert.equal(projection.upperBound.project.id,id)
        assert.equal(projection.upperBound.project.active,false)
        assert.equal(projection.directoryRevision,shared.revision)
        assert.equal(projection.project.enabled,false,'local target must be disabled before directory reconciliation')
        const candidate={...clone(projection.project),enabled:false,directoryRevision:projection.directoryRevision}
        assert(candidate.scopes&&typeof candidate.scopes==='object','complete target scope bindings required')
        await management.request(reconciliationPath,'PUT',candidate,projection.policyRevision)
        await management.login()
        const confirmed=await management.request(reconciliationPath)
        const currentShared=await management.request(targetPath)
        semanticEqual(confirmed.project,candidate,'target reconciliation changed complete reviewed bindings')
        assert.equal(currentShared.active,false)
        assert.equal(confirmed.project.enabled,false)
        assert.equal(confirmed.directoryRevision,currentShared.revision)
        assert.equal(confirmed.project.directoryRevision,currentShared.revision)
        targetCleanupState={id,localCreated:true,enabled:false,active:false,directoryRevision:currentShared.revision}
      }else targetCleanupState={id,localCreated:false,active:false,directoryRevision:shared.revision}
      report.cleanup.push({stage:'target-directory-reconciled',passed:true,...targetCleanupState});await persist()
    }
    if(revokedAccount){await management.login();const user=await management.request(api+'/users/detail?subject='+encodeURIComponent(revokedAccount.subject));await management.request(api+'/users/state','PUT',{subject:revokedAccount.subject,active:false},user.revision);await management.reconcile(applicationProject)}
    if(assignmentOriginal){await management.login();const path=api+'/identity/projects/'+applicationProject+'/assignments/detail?subject='+encodeURIComponent(planned.admin.subject),current=await management.request(path);await identity(path.slice(api.length),'PUT',{issuer:base,subject:planned.admin.subject,projectScopes:assignmentOriginal.projectScopes},current.revision)}
    if(memberOriginal){await management.login();const path=api+'/identity/projects/'+applicationProject+'/clients/'+key('kestra-ui'),current=await management.request(path);await identity(path.slice(api.length),'PUT',{clientId:'kestra-ui',approved:memberOriginal.approved,firstPartyUi:true,audiences:memberOriginal.audiences,allowedProjectScopes:memberOriginal.allowedProjectScopes},current.revision)}
    if(createdScope){await management.login();const path=api+'/identity/projects/'+applicationProject+'/scopes/'+key(scope),current=await management.request(path);const local=planned.policy.applicationProjects[applicationProject].scopes[scope];if(local)management.reconciliationEdits.set(scope,{...local,enabled:false});await management.mutateIdentity(path,'PUT',{scope,description:current.description,active:false,resourceIntents:current.resourceIntents,managementIntents:current.managementIntents},current.revision)}
    if(originalConsoleScopes){
      const final=await read('/policy')
      for(const [name,definition]of Object.entries(originalConsoleScopes))semanticEqual(final.policy.applicationProjects[applicationProject].scopes[name],definition,'existing console scope was changed: '+name)
      if(createdTarget){
        assert(targetCleanupState,'target cleanup was not confirmed before removing manager authority')
        const shared=await read('/identity/projects/'+id)
        assert.equal(shared.active,false);assert.equal(shared.revision,targetCleanupState.directoryRevision)
        const local=final.policy.applicationProjects[id]
        if(targetCleanupState.localCreated){assert(local);assert.equal(local.enabled,false);assert.equal(local.directoryRevision,shared.revision)}
        else assert.equal(local,undefined)
      }
    }
    report.cleanup.push({passed:true,newTargetRetainedDisabled:createdTarget,newManagementScopeRetainedDisabled:createdScope,mainMembershipAndSubjectRestored:true})
  }catch(error){report.cleanup.push({passed:false,error:safe(error)})}
  if(report.cleanup.some(row=>!row.passed))report.checks.push({id:'ui-target-cleanup',passed:false,status:'failed',evidence:{cleanup:report.cleanup}})
  report.completed=report.checks.every(row=>row.passed)&&report.cleanup.every(row=>row.passed);await persist();return report
}
