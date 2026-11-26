import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {amisP0Cases, amisP0NoEffectCases, amisP0ZeroLookupCases} from '../amis-apps-acceptance-cases.mjs'
import {validateAmisP0Report, verifyAmisEvidenceFiles} from '../check-amis-apps-report.mjs'

function reportFixture() {
  const digest = 'a'.repeat(64)
  const inputs = {
    rootCommit: '1'.repeat(40), hostCommit: '2'.repeat(40), amisCommit: '3'.repeat(40), rbacCommit: '4'.repeat(40),
    hostImage: `ghcr.io/ai-specs/kestra-overlay@sha256:${digest}`,
    amisJarSha256: digest, rbacJarSha256: 'b'.repeat(64),
  }
  return {
    schemaVersion: 1, stage: 'P0', status: 'passed', completed: true, synthetic: false,
    identityTransport: 'production-oidc', inputs,
    verifiedTransportEvidence: {
      productionLogin: {path: `cases/${amisP0Cases[0]}.json`, sha256: digest},
      inspectedOwner: {path: `cases/${amisP0Cases[1]}.json`, sha256: digest},
    },
    cases: amisP0Cases.map(id => ({
      id, status: 'passed', evidence: [{path: `cases/${id}.json`, sha256: digest}],
      ...(amisP0ZeroLookupCases.includes(id) ? {
        lookups: {namespace: 0, flow: 0, schema: 0, flowAuthorization: 0},
        lookupEvidence: 'instrumented-public-contract-probe',
      } : {}),
      ...(amisP0NoEffectCases.includes(id) ? {
        sideEffects: {windowMs: 5000, before: {database: digest, storage: digest, queue: digest},
          after: {database: digest, storage: digest, queue: digest}},
      } : {}),
    })),
    resources: {owner: 'checker-test', retained: [], created: [{owner: 'checker-test', removed: true}]},
    summary: {passed: amisP0Cases.length, failed: 0, skipped: 0, notRun: 0},
  }
}

test('checker accepts a structurally complete unit-test report, not production evidence', () => {
  const report = reportFixture()
  assert.equal(validateAmisP0Report(report, report.inputs).passed, amisP0Cases.length)
})

const invalidReports = {
  'omitted case': report => report.cases.pop(),
  'duplicate case': report => { report.cases[1] = structuredClone(report.cases[0]) },
  'out-of-order case': report => report.cases.reverse(),
  'skipped case': report => { report.cases[0].status = 'skipped' },
  'not completed': report => { report.completed = false },
  'test transport': report => { report.identityTransport = 'test' },
  'missing transport registration': report => { delete report.verifiedTransportEvidence },
  'missing production login': report => { delete report.verifiedTransportEvidence.productionLogin },
  'missing inspected owner': report => { delete report.verifiedTransportEvidence.inspectedOwner },
  'single forged transport reference': report => { report.verifiedTransportEvidence = {productionLogin: report.verifiedTransportEvidence.productionLogin} },
  'same reference reused for login and owner': report => { report.verifiedTransportEvidence.inspectedOwner = {...report.verifiedTransportEvidence.productionLogin} },
  'unregistered transport path': report => { report.verifiedTransportEvidence.inspectedOwner.path = 'other-evidence.json' },
  'transport leaves evidence directory': report => { report.verifiedTransportEvidence.inspectedOwner.path = '../outside.json' },
  'absolute transport path': report => { report.verifiedTransportEvidence.inspectedOwner.path = '/tmp/owner.json' },
  'invalid transport hash': report => { report.verifiedTransportEvidence.inspectedOwner.sha256 = 'not-a-hash' },
  'different registered transport hash': report => { report.verifiedTransportEvidence.inspectedOwner.sha256 = 'c'.repeat(64) },
  'conflicting case evidence registration': report => { report.cases[1].evidence.push({...report.cases[0].evidence[0], sha256: 'c'.repeat(64)}) },
  'explicitly synthetic': report => { report.synthetic = true },
  'missing evidence': report => { report.cases[0].evidence = [] },
  'evidence traversal': report => { report.cases[0].evidence[0].path = '../other-owner/evidence.json' },
  'invalid hash': report => { report.cases[0].evidence[0].sha256 = 'tag' },
  'lookup before entry denial': report => { report.cases[6].lookups.flow = 1 },
  'uninstrumented zero lookup': report => { report.cases[6].lookupEvidence = 'assumed' },
  'missing side-effect observation': report => { delete report.cases[6].sideEffects },
  'unobserved delayed effects': report => { report.cases[6].sideEffects.windowMs = 4999 },
  'storage side effect': report => { report.cases[6].sideEffects.after.storage = 'b'.repeat(64) },
  'retained resource': report => { report.resources.retained.push('test-container') },
  'unremoved resource': report => { report.resources.created[0].removed = false },
  'wrong resource owner': report => { report.resources.created[0].owner = 'other-owner' },
  'tag instead of digest': report => { report.inputs.hostImage = 'ghcr.io/ai-specs/kestra-overlay:latest' },
  'incorrect totals': report => { report.summary.passed++ },
}

for (const [name, mutate] of Object.entries(invalidReports)) {
  test(`checker rejects ${name}`, () => {
    const report = reportFixture()
    const expected = structuredClone(report.inputs)
    mutate(report)
    assert.throws(() => validateAmisP0Report(report, expected))
  })
}

test('checker rejects an old root submission even if every case passed', () => {
  const report = reportFixture()
  assert.throws(() => validateAmisP0Report(report, {...report.inputs, rootCommit: '5'.repeat(40)}))
})

test('evidence verification checks actual bytes, missing files and symlink escape', context => {
  const area = mkdtempSync(join(tmpdir(), 'amis-checker-test-'))
  context.after(() => rmSync(area, {recursive: true, force: true}))
  const evidence = 'unit-test evidence, not an acceptance result\n'
  const hash = createHash('sha256').update(evidence).digest('hex')
  const report = {cases: [{id: 'unit-test-only', evidence: [{path: 'evidence.json', sha256: hash}]}]}
  writeFileSync(join(area, 'evidence.json'), evidence)
  assert.equal(verifyAmisEvidenceFiles(report, area), 1)
  writeFileSync(join(area, 'evidence.json'), 'changed')
  assert.throws(() => verifyAmisEvidenceFiles(report, area), /bytes differ/)
  rmSync(join(area, 'evidence.json'))
  assert.throws(() => verifyAmisEvidenceFiles(report, area))
  symlinkSync(join(tmpdir()), join(area, 'outside'))
  report.cases[0].evidence[0].path = 'outside'
  assert.throws(() => verifyAmisEvidenceFiles(report, area), /escapes report directory/)
})

test('registered transport evidence is checked against real bytes and cannot name an unregistered file', context => {
  const area = mkdtempSync(join(tmpdir(), 'amis-transport-checker-test-'))
  context.after(() => rmSync(area, {recursive: true, force: true}))
  const reference = (path, bytes) => {
    writeFileSync(join(area, path), bytes)
    return {path, sha256: createHash('sha256').update(bytes).digest('hex')}
  }
  const login = reference('login.json', 'synthetic login observation\n')
  const owner = reference('owner.json', 'synthetic inspected owner\n')
  const report = {cases: [{id: 'unit-test-only', evidence: [login, owner]}],
    verifiedTransportEvidence: {productionLogin: {...login}, inspectedOwner: {...owner}}}
  assert.equal(verifyAmisEvidenceFiles(report, area), 2)
  writeFileSync(join(area, 'owner.json'), 'tampered')
  assert.throws(() => verifyAmisEvidenceFiles(report, area), /bytes differ/)
  report.verifiedTransportEvidence.inspectedOwner = reference('unregistered.json', 'exists but unregistered\n')
  assert.throws(() => verifyAmisEvidenceFiles(report, area), /unregistered transport evidence/)
})
