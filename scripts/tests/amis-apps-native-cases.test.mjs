// Synthetic strict HTTP/probe fixtures; never production authorization evidence.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {classifyAmisNativePath,runAmisNativeCases,runAmisAssetCases} from '../amis-apps-native-cases.mjs'
const hash=value=>createHash('sha256').update(value).digest('hex')
const paths=['/ui/main/page/x','/ui-extensions/app/pages/x','/api/v1/api/x','/oidc/app/pages/x','/oauth/app/pages/x','/.well-known/app/pages/x','/static/app/pages/x','/swagger/app/pages/x','/ping']
const response=(status,body='',type='text/plain',extra={})=>new Response(body,{status,headers:{'content-type':type,'cache-control':'no-store','content-length':String(Buffer.byteLength(body??'')),...extra}})
function fixture(change={}) {
  const body={'assets/main.js':'console.log("synthetic")','assets/main.css':'body {color: red}','assets/chunk.js':'export const synthetic = 1','assets/font.woff2':'synthetic-font'}
  const mime=key=>key.endsWith('.css')?'text/css; charset=utf-8':key.endsWith('.woff2')?'font/woff2':'text/javascript; charset=utf-8'
  const manifest={version:1,entry:'index.html',assets:{'index.html':{sha256:hash('template'),contentType:'text/html; charset=utf-8'},...Object.fromEntries(Object.entries(body).map(([key,value])=>[key,{sha256:hash(value),contentType:mime(key)}]))}}
  const reports=[],calls=[];let snapshots=0
  const snapshot=()=>({generation:change.generation&&snapshots++?'new':'same',integrity:'ok',readiness:Object.fromEntries(['flowRepositoryListener','flowMetaStoreListener','namespaceFactoryListener','storageListener','authorizationListener'].map(key=>[key,!change.notReady])),flowLookup:0,flowMeta:0,schemaStorage:0,storageCalls:0,namespaceResolve:0,flowAuthorization:0})
  const options={mode:'B',base:'https://synthetic.example',identityEvidence:{authenticated:true,subject:'actor'},probe:{snapshot:async()=>snapshot()},persist:async report=>reports.push(report),namespace:'company.amis',flowId:'acceptance',pageId:'home',expectedPublishedAssets:manifest,nativeCases:paths.map((path,i)=>({path,status:i===0?200:404,contentType:i===0?'text/html':'text/plain',...(i===0?{marker:'id="app"'}:{})}))}
  options.authClient={request:async(path,request)=>{
    calls.push({path,...request});assert.equal(request.redirect,'manual')
    if(paths.includes(path))return response(path===paths[0]?200:404,path===paths[0]?'<div id="app"></div>':'not found',path===paths[0]?'text/html':'text/plain')
    if(path.endsWith('/pages/home'))return response(200,`<base href="/company.amis/acceptance/"><script type="module" src="${change.assetReference??'assets/main.js'}"></script><link rel="stylesheet" href="assets/main.css">`,'text/html')
    const key=path.slice('/company.amis/acceptance/'.length)
    if(!Object.hasOwn(body,key)){assert(['assets/','assets/index.html','assets/runtime-manifest.json'].includes(key));return response(404)}
    const value=change.loginHTML?'<html>login</html>':body[key]
    if(request.method==='HEAD')return response(200,change.headBody?'bad':'',mime(key),{'content-length':String(Buffer.byteLength(value))})
    return response(200,value,change.mime?'application/json':mime(key))
  }}
  options.anonymousTransport=async(url,request)=>{assert.equal(request.credentials,'omit');assert.equal(request.redirect,'manual');assert.deepEqual(request.headers,{});assert(!request.headers.cookie);return response(change.anonymousRedirect?302:401,'','text/plain',change.anonymousRedirect?{location:'/oidc/login'}:{})}
  return {options,manifest,reports,calls}
}
test('native exact classifier and all nine explicit HTTP classes pass with zero probe delta',async()=>{
  const f=fixture();assert.equal((await runAmisNativeCases(f.options)).status,'passed');assert.equal(f.calls.length,9)
  for(const path of ['/company.amis/app/pages/x','/api/random','https://foreign/ui/main/page/x','/ui/main/page/x?x=1'])assert.equal(classifyAmisNativePath(path),null)
})
test('all published assets including font and dynamic chunk GET/HEAD/anonymous are checked',async()=>{
  const f=fixture(),report=await runAmisAssetCases(f.options);assert.equal(report.status,'passed');assert(report.checks.some(row=>row.id==='assets/chunk.js'));assert(report.checks.some(row=>row.id==='assets/font.woff2'))
})
for(const [name,change]of [['MIME',{mime:true}],['login HTML',{loginHTML:true}],['HEAD body',{headBody:true}],['anonymous redirect',{anonymousRedirect:true}],['unready',{notReady:true}],['generation changed',{generation:true}]])
  test('reject synthetic '+name+' and preserve partial report',async()=>{const f=fixture(change),report=await runAmisAssetCases(f.options);assert.equal(report.status,'failed');assert.equal(f.reports.at(-1).status,'failed')})
test('wrong manifest hash and traversal rejected',async()=>{
  const f=fixture();f.manifest.assets['assets/main.js'].sha256='a'.repeat(64);assert.equal((await runAmisAssetCases(f.options)).status,'failed')
  const other=fixture();other.manifest.assets['assets/../private']={sha256:'a'.repeat(64),contentType:'text/javascript'};assert.equal((await runAmisAssetCases(other.options)).status,'failed');assert.equal(other.calls.length,0)
})
test('native 404 mismatch never becomes automatic pass',async()=>{
  const f=fixture();f.options.nativeCases[8].status=200;const report=await runAmisNativeCases(f.options);assert.equal(report.status,'failed');assert.equal(report.checks.length,9);assert.equal(report.checks.at(-1).status,'failed')
})
for(const reference of ['https://foreign.example/assets/main.js','/assets/main.js','assets/%6dain.js','assets/../main.js','assets//main.js','assets/missing.js'])
  test('reject noncanonical or undeclared actual tag '+reference,async()=>{
    const f=fixture({assetReference:reference});const report=await runAmisAssetCases(f.options);assert.equal(report.status,'failed');assert.equal(report.checks[0].status,'failed');assert.equal(f.calls.length,1)
  })
test('native probe nonzero delta fails; asset probe increases are reported rather than forged zero',async()=>{
  for(const assets of [false,true]){
    const f=fixture();const original=f.options.probe.snapshot;let called=0
    f.options.probe.snapshot=async()=>({...await original(),flowLookup:called++?1:0})
    const report=await(assets?runAmisAssetCases:runAmisNativeCases)(f.options)
    assert.equal(report.status,assets?'passed':'failed');if(assets)assert.equal(report.delta.flowLookup,1)
  }
})
