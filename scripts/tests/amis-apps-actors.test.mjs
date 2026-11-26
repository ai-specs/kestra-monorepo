import assert from 'node:assert/strict'
import test from 'node:test'
import {planAmisActors, provisionAmisActors, publicEvidence} from '../amis-apps-actors.mjs'

const base = 'http://127.0.0.1:18129'
const prefix = '/api/v1/main/extensions/rbac'
const groupPath = prefix + '/application-groups/main'
const applicationPath = groupPath + '/applications/~a2VzdHJhLXVp'
const admin = {username: 'test-manager', password: 'private-admin-password'}

class FakeServer {
  options
  loginEvents = []
  logoutEvents = []
  identityEvents = []
  constructor(options = {}) { this.options = options }
  groupRevision = 5
  applicationRevision = 3
  authorizationVersion = 1
  scopes = new Map([['admin', {key: 'admin', name: 'Existing administrator'}]])
  permissions = new Map([['initial-administrator', {key: 'initial-administrator', scopeKeys: ['admin'],
    grants: [{scope: 'NAMESPACE', namespace: 'company.*', resource: 'FLOW', actions: ['READ', 'EXECUTE']}], managementGrants: []}]])
  users = new Map([[admin.username, {password: admin.password}]])
  assignments = new Map([[admin.username, ['admin']]])
  requests = []

  client() {
    const server = this
    let subject
    return {
      async login(username, password) {
        assert.equal(server.users.get(username)?.password, password)
        subject = username
        server.loginEvents.push(username)
        return {authenticated: true, credentialsSubmitted: server.options.reusedSubject !== username}
      },
      async changeTemporaryPassword(username, temporaryPassword, nextPassword) {
        assert.equal(server.users.get(username)?.temporaryPassword, temporaryPassword)
        server.users.set(username, {password: nextPassword})
        // The real helper finishes password change with a normal actor login.
        subject = username
      },
      async verifiedUiIdentity(expected) {
        assert.equal(expected.applicationGroupId, 'main')
        assert.equal(expected.subject, subject)
        assert.equal(expected.audience, 'kestra-ui')
        server.identityEvents.push(subject)
        const supported = new Set([...server.permissions.values()].flatMap(permission => permission.scopeKeys))
        return {applicationGroupScopes: (server.assignments.get(subject) ?? []).filter(key => supported.has(key)),
          authorizationVersion: server.authorizationVersion}
      },
      async request(path, options = {}) {
        if (path === '/oidc/logout') {
          const actorSession = subject !== undefined && subject !== admin.username
          const configured = server.options.logoutStage === 'actor' ? actorSession : !actorSession
          const status = configured ? server.options.logoutStatus ?? 303 : 303
          const location = server.options.logoutLocation
          server.logoutEvents.push({subject, status})
          subject = undefined
          return {status, headers: new Headers(location === undefined ? {} : {Location: location}), body: {async cancel() {}}}
        }
        assert.equal(subject, admin.username, 'Only the explicit manager transport may provision')
        assert(path.startsWith(prefix + '/'), 'No legacy or unprefixed management path')
        const method = options.method ?? 'GET'
        const body = options.body === undefined ? undefined : JSON.parse(options.body)
        server.requests.push({path, method, body, ifMatch: options.headers?.['If-Match']})
        const response = (status, value) => ({status, async text() {return value === undefined ? '' : JSON.stringify(value)}})
        if (path === groupPath && method === 'GET') return response(200, {id: 'main', issuer: base, revision: server.groupRevision})
        if (path === applicationPath && method === 'GET') return response(200, {clientId: 'kestra-ui', revision: server.applicationRevision})
        if (path === groupPath + '/scopes' && method === 'POST') {
          assert.equal(options.headers['If-Match'], '"' + server.groupRevision + '"')
          assert(!server.scopes.has(body.key))
          server.scopes.set(body.key, {...body, revision: 1})
          server.groupRevision += 3
          return response(201, {key: body.key, revision: 1, parentRevision: server.groupRevision})
        }
        if (path.startsWith(groupPath + '/scopes/') && method === 'GET') return response(200, server.scopes.get(path.split('/').at(-1)))
        if (path === applicationPath + '/permissions' && method === 'POST') {
          assert.equal(options.headers['If-Match'], '"' + server.applicationRevision + '"')
          assert(body.scopeKeys.every(key => server.scopes.has(key)))
          assert(!server.permissions.has(body.key))
          server.permissions.set(body.key, {...body, revision: 1})
          server.applicationRevision += 2
          return response(201, {key: body.key, revision: 1, parentRevision: server.applicationRevision})
        }
        if (path.startsWith(applicationPath + '/permissions/') && method === 'GET') return response(200, server.permissions.get(path.split('/').at(-1)))
        if (path === prefix + '/users' && method === 'POST') {
          assert.equal(body.password, undefined)
          const temporaryPassword = 'TEMPORARY-PRIVATE-' + body.username
          server.users.set(body.username, {temporaryPassword})
          return response(201, {subject: body.username, revision: 0, temporaryPassword})
        }
        if (path === groupPath + '/scope-grants' && method === 'POST') {
          assert.equal(options.headers['If-Match'], '"' + server.groupRevision + '"')
          assert.equal(body.issuer, base)
          assert(server.users.has(body.subject))
          server.assignments.set(body.subject, body.scopeKeys)
          server.groupRevision += 3
          return response(201, {subject: body.subject, revision: 1, parentRevision: server.groupRevision})
        }
        if (path.startsWith(groupPath + '/scope-grants/detail?') && method === 'GET') {
          const username = new URL(path, base).searchParams.get('subject')
          return server.assignments.has(username) ? response(200, {subject: username, scopeKeys: server.assignments.get(username)}) : response(404, {code: 'not_found'})
        }
        throw new Error('Unexpected fake management operation: ' + method + ' ' + path)
      },
    }
  }

  effective(username) {
    const assigned = this.assignments.get(username) ?? []
    return [...this.permissions.values()].filter(permission => permission.scopeKeys.some(key => assigned.includes(key)))
      .flatMap(permission => permission.grants)
  }
}

test('test actor plan keeps entry, execution, zero-grant and namespace ranges distinct', () => {
  const plan = planAmisActors()
  assert.equal(plan.groupId, 'main')
  assert.deepEqual(plan.actors.find(actor => actor.key === 'zero-grant').scopeKeys, [])
  assert(!plan.scopes.some(scope => scope.grants.length === 0))
  assert(plan.scopes.find(scope => scope.key === 'amis-flow-a').grants.some(grant => grant.resource === 'EXECUTION' && grant.actions.includes('ACCESS_OUTPUTS')))
  assert(plan.scopes.find(scope => scope.key === 'amis-exact-a').grants.every(grant => grant.namespace === plan.namespaceA))
  assert(plan.scopes.find(scope => scope.key === 'amis-except-b').grants.every(grant => grant.namespace === '!' + plan.namespaceB + '.*'))
  assert(plan.scopes.flatMap(scope => scope.grants).every(grant => !['SYSTEM', 'NAMESPACE_FILE'].includes(grant.resource)))
  assert.throws(() => planAmisActors({namespaceA: 'company.*'}))
})

test('public redaction preserves revocation metadata but removes credential values', () => {
  assert.deepEqual(publicEvidence({authorizationVersion: 4, password: 'private', token: 'private',
    temporaryPassword: 'private', nested: {scopeKeys: ['a'], cookie: 'private'}}), {authorizationVersion: 4, nested: {scopeKeys: ['a']}})
  assert.deepEqual(publicEvidence({access_token: 'private', client_secret: 'private', Authorization: 'private',
    nested: {'X-CSRF-TOKEN': 'private', authorizationVersion: 2}}), {nested: {authorizationVersion: 2}})
})

test('explicit fake orchestration proves per-scope permissions do not leak privileges across actors', async () => {
  const server = new FakeServer()
  const original = structuredClone(server.permissions.get('initial-administrator'))
  const result = await provisionAmisActors({base, client: server.client(), clientFactory: () => server.client(), admin,
    newPasswordFactory: username => 'PRIVATE-CHANGED-PASSWORD-' + username})
  assert.equal(result.public.transport, 'explicit-test-double')
  assert.deepEqual(server.permissions.get('initial-administrator'), original)
  assert.equal(server.permissions.size, 10)
  assert.deepEqual(server.effective('amis-entry-only').map(grant => grant.resource), ['EXTENSION_ROUTE'])
  assert(server.effective('amis-flow-only').every(grant => grant.resource !== 'EXTENSION_ROUTE'))
  assert.deepEqual(server.effective('amis-zero-grant'), [])
  const noOutput = server.effective('amis-no-output')
  assert(noOutput.some(grant => grant.resource === 'EXTENSION_ROUTE'))
  assert(noOutput.some(grant => grant.resource === 'FLOW' && grant.actions.includes('EXECUTE')))
  assert(noOutput.some(grant => grant.resource === 'EXECUTION' && grant.actions.includes('CREATE')))
  assert(noOutput.filter(grant => grant.resource === 'EXECUTION').every(grant =>
    !grant.actions.includes('READ') && !grant.actions.includes('ACCESS_OUTPUTS')))
  assert(!server.assignments.has('amis-zero-grant'))
  assert(server.effective('amis-split').some(grant => grant.resource === 'EXTENSION_ROUTE'))
  assert(server.effective('amis-split').some(grant => grant.resource === 'FLOW'))
  const mixed = server.effective('amis-mixed')
  assert.equal(mixed.find(grant => grant.resource === 'EXTENSION_ROUTE').namespace, 'company.amis.a.*')
  assert.equal(mixed.find(grant => grant.resource === 'FLOW').namespace, 'company.amis.b.*')
  assert(result.public.permissions.every(permission => permission.scopeKeys.length === 1))
  assert(result.private.actors.every(actor => actor.password.length >= 16))
  assert(!JSON.stringify(result.public).includes('PRIVATE'))
  assert(!server.requests.some(request => request.method === 'POST' && /\/applications$/.test(request.path)))
})

const provision = server => provisionAmisActors({base, client: server.client(), clientFactory: () => server.client(), admin,
  newPasswordFactory: username => 'PRIVATE-CHANGED-PASSWORD-' + username})

for (const logoutStage of ['manager', 'actor']) {
  test(`307 /ui/ logout permits fresh ${logoutStage} credential submission and signed actor verification`, async () => {
    const server = new FakeServer({logoutStage, logoutStatus: 307, logoutLocation: '/ui/'})
    const result = await provision(server)
    assert.equal(result.private.actors.length, planAmisActors().actors.length)
    assert(server.logoutEvents.some(event => event.status === 307))
    for (const actor of planAmisActors().actors) {
      assert(server.loginEvents.includes(actor.username))
      assert(server.identityEvents.includes(actor.username))
    }
  })
  for (const logoutLocation of ['https://outside.invalid/ui/', '/oidc/login', undefined]) {
    test(`307 ${logoutStage} logout rejects ${logoutLocation ?? 'missing Location'} before reauthentication`, async () => {
      const server = new FakeServer({logoutStage, logoutStatus: 307, logoutLocation})
      await assert.rejects(provision(server))
      if (logoutStage === 'manager') {
        assert.equal(server.requests.length, 0)
        assert.equal(server.loginEvents.length, 0)
      } else assert.equal(server.identityEvents.length, 0, 'Rejected actor logout must not advance to signed identity verification')
    })
  }
}

for (const reusedSubject of [admin.username, 'amis-allow-a']) test(`session reuse without submitted credentials rejects ${reusedSubject}`, async () => {
  const server = new FakeServer({reusedSubject, logoutStatus: 307, logoutLocation: '/ui/'})
  await assert.rejects(provision(server), /credentials must be (resubmitted|submitted)/)
  if (reusedSubject === admin.username) assert.equal(server.requests.length, 0)
  else assert(!server.identityEvents.includes(reusedSubject))
})
