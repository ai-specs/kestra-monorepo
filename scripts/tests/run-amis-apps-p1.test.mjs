import test from 'node:test'
import {createHash} from 'node:crypto'
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import {amisP1Cases} from '../amis-apps-p1-cases.mjs'
import {runAmisP1,verifyAmisP1OutputRead,amisP1Expected,amisP1Deployment,verifyAmisP1DeniedEffects,verifyAmisP1Persisted} from '../run-amis-apps-p1.mjs'
import {verifyAmisBrowserRuntime} from '../amis-apps-browser-driver.mjs'
import {verifyP1CredentialSubmission} from '../amis-apps-p1-browser-driver.mjs'
import {validateP1StoredReads,validateAmisP1Report,validateP1CaseEvidence} from '../check-amis-apps-p1-report.mjs'
const base='http://127.0.0.1:18080',marker='unique-p1',caller='test-caller'
const clone=value=>structuredClone(value)
function observed(id='A-complex-form-validates-and-persists-typed-inputs') {
 const expected=amisP1Expected(id,{caller,marker})
 const inputs={action:'save',name:marker,quantity:7,category:'beta',date:'2026-12-01',enabled:true,details:marker+'-details',tags:[marker+'-tag'],page:1,perPage:2}
 const execution={id:'real-id',namespace:'company.amis.a',flowId:expected.flowIds[0],state:{current:'SUCCESS'},inputs,outputs:{response:{...inputs,message:marker}},trigger:{type:'io.kestra.plugin.amis.apps.ApiTrigger',variables:{caller,apiId:'run'}}}
 const url=base+'/company.amis.a/'+execution.flowId+'/apis/run'
 const identity={subject:caller,issuer:base,audiences:['kestra-ui'],signatureVerified:true}
 const productionLogin={identity,subject:caller,credentialsSubmitted:true,httpStatus:303,transport:'production-browser',requestId:'credential',documentId:'login-document'}
 const browser={synthetic:true,scope:'test-transport',id,completed:true,identity,productionLogin,diagnostics:{integrity:[],errors:[]},checks:[{id:'exact-network-contract',status:'passed'}],executionIds:['real-id'],trace:[{method:'POST',url,requestId:'post',documentId:'page-document',responses:[{status:202}]},{method:'GET',url:url+'/executions/real-id',requestId:'poll',documentId:'page-document',responses:[{status:200}]}]}
 const database=clone(execution);delete database.outputs
 return {synthetic:true,id,expected,marker,persisted:[execution],before:['previous-id'],after:['previous-id','real-id'],browser,
  databaseExecutions:[database],persistedReads:[{method:'GET',path:'/api/v1/main/executions/'+execution.id,status:200,execution:clone(database)}],
  outputReads:[{method:'GET',path:'/api/v1/main/outputs/executions/'+execution.id,status:200,outputs:clone(execution.outputs)}],
  outputStorage:[{executionId:execution.id,tenantId:'main',valueBytes:20,valueSha256:'a'.repeat(64)}],
  resultReads:[{method:'GET',path:'/company.amis.a/'+execution.flowId+'/apis/run/executions/'+execution.id,status:200,body:{executionId:execution.id,executionState:'SUCCESS',resultReady:true,status:0,data:clone(execution.outputs.response)}}]}

}
test('all 24 fixed plans retain namespace A and exact execution counts',()=>{
 const counts=[1,3,2,1,1,1,1,2,1,1,2,0]
 for(const mode of ['A','B'])for(const [index,id]of amisP1Cases.filter(id=>id.startsWith(mode+'-')).entries()) {
  const plan=amisP1Expected(id,{caller,marker});assert.equal(plan.namespace,'company.amis.a');assert.equal(plan.newExecutions,counts[index])
  assert.deepEqual(Object.keys(plan).sort(),['apiId','caller','flowIds','namespace','newExecutions'])
 }
 assert.deepEqual(amisP1Expected('B-conditional-initial-load-and-query',{caller}).flowIds,['p1-init','p1-conditional','p1-query'])
})
test('deployment supplies actual container/image and formal jar mount bindings',()=>{
 const selected={hostImage:'image@sha256:formal',amisJarSha256:'a'.repeat(64),rbacJarSha256:'b'.repeat(64)}
 const inspected={postgresContainer:'1'.repeat(64),kestraContainer:'2'.repeat(64)}
 const value=amisP1Deployment('B',{project:'owner'},inspected,{Image:'sha256:actual'},selected)
 assert.deepEqual(value.containerIds,[inspected.postgresContainer,inspected.kestraContainer]);assert.equal(value.hostContainerId,inspected.kestraContainer)
 assert.equal(value.formalImage,selected.hostImage);assert.equal(value.actualImageId,'sha256:actual')
 assert.equal(value.jars.length,2);assert.equal(amisP1Deployment('A',{project:'owner'},inspected,{Image:'actual'},selected).jars.length,1)
})
test('valid independent DB, typed outputs and exact network agree with current root checker schema',()=>{
 const value=observed();assert.deepEqual(verifyAmisP1Persisted(value),['real-id'])
 assert(validateP1CaseEvidence({id:value.id,productionLogin:value.browser.productionLogin,executionIds:['real-id']},value))
})
for(const [name,mutate]of [
 ['extra persisted execution',v=>v.after.push('unexplained')],
 ['foreign flow',v=>v.persisted[0].flowId='p1-other'],
 ['namespace outside allow-a',v=>v.persisted[0].namespace='company.amis.b'],
 ['wrong API',v=>v.persisted[0].trigger.variables.apiId='other'],
 ['wrong caller',v=>v.persisted[0].trigger.variables.caller='other'],
 ['typed number became text',v=>v.persisted[0].inputs.quantity='7'],
 ['bound output changed',v=>v.persisted[0].outputs.response.details='wrong'],
 ['old execution poll',v=>v.browser.executionIds=['previous-id']],
 ['missing POST',v=>v.browser.trace=v.browser.trace.filter(row=>row.method!=='POST')],
 ['browser subcheck failed',v=>v.browser.checks[0].status='failed'],
 ['lost prior execution',v=>v.after=v.after.filter(id=>id!=='previous-id')],
 ['missing persisted details',v=>v.persisted=[]],
])test('fail closed: '+name,()=>{const value=observed();mutate(value);assert.throws(()=>verifyAmisP1Persisted(value))})
test('SYNC no-poll execution identity comes exclusively from actual inventory difference',()=>{
 const value=observed('A-sync-success-and-failure')
 const failed=clone(value.persisted[0]);failed.id='failed-id';failed.state.current='FAILED';failed.inputs.action='fail';delete failed.outputs
 value.persisted.push(failed);value.after.push(failed.id)
 value.browser.executionIds=[];value.browser.trace=[value.browser.trace[0],{...value.browser.trace[0],requestId:'post-two'}]
 assert.deepEqual(verifyAmisP1Persisted(value).sort(),['failed-id','real-id'])
 assert.deepEqual(value.browser.executionIds,[])
})
function effects() {
 const sources={database:'a'.repeat(64),queue:'b'.repeat(64),storage:'c'.repeat(64)},hash=createHash('sha256').update(JSON.stringify(sources)).digest('hex')
 return {windowMs:5000,sources:Object.keys(sources),before:hash,beforeSources:sources,immediate:hash,after:clone(sources),samples:[{elapsedMs:250,hash,sources:clone(sources)},{elapsedMs:5001,hash,sources:clone(sources)}]}
}
test('denial keeps full five-second content hashes rather than status or count only',()=>{
 const value=effects(),result=verifyAmisP1DeniedEffects(value)
 assert.deepEqual(result.before,value.beforeSources);assert.deepEqual(result.after,value.after);assert.equal(result.samples.at(-1).elapsedMs,5001)
})
for(const [name,mutate]of [
 ['short window',v=>v.windowMs=4999],['early end',v=>v.samples.at(-1).elapsedMs=4999],
 ['immediate mutation',v=>v.immediate='e'.repeat(64)],['delayed queue mutation',v=>v.samples[1].sources.queue='e'.repeat(64)],
 ['empty content hashes',v=>v.beforeSources={}],['final mutation',v=>v.after.storage='e'.repeat(64)],
 ['decreasing clock',v=>v.samples.unshift({...v.samples[1],elapsedMs:9000})],
])test('denial rejects '+name,()=>{const value=effects();mutate(value);assert.throws(()=>verifyAmisP1DeniedEffects(value))})
test('refusal requires exactly zero new executions and zero browser API POSTs',()=>{
 const value=observed('B-authenticated-refusal-has-no-delayed-effects');value.persisted=[];value.after=[...value.before];value.browser.executionIds=[];value.browser.trace=[]
 assert.deepEqual(verifyAmisP1Persisted(value),[])
 value.after.push('unexpected');assert.throws(()=>verifyAmisP1Persisted(value),/Unexpected newly/)
})

test('preflight failure retains an incomplete report before any environment or Docker startup',async()=>{
 const parent=mkdtempSync(join(fileURLToPath(new URL('../../.work/',import.meta.url)),'p1-runner-negative-'))
 const area=join(parent,'result')
 try {
  await assert.rejects(runAmisP1({directory:area,selected:{rootCommit:'0'.repeat(40)}}),error=>{assert.equal(error.reportPath,join(area,'report.json'));return true})
  const report=JSON.parse(readFileSync(join(area,'report.json')))
  assert.equal(report.completed,false);assert(report.failure.message);assert.equal(report.summary.notRun,24)
  assert.equal(report.resources.noEnvironmentConstructed,true);assert.equal(report.resources.cleaned,true)
 } finally {rmSync(parent,{recursive:true,force:true})}
})

test('execution GET without outputs is supplemented only by exact published output GET and main-tenant storage',()=>{
 const execution=observed().persisted[0],outputs=execution.outputs;delete execution.outputs
 const read={method:'GET',path:'/api/v1/main/outputs/executions/'+execution.id,status:200,outputs}
 const storage=[{executionId:execution.id,tenantId:'main',valueBytes:123,valueSha256:'a'.repeat(64)}]
 assert.deepEqual(verifyAmisP1OutputRead(execution,read,storage),outputs)
 for(const changed of [[{...storage[0],tenantId:'other'}],[{...storage[0],executionId:'other'}],[],[{...storage[0],valueBytes:0}]])assert.throws(()=>verifyAmisP1OutputRead(execution,read,changed))
 assert.throws(()=>verifyAmisP1OutputRead(execution,{...read,path:'/api/v1/main/outputs/executions/other'},storage))
 assert.throws(()=>verifyAmisP1OutputRead(execution,{...read,outputs:{}},storage))
})

function syntheticRuntime(mode='B') {
 const selected={hostImage:'ghcr.io/ai-specs/kestra-overlay@sha256:'+'a'.repeat(64),amisJarSha256:'b'.repeat(64),rbacJarSha256:'c'.repeat(64)}
 const inspected={postgresContainer:'1'.repeat(64),kestraContainer:'2'.repeat(64)}
 const deployment=amisP1Deployment(mode,{project:'synthetic-owner'},inspected,{Image:'sha256:'+'d'.repeat(64)},selected)
 const records=deployment.containerIds.map(Id=>({Id,State:{Running:true},Config:{Labels:{owner:deployment.project,'com.docker.compose.project':deployment.project},Image:selected.hostImage},Image:deployment.actualImageId,NetworkSettings:{Ports:{'8080/tcp':[{HostIp:'127.0.0.1',HostPort:'18080'}]}},Mounts:deployment.jars.map(jar=>({Destination:jar.target,RW:false}))}))
 const execute=async(command,args)=>{
  assert.equal(command,'docker') // A synthetic function only; never executes the command.
  if(args[0]==='inspect')return {code:0,stdout:JSON.stringify(records)}
  assert.deepEqual(args.slice(0,3),['exec',deployment.hostContainerId,'sha256sum'])
  return {code:0,stdout:deployment.jars.find(jar=>jar.target===args[3]).sha256+'  '+args[3]}
 }
 return {synthetic:true,base,deployment,records,execute}
}
test('runner deployment integrates with real driver validator through explicitly synthetic inspection',async()=>{
 for(const mode of ['A','B']) {const value=syntheticRuntime(mode);await verifyAmisBrowserRuntime(value,value.execute)}
})
for(const [name,mutate]of [
 ['owner differs',v=>v.records[1].Config.Labels.owner='foreign'],
 ['formal image differs',v=>v.records[1].Config.Image+='-changed'],
 ['actual image ID differs',v=>v.records[1].Image='sha256:'+'e'.repeat(64)],
 ['host port differs',v=>v.records[1].NetworkSettings.Ports['8080/tcp'][0].HostPort='9999'],
 ['public bind',v=>v.records[1].NetworkSettings.Ports['8080/tcp'][0].HostIp='0.0.0.0'],
 ['writable jar',v=>v.records[1].Mounts[0].RW=true],
 ['jar mount absent',v=>v.records[1].Mounts.pop()],
 ['jar hash differs',v=>{const original=v.execute;v.execute=async(c,a)=>a[0]==='exec'?{code:0,stdout:'f'.repeat(64)+'  '+a[3]}:original(c,a)}],
])test('driver integration rejects '+name,async()=>{const value=syntheticRuntime();mutate(value);await assert.rejects(verifyAmisBrowserRuntime(value,value.execute))})
function credentialEvents(){return [{kind:'request',url:base+'/oidc/login',method:'POST',requestId:'login',documentId:'doc-login'},{kind:'http-response',url:base+'/oidc/login',status:303,requestId:'login',documentId:'doc-login'}]}
test('driver credential receipt requires exact request and source document',()=>{
 const synthetic=true,events=credentialEvents();assert(synthetic)
 assert.equal(verifyP1CredentialSubmission(events,base,caller).httpStatus,303)
 for(const mutate of [v=>v[1].status=200,v=>v[1].documentId='different',v=>v[1].requestId='different',v=>v[0].url='http://foreign/oidc/login']) {
  const copy=clone(events);mutate(copy);assert.throws(()=>verifyP1CredentialSubmission(copy,base,caller))
 }
})
for(const [name,mutate]of [
 ['missing collector integrity',v=>delete v.browser.diagnostics.integrity],
 ['collector integrity failure',v=>v.browser.diagnostics.integrity.push({message:'lost events'})],
 ['unclassified browser error',v=>v.browser.diagnostics.errors.push({message:'unexpected HTTP 500'})],
 ['login response was not 303',v=>v.browser.productionLogin.httpStatus=200],
 ['synthetic identity receipt',v=>v.browser.identity.synthetic=true],
 ['identity receipt unverified',v=>v.browser.productionLogin.identity.signatureVerified=false],
 ['identity subject differs',v=>v.browser.productionLogin.identity.subject='someone-else'],
 ['browser identity differs from login receipt',v=>v.browser.identity={...v.browser.identity,issuer:'http://foreign'}],
 ['login source document missing',v=>delete v.browser.productionLogin.documentId],
 ['caller expected namespace changed',v=>v.expected.namespace='company.amis.b'],
 ['lost network assertion',v=>v.browser.checks=[]],
])test('checker interface rejects '+name,()=>{
 const value=observed();mutate(value)
 assert.throws(()=>validateP1CaseEvidence({id:value.id,productionLogin:value.browser.productionLogin,executionIds:['real-id']},value))
})

for(const [name,prepare,expectedError]of [
 ['missing attachments',()=>{},/Retained browser diagnostic files required/],
 ['attachment SHA mismatch',(value,area)=>{writeFileSync(join(area,'diagnostic.json'),'synthetic diagnostics');value.browser.attachments=[{path:'diagnostic.json',sha256:'0'.repeat(64)}]},/strictly equal/],
 ['final diagnostic missing',(value,area)=>{const bytes=JSON.stringify({synthetic:true,integrity:[],events:[]});writeFileSync(join(area,'diagnostic.json'),bytes);value.browser.attachments=[{path:'diagnostic.json',sha256:createHash('sha256').update(bytes).digest('hex')}]},/Final immutable diagnostics missing/],
])test('full checker rejects '+name+' before any remaining matrix rows',()=>{
 const area=mkdtempSync(join(tmpdir(),'p1-interface-synthetic-'))
 try {
  const value=observed();prepare(value,area)
  const bytes=JSON.stringify(value);writeFileSync(join(area,'case.json'),bytes)
  const inputs=Object.fromEntries(['rootCommit','hostCommit','amisCommit','rbacCommit'].map(key=>[key,'a'.repeat(40)]))
  Object.assign(inputs,{hostImage:'ghcr.io/ai-specs/kestra-overlay@sha256:'+'b'.repeat(64),amisJarSha256:'c'.repeat(64),rbacJarSha256:'d'.repeat(64)})
  const first={id:value.id,status:'passed',transport:'production-browser-and-execution-store',productionLogin:value.browser.productionLogin,executionIds:['real-id'],evidence:[{path:'case.json',sha256:createHash('sha256').update(bytes).digest('hex')}]}
  // Deliberately invalid partial report; can never be a full production pass.
  const report={testTransport:{synthetic:true},schemaVersion:1,stage:'P1',completed:true,synthetic:false,identityTransport:'production-oidc',inputs,cases:amisP1Cases.map((id,index)=>index?{id,status:'not_run'}:first)}
  assert.throws(()=>validateAmisP1Report(report,inputs,{directory:area}),error=>{
   assert.match(error.message,expectedError)
   if(name==='attachment SHA mismatch') {
    assert.equal(error.actual,createHash('sha256').update('synthetic diagnostics').digest('hex'))
    assert.equal(error.expected,'0'.repeat(64))
   }
   return true
  })
 } finally {rmSync(area,{recursive:true,force:true})}
})
test('output reader rejects array response, textual byte counts and duplicate storage bindings',()=>{
 const execution=observed().persisted[0],outputs=execution.outputs;delete execution.outputs
 const read={method:'GET',path:'/api/v1/main/outputs/executions/'+execution.id,status:200,outputs}
 const record={executionId:execution.id,tenantId:'main',valueBytes:20,valueSha256:'a'.repeat(64)}
 assert.throws(()=>verifyAmisP1OutputRead(execution,{...read,outputs:{response:[]}},[record]))
 assert.throws(()=>verifyAmisP1OutputRead(execution,read,[{...record,valueBytes:'20'}]))
 assert.throws(()=>verifyAmisP1OutputRead(execution,read,[record,record]))
})

test('producer read schema matches strict checker for normal success and zero-execution refusal',()=>{
 assert(validateP1StoredReads(observed()))
 const denied=observed('B-authenticated-refusal-has-no-delayed-effects')
 for(const key of ['persisted','databaseExecutions','persistedReads','outputReads','outputStorage','resultReads'])denied[key]=[]
 assert(validateP1StoredReads(denied))
})
for(const [name,change]of [
 ['missing array',v=>delete v.outputStorage],['DB tuple differs',v=>v.databaseExecutions[0].inputs.name='foreign'],
 ['native tuple differs',v=>v.persistedReads[0].execution.flowId='foreign'],['output read wrong ID',v=>v.outputReads[0].path+='/other'],
 ['output read data differs',v=>v.outputReads[0].outputs.response.message='foreign'],['wrong storage tenant',v=>v.outputStorage[0].tenantId='other'],
 ['result read wrong execution',v=>v.resultReads[0].body.executionId='other'],['result read data differs',v=>v.resultReads[0].body.data.quantity=999],
 ['orphan read',v=>v.resultReads.push(clone(v.resultReads[0]))],
])test('stored read interface rejects '+name,()=>{const value=observed();change(value);assert.throws(()=>validateP1StoredReads(value))})
