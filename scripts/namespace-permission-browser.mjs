import {assertNamespaceListEvidence,namespacePermissionCaseIds,namespacePermissionNamespaces} from './namespace-permission-evidence.mjs'
import assert from 'node:assert/strict'
import {runNamespaceFlowDetailBrowser} from './namespace-flow-detail-browser.mjs'

// One business plan for the existing Ego and Playwright page adapters. Control-plane
// preparation is labelled separately; every allowed business write uses native UI.
export {namespacePermissionNamespaces,namespacePermissionCaseIds} from './namespace-permission-evidence.mjs'
export function initialNamespacePermissionReport() {
  return {completed:false,cases:namespacePermissionCaseIds.map(id=>({id,status:'not_run',passed:false})),requests:[]}
}
export function assertNamespacePermissionReport(report) {
  assert.equal(report?.completed,true)
  assert.deepEqual(report.cases.map(row=>row.id),namespacePermissionCaseIds)
  for(const row of report.cases) {
    assert.equal(row.status,'passed',row.id);assert.equal(row.passed,true,row.id)
    assert(row.evidence&&typeof row.evidence==='object',row.id)
    if(row.id.endsWith('-denied')&&!row.id.includes('refresh')) {
      assert.equal(row.evidence.response.status,403)
      assert.deepEqual(row.evidence.immediate,row.evidence.before)
      assert(row.evidence.samples.length>=2)
      assert(row.evidence.observedMs>=row.evidence.minimumObservationMs&&row.evidence.minimumObservationMs>=2000)
      for(const sample of row.evidence.samples)assert.deepEqual(sample.snapshot,row.evidence.before)
    }
    if(row.id.endsWith('-ui-save')) {
      assert.equal(row.evidence.transport,'native-ui')
      assert.notEqual(row.evidence.before,row.evidence.value)
      assert.equal(row.evidence.readBack,row.evidence.value)
      assert(row.evidence.response.requestId&&row.evidence.response.source.documentId)
      assert(row.evidence.response.status>=200&&row.evidence.response.status<300)
    }
  }
  assert.equal(report.loginTransitions?.length,5,'Every production bookmark login must retain its callback evidence')
  assert.equal(report.loginTransitions.filter(item=>item.temporaryPasswordFlow).length,1)
  for(const transition of report.loginTransitions) {
    assert.equal(transition.requestedTarget,'/ui/main/flows')
    assert.equal(transition.anonymous.status,401)
    assert.equal(transition.loginDocument.path,'/oidc/login')
    assert(transition.previousDocument.documentId&&transition.loginDocument.documentId&&transition.finalDocument.documentId)
    assert.notEqual(transition.finalDocument.documentId,transition.loginDocument.documentId)
    assert.equal(transition.finalDocument.path,transition.temporaryPasswordFlow?'/oidc/password':'/ui/main/flows')
    assert.equal(transition.businessContent,transition.temporaryPasswordFlow?'restricted-password-change-form':'visible-flow-list-and-native-response')
    if(!transition.temporaryPasswordFlow)assert(transition.listResponses.length>0&&transition.listResponses.every(row=>row.status===200&&row.documentId===transition.finalDocument.documentId))
  }
  assert(Array.isArray(report.logoutTransitions)&&[3,4].includes(report.logoutTransitions.length),'Production exit evidence missing')
  for(const transition of report.logoutTransitions) {
    assert.equal(typeof transition.clicked,'boolean');assert.equal(transition.automatic,!transition.clicked)
    assert.equal(transition.finalDocument?.path,'/oidc/login');assert(transition.finalDocument.documentId)
    assert.equal(transition.anonymous?.status,401);assert.equal(transition.anonymous.source?.documentId,transition.finalDocument.documentId)
    assert(transition.logoutResponses.length>0&&transition.logoutResponses.every(row=>row.requestId&&row.documentId&&row.status===307))
  }
  const list=report.cases.find(row=>row.id==='second-exact-flow-kv-list-and-total').evidence
  assertNamespaceListEvidence(list,{namespaces:['company.sub','company.sub.child'],expectedLists:list.expectedLists})
  for(const request of report.requests)assert(request.requestId&&request.source?.documentId)
  return report
}
// Dismiss the host's own optional install notification with a native action.
// A new document may offer it again; do not hide/remove or click through it.
export async function dismissNamespaceInstallPrompt(page) {
  const label=await page.evaluate(()=>{
    const visible=node=>Boolean(node.getClientRects().length)&&getComputedStyle(node).visibility!=='hidden'&&getComputedStyle(node).display!=='none'
    const prompts=[...document.querySelectorAll('.pwa-install-prompt')].filter(visible)
    if(!prompts.length)return null
    if(prompts.length!==1)throw Error('Expected one visible native PWA install prompt')
    const buttons=[...prompts[0].querySelectorAll('.pwa-install-actions button')].filter(node=>visible(node)&&!node.disabled&&/^(Not now|暂不)$/i.test(node.textContent.trim()))
    if(buttons.length!==1)throw Error('Expected one native Not now / 暂不 action')
    return buttons[0].textContent.trim()
  })
  if(label===null)return false
  await page.click('.pwa-install-actions button:text-is('+JSON.stringify(label)+')')
  await page.waitForFunction(()=>![...document.querySelectorAll('.pwa-install-prompt')].some(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden'&&getComputedStyle(node).display!=='none'))
  return true
}
// Navigation can finish before the native KV request populates the table.
export function namespaceKvTargetReady({ns,id}) {
  const visible=node=>Boolean(node?.getClientRects().length)&&getComputedStyle(node).visibility!=='hidden'&&getComputedStyle(node).display!=='none'
  const rows=[...document.querySelectorAll('tbody tr')].filter(row=>visible(row)
    &&[...row.querySelectorAll('td')].some(cell=>cell.textContent.trim()===ns)
    &&[...row.querySelectorAll('td')].some(cell=>cell.textContent.trim()===id))
  return rows.length===1&&visible(rows[0].querySelector('[data-test="kv-edit"]'))
}
// A populated later page must not be required on the login landing page.
export function namespaceFlowLandingReady() {
  const visible=node=>Boolean(node?.getClientRects().length)&&getComputedStyle(node).visibility!=='hidden'&&getComputedStyle(node).display!=='none'
  return location.pathname==='/ui/main/flows'&&!document.querySelector('input[name="password"]')
    &&visible(document.querySelector('.flows-table'))
    &&[...document.querySelectorAll('.flows-table thead th,.flows-table [role="columnheader"]')].some(node=>visible(node)&&node.textContent.trim().length>0)
}
// Only the committed selected label proves selection. The input holds a search
// query and becomes empty after selection in the production design-system select.
// The object form returns a boolean for the same function used by browser waits.
export function namespacePickerState(argument) {
  const namespace=typeof argument==='string'?argument:argument.namespace
  const normalize=value=>String(value??'').replace(/\s+/g,' ').trim()
  const visible=node=>{const style=getComputedStyle(node);return Boolean(node.getClientRects().length)&&style.visibility!=='hidden'&&style.display!=='none'}
  const roots=[...document.querySelectorAll('[data-test="kv-namespace"]')].filter(visible)
  const root=roots.length===1?roots[0]:null
  const labels=root?[...root.querySelectorAll('.kel-select__selected-item.kel-select__placeholder:not(.is-transparent) span')].filter(visible):[]
  const selected=labels.length===1&&normalize(labels[0].innerText??labels[0].textContent)===namespace
  const options=[...document.querySelectorAll('[role="option"]')].filter(node=>visible(node)&&normalize(node.innerText??node.textContent)===namespace&&!node.disabled&&node.getAttribute('aria-disabled')!=='true')
  const state={selected,visibleOptions:options.length,ready:selected||options.length===1}
  return typeof argument==='string'?state:state[argument.waitFor]===true
}
// A pre-existing edit route is not a save-completion signal. Wait for the
// response to this operation before reading its persisted fields.
export async function waitNamespacePermissionResponse(page,{base,path,method,status,before,allowDraftQuery=false,timeoutMs=60000}) {
  const deadline=Date.now()+timeoutMs
  for(;;) {
    const events=(await page.diagnostics()).events
    const responses=events.filter(event=>!before.has(event.id)&&['http-response','http-error'].includes(event.kind)
      &&(event.url===base+path||allowDraftQuery&&event.url===base+path+'?draft=false')&&event.method===method)
    assert(responses.length<=1,'Exact response is ambiguous: '+method+' '+path)
    if(responses.length===1) {
      const response=responses[0]
      assert(events.some(event=>!before.has(event.id)&&event.kind==='request'&&event.requestId===response.requestId
        &&event.documentId===response.documentId&&event.url===response.url&&event.method===method),
      'Exact response has no request from this operation: '+method+' '+path)
      if(status!==undefined)assert.equal(response.status,status,'Exact response status differs')
      return response
    }
    assert(Date.now()<deadline,'Exact response missing before deadline: '+method+' '+path)
    await new Promise(resolve=>setTimeout(resolve,Math.min(100,Math.max(1,deadline-Date.now()))))
  }
}
// Keep the original error for explicit in-memory inspection only. Report writers
// use message/stack, never serialize or log cause. Longest first handles prefixes.
export function redactNamespacePermissionError(error,secrets) {
  let message=String(error?.message??error)
  for(const secret of [...new Set(secrets)].filter(value=>typeof value==='string'&&value.length).sort((a,b)=>b.length-a.length))message=message.replaceAll(secret,'[redacted]')
  return new Error(message,{cause:error})
}
export async function runNamespacePermissionBrowser(page,{base,account,controls,record=async()=>{}}) {
  const secrets=[account.password]
  const rememberSecret=value=>{assert(typeof value==='string'&&value.length>0);secrets.push(value);page.redactSecrets([value])}
  page.redactSecrets(secrets)
  const report=initialNamespacePermissionReport(),prefix='namespace_'+Date.now()
  const id=prefix,kv=prefix
  const api='/api/v1/main',management=api+'/extensions/rbac',group=management+'/application-groups/main'
  const persist=()=>record(structuredClone(report))
  async function check(name,operation) {
    const row=report.cases.find(item=>item.id===name);assert(row);row.status='running';await persist()
    try {row.evidence=await operation();row.status='passed';row.passed=true}
    catch(error){const safe=redactNamespacePermissionError(error,secrets);row.status='failed';row.error=safe.message;throw safe}
    finally{await persist()}
  }
  async function sourceResponse(path,method,status,before,{allowDraftQuery=false}={}) {
    const event=await waitNamespacePermissionResponse(page,{base,path,method,status,before,allowDraftQuery})
    const actual=new URL(event.url),request={path:actual.pathname+actual.search,method,status:event.status,requestId:event.requestId,source:{documentId:event.documentId},expectedStatuses:[event.status]}
    report.requests.push(request);return request
  }
  async function request(path,method='GET',body,revision,contentType='application/json') {
    const before=new Set((await page.diagnostics()).events.map(event=>event.id))
    const result=await page.evaluate(async({path,method,body,revision,contentType})=>{
      if(!['GET','HEAD'].includes(method)&&!document.querySelector('meta[name="csrf-token"]')?.content)throw Error('Production CSRF token missing')
      const response=await fetch(path,{method,credentials:'same-origin',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'X-CSRF-TOKEN':document.querySelector('meta[name="csrf-token"]')?.content??'',...(body===undefined?{}:{'Content-Type':contentType}),...(revision===undefined?{}:{'If-Match':'"'+revision+'"'})},...(body===undefined?{}:{body:contentType==='application/json'?JSON.stringify(body):body})})
      const text=await response.text();let value;try{value=JSON.parse(text)}catch{value=text}
      return {status:response.status,value}
    },{path,method,body,revision,contentType})
    return {...result,response:await sourceResponse(path,method,result.status,before)}
  }
  const ok=result=>{assert(result.status>=200&&result.status<300,'Production HTTP '+result.status);return result.value}
  const flowPath=ns=>api+'/flows/'+ns+'/'+id
  const kvPath=ns=>api+'/namespaces/'+ns+'/kv/'+kv
  const yaml=(ns,value)=>`id: ${id}\nnamespace: ${ns}\ndescription: ${value}\ntasks:\n  - id: hello\n    type: io.kestra.plugin.core.log.Log\n    message: Namespace permission acceptance\n`
  async function save(ns,kind,value) {
    const path=kind==='flow'?flowPath(ns):kvPath(ns)
    const before=await controls.readNamespaceResource({namespace:ns,kind,id})
    if(kind==='flow') {
      await page.goto(base+(before.length?'/ui/main/flows/edit/'+ns+'/'+id+'/edit':'/ui/main/flows/new'))
      await page.waitForFunction(()=>Boolean(document.querySelector('.monaco-editor .view-lines')))
      await dismissNamespaceInstallPrompt(page)
      await page.replaceEditorText(yaml(ns,value))
    } else {
      const kvNavigationEvents=new Set((await page.diagnostics()).events.map(event=>event.id))
      await page.goto(base+'/ui/main/kv')
      await page.waitForFunction(()=>Boolean(document.querySelector('[data-test="kv-add"]')))
      await dismissNamespaceInstallPrompt(page)
      if(before.length) {
        // Preserved qualification data can span pages. Use the native key search
        // before finding the exact namespace/key row; never edit a positional row.
        const search='input[placeholder="Search KV pairs"],input[placeholder="搜索 KV 对"]'
        await page.waitForFunction(()=>[...document.querySelectorAll('input[placeholder="Search KV pairs"],input[placeholder="搜索 KV 对"]')].filter(node=>node.getClientRects().length).length===1)
        await page.fill(search,id)
        await page.press(search,'Enter')
        await page.waitForFunction(namespaceKvTargetReady,{ns,id})
        const current=await page.evaluate(()=>({path:location.pathname,timeOrigin:performance.timeOrigin}))
        const deadline=Date.now()+60000
        for(;;) {
          const observed=(await page.diagnostics()).events.filter(event=>!kvNavigationEvents.has(event.id))
          const navigation=observed.filter(event=>event.kind==='document-navigation'&&new URL(event.url).pathname==='/ui/main/kv').at(-1)
          const response=observed.find(event=>event.kind==='http-response'&&event.documentId===navigation?.documentId&&event.method==='GET'&&event.status===200&&new URL(event.url).pathname==='/api/v1/main/kv')
          if(response) {
            assert(observed.some(event=>event.kind==='request'&&event.requestId===response.requestId&&event.documentId===response.documentId&&event.url===response.url&&event.method==='GET'),'Native KV load lacks source request')
            break
          }
          assert(Date.now()<deadline,'Current KV document has no successful native list response')
          await new Promise(resolve=>setTimeout(resolve,100))
        }
        assert.deepEqual(await page.evaluate(()=>({path:location.pathname,timeOrigin:performance.timeOrigin})),current)
        await page.waitForFunction(namespaceKvTargetReady,{ns,id})
        await dismissNamespaceInstallPrompt(page)
        await page.waitForFunction(()=>![...document.querySelectorAll('.kel-loading-mask')].some(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden'))
        assert(/^[a-z0-9_.]+$/.test(ns)&&/^namespace_[0-9]+$/.test(id),'Unexpected KV locator identity')
        await page.evaluate(({ns,id})=>{
          const rows=[...document.querySelectorAll('tbody tr')].filter(row=>[...row.querySelectorAll('td')].some(cell=>cell.textContent.trim()===ns)&&[...row.querySelectorAll('td')].some(cell=>cell.textContent.trim()===id))
          if(rows.length!==1)throw Error('Expected one settled namespace/key row')
          const button=rows[0].querySelector('[data-test="kv-edit"]')
          if(!button)throw Error('Settled KV row has no edit button')
          button.setAttribute('data-namespace-permission-edit','true')
        },{ns,id})
        await page.click('[data-namespace-permission-edit="true"]')
      } else {
      await page.click('[data-test="kv-add"]')
      let selection=await page.evaluate(namespacePickerState,ns)
      if(!selection.selected) {
        await page.fill('[data-test="kv-namespace"] input',ns)
        // Let Playwright's strict locator wait for and click the one exact native
        // option. A test-authored “dropdown settled” predicate is not a UI action.
        selection=await page.evaluate(namespacePickerState,ns)
        if(!selection.selected)await page.click('[role="option"]:text-is('+JSON.stringify(ns)+')')
      }
      await page.waitForFunction(namespacePickerState,{namespace:ns,waitFor:'selected'})
      // Focus the next real field; saving below still requires the exact namespace
      // endpoint and an independent storage readback, even for auto-selection.
      await page.fill('[data-test="kv-key"] input',kv)
      }
      await page.fill('[data-test="kv-value"] textarea',value)
    }
    await dismissNamespaceInstallPrompt(page)
    const events=new Set((await page.diagnostics()).events.map(event=>event.id))
    if(kind==='flow') {
      const label=await page.evaluate(()=>{const nodes=[...document.querySelectorAll('button')].filter(node=>node.getClientRects().length&&/^(Save|保存)$/.test(node.innerText.trim()));if(nodes.length!==1)throw Error('Expected one native save button');return nodes[0].innerText.trim()})
      await page.click('button:text-is('+JSON.stringify(label)+')')
      await page.waitForFunction(({ns,id})=>location.pathname.startsWith('/ui/main/flows/edit/'+ns+'/'+id),{ns,id})
    } else {
      await page.click('[data-test="kv-save"]')
      await page.waitForFunction(()=>!document.querySelector('[data-test="kv-save"]')?.getClientRects().length)
    }
    const response=await sourceResponse(kind==='flow'?(before.length?path:api+'/flows'):path,kind==='flow'?(before.length?'PUT':'POST'):'PUT',undefined,events,{allowDraftQuery:kind==='flow'})
    assert(response.status>=200&&response.status<300)
    const read=ok(await request(path)),readBack=kind==='flow'?read.description:read.value
    if(kind==='kv'){assert.equal(read.type,'STRING');assert(Number.isSafeInteger(read.revision)&&read.revision>0)}
    assert.equal(readBack,value)
    const stored=await controls.readNamespaceResource({namespace:ns,kind,id})
    assert.notDeepEqual(stored,before,'UI save did not change owned storage')
    return {transport:'native-ui',before:kind==='flow'?before.at(-1)?.description:before.at(-1)?.value,value,readBack,response,stored}
  }
  async function deny(ns,kind,action) {
    const before=await controls.namespaceEffects()
    const path=kind==='flow'?flowPath(ns):kvPath(ns)
    const createId=id+'_denied'
    const result=action==='read'?await request(path):kind==='flow'
      ?await request(action==='create'?api+'/flows':path,action==='create'?'POST':action==='update'?'PUT':'DELETE',action==='delete'?undefined:yaml(ns,'must-not-persist').replace('id: '+id,'id: '+(action==='create'?createId:id)),undefined,'application/x-yaml')
      :await request(action==='create'?path+'_denied':path,action==='delete'?'DELETE':'PUT',action==='delete'?undefined:'must-not-persist',undefined,'text/plain')
    assert.equal(result.status,403,'Out-of-scope '+kind+' '+action+' '+ns)
    const immediate=await controls.namespaceEffects();assert.deepEqual(immediate,before)
    const start=Date.now(),minimumObservationMs=2500,samples=[]
    do {await new Promise(resolve=>setTimeout(resolve,samples.length?250:0));const snapshot=await controls.namespaceEffects();samples.push({elapsedMs:Date.now()-start,snapshot});assert.deepEqual(snapshot,before,'Delayed rejected-write effect')}while(Date.now()-start<minimumObservationMs||samples.length<2)
    return {transport:'same-production-session-adversarial-request',response:result.response,before,immediate,samples,minimumObservationMs,observedMs:Date.now()-start}
  }
  async function lists(namespaces) {
    const results={}
    for(const kind of ['flow','kv']) {
      const path=kind==='flow'?api+'/flows/search':api+'/kv'
      const all=[];let total
      for(let pageNumber=1;;pageNumber++) {
        const value=ok(await request(path+'?size=2&page='+pageNumber))
        assert(Array.isArray(value.results));assert(Number.isSafeInteger(value.total))
        if(total===undefined)total=value.total;else assert.equal(value.total,total)
        all.push(...value.results);assert(all.length<=total)
        if(all.length===total)break
        assert(value.results.length>0)
      }
      if(namespaces.length===2)assert(all.every(row=>row.namespace==='company.sub'||row.namespace.startsWith('company.sub.')),'List leaked a namespace')
      const selected=all.filter(row=>(kind==='flow'?row.id:row.key)===id)
      assert.deepEqual(selected.map(row=>row.namespace).sort(),[...namespaces].sort())
      for(const ns of namespaces)ok(await request(kind==='flow'?flowPath(ns):kvPath(ns)))
      results[kind]={total,rows:all.map(row=>({namespace:row.namespace,id:kind==='flow'?row.id:row.key})),namespaces}
    }
    if(namespaces.length===2) {
      assert.equal(typeof controls.expectedNamespaceLists,'function','Independent complete database collection observer required')
      results.expectedLists=await controls.expectedNamespaceLists()
      assertNamespaceListEvidence(results,{namespaces,expectedLists:results.expectedLists})
    }
    return results
  }
  async function logout() {
    const previous=new Set((await page.diagnostics()).events.map(event=>event.id))
    await page.goto(base+'/ui/access-denied')
    await page.waitForFunction(()=>{
      const visible=selector=>[...document.querySelectorAll(selector)].some(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden')
      return location.pathname==='/oidc/login'&&document.readyState==='complete'&&visible('input[name="username"]')&&visible('input[name="password"]')
        ||location.pathname==='/ui/access-denied'&&visible('[data-testid="return-to-login"]')
    })
    const clicked=await page.evaluate(()=>location.pathname==='/ui/access-denied')
    if(clicked)await page.click('[data-testid="return-to-login"]')
    await page.waitForFunction(()=>location.pathname==='/oidc/login'&&document.readyState==='complete'
      &&Boolean(document.querySelector('input[name="username"]')?.getClientRects().length)
      &&Boolean(document.querySelector('input[name="password"]')?.getClientRects().length))
    const finalDocument=await page.evaluate(()=>({path:location.pathname,timeOrigin:performance.timeOrigin}))
    const events=(await page.diagnostics()).events.filter(event=>!previous.has(event.id))
    const navigation=events.filter(event=>event.kind==='document-navigation'&&new URL(event.url).pathname==='/oidc/login').at(-1)
    assert(navigation?.documentId,'Final production login document identity missing')
    const logoutResponses=events.filter(event=>event.kind==='http-response'&&event.url===base+'/oidc/logout'&&event.status===307)
    assert(logoutResponses.length>0,'Production logout redirect is missing')
    const loginResponse=events.find(event=>event.kind==='http-response'&&event.documentId===navigation.documentId&&new URL(event.url).pathname==='/oidc/login'&&event.status===200)
    assert(loginResponse,'Final login document was not loaded through the production redirect chain')
    if(!clicked)assert(events.some(event=>event.kind==='http-response'&&event.url===base+'/ui/access-denied'&&event.status===307),
      'Automatic logout requires the actual protected-page redirect')
    const anonymous=await request(api+'/flows/search?size=1')
    assert.equal(anonymous.status,401)
    assert.equal(anonymous.response.source.documentId,navigation.documentId,'Anonymous check ran in another document')
    assert.deepEqual(await page.evaluate(()=>({path:location.pathname,timeOrigin:performance.timeOrigin})),finalDocument,
      'Final login document changed during anonymous verification')
    const transition={clicked,automatic:!clicked,finalDocument:{...finalDocument,documentId:navigation.documentId},
      logoutResponses:logoutResponses.map(({id,requestId,documentId,url,status})=>({id,requestId,documentId,url,status})),
      anonymous:anonymous.response}
    ;(report.logoutTransitions??=[]).push(transition)
    await persist()
    return transition
  }
  async function login(user,password,{temporary=false}={}) {
    const requestedTarget='/ui/main/flows'
    const previous=new Set((await page.diagnostics()).events.map(event=>event.id))
    const previousDocument=await page.evaluate(()=>({path:location.pathname,timeOrigin:performance.timeOrigin}))
    const anonymous=await request(api+'/flows/search?size=1')
    assert.equal(anonymous.status,401,'Bookmark login must begin without a business session')
    // Ask for the authorized bookmark BEFORE authentication. Do not repair an
    // incorrect callback by navigating after login.
    await page.goto(base+requestedTarget)
    await page.waitForFunction(()=>location.pathname==='/oidc/login'&&document.readyState==='complete'
      &&Boolean(document.querySelector('input[name="username"]')?.getClientRects().length)
      &&Boolean(document.querySelector('input[name="password"]')?.getClientRects().length))
    const loginDocument=await page.evaluate(()=>({path:location.pathname,timeOrigin:performance.timeOrigin}))
    for(const [selector,value] of [['input[name="username"]',user],['input[name="password"]',password]]) {
      await page.focus(selector);await page.press(selector,'ControlOrMeta+A');await page.press(selector,'Backspace');await page.fill(selector,value)
    }
    assert(await page.evaluate(({user,password})=>document.querySelector('input[name="username"]')?.value===user&&document.querySelector('input[name="password"]')?.value===password,{user,password}),'Production login fields differ from intended credentials')
    await page.click('button[type="submit"]')
    if(temporary)await page.waitForFunction(()=>location.pathname==='/oidc/password'&&Boolean(document.querySelector('input[name="confirmation"]')?.getClientRects().length))
    else await page.waitForFunction(namespaceFlowLandingReady)
    const finalDocument=await page.evaluate(()=>({path:location.pathname,timeOrigin:performance.timeOrigin}))
    let events=(await page.diagnostics()).events.filter(event=>!previous.has(event.id))
    const loginNavigation=events.filter(event=>event.kind==='document-navigation'&&new URL(event.url).pathname==='/oidc/login').at(-1)
    const finalNavigation=events.filter(event=>['document-navigation','document-route'].includes(event.kind)&&new URL(event.url).pathname===finalDocument.path).at(-1)
    assert(loginNavigation?.documentId&&finalNavigation?.documentId,'Bookmark login document provenance missing')
    assert.notEqual(finalNavigation.documentId,loginNavigation.documentId,'Login did not replace its source document')
    assert(events.some(event=>event.kind==='request'&&event.url===base+requestedTarget),'Anonymous bookmark document request missing')
    let listResponses=[]
    if(!temporary) {
      const deadline=Date.now()+60000
      for(;;) {
        events=(await page.diagnostics()).events.filter(event=>!previous.has(event.id))
        listResponses=events.filter(event=>event.kind==='http-response'&&event.documentId===finalNavigation.documentId&&new URL(event.url).pathname===api+'/flows/search'&&event.status===200)
        if(listResponses.length)break
        assert(Date.now()<deadline,'Final Flow list has no successful native business request')
        await new Promise(resolve=>setTimeout(resolve,100))
      }
      assert(await page.evaluate(namespaceFlowLandingReady),'Final Flow list changed while awaiting native response')
      assert.deepEqual(await page.evaluate(()=>({path:location.pathname,timeOrigin:performance.timeOrigin})),finalDocument,'Native list response belongs to an obsolete landing document')
    }
    if(!temporary)await dismissNamespaceInstallPrompt(page)
    const transition={subject:user,requestedTarget,temporaryPasswordFlow:temporary,anonymous:anonymous.response,
      previousDocument:{...previousDocument,documentId:anonymous.response.source.documentId},
      loginDocument:{...loginDocument,documentId:loginNavigation.documentId},finalDocument:{...finalDocument,documentId:finalNavigation.documentId},
      businessContent:temporary?'restricted-password-change-form':'visible-flow-list-and-native-response',
      listResponses:listResponses.map(({requestId,documentId,status})=>({requestId,documentId,status})),
      redirects:events.filter(event=>event.kind==='http-response'&&['/ui/main/flows','/oauth/login/kestra','/oidc/authorize','/oidc/login','/oauth/callback/kestra','/oidc/password'].includes(new URL(event.url).pathname))
        .map(({requestId,documentId,url,status})=>({requestId,documentId,path:new URL(url).pathname,status}))}
    ;(report.loginTransitions??=[]).push(transition)
    await persist()
    return transition
  }
  try {
    for(const ns of ['company','company.sub'])for(const kind of ['flow','kv'])await check(`admin-${ns}-${kind}-ui-save`,()=>save(ns,kind,'saved_'+prefix+'_'+ns))
    await check('outside-baselines-control-plane',async()=>{
      const receipt=await controls.seedNamespaceBaselines({id,sourceNamespace:'company',namespaces:namespacePermissionNamespaces.filter(ns=>!['company','company.sub'].includes(ns))})
      assert.equal(receipt.transport,'owned-database-and-storage-seed');return receipt
    })
    await check('admin-global-flow-kv-list-and-details',()=>lists(namespacePermissionNamespaces))
    for(const ns of ['company2','outside'])for(const kind of ['flow','kv'])for(const action of ['create','update','delete'])await check(`admin-${ns}-${kind}-${action}-denied`,()=>deny(ns,kind,action))
    const second={username:prefix,password:account.password+'Second1!'};rememberSecret(second.password)
    let temporaryPassword
    await check('second-account-control-plane-preparation',async()=>{
      // Explicit control-plane API assistance. Never counted as a business UI save.
      const created=ok(await request(management+'/users','POST',{username:second.username,name:'Namespace scope test account',email:prefix+'@example.invalid'}))
      temporaryPassword=created.temporaryPassword;assert(temporaryPassword);rememberSecret(temporaryPassword)
      let current=ok(await request(group))
      ok(await request(group+'/scopes','POST',{key:prefix.replaceAll('_','-'),name:'Company subtree '+prefix,description:'Production namespace acceptance'},current.revision))
      // Reauthenticate after support/epoch mutations through the actual login UI.
      await logout();await login(account.username,account.password)
      await page.waitForFunction(()=>Boolean(document.querySelector('#side-menu')))
      const appPath=group+'/applications/~'+Buffer.from('kestra-ui').toString('base64url')
      const app=ok(await request(appPath))
      ok(await request(appPath+'/permissions','POST',{key:prefix.replaceAll('_','-'),name:'Company subtree '+prefix,scopeKeys:[prefix.replaceAll('_','-')],description:'Flow/KV subtree plus shared host metadata',enabled:true,managementGrants:[],grants:['FLOW','KVSTORE','NAMESPACE'].map(resource=>({scope:'NAMESPACE',tenant:'main',namespace:'company.sub',descendants:true,resource,actions:['READ','LIST','CREATE','UPDATE','DELETE'],ids:[],allIds:true})).concat([{scope:'TENANT',tenant:'main',namespace:null,descendants:false,resource:'METADATA',actions:['READ','LIST'],ids:[],allIds:true}])},app.revision))
      await logout();await login(account.username,account.password);await page.waitForFunction(()=>Boolean(document.querySelector('#side-menu')))
      const supported=ok(await request(appPath)).supportedScopeKeys
      assert(Array.isArray(supported)&&supported.includes(prefix.replaceAll('_','-')),'Permission did not derive application support')
      assert(app.supportedScopeKeys.every(key=>supported.includes(key)),'Preparing the second account removed existing application support')
      current=ok(await request(group))
      ok(await request(group+'/scope-grants','POST',{issuer:base,subject:second.username,scopeKeys:[prefix.replaceAll('_','-')]},current.revision))
      return {transport:'production-management-api-assistance',subject:second.username,scopeKeys:[prefix.replaceAll('_','-')],namespace:'company.sub',resources:['FLOW','KVSTORE','NAMESPACE'],additionalGrants:[{resource:'METADATA',scope:'TENANT',tenant:'main',actions:['READ','LIST'],purpose:'shared-host-metadata-only'}],temporaryPasswordIssued:true}
    })
    await check('second-account-password-change-and-login',async()=>{
      await logout();await login(second.username,temporaryPassword,{temporary:true})
      await page.waitForFunction(()=>location.pathname==='/oidc/password')
      await page.fill('input[name="password"]',second.password);await page.fill('input[name="confirmation"]',second.password);await page.click('button[type="submit"]')
      await page.waitForFunction(()=>location.pathname==='/oidc/login')
      await login(second.username,second.password)
      await page.waitForFunction(()=>!document.querySelector('input[name="password"]')&&location.pathname.startsWith('/ui/'))
      return {transport:'production-ui',subject:second.username,passwordChanged:true}
    })
    for(const ns of ['company.sub','company.sub.child'])for(const kind of ['flow','kv'])await check(`second-${ns}-${kind}-ui-save`,()=>save(ns,kind,'second_'+prefix+'_'+ns))
    await check('second-exact-flow-kv-list-and-total',async()=>{
      const result=await lists(['company.sub','company.sub.child'])
      result.flowDetail=await runNamespaceFlowDetailBrowser(page,{base,namespace:'company.sub',flowId:id,description:'second_'+prefix+'_company.sub'})
      return result
    })
    for(const ns of ['company','company.other','company2','outside'])for(const kind of ['flow','kv'])for(const action of ['read','create','update','delete'])await check(`second-${ns}-${kind}-${action}-denied`,()=>deny(ns,kind,action))
    await check('second-revocation-refresh-denied',async()=>{
      assert.equal(typeof controls.revokeNamespaceSubject,'function')
      const revocation=await controls.revokeNamespaceSubject({subject:second.username,account})
      await page.reload()
      await page.waitForFunction(()=>location.pathname==='/ui/access-denied'||location.pathname==='/oidc/login')
      const response=await request(flowPath('company.sub'));assert([401,403].includes(response.status))
      return {revocation,response:response.response,path:await page.evaluate(()=>location.pathname)}
    })
    await check('logout-switch-back-to-admin',async()=>{
      const anonymous=await page.evaluate(()=>location.pathname==='/oidc/login')
      if(!anonymous)await logout()
      await login(account.username,account.password);await page.waitForFunction(()=>Boolean(document.querySelector('#side-menu')))
      ok(await request(flowPath('company')))
      return {subject:account.username,transport:'production-ui'}
    })
    report.completed=true;assertNamespacePermissionReport(report);return report
  } catch(error) {throw redactNamespacePermissionError(error,secrets)}
  finally {await persist()}
}
