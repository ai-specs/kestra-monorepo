import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {setTimeout as wait} from 'node:timers/promises'

// Confirmed in the published host jar's baseline-postgres.sql and
// 2.0.02-queue-postgres.sql. Missing tables/columns are unsupported, never empty.
const tables = ['flows', 'executions', 'execution_queued', 'namespace_file_metadata', 'kv_metadata', 'execution_outputs']
const required = [...tables, 'queues']
const hash = value => createHash('sha256').update(value).digest('hex')
const sha256 = /^[a-f0-9]{64}$/
const defaults = (command, args, options) => ({stdout: execFileSync(command, args, {encoding: 'utf8', timeout: 20000, maxBuffer: 32 * 1024 * 1024, ...options})})

// Same conservative rule as upstream-upgrade-rehearsal: unknown queue types,
// malformed/null values and every business identity remain observable. No
// namespace restriction: company.amis parents/children/siblings/company2 and
// unexpected out-of-scope writes all remain included. This is NOT all queues.
export const amisQueuePredicate = "NOT ((type='scheduler_event' AND value->>'type' IN ('VNODES_ASSIGNMENT_REQUEST','VNODES_ASSIGNMENT_REPLY','VNODES_ASSIGNMENT_RELEASE','VNODES_ASSIGNMENT_REJECTED') AND NOT (value ?| ARRAY['namespace','flowId','executionId','tenantId'])) IS TRUE)"

const storageScript = 'set -eu; find /app/storage -mindepth 1 ! -path /app/storage/.oidc-installation -print; find /app/storage -type f ! -path /app/storage/.oidc-installation -exec sha256sum {} +'

/** Read-only current single-tenant isolated acceptance observer. Synchronous
 * runner is an explicit testing transport. Caller supplies an actual passed
 * ownership journal; this module also verifies live owners on every snapshot.
 * Snapshots return counts/digests; execution observers expose validated binding
 * metadata only, never full execution rows. No SQL/table name is supplied
 * by callers. Queue filtering must receive a positive control in real acceptance.
 */
export class AmisSideEffects {
  #owner; #pg; #app; #database; #runner; #journal; #markers
  constructor({owner, project = owner, postgresContainer, kestraContainer, database,
    journalPassed, journal, markers = [], runner = defaults}) {
    assert.match(owner, /^application-projects-bb-[0-9]+-[0-9]+$/)
    assert.equal(project, owner)
    for (const id of [postgresContainer, kestraContainer]) assert.match(id, /^[a-f0-9]{64}$/)
    assert.notEqual(postgresContainer, kestraContainer)
    assert.match(database, /^application_group_acceptance_[0-9]+_[0-9]+$/)
    assert.equal(journalPassed, true, 'Caller ownership journal must have passed')
    assert.equal(journal?.owner, owner)
    for (const [kind, id] of [['container', postgresContainer], ['container', kestraContainer], ['database', database]]) {
      assert(journal.created?.some(item => item.kind === kind && item.id === id && item.owner === owner && item.removed === false), 'Active resource absent from passed journal')
    }
    assert(Array.isArray(markers) && markers.every(marker => typeof marker === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(marker)))
    this.#owner = owner; this.#pg = postgresContainer; this.#app = kestraContainer
    this.#database = database; this.#runner = runner; this.#journal = structuredClone(journal); this.#markers = [...markers]
  }
  #run(args) {
    try {
      const result = this.#runner('docker', args, {timeout: 20000})
      assert(result && typeof result.stdout === 'string')
      return result.stdout.trim()
    } catch {
      // Child-process diagnostics can contain row values or credentials.
      throw new Error(`Read-only observation failed during ${args[0]}; raw transport diagnostics withheld`)
    }
  }
  #owners() {
    for (const [id, service] of [[this.#pg, 'postgres'], [this.#app, 'kestra']]) {
      const inspected = JSON.parse(this.#run(['inspect', id]))
      assert(Array.isArray(inspected) && inspected.length === 1)
      const actual = inspected[0]
      assert.equal(actual.Id, id)
      assert.equal(actual.Config?.Labels?.owner, this.#owner, 'Foreign owner')
      assert.equal(actual.Config?.Labels?.['com.docker.compose.project'], this.#owner, 'Foreign project')
      assert.equal(actual.Config?.Labels?.['com.docker.compose.service'], service)
      assert.equal(actual.State?.Running, true)
      if (service === 'postgres') assert.equal(actual.Config.Image, 'postgres:18')
      else {
        const storage = actual.Mounts?.filter(mount => mount.Destination === '/app/storage')
        assert.equal(storage?.length, 1)
        assert.equal(storage[0].Type, 'volume')
        assert(this.#journal.created.some(item => item.kind === 'volume' && item.id === storage[0].Name && item.owner === this.#owner && item.removed === false), 'Storage absent from passed journal')
      }
    }
  }
  #query(expression) {
    const sql = `SELECT json_build_object('database',current_database(),'result',(${expression}))::text;`
    const result = JSON.parse(this.#run(['exec', '-e', 'PGOPTIONS=-c default_transaction_read_only=on', this.#pg,
      'psql', '-X', '-U', 'kestra', '-d', this.#database, '-v', 'ON_ERROR_STOP=1', '-Atc', sql]))
    assert.equal(result.database, this.#database, 'Actual database differs')
    return result.result
  }
  #schema() {
    const inventory = this.#query(`SELECT coalesce(json_agg(json_build_object('table',table_name,'column',column_name,'type',udt_name) ORDER BY table_name,column_name),'[]') FROM information_schema.columns WHERE table_schema='public' AND table_name IN (${required.map(name => `'${name}'`).join(',')})`)
    assert(Array.isArray(inventory))
    for (const table of required) {
      const columns = inventory.filter(row => row.table === table)
      assert(columns.length > 0, `Unsupported missing public table: ${table}`)
      assert(columns.some(row => row.column === 'value' && row.type === (table === 'execution_outputs' ? 'bytea' : 'jsonb')), `Unsupported ${table}.value schema`)
    }
    assert(inventory.some(row => row.table === 'queues' && row.column === 'type' && ['varchar', 'text'].includes(row.type)), 'Unsupported queue type schema')
    for (const [column, types] of [['offset', ['int8', 'int4']], ['created', ['timestamp', 'timestamptz']]]) {
      assert(inventory.some(row => row.table === 'queues' && row.column === column && types.includes(row.type)), `Unsupported queue ${column} schema`)
    }
  }
  #aggregate(table, predicate = '') {
    assert(required.includes(table))
    return `(SELECT json_build_object('count',count(*),'digest',encode(sha256(convert_to(coalesce(string_agg(length(row_text)::text || ':' || row_text,'' ORDER BY row_text COLLATE "C"),''),'UTF8')),'hex')) FROM (SELECT row_to_json(t)::text AS row_text FROM public.${table} t${predicate ? ' WHERE ' + predicate : ''}) observed_rows)`
  }
  #queueDiagnostics(predicate) {
    // Only metadata is returned or hashed here. The independent strict queue
    // digest above still hashes complete rows, including unknown message types.
    return `(SELECT coalesce(json_agg(diagnostic ORDER BY diagnostic->>'type' COLLATE "C" NULLS FIRST),'[]'::json) FROM (SELECT json_build_object('type',type,'count',count(*),'minOffset',min("offset")::text,'maxOffset',max("offset")::text,'minCreated',min(created)::text,'maxCreated',max(created)::text,'digest',encode(sha256(convert_to(coalesce(string_agg(length(metadata)::text || ':' || metadata,'' ORDER BY metadata COLLATE "C"),''),'UTF8')),'hex')) AS diagnostic FROM (SELECT type,"offset",created,json_build_array(type,"offset"::text,created::text)::text AS metadata FROM public.queues t WHERE ${predicate}) metadata_rows GROUP BY type) grouped_metadata)`
  }
  #executions() {
    this.#owners(); this.#schema()
    const rows = this.#query(`SELECT coalesce(json_agg(json_build_object('id',value->'id','namespace',value->'namespace','flowId',value->'flowId','state',value->'state'->'current','marker',value->'inputs'->'name','valid',jsonb_typeof(value)='object' AND jsonb_typeof(value->'state')='object' AND (value->'inputs' IS NULL OR value->'inputs'='null'::jsonb OR jsonb_typeof(value->'inputs')='object'))),'[]'::json) FROM public.executions`)
    assert(Array.isArray(rows), 'Invalid execution observation')
    const states = new Set(['CREATED','RUNNING','PAUSED','QUEUED','RESTARTED','KILLING','RETRYING','SUCCESS','WARNING','RETRIED','SKIPPED','RESUBMITTED','FAILED','KILLED','CANCELLED'])
    const ids = new Set()
    for (const row of rows) {
      assert(row && row.valid === true && typeof row.id === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_-]{0,99}$/.test(row.id)
        && typeof row.namespace === 'string' && row.namespace.length <= 150 && /^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*$/.test(row.namespace)
        && typeof row.flowId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(row.flowId)
        && states.has(row.state) && (row.marker === null || typeof row.marker === 'string'), 'Invalid execution binding record')
      assert(!ids.has(row.id), 'Duplicate execution ID observed'); ids.add(row.id)
    }
    return rows.sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  }
  executionInventory() {
    return this.#executions().map(row => row.id)
  }
  executionDetails(marker) {
    assert(typeof marker === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(marker), 'Invalid execution marker')
    return this.#executions().filter(row => row.marker === marker).map(({id,namespace,flowId,state}) => ({id,namespace,flowId,state}))
  }
  executionCount(marker) {
    return this.executionDetails(marker).length
  }
  snapshot() {
    this.#owners(); this.#schema()
    const markerSql = this.#markers.map(marker => `strpos(row_to_json(t)::text,'${marker}')>0`)
    const predicate = markerSql.length ? `(${amisQueuePredicate}) OR (${markerSql.join(' OR ')})` : amisQueuePredicate
    const values = this.#query(`SELECT json_build_object(${tables.map(table => `'${table}',${this.#aggregate(table)}`).join(',')},'queues',${this.#aggregate('queues', predicate)},'queueDiagnostics',${this.#queueDiagnostics(predicate)})`)
    for (const table of required) {
      assert(Number.isSafeInteger(values?.[table]?.count) && values[table].count >= 0, 'Invalid table count')
      assert.match(values[table].digest, sha256)
    }
    const queueDiagnostics = values.queueDiagnostics
    assert(Array.isArray(queueDiagnostics), 'Invalid queue diagnostics')
    const types = new Set()
    for (const row of queueDiagnostics) {
      assert(row && (row.type === null || typeof row.type === 'string') && !types.has(row.type), 'Invalid queue diagnostic type')
      types.add(row.type)
      assert(Number.isSafeInteger(row.count) && row.count > 0, 'Invalid queue diagnostic count')
      for (const field of ['minOffset', 'maxOffset']) assert(row[field] === null || (typeof row[field] === 'string' && /^-?[0-9]+$/.test(row[field])), 'Invalid queue diagnostic offset')
      for (const field of ['minCreated', 'maxCreated']) assert(row[field] === null || (typeof row[field] === 'string' && row[field].length <= 64 && Number.isFinite(Date.parse(row[field]))), 'Invalid queue diagnostic timestamp')
      assert.match(row.digest, sha256)
    }
    assert.equal(queueDiagnostics.reduce((sum, row) => sum + row.count, 0), values.queues.count, 'Queue diagnostic count differs')
    const databaseValues = Object.fromEntries(tables.map(table => [table, values[table]]))
    const storageOutput = this.#run(['exec', this.#app, 'sh', '-c', storageScript])
    const sources = {database: hash(JSON.stringify(databaseValues)), queue: hash(JSON.stringify(values.queues)), storage: hash(storageOutput.split('\n').sort().join('\n'))}
    return {hash: hash(JSON.stringify(sources)), sources, queueDiagnostics, counts: Object.fromEntries(required.map(table => [table, values[table].count])),
      coverage: {database: 'whole-public-business-tables', queue: 'all-except-exact-identity-free-vnode-coordination', storage: 'all-paths-and-file-hashes-except-root-installation-receipt'}}
  }
  async waitForIdle({timeoutMs = 90000, intervalMs = 250} = {}) {
    assert(timeoutMs >= 5000 && timeoutMs <= 120000 && intervalMs > 0 && intervalMs <= 1000)
    const started = performance.now()
    for (;;) {
      this.#owners(); this.#schema()
      const active = this.#query("SELECT (SELECT count(*) FROM public.executions WHERE value->'state'->>'current' IS NULL OR value->'state'->>'current' NOT IN ('SUCCESS','WARNING','FAILED','KILLED','CANCELLED','SKIPPED')) + (SELECT count(*) FROM public.execution_queued)")
      assert(Number.isSafeInteger(active) && active >= 0)
      if (active === 0) return {waitedMs: Math.ceil(performance.now() - started), active}
      assert(performance.now() - started < timeoutMs, 'Isolated database did not become idle')
      await wait(intervalMs)
    }
  }
  async waitForStable({windowMs = 5000, timeoutMs = 60000, intervalMs = 250} = {}) {
    assert(windowMs >= 5000 && timeoutMs >= windowMs && timeoutMs <= 60000 && intervalMs > 0 && intervalMs <= 1000)
    const started = performance.now(); let stableSince = started
    const observation = {windowMs, timeoutMs, samples: []}
    try {
      let previous = this.snapshot()
      observation.before = previous.hash
      stableSince = performance.now()
      while (performance.now() - stableSince < windowMs) {
        assert(performance.now() - started < timeoutMs, 'Isolated effects did not stabilize')
        await wait(intervalMs)
        const current = this.snapshot(); observation.samples.push({elapsedMs: Math.ceil(performance.now() - started), ...current})
        if (current.hash !== previous.hash) stableSince = performance.now()
        previous = current
      }
    } catch {
      const error = new Error('Stability observation failed; raw diagnostics withheld')
      error.observation = observation
      throw error
    }
    return observation
  }
  async observeDenied(action, verifyResponse, {windowMs = 5000, intervalMs = 250} = {}) {
    assert(windowMs >= 5000 && windowMs <= 60000 && intervalMs > 0 && intervalMs <= 1000)
    const before = this.snapshot()
    const observation = {before: before.hash, beforeSources: before.sources, beforeQueueDiagnostics: before.queueDiagnostics, sources: ['database', 'queue', 'storage'], windowMs, samples: []}
    let response, failure
    const recordFailure = error => { if (!failure) failure = error }
    try { response = await action() } catch (error) { recordFailure(error) }
    try { if (!failure) await verifyResponse(response) } catch (error) { recordFailure(error) }
    try {
      const immediate = this.snapshot(); observation.immediate = immediate.hash; observation.after = immediate.sources; observation.immediateQueueDiagnostics = immediate.queueDiagnostics; observation.afterQueueDiagnostics = immediate.queueDiagnostics
      const start = performance.now()
      do {
        await wait(intervalMs)
        const current = this.snapshot()
        observation.samples.push({elapsedMs: Math.ceil(performance.now() - start), hash: current.hash, sources: current.sources, queueDiagnostics: current.queueDiagnostics})
        observation.after = current.sources; observation.afterQueueDiagnostics = current.queueDiagnostics
      } while (observation.samples.at(-1).elapsedMs < windowMs)
      if (immediate.hash !== before.hash || observation.samples.some(sample => sample.hash !== before.hash)) recordFailure(new Error('Denied operation changed database, queue or storage'))
    } catch (error) { observation.observerFailed = true; recordFailure(error) }
    if (failure) {
      const error = new Error('Denied observation failed; response or action error details withheld')
      error.observation = observation; error.sideEffects = observation
      throw error
    }
    return {response, observation}
  }
}
