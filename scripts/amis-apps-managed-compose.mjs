import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {createHash} from 'node:crypto'
import {mkdirSync, realpathSync, writeFileSync, renameSync} from 'node:fs'
import {dirname, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {setTimeout as delay} from 'node:timers/promises'
import {planAmisCompose} from './amis-apps-compose.mjs'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hash = value => createHash('sha256').update(value).digest('hex')
const containerPattern = /^[a-f0-9]{64}$/

function defaultRunner(command, args, {input, timeout = 180000} = {}) {
  return new Promise((accept, reject) => {
    const child = execFile(command, args, {timeout, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8'}, (error, stdout, stderr) => {
      if (error) reject(error)
      else accept({stdout, stderr})
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input ?? '')
  })
}

// Compose interpolation is a second pass even for JSON. Preserve every literal '$'.
function composeLiterals(value) {
  if (typeof value === 'string') return value.split('$').join('$$')
  if (Array.isArray(value)) return value.map(composeLiterals)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, composeLiterals(item)]))
  return value
}

/** Inputs must already have passed release audits. modes.A/B supply distinct
 * {database,storage,admin}; optional testOptions(mode) supports probe/fault testing
 * via {jvmProperties,kestraConfiguration}; never modifies jars or images.
 * reconfigureOwnedApp({mode,variant:{amisPresent?,amisEnabled?,rbacPresent?,
 * testJvmProperties?}}) restarts only the active app from its original mode plan.
 * Empty variant restores the exact original graph; A never accepts RBAC present.
 * runner('docker', argv, {input,timeout}) is the explicit test transport seam.
 */
export function createManagedAmisCompose({directory, sourceCompose, inputs, runner = defaultRunner}) {
  const privateInputs = structuredClone(inputs)
  const owner = privateInputs.project
  assert.match(owner, /^application-projects-bb-[0-9]+-[0-9]+$/)
  assert.equal(sourceCompose.services?.postgres?.image, 'postgres:18')
  assert.equal(sourceCompose.services.postgres.environment?.POSTGRES_DB, 'kestra')
  assert.equal(sourceCompose.services.postgres.environment?.POSTGRES_USER, 'kestra')
  assert(privateInputs.modes?.A && privateInputs.modes?.B, 'Explicit A/B mode inputs required')
  assert.notEqual(privateInputs.modes.A.database, privateInputs.modes.B.database, 'A/B databases must differ')
  const area = resolve(directory)
  assert(area.startsWith(resolve(repository, '.work') + sep), 'New root .work directory required')
  assert.equal(realpathSync(dirname(area)), dirname(area), 'Symlink parent forbidden')
  const secrets = new Set()
  function collect(value, key = '') {
    if (typeof value === 'string' && /password|secret|token|cookie/i.test(key) && value) secrets.add(value)
    else if (value && typeof value === 'object') for (const [name, item] of Object.entries(value)) collect(item, name)
  }
  collect(privateInputs); collect(sourceCompose)
  function redact(value) {
    let text = String(value)
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) text = text.replaceAll(secret, '[REDACTED]')
    return text.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
      .replace(/((?:password|token|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
  }
  const plans = {}
  for (const mode of ['A', 'B']) {
    const selected = privateInputs.modes[mode]
    for (const key of Object.keys(selected)) assert(['database', 'storage', 'admin'].includes(key), 'Unexpected mode override')
    const plan = planAmisCompose(sourceCompose, {...privateInputs, ...selected, mode})
    if (privateInputs.clientSecret !== undefined) plan.raw.services.kestra.environment.KESTRA_OIDC_UI_CLIENT_SECRET = privateInputs.clientSecret
    const testOptions = privateInputs.testOptions?.[mode]
    if (testOptions) {
      for (const key of Object.keys(testOptions)) assert(['jvmProperties', 'kestraConfiguration'].includes(key))
      const environment = plan.raw.services.kestra.environment
      const properties = testOptions.jvmProperties ?? {}
      for (const [key, value] of Object.entries(properties)) {
        assert.match(key, /^amis\.acceptance\.[A-Za-z0-9_.-]+$/)
        assert.match(String(value), /^[A-Za-z0-9_.-]+$/)
        environment.JAVA_TOOL_OPTIONS = `${environment.JAVA_TOOL_OPTIONS ?? ''} -D${key}=${value}`.trim()
      }
      if (testOptions.kestraConfiguration !== undefined) {
        assert.equal(typeof testOptions.kestraConfiguration, 'string')
        environment.KESTRA_CONFIGURATION += '\n' + testOptions.kestraConfiguration
      }
    }
    plans[mode] = plan
  }
  mkdirSync(area, {mode: 0o700})
  const config = resolve(area, 'compose.json')
  const envFile = resolve(area, 'test.env')
  writeFileSync(envFile, '# Test configuration uses escaped literal values; no inherited .env is loaded.\n', {flag: 'wx', mode: 0o600})
  const resources = {owner, created: [], errors: []}
  let pgId, activeId, activeMode, activePlan, activeVariant, closed = false, busy = false, preflightDone = false
  function persist() { writeFileSync(resolve(area, 'resources.json'), JSON.stringify(resources, null, 2) + '\n', {mode: 0o600}) }
  let generation = 0
  function save(mode, plan = plans[mode]) {
    const raw = composeLiterals(plan.raw)
    const bytes = JSON.stringify(raw, null, 2) + '\n'
    const saved = resolve(area, `compose-${String(++generation).padStart(4, '0')}-${mode}.json`)
    writeFileSync(saved, bytes, {flag: 'wx', mode: 0o600})
    writeFileSync(resolve(area, 'compose.next'), bytes, {flag: 'wx', mode: 0o600})
    renameSync(resolve(area, 'compose.next'), config)
  }
  save('A'); persist()
  const compose = ['compose', '--env-file', envFile, '-p', owner, '-f', config]
  let commandNumber = 0
  async function runCommand(args, options = {}) {
    assert(Array.isArray(args) && args.every(value => typeof value === 'string'))
    assert(['compose', 'ps', 'inspect', 'volume', 'network', 'exec', 'rm'].includes(args[0]))
    const number = ++commandNumber
    try {
      const result = await runner('docker', args, {...options, timeout: options.timeout ?? 180000})
      assert(result && typeof result.stdout === 'string', 'Runner stdout required')
      writeFileSync(resolve(area, `command-${number}.log`), redact(result.stdout + (result.stderr ?? '')), {mode: 0o600})
      return result.stdout.trim()
    } catch (error) {
      const failure = new Error(redact(error.message ?? error))
      resources.errors.push({command: number, operation: args[0], message: failure.message})
      writeFileSync(resolve(area, `command-${number}.log`), redact(`${failure.message}\n${error.stdout ?? ''}\n${error.stderr ?? ''}`), {mode: 0o600})
      persist()
      throw failure
    }
  }
  const volumeNames = new Set(Object.values(plans).flatMap(plan => Object.values(plan.raw.volumes).map(volume => volume.name)))
  const networkName = plans.A.raw.networks.default.name
  function remember(kind, id, extra = {}) {
    let resource = resources.created.find(item => item.kind === kind && item.id === id)
    if (!resource) { resource = {kind, id, owner, removed: false, ...extra}; resources.created.push(resource); persist() }
    return resource
  }
  async function inspectOwned(kind, id) {
    if (kind === 'container') assert.match(id, containerPattern)
    const args = kind === 'container' ? ['inspect', id] : [kind, 'inspect', id]
    const values = JSON.parse(await runCommand(args))
    assert(Array.isArray(values) && values.length === 1)
    const value = values[0]
    const labels = kind === 'container' ? value.Config?.Labels : value.Labels
    assert.equal(labels?.owner, owner, 'Foreign owner; operation refused')
    assert.equal(labels?.['com.docker.compose.project'], owner, 'Foreign Compose project')
    if (kind === 'container') assert.equal(value.Id, id)
    else assert.equal(value.Name, id)
    return value
  }
  async function discover(creation) {
    if (!preflightDone) return
    const ids = (await runCommand(['ps', '-aq', '--no-trunc', '--filter', `label=com.docker.compose.project=${owner}`])).split(/\s+/).filter(Boolean)
    for (const id of ids) {
      const value = await inspectOwned('container', id)
      const service = value.Config.Labels['com.docker.compose.service']
      assert(['postgres', 'kestra'].includes(service), 'Unexpected owned service')
      const known = resources.created.some(item => item.kind === 'container' && item.id === id)
      if (!known && creation?.service === service && !creation.beforeIds.has(id)) remember('container', id, {service})
    }
    for (const kind of ['volume', 'network']) {
      const names = (await runCommand([kind, 'ls', '--format', '{{.Name}}'])).split('\n').filter(Boolean)
      for (const name of names) if (kind === 'volume' ? volumeNames.has(name) : name === networkName) {
        const known = resources.created.some(item => item.kind === kind && item.id === name)
        if (known || creation?.[kind]?.has(name)) {
          await inspectOwned(kind, name); remember(kind, name)
        }
      }
    }
  }
  async function preflight() {
    assert.equal(await runCommand(['ps', '-q', '--filter', 'ancestor=postgres:18']), '', 'Existing PostgreSQL must be paused externally')
    assert.equal(await runCommand(['ps', '-aq', '--filter', `label=com.docker.compose.project=${owner}`]), '', 'Project already has containers')
    for (const kind of ['volume', 'network']) {
      const names = (await runCommand([kind, 'ls', '--format', '{{.Name}}'])).split('\n')
      assert(!names.some(name => kind === 'volume' ? volumeNames.has(name) : name === networkName), 'Pre-existing resource name collision')
    }
    preflightDone = true
  }
  async function exclusive(action) {
    assert(!closed && !busy, 'Manager closed or operation already running')
    busy = true
    try { return await action() } finally { busy = false }
  }
  async function upAndDiscover(args) {
    const service = args.at(-1)
    const beforeIds = new Set((await runCommand(['ps', '-aq', '--no-trunc', '--filter', `label=com.docker.compose.project=${owner}`])).split(/\s+/).filter(Boolean))
    for (const id of beforeIds) assert(resources.created.some(item => item.kind === 'container' && item.id === id && !item.removed), 'Unjournaled project container')
    const plan = service === 'postgres' ? plans.A : pendingPlan
    const requiredVolumes = new Set(plan.raw.services[service].volumes.filter(item => item.type === 'volume').map(item => plan.raw.volumes[item.source].name))
    const creation = {service, beforeIds, volume: new Set(), network: new Set()}
    for (const [kind, required] of [['volume', requiredVolumes], ['network', new Set([networkName])]]) {
      const existing = new Set((await runCommand([kind, 'ls', '--format', '{{.Name}}'])).split('\n').filter(Boolean))
      for (const name of required) {
        if (existing.has(name)) {
          assert(resources.created.some(item => item.kind === kind && item.id === name && !item.removed), 'Unjournaled resource collision')
          await inspectOwned(kind, name)
        } else creation[kind].add(name)
      }
    }
    let failure
    try { await runCommand(args) } catch (error) { failure = error }
    try { await discover(creation) } catch (error) {
      if (failure) failure.discoveryError = redact(error.message)
      else failure = error
    }
    if (failure) throw failure
  }
  let pendingPlan
  async function startPostgres() {
    return exclusive(async () => {
      assert(!pgId, 'PostgreSQL already started')
      await preflight()
      await upAndDiscover([...compose, 'up', '-d', '--no-deps', 'postgres'])
      pgId = await runCommand([...compose, 'ps', '-q', 'postgres'])
      let ready = false
      for (let attempt = 0; attempt < 90; attempt++) {
        const value = await inspectOwned('container', pgId)
        assert.equal(value.Config.Image, 'postgres:18')
        assert.equal(value.State?.Running, true)
        if (value.State?.Health?.Status === 'healthy') { ready = true; break }
        await delay(1000)
      }
      assert(ready, 'Owned PostgreSQL health deadline exceeded')
      return {postgresContainer: pgId, owner}
    })
  }
  async function startMode(mode) {
    return exclusive(async () => {
      assert(['A', 'B'].includes(mode) && pgId, 'Owned PostgreSQL and valid mode required')
      const postgres = await inspectOwned('container', pgId)
      assert.equal(postgres.Config.Image, 'postgres:18')
      assert.equal(postgres.State?.Health?.Status, 'healthy')
      if (activeId) {
        await inspectOwned('container', activeId)
        await runCommand(['rm', '-f', activeId])
        resources.created.find(item => item.id === activeId && item.kind === 'container').removed = true
        persist(); activeId = undefined
      }
      const database = privateInputs.modes[mode].database
      const existingDatabase = resources.created.find(item => item.kind === 'database' && item.id === database && item.mode === mode && !item.removed)
      if (!existingDatabase) {
        await runCommand(['exec', '-i', pgId, 'psql', '-X', '-U', 'kestra', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
          {input: `CREATE DATABASE "${database}" OWNER kestra;\nCOMMENT ON DATABASE "${database}" IS '${owner}';\n`})
        remember('database', database, {mode})
      } else {
        const proof = JSON.parse(await runCommand(['exec', '-i', pgId, 'psql', '-X', '-U', 'kestra', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
          {input: `SELECT json_build_object('owner',pg_get_userbyid(datdba),'comment',shobj_description(oid,'pg_database')) FROM pg_database WHERE datname='${database}';\n`}))
        assert.equal(proof.owner, 'kestra', 'Database role owner differs')
        assert.equal(proof.comment, owner, 'Database journal owner differs')
      }
      save(mode)
      pendingPlan = plans[mode]
      await runCommand([...compose, 'config', '--quiet'])
      await upAndDiscover([...compose, 'up', '-d', '--no-deps', '--force-recreate', 'kestra'])
      activeId = await runCommand([...compose, 'ps', '-q', 'kestra'])
      const current = await inspectOwned('container', activeId)
      assert.equal(current.Config.Image, privateInputs.hostImage)
      activeMode = mode
      activePlan = plans[mode]
      activeVariant = variantFor(mode, {}).public
      return inspect()
    })
  }
  function variantFor(mode, variant) {
    assert(['A', 'B'].includes(mode), 'Valid mode required')
    assert(variant && typeof variant === 'object' && !Array.isArray(variant), 'Explicit variant object required')
    const keys = ['amisPresent', 'amisEnabled', 'rbacPresent', 'testJvmProperties']
    for (const key of Object.keys(variant)) assert(keys.includes(key), 'Unknown variant key')
    for (const key of keys.slice(0, 3)) if (Object.hasOwn(variant, key)) assert.equal(typeof variant[key], 'boolean', 'Variant boolean required')
    const plan = structuredClone(plans[mode])
    const host = plan.raw.services.kestra
    const amisTarget = '/app/libs/kestra-amis-apps.jar'
    const rbacTarget = '/app/libs/kestra-rbac-authorizer.jar'
    const originalJarMounted = {amis: host.volumes.some(item => item.target === amisTarget), rbac: host.volumes.some(item => item.target === rbacTarget)}
    const amisPresent = variant.amisPresent ?? originalJarMounted.amis
    const rbacPresent = variant.rbacPresent ?? originalJarMounted.rbac
    assert(mode !== 'A' || !rbacPresent, 'Mode A must never mount RBAC')
    assert(!amisPresent || originalJarMounted.amis, 'Original AMIS mount required')
    assert(!rbacPresent || originalJarMounted.rbac, 'Original RBAC mount required')
    host.volumes = host.volumes.filter(item => (item.target !== amisTarget || amisPresent) && (item.target !== rbacTarget || rbacPresent))
    const configuration = host.environment.KESTRA_CONFIGURATION
    const headings = [...configuration.matchAll(/^  amis-apps:\s*\n/gm)]
    assert.equal(headings.length, 1, 'Unique original amis-apps section required')
    const start = headings[0].index + headings[0][0].length
    const remaining = configuration.slice(start)
    const next = remaining.search(/^(?:  \S|\S)/m)
    const end = next < 0 ? configuration.length : start + next
    const section = configuration.slice(start, end)
    assert.equal((section.match(/^    enabled: true$/gm) ?? []).length, 1, 'Original amis-apps enabled:true required')
    assert.equal((section.match(/^    enabled:/gm) ?? []).length, 1, 'Unique amis-apps enabled flag required')
    const amisEnabled = variant.amisEnabled ?? true
    host.environment.KESTRA_CONFIGURATION = configuration.slice(0, start)
      + section.replace(/^    enabled: true$/m, `    enabled: ${amisEnabled}`) + configuration.slice(end)
    const properties = variant.testJvmProperties ?? {}
    assert(properties && typeof properties === 'object' && !Array.isArray(properties), 'Fault property map required')
    const additions = []
    for (const [key, value] of Object.entries(properties).sort(([a], [b]) => a.localeCompare(b))) {
      assert.match(key, /^amis\.acceptance\.fault\.[A-Za-z0-9_.-]+$/)
      assert(['string', 'boolean', 'number'].includes(typeof value))
      assert.match(String(value), /^[A-Za-z0-9_.-]+$/)
      additions.push(`-D${key}=${value}`)
    }
    if (additions.length) host.environment.JAVA_TOOL_OPTIONS = [host.environment.JAVA_TOOL_OPTIONS ?? '', ...additions].filter(Boolean).join(' ')
    return {plan, public: {amisPresent, amisEnabled, rbacPresent, originalJarMounted, testJvmProperties: structuredClone(properties)}}
  }
  async function reconfigureOwnedApp({mode, variant}) {
    return exclusive(async () => {
      assert(activeId && mode === activeMode, 'Reconfigure only the active mode')
      const derived = variantFor(mode, variant)
      const pg = await inspectOwned('container', pgId)
      assert.equal(pg.Config.Image, 'postgres:18')
      assert.equal(pg.State?.Running, true)
      await inspectOwned('container', activeId)
      save(mode, derived.plan)
      await runCommand([...compose, 'config', '--quiet'])
      await runCommand(['rm', '-f', activeId])
      resources.created.find(item => item.kind === 'container' && item.id === activeId).removed = true
      persist(); activeId = undefined
      pendingPlan = derived.plan
      await upAndDiscover([...compose, 'up', '-d', '--no-deps', '--force-recreate', 'kestra'])
      activeId = await runCommand([...compose, 'ps', '-q', 'kestra'])
      activePlan = derived.plan
      activeVariant = derived.public
      return inspect()
    })
  }
  async function inspect() {
    assert(activeId && activeMode, 'No active mode')
    const postgres = await inspectOwned('container', pgId)
    assert.equal(postgres.Config.Image, 'postgres:18')
    assert.equal(postgres.State?.Running, true)
    const current = await inspectOwned('container', activeId)
    assert.equal(current.Config.Image, privateInputs.hostImage)
    assert.equal(current.State?.Running, true)
    const configurations = (current.Config.Env ?? []).filter(value => typeof value === 'string' && value.startsWith('KESTRA_CONFIGURATION='))
    assert.equal(configurations.length, 1, 'Actual configuration must be present exactly once')
    const actualConfigurationSha256 = hash(configurations[0].slice('KESTRA_CONFIGURATION='.length))
    assert.equal(actualConfigurationSha256, hash(activePlan.raw.services.kestra.environment.KESTRA_CONFIGURATION),
      'Actual configuration hash differs from plan')
    const actualJvmOptions = current.Config.Env.filter(value => typeof value === 'string' && value.startsWith('JAVA_TOOL_OPTIONS='))
    const expectedJvmOptions = activePlan.raw.services.kestra.environment.JAVA_TOOL_OPTIONS
    assert.equal(actualJvmOptions.length, expectedJvmOptions === undefined ? 0 : 1, 'Actual JAVA_TOOL_OPTIONS count differs')
    if (expectedJvmOptions !== undefined) assert.equal(hash(actualJvmOptions[0].slice('JAVA_TOOL_OPTIONS='.length)), hash(expectedJvmOptions), 'Actual JVM options hash differs')
    const ports = current.NetworkSettings?.Ports
    assert(ports && typeof ports === 'object', 'Actual published ports missing')
    const published = Object.entries(ports).filter(([, bindings]) => Array.isArray(bindings) && bindings.length > 0)
    assert.deepEqual(published.map(([port]) => port), ['8080/tcp'], 'Unexpected published port')
    const bindings = ports['8080/tcp']
    assert.equal(bindings.length, 1, 'Exactly one loopback binding required')
    assert.equal(bindings[0].HostIp, '127.0.0.1', 'Actual port is not loopback-only')
    assert.equal(bindings[0].HostPort, new URL(plans[activeMode].public.base).port, 'Actual host port differs')
    const actualMounts = (current.Mounts ?? []).map(item => ({type: item.Type, source: item.Source, target: item.Destination, readOnly: item.RW === false}))
    const expectedLibraries = activePlan.raw.services.kestra.volumes.filter(item => item.target.startsWith('/app/libs'))
    assert.deepEqual(actualMounts.filter(item => item.target.startsWith('/app/libs')).map(item => item.target).sort(), expectedLibraries.map(item => item.target).sort())
    for (const mount of expectedLibraries) {
      assert(actualMounts.some(item => item.target === mount.target && item.source === mount.source && item.type === 'bind' && item.readOnly))
    }
    const storage = plans[activeMode].public.expectedMounts.storage
    const actualStorage = (current.Mounts ?? []).filter(item => item.Destination === '/app/storage')
    assert.equal(actualStorage.length, 1)
    assert.equal(actualStorage[0].Type, 'volume')
    assert.equal(actualStorage[0].Name, storage, 'Actual storage volume differs')
    return {owner, mode: activeMode, base: plans[activeMode].public.base, postgresContainer: pgId, kestraContainer: activeId,
      configurationSha256: actualConfigurationSha256, actualMounts, variant: structuredClone(activeVariant)}
  }
  async function cleanup() {
    assert(!busy, 'Operation already running')
    busy = true
    const failures = []
    try {
      try { await discover() } catch (error) { failures.push(error) }
      for (const kind of ['container', 'volume', 'network']) for (const resource of [...resources.created].reverse()) {
        if (resource.kind !== kind || resource.removed) continue
        try {
          await inspectOwned(kind, resource.id)
          await runCommand(kind === 'container' ? ['rm', '-f', resource.id] : [kind, 'rm', resource.id])
          resource.removed = true; persist()
        } catch (error) { failures.push(error) }
      }
      const pgVolume = resources.created.find(item => item.kind === 'volume' && item.id === `${owner}-postgres`)
      if (pgVolume?.removed) for (const resource of resources.created) if (resource.kind === 'database') resource.removed = true
      for (const error of failures) resources.errors.push({operation: 'cleanup', message: redact(error.message)})
      closed = failures.length === 0
      persist()
      if (failures.length) throw new AggregateError(failures.map(error => new Error(redact(error.message))), 'Owned resource cleanup failed; journal retained')
      return structuredClone(resources)
    } finally { busy = false }
  }
  const manager = {startPostgres, startMode, reconfigureOwnedApp, inspect, cleanup, get resources() { return structuredClone(resources) }}
  Object.defineProperty(manager, 'private', {enumerable: false, value: privateInputs})
  return manager
}
