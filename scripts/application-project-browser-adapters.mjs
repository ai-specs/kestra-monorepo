/**
 * Tool adapters for runApplicationProjectUi. No browser/context/task is created.
 * Caller supplies an existing Playwright Page or the existing Ego TaskSpace Page,
 * before the first application navigation. The adapter does not own that page.
 *
 * const page = await createPlaywrightApplicationProjectAdapter(existingPage, options)
 * const page = await createEgoApplicationProjectAdapter(existingEgoPage, options)
 * await runApplicationProjectBrowser(page, base, fixture, record)
 * await page.dispose() // detach diagnostics only; never closes the user's page
 *
 * options.artifactDirectory: required absolute directory for retained PNG files.
 * options.timeoutMs: default 30000. options.secrets: additional strings to redact.
 * options.onArtifact: optional async callback for uploading/retaining each PNG.
 * Both factories use Chromium CDP to collect the SAME diagnostic events across
 * documents. Ego uses documented page.cdp/page.events, NOT EventEmitter methods.
 * Playwright's CDPSession is attached to the supplied page, without launching.
 * Unknown event envelopes / lost event notifications fail diagnostics explicitly.
 * Do not call rawPage.events() elsewhere while this adapter owns its buffer.
 *
 * Only common CSS and terminal :has-text/:text-is selectors are accepted. Every
 * interaction remains a native browser-tool action. No HTTP/synthetic DOM event
 * substitutes, first()/nth() shortcuts, route mocks or reduced case matrices.
 *
 * No real service is required for syntax checking this module. Importing it has
 * no browser, filesystem or acceptance-report side effects. Runtime CDP envelope
 * compatibility and failure-artifact behavior require subsequent REAL execution.
 */
import {randomUUID} from 'node:crypto'
import {mkdir, stat} from 'node:fs/promises'
import {isAbsolute, join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {writeBrowserDiagnosticEvidence} from './browser-diagnostic-evidence.mjs'

export const applicationProjectAdapterHelperVersion='2026-10-27-response-stage-v2-clipboard-restore'

const PROTOCOL_EVENTS = Object.freeze([
  'Page.frameNavigated','Page.navigatedWithinDocument',
  'Runtime.executionContextCreated','Runtime.executionContextDestroyed','Runtime.executionContextsCleared',
  'Runtime.consoleAPICalled','Runtime.exceptionThrown',
  'Log.entryAdded','Network.requestWillBeSent','Network.responseReceived','Network.loadingFailed',
  'Fetch.requestPaused',
])
const assert = (value,message) => {if (!value) throw new Error(message)}
const copy = value => JSON.parse(JSON.stringify(value))

function redactor(initialSecrets = []) {
  const secrets = new Set(initialSecrets.filter(value => typeof value === 'string' && value.length))
  const text = value => {
    let output = String(value ?? '')
    for (const secret of secrets) output = output.replaceAll(secret,'[redacted]')
    return output.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted-jwt]')
      .replace(/([?&]from=)[^&#\s]*/gi,'$1[redacted-login-target]')
      .replace(/([?&](?:code|state|access_token|id_token|refresh_token|password|client_secret)=)[^&#\s]*/gi,'$1[redacted]')
      .replace(/Bearer\s+[^\s,;]+/gi,'Bearer [redacted]')
  }
  return {text,add:values => {for (const value of values) if (typeof value === 'string' && value.length) secrets.add(value)}}
}

function commonSelector(selector) {
  assert(typeof selector === 'string' && selector.trim(),'nonempty selector required')
  assert(!selector.includes('>>') && !/^(?:loc=|text=|xpath=|ref=|@)/.test(selector),'use common CSS, not tool-specific locator syntax')
  assert(!/:nth-match\(|:has\(|getByRole\(|locator\(/.test(selector),'unsupported selector extension')
  if (selector.includes(':has-text(') || selector.includes(':text-is(')) {
    assert(/:(?:has-text|text-is)\((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\)$/.test(selector),'text pseudo-selector must be terminal and quoted')
  }
  return selector
}

function diagnosticsCollector(redact) {
  let sequence = 0
  let topFrame = null
  let current = {id:'document:initial',url:'about:blank',frameId:null,loaderId:null}
  const documents = new Map([[current.id,current]])
  const frameDocuments = new Map()
  const contexts = new Map()
  const requests = new Map()
  const events = []
  const integrity = []
  const idFor = (frame,loader) => 'document:' + (frame ?? 'unknown-frame') + ':' + (loader ?? 'initial')
  function documentFor(frame,loader,url) {
    const id = idFor(frame,loader)
    let document = documents.get(id)
    if (!document) {document = {id,url:url || 'about:blank',frameId:frame ?? null,loaderId:loader ?? null}; documents.set(id,document)}
    else if (url) document.url = url
    return document
  }
  function add(kind,document,detail = {}) {
    const source = document ?? current
    const value = {id:'event:' + (++sequence),kind,documentId:source.id,documentUrl:redact.text(source.url),url:redact.text(detail.url ?? source.url),message:redact.text(detail.message ?? ''),observedAt:new Date().toISOString(),...detail}
    value.url = redact.text(value.url)
    value.message = redact.text(value.message)
    if (value.scriptUrl) value.scriptUrl = redact.text(value.scriptUrl)
    events.push(value)
    return value
  }
  function issue(message,detail = {}) {integrity.push(add('diagnostic-integrity-error',current,{message,...detail}))}
  function contextDocument(id) {return contexts.get(id) ?? current}
  function stackFrames(stack) {return (stack?.callFrames ?? []).map(frame => ({url:redact.text(frame.url),line:frame.lineNumber,column:frame.columnNumber,functionName:redact.text(frame.functionName)}))}
  function consume(method,params) {
    if (!PROTOCOL_EVENTS.includes(method)) return // Non-error protocol housekeeping is not a diagnostic.
    const p = params ?? {}
    switch (method) {
      case 'Page.frameNavigated': {
        const frame = p.frame
        if (!frame?.id) return issue('frame navigation missing frame identity')
        const document = documentFor(frame.id,frame.loaderId,frame.url)
        frameDocuments.set(frame.id,document)
        if (!frame.parentId) {topFrame = frame.id; current = document}
        add('document-navigation',document,{frameId:frame.id,loaderId:frame.loaderId})
        break
      }
      case 'Page.navigatedWithinDocument': {
        const document = frameDocuments.get(p.frameId) ?? current
        document.url = p.url ?? document.url
        add('document-route',document,{frameId:p.frameId})
        break
      }
      case 'Runtime.executionContextCreated': {
        const context = p.context
        if (!context?.id) return issue('execution context missing ID')
        const frameId = context.auxData?.frameId
        const document = frameDocuments.get(frameId) ?? current
        contexts.set(context.id,document)
        break
      }
      case 'Runtime.executionContextDestroyed':
        // Retain the mapping: late unload errors still belong to the old document.
        if (p.executionContextId && contexts.has(p.executionContextId)) add('execution-context-destroyed',contexts.get(p.executionContextId),{executionContextId:p.executionContextId})
        break
      case 'Runtime.executionContextsCleared':
        // Do not clear contexts/documents or erase previously observed failures.
        break
      case 'Runtime.consoleAPICalled': {
        const document = contextDocument(p.executionContextId)
        const message = (p.args ?? []).map(argument => typeof argument.value === 'object' ? '[object]' : argument.value ?? argument.description ?? argument.type).join(' ')
        add(['error','assert'].includes(p.type) ? 'console-error' : p.type === 'warning' ? 'console-warning' : 'console',document,
          {message,level:p.type,executionContextId:p.executionContextId,stack:stackFrames(p.stackTrace)})
        break
      }
      case 'Runtime.exceptionThrown': {
        const detail = p.exceptionDetails ?? {}
        add('page-error',contextDocument(detail.executionContextId),{message:detail.exception?.description ?? detail.text ?? 'Uncaught browser exception',executionContextId:detail.executionContextId,scriptUrl:detail.url,stack:stackFrames(detail.stackTrace)})
        break
      }
      case 'Log.entryAdded': {
        const entry = p.entry ?? {}
        const request = requests.get(entry.networkRequestId)
        add(entry.level === 'error' ? 'console-error' : 'browser-log',request?.document ?? current,{url:request?.url??entry.url,status:request?.status,message:entry.text,scriptUrl:entry.url,requestId:entry.networkRequestId,level:entry.level,source:entry.source,stack:stackFrames(entry.stackTrace)})
        break
      }
      case 'Network.requestWillBeSent': {
        if (!p.requestId || !p.request?.url) return issue('request event missing request ID or URL')
        if (p.redirectResponse) {
          const prior = requests.get(p.requestId)
          add('http-response',prior?.document ?? current,{requestId:p.requestId,url:p.redirectResponse.url,status:p.redirectResponse.status,method:prior?.method,message:'HTTP redirect',redirect:true})
        }
        const document = p.loaderId ? documentFor(p.frameId,p.loaderId,p.type === 'Document' ? p.request.url : p.documentURL) : frameDocuments.get(p.frameId) ?? current
        const acceptanceRequestId=Object.entries(p.request.headers??{}).find(([name])=>name.toLowerCase()==='x-acceptance-request-id')?.[1]
        requests.set(p.requestId,{document:{...document},url:p.request.url,method:p.request.method,frameId:p.frameId,loaderId:p.loaderId})
        add('request',document,{requestId:p.requestId,url:p.request.url,method:p.request.method,resourceType:p.type,frameId:p.frameId,loaderId:p.loaderId,initiatorStack:stackFrames(p.initiator?.stack),...(/^root-ui-[a-f0-9]{24}$/.test(acceptanceRequestId??'')?{acceptanceRequestId}:{})})
        break
      }
      case 'Network.responseReceived': {
        const request = requests.get(p.requestId)
        const document = request?.document ?? frameDocuments.get(p.frameId) ?? current
        const response = p.response ?? {}
        const cacheControl=Object.entries(response.headers??{}).find(([name])=>name.toLowerCase()==='cache-control')?.[1]
        if(request)request.status=response.status
        add(response.status >= 400 ? 'http-error' : 'http-response',document,{requestId:p.requestId,url:response.url ?? request?.url,status:response.status,method:request?.method,resourceType:p.type,message:'HTTP ' + response.status,cacheControl:typeof cacheControl==='string'?cacheControl:null,fromDiskCache:response.fromDiskCache === true,fromServiceWorker:response.fromServiceWorker === true})
        break
      }
      case 'Network.loadingFailed': {
        const request = requests.get(p.requestId)
        add('request-failed',request?.document ?? current,{requestId:p.requestId,url:request?.url ?? current.url,method:request?.method,message:p.errorText ?? 'Network request failed',cancelled:p.canceled === true,blockedReason:p.blockedReason,resourceType:p.type})
        break
      }
    }
  }
  return {
    consume,issue,add,
    source:() => ({...current}),
    requestSource:requestId => {
      const request=requests.get(requestId)
      return request?{document:{...request.document},url:request.url,method:request.method}:null
    },
    initialize(frame) {if (frame) consume('Page.frameNavigated',{frame})},
    snapshot() {
      if (integrity.length) throw Object.assign(new Error('diagnostic collection incomplete: ' + integrity.map(event => event.message).join('; ')),{diagnosticEvents:copy(events)})
      return {events:copy(events),documents:[...documents.values()].map(document => ({...document,url:redact.text(document.url)})),topFrame}
    },
    unsafeSnapshot:() => ({events:copy(events),integrity:copy(integrity)}),
  }
}

async function initializeProtocol(send,collector) {
  await send('Page.enable')
  const tree = await send('Page.getFrameTree')
  assert(tree?.frameTree?.frame,'CDP frame tree unavailable: source attribution cannot be initialized')
  collector.initialize(tree.frameTree.frame)
  // Source identity exists before Runtime.enable replays existing contexts.
  await send('Runtime.enable')
  await send('Network.enable',{maxTotalBufferSize:32 * 1024 * 1024,maxResourceBufferSize:2 * 1024 * 1024})
  await send('Log.enable')
}

async function makeAdapter(raw,tools,options) {
  assert(options && typeof options.artifactDirectory === 'string' && isAbsolute(options.artifactDirectory),'artifactDirectory must be an explicit absolute path')
  const timeout = options.timeoutMs ?? 30000
  assert(Number.isFinite(timeout) && timeout > 0 && timeout <= 60000,'timeoutMs must be in (0,60000]')
  await mkdir(options.artifactDirectory,{recursive:true})
  const redact = redactor(options.secrets ?? [])
  const collector = diagnosticsCollector(redact)
  const artifacts = []
  const artifactRun = randomUUID()
  let artifactSequence = 0
  let disposed = false
  let detached = false
  let disposalComplete = false
  const clipboardBaselines=new Map()
  let failureCapture = false
  const droppedResponses=new Map()
  let activeDrop=null
  let protocolWork=Promise.resolve()
  const pausedRequests=new Set()
  async function pausedResponse(params) {
    const fetchId=params.requestId
    assert(typeof fetchId==='string'&&fetchId,'paused response missing Fetch request identity')
    pausedRequests.add(fetchId)
    try {
      const operation=activeDrop
      if(!operation||operation.matched||params.request?.url!==operation.url||params.request?.method!==operation.method) {
        await tools.send('Fetch.continueRequest',{requestId:fetchId});return
      }
      operation.matched=true
      assert(params.responseStatusCode===200&&!params.responseErrorReason,'response loss requires an actual production HTTP 200')
      const request=collector.requestSource(params.networkId)
      assert(request&&request.url===operation.url&&request.method===operation.method,'paused response lacks exact Network request attribution')
      assert(request.document.id===operation.documentId,'paused response belongs to another document')
      operation.response={requestId:params.networkId,documentId:request.document.id,url:redact.text(request.url),status:params.responseStatusCode}
      collector.add('http-response',request.document,{requestId:params.networkId,url:request.url,method:request.method,status:params.responseStatusCode,message:'Actual HTTP response paused before delivery',responseStage:'Fetch.requestPaused'})
      await tools.send('Fetch.failRequest',{requestId:fetchId,errorReason:'Failed'})
      operation.failed=true
      collector.add('response-dropped',request.document,{...operation.response,operationId:operation.operationId,message:'Production response aborted before delivery'})
    } catch(error) {
      if(activeDrop)activeDrop.error='response-stage interception failed; inspect exact request diagnostics'
      collector.issue('response-stage interception failed: '+redact.text(error.message))
      await tools.send('Fetch.continueRequest',{requestId:fetchId}).catch(()=>{})
    } finally {pausedRequests.delete(fetchId)}
  }
  const receive=(method,params)=>{
    if(method==='Fetch.requestPaused') {
      protocolWork=protocolWork.then(()=>pausedResponse(params)).catch(error=>collector.issue('response-stage protocol failure: '+redact.text(error.message)))
    }else {
      try {collector.consume(method,params)} catch (error) {collector.issue('CDP normalization failed: ' + redact.text(error.message))}
    }
  }
  const drain = async () => {
    for (const envelope of await tools.drain()) {
      const event = envelope?.method ? envelope : envelope?.event?.method ? envelope.event : null
      if (!event || typeof event.method !== 'string' || !event.params || typeof event.params !== 'object') {
        collector.issue('unrecognized CDP event envelope; refusing incomplete diagnostics')
        continue
      }
      receive(event.method,event.params)
    }
    await protocolWork
  }
  await tools.attach(receive)
  try {await initializeProtocol(tools.send,collector); await drain()} catch (error) {await tools.detach(); throw error}
  async function screenshot(label = 'snapshot') {
    const maskId=artifactRun+'-'+String(++artifactSequence)
    const credentialVisible=await raw.evaluate(maskId=>{
      let found=false
      const inspect=root=>{
        for(const element of root.querySelectorAll('[data-sensitive-credential],.rbac-one-time-value')) {
          const style=getComputedStyle(element),rect=element.getBoundingClientRect()
          if((element.textContent?.trim()||element.value)&&rect.width>0&&rect.height>0&&style.visibility!=='hidden'&&style.display!=='none')found=true
        }
        const children=[...root.querySelectorAll('*')].filter(element=>element.shadowRoot)
        const mask=document.createElement('style')
        mask.dataset.credentialArtifactMask=maskId
        mask.textContent='[data-sensitive-credential],.rbac-one-time-value{visibility:hidden!important}'
        ;(root===document?document.head:root).append(mask)
        children.forEach(element=>inspect(element.shadowRoot))
      }
      inspect(document)
      return found
    },maskId)
    const path = join(options.artifactDirectory,artifactRun + '-' + String(artifactSequence).padStart(4,'0') + '-' + label.replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,60) + '.png')
    try {
      if(credentialVisible)throw Object.assign(new Error('Credential-bearing screenshot blocked; retain sanitized diagnostics instead'),{code:'credential_screenshot_blocked'})
      await tools.screenshot(path)
    } finally {
      await raw.evaluate(maskId=>{
        const clear=root=>{
          for(const mask of root.querySelectorAll('style[data-credential-artifact-mask]'))if(mask.dataset.credentialArtifactMask===maskId)mask.remove()
          for(const element of root.querySelectorAll('*'))if(element.shadowRoot)clear(element.shadowRoot)
        }
        clear(document)
      },maskId)
    }
    const file = await stat(path)
    assert(file.isFile() && file.size > 0,'screenshot artifact was not retained on disk')
    const artifact = {path,label,document:collector.source(),createdAt:new Date().toISOString()}
    artifacts.push(artifact)
    if (options.onArtifact) await options.onArtifact(copy(artifact))
    return copy(artifact)
  }
  async function captureFailure(error,label = 'failure') {
    if (failureCapture) return
    failureCapture = true
    try {return await screenshot(label)} catch (captureError) {
      if(captureError.code==='credential_screenshot_blocked') {
        const suppressed={kind:'screenshot-suppressed',captured:false,reason:'credential-visible',label,document:collector.source(),createdAt:new Date().toISOString()}
        collector.add('artifact-suppressed',suppressed.document,{message:'Screenshot intentionally not captured because a one-time credential is visible',artifactLabel:label})
        if(error&&typeof error==='object')error.artifactCaptureError=redact.text(captureError.message)
        return suppressed
      }
      collector.issue('failure screenshot unavailable: ' + redact.text(captureError.message))
      if (error && typeof error === 'object') error.artifactCaptureError = redact.text(captureError.message)
    } finally {failureCapture = false}
  }
  async function action(name,operation) {
    assert(!disposed,'adapter already disposed')
    const before = collector.source()
    try {
      const result = await operation()
      await drain()
      return result
    } catch (error) {
      // Context destruction/cancelled requests are evidence, never blanket noise.
      collector.add('operation-error',before,{message:redact.text(error.message),operation:name})
      try {await drain()} catch (captureError) {collector.issue('error-time diagnostic drain failed: ' + redact.text(captureError.message))}
      await captureFailure(error,name + '-failure')
      throw error
    }
  }
  async function clearDroppedResponse({operationId}={}) {
    assert(typeof operationId==='string'&&droppedResponses.has(operationId),'known response-loss operation required')
    const operation=droppedResponses.get(operationId)
    if(operation.cleared)return
    let drainError
    try {await drain()}catch(error){drainError=error}
    try {
      if(activeDrop===operation) {
        for(const requestId of pausedRequests)await tools.send('Fetch.continueRequest',{requestId}).catch(()=>{})
        await tools.send('Fetch.disable')
        activeDrop=null
      }
      operation.cleared=true
    } catch(error) {collector.issue('response-loss cleanup failed; Fetch interception may remain enabled');throw error}
    if(drainError)throw drainError
  }
  const adapter = {
    helperVersion:applicationProjectAdapterHelperVersion,
    goto:url => action('goto',() => tools.goto(url,timeout)),
    reload:() => action('reload',() => tools.reload(timeout)),
    history:direction=>action('history',async()=>{
      assert(['back','forward'].includes(direction),'explicit native history direction required')
      let history,previous,stable=0
      const started=performance.now()
      while(performance.now()-started<timeout) {
        const url=await raw.evaluate(()=>location.href)
        history=await tools.send('Page.getNavigationHistory',{})
        const entry=history.entries[history.currentIndex]
        const signature=JSON.stringify([history.currentIndex,entry?.id,entry?.url])
        stable=entry?.url===url&&signature===previous?stable+1:0
        previous=signature
        if(stable>=2)break
        await delay(50)
      }
      assert(stable>=2,'native history entry has not settled to the visible URL')
      const index=history.currentIndex+(direction==='back'?-1:1),entry=history.entries[index]
      assert(entry&&Number.isSafeInteger(entry.id),'native browser history entry unavailable')
      await tools.send('Page.navigateToHistoryEntry',{entryId:entry.id})
      return {direction,fromIndex:history.currentIndex,toIndex:index,entryId:entry.id}
    }),
    pressFocused:key=>action('pressFocused',async()=>{
      assert(['Tab','Shift+Tab','Escape'].includes(key),'supported native focus key required')
      assert(typeof raw.keyboard?.press==='function','documented native keyboard API required')
      // Do not fabricate Windows native keycodes on macOS. Both existing
      // browser adapters expose a native keyboard API without refocusing body.
      return raw.keyboard.press(key)
    }),
    click:selector => action('click',() => tools.click(commonSelector(selector),timeout)),
    clickAt:point=>action('clickAt',async()=>{
      assert(point&&Object.keys(point).every(key=>['x','y'].includes(key))&&Number.isFinite(point.x)&&Number.isFinite(point.y),'finite CSS viewport point required')
      const viewport=await raw.evaluate(()=>({width:innerWidth,height:innerHeight}))
      assert(point.x>=0&&point.y>=0&&point.x<viewport.width&&point.y<viewport.height,'click point is outside the viewport')
      assert(typeof raw.mouse?.click==='function','native mouse click unavailable')
      await raw.mouse.click(point.x,point.y)
    }),
    setClipboardPermission:state=>action('setClipboardPermission',async()=>{
      assert(['granted','denied'].includes(state),'clipboard permission must be granted or denied')
      assert(typeof tools.browserSend==='function','browser-scoped CDP callback required for clipboard permission')
      const origin=await raw.evaluate(()=>location.origin)
      assert(/^https?:\/\//.test(origin)&&new URL(origin).origin===origin,'clipboard permission requires an HTTP origin')
      // Ego Page handles resolve lazily. Resolve the current owned Page after
      // initialization instead of freezing undefined at adapter construction.
      const targetId=tools.getTargetId?tools.getTargetId():tools.targetId
      if(tools.getTargetId)assert(typeof targetId==='string'&&targetId.length,'current owned Page target identity unavailable')
      const result=await tools.browserSend('Target.getTargetInfo',targetId?{targetId}:{})
      const target=result?.targetInfo
      assert(target?.type==='page'&&new URL(target.url).origin===origin,'clipboard permission target does not match this page')
      if(targetId)assert(target.targetId===targetId,'clipboard permission resolved another browser target')
      const context=target.browserContextId?{browserContextId:target.browserContextId}:{}
      const previous=await raw.evaluate(async()=>Promise.all(['clipboard-read','clipboard-write'].map(async name=>({name,state:(await navigator.permissions.query({name})).state}))))
      assert(Array.isArray(previous)&&previous.length===2&&previous.every((permission,index)=>permission.name===['clipboard-read','clipboard-write'][index]&&['granted','denied','prompt'].includes(permission.state)),'clipboard permission baseline unavailable')
      const baselineKey=JSON.stringify([target.browserContextId??null,origin])
      const applied=[]
      try {
        for(const name of ['clipboard-read','clipboard-write']) {
          await tools.browserSend('Browser.setPermission',{permission:{name},setting:state,origin,...context})
          applied.push(name)
          if(!clipboardBaselines.has(baselineKey))clipboardBaselines.set(baselineKey,{origin,context,permissions:previous.map(permission=>({...permission,restored:permission.name!==name}))})
          clipboardBaselines.get(baselineKey).permissions.find(permission=>permission.name===name).restored=false
        }
        const actual=await raw.evaluate(async()=>Promise.all(['clipboard-read','clipboard-write'].map(async name=>(await navigator.permissions.query({name})).state)))
        assert(actual.every(permission=>permission===state),'clipboard permission did not take effect')
      }catch(error) {
        const restored=await Promise.allSettled(previous.filter(permission=>applied.includes(permission.name)).map(async permission=>{
          await tools.browserSend('Browser.setPermission',{permission:{name:permission.name},setting:permission.state,origin,...context})
          const original=clipboardBaselines.get(baselineKey).permissions.find(item=>item.name===permission.name)
          original.restored=permission.state===original.state
        }))
        if(restored.some(result=>result.status==='rejected'))collector.issue('clipboard permission rollback failed for this origin')
        if(!applied.length&&/^'Browser\.setPermission' wasn't found$/.test(error.message)) {
          collector.add('tool-capability-unavailable',collector.source(),{message:'Current browser transport does not implement Browser.setPermission',method:'Browser.setPermission',origin})
          throw Object.assign(new Error('Current browser transport lacks Browser.setPermission; the real copy-failure/retry assertion remains mandatory in the complete CI-browser matrix'),{code:'acceptance_contract_missing'})
        }
        throw error
      }
    }),
    readClipboard:async()=>{
      assert(!disposed,'adapter already disposed')
      try {
        assert(await raw.evaluate(async()=>(await navigator.permissions.query({name:'clipboard-read'})).state==='granted'),'clipboard read requires an explicit granted permission')
        const value=await raw.evaluate(()=>navigator.clipboard.readText())
        assert(typeof value==='string','clipboard read did not return text')
        redact.add([value])
        return value
      }catch {throw new Error('Native clipboard text read failed; clipboard content is not recorded')}
    },
    dropNextResponse:input=>action('dropNextResponse',async()=>{
      assert(input&&typeof input.url==='string'&&input.method==='POST','exact POST response target required')
      const target=new URL(input.url),origin=await raw.evaluate(()=>location.origin)
      assert(target.origin===origin&&!target.username&&!target.password&&!target.search&&!target.hash,'response-loss target must be exact and same-origin without credentials or query')
      assert(/^\/api\/v1\/main\/extensions\/rbac\/application-groups\/[A-Za-z0-9_-]+\/applications\/~[A-Za-z0-9_-]+\/credentials\/rotate$/.test(target.pathname),'only production credential rotation response loss is supported')
      assert(!activeDrop,'only one response-loss operation may be active')
      await drain()
      const operation={operationId:'response-loss-'+randomUUID(),url:target.href,method:input.method,documentId:collector.source().id,matched:false,failed:false,cleared:false}
      droppedResponses.set(operation.operationId,operation);activeDrop=operation
      try{await tools.send('Fetch.enable',{patterns:[{urlPattern:target.href,requestStage:'Response'}]})}
      catch(error){await clearDroppedResponse({operationId:operation.operationId});throw error}
      return {operationId:operation.operationId}
    }),
    waitForDroppedResponse:input=>action('waitForDroppedResponse',async()=>{
      assert(typeof input?.operationId==='string'&&droppedResponses.has(input.operationId),'known response-loss operation required')
      const operation=droppedResponses.get(input.operationId),started=performance.now()
      while(performance.now()-started<timeout) {
        await drain()
        assert(!operation.error,operation.error)
        assert(!operation.cleared,'response-loss operation was cleared before observation')
        if(operation.failed) {
          const failed=collector.snapshot().events.find(event=>event.kind==='request-failed'&&event.requestId===operation.response.requestId&&event.documentId===operation.response.documentId&&event.url===operation.response.url)
          if(failed) {
            assert(['net::ERR_FAILED','net::ERR_CONNECTION_RESET'].includes(failed.message),'unexpected actual network failure after response loss')
            return {...operation.response,dropped:true,message:failed.message}
          }
        }
        await delay(25)
      }
      throw new Error('Timed out awaiting actual production response loss and matching Network.loadingFailed')
    }),
    clearDroppedResponse:input=>action('clearDroppedResponse',()=>clearDroppedResponse(input)),
    fill:(selector,value) => action('fill',() => tools.fill(commonSelector(selector),value,timeout)),
    selectOption:(selector,value) => action('selectOption',() => tools.selectOption(commonSelector(selector),value,timeout)),
    focus:selector => action('focus',() => tools.focus(commonSelector(selector),timeout)),
    press:(selector,value) => action('press',() => tools.press(commonSelector(selector),value,timeout)),
    evaluate:(callback,argument) => action('evaluate',() => argument === undefined ? raw.evaluate(callback) : raw.evaluate(callback,argument)),
    waitForFunction:(callback,argument) => action('waitForFunction',() => raw.waitForFunction(callback,argument,{timeout})),
    setViewport:viewport => action('setViewport',async () => {
      assert(Number.isInteger(viewport?.width) && Number.isInteger(viewport?.height) && viewport.width > 0 && viewport.height > 0,'valid CSS viewport dimensions required')
      await tools.setViewport(viewport)
      assert(await raw.evaluate(({width,height}) => innerWidth === width && innerHeight === height,viewport),'requested viewport did not take effect')
    }),
    setColorScheme:scheme => action('setColorScheme',async () => {
      assert(['light','dark'].includes(scheme),'system preference emulation must be light or dark')
      await tools.setColorScheme(scheme)
      assert(await raw.evaluate(scheme => matchMedia('(prefers-color-scheme: ' + scheme + ')').matches,scheme),'requested system color scheme did not take effect')
    }),
    screenshot:() => action('screenshot',() => screenshot()),
    diagnostics:() => action('diagnostics',async () => {await drain(); return {...collector.snapshot(),artifacts:copy(artifacts)}}),
    responseMetadata:({requestId,documentId,url})=>action('responseMetadata',async()=>{
      await drain()
      const response=collector.snapshot().events.findLast(event=>['http-response','http-error'].includes(event.kind)&&event.requestId===requestId&&event.documentId===documentId&&event.url===url)
      assert(response,'Exact response and source document were not observed')
      return {requestId,documentId,url,status:response.status,cacheControl:response.cacheControl}
    }),
    captureFailure,
    redactSecrets:values => redact.add(values),
    artifactReferences:() => copy(artifacts),
    diagnosticEvidence:async () => {try {await drain()} catch (error) {collector.issue('final diagnostic drain failed: ' + redact.text(error.message))}; return collector.unsafeSnapshot()},
    diagnosticEvidenceReference:async () => {try {await drain()} catch (error) {collector.issue('final diagnostic drain failed: ' + redact.text(error.message))}; return writeBrowserDiagnosticEvidence(collector.unsafeSnapshot(),options.diagnosticDirectory??join(options.artifactDirectory,'diagnostics'))},
    async dispose() {
      if(disposalComplete)return
      disposed=true
      const failures=[]
      if(!detached) {
        try{if(activeDrop)await clearDroppedResponse({operationId:activeDrop.operationId})}catch(error){failures.push(error)}
        try{await drain()}catch(error){failures.push(error)}
      }
      for(const baseline of clipboardBaselines.values())for(const permission of baseline.permissions) {
        if(permission.restored)continue
        try {
          await tools.browserSend('Browser.setPermission',{permission:{name:permission.name},setting:permission.state,origin:baseline.origin,...baseline.context})
          permission.restored=true
        }catch(error) {
          collector.issue('clipboard permission restoration failed',{url:baseline.origin,permission:permission.name,browserContextId:baseline.context.browserContextId??null})
          failures.push(error)
        }
      }
      const pendingPermissions=[...clipboardBaselines.values()].some(baseline=>baseline.permissions.some(permission=>!permission.restored))
      if(!detached&&!pendingPermissions) {
        try{await tools.detach();detached=true}catch(error){failures.push(error)}
      }
      if(failures.length)throw new AggregateError(failures,'Adapter disposal failed; inspect retained diagnostics and retry pending cleanup')
      disposalComplete=true
    },
  }
  return adapter
}

/** Wrap an existing Chromium Playwright Page. Does not import/launch Playwright. */
export async function createPlaywrightApplicationProjectAdapter(page,options) {
  assert(page && typeof page.context === 'function','existing Chromium Playwright Page required')
  assert(options && isAbsolute(options.artifactDirectory ?? ''),'artifactDirectory must be an explicit absolute path')
  const session = await page.context().newCDPSession(page)
  const listeners = []
  const target = selector => {
    const match = selector.match(/^(.*):text-is\(("(?:[^"\\]|\\.)*")\)$/)
    if (!match) return page.locator(selector)
    const text = JSON.parse(match[2]).trim().split(/\s+/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s+')
    return page.locator(match[1]).filter({visible:true,hasText:new RegExp('^\\s*' + text + '\\s*$')})
  }
  return makeAdapter(page,{
    send:(method,params) => session.send(method,params),
    browserSend:(method,params)=>session.send(method,params),
    async attach(receive) {for (const method of PROTOCOL_EVENTS) {const listener = params => receive(method,params); listeners.push([method,listener]); session.on(method,listener)}},
    drain:async () => [], // CDP listeners consume synchronously and retain all documents.
    async detach() {for (const [method,listener] of listeners) session.off(method,listener); await session.detach()},
    goto:(url,timeout) => page.goto(url,{waitUntil:'domcontentloaded',timeout}),
    reload:timeout => page.reload({waitUntil:'domcontentloaded',timeout}),
    click:(selector,timeout) => target(selector).click({timeout}),
    fill:(selector,value,timeout) => target(selector).fill(value,{timeout}),
    selectOption:(selector,value,timeout) => target(selector).selectOption(value,{timeout}),
    focus:(selector,timeout) => target(selector).focus({timeout}),
    press:(selector,value,timeout) => target(selector).press(value,{timeout}),
    screenshot:path => page.screenshot({path,fullPage:true,timeout:options?.timeoutMs ?? 30000}),
    setViewport:viewport => page.setViewportSize(viewport),
    setColorScheme:colorScheme => page.emulateMedia({colorScheme}),
  },options)
}

/** Wrap only the caller's existing Ego Page; never creates/claims a TaskSpace. */
export async function createEgoApplicationProjectAdapter(page,options) {
  for (const method of ['cdp','events','goto','reload','click','fill','selectOption','focus','press','evaluate','waitForFunction','screenshot']) assert(typeof page?.[method] === 'function','documented Ego Page method missing: ' + method)
  // The installed Ego runtime rejects terminal text pseudo-selectors on raw CSS
  // even though its guide lists them. Resolve the intended visible DOM element
  // first, then use Ego's documented strict accessible-role action. No synthetic
  // events, positional first()/nth() fallback or reduced business assertion.
  const nativeSelector = async selector => {
    const match = selector.match(/^(.*):(has-text|text-is)\(("(?:[^"\\]|\\.)*")\)$/)
    if (!match) return selector
    const result = await page.evaluate(({css,text,exact}) => {
      const roots = [document]
      for (let index=0; index<roots.length; index++) for (const node of roots[index].querySelectorAll('*')) if (node.shadowRoot) roots.push(node.shadowRoot)
      const normalize = value => String(value ?? '').replace(/\s+/g,' ').trim()
      const wanted = normalize(text)
      const candidates = roots.flatMap(root => [...root.querySelectorAll(css)]).filter(node => {
        const style = getComputedStyle(node)
        if (!node.getClientRects().length || style.visibility === 'hidden' || style.display === 'none') return false
        const observed = normalize(node.innerText ?? node.textContent)
        return exact ? observed === wanted : observed.includes(wanted)
      })
      if (candidates.length !== 1) throw new Error('Expected one visible intended text target; found ' + candidates.length)
      const roleOf = element => element.getAttribute('role') ?? ({BUTTON:'button',A:'link',INPUT:'textbox',TEXTAREA:'textbox',SELECT:'combobox'})[element.tagName]
      const target = candidates[0]
      const node = roleOf(target) ? target : target.closest('button,a[href],[role="button"],[role="option"],[role="tab"]')
      if (!node || !node.contains(target)) throw new Error('Text target has no actual interactive ancestor')
      const nameOf = element => {
        const labels = element.getAttribute('aria-labelledby')?.split(/\s+/).filter(Boolean)
        if (labels?.length) return normalize(labels.map(id => element.getRootNode().getElementById(id)?.textContent ?? '').join(' '))
        return normalize(element.getAttribute('aria-label') ?? element.innerText ?? element.textContent)
      }
      const role = roleOf(node)
      const name = nameOf(node)
      if (!role || !name) throw new Error('Text target requires an actual accessible role and name')
      if (node.disabled || node.getAttribute('aria-disabled') === 'true') throw new Error('Text target is disabled')
      const semanticMatches = roots.flatMap(root => [...root.querySelectorAll('*')]).filter(element => {
        const style = getComputedStyle(element)
        return element.getClientRects().length && style.visibility !== 'hidden' && style.display !== 'none'
          && roleOf(element) === role && nameOf(element) === name
      })
      if (semanticMatches.length !== 1 || semanticMatches[0] !== node) throw new Error('Accessible-role action would not uniquely identify the intended DOM target')
      return {role,name}
    },{css:match[1],text:JSON.parse(match[3]),exact:match[2] === 'text-is'})
    return 'loc=role:' + result.role + '[name=' + JSON.stringify(result.name) + ']'
  }
  return makeAdapter(page,{
    send:(method,params) => page.cdp(method,params,{timeout:options?.timeoutMs ?? 30000}),
    browserSend:options?.browserCdp,
    getTargetId:() => page.targetId,
    attach:async () => {}, // Ego buffers CDP events; it is NOT an EventEmitter.
    async drain() {
      const result = await page.events()
      assert(Array.isArray(result),'Ego page.events() did not return the documented event array')
      return result
    },
    detach:async () => {}, // Do not disable domains owned by the user's Page.
    goto:(url,timeout) => page.goto(url,{waitUntil:'domcontentloaded',timeout}),
    reload:timeout => page.reload({waitUntil:'domcontentloaded',timeout}),
    click:async (selector,timeout) => page.click(await nativeSelector(selector),{timeout}),
    fill:async (selector,value,timeout) => page.fill(await nativeSelector(selector),value,{timeout}),
    selectOption:async (selector,value,timeout) => page.selectOption(await nativeSelector(selector),value,{timeout}),
    focus:async (selector,timeout) => page.focus(await nativeSelector(selector),{timeout}),
    press:async (selector,value,timeout) => page.press(await nativeSelector(selector),value,{timeout}),
    screenshot:path => page.screenshot({path,fullPage:true}),
    setViewport:({width,height}) => page.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false}),
    setColorScheme:scheme => page.cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]}),
  },options)
}

/** Retain a failure screenshot even when a business assertion (not a tool) throws. */
export async function runApplicationProjectBrowser(adapter,base,fixture,record) {
  assert(typeof record === 'function','a persistent report callback is required')
  adapter.redactSecrets([fixture?.admin?.password])
  let lastReport = null
  const persist = async report => {
    lastReport = copy(report)
    lastReport.adapterArtifacts = adapter.artifactReferences()
    await record(lastReport)
  }
  try {
    const {runApplicationProjectUi} = await import('./application-project-ui-cases.mjs')
    return await runApplicationProjectUi(adapter,base,fixture,persist)
  } catch (error) {
    await adapter.captureFailure(error,'business-assertion-failure')
    const evidence = await adapter.diagnosticEvidenceReference().catch(captureError => ({captureFailure:String(captureError.message)}))
    const report = lastReport ?? {completed:false,rows:[],ui:[],failure:{message:String(error.message)}}
    report.completed = false
    report.adapterArtifacts = adapter.artifactReferences()
    report.adapterDiagnostics = evidence
    await record(report)
    throw error
  }
}
