/** Production Page interactions only. Caller owns Page, deployment and store/effects checks.
 * scenario: published {scenarios:[{id,namespace,flowId,pageId,apiId}]} (or array).
 * account: {username,password,authenticated?:true}; authenticated requires caller's existing login.
 * record: local async report persistence. onAuthenticated: optional local identity
 * callback injected by the child driver after native login, never JSON serialized.
 * No response bodies, DB evidence, browser creation, source-tree or OCI reads here.
 */
import assert from 'node:assert/strict'
import {amisP1PerModeCases} from './amis-apps-p1-cases.mjs'
import {amisBrowserDocument} from './amis-apps-browser.mjs'

// All evaluated functions are self-contained for both Ego and Playwright serialization.
export function p1PageObservation() {
  const visible = n => Boolean(n?.getClientRects().length) && getComputedStyle(n).visibility !== 'hidden'
  return {url: location.href, path: location.pathname, timeOrigin: performance.timeOrigin,
    text: document.body?.innerText ?? '', busy: document.querySelector('main')?.getAttribute('aria-busy'),
    alert: [...document.querySelectorAll('[role="alert"]')].filter(visible).map(n => n.innerText),
    login: visible(document.querySelector('input[name="password"]')),
    recovery: Object.keys(sessionStorage).filter(k => k.startsWith('amis.execution.v1:')).map(k => ({key:k,value:JSON.parse(sessionStorage.getItem(k))}))}
}
export function p1DomReady({path, text, busy, alert, login, selector, absent, recoveryPending, recoveryApiUrl, settledMarker}) {
  const visible = n => Boolean(n?.getClientRects().length) && getComputedStyle(n).visibility !== 'hidden'
  if(settledMarker) {
    const busy=document.querySelector('main')?.getAttribute('aria-busy')
    const alerts=[...document.querySelectorAll('[role="alert"]')].filter(visible)
    return busy==='false' && (alerts.some(n=>n.innerText.includes('Request timed out')) || !alerts.length && document.body?.innerText.includes('Saved: '+settledMarker))
  }
  if(recoveryPending && !Object.keys(sessionStorage).filter(k=>k.startsWith('amis.execution.v1:')).some(k=>{const value=JSON.parse(sessionStorage.getItem(k));return value.phase==='pending'&&(!recoveryApiUrl||value.apiUrl===recoveryApiUrl)})) return false
  if (path && (location.pathname !== path || location.search || location.hash)) return false
  if (login !== undefined && visible(document.querySelector('input[name="password"]')) !== login) return false
  if (selector && [...document.querySelectorAll(selector)].some(visible) === Boolean(absent)) return false
  if (text && !document.body?.innerText.includes(text)) return false
  if (busy !== undefined && document.querySelector('main')?.getAttribute('aria-busy') !== String(busy)) return false
  if (alert !== undefined && [...document.querySelectorAll('[role="alert"]')].some(n => visible(n) && n.innerText.trim()) !== alert) return false
  return true
}
// Resolve a unique live DOM control into ordinary CSS. Never dispatch synthetic events.
export function p1ControlSelector({kind, name, text}) {
  const visible = n => Boolean(n?.getClientRects().length) && getComputedStyle(n).visibility !== 'hidden'
  let nodes
  if(kind==='dialog-confirm') {
    const dialogs=[...document.querySelectorAll('[role="dialog"]')].filter(visible)
    if(dialogs.length!==1) throw new Error('Expected one visible dialog')
    nodes=[...dialogs[0].querySelectorAll('button')].filter(n=>visible(n)&&n.textContent.trim()===text)
  } else if (kind === 'select') {
    const label = [...document.querySelectorAll('label')].filter(n => visible(n) && n.textContent.trim() === name)
    if (label.length !== 1) throw new Error('Expected one visible label: ' + name)
    const item = label[0].closest('.cxd-Form-item,.dark-Form-item')
    nodes = [...(item?.querySelectorAll('.cxd-Select,.dark-Select') ?? [])].filter(visible)
  } else if (kind === 'tag') {
    const labels = [...document.querySelectorAll('label')].filter(n => visible(n) && n.textContent.trim() === 'Tags')
    if(labels.length !== 1) throw new Error('Expected one visible Tags label')
    nodes = [...(labels[0].closest('.cxd-Form-item,.dark-Form-item')?.querySelectorAll('input[type="text"],input:not([type])') ?? [])].filter(visible)
  }
  else if (kind === 'option') nodes = [...document.querySelectorAll('[role="option"],.cxd-Select-option,.dark-Select-option')].filter(n => visible(n) && n.textContent.trim() === text)
  else if (kind === 'date') nodes = [...new Set([
    ...document.querySelectorAll('.cxd-DatePicker input, .dark-DatePicker input'),
    ...[...document.querySelectorAll('input')].filter(n => n.name === 'date' || n.getAttribute('placeholder') === 'Select Date' || n.getAttribute('aria-label') === 'Select Date'),
  ])].filter(visible)
  else if (kind === 'switch') nodes = [...new Set([...document.querySelectorAll('input[type="checkbox"]')].map(input => {
    const label=input.closest('label[data-role="switch"]') ?? input.closest('label')
    return visible(label) ? label : visible(input) ? input : null
  }).filter(Boolean))]
  else nodes = [...document.querySelectorAll('button,a')].filter(n => visible(n) && n.textContent.trim() === text)
  if (nodes.length !== 1) throw new Error('Expected one live control: ' + JSON.stringify({kind,name,text,count:nodes.length}))
  const parts = []; let node = nodes[0]
  while (node && node !== document.documentElement) {
    const index = [...node.parentElement.children].filter(n => n.tagName === node.tagName).indexOf(node) + 1
    parts.unshift(node.tagName.toLowerCase() + ':nth-of-type(' + index + ')'); node = node.parentElement
  }
  return 'html > ' + parts.join(' > ')
}

// Read-only observation starts BEFORE native pagination; it never alters app state.
export function p1ObserveQueryLoading({operation}) {
  const key='__rootAmisP1QueryLoading'
  if(operation==='start') {
    if(globalThis[key])throw new Error('Query loading observer already active')
    const main=document.querySelector('main')
    if(!main)throw new Error('Query main is absent')
    const state={url:location.href,timeOrigin:performance.timeOrigin,initialBusy:main.getAttribute('aria-busy'),busyTrueObserved:false,transitions:[]}
    const consume=records=>{for(const record of records) {
      if(record.target!==main||record.attributeName!=='aria-busy')continue
      const current=main.getAttribute('aria-busy')
      state.transitions.push({oldValue:record.oldValue,current})
      if(record.oldValue==='true'||current==='true')state.busyTrueObserved=true
    }}
    const observer=new MutationObserver(consume)
    observer.observe(main,{attributes:true,attributeFilter:['aria-busy'],attributeOldValue:true})
    globalThis[key]={state,observer,consume}
    return {url:state.url,timeOrigin:state.timeOrigin,observingBeforeClick:true}
  }
  if(operation!=='stop')throw new Error('Unknown loading observation operation')
  const active=globalThis[key]
  if(!active)throw new Error('Query loading observer was not started')
  active.consume(active.observer.takeRecords());active.observer.disconnect();delete globalThis[key]
  return {...active.state,finalBusy:document.querySelector('main')?.getAttribute('aria-busy')}
}

// Captures short native states before diagnostic persistence can outlast them.
export function p1ObserveStatus({operation}) {
  const key='__rootAmisP1StatusObservation'
  if(operation==='start') {
    if(globalThis[key])throw new Error('Status observer already active')
    const main=document.querySelector('main')
    if(!main)throw new Error('Status main is absent')
    const state={url:location.href,timeOrigin:performance.timeOrigin,startedAt:performance.now(),samples:[],overflow:false}
    const sample=()=>{
      const status=main.querySelector(':scope > [role="status"]')
      const visible=Boolean(status?.getClientRects().length)&&getComputedStyle(status).visibility!=='hidden'
      const row={at:performance.now(),text:visible?status.textContent.trim():'',busy:main.getAttribute('aria-busy')==='true'}
      const last=state.samples.at(-1)
      if(last&&last.text===row.text&&last.busy===row.busy)return
      if(state.samples.length>=512){state.overflow=true;return}
      state.samples.push(row)
    }
    const observer=new MutationObserver(sample)
    observer.observe(main,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-busy']})
    sample();globalThis[key]={state,observer,sample}
    return {url:state.url,timeOrigin:state.timeOrigin,startedAt:state.startedAt}
  }
  if(operation!=='stop')throw new Error('Unknown status observation operation')
  const active=globalThis[key]
  if(!active)throw new Error('Status observer missing; document may have changed')
  active.observer.takeRecords();active.sample();active.observer.disconnect();delete globalThis[key]
  return {...active.state,endedAt:performance.now()}
}
export function p1ObservedPausedReady({source,pausedText,maxObservationMs=10000}) {
  const active=globalThis.__rootAmisP1StatusObservation
  if(!active||location.href!==source.url||performance.timeOrigin!==source.timeOrigin)throw new Error('Paused status observer left source document')
  if(active.state.overflow)throw new Error('Status observation exceeded bounded history')
  if(active.state.samples.some((row,index)=>index>0&&row.at>source.startedAt&&row.text===pausedText&&row.busy===true))return true
  if(performance.now()-source.startedAt>=maxObservationMs)throw new Error('No actual paused busy state within bounded observation window')
  return false
}
export function p1VerifyPausedObservation(source,observed,document,pausedText) {
  assert.equal(observed.url,source.url,'Status observation crossed source URL')
  assert.equal(observed.timeOrigin,source.timeOrigin,'Status observation crossed document generation')
  assert.equal(document.url,source.url,'Paused observation left source document')
  assert.equal(document.timeOrigin,source.timeOrigin,'Paused observation left source document generation')
  assert.equal(observed.overflow,false,'Status observation exceeded bounded history')
  assert.equal(observed.startedAt,source.startedAt)
  assert(Number.isFinite(observed.endedAt)&&observed.endedAt>=source.startedAt,'Invalid status observation deadline')
  assert(Array.isArray(observed.samples)&&observed.samples.length<=512,'Bounded status samples required')
  let previous=source.startedAt
  for(const row of observed.samples){assert(Number.isFinite(row.at)&&row.at>=previous&&row.at<=observed.endedAt,'Invalid status sample time');previous=row.at}
  assert(observed.samples.some((row,index)=>index>0&&row.at>source.startedAt&&row.text===pausedText&&row.busy===true),'Actual paused status with busy was not observed after installation')
  return observed
}

export function p1LocaleState() {
  const visible=n=>Boolean(n?.getClientRects().length)&&getComputedStyle(n).visibility!=='hidden'
  const selects=[...document.querySelectorAll('header select')].filter(visible)
  if(selects.length!==2)throw new Error('Expected two visible native header selects')
  if(document.querySelector('header label:first-of-type select')!==selects[0])throw new Error('Language selector does not identify first native header select')
  const values=[...selects[0].options].map(option=>option.value)
  if(!values.includes('en')||new Set(values).size!==values.length||values.some(value=>!value))throw new Error('Language select has invalid locale enumeration')
  return {selected:selects[0].value,values,actualLocale:document.documentElement.lang}
}
export function p1SubmitState(selector) {
  const button=document.querySelector(selector)
  const present=Boolean(button?.matches('button[type="submit"]'))
  const visible=present&&Boolean(button.getClientRects().length)&&getComputedStyle(button).visibility!=='hidden'
  return {present,visible,disabled:present?Boolean(button.disabled||button.closest('fieldset[disabled]')):null,busy:document.querySelector('main')?.getAttribute('aria-busy')==='true'}
}

export function p1NetworkTrace(events, apiUrls) {
  const allowed = new Set(apiUrls)
  const relevant = url => {try {const u = new URL(url); return allowed.has(u.href) || [...allowed].some(api => u.href.startsWith(api + '/executions/') && !u.search && !u.hash)} catch {return false}}
  const requests = events.filter(e => e.kind === 'request' && relevant(e.url))
  return requests.map(request => ({...request, responses: events.filter(e => ['http-response','http-error','request-failed'].includes(e.kind) && e.requestId === request.requestId && e.documentId === request.documentId && e.url === request.url)}))
}

export async function runAmisP1BrowserCase(adapter, options) {
  const {id, base, scenario, account, marker, record = async () => {}} = options
  const suffix = id?.replace(/^[AB]-/, '')
  assert(amisP1PerModeCases.includes(suffix), 'Unknown P1 case')
  assert.equal(new URL(base).origin, base, 'Exact origin required')
  assert(typeof marker === 'string' && marker.length, 'Unique marker required')
  const scenarios = Array.isArray(scenario) ? scenario : scenario?.scenarios ?? [scenario]
  const byId = name => {const value = scenarios.find(s => s?.id === name); assert(value, 'Published scenario missing: ' + name); return value}
  const pathFor = s => '/' + [s.namespace,s.flowId,'pages',s.pageId].map(encodeURIComponent).join('/')
  const apiFor = s => base + '/' + [s.namespace,s.flowId,'apis',s.apiId].map(encodeURIComponent).join('/')
  const apiUrls = scenarios.filter(Boolean).map(apiFor)
  const secrets = [account?.password].filter(Boolean)
  adapter.redactSecrets?.(secrets)
  const sanitize = value => JSON.parse(JSON.stringify(value, (key,v) => typeof v === 'string' ? secrets.reduce((text, secret) => text.replaceAll(secret,'[redacted]').replaceAll(encodeURIComponent(secret),'[redacted]'),v).replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted-jwt]').replace(/Bearer\s+[^\s,;]+/gi,'Bearer [redacted]').replace(/([?&](?:code|state|access_token|id_token|refresh_token|password)=)[^&#\s]*/gi,'$1[redacted]') : v))
  const report = {id,synthetic:adapter.synthetic===true,scope:adapter.synthetic===true?'test-transport':'production-page-interactions',completed:false,checks:[],executionIds:[],trace:[],limitations:['No response body capture in adapter; no independent execution-store, typed persistence or delayed-effects proof']}
  let start = 0, previous = 0, active, authenticated = account?.authenticated === true
  const persist = () => record(sanitize(report))
  async function evidence() {
    const diagnostics = await adapter.diagnostics()
    assert(diagnostics.events.length >= previous, 'Adapter event history lost')
    const delta = diagnostics.events.slice(previous)
    previous = diagnostics.events.length
    const diagnosticFile = await adapter.diagnosticEvidenceReference()
    assert(diagnosticFile?.path && /^[a-f0-9]{64}$/.test(diagnosticFile.sha256), 'Retained diagnostic file/hash required')
    const events = diagnostics.events.slice(start)
    report.trace = p1NetworkTrace(events,apiUrls)
    report.executionIds = [...new Set(report.trace.map(r => r.url.match(/\/executions\/([^/?#]+)$/)?.[1]).filter(Boolean))]
    return {document:await adapter.evaluate(amisBrowserDocument),documents:diagnostics.documents,events:delta,diagnosticFile,artifacts:adapter.artifactReferences()}
  }
  async function step(name, action) {
    const row = {id:name,status:'running'}; report.checks.push(row)
    try {row.sourceDocument = await adapter.evaluate(amisBrowserDocument); row.observation = await action(); row.evidence = await evidence(); row.status = 'passed'; await persist(); return row.observation}
    catch(error) {
      row.status = 'failed'; row.error = String(error.message)
      try {await adapter.captureFailure(error,'p1-'+suffix+'-'+name);row.evidence = await evidence()} catch(e) {row.evidenceError=String(e.message)}
      report.failure = {phase:name,message:String(error.message)}
      try {await persist()} catch(e) {report.recordError=String(e.message)}
      const failure = new Error(sanitize(String(error.message))); failure.report=sanitize(report);throw failure
    }
  }
  const wait = arg => adapter.waitForFunction(p1DomReady,arg)
  const click = async text => adapter.click(await adapter.evaluate(p1ControlSelector,{kind:'button',text}))
  const control = async (kind,name,text) => adapter.click(await adapter.evaluate(p1ControlSelector,{kind,name,text}))
  async function navigate(name) {
    active = byId(name); const path = pathFor(active)
    await step('navigate-'+name,async()=>{await adapter.goto(base+path);await wait({selector:'main, input[name="password"]'});return {requestedPath:path}})
    const state = await adapter.evaluate(p1PageObservation)
    if (state.login) await step('production-login',async()=>{
      assert(account?.username && account?.password,'Production login credentials required')
      await adapter.fill('input[name="username"]',account.username);await adapter.fill('input[name="password"]',account.password);await adapter.click('button[type="submit"]')
      await wait({login:false,selector:'main, [role="alert"], button[data-testid="return-to-login"]'})
      if(options.onAuthenticated) {
        const identity=await options.onAuthenticated()
        assert.equal(identity?.subject,account.username,'Authenticated browser subject differs')
        assert.equal(identity.issuer,base,'Authenticated browser issuer differs')
        assert.equal(identity.signatureVerified,true,'Authenticated browser signature unverified')
        assert(Array.isArray(identity.audiences)&&identity.audiences.includes('kestra-ui'),'Authenticated browser audience differs')
        if(id.startsWith('B-')) {
          assert.equal(identity.applicationGroupId,'main','Authenticated browser application group differs')
          assert(Number.isSafeInteger(identity.authorizationVersion)&&identity.authorizationVersion>0,'Authenticated browser authorization version missing')
          assert(Array.isArray(identity.applicationGroupScopes)&&identity.applicationGroupScopes.every(scope=>typeof scope==='string'),'Authenticated browser scopes missing')
        }
        report.identity={subject:identity.subject,issuer:identity.issuer,audiences:identity.audiences,signatureVerified:true,
          ...(identity.applicationGroupId!==undefined?{applicationGroupId:identity.applicationGroupId}:{}),
          ...(identity.authorizationVersion!==undefined?{authorizationVersion:identity.authorizationVersion}:{}),
          ...(identity.applicationGroupScopes!==undefined?{applicationGroupScopes:identity.applicationGroupScopes}:{}),
          ...(identity.synthetic===true?{synthetic:true}:{})}
      }
      authenticated=true;return {nativeLogin:true,identityVerified:Boolean(report.identity)}
    })
    else await step('existing-session-account',async()=>{assert(authenticated,'Existing session requires explicit authenticated account assertion');return {callerBoundExistingSession:true}})
    if (suffix !== 'authenticated-refusal-has-no-delayed-effects') {
      await step('canonical-'+name,async()=>{await wait({path,selector:'.cxd-Page-title,.dark-Page-title'});return adapter.evaluate(p1PageObservation)})
      await step('native-locale-'+name,async()=>{
        const before=await adapter.evaluate(p1LocaleState)
        if(before.selected!=='en') {
          assert(name==='p1-async'||name==='p1-sync'||name==='p1-sync-expiry'||name==='p1-dialog','Auto-loading page requires English preference before navigation')
          await adapter.selectOption('header label:first-of-type select','en')
        }
        await adapter.waitForFunction(()=>document.documentElement.lang==='en')
        const after=await adapter.evaluate(p1LocaleState)
        assert.equal(after.actualLocale,'en');assert.equal(after.selected,'en')
        return {before,after,nativeSelection:before.selected!=='en'}
      })
    }
  }
  async function select(name,value) {await control('select',name);await control('option',undefined,value)}
  async function fill(action='save',typed=false) {
    await step('fill-'+action,async()=>{
      if (active.id !== 'p1-dialog') await select('Scenario',action)
      await adapter.fill('input[name="name"]',marker)
      if(typed) {
        await adapter.fill('input[name="quantity"]','7');await select('Category','Beta')
        await adapter.fill(await adapter.evaluate(p1ControlSelector,{kind:'date'}),'2026-12-01');await adapter.pressFocused('Tab')
        await control('switch');await wait({selector:'input[name="details"]'});await adapter.fill('input[name="details"]',marker+'-details')
        await adapter.fill(await adapter.evaluate(p1ControlSelector,{kind:'tag'}),marker+'-tag')
      }
      return {marker,expectedInputs:typed?{name:marker,quantity:7,category:'beta',date:'2026-12-01',enabled:true,details:marker+'-details',tags:[marker+'-tag']}:{name:marker,action}}
    })
  }
  let originalSubmitSelector
  const submit = () => step('submit',async()=>{
    if(active.id==='p1-dialog') {
      await adapter.click(await adapter.evaluate(p1ControlSelector,{kind:'dialog-confirm',text:options.labels?.confirm??'Confirm'}))
      return {nativeSubmit:true,control:'visible-dialog-confirm'}
    }
    originalSubmitSelector=await adapter.evaluate(p1ControlSelector,{kind:'button',text:'Save changed data'})
    await adapter.click(originalSubmitSelector);return {nativeSubmit:true,control:'form-submit',selector:originalSubmitSelector}
  })
  const success = () => step('visible-result',async()=>{
    await wait({settledMarker:marker})
    const state=await adapter.evaluate(p1PageObservation)
    if(state.alert?.some(text=>text.includes('Request timed out'))) {
      assert(state.recovery.some(r=>r.value.phase==='pending'),'Timeout lost original execution')
      await click(labels.resume)
      await wait({text:'Saved: '+marker,busy:false,alert:false})
      return {recoveredAfterActualTimeout:true,before:state,after:await adapter.evaluate(p1PageObservation)}
    }
    assert(state.text.includes('Saved: '+marker),'Expected bound business result')
    return state
  })
  const posts = () => report.trace.filter(r=>r.method==='POST')
  const labels = {cancel:'Cancel request',resume:'Resume result query',paused:'Execution paused; waiting for resume…',...options.labels}
  const resume = () => step('resume-original',async()=>{await click(labels.resume);return {nativeResume:true}})
  async function noReplayNavigation() {
    await step('confirmed-execution-before-refresh',async()=>{
      const apiPath=new URL(apiFor(active)).pathname
      await wait({recoveryPending:true,recoveryApiUrl:apiPath})
      const state=await adapter.evaluate(p1PageObservation)
      const recovery=state.recovery.filter(row=>row.value.phase==='pending'&&row.value.apiUrl===apiPath)
      assert.equal(recovery.length,1,'Refresh requires exactly one confirmed original API execution')
      const value=recovery[0].value
      assert(typeof value.executionId==='string'&&/^[A-Za-z0-9_-]+$/.test(value.executionId),'Confirmed execution ID missing')
      assert.equal(value.executionUrl,apiPath+'/executions/'+value.executionId,'Confirmed recovery URL differs')
      return {confirmedBeforeReload:true,recovery:value}
    })
    await step('refresh',async()=>{const before=await adapter.evaluate(amisBrowserDocument);await adapter.reload();await wait({path:pathFor(active),selector:'main'});const after=await adapter.evaluate(amisBrowserDocument);assert.notEqual(before.timeOrigin,after.timeOrigin,'Reload must replace document');return {before,after}})
    await step('leave-and-reenter',async()=>{
      const before=await adapter.evaluate(amisBrowserDocument)
      const initial=await adapter.diagnostics(),eventStart=initial.events.length
      const beforeId=initial.documents.filter(row=>row.url===before.url).at(-1)?.id
      assert(beforeId,'Original adapter document identity missing')
      await adapter.goto(base+'/ping');await wait({path:'/ping'})
      const away=await adapter.evaluate(amisBrowserDocument)
      assert.equal(away.url,base+'/ping');assert.equal(away.path,'/ping')
      assert.notEqual(away.timeOrigin,before.timeOrigin,'Leaving must replace original document')
      const departed=await adapter.diagnostics()
      const awayId=departed.documents.filter(row=>row.url===away.url).at(-1)?.id
      assert(awayId&&awayId!==beforeId,'Health navigation must replace original adapter document')
      const health=departed.events.slice(eventStart).filter(row=>row.kind==='request'&&row.method==='GET'&&row.url===base+'/ping'&&row.documentId===awayId)
      assert.equal(health.length,1,'Exact native health document request required')
      const response=departed.events.find(row=>row.kind==='http-response'&&row.status===200&&row.requestId===health[0].requestId&&row.documentId===awayId&&row.url===health[0].url)
      assert(response,'Public health document must return actual HTTP 200')
      await adapter.goto(base+pathFor(active));await wait({path:pathFor(active),selector:'main'})
      const after=await adapter.evaluate(amisBrowserDocument),returned=await adapter.diagnostics()
      const afterId=returned.documents.filter(row=>row.url===after.url).at(-1)?.id
      assert.equal(after.url,base+pathFor(active));assert.notEqual(after.timeOrigin,away.timeOrigin)
      assert(afterId&&afterId!==awayId&&afterId!==beforeId,'Reentry must create a fresh business document')
      return {reentered:true,before,away,after,beforeDocumentId:beforeId,awayDocumentId:awayId,documentId:afterId,healthRequest:health[0],healthResponse:response}
    })
  }
  await step('baseline',async()=>{start=(await adapter.diagnostics()).events.length;previous=start;return {start}})
  const main = suffix.includes('sync-expiry')?'p1-sync-expiry':suffix==='sync-success-and-failure'?'p1-sync':suffix.startsWith('dialog')?'p1-dialog':suffix.startsWith('list')?'p1-query':suffix.startsWith('conditional')?'p1-init':'p1-async'
  if(['p1-init','p1-query'].includes(main))await navigate('p1-async')
  await navigate(main)
  if(suffix==='authenticated-refusal-has-no-delayed-effects') {
    if(id.startsWith('A-')) await step('anonymous-document-refusal',async()=>{
      await adapter.goto(base+'/oidc/logout')
      await wait({login:true})
      await adapter.goto(base+pathFor(active))
      await wait({login:true})
      const state=await adapter.evaluate(p1PageObservation)
      assert.equal(state.path,'/oidc/login','Anonymous protected document must reach production login')
      return {anonymousDocumentRedirect:true,expectedExternalPostStatus:401,externalRefusalAndEffectsRequired:true}
    })
    else await step('authenticated-refusal',async()=>{await wait({text:options.denialText ?? 'Access denied',login:false});return {uiDenialOnly:true,expectedExternalPostStatus:403,externalRefusalAndEffectsRequired:true}})
  } else if(suffix==='conditional-initial-load-and-query') {
    await step('initial-load',async()=>{await wait({text:'Initial: INITIAL-LOADED',busy:false,alert:false})})
    await navigate('p1-conditional')
    await step('conditional-before',async()=>{assert(!posts().some(p=>p.url===apiFor(active)),'Hidden service made a POST');return {hidden:true}})
    await step('conditional-load',async()=>{await control('switch');await wait({text:'Conditional: CONDITIONAL-LOADED',busy:false,alert:false})})
    await navigate('p1-query');await step('query',async()=>{await wait({text:'ROW-ONE',busy:false,alert:false});await wait({text:'ROW-TWO'})})
  } else if(suffix==='list-pagination-empty-and-loading') {
    await step('query-first-page',async()=>{await wait({text:'ROW-ONE',busy:false,alert:false});await wait({text:'ROW-TWO'})})
    const source=await step('query-loading-observer',()=>adapter.evaluate(p1ObserveQueryLoading,{operation:'start'}))
    await step('query-next-empty',async()=>{
      try {await click('2');await wait({text:'No business records',busy:false,alert:false})}
      finally {report.queryLoading=await adapter.evaluate(p1ObserveQueryLoading,{operation:'stop'})}
    })
    await step('query-loading',async()=>{
      const observed=report.queryLoading
      assert.equal(observed.url,source.url,'Loading observation crossed document')
      assert.equal(observed.timeOrigin,source.timeOrigin,'Loading observation crossed document generation')
      assert.equal(observed.initialBusy,'false','Pagination loading observation must start from a settled first page')
      assert.equal(observed.busyTrueObserved,true,'Native pagination never exposed a loading state')
      assert.equal(observed.finalBusy,'false','Pagination remained busy')
      return {source,observed,scope:'Native pagination DOM observation; initial data and empty result checked separately'}
    })
  } else {
    if(main==='p1-dialog') await step('open-dialog',async()=>{await click('Open form');await wait({selector:'[role="dialog"]'})})
    if(suffix==='complex-form-validates-and-persists-typed-inputs') await step('required-validation',async()=>{await click('Save changed data');await wait({selector:'.cxd-Form-feedback,.dark-Form-feedback'});await evidence();assert.equal(posts().length,0,'Invalid form sent POST')})
    const action = /failure/.test(suffix)?'fail':/paused/.test(suffix)?'pause':/async-running|sync-expiry|double-submit|client-timeout/.test(suffix)?'slow':'save'
    await fill(action,suffix==='complex-form-validates-and-persists-typed-inputs')
    let pauseSource
    if(action==='pause')pauseSource=await step('observe-status-before-pause',()=>adapter.evaluate(p1ObserveStatus,{operation:'start'}))
    try {await submit()} catch(error) {
      if(pauseSource)try {report.pausedObservation=await adapter.evaluate(p1ObserveStatus,{operation:'stop'})}catch(cleanupError){report.statusObserverCleanupError=String(cleanupError.message)}
      throw error
    }
    if(suffix==='double-submit-refresh-and-reentry-do-not-replay') {
      await step('duplicate-submit',async()=>{
        assert(originalSubmitSelector,'Original native submit selector missing')
        const state=await adapter.evaluate(p1SubmitState,originalSubmitSelector)
        if(state.present&&state.visible&&!state.disabled) await adapter.click(originalSubmitSelector)
        else assert(state.busy||state.disabled,'Missing submit without actual busy/disabled protection')
        return {nativeSecondClick:state.present&&state.visible&&!state.disabled,originalSubmit:state,sourceSelector:originalSubmitSelector}
      });await noReplayNavigation();await resume();await success()
    } else if(suffix==='client-timeout-and-cancel-preserve-recoverable-execution') {
      await step('client-timeout',async()=>{await wait({alert:true,busy:false,text:'Request timed out'});const state=await adapter.evaluate(p1PageObservation);assert(state.recovery.some(r=>r.value.phase==='pending'),'Timeout lost confirmed execution');return state})
      await resume();await success()
      // A fresh explicit slow submission gives cancellation its own pending window.
      // The original may already be terminal after timeout; never pretend it stayed pending.
      await fill('slow');await submit()
      await step('cancel-distinct-pending-execution',async()=>{
        await wait({busy:true,recoveryPending:true})
        const before=await adapter.evaluate(p1PageObservation)
        assert(before.recovery.some(r=>r.value.phase==='pending'),'Cancellation requires confirmed pending execution')
        await click(labels.cancel);await wait({alert:true,busy:false,text:'Request cancelled'})
        const after=await adapter.evaluate(p1PageObservation)
        return {before,after,explicitSecondSubmission:true}
      });await resume();await success()
    } else if(suffix==='paused-execution-remains-pending') {
      await step('paused',async()=>{
        // Reading retained history avoids waiting for the short pause to still be present.
        let observed
        try {await adapter.waitForFunction(p1ObservedPausedReady,{source:pauseSource,pausedText:labels.paused,maxObservationMs:10000})}
        finally {observed=await adapter.evaluate(p1ObserveStatus,{operation:'stop'});report.pausedObservation=observed}
        report.pausedObservation=observed
        const document=await adapter.evaluate(amisBrowserDocument)
        return p1VerifyPausedObservation(pauseSource,observed,document,labels.paused)
      });await success()
    } else if(action==='fail') {
      await step('visible-failure',async()=>{await wait({alert:true,busy:false,text:'Execution failed (FAILED)'});return adapter.evaluate(p1PageObservation)})
      if(suffix==='sync-success-and-failure') {await fill('save');await submit();await success()}
    } else {if(/async-running|sync-expiry/.test(suffix)) await step('pending',async()=>{await wait({busy:true});return adapter.evaluate(p1PageObservation)});await success()}
  }
  await step('exact-network-contract',async()=>{
    await evidence()
    for(const row of report.trace) {assert(row.documentId && row.requestId,'Missing source request identity');assert(row.responses.length,'No response/failure retained for '+row.url)}
    if(suffix.startsWith('client-timeout')) assert.equal(posts().length,2,'Timeout recovery and distinct cancellation require two explicit submissions')
    if(suffix==='sync-success-and-failure') assert.equal(posts().length,2,'SYNC failure and success each require one POST')
    if(suffix==='conditional-initial-load-and-query') assert.equal(posts().length,3,'Init, conditional and query each require one POST')
    if(suffix==='list-pagination-empty-and-loading') assert.equal(posts().length,2,'Each list page requires one POST')
    if(suffix!=='authenticated-refusal-has-no-delayed-effects') assert(posts().length>0,'Real production POST absent')
    if(/complex-form|dialog|async-running|async-failure|paused|sync-expiry|double-submit/.test(suffix)) assert.equal(posts().length,1,'Expected exactly one POST')
    if(/async-running|paused|sync-expiry|double-submit|client-timeout/.test(suffix)) {
      const polls=report.trace.filter(r=>r.method==='GET');assert(polls.length,'Original execution poll absent');assert.equal(report.executionIds.length,suffix.startsWith('client-timeout')?2:1,'Poll identity count differs from explicit submissions')
      assert(polls.every(p=>report.executionIds.some(executionId=>p.url===apiFor(active)+'/executions/'+executionId)),'Cross API poll')
    }
    return {postCount:posts().length,executionIds:report.executionIds,responseBodiesCaptured:false}
  })
  report.completed=true
  try {await persist()} catch(error) {report.completed=false;report.failure={phase:'final-record',message:String(error.message)};const failure=new Error('P1 report persistence failed');failure.report=sanitize(report);throw failure}
  return sanitize(report)
}
