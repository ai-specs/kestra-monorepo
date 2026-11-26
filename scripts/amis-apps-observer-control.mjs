import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'

// Confirm that the production queue observer sees a real, otherwise unconsumed
// row in the owned isolated database. This is instrumentation validation, never
// a substitute for a real permitted Flow execution.
export async function verifyAmisQueueObservation({owner, postgresContainer, database, effects,
  execute = execFileSync}) {
  assert.match(owner, /^application-projects-bb-[0-9]+-[0-9]+$/)
  assert.match(postgresContainer, /^[a-f0-9]{64}$/)
  assert.match(database, /^application_group_acceptance_[0-9]+_[0-9]+$/)
  await effects.waitForIdle()
  await effects.waitForStable()
  const before = effects.snapshot() // Also verifies live owner and actual DB.
  const key = 'amis-observer-' + randomUUID()
  const type = 'amis_acceptance_observer_only'
  function sql(query) {
    return execute('docker', ['exec', postgresContainer, 'psql', '-X', '-U', 'kestra', '-d', database,
      '-v', 'ON_ERROR_STOP=1', '-Atc', query], {encoding: 'utf8', timeout: 20000})
  }
  let inserted = false, observation, failure
  try {
    const identity = sql("SELECT current_database();").trim()
    assert.equal(identity, database)
    // Set cleanup intent before mutation: a lost successful transport response
    // must still attempt removal of this unique, explicitly owned row.
    inserted = true
    sql(`INSERT INTO public.queues(type,key,value,created) VALUES ('${type}','${key}',jsonb_build_object('owner','${owner}','namespace','company.amis','flowId','observer-positive-control','executionId','${key}'),now());`)
    const during = effects.snapshot()
    assert.equal(during.counts.queues, before.counts.queues + 1)
    assert.notEqual(during.sources.queue, before.sources.queue, 'Queue observer did not detect the real positive control')
    assert.equal(during.sources.database, before.sources.database)
    assert.equal(during.sources.storage, before.sources.storage)
    observation = {owner, kind: 'owned-isolated-queue-observer-positive-control', before, during}
  } catch (error) {failure = error}
  finally {
    if (inserted) {
      try {
        sql(`DELETE FROM public.queues WHERE type='${type}' AND key='${key}' AND value->>'owner'='${owner}';`)
        const after = effects.snapshot()
        assert.equal(after.hash, before.hash, 'Queue observation control did not restore its baseline')
        if (observation) observation.after = after
      } catch (error) {failure = failure ? new AggregateError([failure, error], 'Queue observation and cleanup failed') : error}
    }
  }
  if (failure) throw new Error('Owned queue observation control failed; retained runner diagnostics required', {cause: failure})
  return {...observation, passed: true, restored: true}
}
