import test from 'node:test'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {nativeFlowCaseNames,assertPublishedNativeFlowReport,assertPublishedNativeClassifierSource,extractPublishedNativeClassifier} from '../published-native-flow-evidence.mjs'
const commit='a'.repeat(40),hashes={'./serve.mjs':'b'.repeat(64)}
function fixture(){return {transport:'explicit-test-transport',locale:'en',width:1280,completed:true,passedGate:true,inputsRechecked:true,passed:21,notRun:0,finishedAt:'done',inputs:hashes,cases:nativeFlowCaseNames.map((name,i)=>({name,status:'passed',network:{runId:'owned-run',sourceHash:hashes['./serve.mjs']},dom:{},finishedAt:'done',documentId:'d'+i,eventIds:['e'+i],diagnostics:{unexpected:[]}})),diagnostics:{events:nativeFlowCaseNames.map((_,i)=>({id:'e'+i,kind:'request',documentId:'d'+i}))}}}
const readiness={runId:'owned-run',sourceHash:hashes['./serve.mjs']}
const check=(r,ready=readiness)=>assertPublishedNativeFlowReport(JSON.stringify(r),JSON.stringify(ready),{commit,expectedHashes:hashes,classify:()=>({unexpected:[]})})
test('exact published native matrix with source lock accepts',()=>assert.equal(check(fixture()).checks,21))
for(const [name,change]of [['missing case',r=>r.cases.pop()],['duplicate case',r=>r.cases[1]=r.cases[0]],['wrong lock',r=>r.inputs={}],['unfinished',r=>r.completed=false],['no completion hash',r=>r.inputsRechecked=false],['missing source',r=>delete r.cases[0].documentId],['missing event',r=>r.diagnostics.events.pop()],['duplicate event reference',r=>r.cases[1].eventIds=['e0']],['unknown external case error',r=>r.diagnostics.events.push({id:'unknown',kind:'console-error'})],['forged verdict',r=>r.cases[0].diagnostics={unexpected:[],fake:true}]])test('native report rejects '+name,()=>{const r=fixture();change(r);assert.throws(()=>check(r))})
test('server owner/source must match reviewed inputs',()=>{assert.throws(()=>check(fixture(),{...readiness,runId:''}));assert.throws(()=>check(fixture(),{...readiness,sourceHash:'other'}))})
test('classifier extraction accepts only exact new published file',()=>{const path='ui/tests/flow-execution-capabilities/diagnostics.mjs';const patch=`diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1 @@\n+export function classifyDiagnostics() {}\n`;assert.equal(extractPublishedNativeClassifier(patch),'export function classifyDiagnostics() {}\n');assert.throws(()=>extractPublishedNativeClassifier(patch.replace('new file mode 100644','index abc..def')));assert.throws(()=>extractPublishedNativeClassifier(patch+patch))})

const classifier='export function classifyDiagnostics() { return {expected:[],unexpected:[]} }\n'
const classifierHash=value=>createHash('sha256').update(value).digest('hex')
test('published classifier is accepted only after exact reviewed byte hash validation',()=>{
 assert.equal(assertPublishedNativeClassifierSource(classifier,classifierHash(classifier)),classifier)
})
for(const [name,source,hash]of [
 ['changed source',classifier+'// changed',classifierHash(classifier)],
 ['changed line endings',classifier.replaceAll('\n','\r\n'),classifierHash(classifier)],
 ['missing source','',classifierHash('')],
 ['unreviewed hash',classifier,'not-a-sha256'],
 ['missing export','const classifier = true',classifierHash('const classifier = true')],
])test('published classifier rejects '+name,()=>assert.throws(()=>assertPublishedNativeClassifierSource(source,hash)))

function noRequestUnmount(){
 const r=fixture(),last=r.cases.at(-1),previous=r.cases.at(-2)
 last.documentId=previous.documentId;last.eventIds=[];last.network.calls=[];last.dom={rows:[],canvases:0,errors:[]}
 r.diagnostics.events.pop();r.diagnostics.events.push({id:'live-document',kind:'document',documentId:previous.documentId})
 return r
}
test('no-request unmount retains the preceding live document source without inventing a network event',()=>assert.equal(check(noRequestUnmount()).checks,21))
for(const[name,change]of[
 ['another document',r=>r.cases.at(-1).documentId='unknown'],
 ['new final document',r=>r.diagnostics.events.push({id:'other-doc',kind:'document',documentId:'other'})],
 ['wrong predecessor',r=>r.cases.at(-2).name='other'],
 ['request after unmount',r=>r.cases.at(-1).network.calls=[{kind:'flows'}]],
 ['retained rows',r=>r.cases.at(-1).dom.rows=[{id:'old'}]],
 ['retained chart',r=>r.cases.at(-1).dom.canvases=1],
 ['application error',r=>r.cases.at(-1).dom.errors=['failure']],
 ['other case missing events',r=>r.cases[0].eventIds=[]],
])test('no-request source evidence rejects '+name,()=>{const r=noRequestUnmount();change(r);assert.throws(()=>check(r))})
