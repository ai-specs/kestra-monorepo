import assert from 'node:assert/strict'
import test from 'node:test'
import {createAmisRevocationControls} from '../amis-apps-revocation.mjs'

// Stateful test transport only. No production authorization, refresh or storage proof.
const base = 'https://revocation-unit.invalid'
const root = '/api/v1/main/extensions/rbac/application-groups/main'
const permissionPath = root + '/applications/~a2VzdHJhLXVp/permissions/permission-amis-entry-a'
const grantsPath = root + '/scope-grants/detail?subject=amis-revoke-grant'
const admin = {username: 'manager-test', password: 'SYNTHETIC-ADMIN-PRIVATE-PASSWORD'}
const originalPermission = {
  key: 'permission-amis-entry-a', name: 'Explicit AMIS entry', description: 'Unit transport policy', enabled: true,
  scopeKeys: ['amis-entry-a'], grants: [{scope: 'NAMESPACE', tenant: 'main', namespace: 'company.amis.a.*',
    resource: 'EXTENSION_ROUTE', actions: ['EXECUTE'], ids: ['amis-apps'], allIds: false}], managementGrants: [], revision: 7
}
const originalAssignment = {issuer: base, subject: 'amis-revoke-grant', scopeKeys: ['amis-entry-a', 'amis-flow-a'], revision: 11}
const permissionInput = value => Object.fromEntries(['key', 'name', 'description', 'enabled', 'scopeKeys', 'grants', 'managementGrants'].map(key => [key, structuredClone(value[key])]))
const assignmentInput = value => ({issuer: value.issuer, subject: value.subject, scopeKeys: [...value.scopeKeys]})

class StatefulTransport {
  permission = structuredClone(originalPermission)
  assignment = structuredClone(originalAssignment)
  session = 'old-privileged-session'
  issued = 0
  writes = []
  events = []
  cancelled = 0
  supportedScopes = new Set(['amis-entry-a', 'amis-flow-a'])
  options

  constructor(options = {}) {this.options = options}
  response(status, value) {
    return {status, body: {cancel: async () => {this.cancelled++}}, text: async () => value === undefined ? '' : JSON.stringify(value)}
  }
  async login(username, password) {
    assert.equal(this.session, null, 'Fresh login must follow actual logout/session clearing')
    assert.equal(username, admin.username)
    assert.equal(password, admin.password)
    this.events.push({kind: 'login', generation: ++this.issued})
    this.session = `signed-test-session-${this.issued}`
    return {authenticated: true, credentialsSubmitted: this.options.reusedLogin !== true}
  }
  async request(path, options = {}) {
    const method = options.method ?? 'GET'
    if (path === '/oidc/logout') {
      assert.equal(method, 'GET')
      this.events.push({kind: 'logout', previous: this.session})
      if (!this.options.logoutKeepsSession) this.session = null
      const response = this.response(this.options.logoutStatus ?? 303)
      response.headers = new Headers(this.options.logoutLocation === undefined ? {} : {Location: this.options.logoutLocation})
      return response
    }
    assert(this.session?.startsWith('signed-test-session-'), 'Management operations require a fresh manager login')
    assert([permissionPath, grantsPath].includes(path), `Unexpected real-contract path ${method} ${path}`)
    assert(['GET', 'PUT'].includes(method), `Unexpected management method ${method}`)
    this.events.push({kind: 'request', path, method, generation: this.issued})
    if (this.options.status && this.options.statusMethod === method) return this.response(this.options.status, {code: 'test_transport_error'})
    const kind = path === permissionPath ? 'permission' : 'assignment'
    if (method === 'GET') {
      const current = structuredClone(this[kind])
      if (this.options.corruptReadback && this.writes.length) {
        if (kind === 'permission') current.enabled = true
        else current.scopeKeys = ['amis-entry-a']
      }
      return this.response(200, current)
    }
    const ifMatch = options.headers?.['If-Match']
    assert.match(ifMatch ?? '', /^"(?:0|[1-9][0-9]*)"$/, 'Strong exact If-Match required')
    assert.equal(options.headers?.['Content-Type'], 'application/json')
    if (this.options.raceOnWrite) {
      this[kind].revision++
      this.options.raceOnWrite = false
    }
    if (ifMatch !== `"${this[kind].revision}"`) return this.response(412, {code: 'stale_revision'})
    const body = JSON.parse(options.body)
    assert.deepEqual(Object.keys(body).sort(), (kind === 'permission' ? ['key','name','description','enabled','scopeKeys','grants','managementGrants'] : ['issuer','subject','scopeKeys']).sort())
    if (kind === 'permission') {
      assert.equal(body.key, originalPermission.key)
      assert.deepEqual(body.scopeKeys, originalPermission.scopeKeys)
      assert.deepEqual(body.managementGrants, [])
    } else {
      assert.equal(body.issuer, base); assert.equal(body.subject, originalAssignment.subject)
      assert(body.scopeKeys.every(key => this.supportedScopes.has(key)))
    }
    const previousRevision = this[kind].revision
    this[kind] = {...structuredClone(body), revision: previousRevision + (this.options.nonIncreasingRevision ? 0 : 3)}
    this.writes.push({path, body, ifMatch, previousRevision, revision: this[kind].revision})
    return this.response(200, {key: body.key, subject: body.subject, revision: this[kind].revision, parentRevision: 50})
  }
  controls() {return createAmisRevocationControls({base, admin, client: this})}
  intersection() {return this.assignment.scopeKeys.filter(key => this.supportedScopes.has(key))}
}

test('TEST TRANSPORT permission disable/readback/restore uses fresh sessions, strong revisions and exact original grants', async () => {
  const server = new StatefulTransport(); const controls = server.controls()
  const revoked = await controls.revokePermission({operationId:'permission-op',permissionKey:originalPermission.key})
  assert.equal(revoked.originalRevision,7); assert.equal(revoked.revokedRevision,10)
  assert.equal(server.permission.enabled,false)
  assert.deepEqual(permissionInput(server.permission), {...permissionInput(originalPermission),enabled:false})
  const restored = await controls.restore({operationId:'permission-op'})
  assert.equal(restored.revision,13)
  assert.deepEqual(permissionInput(server.permission),permissionInput(originalPermission))
  assert.deepEqual(server.writes.map(write=>write.ifMatch),['"7"','"10"'])
  assert.equal(server.issued,4); assert.equal(server.cancelled,4)
  assert.deepEqual(server.events.filter(event=>event.kind==='logout'||event.kind==='login').map(event=>event.kind), ['logout','login','logout','login','logout','login','logout','login'])
})

test('TEST TRANSPORT user scope withdrawal reads an empty intersection, then restores the exact assignment', async () => {
  const server = new StatefulTransport(); const controls = server.controls()
  const revoked = await controls.revokeSubjectGrants({operationId:'grants-op',subject:originalAssignment.subject})
  assert.deepEqual(server.intersection(),[]); assert.deepEqual(revoked.scopeKeys,[])
  assert.equal(revoked.originalRevision,11); assert.equal(revoked.revokedRevision,14)
  await controls.restore({operationId:'grants-op'})
  assert.deepEqual(assignmentInput(server.assignment),assignmentInput(originalAssignment))
  assert.deepEqual(server.writes.map(write=>write.ifMatch),['"11"','"14"'])
  assert(server.writes.every(write=>write.path===grantsPath)); assert.equal(server.issued,4)
})

for (const kind of ['permission','grants']) test(`TEST TRANSPORT ${kind} concurrent edit cannot be overwritten by restore`, async () => {
  const server = new StatefulTransport(); const controls = server.controls()
  if (kind==='permission') {
    await controls.revokePermission({operationId:'op',permissionKey:originalPermission.key})
    server.permission.grants[0].namespace='company.changed.*'; server.permission.revision++
  } else {
    await controls.revokeSubjectGrants({operationId:'op',subject:originalAssignment.subject})
    server.assignment.scopeKeys=['amis-flow-a']; server.assignment.revision++
  }
  const before = structuredClone(kind==='permission'?server.permission:server.assignment)
  await assert.rejects(controls.restore({operationId:'op'}))
  assert.equal(server.writes.length,1)
  assert.deepEqual(kind==='permission'?server.permission:server.assignment,before)
})

test('TEST TRANSPORT unknown restore operation makes no request', async () => {
  const server=new StatefulTransport(); await assert.rejects(server.controls().restore({operationId:'missing'}),/matching unrestored/)
  assert.deepEqual(server.events,[])
})

for (const kind of ['permission','grants']) test(`TEST TRANSPORT ${kind} duplicate revoke and duplicate restore are rejected`, async () => {
  const server=new StatefulTransport(); const controls=server.controls()
  const revoke=()=>kind==='permission'?controls.revokePermission({operationId:'op',permissionKey:originalPermission.key}):controls.revokeSubjectGrants({operationId:'op',subject:originalAssignment.subject})
  await revoke(); const count=server.events.length
  await assert.rejects(revoke()); assert.equal(server.events.length,count)
  await controls.restore({operationId:'op'}); const restoredCount=server.events.length
  await assert.rejects(controls.restore({operationId:'op'}),/matching unrestored/); assert.equal(server.events.length,restoredCount)
})

for (const method of ['GET','PUT']) for (const status of [401,403,404,409,412,503]) test(`TEST TRANSPORT ${method} HTTP ${status} fails without false success`, async () => {
  const server=new StatefulTransport({status,statusMethod:method}); const controls=server.controls()
  await assert.rejects(controls.revokePermission({operationId:'op',permissionKey:originalPermission.key}),new RegExp(`returned ${status}`))
  assert.equal(server.writes.length,0); assert.deepEqual(server.permission,originalPermission)
})

test('TEST TRANSPORT write race receives 412 and does not overwrite concurrent revision', async () => {
  const server=new StatefulTransport({raceOnWrite:true})
  await assert.rejects(server.controls().revokePermission({operationId:'op',permissionKey:originalPermission.key}),/returned 412/)
  assert.equal(server.writes.length,0); assert.equal(server.permission.enabled,true)
})

for (const kind of ['permission','grants']) test(`TEST TRANSPORT ${kind} false readback is rejected`, async () => {
  const server=new StatefulTransport({corruptReadback:true}); const controls=server.controls()
  await assert.rejects(kind==='permission'?controls.revokePermission({operationId:'op',permissionKey:originalPermission.key}):controls.revokeSubjectGrants({operationId:'op',subject:originalAssignment.subject}))
})

test('TEST TRANSPORT credentialsSubmitted false is rejected before management requests', async () => {
  const server=new StatefulTransport({reusedLogin:true})
  await assert.rejects(server.controls().revokePermission({operationId:'op',permissionKey:originalPermission.key}))
  assert(!server.events.some(event=>event.kind==='request')); assert.equal(server.writes.length,0)
})

test('TEST TRANSPORT logout must clear the prior session before fresh login', async () => {
  const server=new StatefulTransport({logoutKeepsSession:true})
  await assert.rejects(server.controls().revokeSubjectGrants({operationId:'op',subject:originalAssignment.subject}),/actual logout/)
  assert.equal(server.writes.length,0)
})

test('TEST TRANSPORT public evidence omits credentials while retaining operation revision evidence', async () => {
  const server=new StatefulTransport(); const controls=server.controls()
  const revoked=await controls.revokePermission({operationId:'op',permissionKey:originalPermission.key})
  await controls.restore({operationId:'op'})
  const evidence=controls.publicEvidence()
  const json=JSON.stringify(evidence)
  assert(!json.includes(admin.password)); assert(!/password|temporaryPassword|access_token|signed-test-session/i.test(json))
  assert.equal(revoked.revokedRevision,10)
  assert(evidence.events.every(event=>event.path.startsWith(root+'/')))
  assert.equal(evidence.operations[0].restored,true)
  assert.equal(evidence.operations[0].originalRevision,7, 'Public operation must preserve original revision')
  assert.equal(evidence.operations[0].revokedRevision,10, 'Public operation must preserve revoked revision')
  assert.equal(evidence.operations[0].restoredRevision,13, 'Public operation must preserve restored revision')
})

test('TEST TRANSPORT subject withdrawal must reject a non-increasing revision receipt', async () => {
  const server=new StatefulTransport({nonIncreasingRevision:true})
  await assert.rejects(server.controls().revokeSubjectGrants({operationId:'op',subject:originalAssignment.subject}))
})

for (const kind of ['permission','grants']) test(`TEST TRANSPORT ${kind} restore rejects a concurrent write after its GET`, async () => {
  const server=new StatefulTransport(); const controls=server.controls()
  if (kind==='permission') await controls.revokePermission({operationId:'op',permissionKey:originalPermission.key})
  else await controls.revokeSubjectGrants({operationId:'op',subject:originalAssignment.subject})
  server.options.raceOnWrite=true
  await assert.rejects(controls.restore({operationId:'op'}),/returned 412/)
  assert.equal(server.writes.length,1)
  assert.equal(controls.publicEvidence().operations[0].restored,false)
})

for (const kind of ['permission','grants']) test(`TEST TRANSPORT ${kind} restore HTTP failure is not marked restored`, async () => {
  const server=new StatefulTransport(); const controls=server.controls()
  if (kind==='permission') await controls.revokePermission({operationId:'op',permissionKey:originalPermission.key})
  else await controls.revokeSubjectGrants({operationId:'op',subject:originalAssignment.subject})
  server.options.status=503; server.options.statusMethod='PUT'
  await assert.rejects(controls.restore({operationId:'op'}),/returned 503/)
  assert.equal(server.writes.length,1)
  assert.equal(controls.publicEvidence().operations[0].restored,false)
})

for (const kind of ['permission', 'grants']) test(`TEST TRANSPORT 307 /ui/ ${kind} revoke and restore requires fresh credentials each time`, async () => {
  const server = new StatefulTransport({logoutStatus: 307, logoutLocation: '/ui/'})
  const controls = server.controls()
  if (kind === 'permission') await controls.revokePermission({operationId:'op',permissionKey:originalPermission.key})
  else await controls.revokeSubjectGrants({operationId:'op',subject:originalAssignment.subject})
  const restored = await controls.restore({operationId:'op'})
  assert.equal(restored.restored, true)
  assert.equal(server.issued, 4)
  assert.equal(server.cancelled, 4)
  assert.equal(server.writes.length, 2)
})

for (const logoutLocation of ['https://outside.invalid/ui/', '/oidc/login', undefined]) test(`TEST TRANSPORT 307 rejects ${logoutLocation ?? 'missing Location'} before login or policy query`, async () => {
  const server = new StatefulTransport({logoutStatus:307, logoutLocation})
  await assert.rejects(server.controls().revokePermission({operationId:'op',permissionKey:originalPermission.key}))
  assert.equal(server.issued,0)
  assert.equal(server.writes.length,0)
  assert(!server.events.some(event=>event.kind==='request'))
})

test('TEST TRANSPORT valid 307 logout cannot authorize a reused login receipt', async () => {
  const server = new StatefulTransport({logoutStatus:307,logoutLocation:'/ui/',reusedLogin:true})
  await assert.rejects(server.controls().revokeSubjectGrants({operationId:'op',subject:originalAssignment.subject}))
  assert.equal(server.issued,1)
  assert.equal(server.writes.length,0)
  assert(!server.events.some(event=>event.kind==='request'))
})
