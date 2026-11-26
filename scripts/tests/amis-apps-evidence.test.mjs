import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createAmisP0Recorder} from '../amis-apps-evidence.mjs'
import {amisP0Cases, amisP0NoEffectCases, amisP0ZeroLookupCases} from '../amis-apps-acceptance-cases.mjs'

// Synthetic observer data tests the report schema only, never business acceptance.
const inputs = {rootCommit: 'a'.repeat(40), hostCommit: 'b'.repeat(40), amisCommit: 'c'.repeat(40), rbacCommit: 'd'.repeat(40),
  hostImage: 'ghcr.io/ai-specs/kestra-overlay@sha256:' + 'e'.repeat(64), amisJarSha256: 'f'.repeat(64), rbacJarSha256: 'a'.repeat(64)}
const owner = 'application-projects-bb-123-456'
function setup(synthetic = true) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'amis-recorder-')))
  const directory = join(parent, 'run')
  const recorder = createAmisP0Recorder({directory, inputs, owner, synthetic, clock: () => '2026-11-26T00:00:00Z'})
  return {parent, directory, recorder, report: () => JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8'))}
}
function observation(recorder, id) {
  const result = {evidence: [recorder.captureEvidence(id + '.json', {syntheticObserver: true, authorizationVersion: 1})]}
  if (amisP0ZeroLookupCases.includes(id)) Object.assign(result, {lookups: {namespace: 0, flow: 0, schema: 0, flowAuthorization: 0}, lookupEvidence: 'instrumented-public-contract-probe'})
  if (amisP0NoEffectCases.includes(id)) {
    const hashes = {database: 'a'.repeat(64), storage: 'b'.repeat(64), queue: 'c'.repeat(64)}
    result.sideEffects = {windowMs: 5000, before: hashes, after: {...hashes}}
  }
  return result
}
async function complete(recorder, extraEvidence = []) {
  for (const id of amisP0Cases) await recorder.record(id, () => {
    const observed = observation(recorder, id)
    if (id === amisP0Cases[0]) observed.evidence.push(...extraEvidence)
    return observed
  })
}

test('synthetic 44-case schema run persists initial notRun and validates final evidence', async () => {
  const {recorder, report, directory} = setup()
  assert.equal(amisP0Cases.length, 44)
  assert(report().cases.every(row => row.status === 'notRun'))
  assert.equal(report().status, 'running')
  recorder.journalResource({id: 'owned-test-id', kind: 'container', owner})
  await complete(recorder)
  recorder.markRemoved({id: 'owned-test-id', kind: 'container', owner})
  assert.equal(recorder.finalize().status, 'schema-validated')
  assert.equal(report().synthetic, true)
  assert.equal(report().identityTransport, 'synthetic-observer')
  assert.equal(JSON.parse(readFileSync(join(directory, 'report-final.json'))).summary.passed, 44)
  assert.throws(() => recorder.finalize())
})

test('mid-run failure retains passed/current failed/remaining notRun and throws', async () => {
  const {recorder, report} = setup()
  await recorder.record(amisP0Cases[0], () => observation(recorder, amisP0Cases[0]))
  await assert.rejects(recorder.record(amisP0Cases[1], () => {throw new Error('observer failed')}), /observer failed/)
  assert.deepEqual(report().summary, {passed: 1, failed: 1, skipped: 0, notRun: 42})
  assert.equal(report().status, 'failed')
  assert.throws(() => recorder.finalize())
})

test('out-of-order, duplicate and concurrent records never invoke action', async () => {
  const {recorder} = setup()
  let calls = 0
  await assert.rejects(recorder.record(amisP0Cases[1], () => {calls++}))
  await recorder.record(amisP0Cases[0], () => observation(recorder, amisP0Cases[0]))
  await assert.rejects(recorder.record(amisP0Cases[0], () => {calls++}))
  let release
  const inFlight = recorder.record(amisP0Cases[1], () => new Promise(resolve => {release = resolve}))
  await assert.rejects(recorder.record(amisP0Cases[1], () => {calls++}), /already running/)
  release(observation(recorder, amisP0Cases[1]))
  await inFlight
  assert.equal(calls, 0)
})

test('missing and unregistered evidence fail the active case', async () => {
  for (const observed of [{}, {evidence: [{path: '../outside.json', sha256: 'a'.repeat(64)}]}]) {
    const {recorder, report} = setup()
    await assert.rejects(recorder.record(amisP0Cases[0], () => observed))
    assert.equal(report().cases[0].status, 'failed')
    assert.equal(report().summary.notRun, 43)
  }
})

test('missing observer safety fields fail rather than implicitly pass', async () => {
  for (const missing of ['lookups', 'sideEffects']) {
    const {recorder, report} = setup()
    const target = amisP0Cases.indexOf(amisP0ZeroLookupCases[0])
    for (const id of amisP0Cases.slice(0, target)) await recorder.record(id, () => observation(recorder, id))
    await assert.rejects(recorder.record(amisP0Cases[target], () => {
      const observed = observation(recorder, amisP0Cases[target]); delete observed[missing]; return observed
    }))
    assert.equal(report().cases[target].status, 'failed')
  }
})

test('sensitive keys, unsafe paths, overwrite and symlink run directory are rejected', () => {
  const {recorder, parent, directory} = setup()
  for (const key of ['password', 'accessToken', 'cookie', 'secret', 'authorizationHeader']) {
    assert.throws(() => recorder.captureEvidence('unsafe.json', {nested: {[key]: 'never saved'}}), /Sensitive/)
  }
  for (const name of ['/tmp/escape.json', '../escape.json', 'sub/file.json', 'report.json']) {
    assert.throws(() => recorder.captureEvidence(name, {value: true}))
  }
  recorder.captureEvidence('valid.json', {authorizationVersion: 1, tokenExpiredExpected: true, csrfSha: 'a'.repeat(64), actorClaimsMetadata: {issuer: 'test'}})
  assert.throws(() => recorder.captureEvidence('valid.json', {value: true}))
  const outside = join(parent, 'outside.json')
  writeFileSync(outside, '{}')
  symlinkSync(outside, join(directory, 'linked.json'))
  assert.throws(() => recorder.captureEvidence('linked.json', {value: true}))
  assert.equal(readFileSync(outside, 'utf8'), '{}')
  assert.throws(() => createAmisP0Recorder({directory, inputs, owner}))
  const link = join(parent, 'link'); symlinkSync(directory, link)
  assert.throws(() => createAmisP0Recorder({directory: join(link, 'escape'), inputs, owner}))
})

test('production finalization requires explicit login and inspected owner evidence references', async () => {
  for (const provide of [false, true]) {
    const {recorder, report} = setup(false)
    recorder.journalResource({id: 'owned', kind: 'container', owner})
    const verifiedTransportEvidence = provide ? {
      productionLogin: recorder.captureEvidence('login.json', {testData: true, authenticated: true}),
      inspectedOwner: recorder.captureEvidence('owner.json', {testData: true, owner})
    } : undefined
    await complete(recorder, provide ? Object.values(verifiedTransportEvidence) : [])
    recorder.markRemoved({id: 'owned', kind: 'container', owner})
    if (!provide) {
      assert.throws(() => recorder.finalize(), /transport evidence required/)
      assert.equal(report().status, 'failed')
      assert.equal(report().identityTransport, 'unverified')
    } else {
      // Synthetic test data for reference plumbing only; no production login is performed here.
      assert.equal(recorder.finalize({verifiedTransportEvidence}).status, 'passed')
    }
  }
})

test('production transport must have distinct case-registered references, capture alone is insufficient', async () => {
  for (const variant of ['unregistered', 'same-reference']) {
    const {recorder, report} = setup(false)
    recorder.journalResource({id:'owned',kind:'container',owner})
    const login = recorder.captureEvidence('login.json',{testData:true})
    const inspected = recorder.captureEvidence('owner.json',{testData:true,owner})
    const references = {productionLogin:login,inspectedOwner:variant==='same-reference'?login:inspected}
    await complete(recorder,variant==='unregistered'?[]:[login])
    recorder.markRemoved({id:'owned',kind:'container',owner})
    assert.throws(()=>recorder.finalize({verifiedTransportEvidence:references}))
    assert.equal(report().status,'failed')
  }
})

test('unclean resources and tampered evidence prevent final pass', async () => {
  for (const tamper of [false, true]) {
    const {recorder, directory, report} = setup()
    assert.throws(() => recorder.journalResource({id: 'foreign', kind: 'container', owner: 'other'}))
    recorder.journalResource({id: 'owned', kind: 'container', owner})
    await complete(recorder)
    if (tamper) {
      recorder.markRemoved({id: 'owned', kind: 'container', owner})
      writeFileSync(join(directory, amisP0Cases[0] + '.json'), '{}')
    }
    assert.throws(() => recorder.finalize())
    assert.equal(report().status, 'failed')
    assert.equal(report().completed, false)
    assert.throws(() => recorder.finalize())
  }
})
