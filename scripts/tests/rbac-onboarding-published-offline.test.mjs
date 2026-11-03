import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {hostInitialAccountCases,assertHostInitialAccountReports,assertHostOnboardingBrowserEvidence,hostOnboardingBrowserCaseNames,assertHostOnboardingDiagnostics,committedHostOnboardingSources,hostOnboardingSourceFiles} from '../rbac-onboarding-published-evidence.mjs'

test('committed onboarding provenance hashes exact Git blob bytes including terminal newlines and ignores dirty files',()=>{
  const directory=mkdtempSync(join(tmpdir(),'onboarding-provenance-'))
  try {
    const git=(...args)=>execFileSync('git',['-C',directory,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
    git('init');mkdirSync(join(directory,'patches/webserver'),{recursive:true});mkdirSync(join(directory,'scripts'))
    const files={'patches/webserver/0391-locale.patch':'exact\n\n','patches/webserver/0390-init.patch':'first\n',
      'scripts/onboarding-browser-cases.mjs':' cases\n\n','scripts/onboarding-playwright-runner.mjs':'runner\n','scripts/onboarding-playwright-adapter.mjs':'adapter\n'}
    for(const path of Object.values(hostOnboardingSourceFiles))files[path]??='additional source bytes\n'
    for(const [path,bytes] of Object.entries(files))writeFileSync(join(directory,path),bytes)
    git('add','.');git('-c','user.name=Offline test','-c','user.email=offline@example.invalid','-c','commit.gpgsign=false','commit','-m','Own temporary provenance test input')
    const commit=git('rev-parse','HEAD'),actual=committedHostOnboardingSources(directory,commit)
    const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),patchset=createHash('sha256')
    for(const path of Object.keys(files).filter(path=>path.endsWith('.patch')).sort())patchset.update(path+'\0'+sha(files[path])+'\n')
    assert.deepEqual(actual,{patchCount:2,patchsetSha256:patchset.digest('hex'),
      ...Object.fromEntries(Object.entries(hostOnboardingSourceFiles).map(([key,path])=>[key,sha(files[path])]))})
    writeFileSync(join(directory,'scripts/onboarding-browser-cases.mjs'),'uncommitted different bytes')
    assert.deepEqual(committedHostOnboardingSources(directory,commit),actual)
  } finally {rmSync(directory,{recursive:true,force:true})}
})

function diagnostics() {
  const expectedResponses=[1,2].map(index=>({requestId:'request-'+index,documentId:'document-'+index,url:'http://localhost:18080/oidc/setup'}))
  const events=expectedResponses.flatMap((source,index)=>[{...source,id:'request-event-'+index,kind:'request'},
    {...source,id:'error-event-'+index,kind:'http-error',status:400}])
  return {events,verdict:{passed:true,expectedResponses,allowedEventIds:['error-event-0','error-event-1']}}
}
test('downloaded first-install diagnostics allow only two source-bound invalid-form400 responses',()=>{
  assert.equal(assertHostOnboardingDiagnostics(diagnostics()).unknownErrors,0)
})
for(const [name,mutate] of [
  ['business error hidden as form failure',value=>{for(const source of [...value.events,...value.verdict.expectedResponses])source.url='http://localhost:18080/api/v1/main/flows'}],
  ['missing request source',value=>{value.events=value.events.filter(event=>event.id!=='request-event-0')}],
  ['different error document',value=>{value.events[1].documentId='another-document'}],
  ['unknown console error',value=>{value.events.push({id:'extra',kind:'console-error',documentId:'document-2',text:'Unexpected failure'})}],
  ['unknown request failure',value=>{value.events.push({id:'extra',kind:'request-failed',documentId:'document-2',error:'net::ERR_FAILED'})}],
  ['integrity failure',value=>{value.events.push({id:'extra',kind:'diagnostic-integrity-error'})}],
  ['invented green summary',value=>{value.verdict.allowedEventIds.push('extra')}],
])test('diagnostic audit rejects '+name,()=>{const value=diagnostics();mutate(value);assert.throws(()=>assertHostOnboardingDiagnostics(value))})

function browserEvidence() {
  const expectedSourceHashes={patchCount:48,patchsetSha256:'a'.repeat(64),sharedCasesSha256:'b'.repeat(64),runnerSha256:'c'.repeat(64),adapterSha256:'d'.repeat(64)}
  for(const key of Object.keys(hostOnboardingSourceFiles))expectedSourceHashes[key]??='e'.repeat(64)
  const report={completed:true,newNonEnglishCopyVerified:true,productionFirstInstallVerified:false,productionFirstInstall:false,environment:'host-http-test-service-substitute',checks:hostOnboardingBrowserCaseNames.map(name=>({name,passed:true}))}
  const inputs={sourceCommit:'f'.repeat(40),environment:'host-http-test-service-substitute; not production first-install acceptance',...expectedSourceHashes,
    uiAssets:{'assets/oidc-login-i18n.js':'e'.repeat(64),'assets/oidc-zh_CN-abcd.js':'e'.repeat(64),'assets/oidc-de-abcd.js':'e'.repeat(64)}}
  return {report,inputs,options:{commit:inputs.sourceCommit,expectedSourceHashes}}
}
test('published onboarding browser has exact21 real named checks and committed source binding',()=>{
  const {report,inputs,options}=browserEvidence()
  assert.equal(assertHostOnboardingBrowserEvidence(report,inputs,options).checks,21)
})
for(const [name,mutate] of [
  ['missing check',value=>{value.report.checks.pop()}],
  ['different ordered case',value=>{value.report.checks.reverse()}],
  ['failed check',value=>{value.report.checks[0].passed=false}],
  ['mock labeled production',value=>{value.report.productionFirstInstall=true}],
  ['different host commit',value=>{value.inputs.sourceCommit='0'.repeat(40)}],
  ['different patchset',value=>{value.inputs.patchsetSha256='0'.repeat(64)}],
  ['different driver',value=>{value.inputs.runnerSha256='0'.repeat(64)}],
  ['missing Chinese bundle',value=>{delete value.inputs.uiAssets['assets/oidc-zh_CN-abcd.js']}],
  ['invalid asset path',value=>{value.inputs.uiAssets['../secret.js']='e'.repeat(64)}],
])test('published browser rejects '+name,()=>{
  const value=browserEvidence();mutate(value)
  assert.throws(()=>assertHostOnboardingBrowserEvidence(value.report,value.inputs,value.options))
})

const reports=()=>Object.fromEntries(Object.entries(hostInitialAccountCases).map(([suite,names])=>[suite,
  '<testsuite tests="'+names.length+'" failures="0" errors="0" skipped="0">'+names.map(name=>'<testcase classname="io.kestra.webserver.oidc.'+suite+'" name="'+name+'()"/>').join('')+'</testsuite>']))
test('published host first-install evidence requires all45 precise named cases without rerunning them in root',()=>{
  const actual=assertHostInitialAccountReports(reports())
  assert.equal(actual.tests,45);assert.equal(actual.suites.length,8);assert.equal(actual.failures,0)
})
for(const [name,mutate] of [
  ['missing suite',raw=>{delete raw.OidcInitialAccountContractTest}],
  ['extra suite',raw=>{raw.UnrelatedTest=raw.OidcInitialAccountContractTest}],
  ['wrong name',raw=>{raw.OidcInitialAccountContractTest=raw.OidcInitialAccountContractTest.replace('acceptsOnlyValidatedImmutableContext','differentCase')}],
  ['wrong class',raw=>{raw.OidcInitialAccountContractTest=raw.OidcInitialAccountContractTest.replace('io.kestra.webserver.oidc.OidcInitialAccountContractTest','io.kestra.test.Invented')}],
  ['omitted case',raw=>{raw.OidcInitialAccountContractTest=raw.OidcInitialAccountContractTest.replace(/<testcase[^>]+\/>/,'')}],
  ['skip',raw=>{raw.OidcInitialAccountContractTest=raw.OidcInitialAccountContractTest.replace('skipped="0"','skipped="1"')}],
  ['failure',raw=>{raw.OidcInitialAccountContractTest=raw.OidcInitialAccountContractTest.replace('failures="0"','failures="1"')}],
  ['error',raw=>{raw.OidcInitialAccountContractTest=raw.OidcInitialAccountContractTest.replace('errors="0"','errors="1"')}],
])test('published first-install report rejects '+name,()=>{const raw=reports();mutate(raw);assert.throws(()=>assertHostInitialAccountReports(raw))})
