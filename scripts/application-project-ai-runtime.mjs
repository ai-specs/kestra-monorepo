import assert from 'node:assert/strict'
import {createHash, randomBytes} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {ApplicationGroupManagement, applicationProjectFeature} from './application-project-fixture.mjs'
import {ProjectSideEffects} from './application-project-effects.mjs'
import {runApplicationProjectAiBrowser} from './application-project-ai-browser.mjs'
import {startModelTransport} from './ai-model-transport.mjs'
import {sanitizeUiEvidence} from './access-control-v3-ui.mjs'
import {permissionWriteBody} from './access-control-v3-rest-cases.mjs'

const api = '/api/v1/main'
const digest = value => createHash('sha256').update(value).digest('hex')
const namespace = 'company.a'
const password = () => randomBytes(24).toString('base64url') + 'Aa1!'
export const aiRuntimeCaseIds = Object.freeze({
    A:Object.freeze(['ai-text','ai-stop','ai-tool-list','ai-confirm-reject','ai-confirm-approve','ai-confirm-duplicate']),
    B:Object.freeze(['ai-text','ai-stop','ai-owner','ai-tool-list','ai-confirm-reject','ai-confirm-approve','ai-confirm-duplicate','ai-confirm-scope-denied','ai-confirm-business-revoked']),
})
export function assertAiRuntimeControls(controls, browserDriver) {
    for(const name of ['waitForHost','assertRuntime','thread','readThread','captureEffects','observeEffects','revokeWait'])
        assert.equal(typeof controls?.[name],'function','not implemented: owned '+name+' control')
    assert.equal(browserDriver?.supportsExplicitCaseIds,true,'not implemented: browser driver explicit A/B applicability; A must not execute owner isolation')
}
export function aiRuntimeGrants() {
    const tenant = (resource, actions) => ({scope:'TENANT',tenant:'main',namespace:null,resource,actions,ids:[],allIds:true})
    const ns = (resource, actions) => ({scope:'NAMESPACE',tenant:'main',namespace:namespace,resource,actions,ids:[],allIds:true})
    return [tenant('AI',['READ','EXECUTE']),tenant('METADATA',['READ','LIST']),
        ns('FLOW',['READ','LIST','EXECUTE']),ns('EXECUTION',['READ','LIST','UPDATE','CREATE']),ns('LOG',['READ','LIST'])]
}

export function assertAiGrantSemantics(actual, expected) {
    const stable = value => Array.isArray(value) ? value.map(stable)
        : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])) : value
    const normalize = grants => {
        assert(Array.isArray(grants),'grants must be an array')
        return grants.map(grant=>{
            const result=structuredClone(grant)
            if(result.scope==='TENANT' && !Object.hasOwn(result,'namespace'))result.namespace=null
            for(const field of ['actions','ids'])if(Array.isArray(result[field]))result[field].sort()
            return stable(result)
        }).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))
    }
    assert.deepEqual(normalize(actual),normalize(expected),'persisted AI grant semantics differ')
}

export function aiSentinels(suffix, mode) {
    assert.match(suffix,/^[a-f0-9]{10}$/);assert(['A','B'].includes(mode))
    return ['company.a','company.b','company.outside'].filter(value=>mode==='A'||value===namespace)
        .map(value=>({namespace:value,id:'ai-list-'+suffix}))
}

export async function verifyAiEntryDenials({kind,client,threadId,snapshot,effects,transportRequests,scenarioId,onProgress=async()=>{}}) {
    assert(['zero-ai','read-only-ai'].includes(kind));assert.match(threadId,/^[A-Za-z0-9_-]+$/)
    assert.match(scenarioId,/^[A-Za-z0-9_-]{1,64}$/)
    const before=await snapshot(), modelBefore=await transportRequests(), requests=[]
    const root=api+'/ai/threads', expectedGet=kind==='zero-ai'?403:200
    const operations=[[root,'POST',{mode:'ASK',title:'Denied activated AI probe'},403],
        [root+'/'+threadId,'GET',undefined,expectedGet],
        [root+'/'+threadId+'/chat','POST',{prompt:'Must not run [[ai-scenario:'+scenarioId+']]',mode:'ASK',providerId:'controlled-gemini'},403],
        [root+'/'+threadId+'/confirm','POST',{confirmationId:'denied-confirmation',decision:'APPROVE',providerId:'controlled-gemini'},403]]
    const aiSnapshots=[]
    let observation, failure
    try { ({observation}=await effects.observeDenied(async()=>{
        for(const [path,method,body,status] of operations) {
            const response=await client.request(path,{method,headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})})
            await response.body?.cancel();requests.push({path,method,status:response.status})
            await onProgress({requests:structuredClone(requests)})
            aiSnapshots.push(await snapshot())
        }
        return requests
    },responses=>{
        for(const [index,response] of responses.entries())
            assert.equal(response.status,operations[index][3],kind+' entry status differs: '+response.method+' '+response.path)
        for(const value of aiSnapshots)assert.deepEqual(value,before,'denied AI entry changed persisted threads/messages')
    }, {windowMs:5000})) } catch(error) {failure=error}
    try {const after=await snapshot();aiSnapshots.push(after);assert.deepEqual(after,before,'late denied AI write')}
    catch(error) {failure??=error}
    if(failure) {failure.aiObservation={before,samples:aiSnapshots};throw failure}
    assert.deepEqual(await transportRequests(),modelBefore,'denied AI entry reached model')
    return {id:'ai-activated-'+kind+'-entry',status:'passed',passed:true,providerConfigured:true,requests,noAiSideEffects:true,noBusinessSideEffects:true,noModelRequests:true,observation}
}

export function configureAiRuntime(originalHost, {mode, database, modelBase, storage, formalJar, admin}) {
    assert(['A','B'].includes(mode)); assert(/^application_group_acceptance_[0-9]+_[0-9]+$/.test(database))
    assert(admin?.username && admin?.password && typeof formalJar === 'string')
    assert(/^ai-[ab]-[a-f0-9]+$/.test(storage)); assert.equal(new URL(modelBase).protocol,'http:')
    const host = structuredClone(originalHost)
    let configuration = applicationProjectFeature(host.environment.KESTRA_CONFIGURATION, mode === 'B')
    assert(!/^  ai:/m.test(configuration),'AI stage requires explicit provider-free source configuration')
    assert(/^kestra:\s*$/m.test(configuration),'Kestra configuration root missing')
    configuration = configuration.replace(/^kestra:\s*$/m, 'kestra:\n  ai:\n    enabled: true\n    providers:\n      - id: controlled-gemini\n        type: gemini\n        is-default: true\n        configuration:\n          base-url: ' + JSON.stringify(modelBase) + '\n          api-key: local-test-key\n          model-name: gemini-2.5-flash\n          thinking-enabled: false\n          log-requests: false\n          log-responses: false\n          timeout: PT180S\n    agent:\n      docs-mcp-url: ' + JSON.stringify(modelBase + "/docs-disabled") + '\n      model-call-timeout: PT180S')
    assert(configuration.includes('jdbc:postgresql://postgres:5432/kestra'),'Known database URL required')
    configuration = configuration.replaceAll('jdbc:postgresql://postgres:5432/kestra','jdbc:postgresql://postgres:5432/' + database)
    host.environment.KESTRA_CONFIGURATION = configuration
    for (const [key,value] of Object.entries({USERNAME:admin.username,PASSWORD:admin.password,EMAIL:admin.username+'@acceptance.invalid',NAME:'AI acceptance manager'}))
        host.environment['KESTRA_OIDC_BOOTSTRAP_'+key] = value
    const volumes = host.volumes ?? []
    assert(volumes.every(volume => typeof volume === 'object' && volume.target),'Explicit long-form owned mounts required')
    assert(!volumes.some(volume => volume.target.startsWith('/app/libs') && !['/app/libs','/app/libs/kestra-rbac-authorizer.jar'].includes(volume.target)), 'Unknown application extension mount')
    host.volumes = volumes.filter(volume => !['/app/storage','/app/libs','/app/libs/kestra-rbac-authorizer.jar'].includes(volume.target))
    host.volumes.push({type:'volume',source:storage,target:'/app/storage'})
    if (mode === 'B') host.volumes.push({type:'bind',source:formalJar,target:'/app/libs/kestra-rbac-authorizer.jar',read_only:true})
    return host
}

/** Run only after the caller has completed and retained its original provider-unavailable gate. */
export async function runApplicationProjectAiRuntime(options) {
    const {configuration, compose, saveConfiguration, command, base, inputs, formalJar, planned, record, controls} = options
    let page=options.page
    const sourceNames=['application-project-ai-runtime.mjs','application-project-ai-browser.mjs','application-project-ai-controls.mjs','application-project-ai-deployment.mjs','ai-model-transport.mjs']
    const sourceSha256=()=>Object.fromEntries(sourceNames.map(name=>[name,digest(readFileSync(new URL(name,import.meta.url)))]))
    const report = {schemaVersion:1,stage:'ai-activated',completed:false,sourceSha256:sourceSha256(),modes:[],cleanup:[],failure:null,
        integrationRequirements:['browserDriver.supportsExplicitCaseIds with exact A/B matrices',
            'assertRuntime verifies actual image/mount/database and returns storageVolume',
            'thread/readThread observe the active browser cookie session',
            'observeEffects checks persisted execution, queue and storage until bounded stable outcome',
            'revokeWait performs actual native wait/revoke/termination and business-state observation',
            'model transport validates raw EDIT rejection text via expect.rejectedText and reports completed function response']}
    const secrets = [planned?.admin?.password]
    const persist = () => record(sanitizeUiEvidence(structuredClone(report), secrets))
    const original = structuredClone(configuration)
    let transport, active, configured = false, postgres
    const resources=[]
    try {
        assert.equal(typeof record,'function','record required')
        for (const [name,fn] of Object.entries({compose,saveConfiguration,command})) assert.equal(typeof fn,'function',name+' required')
        assert.equal(options.noProviderEvidence?.passed,true,'original no-provider gate must finish first')
        assert.equal(options.noProviderEvidence?.providerConfigured,false)
        assert.equal(options.noProviderEvidence?.image,inputs.image)
        assert(/^application-projects-bb-[0-9]+-[0-9]+$/.test(options.project),'owned compose project required')
        assert.match(inputs.image,/^ghcr.io\/ai-specs\/kestra-overlay@sha256:[a-f0-9]{64}$/)
        assert.equal(original.services.kestra.image,inputs.image,'source deployment must use formal image')
        assert.equal(digest(readFileSync(formalJar)),inputs.jarSha256,'formal jar hash mismatch')
        const browserDriver=options.browserDriver ?? runApplicationProjectAiBrowser
        assertAiRuntimeControls(controls,browserDriver)
        assert.equal(new URL(base).origin,base)
        const inspect = async (format,id) => String(await command('docker',['inspect','-f',format,id])).trim()
        postgres = String(await compose('ps','-q','postgres')).trim()
        assert.match(postgres,/^[a-f0-9]{12,64}$/)
        assert.equal(await inspect('{{index .Config.Labels "com.docker.compose.project"}}',postgres),options.project)
        assert.equal(await inspect('{{index .Config.Labels "owner"}}',postgres),options.project)
        transport = await startModelTransport({host:options.modelHost ?? '0.0.0.0',port:0})
        const controlBase = `http://127.0.0.1:${transport.address.port}`
        const modelBase = options.modelBaseForPort?.(transport.address.port)
        assert(modelBase,'container-reachable modelBaseForPort callback required')
        const scenarioRequest = async (path, body, method='POST') => {
            const response = await fetch(controlBase+path,{method,headers:{'Content-Type':'application/json'},
                ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000)})
            const result = await response.json(); assert(response.ok,'model control failed '+response.status); return result
        }
        for (const mode of ['A','B']) {
            if(options.prepareModePage)page=await options.prepareModePage(mode)
            const suffix = randomBytes(5).toString('hex')
            const database = 'application_group_acceptance_'+Date.now()+'_'+(mode==='A'?1:2)
            const storage = 'ai-'+mode.toLowerCase()+'-'+suffix
            const admin = {username:'ai-manager-'+suffix,subject:'ai-manager-'+suffix,password:password()}
            const account = {username:'ai-user-'+suffix,subject:'ai-user-'+suffix,password:password()}
            const other = {username:'ai-other-'+suffix,subject:'ai-other-'+suffix,password:password()}
            secrets.push(admin.password,account.password,other.password)
            active = {mode,database,storage,image:inputs.image,jarAbsent:mode==='A',jarSha256:mode==='B'?inputs.jarSha256:null,status:'running',applicableCaseIds:[...aiRuntimeCaseIds[mode]]}
            report.modes.push(active); await persist()
            // Database creation is deployment isolation, never an authorization-table write.
            await command('docker',['exec',postgres,'psql','-X','-U','kestra','-d','kestra','-v','ON_ERROR_STOP=1','-c','CREATE DATABASE '+database+' OWNER kestra'])
            const resource={database,storage,volume:null};resources.push(resource)
            configuration.services.kestra = configureAiRuntime(original.services.kestra,{mode,database,modelBase,storage,formalJar,admin})
            configuration.volumes ??= {}; configuration.volumes[storage] = {labels:{owner:options.project}}
            configured = true; await saveConfiguration(); await compose('up','-d','kestra')
            const kestra = String(await compose('ps','-q','kestra')).trim()
            assert.match(kestra,/^[a-f0-9]{12,64}$/)
            await controls.waitForHost({base,mode,database,kestra})
            const actual = await controls.assertRuntime({base,mode,database,postgres,kestra,image:inputs.image,jarSha256:active.jarSha256,jarAbsent:active.jarAbsent})
            assert.equal(actual?.verified,true,'actual owned image/mount/database configuration must be verified')
            assert(typeof actual.storageVolume==='string' && actual.storageVolume.length,'actual named storage volume required for cleanup')
            assert.equal(String(await command('docker',['volume','inspect','-f','{{index .Labels "owner"}}',actual.storageVolume])).trim(),options.project)
            resource.volume=actual.storageVolume
            active.configurationSha256 = digest(configuration.services.kestra.environment.KESTRA_CONFIGURATION)
            active.runtime = {verified:true,database,jarAbsent:mode==='A',configurationSha256:active.configurationSha256}
            const adminClient = new ProductionOAuthClient(base)
            assert.equal((await adminClient.login(admin.username,admin.password)).authenticated,true)
            const configResponse = await adminClient.request('/api/v1/configs'); assert.equal(configResponse.status,200)
            assert.equal((await configResponse.json()).isAiApiKeyConfigured,true,'formal Gemini provider not activated')
            let management, userClient
            if (mode === 'B') {
                management = new ApplicationGroupManagement(base,admin); await management.login()
                const group = 'main', scope = 'acceptance-ai-'+suffix
                let current = await management.request(management.groupPath(group))
                await management.request(management.groupPath(group)+'/scopes','POST',{key:scope,name:'AI acceptance',description:'Explicit AI entry and company.a tools'},current.revision)
                await management.login()
                const application = await management.request(management.applicationPath(group))
                await management.request(management.permissionsPath(group),'POST',{key:'ai-'+suffix,name:'AI acceptance',scopeKeys:[scope],description:'Explicit test grants',enabled:true,grants:aiRuntimeGrants(),managementGrants:[]},application.revision)
                await management.login()
                active.scope = scope
                const permission=await management.request(management.permissionsPath(group)+'/ai-'+suffix)
                assertAiGrantSemantics(permission.grants,aiRuntimeGrants())
                for (const value of [account,other]) {
                    await management.login()
                    const created = await management.request('/api/v1/main/extensions/rbac/users','POST',{username:value.username,name:'AI acceptance account',email:value.username+'@acceptance.invalid'})
                    assert.equal(created.subject,value.subject)
                    assert(typeof created.temporaryPassword==='string' && created.temporaryPassword.length,'host-generated temporaryPassword required')
                    await new ProductionOAuthClient(base).changeTemporaryPassword(value.username,created.temporaryPassword,value.password)
                    delete created.temporaryPassword
                    await management.login()
                    current = await management.request(management.groupPath(group))
                    await management.request(management.groupPath(group)+'/scope-grants','POST',{issuer:base,subject:value.subject,scopeKeys:[scope]},current.revision)
                }
                userClient = new ProductionOAuthClient(base); await userClient.login(account.username,account.password)
                const identity = await userClient.verifiedUiIdentity({applicationGroupId:group,subject:account.subject,audience:'kestra-ui'})
                assert(identity.applicationGroupScopes.includes(scope),'real login did not receive AI scope')
            }
            const effects = new ProjectSideEffects({postgresContainer:postgres,kestraContainer:kestra,composeProject:options.project,database,namespacePrefix:'company.'})
            await adminClient.login(admin.username,admin.password)
            const seedByScenario = new Map()
            const seed = async spec => {
                await adminClient.login(admin.username,admin.password)
                const seedNamespace=spec.namespace??namespace
                const flowId = 'ai-'+suffix+'-'+spec.id
                const source = `id: ${flowId}\nnamespace: ${seedNamespace}\ntasks:\n  - id: failed\n    type: io.kestra.plugin.core.execution.Fail\n`
                const saved = await adminClient.request(api+'/flows',{method:'POST',headers:{'Content-Type':'application/x-yaml'},body:source})
                assert(saved.ok,'real seed flow write failed'); await saved.body?.cancel()
                const execute = await adminClient.request(api+'/executions/'+seedNamespace+'/'+flowId,{method:'POST',body:new FormData()})
                assert(execute.ok,'real failed execution creation failed')
                const execution = await execute.json(); assert(execution.id)
                const deadline = Date.now()+60000
                for (;;) {
                    const response = await adminClient.request(api+'/executions/'+execution.id); assert(response.ok)
                    const stored = await response.json()
                    if(stored.state?.current==='FAILED')break
                    assert(Date.now()<deadline,'failed execution seed deadline exceeded'); await new Promise(resolve=>setTimeout(resolve,200))
                }
                await effects.waitForStable()
                const result = {flowId,executionId:execution.id,namespace:seedNamespace,expectedState:'FAILED'}; seedByScenario.set(spec.id,result); return result
            }
            for (const sentinel of aiSentinels(suffix,'A')) {
                const response = await adminClient.request(api+'/flows',{method:'POST',headers:{'Content-Type':'application/x-yaml'},body:`id: ${sentinel.id}\nnamespace: ${sentinel.namespace}\ntasks:\n  - id: log\n    type: io.kestra.plugin.core.log.Log\n    message: AI list sentinel\n`})
                assert(response.ok,'list sentinel create failed'); await response.body?.cancel()
            }
            const spec = name => ({id:mode.toLowerCase()+'-'+suffix+'-'+name,prompt:'Perform the controlled '+name+' operation',expectedText:'Controlled operation complete.',providerId:'controlled-gemini'})
            const scenarios = {text:spec('text'),cancel:spec('cancel'),list:spec('list'),reject:spec('reject'),approve:spec('approve'),
                ...(mode==='B'?{owner:{account:other,scenario:spec('owner')},scopeDenied:{...spec('scope-denied'),namespace:'company.b',expectedDenied:true},businessRevoked:{...spec('business-revoked'),expectedDenied:true,revokeBusiness:true}}:{})}
            const scenario = {
                async prepare(value) {
                    let definition = {id:value.id,mode:'text',text:value.expectedText}
                    if(value.id===scenarios.cancel.id || value.mode==='wait')definition.mode='wait'
                    if(value.id===scenarios.list.id)definition={...definition,mode:'tool',tool:{name:'list-flows',args:{},expect:{flowIds:aiSentinels(suffix,mode),namespaces:aiSentinels(suffix,mode).map(value=>value.namespace),minItems:1}}}
                    if(seedByScenario.has(value.id)) {
                        const seeded = seedByScenario.get(value.id)
                        definition={...definition,mode:value.mode==='wait'?'wait':'tool',tool:{name:'restart-execution',args:{executionId:seeded.executionId},
                            expect:value.expectedDenied?{authorizationDenied:true}:value.id===scenarios.reject.id?{rejectedText:true}:{exact:{executionId:seeded.executionId}}}}
                    }
                    await scenarioRequest('/scenarios',definition)
                },
                read:id=>scenarioRequest('/scenarios/'+id,undefined,'GET'),
                async release(id,{allowDisconnected=false}={}) {
                    const response=await fetch(controlBase+'/scenarios/'+id+'/release',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)})
                    const value=await response.json()
                    if(allowDisconnected) {
                        assert.equal(response.status,409);assert.equal(value.error,'not_waiting')
                        const state=await scenario.read(id);assert(state.disconnected>0);assert.equal(state.phase,'disconnected')
                        active.lateRelease={id,status:response.status,error:value.error,disconnected:state.disconnected};await persist()
                        return {...active.lateRelease,disconnected:true}
                    }
                    assert.equal(response.status,200);return value
                },
                async verifyRejected(id) {
                    assert.equal(id,scenarios.reject.id,'only the declared rejection scenario can verify rejected text')
                    const state=await scenarioRequest('/scenarios/'+id,undefined,'GET')
                    assert.equal(state.phase,'done','rejected-text model scenario did not complete')
                    assert.equal(state.functionResponses,1,'transport must verify exactly one rejected-text function response')
                    return {verified:true,source:'gemini-http-transport-rejected-text',phase:state.phase,functionResponses:state.functionResponses}
                },
            }
            if(mode==='B') {
                active.entryDenials=[]
                const sql=async query=>String(await command('docker',['exec',postgres,'psql','-X','-q','-A','-t','-U','kestra','-d',database,'-v','ON_ERROR_STOP=1','-c',query])).trim()
                const persistenceSnapshot=async()=>{
                    const result={}
                    for(const table of ['ai_agent_thread','ai_agent_message']) {
                        const present=await sql("SELECT to_regclass('public."+table+"') IS NOT NULL")==='t'
                        result[table]=present?{present,hash:await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY row_to_json(t)::text),'')) FROM "+table+' t')}:{present:false}
                    }
                    return result
                }
                for(const kind of ['zero-ai','read-only-ai']) {
                    const value={username:'ai-'+kind+'-'+suffix,subject:'ai-'+kind+'-'+suffix,password:password()}
                    secrets.push(value.password)
                    const scope='acceptance-'+kind+'-'+suffix, key='ai-'+kind+'-'+suffix
                    await management.login()
                    let group=await management.request(management.groupPath('main'))
                    await management.request(management.groupPath('main')+'/scopes','POST',{key:scope,name:'AI entry denial '+kind,description:'Explicit activated AI denial test scope'},group.revision)
                    await management.login()
                    const application=await management.request(management.applicationPath('main'))
                    const grants=[aiRuntimeGrants().find(grant=>grant.resource==='AI')]
                    await management.request(management.permissionsPath('main'),'POST',{key,name:'AI entry denial '+kind,scopeKeys:[scope],enabled:true,grants,managementGrants:[]},application.revision)
                    await management.login()
                    const created=await management.request('/api/v1/main/extensions/rbac/users','POST',{username:value.username,name:'AI entry denial',email:value.username+'@acceptance.invalid'})
                    assert.equal(created.subject,value.subject);assert(typeof created.temporaryPassword==='string')
                    await new ProductionOAuthClient(base).changeTemporaryPassword(value.username,created.temporaryPassword,value.password)
                    secrets.push(created.temporaryPassword);delete created.temporaryPassword
                    await management.login();group=await management.request(management.groupPath('main'))
                    await management.request(management.groupPath('main')+'/scope-grants','POST',{issuer:base,subject:value.subject,scopeKeys:[scope]},group.revision)
                    const client=new ProductionOAuthClient(base);assert.equal((await client.login(value.username,value.password)).authenticated,true)
                    const identity=await client.verifiedUiIdentity({applicationGroupId:'main',subject:value.subject,audience:'kestra-ui'})
                    assert(identity.applicationGroupScopes.includes(scope))
                    const response=await client.request(api+'/ai/threads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'ASK',title:'AI entry denial own thread'})})
                    assert(response.ok,'authorized own thread setup failed');const thread=await response.json();assert(thread.uid)
                    await management.login()
                    const path=management.permissionsPath('main')+'/'+key, permission=await management.request(path)
                    const deniedGrants=kind==='zero-ai'?[]:grants.map(grant=>({...grant,actions:['READ']}))
                    await management.request(path,'PUT',Object.fromEntries(['key','name','description','scopeKeys','enabled','managementGrants'].map(field=>[field,permission[field]]).concat([['grants',deniedGrants]])),permission.revision)
                    await management.login()
                    const persisted=await management.request(path);assertAiGrantSemantics(persisted.grants,deniedGrants)
                    const snapshot=async()=>{
                        const temporaryRead=kind==='zero-ai'
                        const replace=async next=>{
                            await management.login();const current=await management.request(path)
                            await management.request(path,'PUT',Object.fromEntries(['key','name','description','scopeKeys','enabled','managementGrants'].map(field=>[field,current[field]]).concat([['grants',next]])),current.revision)
                            await client.login(value.username,value.password)
                        }
                        let detail
                        try {
                            if(temporaryRead)await replace(grants.map(grant=>({...grant,actions:['READ']})))
                            const response=await client.request(api+'/ai/threads/'+thread.uid)
                            assert.equal(response.status,200,'own thread observation with explicit AI.READ failed')
                            detail=await response.json()
                        } finally {if(temporaryRead)await replace(deniedGrants)}
                        return {ownThread:detail,persistence:await persistenceSnapshot(),observationScope:'owned-thread-and-messages-via-production-API; OSS ephemeral store is not globally enumerable'}
                    }
                    await client.login(value.username,value.password)
                    const scenarioId='b-'+suffix+'-'+kind
                    await scenarioRequest('/scenarios',{id:scenarioId,mode:'text',text:'Denied model must never run'})
                    const entry={id:'ai-activated-'+kind+'-entry',status:'running',passed:false,requests:[]}
                    active.entryDenials.push(entry);await persist()
                    try {
                        const result=await verifyAiEntryDenials({kind,client,threadId:thread.uid,snapshot,effects,scenarioId,
                            onProgress:async partial=>{Object.assign(entry,partial);await persist()},
                            transportRequests:async()=>{const state=await scenarioRequest('/scenarios/'+scenarioId,undefined,'GET');return {requests:state.requests,functionResponses:state.functionResponses}}})
                        Object.assign(entry,result)
                    } catch(error) {entry.status='failed';entry.error=String(error.message);entry.sideEffects=error.sideEffects;entry.aiObservation=error.aiObservation;throw error}
                    await persist()
                }
            }
            const browserControls = {mode,scenario,seed,caseIds:[...aiRuntimeCaseIds[mode]],
                async revokeBusiness(){
                    await management.login();const path=management.permissionsPath('main')+'/ai-'+suffix
                    const permission=await management.request(path)
                    const input=permissionWriteBody(permission)
                    const grants=input.grants.filter(grant=>!['FLOW','EXECUTION'].includes(grant.resource))
                    await management.request(path,'PUT',Object.fromEntries(['key','name','description','scopeKeys','enabled','managementGrants'].map(key=>[key,permission[key]]).concat([['grants',grants]])),permission.revision)
                    await management.login()
                    const stored=await management.request(path);assertAiGrantSemantics(stored.grants,grants)
                    assert(stored.grants.some(grant=>grant.resource==='AI'&&grant.actions.includes('EXECUTE')),'business revoke must preserve AI.EXECUTE')
                    return {businessRevoked:true,aiExecuteRetained:true,revision:stored.revision}
                },
                record:async value=>{active.browser=value;await persist()},
                thread:(adapter,value)=>controls.thread(adapter,value,{base,mode}),
                readThread:(adapter,id)=>controls.readThread(adapter,id,{base,mode}),
                effects:{businessSnapshot:()=>effects.snapshot(),
                    async observeBusinessUnchanged(before){
                        assert.equal(effects.snapshot().hash,before.hash,'cancelled AI turn changed business state')
                        const {observation}=await effects.observeDenied(()=>{},()=>{}, {windowMs:5000})
                        assert.equal(observation.before,before.hash)
                        return {unchanged:true,observation}
                    },snapshot:seeded=>controls.captureEffects(seeded,effects),
                    observe:value=>controls.observeEffects({...value,effects,base,mode,adminClient,readExecution:id=>readExecution(adminClient,id)})}}
            active.browser = await browserDriver(page,base,mode==='A'?admin:account,scenarios,browserControls)
            assert.equal(active.browser?.completed,true)
            assert.deepEqual(active.browser.checks.map(row=>row.id),aiRuntimeCaseIds[mode],'driver did not use explicit applicable matrix')
            assert(active.browser.checks.every(row=>row.status==='passed'&&row.passed),'applicable case not passed')
            if(mode==='B') {
                const revoke = async () => {
                    await management.login()
                    const path=management.permissionsPath('main')+'/ai-'+suffix
                    const permission=await management.request(path)
                    const grants=permissionWriteBody(permission).grants.map(grant=>grant.resource==='AI'?{...grant,actions:['READ']}:grant)
                    await management.request(path,'PUT',Object.fromEntries(['key','name','description','scopeKeys','enabled','managementGrants'].map(key=>[key,permission[key]]).concat([['grants',grants]])),permission.revision)
                }
                const waitScenario={...spec('revoke'),mode:'wait'}
                const revokeSeed=await seed(waitScenario)
                waitScenario.tool={name:'restart-execution',args:{executionId:revokeSeed.executionId}}
                active.revocation = await controls.revokeWait({page,base,account,scenario,seed,effects,revoke,mode,waitScenario})
                assert(active.revocation?.completed && active.revocation.denied && active.revocation.noBusinessSideEffects,'scope revocation wait must deny without business effects')
            }
            await options.captureRuntimeDiagnostics?.({mode})
            active.status='passed';await persist()
        }
        report.completed=true
    } catch(error) {
        report.failure={name:error.name,message:String(error.message)}
        if(active && error.report)active.browser=error.report
        if(active)active.status='failed'
    } finally {
        if(configured && active?.status==='failed') {
            try {await options.captureRuntimeDiagnostics?.({mode:active.mode})}
            catch {report.cleanup.push({resource:'runtime-diagnostics',captured:false});report.completed=false}
        }
        let restored=!configured
        if(configured) {
            try {
                for(const key of Object.keys(configuration))delete configuration[key]
                Object.assign(configuration,original);await saveConfiguration();await compose('up','-d','kestra')
                await controls.waitForHost({base,restored:true})
                restored=true
                report.cleanup.push({resource:'original-compose',restored:true})
            } catch {report.cleanup.push({resource:'original-compose',restored:false});report.completed=false}
        }
        if(transport) {
            try{await transport.close();report.cleanup.push({resource:'model-transport',closed:true})}
            catch{report.cleanup.push({resource:'model-transport',closed:false});report.completed=false}
        }
        for(const resource of resources) {
            if(!restored){report.cleanup.push({resource:'owned-ai-data',database:resource.database,retained:true,reason:'restore-failed'});continue}
            try {
                assert.equal(String(await command('docker',['inspect','-f','{{index .Config.Labels "owner"}}',postgres])).trim(),options.project)
                if(resource.volume) {
                    assert.equal(String(await command('docker',['volume','inspect','-f','{{index .Labels "owner"}}',resource.volume])).trim(),options.project)
                    await command('docker',['volume','rm',resource.volume])
                }
                // Only this invocation's freshly created, unshared database is removed. PostgreSQL stays running.
                await command('docker',['exec',postgres,'psql','-X','-U','kestra','-d','kestra','-v','ON_ERROR_STOP=1','-c','DROP DATABASE '+resource.database])
                report.cleanup.push({resource:'owned-ai-data',database:resource.database,removed:true})
            } catch {report.cleanup.push({resource:'owned-ai-data',database:resource.database,removed:false});report.completed=false}
        }
        try {assert.deepEqual(sourceSha256(),report.sourceSha256,'AI acceptance source changed while running')}
        catch(error){report.completed=false;report.failure??={name:error.name,message:String(error.message)}}
        await persist()
    }
    const result=sanitizeUiEvidence(report,secrets)
    if(!result.completed){const error=new Error('AI activated integration incomplete');error.report=result;throw error}
    return result
}
async function readExecution(client,id) {
    assert.match(id,/^[A-Za-z0-9_-]+$/)
    const response=await client.request(api+'/executions/'+id);assert.equal(response.status,200)
    const value=await response.json();return value
}
