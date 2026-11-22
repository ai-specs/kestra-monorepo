import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
export const nativeFlowCaseNames=Object.freeze([
 'none-native-list-no-latest-no-chart-no-expected403','mixed-native-target-row-latest-and-chart','all-native-allowed-path-preserved','provider503-native-clears-content-and-displays-error',
 'identity-switch-ignores-pending-flow-response','identity-switch-cancels-pending-latest-and-unmounts-chart','identity-switch-cancels-pending-capability-projection','pagination-ignores-older-flow-page-response',
 'current-page-30s-expiry-rechecks-and-unmounts-revoked-content','mode-a-native-oss-without-capability-request',
])
// This source is a formal host report artifact. Validate its independently
// reviewed content lock before importing it; never infer final source from a
// single patch when later patches may update the same file.
export function assertPublishedNativeClassifierSource(source,expectedSha256) {
 assert.equal(typeof source,'string');assert(source.length>0,'Published native classifier source missing')
 assert.match(expectedSha256,/^[a-f0-9]{64}$/,'Reviewed classifier SHA-256 required')
 assert.equal(createHash('sha256').update(source).digest('hex'),expectedSha256,'Published native classifier differs from reviewed source')
 assert(source.includes('export function classifyDiagnostics'),'Published classifier export missing')
 return source
}
export function assertPublishedNativeFlowReport(raw,readinessRaw,{commit,expectedHashes,classify}) {
 return assertPublishedNativeReport(raw,readinessRaw,{commit,expectedHashes,classify,caseNames:nativeFlowCaseNames,requireViewport:true})
}
export function assertPublishedNativeReport(raw,readinessRaw,{commit,expectedHashes,classify,caseNames,requireViewport=false}) {
 assert.match(commit,/^[a-f0-9]{40}$/);assert.equal(typeof classify,'function')
 const report=JSON.parse(raw),readiness=JSON.parse(readinessRaw)
 assert.equal(report.transport,'explicit-test-transport')
 if(requireViewport){assert.equal(report.locale,'en');assert.equal(report.width,1280)}
 assert(Array.isArray(caseNames)&&caseNames.length>0&&new Set(caseNames).size===caseNames.length)
 for(const key of ['completed','passedGate','inputsRechecked'])assert.equal(report[key],true)
 assert.equal(report.passed,caseNames.length);assert.equal(report.notRun,0);assert(report.finishedAt)
 assert.deepEqual(report.cases.map(row=>row.name),caseNames)
 assert.deepEqual(report.inputs,expectedHashes,'Published native component source lock differs')
 assert.equal(readiness.sourceHash,expectedHashes['./serve.mjs']);assert(typeof readiness.runId==='string'&&readiness.runId.length>0)
 assert.equal(new Set(report.diagnostics.events.map(row=>row.id)).size,report.diagnostics.events.length)
 const covered=new Set()
 for(const row of report.cases){
  assert.equal(row.status,'passed');assert(row.network&&row.dom&&row.finishedAt&&row.documentId)
  assert.equal(row.network.runId,readiness.runId,'Native report used another transport owner')
  assert.equal(row.network.sourceHash,readiness.sourceHash,'Native report used another transport source')
  assert(Array.isArray(row.eventIds));assert.equal(new Set(row.eventIds).size,row.eventIds.length)
  const actual=report.diagnostics.events.filter(event=>row.eventIds.includes(event.id))
  assert.equal(actual.length,row.eventIds.length)
  assert(actual.some(event=>event.documentId===row.documentId),'Native case document has no source event')
  for(const id of row.eventIds){assert(!covered.has(id));covered.add(id)}
  const before=new Set(report.diagnostics.events.filter(event=>!row.eventIds.includes(event.id)).map(event=>event.id))
  const verdict=classify(report.diagnostics,row.name,row.documentId,before)
  assert.deepEqual(verdict,row.diagnostics);assert.deepEqual(verdict.unexpected,[])
 }
 assert(!report.diagnostics.events.some(event=>['console-error','page-error','http-error','request-failed','diagnostic-integrity-error'].includes(event.kind)&&!covered.has(event.id)))
 return {commit,checks:caseNames.length,failures:0,skipped:0,notRun:0,transport:report.transport,reportSha256:createHash('sha256').update(raw).digest('hex')}
}

export function extractPublishedNativeClassifier(patch,path='ui/tests/flow-execution-capabilities/diagnostics.mjs') {
 assert(['ui/tests/flow-execution-capabilities/diagnostics.mjs','ui/tests/flow-detail-capabilities/diagnostics.mjs'].includes(path))
 const blocks=patch.split(/^diff --git /m).filter(block=>block.startsWith('a/'+path+' b/'+path+'\n'))
 assert.equal(blocks.length,1);assert(blocks[0].includes('new file mode 100644'))
 const lines=blocks[0].split('\n'),start=lines.findIndex(line=>line.startsWith('@@ '));assert(start>0)
 const content=lines.slice(start+1).filter(line=>line.startsWith('+')).map(line=>line.slice(1)).join('\n')+'\n'
 assert(content.includes('export function classifyDiagnostics'))
 return content
}
