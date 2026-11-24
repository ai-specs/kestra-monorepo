import {mkdir, readFile, writeFile, chmod, copyFile, readdir} from 'node:fs/promises'
import {createHash, createPublicKey, verify} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {runUpstreamExecutionActions} from './upstream-execution-actions.mjs'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {redactOwnedServiceLog} from './owned-service-log.mjs'
import {isAbsolute, join, resolve} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

export const queueRefusalPredicate = "NOT ((type='scheduler_event' AND value->>'type' IN ('VNODES_ASSIGNMENT_REQUEST','VNODES_ASSIGNMENT_REPLY','VNODES_ASSIGNMENT_RELEASE','VNODES_ASSIGNMENT_REJECTED') AND NOT (value ?| ARRAY['namespace','flowId','executionId','tenantId'])) IS TRUE)"
const hex = /^[a-f0-9]{64}$/
export const phases = ['inputValidation', 'ciValidation', 'publicationBinding', 'ownedProvision', 'oldBootstrapLogin', 'oldFlowKv', 'oldBoundarySideEffects', 'stopOld', 'consistentSnapshot', 'newStartLogin', 'newReadWriteBoundary', 'stopNew', 'verifySnapshot', 'restoreDatabase', 'restoreStorage', 'restoreOldConfiguration', 'startRestoredOld', 'restoredDataAndBoundary', 'ownedCleanup']
function requireValue(condition, message) { if (!condition) { const error = new Error(message); error.safeReason = message; throw error } }
export function parseArgs(args) {
  const result = {}
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    requireValue(['--run', '--config', '--evidence'].includes(key), 'Unknown argument')
    requireValue(!(key in result), 'Duplicate argument')
    if (key === '--run') result[key] = true
    else { requireValue(args[i + 1] && !args[i + 1].startsWith('--'), 'Missing argument value'); result[key] = args[++i] }
  }
  requireValue(result['--run'] && result['--config'] && result['--evidence'], 'Explicit --run --config --evidence required')
  requireValue(isAbsolute(result['--config']) && isAbsolute(result['--evidence']), 'Absolute paths required')
  return {config: result['--config'], evidence: result['--evidence']}
}
export function validateConfig(config) {
  requireValue(config && ['A', 'B'].includes(config.mode), 'Mode must be A or B')
  requireValue(/^[a-z][a-z0-9-]{7,62}$/.test(config.ownerLabel ?? ''), 'Unique ownerLabel required')
  const pg = config.postgres
  requireValue(pg && ['container', 'network', 'admin'].every(k => typeof pg[k] === 'string' && /^[a-zA-Z0-9_.-]+$/.test(pg[k])), 'Explicit existing PG container/network/admin required')
  for (const side of ['old', 'new']) {
    const value = config[side]
    requireValue(value && /^ghcr\.io\/ai-specs\/kestra-overlay@sha256:[a-f0-9]{64}$/.test(value.image), `${side}: formal digest required`)
    for (const kind of config.mode === 'B' ? ['overlay', 'plugin'] : ['overlay']) {
      const ci = value[kind]
      requireValue(ci && ci.repository === `ai-specs/kestra-${kind === 'overlay' ? 'overlay' : 'plugin-rbac'}` && Number.isSafeInteger(ci.runId) && ci.runId > 0 && /^[a-f0-9]{40}$/.test(ci.commit), `${side}: exact ${kind} CI required`)
    }
    if (config.mode === 'A') requireValue(value.jar === undefined && value.plugin === undefined, 'Mode A forbids jar/plugin')
    else requireValue(value.jar && isAbsolute(value.jar.path ?? '') && hex.test(value.jar.sha256), `${side}: jar path/SHA required`)
  }
  requireValue(Number.isInteger(config.appPort) && config.appPort > 1024 && config.appPort <= 65535, 'Explicit appPort required')
  requireValue(config.old.image !== config.new.image, 'Upgrade requires different image digests')
  return config
}
export function validateRun(ci, run, kind) {
  requireValue(run.head_sha === ci.commit && run.status === 'completed' && run.conclusion === 'success' && run.event === 'push' && run.head_branch === 'main' && run.path === `.github/workflows/${kind === 'overlay' ? 'overlay' : 'build'}.yml` && run.repository?.full_name === ci.repository && run.id === ci.runId, 'CI is not an exact successful formal push/main workflow')
}
// No prefix-based adoption: creation success and exact current ownership are both mandatory.
export function cleanupEligible(resource, currentOwner, expectedOwner) {
  return resource?.created === true && resource.owner === expectedOwner && currentOwner === expectedOwner && typeof expectedOwner === 'string' && expectedOwner.length >= 8
}

const hash = value => createHash('sha256').update(value).digest('hex')
const delay = ms => new Promise(done => setTimeout(done, ms))
const ownerKey = 'io.kestra.upgrade.owner'
const literal = value => "'" + String(value).replaceAll("'", "''") + "'"
const identifier = value => { requireValue(/^[a-z][a-z0-9_]{0,62}$/.test(value), 'Unsafe SQL identifier'); return '"' + value + '"' }
const root = fileURLToPath(new URL('..', import.meta.url))

// External errors and argv are never emitted: database/HTTP secrets may be present.
function command(program, args, {input, binary = false, env} = {}, attempt = 0) {
  try { return execFileSync(program, args, {input, encoding: binary ? undefined : 'utf8', env, timeout: 180000, maxBuffer: 128 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe']}) }
  catch (failure) {
    const readOnly = program === 'gh' && (args[0] === 'api' && !args.some(arg => ['-X','--method','-f','--raw-field','-F','--field','--input'].includes(arg)) || args[0] === 'run' && ['view','download'].includes(args[1]))
    if (readOnly && attempt < 2 && /EOF|ETIMEDOUT|ECONNRESET|TLS handshake timeout|connection reset|502 Bad Gateway|503 Service Unavailable/i.test(String(failure.code)+' '+String(failure.stderr))) return command(program,args,{input,binary,env},attempt+1)
    const error = new Error('External operation failed'); error.safeReason = 'External operation failed: ' + program
    if(program==='docker' && args[0]==='pull') {
      const diagnostic=String(failure.stderr??'')
      const kind=/denied|unauthorized|forbidden/i.test(diagnostic)?'registry authorization':/no matching manifest/i.test(diagnostic)?'platform manifest':/no space left/i.test(diagnostic)?'disk space':/manifest unknown|not found/i.test(diagnostic)?'missing image':/timeout|TLS|EOF|connection|resolve|network/i.test(diagnostic)?'registry network':'unclassified registry error'
      error.safeReason+=' pull ('+kind+'); exit='+String(failure.status??failure.code??'unknown')
    }
    throw error
  }
}
// A successful complete inventory is the only evidence of absence. Transport,
// permission and parse failures propagate; a failed inspect is never absence.
export function requireResourceAbsent(kind, name, invoke = command) {
  requireValue(['container', 'volume'].includes(kind), 'Unknown resource kind')
  const args = kind === 'container'
    ? ['container', 'ls', '--all', '--format', '{{json .Names}}']
    : ['volume', 'ls', '--format', '{{json .Name}}']
  const output = invoke('docker', args)
  requireValue(typeof output === 'string', 'Docker inventory must be text')
  const names = output.trim() === '' ? [] : output.trim().split('\n').flatMap(line => {
    const value = JSON.parse(line)
    requireValue(typeof value === 'string' && value.length > 0, 'Invalid Docker inventory name')
    return value.split(',').map(item => item.trim())
  })
  requireValue(!names.includes(name), 'Refusing existing resource name')
}

// Called only after cleanup attempts: incomplete phases or retained resources
// cannot be presented as a successful rehearsal, including partial cleanup.
export function finalizeRehearsalReport(report) {
  report.retainedResources = report.resources.filter(item => !item.removed)
  if (report.status === 'passed' && (report.retainedResources.length || Object.values(report.phases).some(row => row.status !== 'passed'))) report.status = 'failed'
  report.counts = Object.values(report.phases).reduce((counts, row) => { counts[row.status] = (counts[row.status] ?? 0) + 1; return counts }, {})
}

export const storageMetadataCommand = "set -eu; entries=$(find /app/storage -printf '%P\\t%y\\t%m\\t%U\\t%G\\t%l\\n'); printf '%s\\n' \"$entries\" | LC_ALL=C sort"
export const storageRestoreArgs = ['tar', '--numeric-owner', '--same-owner', '-xpf', '-', '-C', '/app/storage']
export function verifyRestoredStorage(expected, actual) {
  requireValue([expected, actual].every(state => state && typeof state.metadata === 'string' && state.metadata.length > 0 && hex.test(state.contentSha256)), 'Storage metadata/content evidence missing')
  requireValue(expected.metadata === actual.metadata, 'Restored storage mode/UID/GID/type/link mismatch')
  requireValue(expected.contentSha256 === actual.contentSha256, 'Restored storage content mismatch')
}

export async function privateWrite(directory, name, value) {
  await writeFile(join(directory, name), typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', {mode: 0o600, flag: 'wx'})
}
export async function verifyPublishedXml(directory, gates) {
  requireValue(Array.isArray(gates) && gates.length >= 3, 'Explicit published unit/postgres/lifecycle XML gates required')
  const results = []
  for (const gate of gates) {
    requireValue(['.evidence/unit/results', '.evidence/postgres/results', '.evidence/lifecycle/results'].includes(gate.path) && Number.isSafeInteger(gate.tests) && gate.tests > 0, 'Invalid published XML gate')
    const files = (await readdir(join(directory, gate.path))).filter(name => name.endsWith('.xml'))
    requireValue(files.length > 0, 'Published XML reports missing')
    let total = 0
    const hashes = {}
    let cases = 0
    for (const file of files) {
      const text = await readFile(join(directory, gate.path, file), 'utf8')
      const suites = [...text.matchAll(/<testsuite\s+([^>]+)>/g)]
      requireValue(suites.length > 0, 'JUnit testsuite missing')
      for (const [, attributes] of suites) {
        const field = name => { const match = attributes.match(new RegExp('(?:^|\\s)' + name + '=["\']([0-9]+)["\']')); requireValue(match, 'JUnit counter missing'); return Number(match[1]) }
        requireValue(field('failures') === 0 && field('errors') === 0 && field('skipped') === 0, 'Published tests failed/skipped')
        total += field('tests')
      }
      cases += [...text.matchAll(/<testcase(?:\s|>)/g)].length
      requireValue(!/<(?:failure|error|skipped)(?:\s|\/|>)/.test(text), 'Published failing/skipped testcase')
      hashes[file] = hash(text)
    }
    requireValue(cases === total, 'Published actual testcase count mismatch')
    requireValue(total === gate.tests, 'Published exact test count mismatch')
    results.push({path: gate.path, tests: total, hashes})
  }
  requireValue(new Set(gates.map(gate => gate.path)).size === 3, 'All three published XML suites required')
  return results
}
export async function checkPublication(config, directory, invoke = command) {
  const api = path => JSON.parse(invoke('gh', ['api', path]))
  const evidence = {}
  for (const side of ['old', 'new']) {
    const bundle = config[side], ci = bundle.overlay
    const run = api(`repos/${ci.repository}/actions/runs/${ci.runId}`)
    validateRun(ci, run, 'overlay')
    const jobs = JSON.parse(invoke('gh', ['run', 'view', String(ci.runId), '-R', ci.repository, '--json', 'jobs'])).jobs
    requireValue(jobs.length && jobs.every(job => job.conclusion === 'success'), 'All host jobs must succeed')
    const promote = jobs.find(job => job.name === 'promote'), build = jobs.find(job => job.name === 'build-push')
    requireValue(promote && build, 'Published host promotion/build required')
    requireValue(promote.steps.some(step => step.name === 'Promote verified immutable candidate to deployment tags' && step.conclusion === 'success'), 'Promotion step required')
    const promotion = invoke('gh', ['run', 'view', String(ci.runId), '-R', ci.repository, '--job', String(promote.databaseId), '--log'])
    requireValue(!promotion.includes('SKIP: candidate commit is no longer the current main HEAD'), 'Skipped promotion rejected')
    const log = invoke('gh', ['run', 'view', String(ci.runId), '-R', ci.repository, '--job', String(build.databaseId), '--log'])
    requireValue([...log.matchAll(/Candidate image: (ghcr\.io\/ai-specs\/kestra-overlay@sha256:[a-f0-9]{64})/g)].some(match => match[1] === bundle.image), 'Image must match formal CI build digest')
    evidence[side] = {image: bundle.image, overlay: ci, promotionLogSha256: hash(promotion), buildLogSha256: hash(log)}
    if (config.mode === 'B') {
      const plugin = bundle.plugin
      validateRun(plugin, api(`repos/${plugin.repository}/actions/runs/${plugin.runId}`), 'plugin')
      const pluginJobs = JSON.parse(invoke('gh', ['run', 'view', String(plugin.runId), '-R', plugin.repository, '--json', 'jobs'])).jobs
      requireValue(pluginJobs.length && pluginJobs.every(job => job.conclusion === 'success'), 'All plugin jobs must succeed')
      const artifacts = api(`repos/${plugin.repository}/actions/runs/${plugin.runId}/artifacts?per_page=100`).artifacts.filter(item => item.name === 'kestra-rbac-authorizer' && !item.expired)
      requireValue(artifacts.length === 1, 'One published plugin artifact required')
      const destination = join(directory, side + '-artifact')
      await mkdir(destination, {mode: 0o700})
      invoke('gh', ['run', 'download', String(plugin.runId), '-R', plugin.repository, '--name', 'kestra-rbac-authorizer', '--dir', destination])
      // Downloaded evidence can contain credentials; recursively narrow file permissions.
      async function restrict(path) { for (const item of await readdir(path, {withFileTypes: true})) { const child = join(path, item.name); requireValue(!item.isSymbolicLink(), 'Artifact symlink rejected'); await chmod(child, item.isDirectory() ? 0o700 : 0o600); if (item.isDirectory()) await restrict(child) } }
      await restrict(destination)
      const bytes = await readFile(join(destination, 'build/libs/kestra-rbac-authorizer.jar'))
      requireValue(hash(bytes) === bundle.jar.sha256 && hash(await readFile(bundle.jar.path)) === bundle.jar.sha256, 'Published and local jar SHA must match')
      const provenance = JSON.parse(await readFile(join(destination, '.integration/host-provenance.json'), 'utf8'))
      requireValue(provenance.image === bundle.image && hex.test(provenance.sha256), 'Plugin must compile against selected published host')
      const matrices = await verifyPublishedXml(destination, plugin.xmlGates)
      evidence[side].plugin = {...plugin, matrices, artifactId: artifacts[0].id, jarSha256: hash(bytes), provenanceSha256: hash(JSON.stringify(provenance))}
      await copyFile(join(destination, 'build/libs/kestra-rbac-authorizer.jar'), join(directory, side + '.jar'))
      await chmod(join(directory, side + '.jar'), 0o600)
    }
    invoke('docker', ['pull', bundle.image])
    const inspected = JSON.parse(invoke('docker', ['image', 'inspect', bundle.image]))[0]
    requireValue(inspected.RepoDigests.includes(bundle.image), 'Pulled image digest mismatch')
    evidence[side].imageId = inspected.Id
  }
  await privateWrite(directory, 'publication.json', evidence)
  return evidence
}

export const recoveryOrder = ['verifySnapshot', 'restoreDatabase', 'restoreStorage', 'restoreOldConfiguration', 'startRestoredOld', 'restoredDataAndBoundary']
export async function executeRecovery(operations) {
  for (const name of recoveryOrder) { requireValue(typeof operations[name] === 'function', 'Missing recovery operation'); await operations[name]() }
}

// Every operation below uses real Docker/PG/HTTP transports. No adapter option is
// accepted by the CLI. Unit tests may exercise pure predicates and sequencing.
export async function runRehearsal(options) {
  await mkdir(options.evidence, {mode: 0o700})
  await chmod(options.evidence, 0o700)
  const report = {schema: 2, scope: 'real HTTP upgrade and consistent recovery', status: 'running', browser: 'notRun', phases: Object.fromEntries(phases.map(name => [name, {status: 'notRun'}])), resources: [], startedAt: new Date().toISOString()}
  let config, pgId, appId, volume, database, role, project, password, account, limited, secret, composeEnv, service, oldConfig, manifest, policyBaseline, snapshotReady = false, stopped = true
  let businessBaseline, identityBaseline, setupBaseline, storageBaseline
  const identityState = () => sql("SELECT json_build_object('users',(SELECT coalesce(jsonb_agg(to_jsonb(u) - 'updated_at' - 'last_login_at' ORDER BY (to_jsonb(u) - 'updated_at' - 'last_login_at')::text),'[]') FROM oidc_user u),'setup',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY to_jsonb(s)::text),'[]') FROM oidc_setup s));").trim()
  const setupState = async () => { const response = await fetch(base() + '/oidc/setup', {redirect: 'manual', signal: AbortSignal.timeout(10000)}); const text = await response.text(); requireValue(!/name=["'](?:password|username)["']/.test(text), 'Setup reopened'); return {status: response.status, location: response.headers.get('location')} }
  const absent = (kind, name) => requireResourceAbsent(kind, name, (program, args) => docker(args))
  const ledger = report.resources
  const save = async () => { await writeFile(join(options.evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n', {mode: 0o600}); await chmod(join(options.evidence, 'report.json'), 0o600) }
  const stage = async (name, operation) => { report.phases[name] = {status: 'running'}; await save(); try { const evidence = await operation(); report.phases[name] = {status: 'passed', ...(evidence === undefined ? {} : {evidence})}; await save(); return evidence } catch (error) { report.phases[name] = {status: 'failed', reason: error?.safeReason ?? 'Operation failed; raw output suppressed to protect credentials'}; await save(); throw error } }
  const docker = (args, extra) => command('docker', args, extra)
  const inspect = id => JSON.parse(docker(['inspect', id]))[0]
  const created = (kind, id) => { ledger.push({kind, id, owner: config.ownerLabel, created: true}); return id }
  const owned = (kind, id, currentOwner) => requireValue(cleanupEligible(ledger.find(item => item.kind === kind && item.id === id), currentOwner, config.ownerLabel), 'Resource ownership mismatch')
  const appOwned = () => { const item = inspect(appId); owned('container', appId, item.Config.Labels[ownerKey]); return item }
  const pgCheck = () => { const item = inspect(pgId); requireValue(item.Id === pgId && item.State.Running && item.NetworkSettings.Networks[config.postgres.network], 'Existing PG identity/network changed') }
  const sql = (text, target = database ?? 'postgres', binary = false, program = 'psql', extra = []) => {
    pgCheck()
    const args = program === 'psql' ? ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', config.postgres.admin, '-d', target] : ['-U', config.postgres.admin, '-d', target, ...extra]
    return docker(['exec', '-i', pgId, 'sh', '-c', 'export PGPASSWORD="$POSTGRES_PASSWORD"; exec "$@"', 'upgrade-pg', program, ...args], {input: text, binary})
  }
  const dbOwned = () => {
    const db = sql(`SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=${literal(database)};`, 'postgres').trim()
    owned('database', database, db)
    requireValue(sql(`SELECT rolname FROM pg_roles WHERE oid=(SELECT datdba FROM pg_database WHERE datname=${literal(database)});`, 'postgres').trim() === role, 'DB owner changed')
  }
  const volumeOwned = () => { const value = JSON.parse(docker(['volume', 'inspect', volume]))[0]; owned('volume', volume, value.Labels?.[ownerKey]) }
  const business = ({refusal = false} = {}) => {
    dbOwned()
    // Full persisted business/queue rows, excluding only authentication and engine
    // liveness tables; discovery avoids silently missing a new queue table.
    const tables = JSON.parse(sql("SELECT coalesce(json_agg(tablename ORDER BY tablename),'[]') FROM pg_tables WHERE schemaname='public' AND (tablename IN ('flows','kv_metadata','executions','triggers','execution_outputs','logs','metrics') OR tablename LIKE '%queue%');"))
    requireValue(tables.includes('flows') && tables.includes('kv_metadata'), 'Business tables required')
    const values = {}, restoredValues = {}, regeneratedFulltext = []
    for (const table of tables) {
      const housekeeping = refusal && table === 'queues' ? ' WHERE '+queueRefusalPredicate : ''
      values[table] = sql(`SELECT coalesce(jsonb_agg(v ORDER BY v::text),'[]'::jsonb) FROM (SELECT to_jsonb(t) v FROM ${identifier(table)} t${housekeeping}) s;`).trim()
      // pg_dump excludes generated columns. Upstream fulltext_replace uses an
      // unordered DISTINCT, so generated tsvector positions vary on restoration.
      // Retain exact hashes for denial checks; recovery also checks every token
      // with strip() while all stored inputs and other fields remain exact.
      const generated = sql(`SELECT count(*) FROM pg_attribute WHERE attrelid=${literal('public.'+table)}::regclass AND attname='fulltext' AND attgenerated='s' AND atttypid='tsvector'::regtype;`).trim() === '1'
      if (generated) {
        regeneratedFulltext.push(table)
        restoredValues[table] = sql(`SELECT coalesce(jsonb_agg(v ORDER BY v::text),'[]'::jsonb) FROM (SELECT (to_jsonb(t)-'fulltext') || jsonb_build_object('fulltext',strip(t.fulltext)::text) v FROM ${identifier(table)} t) s;`).trim()
      } else restoredValues[table] = values[table]
    }
    return {sha256: hash(JSON.stringify(values)), restoreSha256: hash(JSON.stringify(restoredValues)), regeneratedFulltext, excludedHousekeeping: refusal ? ['scheduler_event/VNODES_ASSIGNMENT_REQUEST','scheduler_event/VNODES_ASSIGNMENT_REPLY','scheduler_event/VNODES_ASSIGNMENT_RELEASE','scheduler_event/VNODES_ASSIGNMENT_REJECTED'] : [], tables, tableSha256: Object.fromEntries(Object.entries(values).map(([key,value]) => [key,hash(value)]))}
  }
  const policy = () => config.mode === 'A' ? null : sql("SELECT coalesce(jsonb_agg(document_json::jsonb ORDER BY group_id),'[]') FROM rbac_application_group_state;").trim()
  const helper = async (script, input) => {
    volumeOwned()
    const name = project + '-helper-' + randomBytes(4).toString('hex')
    absent('container', name)
    const id = docker(['create', '--name', name, '--label', ownerKey + '=' + config.ownerLabel, '--network', 'none', '--user', '0', '--entrypoint', '/bin/sh', '-v', volume + ':/app/storage', config.old.image, '-ec', script]).trim()
    created('container', id); await save()
    try {
      docker(['start', id])
      if (input !== undefined) docker(['exec', '-i', id, '/bin/sh', '-ec', input.script], {input: input.bytes})
      return id
    } catch (error) { throw error }
  }
  const storageHash = async () => {
    const id = await helper('sleep 180')
    try { return hash(docker(['exec', id, '/bin/sh', '-ec', "set -eu; sums=$(find /app/storage -type f -exec sha256sum {} +); printf '%s\\n' \"$sums\" | LC_ALL=C sort"])) }
    finally { owned('container', id, inspect(id).Config.Labels[ownerKey]); docker(['rm', '-f', id]); ledger.find(item => item.id === id).removed = true }
  }
  const storageState = async () => {
    const id = await helper('sleep 180')
    try {
      const metadata = docker(['exec', id, '/bin/sh', '-ec', storageMetadataCommand])
      return {metadata, contentSha256: await storageHash()}
    } finally { owned('container', id, inspect(id).Config.Labels[ownerKey]); docker(['rm', '-f', id]); ledger.find(item => item.id === id).removed = true }
  }
  const request = async (client, path, method = 'GET', body, type = 'application/json', revision) => {
    const response = await client.request(path, {method, headers: {...(body === undefined ? {} : {'Content-Type': type}), ...(revision === undefined ? {} : {'If-Match': '"' + revision + '"'})}, ...(body === undefined ? {} : {body: type === 'application/json' ? JSON.stringify(body) : body})})
    const text = await response.text(); let value; try { value = JSON.parse(text) } catch { value = text }
    return {status: response.status, value}
  }
  const ok = result => { requireValue(result.status >= 200 && result.status < 300, 'Production HTTP failed'); return result.value }
  const base = () => 'http://localhost:' + config.appPort
  const login = async (user = account) => {
    const client = new ProductionOAuthClient(base())
    const send = client.request.bind(client); let jwt
    client.request = async (...args) => { const response = await send(...args); for (const cookie of response.headers.getSetCookie()) if (cookie.startsWith('JWT=')) jwt = cookie.slice(4).split(';')[0]; return response }
    await client.login(user.username, user.password)
    requireValue(jwt, 'Production ID token required')
    const parts = jwt.split('.'); requireValue(parts.length === 3, 'JWT structure required')
    const header = JSON.parse(Buffer.from(parts[0], 'base64url')), claims = JSON.parse(Buffer.from(parts[1], 'base64url'))
    const keys = ok(await request(client, '/oidc/jwks')).keys.filter(key => key.kid === header.kid && key.kty === 'RSA')
    requireValue(header.alg === 'RS256' && keys.length === 1 && verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), createPublicKey({key: keys[0], format: 'jwk'}), Buffer.from(parts[2], 'base64url')), 'Production JWT signature invalid')
    requireValue(claims.iss === base() && claims.sub === user.username && claims.exp > Date.now()/1000 && (Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes('kestra-ui'), 'Production JWT claims invalid')
    jwt = undefined
    if (config.mode === 'B') await client.verifiedUiIdentity({applicationGroupId: 'main', subject: user.username, audience: 'kestra-ui'})
    return client
  }
  const start = async side => {
    requireValue(stopped, 'Previous app must be stopped')
    dbOwned(); volumeOwned()
    const selected = structuredClone(service)
    selected.image = config[side].image
    selected.environment.KESTRA_OIDC_BOOTSTRAP_USERNAME = side === 'old' && !snapshotReady ? account.username : ''
    selected.environment.KESTRA_OIDC_BOOTSTRAP_PASSWORD = side === 'old' && !snapshotReady ? account.password : ''
    selected.volumes = [{type: 'volume', source: 'storage', target: '/app/storage'}]
    if (config.mode === 'B') selected.volumes.push({type: 'bind', source: join(options.evidence, side + '.jar'), target: '/app/libs/kestra-rbac-authorizer.jar', read_only: true})
    selected.environment.KESTRA_CONFIGURATION = selected.environment.KESTRA_CONFIGURATION.replaceAll('$', '$$')
    const document = {services: {kestra: selected}, volumes: {storage: {external: true, name: volume}}, networks: {default: {external: true, name: config.postgres.network}}}
    const filename = join(options.evidence, 'compose-' + side + '-' + randomBytes(4).toString('hex') + '.json')
    await writeFile(filename, JSON.stringify(document), {mode: 0o600, flag: 'wx'})
    const args = ['compose', '--env-file', '/dev/null', '-p', project, '-f', filename]
    absent('container', selected.container_name)
    try { docker([...args, 'create', '--no-build', 'kestra'], {env: composeEnv}) }
    catch (error) {
      // Compose may fail after Docker successfully created our exclusive container.
      // Recover its immutable ID only when the exact owner label matches.
      try { const partial = inspect(selected.container_name); if (partial.Config.Labels?.[ownerKey] === config.ownerLabel) { appId = partial.Id; created('container', appId); await save() } } catch {}
      throw error
    }
    appId = docker([...args, 'ps', '-aq', 'kestra'], {env: composeEnv}).trim(); requireValue(/^[a-f0-9]{12,64}$/.test(appId), 'Owned app container ID required')
    created('container', appId); await save()
    const item = appOwned(); requireValue(item.Config.Image === config[side].image, 'App image mismatch')
    requireValue(item.Mounts.some(m => m.Name === volume && m.Destination === '/app/storage'), 'App storage mismatch')
    docker(['start', appId]); stopped = false
    const deadline = Date.now() + 180000
    while (Date.now() < deadline) {
      try { const response = await fetch(base() + '/ping', {signal: AbortSignal.timeout(2000)}); await response.body?.cancel(); if (response.ok) return } catch {}
      await delay(1000)
    }
    throw new Error('App readiness deadline exceeded')
  }
  const stop = async () => {
    if (!appId) return
    const item = appOwned()
    if (item.State.Running) docker(['stop', '--time', '30', appId])
    requireValue(!appOwned().State.Running, 'App must be stopped before snapshot/restore')
    stopped = true
    const logs = docker(['logs', appId])
    await privateWrite(options.evidence, 'app-' + appId + '.log', redactOwnedServiceLog(logs))
    const downloadsDetected = /Downloading plugin|Auto.install.*download/i.test(logs)
    docker(['rm', appId]); ledger.find(item => item.id === appId).removed = true; appId = undefined; await save(); requireValue(!downloadsDetected, 'Unexpected automatic plugin download')
  }
  const flowId = phase => 'upgrade-' + phase
  const flow = (namespace, phase) => `id: ${flowId(phase)}\nnamespace: ${namespace}\ndescription: upgrade-${phase}\ntasks:\n  - id: hello\n    type: io.kestra.plugin.core.log.Log\n    message: upgrade-${phase}\n`
  const kv = (namespace, phase) => `/api/v1/main/namespaces/${namespace}/kv/upgrade-${phase}`
  const writeResources = async (client, phase) => {
    ok(await request(client, '/api/v1/main/flows', 'POST', flow('company.sub', phase), 'application/x-yaml'))
    ok(await request(client, kv('company.sub', phase), 'PUT', JSON.stringify('upgrade-' + phase), 'text/plain'))
  }
  const readResources = async (client, phase, exists = true) => {
    const f = await request(client, `/api/v1/main/flows/company.sub/${flowId(phase)}`), k = await request(client, kv('company.sub', phase))
    if (exists) { requireValue(ok(f).description === 'upgrade-' + phase, 'Flow content mismatch'); requireValue(ok(k).value === 'upgrade-' + phase, 'KV content mismatch') }
    else requireValue(f.status === 404 && k.status === 404, 'Restored old state must not contain new resources')
  }
  const observeRefusals = async operation => {
    // Finish observing the preceding allowed writes before taking the refusal baseline.
    let before = business({refusal:true}), stableSince = Date.now()
    const stableDeadline = Date.now() + 60000
    while (Date.now() - stableSince < 5000) {
      requireValue(Date.now() < stableDeadline, 'Allowed effects did not settle before refusal')
      await delay(250)
      const current = business({refusal:true})
      if (current.sha256 !== before.sha256) stableSince = Date.now()
      before = current
    }
    const storage = await storageHash()
    const value = await operation()
    const deadline = Date.now() + 5000
    do { const after = business({refusal:true}); if (after.sha256 !== before.sha256) await privateWrite(options.evidence, 'denied-business-change-'+randomBytes(4).toString('hex')+'.json', {before,after}); requireValue(after.sha256 === before.sha256, 'Denied write changed persisted business/queue state'); requireValue(await storageHash() === storage, 'Denied write changed storage'); await delay(250) } while (Date.now() < deadline)
    return {value,observation:{databaseSha256:before.sha256,storageSha256:storage,windowMs:5000,tables:before.tables,excludedHousekeeping:before.excludedHousekeeping}}
  }
  const boundary = async () => {
    if (config.mode === 'A') return {status:'notApplicable',reason:'Mode A has no fine-grained authorization'}
    const client=await login(limited)
    const {value:denied,observation}=await observeRefusals(async()=>{
      const denied=[await request(client,'/api/v1/main/flows','POST',flow('outside.denied','denied'),'application/x-yaml'),await request(client,kv('outside.denied','denied'),'PUT','"forbidden"','text/plain')]
      requireValue(denied.every(result=>result.status===403),'Explicit outside Flow/KV refusal required');return denied
    })
    return {statuses:denied.map(result=>result.status),...observation}
  }
  const executionActions = async key => runUpstreamExecutionActions(await login(),{mode:config.mode,record:async value=>{report[key]=value;await save()},observeDenied:async operation=>(await observeRefusals(operation)).observation})
  const recovery = async () => {
    requireValue(snapshotReady && stopped, 'Consistent stopped snapshot required')
    await executeRecovery({
      verifySnapshot: () => stage('verifySnapshot', async () => { requireValue(hash(await readFile(join(options.evidence, 'snapshot-manifest.json'))) === hash(JSON.stringify(manifest, null, 2) + '\n'), 'Snapshot manifest changed'); for (const [name, sha] of Object.entries(manifest)) requireValue(hash(await readFile(join(options.evidence, name))) === sha, 'Snapshot hash mismatch'); return {manifestSha256: hash(JSON.stringify(manifest))} }),
      restoreDatabase: () => stage('restoreDatabase', async () => {
      dbOwned()
      const backup = await readFile(join(options.evidence, 'database.dump'))
      const listing = docker(['exec', '-i', pgId, 'pg_restore', '--list'], {input: backup})
      sql('DROP SCHEMA public CASCADE;' + (/\bSCHEMA - public\b/.test(listing) ? '' : ' CREATE SCHEMA public AUTHORIZATION ' + identifier(role) + ';'))
      sql(backup, database, false, 'pg_restore', ['--exit-on-error', '--no-owner', '--role', role])
      const actual = business(); await privateWrite(options.evidence, 'restored-business-comparison.json', {expected: businessBaseline, actual}); requireValue(actual.restoreSha256 === businessBaseline.restoreSha256 && JSON.stringify(actual.regeneratedFulltext) === JSON.stringify(businessBaseline.regeneratedFulltext), 'Restored database business/queue snapshot mismatch'); return {business: actual}
    }),
      restoreStorage: () => stage('restoreStorage', async () => {
      const id = await helper('sleep 180')
      try { docker(['exec', id, '/bin/sh', '-ec', 'find /app/storage -mindepth 1 -maxdepth 1 -exec rm -rf {} +']); docker(['exec', '-i', id, ...storageRestoreArgs], {input: await readFile(join(options.evidence, 'storage.tar'))}) }
      finally { owned('container', id, inspect(id).Config.Labels[ownerKey]); docker(['rm', '-f', id]); ledger.find(item => item.id === id).removed = true }
      const actual = await storageState(); verifyRestoredStorage(storageBaseline, actual)
      return {metadataSha256: hash(actual.metadata), contentSha256: actual.contentSha256}
    }),
      restoreOldConfiguration: () => stage('restoreOldConfiguration', async () => { service = JSON.parse(await readFile(join(options.evidence, 'old-service.json'), 'utf8')); requireValue(hash(JSON.stringify(service)) === oldConfig, 'Old configuration mismatch') }),
      startRestoredOld: () => stage('startRestoredOld', async () => { await start('old'); await login() }),
      restoredDataAndBoundary: () => stage('restoredDataAndBoundary', async () => { const client = await login(); requireValue(identityState() === identityBaseline, 'Restored users/setup changed'); requireValue(JSON.stringify(await setupState()) === JSON.stringify(setupBaseline), 'Restored setup behavior changed'); await readResources(client, 'old'); await readResources(client, 'new', false); requireValue(policy() === policyBaseline, 'Restored authorization changed'); await readResources(config.mode === 'B' ? await login(limited) : client, 'old'); return boundary() })
    })
  }
  try {
    await save()
    await stage('inputValidation', async () => { config = validateConfig(JSON.parse(await readFile(options.config, 'utf8'))); report.ownerLabel = config.ownerLabel; return {mode: config.mode, oldImage: config.old.image, newImage: config.new.image} })
    await stage('ciValidation', async () => { for (const side of ['old', 'new']) for (const kind of config.mode === 'B' ? ['overlay', 'plugin'] : ['overlay']) { const ci = config[side][kind]; validateRun(ci, JSON.parse(command('gh', ['api', `repos/${ci.repository}/actions/runs/${ci.runId}`])), kind) } })
    await stage('publicationBinding', () => checkPublication(config, options.evidence))
    await stage('ownedProvision', async () => {
      project = 'upgrade-' + randomBytes(10).toString('hex'); const suffix = randomBytes(10).toString('hex')
      database = 'upgrade_' + suffix; role = 'upgrade_' + suffix; volume = project + '-storage'; password = randomBytes(32).toString('hex'); secret = randomBytes(32).toString('hex')
      account = {username: 'upgradeadmin' + suffix, password: randomBytes(24).toString('hex') + 'Aa1!'}
      limited = {username: 'upgradelimited' + suffix, password: randomBytes(24).toString('hex') + 'Aa1!'}
      const pg = inspect(config.postgres.container); pgId = pg.Id; pgCheck()
      requireValue(pg.Name === '/' + config.postgres.container && pg.NetworkSettings.Networks[config.postgres.network].Aliases?.includes(config.postgres.container), 'Explicit PG container name/DNS alias required for JDBC')
      sql(`CREATE ROLE ${identifier(role)} LOGIN PASSWORD ${literal(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;`, 'postgres'); created('role', role); await save()
      sql(`COMMENT ON ROLE ${identifier(role)} IS ${literal(config.ownerLabel)};`, 'postgres')
      sql(`CREATE DATABASE ${identifier(database)} OWNER ${identifier(role)};`, 'postgres'); created('database', database); await save()
      sql(`COMMENT ON DATABASE ${identifier(database)} IS ${literal(config.ownerLabel)}; REVOKE ALL ON DATABASE ${identifier(database)} FROM PUBLIC; GRANT CONNECT ON DATABASE ${identifier(database)} TO ${identifier(role)};`, 'postgres')
      absent('volume', volume)
      docker(['volume', 'create', '--label', ownerKey + '=' + config.ownerLabel, volume]); created('volume', volume); await save()
      composeEnv = Object.fromEntries(['PATH', 'HOME', 'DOCKER_CONFIG'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]))
      Object.assign(composeEnv, {KESTRA_IMAGE: config.old.image, POSTGRES_PASSWORD: password, KESTRA_OIDC_UI_CLIENT_SECRET: secret, KESTRA_OIDC_BOOTSTRAP_USERNAME: account.username, KESTRA_OIDC_BOOTSTRAP_PASSWORD: account.password, KESTRA_OIDC_SETUP_ALLOWED: 'false', KESTRA_RBAC_ENABLED: String(config.mode === 'B'), KESTRA_OIDC_REGISTRATION_ENABLED: 'false'})
      const rendered = JSON.parse(docker(['compose', '--env-file', '/dev/null', '-f', join(root, 'docker-compose.yml'), 'config', '--format', 'json'], {env: composeEnv}))
      service = rendered.services.kestra; requireValue(!service.build && !service.privileged && !service.network_mode && !service.devices, 'Unsupported Compose app configuration')
      delete service.depends_on; delete service.restart; service.labels = {[ownerKey]: config.ownerLabel}; service.container_name = project + '-app'; service.user = '0:0'; service.ports = [{target: 8080, published: String(config.appPort), host_ip: '127.0.0.1'}]
      service.environment.KESTRA_CONFIGURATION = service.environment.KESTRA_CONFIGURATION.replaceAll('jdbc:postgresql://postgres:5432/kestra', `jdbc:postgresql://${config.postgres.container}:5432/${database}`).replace('username: kestra', 'username: ' + role).replaceAll('http://localhost:8080', base()).replaceAll('url: ' + base() + '/oidc/token', 'url: http://localhost:8080/oidc/token').replaceAll('jwks-uri: ' + base() + '/oidc/jwks', 'jwks-uri: http://localhost:8080/oidc/jwks')
      requireValue(service.environment.KESTRA_CONFIGURATION.includes('auto-install:\n      enabled: false'), 'Automatic plugin downloads must be disabled')
      await privateWrite(options.evidence, 'credentials.json', {database, role, password, account, limited, secret})
      const queueRows = [
        ...['VNODES_ASSIGNMENT_REQUEST','VNODES_ASSIGNMENT_REPLY','VNODES_ASSIGNMENT_RELEASE','VNODES_ASSIGNMENT_REJECTED'].map((type,index) => [index,'scheduler_event',{type}]),
        [4,'scheduler_event',{type:'UNKNOWN'}],[5,'scheduler_event',{}],[6,'scheduler_event',null],
        [7,'scheduler_event',{type:'VNODES_ASSIGNMENT_REPLY',namespace:'outside.denied'}],
        [8,'flow_interface',{type:'VNODES_ASSIGNMENT_REPLY'}],
      ]
      const values = queueRows.map(([id,type,value]) => `(${id},${literal(type)},${literal(JSON.stringify(value))}::jsonb)`).join(',')
      const included = JSON.parse(sql(`WITH queues(id,type,value) AS (VALUES ${values}) SELECT json_agg(id ORDER BY id) FROM queues WHERE ${queueRefusalPredicate};`))
      requireValue(JSON.stringify(included) === JSON.stringify([4,5,6,7,8]), 'Queue housekeeping scope must retain unknown and business events')
      return {pgContainer: pgId, database, role, volume, project, queueScopeProof:{cases:9,retained:included,excluded:[0,1,2,3]}}
    })
    await stage('oldBootstrapLogin', async () => { await start('old'); await login(); setupBaseline = await setupState() })
    await stage('oldFlowKv', async () => {
      let client = await login()
      if (config.mode === 'B') {
        const api = '/api/v1/main/extensions/rbac', group = api + '/application-groups/main', scope = 'upgrade-company', app = group + '/applications/~' + Buffer.from('kestra-ui').toString('base64url')
        const management = async (path, method = 'GET', body, revision) => ok(await request(client, path, method, body, 'application/json', revision))
        const fresh = async () => { client = await login() }
        await management(group + '/scopes', 'POST', {key: scope, name: scope, description: 'Upgrade restricted namespace'}, (await management(group)).revision); await fresh()
        const grants = ['FLOW', 'KVSTORE', 'NAMESPACE'].map(resource => ({scope: 'NAMESPACE', tenant: 'main', namespace: 'company.*', resource, actions: ['READ', 'LIST', 'CREATE', 'UPDATE'], ids: [], allIds: true}))
        await management(app + '/permissions', 'POST', {key: 'upgrade-company', name: scope, scopeKeys: [scope], description: 'Upgrade limited permission', enabled: true, grants, managementGrants: []}, (await management(app)).revision); await fresh()
        const createdUser = await management(api + '/users', 'POST', {username: limited.username, name: 'Upgrade test account', email: limited.username + '@acceptance.invalid'})
        requireValue(createdUser.subject === limited.username && createdUser.temporaryPassword, 'Real temporary user credentials required')
        await new ProductionOAuthClient(base()).changeTemporaryPassword(limited.username, createdUser.temporaryPassword, limited.password); await fresh()
        await management(group + '/scope-grants', 'POST', {issuer: base(), subject: limited.username, scopeKeys: [scope]}, (await management(group)).revision)
        client = await login(limited)
      }
      await writeResources(client, 'old'); await readResources(client, 'old'); await executionActions('oldExecutionActions'); policyBaseline = policy(); identityBaseline = identityState()
    })
    await stage('oldBoundarySideEffects', boundary)
    await stage('stopOld', stop)
    await stage('consistentSnapshot', async () => {
      requireValue(stopped, 'App must stop before consistent backup'); dbOwned(); businessBaseline = business()
      await privateWrite(options.evidence, 'database.dump', sql(undefined, database, true, 'pg_dump', ['--format=custom']))
      storageBaseline = await storageState()
      await privateWrite(options.evidence, 'storage-state.json', storageBaseline)
      const id = await helper('sleep 180')
      try { await privateWrite(options.evidence, 'storage.tar', docker(['exec', id, 'tar', '--numeric-owner', '-cpf', '-', '-C', '/app/storage', '.'], {binary: true})) }
      finally { owned('container', id, inspect(id).Config.Labels[ownerKey]); docker(['rm', '-f', id]); ledger.find(item => item.id === id).removed = true }
      verifyRestoredStorage(storageBaseline, await storageState())
      // Save configuration with bootstrap disabled so restoration cannot create/regrant identities.
      service.environment.KESTRA_OIDC_BOOTSTRAP_USERNAME = ''; service.environment.KESTRA_OIDC_BOOTSTRAP_PASSWORD = ''
      oldConfig = hash(JSON.stringify(service)); await privateWrite(options.evidence, 'old-service.json', service)
      await privateWrite(options.evidence, 'versions.json', {old: config.old.image, new: config.new.image, oldJarSha256: config.old.jar?.sha256 ?? null, newJarSha256: config.new.jar?.sha256 ?? null})
      manifest = {}; for (const name of ['database.dump', 'storage.tar', 'storage-state.json', 'old-service.json', 'versions.json', ...(config.mode === 'B' ? ['old.jar', 'new.jar'] : [])]) manifest[name] = hash(await readFile(join(options.evidence, name)))
      await privateWrite(options.evidence, 'snapshot-manifest.json', manifest); snapshotReady = true; return {manifest, business: businessBaseline}
    })
    try {
      await stage('newStartLogin', async () => { await start('new'); await login(); requireValue(identityState() === identityBaseline, 'Upgrade changed users/setup'); requireValue(JSON.stringify(await setupState()) === JSON.stringify(setupBaseline), 'Upgrade changed setup behavior'); requireValue(policy() === policyBaseline, 'Upgrade changed grants or permissions') })
      await stage('newReadWriteBoundary', async () => { const client = config.mode === 'B' ? await login(limited) : await login(); await readResources(client, 'old'); await writeResources(client, 'new'); await readResources(client, 'new'); const result=await boundary(); result.executionActions=await executionActions('executionActions'); return result })
    } finally {
      await stage('stopNew', stop)
      await recovery()
    }
    report.status = 'passed'
  } catch { report.status = 'failed' }
  finally {
    // Failure resources are retained for investigation; only owned app is stopped.
    if (appId) { try { await stop() } catch { report.stopFailure = true; report.status = 'failed' } }
    if (report.status === 'passed') {
      try { await stage('ownedCleanup', async () => {
        dbOwned(); volumeOwned()
        requireValue(sql(`SELECT shobj_description(oid,'pg_authid') FROM pg_roles WHERE rolname=${literal(role)};`, 'postgres').trim() === config.ownerLabel, 'Role owner mismatch')
        owned('role', role, config.ownerLabel)
        sql(`DROP DATABASE ${identifier(database)};`, 'postgres'); ledger.find(item => item.kind === 'database').removed = true
        sql(`DROP ROLE ${identifier(role)};`, 'postgres'); ledger.find(item => item.kind === 'role').removed = true
        docker(['volume', 'rm', volume]); ledger.find(item => item.kind === 'volume').removed = true
      }) } catch { report.status = 'failed' }
    }
    finalizeRehearsalReport(report)
    report.finishedAt = new Date().toISOString(); await save()
  }
  return report
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.umask(0o077)
  try { const options = parseArgs(process.argv.slice(2)), report = await runRehearsal(options); console.log(JSON.stringify({status: report.status, report: join(options.evidence, 'report.json')})); process.exitCode = report.status === 'passed' ? 0 : 1 }
  catch { console.error('Cannot start: invalid arguments or evidence directory is not new'); process.exitCode = 1 }
}
