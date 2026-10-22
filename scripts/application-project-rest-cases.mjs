/** Real REST matrix; no account creation, SQL grants, fake principals or JWT decoding.
 * runApplicationProjectRest(base, fixture, record)
 * fixture.accounts[caseId]={username,password,subject}; fixture.observerAccount likewise.
 * fixture.probes['caseId:probeIndex']={flowId,executionId?,outputUri?,outputText?,
 *   source?, expectedSourceFragment?, expectedFields?,inputs?,expectedExecutionFields?,
 *   expectedList:[{namespace,id}],allowedNamespaces:[...],outsideList:[{namespace,id}],includeDescendants:false?}.
 * Sources for CREATE/UPDATE must be complete valid YAML and explicitly change
 * fields. All referenced flows/executions and out-of-range sentinels already exist;
 * CREATE targets alone must be absent. Dedicated DELETE targets must not be reused.
 * fixture.expectedAudience: REQUIRED actual production UI client ID.
 * Default identity source: ProductionOAuthClient.verifiedUiIdentity validates
 * the real OIDC ID-token cookie signature/issuer/audience/expiry before claims.
 * Cookie format/signature errors fail explicitly; no decode or endpoint fallback.
 * Optional explicit fixture.identity={mode:'endpoint',path,field?} selects an
 * ALREADY published same-session SERVER-VERIFIED identity envelope. Never add a
 * host identity API merely for acceptance; zero-grant accounts need no management
 * endpoint with the default signed-cookie method.
 * Optional fixture.verifiedIdentities[caseId] is NOT accepted as trustworthy input.
 * fixture.effects: ProjectSideEffects instance or its constructor configuration.
 * fixture.flowWrite={transport:'multipart'|'yaml',partName?}; multipart partName
 * MUST match the published host contract; no guessed form field. The currently
 * pinned executable has YAML single-flow create/update, not multipart single-flow
 * overloads. Use yaml for that published API; use multipart only after release.
 * Execution POST uses FormData inputs; output uses /executions/{id}/file?path=URI.
 * fixture.successStatuses optional {CREATE:[201],UPDATE:[200],DELETE:[204],EXECUTE:[200]}.
 * fixture.terminalExecutionState defaults SUCCESS, executionTimeoutMs<=60000.
 * fixture.effectsWindowMs>=5000. Sequential execution avoids self-induced snapshot
 * changes; callers must quiesce unrelated jobs in the explicitly isolated observer.
 * record receives partial/final {completed,matrix,failures,skipped:0,notRun,...}.
 * This is a REST report fragment, not a fabricated final composition report.
 */
import assert from 'node:assert/strict'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {ProjectSideEffects} from './application-project-effects.mjs'
import {projectScopeCases,applicationProject} from './application-project-cases.mjs'

const enc=encodeURIComponent
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,ordered(item)])):value
const equal=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b))
const pairs=items=>items.map(item=>item.namespace+'/'+item.id).sort()
const writes=new Set(['CREATE','UPDATE','DELETE','EXECUTE'])
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
function fieldsMatch(actual,expected,label) {
  assert(expected&&typeof expected==='object'&&!Array.isArray(expected)&&Object.keys(expected).length,label+': explicit persisted field expectations required')
  for(const [path,value] of Object.entries(expected)) {
    assert(!['__proto__','constructor','prototype'].some(part=>path.split('.').includes(part)),'unsafe expected field path')
    const observed=path.split('.').reduce((object,part)=>object?.[part],actual)
    assert(equal(observed,value),label+': persisted field differs: '+path)
  }
}

export async function runApplicationProjectRest(base,fixture,record) {
  assert.equal(typeof record,'function','persistent report callback required')
  const matrix=projectScopeCases.flatMap(testCase=>testCase.probes.map((probe,probeIndex)=>({transport:'rest',caseId:testCase.id,probeIndex,expectedAllowed:probe.allowed,resource:{tenant:'main',namespace:probe.namespace,resource:probe.resource,action:probe.action,...(probe.resourceId?{id:probe.resourceId}:{})},passed:false,status:'not_run',observed:{}})))
  const report={schemaVersion:1,completed:false,matrix,failures:0,skipped:0,notRun:matrix.length,requests:[],logins:[],cleanup:[],preconditionFailure:null}
  let observer
  let effects
  const prefix=fixture?.apiBase??'/api/v1/main'
  const pendingCleanup=[]
  const secrets=Object.values(fixture?.accounts??{}).map(account=>account?.password).concat(fixture?.observerAccount?.password).filter(Boolean)
  const safeError=error=>secrets.reduce((text,secret)=>text.replaceAll(secret,'[redacted]'),String(error?.message??error)).replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted-jwt]')
  const persist=async()=>{report.failures=matrix.filter(row=>row.status==='failed').length+(report.preconditionFailure?1:0)+report.cleanup.filter(row=>!row.passed).length;report.notRun=matrix.filter(row=>row.status==='not_run').length;await record(structuredClone(report))}
  async function request(client,path,options={},label='observer') {
    const response=await client.request(path,options)
    report.requests.push({case:label,method:options.method??'GET',path,status:response.status,at:new Date().toISOString()})
    return response
  }
  async function json(client,path,label) {
    const response=await request(client,path,{},label)
    assert.equal(response.status,200,'read failed: '+path)
    return response.json()
  }
  const flowPath=(namespace,id)=>prefix+'/flows/'+enc(namespace)+'/'+enc(id)
  async function login(account,label) {
    assert(account?.username&&account.password&&account.subject,'configured real account required: '+label)
    const client=new ProductionOAuthClient(base)
    const result=await client.login(account.username,account.password)
    const allowed=fixture.loginCallbackPaths??['/ui/','/ui/main/dashboards','/ui/access-denied']
    assert(allowed.includes(result.callbackPath),'unexpected production OAuth callback path: '+label)
    report.logins.push({case:label,subject:account.subject,callbackPath:result.callbackPath,authenticated:result.authenticated})
    return client
  }
  async function identity(client,account,testCase) {
    assert(typeof fixture.expectedAudience==='string'&&fixture.expectedAudience.length,'actual UI client ID fixture.expectedAudience is required')
    const mode=fixture.identity?.mode??'verified-ui-cookie'
    let actual
    if(mode==='verified-ui-cookie') {
      assert.equal(typeof client.verifiedUiIdentity,'function','production OAuth helper must support verifiedUiIdentity')
      // Deliberately no catch/fallback: a non-ID-token cookie or failed validation
      // fails this account's matrix rows, including a protocol-only identity.
      actual=await client.verifiedUiIdentity({applicationGroupId:applicationProject,subject:account.subject,audience:fixture.expectedAudience})
    } else {
      assert.equal(mode,'endpoint','unknown identity verification mode')
      assert(typeof fixture.identity.path==='string'&&fixture.identity.path.startsWith('/')&&!fixture.identity.path.startsWith('//'),'explicit published same-origin verified identity endpoint required')
      const response=await request(client,fixture.identity.path,{},testCase.id+':identity')
      assert.equal(response.status,200,'explicit verified endpoint is unavailable to this real identity')
      const body=await response.json()
      actual=fixture.identity.field?body[fixture.identity.field]:body
    }
    assert(actual&&typeof actual==='object','verified identity envelope absent')
    assert.equal(actual.subject,account.subject)
    assert.equal(actual.applicationGroupId,applicationProject)
    assert(typeof actual.issuer==='string'&&new URL(actual.issuer).origin===new URL(base).origin,'trusted identity issuer differs from production host')
    assert.deepEqual(actual.audiences,[fixture.expectedAudience],'trusted UI identity audience differs from the real UI client ID')
    assert(Array.isArray(actual.audiences)&&actual.audiences.length&&actual.audiences.every(value=>typeof value==='string'&&value))
    assert(Array.isArray(actual.applicationGroupScopes)&&actual.applicationGroupScopes.every(value=>typeof value==='string'))
    assert.equal(new Set(actual.applicationGroupScopes).size,actual.applicationGroupScopes.length)
    assert.deepEqual([...actual.applicationGroupScopes].sort(),[...testCase.scopes].sort(),'actual production scope set differs from unified matrix')
    return {subject:actual.subject,issuer:actual.issuer,audiences:[...actual.audiences],applicationGroupId:actual.applicationGroupId,applicationGroupScopes:[...actual.applicationGroupScopes],...(actual.clientId?{clientId:actual.clientId}:{})}
  }
  function flowBody(source) {
    assert(typeof source==='string'&&source.trim(),'complete fixture YAML required')
    if(fixture.flowWrite.transport==='yaml') return {headers:{'Content-Type':'application/x-yaml'},body:source}
    assert.equal(fixture.flowWrite.transport,'multipart')
    assert(typeof fixture.flowWrite.partName==='string'&&/^[A-Za-z][A-Za-z0-9_-]*$/.test(fixture.flowWrite.partName),'published multipart field name required')
    const body=new FormData();body.append(fixture.flowWrite.partName,new Blob([source],{type:'application/x-yaml'}),'flow.yaml')
    return {body} // fetch supplies the multipart boundary; never manually set it.
  }
  function operation(client,probe,data,label) {
    const id=probe.resourceId??data.flowId
    if(probe.action==='READ')return ()=>request(client,flowPath(probe.namespace,id)+'?source=true',{},label)
    if(probe.action==='LIST') {
      const query=new URLSearchParams({page:'1',size:'1',['filters[namespace]['+(data.includeDescendants===false?'EQUALS':'PREFIX')+']']:probe.namespace})
      return ()=>request(client,prefix+'/flows/search?'+query,{},label)
    }
    if(probe.action==='ACCESS_OUTPUTS') {
      assert(data.executionId&&data.outputUri,'real execution ID and existing output URI required')
      return ()=>request(client,prefix+'/executions/'+enc(data.executionId)+'/file?'+new URLSearchParams({path:data.outputUri}),{},label)
    }
    if(probe.action==='EXECUTE')return ()=>{
      const body=new FormData()
      for(const [name,value] of Object.entries(data.inputs??{}))body.append(name,String(value))
      return request(client,prefix+'/executions/'+enc(probe.namespace)+'/'+enc(id),{method:'POST',body},label)
    }
    if(probe.action==='DELETE')return ()=>request(client,flowPath(probe.namespace,id),{method:'DELETE'},label)
    assert(['CREATE','UPDATE'].includes(probe.action),'unsupported matrix action')
    return ()=>request(client,probe.action==='CREATE'?prefix+'/flows':flowPath(probe.namespace,id),{method:probe.action==='CREATE'?'POST':'PUT',...flowBody(data.source)},label)
  }
  async function listEvidence(client,probe,data,first,label) {
    assert(Array.isArray(data.expectedList)&&data.expectedList.length,'explicit nonempty authorized fixture list required')
    assert(Array.isArray(data.allowedNamespaces)&&data.allowedNamespaces.length,'explicit authorized namespace domain required')
    assert(Array.isArray(data.outsideList)&&data.outsideList.length,'real out-of-range list sentinels required')
    for(const item of [...data.expectedList,...data.outsideList]) {const real=await json(observer,flowPath(item.namespace,item.id),label+':list-seed');assert.equal(real.namespace,item.namespace);assert.equal(real.id,item.id)}
    const observed=[];const pages=[];let value=await first.json();let page=1;let total
    for(;;) {
      assert(Array.isArray(value.results),'published search response must contain results')
      assert(Number.isSafeInteger(value.total)&&value.total>=0,'search total is invalid')
      total??=value.total;assert.equal(value.total,total,'list changed while paging')
      assert(value.results.length<=1,'size=1 not respected')
      pages.push({page,total,items:value.results.map(({id,namespace})=>({id,namespace}))})
      for(const item of value.results){assert(typeof item.id==='string'&&typeof item.namespace==='string');assert(data.allowedNamespaces.includes(item.namespace),'list leaked namespace');assert(!observed.some(prior=>prior.id===item.id&&prior.namespace===item.namespace),'duplicate across pages');observed.push({id:item.id,namespace:item.namespace})}
      if(observed.length===total)break
      assert(value.results.length&&page<=total,'pagination stalled or exceeded total')
      const query=new URLSearchParams({page:String(++page),size:'1',['filters[namespace]['+(data.includeDescendants===false?'EQUALS':'PREFIX')+']']:probe.namespace})
      value=await json(client,prefix+'/flows/search?'+query,label)
    }
    if(total!==data.expectedList.length) {
      const unfiltered=await json(client,prefix+'/flows/search?size=1&page=1',label+':unfiltered-diagnostic')
      throw new Error('authorized list total differs: filtered='+total+', expected='+data.expectedList.length+', unfiltered='+unfiltered.total)
    }
    assert(data.outsideList.every(item=>!observed.some(actual=>actual.namespace===item.namespace&&actual.id===item.id)),'list leaked an out-of-range sentinel')
    assert.deepEqual(pairs(observed),pairs(data.expectedList),'authorized items differ from exact seeded fixture')
    if(probe.expectedIds){assert.deepEqual(observed.map(item=>item.id).sort(),[...probe.expectedIds].sort());assert.equal(total,probe.expectedIds.length)}
    const query=new URLSearchParams({page:String(page+1),size:'1',['filters[namespace]['+(data.includeDescendants===false?'EQUALS':'PREFIX')+']']:probe.namespace})
    const end=await json(client,prefix+'/flows/search?'+query,label)
    assert([0,total].includes(end.total),'empty-page total contradicts authorized count');assert.deepEqual(end.results,[],'page beyond authorized total is not empty')
    return {items:observed,total,pages,emptyPage:page+1}
  }
  try {
    assert(typeof fixture?.expectedAudience==='string'&&fixture.expectedAudience.length,'actual production UI client ID is mandatory')
    assert(fixture?.flowWrite&&['yaml','multipart'].includes(fixture.flowWrite.transport),'explicit published Flow write contract required')
    effects=fixture.effects instanceof ProjectSideEffects?fixture.effects:new ProjectSideEffects(fixture.effects)
    observer=await login(fixture.observerAccount,'observer')
    for(const testCase of projectScopeCases) {
      let client;let trusted;let setupFailure
      try {client=await login(fixture.accounts?.[testCase.id],testCase.id);trusted=await identity(client,fixture.accounts[testCase.id],testCase)}catch(error){setupFailure=error}
      for(const [probeIndex,probe]of testCase.probes.entries()) {
        const row=matrix.find(item=>item.caseId===testCase.id&&item.probeIndex===probeIndex)
        const label=testCase.id+':'+probeIndex
        row.status='running';row.startedAt=new Date().toISOString()
        try {
          if(setupFailure)throw setupFailure
          row.identity=trusted
          const data=fixture.probes?.[label];assert(data,'missing configured real fixture: '+label)
          const id=probe.resourceId??data.flowId;assert(typeof id==='string'&&id,'flow identity required')
          const path=flowPath(probe.namespace,id)
          // A denial must exercise an existing real resource, except CREATE, whose
          // valid body is independently checked against configured expected fields.
          let before
          if(probe.action!=='CREATE'&&probe.action!=='LIST'&&probe.action!=='ACCESS_OUTPUTS')before=await json(observer,path+'?source=true',label+':preflight')
          if(probe.action==='ACCESS_OUTPUTS') {
            const execution=await json(observer,prefix+'/executions/'+enc(data.executionId),label+':execution-preflight');assert.equal(execution.namespace,probe.namespace,'output namespace differs from matrix resource');assert.equal(execution.flowId,id,'output flow differs from configured target')
            const existing=await request(observer,prefix+'/executions/'+enc(data.executionId)+'/file?'+new URLSearchParams({path:data.outputUri}),{},label+':preflight')
            assert.equal(existing.status,200,'output denial target is not a real existing output');await existing.body?.cancel()
          }
          if(probe.action==='CREATE'){const absent=await request(observer,path,{},label+':preflight');assert.equal(absent.status,404,'CREATE target already exists');await absent.body?.cancel()}
          if(['CREATE','UPDATE'].includes(probe.action)) {
            assert(data.expectedSourceFragment&&data.source?.includes(data.expectedSourceFragment),'write must contain an explicit expected source change')
            fieldsMatch(data.expectedFields,data.expectedFields,'write expectations')
            if(before){assert(!before.source?.includes(data.expectedSourceFragment),'UPDATE source fragment does not change');assert(!Object.entries(data.expectedFields).every(([field,value])=>equal(field.split('.').reduce((obj,key)=>obj?.[key],before),value)),'UPDATE persisted fields are unchanged')}
          }
          const action=operation(client,probe,data,label)
          let response
          if(!probe.allowed&&writes.has(probe.action)) {
            const denial=await effects.observeDenied(action,async result=>{row.observed.status=result.status;row.observed.allowed=false;assert.equal(result.status,403,'only explicit authorization 403 satisfies this authenticated denial; 404/500 are failures');await result.body?.cancel()},{windowMs:fixture.effectsWindowMs??5000,intervalMs:250})
            row.observed.sideEffects=denial.observation
          } else {
            response=await action();row.observed.status=response.status;row.observed.allowed=response.status>=200&&response.status<300
            if(!probe.allowed){assert.equal(response.status,403,'404/500/redirect are not authorization denials');await response.body?.cancel()}
            else {
              assert(response.ok,'allowed operation returned HTTP '+response.status)
              if(probe.action==='LIST')Object.assign(row.observed,await listEvidence(client,probe,data,response,label))
              else if(probe.action==='READ'){const value=await response.json();assert.equal(value.id,id);assert.equal(value.namespace,probe.namespace);row.observed.persisted={id:value.id,namespace:value.namespace}}
              else if(probe.action==='ACCESS_OUTPUTS'){assert.equal(typeof data.outputText,'string','expected output bytes required');assert.equal(await response.text(),data.outputText);row.observed.outputBytesVerified=true}
              else {
                const accepted=fixture.successStatuses?.[probe.action]??({CREATE:[200,201],UPDATE:[200],DELETE:[200,204],EXECUTE:[200,201]})[probe.action]
                assert(accepted.includes(response.status),'unexpected successful mutation status')
                if(probe.action==='DELETE'){await response.body?.cancel();const removed=await request(observer,path,{},label+':persisted');assert.equal(removed.status,404,'DELETE did not remove the exact real flow');await removed.body?.cancel();row.observed.persisted={id,namespace:probe.namespace,deleted:true};pendingCleanup.push({path,action:'DELETE',beforeSource:before?.source})}
                else if(probe.action==='EXECUTE'){
                  const execution=await response.json();pendingCleanup.push({path:prefix+'/executions/'+enc(execution.id),action:'EXECUTE'});assert(execution.id&&execution.flowId===id&&execution.namespace===probe.namespace,'execution response identity mismatch')
                  const deadline=Date.now()+(fixture.executionTimeoutMs??60000);assert((fixture.executionTimeoutMs??60000)<=60000)
                  let stored
                  do{stored=await json(observer,prefix+'/executions/'+enc(execution.id),label+':persisted');assert.equal(stored.namespace,probe.namespace);assert.equal(stored.flowId,id);if(stored.state?.current===(fixture.terminalExecutionState??'SUCCESS'))break;assert(!['FAILED','KILLED','CANCELLED'].includes(stored.state?.current),'accepted execution failed');await delay(250)}while(Date.now()<deadline)
                  assert.equal(stored.state?.current,fixture.terminalExecutionState??'SUCCESS','execution did not persist expected terminal state within deadline');fieldsMatch(stored,data.expectedExecutionFields,'execution persistence');row.observed.persisted={id:stored.id,namespace:stored.namespace,flowId:stored.flowId,state:stored.state.current};row.observed.quiescence=await effects.waitForStable()
                }else{
                  await response.body?.cancel()
                  const stored=await json(observer,path+'?source=true',label+':persisted');assert.equal(stored.id,id);assert.equal(stored.namespace,probe.namespace);assert(stored.source?.includes(data.expectedSourceFragment),'saved source lacks edited field');fieldsMatch(stored,data.expectedFields,'flow persistence');row.observed.persisted={id,namespace:probe.namespace,fields:data.expectedFields,sourceFragmentVerified:true}
                  // Restoration uses real public operations only; DELETE fixture
                  // source is supplied by the caller because no YAML serializer is assumed.
                  pendingCleanup.push({path,action:probe.action,beforeSource:before?.source})
                }
              }
            }
          }
          row.passed=true;row.status='passed'
        }catch(error){row.passed=false;row.status='failed';row.error=safeError(error);if(error.sideEffects)row.observed.sideEffects=error.sideEffects}
        finally{row.finishedAt=new Date().toISOString();await persist()}
      }
    }
  }catch(error){report.preconditionFailure=safeError(error)}
  finally {
    // Isolated allowed CREATE/UPDATE changes remain explicitly listed for caller
    // cleanup. Never auto-delete a user's fixture or conceal a successful mutation.
    report.cleanupRequired=pendingCleanup.map(({path,action})=>({path,action}))
    report.completed=matrix.every(row=>row.passed&&row.status==='passed')&&!report.preconditionFailure
    await persist()
  }
  return report
}
