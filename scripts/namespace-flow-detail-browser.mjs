import assert from 'node:assert/strict'

export const namespaceFlowDetailPhases=Object.freeze(['overview-direct','overview-refresh','executions-direct'])

// Production integration only. Component visuals and their complete state matrix
// belong to the host's independently published browser gate.
export function namespaceFlowDetailCanonicalQueryReady({path,description,tab}) {
  if(location.pathname!==path||new URLSearchParams(location.search).get('filters[timeRange][EQUALS]')!=='PT24H')return false
  const visible=node=>Boolean(node.getClientRects().length)&&getComputedStyle(node).visibility!=='hidden'&&getComputedStyle(node).display!=='none'
  const denied=[...document.querySelectorAll('[data-flow-capability-state="unavailable"]')].filter(visible)
  const errors=[...document.querySelectorAll('[data-flow-capability-state="error"],[data-flow-capability-state="unsupported"]')].filter(visible)
  return errors.length===0&&(tab==='overview'?denied.length===9&&document.body.innerText.includes(description):denied.length===1)
}

export function namespaceFlowDetailReady({path,description,tab}) {
  if(location.pathname!==path)return false
  const visible=node=>Boolean(node.getClientRects().length)&&getComputedStyle(node).visibility!=='hidden'
  const denied=[...document.querySelectorAll('[data-flow-capability-state="unavailable"]')].filter(visible)
  const errors=[...document.querySelectorAll('[data-flow-capability-state="error"],[data-flow-capability-state="unsupported"]')].filter(visible)
  return errors.length===0&&(tab==='overview'
    ? denied.length===9&&document.body.innerText.includes(description)
    : denied.length===1)
}

const forbidden=path=>/^\/api\/v1\/main\/(?:executions\/(?:search|latest)|logs\/search|triggers\/)/.test(path)
const observedKinds=new Set(['request','http-response','http-error','request-failed'])
export function assertNamespaceFlowDetailEvidence(detail,{events,base,namespace,flowId,description}) {
  assert.equal(detail?.transport,'production-ui')
  assert.equal(detail.namespace,namespace);assert.equal(detail.flowId,flowId)
  assert.deepEqual(detail.phases.map(row=>row.name),namespaceFlowDetailPhases)
  const documents=new Set()
  for(const row of detail.phases) {
    const tab=row.name==='executions-direct'?'executions':'overview'
    const path='/ui/main/flows/edit/'+namespace+'/'+flowId+'/'+tab
    assert.equal(row.path,path);assert.equal(row.document.path,path)
    assert(row.document.documentId&&Number.isFinite(row.document.timeOrigin))
    assert(!documents.has(row.document.documentId));documents.add(row.document.documentId)
    assert.equal(row.dom.denied,tab==='overview'?9:1)
    assert.equal(row.dom.errors,0)
    if(tab==='overview')assert.equal(row.dom.description,description)
    assert(Array.isArray(row.eventIds)&&row.eventIds.length>0)
    assert.equal(new Set(row.eventIds).size,row.eventIds.length)
    const selected=events.filter(event=>row.eventIds.includes(event.id))
    assert.equal(selected.length,row.eventIds.length,'Flow detail source events missing')
    assert.deepEqual(selected.map(event=>event.id),row.eventIds,'Flow detail diagnostic order differs')
    assert(selected.every(event=>event.documentId===row.document.documentId),'Flow detail evidence belongs to another document')
    assert(selected.some(event=>event.kind==='document-navigation'&&new URL(event.url).origin===base&&new URL(event.url).pathname===path))
    const requests=selected.filter(event=>event.kind==='request')
    const responses=selected.filter(event=>['http-response','http-error'].includes(event.kind))
    const capability=responses.filter(event=>new URL(event.url).pathname==='/api/v1/main/ui/flows/execution-capabilities')
    assert(capability.length>0&&capability.every(event=>event.status===200&&event.method==='POST'))
    const previews=requests.filter(event=>new URL(event.url).pathname==='/api/v1/main/dashboards/charts/preview')
    assert.equal(previews.length,tab==='overview'?1:0,'Unexpected runtime chart mounted')
    for(const preview of previews)assert(responses.some(response=>response.requestId===preview.requestId&&response.method==='POST'&&response.status===200),'Description chart did not return successfully')
    for(const request of requests.filter(event=>new URL(event.url).pathname.startsWith('/api/'))) {
      assert.equal(responses.filter(response=>response.requestId===request.requestId&&response.url===request.url&&response.method===request.method).length,1,'Flow detail business request has no completed response')
    }
    for(const response of responses) {
      assert.equal(requests.filter(request=>request.requestId===response.requestId&&request.url===response.url&&request.method===response.method).length,1)
      assert(response.status<400,'Flow detail issued a denied business request')
    }
    assert(!selected.some(event=>observedKinds.has(event.kind)&&forbidden(new URL(event.url).pathname)),'Flow detail issued a forbidden runtime request')
    assert(!selected.some(event=>['http-error','request-failed','diagnostic-integrity-error','page-error','console-error'].includes(event.kind)))
    const allDocumentEvents=events.filter(event=>event.documentId===row.document.documentId)
    assert(!allDocumentEvents.some(event=>observedKinds.has(event.kind)&&forbidden(new URL(event.url).pathname)))
    const cutoff=events.findIndex(event=>event.id===row.eventIds.at(-1))
    assert.deepEqual(selected.map(event=>event.id),events.slice(0,cutoff+1).filter(event=>event.documentId===row.document.documentId).map(event=>event.id),'Flow detail document diagnostics were narrowed')
  }
  return {phases:3,documents:3,description:true,deniedRuntimeRequests:0}
}

export async function runNamespaceFlowDetailBrowser(page,{base,namespace,flowId,description}) {
  const detail={transport:'production-ui',namespace,flowId,phases:[]}
  for(const name of namespaceFlowDetailPhases) {
    const tab=name==='executions-direct'?'executions':'overview'
    const path='/ui/main/flows/edit/'+namespace+'/'+flowId+'/'+tab
    const previousOrigin=await page.evaluate(()=>performance.timeOrigin)
    if(name==='overview-refresh')await page.reload()
    else await page.goto(base+path)
    await page.waitForFunction(previous=>performance.timeOrigin>previous,previousOrigin)
    await page.waitForFunction(namespaceFlowDetailReady,{path,description,tab})
    if(name==='overview-direct') {
      // The native Flow router first mounts the bare Overview, then canonicalizes
      // its default time filter and performs another document load. Evidence must
      // be bound to that final canonical document, not span both route mounts.
      await page.waitForFunction(namespaceFlowDetailCanonicalQueryReady,{path,description,tab})
      const intermediateOrigin=await page.evaluate(()=>performance.timeOrigin)
      await page.waitForFunction(previous=>performance.timeOrigin>previous,intermediateOrigin)
      await page.waitForFunction(namespaceFlowDetailCanonicalQueryReady,{path,description,tab})
    }
    const dom=await page.evaluate(({description})=>{
      const visible=node=>Boolean(node.getClientRects().length)&&getComputedStyle(node).visibility!=='hidden'
      return {denied:[...document.querySelectorAll('[data-flow-capability-state="unavailable"]')].filter(visible).length,
        errors:[...document.querySelectorAll('[data-flow-capability-state="error"],[data-flow-capability-state="unsupported"]')].filter(visible).length,
        description:document.body.innerText.includes(description)?description:null,path:location.pathname,timeOrigin:performance.timeOrigin}
    },{description})
    let diagnostics=await page.diagnostics()
    const navigation=diagnostics.events.filter(event=>event.kind==='document-navigation'&&new URL(event.url).origin===base&&new URL(event.url).pathname===path).at(-1)
    assert(navigation?.documentId,'Production Flow detail document missing')
    const deadline=Date.now()+60000
    for(;;) {
      const current=diagnostics.events.filter(event=>event.documentId===navigation.documentId)
      const requests=current.filter(event=>event.kind==='request'&&new URL(event.url).pathname.startsWith('/api/'))
      if(requests.every(request=>current.some(event=>['http-response','http-error','request-failed'].includes(event.kind)&&event.requestId===request.requestId)))break
      assert(Date.now()<deadline,'Production Flow detail requests did not complete')
      await new Promise(resolve=>setTimeout(resolve,100))
      diagnostics=await page.diagnostics()
    }
    detail.phases.push({name,path,document:{path:dom.path,timeOrigin:dom.timeOrigin,documentId:navigation.documentId},dom,eventIds:diagnostics.events.filter(event=>event.documentId===navigation.documentId).map(event=>event.id)})
  }
  assertNamespaceFlowDetailEvidence(detail,{events:(await page.diagnostics()).events,base,namespace,flowId,description})
  return detail
}
