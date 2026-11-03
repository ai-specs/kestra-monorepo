import test from 'node:test'
import assert from 'node:assert/strict'
import {initialRbacOnboardingReport,assertRbacOnboardingReport,rbacOnboardingCaseIds,rbacNormalOnboardingCaseIds,classifyRbacOnboardingDiagnostics} from '../rbac-onboarding-browser.mjs'
import {applicationGroupTables} from '../application-group-artifact-contract.mjs'
import {scopedRbacOnboardingEvents} from '../rbac-onboarding-browser.mjs'

const inputs={image:'ghcr.io/ai-specs/kestra-overlay@sha256:'+'a'.repeat(64),jarSha256:'b'.repeat(64),
  rootCommit:'c'.repeat(40),overlayCommit:'d'.repeat(40),pluginCommit:'e'.repeat(40)}
test('shared Ego adapter retains earlier failures and evaluates each journey exact event suffix',()=>{
  const first={id:'first',kind:'http-error',status:503},second={id:'second',kind:'page-error'}
  assert.deepEqual(scopedRbacOnboardingEvents({events:[first,second]},{events:[first]}),[second])
  assert.throws(()=>scopedRbacOnboardingEvents({events:[{...first,status:200},second]},{events:[first]}))
  assert.throws(()=>scopedRbacOnboardingEvents({events:[second]},{events:[first]}))
  assert.throws(()=>scopedRbacOnboardingEvents({events:[first,first]},{events:[first]}))
})
function completeReport() {
  const report=initialRbacOnboardingReport(inputs)
  for(const row of report.cases)Object.assign(row,{status:'passed',passed:true,evidence:{source:'production-browser-and-owned-storage'}})
  const evidence=id=>report.cases.find(row=>row.id===id).evidence
  Object.assign(evidence('missing-jar-guidance'),{form:false,text:'Place kestra-rbac-authorizer.jar in deployment/libs/'})
  Object.assign(evidence('jar-placement-does-not-hotload'),{form:false,formalJarVerified:true,text:'docker compose restart kestra'})
  Object.assign(evidence('restart-automatically-recovers-setup'),{recoveredWithoutManualNavigation:true,passwordAutomaticallyReplayed:false,path:'/oidc/setup'})
  report.restartWindows=[{startedAt:'2026-11-03T08:00:00Z',finishedAt:'2026-11-03T08:00:05Z'}]
  report.requests=[['POST',503],['POST',403],['GET',404],['POST',404]].map(([method,status],index)=>({path:'/oidc/setup',method,status,requestId:'request:'+index,source:{documentId:'document:'+index}}))
  for(const id of ['missing-participant-rejects-without-effects','setup-csrf-rejection-without-effects']) {
    evidence(id).before={accounts:0,installations:0,groups:0,credentials:0,clients:0,pluginTables:[]};evidence(id).after={accounts:0,installations:0,groups:0,credentials:0,clients:0,pluginTables:[]}
    evidence(id).status=403
  }
  evidence('first-account-creation-through-ui').subject='initial-admin'
  evidence('atomic-directory-and-first-subject-grant').state={accounts:1,installations:1,groups:1,credentials:1,clients:1,builtInGroupId:'main',subjects:['initial-admin'],scopeKeys:['admin'],catalogRevision:1}
  evidence('atomic-directory-and-first-subject-grant').state.pluginTables=[...applicationGroupTables].sort()
  for(const id of ['first-production-login-to-dashboard','dashboard-refresh-retains-canonical-path'])evidence(id).path='/ui/main/dashboards'
  Object.assign(evidence('initial-group-description-save-and-readback'),{beforeDescription:'initial',description:'changed',readBackDescription:'changed',beforeRevision:1,afterRevision:2})
  Object.assign(evidence('actual-access-management-menu'),{href:'/ui/main/extensions/rbac',path:'/ui/main/extensions/rbac/application-groups'})
  evidence('completed-setup-get-and-post-closed').statuses=[404,404]
  report.diagnostics={integrity:0,unexpectedErrors:0,reference:{kind:'immutable-browser-diagnostics',sha256:'f'.repeat(64)}}
  report.diagnostics.checkpoint={kind:'immutable-browser-diagnostics',sha256:'e'.repeat(64)}
  report.summary={planned:12,passed:12,failed:0,notRun:0,skipped:0};report.completed=true
  return report
}
function completeNormalReport() {
  const original=completeReport(),normal=initialRbacOnboardingReport(inputs,'normal')
  normal.cases=normal.cases.map(row=>row.id==='formal-jar-ready-without-restart'
    ?{...row,status:'passed',passed:true,evidence:{source:'production-browser-and-owned-storage',restartCount:0,jarSha256:inputs.jarSha256,path:'/oidc/setup',form:true}}
    :structuredClone(original.cases.find(source=>source.id===row.id)))
  normal.requests=original.requests.slice(1);normal.diagnostics=original.diagnostics
  normal.summary={planned:9,passed:9,failed:0,notRun:0,skipped:0};normal.completed=true
  return normal
}

test('new-user automatic installation has a unique named production workflow plan',()=>{
  assert.equal(rbacOnboardingCaseIds.length,12)
  assert.equal(new Set(rbacOnboardingCaseIds).size,12)
  const report=initialRbacOnboardingReport(inputs)
  assert(report.cases.every(row=>row.status==='not_run'&&!row.passed))
  assert.throws(()=>assertRbacOnboardingReport(report,inputs))
})
test('complete first-install report binds formal inputs and actual storage outcomes',()=>{
  assert.equal(assertRbacOnboardingReport(completeReport(),inputs).passed,12)
})
test('ordinary prepared-jar installation independently proves startup without any JVM restart',()=>{
  assert.equal(rbacNormalOnboardingCaseIds.length,9)
  assert.equal(assertRbacOnboardingReport(completeNormalReport(),inputs).passed,9)
})
for(const [name,mutate] of [
  ['unrequested restart',report=>{report.cases[0].evidence.restartCount=1}],
  ['different mounted jar',report=>{report.cases[0].evidence.jarSha256='0'.repeat(64)}],
  ['hidden wait state',report=>{report.cases[0].evidence.form=false}],
  ['reused recovery report',report=>{report.scenario='missing-jar'}],
])test('ordinary startup rejects '+name,()=>{const report=completeNormalReport();mutate(report);assert.throws(()=>assertRbacOnboardingReport(report,inputs))})
for(const [name,mutate] of [
  ['different image',report=>{report.inputs.image+='wrong'}],
  ['omitted row',report=>{report.cases.pop()}],
  ['duplicate row',report=>{report.cases[1]=report.cases[0]}],
  ['not run',report=>{report.cases[0].status='not_run'}],
  ['skip',report=>{report.summary.skipped=1}],
  ['unknown browser error',report=>{report.diagnostics.unexpectedErrors=1}],
  ['diagnostic loss',report=>{report.diagnostics.integrity=1}],
  ['wrong source',report=>{report.cases[0].evidence.source='mock'}],
  ['partial account creation',report=>{report.cases[1].evidence.after.accounts=1}],
  ['credential left after rejection',report=>{report.cases[1].evidence.after.credentials=1}],
  ['client left after rejection',report=>{report.cases[1].evidence.after.clients=1}],
  ['wrong credential count after success',report=>{report.cases[6].evidence.state.credentials=0}],
  ['extra client after success',report=>{report.cases[6].evidence.state.clients=2}],
  ['partial plugin schema after rejection',report=>{report.cases[1].evidence.after.pluginTables=['rbac_management_audit']}],
  ['missing current plugin table',report=>{report.cases[6].evidence.state.pluginTables.pop()}],
  ['wrong first subject',report=>{report.cases[6].evidence.state.subjects=['another-account']}],
  ['repeated directory initialization',report=>{report.cases[6].evidence.state.catalogRevision=2}],
  ['manual landing repair',report=>{report.cases[7].evidence.path='/ui/'}],
  ['unchanged form',report=>{report.cases[10].evidence.beforeDescription='changed'}],
  ['save not persisted',report=>{report.cases[10].evidence.readBackDescription='initial'}],
  ['setup reopens',report=>{report.cases[11].evidence.statuses=[200,200]}],
  ['missing placement instructions',report=>{report.cases[0].evidence.text='Not available'}],
  ['filename mistaken for activation',report=>{report.cases[2].evidence.form=true}],
  ['manual restart navigation',report=>{report.cases[3].evidence.recoveredWithoutManualNavigation=false}],
  ['automatic password replay',report=>{report.cases[3].evidence.passwordAutomaticallyReplayed=true}],
  ['missing restart window',report=>{report.restartWindows=[]}],
  ['wrong management menu',report=>{report.cases[9].evidence.href='/ui/main/flows'}],
  ['missing request source',report=>{delete report.requests[1].source}],
  ['missing explicit denial',report=>{report.requests.splice(1,1)}],
  ['wrong denied method',report=>{report.requests[1].method='GET'}],
  ['wrong request path',report=>{report.requests[1].path='/api/v1/main/flows'}],
])test('rejects '+name,()=>{
  const report=completeReport();mutate(report)
  assert.throws(()=>assertRbacOnboardingReport(report,inputs))
})

const base='http://localhost:18180'
const setup='/oidc/setup'
function restartEvents({path=setup,method='GET',documentPath=setup,message='net::ERR_CONNECTION_REFUSED',time='2026-11-03T08:00:01Z'}={}) {
  const source={documentId:'document:setup',url:base+path,documentUrl:base+documentPath,requestId:'restart-poll',method,observedAt:time}
  return [{...source,id:'request:1',kind:'request'},{...source,id:'failure:1',kind:'request-failed',message}]
}
const restartWindows=[{startedAt:'2026-11-03T08:00:00Z',finishedAt:'2026-11-03T08:00:05Z'}]
test('classifies only exact read-only setup polls inside owned restart window',()=>{
  const result=classifyRbacOnboardingDiagnostics({events:restartEvents(),base,requests:[],restartWindows})
  assert.equal(result.errors.length,0)
  assert.equal(result.classifications[0].reason,'owned-jvm-restart-setup-poll')
})
for(const [name,options,windows] of [
  ['post retry',{method:'POST'},restartWindows],
  ['business API',{path:'/api/v1/main/flows'},restartWindows],
  ['different source document',{documentPath:'/ui/main/dashboards'},restartWindows],
  ['unknown network error',{message:'net::ERR_FAILED'},restartWindows],
  ['outside restart window',{time:'2026-11-03T08:00:06Z'},restartWindows],
  ['missing owner window',{},[]],
])test('does not ignore '+name,()=>{
  const result=classifyRbacOnboardingDiagnostics({events:restartEvents(options),base,requests:[],restartWindows:windows})
  assert.equal(result.errors.length,1)
})
