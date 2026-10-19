/** Composition only. Imported fragments keep ownership of their real assertions. */
import assert from 'node:assert/strict'
import {runApplicationProjectAggregates} from './application-project-aggregate-cases.mjs'
import {runApplicationProjectRest} from './application-project-rest-cases.mjs'
import {runApplicationProjectMcp} from './application-project-mcp-cases.mjs'
import {runPreparedApplicationProjectUi,uiRootChecks} from './application-project-ui-fixture.mjs'
import {requiredProjectChecks,projectScopeCases} from './application-project-cases.mjs'

export const plannedMcpCheckIds=Object.freeze(['mcp-production-dcr-owner-pkce-consent','mcp-tools-list-call','mcp-capability-without-project','mcp-project-without-capability','mcp-known-plus-unbound-list','mcp-known-plus-unbound-call','mcp-same-session-local-revoke','mcp-same-session-directory-revoke','mcp-subject-revoke','refresh-cannot-restore-revoked-scope','mcp-missing-extension'])

export function initialEvidence() {
  return {
    matrix:projectScopeCases.flatMap(item=>item.probes.map((probe,probeIndex)=>({transport:'rest',caseId:item.id,probeIndex,expectedAllowed:probe.allowed,resource:{tenant:'main',namespace:probe.namespace,resource:probe.resource,action:probe.action,...(probe.resourceId?{id:probe.resourceId}:{})},passed:false,status:'not_run',observed:{}}))),
    checks:[...new Set([...requiredProjectChecks,...plannedMcpCheckIds])].map(id=>({id,passed:false,status:'not_run',evidence:{}})),
    ui:['light','dark','dark-2','system'].flatMap(theme=>['en','de','es','fr','hi','it','ja','ko','pl','pt','pt_BR','ru','zh_CN'].map(locale=>({case:'theme-language',theme,locale,passed:false,status:'not_run'}))),
  }
}
export async function runIntegration(base,fixture,adapter,report,persist) {
  assert(fixture?.rest,'independently provisioned real REST test configuration required')
  const mergeChecks=fragment=>{
    for(const check of fragment.checks??[]) {
      const index=report.checks.findIndex(item=>item.id===check.id)
      if(index<0)report.checks.push(check);else report.checks[index]=check
    }
  }
  // Each fragment retains failure and pending rows before the next stage begins.
  await runApplicationProjectRest(base,fixture.rest,async fragment=>{
    report.fragments.rest=fragment;report.matrix=fragment.matrix;await persist()
  })
  if(fixture.runSecurity)await fixture.runSecurity(async fragment=>{report.fragments.security=fragment;mergeChecks(fragment);await persist()})
  if(fixture.checkHostHealth)await fixture.checkHostHealth('after-security')
  if(fixture.runMigration)await fixture.runMigration(async fragment=>{report.fragments.migration=fragment;mergeChecks(fragment);await persist()},async row=>{report.fragments.migrationStorageRecovery=row;await persist()})
  if(fixture.checkHostHealth)await fixture.checkHostHealth('after-migration')
  if(fixture.prepareMcp)fixture.mcp=await fixture.prepareMcp()
  if(fixture.prepareMissingExtension&&fixture.mcp) {
    try {fixture.mcp.missingExtension=await fixture.prepareMissingExtension()}
    catch(error) {
      // Preserve the actual setup failure and still execute all normal MCP
      // cases. Its mandatory missing-extension row will also fail explicitly.
      report.fragments.missingExtensionSetup={completed:false,status:'failed',error:error.stdout!==undefined||error.stderr!==undefined?'isolated missing-extension command failed; retained command-failures.log':String(error.message)}
      await persist()
    }
  }
  if(fixture.checkHostHealth)await fixture.checkHostHealth('before-mcp')
  if(fixture.mcp)await runApplicationProjectMcp(base,fixture.mcp,async fragment=>{
    report.fragments.mcp=fragment;mergeChecks(fragment);await persist()
  })
  if(report.fragments.featureDisabled)mergeChecks(report.fragments.featureDisabled)
  const missingMcp=report.fragments.mcp?.checks?.find(row=>row.id==='mcp-missing-extension')
  const missingRest=report.fragments.missingExtensionRest
  if(missingMcp?.passed&&missingRest?.readStatus===403&&missingRest.writeStatus===403&&missingRest.sideEffects)mergeChecks({checks:[{id:'missing-extension',passed:true,status:'passed',evidence:{mcp:missingMcp.evidence,rest:missingRest}}]})
  await persist()
  await runApplicationProjectAggregates(base,{planned:fixture.planned,rest:report.fragments.rest,mcp:report.fragments.mcp},async fragment=>{report.fragments.aggregates=fragment;mergeChecks(fragment);await persist()})
  if(fixture.prepareUi) {
    try {fixture.ui=await fixture.prepareUi({rest:report.fragments.rest,mcp:report.fragments.mcp})}
    catch(error){report.fragments.uiPreparationFailure={completed:false,status:'failed',error:String(error.message)};await persist();throw error}
  }
  if(fixture.ui) {
    const recordUi=async fragment=>{
      report.fragments.ui=fragment
      const pending=initialEvidence().ui
      for(const row of fragment.ui??[]) {
        const index=pending.findIndex(item=>item.case===row.case&&item.theme===row.theme&&item.locale===row.locale)
        if(index<0)pending.push(row);else pending[index]=row
      }
      report.ui=pending;mergeChecks({checks:uiRootChecks(fragment)});await persist()
    }
    if(fixture.runUi)await fixture.runUi(fixture.ui,recordUi)
    else {assert(adapter,'caller-owned browser adapter required; no browser space is opened');await runPreparedApplicationProjectUi(adapter,base,fixture.ui,recordUi)}
  }
  // Required migration/fault/revocation checks remain not_run until their own
  // real operations are implemented. UI evidence is never converted into an
  // unrelated integration check, and none is manufactured from row counts.
}
