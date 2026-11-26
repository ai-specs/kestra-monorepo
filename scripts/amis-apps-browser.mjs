import assert from 'node:assert/strict'

const sourceFile = 'scripts/amis-apps-browser.mjs'
const inputSelector = 'input[name="name"]'
const logoutSelector = 'a[href="/oidc/logout"]'
const phaseNames = ['bookmark', 'production-login', 'canonical-page', 'fill-input', 'submit-result', 'refresh-page', 'logout', 'logged-out-bookmark']

export function amisBrowserDocument() {
  return {url: location.href, path: location.pathname, timeOrigin: performance.timeOrigin, title: document.title}
}

export function amisLoginOrPageReady({origin, path, access, deniedPath, denialText}) {
  const visible = node => Boolean(node?.getClientRects().length) && getComputedStyle(node).visibility !== 'hidden'
  if (!document.body) return false
  if (location.origin !== origin) return false
  if (access === 'zero' && location.pathname === deniedPath) return typeof denialText === 'string' && Boolean(denialText.trim()) && document.body.innerText.includes(denialText) && [...document.querySelectorAll('button[data-testid="return-to-login"]')].filter(visible).length === 1 && ![...document.querySelectorAll('input[name="name"]')].some(visible)
  if (location.pathname === '/oidc/login') return visible(document.querySelector('input[name="username"]')) && visible(document.querySelector('input[name="password"]')) && visible(document.querySelector('button[type="submit"]'))
  return location.pathname === path && !location.search && !location.hash && visible(document.querySelector('input[name="name"]')) && [...document.querySelectorAll('.cxd-Page-title, .dark-Page-title')].some(node => visible(node) && node.textContent.trim())
}

export function amisCanonicalPageReady({origin, path, title, submitText}) {
  const visible = node => Boolean(node?.getClientRects().length) && getComputedStyle(node).visibility !== 'hidden'
  if (location.origin !== origin || location.pathname !== path || location.search || location.hash) return false
  const inputs = [...document.querySelectorAll('input[name="name"]')].filter(visible)
  const titles = [...document.querySelectorAll('.cxd-Page-title, .dark-Page-title')].filter(visible)
  const buttons = [...document.querySelectorAll('button')].filter(node => visible(node) && node.textContent.trim() === submitText)
  return inputs.length === 1 && !inputs[0].disabled && titles.length === 1 && titles[0].textContent.trim() === title && buttons.length === 1 && !buttons[0].disabled && !visible(document.querySelector('[role="alert"]')) && !visible(document.querySelector('input[name="password"]'))
}

export function amisResultReady({origin, path, resultText}) {
  const visible = node => Boolean(node?.getClientRects().length) && getComputedStyle(node).visibility !== 'hidden'
  return location.origin === origin && location.pathname === path && !location.search && !location.hash && !visible(document.querySelector('[role="alert"]')) && [...document.querySelectorAll('main .cxd-TplField, main .dark-TplField')].some(node => visible(node) && node.textContent.trim() === resultText)
}

export function amisDeniedPageReady({origin, path, denialText}) {
  const visible = node => Boolean(node?.getClientRects().length) && getComputedStyle(node).visibility !== 'hidden'
  if (!document.body) return false
  return location.origin === origin && location.pathname === path && document.body.innerText.includes(denialText) && [...document.querySelectorAll('button[data-testid="return-to-login"]')].filter(visible).length === 1 && ![...document.querySelectorAll('input[name="name"]')].some(visible)
}

function redact(value, secrets) {
  if (typeof value === 'string') {
    for (const secret of secrets) if (secret) value = value.replaceAll(secret, '[redacted]').replaceAll(encodeURIComponent(secret), '[redacted]')
    return value.replace(/([?&](?:code|state|access_token|id_token|refresh_token|password)=)[^&#\s]*/gi, '$1[redacted]').replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
  }
  if (Array.isArray(value)) return value.map(item => redact(item, secrets))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, secrets)]))
  return value
}

export async function runAmisAppsBrowser(adapter, options) {
  const {base, account, namespace, flowId, pageId, marker, nextAccount, record} = options
  for (const method of ['goto', 'reload', 'fill', 'click', 'evaluate', 'waitForFunction', 'diagnostics', 'diagnosticEvidenceReference', 'artifactReferences', 'captureFailure', 'redactSecrets']) assert.equal(typeof adapter?.[method], 'function', `Existing adapter.${method} required`)
  assert.equal(typeof record, 'function', 'Persistent report callback required')
  const origin = new URL(base)
  assert.equal(origin.origin, base, 'Base must be an origin without a path or credentials')
  assert(['http:', 'https:'].includes(origin.protocol))
  assert(typeof namespace === 'string' && namespace.length <= 150 && /^[a-z0-9][a-z0-9_-]*(\.[a-z0-9_-]+)*$/.test(namespace), 'Invalid namespace')
  assert(typeof flowId === 'string' && flowId.length <= 100 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(flowId), 'Invalid Flow ID')
  assert(typeof pageId === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_-]{0,99}$/.test(pageId), 'Invalid page ID')
  assert(typeof marker === 'string' && marker.trim() && marker.length <= 200, 'Explicit nonempty marker required')
  const validateAccount = value => {assert(typeof value?.username === 'string' && value.username); assert(typeof value?.password === 'string' && value.password)}
  validateAccount(account)
  assert(!account.access || account.access === 'allowed', 'Primary account must be explicitly allowed; zero-account switching uses nextAccount')
  if (nextAccount) {
    validateAccount(nextAccount)
    assert.notEqual(nextAccount.username, account.username, 'Account switch requires a different username')
    assert(['allowed', 'zero'].includes(nextAccount.access), 'Next account requires explicit allowed/zero expectation')
    if (nextAccount.access === 'zero') assert(typeof nextAccount.denialText === 'string' && nextAccount.denialText.trim(), 'Explicit denial text required')
    if (nextAccount.marker !== undefined) assert(typeof nextAccount.marker === 'string' && nextAccount.marker.trim() && nextAccount.marker.length <= 256, 'Invalid next-account marker')
  }
  const secrets = [account.password, nextAccount?.password].filter(Boolean)
  adapter.redactSecrets(secrets)
  const path = `/${namespace}/${flowId}/pages/${pageId}`
  const submitText = options.submitText ?? 'Submit'
  const submitSelector = 'button:text-is(' + JSON.stringify(submitText) + ')'
  const configuredTitle = options.schemaTitle ?? 'AMIS production acceptance'
  const planned = phaseNames.map(id => ({id, sourceFile, status: 'not_run'}))
  if (nextAccount) planned.push(...(nextAccount.access === 'allowed' ? phaseNames : ['bookmark', 'production-login', 'zero-authority-denial', 'logout', 'logged-out-bookmark']).map(id => ({id: `next-${id}`, sourceFile, status: 'not_run'})))
  const report = {schemaVersion: 1, completed: false, scope: 'Shared browser UI observations; not production execution-store, persistence or RBAC proof', sourceFile, canonicalPath: path, checks: planned, limitations: ['No browser/context/profile is created or cleared', 'No HTTP client, identity simulation, route interception or execution-store assertion', 'Independent repository visual matrices are not repeated or reduced by this workflow'], failure: null}
  const snapshot = () => redact(structuredClone(report), secrets)
  let lastEventCount = 0
  const evidence = async () => {
    const document = await adapter.evaluate(amisBrowserDocument)
    const diagnostics = await adapter.diagnostics()
    assert(Array.isArray(diagnostics.events) && Array.isArray(diagnostics.documents), 'Adapter diagnostic event/document history required')
    assert(diagnostics.events.length >= lastEventCount, 'Adapter diagnostic history was lost')
    const events = diagnostics.events.slice(lastEventCount)
    lastEventCount = diagnostics.events.length
    const file = await adapter.diagnosticEvidenceReference()
    assert(file?.path && /^[a-f0-9]{64}$/.test(file.sha256), 'Diagnostic source file/hash required')
    return {sourceFile, document, documents: diagnostics.documents, eventIds: events.map(event => event.id), diagnosticFile: file, artifacts: adapter.artifactReferences()}
  }
  const phase = async (id, action) => {
    const row = report.checks.find(item => item.id === id)
    try {
      const observation = await action()
      row.evidence = {...await evidence(), observation}
      row.status = 'passed'
      await record(snapshot())
    } catch (error) {
      row.status = 'failed'
      row.error = String(error.message)
      try {row.sourceDocument = await adapter.evaluate(amisBrowserDocument)} catch (failure) {row.sourceDocumentError = String(failure.message)}
      try {await adapter.captureFailure(error, `amis-${id}`)} catch (failure) {row.captureError = String(failure.message)}
      try {row.evidence = await evidence()} catch (failure) {row.diagnosticError = String(failure.message)}
      report.failure = {phase: id, message: String(error.message)}
      report.summary = {passed: report.checks.filter(item => item.status === 'passed').length, failed: 1, skipped: 0, notRun: report.checks.filter(item => item.status === 'not_run').length}
      const retained = snapshot()
      try {await record(retained)} catch (failure) {retained.recordError = redact(String(failure.message), secrets)}
      const failure = new Error(redact(`AMIS browser phase ${id}: ${error.message}`, secrets))
      failure.report = retained
      throw failure
    }
  }
  const login = async (selected, targetPath) => {
    let document = await adapter.evaluate(amisBrowserDocument)
    let replacedExistingSession = false
    if (document.path !== '/oidc/login') {
      await adapter.click(logoutSelector)
      await adapter.waitForFunction(amisLoginOrPageReady, {origin: base, path: '/__amis_no_business_target__'})
      assert.equal((await adapter.evaluate(amisBrowserDocument)).path, '/oidc/login', 'Existing-session logout did not reach production login')
      await adapter.goto(base + targetPath)
      await adapter.waitForFunction(amisLoginOrPageReady, {origin: base, path: targetPath})
      document = await adapter.evaluate(amisBrowserDocument)
      replacedExistingSession = true
    }
    assert.equal(document.path, '/oidc/login', 'Specified account requires a fresh production login with bookmark target')
    await adapter.fill('input[name="username"]', selected.username)
    await adapter.fill('input[name="password"]', selected.password)
    await adapter.click('button[type="submit"]')
    if (selected.access === 'zero') await adapter.waitForFunction(amisDeniedPageReady, {origin: base, path: selected.deniedPath ?? '/ui/access-denied', denialText: selected.denialText})
    else await adapter.waitForFunction(amisCanonicalPageReady, {origin: base, path: targetPath, title: configuredTitle, submitText})
    return {performed: true, replacedExistingSession, method: 'Native production login form', account: selected.username}
  }
  const logout = async (prefix, denied = false) => {
    await phase(`${prefix}logout`, async () => {
      await adapter.click(denied ? 'button[data-testid="return-to-login"]' : logoutSelector)
      await adapter.waitForFunction(amisLoginOrPageReady, {origin: base, path: '/__amis_no_business_target__'})
      assert.equal((await adapter.evaluate(amisBrowserDocument)).path, '/oidc/login', 'Logout did not reach login form')
      return {clicked: true, target: '/oidc/logout'}
    })
    await phase(`${prefix}logged-out-bookmark`, async () => {
      await adapter.goto(base + path)
      await adapter.waitForFunction(amisLoginOrPageReady, {origin: base, path})
      assert.equal((await adapter.evaluate(amisBrowserDocument)).path, '/oidc/login', 'Protected bookmark remained accessible after logout')
      return {bookmarkRechecked: true}
    })
  }
  const runAccount = async (selected, selectedMarker, prefix = '') => {
    await phase(`${prefix}bookmark`, async () => {
      await adapter.goto(base + path)
      await adapter.waitForFunction(amisLoginOrPageReady, {origin: base, path, access: selected.access, deniedPath: selected.deniedPath ?? '/ui/access-denied', denialText: selected.denialText})
      return {requestedPath: path}
    })
    await phase(`${prefix}production-login`, () => login(selected, path))
    if (selected.access === 'zero') {
      await phase(`${prefix}zero-authority-denial`, async () => {
        await adapter.waitForFunction(amisDeniedPageReady, {origin: base, path: selected.deniedPath ?? '/ui/access-denied', denialText: selected.denialText})
        return {denied: true, note: 'UI denial only; runtime zero grants and side effects require separate production evidence'}
      })
      return logout(prefix, true)
    }
    const target = {origin: base, path, title: configuredTitle, submitText}
    await phase(`${prefix}canonical-page`, async () => {await adapter.waitForFunction(amisCanonicalPageReady, target); return {title: configuredTitle}})
    await phase(`${prefix}fill-input`, async () => {
      await adapter.fill(inputSelector, selectedMarker)
      const value = await adapter.evaluate(() => document.querySelector('input[name="name"]')?.value)
      assert.equal(value, selectedMarker, 'Actual input value differs from marker')
      return {selector: inputSelector, marker: selectedMarker}
    })
    await phase(`${prefix}submit-result`, async () => {
      await adapter.click(submitSelector)
      await adapter.waitForFunction(amisResultReady, {origin: base, path, resultText: `Result: ${selectedMarker}`})
      return {nativeSubmit: true, resultText: `Result: ${selectedMarker}`, persistence: 'Not verified by this UI fragment'}
    })
    await phase(`${prefix}refresh-page`, async () => {
      const before = await adapter.evaluate(amisBrowserDocument)
      const beforeHistory = await adapter.diagnostics()
      const beforeId = beforeHistory.documents.filter(document => document.url === before.url).at(-1)?.id
      await adapter.reload()
      await adapter.waitForFunction(amisCanonicalPageReady, target)
      const after = await adapter.evaluate(amisBrowserDocument)
      const afterHistory = await adapter.diagnostics()
      const afterId = afterHistory.documents.filter(document => document.url === after.url).at(-1)?.id
      assert(beforeId && afterId && beforeId !== afterId, 'Refresh did not create a new adapter document identity')
      return {title: configuredTitle, previousTimeOrigin: before.timeOrigin, timeOrigin: after.timeOrigin, previousDocumentId: beforeId, documentId: afterId}
    })
    await logout(prefix)
  }
  await record(snapshot())
  await runAccount(account, marker)
  if (nextAccount) await runAccount(nextAccount, nextAccount.marker ?? `${marker}-next`, 'next-')
  report.completed = true
  report.summary = {passed: report.checks.filter(row => row.status === 'passed').length, failed: 0, skipped: 0, notRun: 0}
  try {await record(snapshot())} catch (error) {
    report.completed = false
    report.failure = {phase: 'report-finalize', message: String(error.message)}
    const failure = new Error(redact(`AMIS browser report persistence failed: ${error.message}`, secrets))
    failure.report = snapshot()
    throw failure
  }
  return snapshot()
}
