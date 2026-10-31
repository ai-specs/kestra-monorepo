/** Narrow source-based classifications. A matching message alone never passes. */
export function classifyAccessControlDiagnostics({events,base,requests=[],expectedTransportFailures=[],identityWindows=[]}) {
  const at=event=>Date.parse(event.observedAt)
  const byRequest=new Map(),byDocument=new Map()
  for(const event of events){if(event.requestId){const list=byRequest.get(event.requestId)??[];list.push(event);byRequest.set(event.requestId,list)}const list=byDocument.get(event.documentId)??[];list.push(event);byDocument.set(event.documentId,list)}
  const navigation=events.filter(event=>event.kind==='document-navigation')
  const order=new Map(events.map((event,index)=>[event.id,index]))
  const same=(left,right)=>left.requestId===right.requestId&&left.documentId===right.documentId&&left.url===right.url
  const indexed=new Map(),classifications=[]
  const add=(event,reason,evidence)=>{indexed.set(event.id,{id:event.id,reason,evidence});classifications.push(indexed.get(event.id))}
  const exactRequests=event=>requests.some(request=>request.requestId===event.requestId&&request.source?.documentId===event.documentId&&base+request.path===event.url&&request.method===event.method&&request.status===event.status&&request.expectedStatuses.includes(event.status))
  for(const event of events) {
    const related=byRequest.get(event.requestId)??[]
    const original=related.find(request=>request.kind==='request'&&same(request,event)&&request.method===event.method)
    if(event.kind==='http-error'&&original&&exactRequests(event)){add(event,'explicit-business-denial',{requestId:event.requestId,documentId:event.documentId});continue}
    if(event.kind==='request-failed'&&expectedTransportFailures.some(item=>item.case==='ui-secret-response-lost-once'&&same(item,event)&&item.message===event.message)){add(event,'explicit-once-only-response-drop',{requestId:event.requestId,documentId:event.documentId});continue}
    if(event.kind==='request-failed'&&original&&event.message==='net::ERR_ABORTED'&&event.cancelled===true) {
      const url=new URL(event.url),path=url.pathname
      const read=event.method==='GET'&&url.origin===base&&(path.startsWith('/api/v1/')||path.startsWith('/ui/assets/')||path==='/ui-extensions/main/manifest')
      const query=event.method==='POST'&&url.origin===base&&['/api/v1/main/dashboards/charts/preview','/api/v1/main/namespaces/autocomplete'].includes(path)
      const feed=event.method==='GET'&&event.url.startsWith('https://api.kestra.io/v1/feeds?')
      const next=navigation.find(next=>order.get(next.id)>order.get(original.id)&&next.frameId===original.frameId&&next.documentId!==event.documentId)
      if((read||query||feed)&&next&&Math.abs(at(next)-at(event))<=1000){add(event,'cancelled-read-on-document-unload',{requestId:event.requestId,documentId:event.documentId,nextDocumentId:next.documentId,navigationEventId:next.id});continue}
      if(event.method==='GET'&&event.url===base+'/ui-extensions/main/manifest') {
        const route=(byDocument.get(event.documentId)??[]).find(route=>route.kind==='document-route'&&order.get(route.id)>order.get(event.id)&&at(route)-at(event)<=1000&&route.url!==original.documentUrl)
        const replacement=(byDocument.get(event.documentId)??[]).find(response=>response.kind==='http-response'&&response.url===event.url&&response.status===200&&response.requestId!==event.requestId&&order.get(response.id)>order.get(event.id)&&at(response)-at(event)<=1000)
        if(route&&replacement){add(event,'superseded-host-manifest-during-canonical-route',{requestId:event.requestId,documentId:event.documentId,routeEventId:route.id,replacementRequestId:replacement.requestId,replacementEventId:replacement.id});continue}
      }
      if(event.method==='GET'&&event.resourceType==='Fetch'&&event.url===base+'/api/v1/main/extensions/rbac/capabilities'&&original.frameId&&original.initiatorStack?.[0]?.functionName&&Number.isInteger(original.initiatorStack[0].line)&&Number.isInteger(original.initiatorStack[0].column)&&original.initiatorStack[0].url.startsWith(base+'/ui/assets/app-')) {
        const source=new URL(original.documentUrl)
        const canonical=source.origin===base&&/^\/ui\/main\/extensions\/rbac\/application-groups\/[^/]+\/applications$/.test(source.pathname)
        const route=canonical&&(byDocument.get(event.documentId)??[]).find(route=>{
          if(route.kind!=='document-route'||order.get(route.id)<=order.get(event.id)||at(route)-at(event)>1000)return false
          const target=new URL(route.url)
          return target.origin===source.origin&&target.search===source.search&&target.pathname.startsWith(source.pathname+'/')&&/^~[A-Za-z0-9_-]+$/.test(target.pathname.slice(source.pathname.length+1))
        })
        const replacement=(byDocument.get(event.documentId)??[]).find(response=>response.kind==='http-response'&&response.url===event.url&&response.status===200&&response.requestId!==event.requestId&&order.get(response.id)>order.get(event.id)&&at(response)-at(event)<=1000&&(byRequest.get(response.requestId)??[]).some(request=>request.kind==='request'&&request.method==='GET'&&request.documentId===event.documentId&&request.frameId===original.frameId&&order.get(request.id)>order.get(event.id)&&JSON.stringify(request.initiatorStack?.[0])===JSON.stringify(original.initiatorStack[0])))
        if(route&&replacement){add(event,'superseded-host-capability-during-canonical-selection',{requestId:event.requestId,documentId:event.documentId,routeEventId:route.id,replacementRequestId:replacement.requestId,replacementEventId:replacement.id,initiator:original.initiatorStack[0]});continue}
      }
    }
    if(event.kind!=='http-error'||!original||event.method!=='GET')continue
    const url=new URL(event.url)
    if(url.origin!==base)continue
    const window=identityWindows.find(window=>/^[a-f0-9]{64}$/.test(window.subjectHash??'')&&at(event)>=Date.parse(window.startedAt)&&at(event)<=Date.parse(window.finishedAt)&&window.documentIds?.includes(event.documentId)&&['production-login','authenticated-session'].includes(window.kind))
    if(event.status===403&&url.pathname==='/api/v1/configs'&&window&&window.businessAdmin===false&&(window.kind==='authenticated-session'||Number.isFinite(Date.parse(window.authenticatedAt))&&at(event)>=Date.parse(window.authenticatedAt))){add(event,'restricted-account-host-config-denial',{subjectHash:window.subjectHash,documentId:event.documentId,identityWindow:window.id});continue}
    const logout=events.find(item=>item.id===window?.logoutEventId&&item.kind==='http-response'&&item.url===base+'/oidc/logout'&&item.status===307&&Math.abs(at(item)-at(event))<=1000)
    if(event.status===401&&url.pathname==='/api/v1/main/extensions/rbac/capabilities'&&event.documentUrl===base+'/ui/access-denied'&&window?.kind==='production-login'&&logout){add(event,'logged-out-denial-page-capability-probe',{documentId:event.documentId,identityWindow:window.id,logoutEventId:logout.id});continue}
    if(event.status===403&&url.pathname==='/api/v1/main/extensions/rbac/capabilities') {
      const mutation=(byDocument.get(event.documentId)??[]).find(response=>response.kind==='http-response'&&['POST','PUT','DELETE'].includes(response.method)&&response.status>=200&&response.status<300&&new URL(response.url).origin===base&&/^\/api\/v1\/main\/extensions\/rbac\/(?:application-groups\/[^/]+\/(?:applications|scope-grants)(?:\/|$)|users\/detail$)/.test(new URL(response.url).pathname)&&at(event)-at(response)>=0&&at(event)-at(response)<=1000&&requests.some(request=>request.requestId===response.requestId&&request.source?.documentId===response.documentId&&base+request.path===response.url&&request.method===response.method&&request.status===response.status&&request.expectedStatuses.includes(response.status)&&request.postWriteView?.reauthenticationRequired===true&&request.postWriteView?.businessContentHidden===true))
      const recovery=window?.kind==='authenticated-session'&&identityWindows.find(next=>next.kind==='production-login'&&next.subjectHash===window.subjectHash&&Date.parse(next.authenticatedAt)>at(event)&&Date.parse(next.authenticatedAt)-at(event)<=60000&&requests.some(request=>request.method==='GET'&&request.path==='/api/v1/main/extensions/rbac/capabilities'&&request.status===200&&request.expectedStatuses.includes(200)&&next.documentIds.includes(request.source?.documentId)))
      if(mutation&&recovery)add(event,'post-mutation-session-denial-with-verified-recovery',{requestId:event.requestId,documentId:event.documentId,subjectHash:window.subjectHash,mutationRequestId:mutation.requestId,mutationEventId:mutation.id,recoveryWindow:recovery.id})
    }
  }
  for(const event of events.filter(event=>event.kind==='console-error')) {
    const response=(byRequest.get(event.requestId)??[]).find(response=>same(response,event)&&indexed.has(response.id)&&['http-error','request-failed'].includes(response.kind))
    if(event.source==='network'&&response&&(/^Failed to load resource: the server responded with a status of (400|401|403|404|409|412|428|503) /.test(event.message)||indexed.get(response.id).reason==='explicit-once-only-response-drop'&&event.message==='Failed to load resource: net::ERR_FAILED')){add(event,'network-console-for-classified-request',{requestId:event.requestId,responseEventId:response.id,documentId:event.documentId});continue}
    const first=event.message.split('\n')[0]
    const errorStack=[...event.message.matchAll(/\bat (?:async )?([^\s(]+) \((https?:\/\/[^\s)]+):(\d+):(\d+)\)/g)].map(match=>({functionName:match[1],url:match[2],line:Number(match[3])-1,column:Number(match[4])-1}))
    const originFrames=[...(event.stack??[]),...errorStack]
    const auth=first==='Error during authentication check: TypeError: Failed to fetch'
    const native=first==='TypeError: Failed to fetch'&&['/ui/main/dashboards','/ui/main/namespaces','/ui/main/flows'].includes(new URL(event.documentUrl).pathname)
    if((auth||native)&&event.stack?.length&&event.stack.every(frame=>!frame.url||frame.url.startsWith(base+'/ui/assets/'))) {
      const abort=(byDocument.get(event.documentId)??[]).find(failed=>indexed.get(failed.id)?.reason==='cancelled-read-on-document-unload'&&Math.abs(at(event)-at(failed))<=100&&(!auth||failed.url===base+'/api/v1/main/extensions/rbac/capabilities'||failed.url===base+'/ui-extensions/main/manifest')&&(byRequest.get(failed.requestId)??[]).some(request=>request.kind==='request'&&same(request,failed)&&request.initiatorStack?.some(origin=>origin.functionName&&originFrames.some(frame=>frame.url===origin.url&&frame.functionName===origin.functionName&&frame.line===origin.line))))
      if(abort)add(event,'host-fetch-console-for-proven-document-unload',{documentId:event.documentId,abortedEventId:abort.id,navigationEventId:indexed.get(abort.id).evidence.navigationEventId})
    }
  }
  const errors=events.filter(event=>['console-error','page-error','request-failed','http-error','diagnostic-integrity-error'].includes(event.kind)&&!indexed.has(event.id))
  return {classifications,errors}
}
