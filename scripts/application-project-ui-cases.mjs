/**
 * Shared REAL-browser acceptance. Does not launch a browser or manufacture claims.
 *
 * page adapter (Ego and CI must implement the same semantics):
 *   goto, reload, click, fill, selectOption, focus, press, evaluate,
 *   waitForFunction(fn,arg), setViewport({width,height}),
 *   setColorScheme('light'|'dark'), screenshot() -> retained artifact reference,
 *   diagnostics() -> {events:[{id,kind,documentId,url,message,status?,requestId?}]}.
 * diagnostics MUST collect console errors, page errors, failed requests and HTTP
 * errors from BEFORE the initial goto, including unloaded documents. The adapter
 * assigns document IDs; this module never drops errors on a navigation boundary.
 * Adaptation must not reduce assertions. No locator(), route() or indexed selector chains,
 * synthetic DOM clicks or mock responses are used here.
 *
 * fixture (all operations target an ISOLATED acceptance deployment):
 * admin:{username,password,subject}; projectId, scope, clientId, subject;
 * reauthenticationSteps: real host logout/change-account control steps (same action format),
 * used whenever /ui/ does not already display the production login form.
 * The supplied clientId MUST be a non-UI test client: receipt UI membership may
 * never be temporarily disapproved, because that would prevent recovery login.
 * edit:{description,namespace,actions:[...]}; unknownScope;
 * optional reconciliationEdits:[{scope,description?,namespace?,actions?}] provides
 * approved first-grant corrections for multiple out-of-bound scopes, applied via
 * real fields before ONE atomic reconciliation save (never individual PUTs).
 * preferences:{path, themes:{light:steps,dark:steps,'dark-2':steps,system:steps},
 *   locales:{en:steps,...all 13}}; each step is {action:'click'|'fill'|'selectOption',
 *   selector:<CSS or terminal :has-text>, value?}. These steps operate the real
 *   host preference controls, not localStorage. Selectors must be obtained from
 *   the deployed DOM, not invented by an adapter.
 * localeText:{locale:{projects,scopes,clients,assignments,saveLocal,search}};
 * references:{mcpPath,namespacesPath,flowsPath,tab,button,search,tableHeader,tableCell};
 * pagination:{projects:<known second-page project ID>,scopes:<scope>,
 *   clients:<client ID>,assignments:<subject>}; all four directories MUST exceed
 *   25 entries (25 is the UI's initial display page size).
 * filters:{projects|scopes|clients|assignments:{equals|contains|and|or:{steps,expectedIds:[...]}}};
 * steps use the same real DOM actions as preferences and must clear prior filters.
 * optional loginFinalPath (default /ui/main/dashboards), tenant (default main),
 * apiBase, expectedRequestErrors:[{case,method,status,path,code?}],
 * expectedBrowserErrors:[{case,kind,url,message,documentId}]. Exact exceptions
 * only; all observations remain in the report. Passwords/tokens are never reported.
 *
 * report.ui (also report.rows) contains checker-compatible rows. A theme row is
 * {case:'theme-language',theme,locale,passed,computedStyles,translation,
 * keyboardFocus,noHorizontalOverflow}; flags are set only after real assertions.
 * record(report) is called after every case and again in finally. The caller
 * persists it even on failure; no case is marked skipped. Missing adapter/fixture
 * inputs fail explicitly. Unexecuted cases remain not_run and prevent completion.
 */
export const applicationProjectUiLocales = Object.freeze(['en','de','es','fr','hi','it','ja','ko','pl','pt','pt_BR','ru','zh_CN'])
export const applicationProjectUiThemes = Object.freeze(['light','dark','dark-2','system'])
const clone = value => JSON.parse(JSON.stringify(value))
const key = value => '~' + Buffer.from(value, 'utf8').toString('base64url')
const quote = value => JSON.stringify(String(value))
const canonical = value => Array.isArray(value) ? value.map(canonical).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([name,item]) => [name,canonical(item)])) : value
const exact = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
const ensure = (value, message) => {if (!value) throw new Error(message)}

export function sanitizeApplicationProjectUiEvidence(value, secrets = []) {
  const sanitizeText = input => {
    let text = input
    for (const secret of secrets) if (typeof secret === 'string' && secret.length) text = text.replaceAll(secret,'[redacted]')
    return text.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted-jwt]')
      .replace(/((?:[?&#]|%3[fF]|%26)(?:from|code|state|access_token|id_token|refresh_token|password|client_secret)(?:=|%3[dD]))[^\s&#"'<>]*/gi,'$1[redacted]')
      .replace(/Bearer\s+[^\s,;]+/gi,'Bearer [redacted]')
  }
  if (typeof value === 'string') return sanitizeText(value)
  if (Array.isArray(value)) return value.map(item => sanitizeApplicationProjectUiEvidence(item,secrets))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name,item]) => [name,/^(?:interaction|nonce|csrf|code_verifier|password|client_secret|access_token|id_token|refresh_token|authorization)$/i.test(name) && (typeof item === 'string' || typeof item === 'number') ? '[redacted]' : sanitizeApplicationProjectUiEvidence(item,secrets)]))
  return value
}

export async function runApplicationProjectUi(page, base, fixture, record) {
  const planned = ['preconditions','production-ui-login-canonical-path','menu-access-management','ui-initial-english-preference',
    ...['projects','scopes','clients','assignments'].map(section => 'actual-content-' + section),
    'ui-role-grant-edit-refresh','ui-empty-grants-no-policy-change','ui-unknown-scope-no-policy-change','ui-412-conflict-no-policy-change',
    'ui-client-membership-approval','ui-subject-grant-revoke','ui-loading-transition',
    ...applicationProjectUiThemes.flatMap(theme => applicationProjectUiLocales.map(locale => 'ui-theme-language-' + theme + '-' + locale)),
    'ui-theme-colors-are-distinct',...['projects','scopes','clients','assignments'].map(section => 'ui-search-filter-pagination-' + section),
    ...['projects','scopes','clients','assignments'].flatMap(section => ['equals','contains','and','or'].map(operator => 'ui-filter-' + section + '-' + operator)),
    'ui-narrow-and-keyboard-focus','console-page-request-errors-have-explicit-sources']
  const report = {version:1, completed:false, planned, rows:[], documents:[], diagnostics:[], requests:[], artifacts:[], failure:null}
  const diagnostic = fixture?.diagnostic ?? null
  if (diagnostic) report.nonFinal = true
  let diagnosticStarted = !diagnostic?.startAt
  // The composition runner can merge report.ui directly into its final ui section.
  report.ui = report.rows
  let activeCase = 'preconditions'
  const diagnosticCursor = new Set()
  const restores = []
  let targetSequence = 0
  let policyOriginal = null
  let mutationStarted = false
  const tenant = fixture?.tenant ?? 'main'
  const origin = new URL(base)
  const prefix = origin.pathname.replace(/\/$/, '')
  const apiBase = fixture?.apiBase ?? prefix + '/api/v1/' + encodeURIComponent(tenant)
  const api = apiBase + '/extensions/rbac'
  const ui = prefix + '/ui/' + encodeURIComponent(tenant)
  const project = 'projects/' + encodeURIComponent(fixture?.projectId ?? '')
  const scopePath = project + '/scopes/' + key(fixture?.scope ?? '')
  const localPath = '/projects/' + encodeURIComponent(fixture?.projectId ?? '') + '/scopes/' + key(fixture?.scope ?? '')
  const scopeSection = 'section[aria-labelledby="local-scope-title"]'
  const rootSelector = '[data-test="extension-container"]'
  const url = path => new URL(path, origin.origin).href
  const sanitize = value => sanitizeApplicationProjectUiEvidence(value,[fixture?.admin?.password,fixture?.zeroAccount?.password])
  const errorText = error => sanitize(String(error?.message ?? error))
  const persist = async () => {if (typeof record === 'function') await record(sanitize(clone(report)))}
  const documentState = async () => {
    const state = await page.evaluate(() => ({url:location.href,path:location.pathname,timeOrigin:performance.timeOrigin,title:document.title}))
    const diagnostics = await page.diagnostics()
    const document = diagnostics.documents?.findLast(item => item.frameId === diagnostics.topFrame)
    ensure(typeof document?.id === 'string' && document.id,'adapter diagnostics is missing the current top-frame document identity')
    return sanitize({...state,documentId:document.id})
  }
  async function collectDiagnostics() {
    const result = await page.diagnostics()
    ensure(Array.isArray(result?.events), 'adapter diagnostics must return events from all document generations')
    for (const event of result.events) {
      ensure(event.id && event.documentId && event.url && event.kind, 'diagnostic is missing source document or event identity')
      if (diagnosticCursor.has(event.id)) continue
      diagnosticCursor.add(event.id)
      const matched = (fixture.expectedBrowserErrors ?? []).some(rule => rule.case === activeCase && rule.kind === event.kind && rule.url === event.url && rule.message === event.message && rule.documentId === event.documentId)
      report.diagnostics.push({...event, case:activeCase, expected:matched})
    }
  }
  async function run(name, operation) {
    if (name === diagnostic?.startAt) diagnosticStarted = true
    if (!diagnosticStarted && !['preconditions','production-ui-login-canonical-path','menu-access-management','ui-initial-english-preference'].includes(name)) return
    activeCase = name
    const combination = name.match(/^ui-theme-language-(light|dark-2|dark|system)-(.+)$/)
    const row = {name,case:combination ? 'theme-language' : name,...(combination ? {theme:combination[1],locale:combination[2]} : {}),passed:false,status:'running',startedAt:new Date().toISOString()}
    report.rows.push(row)
    try {
      row.source = await documentState()
      const evidence = await operation()
      await collectDiagnostics()
      row.status = 'passed'
      row.passed = true
      row.evidence = evidence ?? {}
      if (combination) {
        for (const field of ['computedStyles','translation','keyboardFocus','noHorizontalOverflow']) row[field] = evidence[field]
      }
    } catch (error) {
      row.status = 'failed'
      row.error = errorText(error)
      try {row.document = await documentState(); await collectDiagnostics()} catch (captureError) {row.captureError = errorText(captureError)}
      if (!diagnostic?.continueAfterFailure || ['preconditions','production-ui-login-canonical-path','menu-access-management','ui-initial-english-preference'].includes(name)) throw error
      report.failure ??= {case:name,message:errorText(error)}
      try {row.failureArtifact = await page.screenshot()} catch (captureError) {row.artifactCaptureError = errorText(captureError)}
    } finally {row.finishedAt = new Date().toISOString(); await persist()}
  }
  async function request(path, method = 'GET', body, revision) {
    const result = await page.evaluate(async ({path,method,body,revision}) => {
      const headers = {Accept:'application/json'}
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      if (revision !== undefined) headers['If-Match'] = '"' + revision + '"'
      if (method !== 'GET') {
        const csrf = document.querySelector('meta[name="csrf-token"]')?.content
        if (!csrf) throw new Error('host CSRF token missing')
        headers['X-CSRF-TOKEN'] = csrf
      }
      const response = await fetch(path, {method,headers,credentials:'same-origin',redirect:'error',...(body === undefined ? {} : {body:JSON.stringify(body)})})
      const data = await response.json().catch(() => null)
      return {ok:response.ok,status:response.status,body:data,url:response.url,source:{url:location.href,path:location.pathname,timeOrigin:performance.timeOrigin}}
    }, {path:api + path,method,body,revision})
    const source = await documentState()
    ensure(source.timeOrigin === result.source.timeOrigin,'request source document changed before attribution')
    report.requests.push({case:activeCase,method,path:api + path,status:result.status,source:{...result.source,documentId:source.documentId},code:result.body?.code})
    return result
  }
  async function readPolicy() {
    const response = await request('/policy')
    ensure(response.ok && response.body?.policy?.schemaVersion === 2, 'same-cookie policy read failed or returned legacy schema')
    return response.body
  }
  async function extensionState() {
    return page.evaluate(() => {
      const host = document.querySelector('[data-test="extension-container"]')
      const root = host?.shadowRoot
      return {path:location.pathname,lang:root?.querySelector('.rbac-page')?.lang,hostClasses:host?.className,
        busy:root?.querySelector('main')?.getAttribute('aria-busy'),text:root?.textContent,
        errors:[...(root?.querySelectorAll('[role="alert"]') ?? [])].filter(item => !item.matches('[data-test="reconciliation-required"]')).map(item => item.textContent.trim()),
        reconciliation:root?.querySelector('[data-test="reconciliation-required"]')?.textContent.trim(),
        rows:[...(root?.querySelectorAll('tbody tr') ?? [])].map(item => item.textContent.trim()),
        search:root?.querySelector('.ks-search input')?.value}
    })
  }
  async function stable(path) {
    await page.waitForFunction(({path,rootSelector}) => {
      const root = document.querySelector(rootSelector)?.shadowRoot
      return location.pathname === path && root?.querySelector('main')?.getAttribute('aria-busy') === 'false' && Boolean(root.querySelector('.kel-tabs'))
    }, {path,rootSelector})
    await page.waitForFunction(({path,rootSelector}) => {
      const root = document.querySelector(rootSelector)?.shadowRoot
      const table = root?.querySelector('.management-data-table')
      if (!table) return true
      const rows = root.querySelectorAll('tbody tr').length
      const pagination = root.querySelector('.kel-pagination')
      const text = pagination?.querySelector('.kel-pagination__total')?.textContent ?? ''
      const total = Number(text.match(/\d+/)?.[0])
      const sizeInput = pagination?.querySelector('.kel-pagination__sizes input')
      const sizeText = sizeInput?.value || pagination?.querySelector('.kel-pagination__sizes')?.textContent || ''
      const size = Number(sizeText.match(/\d+/)?.[0])
      const current = Number(pagination?.querySelector('.kel-pager .is-active')?.textContent)
      if (Number.isFinite(total) && size > 0 && current > 0) return rows === Math.min(size,Math.max(0,total-(current-1)*size))
      return rows > 0 || Boolean(root.querySelector('.kel-empty,.kel-table__empty-block'))
    }, {path,rootSelector})
    const state = await extensionState()
    ensure(!state.errors.length, 'stable extension contains an error: ' + state.errors.join('; '))
    return state
  }
  async function open(path) {
    await page.goto(url(ui + '/extensions/rbac/' + path))
    return stable(ui + '/extensions/rbac/' + path)
  }
  async function clickText(selector, text) {await page.click(selector + ':has-text(' + quote(text) + ')')}
  async function markTarget(selector,index) {
    ensure(Number.isInteger(index) && index >= 0,'invalid DOM target index')
    const token = 'application-project-' + (++targetSequence)
    await page.evaluate(({selector,index,token}) => {
      const root = document.querySelector('[data-test="extension-container"]')?.shadowRoot
      if (!root) throw new Error('extension DOM not available for unique target')
      for (const old of root.querySelectorAll('[data-application-project-ui-target]')) old.removeAttribute('data-application-project-ui-target')
      const target = [...root.querySelectorAll(selector)][index]
      if (!target || !target.getClientRects().length || target.disabled) throw new Error('actual DOM target is absent or not interactive')
      // Locator annotation only: do not dispatch input, change or click events.
      target.setAttribute('data-application-project-ui-target',token)
      if (root.querySelectorAll('[data-application-project-ui-target="' + token + '"]').length !== 1) throw new Error('DOM target annotation is not unique')
    },{selector,index,token})
    return '[data-application-project-ui-target=' + quote(token) + ']'
  }
  async function realSteps(steps) {
    ensure(Array.isArray(steps) && steps.length,'real UI action steps are required')
    for (const step of steps) {
      ensure(['click','fill','selectOption'].includes(step.action) && typeof step.selector === 'string','unsupported real UI step')
      ensure(!step.selector.includes('>>') && !/locator\(|getByRole\(|:nth-match\(/.test(step.selector),'selector must use common CSS or terminal has-text')
      if (step.action === 'click') await page.click(step.selector)
      else await page[step.action](step.selector,step.value)
    }
  }
  async function productionSignIn(reason) {
    const pathValue = value => String(value).replace(/^C:\\workspace\\files\\ui/, '') || '/'
    const before = await documentState()
    await page.goto(url(prefix + '/ui/'))
    await page.waitForFunction(() => document.readyState === 'complete' && (Boolean(document.querySelector('input[name="username"]')) || location.pathname.includes('/ui/')))
    if (!await page.evaluate(() => Boolean(document.querySelector('input[name="username"]')))) {
      if (fixture.reauthenticationPath) {
        ensure(fixture.reauthenticationPath === '/ui/access-denied','reauthentication must use the published denial page')
        await page.goto(url(prefix + fixture.reauthenticationPath))
        await page.waitForFunction(() => Boolean(document.querySelector('input[name="username"]')) || Boolean(document.querySelector('[data-testid="return-to-login"]')))
      }
      if (!await page.evaluate(() => Boolean(document.querySelector('input[name="username"]')))) await realSteps(fixture.reauthenticationSteps)
    }
    await page.waitForFunction(() => Boolean(document.querySelector('input[name="username"]')) && Boolean(document.querySelector('input[name="password"]')))
    await page.fill('input[name="username"]',fixture.admin.username)
    await page.fill('input[name="password"]',fixture.admin.password)
    await page.click('button[type="submit"]')
    const accepted = (fixture.reauthenticationFinalPaths ?? [fixture.loginFinalPath ?? '/ui/main/dashboards','/ui/access-denied']).map(path => prefix + pathValue(path))
    await page.waitForFunction(accepted => accepted.includes(location.pathname) && !document.querySelector('input[name="password"]'),accepted)
    const final = await documentState()
    // Record the actual final path BEFORE navigating to a management page.
    const caps = await request('/capabilities')
    ensure(caps.ok && caps.body.allowed && caps.body.subject === fixture.admin.subject,'new production sign-in did not restore a trusted management identity')
    const evidence = {reason,before,final,subject:caps.body.subject,needsReconciliation:caps.body.needsReconciliation === true,identityManagement:caps.body.identityManagement,localPolicyManagement:caps.body.localPolicyManagement}
    report.rows.push({case:'production-reauthentication',name:'production-reauthentication-' + report.rows.length,passed:true,status:'passed',evidence})
    return caps.body
  }
  async function saveDirectoryForm(selector,path) {
    const before = await documentState()
    const previous = new Set((await page.diagnostics()).events.map(event => event.id))
    await page.click(selector)
    const deadline = Date.now() + 30000
    let response
    while (Date.now() < deadline) {
      const events = (await page.diagnostics()).events
      response = events.find(event => !previous.has(event.id) && ['http-response','http-error'].includes(event.kind) && event.documentId === before.documentId && event.method === 'PUT' && event.url === url(api + path))
      if (response) break
      await new Promise(resolve => setTimeout(resolve,100))
    }
    ensure(response,'native directory save produced no attributable HTTP response')
    report.requests.push({case:activeCase,method:'PUT',path:api + path,status:response.status,requestId:response.requestId,source:before,transport:'native-ui'})
    ensure(response.status >= 200 && response.status < 300,'native directory save failed: HTTP ' + response.status + ' ' + path)
    await page.waitForFunction(() => {
      if (location.pathname === '/' + ['ui','access-denied'].join('/')) return true
      return document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy') === 'false'
    })
    if (await page.evaluate(() => location.pathname === '/' + ['ui','access-denied'].join('/'))) {
      return {status:response.status,requestId:response.requestId,source:before,reauthenticationRequired:true,savedResult:'directory mutation redirected to published access-denied',redirected:true}
    }
    const state = await page.evaluate(() => {
      const root = document.querySelector('[data-test="extension-container"]').shadowRoot
      return {reauthenticationRequired:Boolean(root.querySelector('[data-test="reauthenticate"]')),savedResult:root.querySelector('[data-test="saved-result"]')?.textContent,errors:[...root.querySelectorAll('[role="alert"]')].filter(node => !node.querySelector('[data-test="reauthenticate"]')).map(node => node.textContent.trim())}
    })
    ensure(!state.errors.length,'directory save contains an error: ' + state.errors.join('; '))
    ensure(state.reauthenticationRequired && state.savedResult,'successful identity save must expose the saved result and require production reauthentication')
    return {status:response.status,requestId:response.requestId,source:before,...state}
  }
  async function afterDirectoryMutation(reason) {
    const stale = await request('/capabilities')
    ensure([401,403].includes(stale.status),'directory mutation failed to invalidate the old authenticated identity')
    const caps = await productionSignIn(reason)
    if (caps.needsReconciliation === true) {
      ensure(caps.localPolicyManagement === true && caps.identityManagement === false,'stale local binding recovery must expose only current LOCAL_POLICY.MANAGE')
      const recoveryPath = '/projects/' + encodeURIComponent(fixture.projectId) + '/reconciliation'
      const projection = await request(recoveryPath)
      ensure(projection.ok && projection.body.project.id === fixture.projectId,'target-only reconciliation projection unavailable')
      const {project:localProject,policyRevision,directoryRevision,upperBound} = projection.body
      ensure(Number.isSafeInteger(policyRevision) && Number.isSafeInteger(directoryRevision),'reconciliation revisions missing')
      ensure(exact(Object.keys(upperBound),['project','scopes']),'recovery projection leaked or omitted directory sections')
      const candidate = clone(localProject)
      candidate.directoryRevision = directoryRevision
      for (const scope of Object.values(candidate.scopes)) {
        scope.managementGrants ??= []
        for (const grant of scope.managementGrants) grant.projectIds ??= []
      }
      await open(project + '/reconciliation')
      const locked = await page.evaluate(() => {
        const root = document.querySelector('[data-test="extension-container"]').shadowRoot
        const identity = root.querySelector('[data-test="save-identity-scope"]')
        const save = root.querySelector('[data-test="save-project-reconciliation"]')
        return {identityDisabled:!identity || identity.disabled,saveDisabled:save?.disabled,scopes:[...root.querySelectorAll('[data-reconciliation-scope]')].map(section => section.getAttribute('data-reconciliation-scope')),
          displayedRevision:root.querySelector('[data-test="reconciliation-policy-revision"]')?.textContent.trim(),targetRevision:root.querySelector('[data-test="reconciliation-target-revision"]')?.textContent.trim(),
          inputRevision:root.querySelector('[name="reconciliation-directory-revision"]')?.value,upper:root.querySelector('[data-test="reconciliation-upper"]')?.textContent}
      })
      ensure(locked.identityDisabled && locked.saveDisabled,'recovery opens identity CRUD or enables saving without approval')
      ensure(exact(locked.scopes,Object.keys(localProject.scopes)),'complete project scope review is incomplete')
      ensure(Number(locked.displayedRevision) === policyRevision && Number(locked.targetRevision) === directoryRevision,'recovery page displays incorrect revisions')
      ensure(Number(locked.inputRevision) === localProject.directoryRevision,'UI silently copied the latest revision before explicit review')
      ensure(exact(JSON.parse(locked.upper),upperBound),'read-only upper bound differs from target-only response')
      for (const edit of fixture.reconciliationEdits ?? []) {
        const scope = candidate.scopes[edit.scope]
        ensure(scope,'reconciliation edit references a missing local scope')
        const section = '[data-reconciliation-scope=' + quote(edit.scope) + ']'
        if (edit.description !== undefined) {
          await page.fill(section + ' [name="reconciliation-scope-description"]',edit.description)
          scope.description = edit.description
        }
        if (edit.namespace !== undefined) {
          ensure(scope.grants[0]?.scope === 'NAMESPACE','namespace edit requires an actual first namespace grant')
          await page.fill(await markTarget(section + ' [name="grant-namespace"]',0),edit.namespace)
          scope.grants[0].namespace = edit.namespace
        }
        if (edit.actions) {
          ensure(scope.grants[0],'action edit requires a first resource grant')
          for (const action of ['READ','LIST','CREATE','UPDATE','DELETE','EXECUTE','ACCESS_OUTPUTS']) {
            const selector = section + ' .grant input[type="checkbox"][value=' + quote(action) + ']'
            const state = await page.evaluate(({section,action}) => {
              const root = document.querySelector('[data-test="extension-container"]').shadowRoot
              const element = root.querySelector(section + ' .grant input[value="' + action + '"]')
              return {exists:!!element,checked:element?.checked}
            },{section,action})
            if (state.checked !== edit.actions.includes(action)) {
              ensure(state.exists,'requested action is not available in the current actual resource editor')
              await page.click(await markTarget(selector,0))
            }
          }
          scope.grants[0].actions = [...edit.actions]
        }
      }
      await page.fill('[name="reconciliation-directory-revision"]',String(directoryRevision))
      await page.click('[data-test="approve-project-reconciliation"]')
      await page.click('[data-test="save-project-reconciliation"]')
      await page.waitForFunction(() => {
        if (location.pathname === '/' + ['ui','access-denied'].join('/')) return true
        return document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy') === 'false'
      })
      const confirmed = await readPolicy()
      const saved = confirmed.policy.applicationProjects[fixture.projectId]
      ensure(confirmed.revision > policyRevision && saved.directoryRevision === directoryRevision,'atomic recovery did not save the global and latest directory revisions')
      ensure(exact(saved.scopes,candidate.scopes),'atomic recovery did not persist all approved complete scopes')
      ensure(saved.issuer === candidate.issuer && exact(saved.audiences,candidate.audiences) && saved.enabled === candidate.enabled,'atomic recovery unexpectedly changed project metadata')
      const trusted = await productionSignIn(reason + ': after atomic complete-project reconciliation')
      ensure(trusted.needsReconciliation !== true && trusted.identityManagement === true,'identity administration resumed before a successful complete-project save and new sign-in')
      report.rows.push({case:'directory-reconciliation',name:'directory-reconciliation-' + report.rows.length,passed:true,status:'passed',evidence:{reason,policyRevision,confirmedRevision:confirmed.revision,directoryRevision,completeScopes:saved.scopes,lockState:locked,reauthenticated:true,endpoint:recoveryPath,atomic:true}})
    }
    return caps
  }

  async function openRecord(path, identifier) {
    await open(path)
    await page.fill('.ks-search input', identifier)
    await page.waitForFunction(identifier => {
      const root = document.querySelector('[data-test="extension-container"]')?.shadowRoot
      const rows=[...(root?.querySelectorAll('tbody tr') ?? [])]
      return rows.length===1&&[...rows[0].querySelectorAll('td')].some(cell=>cell.textContent.trim()===identifier)&&root.querySelectorAll('tbody button').length===1
    }, identifier)
    const target = await page.evaluate(identifier => {
      const root = document.querySelector('[data-test="extension-container"]').shadowRoot
      const rows = [...root.querySelectorAll('tbody tr')]
      const matching = rows.filter(row => [...row.querySelectorAll('td')].some(cell => cell.textContent.trim() === identifier))
      if (matching.length !== 1) throw new Error('record locator must match one exact table cell')
      const button = matching[0].querySelector('button')
      if (!button || button.disabled) throw new Error('record action is not interactive')
      return {index:[...root.querySelectorAll('tbody button')].indexOf(button),name:button.textContent.trim()}
    }, identifier)
    await page.focus('tbody button')
    await page.waitForFunction(() => {
      const root = document.querySelector('[data-test="extension-container"]')?.shadowRoot
      const button = root?.querySelector('tbody button')
      if (!button || root.activeElement !== button) return false
      const rect = button.getBoundingClientRect()
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
    })
    await page.click('tbody button')
    return target
  }
  async function preference(steps) {
    ensure(Array.isArray(steps) && steps.length, 'missing real host preference steps')
    await page.goto(url(prefix + fixture.preferences.path))
    for (const step of steps) {
      ensure(['click','fill','selectOption'].includes(step.action) && typeof step.selector === 'string', 'unsupported preference action')
      ensure(!step.selector.includes('>>') && !/locator\(|getByRole\(|:nth-match\(/.test(step.selector), 'preference must use supported CSS or terminal has-text')
      if (step.action === 'click') await page.click(step.selector)
      else await page[step.action](step.selector, step.value)
    }
  }
  async function styles(selector, shadow = false) {
    await page.waitForFunction(({selector,shadow}) => Boolean((shadow ? document.querySelector('[data-test="extension-container"]')?.shadowRoot : document)?.querySelector(selector)),{selector,shadow})
    return page.evaluate(({selector,shadow}) => {
      const root = shadow ? document.querySelector('[data-test="extension-container"]')?.shadowRoot : document
      const element = root?.querySelector(selector)
      if (!element) throw new Error('actual reference DOM missing: ' + selector)
      const style = getComputedStyle(element)
      const box = element.getBoundingClientRect()
      return {fontSize:style.fontSize,fontWeight:style.fontWeight,radius:style.borderRadius,color:style.color,background:style.backgroundColor,
        borderBottomWidth:style.borderBottomWidth,borderBottomStyle:style.borderBottomStyle,width:box.width,height:box.height,display:style.display}
    }, {selector,shadow})
  }
  async function snapshot(name) {
    const artifact = await page.screenshot()
    ensure(artifact, 'screenshot adapter must return a retained artifact reference')
    report.artifacts.push({case:activeCase,name,artifact,source:await documentState()})
  }
  async function reloadScope() {await page.reload(); return stable(ui + '/extensions/rbac/' + scopePath)}
  async function rejectionState(before, expectedStatus) {
    await page.waitForFunction(() => {
      const root = document.querySelector('[data-test="extension-container"]')?.shadowRoot
      return root?.querySelector('main')?.getAttribute('aria-busy') === 'false' && Boolean(root.querySelector('[role="alert"]'))
    })
    const after = await readPolicy()
    ensure(exact(before,after), 'rejected UI save changed policy/revision')
    const state = await extensionState()
    if (expectedStatus === 412) {
      await collectDiagnostics()
      ensure(report.diagnostics.some(event => event.case === activeCase && event.status === 412 && event.url === url(api + localPath)), 'no source-attributed HTTP 412 observed for the stale UI write')
    }
    return {errors:state.errors,policyRevision:after.revision,...(expectedStatus === 412 ? {observedHttpStatus:412} : {rejectedWithoutChange:true})}
  }
  try {
    await run('preconditions', async () => {
      if (diagnostic) {
        ensure(diagnostic.nonFinal === true && typeof diagnostic.startAt === 'string' && planned.includes(diagnostic.startAt),'diagnostic start requires explicit nonFinal and a planned case')
        ensure(typeof diagnostic.continueAfterFailure === 'boolean','diagnostic continuation must be explicit')
      }
      for (const method of ['goto','reload','click','fill','selectOption','focus','press','evaluate','waitForFunction','setViewport','setColorScheme','screenshot','diagnostics']) ensure(typeof page[method] === 'function', 'missing shared adapter method: ' + method)
      ensure(typeof record === 'function','record callback is required')
      for (const name of ['projectId','scope','clientId','subject','unknownScope']) ensure(typeof fixture[name] === 'string' && fixture[name], 'missing fixture ' + name)
      ensure(fixture.admin?.username && fixture.admin?.password && fixture.admin?.subject,'real admin credentials required')
      ensure(fixture.subject !== fixture.admin.subject,'subject grant/revoke test must not remove the testing administrator’s own authority')
      ensure(Array.isArray(fixture.reauthenticationSteps) && fixture.reauthenticationSteps.length,'real production reauthentication steps are required after every directory epoch change')
      ensure(fixture.edit?.description && fixture.edit?.namespace && fixture.edit?.actions?.length, 'explicit scope changes required')
      for (const locale of applicationProjectUiLocales) {
        ensure(fixture.preferences?.locales?.[locale]?.length, 'missing real locale preference steps: ' + locale)
        for (const label of ['projects','scopes','clients','assignments','saveLocal','search']) ensure(fixture.localeText?.[locale]?.[label], 'missing translated expected text: ' + locale + '/' + label)
      }
      for (const theme of applicationProjectUiThemes) ensure(fixture.preferences?.themes?.[theme]?.length,'missing real theme preference steps: ' + theme)
      for (const list of ['projects','scopes','clients','assignments']) {
        ensure(fixture.pagination?.[list], 'missing second-page record: ' + list)
        for (const operator of ['equals','contains','and','or']) {
          const plan = fixture.filters?.[list]?.[operator]
          ensure(plan?.steps?.length && Array.isArray(plan.expectedIds), 'missing real DOM filter plan: ' + list + '/' + operator)
        }
      }
      for (const name of ['mcpPath','namespacesPath','flowsPath','tab','button','search','tableHeader','tableCell']) ensure(fixture.references?.[name], 'missing actual DOM reference: ' + name)
      return {themes:applicationProjectUiThemes,locales:applicationProjectUiLocales,noSkips:true}
    })
    await run('production-ui-login-canonical-path', async () => {
      await page.goto(url(prefix + '/ui/'))
      await page.waitForFunction(() => Boolean(document.querySelector('input[name="username"]')) || location.pathname.includes('/ui/main/'))
      ensure(await page.evaluate(() => Boolean(document.querySelector('input[name="username"]'))), 'fresh anonymous browser session required to verify production login')
      await page.fill('input[name="username"]',fixture.admin.username)
      await page.fill('input[name="password"]',fixture.admin.password)
      await page.click('button[type="submit"]')
      const expected = prefix + (fixture.loginFinalPath ?? '/ui/main/dashboards')
      await page.waitForFunction(expected => location.pathname === expected && !document.querySelector('input[name="password"]') && document.querySelectorAll('a[href]').length > 3,expected)
      // No goto of a corrected business route is permitted before this assertion.
      const current = await documentState()
      ensure(current.path === expected,'login ended at a noncanonical path')
      const caps = await request('/capabilities')
      ensure(caps.ok && caps.body.allowed && caps.body.subject === fixture.admin.subject,'authenticated subject differs from the supplied real admin')
      return {final:current,subject:caps.body.subject}
    })
    await run('menu-access-management', async () => {
      await page.waitForFunction(ui => [...document.querySelectorAll('a[href]')].some(item => new URL(item.href).pathname.startsWith(ui + '/extensions/rbac')) || document.querySelector('[data-test="extension-container"]'), ui)
      const sidebarCollapsed=await page.evaluate(()=>document.querySelector('#side-menu')?.classList.contains('is-collapsed')===true)
      if(sidebarCollapsed){
        await page.click('[data-testid="topnav-sidebar-toggle"]')
        await page.waitForFunction(()=>{const sidebar=document.querySelector('#side-menu');return sidebar&&!sidebar.classList.contains('is-collapsed')&&sidebar.getBoundingClientRect().width>100})
      }
      const menu = await page.evaluate(ui => {
        const link = [...document.querySelectorAll('a[href]')].find(item => new URL(item.href).pathname.startsWith(ui + '/extensions/rbac'))
        if (!link) throw new Error('Access management menu entry missing')
        const control = link.closest('.ks-sidebar-section')?.querySelector('button[aria-expanded]')
        const collapsed = link.closest('[aria-hidden="true"], [inert]') || control?.getAttribute('aria-expanded') === 'false' || !link.getClientRects().length
        const toggles = [...document.querySelectorAll('button[aria-expanded="false"]')].map(item => ({name:item.textContent.trim(),controls:item.getAttribute('aria-controls')}))
        return {href:link.getAttribute('href'),name:link.textContent.trim(),collapsed:Boolean(collapsed),sectionControl:control?{name:control.textContent.trim(),expanded:control.getAttribute('aria-expanded')}:null,toggles}
      },ui)
      if (menu.collapsed) {
        const toggle = menu.sectionControl??menu.toggles.find(item => /extensions/i.test(item.name))
        ensure(toggle,'collapsed extension menu has no discovered expansion control')
        await clickText('button[aria-expanded="false"]',toggle.name)
        await page.waitForFunction(href => [...document.querySelectorAll('a[href]')].some(link => link.getAttribute('href') === href && !link.closest('[inert], [aria-hidden="true"]') && link.closest('.ks-sidebar-section')?.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded') === 'true' && link.getClientRects().length > 0),menu.href)
      }
      await page.click('a[href=' + quote(menu.href) + ']')
      const state = await stable(ui + '/extensions/rbac/projects')
      ensure(state.rows.some(row => row.includes(fixture.projectId)),'menu-loaded project list does not contain the approved project')
      policyOriginal = await readPolicy()
      ensure(policyOriginal.policy.applicationProjects[fixture.projectId]?.scopes?.[fixture.scope], 'approved local scope missing')
      return {menu,final:state.path}
    })
    await run('ui-initial-english-preference', async () => {
      await preference(fixture.preferences.locales.en)
      const state = await open('projects')
      ensure(state.lang === 'en','host language preference did not select English')
      return {lang:state.lang}
    })
    for (const section of ['projects','scopes','clients','assignments']) {
      await run('actual-content-' + section, async () => {
        const path = section === 'projects' ? 'projects' : project + '/' + section
        const identifier = section === 'projects' ? fixture.projectId : section === 'scopes' ? fixture.scope : section === 'clients' ? fixture.clientId : fixture.subject
        await openRecord(path,identifier)
        const expected = section === 'projects' ? project : path + '/' + key(identifier)
        const state = await stable(ui + '/extensions/rbac/' + expected)
        ensure(state.text.includes(identifier),'detail lacks exact identity')
        if (section === 'scopes') ensure(await page.evaluate(() => Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('#identity-scope-title')) && Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('#local-scope-title'))),'scope does not show both independent sides')
        return {identifier,path:state.path}
      })
    }
    await run('ui-role-grant-edit-refresh', async () => {
      await open(scopePath)
      const before = await readPolicy()
      const prior = before.policy.applicationProjects[fixture.projectId].scopes[fixture.scope]
      ensure(prior.description !== fixture.edit.description,'test description must actually change')
      ensure(prior.grants.length > 0 && prior.grants[0].scope === 'NAMESPACE','test scope needs a normal namespace grant')
      ensure(prior.grants[0].namespace !== fixture.edit.namespace && !exact(prior.grants[0].actions,fixture.edit.actions),'namespace and action set must actually change')
      await page.fill('[name="local-scope-description"]',fixture.edit.description)
      await page.fill(await markTarget(scopeSection + ' [name="grant-namespace"]',0),fixture.edit.namespace)
      for (const action of ['READ','LIST','CREATE','UPDATE','DELETE','EXECUTE','ACCESS_OUTPUTS']) {
        const selector = scopeSection + ' .grant input[type="checkbox"][value=' + quote(action) + ']'
        const selected = await page.evaluate(action => document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('section[aria-labelledby="local-scope-title"] .grant input[value="' + action + '"]')?.checked,action)
        if (Boolean(selected) !== fixture.edit.actions.includes(action)) await page.click(await markTarget(selector,0))
      }
      mutationStarted = true
      await page.click('[data-test="save-local-scope"]')
      await page.waitForFunction(() => document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy') === 'false')
      const after = await readPolicy()
      const saved = after.policy.applicationProjects[fixture.projectId].scopes[fixture.scope]
      ensure(after.revision > before.revision && saved.description === fixture.edit.description && saved.grants[0].namespace === fixture.edit.namespace && exact([...saved.grants[0].actions].sort(),[...fixture.edit.actions].sort()),'same-cookie persisted scope does not match actual edits')
      await reloadScope()
      const displayed = await page.evaluate(() => {
        const root = document.querySelector('[data-test="extension-container"]').shadowRoot
        return {description:root.querySelector('[name="local-scope-description"]').value,namespace:root.querySelector('[name="grant-namespace"]').value,actions:[...root.querySelectorAll('section[aria-labelledby="local-scope-title"] .grant input[value]:checked')].map(input => input.value)}
      })
      ensure(displayed.description === fixture.edit.description && displayed.namespace === fixture.edit.namespace && fixture.edit.actions.every(action => displayed.actions.includes(action)),'refresh lost persisted scope edits')
      return {beforeRevision:before.revision,afterRevision:after.revision,displayed}
    })
    await run('ui-empty-grants-no-policy-change', async () => {
      await open(scopePath)
      const before = await readPolicy()
      while (await page.evaluate(() => document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('section[aria-labelledby="local-scope-title"] .grant').length > 0)) {
        const target = await page.evaluate(() => {
          const root = document.querySelector('[data-test="extension-container"]').shadowRoot
          const buttons = [...root.querySelector('section[aria-labelledby="local-scope-title"] .grant').querySelectorAll('button')]
          const button = buttons.at(-1)
          return [...root.querySelectorAll('button')].indexOf(button)
        })
        await page.click(await markTarget('button',target))
      }
      await page.click('[data-test="save-local-scope"]')
      return rejectionState(before,400)
    })
    await run('ui-unknown-scope-no-policy-change', async () => {
      await open(project + '/scopes/new')
      const before = await readPolicy()
      // This real UI writes the shared directory first, never silently creates an
      // unknown local binding. Submit the frozen local endpoint through the same
      // page cookie, then assert the page rejects an unknown detail route too.
      const rejected = await request('/projects/' + encodeURIComponent(fixture.projectId) + '/scopes','POST',{name:fixture.unknownScope,description:'Unknown scope rejection',enabled:true,grants:[{scope:'NAMESPACE',tenant:'main',namespace:fixture.edit.namespace,descendants:false,resource:'FLOW',actions:['READ'],ids:[],allIds:true}],managementGrants:[]},before.revision)
      ensure(!rejected.ok && [400,404,409].includes(rejected.status),'unknown local scope write was not rejected')
      ensure(exact(before,await readPolicy()),'unknown scope API rejection changed policy')
      await page.goto(url(ui + '/extensions/rbac/' + project + '/scopes/' + key(fixture.unknownScope)))
      await page.waitForFunction(() => Boolean(document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('[role="alert"]')))
      ensure(exact(before,await readPolicy()),'unknown detail route changed policy')
      return {apiStatus:rejected.status,code:rejected.body?.code,pageErrors:(await extensionState()).errors,operation:'unknown local API plus real detail route; UI has no arbitrary local scope selector'}
    })
    await run('ui-412-conflict-no-policy-change', async () => {
      await open(scopePath)
      const before = await readPolicy()
      await page.fill('[name="local-scope-description"]',fixture.edit.description + ' stale browser edit')
      const current = before.policy.applicationProjects[fixture.projectId].scopes[fixture.scope]
      const concurrent = await request(localPath,'PUT',{name:fixture.scope,...current,description:fixture.edit.description + ' concurrent accepted edit'},before.revision)
      ensure(concurrent.ok && concurrent.body.revision > before.revision,'public concurrent mutation did not advance revision')
      const baseline = await readPolicy()
      await page.click('[data-test="save-local-scope"]')
      const evidence = await rejectionState(baseline,412)
      const reload = await page.evaluate(() => {
        const root = document.querySelector('[data-test="extension-container"]').shadowRoot
        const button = [...root.querySelectorAll('.message button')].find(button => !button.disabled)
        if (!button) throw new Error('conflict reload action missing')
        return [...root.querySelectorAll('button')].indexOf(button)
      })
      await page.click(await markTarget('button',reload))
      await stable(ui + '/extensions/rbac/' + scopePath)
      ensure(await page.evaluate(expected => document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[name="local-scope-description"]').value === expected,concurrent.body.policy.applicationProjects[fixture.projectId].scopes[fixture.scope].description),'reload did not display concurrent saved data')
      return evidence
    })
    await run('ui-client-membership-approval', async () => {
      const memberPath = '/identity/projects/' + encodeURIComponent(fixture.projectId) + '/clients/' + key(fixture.clientId)
      const before = await request(memberPath)
      ensure(before.ok && typeof before.body.approved === 'boolean' && before.body.firstPartyUi === false,'fixture must use a non-UI test client so receipt-backed UI login remains available')
      const original = before.body
      restores.push({path:memberPath,kind:'client',original})
      await open(project + '/clients/' + key(fixture.clientId))
      await page.click('[data-test="member-approved"]')
      await saveDirectoryForm('[data-test="save-member"]',memberPath)
      await afterDirectoryMutation('client approval changed')
      const after = await request(memberPath)
      ensure(after.ok && after.body.firstPartyUi === false && after.body.approved === !original.approved && after.body.revision > original.revision,'client approval form did not persist changed approval')
      await open(project + '/clients/' + key(fixture.clientId))
      await page.reload()
      await stable(ui + '/extensions/rbac/' + project + '/clients/' + key(fixture.clientId))
      ensure(await page.evaluate(expected => document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('form input[type="checkbox"]').checked === expected,after.body.approved),'client approval lost on refresh')
      // Restore approval before further business checks, through the actual form.
      await page.click('[data-test="member-approved"]')
      await saveDirectoryForm('[data-test="save-member"]',memberPath)
      await afterDirectoryMutation('client approval restored')
      ensure((await request(memberPath)).body.approved === original.approved,'client approval form could not restore approved state')
      return {before:original.approved,changed:after.body.approved,refreshVerified:true,restored:true}
    })
    await run('ui-subject-grant-revoke', async () => {
      const assignmentPath = '/identity/projects/' + encodeURIComponent(fixture.projectId) + '/assignments/detail?subject=' + encodeURIComponent(fixture.subject)
      const before = await request(assignmentPath)
      ensure(before.ok && before.body.projectScopes.includes(fixture.scope),'test subject must have the supplied project scope')
      const original = before.body
      restores.push({path:assignmentPath,kind:'assignment',original})
      await open(project + '/assignments/' + key(fixture.subject))
      const selector = 'form input[type="checkbox"][value=' + quote(fixture.scope) + ']'
      await page.click(selector)
      await saveDirectoryForm('[data-test="save-assignment"]',assignmentPath)
      await afterDirectoryMutation('subject scope revoked')
      const revoked = await request(assignmentPath)
      ensure(revoked.ok && !revoked.body.projectScopes.includes(fixture.scope) && revoked.body.revision > original.revision,'subject scope revocation did not persist')
      await open(project + '/assignments/' + key(fixture.subject))
      await page.reload()
      await stable(ui + '/extensions/rbac/' + project + '/assignments/' + key(fixture.subject))
      ensure(await page.evaluate(scope => !document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('form input[value="' + CSS.escape(scope) + '"]').checked,fixture.scope),'revoked scope was checked after refresh')
      await page.click(selector)
      await saveDirectoryForm('[data-test="save-assignment"]',assignmentPath)
      await afterDirectoryMutation('subject scope granted')
      const granted = await request(assignmentPath)
      ensure(granted.ok && granted.body.projectScopes.includes(fixture.scope),'subject grant form did not persist')
      return {subject:fixture.subject,revokedRevision:revoked.body.revision,grantedRevision:granted.body.revision,runtimeTokenRevocation:'requires the shared authentication/runtime cases; this row verifies identity persistence only'}
    })
    await run('ui-loading-transition', async () => {
      await open(project)
      await page.evaluate(() => {
        const root = document.querySelector('[data-test="extension-container"]').shadowRoot
        const state = {busy:false,document:{url:location.href,timeOrigin:performance.timeOrigin}}
        window.__applicationProjectUiLoading = state
        const observer = new MutationObserver(records => {
          if (records.some(record => record.type === 'attributes' && record.attributeName === 'aria-busy' && (record.oldValue === 'true' || record.target.getAttribute('aria-busy') === 'true'))) state.busy = true
        })
        observer.observe(root,{subtree:true,attributes:true,attributeOldValue:true,attributeFilter:['aria-busy']})
        state.stop = () => observer.disconnect()
      })
      await clickText('[role="tab"]','Project scopes')
      await stable(ui + '/extensions/rbac/' + project + '/scopes')
      const observation = await page.evaluate(() => {
        const state = window.__applicationProjectUiLoading
        state.stop()
        const value = {busy:state.busy,document:state.document}
        delete window.__applicationProjectUiLoading
        return value
      })
      ensure(observation.busy,'actual tab navigation did not expose a loading transition')
      return observation
    })
    // Full theme × locale matrix, with no adapter-specific reductions.
    const themeSnapshots = new Map()
    for (const theme of applicationProjectUiThemes) {
      for (const locale of applicationProjectUiLocales) {
        await run('ui-theme-language-' + theme + '-' + locale, async () => {
          await page.setViewport({width:1440,height:1000})
          await page.setColorScheme('light')
          await preference(fixture.preferences.themes[theme])
          await preference(fixture.preferences.locales[locale])
          const ref = fixture.references
          await page.goto(url(prefix + ref.mcpPath))
          const referenceTab = await styles(ref.tab)
          const referenceButton = await styles(ref.button)
          await page.goto(url(prefix + ref.namespacesPath))
          const referenceSearch = await styles(ref.search)
          // Namespaces is a tree; table assertions intentionally use Flows.
          await page.goto(url(prefix + ref.flowsPath))
          const referenceHeader = await styles(ref.tableHeader)
          const referenceCell = await styles(ref.tableCell)
          let state = await open(project + '/scopes')
          const expected = fixture.localeText[locale]
          const actualNavigation = await page.evaluate(() => [...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('[role="tab"]')].map(tab => tab.textContent.trim()))
          ensure(state.lang === locale.replaceAll('_','-'),'extension language differs from host preference')
          ensure([expected.projects,expected.scopes,expected.clients,expected.assignments].every(text => state.text.includes(text)),'actual translated navigation is absent')
          ensure(!/\b(?:undefined|null)\b/.test(state.text),'unresolved UI value rendered')
          const observed = {
            tab:await styles('.kel-tabs__item',true),
            button:await styles('button.kel-button:not(:disabled)',true),
            search:await styles('.ks-search input',true),
            header:await styles('th',true),cell:await styles('tbody td',true)
          }
          report.rows.at(-1).evidence = {theme,locale,computedStyles:observed,translation:{lang:state.lang,navigation:actualNavigation},references:{tab:referenceTab,button:referenceButton,search:referenceSearch,header:referenceHeader,cell:referenceCell},partial:true}
          for (const field of ['fontSize','fontWeight','radius']) ensure(observed.tab[field] === referenceTab[field],'MCP tab style mismatch: ' + field)
          for (const field of ['fontSize','radius']) ensure(observed.button[field] === referenceButton[field],'MCP button style mismatch: ' + field)
          ensure(observed.search.fontSize === referenceSearch.fontSize,'Namespaces search typography mismatch')
          ensure(observed.header.fontSize === referenceHeader.fontSize && observed.header.fontWeight === referenceHeader.fontWeight,'Flows header typography mismatch')
          ensure(observed.cell.fontSize === referenceCell.fontSize && observed.cell.borderBottomStyle === referenceCell.borderBottomStyle && observed.cell.borderBottomWidth === referenceCell.borderBottomWidth,'Flows row style mismatch')
          ensure(observed.header.color !== observed.header.background && observed.cell.color !== observed.cell.background,'table text colors equal their backgrounds')
          const input = await page.evaluate(() => {
            const root = document.querySelector('[data-test="extension-container"]').shadowRoot
            return root.querySelector('.ks-search input')?.getAttribute('placeholder')
          })
          ensure(input === expected.search,'search placeholder is not actually translated')
          await page.reload()
          state = await stable(ui + '/extensions/rbac/' + project + '/scopes')
          ensure(state.lang === locale.replaceAll('_','-') && state.text.includes(expected.scopes),'language preference did not survive refresh')
          if (locale === 'en') {
            themeSnapshots.set(theme,observed)
            await snapshot(theme + '-desktop')
          }
          if (theme === 'system') {
            const before = await styles('main',true)
            await page.setColorScheme('dark')
            await page.waitForFunction(() => document.querySelector('[data-test="extension-container"]')?.classList.contains('dark'))
            const dark = await styles('main',true)
            const colors = await styles('.rbac-page',true)
            ensure(before.color !== dark.color,'system theme did not follow emulated dark preference')
            ensure(colors.color !== colors.background,'system dark text is unreadable')
            await page.setColorScheme('light')
          } else {
            ensure(await page.evaluate(theme => {
              const host = document.querySelector('[data-test="extension-container"]')
              return theme === 'light' ? host.classList.contains('light') : theme === 'dark-2' ? host.classList.contains('dark') && host.classList.contains('dark-2') : host.classList.contains('dark') && !host.classList.contains('dark-2')
            },theme),'resolved theme classes do not match preference')
          }
          await open(scopePath)
          const actualSave = await page.evaluate(() => document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('[data-test="save-local-scope"]')?.textContent.trim())
          ensure(actualSave === expected.saveLocal,'scope save action is not translated')
          await page.focus('[name="local-scope-description"]')
          await page.press('[name="local-scope-description"]','Tab')
          const accessibility = await page.evaluate(() => {
            const host = document.querySelector('[data-test="extension-container"]')
            const root = host.shadowRoot
            const focused = root.activeElement
            const style = focused && getComputedStyle(focused)
            const box = root.querySelector('main').getBoundingClientRect()
            return {focus:{tag:focused?.tagName,name:focused?.getAttribute('name'),disabled:focused?.disabled,outline:style?.outlineStyle,outlineWidth:style?.outlineWidth},
              layout:{viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,mainLeft:box.left,mainRight:box.right},
              keyboardFocus:Boolean(focused && !focused.disabled && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0),
              noHorizontalOverflow:document.documentElement.scrollWidth <= innerWidth + 2 && box.left >= -2 && box.right <= innerWidth + 2}
          })
          ensure(accessibility.keyboardFocus,'keyboard focus is not visible for this theme/language combination')
          ensure(accessibility.noHorizontalOverflow,'horizontal overflow in this theme/language combination')
          return {theme,locale,computedStyles:observed,translation:{lang:state.lang,navigation:actualNavigation,searchPlaceholder:input,saveLocal:actualSave},
            keyboardFocus:accessibility.keyboardFocus,noHorizontalOverflow:accessibility.noHorizontalOverflow,accessibility,
            references:{tab:referenceTab,button:referenceButton,search:referenceSearch,header:referenceHeader,cell:referenceCell},refreshed:true}
        })
      }
    }
    await run('ui-theme-colors-are-distinct', async () => {
      const light = themeSnapshots.get('light')
      const dark = themeSnapshots.get('dark')
      const dark2 = themeSnapshots.get('dark-2')
      ensure(light && dark && dark2,'theme matrix did not collect all theme evidence')
      ensure(light.header.background !== dark.header.background && light.cell.color !== dark.cell.color,'light and dark did not change actual table colors')
      ensure(dark.header.background !== dark2.header.background || dark.cell.color !== dark2.cell.color,'dark-2 did not produce distinct computed table colors')
      return {light,dark,dark2}
    })
    await preference(fixture.preferences.locales.en)
    await preference(fixture.preferences.themes.light)
    for (const section of ['projects','scopes','clients','assignments']) {
      await run('ui-search-filter-pagination-' + section, async () => {
        const path = section === 'projects' ? 'projects' : project + '/' + section
        await open(path)
        await page.fill('.ks-search input','')
        if (await page.evaluate(() => [...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('button')].some(button => button.textContent.trim() === 'Clear all'))) await clickText('button','Clear all')
        await stable(ui + '/extensions/rbac/' + path)
        const before = await extensionState()
        ensure(before.rows.length === 25,'fixture must populate a complete 25-row first page for ' + section)
        const next = '.kel-pagination button.btn-next'
        ensure(await page.evaluate(() => !document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.kel-pagination button.btn-next')?.disabled),'next page is not available')
        await page.evaluate(() => document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.kel-pagination button.btn-next').scrollIntoView({block:'center',inline:'nearest'}))
        await page.focus(next)
        await page.click(next)
        await page.waitForFunction(() => document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('.kel-pager .is-active')?.textContent.trim() === '2')
        const second = await extensionState()
        ensure(!exact(before.rows,second.rows),'pagination did not change displayed records')
        const discoveredSecondPageId = await page.evaluate(firstRows => {
          const root = document.querySelector('[data-test="extension-container"]').shadowRoot
          return [...root.querySelectorAll('tbody tr')].find(row => !firstRows.includes(row.textContent.trim()))?.querySelector('td')?.textContent.trim()
        },before.rows)
        await page.evaluate(() => document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.kel-pagination button.btn-prev').scrollIntoView({block:'center',inline:'nearest'}))
        await page.focus('.kel-pagination button.btn-prev')
        await page.click('.kel-pagination button.btn-prev')
        await page.waitForFunction(() => document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('.kel-pager .is-active')?.textContent.trim() === '1')
        const target = discoveredSecondPageId
        ensure(typeof target === 'string' && target,'second page must contain a real record absent from page one')
        ensure(!before.rows.some(row => row.includes(target)),'specified second-page record already appears on page one')
        await page.fill('.ks-search input',target)
        await page.waitForFunction(target => {
          const rows = [...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('tbody tr')]
          return rows.length === 1 && rows[0].textContent.includes(target)
        },target)
        await page.fill('.ks-search input','__application_project_no_match__')
        await page.waitForFunction(() => document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('tbody tr').length === 0)
        await page.fill('.ks-search input','')
        await page.waitForFunction(() => document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('tbody tr').length === 25)
        await clickText('button','Add filters')
        const fieldKey = section === 'projects' ? 'id' : section === 'scopes' ? 'scope' : section === 'clients' ? 'clientId' : 'subject'
        const names = {id:'Project ID',scope:'OAuth2 scope',clientId:'Client ID',subject:'User identity'}
        await page.click('button[aria-label=' + quote('Add filter for ' + names[fieldKey]) + ']')
        await page.fill('.edit-popup input',target)
        await page.waitForFunction(target => {
          const root = document.querySelector('[data-test="extension-container"]').shadowRoot
          return root.querySelectorAll('tbody tr').length === 1 && root.querySelector('tbody').textContent.includes(target)
        },target)
        await page.click('.edit-popup button[aria-label="Close"]')
        await page.reload()
        await stable(ui + '/extensions/rbac/' + path)
        ensure((await extensionState()).rows.length === 1,'condition did not survive refresh')
        await clickText('button','Clear all')
        await page.waitForFunction(() => document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('tbody tr').length === 25)
        return {firstPageCount:before.rows.length,secondPageChanged:true,otherPageSearch:target,empty:true,conditionRefresh:true,clear:true}
      })
    }
    for (const section of ['projects','scopes','clients','assignments']) {
      for (const operator of ['equals','contains','and','or']) {
        await run('ui-filter-' + section + '-' + operator, async () => {
          const path = section === 'projects' ? 'projects' : project + '/' + section
          await open(path)
          const plan = fixture.filters[section][operator]
          for (const step of plan.steps) {
            ensure(['click','fill','selectOption'].includes(step.action) && step.selector && !step.selector.includes('>>') && !/locator\(|getByRole\(|:nth-match\(/.test(step.selector), 'unsupported filter action')
            if (step.action === 'click') {
              if (step.selector === '.adv-clear' && !await page.evaluate(() => Boolean(document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.adv-clear')))) await page.click('button[aria-label="Add advanced filter"]')
              await page.click(step.selector)
            }
            else await page[step.action](step.selector,step.value)
          }
          await page.waitForFunction(expected => {
            const root = document.querySelector('[data-test="extension-container"]')?.shadowRoot
            const ids = [...(root?.querySelectorAll('tbody tr') ?? [])].map(row => row.querySelector('td')?.textContent.trim()).sort()
            return JSON.stringify(ids) === JSON.stringify([...expected].sort())
          },plan.expectedIds)
          const observed = await extensionState()
          await page.reload()
          await stable(ui + '/extensions/rbac/' + path)
          const restored = await page.evaluate(() => [...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('tbody tr')].map(row => row.querySelector('td')?.textContent.trim()).sort())
          ensure(exact(restored,[...plan.expectedIds].sort()), 'filter result was not restored after refresh')
          return {operator,expectedIds:plan.expectedIds,rows:observed.rows,refreshed:true}
        })
      }
    }
    await run('ui-narrow-and-keyboard-focus', async () => {
      await page.setViewport({width:390,height:844})
      await open(scopePath)
      await page.focus('[name="local-scope-description"]')
      await page.press('[name="local-scope-description"]','Tab')
      const observed = await page.evaluate(() => {
        const root = document.querySelector('[data-test="extension-container"]').shadowRoot
        const focused = root.activeElement
        const style = focused && getComputedStyle(focused)
        return {viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,focused:focused?.tagName,name:focused?.getAttribute('name'),outline:style?.outlineStyle,outlineWidth:style?.outlineWidth,disabled:focused?.disabled,
          bounds:[...root.querySelectorAll('input,select,textarea,button')].filter(item => item.getClientRects().length).map(item => ({left:item.getBoundingClientRect().left,right:item.getBoundingClientRect().right}))}
      })
      ensure(observed.viewport === 390 && observed.documentWidth <= 392,'narrow page has document overflow')
      ensure(observed.focused && !observed.disabled && observed.outline !== 'none' && parseFloat(observed.outlineWidth) > 0,'keyboard focus is not visible on the next interactive control')
      ensure(observed.bounds.every(box => box.left >= -2 && box.right <= 392),'narrow form controls leave viewport')
      await snapshot('narrow-focus')
      await page.setViewport({width:1440,height:1000})
      return observed
    })
    await run('console-page-request-errors-have-explicit-sources', async () => {
      await collectDiagnostics()
      const unexpected = report.diagnostics.filter(event => !event.expected && ['console-error','page-error','request-failed','http-error'].includes(event.kind))
      const allowed = event => {
        const isNavigationAbort = item => item.kind === 'request-failed' && item.message === 'net::ERR_ABORTED' && (new URL(item.url).origin === origin.origin || item.url.startsWith('https://api.kestra.io/v1/feeds?')) && report.diagnostics.some(request => request.kind === 'request' && request.requestId === item.requestId && request.documentId === item.documentId && request.url === item.url) && report.diagnostics.some(next => next.kind === 'document-navigation' && next.documentId !== item.documentId && Math.abs(Date.parse(next.observedAt) - Date.parse(item.observedAt)) < 1000)
        if (isNavigationAbort(event)) return true
        if (event.kind === 'console-error' && event.message.startsWith('TypeError: 200 Failed to fetch\n') && event.message.includes('/mf-shared-')) {
          return report.diagnostics.some(item => item.documentId === event.documentId && item.cancelled === true && isNavigationAbort(item) && Math.abs(Date.parse(item.observedAt) - Date.parse(event.observedAt)) < 1000 && report.diagnostics.some(response => response.kind === 'http-response' && response.status === 200 && response.requestId === item.requestId && response.documentId === item.documentId && response.url === item.url && Date.parse(response.observedAt) <= Date.parse(item.observedAt)))
        }
        if (event.kind === 'console-error' && /^(?:Error during authentication check: )?TypeError: Failed to fetch(?:\n|$)/.test(event.message) && (event.message.startsWith('Error during authentication check:') || event.message.includes('/common-dashboard-execution-flow-') || event.message.includes('/Namespaces-') && event.message.includes('Fl.fetchCall')) && report.diagnostics.some(item => item.documentId === event.documentId && isNavigationAbort(item) && Math.abs(Date.parse(item.observedAt) - Date.parse(event.observedAt)) < 1000)) return true
        if (event.kind === 'request-failed' && event.message === 'net::ERR_ABORTED' && (event.url.startsWith('https://api.kestra.io/v1/feeds?') || event.resourceType === 'Script' && new URL(event.url).origin === origin.origin && new URL(event.url).pathname.startsWith('/' + ['ui','assets',''].join('/')))) {
          return report.diagnostics.some(item => item.kind === 'document-navigation' && item.documentId !== event.documentId && Date.parse(item.observedAt) >= Date.parse(event.observedAt) - 1000 && Date.parse(item.observedAt) <= Date.parse(event.observedAt) + 1000)
        }
        if (!['http-error','console-error'].includes(event.kind) || !event.requestId) return false
        const response = report.diagnostics.find(item => item.kind === 'http-error' && item.requestId === event.requestId && item.documentId === event.documentId && item.url === event.url && item.status === event.status)
        if (!response) return false
        if (response.method === 'GET' && event.status === 403 && event.url === url('/' + ['api','v1','configs'].join('/')) && new URL(event.documentUrl).pathname === ui + '/extensions/rbac/projects/' + encodeURIComponent(fixture.projectId) + '/reconciliation' && report.diagnostics.some(item => item.kind === 'http-response' && item.status === 200 && item.method === 'GET' && item.documentId === event.documentId && item.url === url(api + '/projects/' + encodeURIComponent(fixture.projectId) + '/reconciliation'))) return true
        if (response.method === 'GET' && event.status === 403 && event.url === url('/' + ['api','v1','configs'].join('/')) && (report.rows.some(row => row.case === 'production-reauthentication' && row.evidence?.needsReconciliation === true && row.evidence?.final?.documentId === event.documentId) || report.requests.some(request => request.method === 'GET' && request.status === 200 && request.source?.documentId === event.documentId && request.path === api + '/projects/' + encodeURIComponent(fixture.projectId) + '/reconciliation'))) return true
        if ((fixture.expectedRequestErrors ?? []).some(rule => rule.case === event.case && rule.method === response.method && rule.status === event.status && url(rule.path) === event.url)) return true
        return report.requests.some(request => request.source.documentId && request.source.documentId === event.documentId && response.method === request.method && event.url === url(request.path) && event.status === request.status && (fixture.expectedRequestErrors ?? []).some(rule => rule.case === request.case && rule.method === request.method && rule.status === request.status && rule.path === request.path && (!rule.code || rule.code === request.code)))
      }
      const failures = unexpected.filter(event => !allowed(event))
      ensure(!failures.length,'unclassified console/page/request failures: ' + JSON.stringify(failures))
      return {events:report.diagnostics.length,explicitlyExpected:report.diagnostics.filter(event => event.expected).length,unclassified:failures.length}
    })
    report.completed = !diagnostic
  } catch (error) {
    report.failure = {case:activeCase,message:errorText(error)}
    throw error
  } finally {
    // Preserve evidence first. Cleanup is a separate recorded operation; it cannot
    // erase the original failure or turn a failed test into a passing report.
    try {report.documents.push(await documentState()); await collectDiagnostics()} catch (error) {report.diagnosticCaptureFailure = errorText(error)}
    if (mutationStarted && policyOriginal) {
      try {
        activeCase = 'cleanup-restore-test-scope'
        const current = await readPolicy()
        const original = policyOriginal.policy.applicationProjects[fixture.projectId].scopes[fixture.scope]
        const restored = await request(localPath,'PUT',{name:fixture.scope,...original},current.revision)
        ensure(restored.ok,'test scope restoration failed')
        const verified = await readPolicy()
        ensure(exact(verified.policy.applicationProjects[fixture.projectId].scopes[fixture.scope],original),'restored scope differs from original')
        report.rows.push({name:activeCase,case:activeCase,passed:true,status:'passed',evidence:{revision:verified.revision}})
      } catch (error) {
        report.completed = false
        report.rows.push({name:'cleanup-restore-test-scope',case:'cleanup-restore-test-scope',passed:false,status:'failed',error:errorText(error)})
      }
    }
    for (const restoration of restores.reverse()) {
      try {
        activeCase = 'cleanup-restore-' + restoration.kind
        const current = await request(restoration.path)
        ensure(current.ok,'cleanup could not read identity record')
        const original = restoration.original
        const input = restoration.kind === 'client'
          ? {clientId:original.clientId,approved:original.approved,firstPartyUi:original.firstPartyUi,audiences:original.audiences,allowedProjectScopes:original.allowedProjectScopes}
          : {issuer:original.issuer,subject:original.subject,projectScopes:original.projectScopes}
        const result = await request(restoration.path,'PUT',input,current.body.revision)
        ensure(result.ok,'cleanup failed to restore identity record')
        await afterDirectoryMutation('restore test ' + restoration.kind)
        const verified = (await request(restoration.path)).body
        ensure(Object.entries(input).every(([field,value]) => exact(verified[field],value)),'restored identity record does not match original')
        report.rows.push({name:activeCase,case:activeCase,passed:true,status:'passed',evidence:{revision:verified.revision}})
      } catch (error) {
        report.completed = false
        report.rows.push({name:activeCase,case:activeCase,passed:false,status:'failed',error:errorText(error)})
      }
    }
    try {await collectDiagnostics()} catch (error) {report.completed = false; report.diagnosticCaptureFailure = errorText(error)}
    if (report.diagnosticCaptureFailure) report.completed = false
    report.finishedAt = new Date().toISOString()
    report.notRun = planned.filter(name => !report.rows.some(row => row.name === name))
    if (report.notRun.length) report.completed = false
    report.counts = {passed:report.rows.filter(row => row.status === 'passed').length,failed:report.rows.filter(row => row.status === 'failed').length,skipped:0,notRun:report.notRun.length}
    await persist()
  }
  ensure(report.completed && report.counts.failed === 0,'acceptance or test cleanup failed; retained report is authoritative')
  return report
}
