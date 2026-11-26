import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import {runAmisAppsBrowser, amisLoginOrPageReady, amisCanonicalPageReady, amisDeniedPageReady, amisResultReady} from '../amis-apps-browser.mjs'

const base = 'https://browser-unit.invalid'
const path = '/company.demo/Greeting.v1/pages/_home'
const account = {username: 'allowed-test', password: 'secret-test-only-P@ss'}
const nextPassword = 'other-test-only-secret'

function fakeAdapter(settings = {}) {
  const state = {href: 'about:blank', session: settings.existingSession ?? null, username: '', input: '', result: '', title: 'AMIS production acceptance', generation: 1, alert: null}
  const calls = []; const recorded = []; const events = []; const documents = []; const captured = []
  let serial = 0
  const observe = kind => {
    serial++
    events.push({id: `FAKE-event-${serial}`, kind, documentId: `FAKE-document-${state.generation}`, documentUrl: state.href})
  }
  const navigate = href => {
    state.href = href; state.generation++; state.result = ''; state.input = ''
    documents.push({id: `FAKE-document-${state.generation}`, url: state.href})
    observe('document-navigation')
  }
  const node = (textContent = '', extra = {}) => Object.freeze({textContent, innerText: textContent, disabled: false, getClientRects: () => [{width: 120, height: 30}], ...extra})
  const evaluate = (callback, argument) => {
    const url = new URL(state.href === 'about:blank' ? base : state.href)
    const login = url.pathname === '/oidc/login'
    const denied = url.pathname === '/ui/access-denied'
    const business = url.pathname === path
    const lookup = selector => {
      if (selector === 'input[name="username"]') return login ? [node('', {value: state.username})] : []
      if (selector === 'input[name="password"]') return login ? [node()] : []
      if (selector === 'button[type="submit"]') return login ? [node('Sign in')] : []
      if (selector === 'input[name="name"]') return business ? [node('', {value: state.input}), ...(settings.duplicateInput ? [node()] : [])] : []
      if (selector === '.cxd-Page-title, .dark-Page-title') return business ? [node(state.title)] : []
      if (selector === 'button') return business ? [node('Submit')] : login ? [node('Sign in')] : []
      if (selector === '[role="alert"]') return state.alert ? [node(state.alert)] : []
      if (selector === 'main .cxd-TplField, main .dark-TplField') return business && state.result ? [node(state.result)] : []
      if (selector === 'a[href="/oidc/logout"]') return !settings.missingLogout && !state.missingLogout && business ? [node('Sign out / switch account')] : []
      if (selector === 'button[data-testid="return-to-login"]') return denied && !settings.missingLogout && !state.missingLogout && !settings.missingReturnToLogin
        ? [node('Login'), ...(settings.duplicateReturnToLogin ? [node('Login')] : [])] : []
      throw new Error(`FAKE adapter has no DOM selector: ${selector}`)
    }
    const sandbox = {
      location: Object.freeze({href: state.href, origin: url.origin, pathname: url.pathname, search: url.search, hash: url.hash}),
      performance: Object.freeze({timeOrigin: settings.equalTimeOrigin ? 1 : state.generation}),
      getComputedStyle: () => Object.freeze({visibility: 'visible'}),
      document: Object.freeze({title: 'FAKE unit document', body: state.bodyMissing ? null : Object.freeze({innerText: denied ? (state.denialText ?? settings.denialText ?? 'Access denied: no grants') : state.result}), querySelector: selector => lookup(selector)[0] ?? null, querySelectorAll: lookup})
    }
    return vm.runInNewContext(`'use strict'; (${callback.toString()})`, sandbox)(argument)
  }
  const adapter = {
    async goto(href) {
      calls.push(['goto', href])
      assert.equal(new URL(href).origin, base)
      if (new URL(href).pathname === path) navigate(state.session ? base + path : base + '/oidc/login?from=' + encodeURIComponent(path))
      else throw new Error('FAKE unexpected navigation')
    },
    async reload() {
      calls.push(['reload'])
      if (!settings.staleRefresh) navigate(settings.wrongRefreshPath ? base + '/wrong' : state.href)
      if (settings.changedTitle) state.title = 'Loading a different schema'
    },
    async fill(selector, value) {
      calls.push(['fill', selector, value]); observe('native-fill')
      if (selector === 'input[name="username"]') state.username = value
      else if (selector === 'input[name="password"]') assert([account.password, nextPassword].includes(value))
      else if (selector === 'input[name="name"]') state.input = value
      else throw new Error('FAKE unexpected fill')
    },
    async click(selector) {
      calls.push(['click', selector]); observe('native-click')
      if (selector === 'button[type="submit"]') {
        state.session = state.username
        navigate(settings.wrongLoginPath ? base + '/wrong' : state.username === 'zero-test' ? base + '/ui/access-denied' : base + path)
      } else if (selector === 'button:text-is("Submit")') {
        if (settings.submitError) throw new Error(settings.submitError)
        if (settings.errorAlert) state.alert = 'Execution failed'
        if (!settings.noResult) state.result = `Result: ${state.input}`
      } else if (selector === 'a[href="/oidc/logout"]' || selector === 'button[data-testid="return-to-login"]') {
        assert.equal(new URL(state.href).pathname === '/ui/access-denied', selector === 'button[data-testid="return-to-login"]', 'Exit control must come from the actual source page')
        if (selector === 'button[data-testid="return-to-login"]') assert(!settings.missingReturnToLogin)
        if (!settings.logoutDoesNotClear) state.session = null
        navigate(base + '/oidc/login')
      } else throw new Error(`FAKE unsupported common selector: ${selector}`)
    },
    async evaluate(callback, argument) {return evaluate(callback, argument)},
    async waitForFunction(callback, argument) {
      calls.push(['wait', callback.name]); observe('readonly-dom-wait')
      if (!evaluate(callback, argument)) throw new Error(`FAKE ReadonlyDOM predicate not satisfied: ${callback.name}`)
    },
    async diagnostics() {return {events: settings.lostDiagnostics && serial > 5 ? [] : [...events], documents: [...documents], integrity: []}},
    async diagnosticEvidenceReference() {return {kind: 'FAKE-unit-file-not-real-evidence', path: `/FAKE/unit/diagnostics-${serial}.json`, sha256: 'a'.repeat(64)}},
    artifactReferences() {return captured.map(label => ({kind: 'FAKE-unit-screenshot', path: `/FAKE/${label}.png`}))},
    async captureFailure(error, label) {captured.push(label)},
    redactSecrets(values) {calls.push(['register-redactor', values.length])}
  }
  const options = {base, account, namespace: 'company.demo', flowId: 'Greeting.v1', pageId: '_home', marker: 'UNIQUE-SAVED-MARKER', record: async report => {recorded.push(report)}}
  return {adapter, options, calls, recorded, state, evaluate}
}

test('FAKE adapter only: same native login/bookmark/form/result/refresh/logout assertions in order', async () => {
  const fixture = fakeAdapter()
  const report = await runAmisAppsBrowser(fixture.adapter, fixture.options)
  assert.equal(report.completed, true)
  assert.deepEqual(report.summary, {passed: 8, failed: 0, skipped: 0, notRun: 0})
  assert.deepEqual(report.checks.map(row => row.id), ['bookmark', 'production-login', 'canonical-page', 'fill-input', 'submit-result', 'refresh-page', 'logout', 'logged-out-bookmark'])
  assert.deepEqual(fixture.calls.filter(row => ['goto', 'fill', 'click', 'reload'].includes(row[0])), [
    ['goto', base + path], ['fill', 'input[name="username"]', account.username], ['fill', 'input[name="password"]', account.password], ['click', 'button[type="submit"]'],
    ['fill', 'input[name="name"]', 'UNIQUE-SAVED-MARKER'], ['click', 'button:text-is("Submit")'], ['reload'], ['click', 'a[href="/oidc/logout"]'], ['goto', base + path]
  ])
  assert(report.checks.every(row => row.evidence.document.timeOrigin > 0 && row.evidence.diagnosticFile.path.startsWith('/FAKE/') && row.evidence.documents.length > 0))
  assert(!JSON.stringify(fixture.recorded).includes(account.password))
  assert.match(report.scope, /not production execution-store/)
})

test('FAKE adapter only: existing admin is natively logged out before requested lower account login', async () => {
  const fixture = fakeAdapter({existingSession: 'existing-admin'})
  const report = await runAmisAppsBrowser(fixture.adapter, fixture.options)
  assert.equal(report.checks[1].evidence.observation.performed, true)
  assert.equal(report.checks[1].evidence.observation.replacedExistingSession, true)
  const exit = fixture.calls.findIndex(row => row[0] === 'click' && row[1] === 'a[href="/oidc/logout"]')
  const credentials = fixture.calls.findIndex(row => row[0] === 'fill' && row[1] === 'input[name="username"]' && row[2] === account.username)
  assert(exit >= 0 && credentials > exit)
  assert.deepEqual(fixture.calls.slice(exit + 1, credentials).filter(row => row[0] === 'goto'), [['goto', base + path]])
  assert(fixture.calls.some(row => row[0] === 'fill' && row[1] === 'input[name="password"]' && row[2] === account.password))
})

for (const access of ['allowed', 'zero']) test(`FAKE adapter only: native logout and next ${access} account login`, async () => {
  const fixture = fakeAdapter()
  fixture.options.nextAccount = {username: access === 'zero' ? 'zero-test' : 'second-allowed', password: nextPassword, access, denialText: 'Access denied: no grants'}
  const report = await runAmisAppsBrowser(fixture.adapter, fixture.options)
  assert.equal(report.completed, true)
  assert.equal(report.summary.passed, access === 'zero' ? 13 : 16)
  assert(report.checks.some(row => row.id === 'next-production-login' && row.evidence.observation.performed))
  assert.equal(fixture.calls.filter(row => row[0] === 'click' && row[1] === 'button:text-is("Submit")').length, access === 'zero' ? 1 : 2)
  assert.equal(fixture.calls.filter(row => row[0] === 'click' && row[1] === 'a[href="/oidc/logout"]').length, access === 'zero' ? 1 : 2)
  assert.equal(fixture.calls.filter(row => row[0] === 'click' && row[1] === 'button[data-testid="return-to-login"]').length, access === 'zero' ? 1 : 0)
  assert(!JSON.stringify(fixture.recorded).includes(nextPassword))
  if (access === 'zero') assert.match(report.checks.find(row => row.id === 'next-zero-authority-denial').evidence.observation.note, /separate production evidence/)
})

for (const [name, settings, failedPhase] of [
  ['login wrong final path', {wrongLoginPath: true}, 'production-login'],
  ['duplicate actual input', {duplicateInput: true}, 'production-login'],
  ['no rendered result', {noResult: true}, 'submit-result'],
  ['visible execution error despite result', {errorAlert: true}, 'submit-result'],
  ['stale document on refresh', {staleRefresh: true}, 'refresh-page'],
  ['wrong canonical path after refresh', {wrongRefreshPath: true}, 'refresh-page'],
  ['changed schema title', {changedTitle: true}, 'refresh-page'],
  ['logout keeps business session', {logoutDoesNotClear: true}, 'logged-out-bookmark'],
  ['diagnostic history lost', {lostDiagnostics: true}, 'production-login']
]) test(`FAKE adapter only: rejects ${name} and retains prior assertions`, async () => {
  const fixture = fakeAdapter(settings)
  await assert.rejects(runAmisAppsBrowser(fixture.adapter, fixture.options), error => {
    assert.equal(error.report.completed, false)
    assert.equal(error.report.failure.phase, failedPhase)
    const row = error.report.checks.find(item => item.id === failedPhase)
    assert.equal(row.status, 'failed')
    assert(error.report.checks.some(item => item.status === 'passed'))
    assert.equal(fixture.recorded.at(-1).failure.phase, failedPhase)
    assert.equal(error.report.summary.failed, 1)
    return true
  })
})

test('FAKE adapter only: exceptions redact password and retain failure artifacts/document refs', async () => {
  const fixture = fakeAdapter({submitError: `tool exception ${account.password} ${encodeURIComponent(account.password)}`})
  await assert.rejects(runAmisAppsBrowser(fixture.adapter, fixture.options), error => {
    assert(!error.message.includes(account.password))
    const retained = JSON.stringify(error.report)
    assert(!retained.includes(account.password))
    assert(!retained.includes(encodeURIComponent(account.password)))
    assert.match(retained, /redacted/)
    assert(error.report.checks.find(row => row.status === 'failed').evidence.artifacts.length > 0)
    return true
  })
})

test('FAKE adapter only: refuses underspecified zero account and malformed routes before navigation', async () => {
  for (const change of [{namespace: '../private'}, {pageId: 'home.json'}, {base: `${base}/path`}, {marker: ''}, {nextAccount: {username: 'zero-test', password: nextPassword, access: 'zero'}}]) {
    const fixture = fakeAdapter()
    await assert.rejects(runAmisAppsBrowser(fixture.adapter, {...fixture.options, ...change}))
    assert(!fixture.calls.some(row => row[0] === 'goto'))
  }
})

test('ReadonlyDOM predicates use exact canonical path, title and rendered result, not HTTP status', () => {
  const fixture = fakeAdapter({existingSession: 'allowed'})
  fixture.state.href = base + path
  const options = {origin: base, path, title: 'AMIS production acceptance', submitText: 'Submit'}
  assert.equal(fixture.evaluate(amisCanonicalPageReady, options), true)
  fixture.state.href += '?temporary=loading'
  assert.equal(fixture.evaluate(amisCanonicalPageReady, options), false)
  fixture.state.href = base + path
  fixture.state.input = 'MARKER'
  assert.equal(fixture.evaluate(amisResultReady, {origin: base, path, resultText: 'Result: MARKER'}), false)
  fixture.state.result = 'Result: MARKER'
  assert.equal(fixture.evaluate(amisResultReady, {origin: base, path, resultText: 'Result: MARKER'}), true)
  fixture.state.href = base + '/ui/access-denied'
  assert.equal(fixture.evaluate(amisDeniedPageReady, {origin: base, path: '/ui/access-denied', denialText: 'Access denied: no grants'}), true)
})

test('FAKE adapter only: final persistence failure retains all executed assertions and redacts secrets', async () => {
  const fixture = fakeAdapter()
  fixture.options.record = async report => {
    fixture.recorded.push(report)
    if (report.completed) throw new Error(`disk error ${account.password}`)
  }
  await assert.rejects(runAmisAppsBrowser(fixture.adapter, fixture.options), error => {
    assert.equal(error.report.completed, false)
    assert.equal(error.report.failure.phase, 'report-finalize')
    assert.equal(error.report.checks.filter(row => row.status === 'passed').length, 8)
    assert(!JSON.stringify(error.report).includes(account.password))
    return true
  })
})

test('helper source has no browser construction, profile clearing, fetch transport or sleeps', () => {
  const source = readFileSync(new URL('../amis-apps-browser.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /newContext\(|chromium\.launch|\.route\(|localStorage\.clear|clearCookies|fetch\(|setTimeout\(/)
  assert.match(source, /button:text-is\(/)
})


test('FAKE state machine: zero bookmark directly accepts only the selected denial page', async () => {
  const fixture = fakeAdapter()
  fixture.state.href = base + '/ui/access-denied'
  const target = {origin: base, path, access: 'zero', deniedPath: '/ui/access-denied', denialText: 'Access denied: no grants'}
  await fixture.adapter.waitForFunction(amisLoginOrPageReady, target)
  assert.equal(fixture.evaluate(amisLoginOrPageReady, {...target, access: 'allowed'}), false)
  assert.equal(fixture.evaluate(amisLoginOrPageReady, {...target, deniedPath: '/other-denial'}), false)
  assert.equal(fixture.evaluate(amisLoginOrPageReady, {...target, denialText: 'different reason'}), false)
  const missingExit = fakeAdapter({missingLogout:true})
  missingExit.state.href = fixture.state.href
  await assert.rejects(missingExit.adapter.waitForFunction(amisLoginOrPageReady, target), /predicate not satisfied/)
})

for (const settings of [{missingLogout:true}, {denialText:'wrong denial reason'}]) test('FAKE state machine: zero login wrong denial content fails and retains allowed-account checks ' + JSON.stringify(settings), async () => {
  const fixture = fakeAdapter()
  fixture.options.nextAccount = {username:'zero-test',password:nextPassword,access:'zero',denialText:'Access denied: no grants'}
  const originalClick = fixture.adapter.click
  fixture.adapter.click = async selector => {
    await originalClick(selector)
    if (fixture.state.session === 'zero-test') {
      fixture.state.missingLogout = settings.missingLogout
      fixture.state.denialText = settings.denialText
    }
  }
  await assert.rejects(runAmisAppsBrowser(fixture.adapter,fixture.options), error => {
    assert.equal(error.report.failure.phase,'next-production-login')
    assert.equal(error.report.checks.filter(row=>row.status==='passed').length,9)
    assert.equal(error.report.checks.find(row=>row.id==='next-zero-authority-denial').status,'not_run')
    return true
  })
})

test('FAKE state machine: refresh generation changes even when timeOrigin is equal', async () => {
  const fixture = fakeAdapter({equalTimeOrigin:true})
  const report = await runAmisAppsBrowser(fixture.adapter,fixture.options)
  const observation = report.checks.find(row=>row.id==='refresh-page').evidence.observation
  assert.equal(observation.previousTimeOrigin,observation.timeOrigin)
  assert.notEqual(observation.previousDocumentId,observation.documentId)
})

test('FAKE state machine: existing admin logout that retains session fails before requested-user credential fill', async () => {
  const fixture = fakeAdapter({existingSession:'existing-admin',logoutDoesNotClear:true})
  await assert.rejects(runAmisAppsBrowser(fixture.adapter, fixture.options), error => {
    assert.equal(error.report.failure.phase, 'production-login')
    assert.equal(error.report.checks[0].status,'passed')
    assert.equal(error.report.checks.find(row=>row.id==='submit-result').status,'not_run')
    assert(!fixture.calls.some(row=>row[0]==='fill'&&row[1]==='input[name="password"]'))
    return true
  })
})

test('denial readiness waits through null body navigation and only accepts final same-origin denial document', () => {
  const fixture = fakeAdapter()
  fixture.state.href = base + '/ui/access-denied'
  const denied = {origin:base,path:'/ui/access-denied',denialText:'Access denied: no grants'}
  const login = {origin:base,path,access:'zero',deniedPath:'/ui/access-denied',denialText:denied.denialText}
  fixture.state.bodyMissing = true
  assert.equal(fixture.evaluate(amisDeniedPageReady,denied),false)
  assert.equal(fixture.evaluate(amisLoginOrPageReady,login),false)
  fixture.state.bodyMissing = false
  assert.equal(fixture.evaluate(amisDeniedPageReady,denied),true)
  assert.equal(fixture.evaluate(amisLoginOrPageReady,login),true)
  fixture.state.href = 'https://wrong-origin.invalid/ui/access-denied'
  assert.equal(fixture.evaluate(amisDeniedPageReady,denied),false)
  assert.equal(fixture.evaluate(amisLoginOrPageReady,login),false)
  fixture.state.href = base + '/wrong-denial'
  assert.equal(fixture.evaluate(amisDeniedPageReady,denied),false)
  assert.equal(fixture.evaluate(amisLoginOrPageReady,login),false)
  fixture.state.href = base + '/ui/access-denied'
  fixture.state.denialText = 'Different failure'
  assert.equal(fixture.evaluate(amisDeniedPageReady,denied),false)
  assert.equal(fixture.evaluate(amisLoginOrPageReady,login),false)
})

for (const settings of [{missingReturnToLogin:true},{duplicateReturnToLogin:true}]) test('native denial page requires exactly one return-to-login button '+JSON.stringify(settings),async()=>{
  const fixture=fakeAdapter(settings)
  fixture.state.href=base+'/ui/access-denied'
  assert.equal(fixture.evaluate(amisDeniedPageReady,{origin:base,path:'/ui/access-denied',denialText:'Access denied: no grants'}),false)
  assert.equal(fixture.evaluate(amisLoginOrPageReady,{origin:base,path,access:'zero',deniedPath:'/ui/access-denied',denialText:'Access denied: no grants'}),false)
  fixture.state.href='about:blank'
  fixture.options.nextAccount={username:'zero-test',password:nextPassword,access:'zero',denialText:'Access denied: no grants'}
  await assert.rejects(runAmisAppsBrowser(fixture.adapter,fixture.options),error=>{
    assert.equal(error.report.completed,false)
    assert.equal(error.report.checks.find(row=>row.id==='next-zero-authority-denial').status,'not_run')
    assert.equal(error.report.checks.find(row=>row.id==='submit-result').status,'passed')
    return true
  })
})
