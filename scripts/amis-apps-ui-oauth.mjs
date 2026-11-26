import {randomBytes, createHash, createPublicKey, verify} from 'node:crypto'
import {productionStreamingRequest} from './production-streaming-request.mjs'

const scopes = 'openid profile email kestra:application-group-scopes'
const check = (condition, message) => { if (!condition) throw new Error(message) }
const readJSON = async response => { try { return await response.json() } catch { throw new Error('Invalid OAuth JSON response') } }
const apiPath = /^\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\/[A-Za-z0-9][A-Za-z0-9._-]*\/apis\/[A-Za-z0-9_][A-Za-z0-9_-]{0,99}(?:\/executions\/[A-Za-z0-9_][A-Za-z0-9_-]{0,99})?$/

// Tokens and client secret remain in this closure. The injected transport is only
// for offline tests; the default uses real same-origin HTTP without cookies.
export async function createAmisUiOAuth({base, client, clientSecret, namespace, flowId, expectedSubject, groupId, expectedScopeKeys, callerAbortSignal, transport = fetch}) {
  const parsedBase = new URL(base)
  check(['http:', 'https:'].includes(parsedBase.protocol) && !parsedBase.username && !parsedBase.password && !parsedBase.search && !parsedBase.hash && parsedBase.pathname === '/', 'Invalid instance base')
  const origin = parsedBase.origin
  check(typeof clientSecret === 'string' && clientSecret.length > 0, 'UI client secret required')
  check(typeof namespace === 'string' && namespace.length <= 150 && /^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*$/.test(namespace) && typeof flowId === 'string' && flowId.length <= 100 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(flowId), 'Explicit Flow required')
  check(typeof expectedSubject === 'string' && expectedSubject.length > 0 && groupId === 'main', 'Explicit actor and main group required')
  check(Array.isArray(expectedScopeKeys) && expectedScopeKeys.every(x => typeof x === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(x)) && new Set(expectedScopeKeys).size === expectedScopeKeys.length, 'Explicit expected scope keys required')
  const expectedScopes = [...expectedScopeKeys].sort()
  async function bounded(requester, url, options = {}, parse = true) {
    const controller = new AbortController()
    const parents = [callerAbortSignal, options.signal].filter(Boolean)
    const abort = () => controller.abort()
    let timer, rejectAbort
    const aborted = new Promise((resolve, reject) => { rejectAbort = () => reject(new Error('OAuth request aborted or timed out')); controller.signal.addEventListener('abort', rejectAbort, {once: true}) })
    try {
      for (const parent of parents) { parent.addEventListener('abort', abort, {once: true}); if (parent.aborted) abort() }
      timer = setTimeout(abort, 30_000)
      if (controller.signal.aborted) return await aborted
      return await Promise.race([aborted, (async () => {
        const response = await requester(url, {...options, signal: controller.signal})
        if (!parse) return response
        const body = response.status === 200 || response.headers?.get('content-type')?.includes('application/json') ? await readJSON(response) : null
        return {status: response.status, headers: response.headers, json: async () => body}
      })()])
    } catch { throw new Error('OAuth request failed, aborted or timed out') }
    finally { clearTimeout(timer); for (const parent of parents) parent.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', rejectAbort) }
  }
  const redirectUri = origin + '/oauth/callback/kestra'
  const discoveryResponse = await bounded(client.request.bind(client), '/.well-known/openid-configuration', {redirect: 'manual'})
  check(discoveryResponse.status === 200, 'Discovery unavailable')
  const discovery = await readJSON(discoveryResponse)
  check(discovery.issuer === origin, 'Discovery issuer mismatch')
  for (const [field, path] of [['authorization_endpoint', '/oidc/authorize'], ['token_endpoint', '/oidc/token'], ['jwks_uri', '/oidc/jwks']])
    check(discovery[field] === origin + path, 'Unexpected discovery endpoint')
  const verifier = randomBytes(48).toString('base64url'), state = randomBytes(32).toString('base64url'), nonce = randomBytes(32).toString('base64url')
  const query = new URLSearchParams({client_id: 'kestra-ui', redirect_uri: redirectUri, response_type: 'code', scope: scopes, state, nonce,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256'})
  let authorization = await bounded(client.request.bind(client), '/oidc/authorize?' + query, {redirect: 'manual'}, false)
  let explicitConsent = false
  if (authorization.status === 200) {
    const html = await authorization.text()
    const interactions = [...html.matchAll(/name="interaction" value="([A-Za-z0-9_-]+)"/g)]
    check(interactions.length === 1, 'Production consent interaction missing or duplicated')
    authorization = await bounded(client.request.bind(client), '/oidc/consent', {method: 'POST', redirect: 'manual',
      headers: {'Content-Type': 'application/x-www-form-urlencoded', Origin: origin},
      body: new URLSearchParams({interaction: interactions[0][1], decision: 'approve',
        ...Object.fromEntries(scopes.split(' ').map(scope => ['scope-' + scope, 'yes']))})}, false)
    explicitConsent = true
    check(authorization.status === 303, 'Explicit owner consent did not issue a callback')
  }
  check([302, 303, 307].includes(authorization.status), 'UI authorization did not produce a valid callback: HTTP ' + authorization.status)
  let callback
  try { callback = new URL(authorization.headers.get('location'), origin) } catch { throw new Error('Invalid authorization callback') }
  check(callback.origin + callback.pathname === redirectUri && !callback.hash && !callback.username && !callback.password, 'Authorization callback mismatch')
  check(callback.searchParams.getAll('state').length === 1 && callback.searchParams.get('state') === state, 'Authorization state mismatch')
  check(!callback.searchParams.has('error') && callback.searchParams.getAll('code').length === 1 && callback.searchParams.get('code'), 'Authorization code missing')
  const code = callback.searchParams.get('code')
  async function postToken(values) {
    try { return await bounded(transport, origin + '/oidc/token', {method: 'POST', redirect: 'manual', credentials: 'omit', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({client_id: 'kestra-ui', client_secret: clientSecret, ...values})}) }
    catch { throw new Error('Token transport failed') }
  }
  async function validate(tokens, expectedNonce) {
    check(tokens && tokens.token_type?.toLowerCase() === 'bearer' && typeof tokens.refresh_token === 'string' && tokens.refresh_token.length > 0, 'Incomplete token response')
    let response
    try { response = await bounded(transport, discovery.jwks_uri, {redirect: 'manual', credentials: 'omit'}) }
    catch { throw new Error('JWKS transport failed') }
    check(response.status === 200, 'JWKS unavailable')
    const jwks = await readJSON(response)
    const project = (token, kind) => {
      try {
        const parts = token.split('.'); check(parts.length === 3, 'Invalid JWT')
        const header = JSON.parse(Buffer.from(parts[0], 'base64url'))
        check(header.alg === 'RS256' && typeof header.kid === 'string', 'Unsupported JWT header')
        const keys = jwks.keys.filter(key => key.kid === header.kid && key.kty === 'RSA' && (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig'))
        check(keys.length === 1, 'Ambiguous JWT signing key')
        check(verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), createPublicKey({key: keys[0], format: 'jwk'}), Buffer.from(parts[2], 'base64url')), 'Invalid JWT signature')
        const claims = JSON.parse(Buffer.from(parts[1], 'base64url'))
        check(claims.iss === origin && typeof claims.sub === 'string' && claims.sub.length > 0, 'JWT identity mismatch')
        const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
        check(audiences.length === 1 && audiences[0] === 'kestra-ui', 'JWT audience mismatch')
        check(Number.isFinite(claims.exp) && claims.exp > Date.now()/1000 && Number.isFinite(claims.iat) && claims.iat <= Date.now()/1000+30, 'JWT time invalid')
        check(claims.nbf === undefined || Number.isFinite(claims.nbf) && claims.nbf <= Date.now()/1000, 'JWT not active')
        // Formal host 4ca uses token_type=access_token; its ID JWT has no token_use field.
        if (kind === 'access') check(claims.token_type === 'access_token', 'Wrong JWT token type')
        const group = claims.kestra_application_group_v1
        check(group && group.client_id === 'kestra-ui' && typeof group.application_group_id === 'string' && group.application_group_id === groupId, 'JWT group missing')
        check(Number.isSafeInteger(group.authorization_version) && group.authorization_version > 0, 'JWT authorization version invalid')
        check(Array.isArray(group.application_group_scopes) && group.application_group_scopes.every(x => typeof x === 'string' && x.length > 0) && new Set(group.application_group_scopes).size === group.application_group_scopes.length, 'JWT scopes invalid')
        check(Array.isArray(group.protocol_scopes) && group.protocol_scopes.every(x => typeof x === 'string' && x.length > 0) && new Set(group.protocol_scopes).size === group.protocol_scopes.length, 'JWT protocol scopes invalid')
        check(!group.application_group_scopes.some(x => group.protocol_scopes.includes(x)), 'JWT scope classes overlap')
        const actualScopes = typeof claims.scope === 'string' ? claims.scope.split(' ').filter(Boolean) : claims.scope
        if (kind === 'access') check(Array.isArray(actualScopes) && JSON.stringify([...actualScopes].sort()) === JSON.stringify([...group.application_group_scopes, ...group.protocol_scopes].sort()), 'JWT scope envelope mismatch')
        return {claims, public: {subject: claims.sub, issuer: claims.iss, exactAudiences: audiences, group: group.application_group_id, scopeKeys: [...group.application_group_scopes].sort(), authVersion: group.authorization_version}}
      } catch (failure) {
        const safe = new Set(['JWT time invalid','JWT not active','Wrong JWT token type','JWT group missing',
          'JWT authorization version invalid','JWT scopes invalid','JWT protocol scopes invalid',
          'JWT scope classes overlap','JWT scope envelope mismatch','ID token nonce mismatch'])
        throw new Error('Signed token validation failed' + (safe.has(failure.message) ? ': ' + failure.message : ''))
      }
    }
    const access = project(tokens.access_token, 'access')
    check(!expectedNonce || typeof tokens.id_token === 'string', 'Initial exchange requires an ID token')
    if (tokens.id_token !== undefined) {
      const id = project(tokens.id_token, 'id')
      check(JSON.stringify(access.public) === JSON.stringify(id.public), 'Token identities disagree')
      if (expectedNonce) check(id.claims.nonce === expectedNonce, 'ID token nonce mismatch')
    }
    return access.public
  }
  const exchange = await postToken({grant_type: 'authorization_code', redirect_uri: redirectUri, code, code_verifier: verifier})
  if (exchange.status !== 200) {
    let failure
    try {failure = await exchange.json()} catch {}
    const known = new Set(['invalid_request','invalid_client','invalid_grant','unauthorized_client','unsupported_grant_type','invalid_scope','server_error','temporarily_unavailable'])
    throw new Error('Authorization code exchange failed: HTTP ' + exchange.status
      + (known.has(failure?.error) ? ' ' + failure.error : ''))
  }
  let tokens = await readJSON(exchange)
  const initial = await validate(tokens, nonce)
  check(initial.subject === expectedSubject && initial.group === groupId && JSON.stringify(initial.scopeKeys) === JSON.stringify(expectedScopes), 'Initial actor or scopes mismatch')
  let current = initial
  let refreshState = {attempted: false, success: false}
  return Object.freeze({
    evidence: () => structuredClone({initial, current, refresh: refreshState, explicitConsent}),
    async refresh() {
      refreshState = {attempted: true, success: false}
      const response = await postToken({grant_type: 'refresh_token', refresh_token: tokens.refresh_token})
      refreshState.status = response.status
      if (response.status !== 200) return {success: false, status: response.status, before: structuredClone(current)}
      const candidate = await readJSON(response)
      check(candidate.refresh_token !== tokens.refresh_token, 'Refresh token did not rotate')
      const after = await validate(candidate)
      check(after.subject === initial.subject && after.group === initial.group, 'Refresh identity changed')
      check(after.scopeKeys.every(key => current.scopeKeys.includes(key)), 'Refresh expanded application scopes')
      const before = current; tokens = candidate; current = after
      refreshState = {attempted: true, success: true, status: 200, rotated: true}
      return structuredClone({success: true, status: 200, rotated: true, before, after})
    },
    async requestAccess(path, options = {}) {
      check(typeof path === 'string' && apiPath.test(path) && path.startsWith(`/${namespace}/${flowId}/apis/`) && !path.split('/').some(x => x === '.' || x === '..'), 'Invalid AMIS API path')
      const polling = path.includes('/executions/')
      check((options.method ?? 'GET') === (polling ? 'GET' : 'POST'), 'Invalid AMIS API method')
      check(!options.credentials || options.credentials === 'omit', 'Cookie credentials forbidden')
      const headers = new Headers(options.headers)
      check(!headers.has('cookie') && !headers.has('authorization'), 'Caller credentials forbidden')
      headers.set('Authorization', 'Bearer ' + tokens.access_token)
      try { return await bounded(transport, origin + path, {...options, headers, redirect: 'manual', credentials: 'omit'}, false) }
      catch { throw new Error('AMIS API transport failed') }
    },
    async requestStreaming(path, {chunks, signal, timeoutMs = 45000} = {}) {
      check(typeof path === 'string' && apiPath.test(path) && path.startsWith(`/${namespace}/${flowId}/apis/`)
        && !path.includes('/executions/') && !path.split('/').some(part => part === '.' || part === '..'), 'Invalid streaming API path')
      check(chunks && typeof chunks[Symbol.asyncIterator] === 'function', 'Explicit asynchronous request chunks required')
      check(Number.isInteger(timeoutMs) && timeoutMs > 30000 && timeoutMs <= 45000, 'Streaming observation deadline must bound the host 30-second limit')
      return productionStreamingRequest(new URL(path, origin), {chunks, signal, timeoutMs,
        headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + tokens.access_token}})
    },
  })
}
