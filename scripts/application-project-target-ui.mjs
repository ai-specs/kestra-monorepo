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
export async function runTargetGroupBrowser(page,base,fixture,{management,planned,effects},record) {
  assert.equal(typeof record,'function')
  const report={completed:false,checks:targetUiCheckIds.map(id=>({id,passed:false,status:'not_run',evidence:{}})),requests:[],logins:[],cleanup:[]}
  assert.equal(fixture.applicationGroupId,applicationProject,'target browser must use its prepared group')
  assert(typeof fixture.currentApplicationClientId==='string'&&fixture.currentApplicationClientId)
  assert(typeof fixture.referenceScopeKey==='string'&&typeof fixture.referenceNamespace==='string')
  const currentApplication=fixture.currentApplicationClientId
  const groupPath='/application-groups/'+encodeURIComponent(applicationProject)
  const applicationPath=groupPath+'/applications/'+key(currentApplication)
  const declarationPath=applicationPath+'/scope-declarations/'+encodeURIComponent(fixture.scope)
  const runtimePath=applicationPath+'/runtime-permissions'
  let declarationOriginal,revokedAccount,policyBaseline
  const diagnosticStart=new Set((await page.diagnostics()).events.map(event=>event.id))
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
    const previous=new Set((await page.diagnostics()).events.map(event=>event.id))
    await page.goto(base+'/ui/access-denied')
    await page.waitForFunction(()=>Boolean(document.querySelector('input[name="username"]'))||Boolean(document.querySelector('[data-testid="return-to-login"]')))
    if(!await page.evaluate(()=>Boolean(document.querySelector('input[name="username"]'))))await page.click('[data-testid="return-to-login"]')
    await page.waitForFunction(()=>Boolean(document.querySelector('input[name="username"]'))&&Boolean(document.querySelector('input[name="password"]')))
    await page.fill('input[name="username"]',account.username);await page.fill('input[name="password"]',account.password);await page.click('button[type="submit"]')
    await page.waitForFunction(()=>!document.querySelector('input[name="password"]')&&['/ui/main/dashboards','/ui/access-denied'].includes(location.pathname))
    const diagnostics=await page.diagnostics()
    const documentIds=[...new Set(diagnostics.events.filter(event=>!previous.has(event.id)&&event.kind==='document-navigation').map(event=>event.documentId))]
    report.logins.push({subject:account.subject,path:await page.evaluate(()=>location.pathname),documentIds});await persist()
  }
  async function open(path,selector) {await page.goto(base+'/ui/main/extensions/rbac/'+path);await page.waitForFunction(({root,selector})=>Boolean(document.querySelector(root)?.shadowRoot?.querySelector(selector))&&document.querySelector(root).shadowRoot.querySelector('main')?.getAttribute('aria-busy')==='false',{root,selector})}
  async function sameCookie(path,method='GET',body,revision,{expectedStatuses=[200]}={}) {
    const targetPath=path.startsWith('/api/')?path:api+path
    const before=await page.evaluate(()=>({url:location.href,timeOrigin:performance.timeOrigin}))
    const diagnostics=await page.diagnostics(),sourceDocument=diagnostics.documents.findLast(item=>item.frameId===diagnostics.topFrame)
    assert(sourceDocument?.id,'same-cookie request must have a browser document identity')
    let result
    try {
      result=await page.evaluate(async({path,method,body,revision})=>{
        const source={url:location.href,timeOrigin:performance.timeOrigin}
        const headers={Accept:'application/json'}
        if(body!==undefined)headers['Content-Type']='application/json'
        if(revision!==undefined)headers['If-Match']='"'+revision+'"'
        if(method!=='GET'){headers['X-CSRF-TOKEN']=document.querySelector('meta[name="csrf-token"]')?.content;if(!headers['X-CSRF-TOKEN'])throw new Error('real UI CSRF meta missing')}
        const response=await fetch(path,{method,headers,credentials:'same-origin',redirect:'manual',...(body===undefined?{}:{body:JSON.stringify(body)})})
        return {status:response.status,body:await response.json().catch(()=>null),source}
      },{path:targetPath,method,body,revision})
      assert.equal(result.source.timeOrigin,before.timeOrigin,'same-cookie request changed browser document before source attribution')
      report.requests.push({path:targetPath,method,status:result.status,expectedStatuses,source:{...result.source,documentId:sourceDocument.id}})
      await persist();return result
    } catch(error) {
      report.requests.push({path:targetPath,method,status:result?.status??null,expectedStatuses,source:{...before,documentId:sourceDocument.id},error:safe(error)})
      await persist();throw error
    }
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
      const markers=()=>[...shadow.querySelectorAll('p.message[role="status"],[data-test="reauthenticate"]')]
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
      window.__applicationGroupTargetSave??={};window.__applicationGroupTargetSave[token]=state
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
        const shadow=document.querySelector(root)?.shadowRoot,state=window.__applicationGroupTargetSave?.[token]
        if(!shadow||!state||shadow.querySelector('main')?.getAttribute('aria-busy')!=='false')return false
        const completed=Boolean(shadow.querySelector('p.message[role="status"],[data-test="reauthenticate"]'))
        return completed&&(state.busy||state.changed)
      },{root,token})
    } finally {
      await page.evaluate(token=>{const state=window.__applicationGroupTargetSave?.[token];state?.observer?.disconnect();if(window.__applicationGroupTargetSave)delete window.__applicationGroupTargetSave[token]},token)
    }
  }
  await persist()
  try {
    const row=report.checks[0];row.status='running';await persist()
    await login(planned.admin)
    const clientPath='application-groups/'+applicationProject+'/applications/'+key(currentApplication)
    policyBaseline=await read(runtimePath)
    await open(clientPath,'[data-test="application-declarations"]')
    const section='[data-scope="'+fixture.scope+'"]'
    const before=await sameCookie(declarationPath)
    assert.equal(before.status,200)
    declarationOriginal=clone(before.body)
    const original=before.body.permissions
    assert.equal(original.length,1,'controlled UI declaration must have one initial permission')
    assert(original[0].key&&original[0].name)
    const renamed='Browser reviewed '+original[0].name
    await page.fill(section+' .application-permission-row:first-of-type input',renamed)
    await save(section+' .buttons button:first-child','PUT',declarationPath)
    const saved=await sameCookie(declarationPath)
    assert.equal(saved.status,200)
    assert(saved.body.revision>before.body.revision)
    assert.equal(saved.body.permissions[0].key,original[0].key)
    assert.equal(saved.body.permissions[0].name,renamed)
    semanticEqual(await read(runtimePath),policyBaseline,'permission display name changed application runtime policy')
    const extraKey='browser-extra-'+randomBytes(6).toString('hex'),extraName='Browser additional declared permission'
    const extraRow=section+' .application-permission-add'
    await page.fill(extraRow+' label:nth-of-type(1) input',extraKey)
    await page.fill(extraRow+' label:nth-of-type(2) input',extraName)
    await page.click(extraRow+' button')
    await save(section+' .buttons button:first-child','PUT',declarationPath)
    const added=await sameCookie(declarationPath)
    assert.equal(added.status,200);assert.equal(added.body.permissions.length,2)
    assert(added.body.permissions.some(permission=>permission.key===extraKey&&permission.name===extraName))
    assert(added.body.permissions.some(permission=>permission.key===original[0].key&&permission.name===renamed))
    semanticEqual(await read(runtimePath),policyBaseline,'adding declared metadata changed application runtime policy')
    await open(clientPath,'[data-test="application-declarations"]')
    const displayed=await page.evaluate(({root,section})=>document.querySelector(root).shadowRoot.querySelector(section+' .application-permission-row:first-of-type input')?.value,{root,section})
    assert.equal(displayed,renamed,'refresh lost application permission name')
    await page.click(section+' .buttons button:nth-child(2)')
    await page.waitForFunction(({root,section})=>Boolean(document.querySelector(root).shadowRoot.querySelector(section+' [role="alertdialog"]')),{root,section})
    await save(section+' [role="alertdialog"] button:first-of-type','DELETE',declarationPath)
    await login(planned.admin)
    const revoked=await sameCookie(declarationPath,'GET',undefined,undefined,{expectedStatuses:[404]})
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
    semanticEqual(await read(runtimePath),policyBaseline,'metadata deletion or recreation changed application runtime policy')
    row.passed=true;row.status='passed';row.evidence={applicationGroupId:applicationProject,clientId:currentApplication,scopeKey:fixture.scope,
      permissionKey:original[0].key,originalName:original[0].name,updatedName:renamed,
      updateRevision:saved.body.revision,addedPermissionKey:extraKey,addedPermissionName:extraName,actualPolicyUnchanged:true,deletedWithRealUi:true,recreatedWithRealUi:true}
  }catch(error){report.checks[0].status='failed';report.checks[0].evidence.error=safe(error)}finally{await persist()}
  try {
    const row=report.checks[1];row.status='running';await persist()
    // UI-only account has exactly the reference scope, not an old REST fixture.
    const password=randomBytes(24).toString('base64url')+'Aa1!',username='ui-revoke-'+randomBytes(6).toString('hex')
    secrets.add(password);page.redactSecrets([password])
    await management.login();const created=await management.request(api+'/users','POST',{username,name:'UI runtime revocation',email:username+'@acceptance.invalid',password})
    assert.equal(created.subject,username)
    const account={username,password,subject:created.subject};revokedAccount=account
    await management.reauthenticateGroup(applicationProject)
    const group=await management.request(api+groupPath)
    const reference=fixture.referenceScopeKey
    await management.mutateDirectory(api+groupPath+'/scope-grants','POST',{issuer:base,subject:created.subject,scopeKeys:[reference]},group.revision)
    await login(account)
    await page.goto(base+'/ui/main/flows');await page.waitForFunction(()=>location.pathname==='/ui/main/flows'&&Boolean(document.querySelector('.kel-table tbody td')))
    const baseline=await sameCookie('/api/v1/main/flows/search?size=1')
    assert.equal(baseline.status,200);assert(Array.isArray(baseline.body.results)&&baseline.body.results.length)
    assert(baseline.body.results.every(flow=>flow.namespace===fixture.referenceNamespace),'reference account list leaked another namespace')
    await management.login();const assignmentPath=api+groupPath+'/scope-grants/detail?subject='+encodeURIComponent(account.subject)
    const subjectOriginal=await management.request(assignmentPath)
    const beforeEffects=effects.snapshot()
    const start=performance.now()
    await management.request(assignmentPath,'PUT',{issuer:base,subject:account.subject,scopeKeys:[]},subjectOriginal.revision)
    // Do NOT sign out or replace this old browser cookie before probing it.
    const samples=[];let rejected=false
    while(performance.now()-start<60000) {
      const status=(await sameCookie('/api/v1/main/flows/search?size=1','GET',undefined,undefined,{expectedStatuses:[200,401,403]})).status
      samples.push({elapsedMs:Math.ceil(performance.now()-start),status});if([401,403].includes(status)){rejected=true;break}assert.equal(status,200);await new Promise(resolve=>setTimeout(resolve,100))
    }
    const afterEffects=effects.snapshot();assert.equal(afterEffects.hash,beforeEffects.hash,'UI subject revocation changed business persistence')
    assert(rejected,'old real UI cookie did not lose access within deadline')
    await management.reauthenticateGroup(applicationProject)
    await login(account)
    await page.waitForFunction(()=>location.pathname==='/ui/access-denied'&&Boolean(document.querySelector('[data-testid="return-to-login"]')))
    await page.click('[data-testid="return-to-login"]');await page.waitForFunction(()=>Boolean(document.querySelector('input[name="username"]')))
    await page.fill('input[name="username"]',planned.admin.username);await page.fill('input[name="password"]',planned.admin.password);await page.click('button[type="submit"]')
    await page.waitForFunction(()=>location.pathname==='/ui/main/dashboards'&&!document.querySelector('input[name="password"]'))
    const caps=await sameCookie('/capabilities');assert.equal(caps.status,200);assert.equal(caps.body.subject,planned.admin.subject)
    row.passed=true;row.status='passed';row.evidence={subject:account.subject,baselineStatus:200,oldCookieKeptDuringRevocation:true,beforeEffects:beforeEffects.hash,afterEffects:afterEffects.hash,sources:Object.keys(beforeEffects.sources),samples,freshZeroScopeDeniedPage:true,realSignOutClicked:true,replacementSubject:caps.body.subject}
  }catch(error){report.checks[1].status='failed';report.checks[1].evidence.error=safe(error)}finally{await persist()}
  async function cleanup(name,operation) {
    try {await operation();report.cleanup.push({stage:name,passed:true})}
    catch(error){report.cleanup.push({stage:name,passed:false,error:safe(error)})}
    await persist()
  }
  if(declarationOriginal)await cleanup('declaration-original-restored',async()=>{
    await management.login()
    const all=await management.request(api+applicationPath+'/scope-declarations')
    assert(Array.isArray(all))
    const current=all.find(item=>item.scopeKey===fixture.scope)
    if(!current)await management.request(api+declarationPath,'POST',{permissions:declarationOriginal.permissions})
    else if(JSON.stringify(canonicalTargetValue(current.permissions))!==JSON.stringify(canonicalTargetValue(declarationOriginal.permissions)))
      await management.request(api+declarationPath,'PUT',{permissions:declarationOriginal.permissions},current.revision)
    const restored=await read(declarationPath)
    semanticEqual(restored.permissions,declarationOriginal.permissions,'metadata cleanup did not restore all original permission keys and names')
    semanticEqual(await read(runtimePath),policyBaseline,'metadata CRUD or cleanup changed actual application policy')
  })
  if(revokedAccount)await cleanup('revoked-test-account-disabled-without-grants',async()=>{
    await management.login()
    const path=groupPath+'/scope-grants/detail?subject='+encodeURIComponent(revokedAccount.subject)
    const grants=await management.request(api+groupPath+'/scope-grants?page=1&size=100')
    assert.equal(grants.total,grants.items.length,'complete test grant cleanup list required')
    const assignment=grants.items.find(item=>item.subject===revokedAccount.subject)
    if(assignment)await management.mutateDirectory(api+path,'DELETE',undefined,assignment.revision)
    await management.login()
    const user=await management.request(api+'/users/detail?subject='+encodeURIComponent(revokedAccount.subject))
    await management.request(api+'/users/state','PUT',{subject:revokedAccount.subject,active:false},user.revision)
    assert.equal((await read('/users/detail?subject='+encodeURIComponent(revokedAccount.subject))).active,false)
  })
  await cleanup('target-ui-diagnostics',async()=>{
    const observed=await page.diagnostics(),events=observed.events.filter(event=>!diagnosticStart.has(event.id))
    const errors=events.filter(event=>['console-error','page-error','http-error','request-failed'].includes(event.kind))
    const expectedResponse=event=>report.requests.some(request=>request.source?.documentId===event.documentId&&request.method===event.method
      &&new URL(request.path,base).href===event.url&&request.status===event.status&&request.expectedStatuses?.includes(event.status)&&[401,403,404].includes(event.status))
      ||report.logins.some(login=>login.documentIds.includes(event.documentId)&&(
        event.method==='GET'&&event.url===base+'/api/v1/configs'&&event.status===403&&login.path==='/ui/access-denied'
        ||event.method==='GET'&&event.url===base+api+'/capabilities'&&[401,403].includes(event.status)&&new URL(event.documentUrl).pathname==='/ui/access-denied'))
    const navigationAbort=event=>event.kind==='request-failed'&&event.message==='net::ERR_ABORTED'
      &&(event.resourceType==='Script'&&event.url.startsWith(base+'/ui/assets/')
        ||event.url.startsWith('https://api.kestra.io/v1/feeds?')
        ||event.resourceType==='Fetch'&&['/api/v1/main/dashboards/charts/preview','/api/v1/main/extensions/rbac/capabilities'].includes(new URL(event.url,base).pathname)
          &&events.some(request=>request.kind==='request'&&request.requestId===event.requestId&&request.documentId===event.documentId&&request.url===event.url)
        ||report.requests.some(request=>request.source?.documentId===event.documentId&&new URL(request.path,base).href===event.url))
      &&events.some(next=>next.kind==='document-navigation'&&next.documentId!==event.documentId&&Math.abs(Date.parse(next.observedAt)-Date.parse(event.observedAt))<=1000)
    const allowed=event=>event.kind==='http-error'&&expectedResponse(event)||navigationAbort(event)
      ||event.kind==='console-error'&&event.message.startsWith('TypeError: Failed to fetch\n')
        &&events.some(cancelled=>navigationAbort(cancelled)&&cancelled.documentId===event.documentId
          &&Math.abs(Date.parse(cancelled.observedAt)-Date.parse(event.observedAt))<=1000)
      ||event.kind==='console-error'&&event.requestId&&events.some(response=>response.kind==='http-error'&&response.requestId===event.requestId
        &&response.documentId===event.documentId&&response.url===event.url&&response.status===event.status&&expectedResponse(response))
    const failures=errors.filter(event=>!allowed(event))
    report.diagnostics={events,unexpected:failures,expectedErrorIds:errors.filter(allowed).map(event=>event.id)}
    await persist()
    assert.equal(failures.length,0,'target UI has unclassified document/request errors: '+JSON.stringify(safeValue(failures)))
  })
  if(report.cleanup.some(row=>!row.passed))report.checks.push({id:'ui-target-cleanup',passed:false,status:'failed',evidence:{cleanup:report.cleanup}})
  report.completed=report.checks.every(row=>row.passed)&&report.cleanup.every(row=>row.passed);await persist();return report
}
