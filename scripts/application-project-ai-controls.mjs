import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {randomBytes} from 'node:crypto'
import {ProjectSideEffects} from './application-project-effects.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
export function validateAiThread(detail, uid, marker) {
    assert(detail && detail.uid === uid && ['IDLE','RUNNING','AWAITING_CONFIRMATION'].includes(detail.status), 'actual thread identity/state mismatch')
    assert(Array.isArray(detail.messages), 'thread messages required')
    if (marker) assert(detail.messages.some(message => message.role === 'USER' && message.type === 'TEXT'
        && typeof message.content === 'string' && message.content.includes(`[[ai-scenario:${marker}]]`)), 'active thread does not contain scenario prompt')
    return detail
}
export function validateAiRuntimeInspection(actual, expected) {
    assert.equal(actual.Config?.Image, expected.image, 'runtime image differs')
    for (const key of ['owner','com.docker.compose.project']) assert.equal(actual.Config?.Labels?.[key], expected.project, 'runtime owner differs')
    const bindings = actual.NetworkSettings?.Ports?.['8080/tcp'] ?? []
    assert(bindings.some(binding => binding.HostIp === '127.0.0.1' && binding.HostPort === String(new URL(expected.base).port || '80')), 'owned loopback port differs')
    const mounts = actual.Mounts ?? []
    const storage = mounts.filter(mount => mount.Destination === '/app/storage')
    assert.equal(storage.length, 1); assert.equal(storage[0].Type,'volume'); assert(storage[0].Name)
    if (expected.mode === 'A') assert(!mounts.some(mount => mount.Destination.startsWith('/app/libs')), 'A must not mount application libraries')
    else {
        const jars = mounts.filter(mount => mount.Destination === '/app/libs/kestra-rbac-authorizer.jar')
        assert.equal(jars.length,1); assert.equal(jars[0].RW,false, 'formal plugin must be read-only')
    }
    const values = actual.Config.Env.filter(value => value.startsWith('KESTRA_CONFIGURATION='))
    assert.equal(values.length,1)
    assert.equal(values[0].slice('KESTRA_CONFIGURATION='.length),expected.configuration, 'actual configuration differs')
    return storage[0].Name
}
export function validateAiExecutionChange(before, after, decision) {
    assert(before && after && before.id === after.id && before.namespace === after.namespace && before.flowId === after.flowId, 'saved execution identity changed')
    if (decision === 'APPROVE') {
        const prior = before.metadata?.attemptNumber, next = after.metadata?.attemptNumber
        assert(Number.isSafeInteger(prior) && Number.isSafeInteger(next) && next === prior + 1, 'restart must increment saved attempt exactly once')
        assert(['SUCCESS','FAILED','KILLED','CANCELLED'].includes(after.state?.current), 'restart has not reached terminal stored state')
    } else assert.deepEqual(after,before,'denied/repeated operation changed saved execution')
}

export async function captureEffects(seeded, effects, readExecution) {
    assert(id(seeded?.executionId), 'seeded execution ID required')
    assert.equal(typeof readExecution, 'function', 'SQL execution reader required')
    assert.equal(typeof effects?.snapshot, 'function', 'business snapshot observer required')
    const execution = await readExecution(seeded.executionId)
    assert.equal(execution?.id, seeded.executionId, 'SQL execution identity differs')
    assert(typeof execution.namespace === 'string' && execution.namespace.length > 0 && typeof execution.flowId === 'string' && execution.flowId.length > 0, 'SQL execution namespace/flow missing')
    assert(Number.isSafeInteger(execution.metadata?.attemptNumber) && execution.metadata.attemptNumber >= 1, 'SQL execution metadata.attemptNumber required')
    const business = await effects.snapshot()
    assert(typeof business?.hash === 'string' && business.hash.length > 0, 'business snapshot hash required')
    return structuredClone({execution, business})
}

export function createAiControls({base,project,command,configuration,record,timeoutMs=60000}) {
    assert.equal(new URL(base).origin,base)
    assert.match(project,/^application-projects-bb-[0-9]+-[0-9]+$/)
    assert.equal(typeof command,'function');assert.equal(typeof record,'function')
    assert(Number.isInteger(timeoutMs) && timeoutMs >= 5000 && timeoutMs <= 180000)
    let runtime
    const emit = async value => record(value)
    const run = async args => String(await command('docker',args)).trim()
    const inspect = async container => {
        assert.match(container,/^[a-f0-9]{12,64}$/)
        const values=JSON.parse(await run(['inspect',container]));assert.equal(values.length,1)
        for (const key of ['owner','com.docker.compose.project']) assert.equal(values[0].Config?.Labels?.[key],project)
        return values[0]
    }
    const until = async (probe,message) => {
        const deadline=Date.now()+timeoutMs
        while(Date.now()<deadline) {const value=await probe();if(value)return value;await delay(200)}
        throw new Error(message)
    }
    const browserGet = async (page,uid) => {
        assert(id(uid));assert.equal(typeof page?.evaluate,'function')
        return page.evaluate(async ({base,uid}) => {
            if(location.origin !== base) throw new Error('Browser origin differs')
            const response=await fetch('/api/v1/main/ai/threads/'+encodeURIComponent(uid),{credentials:'same-origin',redirect:'manual',signal:AbortSignal.timeout(10000)})
            return {status:response.status,detail:response.status===200?await response.json():null}
        },{base,uid})
    }
    const sql = async query => {
        assert(runtime,'verified runtime required')
        await inspect(runtime.postgres)
        return run(['exec',runtime.postgres,'psql','-X','-q','-A','-t','-U','kestra','-d',runtime.database,'-v','ON_ERROR_STOP=1','-c',query])
    }
    const savedExecution = async uid => {
        assert(id(uid))
        const text=await sql("SELECT value::text FROM executions WHERE value->>'id'='"+uid+"' AND (tenant_id='main' OR tenant_id IS NULL)")
        assert(text,'actual persisted execution missing');return JSON.parse(text)
    }
    const controls = {
        async captureEffects(seeded, effects) {
            assert(runtime, 'verified runtime required')
            const observer = effects ?? new ProjectSideEffects({postgresContainer:runtime.postgres,kestraContainer:runtime.kestra,composeProject:project,database:runtime.database,namespacePrefix:'company.'})
            return captureEffects(seeded, observer, savedExecution)
        },
        async waitForHost(options={}) {
            assert(!options.base || options.base===base)
            await until(async()=>{
                try {const response=await fetch(base+'/ping',{signal:AbortSignal.timeout(3000)});await response.body?.cancel();return response.ok}
                catch{return false}
            },'host readiness deadline exceeded')
            await emit({kind:'ai-host-ready',restored:options.restored===true})
        },
        async assertRuntime(expected) {
            assert.equal(expected.base,base);assert(['A','B'].includes(expected.mode))
            assert.match(expected.database,/^application_group_acceptance_[0-9]+_[0-9]+$/)
            const actual=await inspect(expected.kestra);await inspect(expected.postgres)
            const config=configuration.services.kestra.environment.KESTRA_CONFIGURATION
            const storageVolume=validateAiRuntimeInspection(actual,{...expected,project,configuration:config})
            assert(config.includes('jdbc:postgresql://postgres:5432/'+expected.database))
            runtime={...expected}
            const database=await sql('SELECT current_database()');assert.equal(database,expected.database)
            if(expected.mode==='A') {
                assert.equal(expected.jarAbsent,true)
                const absent=await run(['exec',expected.kestra,'sh','-c','if test -e /app/libs/kestra-rbac-authorizer.jar; then printf present; else printf absent; fi'])
                assert.equal(absent,'absent','A plugin file exists')
            } else {
                assert.match(expected.jarSha256,/^[a-f0-9]{64}$/)
                const actualHash=(await run(['exec',expected.kestra,'sha256sum','/app/libs/kestra-rbac-authorizer.jar'])).split(/\s+/)[0]
                assert.equal(actualHash,expected.jarSha256)
            }
            const evidence={kind:'ai-runtime-verified',mode:expected.mode,image:expected.image,database,storageVolume,configurationSha256:hash(config),jarAbsent:expected.mode==='A',...(expected.mode==='B'?{jarSha256:expected.jarSha256}:{})}
            await emit(evidence);return {...evidence,verified:true}
        },
        async thread(page,spec) {
            assert(spec?.id)
            const uid=await page.evaluate(()=>localStorage.getItem('kestra.copilot.activeThread'))
            if(!uid)return null
            assert(id(uid),'invalid actual localStorage thread ID')
            const response=await browserGet(page,uid)
            if(response.status!==200)return null
            if(!(response.detail.messages??[]).some(message=>message.role==='USER'&&message.type==='TEXT'&&message.content?.includes(`[[ai-scenario:${spec.id}]]`)))return null
            validateAiThread(response.detail,uid,spec.id)
            return {uid,transport:'browser-session'}
        },
        async readThread(page,uid) {
            const response=await browserGet(page,uid)
            assert.equal(response.status,200,'same-browser thread read denied')
            return validateAiThread(response.detail,uid)
        },
        async observeEffects({seeded,before,decision,effects}) {
            assert(id(seeded?.executionId));assert(['APPROVE','REJECT','DUPLICATE'].includes(decision))
            assert(before?.business?.hash && before?.execution,'pre-operation snapshot required')
            const observer=effects ?? new ProjectSideEffects({postgresContainer:runtime.postgres,kestraContainer:runtime.kestra,composeProject:project,database:runtime.database,namespacePrefix:'company.'})
            assert.equal(typeof observer.snapshot,'function')
            const fullBefore=before.execution
            let saved
            if(decision==='APPROVE') {
                saved=await until(async()=>{
                    const value=await savedExecution(seeded.executionId)
                    if(!Number.isSafeInteger(fullBefore.metadata?.attemptNumber)) throw new Error('pre-operation snapshot lacks metadata.attemptNumber; provide full saved execution')
                    if(value.metadata?.attemptNumber===fullBefore.metadata.attemptNumber+1 && ['SUCCESS','FAILED','KILLED','CANCELLED'].includes(value.state?.current))return value
                    return null
                },'saved restart attempt did not finish')
                validateAiExecutionChange(fullBefore,saved,decision)
            }
            const samples=[],start=Date.now();let stableSince=Date.now(),previous
            while(Date.now()-stableSince<5000) {
                assert(Date.now()-start<timeoutMs,'business side effects never stabilized')
                saved=await savedExecution(seeded.executionId)
                const snapshot=observer.snapshot()
                if(decision!=='APPROVE') {
                    assert.equal(snapshot.hash,before.business.hash,'denied/repeated business/queue/storage changed')
                    validateAiExecutionChange(fullBefore,saved,decision)
                } else validateAiExecutionChange(fullBefore,saved,decision)
                if(previous && previous!==snapshot.hash)stableSince=Date.now()
                previous=snapshot.hash;samples.push({elapsedMs:Date.now()-start,hash:snapshot.hash})
                await delay(200)
            }
            const evidence={completed:true,queueChecked:true,storageChecked:true,unchanged:decision!=='APPROVE',savedReadBack:decision==='APPROVE',executionId:seeded.executionId,executionSha256:hash(JSON.stringify(saved)),observedMs:Date.now()-start,samples}
            await emit({kind:'ai-effects-observed',decision,...evidence});return evidence
        },
        async verifyRejectedTransport({id:scenarioId,controlBase}) {
            assert(/^[A-Za-z0-9_-]{1,64}$/.test(scenarioId))
            const url=new URL(controlBase);assert(['127.0.0.1','localhost'].includes(url.hostname),'owned loopback transport required')
            const response=await fetch(new URL('/scenarios/'+scenarioId,url),{signal:AbortSignal.timeout(5000)})
            assert.equal(response.status,200);const state=await response.json()
            assert.equal(state.id,scenarioId);assert.equal(state.phase,'done');assert.equal(state.functionResponses,1)
            assert(state.events?.includes('function_response_verified'),'transport verification event missing')
            return {verified:true,phase:state.phase,functionResponses:state.functionResponses}
        },
        async revokeWait(args) {
            const {page,account,scenario,revoke,effects,waitScenario}=args
            assert.equal(args.mode,'B');assert.equal(args.base,base)
            assert.equal(typeof revoke,'function');assert.equal(typeof effects?.snapshot,'function')
            assert(waitScenario?.id && waitScenario.mode==='wait','runtime must supply a dedicated wait scenario, not reuse an already completed scenario')
            assert.equal(typeof scenario?.release,'function','owned transport release needed for late tool/connection test')
            assert.equal(typeof scenario?.read,'function');assert.equal(typeof scenario?.prepare,'function')
            assert.equal(waitScenario.tool?.name,'restart-execution','wait scenario must release a real restart tool call')
            const executionId=waitScenario.tool.args?.executionId
            assert(id(executionId),'wait restart execution ID required')
            assert(account?.subject)
            const seed='ai-revoke-'+randomBytes(5).toString('hex')
            assert(waitScenario.id.startsWith('b-'),'mode B wait scenario ID required')
            await scenario.prepare(waitScenario)
            if(await page.evaluate(()=>Boolean(document.querySelector('[data-test="copilot-new-chat"]'))))await page.click('[data-test="copilot-new-chat"]')
            const before=await controls.captureEffects({executionId},effects)
            await page.fill('[data-test="copilot-chat"] textarea',`Wait until released ${seed} [[ai-scenario:${waitScenario.id}]]`)
            await page.click('[data-test="copilot-send"]')
            const thread=await until(()=>controls.thread(page,waitScenario),'revocation thread not observed')
            await until(async()=>{const state=await scenario.read(waitScenario.id);return state.phase==='waiting'&&state.events?.includes('first_frame_sent')},'model first frame not waiting')
            await page.waitForFunction(()=>Boolean(document.querySelector('[data-test="copilot-assistant-text"]'))&&Boolean(document.querySelector('[data-test="copilot-stop"]')))
            await revoke()
            const wire=await until(async()=>{const state=await scenario.read(waitScenario.id);return state.disconnected>0?state:null},'revoked model connection not closed')
            const state=await until(async()=>{const value=await controls.readThread(page,thread.uid);return value.status==='IDLE'?value:null},'revoked thread not IDLE with retained AI.READ')
            const forbidden=await page.evaluate(async ({base,uid})=>{
                if(location.origin!==base)throw new Error('Browser origin differs')
                const csrf=document.querySelector('meta[name="csrf-token"]')?.content
                if(!csrf)throw new Error('Browser CSRF metadata missing')
                const response=await fetch('/api/v1/main/ai/threads/'+encodeURIComponent(uid)+'/chat',{
                    method:'POST',credentials:'same-origin',redirect:'manual',signal:AbortSignal.timeout(10000),
                    headers:{'Content-Type':'application/json','X-CSRF-TOKEN':csrf},body:JSON.stringify({prompt:'revoked AI.EXECUTE probe'})})
                await response.body?.cancel();return {status:response.status}
            },{base,uid:thread.uid})
            assert.equal(forbidden.status,403,'chat must reject removed AI.EXECUTE')
            assert(Array.isArray(state.messages));assert(!state.messages.some(message=>message.type==='TOOL_CALL'),'revoked wait dispatched tool')
            assert.equal(wire.functionResponses,0)
            await effects.observeDenied(async()=>{
                let timer
                try {return await Promise.race([scenario.release(waitScenario.id,{allowDisconnected:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('late release deadline exceeded')),5000)})])}
                finally {clearTimeout(timer)}
            },result=>{
                assert(result?.disconnected===true || result?.status===409,'late release must observe closed model connection')
            },{windowMs:5000})
            await controls.observeEffects({seeded:{executionId},before,decision:'REJECT',effects})
            const finalState=await controls.readThread(page,thread.uid)
            assert.equal(finalState.status,'IDLE');assert(!finalState.messages.some(message=>message.type==='TOOL_CALL'),'late tool dispatched after revocation')
            const finalWire=await scenario.read(waitScenario.id);assert.equal(finalWire.functionResponses,0)
            const result={completed:true,denied:true,readRetained:true,chatStatus:forbidden.status,noBusinessSideEffects:true,threadId:thread.uid,status:finalState.status,disconnected:wire.disconnected}
            await emit({kind:'ai-revocation-observed',...result});return result
        },
    }
    return controls
}
