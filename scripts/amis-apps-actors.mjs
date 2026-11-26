import assert from 'node:assert/strict'
import {ProductionOAuthClient} from './production-oauth-client.mjs'

const prefix = '/api/v1/main/extensions/rbac'
const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const namespaceIdentifier = /^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*$/
const scopeIdentifier = /^[a-z][a-z0-9-]{0,63}$/
const grant = (namespace, resource, actions, ids = []) => ({scope: 'NAMESPACE', tenant: 'main', namespace,
  resource, actions, ids, allIds: ids.length === 0})
const entry = namespace => [grant(namespace, 'EXTENSION_ROUTE', ['EXECUTE'], ['amis-apps'])]
const execution = namespace => [grant(namespace, 'FLOW', ['READ', 'EXECUTE']),
  grant(namespace, 'EXECUTION', ['CREATE', 'READ', 'ACCESS_OUTPUTS'])]

export function planAmisActors({namespaceA = 'company.amis.a', namespaceB = 'company.amis.b', groupId = 'main'} = {}) {
  assert(identifier.test(groupId) && namespaceIdentifier.test(namespaceA) && namespaceIdentifier.test(namespaceB))
  assert.notEqual(namespaceA, namespaceB)
  const scopes = [
    {key: 'amis-entry-a', name: 'AMIS test entry A', grants: entry(namespaceA + '.*')},
    {key: 'amis-flow-a', name: 'AMIS test execution A', grants: execution(namespaceA + '.*')},
    {key: 'amis-flow-b', name: 'AMIS test execution B', grants: execution(namespaceB + '.*')},
    {key: 'amis-no-output', name: 'AMIS test execution without output reading', grants: [
      grant(namespaceA + '.*', 'FLOW', ['READ', 'EXECUTE']), grant(namespaceA + '.*', 'EXECUTION', ['CREATE'])]},
    {key: 'amis-exact-a', name: 'AMIS test exact A', grants: [...entry(namespaceA), ...execution(namespaceA)]},
    {key: 'amis-except-b', name: 'AMIS test except B subtree', grants: [...entry('!' + namespaceB + '.*'), ...execution('!' + namespaceB + '.*')]},
    {key: 'amis-revoke-entry', name: 'AMIS test revocable entry', grants: entry(namespaceA + '.*')},
    {key: 'amis-revoke-flow', name: 'AMIS test revocable execution', grants: execution(namespaceA + '.*')},
  ].map(scope => ({...scope, description: 'Isolated AMIS acceptance data; not a product default'}))
  const actors = [
    {key: 'allow-a', username: 'amis-allow-a', scopeKeys: ['amis-entry-a', 'amis-flow-a']},
    {key: 'entry-only', username: 'amis-entry-only', scopeKeys: ['amis-entry-a']},
    {key: 'flow-only', username: 'amis-flow-only', scopeKeys: ['amis-flow-a']},
    {key: 'zero-grant', username: 'amis-zero-grant', scopeKeys: []},
    {key: 'no-output', username: 'amis-no-output', scopeKeys: ['amis-entry-a', 'amis-no-output']},
    {key: 'split', username: 'amis-split', scopeKeys: ['amis-entry-a', 'amis-flow-a']},
    {key: 'mixed-ranges', username: 'amis-mixed', scopeKeys: ['amis-entry-a', 'amis-flow-b']},
    {key: 'exact-a', username: 'amis-exact-a', scopeKeys: ['amis-exact-a']},
    {key: 'complement', username: 'amis-complement', scopeKeys: ['amis-except-b']},
    {key: 'revoke-entry', username: 'amis-revoke-entry', scopeKeys: ['amis-revoke-entry', 'amis-flow-a']},
    {key: 'revoke-flow', username: 'amis-revoke-flow', scopeKeys: ['amis-entry-a', 'amis-revoke-flow']},
    {key: 'revoke-grant', username: 'amis-revoke-grant', scopeKeys: ['amis-entry-a', 'amis-flow-a']},
  ]
  return {groupId, namespaceA, namespaceB, scopes, actors, capability: 'amis-apps'}
}

export function publicEvidence(value) {
  const privateKeys = new Set(['password', 'temporarypassword', 'clientsecret', 'cookie', 'cookies', 'setcookie', 'token',
    'accesstoken', 'idtoken', 'refreshtoken', 'authorization', 'authorizationheader', 'csrftoken', 'xcsrftoken'])
  const clean = input => {
    if (Array.isArray(input)) return input.map(clean)
    if (!input || typeof input !== 'object') return input
    return Object.fromEntries(Object.entries(input).filter(([key]) => !privateKeys.has(key.toLowerCase().replace(/[-_]/g, '')))
      .map(([key, item]) => [key, clean(item)]))
  }
  return clean(value)
}

const canonical = value => Array.isArray(value) ? value.map(canonical).sort((first, second) => JSON.stringify(first).localeCompare(JSON.stringify(second)))
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([first], [second]) => first.localeCompare(second))
    .map(([key, item]) => [key, canonical(item)])) : value

export async function provisionAmisActors({base, client, clientFactory = () => new ProductionOAuthClient(base), admin,
  plan = planAmisActors(), newPasswordFactory}) {
  assert.equal(new URL(base).origin, base)
  assert(admin?.username && admin?.password && typeof newPasswordFactory === 'function')
  assert(identifier.test(plan.groupId))
  const controller = client ?? clientFactory()
  const groupPath = prefix + '/application-groups/' + plan.groupId
  const applicationPath = groupPath + '/applications/~' + Buffer.from('kestra-ui').toString('base64url')
  const events = []
  async function request(path, {method = 'GET', body, revision, statuses = [200]} = {}) {
    assert(path.startsWith(prefix + '/'))
    const headers = {...(body === undefined ? {} : {'Content-Type': 'application/json'}),
      ...(revision === undefined ? {} : {'If-Match': '"' + revision + '"'})}
    if (revision !== undefined) assert(Number.isSafeInteger(revision) && revision >= 0)
    const response = await controller.request(path, {method, headers, ...(body === undefined ? {} : {body: JSON.stringify(body)})})
    const text = await response.text()
    const value = text ? JSON.parse(text) : null
    events.push({path, method, status: response.status})
    assert(statuses.includes(response.status), `Isolated management ${method} ${path} returned ${response.status}`)
    return value
  }
  async function fresh() {
    const loggedOut = await controller.request('/oidc/logout')
    assert([200, 302, 303, 307].includes(loggedOut.status), 'Production logout did not complete before reauthentication')
    if (loggedOut.status === 307) assert.equal(new URL(loggedOut.headers.get('location'), base).href, base + '/ui/')
    await loggedOut.body?.cancel()
    const result = await controller.login(admin.username, admin.password)
    assert(result.authenticated && result.credentialsSubmitted, 'Production manager credentials must be resubmitted')
  }
  await fresh()
  const originalGroup = await request(groupPath)
  assert.equal(originalGroup.id, plan.groupId)
  assert.equal(originalGroup.issuer, base)
  const originalApplication = await request(applicationPath)
  assert.equal(originalApplication.clientId, 'kestra-ui')
  const storedPermissions = []
  const definitions = [{key: 'amis-admin-entry', name: 'AMIS explicitly maintained administrator entry', scopeKeys: ['admin'],
    grants: [...entry(plan.namespaceA + '.*'), ...entry(plan.namespaceB + '.*')]}]
  for (const scope of plan.scopes) {
    assert(scopeIdentifier.test(scope.key) && scope.grants.length > 0)
    await fresh()
    const parent = await request(groupPath)
    const created = await request(groupPath + '/scopes', {method: 'POST', revision: parent.revision,
      body: {key: scope.key, name: scope.name, description: scope.description}, statuses: [200, 201]})
    assert.equal(created.key, scope.key)
    assert(Number.isSafeInteger(created.parentRevision))
    await fresh()
    const readBack = await request(groupPath + '/scopes/' + scope.key)
    assert.equal(readBack.key, scope.key)
    assert.equal(readBack.name, scope.name)
    definitions.push({key: 'permission-' + scope.key, name: scope.name, scopeKeys: [scope.key], grants: scope.grants})
  }
  for (const definition of definitions) {
    await fresh()
    const application = await request(applicationPath)
    const input = {...definition, description: 'Explicit isolated acceptance policy', enabled: true, managementGrants: []}
    const created = await request(applicationPath + '/permissions', {method: 'POST', revision: application.revision,
      body: input, statuses: [200, 201]})
    assert.equal(created.key, definition.key)
    await fresh()
    const stored = await request(applicationPath + '/permissions/' + definition.key)
    assert.deepEqual(canonical(stored.scopeKeys), canonical(definition.scopeKeys))
    assert.deepEqual(canonical(stored.grants), canonical(definition.grants))
    assert.deepEqual(stored.managementGrants, [])
    storedPermissions.push({key: stored.key, scopeKeys: stored.scopeKeys, grants: stored.grants, revision: stored.revision})
  }
  const privateActors = []
  const identities = []
  for (const actor of plan.actors) {
    assert(identifier.test(actor.username) && actor.scopeKeys.every(key => plan.scopes.some(scope => scope.key === key)))
    await fresh()
    const created = await request(prefix + '/users', {method: 'POST',
      body: {username: actor.username, name: 'AMIS acceptance ' + actor.key, email: actor.username + '@acceptance.invalid'}, statuses: [201]})
    assert.equal(created.subject, actor.username)
    assert(typeof created.temporaryPassword === 'string' && created.temporaryPassword.length > 0)
    const actorClient = clientFactory()
    const password = newPasswordFactory(actor.username)
    assert(typeof password === 'string' && password.length >= 16)
    await actorClient.changeTemporaryPassword(actor.username, created.temporaryPassword, password)
    delete created.temporaryPassword
    if (actor.scopeKeys.length) {
      await fresh()
      const parent = await request(groupPath)
      const granted = await request(groupPath + '/scope-grants', {method: 'POST', revision: parent.revision,
        body: {issuer: base, subject: actor.username, scopeKeys: actor.scopeKeys}, statuses: [200, 201]})
      assert.equal(granted.subject, actor.username)
      await fresh()
      const stored = await request(groupPath + '/scope-grants/detail?' + new URLSearchParams({subject: actor.username}))
      assert.equal(stored.subject, actor.username)
      assert.deepEqual(canonical(stored.scopeKeys), canonical(actor.scopeKeys))
    } else {
      await fresh()
      const absent = await request(groupPath + '/scope-grants/detail?' + new URLSearchParams({subject: actor.username}), {statuses: [200, 404]})
      if (absent?.scopeKeys) assert.deepEqual(absent.scopeKeys, [])
    }
    const loggedOut = await actorClient.request('/oidc/logout')
    assert([200, 302, 303, 307].includes(loggedOut.status))
    if (loggedOut.status === 307) assert.equal(new URL(loggedOut.headers.get('location'), base).href, base + '/ui/')
    await loggedOut.body?.cancel()
    const login = await actorClient.login(actor.username, password)
    assert(login.authenticated && login.credentialsSubmitted, 'Actor credentials must be submitted after grants')
    const identity = await actorClient.verifiedUiIdentity({applicationGroupId: plan.groupId, subject: actor.username, audience: 'kestra-ui'})
    assert.deepEqual(canonical(identity.applicationGroupScopes), canonical(actor.scopeKeys))
    identities.push({key: actor.key, subject: actor.username, applicationGroupScopes: identity.applicationGroupScopes,
      authorizationVersion: identity.authorizationVersion})
    privateActors.push({...actor, subject: actor.username, password})
  }
  return {public: {transport: controller instanceof ProductionOAuthClient ? 'production-oidc' : 'explicit-test-double',
    groupId: plan.groupId, events, permissions: storedPermissions, actors: identities}, private: {admin, actors: privateActors}}
}
