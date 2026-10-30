import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {applicationProject} from './application-project-cases.mjs'
import {sanitizeUiEvidence,completeFirstPasswordChange} from './access-control-v3-ui.mjs'

const api='/api/v1/main/extensions/rbac'
export const canonicalTargetValue=value=>Array.isArray(value)?value.map(canonicalTargetValue).sort((left,right)=>JSON.stringify(left).localeCompare(JSON.stringify(right))):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([left],[right])=>left.localeCompare(right)).map(([name,item])=>[name,canonicalTargetValue(item)])):value
export const targetUiCheckIds=Object.freeze(['ui-permission-runtime-projection','ui-subject-runtime-revoke'])

export async function runTargetGroupBrowser(page,base,fixture,{management,planned,effects},record) {
  assert.equal(typeof record,'function')
  const report={completed:false,checks:targetUiCheckIds.map(id=>({id,passed:false,status:'not_run',evidence:{}})),requests:[],logins:[],cleanup:[]}
  const secrets=[planned.admin.password,fixture.zeroAccount.password]
  const diagnosticStart=new Set((await page.diagnostics()).events.map(event=>event.id))
  const requestOffset=management.requests.length
  const persist=()=>record(sanitizeUiEvidence({...structuredClone(report),managementRequests:management.requests.slice(requestOffset)},secrets))
  const groupPath='/application-groups/'+encodeURIComponent(applicationProject)
  let account
  async function source() {
    const state=await page.evaluate(()=>({path:location.pathname,timeOrigin:performance.timeOrigin}))
    const diagnostics=await page.diagnostics(),document=diagnostics.documents.findLast(item=>item.frameId===diagnostics.topFrame)
    assert(document?.id);return {...state,documentId:document.id}
  }
  async function sameCookie(path,{expectedStatuses=[200]}={}) {
    const before=await source(),fullPath=path.startsWith('/api/')?path:api+path
    const result=await page.evaluate(async path=>{const response=await fetch(path,{credentials:'same-origin',redirect:'manual'});return {status:response.status,body:await response.json().catch(()=>null)}},fullPath)
    assert.equal((await source()).timeOrigin,before.timeOrigin)
    report.requests.push({path:fullPath,method:'GET',status:result.status,source:before,expectedStatuses});await persist()
    assert(expectedStatuses.includes(result.status),'same-cookie status '+result.status)
    return result
  }
  async function login(value) {
    const before=new Set((await page.diagnostics()).events.map(event=>event.id))
    await page.goto(base+'/ui/access-denied')
    await page.waitForFunction(()=>Boolean(document.querySelector('input[name="username"]'))||Boolean(document.querySelector('[data-testid="return-to-login"]')))
    if(!await page.evaluate(()=>Boolean(document.querySelector('input[name="username"]'))))await page.click('[data-testid="return-to-login"]')
    await page.waitForFunction(()=>Boolean(document.querySelector('input[name="password"]')))
    await page.fill('input[name="username"]',value.username);await page.fill('input[name="password"]',value.password);await page.click('button[type="submit"]')
    await completeFirstPasswordChange(page,value,fixture.firstPasswordChange??{path:'/oidc/password',newPassword:'input[name="password"]',confirmPassword:'input[name="confirmation"]',submit:'button[type="submit"]'},async(status,requestId)=>{report.requests.push({path:'/api/v1/main/flows/search?size=1',method:'GET',status,requestId,source:await source(),expectedStatuses:[401,403]});await persist()})
    secrets.push(value.password)
    await page.waitForFunction(()=>!document.querySelector('input[name="password"]')&&['/ui/main/dashboards','/ui/access-denied'].includes(location.pathname))
    const events=(await page.diagnostics()).events.filter(event=>!before.has(event.id))
    report.logins.push({subject:value.subject,path:(await source()).path,documentIds:[...new Set(events.filter(event=>event.kind==='document-navigation').map(event=>event.documentId))]});await persist()
  }
  async function check(index,operation) {
    const row=report.checks[index];row.status='running';await persist()
    try{row.evidence=await operation();row.status='passed';row.passed=true}catch(error){row.status='failed';row.evidence={error:String(error.message)}}finally{await persist()}
  }
  await persist()
  await check(0,async()=>{
    assert.equal(fixture.applicationGroupId,applicationProject)
    assert.equal(typeof effects?.snapshot,'function','business persistence/queue/storage observation required')
    await management.login()
    const permissions=await management.readPermissions(applicationProject)
    const selected=permissions.items.filter(permission=>permission.scopeKeys.includes(fixture.referenceScopeKey))
    assert(selected.some(permission=>permission.enabled&&permission.grants.some(grant=>grant.namespace===fixture.referenceNamespace&&grant.resource==='FLOW'&&grant.actions.includes('READ')&&grant.actions.includes('LIST'))),'reference typed permission projection missing')
    const username='ui-revoke-'+randomBytes(6).toString('hex')
    const created=await management.request(api+'/users','POST',{username,name:'UI runtime revocation',email:username+'@acceptance.invalid'})
    assert.equal(created.subject,username);assert.equal(typeof created.temporaryPassword,'string')
    secrets.push(created.temporaryPassword);page.redactSecrets([created.temporaryPassword])
    account={username,subject:created.subject,password:created.temporaryPassword,passwordChangeRequired:true}
    await management.reauthenticateGroup(applicationProject)
    const group=await management.request(api+groupPath)
    await management.mutateDirectory(api+groupPath+'/scope-grants','POST',{issuer:base,subject:account.subject,scopeKeys:[fixture.referenceScopeKey]},group.revision)
    await login(account)
    await page.goto(base+'/ui/main/flows')
    await page.waitForFunction(()=>location.pathname==='/ui/main/flows'&&Boolean(document.querySelector('.kel-table tbody td')))
    const baseline=await sameCookie('/api/v1/main/flows/search?size=100')
    assert(Array.isArray(baseline.body.results)&&baseline.body.results.length)
    assert(baseline.body.results.every(flow=>flow.namespace===fixture.referenceNamespace),'reference UI list leaked another namespace')
    return {subject:account.subject,namespace:fixture.referenceNamespace,permissionKeys:selected.map(permission=>permission.key),status:baseline.status,firstPasswordChange:'real-browser',visibleResults:baseline.body.results.map(flow=>({id:flow.id,namespace:flow.namespace}))}
  })
  await check(1,async()=>{
    assert(report.checks[0].passed,'real typed permission and temporary-password browser precondition did not pass')
    await management.login()
    const path=api+groupPath+'/scope-grants/detail?subject='+encodeURIComponent(account.subject)
    const original=await management.request(path),before=await effects.snapshot()
    const start=performance.now()
    await management.request(path,'PUT',{issuer:base,subject:account.subject,scopeKeys:[]},original.revision)
    const samples=[];let rejected=false
    while(performance.now()-start<60000) {
      const result=await sameCookie('/api/v1/main/flows/search?size=1',{expectedStatuses:[200,401,403]})
      samples.push({elapsedMs:Math.ceil(performance.now()-start),status:result.status})
      if([401,403].includes(result.status)){rejected=true;break}
      await new Promise(resolve=>setTimeout(resolve,100))
    }
    assert(rejected,'old actual browser cookie retained access after 60 seconds')
    const after=await effects.snapshot();assert.equal(after.hash,before.hash,'revocation changed business persistence/queues/storage')
    await management.login();const stored=await management.request(path);assert.deepEqual(stored.scopeKeys,[],'zero-scope subject must remain persisted')
    await login(account);assert.equal((await source()).path,'/ui/access-denied')
    await page.click('[data-testid="return-to-login"]');await page.waitForFunction(()=>Boolean(document.querySelector('input[name="username"]')))
    await page.fill('input[name="username"]',planned.admin.username);await page.fill('input[name="password"]',planned.admin.password);await page.click('button[type="submit"]')
    await page.waitForFunction(()=>location.pathname==='/ui/main/dashboards'&&!document.querySelector('input[name="password"]'))
    const capabilities=await sameCookie('/capabilities');assert.equal(capabilities.body.subject,planned.admin.subject)
    return {subject:account.subject,beforeEffects:before.hash,afterEffects:after.hash,sources:Object.keys(before.sources),samples,zeroScopePersisted:true,oldCookieKeptDuringRevocation:true,realSignOutClicked:true,replacementSubject:capabilities.body.subject}
  })
  if(account) {
    try {
      await management.login()
      const user=await management.request(api+'/users/detail?subject='+encodeURIComponent(account.subject))
      await management.request(api+'/users/detail?subject='+encodeURIComponent(account.subject),'DELETE',undefined,user.revision)
      const grants=await management.request(api+groupPath+'/scope-grants?page=1&size=100')
      assert.equal(grants.total,grants.items.length,'full cleanup grant catalog required')
      assert(!grants.items.some(grant=>grant.subject===account.subject),'account delete left subject grant')
      report.cleanup.push({stage:'test-account-deleted-atomically',passed:true})
    }catch(error){report.cleanup.push({stage:'test-account-deleted-atomically',passed:false,error:String(error.message)})}
    await persist()
  }
  const events=(await page.diagnostics()).events.filter(event=>!diagnosticStart.has(event.id))
  const expectedResponse=event=>report.requests.some(request=>(!request.requestId||request.requestId===event.requestId)&&request.source.documentId===event.documentId&&base+request.path===event.url&&request.method===event.method&&request.status===event.status&&request.expectedStatuses.includes(event.status))||report.logins.some(login=>login.documentIds.includes(event.documentId)&&event.method==='GET'&&([401,403].includes(event.status)&&event.url===base+api+'/capabilities'&&new URL(event.documentUrl).pathname==='/ui/access-denied'||event.status===403&&event.url===base+'/api/v1/configs'&&login.path==='/ui/access-denied'))
  const aborted=event=>event.kind==='request-failed'&&event.message==='net::ERR_ABORTED'&&(event.resourceType==='Script'&&event.url.startsWith(base+'/ui/assets/')||event.url.startsWith('https://api.kestra.io/v1/feeds?')||['/api/v1/main/dashboards/charts/preview',api+'/capabilities'].some(path=>event.url===base+path)&&events.some(request=>request.kind==='request'&&request.requestId===event.requestId&&request.documentId===event.documentId&&request.url===event.url))&&events.some(next=>next.kind==='document-navigation'&&next.documentId!==event.documentId&&Math.abs(Date.parse(next.observedAt)-Date.parse(event.observedAt))<=1000)
  const allowed=event=>event.kind==='http-error'&&expectedResponse(event)||aborted(event)||event.kind==='console-error'&&event.requestId&&events.some(response=>response.kind==='http-error'&&response.requestId===event.requestId&&response.documentId===event.documentId&&response.url===event.url&&expectedResponse(response))||event.kind==='console-error'&&event.message.startsWith('TypeError: Failed to fetch\n')&&events.some(cancelled=>aborted(cancelled)&&cancelled.documentId===event.documentId&&Math.abs(Date.parse(cancelled.observedAt)-Date.parse(event.observedAt))<=1000)
  const unexpected=events.filter(event=>['console-error','page-error','request-failed','http-error','diagnostic-integrity-error'].includes(event.kind)&&!allowed(event))
  report.diagnostics={events,unexpected,expectedErrorIds:events.filter(allowed).map(event=>event.id)}
  if(unexpected.length)report.cleanup.push({stage:'target-ui-source-attributed-diagnostics',passed:false,error:'unclassified browser errors'})
  report.completed=report.checks.every(row=>row.passed&&row.status==='passed')&&report.cleanup.every(row=>row.passed)
  await persist();return sanitizeUiEvidence(report,secrets)
}
