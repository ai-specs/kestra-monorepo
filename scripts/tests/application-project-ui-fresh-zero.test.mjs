import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {verifyFreshZeroUiIdentity} from '../application-project-ui-fixture.mjs'

const base='http://127.0.0.1:18128'
const account={username:'zero',subject:'zero',password:'test-only-password'}
function setup(options={}) {
  const state={epoch:2,cookieEpoch:1,session:true,calls:[],closed:0}
  const response=(status,location)=>({status,headers:new Headers(location?{location}:{}),body:{async cancel(){state.closed++}}})
  const client={
    async request(path) {
      state.calls.push(path)
      if(path==='/oidc/logout') {
        state.session=false
        return response(options.logoutStatus??307,options.missingLocation?undefined:options.location??'/ui/')
      }
      assert(path.endsWith('search?size=1'))
      return response(!state.session||state.cookieEpoch!==state.epoch?401:options.businessStatus??403)
    },
    async login(username,password) {
      state.calls.push('login')
      assert.equal(username,account.username);assert.equal(password,account.password)
      if(!options.staleCookie){state.cookieEpoch=state.epoch;state.session=true}
      return {authenticated:!options.unauthenticated,credentialsSubmitted:!options.reusedSession}
    },
    async verifiedUiIdentity(expected) {
      state.calls.push('signed-identity')
      assert.equal(expected.subject,account.subject);assert.equal(expected.audience,'kestra-ui')
      return {applicationGroupScopes:options.scopes??[]}
    },
  }
  return {state,client,args:{base,client,account}}
}

test('epoch-stale cookie is 401; explicit logout and credential login yields fresh signed zero-scope 403',async()=>{
  const {state,client,args}=setup()
  const stale=await client.request('/flows/search?size=1')
  assert.equal(stale.status,401);await stale.body.cancel()
  state.calls=[]
  const result=await verifyFreshZeroUiIdentity(args)
  assert.equal(result.businessStatus,403);assert.equal(result.credentialsSubmitted,true)
  assert.deepEqual(result.applicationGroupScopes,[])
  assert.deepEqual(state.calls.slice(0,3),['/oidc/logout','login','signed-identity'])
  assert.equal(state.cookieEpoch,state.epoch);assert.equal(state.closed,3)
  assert(!JSON.stringify(result).includes(account.password))
})

for(const [name,options] of [
  ['session reuse without credentials',{reusedSession:true}],
  ['unauthenticated login',{unauthenticated:true}],
  ['login leaving the stale cookie',{staleCookie:true}],
  ['fresh request still 401',{businessStatus:401}],
  ['fresh request unexpectedly allowed',{businessStatus:200}],
  ['nonempty signed scopes',{scopes:['read']}],
  ['foreign logout redirect',{location:'https://outside.invalid/ui/'}],
  ['wrong logout path',{location:'/oidc/login'}],
  ['missing logout location',{missingLocation:true}],
  ['logout not redirecting',{logoutStatus:200}],
])test(name+' fails instead of accepting an unauthenticated denial',async()=>{
  const {args,state}=setup(options)
  await assert.rejects(verifyFreshZeroUiIdentity(args))
  if(options.reusedSession||options.unauthenticated)assert(!state.calls.includes('signed-identity'))
  assert(state.closed>=1)
})

test('missing login implementation cannot pass the zero-account preparation',async()=>{
  const {args}=setup();delete args.client.login
  await assert.rejects(verifyFreshZeroUiIdentity(args),TypeError)
})

test('UI preparation calls fresh-zero verification after the final reference Flow write',()=>{
  const source=readFileSync(new URL('../application-project-ui-fixture.mjs',import.meta.url),'utf8')
  const call=source.indexOf('const actualZero=await verifyFreshZeroUiIdentity')
  const grant=source.indexOf("scopeKeys:[...new Set([...assigned.scopeKeys,uiScopeNames.reference])]")
  const seed=source.indexOf("assert(seeded.ok,'reference flow creation denied")
  assert(grant>0&&seed>grant&&call>seed)
  assert(source.indexOf('await seeded.body?.cancel()',seed)<call)
})
