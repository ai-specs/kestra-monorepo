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
  sessionTimingEvidence() {
    const jwt=this.#cookies.get('JWT');let claims={},jwtMetadataMalformed=false
    try{claims=jwt?JSON.parse(Buffer.from(jwt.split('.')[1],'base64url').toString('utf8')):{}}catch{jwtMetadataMalformed=true}
    const csrfCookies=[...this.#cookies].filter(([name])=>/csrf|xsrf/i.test(name))
    return {observedAt:new Date().toISOString(),jwtPresent:Boolean(jwt),jwtMetadataMalformed,jwtIssuedAt:Number.isFinite(claims.iat)?claims.iat:null,jwtExpiresAt:Number.isFinite(claims.exp)?claims.exp:null,jwtSha256:jwt?createHash('sha256').update(jwt).digest('hex'):null,csrfPresent:Boolean(this.#csrf),csrfSha256:this.#csrf?createHash('sha256').update(this.#csrf).digest('hex'):null,csrfCookies:csrfCookies.map(([name,value])=>({name,sha256:createHash('sha256').update(value).digest('hex'),matchesHeader:value===this.#csrf}))}
  }
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
  async changeTemporaryPassword(username, temporaryPassword, newPassword) {
    assert(!this.#cookies.has('JWT'),'Temporary-password preparation requires a new unauthenticated client')
    assert(typeof temporaryPassword==='string'&&temporaryPassword.length>0,'Host-generated temporary password required')
    assert(typeof newPassword==='string'&&newPassword.length>=8&&newPassword!==temporaryPassword,'A distinct new password is required')
    const started=await this.request('/oidc/login',form({username,password:temporaryPassword,from:'/oauth/login/kestra'}))
    assert.equal(started.status,303,'Temporary credentials must enter the restricted password-change flow')
    const target=new URL(started.headers.get('location'),this.#base)
    assert.equal(target.origin,this.#base);assert.equal(target.pathname,'/oidc/password')
    assert(!this.#cookies.has('JWT')&&!this.#cookies.has('oidc_session'),'Temporary credentials created a normal session')
    const page=await this.request(target)
    assert.equal(page.status,200,'Production password-change page is unavailable')
    const csrf=(await page.text()).match(/name="csrf"[^>]*value="([A-Za-z0-9_-]+)"/)?.[1]
    assert(csrf,'Restricted password-change form has no CSRF value')
    const before=await this.request('/api/v1/configs',{headers:{Accept:'application/json'}})
    assert([401,403].includes(before.status),'Temporary identity obtained business access before password change')
    await before.body?.cancel()
    const changed=await this.request('/oidc/password',{...form({csrf,password:newPassword,confirmation:newPassword}),headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:this.#base}})
    assert.equal(changed.status,303,'Production forced password change failed')
    const destination=new URL(changed.headers.get('location'),this.#base)
    assert.equal(destination.origin,this.#base);assert.equal(destination.pathname,'/oidc/login')
    assert(!this.#cookies.has('oidc_password_change'),'Restricted password-change cookie was not cleared')
    const login=await this.login(username,newPassword)
    return {transport:'http-form',passwordChanged:true,businessBeforeChange:before.status,login}
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
  async verifyConfidentialRotation({clientId,redirectUri,oldSecret,newSecret}) {
    assert(typeof clientId==='string'&&clientId&&clientId!=='kestra-ui')
    assert(typeof oldSecret==='string'&&oldSecret&&typeof newSecret==='string'&&newSecret&&oldSecret!==newSecret)
    const discovery=await this.discover()
    const verifier=randomBytes(48).toString('base64url'),state=randomBytes(20).toString('hex'),nonce=randomBytes(20).toString('hex')
    const query=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:'code',scope:'openid',state,nonce,
      code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'})
    let authorization=await this.request('/oidc/authorize?'+query)
    assert.equal(authorization.status,200,'Ordinary confidential client must reach production owner consent')
    const interaction=(await authorization.text()).match(/name="interaction" value="([^"]+)"/)?.[1]
    assert(interaction,'Production confidential client consent interaction missing')
    authorization=await this.request('/oidc/consent',{...form({interaction,decision:'approve','scope-openid':'yes'}),headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:this.#base}})
    assert.equal(authorization.status,303)
    const callback=new URL(authorization.headers.get('location'))
    assert.equal(callback.origin+callback.pathname,redirectUri);assert.equal(callback.searchParams.get('state'),state)
    const code=callback.searchParams.get('code');assert(code&&!callback.searchParams.has('error'))
    const exchange=secret=>this.request(discovery.token_endpoint,form({grant_type:'authorization_code',client_id:clientId,client_secret:secret,
      redirect_uri:redirectUri,code,code_verifier:verifier}))
    const old=await exchange(oldSecret)
    assert.equal(old.status,401,'Old confidential secret was not rejected')
    assert.equal((await old.json()).error,'invalid_client','Infrastructure failure is not proof of secret revocation')
    const accepted=await exchange(newSecret)
    assert.equal(accepted.status,200,'New confidential secret failed the production code exchange')
    const tokens=await accepted.json()
    assert(tokens.access_token&&tokens.id_token,'Production exchange omitted signed access or ID token')
    const keysResponse=await this.request(discovery.jwks_uri)
    assert.equal(keysResponse.status,200)
    const keys=(await keysResponse.json()).keys
    for(const [kind,token]of [['access',tokens.access_token],['id',tokens.id_token]]) {
      const segments=token.split('.');assert.equal(segments.length,3)
      const header=JSON.parse(Buffer.from(segments[0],'base64url').toString('utf8'))
      assert.equal(header.alg,'RS256')
      const matching=keys.filter(key=>key.kid===header.kid&&key.kty==='RSA');assert.equal(matching.length,1)
      assert(verify('RSA-SHA256',Buffer.from(segments[0]+'.'+segments[1]),createPublicKey({key:matching[0],format:'jwk'}),Buffer.from(segments[2],'base64url')),'Confidential exchange signature did not verify')
      const claims=JSON.parse(Buffer.from(segments[1],'base64url').toString('utf8'))
      assert.equal(claims.iss,this.#base);assert.deepEqual(Array.isArray(claims.aud)?claims.aud:[claims.aud],[clientId])
      assert(claims.exp>Date.now()/1000)
      if(kind==='id')assert.equal(claims.nonce,nonce)
    }
    return {transport:'production-oidc',newSecretAccepted:true,oldSecretAccepted:false,oldStatus:old.status,newStatus:accepted.status,signedTokensVerified:true,resourceRequested:false}
  }
  async probeCurrentIdpSession() {
    const verifier=randomBytes(48).toString('base64url'),state=randomBytes(20).toString('hex')
    const redirectUri=this.#base+'/oauth/callback/kestra'
    const query=new URLSearchParams({client_id:'kestra-ui',redirect_uri:redirectUri,response_type:'code',scope:'openid',state,
      code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'})
    const response=await this.request('/oidc/authorize?'+query)
    const location=response.headers.get('location')
    assert(redirects.has(response.status)&&location,'IdP session observation must reach a precise production redirect')
    const target=new URL(location,this.#base)
    assert.equal(target.origin,this.#base)
    await response.body?.cancel()
    if(target.pathname==='/oidc/login')return {source:'production-authorize-existing-idp-cookie',authenticated:false,status:response.status,passwordRequired:true,codeIssued:false}
    assert.equal(target.origin+target.pathname,redirectUri,'Unexpected IdP session observation destination')
    assert.equal(target.searchParams.get('state'),state)
    assert(target.searchParams.get('code')&&!target.searchParams.has('error'),'Existing IdP session did not produce a normal authorization code')
    return {source:'production-authorize-existing-idp-cookie',authenticated:true,status:response.status,passwordRequired:false,codeIssued:true}
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
    // Registration establishes a pending public client, rather than approving a applicationGroup membership.
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
        scope: 'openid mcp:flows:read mcp:executions:write', client_name: 'Application group acceptance',
      })})
      assert.equal(registration.status, 201)
      this.#client = await registration.json()
    }
    assert(!this.#client.client_secret, 'Public client must not receive a secret')
    if (!registeredClient) {
      assert(typeof approveClient === 'function', '应用支持范围必须在 owner consent 前通过生产管理操作登记')
      await approveClient({clientId: this.#client.client_id, audiences: [this.#resource], scopes: [...scopes]})
    }
    assert(typeof reauthenticate === 'function', '应用组登记变更后必须重新取得生产登录身份')
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
  async verifiedAccessIdentity({applicationGroupClaim = "kestra_application_group_v1", applicationGroupId, subject, expectedApplicationGroupScopes, expectedProtocolScopes}) {
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
    assert(applicationGroupClaim && Object.hasOwn(claims, applicationGroupClaim), 'Use the documented published application-group claim name')
    const applicationGroup = claims[applicationGroupClaim]
    assert(applicationGroup && typeof applicationGroup === 'object' && !Array.isArray(applicationGroup), 'Signed application-group claim must use the published envelope')
    assert.equal(applicationGroup.application_group_id, applicationGroupId)
    assert.equal(applicationGroup.client_id, this.#client.client_id)
    assert(Number.isSafeInteger(applicationGroup.authorization_version) && applicationGroup.authorization_version > 0)
    for (const name of ['application_group_scopes', 'protocol_scopes']) {
      assert(Array.isArray(applicationGroup[name]) && applicationGroup[name].every(value => typeof value === 'string' && value.length))
      assert.equal(new Set(applicationGroup[name]).size, applicationGroup[name].length, 'Signed scope classification contains duplicates')
    }
    assert(!applicationGroup.application_group_scopes.some(value => applicationGroup.protocol_scopes.includes(value)), 'Application-group and protocol scopes overlap')
    const scopes = typeof claims.scope === 'string' ? claims.scope.split(' ').filter(Boolean) : claims.scope
    assert(Array.isArray(scopes), 'Signed access token scope missing')
    assert.deepEqual([...scopes].sort(), [...applicationGroup.application_group_scopes, ...applicationGroup.protocol_scopes].sort(), 'Signed application-group claim differs from issued scopes')
    if (expectedApplicationGroupScopes !== undefined) assert.deepEqual([...applicationGroup.application_group_scopes].sort(), [...expectedApplicationGroupScopes].sort())
    if (expectedProtocolScopes !== undefined) assert.deepEqual([...applicationGroup.protocol_scopes].sort(), [...expectedProtocolScopes].sort())
    return {subject: claims.sub, issuer: claims.iss, audiences, applicationGroupId: applicationGroup.application_group_id,
      clientId: applicationGroup.client_id, authorizationVersion: applicationGroup.authorization_version,
      applicationGroupScopes: applicationGroup.application_group_scopes, protocolScopes: applicationGroup.protocol_scopes, scopes}
  }
  async expectMcpAuthorizationDenied(scopes) {
    assert(this.#client&&this.#discovery,'Previously registered ordinary application required')
    const state=randomBytes(20).toString('hex'),verifier=randomBytes(48).toString('base64url')
    const response=await this.request('/oidc/authorize?'+new URLSearchParams({client_id:this.#client.client_id,
      redirect_uri:this.#client.redirect_uris[0],response_type:'code',scope:scopes.join(' '),state,resource:this.#resource,
      code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}))
    if(response.status===400) {
      const body=await response.json();assert.equal(body.error,'invalid_scope');assert(!body.code)
      return {status:400,error:'invalid_scope',codeIssued:false,stateVerified:false,registeredClientValidated:true}
    }
    assert([302,303,307].includes(response.status),'Missing provider must return an explicit protocol rejection')
    const callback=new URL(response.headers.get('location'))
    assert.equal(callback.origin+callback.pathname,this.#client.redirect_uris[0]);assert.equal(callback.searchParams.get('state'),state)
    assert.equal(callback.searchParams.get('error'),'invalid_scope');assert(!callback.searchParams.has('code'))
    await response.body?.cancel()
    return {status:response.status,error:'invalid_scope',codeIssued:false,stateVerified:true}
  }
  async verifiedUiIdentity({applicationGroupId, subject, audience, applicationGroupClaim = 'kestra_application_group_v1'}) {
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
    const applicationGroup = claims[applicationGroupClaim]
    assert(applicationGroup && typeof applicationGroup === 'object' && !Array.isArray(applicationGroup))
    assert.equal(applicationGroup.application_group_id,applicationGroupId)
    assert.equal(applicationGroup.client_id,audience)
    assert(Number.isSafeInteger(applicationGroup.authorization_version) && applicationGroup.authorization_version > 0)
    for (const field of ['application_group_scopes','protocol_scopes']) {
      assert(Array.isArray(applicationGroup[field]) && applicationGroup[field].every(value => typeof value === 'string' && value.length))
      assert.equal(new Set(applicationGroup[field]).size,applicationGroup[field].length)
    }
    assert(!applicationGroup.application_group_scopes.some(scope => applicationGroup.protocol_scopes.includes(scope)))
    return {subject:claims.sub,issuer:claims.iss,audiences,applicationGroupId:applicationGroup.application_group_id,clientId:applicationGroup.client_id,
      applicationGroupScopes:applicationGroup.application_group_scopes,protocolScopes:applicationGroup.protocol_scopes,authorizationVersion:applicationGroup.authorization_version}
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
