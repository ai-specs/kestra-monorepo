#!/usr/bin/env node
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {phases} from './upstream-upgrade-rehearsal.mjs'
const [path,mode,image]=process.argv.slice(2)
assert(path&&['A','B'].includes(mode)&&/^ghcr\.io\/ai-specs\/kestra-overlay@sha256:[a-f0-9]{64}$/.test(image),'report path, mode and formal image required')
const report=JSON.parse(readFileSync(path,'utf8'))
assert.equal(report.status,'passed');assert.equal(report.schema,2)
assert.deepEqual(Object.keys(report.phases),phases)
assert(phases.every(name=>report.phases[name].status==='passed'),'All upgrade/recovery phases must pass')
assert.equal(report.phases.inputValidation.evidence.mode,mode)
assert.equal(report.phases.inputValidation.evidence.newImage,image)
assert.notEqual(report.phases.inputValidation.evidence.oldImage,image)
assert.deepEqual(report.retainedResources,[])
assert(report.resources.length>0&&report.resources.every(row=>row.created&&row.removed&&row.owner===report.ownerLabel))
assert.equal(report.phases.ownedProvision.evidence.queueScopeProof.cases,9)
assert.deepEqual(report.phases.ownedProvision.evidence.queueScopeProof.retained,[4,5,6,7,8])
for(const name of ['oldBoundarySideEffects','newReadWriteBoundary','restoredDataAndBoundary']) {
 const evidence=report.phases[name].evidence
 if(mode==='A') assert.equal(evidence.status,'notApplicable')
 else {
  assert.deepEqual(evidence.statuses,[403,403]);assert(evidence.windowMs>=5000)
  assert(evidence.tables.includes('flows')&&evidence.tables.includes('kv_metadata')&&evidence.tables.includes('queues'))
  assert(/^[a-f0-9]{64}$/.test(evidence.databaseSha256));assert(/^[a-f0-9]{64}$/.test(evidence.storageSha256))
 }
}
for(const actions of [report.oldExecutionActions,report.executionActions]) {
 assert.equal(actions?.completed,true);assert.equal(actions.mode,mode)
 assert.deepEqual(actions.checks.map(row=>[row.name,row.status]),['create','restart','replay','pause','resume','kill'].map(name=>[name,'passed']))
 assert(actions.checks.every(row=>typeof row.evidence?.id==='string'&&row.evidence.id.length>0))
 if(mode==='A') {
  assert.deepEqual(actions.checks.map(row=>row.evidence.state),['FAILED','FAILED','FAILED','PAUSED','SUCCESS','KILLED'])
  assert.equal(actions.checks[1].evidence.historyIncreased,true);assert.equal(actions.checks[2].evidence.newExecution,true)
 } else {
  assert(actions.checks.every(row=>row.evidence.state==='FAILED'))
  assert(actions.checks.slice(1).every(row=>row.evidence.responseStatus===403&&row.evidence.behavior==='fail-closed-unregistered-rest-route'))
  assert(actions.denialObservation?.windowMs>=5000)
  for(const key of ['databaseSha256','storageSha256']) assert(/^[a-f0-9]{64}$/.test(actions.denialObservation[key]))
 }
}
assert.equal(report.phases.consistentSnapshot.evidence.business.restoreSha256,report.phases.restoreDatabase.evidence.business.restoreSha256)
assert.equal(report.phases.consistentSnapshot.evidence.business.sha256.length,64)
assert.equal(report.phases.restoreStorage.evidence.contentSha256.length,64)
console.log(JSON.stringify({mode,status:'passed',phases:phases.length,failed:0,notRun:0,retainedResources:0,newImage:image}))
