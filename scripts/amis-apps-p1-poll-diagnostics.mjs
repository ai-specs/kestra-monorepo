const pathPattern=/^\/company\.amis\.a\/p1-[a-z-]+\/apis\/run\/executions\/([A-Za-z0-9_-]+)$/
const identity=(a,b)=>a.documentId===b.documentId&&a.requestId===b.requestId&&a.url===b.url&&a.method===b.method
const sameDocument=(a,b)=>a&&b&&a.url===b.url&&Number.isFinite(a.timeOrigin)&&a.timeOrigin===b.timeOrigin
const pending=(observation,url,id)=>observation?.recovery?.some(r=>r.value?.version===1&&r.value.phase==='pending'&&r.value.executionId===id&&r.value.executionUrl===new URL(url).pathname&&r.value.apiUrl===new URL(url).pathname.split('/executions/')[0])
const afterSuccess=(after,marker)=>after?.busy==='false'&&Array.isArray(after.alert)&&after.alert.length===0&&typeof marker==='string'&&marker.length>0&&after.text?.includes('Saved: '+marker)

/** Narrow exception only; returns all unproved request failures as errors.
 * Original collector events remain untouched and are returned with provenance. */
export function classifyP1PollDiagnostics({events,base,browser}) {
 const classifications=[],errors=[]
 const checks=browser?.checks??[]
 const fill=checks.find(c=>c.id==='fill-slow'&&c.status==='passed')
 const marker=fill?.observation?.marker
 for(const event of events.filter(e=>e.kind==='request-failed')) {
  let proof
  try {
   const url=new URL(event.url),match=pathPattern.exec(url.pathname)
   if(url.origin!==base||url.search||url.hash||!match||event.method!=='GET'||event.resourceType!=='Fetch'||event.cancelled!==true||event.message!=='net::ERR_ABORTED')throw Error()
   const id=match[1],request=events.filter(e=>e.kind==='request'&&identity(e,event))
   if(request.length!==1||request[0].resourceType!=='Fetch'||request[0].documentUrl!==event.documentUrl)throw Error()
   const requestIndex=events.indexOf(request[0]),failureIndex=events.indexOf(event)
   if(requestIndex>=failureIndex)throw Error()
   const doc=event.documentUrl
   if(new URL(doc).origin!==base||new URL(doc).pathname!==url.pathname.split('/apis/')[0]+'/pages/home')throw Error()
   const recovered=checks.find(c=>c.id==='visible-result'&&c.status==='passed'&&c.observation?.recoveredAfterActualTimeout===true&&c.sourceDocument?.url===doc&&sameDocument(c.sourceDocument,c.observation.before)&&sameDocument(c.observation.before,c.observation.after)&&c.observation.before.busy==='false'&&c.observation.before.alert?.some(x=>x.includes('Request timed out'))&&pending(c.observation.before,event.url,id)&&afterSuccess(c.observation.after,marker))
   const cancelIndex=checks.findIndex(c=>c.id==='cancel-distinct-pending-execution'&&c.status==='passed'&&c.sourceDocument?.url===doc&&sameDocument(c.sourceDocument,c.observation?.before)&&c.observation.before.busy==='true'&&sameDocument(c.observation.before,c.observation.after)&&c.observation.after.busy==='false'&&c.observation.after.alert?.some(x=>x.includes('Request cancelled'))&&pending(c.observation.before,event.url,id))
   const resumeIndex=cancelIndex>=0?checks.findIndex((c,i)=>i>cancelIndex&&c.id==='resume-original'&&c.status==='passed'&&c.observation?.nativeResume===true&&sameDocument(c.sourceDocument,checks[cancelIndex].sourceDocument)):-1
   const success=resumeIndex>=0?checks.find((c,i)=>i>resumeIndex&&c.id==='visible-result'&&c.status==='passed'&&sameDocument(c.sourceDocument,checks[cancelIndex].sourceDocument)&&afterSuccess(c.observation?.after??c.observation,marker)):null
   if(!recovered&&!success)throw Error()
   const responses=events.filter((e,i)=>i>failureIndex&&e.kind==='http-response'&&e.status===200&&e.method==='GET'&&e.url===event.url&&e.documentId===event.documentId)
   const response=responses.find(e=>events.some((r,i)=>i>failureIndex&&i<events.indexOf(e)&&r.kind==='request'&&identity(r,e)&&r.resourceType==='Fetch'&&r.documentUrl===doc))
   if(!response)throw Error()
   // A navigation cannot explain away a cancellation from the active document.
   if(events.slice(failureIndex,events.indexOf(response)+1).some(e=>['document-commit','navigation','document-navigation'].includes(e.kind)&&e.documentId!==event.documentId))throw Error()
   proof={executionId:id,requestEventId:request[0].id,recoveryResponseEventId:response.id,documentId:event.documentId,sourceUrl:doc,timeOrigin:(recovered??checks[cancelIndex]).sourceDocument.timeOrigin,protocol:recovered?'observed-timeout-explicit-recovery':'observed-cancel-explicit-recovery'}
  }catch{}
  if(proof)classifications.push({id:event.id,event,reason:'Confirmed original execution polling cancelled by observed bounded wait; explicit same-document recovery succeeded',proof})
  else errors.push(event)
 }
 return {classifications,errors}
}

/** Separate schema-unload proof; never broadens execution-poll cancellation. */
export function classifyP1SchemaUnloadDiagnostics({events,base,browser}) {
 const classifications=[],errors=[]
 for(const event of events.filter(e=>e.kind==='request-failed')) {
  let proof
  try {
   const url=new URL(event.url),match=/^\/company\.amis\.a\/(p1-[a-z-]+)\/schemas\/([A-Za-z0-9_-]+)$/.exec(url.pathname)
   if(url.origin!==base||url.search||url.hash||!match||event.method!=='GET'||event.resourceType!=='Fetch'||event.cancelled!==true||event.message!=='net::ERR_ABORTED')throw Error()
   const page=base+'/company.amis.a/'+match[1]+'/pages/'+match[2],api='/company.amis.a/'+match[1]+'/apis/run'
   const checks=browser.checks,leaveIndex=checks.findIndex(c=>c.id==='leave-and-reenter'&&c.status==='passed'&&c.observation?.beforeDocumentId===event.documentId)
   if(leaveIndex<0)throw Error()
   const leave=checks[leaveIndex].observation
   if(leave.reentered!==true||leave.before?.url!==page||leave.after?.url!==page||leave.away?.url!==base+'/ping'||event.documentUrl!==page)throw Error()
   if(![leave.before.timeOrigin,leave.away.timeOrigin,leave.after.timeOrigin].every(Number.isFinite)||!(leave.before.timeOrigin<leave.away.timeOrigin&&leave.away.timeOrigin<leave.after.timeOrigin))throw Error()
   if(new Set([leave.beforeDocumentId,leave.awayDocumentId,leave.documentId]).size!==3||![leave.beforeDocumentId,leave.awayDocumentId,leave.documentId].every(x=>typeof x==='string'&&x))throw Error()
   const request=events.filter(e=>e.kind==='request'&&identity(e,event));if(request.length!==1||request[0].resourceType!=='Fetch'||request[0].documentUrl!==page)throw Error()
   const index=e=>events.findIndex(x=>x.id===e?.id),ri=index(request[0]),fi=index(event),hr=index(leave.healthRequest),hs=index(leave.healthResponse)
   if(ri<0||fi<=ri||hr<=ri||hs<=hr||fi<hs)throw Error()
   for(const [saved,actual]of [[leave.healthRequest,events[hr]],[leave.healthResponse,events[hs]]])if(JSON.stringify(saved)!==JSON.stringify(actual))throw Error()
   if(leave.healthRequest.kind!=='request'||leave.healthRequest.method!=='GET'||leave.healthRequest.resourceType!=='Document'||leave.healthRequest.url!==base+'/ping'||leave.healthRequest.documentId!==leave.awayDocumentId||leave.healthResponse.kind!=='http-response'||leave.healthResponse.status!==200||!identity(leave.healthRequest,leave.healthResponse))throw Error()
   const awayNav=events.findIndex((e,i)=>i>=fi&&e.kind==='document-navigation'&&e.documentId===leave.awayDocumentId&&e.url===base+'/ping')
   const returnNav=events.findIndex((e,i)=>i>awayNav&&e.kind==='document-navigation'&&e.documentId===leave.documentId&&e.url===page)
   if(awayNav<0||returnNav<=awayNav)throw Error()
   const schemaResponse=events.find((e,i)=>i>returnNav&&e.kind==='http-response'&&e.method==='GET'&&e.status===200&&e.url===event.url&&e.documentId===leave.documentId&&events.some((r,j)=>j>returnNav&&j<i&&r.kind==='request'&&r.resourceType==='Fetch'&&r.documentUrl===page&&identity(r,e)))
   if(!schemaResponse||events.some(e=>e.kind==='request-failed'&&e.documentId===leave.documentId&&e.url===event.url))throw Error()
   const confirmed=checks.slice(0,leaveIndex).find(c=>c.id==='confirmed-execution-before-refresh'&&c.status==='passed'&&c.observation?.confirmedBeforeReload===true)?.observation.recovery
   if(!confirmed||confirmed.phase!=='pending'||confirmed.apiUrl!==api||confirmed.executionUrl!==api+'/executions/'+confirmed.executionId)throw Error()
   const resumeIndex=checks.findIndex((c,i)=>i>leaveIndex&&c.id==='resume-original'&&c.status==='passed'&&c.observation?.nativeResume===true&&sameDocument(c.sourceDocument,leave.after))
   const marker=checks.find(c=>c.id==='fill-slow'&&c.status==='passed')?.observation?.marker
   const success=checks.find((c,i)=>i>resumeIndex&&resumeIndex>=0&&c.id==='visible-result'&&c.status==='passed'&&sameDocument(c.sourceDocument,leave.after)&&afterSuccess(c.observation?.after??c.observation,marker))
   if(!success)throw Error()
   const resultUrl=base+confirmed.executionUrl,result=events.find((e,i)=>i>index(schemaResponse)&&e.kind==='http-response'&&e.status===200&&e.method==='GET'&&e.url===resultUrl&&e.documentId===leave.documentId&&events.some((r,j)=>j>returnNav&&j<i&&r.kind==='request'&&r.resourceType==='Fetch'&&identity(r,e)))
   if(!result)throw Error()
   proof={requestEventId:request[0].id,healthRequestEventId:leave.healthRequest.id,healthResponseEventId:leave.healthResponse.id,awayNavigationEventId:events[awayNav].id,returnNavigationEventId:events[returnNav].id,schemaResponseEventId:schemaResponse.id,resultResponseEventId:result.id,executionId:confirmed.executionId,beforeDocumentId:leave.beforeDocumentId,awayDocumentId:leave.awayDocumentId,documentId:leave.documentId,timeOrigins:{before:leave.before.timeOrigin,away:leave.away.timeOrigin,after:leave.after.timeOrigin}}
  }catch{}
  if(proof)classifications.push({id:event.id,event,reason:'Exact old-document schema fetch cancelled by proved health-page leave; new-document schema and original execution recovery succeeded',proof})
  else errors.push(event)
 }
 return {classifications,errors}
}
