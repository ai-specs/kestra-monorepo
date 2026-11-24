import test from 'node:test'
import assert from 'node:assert/strict'
import {configureAiRuntime, aiRuntimeGrants, aiRuntimeCaseIds, assertAiRuntimeControls, runApplicationProjectAiRuntime, aiSentinels, verifyAiEntryDenials, assertAiGrantSemantics} from '../application-project-ai-runtime.mjs'
import {ProjectSideEffects} from '../application-project-effects.mjs'

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
    for(const grant of grants.filter(g=>g.scope==='NAMESPACE')) {assert.equal(grant.namespace,'company.a');assert.equal(Object.hasOwn(grant,'descendants'),false)}
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
    assert.equal(aiRuntimeCaseIds.B.length,9)
})

test('missing runtime controls or incompatible browser matrix fail before deployment', () => {
    const controls=Object.fromEntries(['waitForHost','assertRuntime','thread','readThread','captureEffects','observeEffects','revokeWait','verifyRejectedTransport'].map(name=>[name,()=>{}]))
    assert.throws(()=>assertAiRuntimeControls(controls,()=>{}),/explicit A\/B applicability/)
    const driver=()=>{};driver.supportsExplicitCaseIds=true
    assert.doesNotThrow(()=>assertAiRuntimeControls(controls,driver))
    delete controls.revokeWait
    assert.throws(()=>assertAiRuntimeControls(controls,driver),/not implemented.*revokeWait/)
})

test('sentinel identities require all company subspaces in A and only company.a in B',()=>{
    assert.deepEqual(aiSentinels('012345abcd','A').map(value=>value.namespace),['company.a','company.b','company.outside'])
    assert.deepEqual(aiSentinels('012345abcd','B'),[{namespace:'company.a',id:'ai-list-012345abcd'}])
    assert.throws(()=>aiSentinels('unsafe','B'))
})

function denialOptions(kind,override={}) {
    const requests=[]
    return {kind,threadId:'own-thread',scenarioId:'denied-model',snapshot:async()=>({threads:'same',messages:'same'}),
        transportRequests:async()=>({requests:0,functionResponses:0}),
        effects:{observeDenied:async(action,verify)=>{const value=await action();verify(value);return {observation:{offline:true}}}},
        client:{request:async(path,options)=>{requests.push({path,...options});return new Response(null,{status:options.method==='GET'&&kind==='read-only-ai'?200:403})}},
        ...override,requests}
}

for(const kind of ['zero-ai','read-only-ai'])test('activated '+kind+' requires exact entry statuses and unchanged evidence (offline boundary)',async()=>{
    const options=denialOptions(kind),result=await verifyAiEntryDenials(options)
    assert.equal(result.id,'ai-activated-'+kind+'-entry');assert.equal(result.passed,true)
    assert.deepEqual(result.requests.map(row=>row.status),[403,kind==='zero-ai'?403:200,403,403])
    assert.match(options.requests.find(row=>row.path.endsWith('/chat')).body,/\[\[ai-scenario:denied-model\]\]/)
})

test('entry denial refuses 404 masquerading as authorization denial',async()=>{
    await assert.rejects(verifyAiEntryDenials(denialOptions('zero-ai',{client:{request:async()=>new Response(null,{status:404})}})),/entry status differs/)
})

test('entry denial refuses thread mutation or model invocation despite 403',async()=>{
    let snapshots=0
    await assert.rejects(verifyAiEntryDenials(denialOptions('zero-ai',{snapshot:async()=>({count:snapshots++})})),/persisted/)
    let requests=0
    await assert.rejects(verifyAiEntryDenials(denialOptions('read-only-ai',{transportRequests:async()=>requests++})),/reached model/)
})

test('grant semantics accepts only tenant omitted null and unordered grant/action/id collections',()=>{
    const expected=aiRuntimeGrants();expected[2].ids=['b','a']
    const actual=structuredClone(expected).reverse()
    for(const grant of actual){if(grant.scope==='TENANT')delete grant.namespace;grant.actions.reverse();grant.ids.reverse()}
    const before=structuredClone(actual)
    assert.doesNotThrow(()=>assertAiGrantSemantics(actual,expected))
    assert.deepEqual(actual,before,'normalization must not mutate persisted evidence')
})

test('grant semantics rejects changed actions namespace IDs flags unknown fields and duplicates',()=>{
    const expected=aiRuntimeGrants()
    for(const mutate of [g=>g[0].actions=['READ'],g=>g[0].namespace='company.a',g=>delete g[2].namespace,
        g=>g[2].namespace='company.b',g=>g[2].ids=['different'],g=>g[2].allIds=false,
        g=>g[0].extra=true,g=>g[0].actions.push('READ'),g=>g.push(structuredClone(g[0]))]) {
        const actual=structuredClone(expected);mutate(actual)
        assert.throws(()=>assertAiGrantSemantics(actual,expected),/semantics differ/)
    }
})

test('failed response and AI mutation still execute real delayed observer and retain snapshots (offline storage)',async()=>{
    await Promise.all(['response','ai-mutation'].map(async kind=>{
        let businessSamples=0,aiSamples=0
        const effects={snapshot:()=>{businessSamples++;return {hash:'stable',sources:{database:'stable'}}},
            observeDenied:ProjectSideEffects.prototype.observeDenied}
        const options=denialOptions('zero-ai',{effects,
            ...(kind==='response'?{client:{request:async()=>new Response(null,{status:404})}}:
                {snapshot:async()=>({count:aiSamples++})})})
        await assert.rejects(verifyAiEntryDenials(options),error=>{
            assert.match(error.message,kind==='response'?/entry status differs/:/persisted/)
            assert(error.sideEffects.samples.length>1,'delayed business samples required even after assertion failure')
            assert(error.sideEffects.samples.at(-1).elapsedMs>=5000)
            assert.equal(error.aiObservation.samples.length,5,'four immediate AI snapshots and final snapshot required')
            return true
        })
        assert(businessSamples>2)
    }))
})
