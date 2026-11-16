import assert from 'node:assert/strict'
import {aiBrowserCaseIdsByMode} from './application-project-ai-browser.mjs'
export function assertAiActivatedReport(report,inputs) {
  assert.equal(report?.schemaVersion,1);assert.equal(report.stage,'ai-activated');assert.equal(report.completed,true)
  assert.equal(report.failure,null);assert.deepEqual(report.modes.map(row=>row.mode),['A','B'])
  for(const row of report.modes){
    assert.equal(row.status,'passed');assert.equal(row.image,inputs.image)
    assert.equal(row.jarAbsent,row.mode==='A');assert.equal(row.jarSha256,row.mode==='A'?null:inputs.jarSha256)
    assert.match(row.configurationSha256,/^[a-f0-9]{64}$/);assert.equal(row.runtime.verified,true)
    assert.equal(row.browser.completed,true);assert.deepEqual(row.browser.checks.map(c=>c.id),aiBrowserCaseIdsByMode[row.mode])
    assert(row.browser.checks.every(c=>c.status==='passed'&&c.passed))
    if(row.mode==='B'){assert.equal(row.revocation.completed,true);assert.equal(row.revocation.denied,true);assert.equal(row.revocation.noBusinessSideEffects,true)}
  }
  assert(report.cleanup.some(c=>c.resource==='original-compose'&&c.restored===true))
  assert(report.cleanup.some(c=>c.resource==='model-transport'&&c.closed===true))
  assert(report.cleanup.filter(c=>c.resource==='owned-ai-data').length===2)
  assert(report.cleanup.filter(c=>c.resource==='owned-ai-data').every(c=>c.removed===true))
  return {modes:2,browserCases:13,revocation:1,failures:0,skipped:0,notRun:0}
}
