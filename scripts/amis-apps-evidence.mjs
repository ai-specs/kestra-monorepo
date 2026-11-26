import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdirSync, realpathSync, writeFileSync, renameSync} from 'node:fs'
import {dirname, resolve, isAbsolute} from 'node:path'
import {amisP0Cases, amisP0NoEffectCases, amisP0ZeroLookupCases} from './amis-apps-acceptance-cases.mjs'
import {validateAmisP0Report, verifyAmisEvidenceFiles} from './check-amis-apps-report.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const digest = /^[a-f0-9]{64}$/
const sensitiveKeys = new Set(['password', 'passwd', 'token', 'accesstoken', 'refreshtoken', 'idtoken', 'csrftoken',
  'cookie', 'cookies', 'setcookie', 'secret', 'clientsecret', 'authorization', 'authorizationheader'])

function safeObject(value) {
  assert(value && typeof value === 'object', 'Evidence object required')
  const visit = object => {
    for (const [key, child] of Object.entries(object)) {
      assert(!sensitiveKeys.has(key.toLowerCase().replace(/[-_]/g, '')), 'Sensitive evidence key rejected')
      if (child && typeof child === 'object') visit(child)
    }
  }
  visit(value)
  return JSON.stringify(value, null, 2) + '\n'
}

export function createAmisP0Recorder({directory, inputs, owner, synthetic, clock = () => new Date().toISOString()}) {
  assert.equal(typeof synthetic, 'boolean', 'Explicit synthetic state required')
  assert.match(owner, /^application-projects-bb-[0-9]+-[0-9]+$/)
  for (const key of ['rootCommit', 'hostCommit', 'amisCommit', 'rbacCommit']) assert.match(inputs[key], /^[a-f0-9]{40}$/)
  for (const key of ['amisJarSha256', 'rbacJarSha256']) assert.match(inputs[key], digest)
  assert.match(inputs.hostImage, /^ghcr\.io\/ai-specs\/kestra-overlay@sha256:[a-f0-9]{64}$/)
  safeObject(inputs)
  const root = resolve(directory)
  assert.equal(realpathSync(dirname(root)), dirname(root), 'Symlink parent forbidden')
  mkdirSync(root, {mode: 0o700}) // Existing run directories are never reused.
  const report = {schemaVersion: 1, stage: 'P0', status: 'running', completed: false,
    synthetic, identityTransport: synthetic ? 'synthetic-observer' : 'unverified', inputs: structuredClone(inputs),
    cases: amisP0Cases.map(id => ({id, status: 'notRun', evidence: []})),
    resources: {owner, created: [], retained: []}, summary: {passed: 0, failed: 0, skipped: 0, notRun: amisP0Cases.length}}
  let busy = false
  let sealed = false
  const captures = new Map()
  function persist() {
    report.updatedAt = clock()
    report.summary = {passed: report.cases.filter(row => row.status === 'passed').length,
      failed: report.cases.filter(row => row.status === 'failed').length, skipped: 0,
      notRun: report.cases.filter(row => row.status === 'notRun').length}
    writeFileSync(resolve(root, 'report.next'), JSON.stringify(report, null, 2) + '\n', {mode: 0o600})
    renameSync(resolve(root, 'report.next'), resolve(root, 'report.json'))
  }
  function open() { assert(!sealed && report.status === 'running', 'Run is closed') }
  function captureEvidence(name, object) {
    open()
    assert(typeof name === 'string' && !isAbsolute(name) && /^[A-Za-z0-9_-]+\.json$/.test(name)
      && !['report.json', 'report-final.json'].includes(name), 'Safe new evidence filename required')
    const bytes = safeObject(object)
    writeFileSync(resolve(root, name), bytes, {mode: 0o600, flag: 'wx'})
    const reference = {path: name, sha256: hash(bytes)}
    captures.set(name, reference.sha256)
    return reference
  }
  function validateRow(row) {
    assert(Array.isArray(row.evidence) && row.evidence.length > 0, 'Evidence required')
    for (const evidence of row.evidence) {
      assert(captures.has(evidence.path), 'Unregistered evidence')
      assert.equal(captures.get(evidence.path), evidence.sha256, 'Unregistered evidence')
    }
    if (amisP0ZeroLookupCases.includes(row.id)) {
      assert.deepEqual(row.lookups, {namespace: 0, flow: 0, schema: 0, flowAuthorization: 0})
      assert.equal(row.lookupEvidence, 'instrumented-public-contract-probe')
    }
    if (amisP0NoEffectCases.includes(row.id)) {
      assert(Number.isFinite(row.sideEffects?.windowMs) && row.sideEffects.windowMs >= 5000)
      for (const scope of ['database', 'storage', 'queue']) {
        assert.match(row.sideEffects.before?.[scope], digest)
        assert.equal(row.sideEffects.after?.[scope], row.sideEffects.before[scope])
      }
    }
  }
  async function record(id, action) {
    open()
    assert(!busy, 'Case already running')
    const row = report.cases.find(candidate => candidate.status === 'notRun')
    assert.equal(row?.id, id, 'Exact ordered once-only case execution required')
    assert.equal(typeof action, 'function')
    busy = true
    try {
      const observed = await action({captureEvidence})
      safeObject(observed)
      const candidate = {...structuredClone(observed), id, status: 'passed'}
      validateRow(candidate)
      Object.assign(row, candidate)
      persist()
      return structuredClone(row)
    } catch (error) {
      row.status = 'failed'
      report.status = 'failed'
      persist()
      throw error
    } finally { busy = false }
  }
  function journalResource({id, kind, owner: resourceOwner}) {
    open()
    assert.equal(resourceOwner, owner, 'Resource owner mismatch')
    assert(typeof id === 'string' && id.length > 0 && typeof kind === 'string' && kind.length > 0)
    assert(!report.resources.created.some(resource => resource.id === id && resource.kind === kind))
    report.resources.created.push({id, kind, owner, removed: false})
    persist()
  }
  function markRemoved({id, kind, owner: resourceOwner}) {
    assert(!sealed)
    assert.equal(resourceOwner, owner)
    const resource = report.resources.created.find(item => item.id === id && item.kind === kind)
    assert(resource && !resource.removed, 'Known unremoved resource required')
    resource.removed = true
    persist()
  }
  function finalize({verifiedTransportEvidence} = {}) {
    assert(!sealed && !busy)
    try {
      const final = {...structuredClone(report), status: 'passed', completed: true}
      if (!synthetic) {
        assert(verifiedTransportEvidence, 'Verified production transport evidence required')
        const references = ['productionLogin', 'inspectedOwner'].map(key => {
          const reference = verifiedTransportEvidence[key]
          assert(reference && captures.has(reference.path), `Missing registered ${key} evidence`)
          assert.equal(captures.get(reference.path), reference.sha256)
          return reference
        })
        verifyAmisEvidenceFiles({cases: [{id: 'verified-transport', evidence: references}]}, root)
        final.verifiedTransportEvidence = structuredClone(verifiedTransportEvidence)
        final.identityTransport = 'production-oidc'
        validateAmisP0Report(final, inputs)
      } else {
        // Explicit synthetic files exercise the same registration and byte gates.
        // They never assert a production login or produce a saved production pass.
        const references = {
          productionLogin: captureEvidence('synthetic-login-reference.json', {synthetic: true, purpose: 'login-reference-schema-test'}),
          inspectedOwner: captureEvidence('synthetic-owner-reference.json', {synthetic: true, purpose: 'owner-reference-schema-test'})
        }
        final.cases[0].evidence.push(...Object.values(references))
        final.verifiedTransportEvidence = references
        validateAmisP0Report({...final, synthetic: false, identityTransport: 'production-oidc'}, inputs)
        final.status = 'schema-validated'
      }
      verifyAmisEvidenceFiles(final, root)
      Object.assign(report, final)
      persist()
      writeFileSync(resolve(root, 'report-final.json'), JSON.stringify(report, null, 2) + '\n', {mode: 0o600, flag: 'wx'})
      sealed = true
      return structuredClone(report)
    } catch (error) {
      report.status = 'failed'
      report.completed = false
      persist()
      writeFileSync(resolve(root, 'report-final.json'), JSON.stringify(report, null, 2) + '\n', {mode: 0o600, flag: 'wx'})
      sealed = true
      throw error
    }
  }
  persist()
  return {record, captureEvidence, journalResource, markRemoved, finalize}
}
