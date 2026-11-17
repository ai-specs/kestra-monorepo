import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {sanitizeUiEvidence} from './access-control-v3-ui.mjs'
import {classifyAccessControlDiagnostics} from './access-control-browser-diagnostics.mjs'

export const aiBrowserCaseIds = Object.freeze(['ai-text', 'ai-stop', 'ai-owner', 'ai-tool-list', 'ai-confirm-reject', 'ai-confirm-approve', 'ai-confirm-duplicate','ai-confirm-scope-denied','ai-confirm-business-revoked'])
export const aiBrowserCaseIdsByMode = Object.freeze({
    A: Object.freeze(aiBrowserCaseIds.filter(id => !['ai-owner','ai-confirm-scope-denied','ai-confirm-business-revoked'].includes(id))),
    B: aiBrowserCaseIds,
})
const root = '[data-test="copilot-chat"]'
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)

export function classifyAiBrowserDiagnostics(diagnostics, requests, base,checks=[],restorations=[],logins=[]) {
    const errors = diagnostics.events.filter(event => ['page-error','console-error','http-error','request-failed','diagnostic-integrity-error'].includes(event.kind))
    const classified = [...classifyAccessControlDiagnostics({events:diagnostics.events.filter(event=>typeof event.documentUrl==='string'),base}).classifications]
    for(const denial of errors.filter(event=>event.kind==='http-error'&&event.status===403&&event.method==='POST'&&event.url===base+'/api/v1/main/dashboards/charts/preview'&&new URL(event.documentUrl).pathname==='/ui/main/dashboards')){
        const login=logins.find(login=>login.path==='/ui/main/dashboards'&&Date.parse(denial.observedAt)<=Date.parse(login.finishedAt)&&Date.parse(login.finishedAt)-Date.parse(denial.observedAt)<5000)
        const next=diagnostics.events.find(event=>event.kind==='document-navigation'&&new URL(event.url).pathname==='/ui/main/ai'&&Date.parse(event.observedAt)>=Date.parse(denial.observedAt)&&Date.parse(event.observedAt)-Date.parse(denial.observedAt)<5000)
        if(login&&next){classified.push({id:denial.id,reason:'explicit-ai-only-account-dashboard-query-denied',requestId:denial.requestId,documentId:denial.documentId,nextDocumentId:next.documentId});for(const event of errors.filter(event=>event.kind==='console-error'&&event.source==='network'&&event.requestId===denial.requestId&&event.documentId===denial.documentId&&event.message.startsWith('Failed to load resource: the server responded with a status of 403 ')))classified.push({id:event.id,reason:'network-console-for-ai-only-dashboard-denial',requestId:denial.requestId,documentId:denial.documentId})}
    }
    for(const event of errors.filter(event=>event.kind==='request-failed'&&event.url==='about:blank'&&event.documentUrl==='about:blank'&&event.resourceType==='Document'&&event.cancelled===true&&event.message==='net::ERR_ABORTED')) {
        const next=diagnostics.events.find(next=>next.kind==='document-navigation'&&next.documentId!==event.documentId&&next.url.startsWith(base+'/')&&Date.parse(next.observedAt)>=Date.parse(event.observedAt)&&Date.parse(next.observedAt)-Date.parse(event.observedAt)<1000)
        if(next)classified.push({id:event.id,reason:'caller-blank-document-replaced-by-production-login',documentId:event.documentId,nextDocumentId:next.documentId})
    }
    for(const restoration of restorations.filter(row=>row.cleared===true)) {
        const path=base+'/api/v1/main/ai/threads/'+restoration.threadId
        const requests=diagnostics.events.filter(event=>event.kind==='request'&&event.url===path&&event.method==='GET'&&Date.parse(event.observedAt)>=Date.parse(restoration.startedAt)&&Date.parse(event.observedAt)<=Date.parse(restoration.finishedAt))
        for(const request of requests) {
            const denial=errors.find(event=>event.kind==='http-error'&&event.status===404&&event.requestId===request.requestId&&event.documentId===request.documentId)
            if(!denial)continue
            classified.push({id:denial.id,reason:'native-stale-or-foreign-thread-restoration-cleared',requestId:request.requestId,documentId:request.documentId})
            for(const event of errors.filter(event=>event.kind==='console-error'&&event.source==='network'&&event.requestId===request.requestId&&event.documentId===request.documentId&&event.message.startsWith('Failed to load resource: the server responded with a status of 404 ')))classified.push({id:event.id,reason:'network-console-for-native-cleared-thread',requestId:request.requestId,documentId:request.documentId})
        }
    }
    for(const check of checks.filter(row=>row.status==='passed'&&['ai-stop','ai-confirm-reject'].includes(row.id))) {
        const path=base+'/api/v1/main/ai/threads/'+check.evidence.threadId+(check.id==='ai-stop'?'/chat':'/confirm')
        for(const event of errors.filter(event=>event.kind==='request-failed'&&event.url===path&&event.method==='POST'&&event.cancelled===true&&event.message==='net::ERR_ABORTED')) {
            const request=diagnostics.events.find(request=>request.kind==='request'&&request.requestId===event.requestId&&request.documentId===event.documentId&&request.url===path)
            const response=diagnostics.events.find(response=>response.kind==='http-response'&&response.requestId===event.requestId&&response.documentId===event.documentId&&response.status===200)
            if(request&&response)classified.push({id:event.id,reason:check.id==='ai-stop'?'native-stop-with-cancelled-message-and-model-disconnect':'native-rejected-confirmation-stream-closed',requestId:request.requestId,documentId:request.documentId,checkId:check.id})
        }
    }
    for (const expected of requests.filter(request => request.status >= 400 && request.expectedStatuses?.includes(request.status))) {
        const request = diagnostics.events.find(event => event.kind === 'request' && event.acceptanceRequestId === expected.acceptanceRequestId && event.url === base + expected.path && event.method === expected.method)
        if (!request) continue
        const response = errors.find(event => event.kind === 'http-error' && event.requestId === request.requestId && event.documentId === request.documentId && event.status === expected.status)
        if (!response) continue
        classified.push({id:response.id, reason:'explicit-ai-denial',requestId:request.requestId,documentId:request.documentId})
        for(const event of errors.filter(event=>event.kind==='request-failed'&&event.requestId===request.requestId&&event.documentId===request.documentId&&event.cancelled===true&&event.message==='net::ERR_ABORTED'))
            classified.push({id:event.id,reason:'explicit-denial-response-body-cancelled',requestId:request.requestId,documentId:request.documentId})
        for (const event of errors.filter(event => event.kind === 'console-error' && event.source === 'network' && event.requestId === request.requestId && event.documentId === request.documentId && event.message.startsWith('Failed to load resource: the server responded with a status of '+expected.status+' ')))
            classified.push({id:event.id,reason:'network-console-for-explicit-ai-denial',requestId:request.requestId,documentId:request.documentId})
    }
    const owner=checks.find(check=>check.id==='ai-owner'&&check.status==='passed'&&check.evidence.ownerReadBack===true)
    if(owner)for(const expected of requests.filter(request=>request.status===200&&request.method==='GET'&&request.path==='/api/v1/main/ai/threads/'+owner.evidence.threadId)){
        const request=diagnostics.events.find(event=>event.kind==='request'&&event.acceptanceRequestId===expected.acceptanceRequestId&&event.url===base+expected.path)
        const response=request&&diagnostics.events.find(event=>event.kind==='http-response'&&event.requestId===request.requestId&&event.documentId===request.documentId&&event.status===200)
        if(response)for(const event of errors.filter(event=>event.kind==='request-failed'&&event.requestId===request.requestId&&event.documentId===request.documentId&&event.cancelled===true&&event.message==='net::ERR_ABORTED'))classified.push({id:event.id,reason:'explicit-owner-status-read-body-cancelled-after-200',requestId:request.requestId,documentId:request.documentId})
    }
    return {classified,unclassified:errors.filter(event => !classified.some(row => row.id === event.id)).map(event=>event.id)}
}

/** Controls observe the owned deployment; they must not replace identity, model beans, tools or storage. */
export async function runApplicationProjectAiBrowser(page, base, account, scenarios, controls) {
    const applicable = aiBrowserCaseIdsByMode[controls?.mode] ?? aiBrowserCaseIds
    const report = {schemaVersion: 1, mode: controls?.mode ?? null, completed: false,
        applicableCaseIds: [...applicable],
        outOfScope: controls?.mode === 'A' ? [{id:'ai-owner',reason:'Mode A baseline has no independent account provisioning; owner isolation is required in mode B.'}] : [],
        checks: applicable.map(id => ({id, status: 'not_run', passed: false, evidence: {}})), logins: [], requests: [], dismissals: [],restorations:[]}
    const secrets = [account?.password, scenarios?.owner?.account?.password].filter(Boolean)
    const persist = async () => {
        assert.equal(typeof controls?.record, 'function', 'persistent report callback required')
        await controls.record(sanitizeUiEvidence(structuredClone(report), secrets))
    }
    let active
    let failure
    const requireControl = name => assert.equal(typeof controls?.[name], 'function', `AI control required: ${name}`)
    const wait = async (probe, message) => {
        const deadline = Date.now() + (controls.timeoutMs ?? 20000)
        while (true) {
            const value = await probe()
            if (value) return value
            assert(Date.now() < deadline, message)
            await new Promise(resolve => setTimeout(resolve, 100))
        }
    }
    const ui = async () => page.evaluate(() => ({path: location.pathname,
        text: [...document.querySelectorAll('[data-test="copilot-assistant-text"]')].map(node => node.textContent).join('\n'),
        stop: Boolean(document.querySelector('[data-test="copilot-stop"]')),
        errors: [...document.querySelectorAll('[data-test="copilot-error"]')].map(node => node.textContent)}))
    async function dismissInstall() {
        if (!await page.evaluate(() => Boolean(document.querySelector('.pwa-install-prompt')))) return
        const selector = '.pwa-install-prompt .pwa-install-actions button:last-child'
        assert(await page.evaluate(selector => {
            const button = document.querySelector(selector)
            return button?.tagName === 'BUTTON' && !button.disabled && button.getClientRects().length > 0
        }, selector), 'native install dismiss button unavailable')
        await page.click(selector)
        await page.waitForFunction(() => !document.querySelector('.pwa-install-prompt'))
        report.dismissals.push({kind:'native-pwa-install',action:'dismiss-button',path:(await ui()).path})
    }
    async function login(value) {
        assert(value?.username && value?.password, 'real login account required')
        const remembered=await page.evaluate(()=>location.protocol.startsWith('http')?localStorage.getItem('kestra.copilot.activeThread'):null)
        const startedAt=new Date().toISOString()
        await page.goto(base + '/ui/access-denied')
        await page.waitForFunction(() => Boolean(document.querySelector('input[name="username"]')) || Boolean(document.querySelector('[data-testid="return-to-login"]')))
        const initialPath = (await ui()).path
        assert(['/ui/access-denied','/oidc/login','/ui/login'].includes(initialPath), 'unexpected initial production login landing')
        if (!await page.evaluate(() => Boolean(document.querySelector('input[name="username"]')))) await page.click('[data-testid="return-to-login"]')
        await page.waitForFunction(() => Boolean(document.querySelector('input[name="password"]')))
        await page.fill('input[name="username"]', value.username)
        await page.fill('input[name="password"]', value.password)
        await page.click('button[type="submit"]')
        const allowed = value.loginPaths ?? ['/ui/access-denied','/ui/main/dashboards','/ui/main/ai','/ui/welcome','/ui/main/welcome']
        await page.waitForFunction(paths => !document.querySelector('input[name="password"]') && paths.includes(location.pathname),allowed)
        const landing = (await ui()).path
        assert(allowed.includes(landing), 'unexpected production OAuth callback landing')
        report.logins.push({subject: value.subject ?? value.username, initialPath, path: landing})
        await dismissInstall()
        await page.goto(base + '/ui/main/ai')
        await page.waitForFunction(() => location.pathname === '/ui/main/ai' && Boolean(document.querySelector('[data-test="copilot-chat"] textarea')))
        const restoring=await page.evaluate(()=>localStorage.getItem('kestra.copilot.activeThread'))??remembered
        if(restoring&&validId(restoring)) {
            await wait(async()=>{
                const events=(await page.diagnostics()).events
                return events.some(event=>['http-response','http-error'].includes(event.kind)&&event.url===base+'/api/v1/main/ai/threads/'+restoring&&[200,404].includes(event.status)&&Date.parse(event.observedAt)>=Date.parse(startedAt))
            },'native remembered thread restoration did not finish')
            await page.waitForFunction(uid=>localStorage.getItem('kestra.copilot.activeThread')!==uid||Boolean(document.querySelector('[data-test="copilot-assistant-text"]')),restoring)
            const current=await page.evaluate(()=>localStorage.getItem('kestra.copilot.activeThread'))
            report.restorations.push({threadId:restoring,startedAt,finishedAt:new Date().toISOString(),cleared:current===null})
        }
        await dismissInstall()
        report.logins.at(-1).finishedAt=new Date().toISOString()
        await persist()
    }
    async function sameCookie(path, body) {
        assert(path.startsWith('/api/v1/main/ai/threads/'), 'AI same-origin path required')
        const acceptanceRequestId = 'root-ui-' + randomBytes(12).toString('hex')
        const result = await page.evaluate(async ({path, body,acceptanceRequestId}) => {
            const csrf = document.querySelector('meta[name="csrf-token"]')?.content
            if (body !== undefined && !csrf) throw new Error('Browser CSRF metadata missing')
            const response = await fetch(path, {method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'manual',
                headers: {'X-Acceptance-Request-Id':acceptanceRequestId,...(body === undefined ? {} : {'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf})},
                ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(15000)})
            await response.body?.cancel()
            return {status: response.status}
        }, {path, body,acceptanceRequestId})
        report.requests.push({path, method: body === undefined ? 'GET' : 'POST', status: result.status,acceptanceRequestId,
            expectedStatuses:active.id==='ai-owner'?[200,404]:active.id==='ai-confirm-duplicate'?[404,409]:[200]})
        await persist(); return result
    }
    async function start(spec) {
        assert(spec && validId(spec.id) && typeof spec.prompt === 'string', 'named scenario and prompt required')
        assert(typeof spec.expectedText === 'string' && spec.expectedText.length, 'scenario expected text required')
        await dismissInstall()
        if (await page.evaluate(() => Boolean(document.querySelector('[data-test="copilot-new-chat"]')))) await page.click('[data-test="copilot-new-chat"]')
        await controls.scenario.prepare(spec)
        await page.fill(root + ' textarea', spec.prompt + ` [[ai-scenario:${spec.id}]]`)
        await page.click('[data-test="copilot-send"]')
        const thread = await wait(async () => {
            const observed = await controls.thread(page, spec)
            return observed?.uid ? observed : null
        }, 'new thread was not observed')
        assert.equal(thread.transport, 'browser-session', 'thread observation must share this browser session')
        assert(typeof thread.uid === 'string' && /^[A-Za-z0-9_-]+$/.test(thread.uid), 'actual thread ID required')
        return thread
    }
    async function idle(spec, thread) {
        return wait(async () => {
            const value = await controls.readThread(page, thread.uid)
            return value?.uid === thread.uid && value.status === 'IDLE' ? value : null
        }, 'thread did not return to IDLE')
    }
    async function done(spec, thread) {
        const state = await idle(spec, thread)
        const source = await wait(async () => { const value = await ui(); return !value.stop && value.text.includes(spec.expectedText) ? value : null }, 'assistant result not visible')
        assert.deepEqual(source.errors, [], 'AI UI error')
        const wire = await controls.scenario.read(spec.id)
        assert.equal(wire.phase, 'done'); assert(wire.requests > 0)
        assert((state.messages ?? []).some(message => message.type === 'TEXT' && message.role === 'ASSISTANT'), 'persisted assistant text required')
        return {threadId: thread.uid, status: state.status, scenario: {id: wire.id, phase: wire.phase, requests: wire.requests}, path: source.path}
    }
    async function confirm(spec, decision) {
        assert(spec?.expectedText, 'confirmation expected text required')
        const seeded = await controls.seed(spec)
        assert(seeded?.executionId && seeded.flowId, 'real stored execution and flow seed required')
        const before = await controls.effects.snapshot(seeded)
        const thread = await start(spec)
        await page.waitForFunction(() => Boolean(document.querySelector('[data-test="copilot-proposed-action"]')))
        const pending = await controls.readThread(page, thread.uid)
        let revocation
        if(spec.revokeBusiness){assert.equal(typeof controls.revokeBusiness,'function');revocation=await controls.revokeBusiness();assert.equal(revocation.businessRevoked,true);assert.equal(revocation.aiExecuteRetained,true);}
        assert.equal(pending.status, 'AWAITING_CONFIRMATION'); assert(pending.pendingConfirmationId)
        assert(['EDIT','PLAN'].includes(pending.mode), 'actual confirmation mode required')
        await dismissInstall()
        await page.click(decision === 'APPROVE' ? '[data-test="copilot-approve"]' : '[data-test="copilot-reject"]')
        let evidence
        if (decision === 'REJECT' && pending.mode === 'PLAN') {
            const finished = await idle(spec, thread)
            assert((finished.messages ?? []).some(message => message.type === 'TEXT' && message.role === 'ASSISTANT'
                && message.content === 'Action rejected; the plan has been aborted.'), 'PLAN rejection completion missing')
            evidence = {threadId:thread.uid,status:finished.status,rejection:'plan-aborted-without-model-roundtrip'}
        } else evidence = await done(spec, thread)
        const state = await controls.readThread(page, thread.uid)
        const results = (state.messages ?? []).filter(message => message.type === 'TOOL_RESULT')
        assert(results.some(message => message.toolResult?.outcome === (spec.expectedDenied?'error':decision === 'APPROVE' ? 'ok' : 'rejected')), 'actual tool result outcome missing')
        if (decision === 'REJECT' && pending.mode === 'EDIT') {
            assert.equal(typeof controls.scenario.verifyRejected, 'function', 'EDIT rejection requires raw rejected-text model request verification')
            const rejected = await controls.scenario.verifyRejected(spec.id)
            assert.equal(rejected?.verified, true, 'model did not receive REJECTED by user tool text')
            evidence.rejection = 'edit-rejected-text-model-roundtrip'
        }
        const observed = await controls.effects.observe({seeded, before, decision:spec.expectedDenied?'REJECT':decision, threadId: thread.uid})
        assert.equal(observed?.completed, true, 'bounded side effect observation required')
        assert.equal(observed.queueChecked, true); assert.equal(observed.storageChecked, true)
        if (decision === 'REJECT'||spec.expectedDenied) assert.equal(observed.unchanged, true, 'rejected operation changed business state')
        else assert.equal(observed.savedReadBack, true, 'approved operation not persisted/read back')
        return {...evidence, business: observed, confirmationId: pending.pendingConfirmationId, seeded,...(revocation?{revocation}:{}),expectedDenied:spec.expectedDenied===true}
    }
    try {
        active = report.checks[0]; active.status = 'running'; await persist()
        assert.equal(new URL(base).origin, base)
        assert(['A', 'B'].includes(controls.mode), 'explicit A/B mode required')
        assert.deepEqual(controls.caseIds, applicable, 'exact ordered A/B caseIds required; cases cannot be omitted, duplicated or expanded')
        for (const name of ['goto', 'waitForFunction', 'fill', 'click', 'evaluate', 'diagnostics']) assert.equal(typeof page?.[name], 'function', `page adapter missing ${name}`)
        for (const name of ['thread', 'readThread', 'seed']) requireControl(name)
        for (const name of ['prepare', 'read']) assert.equal(typeof controls.scenario?.[name], 'function', `scenario control missing ${name}`)
        for (const name of ['snapshot', 'observe','businessSnapshot','observeBusinessUnchanged']) assert.equal(typeof controls.effects?.[name], 'function', `effects control missing ${name}`)
        await login(account)
        for (let index = 0; index < report.checks.length; index++) {
            active = report.checks[index]; active.status = 'running'; await persist()
            if (active.id === 'ai-text') {
                assert(scenarios.text?.expectedText, 'text scenario expected text required')
                const thread = await start(scenarios.text)
                active.evidence = await done(scenarios.text, thread)
            } else if (active.id === 'ai-stop') {
                const before = await controls.effects.businessSnapshot()
                const spec = scenarios.cancel, thread = await start(spec)
                await wait(async () => (await controls.scenario.read(spec.id)).phase === 'waiting', 'model latch not waiting')
                await page.waitForFunction(() => Boolean(document.querySelector('[data-test="copilot-stop"]')))
                await page.click('[data-test="copilot-stop"]')
                const state = await idle(spec, thread)
                assert((state.messages ?? []).some(message => message.type === 'CANCELLED'), 'CANCELLED message missing')
                const wire = await wait(async () => { const value = await controls.scenario.read(spec.id); return value.disconnected > 0 ? value : null }, 'model did not observe disconnect')
                assert(!(state.messages ?? []).some(message=>message.type==='TOOL_CALL'),'cancelled wait dispatched tool')
                const business = await controls.effects.observeBusinessUnchanged(before)
                assert.equal(business.unchanged,true)
                active.evidence = {threadId: thread.uid, status: state.status, cancelledMessage: true, disconnected: wire.disconnected,business}
            } else if (active.id === 'ai-owner') {
                const spec = scenarios.owner
                assert(spec?.account && spec?.scenario?.expectedText, 'second actual account and owner scenario required')
                const own = await start(spec.scenario); await done(spec.scenario, own)
                await login(spec.account)
                assert.equal((await sameCookie('/api/v1/main/ai/threads/' + own.uid)).status, 404)
                await login(account)
                assert.equal((await sameCookie('/api/v1/main/ai/threads/' + own.uid)).status, 200)
                active.evidence = {threadId: own.uid, otherAccountDenied: true, ownerReadBack: true}
            } else if (active.id === 'ai-tool-list') {
                const spec = scenarios.list, thread = await start(spec)
                active.evidence = await done(spec, thread)
                const wire = await controls.scenario.read(spec.id)
                assert.equal(wire.functionResponses, 1, 'model service must verify actual tool result')
                active.evidence.functionResponses = wire.functionResponses
            } else if (active.id === 'ai-confirm-reject') active.evidence = await confirm(scenarios.reject, 'REJECT')
            else if (active.id === 'ai-confirm-approve') active.evidence = await confirm(scenarios.approve, 'APPROVE')
            else if (active.id === 'ai-confirm-scope-denied')active.evidence=await confirm(scenarios.scopeDenied,'APPROVE')
            else if (active.id === 'ai-confirm-business-revoked')active.evidence=await confirm(scenarios.businessRevoked,'APPROVE')
            else {
                const prior = report.checks.find(row => row.id === 'ai-confirm-approve').evidence
                assert(prior.confirmationId && prior.seeded, 'successful approve fixture required for duplicate')
                const before = await controls.effects.snapshot(prior.seeded)
                const duplicate = await sameCookie('/api/v1/main/ai/threads/' + prior.threadId + '/confirm',
                    {confirmationId: prior.confirmationId, decision: 'APPROVE', providerId: scenarios.approve.providerId ?? null})
                assert([404, 409].includes(duplicate.status), 'duplicate confirmation must be rejected')
                const observed = await controls.effects.observe({seeded: prior.seeded, before, decision: 'DUPLICATE', threadId: prior.threadId})
                assert(observed?.completed && observed.unchanged && observed.queueChecked && observed.storageChecked, 'duplicate must not repeat business writes')
                active.evidence = {status: duplicate.status, sameBrowserSession: true, actualUiClick: false, business: observed}
            }
            active.status = 'passed'; active.passed = true; await persist()
        }
        report.completed = true
    } catch (error) {
        failure = error
        if (!active) active = report.checks[0]
        active.status = 'failed'; active.passed = false
        active.evidence = {...active.evidence, error: String(error.message)}
    } finally {
        try {
            const diagnostics = await page.diagnostics()
            report.diagnostics = {events: diagnostics.events, documents: diagnostics.documents}
            Object.assign(report.diagnostics,classifyAiBrowserDiagnostics(diagnostics,report.requests,base,report.checks,report.restorations,report.logins))
            assert.equal(report.diagnostics.unclassified.length, 0, 'AI browser has unclassified diagnostic errors; inspect source document and request evidence')
        } catch (error) { report.diagnosticFailure = String(error.message); report.completed = false; failure ??= error }
        await persist()
    }
    const result = sanitizeUiEvidence(report, secrets)
    if (failure) {
        const error = new Error('AI browser acceptance failed; inspect retained report')
        error.report = result
        throw error
    }
    return result
}

Object.defineProperty(runApplicationProjectAiBrowser, 'supportsExplicitCaseIds', {value:true})
