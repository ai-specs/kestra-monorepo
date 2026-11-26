import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync} from 'node:fs'
import {resolve, join} from 'node:path'
import {createManagedAmisCompose} from '../amis-apps-managed-compose.mjs'

// Explicit synthetic Docker transport; no Docker subprocess is invoked.
const owner = 'application-projects-bb-123-456'
const secret = 'TEST$\u007bSECRET\u007d-only'
const source = {services: {
  postgres: {image: 'postgres:18', environment: {POSTGRES_DB: 'kestra', POSTGRES_USER: 'kestra', POSTGRES_PASSWORD: secret},
    healthcheck: {test: ['CMD', 'true']}, volumes: [{type: 'volume', source: 'user-pg', target: '/var/lib/postgresql'}]},
  kestra: {environment: {KESTRA_CONFIGURATION: `datasources:\n  postgres:\n    url: jdbc:postgresql://postgres:5432/kestra\n    password: ${secret}\nkestra:\n  rbac:\n    enabled: true\n    evaluation:\n      enabled: true\n    application-groups:\n      enabled: true\n  oidc:\n    issuer: http://localhost:8080\nmicronaut:\n  security:\n    oauth2:\n      clients:\n        kestra:\n          scopes: [openid, profile, email]\n          token:\n            url: http://localhost:8080/oidc/token\n          jwks-uri: http://localhost:8080/oidc/jwks\n`},
  volumes: [{type: 'bind', source: '/user/plugins', target: '/app/plugins'}]}
}, volumes: {'user-pg': {name: 'user-data'}}}
const inputs = {project: owner, base: 'http://127.0.0.1:18080/', hostImage: 'ghcr.io/ai-specs/kestra-overlay@sha256:' + 'a'.repeat(64),
  amisJar: '/formal/amis.jar', rbacJar: '/formal/rbac.jar', amisJarSha256: 'b'.repeat(64), rbacJarSha256: 'c'.repeat(64),
  postgresPassword: secret, clientSecret: 'test-client-secret', admin: {username: 'manager', password: 'test-admin-secret'},
  modes: {A: {database: 'application_group_acceptance_123_1', storage: 'amis-a-abc'}, B: {database: 'application_group_acceptance_123_2', storage: 'amis-b-def'}}}

function setup(t, options = {}) {
  mkdirSync('.work', {recursive: true})
  const parent = mkdtempSync(resolve('.work/managed-amis-unit-'))
  t.after(() => rmSync(parent, {recursive: true}))
  const directory = join(parent, 'run')
  const calls = [], containers = new Map(), volumes = new Map(), networks = new Map(), databases = new Map()
  let counter = 0
  const runner = async (command, args, transport = {}) => {
    assert.equal(command, 'docker'); calls.push({args, input: transport.input})
    const json = value => ({stdout: JSON.stringify([value]), stderr: ''})
    if (args[0] === 'ps') {
      if (args.includes('ancestor=postgres:18')) return {stdout: options.existingPg ? 'foreign-pg' : ''}
      return {stdout: [...containers.keys()].join('\n')}
    }
    if (args[0] === 'inspect') { assert(containers.has(args[1])); return json(containers.get(args[1])) }
    if (['volume', 'network'].includes(args[0])) {
      const collection = args[0] === 'volume' ? volumes : networks
      if (args[1] === 'ls') return {stdout: [...collection.keys()].join('\n')}
      if (args[1] === 'inspect') return json(collection.get(args[2]))
      if (args[1] === 'rm') {
        if (options.failCleanup) throw new Error('cleanup failed ' + secret)
        collection.delete(args[2]); return {stdout: ''}
      }
      assert.fail('Unexpected resource command')
    }
    if (args[0] === 'rm') { assert(containers.has(args.at(-1))); containers.delete(args.at(-1)); return {stdout: ''} }
    if (args[0] === 'exec') {
      assert(!args.join(' ').includes(secret))
      if (transport.input.startsWith('SELECT')) {
        const name = /WHERE datname='([^']+)'/.exec(transport.input)[1]
        assert(databases.has(name), 'Unknown database')
        return {stdout: JSON.stringify(databases.get(name))}
      }
      assert.match(transport.input, /^CREATE DATABASE "application_group_acceptance_/)
      const name = /^CREATE DATABASE "([^"]+)"/.exec(transport.input)[1]
      if (databases.has(name)) throw new Error('database already exists')
      databases.set(name, {owner: 'kestra', comment: owner})
      return {stdout: 'CREATE DATABASE\n'}
    }
    assert.equal(args[0], 'compose')
    const raw = JSON.parse(readFileSync(args[args.indexOf('-f') + 1]))
    const service = args.at(-1)
    if (args.includes('up')) {
      for (const [kind, collection] of [['volumes', volumes], ['networks', networks]]) {
        const entries = Object.values(raw[kind]).filter(item => kind === 'networks' || raw.services[service].volumes.some(mount => mount.source === item.name))
        for (const entry of entries) collection.set(entry.name, {Name: entry.name, Labels: {...entry.labels, 'com.docker.compose.project': owner}})
      }
      const id = (++counter).toString(16).padStart(64, '0')
      containers.set(id, {Id: id, Config: {Image: raw.services[service].image,
        Env: Object.entries(raw.services[service].environment).map(([key, value]) => `${key}=${String(value).split('$$').join('$')}`),
        Labels: {owner, 'com.docker.compose.project': owner,
        'com.docker.compose.service': service}}, State: {Running: true, Health: {Status: 'healthy'}},
      NetworkSettings: {Ports: service === 'kestra' ? {'8080/tcp': [{HostIp: '127.0.0.1', HostPort: '18080'}]} : {'5432/tcp': null}},
      Mounts: raw.services[service].volumes.map(mount => ({Type: mount.type, Source: mount.source,
        ...(mount.type === 'volume' ? {Name: mount.source} : {}), Destination: mount.target, RW: !mount.read_only}))})
      if (options.failUp === service) throw new Error('partial up failure ' + secret)
      return {stdout: 'started ' + secret}
    }
    if (args.includes('ps')) return {stdout: [...containers.values()].find(item => item.Config.Labels['com.docker.compose.service'] === service)?.Id ?? ''}
    if (args.includes('config')) return {stdout: ''}
    assert.fail('Unexpected Compose command')
  }
  const selectedInputs = options.probe ? {...inputs, probeJar: '/formal/probe.jar', probeJarSha256: 'e'.repeat(64)} : inputs
  const manager = createManagedAmisCompose({directory, sourceCompose: source, inputs: selectedInputs, runner})
  return {directory, manager, calls, containers, volumes, networks, databases}
}

test('A/B uses one PG with independent databases, readonly jars, literal-safe configs and owned cleanup', async t => {
  const before = structuredClone(source)
  const fixture = setup(t)
  assert.equal(statSync(join(fixture.directory, 'compose.json')).mode & 0o777, 0o600)
  assert.equal(statSync(join(fixture.directory, 'test.env')).mode & 0o777, 0o600)
  const pg = await fixture.manager.startPostgres()
  const a = await fixture.manager.startMode('A')
  assert.equal(a.actualMounts.filter(m => m.target.startsWith('/app/libs/')).length, 1)
  const b = await fixture.manager.startMode('B')
  assert.equal(b.postgresContainer, pg.postgresContainer)
  assert.equal(b.actualMounts.filter(m => m.target.startsWith('/app/libs/')).length, 2)
  const returnA = await fixture.manager.startMode('A')
  assert.equal(returnA.mode, 'A')
  assert.equal(returnA.postgresContainer, pg.postgresContainer)
  assert.notEqual(returnA.kestraContainer, a.kestraContainer)
  assert.notEqual(returnA.kestraContainer, b.kestraContainer)
  assert.equal(returnA.actualMounts.filter(m => m.target.startsWith('/app/libs/')).length, 1)
  assert.equal(returnA.actualMounts.find(m => m.target === '/app/storage').source, a.actualMounts.find(m => m.target === '/app/storage').source)
  assert.equal(fixture.calls.filter(c => c.args.includes('up') && c.args.at(-1) === 'postgres').length, 1)
  const sql = fixture.calls.filter(c => c.args[0] === 'exec' && c.input.startsWith('CREATE')).map(c => c.input)
  assert.equal(sql.length, 2)
  assert(sql[0].includes(inputs.modes.A.database)); assert(sql[1].includes(inputs.modes.B.database))
  assert(readFileSync(join(fixture.directory, 'compose-0002-A.json'), 'utf8').includes('$${SECRET}'))
  assert(readFileSync(join(fixture.directory, 'compose-0003-B.json'), 'utf8').includes('http://localhost:8080/oidc/token'))
  assert.equal(readFileSync(join(fixture.directory, 'compose-0002-A.json'), 'utf8'), readFileSync(join(fixture.directory, 'compose-0004-A.json'), 'utf8'))
  assert.equal(fixture.databases.size, 2)
  assert.equal(fixture.containers.size, 2)
  for (const name of readdirSync(fixture.directory).filter(name => name.endsWith('.log') || name === 'resources.json')) {
    assert(!readFileSync(join(fixture.directory, name), 'utf8').includes(secret))
  }
  assert(!JSON.stringify(fixture.manager).includes('test-admin-secret'))
  assert.equal(fixture.manager.private.admin.password, 'test-admin-secret')
  await fixture.manager.cleanup()
  assert(fixture.manager.resources.created.every(item => item.removed))
  assert.equal(fixture.containers.size + fixture.volumes.size + fixture.networks.size, 0)
  assert.deepEqual(source, before)
})

test('running foreign PostgreSQL prevents up and never stops or deletes it', async t => {
  const fixture = setup(t, {existingPg: true})
  await assert.rejects(fixture.manager.startPostgres(), /paused externally/)
  await fixture.manager.cleanup()
  assert(!fixture.calls.some(c => c.args.includes('up') || ['stop', 'rm', 'run'].includes(c.args[0])))
})

test('partial up failure journals discovered own resources and cleanup removes only them', async t => {
  const fixture = setup(t, {failUp: 'postgres'})
  await assert.rejects(fixture.manager.startPostgres(), error => !error.message.includes(secret))
  assert(fixture.manager.resources.created.length > 0)
  await fixture.manager.cleanup()
  assert(fixture.manager.resources.created.every(item => item.removed))
})

test('foreign owner mutation refuses destructive operation and retains cleanup failure journal', async t => {
  const fixture = setup(t)
  const pg = await fixture.manager.startPostgres()
  fixture.containers.get(pg.postgresContainer).Config.Labels.owner = 'foreign'
  await assert.rejects(fixture.manager.cleanup(), /cleanup failed/)
  assert(!fixture.calls.some(c => c.args[0] === 'rm' && c.args.at(-1) === pg.postgresContainer))
  assert(fixture.manager.resources.created.some(item => item.kind === 'container' && !item.removed))
})

test('cleanup errors remain visible and redacted with unremoved resources', async t => {
  const fixture = setup(t, {failCleanup: true})
  await fixture.manager.startPostgres()
  await assert.rejects(fixture.manager.cleanup(), /cleanup failed/)
  assert(fixture.manager.resources.created.some(item => !item.removed))
  assert(!JSON.stringify(fixture.manager.resources).includes(secret))
})

test('old output directory and duplicate start are rejected without recreating PostgreSQL', async t => {
  const fixture = setup(t)
  assert.throws(() => createManagedAmisCompose({directory: fixture.directory, sourceCompose: source, inputs, runner: async () => assert.fail('no transport')}), /EEXIST/)
  await fixture.manager.startPostgres()
  await assert.rejects(fixture.manager.startPostgres(), /already started/)
  assert.equal(fixture.calls.filter(c => c.args.includes('up') && c.args.at(-1) === 'postgres').length, 1)
  await fixture.manager.cleanup()
})

test('returning mode refuses changed database ownership instead of recreating it', async t => {
  const fixture = setup(t)
  await fixture.manager.startPostgres()
  await fixture.manager.startMode('A')
  await fixture.manager.startMode('B')
  fixture.databases.get(inputs.modes.A.database).comment = 'foreign-owner'
  const previousUps = fixture.calls.filter(c => c.args.includes('up')).length
  await assert.rejects(fixture.manager.startMode('A'), /Database journal owner differs/)
  assert.equal(fixture.calls.filter(c => c.args.includes('up')).length, previousUps)
  assert.equal(fixture.calls.filter(c => c.args[0] === 'exec' && c.input.startsWith('CREATE')).length, 2)
  await fixture.manager.cleanup()
})

test('same-label volume created externally is not adopted by cleanup', async t => {
  const fixture = setup(t)
  await fixture.manager.startPostgres()
  const external = `${owner}-${inputs.modes.B.storage}`
  fixture.volumes.set(external, {Name: external, Labels: {owner, 'com.docker.compose.project': owner}})
  await fixture.manager.cleanup()
  assert(fixture.volumes.has(external))
  assert(!fixture.manager.resources.created.some(item => item.id === external))
  assert(!fixture.calls.some(c => c.args[0] === 'volume' && c.args[1] === 'rm' && c.args[2] === external))
})

test('mode switch checks app owner before removing its current container', async t => {
  const fixture = setup(t)
  await fixture.manager.startPostgres()
  const app = await fixture.manager.startMode('A')
  fixture.containers.get(app.kestraContainer).Config.Labels.owner = 'foreign'
  await assert.rejects(fixture.manager.startMode('B'), /Foreign owner/)
  assert(!fixture.calls.some(c => c.args[0] === 'rm' && c.args.at(-1) === app.kestraContainer))
  await assert.rejects(fixture.manager.cleanup(), /cleanup failed/)
})

test('inspect rejects actual configuration, binding, image, mounts and PG owner mismatches without exposing secrets', async t => {
  const mutations = [
    app => { app.Config.Env = app.Config.Env.map(value => value.startsWith('KESTRA_CONFIGURATION=') ? 'KESTRA_CONFIGURATION=wrong-private-configuration' : value) },
    app => { app.Config.Env = app.Config.Env.filter(value => !value.startsWith('KESTRA_CONFIGURATION=')) },
    app => { app.Config.Env.push(app.Config.Env.find(value => value.startsWith('KESTRA_CONFIGURATION='))) },
    app => { app.NetworkSettings.Ports['8080/tcp'][0].HostIp = '0.0.0.0' },
    app => { app.NetworkSettings.Ports['8080/tcp'][0].HostPort = '18081' },
    app => { app.NetworkSettings.Ports['8080/tcp'].push({HostIp: '::', HostPort: '18080'}) },
    app => { app.NetworkSettings.Ports['9999/tcp'] = [{HostIp: '127.0.0.1', HostPort: '19999'}] },
    app => { app.Config.Image = 'unselected:latest' },
    app => { app.Mounts.find(mount => mount.Destination.startsWith('/app/libs/')).Source = '/wrong.jar' },
    app => { app.Mounts.find(mount => mount.Destination.startsWith('/app/libs/')).RW = true },
    app => { app.Mounts.find(mount => mount.Destination === '/app/storage').Name = 'user-storage' },
    (app, pg) => { pg.Config.Labels.owner = 'foreign' }
  ]
  for (const mutate of mutations) {
    const fixture = setup(t)
    await fixture.manager.startPostgres()
    const snapshot = await fixture.manager.startMode('A')
    assert(!JSON.stringify(snapshot).includes('KESTRA_CONFIGURATION'))
    assert(!JSON.stringify(snapshot).includes(secret))
    const app = fixture.containers.get(snapshot.kestraContainer)
    const pg = fixture.containers.get(snapshot.postgresContainer)
    const originalApp = structuredClone(app), originalPg = structuredClone(pg)
    mutate(app, pg)
    await assert.rejects(fixture.manager.inspect(), error => {
      assert(!error.message.includes(secret))
      assert(!error.message.includes('wrong-private-configuration'))
      return true
    })
    fixture.containers.set(snapshot.kestraContainer, originalApp)
    fixture.containers.set(snapshot.postgresContainer, originalPg)
    await fixture.manager.cleanup()
  }
})

test('A missing/disabled/restore then B duplicate-fault/restore then A preserves original plans and single PG', async t => {
  const originalSource = structuredClone(source)
  const originalInputs = structuredClone(inputs)
  const fixture = setup(t, {probe: true})
  const latest = () => JSON.parse(readFileSync(join(fixture.directory, 'compose.json')))
  await fixture.manager.startPostgres()
  const a = await fixture.manager.startMode('A')
  const aPlan = latest()
  const missing = await fixture.manager.reconfigureOwnedApp({mode: 'A', variant: {amisPresent: false}})
  assert.equal(missing.actualMounts.filter(item => item.target.startsWith('/app/libs')).length, 0)
  assert.equal(missing.variant.originalJarMounted.amis, true)
  const disabled = await fixture.manager.reconfigureOwnedApp({mode: 'A', variant: {amisEnabled: false}})
  assert.equal(disabled.variant.amisPresent, true)
  assert.equal(disabled.variant.amisEnabled, false)
  const disabledConfiguration = latest().services.kestra.environment.KESTRA_CONFIGURATION
  assert(disabledConfiguration.includes('  amis-apps:\n    enabled: false'))
  assert(disabledConfiguration.includes('  rbac:\n    enabled: false'))
  const restoredA = await fixture.manager.reconfigureOwnedApp({mode: 'A', variant: {}})
  assert.deepEqual(latest(), aPlan)
  assert.equal(restoredA.configurationSha256, a.configurationSha256)
  const b = await fixture.manager.startMode('B')
  const bPlan = latest()
  const fault = await fixture.manager.reconfigureOwnedApp({mode: 'B', variant: {
    testJvmProperties: {'amis.acceptance.fault.routeProvider': 'duplicate'}
  }})
  assert.equal(fault.variant.testJvmProperties['amis.acceptance.fault.routeProvider'], 'duplicate')
  let jvm = latest().services.kestra.environment.JAVA_TOOL_OPTIONS
  assert(jvm.includes('-javaagent:/acceptance/probe.jar'))
  assert.equal(jvm.split('-Damis.acceptance.fault.routeProvider=duplicate').length - 1, 1)
  await fixture.manager.reconfigureOwnedApp({mode: 'B', variant: {testJvmProperties: {'amis.acceptance.fault.routeProvider': 'faulted'}}})
  jvm = latest().services.kestra.environment.JAVA_TOOL_OPTIONS
  assert(!jvm.includes('duplicate'))
  assert.equal(jvm.split('-Damis.acceptance.fault.routeProvider=faulted').length - 1, 1)
  const restoreB = await fixture.manager.reconfigureOwnedApp({mode: 'B', variant: {}})
  assert.deepEqual(latest(), bPlan)
  assert.equal(restoreB.configurationSha256, b.configurationSha256)
  const returnA = await fixture.manager.startMode('A')
  assert.deepEqual(latest(), aPlan)
  assert.equal(returnA.postgresContainer, a.postgresContainer)
  const appStates = [a, missing, disabled, restoredA, b, fault, restoreB, returnA]
  for (const state of appStates) {
    assert.equal(state.postgresContainer, a.postgresContainer)
    const expectedStorage = state.mode === 'A' ? a : b
    assert.equal(state.actualMounts.find(item => item.target === '/app/storage').source,
      expectedStorage.actualMounts.find(item => item.target === '/app/storage').source)
    assert(!JSON.stringify(state).includes(secret))
  }
  assert.equal(fixture.calls.filter(c => c.args.includes('up') && c.args.at(-1) === 'postgres').length, 1)
  assert.equal(fixture.calls.filter(c => c.args[0] === 'exec' && c.input.startsWith('CREATE')).length, 2)
  const snapshots = readdirSync(fixture.directory).filter(name => /^compose-\d{4}-[AB]\.json$/.test(name))
  assert.equal(snapshots.length, 10)
  assert(snapshots.every(name => (statSync(join(fixture.directory, name)).mode & 0o777) === 0o600))
  assert.deepEqual(source, originalSource); assert.deepEqual(inputs, originalInputs)
  await fixture.manager.cleanup()
})

test('variant whitelist and active owner reject before app removal or database activity', async t => {
  const fixture = setup(t)
  await fixture.manager.startPostgres()
  const a = await fixture.manager.startMode('A')
  const previousCommands = fixture.calls.length
  for (const request of [
    {mode: 'B', variant: {}}, {mode: 'A', variant: {unknown: true}}, {mode: 'A', variant: {rbacPresent: true}},
    {mode: 'A', variant: {amisPresent: 'false'}}, {mode: 'A', variant: {originalJarMounted: false}},
    {mode: 'A', variant: {testJvmProperties: {'arbitrary.property': 'x'}}},
    {mode: 'A', variant: {testJvmProperties: {'amis.acceptance.fault.x': 'x -javaagent:evil'}}}
  ]) await assert.rejects(fixture.manager.reconfigureOwnedApp(request))
  assert.equal(fixture.calls.length, previousCommands)
  fixture.containers.get(a.kestraContainer).Config.Labels.owner = 'foreign'
  await assert.rejects(fixture.manager.reconfigureOwnedApp({mode: 'A', variant: {amisPresent: false}}), /Foreign owner/)
  assert(!fixture.calls.some(c => c.args[0] === 'rm' && c.args.at(-1) === a.kestraContainer))
  fixture.containers.get(a.kestraContainer).Config.Labels.owner = owner
  await fixture.manager.startMode('B')
  const noAuthorizer = await fixture.manager.reconfigureOwnedApp({mode: 'B', variant: {rbacPresent: false}})
  assert.equal(noAuthorizer.variant.originalJarMounted.rbac, true)
  assert.equal(noAuthorizer.actualMounts.filter(m => m.target.startsWith('/app/libs')).length, 1)
  const restored = await fixture.manager.reconfigureOwnedApp({mode: 'B', variant: {}})
  assert.equal(restored.actualMounts.filter(m => m.target.startsWith('/app/libs')).length, 2)
  await fixture.manager.cleanup()
})
