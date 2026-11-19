import {assertPublishedNativeReport} from './published-native-flow-evidence.mjs'
import assert from 'node:assert/strict'

// Controller-reviewed scope; never infer the expected matrix from a downloaded report.
export const nativeFlowDetailCaseNames=Object.freeze([
 'flow-only-overview-description-nine-local-denials-no403','all-allowed-overview-ten-native-cards',
 'execution-only-datasource-isolation','log-only-datasource-isolation','trigger-only-datasource-isolation',
 'empty-data-does-not-deny-capability','provider503-is-visible-and-does-not-mount-data',
 'old-host-version-is-visible-protocol-error','unknown-fixed-definition-is-unsupported',
 'denied-runtime-deep-links-do-not-mount','concurrency-explicitly-unsupported-no-runtime-request',
 'execution-list-allowed-statistics-denied','logs-list-allowed-statistics-denied',
 'trigger-list-allowed-expanded-log-denied','metrics-native-read-chain','identity-switch-cancels-stale-projection',
 'native-refresh-rechecks-and-reloads-allowed-charts','expiry-unmounts-revoked-charts',
 'mode-a-native-without-capability-request','same-component-flow-target-switch-reloads-description',
 'late-old-flow-definition-cannot-replace-current-target',
 ...['en','zh_CN'].flatMap(locale=>['light','dark','dark-2','syncWithSystem'].flatMap(theme=>[1280,390].map(width=>`visual-${locale}-${theme}-${width}`))),
])

export function assertPublishedNativeFlowDetailReport(raw,readinessRaw,options) {
 const result=assertPublishedNativeReport(raw,readinessRaw,{...options,caseNames:nativeFlowDetailCaseNames})
 for(const row of JSON.parse(raw).cases.filter(row=>row.name.startsWith('visual-'))) {
  assert(row.visual?.surface,'Native visual evidence missing')
  assert.equal(row.visual.background,row.visual.surface)
  assert(row.visual.borderToken);assert.equal(row.visual.border,row.visual.borderToken)
 }
 return result
}
