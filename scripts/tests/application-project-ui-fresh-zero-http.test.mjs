import assert from 'node:assert/strict'
import {generateKeyPairSync, sign} from 'node:crypto'
import {once} from 'node:events'
import {createServer} from 'node:http'
import test from 'node:test'
import {applicationProject} from '../application-project-cases.mjs'
import {ProductionOAuthClient} from '../production-oauth-client.mjs'
import {verifyFreshZeroUiIdentity} from '../application-project-ui-fixture.mjs'

const signing = generateKeyPairSync('rsa', {modulusLength: 2048})
const unrelated = generateKeyPairSync('rsa', {modulusLength: 2048})
const account = {username: 'zero-http-test', subject: 'zero-http-test', password: 'synthetic-only-password'}
const jwk = {...signing.publicKey.export({format: 'jwk'}), kid: 'zero-http-test', alg: 'RS256', use: 'sig'}

async function withProtocol(options, action) {
  const state = {events: [], submitted: 0, signedRequests: 0, businessRequests: 0, staleRequests: 0}
  const sockets = new Set()
  const serverErrors = []
  let origin, timer
  const token = () => {
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({alg: 'RS256', kid: jwk.kid})).toString('base64url')
    const claims = Buffer.from(JSON.stringify({iss: origin, sub: account.subject, aud: 'kestra-ui',
      iat: now, exp: now + 300, kestra_application_group_v1: {
        application_group_id: applicationProject, client_id: 'kestra-ui', authorization_version: 2,
        application_group_scopes: options.nonemptyScope ? ['unexpected-scope'] : [], protocol_scopes: ['openid'],
      }})).toString('base64url')
    const input = header + '.' + claims
    return input + '.' + sign('RSA-SHA256', Buffer.from(input), options.badSignature ? unrelated.privateKey : signing.privateKey).toString('base64url')
  }
  const server = createServer((request, response) => {
    request.on('error', () => {})
    const handle = async () => {
      const url = new URL(request.url, origin)
      const cookies = new Map((request.headers.cookie ?? '').split(';').filter(Boolean).map(pair => {
        const separator = pair.indexOf('=')
        return [pair.slice(0, separator).trim(), pair.slice(separator + 1)]
      }))
      const stale = cookies.get('JWT') === 'old-jwt' || cookies.get('oidc_session') === 'old-session'
      state.events.push({path: url.pathname, method: request.method, staleJwt: cookies.get('JWT') === 'old-jwt',
        staleSession: cookies.get('oidc_session') === 'old-session'})
      const send = (status, body = '', headers = {}) => {
        response.writeHead(status, headers)
        response.end(body)
      }
      if (url.pathname === '/test-seed') return send(200, '', {'Set-Cookie': [
        'JWT=old-jwt; Path=/; HttpOnly', 'oidc_session=old-session; Path=/; HttpOnly']})
      if (url.pathname === '/oidc/logout') {
        assert(stale)
        const clear = []
        if (!options.keepJwt) clear.push('JWT=; Max-Age=0; Path=/; HttpOnly')
        if (!options.keepSession) clear.push('oidc_session=; Max-Age=0; Path=/; HttpOnly')
        return send(307, '', {Location: '/ui/', 'Set-Cookie': clear})
      }
      if (url.pathname === '/oauth/login/kestra') {
        if (stale) { state.staleRequests++; return send(401) }
        return send(302, '', {Location: options.noCredentials ? '/oauth/callback/kestra' : '/oidc/login?from=%2Foauth%2Fcallback%2Fkestra'})
      }
      if (url.pathname === '/oidc/login') {
        assert.equal(request.method, 'POST')
        assert.equal(request.headers['content-type'], 'application/x-www-form-urlencoded')
        assert(!stale)
        let body = ''
        for await (const chunk of request) body += chunk
        const values = new URLSearchParams(body)
        assert.equal(values.get('username'), account.username)
        assert.equal(values.get('password'), account.password)
        assert.equal(values.get('from'), '/oauth/callback/kestra')
        state.submitted++
        return send(303, '', {Location: '/oauth/callback/kestra', 'Set-Cookie': 'oidc_session=new-session; Path=/; HttpOnly'})
      }
      if (url.pathname === '/oauth/callback/kestra') {
        assert(!stale)
        return send(302, '', {Location: '/ui/', 'Set-Cookie': 'JWT=' + token() + '; Path=/; HttpOnly'})
      }
      if (url.pathname === '/ui/') return send(200, '<meta name="csrf-token" content="synthetic-csrf">', {'Content-Type': 'text/html'})
      if (url.pathname === '/.well-known/openid-configuration') return send(200, JSON.stringify({issuer: origin,
        authorization_endpoint: origin + '/oidc/authorize', token_endpoint: origin + '/oidc/token', jwks_uri: origin + '/oidc/jwks'}), {'Content-Type': 'application/json'})
      if (url.pathname === '/oidc/jwks') {
        state.signedRequests++
        return send(200, JSON.stringify({keys: [jwk]}), {'Content-Type': 'application/json'})
      }
      if (url.pathname === '/api/v1/main/flows/search') {
        assert.equal(url.search, '?size=1')
        assert(cookies.get('JWT') && !stale)
        state.businessRequests++
        return send(options.businessStatus ?? 403)
      }
      throw new Error('Unexpected synthetic protocol route')
    }
    handle().catch(error => { serverErrors.push(error); response.destroy() })
  })
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  try {
    const listening = once(server, 'listening')
    server.listen(0, '127.0.0.1')
    await listening
    origin = 'http://127.0.0.1:' + server.address().port
    const deadline = new Promise((accept, reject) => {
      timer = setTimeout(() => reject(new Error('Synthetic HTTP protocol deadline exceeded')), 5000)
    })
    await Promise.race([(async () => {
      const client = new ProductionOAuthClient(origin)
      const seeded = await client.request('/test-seed')
      assert.equal(seeded.status, 200)
      await seeded.body?.cancel()
      await action({state, run: () => verifyFreshZeroUiIdentity({base: origin, client, account})})
    })(), deadline])
  } finally {
    clearTimeout(timer)
    for (const socket of sockets) socket.destroy()
    if (server.listening) await new Promise((accept, reject) => server.close(error => error ? reject(error) : accept()))
    assert.deepEqual(serverErrors, [])
  }
}

test('synthetic loopback: real client clears both old cookies, submits credentials, verifies RS256 zero identity and requires403', async () => {
  await withProtocol({}, async ({state, run}) => {
    const result = await run()
    assert.equal(result.businessStatus, 403)
    assert.equal(result.credentialsSubmitted, true)
    assert.deepEqual(result.applicationGroupScopes, [])
    assert.equal(state.submitted, 1)
    assert.equal(state.signedRequests, 1)
    assert.equal(state.businessRequests, 1)
    assert.equal(state.staleRequests, 0)
    assert.deepEqual(state.events.map(event => event.path), ['/test-seed', '/oidc/logout', '/oauth/login/kestra',
      '/oidc/login', '/oauth/callback/kestra', '/ui/', '/.well-known/openid-configuration', '/oidc/jwks', '/api/v1/main/flows/search'])
    assert(state.events[1].staleJwt && state.events[1].staleSession)
    assert(state.events.slice(2).every(event => !event.staleJwt && !event.staleSession))
    assert(!JSON.stringify(result).includes(account.password))
  })
})

for (const [name, options] of [['JWT', {keepJwt: true}], ['OIDC session', {keepSession: true}]]) {
  test(`synthetic loopback: old ${name} not cleared fails instead of counting401 as zero authorization`, async () => {
    await withProtocol(options, async ({state, run}) => {
      await assert.rejects(run, /Production UI OAuth entry/)
      assert.equal(state.staleRequests, 1)
      assert.equal(state.submitted, 0)
      assert.equal(state.businessRequests, 0)
    })
  })
}

test('synthetic loopback: automatic session login without credential POST is rejected', async () => {
  await withProtocol({noCredentials: true}, async ({state, run}) => {
    await assert.rejects(run, /must submit credentials/)
    assert.equal(state.submitted, 0)
    assert.equal(state.businessRequests, 0)
  })
})

for (const [name, options, expected] of [
  ['wrong RS256 signing key', {badSignature: true}, /signature must verify/],
  ['signed nonempty application scopes', {nonemptyScope: true}, error => {
    assert.equal(error.code, 'ERR_ASSERTION')
    assert.deepEqual(error.actual, ['unexpected-scope'])
    assert.deepEqual(error.expected, [])
    return true
  }],
  ['fresh business401', {businessStatus: 401}, /must be forbidden, not unauthenticated/],
  ['fresh business200', {businessStatus: 200}, /must be forbidden, not unauthenticated/],
]) {
  test(`synthetic loopback: ${name} cannot pass fresh zero preparation`, async () => {
    await withProtocol(options, async ({state, run}) => {
      await assert.rejects(run, expected)
      assert.equal(state.submitted, 1)
      assert.equal(state.signedRequests, 1)
      assert.equal(state.businessRequests, options.businessStatus === undefined ? 0 : 1)
    })
  })
}
