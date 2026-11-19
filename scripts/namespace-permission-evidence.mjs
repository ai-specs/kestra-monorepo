import assert from 'node:assert/strict'
import {assertNamespaceFlowDetailEvidence} from './namespace-flow-detail-browser.mjs'

export const namespacePermissionNamespaces=Object.freeze(['company','company.sub','company.sub.child','company.other','company2','outside'])
export const namespacePermissionCaseIds=Object.freeze([
  ...['company','company.sub'].flatMap(ns=>['flow','kv'].map(kind=>`admin-${ns}-${kind}-ui-save`)),
  'outside-baselines-control-plane',
  'admin-global-flow-kv-list-and-details',
  ...['company2','outside'].flatMap(ns=>['flow','kv'].flatMap(kind=>['create','update','delete'].map(action=>`admin-${ns}-${kind}-${action}-denied`))),
  'second-account-control-plane-preparation', 'second-account-password-change-and-login',
  ...['company.sub','company.sub.child'].flatMap(ns=>['flow','kv'].map(kind=>`second-${ns}-${kind}-ui-save`)),
  'second-exact-flow-kv-list-and-total',
  ...['company','company.other','company2','outside'].flatMap(ns=>['flow','kv'].flatMap(kind=>['read','create','update','delete'].map(action=>`second-${ns}-${kind}-${action}-denied`))),
  'second-revocation-refresh-denied', 'logout-switch-back-to-admin',
])

const nonempty=(value,label)=>assert(typeof value==='string'&&value.length>0,label)
const responseKinds=new Set(['http-response','http-error'])
const identity=request=>JSON.stringify([request.requestId,request.source?.documentId,request.path,request.method,request.status])
const sortedRows=rows=>rows.map(row=>({namespace:row.namespace,id:row.id})).sort((a,b)=>a.namespace.localeCompare(b.namespace)||a.id.localeCompare(b.id))

export function assertNamespaceListEvidence(evidence,{namespaces,expectedLists}) {
  assert.equal(expectedLists?.source,'owned-database')
  assert.equal(expectedLists.namespace,'company.sub');assert.equal(expectedLists.descendants,true)
  for(const kind of ['flow','kv']) {
    const result=evidence?.[kind],expected=expectedLists[kind]
    assert(Array.isArray(result?.rows)&&Array.isArray(expected),'Complete observed '+kind+' collection required')
    assert.deepEqual(result.namespaces,namespaces)
    assert(Number.isSafeInteger(result.total)&&result.total>=0)
    assert.equal(result.total,result.rows.length,'Paged '+kind+' count differs from total')
    for(const rows of [result.rows,expected]) {
      const keys=rows.map(row=>{nonempty(row.namespace,'namespace');nonempty(row.id,'resource ID');return JSON.stringify([row.namespace,row.id])})
      assert.equal(new Set(keys).size,keys.length,'Duplicate '+kind+' resource in complete collection')
      assert(rows.every(row=>row.namespace==='company.sub'||row.namespace.startsWith('company.sub.')),'Out-of-scope '+kind+' row')
    }
    assert.deepEqual(sortedRows(result.rows),sortedRows(expected),'Authorized '+kind+' collection differs from independent database observation')
  }
  return true
}

// No browser transport and no diagnostic classification belongs here. The caller
// supplies the exact immutable diagnostic suffix for this production journey.
export function assertNamespacePermissionEvidence({journey,caseJourney,events,base,firstSubject}) {
  assert.equal(new URL(base).origin,base)
  nonempty(firstSubject,'First production subject required')
  assert.deepEqual(journey,caseJourney,'Top-level and case journey copies differ')
  assert.equal(journey?.completed,true)
  assert(Array.isArray(journey.cases)&&journey.cases.every(row=>row.status==='passed'&&row.passed===true))
  assert.deepEqual(journey.cases.map(row=>row.id),namespacePermissionCaseIds,'Named business matrix differs')
  assert.equal(new Set(journey.cases.map(row=>row.id)).size,journey.cases.length)
  const evidence=id=>{const rows=journey.cases.filter(row=>row.id===id);assert.equal(rows.length,1,'Missing or duplicate case '+id);return rows[0].evidence}
  const secondSubject=evidence('second-account-control-plane-preparation').subject
  assert.match(secondSubject,/^namespace_[0-9]+$/)
  assert.notEqual(firstSubject,secondSubject)
  assert.equal(evidence('second-account-password-change-and-login').subject,secondSubject)
  assert.equal(evidence('logout-switch-back-to-admin').subject,firstSubject)
  assert(Array.isArray(events)&&events.length>0)
  assert.equal(new Set(events.map(event=>event.id)).size,events.length,'Duplicate diagnostic event ID')
  const order=new Map(events.map((event,index)=>[event.id,index]))
  const sameOriginPath=event=>{try{const url=new URL(event.url);return url.origin===base?url.pathname:null}catch{return null}}
  const originalFor=response=>{
    const requests=events.filter(event=>event.kind==='request'&&event.requestId===response.requestId&&event.documentId===response.documentId&&event.url===response.url&&event.method===response.method)
    assert.equal(requests.length,1,'Exact original diagnostic request missing or duplicated')
    assert(order.get(requests[0].id)<order.get(response.id),'Response precedes its request')
    return requests[0]
  }
  const exactReference=(reference,{path,method,status,documentId}={})=>{
    nonempty(reference?.requestId,'Request reference lacks request ID')
    nonempty(reference?.source?.documentId,'Request reference lacks source document ID')
    assert(typeof reference.path==='string'&&reference.path.startsWith('/')&&!reference.path.startsWith('//'))
    assert.equal(new URL(reference.path,base).origin,base)
    if(path!==undefined)assert.equal(reference.path,path)
    if(method!==undefined)assert.equal(reference.method,method)
    if(status!==undefined)assert.equal(reference.status,status)
    if(documentId!==undefined)assert.equal(reference.source.documentId,documentId)
    assert(Array.isArray(reference.expectedStatuses)&&reference.expectedStatuses.includes(reference.status))
    const responses=events.filter(event=>responseKinds.has(event.kind)&&event.requestId===reference.requestId&&event.documentId===reference.source.documentId
      &&event.url===base+reference.path&&event.method===reference.method&&event.status===reference.status)
    assert.equal(responses.length,1,'Exact diagnostic response missing or duplicated: '+reference.method+' '+reference.path)
    originalFor(responses[0]);return responses[0]
  }
  const requests=journey.requests
  assert(Array.isArray(requests)&&requests.length>0)
  assert.equal(new Set(requests.map(identity)).size,requests.length,'Duplicate report request reference')
  for(const request of requests)exactReference(request)
  const ownedReference=(reference,expected)=>{
    assert.equal(requests.filter(item=>identity(item)===identity(reference)).length,1,'Case/session response is absent from the canonical request collection')
    assert.deepEqual(requests.find(item=>identity(item)===identity(reference)),reference)
    return exactReference(reference,expected)
  }
  const nav=(document,path)=>{
    nonempty(document?.documentId,'Document reference missing identity')
    assert.equal(document.path,path)
    assert(Number.isFinite(document.timeOrigin)&&document.timeOrigin>0,'Document time origin missing')
    const rows=events.filter(event=>['document-navigation','document-route'].includes(event.kind)&&event.documentId===document.documentId&&sameOriginPath(event)===path)
    assert(rows.length>0,'Referenced document/path never appeared in diagnostics')
    return rows.at(-1)
  }
  const pathResponse=(reference,path,status)=>{
    nonempty(reference?.requestId,'Redirect response request ID missing');nonempty(reference?.documentId,'Redirect response document ID missing')
    assert.equal(reference.path,path);assert.equal(reference.status,status)
    const rows=events.filter(event=>responseKinds.has(event.kind)&&event.requestId===reference.requestId&&event.documentId===reference.documentId&&event.status===status&&sameOriginPath(event)===path)
    assert.equal(rows.length,1,'Redirect/native response reference missing or ambiguous')
    originalFor(rows[0]);return rows[0]
  }
  const login=journey.loginTransitions
  assert.equal(login?.length,5,'All five production login transitions are required')
  const subjects=[firstSubject,firstSubject,secondSubject,secondSubject,firstSubject]
  const loginBounds=[]
  for(const [index,transition] of login.entries()) {
    assert.equal(transition.subject,subjects[index],'Login subject/order differs')
    assert.equal(transition.temporaryPasswordFlow,index===2,'Temporary password step moved or omitted')
    assert.equal(transition.requestedTarget,'/ui/main/flows')
    const anonymous=ownedReference(transition.anonymous,{path:'/api/v1/main/flows/search?size=1',method:'GET',status:401,documentId:transition.previousDocument.documentId})
    nav(transition.previousDocument,'/oidc/login')
    const loginNav=nav(transition.loginDocument,'/oidc/login')
    const finalPath=index===2?'/oidc/password':'/ui/main/flows'
    const finalNav=nav(transition.finalDocument,finalPath)
    assert.notEqual(transition.previousDocument.documentId,transition.loginDocument.documentId,'Bookmark did not load a new login document')
    assert.notEqual(transition.loginDocument.documentId,transition.finalDocument.documentId,'Login source document was reused as callback evidence')
    assert(transition.loginDocument.timeOrigin>transition.previousDocument.timeOrigin&&transition.finalDocument.timeOrigin>transition.loginDocument.timeOrigin)
    const bookmark=events.filter(event=>event.kind==='request'&&event.method==='GET'&&event.url===base+transition.requestedTarget
      &&order.get(event.id)>order.get(anonymous.id)&&order.get(event.id)<order.get(loginNav.id))
    assert.equal(bookmark.length,1,'Anonymous target document request missing or ambiguous')
    assert.equal(bookmark[0].resourceType,'Document')
    assert(Array.isArray(transition.redirects)&&transition.redirects.length>0)
    const redirects=transition.redirects.map(item=>pathResponse(item,item.path,item.status))
    assert.equal(new Set(redirects.map(row=>row.id)).size,redirects.length,'Duplicate redirect evidence')
    const loginPage=redirects.filter(row=>sameOriginPath(row)==='/oidc/login'&&row.method==='GET'&&row.status===200&&row.documentId===transition.loginDocument.documentId)
    const submit=redirects.filter(row=>sameOriginPath(row)==='/oidc/login'&&row.method==='POST'&&row.status===303)
    assert.equal(loginPage.length,1);assert.equal(submit.length,1)
    assert(order.get(bookmark[0].id)<order.get(loginPage[0].id)&&order.get(loginPage[0].id)<order.get(submit[0].id)&&order.get(submit[0].id)<order.get(finalNav.id))
    assert.equal(transition.businessContent,index===2?'restricted-password-change-form':'visible-flow-list-and-native-response')
    if(index!==2) {
      assert(redirects.some(row=>sameOriginPath(row)==='/oauth/callback/kestra'&&[302,303,307].includes(row.status)),'Production OAuth callback missing')
      assert(transition.listResponses.length>0)
      const nativeIds=[]
      for(const ref of transition.listResponses) {
        const rows=events.filter(event=>event.kind==='http-response'&&event.requestId===ref.requestId&&event.documentId===ref.documentId&&event.documentId===transition.finalDocument.documentId
          &&event.method==='GET'&&event.status===200&&sameOriginPath(event)==='/api/v1/main/flows/search')
        assert.equal(ref.status,200);assert.equal(rows.length,1,'Final native Flow list response missing')
        originalFor(rows[0]);nativeIds.push(rows[0].id)
        assert(order.get(rows[0].id)>order.get(submit[0].id))
      }
      assert.equal(new Set(nativeIds).size,nativeIds.length)
    } else assert(redirects.some(row=>sameOriginPath(row)==='/oidc/password'&&row.status===200))
    loginBounds.push({anonymous:order.get(anonymous.id),submit:order.get(submit[0].id),final:order.get(finalNav.id)})
    if(index>0)assert(loginBounds[index-1].final<loginBounds[index].anonymous,'Login transitions overlap or are reordered')
  }
  const passwordChanges=events.filter(event=>event.kind==='http-response'&&event.method==='POST'&&event.status===303&&sameOriginPath(event)==='/oidc/password'
    &&order.get(event.id)>loginBounds[2].final&&order.get(event.id)<loginBounds[3].anonymous)
  assert.equal(passwordChanges.length,1,'Forced password change did not complete between the two second-account logins')
  originalFor(passwordChanges[0])

  const logout=journey.logoutTransitions
  assert(Array.isArray(logout)&&[3,4].includes(logout.length),'Three preparation exits and the conditional final exit must be retained')
  for(const [index,transition] of logout.entries()) {
    assert.equal(typeof transition.clicked,'boolean');assert.equal(transition.automatic,!transition.clicked)
    const targetLogin=index===3?4:index
    const loginDocument=nav(transition.finalDocument,'/oidc/login')
    assert.equal(transition.finalDocument.documentId,login[targetLogin].previousDocument.documentId,'Logout/login chain changed account stage')
    const anonymous=ownedReference(transition.anonymous,{path:'/api/v1/main/flows/search?size=1',method:'GET',status:401,documentId:transition.finalDocument.documentId})
    assert(order.get(anonymous.id)>order.get(loginDocument.id)&&order.get(anonymous.id)<loginBounds[targetLogin].anonymous)
    assert(transition.logoutResponses.length>0)
    const exits=transition.logoutResponses.map(ref=>{
      assert.equal(ref.url,base+'/oidc/logout');assert.equal(ref.status,307)
      const response=pathResponse({...ref,path:'/oidc/logout'},'/oidc/logout',307)
      assert.equal(ref.id,response.id);assert.equal(response.method,'GET')
      assert(order.get(response.id)<order.get(loginDocument.id))
      return response
    })
    const lower=index===0?-1:loginBounds[index===3?3:index-1].final
    const denied=events.filter(event=>event.kind==='http-response'&&event.method==='GET'&&event.status===(transition.clicked?200:307)&&sameOriginPath(event)==='/ui/access-denied'
      &&order.get(event.id)>lower&&order.get(event.id)<order.get(exits[0].id))
    assert(denied.length>0,'Exit lacks its actual denial page/automatic redirect source')
    assert(exits.every(event=>order.get(event.id)>lower))
  }
  const revoked=evidence('second-revocation-refresh-denied')
  const revocation=revoked.revocation
  assert.equal(revocation.verifiedOperator?.applicationGroupId,'main');assert.equal(revocation.verifiedOperator.subject,firstSubject)
  assert.equal(revocation.subject,secondSubject);assert.deepEqual(revocation.scopeKeys,[])
  const rejected=ownedReference(revoked.response,{path:'/api/v1/main/flows/company.sub/'+secondSubject,method:'GET'})
  assert([401,403].includes(rejected.status));assert(order.get(rejected.id)>loginBounds[3].final&&order.get(rejected.id)<loginBounds[4].anonymous)
  if(logout.length===3) {
    assert.equal(revoked.path,'/oidc/login')
    assert.equal(revoked.response.source.documentId,login[4].previousDocument.documentId)
    assert(events.some(event=>event.kind==='http-response'&&event.method==='GET'&&event.status===307&&sameOriginPath(event)==='/oidc/logout'
      &&order.get(event.id)>loginBounds[3].final&&order.get(event.id)<loginBounds[4].anonymous),'Revoked session lacks actual automatic logout')
  }
  const businessResponses=new Set()
  for(const row of journey.cases) {
    const saved=row.id.match(/^(admin|second)-(.+)-(flow|kv)-ui-save$/)
    const denied=row.id.match(/^(admin|second)-(.+)-(flow|kv)-(read|create|update|delete)-denied$/)
    if(!saved&&!denied)continue
    const [,actor,namespace,kind]=saved??denied
    let response
    if(saved) {
      const path=kind==='flow'?(actor==='admin'?'/api/v1/main/flows':'/api/v1/main/flows/'+namespace+'/'+secondSubject)
        :'/api/v1/main/namespaces/'+namespace+'/kv/'+secondSubject
      const method=kind==='flow'&&actor==='admin'?'POST':'PUT'
      assert([path,...(kind==='flow'?[path+'?draft=false']:[])].includes(row.evidence.response.path))
      response=ownedReference(row.evidence.response,{method})
      assert(response.status>=200&&response.status<300)
      assert.equal(row.evidence.transport,'native-ui')
      assert.equal(row.evidence.value,row.evidence.readBack);assert.notEqual(row.evidence.before,row.evidence.value)
    } else {
      const action=denied[4]
      const path=kind==='flow'?(action==='create'?'/api/v1/main/flows':'/api/v1/main/flows/'+namespace+'/'+secondSubject)
        :'/api/v1/main/namespaces/'+namespace+'/kv/'+secondSubject+(action==='create'?'_denied':'')
      const method=action==='read'?'GET':action==='delete'?'DELETE':kind==='kv'?'PUT':action==='create'?'POST':'PUT'
      response=ownedReference(row.evidence.response,{path,method,status:403})
      const deniedEvidence=row.evidence
      assert(deniedEvidence.before&&typeof deniedEvidence.before.storage==='string')
      for(const table of ['flows','kv_metadata','executions','triggers','queues','execution_outputs','execution_queued'])assert(Array.isArray(deniedEvidence.before.tables?.[table]),'Missing observed effect table '+table)
      assert.deepEqual(deniedEvidence.before.coverage,{queues:'full-owner-table',execution_outputs:'full-owner-table',execution_queued:'full-owner-table',storage:'all-owner-files'})
      assert.deepEqual(deniedEvidence.before,deniedEvidence.immediate)
      assert(deniedEvidence.samples.length>=2&&deniedEvidence.minimumObservationMs>=2500&&deniedEvidence.observedMs>=deniedEvidence.minimumObservationMs)
      let elapsed=-1
      for(const sample of deniedEvidence.samples){assert(sample.elapsedMs>elapsed);elapsed=sample.elapsedMs;assert.deepEqual(sample.snapshot,deniedEvidence.before)}
      assert(elapsed>=deniedEvidence.minimumObservationMs&&elapsed<=deniedEvidence.observedMs)
    }
    assert(!businessResponses.has(response.id),'One response was reused for multiple business cases');businessResponses.add(response.id)
    assert(actor==='admin'?order.get(response.id)<loginBounds[0].anonymous:
      order.get(response.id)>loginBounds[3].final&&order.get(response.id)<order.get(rejected.id),'Business case belongs to another account stage')
  }
  const list=evidence('second-exact-flow-kv-list-and-total')
  assertNamespaceListEvidence(list,{namespaces:['company.sub','company.sub.child'],expectedLists:list.expectedLists})
  assertNamespaceFlowDetailEvidence(list.flowDetail,{events,base,namespace:'company.sub',flowId:secondSubject,description:'second_'+secondSubject+'_company.sub'})
  for(const phase of list.flowDetail.phases) {
    const navigation=nav(phase.document,phase.path)
    assert(order.get(navigation.id)>loginBounds[3].final&&order.get(navigation.id)<order.get(rejected.id),'Flow detail checked outside the second-account stage')
  }
  return {requests:requests.length,logins:login.length,logouts:logout.length,firstSubject,secondSubject,independentLists:true}
}
