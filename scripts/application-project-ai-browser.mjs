import assert from 'node:assert/strict'
import {sanitizeUiEvidence} from './access-control-v3-ui.mjs'

export const aiBrowserCaseIds = Object.freeze(['ai-text', 'ai-stop', 'ai-owner', 'ai-tool-list', 'ai-confirm-reject', 'ai-confirm-approve', 'ai-confirm-duplicate'])
export const aiBrowserCaseIdsByMode = Object.freeze({
    A: Object.freeze(aiBrowserCaseIds.filter(id => id !== 'ai-owner')),
    B: aiBrowserCaseIds,
})
const root = '[data-test="copilot-chat"]'
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)

/** Controls observe the owned deployment; they must not replace identity, model beans, tools or storage. */
export async function runApplicationProjectAiBrowser(page, base, account, scenarios, controls) {
    const applicable = aiBrowserCaseIdsByMode[controls?.mode] ?? aiBrowserCaseIds
    const report = {schemaVersion: 1, mode: controls?.mode ?? null, completed: false,
        applicableCaseIds: [...applicable],
        outOfScope: controls?.mode === 'A' ? [{id:'ai-owner',reason:'Mode A baseline has no independent account provisioning; owner isolation is required in mode B.'}] : [],
        checks: applicable.map(id => ({id, status: 'not_run', passed: false, evidence: {}})), logins: [], requests: [], dismissals: []}
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
        await page.goto(base + '/ui/access-denied')
        await page.waitForFunction(() => Boolean(document.querySelector('input[name="username"]')) || Boolean(document.querySelector('[data-testid="return-to-login"]')))
        const initialPath = (await ui()).path
        assert(['/ui/access-denied','/oidc/login','/ui/login'].includes(initialPath), 'unexpected initial production login landing')
        if (!await page.evaluate(() => Boolean(document.querySelector('input[name="username"]')))) await page.click('[data-testid="return-to-login"]')
        await page.waitForFunction(() => Boolean(document.querySelector('input[name="password"]')))
        await page.fill('input[name="username"]', value.username)
        await page.fill('input[name="password"]', value.password)
        await page.click('button[type="submit"]')
        await page.waitForFunction(() => !document.querySelector('input[name="password"]') && location.pathname.startsWith('/ui/') && location.pathname !== '/ui/login')
        const landing = (await ui()).path
        const allowed = value.loginPaths ?? ['/ui/access-denied','/ui/main/dashboards','/ui/main/ai','/ui/welcome','/ui/main/welcome']
        assert(allowed.includes(landing), 'unexpected production OAuth callback landing')
        report.logins.push({subject: value.subject ?? value.username, initialPath, path: landing})
        await dismissInstall()
        await page.goto(base + '/ui/main/ai')
        await page.waitForFunction(() => location.pathname === '/ui/main/ai' && Boolean(document.querySelector('[data-test="copilot-chat"] textarea')))
        await dismissInstall()
        await persist()
    }
    async function sameCookie(path, body) {
        assert(path.startsWith('/api/v1/main/ai/threads/'), 'AI same-origin path required')
        const result = await page.evaluate(async ({path, body}) => {
            const csrf = document.querySelector('meta[name="csrf-token"]')?.content
            if (body !== undefined && !csrf) throw new Error('Browser CSRF metadata missing')
            const response = await fetch(path, {method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', redirect: 'manual',
                headers: body === undefined ? {} : {'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf},
                ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(15000)})
            await response.body?.cancel()
            return {status: response.status}
        }, {path, body})
        report.requests.push({path, method: body === undefined ? 'GET' : 'POST', status: result.status})
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
        assert(results.some(message => message.toolResult?.outcome === (decision === 'APPROVE' ? 'ok' : 'rejected')), 'actual tool result outcome missing')
        if (decision === 'REJECT' && pending.mode === 'EDIT') {
            assert.equal(typeof controls.scenario.verifyRejected, 'function', 'EDIT rejection requires raw rejected-text model request verification')
            const rejected = await controls.scenario.verifyRejected(spec.id)
            assert.equal(rejected?.verified, true, 'model did not receive REJECTED by user tool text')
            evidence.rejection = 'edit-rejected-text-model-roundtrip'
        }
        const observed = await controls.effects.observe({seeded, before, decision, threadId: thread.uid})
        assert.equal(observed?.completed, true, 'bounded side effect observation required')
        assert.equal(observed.queueChecked, true); assert.equal(observed.storageChecked, true)
        if (decision === 'REJECT') assert.equal(observed.unchanged, true, 'rejected operation changed business state')
        else assert.equal(observed.savedReadBack, true, 'approved operation not persisted/read back')
        return {...evidence, business: observed, confirmationId: pending.pendingConfirmationId, seeded}
    }
    try {
        active = report.checks[0]; active.status = 'running'; await persist()
        assert.equal(new URL(base).origin, base)
        assert(['A', 'B'].includes(controls.mode), 'explicit A/B mode required')
        assert.deepEqual(controls.caseIds, applicable, 'exact ordered A/B caseIds required; cases cannot be omitted, duplicated or expanded')
        for (const name of ['goto', 'waitForFunction', 'fill', 'click', 'evaluate', 'diagnostics']) assert.equal(typeof page?.[name], 'function', `page adapter missing ${name}`)
        for (const name of ['thread', 'readThread', 'seed']) requireControl(name)
        for (const name of ['prepare', 'read']) assert.equal(typeof controls.scenario?.[name], 'function', `scenario control missing ${name}`)
        for (const name of ['snapshot', 'observe']) assert.equal(typeof controls.effects?.[name], 'function', `effects control missing ${name}`)
        await login(account)
        for (let index = 0; index < report.checks.length; index++) {
            active = report.checks[index]; active.status = 'running'; await persist()
            if (active.id === 'ai-text') {
                assert(scenarios.text?.expectedText, 'text scenario expected text required')
                const thread = await start(scenarios.text)
                active.evidence = await done(scenarios.text, thread)
            } else if (active.id === 'ai-stop') {
                const spec = scenarios.cancel, thread = await start(spec)
                await wait(async () => (await controls.scenario.read(spec.id)).phase === 'waiting', 'model latch not waiting')
                await page.waitForFunction(() => Boolean(document.querySelector('[data-test="copilot-stop"]')))
                await page.click('[data-test="copilot-stop"]')
                const state = await idle(spec, thread)
                assert((state.messages ?? []).some(message => message.type === 'CANCELLED'), 'CANCELLED message missing')
                const wire = await wait(async () => { const value = await controls.scenario.read(spec.id); return value.disconnected > 0 ? value : null }, 'model did not observe disconnect')
                active.evidence = {threadId: thread.uid, status: state.status, cancelledMessage: true, disconnected: wire.disconnected}
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
