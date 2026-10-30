import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {accessControlUiGateInputs,accessControlCaseIds} from './access-control-v3-ui.mjs'
import {accessControlV3RestCheckIds} from './access-control-v3-rest-cases.mjs'
import {projectScopeCases,requiredProjectChecks,legacyMigrationChecks} from './application-project-cases.mjs'

const sha256=value=>createHash('sha256').update(value).digest('hex')
const commitPattern=/^[0-9a-f]{40}$/
const hashPattern=/^[0-9a-f]{64}$/
const nonempty=value=>typeof value==='string'&&value.trim().length>0
const passed=row=>row?.passed===true&&row.status==='passed'&&row.skipped===undefined
const names=(classname,methods)=>methods.map(method=>({classname,name:method}))

export const lifecycleXmlInputs=Object.freeze({
  hostAccounts:names('io.kestra.webserver.oidc.OidcAccountDeletionPostgresTest',[
    'deletionCommitsParticipantCleanupAndRetiresSubjectWithoutTouchingHistory',
    'participantWriteThenFailureRollsBackAllState','hostDeletionFailureRollsBackParticipantAndRetirement',
    'missingParticipantCurrentActorAndStaleRevisionCannotDelete',
  ]),
  hostBorrowedConnection:names('io.kestra.webserver.oidc.TrustedIdentityBorrowedConnectionTest',['borrowedConnectionRevalidatesWithoutOpeningOrEndingATransaction']),
  hostPassword:[...names('io.kestra.webserver.oidc.OidcPasswordChangePostgresTest',[
    'temporaryCredentialCannotCreateNormalIdentityBeforeCompletion','inactiveExpiredAndChangedVersionInteractionsFailClosed',
    'storageFailureRollsBackPasswordVersionAndInteractionConsumption',
  ]),...names('io.kestra.webserver.oidc.OidcPasswordChangeHttpTest',['productionLoginRestrictsTemporaryCredentialAndRequiresSameOriginSingleUseChange'])],
  hostRotation:[...names('io.kestra.webserver.oidc.OidcClientCredentialMaintenanceTest',[
    'ordinaryRotationStorageFailureCannotChangeHashHintOrRevision',
    'publicClientHasNoSecretOrRotationAndConcurrentOrdinaryRotationsHaveOneWinner',
    'realCliRegistrationAndOrdinaryRotationPreserveTokensAndPersistHintRevision',
    'invalidAndDuplicateRegistrationsCannotModifyExistingClientOrLeakSecrets',
  ]),...names('io.kestra.webserver.oidc.OidcClientCredentialsHttpTest',['registeredOrdinaryClientUsesProductionConsentAndOnlyRotatedSecretCanExchangeCode'])],
  hostMaintenance:[...names('io.kestra.webserver.oidc.OidcClientCredentialMaintenanceTest',[
    'loginClientOnlineRotationIsForbiddenAndMaintenanceSupportsCancelRollbackAndConfirm',
    'maintenanceFailureRollsBackPendingPhaseAndActiveHash',
  ]),...names('io.kestra.webserver.oidc.OidcClientCredentialsHttpTest',['maintenanceActivationAndRollbackHaveSingleValidSecretInProductionTokenEndpoint'])],
  pluginAccounts:names('io.kestra.extensions.rbac.applicationgroup.AccountLifecyclePostgresTest',[
    'participantWriteThenThrowRollsBackAllGroups','hostDeleteFailureRollsBackParticipantWrites',
    'allGroupCleanupAndLastAdministratorUseBorrowedConnection','lastAdministratorRejectionRollsBackGrantRemoval',
    'concurrentMutualDeletionRechecksActorAfterSecurityLock','concurrentMutualDeactivationRechecksActorAfterSecurityLock',
  ]),
  pluginAudit:names('io.kestra.extensions.rbac.store.ManagementAuditStoreTest',[
    'appendOnlyWriterPreservesOriginalSubjectsAndFiltersItemsAndTotalsBeforePaging',
    'participantAndHostFailureRollbackLeaveNoAuditRows',
    'credentialAuditHasNoSecretFieldsAndMissingTableFailsClosed',
    'targetSnapshotUsesAllMembershipsAndGrouplessAccountsUseOnlyActorGroup',
  ]),
  pluginUpgrade:names('io.kestra.extensions.rbac.applicationgroup.ApplicationPermissionUpgradeTest',[
    'upgradePreservesPolicySupportAndSubjectGrants','conflictingMappingIsRejectedWithoutSideEffects',
    'failureAfterWritesRollsBackDirectoryDeclarationsEpochAndReceipt','reviewedUpgradeIsIdempotentButCannotOverwriteLaterWrites',
    'disabledRuntimePolicyRemainsDisabledWithoutChangingSupport','unknownReferencesAndUnknownMappingsAreRejected',
    'approvedFalseCannotGainSupportDuringUpgrade','sourceDriftAndWrongApprovalCannotApply',
  ]),
})

export const transactionCheckIds=Object.freeze([
  'participant-write-then-throw-rollback','host-delete-failure-rollback',
  'concurrent-mutual-delete-last-admin','concurrent-mutual-disable-last-admin',
])
export const maintenanceStepIds=Object.freeze([
  'baseline-production-login','prepare-preserves-current-login','cancel-preserves-current-revision',
  'cancel-preserves-current-login','activated-secret-production-login','old-consumer-configuration-rejected',
  'rollback-original-configuration-login','final-activated-secret-production-login',
  'confirmed-rollback-material-removed','confirmed-production-login',
])
export const cleanupCheckIds=Object.freeze(['owned-containers-cleaned','owned-networks-cleaned','owned-auxiliary-databases-cleaned'])
export const rootMcpCheckIds=Object.freeze([
  'mcp-production-dcr-owner-pkce-consent','mcp-tools-list-call','mcp-capability-without-application-scope',
  'mcp-application-scope-without-capability','mcp-known-plus-unbound-list','mcp-known-plus-unbound-call',
  'mcp-same-session-application-policy-revoke','mcp-same-session-supported-scope-revoke','mcp-user-scope-revoke',
  'refresh-cannot-restore-revoked-scope','mcp-missing-extension',
])

export function initialGateRows() {return derive({})}

export const hostHttpOriginCases=Object.freeze(['actualHttpRequestWithoutAmbientOriginSurvivesAsyncInitialization','concurrentRequestsOverrideStaleOriginsAndTrimTransactions','missingOriginOutsideHttpFilterStillFailsClosed','requestWithoutAuthenticationStillReturns401BeforeIdentityOrBusiness','explicitUnavailableAndUnknownFailureKeep503And403'])
export function assertHostHttpOriginReport(xml) {
  const report=parseLifecycleJUnit(xml)
  assert.equal(report.status,'passed','Published HTTP origin tests failed or skipped')
  assert.equal(report.cases.length,hostHttpOriginCases.length)
  assert(report.cases.every(test=>test.classname==='io.kestra.webserver.rbac.AuthorizationHttpOriginBoundaryTest'&&test.status==='passed'))
  assert.deepEqual(report.cases.map(test=>test.name.replace(/\(\)$/,'')).sort(),[...hostHttpOriginCases].sort(),'Published HTTP origin named cases differ')
  return {tests:report.cases.length,cases:report.cases,failures:0,skipped:0}
}

function decodeXml(value) {
  return value.replace(/&([^;]+);/g,(_,entity)=>{
    const known={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}
    if(Object.hasOwn(known,entity))return known[entity]
    assert(/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(entity),'unsupported XML entity')
    const number=entity.startsWith('#x')?parseInt(entity.slice(2),16):Number(entity.slice(1))
    assert(number>0&&number<=0x10ffff&&!(number>=0xd800&&number<=0xdfff),'invalid XML character')
    return String.fromCodePoint(number)
  })
}

export function parseLifecycleJUnit(xml) {
  assert(nonempty(xml)&&!/<!(?:DOCTYPE|ENTITY)\b/i.test(xml),'JUnit XML must not use DTD or entities')
  const stack=[],cases=[],suites=[]
  let offset=0,rootCount=0
  const addCase=test=>{
    assert(nonempty(test.attributes.classname)&&nonempty(test.attributes.name),'named JUnit testcase required')
    cases.push({classname:test.attributes.classname,name:test.attributes.name,status:test.failure?'failed':test.skipped?'not_run':'passed'})
    for(const parent of stack)if(['testsuite','testsuites'].includes(parent.name))parent.observed++
  }
  const close=node=>{
    if(node.name==='testcase')addCase(node)
    if(node.name==='system-out'){const parent=stack.findLast(item=>item.name==='testsuite');assert(parent,'JUnit system-out has no owning suite');parent.systemOut=(parent.systemOut??'')+node.text}
    if(['testsuite','testsuites'].includes(node.name)) {
      for(const field of ['tests','failures','errors','skipped'])if(node.attributes[field]!==undefined)assert(/^[0-9]+$/.test(node.attributes[field]),'invalid JUnit suite '+field)
      if(node.attributes.tests!==undefined)assert.equal(Number(node.attributes.tests),node.observed,'JUnit suite testcase count mismatch')
      suites.push({attributes:node.attributes,observed:node.observed,systemOut:node.systemOut??''})
    }
  }
  while(offset<xml.length) {
    const start=xml.indexOf('<',offset)
    if(start<0){assert(stack.length||!xml.slice(offset).trim(),'text outside XML root');if(stack.at(-1)?.name==='system-out')stack.at(-1).text+=decodeXml(xml.slice(offset));offset=xml.length;break}
    assert(stack.length||!xml.slice(offset,start).trim(),'text outside XML root')
    if(stack.at(-1)?.name==='system-out')stack.at(-1).text+=decodeXml(xml.slice(offset,start))
    if(xml.startsWith('<!--',start)){const end=xml.indexOf('-->',start+4);assert(end>=0);offset=end+3;continue}
    if(xml.startsWith('<![CDATA[',start)){assert(stack.length);const end=xml.indexOf(']]>',start+9);assert(end>=0);if(stack.at(-1)?.name==='system-out')stack.at(-1).text+=xml.slice(start+9,end);offset=end+3;continue}
    if(xml.startsWith('<?',start)){assert(!stack.length&&rootCount===0);const end=xml.indexOf('?>',start+2);assert(end>=0);offset=end+2;continue}
    let end=start+1,quote
    for(;end<xml.length;end++){const character=xml[end];if(quote){if(character===quote)quote=undefined}else if(character==='"'||character==="'")quote=character;else if(character==='>')break}
    assert(end<xml.length&&!quote,'unterminated XML tag')
    const raw=xml.slice(start+1,end),closing=raw.startsWith('/'),selfClosing=/\/\s*$/.test(raw)
    const match=raw.match(/^\/?([A-Za-z][\w.-]*)([\s\S]*)$/);assert(match,'unsupported XML tag')
    const name=match[1]
    assert(['testsuites','testsuite','testcase','properties','property','system-out','system-err','failure','error','skipped'].includes(name),'unsupported JUnit element '+name)
    if(closing){assert(!selfClosing&&!match[2].trim());const current=stack.pop();assert(current&&current.name===name,'unbalanced XML');close(current)}
    else {
      const attributes={},attributeText=match[2].replace(/\/\s*$/,'')
      let rest=attributeText
      while(rest.trim()) {
        const attribute=rest.match(/^\s+([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/);assert(attribute,'malformed XML attribute')
        assert(!Object.hasOwn(attributes,attribute[1]),'duplicate XML attribute');attributes[attribute[1]]=decodeXml(attribute[2]??attribute[3]);rest=rest.slice(attribute[0].length)
      }
      if(!stack.length){rootCount++;assert(rootCount===1&&['testsuite','testsuites'].includes(name),'single JUnit suite root required')}
      else if(name==='testcase')assert(['testsuite','testsuites'].includes(stack.at(-1).name),'misplaced JUnit testcase')
      else if(['testsuite','testsuites'].includes(name))assert(['testsuite','testsuites'].includes(stack.at(-1).name),'misplaced JUnit suite')
      else if(['failure','error','skipped'].includes(name)){
        const test=stack.findLast(parent=>parent.name==='testcase');assert(test,'misplaced JUnit outcome')
        if(name==='skipped')test.skipped=true;else test.failure=true
      }
      const current={name,attributes,observed:0,failure:false,skipped:false,text:''}
      if(selfClosing)close(current);else stack.push(current)
    }
    offset=end+1
  }
  assert(rootCount===1&&stack.length===0&&cases.length>0,'incomplete or empty JUnit XML')
  assert.equal(new Set(cases.map(test=>test.classname+'#'+test.name)).size,cases.length,'duplicate named JUnit testcase')
  const suiteFailure=suites.some(suite=>['failures','errors'].some(field=>Number(suite.attributes[field]??0)>0))
  const suiteSkip=suites.some(suite=>Number(suite.attributes.skipped??0)>0)
  return {cases,suites,status:suiteFailure||cases.some(test=>test.status==='failed')?'failed':suiteSkip||cases.some(test=>test.status==='not_run')?'not_run':'passed'}
}

export function derive(report) {
  const evidence=report?.gateEvidence??{},inputs=report?.inputs??{},resolved=new Map()
  const check=(key,source,operation)=>{
    if(resolved.has(key))return resolved.get(key)
    let result
    try {const value=operation();result={id:key,status:value===true?'passed':value?.status??'not_run',passed:value===true||value?.status==='passed',source:value?.source??source,...(value?.reason?{reason:value.reason}:{})}}
    catch(error){result={id:key,status:'failed',passed:false,source,reason:String(error.message)}}
    resolved.set(key,result);return result
  }
  const row=(collection,id,path,predicate)=>check(path+':'+id,path,()=>{
    const matches=(Array.isArray(collection)?collection:[]).filter(item=>(item.id??item.name??item.case)===id)
    if(!matches.length)return {status:'not_run',reason:'required named row missing'}
    assert.equal(matches.length,1,'duplicate required row '+id)
    const current=matches[0]
    if(!passed(current))return {status:current.status==='failed'?'failed':'not_run',reason:'row must explicitly be passed with status passed and no skip'}
    assert(nonempty(current.sourceRef)||current.source||current.evidence&&Object.keys(current.evidence).length||path==='report.ui','row has no operation/source evidence')
    if(predicate)assert(predicate(current),'required operation evidence mismatch: '+id)
    return true
  })
  const ui=id=>row(report?.ui,id,'report.ui',current=>{
    if(!Boolean(current.source&&Object.keys(current.source).length||current.evidence&&Object.keys(current.evidence).length)||current.error)return false
    if(/^ui-drawer-(group|user|permission|subject)-maximize$/.test(id)) {
      const e=current.evidence
      if(e?.source!=='actual-native-drawer-geometry')return false
      for(const name of ['initial','maximized','restored','nativeMaximized'])if(!e[name]||!['width','left','right','viewport'].every(k=>Number.isFinite(e[name][k]))||e[name].width<=0||e[name].viewport<=0)return false
      if(e.maximized.viewport!==e.nativeMaximized.viewport||Math.abs(e.maximized.width-e.nativeMaximized.width)>2||Math.abs(e.maximized.left-e.nativeMaximized.left)>2||Math.abs(e.maximized.right-e.nativeMaximized.right)>2||Math.abs(e.restored.width-e.initial.width)>2)return false
    }
    if(id.startsWith('ui-theme-language-')) {
      const cards=current.evidence?.layouts?.filter(item=>item.path==='application-groups'&&Object.hasOwn(item,'width'))
      if(!Array.isArray(cards)||cards.length!==3||new Set(cards.map(item=>item.width)).size!==3)return false
      for(const item of cards) {
        if(![1280,768,390].includes(item.width))return false
        if(!Array.isArray(item.countSpacing)||item.countSpacing.length<3||item.countSpacing.some(value=>!Number.isFinite(value.token)||value.token<=0||!Number.isFinite(value.gap)||value.gap<value.token-1||!value.text?.startsWith(value.count+' ')))return false
        if(!Array.isArray(item.headingLayout)||!item.headingLayout.length||item.headingLayout.some(value=>value.vertical!==true||!Number.isFinite(value.nameGap)||value.nameGap<=0||value.badgeGap!==null&&(!Number.isFinite(value.badgeGap)||value.badgeGap<=0)))return false
      }
    }
    if(id==='ui-frozen-baseline-key-equality') {
      const actual=current.evidence
      if(actual?.source!=='real-browser-before-boundary-data'||actual.bootstrapMapping?.roleOnly!==true||actual.bootstrapMapping.prototypeSubject!=='admin'||actual.bootstrapMapping.runtimeSubject==='admin')return false
      for(const [kind,total]of [['scopes',19],['permissions',19],['users',22],['subjects',1]])if(actual.collections?.[kind]?.total!==total||actual.collections[kind].items?.length!==total)return false
      if(actual.counts?.scopes!==19||actual.counts.applications!==1||actual.counts.subjects!==1||actual.pages?.length!==4)return false
      if(actual.userSubjectMapping?.length!==22||new Set(actual.userSubjectMapping.map(item=>item.runtimeSubject)).size!==22||!actual.userSubjectMapping.every(item=>item.runtimeSubject===item.prototypeSubject))return false
      if(!actual.collections.users.items.some(item=>item.subject==='admin')||!actual.collections.users.items.some(item=>item.subject===actual.bootstrapMapping.runtimeSubject))return false
      if(actual.groupMapping?.prototypeKey!=='kestra-group'||!nonempty(actual.groupMapping.runtimeId))return false
    }
    if(id==='ui-native-filter-popup-geometry') {
      const actual=current.evidence
      if(actual?.source!=='real-native-filter-clicks-and-geometry'||actual.locations!==4||actual.themes!==4||actual.observations?.length!==48)return false
      const boundary=actual.observations.filter(item=>item.desktopBottomBoundary)
      if(boundary.length!==4||JSON.stringify(boundary.map(item=>item.theme).sort())!==JSON.stringify(['dark','dark-2','light','system']))return false
      for(const item of boundary) {
        const proof=item.desktopBottomBoundary
        if(item.kind!=='permissions'||item.reopening!==0||proof.clearClicked!==true||proof.closeClicked!==true)return false
        if(proof.scroll?.stimulus!=='explicit existing host-layout scroll; no style or business-state mutation')return false
        if(!Number.isSafeInteger(proof.scroll.index)||proof.scroll.index<0||proof.viewport?.height!==900||proof.viewport?.width!==1280)return false
        const a=proof.anchor,b=proof.panel
        if(![a?.top,a?.bottom,b?.top,b?.bottom,b?.height,b?.width].every(Number.isFinite))return false
        if(!a||!b||b.height<=0||b.width<=0||b.top<6||b.bottom>894||Math.abs(a.bottom-880)>3||b.bottom>a.top-3)return false
      }
    }
    if(id==='ui-four-tabs-cards-counts') {
      const spacing=current.evidence?.countSpacing
      if(!Array.isArray(spacing)||spacing.length<3||spacing.some(value=>!Number.isFinite(value.token)||value.token<=0||!Number.isFinite(value.gap)||value.gap<value.token-1||!value.text?.startsWith(value.count+' ')))return false
      const headings=current.evidence?.headingLayout
      if(!Array.isArray(headings)||!headings.length||headings.some(value=>value.vertical!==true||!Number.isFinite(value.nameGap)||value.nameGap<=0||value.badgeGap!==null&&(!Number.isFinite(value.badgeGap)||value.badgeGap<=0)))return false
    }
    if(id.startsWith('ui-four-drawers-theme-language-')) {
      const drawers=current.evidence?.drawers
      if(!Array.isArray(drawers)||drawers.length!==12||new Set(drawers.map(item=>item.width+'|'+item.kind)).size!==12)return false
      for(const item of drawers) {
        if(![1280,768,390].includes(item.width)||!['group','user','permission','subject'].includes(item.kind))return false
        const actual=item.nativeParity,reference=item.nativeReference
        if(!actual?.nativeForm||!reference?.nativeForm||actual.viewport?.width!==item.width||reference.viewport?.width!==item.width)return false
        for(const part of ['header','body','footer']) {
          const style=actual[part]?.style,baseline=reference[part]?.style
          if(!style||!baseline||!['paddingTop','paddingRight','paddingBottom','paddingLeft','fontFamily','fontSize','fontWeight','color','backgroundColor'].every(key=>typeof style[key]==='string'&&style[key].length&&style[key]===baseline[key]))return false
        }
        if(!actual.icons?.expand?.length||!actual.icons?.close?.length||JSON.stringify(actual.icons)!==JSON.stringify(reference.icons))return false
        if(!actual.save?.nativeIcon||!reference.save?.nativeIcon||!Number.isFinite(actual.save.gap)||actual.save.gap<=0||!Number.isFinite(reference.save.gap)||Math.abs(actual.save.gap-reference.save.gap)>1||!actual.save.paths?.length||JSON.stringify(actual.save.paths)!==JSON.stringify(reference.save.paths))return false
        if(!Number.isFinite(actual.footer?.rect?.bottom)||!Number.isFinite(actual.drawer?.bottom)||Math.abs(actual.footer.rect.bottom-actual.drawer.bottom)>2)return false
      }
    }
    return true
  })
  const root=id=>row(report?.checks,id,'report.checks')
  const finalSources=()=>check('source:final-runtime','report.gateEvidence.runtimeSource',()=>{
    if(!evidence.runtimeSource)return {status:'not_run',reason:'measured final runtime/source evidence missing'}
    assert(nonempty(evidence.runtimeSource.sourceRef),'runtime source reference missing')
    assert.equal(report.mode,'run','only production acceptance execution can satisfy final source gate')
    for(const field of ['rootCommit','overlayCommit','pluginCommit'])assert(commitPattern.test(inputs[field]),'final '+field+' missing')
    assert(/^ghcr\.io\/ai-specs\/kestra-overlay@sha256:[0-9a-f]{64}$/.test(inputs.image),'immutable final image missing')
    assert(hashPattern.test(inputs.jarSha256),'final jar hash missing')
    for(const field of ['rootCommit','overlayCommit','pluginCommit','image','jarSha256'])assert.equal(evidence.runtimeSource[field],inputs[field],'actual '+field+' differs from selected final source')
    assert.equal(report.nonFinal,false);assert.equal(report.development?.allowDirtyRoot,false)
    for(const repository of ['root','overlay','plugin'])assert.equal(report.sources?.[repository]?.dirty,false,repository+' source must be clean')
    for(const repository of ['overlay','plugin']) {
      const ci=report.sources?.[repository]?.ci
      assert.equal(ci?.headSha,inputs[repository+'Commit']);assert.equal(ci?.status,'completed');assert.equal(ci?.conclusion,'success')
    }
    return true
  })
  const artifactCache=new Map()
  const xml=(repository,test)=>check('xml:'+repository+':'+test.classname+'#'+test.name,'report.gateEvidence.lifecycleArtifacts',()=>{
    const artifacts=(evidence.lifecycleArtifacts??[]).filter(artifact=>artifact.repository===repository)
    if(!artifacts.length)return {status:'not_run',reason:'downloaded lifecycle XML missing'}
    const matches=[]
    for(const artifact of artifacts) {
      if(!artifactCache.has(artifact)) {
        let parsed
        try {
          assert(commitPattern.test(inputs[repository+'Commit']),'final lifecycle source commit missing')
          assert.equal(artifact.commit,inputs[repository+'Commit'],'lifecycle XML does not match final selected commit')
          assert.equal(artifact.downloaded,true);assert(nonempty(artifact.downloadedAt)&&nonempty(artifact.path))
          assert(/^[1-9][0-9]*$/.test(String(artifact.runId))&&/^[1-9][0-9]*$/.test(String(artifact.artifactId)),'actual CI run/artifact identifiers required')
          assert.equal(artifact.workflow?.headSha,artifact.commit);assert.equal(artifact.workflow?.status,'completed');assert.equal(artifact.workflow?.conclusion,'success')
          assert(hashPattern.test(artifact.sha256));assert.equal(sha256(artifact.xml),artifact.sha256,'downloaded XML hash mismatch')
          assert(['PostgreSQL','unit'].includes(artifact.backend),'explicit lifecycle test backend required')
          parsed=parseLifecycleJUnit(artifact.xml)
        }catch(error){parsed={status:'failed',cases:[],reason:String(error.message)}}
        artifactCache.set(artifact,parsed)
      }
      const parsed=artifactCache.get(artifact)
      if(parsed.status!=='passed')return {status:parsed.status,reason:parsed.reason??'downloaded lifecycle suite contains failed/skipped tests'}
      for(const current of parsed.cases)if(current.classname===test.classname&&[test.name,test.name+'()'].includes(current.name)) {
        assert.equal(artifact.backend,test.classname.endsWith('.TrustedIdentityBorrowedConnectionTest')?'unit':'PostgreSQL','named lifecycle test backend mismatch')
        if(test.classname==='io.kestra.extensions.rbac.store.ManagementAuditStoreTest') {
          const proof=artifact.backendEvidence
          if(!proof)return {status:'not_run',reason:'downloaded plugin check-postgres job/backend provenance missing'}
          assert.equal(proof.source,'plugin-check-postgres');assert.equal(proof.jobName,'build');assert.equal(proof.status,'completed');assert.equal(proof.conclusion,'success')
          assert(/^[1-9][0-9]*$/.test(String(proof.jobId)),'actual build job databaseId required')
          assert.equal(proof.stepName,'Verify policy storage against PostgreSQL');assert(/^[1-9][0-9]*$/.test(String(proof.stepNumber)),'actual PostgreSQL step number required')
          assert.equal(proof.stepStatus,'completed');assert.equal(proof.stepConclusion,'success')
          assert.equal(proof.headSha,artifact.commit);assert.equal(String(proof.runId),String(artifact.runId));assert.equal(String(proof.artifactId),String(artifact.artifactId));assert.equal(proof.path,artifact.path);assert.equal(proof.sha256,artifact.sha256)
          const suites=parsed.suites.filter(suite=>suite.attributes.name===test.classname);assert.equal(suites.length,1,'exact audit suite backend witness missing')
          const lines=suites[0].systemOut.split(/\r?\n/).map(line=>line.trim())
          assert(!lines.includes('Management audit backend: H2'),'H2 audit results must not be labelled PostgreSQL')
          assert(lines.filter(line=>line==='Management audit backend: PostgreSQL').length>=lifecycleXmlInputs.pluginAudit.length,'actual JDBC PostgreSQL backend witnesses missing')
        }
        matches.push({artifact,current})
      }
    }
    if(!matches.length)return {status:'not_run',reason:'exact lifecycle testcase missing'}
    assert.equal(matches.length,1,'duplicate matching lifecycle testcase across artifacts')
    return {status:'passed',source:matches[0].artifact.path}
  })
  const xmlSet=(repository,key)=>lifecycleXmlInputs[key].map(test=>xml(repository,test))
  const maintenance=()=>check('maintenance:root-lifecycle','report.fragments.maintenance',()=>{
    const current=report.fragments?.maintenance
    if(!current)return {status:'not_run',reason:'root real maintenance report missing'}
    assert.equal(current.id,'login-client-maintenance-lifecycle')
    assert(nonempty(evidence.maintenanceSourceRef),'root CLI maintenance source reference missing')
    if(!passed(current)||current.completed!==true)return {status:current.status==='failed'?'failed':'not_run',reason:'maintenance did not complete successfully'}
    for(const id of maintenanceStepIds) {
      const matches=(current.steps??[]).filter(step=>step.id===id);assert.equal(matches.length,1,'maintenance step missing/duplicate: '+id)
      const step=matches[0]
      if(id.includes('production-login')||id.includes('configuration-login')||id.endsWith('current-login'))assert.equal(step.authenticated,true)
      else if(id==='old-consumer-configuration-rejected'){assert.equal(step.rejected,true);assert([401,403,500].includes(step.status))}
      else if(id==='confirmed-rollback-material-removed'){assert.equal(step.rollbackRejected,true);assert.equal(step.failure,'CONFLICT');assert(Number.isSafeInteger(step.credentialRevision))}
      else assert(Number.isSafeInteger(step.credentialRevision))
    }
    assert((current.cleanup??[]).every(step=>step.passed===true),'maintenance recovery failed')
    return true
  })
  const transactions=()=>[check('transactions:composition','report.gateEvidence.transactions',()=>{
    const current=evidence.transactions
    if(!current)return {status:'not_run',reason:'root transaction composition report missing'}
    if(!passed(current)||current.completed!==true)return {status:current.status==='failed'?'failed':'not_run',reason:'transaction composition incomplete'}
    assert.equal(current.id,'account-lifecycle-transaction-composition');assert(nonempty(current.sourceRef))
    return true
  }),...transactionCheckIds.map(id=>row(evidence.transactions?.checks,id,'report.gateEvidence.transactions.checks',current=>{
    const actual=current.evidence
    if(!nonempty(current.sourceRef)||actual?.backend!=='PostgreSQL')return false
    if(id.endsWith('rollback'))return hashPattern.test(actual.beforeHash)&&actual.beforeHash===actual.afterHash
    const preparation=actual.backgroundPreparation
    if(preparation?.source!=='owned-primary-pg-background-writer-drain'||preparation.lockKey!==1380073797||preparation.drained!==true||preparation.productHttpRequests!==0||preparation.schedulerDisabled!==false||!Number.isSafeInteger(preparation.maxPreparationMs)||preparation.maxPreparationMs>75000||!Number.isSafeInteger(preparation.heartbeatMs)||preparation.heartbeatMs>1000||preparation.serverIdleTimeoutMs!==4000)return false
    if(!Number.isSafeInteger(preparation.holderPid)||preparation.holderPid<=0||!/^root_t6_barrier_[a-f0-9]{24}$/.test(preparation.applicationName??'')||!Number.isSafeInteger(preparation.writer?.pid)||preparation.writer.pid===preparation.holderPid||preparation.writer.granted!==false||preparation.writer.applicationName!=='PostgreSQL JDBC Driver'||JSON.stringify(preparation.writer.blockers)!==JSON.stringify([preparation.holderPid]))return false
    const concurrency=actual.concurrency
    if(concurrency?.source!=='owned-primary-pg-security-lock-observer'||concurrency.lockKey!==1380073797||concurrency.lockKind!=='bigint-transaction-advisory'||concurrency.simultaneousWaiters!==2)return false
    if(concurrency.association?.kind!=='exclusive-two-request-cohort'||concurrency.association.individualActorPidMapping!==false||concurrency.association.baselineLockRows!==0)return false
    if(concurrency.association.requests?.length!==2||concurrency.waiters?.length!==2||new Set(concurrency.waiters.map(waiter=>waiter.pid)).size!==2||concurrency.waiters.some(waiter=>waiter.granted!==false))return false
    if(concurrency.release?.holderAbsent!==true||!nonempty(concurrency.release.releasedAt))return false
    if(!Number.isFinite(Date.parse(preparation.observedAt))||!Number.isFinite(Date.parse(concurrency.observedAt))||Date.parse(concurrency.observedAt)<Date.parse(preparation.observedAt))return false
    return actual.persisted===true&&Number.isSafeInteger(actual.remainingManagers)&&actual.remainingManagers>=1&&actual.allowedOperations===1&&actual.deniedOperations===1
  }))]
  const restProbeRows=()=>projectScopeCases.flatMap(test=>test.probes.map((probe,probeIndex)=>check('rest:'+test.id+':'+probeIndex,'report.matrix',()=>{
    const matches=(report.matrix??[]).filter(item=>item.transport==='rest'&&item.caseId===test.id&&item.probeIndex===probeIndex)
    if(!matches.length)return {status:'not_run',reason:'required actual REST probe missing'}
    assert.equal(matches.length,1);const current=matches[0]
    if(!passed(current))return {status:current.status==='failed'?'failed':'not_run'}
    assert.equal(current.expectedAllowed,probe.allowed)
    assert.equal(current.resource?.tenant,'main');assert.equal(current.resource?.namespace,probe.namespace);assert.equal(current.resource?.action,probe.action);assert.equal(current.resource?.resource,probe.resource)
    if(probe.resourceId)assert.equal(current.resource?.id,probe.resourceId)
    assert(current.observed&&Object.keys(current.observed).length,'REST operation observation missing')
    return true
  })))
  const gates=[]
  for(let number=1;number<=12;number++) {
    const gate='T'+number,required=(accessControlUiGateInputs[gate]??[]).map(ui)
    if(number===3||number===9){required.push(root('access-control-v3-rest-fixture'));required.push(...accessControlV3RestCheckIds.filter(id=>id.startsWith('access-control-v3-'+gate+'-rest-')).map(root))}
    if(number===9)required.push(...restProbeRows(),root('management-target-action-cross-scope-denied'),root('wrong-application-group'),root('wrong-tenant'))
    if(number===5)required.push(...xmlSet('overlay','hostAccounts'),...xmlSet('overlay','hostPassword'),...xmlSet('plugin','pluginAccounts'),...xmlSet('plugin','pluginAudit'),root('wrong-issuer'))
    if(number===6)required.push(...transactions(),...xmlSet('overlay','hostAccounts'),...xmlSet('overlay','hostBorrowedConnection'),...xmlSet('plugin','pluginAccounts'),root('last-application-group-administrator'),root('last-application-policy-administrator'))
    if(number===7)required.push(...xmlSet('overlay','hostRotation'),...xmlSet('plugin','pluginAudit'))
    if(number===8)required.push(maintenance(),...xmlSet('overlay','hostMaintenance'))
    if(number===12) {
      required.push(finalSources())
      required.push(check('profile:new-install','report.profile',()=>report.profile==='new-install'?true:{status:'not_run',reason:'new-install production profile not executed'}))
      required.push(check('profile:legacy-exclusions','report.excludedChecks',()=>{if(!Array.isArray(report.excludedChecks))return {status:'not_run',reason:'explicit historical migration exclusions missing'};assert.deepEqual(report.excludedChecks.map(item=>item.id).sort(),[...legacyMigrationChecks].sort());assert(report.excludedChecks.every(item=>nonempty(item.reason)&&item.status===undefined&&item.passed===undefined));return true}))
      for(const id of ['publication-gate','artifact-inputs','new-install-storage-contract'])required.push(check('stage:'+id,'report.stages',()=>{const matches=(report.stages??[]).filter(stage=>stage.id===id);if(!matches.length)return {status:'not_run',reason:'required production stage missing'};assert.equal(matches.length,1);if(matches[0].status!=='passed')return {status:matches[0].status==='failed'?'failed':'not_run'};assert(matches[0].evidence&&Object.keys(matches[0].evidence).length);return true}))
      required.push(...[...new Set([...requiredProjectChecks,...rootMcpCheckIds])].filter(id=>!/^access-control-v3-T[0-9]+$/.test(id)).map(root))
      required.push(...xmlSet('plugin','pluginUpgrade'))
      required.push(...xmlSet('plugin','pluginAudit'))
      required.push(check('upgrade:published-postgres','report.checks.declaration-upgrade',()=>{
        const rows=(report.checks??[]).filter(current=>current.id==='declaration-upgrade')
        if(!rows.length)return {status:'not_run',reason:'declaration-upgrade evidence missing'}
        assert.equal(rows.length,1);const current=rows[0]
        if(!passed(current))return {status:current.status==='failed'?'failed':'not_run'}
        assert.equal(current.evidence?.source,'plugin-ci-postgres');assert.equal(current.evidence?.commit,inputs.pluginCommit);assert.equal(current.evidence?.backend,'PostgreSQL')
        for(const field of ['failures','errors','skipped'])assert.equal(current.evidence[field],0)
        return true
      }))
      required.push(...accessControlCaseIds.map(ui),ui('ui-zero-grant-logout-switch'),ui('ui-permission-runtime-projection'),ui('ui-subject-runtime-revoke'))
      required.push(...restProbeRows())
      for(const id of cleanupCheckIds)required.push(row(evidence.cleanup?.checks,id,'report.gateEvidence.cleanup.checks',current=>nonempty(current.sourceRef)&&current.evidence?.ownerVerified===true&&current.evidence.remaining===0))
      required.push(check('cleanup:root-resources','report.resources.cleaned',()=>report.resources?.cleaned===true?true:{status:'not_run',reason:'root owned-resource cleanup has not completed'}))
    }
    const unique=[...new Map(required.map(item=>[item.id,item])).values()]
    const missing=unique.filter(item=>!item.passed),status=missing.some(item=>item.status==='failed')?'failed':missing.length?'not_run':'passed'
    gates.push({id:'access-control-v3-'+gate,passed:status==='passed',status,evidence:{owner:'access-control-v3-gates',requiredInputs:unique,missingInputs:missing,sources:[...new Set(unique.map(item=>item.source))],rootCiFinalSuccess:'external-post-run-gh-verification-required'}})
  }
  return gates
}
