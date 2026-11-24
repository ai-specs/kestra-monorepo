import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {classifyAccessControlDiagnostics} from '../access-control-browser-diagnostics.mjs'
const fixture=JSON.parse(readFileSync(new URL('./data/auth-login-unload-double-console.json',import.meta.url)))
const classify=events=>classifyAccessControlDiagnostics({events,base:fixture.base})
test('real old-document auth login-config cancellation attributes both catch and handler logs',()=>{
 const result=classify(structuredClone(fixture.events))
 for(const id of ['event:142','event:143'])assert(result.classifications.some(row=>row.id===id&&row.reason==='host-auth-login-double-log-on-proven-document-unload'))
})
for(const [name,mutate] of [
 ['no navigation',e=>e.filter(x=>x.kind!=='document-navigation')],
 ['no original request',e=>e.filter(x=>x.kind!=='request')],
 ['no failed request',e=>e.filter(x=>x.kind!=='request-failed')],
 ['different API',e=>e.map(x=>x.url?.endsWith('/configs/login')?{...x,url:fixture.base+'/api/v1/private'}:x)],
 ['late log',e=>e.map(x=>x.kind==='console-error'?{...x,observedAt:'2026-11-25T00:00:00Z'}:x)],
 ['one log missing',e=>e.filter(x=>x.id!=='event:143')],
 ['different document',e=>e.map(x=>x.id==='event:143'?{...x,documentId:'other-document'}:x)],
 ['foreign stack',e=>e.map(x=>x.kind==='console-error'?{...x,stack:[{url:'https://other.invalid/app.js',functionName:'bad'}]}:x)],
 ['wrong error',e=>e.map(x=>x.kind==='console-error'?{...x,message:'Error during authentication check: invalid identity'}:x)],
 ['unrelated function chain',e=>e.map(x=>x.id==='event:143'?{...x,stack:[{...x.stack[0],functionName:'unrelated'}]}:x)],
])test('rejects auth double-log attribution: '+name,()=>{
 const result=classify(mutate(structuredClone(fixture.events)))
 assert(!result.classifications.some(row=>row.reason==='host-auth-login-double-log-on-proven-document-unload'))
})
