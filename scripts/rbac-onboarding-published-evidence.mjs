import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {parseLifecycleJUnit} from './access-control-v3-gates.mjs'

export const hostOnboardingBrowserCaseNames=Object.freeze([
  'standalone-auth-entry-served-as-javascript','missing-component-no-account-form','deployment-guidance-is-visible',
  ...[1280,390].flatMap(width=>['light','dark','dark-2','syncWithSystem'].map(theme=>'wait-theme-'+theme+'-'+width)),
  'en-waiting-real-copy','zh_CN-waiting-real-copy','chinese-preference-loader-is-native',
  'automatic-wait-recovers-fresh-csrf-without-post','form-keyboard-focus','restored-form-rbac-description',
  'en-form-real-copy','en-server-error-real-copy','zh_CN-form-real-copy','zh_CN-server-error-real-copy',
])

export const hostOnboardingSourceFiles=Object.freeze({
  sharedCasesSha256:'scripts/onboarding-browser-cases.mjs',runnerSha256:'scripts/onboarding-playwright-runner.mjs',
  adapterSha256:'scripts/onboarding-playwright-adapter.mjs',diagnosticsSha256:'scripts/onboarding-diagnostics.mjs',
  testInitSha256:'scripts/onboarding-test.init.gradle',diagnosticsCollectorSha256:'scripts/sdk-browser-diagnostics.cjs',
  ciRunnerSha256:'scripts/run-onboarding-browser.sh',inputWriterSha256:'scripts/write-onboarding-browser-inputs.mjs',
  checkerSha256:'scripts/check-onboarding-browser.mjs',
})

export function committedHostOnboardingSources(repository,commit) {
  assert.match(commit,/^[a-f0-9]{40}$/)
  const show=path=>execFileSync('git',['-C',repository,'show',commit+':'+path],{maxBuffer:32*1024*1024})
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
  const patches=execFileSync('git',['-C',repository,'ls-tree','-r','--name-only',commit,'--','patches/webserver'],{encoding:'utf8'})
    .trim().split('\n').filter(path=>path.endsWith('.patch')).sort()
  assert(patches.length>0)
  const patchset=createHash('sha256')
  for(const path of patches)patchset.update(path+'\0'+sha(show(path))+'\n')
  return {patchCount:patches.length,patchsetSha256:patchset.digest('hex'),
    ...Object.fromEntries(Object.entries(hostOnboardingSourceFiles).map(([key,path])=>[key,sha(show(path))]))}
}

export function assertHostOnboardingBrowserEvidence(report,inputs,{commit,expectedSourceHashes}) {
  assert.equal(report.completed,true);assert.equal(report.newNonEnglishCopyVerified,true)
  assert.equal(report.productionFirstInstallVerified,false)
  assert.equal(report.productionFirstInstall,false)
  assert.equal(report.environment,'host-http-test-service-substitute')
  assert.deepEqual(report.checks.map(row=>row.name),hostOnboardingBrowserCaseNames)
  assert(report.checks.every(row=>row.passed===true))
  assert.equal(inputs.sourceCommit,commit)
  assert.equal(inputs.environment,'host-http-test-service-substitute; not production first-install acceptance')
  for(const key of ['patchsetSha256',...Object.keys(hostOnboardingSourceFiles)]) {
    assert.match(inputs[key],/^[a-f0-9]{64}$/);assert.equal(inputs[key],expectedSourceHashes[key],key+' differs from committed host inputs')
  }
  assert.equal(inputs.patchCount,expectedSourceHashes.patchCount)
  assert(inputs.uiAssets&&Object.keys(inputs.uiAssets).length>=3,'Actual authentication entry and locale assets required')
  assert(Object.hasOwn(inputs.uiAssets,'assets/oidc-login-i18n.js'))
  assert(Object.keys(inputs.uiAssets).some(path=>/^assets\/oidc-zh_CN-.+\.js$/.test(path)))
  for(const [path,sha] of Object.entries(inputs.uiAssets)) {
    assert(/^assets\/[A-Za-z0-9_.-]+\.js$/.test(path),'Invalid authentication asset path')
    assert.match(sha,/^[a-f0-9]{64}$/)
  }
  return {source:'published-host-onboarding-browser',checks:21,failures:0,skipped:0,notRun:0,
    productionFirstInstall:false,sourceCommit:commit,uiAssets:inputs.uiAssets}
}

export function assertHostOnboardingDiagnostics(snapshot) {
  assert(Array.isArray(snapshot?.events)&&snapshot.events.length>0)
  assert.equal(new Set(snapshot.events.map(event=>event.id)).size,snapshot.events.length)
  const expected=snapshot.verdict?.expectedResponses
  assert(Array.isArray(expected)&&expected.length===2,'Two actual invalid-form responses required')
  assert.equal(new Set(expected.map(item=>item.requestId)).size,2)
  const allowed=new Set()
  const origins=new Set()
  for(const item of expected) {
    const url=new URL(item.url);assert.equal(url.pathname,'/oidc/setup');assert.equal(url.search,'')
    assert(['localhost','127.0.0.1'].includes(url.hostname));origins.add(url.origin)
    const responses=snapshot.events.filter(event=>event.kind==='http-error'&&event.requestId===item.requestId&&event.documentId===item.documentId&&event.url===item.url&&event.status===400)
    assert.equal(responses.length,1,'Exact invalid-form error missing or ambiguous');allowed.add(responses[0].id)
    assert(snapshot.events.some(event=>event.kind==='request'&&event.requestId===item.requestId&&event.documentId===item.documentId&&event.url===item.url))
    for(const event of snapshot.events.filter(event=>event.kind==='console-error'&&event.channel==='Log.entryAdded'&&event.source==='network'
      &&event.networkRequestId===item.requestId&&event.documentId===item.documentId&&event.url===item.url
      &&/^Failed to load resource: the server responded with a status of 400\b/.test(event.text)))allowed.add(event.id)
  }
  assert.equal(origins.size,1)
  const errors=snapshot.events.filter(event=>['console-error','page-error','request-failed','http-error','diagnostic-integrity-error'].includes(event.kind)&&!allowed.has(event.id))
  assert.deepEqual(errors,[],'Published first-install browser has unknown errors')
  assert.equal(snapshot.verdict.passed,true)
  assert.deepEqual(snapshot.verdict.allowedEventIds,[...allowed])
  return {events:snapshot.events.length,expectedInvalidForms:2,unknownErrors:0,passed:true}
}

export const hostInitialAccountCases=Object.freeze({
  OidcInitialAccountContractTest:['acceptsOnlyValidatedImmutableContext','rejectsUntrustedIssuerAndIdentifiers'],
  OidcUiClientScopesTest:['mergesExplicitScopesOnce','leavesModeAAndDisabledGroupsUnchanged','neverExpandsOtherClients','micronautCreatesConfiguredClientWithMergedScopesWithoutParticipant'],
  OidcInitialAccountPageTest:['missingParticipantHasSafeWaitPageWithoutAccountFormOrCsrf','filterKeepsDiagnosticPageReachableAndRedirectsLogin','missingParticipantPostDoesNotWrite','availableFormUsesHostThemeAndNativeTranslationEntry','onlyAuthenticationJavascriptReadsBypassInstallationRedirect','ordinaryFailureOffersSafeRetryAndFreshCsrfWithoutClaimingNoAccount'],
  OidcInitialAccountPostgresTest:['formAtomicallyInitializesTrustedContextAndClosesForever','bootstrapUsesSameTransactionAndNeverRegrants','modeADoesNotResolveOrInvokeParticipant','missingAndDuplicateParticipantsLeaveEmptyInstallation','participantWriteThenFailureRollsBackAndCanRetry','hostWriteFailureRollsBackPluginAndCanRetry','invalidConfigurationDoesNotCallParticipant','existingUsersAreLatchedWithoutParticipantOrGrant','concurrentFirstRequestsCommitOnlyOneInitialization','commitFailureLeavesReceiptAndCannotReopen','corruptedReceiptDoesNotInitializeParticipant','deletedDatabaseMarkerCannotRegrantAndMissingReceiptRestoresIdentity'],
  OidcInitialAccountHttpTest:['diagnosticRemainsReachableThroughTypedGateAndDoesNotWrite','csrfAndOriginRejectBeforeWriteAndSuccessClosesBadBody'],
  OidcSetupServiceTest:['emptyDirectoryNeedsSetupAndStoresAccountClientAndMarkerAtomically','upgradeIdentifiesOnlyExactlyConfiguredSystemClient','upgradeConflictDoesNotActivateLegacyClient','environmentSkipsSetupAndRestartDoesNotOverwritePassword','partialEnvironmentAndInvalidPasswordLeaveDatabaseEmpty','clientConflictRollsBackUserAndDoesNotChangeExistingSecret','concurrentSetupCreatesOnlyOneAccount','existingUserIsPreservedAndClosesSetup','deletingDatabaseMarkerAndUsersCannotReopenSetupOrEnvironmentBootstrap','deletingReceiptRestoresSameIdentityWithoutActivatingSetup','corruptedOrReplacedReceiptFailsClosedEvenInSameProcess','explicitDisableRejectsFormButAllowsEnvironmentFirstInstall','transactionFailureBeforeReceiptRollsBackAndCanRetry'],
  OidcSetupControllerTest:['formUsesCsrfAndValidSubmissionEntersOidcLoginChain','missingTamperedAndCrossOriginTokensCannotInitialize','completedSetupIsClosedForGetAndPost','failuresDoNotExposeCredentials'],
  OidcInstallationReceiptTest:['receiptHasPrivatePermissionsAndCannotBeOverwritten','symlinkAndOversizedOrPubliclyWritableReceiptFailClosed'],
})

export function assertHostInitialAccountReports(rawReports) {
  assert.deepEqual(Object.keys(rawReports).sort(),Object.keys(hostInitialAccountCases).sort(),'Exact published first-install suites required')
  const suites=[]
  for(const [name,names] of Object.entries(hostInitialAccountCases)) {
    const xml=rawReports[name],parsed=parseLifecycleJUnit(xml)
    assert.equal(parsed.status,'passed','Published first-install suite failed or skipped: '+name)
    assert.equal(parsed.cases.length,names.length)
    assert.deepEqual(parsed.cases.map(row=>row.name.replace(/\(\)$/,'')).sort(),[...names].sort(),'Published first-install named cases differ: '+name)
    assert(parsed.cases.every(row=>row.classname==='io.kestra.webserver.oidc.'+name&&row.status==='passed'))
    suites.push({name,sha256:createHash('sha256').update(xml).digest('hex'),tests:names.length,
      cases:parsed.cases.map(({classname,name,status})=>({classname,name,status}))})
  }
  const tests=suites.reduce((sum,suite)=>sum+suite.tests,0)
  assert.equal(tests,45)
  return {source:'published-host-scoped-tests',tests,failures:0,skipped:0,notRun:0,suites}
}
