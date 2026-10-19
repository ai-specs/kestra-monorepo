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

const PROTOCOL_EVENTS = Object.freeze([
  'Page.frameNavigated','Page.navigatedWithinDocument',
  'Runtime.executionContextCreated','Runtime.executionContextDestroyed','Runtime.executionContextsCleared',
  'Runtime.consoleAPICalled','Runtime.exceptionThrown',
  'Log.entryAdded','Network.requestWillBeSent','Network.responseReceived','Network.loadingFailed',
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
        requests.set(p.requestId,{document:{...document},url:p.request.url,method:p.request.method,frameId:p.frameId,loaderId:p.loaderId})
        add('request',document,{requestId:p.requestId,url:p.request.url,method:p.request.method,resourceType:p.type,frameId:p.frameId,loaderId:p.loaderId})
        break
      }
      case 'Network.responseReceived': {
        const request = requests.get(p.requestId)
        const document = request?.document ?? frameDocuments.get(p.frameId) ?? current
        const response = p.response ?? {}
        if(request)request.status=response.status
        add(response.status >= 400 ? 'http-error' : 'http-response',document,{requestId:p.requestId,url:response.url ?? request?.url,status:response.status,method:request?.method,resourceType:p.type,message:'HTTP ' + response.status,fromDiskCache:response.fromDiskCache === true,fromServiceWorker:response.fromServiceWorker === true})
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
  let failureCapture = false
  const drain = async () => {
    for (const envelope of await tools.drain()) {
      const event = envelope?.method ? envelope : envelope?.event?.method ? envelope.event : null
      if (!event || typeof event.method !== 'string' || !event.params || typeof event.params !== 'object') {
        collector.issue('unrecognized CDP event envelope; refusing incomplete diagnostics')
        continue
      }
      try {collector.consume(event.method,event.params)} catch (error) {collector.issue('CDP normalization failed: ' + redact.text(error.message))}
    }
  }
  await tools.attach((method,params) => {
    try {collector.consume(method,params)} catch (error) {collector.issue('CDP normalization failed: ' + redact.text(error.message))}
  })
  try {await initializeProtocol(tools.send,collector); await drain()} catch (error) {await tools.detach(); throw error}
  async function screenshot(label = 'snapshot') {
    const path = join(options.artifactDirectory,artifactRun + '-' + String(++artifactSequence).padStart(4,'0') + '-' + label.replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,60) + '.png')
    await tools.screenshot(path)
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
  const adapter = {
    goto:url => action('goto',() => tools.goto(url,timeout)),
    reload:() => action('reload',() => tools.reload(timeout)),
    click:selector => action('click',() => tools.click(commonSelector(selector),timeout)),
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
    captureFailure,
    redactSecrets:values => redact.add(values),
    artifactReferences:() => copy(artifacts),
    diagnosticEvidence:async () => {try {await drain()} catch (error) {collector.issue('final diagnostic drain failed: ' + redact.text(error.message))}; return collector.unsafeSnapshot()},
    async dispose() {if (!disposed) {try {await drain()} finally {await tools.detach(); disposed = true}}},
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
    return page.locator(match[1]).filter({hasText:new RegExp('^\\s*' + text + '\\s*$')})
  }
  return makeAdapter(page,{
    send:(method,params) => session.send(method,params),
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
      const node = candidates[0]
      const roleOf = element => element.getAttribute('role') ?? ({BUTTON:'button',A:'link',INPUT:'textbox',TEXTAREA:'textbox',SELECT:'combobox'})[element.tagName]
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
    const evidence = await adapter.diagnosticEvidence().catch(captureError => ({captureFailure:String(captureError.message)}))
    const report = lastReport ?? {completed:false,rows:[],ui:[],failure:{message:String(error.message)}}
    report.completed = false
    report.adapterArtifacts = adapter.artifactReferences()
    report.adapterDiagnostics = evidence
    await record(report)
    throw error
  }
}
