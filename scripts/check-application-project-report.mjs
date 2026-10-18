#!/usr/bin/env node
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {projectScopeCases, requiredProjectChecks, applicationProject} from './application-project-cases.mjs'

const [file, image, jarSha256, rootCommit, overlayCommit, pluginCommit] = process.argv.slice(2)
assert(file && /^ghcr\.io\/ai-specs\/kestra-overlay@sha256:[0-9a-f]{64}$/.test(image ?? ''), 'Explicit immutable image required')
assert(/^[0-9a-f]{64}$/.test(jarSha256 ?? ''), 'Explicit jar SHA-256 required')
for (const commit of [rootCommit, overlayCommit, pluginCommit]) assert(/^[0-9a-f]{40}$/.test(commit ?? ''), 'Explicit final commit required')
const content = readFileSync(file, 'utf8')
assert(!/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(content), 'Report contains a credential-shaped JWT')
const report = JSON.parse(content)
assert.equal(report.schemaVersion, 1)
assert.equal(report.completed, true, 'Acceptance did not complete')
assert.equal(report.nonFinal, false, 'Development evidence cannot satisfy final acceptance')
assert.equal(report.development?.allowDirtyRoot, false, 'Final acceptance requires committed sources')
assert.equal(report.notRun, 0, 'Required checks remain unexecuted')
assert.equal(report.mode, 'run', 'Static and configuration checks are not acceptance')
assert(report.stages?.some(stage => stage.id === 'publication-gate' && stage.status === 'passed'), 'Formal artifact publication gate missing')
for (const [name, commit] of [['overlay', overlayCommit], ['plugin', pluginCommit]]) {
  const source = report.sources?.[name]
  assert.equal(source?.dirty, false, `${name}: uncommitted independent source`)
  assert.equal(source.ci?.headSha, commit, `${name}: CI does not match final source`)
  assert.equal(source.ci?.status, 'completed')
  assert.equal(source.ci?.conclusion, 'success')
}
assert.deepEqual(report.inputs, {image, jarSha256, rootCommit, overlayCommit, pluginCommit}, 'Report inputs differ from the final composition')
assert.equal(report.failures, 0)
assert.equal(report.skipped, 0)
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
  assert.equal(row.identity.project, applicationProject, label)
  assert(typeof row.identity.subject === 'string' && row.identity.subject.length, label)
  assert(typeof row.identity.issuer === 'string' && row.identity.issuer.startsWith('http'), label)
  assert(Array.isArray(row.identity.audiences) && row.identity.audiences.length, label)
  assert.deepEqual([...row.identity.projectScopes].sort(), [...testCase.scopes].sort(), label)
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
for (const required of requiredProjectChecks) assert(checks.has(required), `Missing required integration check ${required}`)
const combinations = new Set()
for (const row of report.ui) {
  assert.equal(row.passed, true, row.case)
  assert.equal(row.skipped, undefined, row.case)
  if (row.case === 'theme-language') {
    assert(['light', 'dark', 'dark-2', 'system'].includes(row.theme), 'Unknown theme')
    assert(['en', 'de', 'es', 'fr', 'hi', 'it', 'ja', 'ko', 'pl', 'pt', 'pt_BR', 'ru', 'zh_CN'].includes(row.locale), 'Unknown locale')
    const key = `${row.theme}:${row.locale}`
    assert(!combinations.has(key), `Duplicate theme/language ${key}`)
    combinations.add(key)
    assert(row.computedStyles && row.translation && row.keyboardFocus && row.noHorizontalOverflow, `Incomplete actual browser evidence ${key}`)
  }
}
assert.equal(combinations.size, 52, 'Full four-theme, thirteen-language browser matrix missing')
console.log(`PASS final composition: REST ${expectedRows}, required integration ${requiredProjectChecks.length}, browser theme/language 52; zero failure/skip`)
