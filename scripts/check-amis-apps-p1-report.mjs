import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync,realpathSync,lstatSync} from 'node:fs'
import {resolve,sep} from 'node:path'
import {pathToFileURL} from 'node:url'
import {classifyP1PollDiagnostics,classifyP1SchemaUnloadDiagnostics} from './amis-apps-p1-poll-diagnostics.mjs'
import {classifyAccessControlDiagnostics} from './access-control-browser-diagnostics.mjs'
import {assertEquivalentExecutionState} from './amis-apps-execution-state.mjs'
import {validateP1DiagnosticBinding} from './amis-apps-p1-diagnostic-binding.mjs'
import {amisP1Cases} from './amis-apps-p1-cases.mjs'

const suffixOf=id=>id.replace(/^[AB]-/,'')
export function expectedP1ExecutionPlan(id) {
 const suffix=suffixOf(id)
 if(suffix==='authenticated-refusal-has-no-delayed-effects')return {flowIds:['p1-async'],count:0}
 if(suffix==='conditional-initial-load-and-query')return {flowIds:['p1-init','p1-conditional','p1-query'],count:3}
 if(suffix==='list-pagination-empty-and-loading')return {flowIds:['p1-query'],count:2}
 if(suffix==='sync-success-and-failure')return {flowIds:['p1-sync'],count:2}
 if(suffix==='sync-expiry-recovers-original-execution')return {flowIds:['p1-sync-expiry'],count:1}
 if(suffix==='dialog-form-submits-once')return {flowIds:['p1-dialog'],count:1}
 return {flowIds:['p1-async'],count:suffix.startsWith('client-timeout')?2:1}
}
function uniqueIds(values) {assert(Array.isArray(values)&&values.every(x=>typeof x==='string'&&/^[A-Za-z0-9_-]+$/.test(x)));assert.equal(new Set(values).size,values.length);return [...values].sort()}
export function validateP1CaseEvidence(row,value) {
 const plan=expectedP1ExecutionPlan(row.id),suffix=suffixOf(row.id)
 assert.deepEqual(value.expected,{namespace:'company.amis.a',flowIds:plan.flowIds,apiId:'run',caller:row.productionLogin.subject,newExecutions:plan.count},'Expected case binding differs')
 assert(typeof value.marker==='string'&&value.marker)
 const before=uniqueIds(value.before),after=uniqueIds(value.after),added=after.filter(id=>!before.includes(id))
 assert(before.every(id=>after.includes(id)),'Existing executions disappeared')
 assert.equal(added.length,plan.count,'Unexpected production execution count')
 assert.deepEqual(uniqueIds(row.executionIds),added,'Case inventory differs')
 assert.deepEqual(uniqueIds(value.persisted.map(x=>x.id)),added,'Stored execution set differs')
 const browser=value.browser
 assert.equal(browser.id,row.id);assert.equal(browser.completed,true)
 assert(browser.checks?.length>0&&browser.checks.every(c=>c.status==='passed'),'Browser steps incomplete')
 assert(browser.checks.some(c=>c.id==='exact-network-contract'),'Exact network step absent')
 assert.deepEqual(browser.productionLogin,row.productionLogin,'Browser login evidence differs')
 assert.deepEqual(browser.diagnostics?.integrity,[],'Collector integrity absent or failed');assert.deepEqual(browser.diagnostics?.errors,[],'Browser errors absent or failed')
 assert.equal(row.productionLogin.transport,'production-browser');assert.equal(row.productionLogin.httpStatus,303)
 assert.equal(row.productionLogin.identity?.signatureVerified,true);assert.equal(row.productionLogin.identity.subject,row.productionLogin.subject)
 assert.deepEqual(browser.identity,row.productionLogin.identity);assert.notEqual(browser.identity.synthetic,true)
 assert(row.productionLogin.documentId&&row.productionLogin.requestId)
 assert(Array.isArray(browser.trace)&&Array.isArray(browser.executionIds))
 assert(browser.executionIds.every(id=>added.includes(id)),'Poll crossed execution boundary')
 for(const request of browser.trace) {
  const url=new URL(request.url)
  const match=/^\/company\.amis\.a\/(p1-[a-z-]+)\/apis\/run(?:\/executions\/([A-Za-z0-9_-]+))?$/.exec(url.pathname)
  assert(match&&plan.flowIds.includes(match[1])&&!url.search&&!url.hash,'Browser request crossed published case route')
  assert(request.requestId&&request.documentId&&request.responses?.length,'Browser request source absent')
  assert(match[2]?request.method==='GET'&&added.includes(match[2]):request.method==='POST')
 }
 assert.equal(browser.trace.filter(r=>r.method==='POST').length,plan.count,'POST count differs from explicit actions')
 for(const execution of value.persisted) {
  assert.equal(execution.namespace,'company.amis.a');assert(plan.flowIds.includes(execution.flowId))
  assert.equal(execution.trigger?.type,'io.kestra.plugin.amis.apps.ApiTrigger')
  assert.equal(execution.trigger?.variables?.apiId,'run');assert.equal(execution.trigger?.variables?.caller,row.productionLogin.subject)
  const state=typeof execution.state==='string'?execution.state:execution.state?.current
  assert(['SUCCESS','WARNING','FAILED','KILLED','CANCELLED'].includes(state),'Execution did not reach terminal state')
  assert(execution.inputs&&typeof execution.inputs==='object')
  if(state==='SUCCESS'||state==='WARNING')assert(execution.outputs?.response&&typeof execution.outputs.response==='object','Persisted business response absent')
 }
 if(suffix==='complex-form-validates-and-persists-typed-inputs') {
  const execution=value.persisted[0],expected={name:value.marker,quantity:7,category:'beta',date:'2026-12-01',enabled:true,details:value.marker+'-details',tags:[value.marker+'-tag']}
  for(const [key,item] of Object.entries(expected))assert.deepEqual(execution.inputs[key],item,'Typed input differs: '+key)
  assert.equal(execution.outputs.response.message,value.marker)
  for(const key of ['quantity','category','date','enabled','details','tags'])assert.deepEqual(execution.outputs.response[key],expected[key],'Typed output differs: '+key)
 }
 if(suffix==='paused-execution-remains-pending') {
  assert.equal(value.persisted.length,1)
  assert.equal(value.persisted[0].state?.current,'SUCCESS')
  assert(value.persisted[0].state.histories?.some(row=>row.state==='PAUSED'),'Persisted execution never paused')
 }
 if(suffix==='async-failure-and-visible-message')assert(value.persisted.some(x=>(typeof x.state==='string'?x.state:x.state?.current)==='FAILED'))
 if(suffix==='sync-success-and-failure')assert.deepEqual(value.persisted.map(x=>typeof x.state==='string'?x.state:x.state?.current).sort(),['FAILED','SUCCESS'])
 if(suffix.startsWith('conditional'))assert.deepEqual([...new Set(value.persisted.map(x=>x.flowId))].sort(),[...plan.flowIds].sort())
 if(suffix==='authenticated-refusal-has-no-delayed-effects') {
  assert.deepEqual(row.executionIds,[])
  assert.deepEqual(value.refusal,row.refusal);assert.deepEqual(value.sideEffects,row.sideEffects)
  const effects=row.sideEffects
  for(const snapshot of [effects.before,effects.after,...effects.samples.map(x=>x.sources)]) {
   assert.deepEqual(Object.keys(snapshot).sort(),['database','queue','storage'])
   for(const key of ['database','queue','storage'])assert.match(snapshot[key],/^[a-f0-9]{64}$/)
   assert.deepEqual(snapshot,effects.before)
  }
 }
 return true
}

export function validateP1StoredReads(value) {
 for(const key of ['databaseExecutions','persistedReads','outputReads','outputStorage','resultReads'])assert(Array.isArray(value[key]),'Stored read evidence missing: '+key)
 assert.deepEqual(uniqueIds(value.databaseExecutions.map(x=>x.id)),uniqueIds(value.persisted.map(x=>x.id)))
 for(const execution of value.persisted) {
  const db=value.databaseExecutions.find(x=>x.id===execution.id)
  const native=value.persistedReads.filter(x=>x.path==='/api/v1/main/executions/'+execution.id)
  assert.equal(native.length,1);assert.equal(native[0].method,'GET');assert.equal(native[0].status,200)
  for(const key of ['id','namespace','flowId','inputs','state','trigger']) {
   assert.deepEqual(db[key],execution[key],'Database execution tuple differs: '+key)
   if(key==='state')assertEquivalentExecutionState(native[0].execution[key],execution[key],'Native execution state differs')
   else assert.deepEqual(native[0].execution[key],execution[key],'Native execution tuple differs: '+key)
  }
  const output=value.outputReads.filter(x=>x.path==='/api/v1/main/outputs/executions/'+execution.id)
  assert.equal(output.length,1);assert.equal(output[0].method,'GET');assert.equal(output[0].status,200)
  assert.deepEqual(output[0].outputs,execution.outputs,'Output read differs from claimed persisted output')
  if(execution.state.current==='SUCCESS') {
   const storage=value.outputStorage.filter(x=>x.executionId===execution.id&&x.tenantId==='main')
   assert.equal(storage.length,1,'Main-tenant persisted output record missing')
   assert(storage[0].valueBytes>0||typeof storage[0].uri==='string'&&storage[0].uri,'Output record contains no data')
   if(storage[0].valueBytes>0)assert.match(storage[0].valueSha256,/^[a-f0-9]{64}$/)
  }
  const result=value.resultReads.filter(x=>x.path==='/'+execution.namespace+'/'+execution.flowId+'/apis/run/executions/'+execution.id)
  assert.equal(result.length,1);assert.equal(result[0].method,'GET');assert.equal(result[0].status,200)
  assert.equal(result[0].body.executionId,execution.id);assert.equal(result[0].body.executionState,execution.state.current);assert.equal(result[0].body.resultReady,true)
  if(execution.state.current==='FAILED')assert.notEqual(result[0].body.status,0)
  else {assert.equal(result[0].body.status,0);assert.deepEqual(result[0].body.data,execution.outputs.response,'AMIS result differs from stored business output')}
 }
 for(const key of ['persistedReads','outputReads','resultReads'])assert.equal(value[key].length,value.persisted.length,'Unexpected orphan read')
 return true
}

export function validateAmisP1Report(report,expected,{directory}={}) {
  assert.equal(report.schemaVersion,1)
  assert.equal(report.stage,'P1')
  assert.equal(report.completed,true)
  assert.equal(report.synthetic,false)
  assert.equal(report.identityTransport,'production-oidc')
  assert.deepEqual(report.inputs,expected)
  for(const key of ['rootCommit','hostCommit','amisCommit','rbacCommit'])assert.match(expected[key],/^[a-f0-9]{40}$/)
  assert.match(expected.hostImage,/^ghcr.io\/ai-specs\/kestra-overlay@sha256:[a-f0-9]{64}$/)
  for(const key of ['amisJarSha256','rbacJarSha256'])assert.match(expected[key],/^[a-f0-9]{64}$/)
  assert.deepEqual(report.cases.map(row=>row.id),amisP1Cases)
  const root=directory&&realpathSync(directory)
  for(const row of report.cases) {
    assert.equal(row.status,'passed',row.id)
    assert.equal(row.transport,'production-browser-and-execution-store')
    assert(Array.isArray(row.evidence)&&row.evidence.length>0)
    for(const item of row.evidence) {
      assert(typeof item.path==='string'&&item.path&&!item.path.startsWith('/')&&!item.path.includes('\\')&&!item.path.includes(':')&&!item.path.split('/').some(part=>!part||part==='.'||part==='..'))
      assert.match(item.sha256,/^[a-f0-9]{64}$/)
      if(root) {
        const file=resolve(root,item.path),actual=realpathSync(file)
        assert(actual.startsWith(root+sep)&&!lstatSync(file).isSymbolicLink())
        const bytes=readFileSync(file)
        assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256)
        const evidence=JSON.parse(bytes)
        validateP1CaseEvidence(row,evidence)
        validateP1StoredReads(evidence)
        assert(evidence.browser.attachments?.length>0,'Retained browser diagnostic files required')
        const files=new Map()
        for(const attachment of evidence.browser.attachments) {
          assert(typeof attachment.path==='string'&&!attachment.path.startsWith('/')&&!attachment.path.includes('\\')&&!attachment.path.split('/').some(p=>!p||p==='.'||p==='..'))
          const path=resolve(root,attachment.path)
          assert(realpathSync(path).startsWith(root+sep)&&!lstatSync(path).isSymbolicLink())
          const content=readFileSync(path)
          assert.equal(createHash('sha256').update(content).digest('hex'),attachment.sha256)
          files.set(attachment.path,content)
        }
        const final=evidence.browser.diagnostics.finalEvidence
        assert(final?.path&&files.has(final.path),'Final immutable diagnostics missing')
        assert.equal(createHash('sha256').update(files.get(final.path)).digest('hex'),final.sha256)
        const diagnostics=JSON.parse(files.get(final.path))
        assert.equal(diagnostics.events.length,final.events);assert.equal(diagnostics.integrity.length,final.integrity)
        assert.deepEqual(diagnostics.integrity,[])
        assert.equal(new Set(diagnostics.events.map(e=>e.id)).size,diagnostics.events.length)
        assert(diagnostics.events.every(e=>e.id&&e.documentId&&e.kind))
        const credential=diagnostics.events.find(e=>e.kind==='request'&&e.method==='POST'&&e.requestId===row.productionLogin.requestId&&e.documentId===row.productionLogin.documentId)
        assert(credential,'Browser credential request missing in immutable collector')
        const base=new URL(credential.url).origin
        assert.equal(credential.url,base+'/oidc/login')
        assert(diagnostics.events.some(e=>e.kind==='http-response'&&e.status===303&&e.url===credential.url&&e.requestId===credential.requestId&&e.documentId===credential.documentId))
        const requests=[]
        if(row.id==='B-authenticated-refusal-has-no-delayed-effects')for(const event of diagnostics.events) {
          if(event.kind==='http-error'&&event.method==='GET'&&event.status===403&&event.url===base+'/company.amis.a/p1-async/pages/home')requests.push({requestId:event.requestId,source:{documentId:event.documentId},path:'/company.amis.a/p1-async/pages/home',method:'GET',status:403,expectedStatuses:[403]})
        }
        const classified=classifyAccessControlDiagnostics({events:diagnostics.events,base,requests})
        const polls=classifyP1PollDiagnostics({events:diagnostics.events,base,browser:evidence.browser})
        polls.classifications.push(...classifyP1SchemaUnloadDiagnostics({events:diagnostics.events,base,browser:evidence.browser}).classifications)
        const pollIds=new Set(polls.classifications.map(x=>x.id))
        classified.errors=classified.errors.filter(x=>!pollIds.has(x.id));classified.classifications.push(...polls.classifications)
        assert.deepEqual(classified.errors,[],'Retained collector has unexpected errors')
        assert.deepEqual(classified.classifications,evidence.browser.diagnostics.classifications,'Diagnostic classification differs')
        validateP1DiagnosticBinding(row,evidence,diagnostics)
      }
    }
    assert(row.productionLogin?.subject&&row.productionLogin.credentialsSubmitted===true)
    assert(Array.isArray(row.executionIds)&&new Set(row.executionIds).size===row.executionIds.length)
    for(const id of row.executionIds)assert.match(id,/^[A-Za-z0-9_][A-Za-z0-9_-]{0,149}$/)
    if(row.id.endsWith('authenticated-refusal-has-no-delayed-effects')) {
      assert.equal(row.refusal.status,row.id.startsWith('A-')?401:403)
      assert(row.sideEffects.windowMs>=5000&&row.sideEffects.samples.length>0)
      for(const sample of row.sideEffects.samples)assert.deepEqual(sample.sources,row.sideEffects.before)
      assert(row.sideEffects.samples.at(-1).elapsedMs>=row.sideEffects.windowMs)
    } else assert(row.executionIds.length>0,'Real Flow execution required: '+row.id)
  }
  assert.deepEqual(report.summary,{passed:24,failed:0,skipped:0,notRun:0})
  assert.equal(report.resources.cleaned,true)
  assert.equal(report.resources.ownerVerified,true)
  for(const key of ['containers','networks','volumes'])assert.equal(report.resources[key],0)
  return {stage:'P1',scope:root?'production-evidence-verified':'structure-only-no-files-verified',passed:24,failed:0,skipped:0,notRun:0}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const [file,expected,directory]=process.argv.slice(2)
  assert(directory,'Explicit evidence directory required for formal validation')
  console.log(JSON.stringify(validateAmisP1Report(JSON.parse(readFileSync(file)),JSON.parse(readFileSync(expected)),{directory})))
}
