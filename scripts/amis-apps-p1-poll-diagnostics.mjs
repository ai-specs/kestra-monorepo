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
