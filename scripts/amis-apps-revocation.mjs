import assert from 'node:assert/strict'
import {ProductionOAuthClient} from './production-oauth-client.mjs'

const prefix = '/api/v1/main/extensions/rbac'
const groupIdentifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const permissionIdentifier = /^[a-z][a-z0-9-]{0,127}$/

export function createAmisRevocationControls({base, admin, groupId = 'main', client = new ProductionOAuthClient(base)}) {
  assert.equal(new URL(base).origin, base)
  assert(admin?.username && admin?.password && groupIdentifier.test(groupId))
  const root = prefix + '/application-groups/' + groupId
  const application = root + '/applications/~' + Buffer.from('kestra-ui').toString('base64url')
  const operations = new Map()
  const events = []
  async function fresh() {
    const response = await client.request('/oidc/logout')
    assert([200, 302, 303, 307].includes(response.status))
    if (response.status === 307) assert.equal(new URL(response.headers.get('location'), base).href, base + '/ui/')
    await response.body?.cancel()
    const result = await client.login(admin.username, admin.password)
    assert(result.authenticated && result.credentialsSubmitted)
  }
  async function request(path, {method = 'GET', body, revision} = {}) {
    assert(path.startsWith(root + '/'))
    const response = await client.request(path, {method, headers: {...(body === undefined ? {} : {'Content-Type': 'application/json'}),
      ...(revision === undefined ? {} : {'If-Match': '"' + revision + '"'})}, ...(body === undefined ? {} : {body: JSON.stringify(body)})})
    const text = await response.text()
    const value = text ? JSON.parse(text) : null
    events.push({path, method, status: response.status})
    assert(response.status >= 200 && response.status < 300, 'Revocation control returned ' + response.status)
    return value
  }
  const permissionInput = value => ({key: value.key, name: value.name, description: value.description,
    enabled: value.enabled, scopeKeys: value.scopeKeys, grants: value.grants, managementGrants: value.managementGrants})
  return {
    async revokePermission({operationId, permissionKey}) {
      assert(groupIdentifier.test(operationId) && permissionIdentifier.test(permissionKey))
      assert(!operations.has(operationId), 'Revocation operation cannot be repeated implicitly')
      await fresh()
      const path = application + '/permissions/' + permissionKey
      const original = await request(path)
      assert.equal(original.enabled, true)
      assert(Number.isSafeInteger(original.revision) && original.revision > 0)
      const input = permissionInput(original)
      const operation = {kind: 'permission', path, originalRevision: original.revision,
        original: structuredClone(input), revoked: {...input, enabled: false}}
      operations.set(operationId, operation)
      const receipt = await request(path, {method: 'PUT', revision: original.revision, body: {...input, enabled: false}})
      await fresh()
      const stored = await request(path)
      assert.equal(stored.enabled, false)
      assert.equal(stored.revision, receipt.revision)
      assert(stored.revision > original.revision)
      operation.revokedRevision = stored.revision
      return {operationId, permissionKey, originalRevision: original.revision, revokedRevision: stored.revision, enabled: false}
    },
    async revokeSubjectGrants({operationId, subject}) {
      assert(groupIdentifier.test(operationId) && groupIdentifier.test(subject))
      assert(!operations.has(operationId))
      await fresh()
      const path = root + '/scope-grants/detail?' + new URLSearchParams({subject})
      const original = await request(path)
      assert.equal(original.subject, subject)
      assert(original.scopeKeys.length > 0 && original.issuer === base)
      const input = {issuer: base, subject, scopeKeys: [...original.scopeKeys]}
      const operation = {kind: 'grants', path, originalRevision: original.revision, original: input, revoked: {...input, scopeKeys: []}}
      operations.set(operationId, operation)
      const receipt = await request(path, {method: 'PUT', revision: original.revision, body: {...input, scopeKeys: []}})
      await fresh()
      const stored = await request(path)
      assert.deepEqual(stored.scopeKeys, [])
      assert.equal(stored.revision, receipt.revision)
      assert(stored.revision > original.revision, 'Subject grant revocation must advance its revision')
      operation.revokedRevision = stored.revision
      return {operationId, subject, originalRevision: original.revision, revokedRevision: stored.revision, scopeKeys: []}
    },
    async restore({operationId}) {
      const operation = operations.get(operationId)
      assert(operation && !operation.restored, 'A matching unrestored revocation is required')
      await fresh()
      const current = await request(operation.path)
      if (operation.kind === 'permission') assert.deepEqual(permissionInput(current), operation.revoked, 'Do not overwrite concurrent policy edits')
      else assert.deepEqual({issuer: current.issuer, subject: current.subject, scopeKeys: current.scopeKeys}, operation.revoked)
      const receipt = await request(operation.path, {method: 'PUT', revision: current.revision, body: operation.original})
      await fresh()
      const restored = await request(operation.path)
      assert.equal(restored.revision, receipt.revision)
      assert(restored.revision > current.revision, 'Restoration must advance the revoked revision')
      if (operation.kind === 'permission') assert.deepEqual(permissionInput(restored), operation.original)
      else assert.deepEqual({issuer: restored.issuer, subject: restored.subject, scopeKeys: restored.scopeKeys}, operation.original)
      operation.restored = true
      operation.restoredRevision = restored.revision
      return {operationId, restored: true, revision: restored.revision}
    },
    publicEvidence() {return {events: structuredClone(events), operations: [...operations].map(([id, operation]) =>
      ({id, kind: operation.kind, restored: operation.restored === true, originalRevision: operation.originalRevision,
        revokedRevision: operation.revokedRevision, restoredRevision: operation.restoredRevision}))}},
  }
}
