import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {parseLifecycleJUnit} from './access-control-v3-gates.mjs'

export const upgradeSecurityCases=Object.freeze({
  'core/xml/TEST-io.kestra.core.runners.FlowInputOutputTest.xml':Object.freeze([
    'shouldComputeOnRealSecretValueAndMaskOnlyTheOutputWhenValidatingInputs',
    'shouldComputeOnRealSecretValueOfDependencyWhenValidatingInputs',
    'shouldMaskSecretInputsReferencedByAnotherInputWhenValidatingInputs',
    'shouldMaskSecretsInErrorMessagesWhenValidatingInputs',
    'shouldNotMaskSecretsWhenReadingExecutionInputs',
    'shouldObfuscateSecretsWhenValidatingInputsDeclaredAfterTheirDependent',
  ]),
  'webserver/xml/TEST-io.kestra.webserver.controllers.api.NamespaceFileControllerTest.xml':Object.freeze([
    'createGetFileContent_AddFlowWithNamespaceContainingReplacementCharacters',
  ]),
})

export function assertPublishedUpgradeSecurityReports(reports) {
  assert.deepEqual(Object.keys(reports).sort(),Object.keys(upgradeSecurityCases).sort())
  for(const [path,names] of Object.entries(upgradeSecurityCases)) {
    const parsed=parseLifecycleJUnit(reports[path])
    assert.equal(parsed.status,'passed','Published upgrade security cases must execute without failure or skip')
    const classname=path.split('/').at(-1).slice(5,-4)
    assert(parsed.cases.every(row=>row.classname===classname),'Unexpected security suite')
    assert.deepEqual(parsed.cases.map(row=>row.name.replace(/\(\)$/,'')).sort(),[...names].sort())
  }
  return {tests:7,failures:0,skipped:0,notRun:0,sha256:createHash('sha256').update(JSON.stringify(reports)).digest('hex')}
}
