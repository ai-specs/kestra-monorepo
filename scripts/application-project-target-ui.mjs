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

export const targetUiCheckIds=Object.freeze(['ui-application-declaration-crud','ui-subject-revoke'])
export async function runTargetProjectBrowser(page,base,fixture,{management,planned,effects},record) {
  assert.equal(typeof record,'function')
  const report={completed:false,checks:targetUiCheckIds.map(id=>({id,passed:false,status:'not_run',evidence:{}})),requests:[],logins:[],cleanup:[]}
  const id='ui-target-'+randomBytes(6).toString('hex'),scope='acceptance-'+id+'-manage-v1',targetScope='acceptance-'+id+'-read-v1'
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
    await page.waitForFunction(()=>Boolean(document.querySelector('input[name="username"]'))||Boolean(document.querySelector('[data-testid="return-to-login"]')))
    if(!await page.evaluate(()=>Boolean(document.querySelector('input[name="username"]'))))await page.click('[data-testid="return-to-login"]')
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
  async function save(selector,expectedMethod,expectedPath) {
    const previousEvents=new Set((await page.diagnostics()).events.map(event=>event.id))
    const initialDiagnostics=await page.diagnostics()
    const sourceDocument=initialDiagnostics.documents.findLast(document=>document.frameId===initialDiagnostics.topFrame)
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
      const deadline=Date.now()+30000
      let response
      while(Date.now()<deadline){
        response=(await page.diagnostics()).events.find(event=>!previousEvents.has(event.id)&&event.documentId===sourceDocument?.id&&['http-response','http-error'].includes(event.kind)&&event.method===expectedMethod&&event.url===base+api+expectedPath)
        if(response)break
        await new Promise(resolve=>setTimeout(resolve,50))
      }
      assert(response,'native target save produced no exact HTTP response')
      report.requests.push({path:api+expectedPath,method:expectedMethod,status:response.status,requestId:response.requestId,documentId:response.documentId})
      await persist()
      assert(response.status>=200&&response.status<300,'native target save was rejected HTTP '+response.status)
      await page.waitForFunction(({root,token})=>{
        if(location.pathname==='/' + ['ui','access-denied'].join('/'))return true
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
    await save('[data-test="save-project-reconciliation"]','PUT','/projects/'+applicationProject+'/reconciliation')
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
    assert(projection.directoryRevision>before.revision)
    await reconcileConsole(false)
    return result
  }
  await persist()
  try {
    const row=report.checks[0];row.status='running';await persist()
    await login(planned.admin)
    const clientPath='projects/'+applicationProject+'/clients/'+key('kestra-ui')
    const declarationPath='/application-groups/'+applicationProject+'/applications/'+key('kestra-ui')+'/scope-declarations/'+encodeURIComponent(fixture.scope)
    await open(clientPath,'[data-test="application-declarations"]')
    const section='[data-scope="'+fixture.scope+'"]'
    const before=await sameCookie(declarationPath)
    assert.equal(before.status,200)
    const original=before.body.permissions
    assert(original.length>0 && original[0].key && original[0].name)
    const renamed='Browser reviewed '+original[0].name
    await page.fill(section+' .application-permission-row:first-of-type input',renamed)
    await save(section+' .buttons button:first-child','PUT',declarationPath)
    const saved=await sameCookie(declarationPath)
    assert.equal(saved.status,200)
    assert(saved.body.revision>before.body.revision)
    assert.equal(saved.body.permissions[0].key,original[0].key)
    assert.equal(saved.body.permissions[0].name,renamed)
    await open(clientPath,'[data-test="application-declarations"]')
    const displayed=await page.evaluate(({root,section})=>document.querySelector(root).shadowRoot.querySelector(section+' .application-permission-row:first-of-type input')?.value,{root,section})
    assert.equal(displayed,renamed,'refresh lost application permission name')
    await page.click(section+' .buttons button:nth-child(2)')
    await page.waitForFunction(({root,section})=>Boolean(document.querySelector(root).shadowRoot.querySelector(section+' [role="alertdialog"]')),{root,section})
    await save(section+' [role="alertdialog"] button:first-of-type','DELETE',declarationPath)
    await login(planned.admin)
    const revoked=await sameCookie(declarationPath)
    assert.equal(revoked.status,404,'deleted declaration still visible')
    await open(clientPath,'[data-test="application-declarations"]')
    const missing=await page.evaluate(({root,section})=>document.querySelector(root).shadowRoot.querySelector(section)===null,{root,section})
    assert(missing,'deleted declaration remained on the application page')
    await page.selectOption('.application-declarations form select',fixture.scope)
    await page.fill('.application-declarations form label:nth-of-type(2) input',original[0].key)
    await page.fill('.application-declarations form label:nth-of-type(3) input',original[0].name)
    await save('.application-declarations form button[type="submit"]','POST',declarationPath)
    const restored=await read(declarationPath)
    semanticEqual(restored.permissions,original,'recreated declaration changed permission metadata')
    row.passed=true;row.status='passed';row.evidence={groupId:applicationProject,clientId:'kestra-ui',scope:fixture.scope,
      permissionKey:original[0].key,originalName:original[0].name,updatedName:renamed,
      updateRevision:saved.body.revision,deletedWithRealUi:true,recreatedWithRealUi:true}
  }catch(error){report.checks[0].status='failed';report.checks[0].evidence.error=safe(error)}finally{await persist()}
  try {
    const row=report.checks[1];row.status='running';await persist()
    // UI-only account has exactly the reference scope, not an old REST fixture.
    const password=randomBytes(24).toString('base64url')+'Aa1!',username='ui-revoke-'+randomBytes(6).toString('hex')
    secrets.add(password);page.redactSecrets([password])
    await management.login();const created=await management.request(api+'/users','POST',{username,name:'UI runtime revocation',email:username+'@acceptance.invalid',password})
    await management.reconcile(applicationProject)
    const project=await management.request(api+'/identity/projects/'+applicationProject)
    const reference='acceptance-ui-reference-v1'
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
    await page.waitForFunction(()=>location.pathname==='/ui/access-denied'&&Boolean(document.querySelector('[data-testid="return-to-login"]')))
    await page.click('[data-testid="return-to-login"]');await page.waitForFunction(()=>Boolean(document.querySelector('input[name="username"]')))
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
      await save('[data-test="save-local-project"]','PUT','/projects/'+id)
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
        assert.equal(projection.upperBound.project.enabled,false)
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
    if(createdScope){await management.login();const path=api+'/identity/projects/'+applicationProject+'/scopes/'+key(scope),current=await management.request(path);const local=planned.policy.applicationProjects[applicationProject].scopes[scope];if(local)management.reconciliationEdits.set(scope,{...local,enabled:false});await management.mutateIdentity(path,'PUT',{scope,name:current.name,description:current.description,active:false,resourceIntents:current.resourceIntents,managementIntents:current.managementIntents},current.revision)}
    if(originalConsoleScopes){
      const final=await read('/policy')
      for(const [name,definition]of Object.entries(originalConsoleScopes))semanticEqual(final.policy.applicationProjects[applicationProject].scopes[name],definition,'existing console scope was changed: '+name)
      if(createdTarget){
        assert(targetCleanupState,'target cleanup was not confirmed before removing manager authority')
        const shared=await read('/identity/projects/'+id)
        assert.equal(shared.active,false);assert.equal(shared.revision,targetCleanupState.directoryRevision)
        const local=final.policy.applicationProjects[id]
        assert.equal(local,undefined,'removing the exact target manager scope must hide that local target from the filtered policy')
        if(targetCleanupState.localCreated){assert.equal(targetCleanupState.enabled,false);assert.equal(targetCleanupState.directoryRevision,shared.revision)}
      }
    }
    report.cleanup.push({passed:true,newTargetRetainedDisabled:createdTarget,newManagementScopeRetainedDisabled:createdScope,mainMembershipAndSubjectRestored:true})
  }catch(error){report.cleanup.push({passed:false,error:safe(error)})}
  if(report.cleanup.some(row=>!row.passed))report.checks.push({id:'ui-target-cleanup',passed:false,status:'failed',evidence:{cleanup:report.cleanup}})
  report.completed=report.checks.every(row=>row.passed)&&report.cleanup.every(row=>row.passed);await persist();return report
}
