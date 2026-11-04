import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'

export const pluginUiBehaviors=Object.freeze([
  ...['group','user','permission','subject'].flatMap(kind=>[
    `drawer-${kind}-native-style`,`drawer-${kind}-focus-close-reopen`,
    `drawer-${kind}-draft-backdrop-history`,`drawer-${kind}-maximize-save-loading`]),
  'cards-counts-title','list-permission-summary','filter-popup-geometry',
  'filter-popup-buttons-reopen-scroll','state-normal','state-empty','state-loading',
  'state-error-retry','state-denied','state-reauthentication','user-edit-save',
  'inline-discard','credential-copy-retry','theme-switch-refresh-system',
  'default-application-continuity-query','default-scope-continuity-query',
  'default-selection-rejection-clears','default-selection-identity-change',
  'default-selection-rapid-navigation',
])
export const pluginUiExpectedIds=Object.freeze(['light','dark','dark-2','system'].flatMap(theme=>
  ['en','zh_CN'].flatMap(locale=>[1280,768,390].flatMap(width=>pluginUiBehaviors.map(behavior=>
    `plugin-ui/${theme}/${locale}/${width}/${behavior}`)))))
const digest=value=>createHash('sha256').update(value).digest('hex')
const hash=value=>assert(/^[a-f0-9]{64}$/.test(value),'Missing content SHA-256')
export function assertHostAuthenticationRecoveryBrowserReport(raw,runnerSha256) {
  const report=JSON.parse(raw)
  assert.equal(report.completed,true)
  assert.equal(report.environment,'real-chromium-host-http-substitute')
  assert.equal(report.productionFirstInstall,false)
  assert.equal(report.runnerSha256,runnerSha256)
  hash(runnerSha256)
  const sources=['ui/src/utils/authentication.ts','ui/src/utils/basicAuth.ts','ui/src/utils/csrf.ts',
    'ui/src/override/utils/route.ts','ui/src/extensions/runtime.ts','ui/src/extensions/protocol.ts',
    'ui/src/components/extensions/ExtensionPage.vue']
  assert.deepEqual(Object.keys(report.sourceFiles).sort(),sources.sort())
  for(const value of Object.values(report.sourceFiles))hash(value)
  assert.deepEqual(report.finalSourceFiles,report.sourceFiles)
  assert.deepEqual(report.errors,[])
  assert.equal(report.error,undefined)
  assert.deepEqual(report.checks.map(row=>row.name),[...[403,503,401].map(status=>'host-context-request-'+status+'-single-write'),'logout-pending-401'])
  for(const [index,status] of [403,503,401].entries()) {
    const row=report.checks[index]
    assert.equal(row.status,status)
    assert.equal(row.passed,true)
    assert.deepEqual(row.counts,{writes:1,reads:1,logins:status===401?1:0})
  }
  const logout=report.checks[3]
  assert.equal(logout.passed,true)
  assert.equal(logout.status,401)
  assert.equal(logout.logoutRequests,1)
  assert.deepEqual(logout.counts,{writes:1,reads:1,logins:0})
  return {passed:true,cases:4,failures:0,skipped:0,notRun:0,sha256:digest(raw),runnerSha256}
}
export const aggregateUiHashes=files=>digest(Object.entries(files).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([path,sha])=>path+'\0'+sha).join('\n'))
export const stablePopupReferenceCaseName='stable-native-popup-reference-toggle-after-scroll'
export function assertStablePopupReferenceCases(checks) {
  const rows=checks.filter(row=>row.name===stablePopupReferenceCaseName)
  assert.equal(rows.length,4,'Required stable reference regressions missing')
  assert.deepEqual(rows.map(row=>row.theme),['light','dark','dark-2','system'])
  for(const row of rows) {
    assert.equal(row.width,1280);assert.equal(row.passed,true);assert.equal(row.error,undefined)
    const e=row.evidence,relation=e?.triggerPopoverRelation
    for(const key of ['nativeTransitionsSettled','sameTriggerClosed','sameTriggerReopened','afterScrollClosed'])assert.equal(e?.[key],true,'Missing actual stable reference behavior: '+key)
    assert(relation?.trigger&&JSON.stringify(relation.trigger).length>2,'Trigger identity missing')
    assert(['aria-describedby','aria-controls'].includes(relation.ariaAttribute))
    assert(typeof relation.popoverId==='string'&&relation.popoverId.length>0)
    assert(typeof relation.ariaValue==='string'&&relation.ariaValue.trim().split(/\s+/).includes(relation.popoverId),'Trigger must identify the exact observed popup')
  }
  return rows.map(({name,theme,width,passed,evidence})=>({name,theme,width,passed,evidence}))
}
export function committedPluginUiHashes(pluginRoot,commit) {
  assert(/^[a-f0-9]{40}$/.test(commit))
  const git=(...args)=>execFileSync('git',['-C',pluginRoot,...args],{maxBuffer:32*1024*1024})
  const paths=git('ls-tree','-r','--name-only',commit,'ui/src').toString().trim().split('\n')
  assert(paths.length>0&&paths.every(path=>path.startsWith('ui/src/')))
  const harnessPaths=git('ls-tree','-r','--name-only',commit,'ui/browser').toString().trim().split('\n')
  assert(harnessPaths.length>0&&harnessPaths.every(path=>path.startsWith('ui/browser/')))
  return {sourceSha256:aggregateUiHashes(Object.fromEntries(paths.map(path=>[path.slice('ui/src/'.length),digest(git('show',commit+':'+path))]))),lockSha256:digest(git('show',commit+':ui/package-lock.json')),harnessSha256:aggregateUiHashes(Object.fromEntries(harnessPaths.map(path=>[path.slice('ui/browser/'.length),digest(git('show',commit+':'+path))])))}
}

export function assertPluginUiBrowserReport(raw,{commit,image,hostExecutableSha256,manifestRaw,expectedHashes}={}) {
  const report=JSON.parse(raw),manifest=JSON.parse(manifestRaw)
  assert.equal(report.schemaVersion,1);assert.equal(report.gate,'plugin-ui-chromium')
  assert.equal(report.inputs?.sourceCommit,commit);assert.equal(report.inputs.image,image)
  assert.equal(report.inputs.hostExecutableSha256,hostExecutableSha256)
  for(const key of ['sourceSha256','lockSha256','bundleSha256','sdkSha256','hostExecutableSha256'])hash(report.inputs[key])
  for(const key of ['sourceSha256','lockSha256','sdkSha256','bundleSha256','harnessSha256']){hash(expectedHashes?.[key]);assert.equal(report.inputs[key],expectedHashes[key],'Browser input differs from independently selected '+key)}
  assert.deepEqual(report.errors,[],'Plugin browser runner errors must not be hidden by case results')
  for(const key of ['sourceCommit','image','sourceSha256','lockSha256','bundleSha256','sdkSha256','hostExecutableSha256'])assert.equal(report.finalInputs?.[key],report.inputs[key],'Plugin browser input changed during execution: '+key)
  assert.equal(manifest.schemaVersion,1);assert.equal(manifest.gate,'plugin-ui-chromium')
  assert.deepEqual(manifest.cases.map(row=>row.id),pluginUiExpectedIds,'Published plugin plan differs from required UI-owned matrix')
  assert.deepEqual(report.cases.map(row=>row.id),pluginUiExpectedIds,'Missing, duplicate or reordered plugin browser cases')
  for(const collection of [manifest.cases,report.cases])for(const row of collection) {
    const [,theme,locale,width,behavior]=row.id.split('/')
    assert.deepEqual({theme:row.theme,locale:row.locale,width:row.width,behavior:row.behavior},{theme,locale,width:Number(width),behavior},'Published browser parameters differ from named case identity')
  }
  assert.equal(report.gatePassed,true)
  assert.equal(pluginUiExpectedIds.length,840)
  assert.deepEqual(report.summary,{planned:840,executed:840,passed:840,failed:0,notRun:0,skipped:0})
  assert(report.cases.every(row=>row.status==='passed'&&Array.isArray(row.errors)&&row.errors.length===0&&Number.isFinite(row.durationMs)&&row.durationMs>=0),'Plugin browser has errors, skipped or incomplete cases')
  return {passed:true,cases:840,failures:0,notRun:0,skipped:0,reportSha256:digest(raw),manifestSha256:digest(manifestRaw),inputs:report.inputs}
}

export const hostAuthThemeIds=Object.freeze([1280,390].flatMap(width=>[
  ...['light','dark','dark-2','system-light','system-dark'].flatMap(theme=>['login','denied'].map(page=>`${theme}/${width}/${page}`)),
  ...['unset','invalid','storage-unavailable'].map(theme=>`${theme}/${width}/login`),
]))
export const hostAuthLocaleIds=Object.freeze([1280,390].flatMap(width=>
  ['zh_CN','ja','de','ru','pl','pt','en','it','fr','hi','ko','pt_BR','es'].flatMap(locale=>['login','denied'].map(page=>`${locale}/${width}/${page}`))))
export function assertHostAuthenticationUiReports(reports) {
  const names=['auth-theme-env.json','auth-theme-setup.json','auth-i18n-env.json','auth-i18n-setup.json']
  assert.deepEqual(Object.keys(reports).sort(),[...names].sort())
  const evidence={}
  for(const name of names) {
    const raw=reports[name],report=JSON.parse(raw),expected=name.startsWith('auth-theme-')?26:52
    assert.equal(report.completed,true);assert.equal(report.rows.length,expected)
    assert(report.rows.every(row=>row.passed===true&&!row.error&&!row.skipped&&row.overflow===false))
    const ids=report.rows.map(row=>[row.case??row.locale,row.width,row.page].join('/'))
    assert.deepEqual(ids,name.startsWith('auth-theme-')?hostAuthThemeIds:hostAuthLocaleIds,'Published authentication visual matrix differs from exact required cases')
    evidence[name]={sha256:digest(raw),rows:expected}
  }
  return {passed:true,cases:156,failures:0,notRun:0,skipped:0,reports:evidence}
}
