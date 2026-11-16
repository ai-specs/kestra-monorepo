import test from 'node:test'
import assert from 'node:assert/strict'
import {configureAiRuntime, aiRuntimeGrants, aiRuntimeCaseIds, assertAiRuntimeControls, runApplicationProjectAiRuntime} from '../application-project-ai-runtime.mjs'

function original() {
    return {environment:{KESTRA_CONFIGURATION:'kestra:\n  repository:\n    url: jdbc:postgresql://postgres:5432/kestra\n  rbac:\n    enabled: true\n    typed:\n      enabled: true\n    evaluation:\n      enabled: true\n    application-groups:\n      enabled: true\n  oidc:\n    enabled: true\nmicronaut:\n  security:\n    oauth2:\n      clients:\n        kestra:\n          scopes: [openid, profile, email]\n'},volumes:[
        {type:'volume',source:'original',target:'/app/storage'},
        {type:'bind',source:'/original/libs',target:'/app/libs',read_only:true}]}
}
function options(mode) { return {mode,database:'application_group_acceptance_123_1',modelBase:'http://host.docker.internal:12345',storage:'ai-'+mode.toLowerCase()+'-abcd',formalJar:'/formal/plugin.jar',admin:{username:'test-admin',password:'test-only-password'}} }

test('mode A removes plugin mount and disables RBAC without mutating source', () => {
    const source=original(),before=structuredClone(source)
    const host=configureAiRuntime(source,options('A'))
    assert.deepEqual(source,before)
    assert(!host.volumes.some(v=>v.target.startsWith('/app/libs')))
    assert.match(host.environment.KESTRA_CONFIGURATION,/rbac:\n    enabled: false/)
    assert.match(host.environment.KESTRA_CONFIGURATION,/evaluation:\n      enabled: false/)
    assert.match(host.environment.KESTRA_CONFIGURATION,/application-groups:\n      enabled: false/)
    assert.match(host.environment.KESTRA_CONFIGURATION,/base-url: "http:\/\/host.docker.internal:12345"/)
    assert.match(host.environment.KESTRA_CONFIGURATION,/5432\/application_group_acceptance_123_1/)
})

test('mode B mounts only the exact formal plugin and enables normal gates', () => {
    const host=configureAiRuntime(original(),options('B'))
    assert.deepEqual(host.volumes.find(v=>v.target==='/app/libs/kestra-rbac-authorizer.jar'),{type:'bind',source:'/formal/plugin.jar',target:'/app/libs/kestra-rbac-authorizer.jar',read_only:true})
    assert.match(host.environment.KESTRA_CONFIGURATION,/evaluation:\n      enabled: true/)
    assert.match(host.environment.KESTRA_CONFIGURATION,/api-key: local-test-key/)
})

test('AI grants are explicit tenant entry and exact company.a business authority, never SYSTEM', () => {
    const grants=aiRuntimeGrants()
    assert.deepEqual(grants.find(g=>g.resource==='AI').actions,['READ','EXECUTE'])
    assert(!grants.some(g=>g.resource==='SYSTEM'||g.resource==='BUSINESS_INSTANCE'))
    for(const grant of grants.filter(g=>g.scope==='NAMESPACE')) {assert.equal(grant.namespace,'company.a');assert.equal(grant.descendants,false)}
    assert(grants.find(g=>g.resource==='EXECUTION').actions.includes('UPDATE'))
})

test('rejects ambiguous provider source, unsafe database and unknown extension mount', () => {
    const source=original();source.environment.KESTRA_CONFIGURATION+='  ai:\n    enabled: true\n'
    assert.throws(()=>configureAiRuntime(source,options('A')),/provider-free/)
    assert.throws(()=>configureAiRuntime(original(),{...options('A'),database:'kestra; DROP DATABASE kestra'}))
    const mounts=original();mounts.volumes.push({type:'bind',source:'/bad',target:'/app/libs/other.jar'})
    assert.throws(()=>configureAiRuntime(mounts,options('A')),/Unknown application extension/)
})

test('cannot start activated stage before retained provider-unavailable evidence', async () => {
    let commands=0;const reports=[]
    await assert.rejects(runApplicationProjectAiRuntime({configuration:{services:{kestra:original()}},planned:{admin:{}},
        compose:()=>commands++,command:()=>commands++,saveConfiguration:()=>{},record:r=>reports.push(r),controls:{},inputs:{image:'formal'}}),error=>{
        assert.equal(error.report.completed,false)
        assert.match(error.report.failure.message,/no-provider/)
        return true
    })
    assert.equal(commands,0);assert.equal(reports.length,1)
})

test('A owner isolation is outside its explicit matrix, never passed through an admin alias', () => {
    assert(!aiRuntimeCaseIds.A.includes('ai-owner'))
    assert(aiRuntimeCaseIds.B.includes('ai-owner'))
    assert.equal(aiRuntimeCaseIds.A.length,6)
    assert.equal(aiRuntimeCaseIds.B.length,7)
})

test('missing runtime controls or incompatible browser matrix fail before deployment', () => {
    const controls=Object.fromEntries(['waitForHost','assertRuntime','thread','readThread','captureEffects','observeEffects','revokeWait','verifyRejectedTransport'].map(name=>[name,()=>{}]))
    assert.throws(()=>assertAiRuntimeControls(controls,()=>{}),/explicit A\/B applicability/)
    const driver=()=>{};driver.supportsExplicitCaseIds=true
    assert.doesNotThrow(()=>assertAiRuntimeControls(controls,driver))
    delete controls.revokeWait
    assert.throws(()=>assertAiRuntimeControls(controls,driver),/not implemented.*revokeWait/)
})
