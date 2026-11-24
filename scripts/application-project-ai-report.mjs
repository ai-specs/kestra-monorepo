import assert from 'node:assert/strict'
import {aiBrowserCaseIdsByMode} from './application-project-ai-browser.mjs'
import {parseLifecycleJUnit} from './access-control-v3-gates.mjs'
export const aiProviderHostCases=Object.freeze({
  AiProvidersOperationTest:['mapsOnlyTheExactNativeProviderRouteToTenantAiRead','rejectsOtherMethodsPathsHandlersAndTenantsEvenWithMainVariable'],
  AiProvidersHttpTest:['aiReadAloneAllowsOnlyThePublicProviderFields','zeroAiPermissionDeniesBeforeReadingProviderConfiguration','unknownMethodsAndLegacyGenerationDoNotGainPermission'],
  AiProvidersNativeHttpTest:['modeAKeepsTheNativeProviderRouteWithoutAiPermission'],
})
export function assertAiProviderHostReports(rawReports){
  assert.deepEqual(Object.keys(rawReports).sort(),Object.keys(aiProviderHostCases).sort())
  const cases=[]
  for(const [suite,names]of Object.entries(aiProviderHostCases)){
    const parsed=parseLifecycleJUnit(rawReports[suite]);assert.equal(parsed.status,'passed')
    assert(parsed.cases.every(row=>row.status==='passed'&&row.classname==='io.kestra.webserver.rbac.'+suite))
    assert.deepEqual(parsed.cases.map(row=>row.name.replace(/\(\)$/,'')).sort(),[...names].sort())
    cases.push(...parsed.cases)
  }
  return {tests:cases.length,cases,failures:0,skipped:0,notRun:0}
}
export function assertAiActivatedReport(report,inputs) {
  assert.equal(report?.schemaVersion,1);assert.equal(report.stage,'ai-activated');assert.equal(report.completed,true)
  const sources=['application-project-ai-runtime.mjs','application-project-ai-browser.mjs','application-project-ai-controls.mjs','application-project-ai-deployment.mjs','ai-model-transport.mjs']
  assert.deepEqual(Object.keys(report.sourceSha256??{}).sort(),sources.sort())
  for(const value of Object.values(report.sourceSha256))assert.match(value,/^[a-f0-9]{64}$/)
  assert.equal(report.failure,null);assert.deepEqual(report.modes.map(row=>row.mode),['A','B'])
  for(const row of report.modes){
    assert.deepEqual(row.listTotal,{expected:row.mode==='A'?3:1,verified:true,source:'raw-function-response',functionResponses:1},'AI list total must be verified against actual authorized sentinels')
    assert.equal(row.status,'passed');assert.equal(row.image,inputs.image)
    assert.equal(row.jarAbsent,row.mode==='A');assert.equal(row.jarSha256,row.mode==='A'?null:inputs.jarSha256)
    assert.match(row.configurationSha256,/^[a-f0-9]{64}$/);assert.equal(row.runtime.verified,true)
    assert.equal(row.browser.completed,true);assert.deepEqual(row.browser.checks.map(c=>c.id),aiBrowserCaseIdsByMode[row.mode])
    assert(row.browser.checks.every(c=>c.status==='passed'&&c.passed))
    assert.equal(row.browser.checks.find(c=>c.id==='ai-stop').evidence?.business?.unchanged,true,'Native Stop requires unchanged business persistence, queue and storage')
    assert.equal(row.browser.diagnosticFailure,undefined)
    assert.deepEqual(row.browser.diagnostics?.unclassified,[],'AI browser diagnostics must be classified and contain no unexplained errors')
    if(row.mode==='B'){
      for(const id of ['ai-confirm-scope-denied','ai-confirm-business-revoked']){
        const check=row.browser.checks.find(check=>check.id===id)
        assert.equal(check.evidence?.expectedDenied,true);assert.equal(check.evidence?.business?.unchanged,true)
      }
      const businessRevoke=row.browser.checks.find(check=>check.id==='ai-confirm-business-revoked').evidence.revocation
      assert.equal(businessRevoke?.businessRevoked,true);assert.equal(businessRevoke?.aiExecuteRetained,true)
      assert.equal(row.revocation.completed,true);assert.equal(row.revocation.denied,true);assert.equal(row.revocation.noBusinessSideEffects,true)
      assert.equal(row.revocation.terminationDeadlineMs,60000)
      assert(Number.isFinite(row.revocation.terminationElapsedMs)&&row.revocation.terminationElapsedMs>=0&&row.revocation.terminationElapsedMs<=row.revocation.terminationDeadlineMs)
      assert.deepEqual(row.entryDenials?.map(value=>value.id),['ai-activated-zero-ai-entry','ai-activated-read-only-ai-entry'])
      for(const denial of row.entryDenials){
        for(const flag of ['passed','providerConfigured','noAiSideEffects','noBusinessSideEffects','noModelRequests'])assert.equal(denial[flag],true)
        assert.equal(denial.status,'passed');assert.equal(denial.requests.length,4)
        assert.deepEqual(denial.requests.map(request=>request.status),[403,denial.id.includes('zero-ai')?403:200,403,403])
      }
      assert.equal(row.lateRelease?.status,409);assert(row.lateRelease.disconnected>0)
    }
  }
  assert(report.cleanup.some(c=>c.resource==='original-compose'&&c.restored===true))
  assert(report.cleanup.some(c=>c.resource==='model-transport'&&c.closed===true))
  assert(report.cleanup.filter(c=>c.resource==='owned-ai-data').length===2)
  assert(report.cleanup.filter(c=>c.resource==='owned-ai-data').every(c=>c.removed===true))
  return {modes:2,browserCases:15,entryDenials:2,revocation:1,failures:0,skipped:0,notRun:0}
}
