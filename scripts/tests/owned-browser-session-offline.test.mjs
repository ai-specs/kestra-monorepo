import test from 'node:test'
import assert from 'node:assert/strict'
import {captureOwnedSession,restoreOwnedSession} from '../owned-browser-session.mjs'

const origin='http://localhost:18128'
const token=(issuer=origin)=>'unit-test.'+Buffer.from(JSON.stringify({iss:issuer,sub:'owned-test-account'})).toString('base64url')+'.unit-test-signature'
const cookie=()=>({name:'JWT',value:token(),domain:'localhost',path:'/',httpOnly:true,secure:false,sameSite:'Lax',session:true,expires:-1,size:123})

test('session transfer preserves the exact owned cookie in memory and exports only hashed evidence',async()=>{
  const original=cookie(),calls=[]
  const send=async(method,parameters)=>{
    calls.push({method,parameters})
    return method==='Network.getCookies'?{cookies:[original]}:{success:true}
  }
  const state=await captureOwnedSession(send,origin)
  const proof=await restoreOwnedSession(send,origin,state)
  assert.equal(proof.restored,true)
  assert.equal(proof.subject,'owned-test-account')
  assert.match(proof.sha256,/^[a-f0-9]{64}$/)
  assert(!JSON.stringify(proof).includes(original.value))
  const write=calls.find(call=>call.method==='Network.setCookie').parameters
  assert.equal(write.value,original.value)
  assert.equal(write.httpOnly,true)
  assert.equal(write.url,origin)
  assert(!('size' in write));assert(!('session' in write));assert(!('expires' in write))
})

for(const rejectedOrigin of ['https://example.com','http://localhost:18128/ui/','http://127.0.0.2:18128'])test('rejects an unowned transfer origin '+rejectedOrigin,async()=>{
  let calls=0
  await assert.rejects(()=>captureOwnedSession(async()=>{calls++;return {cookies:[cookie()]}},rejectedOrigin))
  assert.equal(calls,0)
})

for(const [name,change] of [
  ['different issuer',value=>{value.value=token('http://localhost:8080')}],
  ['different host',value=>{value.domain='example.com'}],
  ['different cookie',value=>{value.name='oidc_session'}],
  ['not HttpOnly',value=>{value.httpOnly=false}],
  ['different path',value=>{value.path='/other'}],
])test('rejects '+name+' before cookie mutation',async()=>{
  const invalid=cookie();change(invalid)
  let writes=0
  await assert.rejects(()=>restoreOwnedSession(async()=>{writes++;return {success:true}},origin,{cookie:invalid,proof:{}}))
  assert.equal(writes,0)
})

test('refuses duplicate sessions, changed proof, failed restoration and cookie substitution',async()=>{
  await assert.rejects(()=>captureOwnedSession(async()=>({cookies:[cookie(),cookie()]}),origin))
  const state=await captureOwnedSession(async()=>({cookies:[cookie()]}),origin)
  await assert.rejects(()=>restoreOwnedSession(async()=>({success:true}),origin,{...state,proof:{...state.proof,sha256:'0'.repeat(64)}}))
  await assert.rejects(()=>restoreOwnedSession(async()=>({success:false}),origin,state))
  const changed=cookie();changed.value=token()+'.different'
  await assert.rejects(()=>restoreOwnedSession(async method=>method==='Network.setCookie'?{success:true}:{cookies:[changed]},origin,state))
})
