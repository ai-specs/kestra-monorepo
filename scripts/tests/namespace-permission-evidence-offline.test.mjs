import test from 'node:test'
import assert from 'node:assert/strict'
import {namespacePermissionCaseIds} from '../namespace-permission-browser.mjs'
import {assertNamespacePermissionEvidence,assertNamespaceListEvidence} from '../namespace-permission-evidence.mjs'

function sample({automaticFinal=false}={}) {
  const base='http://localhost:8080',firstSubject='initial-admin',second='namespace_12345'
  const events=[],journey={completed:true,requests:[],cases:namespacePermissionCaseIds.map(id=>({id,status:'passed',passed:true,evidence:{}})),loginTransitions:[],logoutTransitions:[]}
  let documents=0,requests=0
  const makeDoc=path=>({path,documentId:'document-'+(++documents),timeOrigin:1000+documents*100})
  const emit=event=>{const value={...event,id:'event-'+events.length};events.push(value);return value}
  const nav=doc=>emit({kind:'document-navigation',url:base+doc.path,documentId:doc.documentId})
  const pair=(path,method,status,doc,{canonical=false,document=false}={})=>{
    const source={requestId:'request-'+(++requests),documentId:doc.documentId,url:base+path,method}
    emit({...source,kind:'request',resourceType:document?'Document':'Fetch'})
    const response=emit({...source,kind:status>=400?'http-error':'http-response',status})
    const reference={path,method,status,requestId:source.requestId,source:{documentId:doc.documentId},expectedStatuses:[status]}
    if(canonical)journey.requests.push(reference)
    return {response,reference}
  }
  const evidence=id=>journey.cases.find(row=>row.id===id).evidence
  Object.assign(evidence('second-account-control-plane-preparation'),{subject:second})
  Object.assign(evidence('second-account-password-change-and-login'),{subject:second})
  Object.assign(evidence('logout-switch-back-to-admin'),{subject:firstSubject})
  const effects={tables:Object.fromEntries(['flows','kv_metadata','executions','triggers','queues','execution_outputs','execution_queued'].map(table=>[table,{count:table==='flows'?2:0,sha256:'a'.repeat(64)}])),storage:'complete hash',
    coverage:{queues:'full-owner-table',execution_outputs:'full-owner-table',execution_queued:'full-owner-table',storage:'all-owner-files'}}
  function business(actor,doc) {
    for(const row of journey.cases) {
      if(!row.id.startsWith(actor+'-'))continue
      const saved=row.id.match(/^(admin|second)-(.+)-(flow|kv)-ui-save$/),denied=row.id.match(/^(admin|second)-(.+)-(flow|kv)-(read|create|update|delete)-denied$/)
      if(!saved&&!denied)continue
      const [,account,namespace,kind]=saved??denied,action=denied?.[4]
      const path=kind==='flow'?(action==='create'||saved&&account==='admin'?'/api/v1/main/flows':'/api/v1/main/flows/'+namespace+'/'+second):'/api/v1/main/namespaces/'+namespace+'/kv/'+second+(action==='create'?'_denied':'')
      const method=saved?(kind==='flow'&&actor==='admin'?'POST':'PUT'):action==='read'?'GET':action==='delete'?'DELETE':kind==='kv'?'PUT':action==='create'?'POST':'PUT'
      const {reference}=pair(path+(saved&&kind==='flow'?'?draft=false':''),method,saved?200:403,doc,{canonical:true})
      row.evidence=saved?{response:reference,transport:'native-ui',before:'old',value:'new',readBack:'new'}:
        {response:reference,before:structuredClone(effects),immediate:structuredClone(effects),samples:[{elapsedMs:100,snapshot:structuredClone(effects)},{elapsedMs:2500,snapshot:structuredClone(effects)}],minimumObservationMs:2500,observedMs:2500}
    }
  }
  function logout(current,{automatic=false}={}) {
    const denied=makeDoc('/ui/access-denied');pair(denied.path,'GET',automatic?307:200,denied,{document:true});if(!automatic)nav(denied)
    const doc=makeDoc('/oidc/login'),exit=pair('/oidc/logout','GET',307,doc,{document:true}).response
    pair(doc.path,'GET',200,doc,{document:true});nav(doc)
    const anon=pair('/api/v1/main/flows/search?size=1','GET',401,doc,{canonical:true}).reference
    journey.logoutTransitions.push({clicked:!automatic,automatic,finalDocument:doc,logoutResponses:[{id:exit.id,requestId:exit.requestId,documentId:exit.documentId,url:exit.url,status:exit.status}],anonymous:anon})
    return doc
  }
  function login(previous,index) {
    const anonymous=pair('/api/v1/main/flows/search?size=1','GET',401,previous,{canonical:true}).reference
    const doc=makeDoc('/oidc/login'),redirects=[]
    const redirect=(path,method,status,target)=>{
      const response=pair(path,method,status,target,{document:true}).response
      redirects.push({path,requestId:response.requestId,documentId:response.documentId,status})
    }
    redirect('/ui/main/flows','GET',307,doc);redirect('/oauth/login/kestra','GET',302,doc);redirect('/oidc/authorize','GET',307,doc);redirect('/oidc/login','GET',200,doc);nav(doc)
    const final=makeDoc(index===2?'/oidc/password':'/ui/main/flows')
    redirect('/oidc/login','POST',303,final)
    const listResponses=[]
    if(index===2)redirect('/oidc/password','GET',200,final)
    else {redirect('/oauth/callback/kestra','GET',303,final);redirect('/ui/main/flows','GET',200,final)}
    nav(final)
    if(index!==2){const r=pair('/api/v1/main/flows/search?page=1','GET',200,final).response;listResponses.push({requestId:r.requestId,documentId:r.documentId,status:200})}
    journey.loginTransitions.push({subject:[firstSubject,firstSubject,second,second,firstSubject][index],requestedTarget:'/ui/main/flows',temporaryPasswordFlow:index===2,anonymous,previousDocument:previous,loginDocument:doc,finalDocument:final,
      businessContent:index===2?'restricted-password-change-form':'visible-flow-list-and-native-response',redirects,listResponses})
    return final
  }
  const initial=makeDoc('/ui/main/kv');nav(initial);business('admin',initial)
  let current=initial
  for(let i=0;i<3;i++){current=logout(current,{automatic:i>0});current=login(current,i)}
  const changed=makeDoc('/oidc/login');pair('/oidc/password','POST',303,changed,{document:true});pair('/oidc/login','GET',200,changed,{document:true});nav(changed)
  current=login(changed,3);business('second',current)
  const rows=[{namespace:'company.sub',id:second},{namespace:'company.sub.child',id:second}]
  const list=evidence('second-exact-flow-kv-list-and-total')
  for(const kind of ['flow','kv'])list[kind]={total:2,rows:structuredClone(rows),namespaces:['company.sub','company.sub.child']}
  list.expectedLists={source:'owned-database',namespace:'company.sub',descendants:true,flow:structuredClone(rows),kv:structuredClone(rows)}
  const description='second_'+second+'_company.sub'
  list.flowDetail={transport:'production-ui',namespace:'company.sub',flowId:second,phases:[]}
  for(const name of ['overview-direct','overview-refresh','executions-direct']) {
    const overview=name!=='executions-direct',path='/ui/main/flows/edit/company.sub/'+second+'/'+(overview?'overview':'executions')
    const doc=makeDoc(path),start=events.length;nav(doc)
    pair('/api/v1/main/ui/flows/execution-capabilities','POST',200,doc)
    if(overview)pair('/api/v1/main/dashboards/charts/preview','POST',200,doc)
    list.flowDetail.phases.push({name,path,document:doc,dom:{denied:overview?9:1,errors:0,description:overview?description:null},eventIds:events.slice(start).map(event=>event.id)})
  }
  if(automaticFinal) {
    current=logout(current,{automatic:true});journey.logoutTransitions.pop()
    evidence('second-revocation-refresh-denied').response=pair('/api/v1/main/flows/company.sub/'+second,'GET',401,current,{canonical:true}).reference
  } else {
    const denied=makeDoc('/ui/access-denied');nav(denied)
    evidence('second-revocation-refresh-denied').response=pair('/api/v1/main/flows/company.sub/'+second,'GET',403,denied,{canonical:true}).reference
  }
  Object.assign(evidence('second-revocation-refresh-denied'),{path:automaticFinal?'/oidc/login':'/ui/access-denied',revocation:{subject:second,scopeKeys:[],verifiedOperator:{subject:firstSubject,applicationGroupId:'main'}}})
  if(!automaticFinal)current=logout(current)
  login(current,4)
  return {journey,caseJourney:structuredClone(journey),events,base,firstSubject}
}
const refresh=value=>{value.caseJourney=structuredClone(value.journey);return value}
test('exact source-attributed business and account matrix validates',()=>{
  assert.deepEqual(assertNamespacePermissionEvidence(sample()),{requests:62,logins:5,logouts:4,firstSubject:'initial-admin',secondSubject:'namespace_12345',independentLists:true})
})
test('revocation may automatically complete the final logout without an invented click',()=>{
  const summary=assertNamespacePermissionEvidence(sample({automaticFinal:true}));assert.equal(summary.logouts,3)
})
test('Overview refresh accepts the native time filter query while retaining its new document',()=>{
  const value=sample(),phase=value.journey.cases.find(row=>row.id==='second-exact-flow-kv-list-and-total').evidence.flowDetail.phases[1]
  const navigation=value.events.find(event=>event.kind==='document-navigation'&&event.documentId===phase.document.documentId)
  navigation.url+='?filters[timeRange][EQUALS]=PT24H'
  assertNamespacePermissionEvidence(refresh(value))
})
test('Overview direct accepts one chart for each same-document canonical URL state',()=>{
  const value=sample(),phase=value.journey.cases.find(row=>row.id==='second-exact-flow-kv-list-and-total').evidence.flowDetail.phases[0]
  const base='http://localhost:8080/ui/main/flows/edit/company.sub/namespace_12345/overview'
  const first=value.events.find(event=>event.kind==='request'&&event.documentId===phase.document.documentId&&event.url.endsWith('/charts/preview'))
  first.documentUrl=base
  const second={...first,id:'canonical-chart-request',requestId:'canonical-chart-response',documentUrl:base+'?filters[timeRange][EQUALS]=PT24H'}
  const response={...second,id:'canonical-chart-response',kind:'http-response',status:200,url:'http://localhost:8080/api/v1/main/dashboards/charts/preview'}
  const firstRoute={id:'overview-default-route',kind:'document-route',documentId:phase.document.documentId,url:base}
  const canonicalRoute={id:'overview-canonical-route',kind:'document-route',documentId:phase.document.documentId,url:base+'?filters[timeRange][EQUALS]=PT24H'}
  const boundary=value.events.findIndex(event=>event.id===phase.eventIds.at(-1))+1
  value.events.splice(boundary,0,firstRoute,canonicalRoute,second,response)
  phase.eventIds.push(firstRoute.id,canonicalRoute.id,second.id,response.id)
  assertNamespacePermissionEvidence(refresh(value))
  second.documentUrl=first.documentUrl
  assert.throws(()=>assertNamespacePermissionEvidence(refresh(value)),/same Flow Overview URL state/)
})
for(const [name,change,{copy=true}={}] of [
  ['missing production Flow detail matrix',value=>delete value.journey.cases.find(row=>row.id==='second-exact-flow-kv-list-and-total').evidence.flowDetail],
  ['missing Overview refresh',value=>value.journey.cases.find(row=>row.id==='second-exact-flow-kv-list-and-total').evidence.flowDetail.phases.splice(1,1)],
  ['Flow description silently hidden',value=>value.journey.cases.find(row=>row.id==='second-exact-flow-kv-list-and-total').evidence.flowDetail.phases[0].dom.description=null],
  ['Overview replaced with a single denial',value=>value.journey.cases.find(row=>row.id==='second-exact-flow-kv-list-and-total').evidence.flowDetail.phases[0].dom.denied=1],
  ['Flow detail wrong transport',value=>value.journey.cases.find(row=>row.id==='second-exact-flow-kv-list-and-total').evidence.flowDetail.transport='explicit-test-transport'],
  ['Flow detail source omitted',value=>value.journey.cases.find(row=>row.id==='second-exact-flow-kv-list-and-total').evidence.flowDetail.phases[0].eventIds.pop()],
  ['Flow detail from another document',value=>value.journey.cases.find(row=>row.id==='second-exact-flow-kv-list-and-total').evidence.flowDetail.phases[0].document.documentId='other-document'],
  ['Flow detail drops a forbidden request',value=>{
    const phase=value.journey.cases.find(row=>row.id==='second-exact-flow-kv-list-and-total').evidence.flowDetail.phases[0]
    value.events.push({id:'dropped-forbidden-runtime',kind:'request',requestId:'runtime-request',documentId:phase.document.documentId,method:'GET',url:value.base+'/api/v1/main/executions/search'})
  }],
  ['omitted business case',value=>value.journey.cases.pop()],
  ['different journey copies',value=>value.caseJourney.requests.pop(),{copy:false}],
  ['missing logout evidence',value=>delete value.journey.logoutTransitions],
  ['missing login evidence',value=>delete value.journey.loginTransitions],
  ['wrong bookmark target',value=>value.journey.loginTransitions[0].requestedTarget='/ui/main/dashboards'],
  ['login after manual dashboard repair',value=>value.journey.loginTransitions[3].finalDocument.path='/ui/main/dashboards'],
  ['wrong account order',value=>value.journey.loginTransitions[3].subject='initial-admin'],
  ['omitted temporary-password phase',value=>value.journey.loginTransitions[2].temporaryPasswordFlow=false],
  ['missing redirect source',value=>value.journey.loginTransitions[0].redirects=[]],
  ['orphan native list response',value=>value.journey.loginTransitions[0].listResponses[0].requestId='invented'],
  ['wrong native list document',value=>value.journey.loginTransitions[0].listResponses[0].documentId='other'],
  ['reused login source document',value=>value.journey.loginTransitions[0].finalDocument.documentId=value.journey.loginTransitions[0].loginDocument.documentId],
  ['logout without click or automatic redirect',value=>value.journey.logoutTransitions[0].automatic=true],
  ['wrong logout document',value=>value.journey.logoutTransitions[0].finalDocument.documentId='invented'],
  ['invented logout response',value=>value.journey.logoutTransitions[0].logoutResponses[0].requestId='invented'],
  ['first subject differs from production installation',value=>value.firstSubject='another-admin'],
  ['request assigned to a previous document',value=>value.journey.requests[0].source.documentId='previous-document'],
  ['case response disagrees with canonical source',value=>value.journey.cases[0].evidence.response={...value.journey.cases[0].evidence.response,source:{documentId:'different-document'}}],
  ['diagnostic response only exists outside supplied suffix',value=>{const id=value.journey.requests[0].requestId;value.events=value.events.filter(event=>event.requestId!==id)}],
  ['response original request has a different document',value=>{value.events.find(event=>event.kind==='request'&&event.requestId===value.journey.requests[0].requestId).documentId='other-document'}],
  ['missing request source',value=>delete value.journey.requests[0].source],
  ['invented request ID',value=>value.journey.requests[0].requestId='invented'],
  ['wrong exact URL',value=>value.journey.requests[0].path+='?invented=1'],
  ['duplicate report response',value=>value.journey.requests.push(value.journey.requests[0])],
  ['missing original diagnostic request',value=>value.events=value.events.filter(event=>event.id!=='event-1')],
  ['duplicate diagnostic response',value=>value.events.push({...value.events.find(event=>event.kind==='http-error'),id:'extra'})],
  ['revocation by wrong group',value=>value.journey.cases.find(row=>row.id==='second-revocation-refresh-denied').evidence.revocation.verifiedOperator.applicationGroupId='kestra'],
  ['narrowed queue observer',value=>delete value.journey.cases.find(row=>row.id==='admin-outside-kv-update-denied').evidence.before.coverage.queues],
  ['partial independent collection',value=>value.journey.cases.find(row=>row.id==='second-exact-flow-kv-list-and-total').evidence.flow.rows.pop()],
  ['forged lower total',value=>{const result=value.journey.cases.find(row=>row.id==='second-exact-flow-kv-list-and-total').evidence.flow;result.rows.pop();result.total--}],
])test('evidence rejects '+name,()=>{
  const value=sample();change(value);if(copy)refresh(value)
  assert.throws(()=>assertNamespacePermissionEvidence(value))
})
test('full list comparison rejects duplicate, outside, omitted and forged-total rows',()=>{
  const value=sample().journey.cases.find(row=>row.id==='second-exact-flow-kv-list-and-total').evidence
  assertNamespaceListEvidence(value,{namespaces:['company.sub','company.sub.child'],expectedLists:value.expectedLists})
  for(const mutate of [row=>row.rows.push(row.rows[0]),row=>row.rows[0].namespace='outside',row=>{row.rows.pop();row.total--},row=>row.total++]){
    const changed=structuredClone(value);mutate(changed.flow)
    assert.throws(()=>assertNamespaceListEvidence(changed,{namespaces:['company.sub','company.sub.child'],expectedLists:value.expectedLists}))
  }
})

test('automatic final exit requires actual same-origin logout evidence',()=>{
  const value=sample({automaticFinal:true})
  const finalLogin=value.journey.loginTransitions[4]
  const id=finalLogin.previousDocument.documentId
  value.events=value.events.filter(event=>!(event.documentId===id&&event.url===value.base+'/oidc/logout'))
  assert.throws(()=>assertNamespacePermissionEvidence(value))
})

const effectTables=['flows','kv_metadata','executions','triggers','queues','execution_outputs','execution_queued']
const deniedEffects=value=>value.journey.cases.find(row=>row.id==='admin-outside-kv-update-denied').evidence
const effectSnapshots=evidence=>[evidence.before,evidence.immediate,...evidence.samples.map(sample=>sample.snapshot)]

for(const table of effectTables) {
  for(const [name,mutate] of [
    ['missing table',tables=>delete tables[table]],
    ['legacy array',tables=>tables[table]=[]],
    ['null summary',tables=>tables[table]=null],
    ['string summary',tables=>tables[table]='empty-table'],
    ['missing count',tables=>delete tables[table].count],
    ['negative count',tables=>tables[table].count=-1],
    ['fractional count',tables=>tables[table].count=0.5],
    ['unsafe count',tables=>tables[table].count=Number.MAX_SAFE_INTEGER+1],
    ['string count',tables=>tables[table].count='0'],
    ['null count',tables=>tables[table].count=null],
    ['NaN count',tables=>tables[table].count=NaN],
    ['infinite count',tables=>tables[table].count=Infinity],
    ['missing digest',tables=>delete tables[table].sha256],
    ['empty-table digest',tables=>tables[table].sha256='empty-table'],
    ['empty digest',tables=>tables[table].sha256=''],
    ['short digest',tables=>tables[table].sha256='a'.repeat(63)],
    ['long digest',tables=>tables[table].sha256='a'.repeat(65)],
    ['nonhex digest',tables=>tables[table].sha256='g'.repeat(64)],
    ['numeric digest',tables=>tables[table].sha256=123],
    ['null digest',tables=>tables[table].sha256=null],
    ['extra summary field',tables=>tables[table].rows=[]],
  ])test('effect summary rejects '+table+' '+name+' even when every snapshot agrees',()=>{
    const value=sample()
    for(const snapshot of effectSnapshots(deniedEffects(value)))mutate(snapshot.tables)
    assert.throws(()=>assertNamespacePermissionEvidence(refresh(value)),/observed effect/)
  })
  for(const stage of ['immediate','delayed'])for(const field of ['count','sha256'])test('effect equality rejects '+table+' '+field+' change in '+stage,()=>{
    const value=sample(),evidence=deniedEffects(value)
    const snapshot=stage==='immediate'?evidence.immediate:evidence.samples.at(-1).snapshot
    snapshot.tables[table][field]=field==='count'?42:'b'.repeat(64)
    assert.throws(()=>assertNamespacePermissionEvidence(refresh(value)))
  })
}

test('effect summaries accept zero and maximum safe counts and mixed-case hex digests',()=>{
  const value=sample()
  for(const snapshot of effectSnapshots(deniedEffects(value))) {
    snapshot.tables.flows={count:0,sha256:'0123456789aAbBcC'.repeat(4)}
    snapshot.tables.queues={count:Number.MAX_SAFE_INTEGER,sha256:'F'.repeat(64)}
  }
  assertNamespacePermissionEvidence(refresh(value))
})

for(const [name,mutate] of [
  ['missing tables',snapshot=>delete snapshot.tables],
  ['array tables',snapshot=>snapshot.tables=[]],
])test('effect snapshot rejects '+name,()=>{
  const value=sample()
  for(const snapshot of effectSnapshots(deniedEffects(value)))mutate(snapshot)
  assert.throws(()=>assertNamespacePermissionEvidence(refresh(value)),/observed effect/)
})

for(const [name,mutate] of [
  ['short minimum window',evidence=>evidence.minimumObservationMs=2499],
  ['short observed window',evidence=>evidence.observedMs=2499],
  ['missing delayed samples',evidence=>evidence.samples=[]],
  ['only one delayed sample',evidence=>evidence.samples.splice(0,1)],
  ['nonincreasing sample times',evidence=>evidence.samples[1].elapsedMs=evidence.samples[0].elapsedMs],
  ['last sample before required window',evidence=>evidence.samples[1].elapsedMs=2499],
  ['last sample after observed window',evidence=>evidence.samples[1].elapsedMs=2501],
  ['immediate storage change',evidence=>evidence.immediate.storage='changed'],
  ['delayed storage change',evidence=>evidence.samples[1].snapshot.storage='changed'],
  ['immediate coverage change',evidence=>delete evidence.immediate.coverage.queues],
  ['delayed coverage change',evidence=>delete evidence.samples[1].snapshot.coverage.queues],
])test('effect evidence retains rejection of '+name,()=>{
  const value=sample();mutate(deniedEffects(value))
  assert.throws(()=>assertNamespacePermissionEvidence(refresh(value)))
})
