import assert from 'node:assert/strict'
import {setTimeout as wait} from 'node:timers/promises'
import {amisApiPath, validateAmisExecutionResponse} from './amis-apps-http.mjs'

/** Existing, explicitly seeded production deployment only. The caller configures
 * max-sync-concurrency=1 and seeds a three-second Pause in both slow Flows.
 */
export async function runAmisSyncCases({mode, client, target, effects, executionCount, executionDetails, executionInventory, persist}) {
  assert(['A', 'B'].includes(mode))
  assert.equal(typeof client?.request, 'function')
  assert.equal(typeof persist, 'function')
  assert.equal(typeof executionCount, 'function', 'Owned database execution count observer required')
  assert.equal(typeof executionDetails, 'function', 'Owned execution binding observer required')
  assert.equal(typeof executionInventory, 'function', 'Whole isolated execution inventory required')
  assert.equal(target.maxSyncConcurrency, 1, 'This capacity scenario requires an explicitly inspected one-permit deployment')
  assert(typeof target.marker === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(target.marker))
  const api = flowId => amisApiPath({namespace: target.namespace, flowId, apiId: target.apiId})
  const report = {id: `${mode}-explicit-sync-timeout-cancel-and-capacity`, completed: false,
    scope: 'Real HTTP waiting and execution count checks; not browser or whole P0', checks: []}
  const save = () => persist(structuredClone(report))
  const post = (path, marker, signal) => client.request(path, {method: 'POST', signal,
    headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name: marker})})
  async function count(marker) {
    const result = await executionCount(marker)
    assert(Number.isSafeInteger(result) && result >= 0)
    return result
  }
  async function untilCount(marker, expected) {
    const deadline = Date.now() + 15000
    for (;;) {
      const actual = await count(marker)
      if (actual === expected) return
      assert(actual < expected && Date.now() < deadline, 'Expected execution creation was not observed')
      await wait(50)
    }
  }
  await save()
  try {
    await effects.waitForIdle()
    const initialInventory = await executionInventory()
    assert(Array.isArray(initialInventory) && new Set(initialInventory).size === initialInventory.length)
    const expected = []
    function track(marker, flowId, executionId) {expected.push({marker, flowId, executionId})}
    const normalPath = api(target.normalFlowId)
    const normalMarker = target.marker + '-normal'
    assert.equal(await count(normalMarker), 0)
    const normal = await post(normalPath, normalMarker)
    const normalResult = validateAmisExecutionResponse(normal.status, await normal.json(), {apiPath: normalPath})
    assert.equal(normal.status, 200, 'Explicit SYNC should return the real completed result')
    assert.equal(normalResult.status, 0, 'Explicit SYNC execution must succeed')
    track(normalMarker, target.normalFlowId, normalResult.executionId)
    assert.deepEqual(normalResult.data, {message: normalMarker})
    assert.equal(await count(normalMarker), 1)
    report.checks.push({name: 'explicit-sync-returns-real-result', passed: true, executionId: normalResult.executionId})
    await save()

    const timeoutPath = api(target.timeoutFlowId)
    const timeoutMarker = target.marker + '-timeout'
    assert.equal(await count(timeoutMarker), 0)
    const started = performance.now()
    const timed = await post(timeoutPath, timeoutMarker)
    const pending = validateAmisExecutionResponse(timed.status, await timed.json(), {apiPath: timeoutPath})
    assert.equal(timed.status, 202)
    assert.equal(pending.resultReady, false)
    track(timeoutMarker, target.timeoutFlowId, pending.executionId)
    assert(performance.now() - started < 15000, 'SYNC HTTP timeout was unbounded')
    assert.equal(await count(timeoutMarker), 1)
    const deadline = Date.now() + 30000
    let terminal
    for (;;) {
      const response = await client.request(pending.executionUrl)
      terminal = validateAmisExecutionResponse(response.status, await response.json(), {apiPath: timeoutPath, executionId: pending.executionId})
      if (terminal.resultReady) break
      assert(Date.now() < deadline)
      await wait(100)
    }
    assert.equal(terminal.status, 0)
    assert.deepEqual(terminal.data, {message: timeoutMarker})
    assert.equal(await count(timeoutMarker), 1)
    report.checks.push({name: 'timeout-does-not-cancel-or-duplicate-execution', passed: true, executionId: pending.executionId})
    await save()

    const capacityPath = api(target.capacityFlowId)
    const holdingMarker = target.marker + '-holding'
    const rejectedMarker = target.marker + '-capacity-denied'
    const cancelMarker = target.marker + '-cancelled-http'
    const afterCancelMarker = target.marker + '-after-cancel'
    const first = post(capacityPath, holdingMarker).then(response => ({response}), error => ({error}))
    await untilCount(holdingMarker, 1)
    const rejected = await post(capacityPath, rejectedMarker)
    assert.equal(rejected.status, 429)
    await rejected.body?.cancel()
    assert.equal(await count(rejectedMarker), 0)
    const firstOutcome = await first
    if (firstOutcome.error) throw firstOutcome.error
    const heldResponse = firstOutcome.response
    const heldResult = validateAmisExecutionResponse(heldResponse.status, await heldResponse.json(), {apiPath: capacityPath})
    assert.equal(heldResponse.status, 200)
    assert.equal(heldResult.status, 0)
    track(holdingMarker, target.capacityFlowId, heldResult.executionId)
    assert.deepEqual(heldResult.data, {message: holdingMarker})
    assert.equal(await count(holdingMarker), 1)
    report.checks.push({name: 'one-permit-capacity-rejects-before-submission', passed: true, deniedStatus: 429, deniedExecutions: 0})
    await save()

    const abort = new AbortController()
    const cancelled = post(capacityPath, cancelMarker, abort.signal).then(response => ({response}), error => ({error}))
    await untilCount(cancelMarker, 1)
    abort.abort()
    const cancellation = await cancelled
    assert(cancellation.error && (cancellation.error.name === 'AbortError' || cancellation.error.code === 'ABORT_ERR'), 'HTTP wait must specifically observe cancellation')
    let afterCancel
    const permitDeadline = Date.now() + 5000
    for (;;) {
      afterCancel = await post(capacityPath, afterCancelMarker)
      if (afterCancel.status !== 429) break
      await afterCancel.body?.cancel()
      assert.equal(await count(afterCancelMarker), 0, 'A rejected permit-release probe must not submit')
      assert(Date.now() < permitDeadline, 'Cancellation did not release the permit within the accepted bound')
      await wait(50)
    }
    assert([200, 202].includes(afterCancel.status), 'HTTP cancellation must release the SYNC permit')
    const afterResult = validateAmisExecutionResponse(afterCancel.status, await afterCancel.json(), {apiPath: capacityPath})
    track(afterCancelMarker, target.capacityFlowId, afterResult.executionId)
    await effects.waitForIdle()
    assert.equal(await count(cancelMarker), 1, 'Cancelled HTTP must not claim execution cancellation or duplicate its submission')
    assert.equal(await count(afterCancelMarker), 1)
    assert.equal(await count(rejectedMarker), 0, 'Rejected capacity request produced a delayed execution')
    const cancelledRows = await executionDetails(cancelMarker)
    assert.equal(cancelledRows.length, 1)
    track(cancelMarker, target.capacityFlowId, cancelledRows[0].id)
    for (const item of expected) {
      assert.equal(await count(item.marker), 1, 'Late duplicate execution detected')
      const rows = await executionDetails(item.marker)
      assert.deepEqual(rows, [{id: item.executionId, namespace: target.namespace, flowId: item.flowId, state: 'SUCCESS'}], 'Execution binding or final success mismatch')
    }
    assert.equal(new Set(expected.map(item => item.executionId)).size, 5)
    const finalInventory = await executionInventory()
    assert.deepEqual([...finalInventory].sort(), [...initialInventory, ...expected.map(item => item.executionId)].sort(), 'Unexpected unmarked execution side effect')
    report.checks.push({name: 'http-cancel-releases-permit-without-resubmission', passed: true,
      cancelledHttpExecutions: 1, nextRequestExecutions: 1, rejectedExecutions: 0})
    report.completed = true
    await save()
    return report
  } catch (error) {
    report.failure = {message: String(error.message)}
    await save()
    const failure = new Error('AMIS SYNC production scenario failed: ' + error.message)
    failure.report = report
    throw failure
  }
}
