import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {phases} from '../upstream-upgrade-rehearsal.mjs'
const image='ghcr.io/ai-specs/kestra-overlay@sha256:'+'b'.repeat(64),sha='a'.repeat(64)
function report() {
 const x={schema:2,status:'passed',ownerLabel:'upgrade-test-owner',phases:Object.fromEntries(phases.map(name=>[name,{status:'passed'}])),retainedResources:[],resources:[{kind:'database',id:'upgrade_test',created:true,removed:true,owner:'upgrade-test-owner'}]}
 x.executionActions={mode:'B',completed:true,denialObservation:{windowMs:5000,databaseSha256:sha,storageSha256:sha},checks:['create','restart','replay','pause','resume','kill'].map((name,index)=>({name,status:'passed',evidence:{id:'execution-'+index,state:'FAILED',responseStatus:403,behavior:'fail-closed-unregistered-rest-route'}}))}
 x.oldExecutionActions=structuredClone(x.executionActions)
 x.phases.inputValidation.evidence={mode:'B',newImage:image,oldImage:'ghcr.io/ai-specs/kestra-overlay@sha256:'+'a'.repeat(64)}
 x.phases.ownedProvision.evidence={queueScopeProof:{cases:9,retained:[4,5,6,7,8]}}
 for(const name of ['oldBoundarySideEffects','newReadWriteBoundary','restoredDataAndBoundary']) x.phases[name].evidence={statuses:[403,403],windowMs:5000,tables:['flows','kv_metadata','queues'],databaseSha256:sha,storageSha256:sha}
 x.phases.consistentSnapshot.evidence={business:{sha256:sha,restoreSha256:sha}};x.phases.restoreDatabase.evidence={business:{restoreSha256:sha}};x.phases.restoreStorage.evidence={contentSha256:sha}
 return x
}
const mutations=[['complete evidence',()=>{},0],['late cleanup failure',x=>{x.phases.ownedCleanup.status='failed'},1],['leftover resource',x=>{x.resources[0].removed=false},1],['wrong deployment',x=>{x.phases.inputValidation.evidence.newImage=x.phases.inputValidation.evidence.oldImage},1],['refusal changed to success',x=>{x.phases.newReadWriteBoundary.evidence.statuses=[200,403]},1],['missing queue observation',x=>{x.phases.oldBoundarySideEffects.evidence.tables=['flows','kv_metadata']},1],['restore differs',x=>{x.phases.restoreDatabase.evidence.business.restoreSha256='c'.repeat(64)},1],['unknown housekeeping excluded',x=>{x.phases.ownedProvision.evidence.queueScopeProof.retained=[7,8]},1],['unexpected control write allowed',x=>{x.executionActions.checks[1].evidence.responseStatus=200},1],['wrong execution state',x=>{x.executionActions.checks[3].evidence.state='RUNNING'},1],['execution action failed',x=>{x.executionActions.checks[1].status='failed'},1],['missing final phase',x=>{delete x.phases.restoredDataAndBoundary},1]]
for(const [name,mutate,status] of mutations)test('upgrade report gate: '+name,()=>{
 const directory=mkdtempSync(join(tmpdir(),'upgrade-report-unit-'))
 try {
  const x=report();mutate(x);const path=join(directory,'report.json');writeFileSync(path,JSON.stringify(x))
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../check-upstream-upgrade-report.mjs',import.meta.url)),path,'B',image],{encoding:'utf8'})
  assert.equal(result.status,status,result.stderr)
 } finally {rmSync(directory,{recursive:true,force:true})}
})
