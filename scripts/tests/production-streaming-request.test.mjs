import assert from 'node:assert/strict'
import {once} from 'node:events'
import {createServer} from 'node:http'
import test from 'node:test'
import {setTimeout as delay} from 'node:timers/promises'
import {ProductionOAuthClient} from '../production-oauth-client.mjs'

const api = '/company.amis/Flow.v1/apis/_submit'
const credentials = {username: 'synthetic-user', password: 'SYNTHETIC-LOGIN-PRIVATE'}
const cookie = 'SYNTHETIC-CLOSURE-JWT'
const csrf = 'SYNTHETIC-CLOSURE-CSRF'
function deferred() {
  let resolve
  const promise = new Promise(accept => { resolve = accept })
  return {promise, resolve}
}
async function bounded(promise) {
  const controller = new AbortController()
  try {
    return await Promise.race([promise, delay(3000, null, {signal: controller.signal}).then(() => { throw new Error('Loopback test deadline') })])
  } finally { controller.abort() }
}
function privateValuesAbsent(value) {
  const text = JSON.stringify(value)
  for (const secret of [credentials.password, cookie, csrf]) assert(!text.includes(secret), 'Private closure value escaped')
}
async function loopback(t, handler, {login = true} = {}) {
  const sockets = new Set(), errors = [], events = []
  let streamingRequests = 0
  const server = createServer((request, response) => {
    request.on('error', () => {})
    Promise.resolve().then(async () => {
      if (request.url === '/oauth/login/kestra') {
        assert.equal(request.method, 'GET');events.push('oauth-entry')
        response.writeHead(302, {Location: '/oidc/login?from=stream-test'});response.end();return
      }
      if (request.url === '/oidc/login') {
        assert.equal(request.method, 'POST')
        const bytes = [];for await (const chunk of request) bytes.push(chunk)
        const form = new URLSearchParams(Buffer.concat(bytes).toString())
        assert.equal(form.get('username'), credentials.username);assert.equal(form.get('password'), credentials.password)
        assert.equal(form.get('from'), 'stream-test');events.push('credentials-submitted')
        response.writeHead(303, {Location: '/ui/main/dashboards', 'Set-Cookie': [`JWT=${cookie}; HttpOnly; Path=/`, `XSRF-TOKEN=${csrf}; Path=/`]})
        response.end();return
      }
      if (request.url === '/ui/main/dashboards') {
        assert(request.headers.cookie.includes(`JWT=${cookie}`));events.push('callback-document')
        response.writeHead(200, {'Content-Type': 'text/html'})
        response.end(`<html><meta name="csrf-token" content="${csrf}"><div id="app"></div></html>`);return
      }
      streamingRequests++
      assert.equal(request.url, api);assert.equal(request.method, 'POST')
      assert.equal(request.headers.cookie, `JWT=${cookie}; XSRF-TOKEN=${csrf}`)
      assert.equal(request.headers['x-csrf-token'], csrf)
      assert.equal(request.headers.authorization, undefined)
      assert.equal(request.headers['content-type'], 'application/json')
      assert.equal(request.headers['transfer-encoding'], 'chunked')
      assert.equal(request.headers['content-length'], undefined)
      await handler(request, response)
    }).catch(error => { errors.push(error);response.destroy() })
  })
  server.on('connection', socket => { sockets.add(socket);socket.on('close', () => sockets.delete(socket)) })
  server.listen(0, '127.0.0.1');await once(server, 'listening')
  t.after(async () => {
    for (const socket of sockets) socket.destroy()
    await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()))
    assert.deepEqual(errors, [])
  })
  const origin = `http://127.0.0.1:${server.address().port}`
  const client = new ProductionOAuthClient(origin)
  let receipt
  if (login) receipt = await bounded(client.login(credentials.username, credentials.password))
  return {client, origin, receipt, events, requests: () => streamingRequests}
}

test('synthetic login over real Node loopback binds private cookie and CSRF to streaming request; preserves mixed chunk bytes', async t => {
  let received
  const fixture = await loopback(t, async (request, response) => {
    const bytes = [];for await (const chunk of request) bytes.push(chunk)
    received = Buffer.concat(bytes).toString('utf8')
    response.writeHead(200, {'Content-Type': 'application/json'});response.end('{"saved":true}')
  })
  async function* chunks() { yield '{"name":';yield Buffer.from('"中文-loopback"');yield new Uint8Array(Buffer.from('}')) }
  const response = await bounded(fixture.client.requestStreaming(api, {chunks: chunks()}))
  assert.equal(response.status, 200);assert.deepEqual(await response.json(), {saved: true})
  assert.equal(received, '{"name":"中文-loopback"}');assert.equal(fixture.requests(), 1)
  assert.deepEqual(fixture.events, ['oauth-entry', 'credentials-submitted', 'callback-document'])
  assert.deepEqual(fixture.receipt, {callbackPath: '/ui/main/dashboards', authenticated: true, credentialsSubmitted: true})
  assert.deepEqual(Object.keys(fixture.client), [])
  for (const method of ['exportCookies', 'cookies', 'csrf', 'session', 'tokens', 'exportSession']) assert.equal(fixture.client[method], undefined)
  privateValuesAbsent({client: fixture.client, receipt: fixture.receipt, timing: fixture.client.sessionTimingEvidence()})
})

test('Node loopback early408 resolves and closes upload socket before producer completion', async t => {
  const closed = deferred(), release = deferred()
  let producerEnded = false
  const {client, requests} = await loopback(t, async (request, response) => {
    request.socket.once('close', closed.resolve)
    request.once('data', () => { response.writeHead(408, {'Content-Type': 'application/json'});response.end('{"error":"body deadline"}') })
  })
  async function* chunks() { try { yield '{"name":"';await release.promise;yield 'late"}' } finally { producerEnded = true } }
  try {
    const response = await bounded(client.requestStreaming(api, {chunks: chunks()}))
    assert.equal(response.status, 408);assert.deepEqual(await response.json(), {error: 'body deadline'})
    assert.equal(producerEnded, false);assert.equal(requests(), 1)
    await bounded(closed.promise)
  } finally { release.resolve() }
})

test('Node loopback caller abort closes live upload and does not expose private abort reason or session', async t => {
  const started = deferred(), closed = deferred(), release = deferred()
  const {client} = await loopback(t, async request => {
    request.socket.once('close', closed.resolve);request.once('data', started.resolve)
  })
  async function* chunks() { yield '{"name":"';await release.promise;yield 'late"}' }
  const controller = new AbortController()
  const rejected = assert.rejects(client.requestStreaming(api, {chunks: chunks(), signal: controller.signal}), error => {
    assert.equal(error.name, 'AbortError');assert.equal(error.message, 'Streaming HTTP cancelled or timed out')
    privateValuesAbsent({name: error.name, message: error.message});assert(!error.message.includes('PRIVATE-ABORT-REASON'));return true
  })
  try { await bounded(started.promise);controller.abort('PRIVATE-ABORT-REASON');await bounded(rejected);await bounded(closed.promise) }
  finally { release.resolve() }
})

test('cookie client rejects outside origin, native management, traversal, query and non-API paths before requests', async t => {
  const {client, origin, requests} = await loopback(t, () => { throw new Error('Invalid path connected') })
  async function* chunks() { yield '{}' }
  for (const path of [`${origin}${api}`, `http://127.0.0.1:1${api}`, `//foreign.invalid${api}`, '/api/v1/main/flows',
    '/company.amis/Flow.v1/apis/_submit/executions/id', '/company.amis/../apis/x', '/company.amis/Flow.v1/apis/x?token=secret',
    '/company.amis/Flow.v1/apis/x#fragment', '/company.amis/Flow.v1/apis/%2e%2e', '/company.amis\\Flow.v1/apis/x']) {
    await assert.rejects(client.requestStreaming(path, {chunks: chunks()}))
  }
  assert.equal(requests(), 0)
})

test('streaming requires existing login/CSRF closure; rejects invalid iterator and deadline without connecting', async t => {
  const anonymous = await loopback(t, () => { throw new Error('Anonymous stream connected') }, {login: false})
  async function* chunks() { yield '{}' }
  await assert.rejects(anonymous.client.requestStreaming(api, {chunks: chunks()}), /Existing production login and CSRF state required/)
  assert.equal(anonymous.requests(), 0)
  const authenticated = await loopback(t, () => { throw new Error('Invalid input connected') })
  for (const timeoutMs of [0, 30000, 45001, NaN, Infinity, '45000']) await assert.rejects(authenticated.client.requestStreaming(api, {chunks: chunks(), timeoutMs}))
  await assert.rejects(authenticated.client.requestStreaming(api, {chunks: ['{}']}))
  const controller = new AbortController();controller.abort('PRIVATE-ABORT-REASON')
  await assert.rejects(authenticated.client.requestStreaming(api, {chunks: chunks(), signal: controller.signal}), {name: 'AbortError'})
  assert.equal(authenticated.requests(), 0)
})

test('Node loopback response over1MiB fails boundedly without cookie/CSRF diagnostics', async t => {
  const {client} = await loopback(t, async (request, response) => {
    request.resume();response.writeHead(200, {'Content-Type': 'text/plain'});response.end('x'.repeat(1048577))
  })
  async function* chunks() { yield '{}' }
  await assert.rejects(bounded(client.requestStreaming(api, {chunks: chunks()})), error => {
    assert.equal(error.message, 'Streaming API transport failed');privateValuesAbsent({message: error.message});return true
  })
})
