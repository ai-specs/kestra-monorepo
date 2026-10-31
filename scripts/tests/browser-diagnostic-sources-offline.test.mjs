import test from 'node:test'
import assert from 'node:assert/strict'
import {classifyAccessControlDiagnostics as classify} from '../access-control-browser-diagnostics.mjs'
const base='http://localhost:18128',time=offset=>new Date(1700000000000+offset).toISOString()
const event=(id,kind,props={})=>({id,kind,documentId:'old',url:base+'/api/v1/main/extensions/rbac/capabilities',documentUrl:base+'/ui/main/extensions/rbac/application-groups/kestra',observedAt:time(100),requestId:'r1',method:'GET',...props})
const request=event('r','request',{frameId:'frame',observedAt:time(0)})
const abort=event('a','request-failed',{message:'net::ERR_ABORTED',cancelled:true})
const navigation=event('n','document-navigation',{documentId:'new',frameId:'frame',url:base+'/ui/main/kv',observedAt:time(110),requestId:undefined})
const run=(events,extra={})=>classify({events,base,...extra})
test('same request, old document and same frame unload identify a cancelled GET',()=>{
  const result=run([request,abort,navigation]);assert.equal(result.errors.length,0);assert.equal(result.classifications[0].evidence.navigationEventId,'n')
})
for(const [name,mutate]of [
  ['missing original request',events=>events.shift()],
  ['different request ID',events=>{events[1].requestId='other'}],
  ['different source document',events=>{events[1].documentId='other'}],
  ['different target frame',events=>{events[2].frameId='other'}],
  ['same current document',events=>{events[2].documentId='old'}],
  ['late unrelated navigation',events=>{events[2].observedAt=time(5000)}],
  ['uncancelled network failure',events=>{events[1].cancelled=false}],
  ['business POST is never a read cancellation',events=>{events[0].method=events[1].method='POST'}],
  ['non-abort failure',events=>{events[1].message='net::ERR_CONNECTION_RESET'}],
])test(name+' remains failed',()=>{const events=structuredClone([request,abort,navigation]);mutate(events);assert.equal(run(events).errors.length,1)})
const mutation=event('mutation','http-response',{requestId:'m1',url:base+'/api/v1/main/extensions/rbac/application-groups/kestra/scope-grants/detail?subject=test',method:'PUT',status:200,observedAt:time(0)})
const denied=event('denied','http-error',{status:403,message:'HTTP 403'})
const confirmed={requestId:'m1',source:{documentId:'old'},path:mutation.url.slice(base.length),method:'PUT',status:200,expectedStatuses:[200],postWriteView:{reauthenticationRequired:true,businessContentHidden:true}}
const mutationEvidence=()=>({requests:[structuredClone(confirmed),{requestId:'fresh',source:{documentId:'fresh-doc'},path:'/api/v1/main/extensions/rbac/capabilities',method:'GET',status:200,expectedStatuses:[200]}],identityWindows:[{id:'old-session',kind:'authenticated-session',startedAt:time(-100),finishedAt:time(200),subjectHash:'a'.repeat(64),documentIds:['old']},{id:'fresh-login',kind:'production-login',startedAt:time(200),finishedAt:time(500),authenticatedAt:time(300),subjectHash:'a'.repeat(64),documentIds:['fresh-doc']}]})
test('old projection refusal requires a confirmed same-document business mutation',()=>{const result=run([request,mutation,denied],mutationEvidence());assert.equal(result.errors.length,0);assert.equal(result.classifications[0].evidence.mutationRequestId,'m1')})
for(const [name,mutate]of [
  ['unconfirmed mutation',options=>{options.requests=[]}],
  ['other document mutation',options=>{options.events[1].documentId='other'}],
  ['failed mutation',options=>{options.events[1].status=403}],
  ['late denial',options=>{options.events[2].observedAt=time(5000)}],
  ['no visible reauthentication',options=>{options.requests[0].postWriteView.reauthenticationRequired=false}],
  ['stale content still visible',options=>{options.requests[0].postWriteView.businessContentHidden=false}],
  ['different mutation request',options=>{options.requests[0].requestId='other'}],
  ['no fresh verified recovery',options=>{options.requests.pop()}],
  ['different recovered identity',options=>{options.identityWindows[1].subjectHash='b'.repeat(64)}],
  ['metadata-only scope write',options=>{options.events[1].url=base+'/api/v1/main/extensions/rbac/application-groups/kestra/scopes/a';options.requests[0].path=options.events[1].url.slice(base.length)}],
])test(name+' cannot classify a capability refusal',()=>{const options=structuredClone({events:[request,mutation,denied],...mutationEvidence()});mutate(options);assert.equal(classify({base,...options}).errors.length,1)})
const configRequest=event('cr','request',{url:base+'/api/v1/configs'})
const configDenied=event('cd','http-error',{url:configRequest.url,status:403,message:'HTTP 403'})
const identity={id:'identity',kind:'authenticated-session',startedAt:time(0),finishedAt:time(200),subjectHash:'a'.repeat(64),businessAdmin:false,documentIds:['old']}
test('known restricted production identity explains only its host config GET',()=>assert.equal(run([configRequest,configDenied],{identityWindows:[identity]}).errors.length,0))
for(const [name,change]of [['admin',{businessAdmin:true}],['unknown identity',{subjectHash:null}],['other document',{documentIds:['other']}],['expired window',{finishedAt:time(1)}]])test(name+' cannot excuse config failure',()=>assert.equal(run([configRequest,configDenied],{identityWindows:[{...identity,...change}]}).errors.length,1))
test('page error and integrity error always fail even alongside genuine unload',()=>assert.equal(run([request,abort,navigation,event('p','page-error',{message:'Extension navigation rejected'}),event('i','diagnostic-integrity-error',{message:'missing source'})]).errors.length,2))
test('network console must link to the exact classified response',()=>{
  const consoleEvent=event('c','console-error',{source:'network',message:'Failed to load resource: the server responded with a status of 403 (Forbidden)'})
  assert.equal(run([request,mutation,denied,consoleEvent],mutationEvidence()).errors.length,0)
  assert.equal(run([request,mutation,denied,{...consoleEvent,requestId:'other'}],mutationEvidence()).errors.length,1)
})
test('native read-only POST cancellation still requires exact old document and frame navigation',()=>{
  const url=base+'/api/v1/main/dashboards/charts/preview'
  assert.equal(run([{...request,url,method:'POST'},{...abort,url,method:'POST'},navigation]).errors.length,0)
  assert.equal(run([{...request,url,method:'POST'},{...abort,url,method:'POST'}]).errors.length,1)
})
test('host fetch console requires matched unload source and host asset stack',()=>{
  const stack=[{url:base+'/ui/assets/app.js',functionName:'verifyAuthentication',line:3}]
  const consoleEvent=event('console','console-error',{requestId:undefined,message:'Error during authentication check: TypeError: Failed to fetch\ntrace',stack})
  assert.equal(run([{...request,initiatorStack:stack},abort,navigation,consoleEvent]).errors.length,0)
  assert.equal(run([request,abort,navigation,{...consoleEvent,documentId:'other'}]).errors.length,1)
  assert.equal(run([request,abort,navigation,{...consoleEvent,stack:[{url:'https://other/app.js'}]}]).errors.length,1)
  assert.equal(run([{...request,initiatorStack:stack},abort,navigation,{...consoleEvent,stack:[{url:base+'/ui/assets/other.js',functionName:'different',line:3}]}]).errors.length,1)
})
test('same URL refusal from another request cannot borrow an explicit expected denial',()=>{
  const expected={requestId:'r1',source:{documentId:'old'},path:request.url.slice(base.length),method:'GET',status:403,expectedStatuses:[403]}
  assert.equal(run([request,denied],{requests:[expected]}).errors.length,0)
  assert.equal(run([{...request,requestId:'other'},{...denied,requestId:'other'}],{requests:[expected]}).errors.length,1)
  assert.equal(run([denied],{requests:[expected]}).errors.length,1)
})
test('explicit public credential 400 network console requires exact response identity',()=>{
  const response={...denied,status:400},consoleEvent=event('console','console-error',{source:'network',message:'Failed to load resource: the server responded with a status of 400 (Bad Request)'})
  const expected={requestId:'r1',source:{documentId:'old'},path:request.url.slice(base.length),method:'GET',status:400,expectedStatuses:[400]}
  assert.equal(run([request,response,consoleEvent],{requests:[expected]}).errors.length,0)
})
test('denial-page capability probe requires the explicit production logout/login window',()=>{
  const denial=event('denied','http-error',{status:401,documentUrl:base+'/ui/access-denied',message:'HTTP 401'})
  const logout=event('logout','http-response',{url:base+'/oidc/logout',status:307})
  assert.equal(run([request,denial,logout],{identityWindows:[{...identity,kind:'production-login',logoutEventId:'logout'}]}).errors.length,0)
  assert.equal(run([request,denial],{identityWindows:[identity]}).errors.length,1)
  assert.equal(run([request,{...denial,documentUrl:base+'/ui/main/flows'}],{identityWindows:[{...identity,kind:'production-login'}]}).errors.length,1)
})
test('earlier nearby navigation cannot excuse a later current-document failure',()=>assert.equal(run([navigation,request,abort]).errors.length,1))
test('target restricted account does not excuse pre-login previous identity config failure',()=>{
  const window={...identity,kind:'production-login',authenticatedAt:time(150)}
  assert.equal(run([configRequest,configDenied],{identityWindows:[window]}).errors.length,1)
  assert.equal(run([configRequest,configDenied],{identityWindows:[{...window,authenticatedAt:time(50)}]}).errors.length,0)
})
test('canonical host manifest cancellation requires different same-document route and successful replacement',()=>{
  const url=base+'/ui-extensions/main/manifest',r={...request,url},a={...abort,url}
  const route=event('route','document-route',{url:base+'/ui/main/extensions/rbac/application-groups/kestra/applications/~a2VzdHJh',observedAt:time(110)})
  const replacement=event('replacement','http-response',{url,requestId:'new-request',status:200,observedAt:time(120)})
  assert.equal(run([r,a,route,replacement]).errors.length,0)
  assert.equal(run([r,a,route]).errors.length,1)
  assert.equal(run([r,a,replacement]).errors.length,1)
  assert.equal(run([r,a,route,{...replacement,documentId:'other'}]).errors.length,1)
})
test('error message stack may identify originating fetch instead of console logging call stack',()=>{
  const origin={url:base+'/ui/assets/app.js',functionName:'fetchIdentity',line:2,column:3}
  const consoleEvent=event('console','console-error',{requestId:undefined,message:'Error during authentication check: TypeError: Failed to fetch\n    at fetchIdentity ('+origin.url+':3:4)',stack:[{url:base+'/ui/assets/app.js',functionName:'logError',line:100}]})
  assert.equal(run([{...request,initiatorStack:[origin]},abort,navigation,consoleEvent]).errors.length,0)
  assert.equal(run([{...request,initiatorStack:[{...origin,functionName:'other'}]},abort,navigation,consoleEvent]).errors.length,1)
})
test('host login-config fetch console must share exact originating stack and proven unload',()=>{
  const url=base+'/api/v1/configs/login',origin={url:base+'/ui/assets/vendor-frozen.js',functionName:'loadConfig',line:13,column:15182}
  const consoleEvent=event('console','console-error',{requestId:undefined,message:'Error during authentication check: TypeError: Failed to fetch\n    at loadConfig ('+origin.url+':14:15183)',stack:[{url:base+'/ui/assets/app.js',functionName:'logError',line:100}]})
  assert.equal(run([{...request,url,initiatorStack:[origin]},{...abort,url},navigation,consoleEvent]).errors.length,0)
  assert.equal(run([{...request,url,initiatorStack:[origin]},{...abort,url},consoleEvent]).errors.length,2)
})
test('once-only deliberately dropped response console cannot excuse any other network failure',()=>{
  const failed={...abort,message:'net::ERR_FAILED'},consoleEvent=event('console','console-error',{source:'network',message:'Failed to load resource: net::ERR_FAILED'})
  const expectedTransportFailures=[{case:'ui-secret-response-lost-once',requestId:'r1',documentId:'old',url:request.url,message:'net::ERR_FAILED'}]
  assert.equal(run([request,failed,consoleEvent],{expectedTransportFailures}).errors.length,0)
  assert.equal(run([request,failed,consoleEvent]).errors.length,2)
})
function canonicalCapabilities() {
  const documentUrl=base+'/ui/main/extensions/rbac/application-groups/kestra/applications'
  const initiatorStack=[{url:base+'/ui/assets/app-frozen.js',functionName:'fetchIdentity',line:1,column:12}]
  return [event('request','request',{documentUrl,frameId:'frame',resourceType:'Fetch',initiatorStack,observedAt:time(0)}),event('abort','request-failed',{documentUrl,resourceType:'Fetch',message:'net::ERR_ABORTED',cancelled:true}),event('replacement-request','request',{documentUrl,frameId:'frame',requestId:'replacement',resourceType:'Fetch',initiatorStack,observedAt:time(120)}),event('replacement-response','http-response',{documentUrl,requestId:'replacement',method:'GET',status:200,observedAt:time(140)}),event('canonical','document-route',{url:documentUrl+'/~a2VzdHJhLXVp',observedAt:time(160)})]
}
test('host capability cancellation requires exact canonical selection and replacement host fetch',()=>assert.equal(run(canonicalCapabilities()).errors.length,0))
for(const [name,mutate]of [
  ['no replacement',events=>{events.splice(2,2)}],
  ['failed replacement',events=>{events[3].status=403}],
  ['different document',events=>{events[3].documentId='other'}],
  ['different initiator',events=>{events[2].initiatorStack=[{url:base+'/ui/assets/other.js',functionName:'other',line:1,column:12}]}],
  ['unrelated route',events=>{events[4].url=base+'/ui/main/kv'}],
  ['no canonical route',events=>{events.pop()}],
  ['wrong canonical group',events=>{events[4].url=base+'/ui/main/extensions/rbac/application-groups/other/applications/~YQ'}],
  ['late replacement',events=>{events[3].observedAt=time(5000)}],
])test(name+' cannot excuse cancelled capabilities',()=>{const events=canonicalCapabilities();mutate(events);assert(run(events).errors.some(event=>event.id==='abort'))})
