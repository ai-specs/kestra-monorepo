import test from 'node:test'
import assert from 'node:assert/strict'
import {amisP1Cases} from '../amis-apps-p1-cases.mjs'
import {validateAmisP1Report} from '../check-amis-apps-p1-report.mjs'
const expected={rootCommit:'a'.repeat(40),hostCommit:'b'.repeat(40),amisCommit:'c'.repeat(40),rbacCommit:'d'.repeat(40),hostImage:'ghcr.io/ai-specs/kestra-overlay@sha256:'+'e'.repeat(64),amisJarSha256:'f'.repeat(64),rbacJarSha256:'1'.repeat(64)}
const fixture=()=>({schemaVersion:1,stage:'P1',completed:true,synthetic:false,identityTransport:'production-oidc',inputs:{...expected},cases:amisP1Cases.map((id,index)=>({id,status:'passed',transport:'production-browser-and-execution-store',evidence:[{path:'evidence/case-'+index+'.json',sha256:'a'.repeat(64)}],productionLogin:{subject:'synthetic-test-only',credentialsSubmitted:true},executionIds:['execution_'+index],...(id.endsWith('authenticated-refusal-has-no-delayed-effects')?{refusal:{status:id.startsWith('A-')?401:403},sideEffects:{windowMs:5000,before:{database:'a',queue:'b',storage:'c'},samples:[{elapsedMs:5000,sources:{database:'a',queue:'b',storage:'c'}}]}}:{})})),summary:{passed:24,failed:0,skipped:0,notRun:0},resources:{cleaned:true,ownerVerified:true,containers:0,networks:0,volumes:0}})
test('synthetic report schema preserves ordered A/B24 production requirements',()=>assert.equal(validateAmisP1Report(fixture(),expected).passed,24))
for(const [name,change] of [
 ['missing case',r=>r.cases.pop()],['reordered IDs',r=>r.cases.reverse()],['duplicate ID',r=>r.cases[1].id=r.cases[0].id],
 ['test transport',r=>r.synthetic=true],['mock browser',r=>r.cases[0].transport='mock'],['missing login',r=>delete r.cases[0].productionLogin],['reused login',r=>r.cases[0].productionLogin.credentialsSubmitted=false],
 ['no execution',r=>r.cases[0].executionIds=[]],['duplicate execution',r=>r.cases[0].executionIds.push(r.cases[0].executionIds[0])],
 ['missing evidence',r=>r.cases[0].evidence=[]],['unsafe path',r=>r.cases[0].evidence[0].path='../report.json'],
 ['wrong input',r=>r.inputs.hostCommit='e'.repeat(40)],['failure',r=>r.cases[0].status='failed'],['not run',r=>r.summary.notRun=1],
 ['unauthenticated B denial',r=>r.cases.at(-1).refusal.status=401],['missing queue effects',r=>delete r.cases.at(-1).sideEffects.samples[0].sources.queue],['late effect',r=>r.cases.at(-1).sideEffects.samples[0].sources.storage='mutated'],['short observation',r=>r.cases.at(-1).sideEffects.samples[0].elapsedMs=100],['unclean resources',r=>r.resources.volumes=1],
])test('P1 gate rejects '+name,()=>{const r=fixture();change(r);assert.throws(()=>validateAmisP1Report(r,expected))})

import {validateP1CaseEvidence} from '../check-amis-apps-p1-report.mjs'
// Synthetic attachment tests only; production must also verify the actual file/hash.
function typedEvidence() {
 const row={id:amisP1Cases[0],executionIds:['execution-1'],productionLogin:{subject:'test-only',credentialsSubmitted:true,transport:'production-browser',httpStatus:303,identity:{subject:'test-only',signatureVerified:true},requestId:'login-1',documentId:'login-doc'}}
 const inputs={name:'changed-value',quantity:7,category:'beta',date:'2026-12-01',enabled:true,details:'changed-value-details',tags:['changed-value-tag']}
 const evidence={expected:{namespace:'company.amis.a',flowIds:['p1-async'],apiId:'run',caller:'test-only',newExecutions:1},marker:'changed-value',before:['old-execution'],after:['old-execution','execution-1'],persisted:[{id:'execution-1',namespace:'company.amis.a',flowId:'p1-async',state:{current:'SUCCESS'},trigger:{type:'io.kestra.plugin.amis.apps.ApiTrigger',variables:{apiId:'run',caller:'test-only'}},inputs,outputs:{response:{...inputs,message:'changed-value'}}}],browser:{id:row.id,completed:true,diagnostics:{integrity:[],errors:[]},checks:[{id:'exact-network-contract',status:'passed'}],productionLogin:structuredClone(row.productionLogin),identity:structuredClone(row.productionLogin.identity),executionIds:['execution-1'],trace:[{url:'http://127.0.0.1:18129/company.amis.a/p1-async/apis/run',method:'POST',requestId:'post-1',documentId:'page-1',responses:[{status:202}]}]}}
 return {row,evidence}
}
test('stored attachment enforces typed inputs, business outputs and explicit action count',()=>{const f=typedEvidence();assert(validateP1CaseEvidence(f.row,f.evidence))})
for(const [name,change] of [
 ['empty attachment',f=>f.evidence={}],['foreign namespace',f=>f.evidence.persisted[0].namespace='company.amis.b'],
 ['foreign Flow',f=>f.evidence.persisted[0].flowId='p1-sync'],['other caller',f=>f.evidence.persisted[0].trigger.variables.caller='other'],
 ['body forged API',f=>f.evidence.persisted[0].trigger.variables.apiId='forged'],['missing outputs',f=>delete f.evidence.persisted[0].outputs],
 ['string quantity',f=>f.evidence.persisted[0].inputs.quantity='7'],['string output',f=>f.evidence.persisted[0].outputs.response.quantity='7'],
 ['not terminal',f=>f.evidence.persisted[0].state.current='RUNNING'],['hidden extra execution',f=>f.evidence.after.push('hidden')],
 ['lost old execution',f=>f.evidence.after.shift()],['failed browser check',f=>f.evidence.browser.checks[0].status='failed'],
 ['missing native credentials',f=>f.evidence.browser.productionLogin.httpStatus=200],['replayed POST',f=>f.evidence.browser.trace.push(structuredClone(f.evidence.browser.trace[0]))],
 ['foreign poll',f=>f.evidence.browser.executionIds=['foreign-id']],['arbitrary route',f=>f.evidence.browser.trace[0].url='http://127.0.0.1:18129/company.amis.b/p1-async/apis/run']
])test('semantic attachment rejects '+name,()=>{const f=typedEvidence();change(f);assert.throws(()=>validateP1CaseEvidence(f.row,f.evidence))})

import {validateP1StoredReads} from '../check-amis-apps-p1-report.mjs'
function storedEvidence() {
 const {evidence}=typedEvidence(),execution=evidence.persisted[0],db=structuredClone(execution);delete db.outputs
 evidence.databaseExecutions=[db]
 evidence.persistedReads=[{method:'GET',path:'/api/v1/main/executions/'+execution.id,status:200,execution:structuredClone(db)}]
 evidence.outputReads=[{method:'GET',path:'/api/v1/main/outputs/executions/'+execution.id,status:200,outputs:structuredClone(execution.outputs)}]
 evidence.outputStorage=[{executionId:execution.id,tenantId:'main',valueBytes:123,valueSha256:'a'.repeat(64)}]
 evidence.resultReads=[{method:'GET',path:'/company.amis.a/p1-async/apis/run/executions/'+execution.id,status:200,body:{executionId:execution.id,executionState:'SUCCESS',resultReady:true,status:0,data:structuredClone(execution.outputs.response)}}]
 return evidence
}
test('formal stored reads require independently matching DB, native, output and API results',()=>assert(validateP1StoredReads(storedEvidence())))
for(const [name,change] of [
 ['no DB tuple',v=>v.databaseExecutions=[]],['changed native input',v=>v.persistedReads[0].execution.inputs.quantity=8],
 ['foreign output read',v=>v.outputReads[0].path='/api/v1/main/outputs/executions/other'],['changed actual output',v=>v.outputReads[0].outputs.response.message='other'],
 ['no output storage',v=>v.outputStorage=[]],['foreign tenant',v=>v.outputStorage[0].tenantId='other'],['empty output bytes',v=>v.outputStorage[0].valueBytes=0],
 ['wrong result execution',v=>v.resultReads[0].body.executionId='other'],['result not ready',v=>v.resultReads[0].body.resultReady=false],
 ['result lost business value',v=>v.resultReads[0].body.data.quantity=99],['orphan result read',v=>v.resultReads.push(structuredClone(v.resultReads[0]))]
])test('stored output binding rejects '+name,()=>{const v=storedEvidence();change(v);assert.throws(()=>validateP1StoredReads(v))})
test('memory-only schema validation explicitly cannot count as file verification',()=>assert.equal(validateAmisP1Report(fixture(),expected).scope,'structure-only-no-files-verified'))

test('paused production case requires same execution persisted PAUSED history before SUCCESS',()=>{
 const f=typedEvidence();f.row.id='A-paused-execution-remains-pending';f.evidence.browser.id=f.row.id
 f.evidence.persisted[0].state={current:'SUCCESS',histories:[{state:'CREATED'},{state:'PAUSED'},{state:'RUNNING'},{state:'SUCCESS'}]}
 assert(validateP1CaseEvidence(f.row,f.evidence))
 f.evidence.persisted[0].state.histories=[{state:'CREATED'},{state:'RUNNING'},{state:'SUCCESS'}]
 assert.throws(()=>validateP1CaseEvidence(f.row,f.evidence),/never paused/)
})
