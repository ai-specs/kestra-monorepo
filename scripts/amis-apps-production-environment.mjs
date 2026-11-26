import assert from 'node:assert/strict'
import {execFileSync, spawnSync} from 'node:child_process'
import {createHash, randomBytes} from 'node:crypto'
import {mkdirSync, writeFileSync, readFileSync, realpathSync} from 'node:fs'
import {resolve, join, dirname} from 'node:path'
import {setTimeout as wait} from 'node:timers/promises'
import {createManagedAmisCompose} from './amis-apps-managed-compose.mjs'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {AmisSideEffects} from './amis-apps-effects.mjs'
import {planAmisActors, provisionAmisActors} from './amis-apps-actors.mjs'
import {amisFixtureFlow, amisFixtureSchema} from './amis-apps-fixture.mjs'
import {redactOwnedServiceLog} from './owned-service-log.mjs'

const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const password = () => randomBytes(24).toString('hex') + 'aA1!'

/** Root-owned production deployment. Caller first verifies published inputs and
 * pauses any pre-existing PostgreSQL itself. This module never stops user resources.
 */
export function createAmisProductionEnvironment({directory, rootDirectory, selected, port = 18129, probeJar,
  transport = {}}) {
  // Explicit test transport only; production defaults retain real services and ownership checks.
  const execute = transport.execFileSync ?? execFileSync
  const fetchRequest = transport.fetch ?? fetch
  selected = structuredClone(selected)
  const root = resolve(rootDirectory)
  const area = resolve(directory)
  assert(area.startsWith(join(root, '.work') + '/'))
  assert.equal(realpathSync(root), root, 'Real repository root required')
  assert.equal(realpathSync(dirname(area)), dirname(area), 'Private deployment directory must not traverse a symlink')
  assert(Number.isInteger(port) && port >= 1024 && port <= 65535)
  const base = 'http://127.0.0.1:' + port
  assert.equal(hash(selected.amisJar), selected.amisJarSha256)
  assert.equal(hash(selected.rbacJar), selected.rbacJarSha256)
  const project = `application-projects-bb-${process.pid}-${Date.now()}`
  const admin = {username: 'amis-acceptance-manager', password: password()}
  const postgresPassword = password()
  const clientSecret = password()
  const environment = {PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_CONFIG: process.env.DOCKER_CONFIG,
    KESTRA_IMAGE: selected.hostImage, POSTGRES_PASSWORD: postgresPassword, KESTRA_OIDC_UI_CLIENT_SECRET: clientSecret,
    KESTRA_RBAC_ENABLED: 'false', KESTRA_AMIS_APPS_ENABLED: 'true', KESTRA_AMIS_APPS_MAX_SYNC_CONCURRENCY: '1'}
  const sourceCompose = JSON.parse(execute('docker', ['compose', '--env-file', '/dev/null', '-p', project,
    '-f', join(root, 'docker-compose.yml'), 'config', '--format', 'json'], {env: environment, encoding: 'utf8'}))
  sourceCompose.services.kestra.environment.KESTRA_CONFIGURATION = sourceCompose.services.kestra.environment.KESTRA_CONFIGURATION
    .replaceAll('$${KESTRA_OIDC_UI_CLIENT_SECRET}', '${KESTRA_OIDC_UI_CLIENT_SECRET}')
  const timestamp = Date.now()
  const inputs = {...selected, project, base, postgresPassword, clientSecret, admin,
    modes: Object.fromEntries(['A', 'B'].map((mode, index) => [mode, {
      database: `application_group_acceptance_${process.pid}_${timestamp + index}`,
      storage: `amis-${mode.toLowerCase()}-${randomBytes(8).toString('hex')}`,
      admin: {...admin, password: password()},
    }])), ...(probeJar ? {probeJar: resolve(probeJar), probeJarSha256: hash(probeJar)} : {})}
  mkdirSync(area, {mode: 0o700})
  writeFileSync(join(area, 'inputs.private.json'), JSON.stringify(inputs, null, 2), {mode: 0o600, flag: 'wx'})
  const manager = createManagedAmisCompose({directory: join(area, 'compose'), sourceCompose, inputs,
    ...(transport.managerRunner ? {runner: transport.managerRunner} : {})})
  const modes = new Map()
  let active
  const client = () => transport.clientFactory ? transport.clientFactory(base) : new ProductionOAuthClient(base)
  async function ready() {
    const deadline = Date.now() + 120000
    for (;;) {
      try {
        const response = await fetchRequest(base + '/.well-known/openid-configuration', {signal: AbortSignal.timeout(3000)})
        if (response.status === 200) {
          assert.equal((await response.json()).issuer, base)
          return
        }
      } catch (error) { if (Date.now() >= deadline) throw error }
      assert(Date.now() < deadline, 'Published application did not become ready')
      await wait(500)
    }
  }
  async function login(account) {
    const session = client()
    const response = await session.request('/oidc/logout')
    await response.body?.cancel()
    const receipt = await session.login(account.username, account.password)
    assert(receipt.authenticated && receipt.credentialsSubmitted)
    if (active?.mode === 'B' && account.username === active.admin.username) {
      const identity = await session.verifiedUiIdentity({applicationGroupId: 'main', subject: account.username, audience: 'kestra-ui'})
      assert(identity.applicationGroupScopes.includes('admin'), 'Manager signed scope must be explicit')
    }
    return session
  }
  function docker(arguments_, options = {}) {
    return execute('docker', arguments_, {encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024, ...options}).trim()
  }
  async function effectsFor(mode, deployment) {
    const actual = await manager.inspect()
    assert.equal(actual.mode, mode)
    assert.equal(actual.owner, project)
    assert.equal(actual.postgresContainer, deployment.postgresContainer)
    assert.equal(actual.kestraContainer, deployment.kestraContainer)
    const journal = manager.resources
    const database = inputs.modes[mode].database
    assert.equal(journal.owner, project)
    for (const [kind, id] of [['container', actual.postgresContainer], ['container', actual.kestraContainer], ['database', database]]) {
      assert(journal.created.some(item => item.kind === kind && item.id === id && item.owner === project && !item.removed), 'Live observer resource absent from manager journal')
    }
    const databaseRecord = journal.created.find(item => item.kind === 'database' && item.id === database)
    assert.equal(databaseRecord.mode, mode, 'Observer database belongs to another mode')
    return new AmisSideEffects({owner: project, project, postgresContainer: actual.postgresContainer,
      kestraContainer: actual.kestraContainer, database, journalPassed: true, journal,
      markers: ['company.amis', 'company2', 'greeting', 'sync-greeting', 'sync-timeout', 'sync-capacity', 'invalid-schema', 'missing-schema'],
      ...(transport.effectsRunner ? {runner: transport.effectsRunner} : {})})
  }
  async function useMode(mode) {
    assert(['A', 'B'].includes(mode))
    const deployment = await manager.startMode(mode)
    active = {mode, deployment}
    await ready()
    const executable = docker(['exec', deployment.kestraContainer, 'sha256sum', '/app/kestra']).split(/\s/)[0]
    assert.equal(executable, selected.hostExecutableSha256)
    assert.equal(docker(['exec', deployment.kestraContainer, 'sha256sum', '/app/libs/kestra-amis-apps.jar']).split(/\s/)[0], selected.amisJarSha256)
    if (mode === 'A') docker(['exec', deployment.kestraContainer, 'test', '!', '-e', '/app/libs/kestra-rbac-authorizer.jar'])
    else assert.equal(docker(['exec', deployment.kestraContainer, 'sha256sum', '/app/libs/kestra-rbac-authorizer.jar']).split(/\s/)[0], selected.rbacJarSha256)
    active.effects = await effectsFor(mode, deployment)
    active.admin = inputs.modes[mode].admin
    if (!modes.has(mode)) {
      const prepared = {mode, admin: active.admin}
      if (mode === 'B') {
        const result = await (transport.provisionActors ?? provisionAmisActors)({base, admin: active.admin, plan: planAmisActors(), newPasswordFactory: password})
        prepared.actors = result.private.actors
        writeFileSync(join(area, 'actors.private.json'), JSON.stringify(result.private, null, 2), {mode: 0o600})
        writeFileSync(join(area, 'actors-public.json'), JSON.stringify(result.public, null, 2), {mode: 0o600})
      }
      await seed()
      modes.set(mode, prepared)
    }
    active.actors = modes.get(mode).actors
    writeFileSync(join(area, 'active-public.json'), JSON.stringify({mode, deployment, executable,
      productionAuthentication: 'OIDC login and ordinary account scopes; no test authentication transport'}, null, 2))
    return active
  }
  async function reconfigure(variant) {
    assert(active)
    const deployment = await manager.reconfigureOwnedApp({mode: active.mode, variant})
    active.deployment = deployment
    await ready()
    active.effects = await effectsFor(active.mode, deployment)
    return deployment
  }
  async function seed() {
    assert(active)
    const session = await login(active.admin)
    async function saveSchema(namespace, path, schema) {
      const body = new FormData()
      body.append('fileContent', new Blob([typeof schema === 'string' ? schema : JSON.stringify(schema)], {type: 'application/json'}), 'schema.json')
      const response = await session.request('/api/v1/main/namespaces/' + namespace + '/files?' + new URLSearchParams({path}), {method: 'POST', body})
      assert.equal(response.status, 200)
      await response.body?.cancel()
      const stored = await session.request('/api/v1/main/namespaces/' + namespace + '/files?' + new URLSearchParams({path}))
      assert.equal(stored.status, 200)
      const expected = typeof schema === 'string' ? schema : JSON.stringify(schema)
      assert.equal(await stored.text(), expected, 'Namespace file bytes differ after save')
    }
    await saveSchema('company.amis', '/amis/home.json', {...amisFixtureSchema(), title: 'Published AMIS parent schema'})
    await saveSchema('company.amis.a', '/amis/invalid.json', '{invalid-json')
    await saveSchema('company.amis.b', '/amis/sibling.json', {...amisFixtureSchema(), title: 'Sibling schema sentinel'})
    const sources = [
      ...['company.amis.a', 'company.amis.b', 'company.amis.a.child', 'company.amis.b.child']
        .map(namespace => amisFixtureFlow({namespace, flowId: 'greeting'})),
      amisFixtureFlow({namespace: 'company.amis.a', flowId: 'sync-greeting', mode: 'SYNC', syncTimeout: 'PT5S'}),
      amisFixtureFlow({namespace: 'company.amis.a', flowId: 'sync-timeout', mode: 'SYNC', syncTimeout: 'PT1S'})
        .replace('tasks:\n', 'tasks:\n  - id: wait\n    type: io.kestra.plugin.core.flow.Pause\n    pauseDuration: PT3S\n'),
      amisFixtureFlow({namespace: 'company.amis.a', flowId: 'sync-capacity', mode: 'SYNC', syncTimeout: 'PT5S'})
        .replace('tasks:\n', 'tasks:\n  - id: wait\n    type: io.kestra.plugin.core.flow.Pause\n    pauseDuration: PT3S\n'),
      amisFixtureFlow({namespace: 'company.amis.a', flowId: 'invalid-schema'}).replace('nsfile:///amis/home.json', 'nsfile:///amis/invalid.json'),
      amisFixtureFlow({namespace: 'company.amis.a', flowId: 'missing-schema'}).replace('nsfile:///amis/home.json', 'nsfile:///amis/sibling.json'),
    ]
    for (const source of sources) {
      const response = await session.request('/api/v1/main/flows', {method: 'POST', headers: {'Content-Type': 'application/x-yaml'}, body: source})
      assert.equal(response.status, 200)
      const saved = await response.json()
      assert(typeof saved.id === 'string' && typeof saved.namespace === 'string' && Number.isSafeInteger(saved.revision))
      const readBack = await session.request('/api/v1/main/flows/' + saved.namespace + '/' + saved.id)
      assert.equal(readBack.status, 200)
      const stored = await readBack.json()
      assert.equal(stored.id, saved.id)
      assert.equal(stored.namespace, saved.namespace)
      assert.equal(stored.revision, saved.revision)
    }
    await active.effects.waitForIdle()
    await active.effects.waitForStable()
  }
  const probe = {snapshot() {
    assert(active && probeJar, 'Live probe and active deployment required')
    const report = JSON.parse(docker(['exec', active.deployment.kestraContainer, 'cat', '/tmp/amis-acceptance-probe/counts.json']))
    assert.equal(report.integrity, 'ok')
    assert(Object.values(report.readiness).every(value => value === true),
      'Probe listener not initialized: ' + Object.entries(report.readiness).filter(([, ready]) => ready !== true).map(([name]) => name).join(', '))
    return report
  }}
  async function retainLogs() {
    if (!active) return
    const result = spawnSync('docker', ['logs', active.deployment.kestraContainer], {encoding: 'utf8', timeout: 30000,
      maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']})
    assert.equal(result.status, 0, 'Owned service log collection failed')
    let sanitized = redactOwnedServiceLog(result.stdout + '\n' + result.stderr)
    const actorPasswords = [...modes.values()].flatMap(mode => mode.actors ?? []).map(actor => actor.password)
    for (const value of [clientSecret, postgresPassword, ...actorPasswords, ...Object.values(inputs.modes).map(mode => mode.admin.password)]) sanitized = sanitized.replaceAll(value, '[redacted]')
    writeFileSync(join(area, `service-${active.mode}-${Date.now()}.log`), sanitized, {mode: 0o600})
  }
  return {base, project, manager, probe, login, useMode, reconfigure, retainLogs,
    startPostgres: () => manager.startPostgres(),
    async cleanup() {
      let logFailure
      try {await retainLogs()} catch (error) {logFailure = error}
      let result
      try {result = await manager.cleanup()} catch (cleanupFailure) {
        if (logFailure) throw new AggregateError([logFailure, cleanupFailure], 'Log retention and owned resource cleanup failed')
        throw cleanupFailure
      }
      if (logFailure) throw logFailure
      return result
    },
    get current() {assert(active); return active},
    get privateInputs() {return inputs},
  }
}
