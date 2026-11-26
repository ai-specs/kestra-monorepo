import assert from 'node:assert/strict'

const identifier = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,99}$/
const namespaceIdentifier = /^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*$/
const flowIdentifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
const pendingStates = new Set(['CREATED', 'RUNNING', 'PAUSED', 'QUEUED', 'RESTARTED', 'KILLING', 'RETRYING'])
const successStates = new Set(['SUCCESS', 'WARNING', 'RETRIED', 'SKIPPED', 'RESUBMITTED'])
const failureStates = new Set(['FAILED', 'KILLED', 'CANCELLED'])

export function amisApiPath({namespace, flowId, apiId}) {
  assert(namespaceIdentifier.test(namespace) && namespace.length <= 150)
  assert(flowIdentifier.test(flowId) && identifier.test(apiId))
  return `/${namespace}/${flowId}/apis/${apiId}`
}

export function validateAmisExecutionResponse(status, value, {apiPath, executionId} = {}) {
  assert([200, 202].includes(status), 'AMIS execution response must be 200 or 202')
  assert(value && typeof value === 'object' && !Array.isArray(value))
  assert.equal(value.version, 1)
  assert(identifier.test(value.executionId), 'Real execution ID required')
  if (executionId !== undefined) assert.equal(value.executionId, executionId)
  assert.equal(value.executionUrl, apiPath + '/executions/' + value.executionId, 'Execution URL changed its API binding')
  assert(value.data && typeof value.data === 'object' && !Array.isArray(value.data), 'AMIS data must be an object')
  assert(Number.isInteger(value.status) && typeof value.resultReady === 'boolean')
  assert(pendingStates.has(value.executionState) || successStates.has(value.executionState) || failureStates.has(value.executionState), 'Unknown execution state')
  if (status === 202) {
    assert.equal(value.resultReady, false)
    assert.equal(value.status, 0)
    assert.deepEqual(value.data, {})
    assert(!failureStates.has(value.executionState), 'A known failed terminal execution must not stay pending')
  } else {
    assert.equal(value.resultReady, true)
    assert(!pendingStates.has(value.executionState), 'Nonterminal execution cannot be a completed response')
    if (successStates.has(value.executionState)) assert.equal(value.status, 0)
    else assert.notEqual(value.status, 0)
  }
  return value
}

export async function invokeAmisApi(client, {namespace, flowId, apiId, inputs, expectedData,
  timeoutMs = 60000, intervalMs = 250, observe = async () => {}, signal}) {
  assert(typeof client?.request === 'function')
  assert(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 300000)
  assert(Number.isInteger(intervalMs) && intervalMs > 0 && intervalMs <= 10000)
  assert(inputs && typeof inputs === 'object' && !Array.isArray(inputs))
  const apiPath = amisApiPath({namespace, flowId, apiId})
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('AMIS production execution observation exceeded its deadline')), timeoutMs)
  const cancellation = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  const observations = []
  try {
    let response = await client.request(apiPath, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(inputs), signal: cancellation})
    let value = validateAmisExecutionResponse(response.status, await response.json(), {apiPath})
    const executionId = value.executionId
    const executionUrl = value.executionUrl
    for (;;) {
      const observation = {status: response.status, executionId, executionState: value.executionState,
        resultReady: value.resultReady, executionUrl}
      observations.push(observation)
      await observe(observation)
      if (value.resultReady) {
        assert.equal(value.status, 0, 'Real Flow execution failed')
        if (expectedData !== undefined) assert.deepEqual(value.data, expectedData)
        return {executionId, executionUrl, result: value, observations}
      }
      await new Promise((resolve, reject) => {
        const aborted = () => {clearTimeout(waiter); cancellation.removeEventListener('abort', aborted); reject(cancellation.reason)}
        const waiter = setTimeout(() => {cancellation.removeEventListener('abort', aborted); resolve()}, intervalMs)
        cancellation.addEventListener('abort', aborted, {once: true})
        if (cancellation.aborted) aborted()
      })
      response = await client.request(executionUrl, {signal: cancellation})
      value = validateAmisExecutionResponse(response.status, await response.json(), {apiPath, executionId})
    }
  } finally {clearTimeout(timer)}
}
