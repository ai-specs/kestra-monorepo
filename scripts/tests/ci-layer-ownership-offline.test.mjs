import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {accessControlAllUiCaseIds,accessControlCaseIds,accessControlTransferredUiCases} from '../access-control-v3-ui.mjs'
import {uiCaseOwner,rootUiPlan} from '../access-control-ci-ownership.mjs'
import {initialEvidence} from '../application-project-integration-cases.mjs'
import {derive} from '../access-control-v3-gates.mjs'

test('every former UI case has exactly one owner and transferred cases are not root skips or passes',()=>{
 assert.equal(accessControlAllUiCaseIds.length,134)
 assert.equal(accessControlCaseIds.length,85)
 assert.equal(accessControlTransferredUiCases.length,49)
 assert.deepEqual([...accessControlCaseIds,...accessControlTransferredUiCases.map(x=>x.id)].sort(),[...accessControlAllUiCaseIds].sort())
 assert(accessControlTransferredUiCases.every(x=>x.owner===uiCaseOwner(x.id)&&x.status===undefined&&x.passed===undefined))
 const report=initialEvidence()
 assert.equal(report.uiProfile,'integration');assert.equal(report.ui.length,88)
 assert(report.ui.every(x=>uiCaseOwner(x.name??x.case)==='root'))
 assert(!report.checks.some(x=>['ui-light','ui-dark','ui-narrow','ui-languages','ui-keyboard-focus'].includes(x.id)))
 assert.throws(()=>rootUiPlan(['same','same']),/duplicate/)
})

test('production workflow and security behavior never transfer into in-memory visual tests',()=>{
 for(const id of ['production-ui-login-canonical-path','ui-group-create-edit-delete','ui-permission-typed-save-refresh',
 'ui-subject-grant-revoke','ui-account-temporary-password-lifecycle','ui-read-write-separation',
 'ui-403-no-side-effects','ui-503-retry-no-side-effects','ui-secret-one-time-rotation',
 'ui-zero-grant-logout-switch','ui-permission-runtime-projection','ui-subject-runtime-revoke'])assert.equal(uiCaseOwner(id),'root',id)
 for(const id of ['ui-four-drawers-theme-language-dark-zh_CN','ui-native-filter-popup-geometry','ui-drawer-group-maximize'])assert.equal(uiCaseOwner(id),'plugin')
 assert.equal(uiCaseOwner('ui-auth-theme-language-light-en'),'overlay')
})

test('integration gates require the actual published owner evidence instead of a local visual pass',()=>{
 const report={...initialEvidence(),ui:[{name:'ui-four-drawers-theme-language-light-en',status:'passed',passed:true,evidence:{invented:true}}]}
 const gate=derive(report).find(x=>x.id==='access-control-v3-T11')
 const owner=gate.evidence.requiredInputs.find(x=>x.id==='published-ui:ui-four-drawers-theme-language-light-en')
 assert.equal(owner.status,'not_run');assert.equal(owner.source,'report.sources.plugin')
 assert(!gate.evidence.requiredInputs.some(x=>x.id==='report.ui:ui-four-drawers-theme-language-light-en'))
})

test('a green ownership summary without raw published cases cannot pass the runtime gate',()=>{
 const report={...initialEvidence(),inputs:{pluginCommit:'a'.repeat(40),image:'image'},sources:{plugin:{downloadedBrowserUiGate:{commit:'a'.repeat(40),image:'image',runId:1,artifactId:1,sha256:'b'.repeat(64),validation:{passed:true,failures:0,notRun:0,skipped:0}}}}}
 const row=derive(report).find(x=>x.id==='access-control-v3-T11').evidence.requiredInputs.find(x=>x.id==='published-ui:ui-four-drawers-theme-language-light-en')
 assert.equal(row.status,'failed');assert.equal(row.passed,false)
})

test('root runner does not retain executable theme loops or migrated literal visual callbacks',()=>{
 const source=readFileSync(new URL('../access-control-v3-ui.mjs',import.meta.url),'utf8')
 assert(!source.includes('async function fourDrawerThemeCase'))
 assert(!source.includes('async function authThemeCase'))
 assert(!source.includes('for(const theme of accessControlThemes)for(const locale of accessControlLocales)'))
 for(const row of accessControlTransferredUiCases)assert(!source.includes("await run('"+row.id+"'"),'Migrated callback still executes: '+row.id)
 assert(!readFileSync(new URL('../application-project-ui-fixture.mjs',import.meta.url),'utf8').includes('measureCurrentHostReferences'))
})
