import test from 'node:test'
import assert from 'node:assert/strict'
import {ProductionOAuthClient} from '../production-oauth-client.mjs'

test('session diagnostic exposes only timing and hashes, never cookie or header values',async()=>{
  const client=new ProductionOAuthClient('http://localhost:18128'),empty=client.sessionTimingEvidence()
  assert.equal(empty.jwtPresent,false);assert.equal(empty.jwtSha256,null);assert.deepEqual(empty.csrfCookies,[])
  const token=['header',Buffer.from(JSON.stringify({iat:100,exp:3700})).toString('base64url'),'signature'].join('.')
  const csrf='test-only-session-csrf-value',original=globalThis.fetch
  let requests=0
  globalThis.fetch=async()=>{
    requests++
    if(requests===1)return new Response(null,{status:302,headers:{location:'/oidc/login?from=test'}})
    if(requests===2)return new Response(null,{status:303,headers:{location:'/ui/'}})
    const headers=new Headers();headers.append('set-cookie','JWT='+token+'; Path=/');headers.append('set-cookie','csrfToken='+csrf+'; Path=/')
    return new Response('<meta name="csrf-token" content="'+csrf+'">',{status:200,headers})
  }
  try{
    await client.login('test-account','test-password')
    const evidence=client.sessionTimingEvidence();assert.equal(evidence.jwtIssuedAt,100);assert.equal(evidence.jwtExpiresAt,3700);assert.equal(evidence.jwtMetadataMalformed,false);assert.equal(evidence.csrfCookies[0].matchesHeader,true)
    assert.match(evidence.jwtSha256,/^[a-f0-9]{64}$/);assert.equal(evidence.csrfSha256,evidence.csrfCookies[0].sha256)
    const serialized=JSON.stringify(evidence);for(const value of [token,csrf,'test-password'])assert(!serialized.includes(value))
  }finally{globalThis.fetch=original}
})
