import assert from 'node:assert/strict'
import {createHash, randomBytes} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {ApplicationGroupManagement, applicationProjectFeature} from './application-project-fixture.mjs'
import {ProjectSideEffects} from './application-project-effects.mjs'
import {runApplicationProjectAiBrowser} from './application-project-ai-browser.mjs'
import {startModelTransport} from './ai-model-transport.mjs'
import {sanitizeUiEvidence} from './access-control-v3-ui.mjs'

const api = '/api/v1/main'
const digest = value => createHash('sha256').update(value).digest('hex')
const namespace = 'company.a'
const password = () => randomBytes(24).toString('base64url') + 'Aa1!'
export const aiRuntimeCaseIds = Object.freeze({
    A:Object.freeze(['ai-text','ai-stop','ai-tool-list','ai-confirm-reject','ai-confirm-approve','ai-confirm-duplicate']),
    B:Object.freeze(['ai-text','ai-stop','ai-owner','ai-tool-list','ai-confirm-reject','ai-confirm-approve','ai-confirm-duplicate']),
})
export function assertAiRuntimeControls(controls, browserDriver) {
    for(const name of ['waitForHost','assertRuntime','thread','readThread','captureEffects','observeEffects','revokeWait'])
        assert.equal(typeof controls?.[name],'function','not implemented: owned '+name+' control')
    assert.equal(browserDriver?.supportsExplicitCaseIds,true,'not implemented: browser driver explicit A/B applicability; A must not execute owner isolation')
}
export function aiRuntimeGrants() {
    const tenant = (resource, actions) => ({scope:'TENANT',tenant:'main',namespace:null,descendants:false,resource,actions,ids:[],allIds:true})
    const ns = (resource, actions) => ({scope:'NAMESPACE',tenant:'main',namespace:namespace,descendants:false,resource,actions,ids:[],allIds:true})
    return [tenant('AI',['READ','EXECUTE']),tenant('METADATA',['READ','LIST']),
        ns('FLOW',['READ','LIST','EXECUTE']),ns('EXECUTION',['READ','LIST','UPDATE','CREATE']),ns('LOG',['READ','LIST'])]
}

export function configureAiRuntime(originalHost, {mode, database, modelBase, storage, formalJar, admin}) {
    assert(['A','B'].includes(mode)); assert(/^application_group_acceptance_[0-9]+_[0-9]+$/.test(database))
    assert(admin?.username && admin?.password && typeof formalJar === 'string')
    assert(/^ai-[ab]-[a-f0-9]+$/.test(storage)); assert.equal(new URL(modelBase).protocol,'http:')
    const host = structuredClone(originalHost)
    let configuration = applicationProjectFeature(host.environment.KESTRA_CONFIGURATION, mode === 'B')
    assert(!/^  ai:/m.test(configuration),'AI stage requires explicit provider-free source configuration')
    assert(/^kestra:\s*$/m.test(configuration),'Kestra configuration root missing')
    configuration = configuration.replace(/^kestra:\s*$/m, 'kestra:\n  ai:\n    enabled: true\n    providers:\n      - id: controlled-gemini\n        type: gemini\n        is-default: true\n        configuration:\n          base-url: ' + JSON.stringify(modelBase) + '\n          api-key: local-test-key\n          model-name: gemini-2.5-flash\n          thinking-enabled: false\n          log-requests: false\n          log-responses: false\n          timeout: PT60S\n    agent:\n      docs-mcp-url: ' + JSON.stringify(modelBase + "/docs-disabled") + '\n      model-call-timeout: PT60S')
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
    const {configuration, compose, saveConfiguration, command, base, inputs, formalJar, planned, page, record, controls} = options
    const report = {schemaVersion:1,stage:'ai-activated',completed:false,modes:[],cleanup:[],failure:null,
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
                active.scope = scope
                const permission=await management.request(management.permissionsPath(group)+'/ai-'+suffix)
                assert.deepEqual(permission.grants,aiRuntimeGrants(),'persisted AI grants differ')
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
                const flowId = 'ai-'+suffix+'-'+spec.id
                const source = `id: ${flowId}\nnamespace: company.a\ntasks:\n  - id: failed\n    type: io.kestra.plugin.core.execution.Fail\n`
                const saved = await adminClient.request(api+'/flows',{method:'POST',headers:{'Content-Type':'application/x-yaml'},body:source})
                assert(saved.ok,'real seed flow write failed'); await saved.body?.cancel()
                const execute = await adminClient.request(api+'/executions/company.a/'+flowId,{method:'POST',body:new FormData()})
                assert(execute.ok,'real failed execution creation failed')
                const execution = await execute.json(); assert(execution.id)
                const deadline = Date.now()+60000
                for (;;) {
                    const response = await adminClient.request(api+'/executions/'+execution.id); assert(response.ok)
                    const stored = await response.json()
                    if(stored.state?.current==='FAILED')break
                    assert(Date.now()<deadline,'failed execution seed deadline exceeded'); await new Promise(resolve=>setTimeout(resolve,200))
                }
                const result = {flowId,executionId:execution.id,namespace}; seedByScenario.set(spec.id,result); return result
            }
            // A/B/outside sentinels are present before model list execution.
            for (const ns of ['company.a','company.b','outside']) {
                const response = await adminClient.request(api+'/flows',{method:'POST',headers:{'Content-Type':'application/x-yaml'},body:`id: ai-list-${suffix}\nnamespace: ${ns}\ntasks: []\n`})
                assert(response.ok,'list sentinel create failed'); await response.body?.cancel()
            }
            const spec = name => ({id:mode.toLowerCase()+'-'+suffix+'-'+name,prompt:'Perform the controlled '+name+' operation',expectedText:'Controlled operation complete.',providerId:'controlled-gemini'})
            const scenarios = {text:spec('text'),cancel:spec('cancel'),list:spec('list'),reject:spec('reject'),approve:spec('approve'),
                ...(mode==='B'?{owner:{account:other,scenario:spec('owner')}}:{})}
            const scenario = {
                async prepare(value) {
                    let definition = {id:value.id,mode:'text',text:value.expectedText}
                    if(value.id===scenarios.cancel.id || value.mode==='wait')definition.mode='wait'
                    if(value.id===scenarios.list.id)definition={...definition,mode:'tool',tool:{name:'list-flows',args:{},expect:{namespaces:mode==='B'?['company.a']:['company.a','company.b','outside'],minItems:1}}}
                    if(seedByScenario.has(value.id)) {
                        const seeded = seedByScenario.get(value.id)
                        definition={...definition,mode:value.mode==='wait'?'wait':'tool',tool:{name:'restart-execution',args:{executionId:seeded.executionId},
                            expect:value.id===scenarios.reject.id?{rejectedText:true}:{exact:{executionId:seeded.executionId}}}}
                    }
                    await scenarioRequest('/scenarios',definition)
                },
                read:id=>scenarioRequest('/scenarios/'+id,undefined,'GET'),
                async release(id,{allowDisconnected=false}={}) {
                    const state=await scenarioRequest('/scenarios/'+id,undefined,'GET')
                    if(allowDisconnected&&state.disconnected>0)return {disconnected:true}
                    return scenarioRequest('/scenarios/'+id+'/release',{})
                },
                async verifyRejected(id) {
                    assert.equal(id,scenarios.reject.id,'only the declared rejection scenario can verify rejected text')
                    const state=await scenarioRequest('/scenarios/'+id,undefined,'GET')
                    assert.equal(state.phase,'done','rejected-text model scenario did not complete')
                    assert.equal(state.functionResponses,1,'transport must verify exactly one rejected-text function response')
                    return {verified:true,source:'gemini-http-transport-rejected-text',phase:state.phase,functionResponses:state.functionResponses}
                },
            }
            const browserControls = {mode,scenario,seed,caseIds:[...aiRuntimeCaseIds[mode]],
                record:async value=>{active.browser=value;await persist()},
                thread:(adapter,value)=>controls.thread(adapter,value,{base,mode}),
                readThread:(adapter,id)=>controls.readThread(adapter,id,{base,mode}),
                effects:{snapshot:seeded=>controls.captureEffects(seeded,effects),
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
                    const grants=permission.grants.map(grant=>grant.resource==='AI'?{...grant,actions:['READ']}:grant)
                    await management.request(path,'PUT',Object.fromEntries(['key','name','description','scopeKeys','enabled','managementGrants'].map(key=>[key,permission[key]]).concat([['grants',grants]])),permission.revision)
                }
                const waitScenario={...spec('revoke'),mode:'wait'}
                const revokeSeed=await seed(waitScenario)
                waitScenario.tool={name:'restart-execution',args:{executionId:revokeSeed.executionId}}
                active.revocation = await controls.revokeWait({page,base,account,scenario,seed,effects,revoke,mode,waitScenario})
                assert(active.revocation?.completed && active.revocation.denied && active.revocation.noBusinessSideEffects,'scope revocation wait must deny without business effects')
            }
            active.status='passed';await persist()
        }
        report.completed=true
    } catch(error) {
        report.failure={name:error.name,message:String(error.message)}
        if(active && error.report)active.browser=error.report
        if(active)active.status='failed'
    } finally {
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
