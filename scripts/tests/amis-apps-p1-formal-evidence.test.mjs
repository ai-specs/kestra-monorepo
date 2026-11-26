import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {amisP1Cases} from '../amis-apps-p1-cases.mjs'
import {validateAmisP1Report} from '../check-amis-apps-p1-report.mjs'

// Entirely synthetic offline protocol data. No real login, signature verification,
// execution or production acceptance is performed. The false flags below are
// inputs required to exercise the formal checker's file-reading success path.
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const expected={rootCommit:'a'.repeat(40),hostCommit:'b'.repeat(40),amisCommit:'c'.repeat(40),rbacCommit:'d'.repeat(40),hostImage:'ghcr.io/ai-specs/kestra-overlay@sha256:'+'e'.repeat(64),amisJarSha256:'f'.repeat(64),rbacJarSha256:'1'.repeat(64)}
// Explicit test scenario plan, independent of the checker's plan function.
const plans=[['p1-async'],['p1-init','p1-conditional','p1-query'],['p1-query','p1-query'],['p1-dialog'],['p1-async'],['p1-async'],['p1-async'],['p1-sync','p1-sync'],['p1-sync-expiry'],['p1-async'],['p1-async','p1-async'],[]]
function fixture(t){
 const directory=mkdtempSync(join(realpathSync(tmpdir()),'synthetic-p1-formal-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));mkdirSync(join(directory,'evidence'));mkdirSync(join(directory,'browser'))
 const evidence=[]
 const report={schemaVersion:1,stage:'P1',completed:true,synthetic:false,syntheticTestFixture:true,identityTransport:'production-oidc',inputs:expected,cases:[],summary:{passed:24,failed:0,skipped:0,notRun:0},resources:{cleaned:true,ownerVerified:true,containers:0,networks:0,volumes:0}}
 for(const [index,id] of amisP1Cases.entries()){
  const flowPlan=plans[index%12],marker='synthetic-change-'+index,subject='synthetic-subject-'+index,documentId='doc-'+index,requestId='credential-'+index,base='http://127.0.0.1:18129'
  const identity={subject,signatureVerified:true,synthetic:false,syntheticTestFixture:true}
  const productionLogin={subject,credentialsSubmitted:true,transport:'production-browser',httpStatus:303,identity,documentId,requestId}
  const ids=flowPlan.map((_,i)=>'synthetic-execution-'+index+'-'+i)
  const inputs={name:marker,quantity:7,category:'beta',date:'2026-12-01',enabled:true,details:marker+'-details',tags:[marker+'-tag']}
  const persisted=flowPlan.map((flowId,i)=>({id:ids[i],namespace:'company.amis.a',flowId,state:{current:index%12===5||index%12===7&&i===0?'FAILED':'SUCCESS',...(index%12===6?{histories:[{state:'CREATED'},{state:'RUNNING'},{state:'PAUSED'},{state:'RUNNING'},{state:'SUCCESS'}]}:{})},inputs:structuredClone(inputs),outputs:{response:{...structuredClone(inputs),message:marker}},trigger:{type:'io.kestra.plugin.amis.apps.ApiTrigger',variables:{apiId:'run',caller:subject}}}))
  const trace=flowPlan.map((flowId,i)=>({url:base+'/company.amis.a/'+flowId+'/apis/run',method:'POST',requestId:'post-'+index+'-'+i,documentId,responses:[{status:202}]}))
  const diagnostic={schemaVersion:1,syntheticTestFixture:true,integrity:[],events:[{id:'login-request-'+index,kind:'request',method:'POST',url:base+'/oidc/login',requestId,documentId},{id:'login-response-'+index,kind:'http-response',method:'POST',status:303,url:base+'/oidc/login',requestId,documentId}]}
  const path='browser/diagnostics-'+index+'.json',bytes=JSON.stringify(diagnostic);writeFileSync(join(directory,path),bytes)
  const attachment={path,sha256:sha(bytes)}
  const row={id,status:'passed',transport:'production-browser-and-execution-store',productionLogin,executionIds:ids,evidence:[]}
  const value={syntheticTestFixture:true,expected:{namespace:'company.amis.a',flowIds:[...new Set(flowPlan.length?flowPlan:['p1-async'])],apiId:'run',caller:subject,newExecutions:flowPlan.length},marker,before:['old-synthetic-execution'],after:['old-synthetic-execution',...ids],persisted,browser:{id,completed:true,checks:[{id:'exact-network-contract',status:'passed'}],productionLogin:structuredClone(productionLogin),identity:structuredClone(identity),trace,executionIds:[],attachments:[attachment],diagnostics:{integrity:[],errors:[],classifications:[],finalEvidence:{...attachment,events:2,integrity:0}}},databaseExecutions:persisted.map(x=>{const db=structuredClone(x);delete db.outputs;return db}),persistedReads:persisted.map(x=>{const db=structuredClone(x);delete db.outputs;return{method:'GET',path:'/api/v1/main/executions/'+x.id,status:200,execution:db}}),outputReads:persisted.map(x=>({method:'GET',path:'/api/v1/main/outputs/executions/'+x.id,status:200,outputs:structuredClone(x.outputs)})),outputStorage:persisted.filter(x=>x.state.current==='SUCCESS').map(x=>({executionId:x.id,tenantId:'main',valueBytes:123,valueSha256:'2'.repeat(64)})),resultReads:persisted.map(x=>({method:'GET',path:'/company.amis.a/'+x.flowId+'/apis/run/executions/'+x.id,status:200,body:{executionId:x.id,executionState:x.state.current,resultReady:true,status:x.state.current==='FAILED'?1:0,data:structuredClone(x.outputs.response)}}))}
  if(index%12===11){const sources={database:'3'.repeat(64),queue:'4'.repeat(64),storage:'5'.repeat(64)};row.refusal={status:id.startsWith('A-')?401:403};row.sideEffects={windowMs:5000,before:sources,after:structuredClone(sources),samples:[{elapsedMs:5000,sources:structuredClone(sources)}]};value.refusal=structuredClone(row.refusal);value.sideEffects=structuredClone(row.sideEffects)}
  report.cases.push(row);evidence.push(value)
 }
 function save(){for(const [index,value]of evidence.entries()){const path='evidence/case-'+index+'.json',bytes=JSON.stringify(value);writeFileSync(join(directory,path),bytes);report.cases[index].evidence=[{path,sha256:sha(bytes)}]}writeFileSync(join(directory,'report.json'),JSON.stringify(report))}
 save();return{directory,report,evidence,save,check:()=>validateAmisP1Report(JSON.parse(readFileSync(join(directory,'report.json'))),expected,{directory})}
}

test('SYNTHETIC complete 24-row formal file path verifies evidence and immutable diagnostics',t=>{
 const f=fixture(t);assert.deepEqual(f.check(),{stage:'P1',scope:'production-evidence-verified',passed:24,failed:0,skipped:0,notRun:0})
})
for(const [name,mutate]of [
 ['empty evidence object',f=>{f.evidence[0]={}}],
 ['missing subject binding',f=>{delete f.report.cases[0].productionLogin.identity.subject}],
 ['changed typed DB storage',f=>{f.evidence[0].databaseExecutions[0].inputs.quantity=8}],
 ['output from non-root execution',f=>{f.evidence[0].outputReads[0].path='/api/v1/main/outputs/executions/foreign-execution'}],
 ['changed typed native read',f=>{f.evidence[0].persistedReads[0].execution.inputs.quantity=8}],
 ['wrong main output storage tenant',f=>{f.evidence[0].outputStorage[0].tenantId='foreign'}],
 ['changed API business output',f=>{f.evidence[0].resultReads[0].body.data.quantity=99}],
 ['missing immutable diagnostic attachment',f=>{f.evidence[0].browser.attachments=[]}],
 ['changed diagnostic event identity',f=>{const ref=f.evidence[0].browser.attachments[0],path=join(f.directory,ref.path),d=JSON.parse(readFileSync(path));d.events[1].requestId='unpaired';const bytes=JSON.stringify(d);writeFileSync(path,bytes);ref.sha256=sha(bytes);f.evidence[0].browser.diagnostics.finalEvidence.sha256=sha(bytes)}]
])test('SYNTHETIC formal file path rejects '+name,t=>{const f=fixture(t);mutate(f);f.save();assert.throws(f.check)})
for(const location of ['evidence','diagnostic'])test('SYNTHETIC formal file path rejects corrupted '+location+' hash',t=>{const f=fixture(t),ref=location==='evidence'?f.report.cases[0].evidence[0]:f.evidence[0].browser.attachments[0];writeFileSync(join(f.directory,ref.path),'{}');assert.throws(f.check)})
