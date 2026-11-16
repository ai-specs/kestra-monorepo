import test from 'node:test'
import assert from 'node:assert/strict'
import {runApplicationProjectAiBrowser, aiBrowserCaseIds, aiBrowserCaseIdsByMode} from '../application-project-ai-browser.mjs'

async function failedReport(f) {
    try { await runApplicationProjectAiBrowser(f.page,'http://localhost:8080',f.account,f.scenarios,f.controls) }
    catch(error) { assert(error.report); return error.report }
    assert.fail('Missing fixture or failed assertion must throw')
}

// This adapter double checks driver sequencing only; no browser, login, provider or database runs here.
function fixture(mode = 'B') {
    const recorded = [], clicks = [], prepared = new Map()
    const account = {username:'alice',subject:'alice',password:'private-alice-password'}
    const spec = id => ({id, prompt:'Controlled test', expectedText:'answer', providerId:'controlled-gemini'})
    const scenarios = {text:spec('text'),cancel:spec('cancel'),list:spec('list'),reject:spec('reject'),approve:spec('approve'),
        owner:{account:{username:'bob',subject:'bob',password:'private-bob-password'},scenario:spec('owner')}}
    let active, decision, currentUser, filled, path, stop = false
    const states = new Map()
    const page = {
        async goto(url) { path = new URL(url).pathname },
        async waitForFunction() {},
        async fill(selector, value) { if (selector.includes('username')) currentUser = value; else filled = value },
        async click(selector) {
            clicks.push(selector)
            if (selector === 'button[type="submit"]') path = '/ui/main/dashboards'
            if (selector.includes('copilot-send')) {
                active = [...prepared.values()].find(value => filled.includes(`[[ai-scenario:${value.id}]]`))
                assert(active); stop = active.id === 'cancel'
            }
            if (selector.includes('copilot-stop')) stop = false
            if (selector.includes('copilot-approve')) decision = 'ok'
            if (selector.includes('copilot-reject')) decision = 'rejected'
        },
        async evaluate(fn, arg) {
            const source = fn.toString()
            if (arg?.path) return {status: arg.body ? 404 : currentUser === 'bob' ? 404 : 200}
            if (source.includes('path: location.pathname')) return {path:path === '/ui/access-denied' ? '/oidc/login' : path === '/ui/main/ai' ? path : '/ui/main/dashboards',text:'answer',stop,errors:[]}
            if (source.includes('input[name="username"]')) return true
            return false
        },
        async diagnostics() { return {events:[],documents:[]} },
    }
    const controls = {mode,caseIds:[...aiBrowserCaseIdsByMode[mode]],timeoutMs:100,
        async record(report) { recorded.push(report) },
        scenario:{async prepare(s) { prepared.set(s.id,s); decision = undefined }, async verifyRejected() { return {verified:true} }, async read(id) {
            return {id, phase:id === 'cancel' ? stop ? 'waiting' : 'disconnected' : 'done',requests:1,functionResponses:1,disconnected:id === 'cancel' && !stop ? 1 : 0}
        }},
        async thread(page,s) { const value = {uid:s.id,transport:'browser-session'}; states.set(s.id,value); return value },
        async readThread(page,id) {
            return {uid:id,mode:'EDIT',status:['approve','reject'].includes(id) && !decision ? 'AWAITING_CONFIRMATION' : 'IDLE',pendingConfirmationId:'confirm-'+id,
                messages:[{type:'TEXT',role:'ASSISTANT'},...(id==='cancel'?[{type:'CANCELLED'}]:[]),...(decision?[{type:'TOOL_RESULT',toolResult:{outcome:decision}}]:[])]}
        },
        async seed() { return {executionId:'exec',flowId:'flow'} },
        effects:{async snapshot() { return {hash:'before'} },async observe({decision}) {
            return {completed:true,queueChecked:true,storageChecked:true,unchanged:decision!=='APPROVE',savedReadBack:decision==='APPROVE'}
        }},
    }
    return {account,scenarios,page,controls,recorded,clicks}
}

test('A and B share native actions within exact six/seven applicable case matrices', async () => {
    for (const mode of ['A','B']) {
        const f = fixture(mode)
        const report = await runApplicationProjectAiBrowser(f.page,'http://localhost:8080',f.account,f.scenarios,f.controls)
        assert.equal(report.completed,true,JSON.stringify(report))
        assert.deepEqual(report.checks.map(row=>row.id),aiBrowserCaseIdsByMode[mode])
        assert.equal(report.checks.length,mode==='A'?6:7)
        assert.deepEqual(report.applicableCaseIds,aiBrowserCaseIdsByMode[mode])
        assert.equal(report.outOfScope.length,mode==='A'?1:0)
        assert(report.checks.every(row=>row.status==='passed'))
        for (const action of ['copilot-send','copilot-stop','copilot-reject','copilot-approve']) assert(f.clicks.some(selector=>selector.includes(action)))
        assert.equal(report.checks.at(-1).evidence.actualUiClick,false)
        assert(!JSON.stringify(f.recorded).includes(f.account.password))
        assert(!JSON.stringify(f.recorded).includes(f.scenarios.owner.account.password))
    }
})

test('advertises explicit matrix capability and A never needs owner fixture', async () => {
    assert.equal(runApplicationProjectAiBrowser.supportsExplicitCaseIds,true)
    const f=fixture('A');delete f.scenarios.owner
    const report=await runApplicationProjectAiBrowser(f.page,'http://localhost:8080',f.account,f.scenarios,f.controls)
    assert.equal(report.completed,true)
    assert.deepEqual(report.outOfScope.map(row=>row.id),['ai-owner'])
    assert(!report.checks.some(row=>row.id==='ai-owner'||row.status==='skipped'))
})

test('rejects missing, reordered, duplicate, expanded or narrowed matrix before login', async () => {
    for(const [mode,ids] of [['A',aiBrowserCaseIds],['B',aiBrowserCaseIdsByMode.A],['A',undefined],
        ['B',[...aiBrowserCaseIds].reverse()],['B',[...aiBrowserCaseIds,'ai-owner']]]) {
        const f=fixture(mode);f.controls.caseIds=ids
        const report=await failedReport(f)
        assert.match(report.checks[0].evidence.error,/exact ordered A\/B caseIds/)
        assert.equal(report.logins.length,0)
        assert.equal(report.checks.filter(row=>row.status==='passed').length,0)
    }
})

test('missing required control fails and retains unrun cases rather than skipping', async () => {
    const f = fixture(); delete f.controls.seed
    const report = await failedReport(f)
    assert.equal(report.completed,false)
    assert.equal(report.checks[0].status,'failed')
    assert.match(report.checks[0].evidence.error,/seed/)
    assert.equal(report.checks.filter(row=>row.status==='not_run').length,6)
    assert(f.recorded.length >= 2)
})

test('missing owner fixture retains prior successes and blocks dependent remainder', async () => {
    const f = fixture(); delete f.scenarios.owner
    const report = await failedReport(f)
    assert.equal(report.completed,false)
    assert.deepEqual(report.checks.map(row=>row.status),['passed','passed','failed','not_run','not_run','not_run','not_run'])
})

test('reject side effects fail the case even when UI says rejected', async () => {
    const f = fixture()
    f.controls.effects.observe = async () => ({completed:true,queueChecked:true,storageChecked:true,unchanged:false,savedReadBack:true})
    const report = await failedReport(f)
    assert.equal(report.checks[4].status,'failed')
    assert.match(report.checks[4].evidence.error,/business state/)
    assert.equal(report.completed,false)
})

test('transport must verify actual function response and browser session observation', async () => {
    const f = fixture(); f.controls.thread = async () => ({uid:'foreign',transport:'other-client'})
    const report = await failedReport(f)
    assert.equal(report.checks[0].status,'failed')
    assert.match(report.checks[0].evidence.error,/browser session/)
})

test('PLAN rejection finishes from persisted abort message without a model completion roundtrip', async () => {
    const f = fixture(), read = f.controls.readThread
    f.controls.readThread = async (...args) => {
        const state = await read(...args)
        if (args[1] === 'reject') {
            state.mode = 'PLAN'
            if (state.status === 'IDLE') state.messages.push({type:'TEXT',role:'ASSISTANT',content:'Action rejected; the plan has been aborted.'})
        }
        return state
    }
    const original = f.controls.scenario.read
    f.controls.scenario.read = async id => {
        assert.notEqual(id,'reject','PLAN reject must not require final model completion')
        return original(id)
    }
    delete f.controls.scenario.verifyRejected
    const report = await runApplicationProjectAiBrowser(f.page,'http://localhost:8080',f.account,f.scenarios,f.controls)
    assert.equal(report.checks[4].evidence.rejection,'plan-aborted-without-model-roundtrip')
})

test('EDIT rejection requires explicit raw rejected text transport verification', async () => {
    const f = fixture(); delete f.controls.scenario.verifyRejected
    const report = await failedReport(f)
    assert.equal(report.checks[4].status,'failed')
    assert.match(report.checks[4].evidence.error,/raw rejected-text/)
})

test('native install prompt is dismissed by adapter button click and login landing is retained', async () => {
    const f = fixture(), evaluate = f.page.evaluate, click = f.page.click
    let visible = true
    f.page.evaluate = async (fn,arg) => {
        if (fn.toString().includes('Boolean(document.querySelector(\'.pwa-install-prompt\'))')) return visible
        if (arg === '.pwa-install-prompt .pwa-install-actions button:last-child') return true
        return evaluate(fn,arg)
    }
    f.page.click = async selector => {
        if (selector === '.pwa-install-prompt .pwa-install-actions button:last-child') visible = false
        return click(selector)
    }
    const report = await runApplicationProjectAiBrowser(f.page,'http://localhost:8080',f.account,f.scenarios,f.controls)
    assert.equal(report.dismissals.length,1)
    assert.equal(report.logins[0].initialPath,'/oidc/login')
    assert(f.clicks.includes('.pwa-install-prompt .pwa-install-actions button:last-child'))
})
