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
    assert.equal(request.headers?.['Accept-Encoding'],'identity')
    if(paths.includes(path))return response(path===paths[0]?200:404,path===paths[0]?'<div id="app"></div>':'not found',path===paths[0]?'text/html':'text/plain')
    if(path.endsWith('/pages/home'))return response(200,`<base href="/company.amis/acceptance/"><script type="module" src="${change.assetReference??'assets/main.js'}"></script><link rel="stylesheet" href="assets/main.css">`,'text/html')
    const key=path.slice('/company.amis/acceptance/'.length)
    if(!Object.hasOwn(body,key)){assert(['assets/','assets/index.html','assets/runtime-manifest.json'].includes(key));return response(key==='assets/'&&options.mode==='B'?403:404)}
    const value=change.loginHTML?'<html>login</html>':body[key]
    if(request.method==='HEAD')return response(200,change.headBody?'bad':'',mime(key),{'content-length':String(Buffer.byteLength(value)),...(Object.hasOwn(change,'headCache')?{'cache-control':change.headCache}:{})})
    return response(200,value,change.mime?'application/json':mime(key),Object.hasOwn(change,'getCache')?{'cache-control':change.getCache}:{})
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

function pageMarkupFixture(markup,mode='B') {
  const f=fixture(),request=f.options.authClient.request
  f.options.mode=mode
  f.options.authClient.request=async(path,options)=>{
    if(path==='/company.amis/acceptance/pages/home'){
      f.calls.push({path,...options});assert.equal(options.redirect,'manual')
      assert.equal(options.headers?.['Accept-Encoding'],'identity')
      return response(200,markup,'text/html')
    }
    return request(path,options)
  }
  return f
}

for(const mode of ['A','B'])test(`synthetic ${mode}: actual Vite leading ./assets JS/CSS/modulepreload resolves exact manifest and all asset checks`,async()=>{
  const f=pageMarkupFixture('<base href="/company.amis/acceptance/"><script type="module" crossorigin src="./assets/main.js"></script><link rel="stylesheet" crossorigin href="./assets/main.css"><link rel="modulepreload" crossorigin href="./assets/chunk.js">',mode)
  const anonymous=[],transport=f.options.anonymousTransport
  f.options.anonymousTransport=async(url,options)=>{anonymous.push(url);return transport(url,options)}
  const report=await runAmisAssetCases(f.options)
  assert.equal(report.status,'passed');assert.equal(f.reports.at(-1).status,'passed')
  assert.deepEqual(report.checks[0].evidence.references,['assets/main.js','assets/main.css','assets/chunk.js'])
  for(const key of ['assets/main.js','assets/main.css','assets/chunk.js','assets/font.woff2']){
    const path='/company.amis/acceptance/'+key
    assert.deepEqual(f.calls.filter(row=>row.path===path).map(row=>row.method),['GET','HEAD'])
    assert(anonymous.includes(f.options.base+path))
    const row=report.checks.find(row=>row.id===key)
    assert.equal(row.status,'passed');assert.equal(row.evidence.sha256,f.manifest.assets[key].sha256)
    assert.equal(row.evidence.contentType,f.manifest.assets[key].contentType)
  }
  assert(f.calls.every(row=>!row.path.includes('./')))
})

for(const reference of ['././assets/main.js','./assets/../main.js','./assets/./main.js','./assets/sub/../../main.js',
  './assets/%2e%2e/main.js','./assets/%6dain.js','./assets//main.js','./assets/missing.js',
  './assets/main.js?download=1','./assets/main.js#fragment','./assets/\\main.js',
  'https://foreign.example/company.amis/acceptance/assets/main.js','//foreign.example/company.amis/acceptance/assets/main.js',
  '/company.amis/other/assets/main.js','./other/main.js']){
  test('synthetic leading-prefix regression rejects '+reference,async()=>{
    const f=fixture({assetReference:reference}),report=await runAmisAssetCases(f.options)
    assert.equal(report.status,'failed');assert.equal(report.checks[0].id,'page-html-tags')
    assert.equal(report.checks[0].status,'failed');assert.equal(f.reports.at(-1).status,'failed')
    assert.deepEqual(f.calls.map(row=>row.path),['/company.amis/acceptance/pages/home'])
  })
}

for(const [kind,reference]of [['stylesheet','././assets/main.css'],['stylesheet','./assets/../main.css'],
  ['stylesheet','https://foreign.example/company.amis/acceptance/assets/main.css'],
  ['modulepreload','././assets/chunk.js'],['modulepreload','./assets/../chunk.js'],
  ['modulepreload','./assets/missing-chunk.js']]){
  test(`synthetic ${kind} rejects ${reference} despite valid leading-prefix script`,async()=>{
    const extra=kind==='stylesheet'?`<link rel="stylesheet" href="${reference}">`:`<link rel="stylesheet" href="./assets/main.css"><link rel="modulepreload" href="${reference}">`
    const f=pageMarkupFixture('<base href="/company.amis/acceptance/"><script type="module" src="./assets/main.js"></script>'+extra)
    const report=await runAmisAssetCases(f.options)
    assert.equal(report.status,'failed');assert.equal(report.checks[0].status,'failed')
    assert.equal(f.calls.length,1);assert.equal(f.reports.at(-1).status,'failed')
  })
}

for(const [getCache,headCache]of [['no-store, no-store','no-store, no-store'],['no-store, no-store','no-store'],
  ['no-store','no-store, no-store'],[' NO-STORE , no-store ','no-store, NO-STORE']]){
  test(`synthetic equivalent no-store directives GET=${getCache} HEAD=${headCache} preserve all asset checks`,async()=>{
    const f=fixture({getCache,headCache}),anonymous=[],transport=f.options.anonymousTransport
    f.options.anonymousTransport=async(url,options)=>{anonymous.push(url);return transport(url,options)}
    const report=await runAmisAssetCases(f.options)
    assert.equal(report.status,'passed');assert.equal(anonymous.length,4)
    for(const key of ['assets/main.js','assets/main.css','assets/chunk.js','assets/font.woff2']){
      const row=report.checks.find(row=>row.id===key)
      assert.equal(row.status,'passed');assert.equal(row.evidence.sha256,f.manifest.assets[key].sha256)
      assert.equal(row.evidence.contentType,f.manifest.assets[key].contentType)
      assert.equal(row.evidence.headStatus,200);assert.equal(row.evidence.anonymousStatus,401)
      assert.deepEqual(f.calls.filter(call=>call.path.endsWith('/'+key)).map(call=>call.method),['GET','HEAD'])
    }
  })
}

for(const method of ['GET','HEAD'])for(const cache of ['no-store, public','no-store, private','no-store, max-age=0',
  'no-store, max-age=3600','no-store,',' ,no-store','no-store,,no-store','', 'public','private','max-age=0','no-cache']){
  test(`synthetic ${method} cache rejects ${JSON.stringify(cache)} despite correct bytes and other headers`,async()=>{
    const f=fixture({getCache:'no-store, no-store',headCache:'no-store, no-store',[method==='GET'?'getCache':'headCache']:cache})
    const report=await runAmisAssetCases(f.options)
    assert.equal(report.status,'failed');assert.equal(f.reports.at(-1).status,'failed')
    const row=report.checks.find(row=>row.id==='assets/main.js')
    assert.equal(row.status,'failed');assert.equal(row.observed.status,200)
    assert.equal(row.observed.sha256,f.manifest.assets['assets/main.js'].sha256)
    assert.equal(row.observed.contentType,f.manifest.assets['assets/main.js'].contentType)
    assert.equal(Number(row.observed.contentLength),row.observed.bytes)
    assert.deepEqual(f.calls.filter(call=>call.path.endsWith('/assets/main.js')).map(call=>call.method),method==='GET'?['GET']:['GET','HEAD'])
    assert(!/cookie|authorization/i.test(JSON.stringify(row.observed)))
  })
}

for(const fault of ['mime','length','body','status','missing-cache'])test('synthetic HEAD '+fault+' remains rejected with valid duplicate GET cache directives',async()=>{
  const f=fixture({getCache:'no-store, no-store',headCache:'no-store, no-store'}),request=f.options.authClient.request
  f.options.authClient.request=async(path,options)=>{
    const original=await request(path,options)
    if(options.method!=='HEAD')return original
    const headers=new Headers(original.headers)
    if(fault==='mime')headers.set('content-type','application/json')
    if(fault==='length')headers.set('content-length','9999')
    if(fault==='missing-cache')headers.delete('cache-control')
    return new Response(fault==='body'?'unexpected':'',{status:fault==='status'?404:200,headers})
  }
  const report=await runAmisAssetCases(f.options)
  assert.equal(report.status,'failed');assert.equal(report.checks.find(row=>row.id==='assets/main.js').status,'failed')
  assert.equal(f.reports.at(-1).status,'failed')
})

test('synthetic every authenticated native/page/asset GET and HEAD explicitly requests identity encoding',async()=>{
  for(const assets of [false,true]){
    const f=fixture(),report=await(assets?runAmisAssetCases:runAmisNativeCases)(f.options)
    assert.equal(report.status,'passed');assert(f.calls.length>0)
    for(const call of f.calls){
      assert(['GET','HEAD'].includes(call.method))
      assert.deepEqual(call.headers,{'Accept-Encoding':'identity'})
    }
    if(assets){
      assert(f.calls.some(call=>call.method==='HEAD'))
      assert(f.calls.some(call=>call.path.endsWith('/pages/home')))
      assert(f.calls.some(call=>call.path.endsWith('/assets/main.js')))
    }
  }
})

for(const length of ['1','9999','0','invalid','',null])test(`synthetic identity GET rejects wrong content-length ${JSON.stringify(length)} with exact formal body/hash/MIME`,async()=>{
  const f=fixture(),request=f.options.authClient.request
  f.options.authClient.request=async(path,options)=>{
    const original=await request(path,options)
    if(options.method!=='GET'||!path.endsWith('/assets/main.js'))return original
    const headers=new Headers(original.headers)
    if(length===null)headers.delete('content-length')
    else headers.set('content-length',length)
    return new Response(await original.arrayBuffer(),{status:200,headers})
  }
  const report=await runAmisAssetCases(f.options),row=report.checks.find(row=>row.id==='assets/main.js')
  assert.equal(report.status,'failed');assert.equal(row.status,'failed')
  assert.equal(row.observed.status,200);assert.equal(row.observed.sha256,f.manifest.assets['assets/main.js'].sha256)
  assert.equal(row.observed.contentType,f.manifest.assets['assets/main.js'].contentType)
  assert.equal(row.observed.contentLength,length)
  assert.notEqual(row.observed.contentLength,String(row.observed.bytes))
  assert.equal(f.reports.at(-1).status,'failed')
  assert(!f.calls.some(call=>call.method==='HEAD'),'GET length failure must stop before HEAD')
})

test('synthetic identity SVG body length/hash is checked without substituting compressed wire length',async()=>{
  const f=fixture(),request=f.options.authClient.request
  const bytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>'+ 'synthetic'.repeat(1000)+'</text></svg>')
  const key='assets/diagram.svg',mime='image/svg+xml'
  f.manifest.assets[key]={sha256:hash(bytes),contentType:mime}
  f.options.authClient.request=async(path,options)=>{
    if(!path.endsWith('/'+key))return request(path,options)
    f.calls.push({path,...options});assert.deepEqual(options.headers,{'Accept-Encoding':'identity'})
    return new Response(options.method==='HEAD'?null:bytes,{status:200,headers:{'content-type':mime,'content-length':String(bytes.length),'cache-control':'no-store, no-store'}})
  }
  const report=await runAmisAssetCases(f.options),row=report.checks.find(row=>row.id===key)
  assert.equal(report.status,'passed');assert.equal(row.evidence.bytes,bytes.length)
  assert.equal(row.evidence.sha256,hash(bytes));assert.equal(row.evidence.headStatus,200)
  assert.deepEqual(f.calls.filter(call=>call.path.endsWith('/'+key)).map(call=>call.method),['GET','HEAD'])
})

for(const mode of ['A','B'])test(`synthetic ${mode}: empty asset directory exact ${mode==='B'?403:404}, private index and manifest remain404`,async()=>{
  const f=fixture();f.options.mode=mode
  const report=await runAmisAssetCases(f.options)
  assert.equal(report.status,'passed')
  for(const suffix of ['assets/','assets/index.html','assets/runtime-manifest.json']){
    const row=report.checks.find(row=>row.id==='not-public-'+suffix)
    assert.equal(row.status,'passed')
    assert.equal(row.evidence.status,suffix==='assets/'&&mode==='B'?403:404)
    assert.equal(row.evidence.path,'/company.amis/acceptance/'+suffix)
    assert.equal(f.calls.filter(call=>call.path===row.evidence.path).length,1)
  }
  assert.equal(report.checks.filter(row=>row.evidence?.headStatus===200&&row.evidence?.anonymousStatus===401).length,4)
})

for(const status of [404,200])test(`synthetic B empty directory ${status} cannot replace exact typed denial403`,async()=>{
  const f=fixture(),request=f.options.authClient.request
  f.options.authClient.request=async(path,options)=>{
    const original=await request(path,options)
    return path==='/company.amis/acceptance/assets/'?response(status):original
  }
  const report=await runAmisAssetCases(f.options)
  assert.equal(report.status,'failed');assert.equal(f.reports.at(-1).status,'failed')
  assert.equal(report.checks.at(-1).id,'not-public-assets/');assert.equal(report.checks.at(-1).status,'failed')
  assert.equal(report.checks.filter(row=>row.evidence?.headStatus===200&&row.evidence?.anonymousStatus===401).length,4)
  assert(!f.calls.some(call=>call.path.endsWith('/assets/index.html')))
})

for(const mode of ['A','B'])for(const suffix of ['assets/index.html','assets/runtime-manifest.json'])for(const status of [200,403]){
  test(`synthetic ${mode} private ${suffix} must404, rejects ${status} without inheriting directory policy`,async()=>{
    const f=fixture(),request=f.options.authClient.request;f.options.mode=mode
    f.options.authClient.request=async(path,options)=>{
      const original=await request(path,options)
      return path==='/company.amis/acceptance/'+suffix?response(status):original
    }
    const report=await runAmisAssetCases(f.options)
    assert.equal(report.status,'failed');assert.equal(f.reports.at(-1).status,'failed')
    assert.equal(report.checks.at(-1).id,'not-public-'+suffix);assert.equal(report.checks.at(-1).status,'failed')
    assert.equal(report.checks.find(row=>row.id==='not-public-assets/').status,'passed')
  })
}
