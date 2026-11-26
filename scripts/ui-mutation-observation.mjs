import assert from 'node:assert/strict'

export function uiDocumentSnapshot() {
  const url=new URL(location.href)
  url.search='';url.hash=''
  return {path:location.pathname,url:url.href,query:location.search,timeOrigin:performance.timeOrigin}
}

export function installUiMutationObservation({key,operation}) {
  const actual=new URL(location.href),target=new URL(operation.url),source=new URL(operation.source.url)
  if(!['http:','https:'].includes(actual.protocol)||target.origin!==actual.origin||source.origin!==actual.origin||!['http:','https:'].includes(target.protocol))throw new Error('Mutation observer requires a same-origin HTTP document and target')
  if(sessionStorage.getItem(key)!==null)throw new Error('Owned mutation sample already exists')
  actual.hash=''
  if(actual.href!==operation.source.url+operation.source.query||performance.timeOrigin!==operation.source.timeOrigin)throw new Error('Mutation source changed before observer installation')
  const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot
  if(!root)throw new Error('Native extension root missing before mutation')
  const record={schemaVersion:1,operation,sequence:0,busy:false,saving:false,closeDisabled:true,saveDisabled:true,unloaded:false}
  const sample=()=>{
    const main=root.querySelector('main'),drawer=root.querySelector('[data-test^="drawer-"][aria-busy]')
    if(main?.getAttribute('aria-busy')==='true')record.busy=true
    if(drawer?.getAttribute('aria-busy')==='true') {
      record.saving=true
      const close=drawer.querySelector('.kel-drawer__close-btn')
      record.closeDisabled&&=!close||close.disabled===true
      record.saveDisabled&&=root.querySelector('[data-test="drawer-save"]')?.disabled===true
    }
    record.sequence++;sessionStorage.setItem(key,JSON.stringify(record))
  }
  const observer=new MutationObserver(records=>{
    if(records.some(change=>change.attributeName==='aria-busy'&&change.oldValue==='true'))record.busy=true
    sample()
  })
  const unload=()=>{record.unloaded=true;sample();observer.disconnect()}
  sample()
  observer.observe(root,{subtree:true,attributes:true,attributeOldValue:true,childList:true})
  addEventListener('pagehide',unload,{once:true})
  window[key]={observer,sample,unload}
}

export function validateUiMutationSample(value,operation,{replaced=false}={}) {
  assert(value&&typeof value==='object'&&!Array.isArray(value),'Owned mutation sample missing')
  assert.deepEqual(Object.keys(value).sort(),['busy','closeDisabled','operation','saveDisabled','saving','schemaVersion','sequence','unloaded'])
  assert.equal(value.schemaVersion,1);assert.deepEqual(value.operation,operation,'Mutation sample source/operation mismatch')
  assert(Number.isSafeInteger(value.sequence)&&value.sequence>0)
  for(const key of ['busy','saving','closeDisabled','saveDisabled','unloaded'])assert.equal(typeof value[key],'boolean')
  assert.equal(value.busy,true,'Native write never exposed a loading state')
  if(value.saving)assert(value.closeDisabled&&value.saveDisabled,'Saving drawer allowed close or duplicate submit')
  if(replaced)assert.equal(value.unloaded,true,'Replacement document has no source unload sample')
  return value
}

export function committedUiDocument(diagnostics,current) {
  assert(diagnostics.topFrame,'Committed top frame missing')
  const navigation=diagnostics.events.findLast(event=>event.kind==='document-navigation'&&event.frameId===diagnostics.topFrame)
  assert(navigation,'Committed top-frame navigation missing')
  const document=diagnostics.documents?.find(item=>item.id===navigation.documentId&&item.frameId===diagnostics.topFrame)
  assert(document,'Committed document metadata missing')
  const routes=diagnostics.events.filter(event=>event.kind==='document-route'&&event.documentId===document.id&&event.frameId===diagnostics.topFrame&&diagnostics.events.indexOf(event)>diagnostics.events.indexOf(navigation))
  const latest=routes.at(-1)??navigation
  assert.equal(latest.url,current.url+current.query,'Committed document route differs from browser URL')
  assert.equal(document.url,current.url+current.query,'Diagnostic document metadata differs from browser URL')
  return document
}

export function sourceUiDocument(diagnostics,current) {
  assert(diagnostics.topFrame,'Source top frame missing')
  assert(Number.isFinite(current.timeOrigin),'Source document time origin missing')
  const navigation=diagnostics.events.findLast(event=>event.kind==='document-navigation'&&event.frameId===diagnostics.topFrame)
  assert(navigation,'Source committed top-frame navigation missing')
  const document=diagnostics.documents?.find(item=>item.id===navigation.documentId&&item.frameId===diagnostics.topFrame)
  assert(document,'Source committed document metadata missing')
  const routes=diagnostics.events.filter(event=>event.kind==='document-route'&&event.documentId===document.id&&event.frameId===diagnostics.topFrame&&diagnostics.events.indexOf(event)>diagnostics.events.indexOf(navigation))
  const actual=new URL(current.url),latest=new URL((routes.at(-1)??navigation).url),metadata=new URL(document.url)
  assert(latest.protocol===actual.protocol&&latest.origin===actual.origin&&latest.pathname===actual.pathname,'Source committed document path differs from browser')
  assert(metadata.protocol===actual.protocol&&metadata.origin===actual.origin&&metadata.pathname===actual.pathname,'Source document metadata path differs from browser')
  return document
}

export function proveUiMutationReplacement({events,operation,response,current}) {
  const original=events.filter(event=>event.kind==='request'&&event.documentId===operation.source.documentId&&event.requestId===response.requestId&&event.url===operation.url&&event.method===operation.method)
  assert.equal(original.length,1,'Exact original mutation request missing or ambiguous')
  const replies=events.filter(event=>['http-response','http-error'].includes(event.kind)&&event.documentId===operation.source.documentId&&event.requestId===response.requestId&&event.url===operation.url&&event.method===operation.method&&event.status===response.status)
  assert.equal(replies.length,1,'Exact original mutation response missing or ambiguous')
  assert(events.indexOf(original[0])<events.indexOf(replies[0]),'Mutation response precedes request')
  assert.equal(new URL(current.url).origin,new URL(operation.source.url).origin)
  assert(current.documentId!==operation.source.documentId&&current.timeOrigin>operation.source.timeOrigin,'Replacement must have a new document generation')
  const navigation=events.findLast(event=>event.kind==='document-navigation'&&event.documentId===current.documentId&&event.frameId===original[0].frameId&&new URL(event.url).origin===new URL(operation.url).origin)
  assert(original[0].frameId&&navigation,'Actual same-frame replacement navigation missing')
  assert(events.indexOf(navigation)>events.indexOf(replies[0]),'Replacement is not after the mutation response')
  const routes=events.filter(event=>event.kind==='document-route'&&event.documentId===current.documentId&&event.frameId===original[0].frameId&&events.indexOf(event)>events.indexOf(navigation))
  assert(routes.every(event=>new URL(event.url).origin===new URL(operation.url).origin),'Replacement route left the mutation origin')
  const settled=routes.at(-1)??navigation
  assert.equal(settled.url,current.url+current.query,'Replacement committed document has no exact current route')
  return {requestEventId:original[0].id,responseEventId:replies[0].id,navigationEventId:navigation.id,routeEventIds:routes.map(event=>event.id),source:operation.source,replacement:current}
}

export async function finishUiMutationObservation({page,key,operation,response}) {
  let snapshot,diagnostics
  for(let attempt=0;attempt<3;attempt++) {
    try {
      snapshot=await page.evaluate(uiDocumentSnapshot)
      diagnostics=await page.diagnostics()
      const document=committedUiDocument(diagnostics,snapshot)
      snapshot.documentId=document.id
      if(snapshot.documentId===operation.source.documentId)assert.equal(snapshot.timeOrigin,operation.source.timeOrigin)
      else proveUiMutationReplacement({events:diagnostics.events,operation,response,current:snapshot})
      const raw=await page.evaluate(({key,source})=>{
        const url=new URL(location.href);url.search='';url.hash=''
        if(url.href!==source.url||location.search!==source.query||performance.timeOrigin!==source.timeOrigin)throw new Error('Mutation reader document changed')
        window[key]?.sample()
        const root=document.querySelector('[data-test="extension-container"]')?.shadowRoot
        return {sample:sessionStorage.getItem(key),view:{path:location.pathname,reauthenticationRequired:Boolean(root?.querySelector('[data-test="sign-in-again"]')||document.querySelector('[data-testid="return-to-login"]')||document.querySelector('input[name="username"]')),businessContentHidden:!root?.querySelector('[data-test="group-detail"],[data-test="permission-row"],[data-test="user-row"],[data-test="subject-row"],[data-test="drawer-permission"],[data-test="credential-once"],[data-test="credential-rotate"]')}}
      },{key,source:snapshot})
      assert(raw.sample!==null,'Owned mutation sample missing')
      const replaced=snapshot.documentId!==operation.source.documentId
      const value=validateUiMutationSample(JSON.parse(raw.sample),operation,{replaced})
      assert.deepEqual(Object.keys(raw.view).sort(),['businessContentHidden','path','reauthenticationRequired'])
      assert.equal(raw.view.path,new URL(snapshot.url).pathname)
      assert.equal(typeof raw.view.reauthenticationRequired,'boolean');assert.equal(typeof raw.view.businessContentHidden,'boolean')
      return {loading:{busy:value.busy,saving:value.saving,closeDisabled:value.closeDisabled,saveDisabled:value.saveDisabled},postWriteView:{...raw.view,source:snapshot},loadingSource:{schemaVersion:1,operationId:operation.id,source:operation.source,sequence:value.sequence,unloaded:value.unloaded,...(replaced?{replacement:proveUiMutationReplacement({events:diagnostics.events,operation,response,current:snapshot})}:{})}}
    } catch(error) {
      if(!/^page\.evaluate: (?:Execution context was destroyed, most likely because of a navigation|Error: Mutation reader document changed)/.test(error.message)||attempt===2)throw error
      const actual=await page.diagnostics()
      const request=actual.events.find(event=>event.kind==='request'&&event.documentId===operation.source.documentId&&event.requestId===response.requestId)
      const reply=actual.events.find(event=>['http-response','http-error'].includes(event.kind)&&event.documentId===operation.source.documentId&&event.requestId===response.requestId&&event.url===operation.url&&event.method===operation.method&&event.status===response.status)
      assert(request?.frameId&&reply&&actual.events.some(event=>event.kind==='document-navigation'&&event.frameId===request.frameId&&event.documentId!==operation.source.documentId&&new URL(event.url).origin===new URL(operation.url).origin&&actual.events.indexOf(event)>actual.events.indexOf(reply)),'Context destruction has no proven same-origin mutation document replacement')
    }
  }
}

export async function clearUiMutationObservation(page,key,origin) {
  await page.evaluate(({key,origin})=>{
    if(location.origin!==origin)throw new Error('Cannot clean mutation sample from foreign origin')
    const state=window[key]
    if(state){state.observer.disconnect();removeEventListener('pagehide',state.unload);delete window[key]}
    sessionStorage.removeItem(key)
  },{key,origin})
}

export function assertRevokedEditorStages(stages) {
  assert.deepEqual(Object.keys(stages).sort(),['freshReadOnly403','staleEpoch401'])
  for(const [name,status] of [['staleEpoch401',401],['freshReadOnly403',403]]) {
    const row=stages[name]
    assert.equal(row.completed,true);assert.equal(row.status,status)
    assert.equal(row.protectedStateUnchanged,true);assert.equal(row.sensitiveContentCleared,true)
    assert(row.request?.requestId&&row.request.source?.documentId&&row.request.status===status)
    assert.deepEqual(row.request.expectedStatuses,[status])
    assert.equal(row.beforeEffects.hash,row.afterEffects.hash)
    assert(/^[a-f0-9]{64}$/.test(row.beforeEffects.hash))
  }
  assert.equal(stages.staleEpoch401.productionLogout,true)
  assert.equal(stages.freshReadOnly403.credentialsSubmitted,true)
  assert.equal(stages.freshReadOnly403.noSaveEntry,true)
  assert.equal(stages.freshReadOnly403.transport,'browser-session-adversarial-request')
  assert(/^[a-f0-9]{64}$/.test(stages.freshReadOnly403.identity.subjectHash)&&Number.isSafeInteger(stages.freshReadOnly403.identity.authorizationVersion)&&stages.freshReadOnly403.identity.authorizationVersion>0)
  assert.equal(stages.staleEpoch401.identity.subjectHash,stages.freshReadOnly403.identity.subjectHash)
  assert(Number.isSafeInteger(stages.staleEpoch401.identity.authorizationVersion)&&stages.staleEpoch401.identity.authorizationVersion>0&&stages.freshReadOnly403.identity.authorizationVersion>stages.staleEpoch401.identity.authorizationVersion)
}
