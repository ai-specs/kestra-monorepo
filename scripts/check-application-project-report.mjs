#!/usr/bin/env node
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import {projectScopeCases, requiredProjectChecks, legacyMigrationChecks, applicationProject} from './application-project-cases.mjs'
import {applicationGroupPluginClasses,applicationGroupTables} from './application-group-artifact-contract.mjs'
import {derive as deriveAccessControlGates,assertHostHttpOriginReport} from './access-control-v3-gates.mjs'
import {createHash} from 'node:crypto'
import {dirname,resolve,sep} from 'node:path'
import {readBrowserDiagnosticEvidence} from './browser-diagnostic-evidence.mjs'
import {accessControlLocales,accessControlSupportedLocales} from './access-control-v3-ui.mjs'
import {checkPublishedTranslationSources} from './access-control-translation-coverage.mjs'
import {classifyAccessControlDiagnostics} from './access-control-browser-diagnostics.mjs'

const [file, image, jarSha256, rootCommit, overlayCommit, pluginCommit] = process.argv.slice(2)
assert(file && /^ghcr\.io\/ai-specs\/kestra-overlay@sha256:[0-9a-f]{64}$/.test(image ?? ''), 'Explicit immutable image required')
assert(/^[0-9a-f]{64}$/.test(jarSha256 ?? ''), 'Explicit jar SHA-256 required')
for (const commit of [rootCommit, overlayCommit, pluginCommit]) assert(/^[0-9a-f]{40}$/.test(commit ?? ''), 'Explicit final commit required')
const content = readFileSync(file, 'utf8')
assert(!/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(content), 'Report contains a credential-shaped JWT')
const report = JSON.parse(content)
assert.equal(report.schemaVersion, 1)
assert(['new-install','legacy-migration'].includes(report.profile),'Explicit acceptance profile required')
assert(Array.isArray(report.excludedChecks),'Explicit excluded check list required')
if(report.profile==='new-install'){
  assert.deepEqual(report.excludedChecks.map(row=>row.id).sort(),[...legacyMigrationChecks].sort(),'New-install exclusions must exactly describe the historical migration checks')
  for(const row of report.excludedChecks){assert.equal(typeof row.reason,'string');assert(row.reason.trim());assert.equal(row.passed,undefined);assert.equal(row.status,undefined)}
  assert(!report.checks?.some(row=>legacyMigrationChecks.includes(row.id)),'Historical migration checks cannot be counted in new-install acceptance')
}else assert.deepEqual(report.excludedChecks,[],'Legacy migration cannot exclude required checks')
const profileRequiredChecks=[...requiredProjectChecks,...(report.profile==='legacy-migration'?legacyMigrationChecks:[])]
assert.equal(report.completed, true, 'Acceptance did not complete')
assert.deepEqual(report.blockers,[],'Completed acceptance retains unresolved blockers')
assert.equal(report.nonFinal, false, 'Development evidence cannot satisfy final acceptance')
assert.equal(report.development?.allowDirtyRoot, false, 'Final acceptance requires committed sources')
assert.equal(report.notRun, 0, 'Required checks remain unexecuted')
assert.equal(report.mode, 'run', 'Static and configuration checks are not acceptance')
assert.equal(report.resources?.cleaned,true,'Final report cannot pass before the owned deployment is cleaned')
assert.equal(report.resources.cleanupInventory?.owner,report.resources.composeProject)
assert.equal(report.resources.cleanupInventory.ownerVerified,true)
for(const derived of deriveAccessControlGates(report)) {
  assert.equal(derived.status,'passed','Final underlying access-control evidence did not pass: '+derived.id)
  assert.equal(derived.passed,true)
  const summaries=report.checks.filter(row=>row.id===derived.id)
  assert.equal(summaries.length,1,'Final access-control gate summary missing or duplicated: '+derived.id)
  assert.deepEqual(summaries[0],derived,'Final access-control gate summary differs from underlying evidence: '+derived.id)
}
for(const resource of ['containers','networks','volumes'])assert.equal(report.resources.cleanupInventory[resource],0,'Owned acceptance '+resource+' remain')
assert(report.stages?.some(stage => stage.id === 'publication-gate' && stage.status === 'passed'), 'Formal artifact publication gate missing')
const sdkGate=report.sources?.overlay?.downloadedSdkBrowserGate
const originGate=report.sources?.overlay?.downloadedHttpOriginGate
assert.equal(originGate?.commit,overlayCommit,'Published HTTP origin regression commit differs')
assert.equal(originGate.runId,sdkGate.runId)
assert.equal(originGate.sha256,createHash('sha256').update(originGate.xml).digest('hex'))
assert.deepEqual({tests:originGate.tests,cases:originGate.cases,failures:originGate.failures,skipped:originGate.skipped},assertHostHttpOriginReport(originGate.xml))
assert.equal(sdkGate?.commit,overlayCommit,'Downloaded host SDK report does not match final commit')
assert.equal(sdkGate.image,image,'Downloaded host SDK report does not match selected image')
assert.equal(sdkGate.passed,949);assert.equal(sdkGate.failures,0);assert.equal(sdkGate.notRun,0)
for(const field of ['sha256','matrixSha256','buildId'])assert(/^[a-f0-9]{64}$/.test(sdkGate[field]),'Downloaded host SDK '+field+' missing')
for(const field of ['runId','artifactId','jobId'])assert(Number.isSafeInteger(sdkGate[field])&&sdkGate[field]>0,'Downloaded host SDK '+field+' missing')
const geometryGate=report.sources?.overlay?.downloadedFilterGeometryGate
assert.equal(geometryGate?.commit,overlayCommit,'Downloaded native filter geometry report does not match final commit')
assert.equal(geometryGate.image,image,'Downloaded native filter geometry report does not match selected image')
assert.equal(geometryGate.runId,sdkGate.runId,'Geometry and SDK reports must come from the same final run')
assert.equal(geometryGate.artifactId,sdkGate.artifactId,'Geometry and SDK reports must come from the same downloaded artifact')
assert.equal(geometryGate.buildId,sdkGate.buildId,'Geometry and SDK frozen builds differ')
assert.equal(geometryGate.checks,60,'Complete native geometry matrix required')
assert(/^[a-f0-9]{64}$/.test(geometryGate.sha256),'Downloaded native geometry report hash missing')
const pluginUi=report.sources?.plugin?.downloadedUiTests
assert.equal(pluginUi?.commit,pluginCommit,'Downloaded plugin UI report does not match final commit')
assert(Number.isSafeInteger(pluginUi.tests)&&pluginUi.tests>=195,'Complete downloaded plugin UI regressions required')
assert.equal(pluginUi.cases?.length,pluginUi.tests,'Plugin UI case count differs from downloaded JUnit')
assert(pluginUi.cases.every(test=>test.status==='passed'),'Downloaded plugin UI cases contain failure or skip')
for(const name of [
  ...['revoked','partial','missing','disabled','invalid'].map(mode=>'App subject deep link revalidates '+mode+' without broadening rows'),
  ...['group','scope','application'].map(kind=>'App native box tab cancel and same-target retry preserves '+kind+' draft and controlled active'),
  'App native box tabs retain active and host URL during real editor save and one-time credential',
  'App slow subject query retains real credential-write and oneTime navigation locks',
  'native drawer owns title/header SVGs, footer/form association, body padding and reopen reset',
  'native drawer CSS leaves padding/header/width to published component and counts own explicit token gap',
  'actual native card buttons retain spaced accessible text, counts, destinations and unavailable/busy locks',
  'published shadow adapter keeps native header and footer in focus ring; Escape closes then restores trigger/fallback',
  'published native drawer dirty nested Escape keeps draft, saving rejects Escape/mask/close and submit',
  'public native forms translate real labels in all published locales and retain immutable permission key/account identity',
  'native clean mask closes; readonly and pending App save stay locked while native maximize remains presentation-only',
  'original public KsButton stays globally unwrapped and preserves public props/events including bare disabled',
  "successful real App scope deletion selected restores only the replacement fallback after slow reload and canonical navigation",
  "successful real App scope deletion nonselected restores only the replacement fallback after slow reload and canonical navigation",
  "cancel preserves the connected original trigger and does not delete, reload or jump to fallback",
  "412 keeps the original trigger/sidebar, rejects duplicate mutation, and cancel restores that trigger",
  "successful delete does not steal focus from an original trigger that remains connected",
  "successful DELETE followed by failed authorized reload does not target a missing or stale fallback",
  "canonical navigation failure after real deletion retains error focus rather than overriding it with fallback",
  "read-only and in-flight delete locks survive; revoked reload never restores unauthorized sidebar",
  'native focus lifecycle: closing retains the cycle kind marker and registration until native release, then public closed cleans up',
  'App automatic canonical navigation releases read lock and observes public rejection',
  ...accessControlSupportedLocales.map(locale=>'App public navigation rejection stays visible in '+locale),
  'App automatic canonical navigation passes actual host read guard',
  'App clear invalid query observes rejection and retains invalid URL without writes',
  'App overlapping navigation late rejection cannot overwrite accepted host destination',
  'App overlapping rejected attempts keep latest failure and ignore stale authorization rejection',
  'App current public authorization rejection clears sensitive view and preserves host URL',
  'App observes pending public navigation rejection after unmount',
  'native focus lifecycle: stale public closed cannot clean a quickly reopened cycle or retain native maximize',
  'native focus lifecycle: async-disabled subject trigger is restored after Enter-style close and native release',
])assert.equal(pluginUi.cases.filter(test=>test.name===name&&test.status==='passed').length,1,'Required final subject/tab regression missing or duplicated: '+name)
for(const field of ['failures','errors','skipped'])assert.equal(pluginUi[field],0)
assert(/^[a-f0-9]{64}$/.test(pluginUi.sha256),'Downloaded plugin UI report hash missing')
for(const field of ['runId','artifactId'])assert(Number.isSafeInteger(pluginUi[field])&&pluginUi[field]>0,'Downloaded plugin UI '+field+' missing')
for(const field of ['runId','artifactId'])assert.equal(pluginUi[field],report.sources.plugin.downloadedTestResultsByPhase?.unit?.[field],'Plugin UI and backend reports must come from the same final artifact')
assert(report.stages?.some(stage => stage.id === 'access-control-prototype' && stage.status === 'passed'
  && stage.evidence?.scope === 'frozen-prototype-only' && stage.evidence.businessAcceptance === false), 'Reviewed prototype input gate missing')
const artifactContract=report.stages?.find(stage=>stage.id==='artifact-inputs'&&stage.status==='passed')?.evidence?.applicationGroupContract
assert.deepEqual(artifactContract,{model:'application-group',requiredClasses:applicationGroupPluginClasses.length,obsoleteClasses:0},'Actual application-group plugin artifact contract missing')
const storageContract=report.stages?.find(stage=>stage.id==='new-install-storage-contract'&&stage.status==='passed')?.evidence
assert.deepEqual(storageContract,{model:'application-group',requiredTables:[...applicationGroupTables],obsoleteTables:[]},'Actual empty-install storage contract missing')
for (const [name, commit] of [['overlay', overlayCommit], ['plugin', pluginCommit]]) {
  const source = report.sources?.[name]
  assert.equal(source?.dirty, false, `${name}: uncommitted independent source`)
  assert.equal(source.ci?.headSha, commit, `${name}: CI does not match final source`)
  assert.equal(source.ci?.status, 'completed')
  assert.equal(source.ci?.conclusion, 'success')
}
assert.deepEqual(report.inputs, {image, jarSha256, rootCommit, overlayCommit, pluginCommit}, 'Report inputs differ from the final composition')
assert.equal(report.failures, 0)
assert.deepEqual(report.resources.queueEvidenceRetention,{configuration:'kestra.jdbc.queue.cleaner.retention',value:'24h',scope:'isolated acceptance test data only',cleanerScheduleUnchanged:true,queueHashEqualityUnchanged:true,actualContainerEnvironmentVerified:true},'Long-running queue evidence retention and unchanged cleaner schedule must be verified in the actual container')
assert(report.sources.plugin.downloadedReportGates?.unit?.includes('zero failure/skip'),'Downloaded plugin unit suite gate missing')
assert(/ApplicationGroupDirectoryServiceTest [1-9][0-9]* PostgreSQL cases executed/.test(report.sources.plugin.downloadedReportGates?.postgres??''),'Downloaded plugin PostgreSQL business service gate missing')
assert.equal(report.skipped, 0)
const upgradeCheck=report.checks?.find(row=>row.id==='declaration-upgrade')
assert(upgradeCheck?.passed&&upgradeCheck.status==='passed','Schema2 declaration-upgrade gate missing')
assert.equal(upgradeCheck.evidence?.source,'plugin-ci-postgres')
assert.equal(upgradeCheck.evidence?.commit,pluginCommit)
assert.equal(upgradeCheck.evidence?.backend,'PostgreSQL')
assert(Number.isSafeInteger(upgradeCheck.evidence?.tests)&&upgradeCheck.evidence.tests>0)
for(const field of ['failures','errors','skipped'])assert.equal(upgradeCheck.evidence[field],0)
assert(report.sources.plugin.downloadedReportGates?.declarationUpgrade,'Downloaded schema2 upgrade report was not checked')
const lifecycleGate=report.sources.plugin.downloadedReportGates?.lifecycle
assert.equal(lifecycleGate?.backend,'PostgreSQL');assert.equal(lifecycleGate?.hostAdapter,'published-adapter-participant')
assert.equal(lifecycleGate.hostImage,image)
assert.equal(lifecycleGate.hostExecutableSha256,report.resources.hostExecutableSha256)
assert(Number.isSafeInteger(lifecycleGate.tests)&&lifecycleGate.tests>=6)
assert(Number.isSafeInteger(lifecycleGate.additionalTests)&&lifecycleGate.additionalTests>0)
for(const field of ['failures','errors','skipped'])assert.equal(lifecycleGate[field],0)
for(const phase of ['unit','postgres','lifecycle']) {
  const actual=report.sources.plugin.downloadedTestResultsByPhase?.[phase]
  assert(actual&&actual.commit===pluginCommit,'Final downloaded plugin phase missing: '+phase)
  assert(/^[1-9][0-9]*$/.test(String(actual.runId))&&/^[1-9][0-9]*$/.test(String(actual.artifactId)))
  assert(typeof actual.path==='string'&&actual.path.length>0&&actual.suites?.length>0)
  for(const field of ['tests','failures','errors','skipped'])assert.equal(actual.totals[field],actual.suites.reduce((total,suite)=>total+suite[field],0),'Plugin phase totals differ: '+phase)
  assert(Number.isSafeInteger(actual.totals.tests)&&actual.totals.tests>0)
  for(const field of ['failures','errors','skipped'])assert.equal(actual.totals[field],0,'Plugin phase is not fully passed: '+phase)
}
assert.equal(report.resources?.missingExtension?.sharedPostgres,true,'Auxiliary acceptance must reuse the primary PostgreSQL service')
assert.equal(report.resources.missingExtension.postgresContainer,report.resources.containerIds.postgres,'Auxiliary observer selected another PostgreSQL container')
assert.equal(report.resources.missingExtension.postgresComposeProject,report.resources.composeProject,'Auxiliary database owner differs from the primary acceptance project')
assert(/^application_group_acceptance_[0-9]+_[0-9]+$/.test(report.resources.missingExtension.database),'Dedicated auxiliary acceptance database required')
assert.equal(report.resources.missingExtension.cleaned,true,'Auxiliary deployment must be cleaned after MCP checks')
assert.equal(report.resources.missingExtension.databaseCleaned,true,'Auxiliary database must be cleaned after MCP checks')
assert(Array.isArray(report.matrix) && Array.isArray(report.checks) && Array.isArray(report.ui), 'Required evidence sections missing')
for (const row of [...report.matrix, ...report.checks, ...report.ui]) {
  assert.equal(row.status, 'passed', 'Every retained acceptance row must actually pass')
  assert.equal(row.passed, true)
}
const rows = new Map()
for (const row of report.matrix) {
  assert.equal(row.transport, 'rest', 'REST matrix must not be satisfied by a synthetic or different transport')
  const key = `${row.caseId}:${row.probeIndex}`
  assert(!rows.has(key), `Duplicate matrix row ${key}`)
  rows.set(key, row)
}
let expectedRows = 0
for (const testCase of projectScopeCases) for (const [index, probe] of testCase.probes.entries()) {
  expectedRows++
  const label = `${testCase.id}:${index}`
  const row = rows.get(label)
  assert(row, `Missing scope matrix case ${label}`)
  assert.equal(row.passed, true, label)
  assert.equal(row.skipped, undefined, label)
  assert.equal(row.expectedAllowed, probe.allowed, label)
  assert.equal(row.observed.allowed, probe.allowed, label)
  assert.equal(row.identity.applicationGroupId, applicationProject, label)
  assert(typeof row.identity.subject === 'string' && row.identity.subject.length, label)
  assert(typeof row.identity.issuer === 'string' && row.identity.issuer.startsWith('http'), label)
  assert(Array.isArray(row.identity.audiences) && row.identity.audiences.length, label)
  assert.deepEqual([...row.identity.applicationGroupScopes].sort(), [...testCase.scopes].sort(), label)
  assert.equal(row.resource.namespace, probe.namespace, label)
  assert.equal(row.resource.resource, probe.resource, label)
  assert.equal(row.resource.action, probe.action, label)
  assert.equal(row.resource.tenant, 'main', label)
  if (probe.resourceId) assert.equal(row.resource.id, probe.resourceId, label)
  assert(Number.isInteger(row.observed.status), label)
  assert(probe.allowed ? row.observed.status >= 200 && row.observed.status < 300
    : [401, 403].includes(row.observed.status), `${label}: status contradicts authorization result`)
  if (probe.allowed && probe.action === 'LIST') {
    assert(Array.isArray(row.observed.items) && row.observed.items.length > 0, `${label}: real list contents missing`)
    assert(Number.isSafeInteger(row.observed.total) && row.observed.total >= row.observed.items.length, `${label}: authorized total missing`)
    for (const item of row.observed.items) {
      assert(typeof item.id === 'string' && item.id.length && typeof item.namespace === 'string', `${label}: list item identity missing`)
      assert(item.namespace === probe.namespace || testCase.id !== 'resource-id-boundary'
        && (testCase.id === 'reader' || testCase.id === 'writer' || testCase.id === 'multiple-complete-scopes')
        && item.namespace.startsWith(probe.namespace + '.'), `${label}: out-of-range list namespace`)
    }
    if (probe.expectedIds) {
      assert.deepEqual(row.observed.items.map(item => item.id).sort(), [...probe.expectedIds].sort(), `${label}: ID filtering differs`)
      assert.equal(row.observed.total, probe.expectedIds.length, `${label}: total includes unauthorized IDs`)
    }
  }
  if (!probe.allowed && ['CREATE', 'UPDATE', 'DELETE', 'EXECUTE'].includes(probe.action)) {
    const effects = row.observed.sideEffects
    assert(effects && /^[0-9a-f]{64}$/.test(effects.before), `${label}: pre-operation storage snapshot missing`)
    assert.equal(effects.immediate, effects.before, `${label}: immediate mutation`)
    assert(effects.windowMs >= 5000 && Array.isArray(effects.samples) && effects.samples.length >= 2, `${label}: delayed observation window missing`)
    let previous = -1
    for (const sample of effects.samples) {
      assert(sample.elapsedMs > previous, `${label}: observation timestamps not increasing`)
      assert.equal(sample.hash, effects.before, `${label}: delayed mutation`)
      previous = sample.elapsedMs
    }
    assert(previous >= effects.windowMs, `${label}: delayed observation ended early`)
    assert.deepEqual([...effects.sources].sort(), ['database', 'queue', 'storage'], `${label}: incomplete side-effect sources`)
  }
}
assert.equal(rows.size, expectedRows, 'Unexpected or missing matrix rows')
const checks = new Map()
for (const check of report.checks) {
  assert(!checks.has(check.id), `Duplicate check ${check.id}`)
  assert.equal(check.passed, true, check.id)
  assert.equal(check.skipped, undefined, check.id)
  assert(check.evidence && typeof check.evidence === 'object', `Evidence missing: ${check.id}`)
  checks.set(check.id, check)
}
for (const required of profileRequiredChecks) assert(checks.has(required), `Missing required integration check ${required}`)
const missingProvider=checks.get('mcp-missing-extension')?.evidence
assert.equal(missingProvider?.authorizationDenied?.error,'invalid_scope','Missing provider must reject new ordinary credentials')
assert.equal(missingProvider.authorizationDenied.codeIssued,false)
assert.equal(missingProvider.authorizationDenied.protocolStateUnchanged,true,'Missing provider authorization changed code/token storage')
assert.equal(missingProvider.oldSessionRejected,true,'Previously allowed MCP session must fail closed without provider')
const combinations = new Set()
const browser=report.fragments?.ui?.shared
const references=[report.fragments?.ui?.adapterDiagnostics,browser?.adapterDiagnostics].filter(Boolean)
assert(references.length>=1,'Immutable final adapter diagnostics missing')
for(const reference of references) {
  const directories=[resolve(dirname(file),'browser/diagnostics'),resolve(dirname(report.resources.composeFile),'browser/diagnostics')]
  const localEvidenceRoot=fileURLToPath(new URL('../.work/',import.meta.url))
  if(typeof reference.path==='string'&&resolve(reference.path).startsWith(localEvidenceRoot)&&dirname(reference.path).endsWith(sep+'diagnostics'))directories.push(dirname(reference.path))
  const evidence=readBrowserDiagnosticEvidence(reference,directories)
  assert.equal(evidence.integrity.length,0,'Final adapter diagnostic integrity errors remain')
  const events=new Map(evidence.events.map(event=>[event.id,event]))
  for(const event of browser?.diagnostics??[])assert.deepEqual(events.get(event.id),event,'Immutable adapter snapshot omits or changes primary browser evidence')
}
assert(browser?.completed&&Array.isArray(browser.diagnostics)&&browser.diagnostics.length>0,'Complete source-attributed browser diagnostics missing')
const diagnosticReview=classifyAccessControlDiagnostics({events:browser.diagnostics,base:report.resources.base,requests:browser.requests,expectedTransportFailures:browser.expectedTransportFailures,identityWindows:browser.identityWindows})
assert.equal(diagnosticReview.errors.length,0,'Final browser report retains unknown errors')
assert.deepEqual(browser.diagnosticClassifications,diagnosticReview.classifications,'Browser error classifications differ from underlying source evidence')
const translations=report.stages.find(stage=>stage.id==='translation-key-coverage'&&stage.status==='passed')?.evidence
assert(translations,'Final translation-key coverage missing')
assert.deepEqual(translations,checkPublishedTranslationSources({pluginRoot:fileURLToPath(new URL('../kestra-plugin-rbac/',import.meta.url)),pluginCommit,jarSha256}),'Translation evidence differs from final committed plugin sources')
assert.equal(translations.pluginCommit,pluginCommit)
assert.equal(translations.jarSha256,jarSha256)
assert.deepEqual(translations.browserLocales,[...accessControlLocales])
assert.deepEqual(translations.locales.map(row=>row.locale),[...accessControlSupportedLocales])
assert.deepEqual(translations.excludedBrowserLocales.map(row=>row.locale),accessControlSupportedLocales.filter(locale=>!accessControlLocales.includes(locale)))
for(const row of translations.locales){assert(row.keys>0);for(const key of ['missing','extra','empty','placeholderMismatches'])assert.equal(row[key],0);assert.equal(row.fallbackRequired,false)}
assert(Object.values(translations.sourceHashes).length>=13)
for(const hash of Object.values(translations.sourceHashes))assert(/^[a-f0-9]{64}$/.test(hash))
for (const row of report.ui) {
  assert.equal(row.passed, true, row.case)
  assert.equal(row.skipped, undefined, row.case)
  if (row.case === 'theme-language') {
    assert(['light', 'dark', 'dark-2', 'system'].includes(row.theme), 'Unknown theme')
    assert(accessControlLocales.includes(row.locale), 'Locale outside full business browser policy')
    const key = `${row.theme}:${row.locale}`
    assert(!combinations.has(key), `Duplicate theme/language ${key}`)
    combinations.add(key)
    assert(row.computedStyles && row.translation && row.keyboardFocus && row.noHorizontalOverflow, `Incomplete actual browser evidence ${key}`)
  }
}
assert.equal(combinations.size, 4*accessControlLocales.length, 'Full four-theme English/Chinese browser matrix missing')
console.log(`PASS final composition (${report.profile}): REST ${expectedRows}, required integration ${profileRequiredChecks.length}, browser theme/language ${combinations.size}, translation catalogues ${translations.locales.length}; zero failure/skip`)
