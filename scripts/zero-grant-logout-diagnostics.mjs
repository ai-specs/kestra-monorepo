/** Only the old denial document's capability probe during an observed logout. */
export function loggedOutCapabilityDenials({events,base,anonymousDocument,anonymousStatus,realSignOutClicked}) {
  if(!realSignOutClicked||anonymousStatus!==401||!anonymousDocument?.documentId)return []
  const at=event=>Date.parse(event.observedAt),order=new Map(events.map((event,index)=>[event.id,index]))
  const navigation=events.find(event=>event.kind==='document-navigation'&&event.documentId===anonymousDocument.documentId&&new URL(event.url).origin===base&&new URL(event.url).pathname==='/oidc/login')
  if(!navigation?.frameId)return []
  const logout=events.find(event=>event.kind==='http-response'&&event.url===base+'/oidc/logout'&&event.method==='GET'&&event.status===307&&event.documentId===navigation.documentId&&order.get(event.id)<order.get(navigation.id)&&at(navigation)-at(event)>=0&&at(navigation)-at(event)<=1000)
  if(!logout)return []
  const logoutRequest=events.find(event=>event.kind==='request'&&event.requestId===logout.requestId&&event.url===logout.url&&event.method==='GET'&&event.documentId===logout.documentId&&event.frameId===navigation.frameId&&order.get(event.id)<order.get(logout.id))
  if(!logoutRequest)return []
  return events.filter(event=>{
    if(event.kind!=='http-error'||event.status!==401||event.method!=='GET'||event.url!==base+'/api/v1/main/extensions/rbac/capabilities'||event.documentUrl!==base+'/ui/access-denied'||order.get(event.id)<=order.get(logout.id)||order.get(event.id)>=order.get(navigation.id)||at(event)-at(logout)<0||at(event)-at(logout)>1000)return false
    const request=events.find(request=>request.kind==='request'&&request.requestId===event.requestId&&request.documentId===event.documentId&&request.url===event.url&&request.method==='GET'&&request.frameId===navigation.frameId&&order.get(request.id)>order.get(logoutRequest.id)&&order.get(request.id)<order.get(event.id))
    return Boolean(request)
  })
}
