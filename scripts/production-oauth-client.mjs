import {createHash, createPublicKey, randomBytes, verify} from 'node:crypto'
import assert from 'node:assert/strict'

const redirects = new Set([301, 302, 303, 307, 308])
const form = body => ({method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(body)})

export class ProductionOAuthClient {
  #base
  #cookies = new Map()
  #csrf
  #client
  #tokens
  #resource
  #discovery
  constructor(base) { this.#base = new URL(base).origin }
  get origin() { return this.#base }
  async request(path, options = {}, includeSession = true) {
    const url = new URL(path, this.#base)
    assert.equal(url.origin, this.#base, 'Test client cannot follow credentials off the instance origin')
    const response = await fetch(url, {...options, redirect: 'manual', signal: options.signal ?? AbortSignal.timeout(90_000), headers: {
      ...(includeSession && this.#cookies.size ? {Cookie: [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; ')} : {}),
      ...(includeSession && this.#csrf && options.method && !['GET', 'HEAD', 'OPTIONS'].includes(options.method) ? {'X-CSRF-TOKEN': this.#csrf} : {}),
      ...options.headers,
    }})
    for (const value of includeSession ? response.headers.getSetCookie() : []) {
      const pair = value.split(';')[0], separator = pair.indexOf('=')
      if (separator <= 0) continue
      const name = pair.slice(0, separator), content = pair.slice(separator + 1)
      if (/;\s*max-age=0(?:;|$)/i.test(value) || content === '') this.#cookies.delete(name)
      else this.#cookies.set(name, content)
    }
    return response
  }
  async login(username, password) {
    let response = await this.request('/oauth/login/kestra')
    assert.equal(response.status, 302, 'Production UI OAuth entry')
    let finalUrl
    let credentialsSubmitted = false
    for (let hop = 0; hop < 16 && redirects.has(response.status); hop++) {
      finalUrl = new URL(response.headers.get('location'), this.#base)
      assert.equal(finalUrl.origin, this.#base, 'Production login cannot leave the instance origin')
      if (finalUrl.pathname === '/oidc/login') {
        assert(!credentialsSubmitted, 'Production login rejected credentials or looped')
        response = await this.request('/oidc/login', form({username,password,from:finalUrl.searchParams.get('from')}))
        assert.equal(response.status,303,'Production credentials were accepted')
        credentialsSubmitted = true
      } else response = await this.request(finalUrl)
    }
    assert.equal(response.status,200,'Production OAuth callback reaches an application document')
    assert(finalUrl?.pathname.startsWith('/ui/'),'Production OAuth chain did not reach a UI path')
    const html = await response.text()
    this.#csrf = html.match(/name="csrf-token"[^>]*content="([^"]+)"/)?.[1]
      ?? html.match(/content="([^"]+)"[^>]*name="csrf-token"/)?.[1]
    assert(this.#csrf && this.#cookies.has('JWT'),'Server issued UI authentication and CSRF cookies')
    // HTTP follows the server callback only. The browser matrix separately
    // verifies the SPA's final canonical route and stable business content.
    return {callbackPath:finalUrl.pathname,authenticated:true,credentialsSubmitted}
  }
  async discover() {
    const response = await this.request('/.well-known/openid-configuration')
    assert.equal(response.status, 200)
    const metadata = await response.json()
    assert.equal(metadata.issuer, this.#base)
    for (const name of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) assert.equal(new URL(metadata[name]).origin, this.#base)
    this.#discovery = metadata
    return metadata
  }
  async issueMcpScopes(scopes, approveClient, reauthenticate, {registeredClient} = {}) {
    const endpoint = '/api/v1/main/mcp/default'
    const challenge = await this.request(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'}, false)
    assert.equal(challenge.status, 401)
    const metadata = challenge.headers.get('www-authenticate')?.match(/resource_metadata="([^"]+)"/)?.[1]
    assert(metadata, 'Protected resource discovery is required')
    const discovery = await this.request(metadata)
    assert.equal(discovery.status, 200)
    this.#resource = (await discovery.json()).resource
    assert.equal(this.#resource, this.#base + endpoint, 'Exact resource-bound audience')
    await this.discover()
    // Registration establishes a pending public client, rather than approving a project membership.
    if (registeredClient) {
      // Reuse only a real prior public DCR response from this isolated issuer.
      // Membership is pre-approved by the explicit directory activation plan;
      // owner login, consent, S256 and the real token exchange still run below.
      assert(typeof registeredClient.client_id === 'string' && registeredClient.client_id.length)
      assert.equal(registeredClient.token_endpoint_auth_method,'none')
      assert(Array.isArray(registeredClient.redirect_uris) && registeredClient.redirect_uris.length === 1)
      assert.equal(registeredClient.redirect_uris[0],'http://127.0.0.1:19997/callback')
      assert(!registeredClient.client_secret)
      this.#client = structuredClone(registeredClient)
    } else {
      const registration = await this.request('/oidc/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
        redirect_uris: ['http://127.0.0.1:19997/callback'], token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
        scope: 'openid mcp:flows:read mcp:executions:write', client_name: 'Application project acceptance',
      })})
      assert.equal(registration.status, 201)
      this.#client = await registration.json()
    }
    assert(!this.#client.client_secret, 'Public client must not receive a secret')
    if (!registeredClient) {
      assert(typeof approveClient === 'function', 'Project membership must be approved through a production management operation')
      await approveClient({clientId: this.#client.client_id, audiences: [this.#resource], scopes: [...scopes]})
    }
    assert(typeof reauthenticate === 'function', 'Project epoch changes require a fresh production identity after membership approval')
    await reauthenticate(this)
    const verifier = randomBytes(48).toString('base64url'), state = randomBytes(20).toString('hex')
    const query = new URLSearchParams({client_id: this.#client.client_id, redirect_uri: this.#client.redirect_uris[0], response_type: 'code',
      scope: scopes.join(' '), state, nonce: randomBytes(20).toString('hex'), resource: this.#resource,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256'})
    let response = await this.request('/oidc/authorize?' + query)
    assert.equal(response.status, 200, 'Authenticated owner reaches explicit consent')
    const interaction = (await response.text()).match(/name="interaction" value="([^"]+)"/)?.[1]
    assert(interaction, 'Production consent interaction missing')
    response = await this.request('/oidc/consent', {...form({interaction, decision: 'approve', ...Object.fromEntries(scopes.map(scope => [`scope-${scope}`, 'yes']))}),
      headers: {'Content-Type': 'application/x-www-form-urlencoded', Origin: this.#base}})
    assert.equal(response.status, 303)
    const callback = new URL(response.headers.get('location'))
    assert.equal(callback.origin + callback.pathname, this.#client.redirect_uris[0])
    assert.equal(callback.searchParams.get('state'), state)
    assert(callback.searchParams.get('code') && !callback.searchParams.get('error'))
    response = await this.request(this.#discovery.token_endpoint, form({grant_type: 'authorization_code', client_id: this.#client.client_id,
      redirect_uri: this.#client.redirect_uris[0], code: callback.searchParams.get('code'), code_verifier: verifier, resource: this.#resource}))
    assert.equal(response.status, 200, 'S256 authorization code exchange')
    this.#tokens = await response.json()
    assert(this.#tokens.access_token && this.#tokens.refresh_token)
    return {clientId: this.#client.client_id, resource: this.#resource, issuedScopes: this.#tokens.scope?.split(' ').filter(Boolean) ?? []}
  }
  async verifiedAccessIdentity({projectClaim = "kestra_project_v1", projectId, subject, expectedProjectScopes, expectedProtocolScopes}) {
    assert(this.#tokens && this.#discovery)
    const [headerSegment, payloadSegment, signatureSegment, extra] = this.#tokens.access_token.split('.')
    assert(!extra && headerSegment && payloadSegment && signatureSegment)
    const header = JSON.parse(Buffer.from(headerSegment, 'base64url').toString('utf8'))
    assert.equal(header.alg, 'RS256')
    const jwksResponse = await this.request(this.#discovery.jwks_uri)
    assert.equal(jwksResponse.status, 200)
    const keys = (await jwksResponse.json()).keys.filter(key => key.kid === header.kid && key.kty === 'RSA')
    assert.equal(keys.length, 1)
    assert(verify('RSA-SHA256', Buffer.from(`${headerSegment}.${payloadSegment}`), createPublicKey({key: keys[0], format: 'jwk'}), Buffer.from(signatureSegment, 'base64url')), 'Token signature must verify before reading authorization claims')
    const claims = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8'))
    assert.equal(claims.iss, this.#discovery.issuer)
    assert.equal(claims.sub, subject)
    assert(claims.exp > Date.now() / 1000 && claims.iat <= Date.now() / 1000 + 30)
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    assert.deepEqual(audiences, [this.#resource])
    assert(projectClaim && Object.hasOwn(claims, projectClaim), 'Use the documented published project claim name')
    const project = claims[projectClaim]
    assert(project && typeof project === 'object' && !Array.isArray(project), 'Signed project claim must use the published envelope')
    assert.equal(project.project_id, projectId)
    assert.equal(project.client_id, this.#client.client_id)
    assert(Number.isSafeInteger(project.authorization_version) && project.authorization_version > 0)
    for (const name of ['project_scopes', 'protocol_scopes']) {
      assert(Array.isArray(project[name]) && project[name].every(value => typeof value === 'string' && value.length))
      assert.equal(new Set(project[name]).size, project[name].length, 'Signed scope classification contains duplicates')
    }
    assert(!project.project_scopes.some(value => project.protocol_scopes.includes(value)), 'Project and protocol scopes overlap')
    const scopes = typeof claims.scope === 'string' ? claims.scope.split(' ').filter(Boolean) : claims.scope
    assert(Array.isArray(scopes), 'Signed access token scope missing')
    assert.deepEqual([...scopes].sort(), [...project.project_scopes, ...project.protocol_scopes].sort(), 'Signed project claim differs from issued scopes')
    if (expectedProjectScopes !== undefined) assert.deepEqual([...project.project_scopes].sort(), [...expectedProjectScopes].sort())
    if (expectedProtocolScopes !== undefined) assert.deepEqual([...project.protocol_scopes].sort(), [...expectedProtocolScopes].sort())
    return {subject: claims.sub, issuer: claims.iss, audiences, project: project.project_id,
      clientId: project.client_id, authorizationVersion: project.authorization_version,
      projectScopes: project.project_scopes, protocolScopes: project.protocol_scopes, scopes}
  }
  async verifiedUiIdentity({projectId, subject, audience, projectClaim = 'kestra_project_v1'}) {
    // authentication:idtoken stores the actual OIDC ID token in the JWT cookie.
    // Any deployment using another cookie format must fail this probe explicitly.
    if (!this.#discovery) await this.discover()
    const token = this.#cookies.get('JWT')
    assert(token, 'Production UI ID-token cookie missing')
    const [headerSegment, payloadSegment, signatureSegment, extra] = token.split('.')
    assert(!extra && headerSegment && payloadSegment && signatureSegment, 'UI cookie is not an OIDC JWT')
    const header = JSON.parse(Buffer.from(headerSegment, 'base64url').toString('utf8'))
    assert.equal(header.alg, 'RS256')
    const response = await this.request(this.#discovery.jwks_uri)
    assert.equal(response.status, 200)
    const keys = (await response.json()).keys.filter(key => key.kid === header.kid && key.kty === 'RSA')
    assert.equal(keys.length, 1)
    assert(verify('RSA-SHA256', Buffer.from(`${headerSegment}.${payloadSegment}`), createPublicKey({key:keys[0],format:'jwk'}), Buffer.from(signatureSegment,'base64url')), 'UI cookie signature must verify before reading claims')
    const claims = JSON.parse(Buffer.from(payloadSegment,'base64url').toString('utf8'))
    assert.equal(claims.iss,this.#discovery.issuer)
    assert.equal(claims.sub,subject)
    assert(claims.exp > Date.now()/1000 && claims.iat <= Date.now()/1000+30)
    assert(typeof audience === 'string' && audience.length, 'Explicit UI client audience required')
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    assert.deepEqual(audiences,[audience])
    const project = claims[projectClaim]
    assert(project && typeof project === 'object' && !Array.isArray(project))
    assert.equal(project.project_id,projectId)
    assert.equal(project.client_id,audience)
    assert(Number.isSafeInteger(project.authorization_version) && project.authorization_version > 0)
    for (const field of ['project_scopes','protocol_scopes']) {
      assert(Array.isArray(project[field]) && project[field].every(value => typeof value === 'string' && value.length))
      assert.equal(new Set(project[field]).size,project[field].length)
    }
    assert(!project.project_scopes.some(scope => project.protocol_scopes.includes(scope)))
    return {subject:claims.sub,issuer:claims.iss,audiences,project:project.project_id,clientId:project.client_id,
      projectScopes:project.project_scopes,protocolScopes:project.protocol_scopes,authorizationVersion:project.authorization_version}
  }
  async refresh() {
    assert(this.#tokens && this.#client && this.#discovery)
    const response = await this.request(this.#discovery.token_endpoint, form({grant_type: 'refresh_token', client_id: this.#client.client_id,
      refresh_token: this.#tokens.refresh_token, resource: this.#resource}))
    if (response.ok) this.#tokens = await response.json()
    else await response.body?.cancel()
    return response.status
  }
  async rpc(session, method, params, id) {
    assert(this.#tokens?.access_token)
    const response = await this.request('/api/v1/main/mcp/default', {method: 'POST', headers: {
      Authorization: `Bearer ${this.#tokens.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      ...(session ? {'Mcp-Session-Id': session, 'MCP-Protocol-Version': '2025-06-18'} : {}),
    }, body: JSON.stringify({jsonrpc: '2.0', ...(id === undefined ? {} : {id}), method, ...(params ? {params} : {})})}, false)
    const nextSession = response.headers.get('mcp-session-id') ?? session
    if (id === undefined || response.status !== 200) { await response.body?.cancel(); return {status: response.status, session: nextSession} }
    if (!response.headers.get('content-type')?.includes('text/event-stream')) return {status: 200, session: nextSession, message: await response.json()}
    const reader = response.body.getReader(), decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const {done, value} = await reader.read()
        if (done) throw new Error('SSE ended without a matching JSON-RPC response')
        buffer += decoder.decode(value, {stream: true})
        buffer = buffer.replaceAll('\r\n', '\n')
        let split
        while ((split = buffer.indexOf('\n\n')) >= 0) {
          const event = buffer.slice(0, split); buffer = buffer.slice(split + 2)
          const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
          if (data) { const message = JSON.parse(data); if (message.id === id) return {status: 200, session: nextSession, message} }
        }
        assert(buffer.length < 16 * 1024 * 1024, 'SSE response exceeded evidence limit')
      }
    } finally { await reader.cancel() }
  }
}
