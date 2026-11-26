// Synthetic RSA keys and fake HTTP only. These tests do not prove production OAuth.
import test from 'node:test'
import assert from 'node:assert/strict'
import {generateKeyPairSync, sign, createHash} from 'node:crypto'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {setTimeout as delay} from 'node:timers/promises'
import {createAmisUiOAuth} from '../amis-apps-ui-oauth.mjs'
const origin = 'https://synthetic.example'
const {privateKey, publicKey} = generateKeyPairSync('rsa', {modulusLength: 2048})
const jwk = {...publicKey.export({format: 'jwk'}), kid: 'synthetic', alg: 'RS256', use: 'sig'}
const response = (status, data) => new Response(JSON.stringify(data), {status})
function fixture(config = {}) {
  const origin = config.origin ?? 'https://synthetic.example'
  let nonce, challenge, issue = 0, authorizationState, consentPending = false, consentApproved = false
  const calls = []
  const consentCalls = []
  const jwt = (scopes, id = false) => {
    const header = Buffer.from(JSON.stringify({alg: 'RS256', kid: 'synthetic'})).toString('base64url')
    const payload = Buffer.from(JSON.stringify({iss: origin, sub: id && issue > 1 && config.refreshIdMismatch ? 'different-signed-subject' : config.subject ?? 'actor', aud: 'kestra-ui', iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+300,
      ...(id ? {nonce} : {}), ...config.claims, ...(!id ? {token_type: config.tokenType ?? 'access_token', scope: [...scopes, 'openid', 'profile', 'email'].join(' ')} : {}), kestra_application_group_v1: {client_id: 'kestra-ui', application_group_id: config.group ?? 'main', authorization_version: issue+1, application_group_scopes: scopes, protocol_scopes: ['openid', 'profile', 'email']}})).toString('base64url')
    const input = header + '.' + payload
    return input + '.' + (config.badSignature || config.badRefreshSignature && issue > 1 ? Buffer.from('bad-signature').toString('base64url') : sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url'))
  }
  const client = {
    discover: async () => ({issuer: origin, authorization_endpoint: origin+'/oidc/authorize', token_endpoint: origin+'/oidc/token', jwks_uri: origin+'/oidc/jwks'}),
    request: async (path, options) => {
      assert(options.signal instanceof AbortSignal)
      if (config.hangAt === path.split('?')[0]) { config.onHang?.(); return new Promise(() => {}) }
      if (path === '/.well-known/openid-configuration') return response(200, await client.discover())
      if (path === '/oidc/consent') {
        assert(config.explicitConsent && consentPending && !consentApproved, 'Exactly one pending consent interaction required')
        assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'manual')
        assert.equal(options.headers.Origin, origin)
        assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded')
        const form = options.body
        assert(form instanceof URLSearchParams)
        assert.deepEqual([...form.keys()].sort(), ['interaction','decision','scope-openid','scope-profile','scope-email','scope-kestra:application-group-scopes'].sort())
        assert.equal(form.get('interaction'), 'private-interaction')
        assert.equal(form.get('decision'), 'approve')
        for (const scope of ['openid','profile','email','kestra:application-group-scopes']) assert.equal(form.get('scope-'+scope), 'yes')
        consentCalls.push({path,method:options.method,origin:options.headers.Origin,approvedScopes:[...form.keys()].filter(key=>key.startsWith('scope-'))})
        consentApproved = true; consentPending = false
        const callback = (config.consentForeign ? 'https://outside.invalid' : origin)
          + (config.consentWrongPath ? '/other-callback' : '/oauth/callback/kestra')
          + '?state=' + (config.consentBadState ? 'wrong' : authorizationState)
          + (config.consentMissingCode ? '' : '&code=private-code')
        return new Response(null, {status:config.consentStatus ?? 303,headers:config.consentNoLocation?{}:{location:callback}})
      }
      const query = new URL(path, origin).searchParams
      nonce = query.get('nonce'); challenge = query.get('code_challenge')
      assert.equal(query.get('scope'), 'openid profile email kestra:application-group-scopes')
      assert.equal(query.get('client_id'), 'kestra-ui')
      assert.equal(query.get('code_challenge_method'), 'S256')
      authorizationState = query.get('state')
      if (config.explicitConsent) {
        consentPending = true
        const interaction = '<input type="hidden" name="interaction" value="private-interaction">'
        return new Response(config.consentMissingInteraction ? '<html>consent without interaction</html>'
          : config.consentDuplicateInteraction ? interaction + interaction : '<form>' + interaction + '</form>',
          {status:200,headers:{'Content-Type':'text/html'}})
      }
      if (config.consent) return response(200, {})
      return new Response(null, {status: config.directStatus ?? 302, headers: {location: (config.foreign ? 'https://foreign.example' : origin)+(config.loginRedirect ? '/oidc/login' : config.wrongCallback ? '/wrong' : '/oauth/callback/kestra')+'?state='+ (config.badState ? 'wrong' : query.get('state'))+'&code=private-code'}})
    },
  }
  const transport = async (url, options = {}) => {
    calls.push({url, options})
    assert(options.signal instanceof AbortSignal)
    if (config.hangAt && url.endsWith(config.hangAt)) { config.onHang?.(); return new Promise(() => {}) }
    if (url.endsWith('/jwks')) return response(200, {keys: [jwk]})
    if (url.endsWith('/token')) {
      if (config.explicitConsent) assert(consentApproved, 'No code exchange before explicit consent approval')
      const form = options.body
      assert.equal(form.get('client_secret'), 'private-secret')
      assert.equal(options.redirect, 'manual'); assert.equal(options.credentials, 'omit')
      if (form.get('grant_type') === 'authorization_code') assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), challenge)
      else if (config.refresh400) return response(400, {error: 'invalid_grant'})
      const scopes = issue++ === 0 ? config.initialScopes ?? ['entry', 'execute'] : ['entry']
      const omitId = issue === 1 ? config.initialNoId : config.refreshNoId
      return response(200, {token_type: 'Bearer', access_token: jwt(scopes), ...(omitId ? {} : {id_token: jwt(scopes, true)}), refresh_token: config.sameRefresh ? 'private-refresh' : 'private-refresh-'+issue})
    }
    return response(200, {ok: true})
  }
  return {client, transport, calls, consentCalls, create: (overrides = {}) => createAmisUiOAuth({base: origin, client, clientSecret: 'private-secret', namespace: 'company.amis', flowId: 'acceptance', expectedSubject: 'actor', groupId: 'main', expectedScopeKeys: ['execute', 'entry'], transport, ...overrides})}
}
test('synthetic signed code PKCE and rotated refresh project revoked scopes without secrets', async () => {
  const f = fixture(), session = await f.create()
  const result = await session.refresh()
  assert.equal(result.success, true); assert.deepEqual(result.before.scopeKeys, ['entry', 'execute']); assert.deepEqual(result.after.scopeKeys, ['entry'])
  assert(!/private|token|secret|code=/.test(JSON.stringify({result, evidence: session.evidence(), session})))
  await session.requestAccess('/company.amis/acceptance/apis/run', {method: 'POST'})
  const request = f.calls.at(-1)
  assert(request.options.headers.get('Authorization').startsWith('Bearer ')); assert.equal(request.options.headers.get('cookie'), null)
})
for (const [name, config] of [['state', {badState: true}], ['callback', {wrongCallback: true}], ['foreign', {foreign: true}], ['consent', {consent: true}], ['signature', {badSignature: true}]])
  test('reject synthetic '+name, async () => { await assert.rejects(fixture(config).create()) })
test('refresh400 retains previous credentials and reports failure', async () => {
  const f = fixture({refresh400: true}), session = await f.create(), before = session.evidence()
  assert.equal((await session.refresh()).success, false); assert.deepEqual(session.evidence().current, before.current); assert.equal(session.evidence().refresh.success, false)
  await session.requestAccess('/company.amis/acceptance/apis/run/executions/abc')
})
test('unchanged refresh is rejected and never installed', async () => {
  const f = fixture({sameRefresh: true}), session = await f.create(), before = session.evidence()
  await assert.rejects(session.refresh(), /did not rotate/); assert.deepEqual(session.evidence().current, before.current); assert.equal(session.evidence().refresh.success, false)
})
test('invalid signed refresh retains old tokens and exposes no raw token error', async () => {
  const f = fixture({badRefreshSignature: true}), session = await f.create(), before = session.evidence()
  await assert.rejects(session.refresh(), error => error.message === 'Signed token validation failed')
  assert.deepEqual(session.evidence().current, before.current); assert.equal(session.evidence().refresh.success, false)
})
test('reject foreign, management, other Flow and cookie API requests before transport', async () => {
  const f = fixture(), session = await f.create(), before = f.calls.length
  for (const path of ['https://foreign.example/company.amis/acceptance/apis/run', '/api/v1/main/extensions/rbac/users', '/company.amis/other/apis/run', '/company.amis/acceptance/apis/run?x=1']) await assert.rejects(session.requestAccess(path, {method: 'POST'}))
  await assert.rejects(session.requestAccess('/company.amis/acceptance/apis/run', {method: 'POST', headers: {cookie: 'private'}}))
  assert.equal(f.calls.length, before)
})
for (const [name, config] of [
  ['wrong subject', {subject: 'old-admin'}], ['wrong group', {group: 'other'}],
  ['missing scope', {initialScopes: ['entry']}], ['excess permission', {initialScopes: ['entry', 'execute', 'admin']}],
  ['wrong access token type', {tokenType: 'id_token'}], ['invalid nbf', {claims: {nbf: '0'}}],
  ['nonfinite exp', {claims: {exp: Infinity}}], ['nonfinite iat', {claims: {iat: Infinity}}],
]) test('reject signed synthetic '+name, async () => { await assert.rejects(fixture(config).create()) })
test('expected actor, main group and exact scope expectations are required', async () => {
  for (const overrides of [{expectedSubject: undefined}, {groupId: undefined}, {groupId: 'other'}, {expectedScopeKeys: undefined}, {expectedScopeKeys: ['entry', 'entry']}])
    await assert.rejects(fixture().create(overrides))
})
test('underscore API and execution identifiers are accepted; invalid bounds and raw paths rejected', async () => {
  const session = await fixture().create()
  await session.requestAccess('/company.amis/acceptance/apis/_run', {method: 'POST'})
  await session.requestAccess('/company.amis/acceptance/apis/_run/executions/_id')
  for (const path of ['/company.amis/acceptance/apis/_run#x', '/company.amis/acceptance/apis/%5Frun', '/company.amis/acceptance/apis/'+ 'a'.repeat(101), '/company.amis/acceptance/apis/_run/executions/'+ 'e'.repeat(101)])
    await assert.rejects(session.requestAccess(path, {method: 'POST'}))
  for (const overrides of [{namespace: 'Company.amis'}, {namespace: 'a'.repeat(151)}, {flowId: 'a'.repeat(101)}, {flowId: '_flow'}])
    await assert.rejects(fixture().create(overrides))
})
for (const path of ['/.well-known/openid-configuration', '/oidc/authorize', '/oidc/token', '/oidc/jwks'])
  test('caller abort bounds synthetic hung '+path, async () => {
    const controller = new AbortController()
    const f = fixture({hangAt: path, onHang: () => queueMicrotask(() => controller.abort('private-caller-reason'))})
    await assert.rejects(f.create({callerAbortSignal: controller.signal}), error => /failed|aborted|timed out/.test(error.message) && !error.message.includes('private'))
  })
test('30 second ceiling rejects transport which ignores cancellation', async t => {
  t.mock.timers.enable({apis: ['setTimeout']})
  let hung = false
  const f = fixture({hangAt: '/oidc/token', onHang: () => { hung = true }})
  const outcome = assert.rejects(f.create(), /Token transport failed/)
  for (let i = 0; !hung && i < 100; i++) await new Promise(resolve => setImmediate(resolve))
  assert(hung)
  t.mock.timers.tick(30_000)
  await outcome
  t.mock.timers.reset()
})

test('stateful explicit owner consent approves exactly four scopes before PKCE exchange and signed refresh', async () => {
  const f = fixture({explicitConsent:true})
  const session = await f.create()
  assert.equal(f.consentCalls.length,1)
  assert.equal(f.consentCalls[0].origin,origin)
  assert.equal(f.consentCalls[0].approvedScopes.length,4)
  assert.equal(session.evidence().explicitConsent,true)
  assert.deepEqual(session.evidence().initial.scopeKeys,['entry','execute'])
  assert.equal((await session.refresh()).success,true)
  assert.deepEqual(session.evidence().current.scopeKeys,['entry'])
  assert(!/private-interaction|private-code|private-secret|private-refresh/.test(JSON.stringify(session.evidence())))
})

for (const [name,config] of [
  ['duplicate interaction',{consentDuplicateInteraction:true}],
  ['missing interaction',{consentMissingInteraction:true}],
  ['302 instead of required 303',{consentStatus:302}],
  ['307 instead of required 303',{consentStatus:307}],
  ['500 consent failure',{consentStatus:500}],
  ['foreign callback',{consentForeign:true}],
  ['wrong callback path',{consentWrongPath:true}],
  ['wrong callback state',{consentBadState:true}],
  ['missing callback Location',{consentNoLocation:true}],
  ['missing code',{consentMissingCode:true}],
]) test('explicit consent rejects '+name+' without token exchange',async()=>{
  const f=fixture({explicitConsent:true,...config})
  await assert.rejects(f.create())
  assert.equal(f.calls.filter(call=>call.url.endsWith('/token')).length,0)
  assert.equal(f.consentCalls.length,config.consentDuplicateInteraction||config.consentMissingInteraction?0:1)
})

test('explicit consent does not weaken signed JWT verification',async()=>{
  const f=fixture({explicitConsent:true,badSignature:true})
  await assert.rejects(f.create(),/Signed token validation failed/)
  assert.equal(f.consentCalls.length,1)
})

test('legacy 200 empty JSON consent remains invalid and cannot approve any scopes',async()=>{
  const f=fixture({consent:true})
  await assert.rejects(f.create(),/interaction missing or duplicated/)
  assert.equal(f.consentCalls.length,0)
  assert.equal(f.calls.length,0)
})

test('direct native 307 callback retains exact state, PKCE, nonce and signed JWT validation', async () => {
  const f=fixture({directStatus:307})
  const session=await f.create()
  assert.equal(f.consentCalls.length,0)
  assert.equal(session.evidence().explicitConsent,false)
  assert.deepEqual(session.evidence().initial.scopeKeys,['entry','execute'])
  assert.equal(f.calls.filter(call=>call.url.endsWith('/token')).length,1)
  assert.equal((await session.refresh()).success,true)
  assert(!/private-code|private-secret|private-refresh/.test(JSON.stringify(session.evidence())))
})

for(const [name,config] of [
  ['login redirect',{loginRedirect:true}],
  ['foreign origin',{foreign:true}],
  ['wrong state',{badState:true}],
]) test('direct 307 rejects '+name+' before token exchange',async()=>{
  const f=fixture({directStatus:307,...config})
  await assert.rejects(f.create())
  assert.equal(f.calls.length,0)
  assert.equal(f.consentCalls.length,0)
})

async function loopback(t, handler) {
  const sockets=new Set(),observedErrors=[]
  const server=createServer((request,response)=>{
    request.on('error',()=>{})
    Promise.resolve(handler(request,response)).catch(error=>{
      observedErrors.push(error);response.destroy()
    })
  })
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(async()=>{
    for(const socket of sockets)socket.destroy()
    await new Promise((accept,reject)=>server.close(error=>error?reject(error):accept()))
    assert.deepEqual(observedErrors,[])
  })
  const origin='http://127.0.0.1:'+server.address().port
  const f=fixture({origin}),session=await f.create()
  return {session,origin,sockets}
}

function deferred() {
  let resolve
  const promise=new Promise(accept=>{resolve=accept})
  return {promise,resolve}
}
async function bounded(promise) {
  const abort=new AbortController()
  try{return await Promise.race([promise,delay(2000,null,{signal:abort.signal}).then(()=>{throw new Error('Synthetic loopback deadline exceeded')})])}
  finally{abort.abort()}
}
function checkStreamingIdentity(request) {
  assert.equal(request.method,'POST')
  assert.equal(request.headers.cookie,undefined)
  assert.equal(request.headers['content-type'],'application/json')
  assert.equal(request.headers['transfer-encoding'],'chunked')
  assert.equal(request.headers['content-length'],undefined)
  assert.match(request.headers.authorization??'',/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
}

test('Node loopback streaming sends closure Bearer without Cookie and preserves JSON chunks',async t=>{
  const received=deferred()
  const {session}=await loopback(t,async(request,response)=>{
    checkStreamingIdentity(request)
    assert.equal(request.url,'/company.amis/acceptance/apis/run')
    const chunks=[];for await(const chunk of request)chunks.push(chunk)
    const body=Buffer.concat(chunks).toString('utf8')
    assert.deepEqual(JSON.parse(body),{name:'loopback-value'})
    received.resolve(body)
    response.writeHead(200,{'Content-Type':'application/json'});response.end('{"received":true}')
  })
  async function* chunks(){yield '{"name":';yield Buffer.from('"loopback-value"');yield new Uint8Array(Buffer.from('}'))}
  const response=await bounded(session.requestStreaming('/company.amis/acceptance/apis/run',{chunks:chunks()}))
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{received:true})
  assert.equal(await bounded(received.promise),'{"name":"loopback-value"}')
})

test('Node loopback caller abort cancels a live streaming upload and closes its socket',async t=>{
  const started=deferred(),closed=deferred(),release=deferred()
  const {session}=await loopback(t,async(request)=>{
    checkStreamingIdentity(request)
    request.socket.once('close',closed.resolve)
    request.once('data',()=>started.resolve())
  })
  async function* chunks(){yield '{"name":"';await release.promise;yield 'later"}'}
  const signal=new AbortController()
  const result=session.requestStreaming('/company.amis/acceptance/apis/run',{chunks:chunks(),signal:signal.signal})
  const rejected=assert.rejects(result,error=>{
    assert.equal(error.name,'AbortError')
    assert(!/Bearer|eyJ|private-secret|private-refresh/.test(JSON.stringify({name:error.name,message:error.message})))
    return true
  })
  try{await bounded(started.promise);signal.abort('private-caller-reason');await bounded(rejected);await bounded(closed.promise)}
  finally{release.resolve()}
})

test('Node loopback early 408 returns and closes socket before producer ends',async t=>{
  const closed=deferred(),release=deferred()
  let producerEnded=false
  const {session}=await loopback(t,async(request,response)=>{
    checkStreamingIdentity(request)
    request.socket.once('close',closed.resolve)
    request.once('data',()=>{response.writeHead(408,{'Content-Type':'application/json'});response.end('{"error":"upload deadline"}')})
  })
  async function* chunks(){try{yield '{"name":"';await release.promise;yield 'delayed"}'}finally{producerEnded=true}}
  try{
    const response=await bounded(session.requestStreaming('/company.amis/acceptance/apis/run',{chunks:chunks()}))
    assert.equal(response.status,408);assert.deepEqual(await response.json(),{error:'upload deadline'})
    assert.equal(producerEnded,false)
    await bounded(closed.promise)
  }finally{release.resolve()}
})

test('streaming invalid paths and deadlines reject before any Node loopback connection',async t=>{
  let requests=0
  const {session,sockets}=await loopback(t,()=>{requests++})
  async function* chunks(){yield '{}'}
  for(const path of ['https://outside.invalid/company.amis/acceptance/apis/run','/company.amis/other/apis/run',
    '/company.amis/acceptance/apis/run/executions/id','/api/v1/main/flows','/company.amis/acceptance/apis/../run']) {
    await assert.rejects(session.requestStreaming(path,{chunks:chunks()}))
  }
  for(const timeoutMs of [0,-1,30000,45001,Infinity,NaN,'45000'])await assert.rejects(session.requestStreaming('/company.amis/acceptance/apis/run',{chunks:chunks(),timeoutMs}))
  await assert.rejects(session.requestStreaming('/company.amis/acceptance/apis/run',{chunks:['{}']}))
  assert.equal(requests,0);assert.equal(sockets.size,0)
})

test('Node loopback streaming rejects response above 1MiB without leaking closure credentials',async t=>{
  const closed=deferred()
  const {session}=await loopback(t,async(request,response)=>{
    checkStreamingIdentity(request);request.socket.once('close',closed.resolve)
    request.resume()
    response.writeHead(200,{'Content-Type':'application/json'});response.end('x'.repeat(1_048_577))
  })
  async function* chunks(){yield '{}'}
  await assert.rejects(bounded(session.requestStreaming('/company.amis/acceptance/apis/run',{chunks:chunks()})),error=>{
    assert.equal(error.message,'Streaming API transport failed')
    assert(!/Bearer|eyJ|private-secret|private-refresh/.test(JSON.stringify({message:error.message})))
    return true
  })
  await bounded(closed.promise)
})

test('refresh AccessTokenResponse without ID token accepts verified access claims and rotated credentials',async()=>{
  const f=fixture({refreshNoId:true}),session=await f.create()
  const result=await session.refresh()
  assert.equal(result.success,true);assert.equal(result.rotated,true)
  assert.deepEqual(result.before.scopeKeys,['entry','execute'])
  assert.deepEqual(result.after.scopeKeys,['entry'])
  assert.deepEqual(session.evidence().current,result.after)
  await session.requestAccess('/company.amis/acceptance/apis/run',{method:'POST'})
  assert(f.calls.at(-1).options.headers.get('Authorization').startsWith('Bearer '))
  assert(!/private-refresh|private-secret|eyJ/.test(JSON.stringify({result,evidence:session.evidence()})))
})

test('initial authorization code exchange still requires ID token and nonce',async()=>{
  await assert.rejects(fixture({initialNoId:true}).create(),/Initial exchange requires an ID token/)
})

test('refresh without ID token rejects bad access signature and retains original verified credentials',async()=>{
  const f=fixture({refreshNoId:true,badRefreshSignature:true}),session=await f.create()
  const before=session.evidence().current
  await assert.rejects(session.refresh(),/Signed token validation failed/)
  assert.deepEqual(session.evidence().current,before)
  assert.equal(session.evidence().refresh.success,false)
})

test('optional refresh ID token must agree with signed access identity when present',async()=>{
  const f=fixture({refreshIdMismatch:true}),session=await f.create()
  const before=session.evidence().current
  await assert.rejects(session.refresh(),/Token identities disagree/)
  assert.deepEqual(session.evidence().current,before)
  assert.equal(session.evidence().refresh.success,false)
})
