import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeFlowDetailCaseNames,assertPublishedNativeFlowDetailReport} from '../published-native-flow-detail-evidence.mjs'
const commit='a'.repeat(40),expectedHashes={'./serve.mjs':'b'.repeat(64)}
function sample(){return {transport:'explicit-test-transport',completed:true,passedGate:true,inputsRechecked:true,passed:37,notRun:0,finishedAt:'done',inputs:expectedHashes,
 cases:nativeFlowDetailCaseNames.map((name,index)=>({name,status:'passed',network:{runId:'owned',sourceHash:expectedHashes['./serve.mjs']},dom:{},finishedAt:'done',documentId:'d'+index,eventIds:['e'+index],diagnostics:{unexpected:[]},...(name.startsWith('visual-')?{visual:{surface:'rgb(1, 2, 3)',background:'rgb(1, 2, 3)',borderToken:'rgb(4, 5, 6)',border:'rgb(4, 5, 6)'}}:{})})),
 diagnostics:{events:nativeFlowDetailCaseNames.map((_,index)=>({id:'e'+index,kind:'request',documentId:'d'+index}))}}}
const check=report=>assertPublishedNativeFlowDetailReport(JSON.stringify(report),JSON.stringify({runId:'owned',sourceHash:expectedHashes['./serve.mjs']}),{commit,expectedHashes,classify:()=>({unexpected:[]})})
test('published detail matrix requires all twenty-one behavior and sixteen visual cases',()=>assert.equal(check(sample()).checks,37))
for(const [name,change] of [
 ['missing mode A',r=>r.cases.splice(18,1)],
 ['missing refreshed or changed target',r=>r.cases.splice(19,1)],
 ['missing Chinese narrow system theme',r=>r.cases.pop()],
 ['test transport called production',r=>r.transport='production-ui'],
 ['nonexistent document',r=>r.cases[0].documentId='invented'],
 ['nonexistent source event',r=>r.cases[0].eventIds=['invented']],
 ['different transport owner',r=>r.cases[0].network.runId='other'],
 ['different transport source',r=>r.cases[0].network.sourceHash='other'],
 ['missing computed style',r=>delete r.cases.find(row=>row.name.startsWith('visual-')).visual],
 ['wrong native surface',r=>r.cases.find(row=>row.name.startsWith('visual-')).visual.background='other'],
 ['uncovered browser failure',r=>r.diagnostics.events.push({id:'late-error',kind:'console-error'})],
])test('detail publication rejects '+name,()=>{const report=sample();change(report);assert.throws(()=>check(report))})
