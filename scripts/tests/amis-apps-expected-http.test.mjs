import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {amisFaultVariants} from '../amis-apps-fault-cases.mjs'
import {classifyAmisNativePath} from '../amis-apps-native-cases.mjs'

// Pure configuration regression, not HTTP execution or production acceptance.
const expected = JSON.parse(readFileSync(new URL('../amis-apps-expected-http.json', import.meta.url), 'utf8'))
const paths = ['/ui/main/page/x', '/ui-extensions/app/pages/x', '/api/v1/api/x', '/oidc/app/pages/x',
  '/oauth/app/pages/x', '/.well-known/app/pages/x', '/static/app/pages/x', '/swagger/app/pages/x', '/ping']
const kinds = ['ui', 'ui-extensions', 'api', 'oidc', 'oauth', '.well-known', 'static', 'swagger', 'ping']
const modes = ['A', 'B']
const missing = new Set(['missing-extension', 'disabled-extension', 'missing-route-provider'])

function validate(value) {
  assert.equal(value.schemaVersion, 1)
  assert.equal(value.stage, 'P0')
  assert.equal(value.status, 'fixed-source-and-main-observed-expectations')
  assert.equal(value.zeroGrantDenialText, 'Access denied')
  assert.deepEqual(value.pendingAdjudication, [])
  for (const field of ['nativeCases', 'faultStatuses', 'faultNativeCases']) {
    assert.deepEqual(Object.keys(value[field]).sort(), modes)
  }
  const matrix = (rows, mode, fault) => {
    assert(Array.isArray(rows))
    assert.equal(rows.length, 9)
    assert.deepEqual(rows.map(row => row.path), paths)
    assert.deepEqual(rows.map(row => classifyAmisNativePath(row.path)), kinds)
    for (const [index, row] of rows.entries()) {
      assert.equal(new URL(row.path, 'https://native.invalid').origin, 'https://native.invalid')
      assert(!row.path.startsWith('/company.amis'), 'Native probe must not target AMIS business')
      const invalidSession = mode === 'B' && fault === 'missing-authorization'
      const status = invalidSession ? [307, 400, 401, 401, 403, 403, 401, 401, 401][index]
        : index === 0 || index === 8 ? 200 : index === 1 ? 400 : mode === 'A' ? 404 : 403
      assert(Number.isInteger(row.status), 'Unresolved native status')
      assert.equal(row.status, status)
      const redirect = invalidSession && index === 0
      assert.equal(row.contentType, redirect ? null : index === 0 ? 'text/html'
        : index === 8 && !invalidSession ? 'application/json' : 'application/problem+json')
      if (redirect) {
        assert.equal(row.location, '/oidc/logout')
        assert.equal(row.marker, undefined)
      } else {
        // Null Location explicitly means no response header, not an unresolved expectation.
        assert(row.location === undefined || row.location === null, 'Unexpected native redirect')
        if (index === 0) assert.equal(row.marker, 'id="app"')
        else assert.equal(row.marker, undefined)
      }
    }
  }
  for (const mode of modes) {
    matrix(value.nativeCases[mode], mode)
    const faults = amisFaultVariants(mode).map(row => row.name)
    assert.equal(faults.length, mode === 'A' ? 6 : 9)
    assert.deepEqual(Object.keys(value.faultStatuses[mode]).sort(), [...faults].sort())
    assert.deepEqual(Object.keys(value.faultNativeCases[mode]).sort(), [...faults].sort())
    for (const fault of faults) {
      const status = missing.has(fault) ? mode === 'A' ? 404 : 403
        : fault === 'missing-authorization' ? 401 : 503
      assert(Number.isInteger(value.faultStatuses[mode][fault]), 'Unresolved fault status')
      assert.equal(value.faultStatuses[mode][fault], status)
      matrix(value.faultNativeCases[mode][fault], mode, fault)
    }
  }
}

test('fixed formal expected HTTP has exact schema/P0, native9, A6/B9 faults and denial text', () => {
  validate(expected)
})

const mutations = [
  ['schema version', value => { value.schemaVersion = 2 }],
  ['missing schema version', value => { delete value.schemaVersion }],
  ['non-P0 stage', value => { value.stage = 'P1' }],
  ['unadjudicated status', value => { value.status = 'pending' }],
  ['pending adjudication', value => { value.pendingAdjudication = [{field: 'faultStatuses.B'}] }],
  ['wrong denial text', value => { value.zeroGrantDenialText = 'Forbidden' }],
  ['missing mode', value => { delete value.nativeCases.B }],
  ['extra mode', value => { value.faultStatuses.C = {} }],
  ['missing native path', value => { value.nativeCases.A.pop() }],
  ['duplicate native path', value => { value.nativeCases.B[1] = value.nativeCases.B[0] }],
  ['reordered native path', value => { value.nativeCases.A.reverse() }],
  ['AMIS business instead of native', value => { value.nativeCases.B[0].path = '/company.amis.a/greeting/pages/home' }],
  ['foreign native origin', value => { value.nativeCases.A[0].path = 'https://foreign.invalid/ui/main/page/x' }],
  ['different reserved target', value => { value.nativeCases.A[1].path = '/ui-extensions/other/pages/x' }],
  ['null native status', value => { value.nativeCases.B[2].status = null }],
  ['null healthy MIME', value => { value.nativeCases.A[0].contentType = null }],
  ['missing SPA marker', value => { delete value.nativeCases.B[0].marker }],
  ['wrong ping MIME', value => { value.nativeCases.B[8].contentType = 'text/html' }],
  ['missing fault', value => { delete value.faultStatuses.A.overlap }],
  ['extra fault', value => { value.faultStatuses.A['missing-authorization'] = 401 }],
  ['missing fault matrix', value => { delete value.faultNativeCases.B['duplicate-authorization'] }],
  ['short fault matrix', value => { value.faultNativeCases.B.overlap.pop() }],
  ['null fault status', value => { value.faultStatuses.B['missing-extension'] = null }],
  ['B missing extension404', value => { value.faultStatuses.B['missing-extension'] = 404 }],
  ['A missing extension403', value => { value.faultStatuses.A['missing-extension'] = 403 }],
  ['missing RBAC503 instead of401', value => { value.faultStatuses.B['missing-authorization'] = 503 }],
  ['duplicate authorization401 instead of503', value => { value.faultStatuses.B['duplicate-authorization'] = 401 }],
  ['overlap403 instead of503', value => { value.faultStatuses.A.overlap = 403 }],
  ['healthy native globally503', value => { value.faultNativeCases.B['duplicate-authorization'][8].status = 503 }],
  ['missing RBAC ping200', value => { value.faultNativeCases.B['missing-authorization'][8].status = 200 }],
  ['redirect login instead of logout', value => { value.faultNativeCases.B['missing-authorization'][0].location = '/oidc/login' }],
  ['external redirect', value => { value.faultNativeCases.B['missing-authorization'][0].location = 'https://foreign.invalid/oidc/logout' }],
  ['protocol-relative redirect', value => { value.faultNativeCases.B['missing-authorization'][0].location = '//foreign.invalid/oidc/logout' }],
  ['redirect query', value => { value.faultNativeCases.B['missing-authorization'][0].location = '/oidc/logout?target=/ui' }],
  ['redirect MIME not absent', value => { value.faultNativeCases.B['missing-authorization'][0].contentType = 'text/html' }],
  ['redirect target absent', value => { value.faultNativeCases.B['missing-authorization'][0].location = null }],
  ['null MIME on nonredirect fault', value => { value.faultNativeCases.B['missing-authorization'][1].contentType = null }],
  ['unexpected healthy redirect', value => { value.nativeCases.A[0].location = '/oidc/logout' }],
]

for (const [name, mutate] of mutations) test(`pure negative configuration rejects ${name}`, () => {
  const value = structuredClone(expected)
  mutate(value)
  assert.throws(() => validate(value))
})
