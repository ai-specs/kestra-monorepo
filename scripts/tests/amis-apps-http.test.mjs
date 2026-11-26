import assert from 'node:assert/strict'
import test from 'node:test'
import {amisApiPath, invokeAmisApi, validateAmisExecutionResponse} from '../amis-apps-http.mjs'

const apiPath = '/company.amis.a/greeting/apis/greet'
const pending = {version: 1, status: 0, data: {}, executionId: 'real-execution', executionState: 'RUNNING', resultReady: false,
  executionUrl: apiPath + '/executions/real-execution'}
const ready = {...pending, executionState: 'SUCCESS', resultReady: true, data: {message: 'saved'}}

test('root invocation submits once and follows only the exact real execution URL', async () => {
  const calls = []
  const responses = [{status: 202, body: pending}, {status: 202, body: {...pending, executionState: 'SUCCESS'}}, {status: 200, body: ready}]
  const client = {async request(path, options) {
    calls.push({path, method: options?.method ?? 'GET'})
    const result = responses.shift()
    return {status: result.status, async json() {return result.body}}
  }}
  const value = await invokeAmisApi(client, {namespace: 'company.amis.a', flowId: 'greeting', apiId: 'greet',
    inputs: {name: 'saved'}, expectedData: {message: 'saved'}, intervalMs: 1})
  assert.equal(value.executionId, 'real-execution')
  assert.deepEqual(calls, [{path: apiPath, method: 'POST'}, ...Array.from({length: 2}, () => ({path: pending.executionUrl, method: 'GET'}))])
})

test('poll responses cannot replace execution identity or return fake empty success', () => {
  const delayed = {...pending, executionState: 'SUCCESS'}
  assert.equal(validateAmisExecutionResponse(202, delayed, {apiPath}), delayed)
  for (const [status, body] of [[200, pending], [202, ready], [200, {...ready, executionId: 'foreign'}],
    [200, {...ready, executionUrl: 'https://foreign.invalid/execution'}], [200, {...ready, executionState: 'UNKNOWN'}],
    [200, {...ready, data: null}], [200, {...ready, data: []}]]) {
    assert.throws(() => validateAmisExecutionResponse(status, body, {apiPath, executionId: 'real-execution'}))
  }
  assert.equal(validateAmisExecutionResponse(200, {...ready, data: {}}, {apiPath}).resultReady, true)
})

test('unknown targets and invalid response identities stop before another network call', async () => {
  assert.throws(() => amisApiPath({namespace: 'company.*', flowId: 'x', apiId: 'greet'}))
  let calls = 0
  const client = {async request() {calls++; return {status: 200, async json() {return {...ready, executionUrl: '//foreign.invalid/result'}}}}}
  await assert.rejects(invokeAmisApi(client, {namespace: 'company.amis.a', flowId: 'greeting', apiId: 'greet', inputs: {}}))
  assert.equal(calls, 1)
})

test('bounded polling timeout never starts a second submission', async () => {
  const methods = []
  const client = {async request(path, options) {methods.push(options?.method ?? 'GET'); return {status: 202, async json() {return pending}}}}
  await assert.rejects(invokeAmisApi(client, {namespace: 'company.amis.a', flowId: 'greeting', apiId: 'greet',
    inputs: {}, timeoutMs: 25, intervalMs: 5}), /deadline/)
  assert.equal(methods.filter(method => method === 'POST').length, 1)
})
