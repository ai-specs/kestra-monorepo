import assert from 'node:assert/strict'
import {classifyAccessControlDiagnostics} from './access-control-browser-diagnostics.mjs'
import {applicationGroupTables} from './application-group-artifact-contract.mjs'
import {dirname} from 'node:path'
import {readBrowserDiagnosticEvidence} from './browser-diagnostic-evidence.mjs'
import {runFirstAccountExecutions,assertFirstAccountExecutions} from './first-account-execution-browser.mjs'

export const rbacOnboardingCaseIds=Object.freeze([
  'missing-jar-guidance',
  'missing-participant-rejects-without-effects',
  'jar-placement-does-not-hotload',
  'restart-automatically-recovers-setup',
  'setup-csrf-rejection-without-effects',
  'first-account-creation-through-ui',
  'atomic-directory-and-first-subject-grant',
  'first-production-login-to-dashboard',
  'dashboard-refresh-retains-canonical-path',
  'actual-access-management-menu',
  'initial-group-description-save-and-readback',
  'completed-setup-get-and-post-closed',
])

export const rbacNormalOnboardingCaseIds=Object.freeze(['formal-jar-ready-without-restart',...rbacOnboardingCaseIds.slice(4),'initial-account-production-executions'])

export function initialRbacOnboardingReport(inputs,scenario='missing-jar') {
  assert(['missing-jar','normal'].includes(scenario))
  const cases=scenario==='normal'?rbacNormalOnboardingCaseIds:rbacOnboardingCaseIds
  return {schemaVersion:1,profile:'automatic-new-install',scenario,completed:false,inputs:structuredClone(inputs),
    cases:cases.map(id=>({id,status:'not_run',passed:false})),requests:[],restartWindows:[],
    summary:{planned:cases.length,passed:0,failed:0,notRun:cases.length,skipped:0}}
}

export function assertRbacOnboardingReport(report,inputs) {
  assert.equal(report?.schemaVersion,1)
  assert.equal(report.profile,'automatic-new-install')
  assert(['missing-jar','normal'].includes(report.scenario))
  const normal=report.scenario==='normal',caseIds=normal?rbacNormalOnboardingCaseIds:rbacOnboardingCaseIds
  assert.equal(report.completed,true,'Automatic first installation is incomplete')
  assert.deepEqual(report.inputs,inputs,'First-install evidence belongs to different formal inputs')
  assert.match(inputs.image,/^ghcr\.io\/ai-specs\/kestra-overlay@sha256:[a-f0-9]{64}$/)
  assert.match(inputs.jarSha256,/^[a-f0-9]{64}$/)
  for(const name of ['rootCommit','overlayCommit','pluginCommit'])assert.match(inputs[name],/^[a-f0-9]{40}$/)
  assert.deepEqual(report.cases.map(row=>row.id),caseIds)
  assert(report.cases.every(row=>row.status==='passed'&&row.passed===true&&row.evidence?.source==='production-browser-and-owned-storage'))
  assert.deepEqual(report.summary,{planned:caseIds.length,passed:caseIds.length,failed:0,notRun:0,skipped:0})
  assert.equal(report.diagnostics?.integrity,0)
  assert.equal(report.diagnostics?.unexpectedErrors,0)
  assert.equal(report.diagnostics?.reference?.kind,'immutable-browser-diagnostics')
  assert.match(report.diagnostics.reference.sha256,/^[a-f0-9]{64}$/)
  assert.equal(report.diagnostics?.checkpoint?.kind,'immutable-browser-diagnostics')
  assert.match(report.diagnostics.checkpoint.sha256,/^[a-f0-9]{64}$/)
  assert.deepEqual(report.telemetryRequests,[],'Usage events must remain disabled throughout the production workflow')
  const find=id=>report.cases.find(row=>row.id===id).evidence
  if(normal)assertFirstAccountExecutions(find('initial-account-production-executions').journey)
  if(normal) {
    const runtime=find('formal-jar-ready-without-restart')
    assert.equal(runtime.restartCount,0);assert.equal(runtime.jarSha256,inputs.jarSha256)
    assert.equal(runtime.path,'/oidc/setup');assert.equal(runtime.form,true)
    assert.equal(runtime.priorSession?.source,'previous-production-onboarding')
    assert.equal(runtime.priorSession.restored,true)
    assert.match(runtime.priorSession.sha256,/^[a-f0-9]{64}$/)
    assert.equal(typeof runtime.priorSession.subject,'string')
    assert(runtime.priorSession.subject.length>0)
    assert.deepEqual(report.restartWindows,[])
  } else {
  const missing=find('missing-jar-guidance')
  assert.equal(missing.form,false);assert(missing.text.includes('kestra-rbac-authorizer.jar'))
  assert(/deployment\/libs|\/app\/libs/.test(missing.text))
  const placed=find('jar-placement-does-not-hotload')
  assert.equal(placed.form,false);assert.equal(placed.formalJarVerified,true)
  assert(placed.text.includes('docker compose restart kestra'))
  const recovered=find('restart-automatically-recovers-setup')
  assert.equal(recovered.recoveredWithoutManualNavigation,true)
  assert.equal(recovered.passwordAutomaticallyReplayed,false);assert.equal(recovered.path,'/oidc/setup')
  assert.equal(report.restartWindows.length,1)
  assert(Number.isFinite(Date.parse(report.restartWindows[0].startedAt)))
  assert(Date.parse(report.restartWindows[0].finishedAt)>Date.parse(report.restartWindows[0].startedAt))
  }
  for(const id of [...(normal?[]:['missing-participant-rejects-without-effects']),'setup-csrf-rejection-without-effects']) {
    const value=find(id)
    assert.deepEqual(value.before,value.after,'Rejected first-install operation changed storage')
    assert.equal(value.before.accounts,0);assert.equal(value.before.installations,0);assert.equal(value.before.groups,0)
    assert.equal(value.before.credentials,0)
    assert.deepEqual(value.before.pluginTables,[])
    assert((id==='setup-csrf-rejection-without-effects'?[403]:[403,503]).includes(value.status))
  }
  const state=find('atomic-directory-and-first-subject-grant').state
  assert.equal(state.accounts,1);assert.equal(state.installations,1);assert.equal(state.groups,1)
  assert.equal(state.credentials,1);assert.equal(state.clients,1)
  assert.deepEqual(state.pluginTables,[...applicationGroupTables].sort())
  assert.equal(state.builtInGroupId,'main');assert.deepEqual(state.subjects,[find('first-account-creation-through-ui').subject])
  assert.deepEqual(state.scopeKeys,['admin']);assert.equal(state.catalogRevision,1)
  assert.equal(find('first-production-login-to-dashboard').path,'/ui/main/dashboards')
  const telemetry=find('first-production-login-to-dashboard').telemetry
  assert.equal(telemetry?.status,200)
  assert.equal(telemetry.isAnonymousUsageEnabled,false)
  assert.equal(telemetry.isUiAnonymousUsageEnabled,false)
  assert.deepEqual(telemetry.eventRequests,[])
  assert.equal(find('dashboard-refresh-retains-canonical-path').path,'/ui/main/dashboards')
  const menu=find('actual-access-management-menu')
  assert.equal(new URL(menu.href,'http://localhost').pathname,'/ui/main/extensions/rbac')
  assert(menu.path.startsWith('/ui/main/extensions/rbac'))
  const saved=find('initial-group-description-save-and-readback')
  assert.notEqual(saved.beforeDescription,saved.description)
  assert.equal(saved.description,saved.readBackDescription)
  assert(saved.afterRevision>saved.beforeRevision)
  assert.deepEqual(find('completed-setup-get-and-post-closed').statuses,[404,404])
  assert.equal(report.requests.length,normal?3:4,'Every explicit first-install request must retain exact browser evidence')
  const expectedRequests=[
    ...(normal?[]:[{method:'POST',statuses:[403,503]}]),
    {method:'POST',statuses:[403]},
    {method:'GET',statuses:[404]},
    {method:'POST',statuses:[404]},
  ]
  const setupPath='/'+['oidc','setup'].join('/')
  for(const [index,request] of report.requests.entries()) {
    const expected=expectedRequests[index]
    assert.equal(request.path,setupPath);assert.equal(request.method,expected.method)
    assert(expected.statuses.includes(request.status))
    assert.equal(typeof request.requestId,'string');assert(request.requestId.length>0)
    assert.equal(typeof request.source?.documentId,'string');assert(request.source.documentId.length>0)
  }
  return {profile:report.profile,...report.summary,completed:true}
}

export function classifyRbacOnboardingDiagnostics({events,base,requests,restartWindows}) {
  const shared=classifyAccessControlDiagnostics({events,base,requests})
  const classified=new Map(shared.classifications.map(item=>[item.id,item]))
  const matches=(left,right)=>left.requestId===right.requestId&&left.documentId===right.documentId&&left.url===right.url
  for(const event of events) {
    const request=events.find(item=>item.kind==='request'&&matches(item,event))
    const timestamp=Date.parse(event.observedAt)
    const restart=restartWindows.find(window=>timestamp>=Date.parse(window.startedAt)&&timestamp<=Date.parse(window.finishedAt))
    if(!restart||!request||request.method!=='GET'||request.url!==base+'/oidc/setup'
      ||new URL(request.documentUrl).pathname!=='/oidc/setup')continue
    const failed=event.kind==='request-failed'&&['net::ERR_CONNECTION_REFUSED','net::ERR_CONNECTION_RESET','net::ERR_EMPTY_RESPONSE','net::ERR_SOCKET_NOT_CONNECTED'].includes(event.message)
    const unavailable=event.kind==='http-error'&&event.status===503
    const networkConsole=event.kind==='console-error'&&event.source==='network'&&events.some(item=>matches(item,event)
      &&(item.kind==='request-failed'&&['net::ERR_CONNECTION_REFUSED','net::ERR_CONNECTION_RESET','net::ERR_EMPTY_RESPONSE','net::ERR_SOCKET_NOT_CONNECTED'].includes(item.message)
        ||item.kind==='http-error'&&item.status===503))
    if(failed||unavailable||networkConsole)classified.set(event.id,{id:event.id,reason:'owned-jvm-restart-setup-poll',
      evidence:{requestId:request.requestId,documentId:request.documentId,restart}})
  }
  return {classifications:[...classified.values()],errors:events.filter(event=>
    ['console-error','page-error','request-failed','http-error','diagnostic-integrity-error'].includes(event.kind)&&!classified.has(event.id))}
}

export function scopedRbacOnboardingEvents(evidence,checkpoint) {
  assert(Array.isArray(evidence?.events)&&Array.isArray(checkpoint?.events))
  assert.deepEqual(evidence.events.slice(0,checkpoint.events.length),checkpoint.events,
    'Earlier browser events changed or disappeared between first-install journeys')
  assert.equal(new Set(evidence.events.map(event=>event.id)).size,evidence.events.length)
  return evidence.events.slice(checkpoint.events.length)
}

export async function runRbacOnboardingBrowser(page,{base,account,inputs,controls,scenario='missing-jar',record=async()=>{}}) {
  assert.equal(new URL(base).origin,base)
  assert(['localhost','127.0.0.1'].includes(new URL(base).hostname))
  assert(account?.username&&account?.password)
  for(const method of ['assertOwner','installationState','deliverFormalJar','restartJvm','readGroup'])assert.equal(typeof controls?.[method],'function',method)
  if(scenario==='normal')assert.equal(typeof controls.readExecution,'function','production execution storage observer required')
  await controls.assertOwner()
  page.redactSecrets([account.password])
  const report=initialRbacOnboardingReport(inputs,scenario)
  const checkpointReference=await page.diagnosticEvidenceReference()
  const checkpoint=readBrowserDiagnosticEvidence(checkpointReference,[dirname(checkpointReference.path)])
  assert.equal(checkpoint.integrity.length,0)
  const path=()=>page.evaluate(()=>location.pathname)
  const persist=async()=>{
    report.summary={planned:report.cases.length,passed:report.cases.filter(row=>row.status==='passed').length,
      failed:report.cases.filter(row=>row.status==='failed').length,notRun:report.cases.filter(row=>row.status==='not_run').length,skipped:0}
    await record(structuredClone(report))
  }
  async function check(id,operation) {
    const row=report.cases.find(item=>item.id===id)
    assert.equal(row.status,'not_run')
    row.status='running';await persist()
    try {row.evidence={source:'production-browser-and-owned-storage',...await operation()};row.passed=true;row.status='passed'}
    catch(error) {row.status='failed';row.error=String(error.message).replaceAll(account.password,'[redacted]');throw error}
    finally {await persist()}
  }
  async function browserRequest(requestPath,method,expectedStatuses,body) {
    const before=new Set((await page.diagnostics()).events.map(event=>event.id))
    const value=await page.evaluate(async({requestPath,method,body})=>{
      const response=await fetch(requestPath,{method,credentials:'same-origin',redirect:'manual',signal:AbortSignal.timeout(15000),
        ...(body===undefined?{}:{headers:{'Content-Type':'application/x-www-form-urlencoded'},body})})
      await response.text()
      return {status:response.status}
    },{requestPath,method,body})
    const events=(await page.diagnostics()).events.filter(event=>!before.has(event.id))
    const responses=events.filter(event=>['http-response','http-error'].includes(event.kind)&&event.url===base+requestPath&&event.method===method&&event.status===value.status)
    assert.equal(responses.length,1,'Exact production request response is missing or ambiguous')
    report.requests.push({path:requestPath,method,status:value.status,requestId:responses[0].requestId,
      source:{documentId:responses[0].documentId},expectedStatuses})
    assert(expectedStatuses.includes(value.status),'Unexpected first-install HTTP status '+value.status)
    return value.status
  }
  async function assertEmptyInstallation() {
    const state=await controls.installationState()
    for(const field of ['accounts','installations','groups','credentials'])assert.equal(state[field],0,'Empty installation '+field+' changed')
    assert.deepEqual(state.pluginTables,[],'Empty installation already contains plugin tables')
    assert(Number.isSafeInteger(state.clients)&&state.clients>=0)
    return state
  }
  await persist()
  try {
    if(scenario==='normal') {
      await check('formal-jar-ready-without-restart',async()=>{
        assert.equal(typeof controls.initialRuntime,'function')
        const runtime=await controls.initialRuntime()
        assert.equal(runtime.restartCount,0);assert.equal(runtime.jarSha256,inputs.jarSha256)
        const priorSession=await controls.restorePriorSession()
        await page.goto(base+'/ui/')
        await page.waitForFunction(()=>location.pathname==='/oidc/setup'&&Boolean(document.querySelector('form[action="/oidc/setup"] input[name="csrf"]'))&&!document.querySelector('[data-setup-wait]'))
        await assertEmptyInstallation()
        return {...runtime,priorSession,form:true,path:await path()}
      })
    } else {
    await check('missing-jar-guidance',async()=>{
      await page.goto(base+'/ui/')
      await page.waitForFunction(()=>location.pathname==='/oidc/setup'&&document.querySelector('[data-setup-wait]')?.textContent.includes('kestra-rbac-authorizer.jar'))
      const observed=await page.evaluate(()=>({form:Boolean(document.querySelector('form[action="/oidc/setup"]')),
        text:document.querySelector('[data-setup-wait]')?.textContent.trim()}))
      assert.equal(observed.form,false);assert(observed.text.includes('kestra-rbac-authorizer.jar'))
      assert(/deployment\/libs|\/app\/libs/.test(observed.text),'Missing-plugin guidance must name the placement directory')
      await assertEmptyInstallation()
      return observed
    })
    await check('missing-participant-rejects-without-effects',async()=>{
      const before=await controls.installationState()
      const status=await browserRequest('/oidc/setup','POST',[403,503],new URLSearchParams({username:account.username,password:account.password,csrf:'invalid'}).toString())
      const after=await controls.installationState();assert.deepEqual(after,before)
      return {before,after,status}
    })
    await check('jar-placement-does-not-hotload',async()=>{
      await controls.deliverFormalJar()
      await page.reload()
      await page.waitForFunction(()=>document.querySelector('[data-setup-wait]')?.textContent.includes('docker compose restart kestra'))
      const observed=await page.evaluate(()=>({form:Boolean(document.querySelector('form[action="/oidc/setup"]')),
        text:document.querySelector('[data-setup-wait]')?.textContent.trim()}))
      assert.equal(observed.form,false);assert(/restart/i.test(observed.text))
      await assertEmptyInstallation()
      return {formalJarVerified:true,...observed}
    })
    await check('restart-automatically-recovers-setup',async()=>{
      const window={startedAt:new Date().toISOString(),finishedAt:null};report.restartWindows.push(window)
      try {
        await controls.restartJvm()
        await page.waitForFunction(()=>location.pathname==='/oidc/setup'&&Boolean(document.querySelector('form[action="/oidc/setup"] input[name="csrf"]'))&&!document.querySelector('[data-setup-wait]'))
      } finally {window.finishedAt=new Date().toISOString()}
      return {recoveredWithoutManualNavigation:true,passwordAutomaticallyReplayed:false,path:await path()}
    })
    }
    await check('setup-csrf-rejection-without-effects',async()=>{
      const before=await controls.installationState()
      const status=await browserRequest('/oidc/setup','POST',[403],new URLSearchParams({username:account.username,password:account.password,csrf:'invalid'}).toString())
      const after=await controls.installationState();assert.deepEqual(after,before)
      return {before,after,status}
    })
    await check('first-account-creation-through-ui',async()=>{
      await page.fill('input[name="username"]',account.username)
      await page.fill('input[name="name"]','First installation test account')
      await page.fill('input[name="email"]','onboarding@example.invalid')
      await page.fill('input[name="password"]',account.password)
      await page.click('form[action="/oidc/setup"] button[type="submit"]')
      await page.waitForFunction(()=>location.pathname==='/oidc/login'&&Boolean(document.querySelector('input[name="password"]')))
      return {subject:account.username,path:await path()}
    })
    await check('atomic-directory-and-first-subject-grant',async()=>{
      const state=await controls.installationState()
      assert.equal(state.accounts,1);assert.equal(state.installations,1);assert.equal(state.groups,1)
      assert.equal(state.credentials,1);assert.equal(state.clients,1)
      assert.deepEqual(state.subjects,[account.username]);assert.deepEqual(state.scopeKeys,['admin'])
      assert.equal(state.builtInGroupId,'main');assert.equal(state.catalogRevision,1)
      return {state}
    })
    await check('first-production-login-to-dashboard',async()=>{
      await page.fill('input[name="username"]',account.username);await page.fill('input[name="password"]',account.password)
      await page.click('button[type="submit"]')
      await page.waitForFunction(()=>location.pathname==='/ui/main/dashboards'&&Boolean(document.querySelector('#side-menu'))&&!document.querySelector('input[name="password"]'))
      const telemetry=await page.evaluate(async()=>{
        const response=await fetch('/api/v1/configs',{credentials:'same-origin',signal:AbortSignal.timeout(15000)})
        const configs=await response.json()
        return {status:response.status,isAnonymousUsageEnabled:configs.isAnonymousUsageEnabled,
          isUiAnonymousUsageEnabled:configs.isUiAnonymousUsageEnabled,
          eventRequests:performance.getEntriesByType('resource').map(entry=>entry.name).filter(value=>{
            const url=new URL(value);return url.hostname==='api.kestra.io'&&url.pathname==='/v1/reports/events'
          })}
      })
      assert.equal(telemetry.status,200)
      assert.equal(telemetry.isAnonymousUsageEnabled,false)
      assert.equal(telemetry.isUiAnonymousUsageEnabled,false)
      assert.deepEqual(telemetry.eventRequests,[])
      return {subject:account.username,path:await path(),telemetry}
    })
    await check('dashboard-refresh-retains-canonical-path',async()=>{
      await page.reload()
      await page.waitForFunction(()=>location.pathname==='/ui/main/dashboards'&&Boolean(document.querySelector('#side-menu')))
      return {path:await path()}
    })
    await check('actual-access-management-menu',async()=>{
      await page.waitForFunction(()=>Boolean(document.querySelector('#side-menu'))&&[...document.querySelectorAll('a[href]')].some(node=>new URL(node.href).pathname==='/ui/main/extensions/rbac'))
      if(await page.evaluate(()=>document.querySelector('#side-menu')?.classList.contains('is-collapsed')===true))await page.click('[data-testid="topnav-sidebar-toggle"]')
      const menu=await page.evaluate(()=>{
        const link=[...document.querySelectorAll('a[href]')].find(node=>new URL(node.href).pathname==='/ui/main/extensions/rbac')
        const control=link?.closest('.ks-sidebar-section')?.querySelector('button[aria-expanded]')
        return {href:link?.getAttribute('href'),collapsed:control?.getAttribute('aria-expanded')==='false',control:control?.textContent.trim()}
      })
      assert(menu.href)
      if(menu.collapsed)await page.click('button[aria-expanded="false"]:text-is('+JSON.stringify(menu.control)+')')
      await page.click('a[href='+JSON.stringify(menu.href)+']')
      await page.waitForFunction(()=>Boolean(document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('[data-test="group-card"][data-group-id="main"]')))
      return {href:menu.href,path:await path()}
    })
    await check('initial-group-description-save-and-readback',async()=>{
      const before=await controls.readGroup()
      await page.click('[data-test="group-card"][data-group-id="main"] .application-group-card-link')
      await page.waitForFunction(()=>Boolean(document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('[data-test="group-edit"]')))
      await page.click('[data-test="group-edit"]')
      const description='First-install browser save '+account.username
      await page.fill('.rbac-inline-form textarea',description)
      await page.click('.rbac-inline-form button[type="submit"]')
      await page.waitForFunction(description=>{
        const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot
        return !root?.querySelector('.rbac-inline-form')&&root?.querySelector('[data-test="group-detail"]')?.textContent.includes(description)
      },description)
      const after=await controls.readGroup()
      assert.equal(after.description,description);assert(after.revision>before.revision)
      return {beforeDescription:before.description,description,readBackDescription:after.description,beforeRevision:before.revision,afterRevision:after.revision}
    })
    await check('completed-setup-get-and-post-closed',async()=>{
      const before=await controls.installationState()
      const statuses=[await browserRequest('/oidc/setup','GET',[404]),await browserRequest('/oidc/setup','POST',[404],'')]
      assert.deepEqual(await controls.installationState(),before)
      return {statuses,unchanged:true}
    })
    if(scenario==='normal')await check('initial-account-production-executions',async()=>{
      const journey=await runFirstAccountExecutions(page,{base,prefix:'first_account_'+Date.now(),readExecution:controls.readExecution,
        record:async journey=>{report.executionJourney=structuredClone(journey);await persist()}})
      return {journey}
    })
    const finalReference=await page.diagnosticEvidenceReference()
    const diagnostics=readBrowserDiagnosticEvidence(finalReference,[dirname(finalReference.path)])
    const events=scopedRbacOnboardingEvents(diagnostics,checkpoint)
    report.telemetryRequests=events.filter(event=>{
      if(event.kind!=='request')return false
      const url=new URL(event.url)
      return url.hostname==='api.kestra.io'&&url.pathname==='/v1/reports/events'
    }).map(({id,requestId,documentId,url})=>({id,requestId,documentId,url}))
    assert.deepEqual(report.telemetryRequests,[],'Production workflow sent disabled usage events')
    const classified=classifyRbacOnboardingDiagnostics({events,base,requests:report.requests,restartWindows:report.restartWindows})
    report.diagnostics={integrity:diagnostics.integrity.length,unexpectedErrors:classified.errors.length,
      classifications:classified.classifications,errors:classified.errors,checkpoint:checkpointReference,
      reference:finalReference}
    assert.equal(report.diagnostics.integrity,0);assert.equal(report.diagnostics.unexpectedErrors,0)
    report.completed=true
    await persist()
    assertRbacOnboardingReport(report,inputs)
    return report
  } catch(error) {
    report.completed=false
    report.failure=String(error.message).replaceAll(account.password,'[redacted]')
    await page.captureFailure(error,'automatic-first-install-failure')
    report.diagnosticReference=await page.diagnosticEvidenceReference()
    await persist()
    throw error
  }
}
