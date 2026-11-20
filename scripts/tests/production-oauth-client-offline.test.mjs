import test from 'node:test'
import assert from 'node:assert/strict'
import {ProductionOAuthClient} from '../production-oauth-client.mjs'

const timeout=()=>Object.assign(new Error('fetch timeout'),{name:'TimeoutError'})
test('production GET retries exactly once after a transport timeout',async()=>{
  const calls=[]
  const previousFetch=globalThis.fetch
  globalThis.fetch=async()=>{calls.push(calls.length);throw timeout()}
  const client=new ProductionOAuthClient('http://localhost:18128')
  try {await assert.rejects(client.request('/oidc/login'),/fetch timeout/)}
  finally {globalThis.fetch=previousFetch}
  assert.deepEqual(calls,[0,1])
})
test('production POST and persistent GET timeouts are not retried',async()=>{
  for(const method of ['POST','GET']) {
    const calls=[]
    const previousFetch=globalThis.fetch
    globalThis.fetch=async()=>{calls.push(calls.length);throw timeout()}
    const client=new ProductionOAuthClient('http://localhost:18128')
    try {await assert.rejects(method==='POST'?client.request('/oidc/login',{method}):client.request('/oidc/login'),/fetch timeout/)}
    finally {globalThis.fetch=previousFetch}
    if(method==='POST')assert.equal(calls.length,1)
    else assert.equal(calls.length,2)
  }
})
