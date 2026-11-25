import test from 'node:test'
import assert from 'node:assert/strict'
import {upgradeSecurityCases,assertPublishedUpgradeSecurityReports} from '../published-upgrade-security-evidence.mjs'

function reports() {
  return Object.fromEntries(Object.entries(upgradeSecurityCases).map(([path,names])=>{
    const classname=path.split('/').at(-1).slice(5,-4)
    return [path,`<testsuite tests="${names.length}" failures="0" errors="0" skipped="0">${names.map(name=>`<testcase classname="${classname}" name="${name}()"/>`).join('')}</testsuite>`]
  }))
}

test('published exact seven upgrade security cases pass',()=>{
  assert.equal(assertPublishedUpgradeSecurityReports(reports()).tests,7)
})
for(const mutation of ['missing','unexpected','skip','failure','wrong-name','wrong-class','wrong-count','duplicate']) {
  test('published upgrade security rejects '+mutation,()=>{
    const input=reports(),path=Object.keys(input)[0]
    if(mutation==='missing')delete input[path]
    if(mutation==='unexpected')input.other=input[path]
    if(mutation==='skip')input[path]=input[path].replace('/>','><skipped/></testcase>')
    if(mutation==='failure')input[path]=input[path].replace('/>','><failure/></testcase>')
    if(mutation==='wrong-name')input[path]=input[path].replace('shouldComputeOnRealSecretValueAndMaskOnlyTheOutputWhenValidatingInputs','unexpected')
    if(mutation==='wrong-class')input[path]=input[path].replace(/classname="[^"]+"/,'classname="other"')
    if(mutation==='wrong-count')input[path]=input[path].replace('tests="6"','tests="5"')
    if(mutation==='duplicate')input[path]=input[path].replace('shouldComputeOnRealSecretValueOfDependencyWhenValidatingInputs','shouldComputeOnRealSecretValueAndMaskOnlyTheOutputWhenValidatingInputs')
    assert.throws(()=>assertPublishedUpgradeSecurityReports(input))
  })
}
