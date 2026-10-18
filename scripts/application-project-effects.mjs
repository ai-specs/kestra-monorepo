import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'

const hash = value => createHash('sha256').update(value).digest('hex')
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

/** Read-only evidence over an explicitly isolated acceptance deployment. */
export class ProjectSideEffects {
  #postgres
  #kestra
  #prefix
  constructor({postgresContainer, kestraContainer, composeProject, namespacePrefix = 'scope.acceptance.'}) {
    assert(/^application-projects-bb-[0-9]+-[0-9]+$/.test(composeProject), 'Isolated acceptance Compose project required')
    assert(/^[A-Za-z0-9_.-]+\.$/.test(namespacePrefix), 'Concrete acceptance namespace prefix required')
    for (const container of [postgresContainer, kestraContainer]) {
      assert(/^[a-f0-9]{12,64}$/.test(container), 'Explicit Docker container ID required')
      const actual = execFileSync('docker', ['inspect', '-f', '{{index .Config.Labels "com.docker.compose.project"}}', container], {encoding: 'utf8'}).trim()
      assert.equal(actual, composeProject, 'Observer must not inspect a user deployment')
    }
    this.#postgres = postgresContainer
    this.#kestra = kestraContainer
    this.#prefix = namespacePrefix
  }
  #sql(query) {
    return execFileSync('docker', ['exec', this.#postgres, 'psql', '-X', '-U', 'kestra', '-d', 'kestra', '-v', 'ON_ERROR_STOP=1', '-Atc', query], {encoding: 'utf8', timeout: 20000, maxBuffer: 16 * 1024 * 1024}).trim()
  }
  snapshot() {
    // Each source is hashed independently. No database row contents, storage bytes,
    // tokens or installation receipt are emitted in the acceptance report.
    const pattern = this.#prefix + '%'
    const database = this.#sql(`SELECT json_build_object(
      'flows',(SELECT md5(coalesce(string_agg(value::text,'|' ORDER BY value::text),'')) FROM flows WHERE value->>'namespace' LIKE '${pattern}'),
      'executions',(SELECT md5(coalesce(string_agg(value::text,'|' ORDER BY value::text),'')) FROM executions WHERE value->>'namespace' LIKE '${pattern}'),
      'pending',(SELECT md5(coalesce(string_agg(value::text,'|' ORDER BY value::text),'')) FROM execution_queued WHERE value::text LIKE '%${this.#prefix}%')
    )::text`)
    const queue = this.#sql(`SELECT md5(coalesce(string_agg(value::text,'|' ORDER BY value::text),'')) FROM queues WHERE value::text LIKE '%${this.#prefix}%'`)
    const storage = execFileSync('docker', ['exec', this.#kestra, 'sh', '-c',
      "set -eu; listing=$(find /app/storage -mindepth 1 ! -name .oidc-installation -print); printf '%s\\n' \"$listing\" | LC_ALL=C sort; sums=$(find /app/storage -type f ! -name .oidc-installation -exec sha256sum {} +); printf '%s\\n' \"$sums\" | LC_ALL=C sort"], {encoding: 'utf8', timeout: 20000, maxBuffer: 32 * 1024 * 1024})
    const sources = {database: hash(database), queue: hash(queue), storage: hash(storage)}
    return {hash: hash(JSON.stringify(sources)), sources}
  }
  async observeDenied(action, verifyResponse, {windowMs = 5000, intervalMs = 250} = {}) {
    assert(windowMs >= 5000 && intervalMs > 0 && intervalMs <= 1000)
    const before = this.snapshot()
    const response = await action()
    // Check persistence even when the response assertion fails, then retain the
    // observation in the thrown error for the caller's finally-written report.
    let responseFailure
    try { await verifyResponse(response) } catch (failure) { responseFailure = failure }
    const immediate = this.snapshot()
    const observation = {before: before.hash, immediate: immediate.hash, sources: Object.keys(before.sources), beforeSources: before.sources,
      windowMs, samples: []}
    const start = performance.now()
    do {
      await wait(intervalMs)
      const observed = this.snapshot()
      observation.samples.push({elapsedMs: Math.ceil(performance.now() - start), hash: observed.hash, sources: observed.sources})
    } while (observation.samples.at(-1).elapsedMs < windowMs)
    const mutation = immediate.hash !== before.hash || observation.samples.some(sample => sample.hash !== before.hash)
    if (responseFailure || mutation) {
      const failure = responseFailure ?? new Error('Denied operation changed database, queue or storage')
      failure.sideEffects = observation
      throw failure
    }
    return {response, observation}
  }
}
