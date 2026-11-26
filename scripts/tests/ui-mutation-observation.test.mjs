import test from 'node:test'
import assert from 'node:assert/strict'
import {installUiMutationObservation,validateUiMutationSample,proveUiMutationReplacement,finishUiMutationObservation,clearUiMutationObservation,assertRevokedEditorStages,committedUiDocument,sourceUiDocument,uiDocumentSnapshot} from '../ui-mutation-observation.mjs'

const base='http://localhost:18128',key='ui-save-test-owned'
const source={documentId:'old',url:base+'/ui/main/extensions/rbac/application-groups/kestra',query:'',timeOrigin:10,path:'/ui/main/extensions/rbac/application-groups/kestra'}
const operation={id:key,case:'ui-application-register-remove',source,url:base+'/api/v1/main/extensions/rbac/application-groups/kestra/applications',method:'POST'}
const sample=()=>({schemaVersion:1,operation:structuredClone(operation),sequence:3,busy:true,saving:true,closeDisabled:true,saveDisabled:true,unloaded:true})
const current={documentId:'new',url:base+'/ui/main/dashboards',query:'',timeOrigin:20}
const request={id:'request',kind:'request',documentId:'old',frameId:'frame',requestId:'write',method:'POST',url:operation.url}
const response={...request,id:'response',kind:'http-response',status:200}
const navigation={id:'navigation',kind:'document-navigation',documentId:'new',frameId:'frame',url:current.url}
const events=[request,response,navigation]

test('source-bound loading sample validates without accepting secret or extra fields',()=>{
  assert.equal(validateUiMutationSample(sample(),operation,{replaced:true}).busy,true)
  const changed=sample();changed.payload='secret';assert.throws(()=>validateUiMutationSample(changed,operation))
})
for(const [name,change] of [
  ['missing record',()=>null],['wrong operation',value=>{value.operation.id='other';return value}],
  ['wrong document',value=>{value.operation.source.documentId='other';return value}],
  ['wrong time origin',value=>{value.operation.source.timeOrigin=11;return value}],
  ['wrong URL',value=>{value.operation.source.url=base+'/other';return value}],
  ['wrong method',value=>{value.operation.method='PUT';return value}],
  ['unobserved loading',value=>{value.busy=false;return value}],['no unload',value=>{value.unloaded=false;return value}],
  ['mutable close',value=>{value.closeDisabled=false;return value}],['duplicate submit',value=>{value.saveDisabled=false;return value}],
  ['invalid sequence',value=>{value.sequence=0;return value}],
])test('cross-document sample rejects '+name,()=>assert.throws(()=>validateUiMutationSample(change(sample()),operation,{replaced:true})))

test('actual replacement proof binds the original write request response and same frame',()=>{
  assert.equal(proveUiMutationReplacement({events,operation,response,current}).navigationEventId,'navigation')
})
function routedReplacement() {
  const replacement={...current,query:'?filters[timeRange][EQUALS]=PT24H'}
  const committed={...navigation,url:base+'/ui/'}
  const routes=[{...committed,id:'route-dashboard',kind:'document-route',url:current.url},{...committed,id:'route-query',kind:'document-route',url:replacement.url+replacement.query}]
  const rows=[request,response,committed,...routes]
  const diagnostics={topFrame:'frame',events:rows,documents:[{id:'new',frameId:'frame',url:replacement.url+replacement.query},{id:'future-provisional',frameId:'frame',url:replacement.url+replacement.query}]}
  return {replacement,rows,diagnostics}
}
test('committed UI entry then same-document dashboard/query routes bind actual replacement',()=>{
  const {replacement,rows,diagnostics}=routedReplacement()
  assert.equal(committedUiDocument(diagnostics,replacement).id,'new')
  const proof=proveUiMutationReplacement({events:rows,operation,response,current:replacement})
  assert.equal(proof.navigationEventId,'navigation');assert.deepEqual(proof.routeEventIds,['route-dashboard','route-query'])
})
for(const [name,change] of [
  ['missing route',value=>{value.rows.pop()}],['foreign route frame',value=>{value.rows.at(-1).frameId='other'}],
  ['foreign route document',value=>{value.rows.at(-1).documentId='other'}],['wrong final query',value=>{value.rows.at(-1).url=current.url+'?other=1'}],
  ['route before commit',value=>{value.rows.splice(2,0,value.rows.pop())}],['foreign route origin',value=>{value.rows.at(-1).url='https://foreign.invalid/ui/main/dashboards'}],
  ['no committed navigation',value=>{value.rows.splice(2,1)}],['wrong commit frame',value=>{value.rows[2].frameId='other'}],
])test('committed replacement route rejects '+name,()=>{
  const value=routedReplacement();change(value)
  assert.throws(()=>proveUiMutationReplacement({events:value.rows,operation,response,current:value.replacement}))
})
test('current document selection rejects provisional-only and metadata URL drift',()=>{
  const value=routedReplacement()
  assert.equal(committedUiDocument(value.diagnostics,value.replacement).id,'new')
  value.diagnostics.documents[0].url=base+'/other'
  assert.throws(()=>committedUiDocument(value.diagnostics,value.replacement))
  value.diagnostics.documents.shift();assert.throws(()=>committedUiDocument(value.diagnostics,value.replacement))
})
test('general login source binds real committed path without comparing redacted from query',()=>{
  const current={url:base+'/oidc/login',query:'?from=private-test-target&code=private-test-code',timeOrigin:25}
  const navigation={id:'login-commit',kind:'document-navigation',frameId:'frame',documentId:'login',url:base+'/oidc/login?from=[redacted]&code=[redacted]'}
  const diagnostics={topFrame:'frame',events:[navigation],documents:[{id:'login',frameId:'frame',url:navigation.url},{id:'uncommitted',frameId:'frame',url:navigation.url}]}
  assert.equal(sourceUiDocument(diagnostics,current).id,'login')
  assert.throws(()=>committedUiDocument(diagnostics,current))
  assert.equal(current.query,'?from=private-test-target&code=private-test-code')
  const wrong={...current,url:base+'/oidc/other'}
  assert.throws(()=>sourceUiDocument(diagnostics,wrong),error=>{assert(!error.message.includes('private-test'));return true})
  assert.throws(()=>sourceUiDocument(diagnostics,{...current,url:'https://foreign.invalid/oidc/login'}))
  assert.throws(()=>sourceUiDocument(diagnostics,{...current,timeOrigin:undefined}))
})
test('general source allows same-document login route but requires the real top-frame commit',()=>{
  const navigation={id:'commit',kind:'document-navigation',frameId:'frame',documentId:'login',url:base+'/ui/'}
  const route={id:'route',kind:'document-route',frameId:'frame',documentId:'login',url:base+'/oidc/login?from=[redacted]'}
  const diagnostics={topFrame:'frame',events:[navigation,route],documents:[{id:'login',frameId:'frame',url:route.url}]}
  const current={url:base+'/oidc/login',query:'?from=private-test',timeOrigin:25}
  assert.equal(sourceUiDocument(diagnostics,current).id,'login')
  route.frameId='other';assert.throws(()=>sourceUiDocument(diagnostics,current))
  diagnostics.events=[];assert.throws(()=>sourceUiDocument(diagnostics,current))
})
test('HTTP mutation committed reader keeps exact query even when general source accepts its path',()=>{
  const {replacement,diagnostics}=routedReplacement()
  const changed={...replacement,query:'?filters[timeRange][EQUALS]=PT1H'}
  assert.equal(sourceUiDocument(diagnostics,changed).id,'new')
  assert.throws(()=>committedUiDocument(diagnostics,changed))
})
for(const [name,change] of [
  ['missing request',rows=>rows.shift()],['missing response',rows=>rows.splice(1,1)],
  ['duplicate response',rows=>rows.splice(2,0,{...rows[1],id:'duplicate'})],
  ['foreign frame',rows=>{rows[2].frameId='other'}],['foreign origin',rows=>{rows[2].url='https://foreign.invalid/ui/main/dashboards'}],
  ['wrong response URL',rows=>{rows[1].url=base+'/other'}],['old response',rows=>{[rows[0],rows[1]]=[rows[1],rows[0]]}],
  ['no navigation',rows=>rows.pop()],['before response',rows=>{[rows[1],rows[2]]=[rows[2],rows[1]]}],
])test('replacement proof rejects '+name,()=>{
  const rows=structuredClone(events);change(rows)
  assert.throws(()=>proveUiMutationReplacement({events:rows,operation,response,current}))
})

function pageFixture({replacement=true,record=sample(),error,transient=false}={}) {
  let reads=0
  const actual=replacement?current:source
  const rows=replacement?events:[{id:'old-navigation',kind:'document-navigation',documentId:source.documentId,frameId:'frame',url:source.url},request,response]
  const page={diagnostics:async()=>({events:structuredClone(rows),topFrame:'frame',documents:[{id:actual.documentId,frameId:'frame',url:actual.url+actual.query}]}),
    evaluate:async(callback,argument)=>{
      reads++
      if(error)throw Error(error)
      if(transient&&reads===1)throw Error('page.evaluate: Execution context was destroyed, most likely because of a navigation')
      if(argument?.key)return {sample:record===null?null:JSON.stringify(record),view:{path:new URL(actual.url).pathname,reauthenticationRequired:false,businessContentHidden:true}}
      return {...actual}
    }}
  return {page,get reads(){return reads}}
}
test('replacement collection retains original loading source and dashboard is not authentication proof',async()=>{
  const {page}=pageFixture();const value=await finishUiMutationObservation({page,key,operation,response})
  assert.deepEqual(value.loadingSource.source,source);assert.equal(value.loadingSource.replacement.navigationEventId,'navigation')
  assert.equal(value.postWriteView.reauthenticationRequired,false);assert.equal(value.postWriteView.source.documentId,'new')
})
test('same-document fast path preserves the source without inventing a replacement',async()=>{
  const {page}=pageFixture({replacement:false});const value=await finishUiMutationObservation({page,key,operation,response})
  assert.equal(value.loadingSource.replacement,undefined);assert.equal(value.postWriteView.source.documentId,'old')
})
test('one specifically identified context destruction needs real navigation and does not repeat the write',async()=>{
  const fixture=pageFixture({transient:true});const value=await finishUiMutationObservation({page:fixture.page,key,operation,response})
  assert.equal(fixture.reads,3);assert.equal(value.loadingSource.replacement.navigationEventId,'navigation')
})
test('context destruction without actual replacement remains failed',async()=>{
  const {page}=pageFixture({replacement:false,transient:true})
  await assert.rejects(finishUiMutationObservation({page,key,operation,response}),/no proven/)
})
test('unrelated evaluation error is not swallowed or retried',async()=>{
  const fixture=pageFixture({error:'page.evaluate: unknown context destroyed problem'})
  await assert.rejects(finishUiMutationObservation({page:fixture.page,key,operation,response}),/unknown/);assert.equal(fixture.reads,1)
})
test('missing storage record fails even after a confirmed200 and navigation',async()=>{
  const {page}=pageFixture({record:null});await assert.rejects(finishUiMutationObservation({page,key,operation,response}),/sample missing/)
  assert.equal(response.status,200)
})

function browserGlobals({storageFailure=false}={}) {
  const saved=Object.fromEntries(['window','document','location','performance','MutationObserver','sessionStorage','addEventListener','removeEventListener'].map(name=>[name,globalThis[name]]))
  const store=new Map([['foreign-key','keep']]),listeners=new Map();let callback,disconnected=0
  const root={querySelector:selector=>selector==='main'?{getAttribute:()=> 'true'}:selector==='[data-test^="drawer-"][aria-busy]'?{getAttribute:()=> 'true',querySelector:()=>({disabled:true})}:selector==='[data-test="drawer-save"]'?{disabled:true}:null}
  Object.assign(globalThis,{window:{},document:{querySelector:()=>({shadowRoot:root})},location:new URL(source.url),performance:{timeOrigin:10},
    MutationObserver:class{constructor(fn){callback=fn}observe(){}disconnect(){disconnected++}},
    sessionStorage:{getItem:name=>store.get(name)??null,setItem:(name,value)=>{if(storageFailure)throw Error('storage unavailable');store.set(name,value)},removeItem:name=>store.delete(name)},
    addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)})
  return {store,listeners,get disconnected(){return disconnected},sample:()=>callback([{attributeName:'aria-busy',oldValue:'true'}]),restore(){for(const [name,value] of Object.entries(saved))if(value===undefined)delete globalThis[name];else globalThis[name]=value}}
}
test('native observer stores only booleans and source binding and cleans only its own key',async()=>{
  const browser=browserGlobals()
  try {
    installUiMutationObservation({key,operation});browser.sample();browser.listeners.get('pagehide')()
    const value=JSON.parse(browser.store.get(key));validateUiMutationSample(value,operation,{replaced:true})
    assert(!JSON.stringify(value).includes('payload'));assert(browser.disconnected>0)
    await clearUiMutationObservation({evaluate:async(fn,args)=>fn(args)},key,base)
    assert.equal(browser.store.has(key),false);assert.equal(browser.store.get('foreign-key'),'keep');assert.equal(browser.listeners.has('pagehide'),false)
  }finally{browser.restore()}
})
test('storage failure occurs during installation before any click can run',()=>{
  const browser=browserGlobals({storageFailure:true});let clicked=false
  try{assert.throws(()=>{installUiMutationObservation({key,operation});clicked=true},/storage unavailable/);assert.equal(clicked,false)}finally{browser.restore()}
})
test('initial committed about blank retains its actual URL rather than nullblank',()=>{
  const browser=browserGlobals()
  try {
    globalThis.location=new URL('about:blank')
    const snapshot=uiDocumentSnapshot();assert.equal(snapshot.url,'about:blank');assert.equal(snapshot.query,'')
    const diagnostics={topFrame:'frame',events:[{kind:'document-navigation',documentId:'blank',frameId:'frame',url:'about:blank'}],documents:[{id:'blank',frameId:'frame',url:'about:blank'}]}
    assert.equal(committedUiDocument(diagnostics,snapshot).id,'blank')
    assert.throws(()=>installUiMutationObservation({key,operation}),/same-origin HTTP/)
    assert.equal(browser.store.has(key),false)
  }finally{browser.restore()}
})
for(const url of ['data:text/html,empty','file:///tmp/read-only.html','https://foreign.invalid/ui/'])test('write observer rejects nonHTTP or foreign source '+url,()=>{
  const browser=browserGlobals()
  try{globalThis.location=new URL(url);assert.throws(()=>installUiMutationObservation({key,operation}),/same-origin HTTP/);assert.equal(browser.store.has(key),false)}finally{browser.restore()}
})
test('HTTP document snapshot separates query and removes fragment without changing origin/path',()=>{
  const browser=browserGlobals()
  try{globalThis.location=new URL(source.url+'?page=2#view');assert.deepEqual(uiDocumentSnapshot(),{path:source.path,url:source.url,query:'?page=2',timeOrigin:10})}finally{browser.restore()}
})

const stages=()=>Object.fromEntries([['staleEpoch401',401],['freshReadOnly403',403]].map(([name,status])=>[name,{completed:true,status,protectedStateUnchanged:true,sensitiveContentCleared:true,request:{requestId:name,source:{documentId:name},status,expectedStatuses:[status]},beforeEffects:{hash:'a'.repeat(64)},afterEffects:{hash:'a'.repeat(64)},...(status===401?{productionLogout:true,identity:{subjectHash:'b'.repeat(64),authorizationVersion:1}}:{credentialsSubmitted:true,noSaveEntry:true,transport:'browser-session-adversarial-request',identity:{subjectHash:'b'.repeat(64),authorizationVersion:2}})}]))
test('revoked editor requires distinct stale401 and fresh readonly403 stages',()=>assertRevokedEditorStages(stages()))
for(const [name,change] of [
  ['missing stale stage',value=>delete value.staleEpoch401],['missing fresh stage',value=>delete value.freshReadOnly403],
  ['fresh401',value=>{value.freshReadOnly403.status=401}],['old403',value=>{value.staleEpoch401.status=403}],
  ['reused identity',value=>{value.freshReadOnly403.credentialsSubmitted=false}],['write control visible',value=>{value.freshReadOnly403.noSaveEntry=false}],
  ['effects changed',value=>{value.staleEpoch401.afterEffects.hash='c'.repeat(64)}],['missing request',value=>delete value.freshReadOnly403.request],
  ['no logout',value=>{value.staleEpoch401.productionLogout=false}],['no readback',value=>{value.freshReadOnly403.protectedStateUnchanged=false}],
  ['stale epoch reused',value=>{value.freshReadOnly403.identity.authorizationVersion=1}],['wrong renewed subject',value=>{value.freshReadOnly403.identity.subjectHash='c'.repeat(64)}],
])test('revoked editor rejects '+name,()=>{const value=stages();change(value);assert.throws(()=>assertRevokedEditorStages(value))})
