import test from 'node:test'
import assert from 'node:assert/strict'
import {loggedOutCapabilityDenials as classify} from '../zero-grant-logout-diagnostics.mjs'
const base='http://localhost:18128',time=n=>new Date(1700000000000+n).toISOString()
const fixture=()=>({base,anonymousDocument:{documentId:'login'},anonymousStatus:401,realSignOutClicked:true,events:[
  {id:'logout-request',kind:'request',documentId:'login',requestId:'logout',url:base+'/oidc/logout',method:'GET',frameId:'frame',observedAt:time(0)},
  {id:'logout-response',kind:'http-response',documentId:'login',requestId:'logout',url:base+'/oidc/logout',method:'GET',status:307,observedAt:time(10)},
  {id:'capability-request',kind:'request',documentId:'old-denial',documentUrl:base+'/ui/access-denied',requestId:'capability',url:base+'/api/v1/main/extensions/rbac/capabilities',method:'GET',frameId:'frame',observedAt:time(20)},
  {id:'denial',kind:'http-error',documentId:'old-denial',documentUrl:base+'/ui/access-denied',requestId:'capability',url:base+'/api/v1/main/extensions/rbac/capabilities',method:'GET',status:401,observedAt:time(30)},
  {id:'login-navigation',kind:'document-navigation',documentId:'login',url:base+'/oidc/login?from=[redacted]',frameId:'frame',observedAt:time(40)},
]})
test('late old-denial capability refusal requires actual same-frame logout and final login document',()=>assert.deepEqual(classify(fixture()).map(x=>x.id),['denial']))
for(const [name,mutate]of [
  ['no real logout click',x=>{x.realSignOutClicked=false}],
  ['anonymous session not proven cleared',x=>{x.anonymousStatus=403}],
  ['no final login navigation',x=>{x.events.pop()}],
  ['different final document',x=>{x.anonymousDocument.documentId='other'}],
  ['logout response absent',x=>{x.events.splice(1,1)}],
  ['unsuccessful logout',x=>{x.events[1].status=403}],
  ['wrong logout frame',x=>{x.events[0].frameId='other'}],
  ['wrong capability frame',x=>{x.events[2].frameId='other'}],
  ['request missing',x=>{x.events.splice(2,1)}],
  ['different source document',x=>{x.events[3].documentId='other'}],
  ['another request',x=>{x.events[3].requestId='other'}],
  ['current business page',x=>{x.events[3].documentUrl=base+'/ui/main/flows'}],
  ['business failure',x=>{x.events[3].url=base+'/api/v1/main/flows'}],
  ['POST failure',x=>{x.events[3].method='POST'}],
  ['authorization failure',x=>{x.events[3].status=403}],
  ['failure before logout',x=>{x.events[3].observedAt=time(5)}],
  ['late unrelated failure',x=>{x.events[3].observedAt=time(5000)}],
  ['navigation before failure',x=>{x.events.splice(2,0,x.events.pop())}],
])test(name+' stays unclassified',()=>{const x=fixture();mutate(x);assert.equal(classify(x).length,0)})
