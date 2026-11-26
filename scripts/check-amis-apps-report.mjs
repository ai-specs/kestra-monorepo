import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync, realpathSync} from 'node:fs'
import {dirname, resolve, sep} from 'node:path'
import {pathToFileURL} from 'node:url'
import {amisP0Cases, amisP0NoEffectCases, amisP0ZeroLookupCases} from './amis-apps-acceptance-cases.mjs'

const sha256 = /^[a-f0-9]{64}$/
const commit = /^[a-f0-9]{40}$/
const image = /^ghcr\.io\/ai-specs\/kestra-overlay@sha256:[a-f0-9]{64}$/

function validateEvidenceReference(evidence, label) {
  assert(evidence && typeof evidence === 'object' && !Array.isArray(evidence), `${label}: missing evidence reference`)
  assert.equal(typeof evidence.path, 'string')
  assert(evidence.path.length > 0 && !evidence.path.startsWith('/') && !evidence.path.includes('\\')
    && !evidence.path.split('/').some(part => part === '..' || part === '.' || part === '')
    && !evidence.path.includes(':'), `${label}: invalid evidence path`)
  assert(typeof evidence.sha256 === 'string' && sha256.test(evidence.sha256), `${label}: invalid evidence hash`)
}

function registeredEvidence(cases) {
  const registered = new Map()
  for (const row of cases) for (const reference of row.evidence ?? []) {
    validateEvidenceReference(reference, row.id)
    if (registered.has(reference.path))
      assert.equal(registered.get(reference.path), reference.sha256, `${row.id}: conflicting evidence registration`)
    registered.set(reference.path, reference.sha256)
  }
  return registered
}

function validateTransportEvidence(report) {
  const registered = registeredEvidence(report.cases)
  const transport = report.verifiedTransportEvidence
  assert(transport && typeof transport === 'object' && !Array.isArray(transport), 'Verified production transport evidence required')
  for (const name of ['productionLogin', 'inspectedOwner']) {
    const reference = transport[name]
    validateEvidenceReference(reference, name)
    assert(registered.has(reference.path), `${name}: unregistered transport evidence`)
    assert.equal(registered.get(reference.path), reference.sha256, `${name}: transport evidence hash differs`)
  }
  assert.notEqual(transport.productionLogin.path, transport.inspectedOwner.path,
    'Production login and inspected owner require distinct evidence references')
}

export function validateAmisP0Report(report, expected) {
  assert.equal(report.schemaVersion, 1)
  assert.equal(report.stage, 'P0')
  assert.equal(report.status, 'passed')
  assert.equal(report.completed, true)
  assert.equal(report.synthetic, false)
  assert.equal(report.identityTransport, 'production-oidc')
  assert.deepEqual(report.inputs, expected, 'Report inputs differ from selected deployment')
  for (const key of ['rootCommit', 'hostCommit', 'amisCommit', 'rbacCommit']) {
    assert.equal(typeof expected[key], 'string')
    assert(commit.test(expected[key]), `Invalid ${key}`)
  }
  assert(image.test(expected.hostImage), 'Immutable formal host image required')
  for (const key of ['amisJarSha256', 'rbacJarSha256']) {
    assert(sha256.test(expected[key]), `Invalid ${key}`)
  }
  assert.deepEqual(report.cases.map(row => row.id), amisP0Cases, 'Exact ordered P0 matrix required')
  for (const row of report.cases) {
    assert.equal(row.status, 'passed', row.id)
    assert(Array.isArray(row.evidence) && row.evidence.length > 0, `${row.id}: missing evidence`)
    for (const evidence of row.evidence) {
      validateEvidenceReference(evidence, row.id)
    }
    if (amisP0ZeroLookupCases.includes(row.id)) {
      assert.deepEqual(row.lookups, {namespace: 0, flow: 0, schema: 0, flowAuthorization: 0}, `${row.id}: lookup occurred`)
      assert.equal(row.lookupEvidence, 'instrumented-public-contract-probe')
    }
    if (amisP0NoEffectCases.includes(row.id)) {
      assert(Number.isFinite(row.sideEffects?.windowMs) && row.sideEffects.windowMs >= 5000,
        `${row.id}: bounded delayed side-effect observation required`)
      for (const scope of ['database', 'storage', 'queue']) {
        assert(sha256.test(row.sideEffects.before?.[scope]), `${row.id}: missing before ${scope}`)
        assert.equal(row.sideEffects.after?.[scope], row.sideEffects.before[scope], `${row.id}: changed ${scope}`)
      }
    }
  }
  validateTransportEvidence(report)
  assert.deepEqual(report.resources.retained, [])
  assert.equal(typeof report.resources.owner, 'string')
  assert(report.resources.owner.length > 0)
  assert(report.resources.created.length > 0)
  assert(report.resources.created.every(resource => resource.owner === report.resources.owner && resource.removed === true))
  assert.deepEqual(report.summary, {passed: amisP0Cases.length, failed: 0, skipped: 0, notRun: 0})
  return {stage: 'P0', ...report.summary}
}

export function verifyAmisEvidenceFiles(report, evidenceDirectory) {
  // Partial recorder checks remain supported; any supplied transport references
  // must still point at registered evidence. Full P0 validation requires them.
  if (report.verifiedTransportEvidence !== undefined) validateTransportEvidence(report)
  const root = realpathSync(evidenceDirectory)
  const paths = new Map()
  for (const row of report.cases) {
    for (const evidence of row.evidence) {
      const path = realpathSync(resolve(root, evidence.path))
      assert(path.startsWith(root + sep), `${row.id}: evidence escapes report directory`)
      const digest = createHash('sha256').update(readFileSync(path)).digest('hex')
      assert.equal(digest, evidence.sha256, `${row.id}: evidence bytes differ`)
      if (paths.has(path)) assert.equal(paths.get(path), digest)
      paths.set(path, digest)
    }
  }
  return paths.size
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [reportPath, inputsPath] = process.argv.slice(2)
  assert(reportPath && inputsPath, 'Usage: node scripts/check-amis-apps-report.mjs REPORT INPUTS')
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  const expected = JSON.parse(readFileSync(inputsPath, 'utf8'))
  const summary = validateAmisP0Report(report, expected)
  const evidenceFiles = verifyAmisEvidenceFiles(report, dirname(resolve(reportPath)))
  console.log(JSON.stringify({...summary, evidenceFiles}))
}
