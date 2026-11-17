import test from 'node:test';
import assert from 'node:assert/strict';
import { startModelTransport } from '../ai-model-transport.mjs';

async function fixture(t, options = {}) {
    const logs = [];
    const service = await startModelTransport({ port: 0, log: entry => logs.push(entry), ...options });
    t.after(() => service.close());
    const base = `http://127.0.0.1:${service.address.port}`;
    async function request(path, body, method = 'POST', headers = {}) {
        return fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    }
    async function create(config) {
        const response = await request('/scenarios', config);
        assert.equal(response.status, 201); return response.json();
    }
    const state = id => request(`/scenarios/${id}`, undefined, 'GET').then(response => response.json());
    return { base, request, create, state, logs };
}
function model(id, responses = [], tool = 'list-flows') {
    return { contents: [{ role: 'user', parts: [{ text: `Explain [[ai-scenario:${id}]]` }] },
        ...responses.map(functionResponse => ({ role: 'user', parts: [{ functionResponse }] }))],
    tools: [{ functionDeclarations: [{ name: tool, parameters: { type: 'object' } }] }] };
}
const endpoint = '/models/gemini-2.5-flash:streamGenerateContent?alt=sse';
const toolConfig = id => ({ id, mode: 'tool', text: 'verified', tool: { name: 'list-flows', args: {},
    expect: { namespaces: ['company.a'], forbiddenNamespaces: ['company.b'], minItems: 1 } } });
function response(id, result) {
    return { id: `call-${id}`, name: 'list-flows', response: { response: JSON.stringify(result) } };
}
async function eventually(check) {
    const deadline = Date.now() + 2000;
    while (!await check()) {
        if (Date.now() > deadline) assert.fail('Condition deadline exceeded');
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}

test('verifies the real raw EDIT rejection result without accepting arbitrary tool output', async t => {
    const f = await fixture(t);
    await f.create({id:'rejected',mode:'tool',text:'Rejected without executing.',tool:{name:'list-flows',args:{},expect:{rejectedText:true}}});
    await (await f.request(endpoint, model('rejected'))).text();
    assert.equal((await f.request(endpoint, model('rejected',[response('rejected',{outcome:'ok'})]))).status,422);
    const raw={id:'call-rejected',name:'list-flows',response:{response:'REJECTED by user.'}};
    const result=await f.request(endpoint,model('rejected',[raw]));
    assert.equal(result.status,200);
    assert.match(await result.text(),/Rejected without executing/);
    assert.equal((await f.state('rejected')).functionResponses,1);
});

test('text scenario emits Gemini SSE and EOF without DONE sentinel', async t => {
    const f = await fixture(t);
    await f.create({ id: 'text', mode: 'text', text: 'hello' });
    const result = await f.request(endpoint, model('text'));
    assert.equal(result.status, 200);
    assert.match(result.headers.get('content-type'), /text\/event-stream/);
    const body = await result.text();
    assert.ok(body.endsWith('\n\n'));
    assert.doesNotMatch(body, /\[DONE\]/);
    const frame = JSON.parse(body.slice(6).trim());
    assert.equal(frame.candidates[0].content.parts[0].text, 'hello');
    assert.equal(frame.candidates[0].finishReason, 'STOP');
    assert.equal((await f.state('text')).phase, 'done');
});

test('tool scenario verifies real nested string functionResponse before final text', async t => {
    const f = await fixture(t);
    await f.create(toolConfig('tool'));
    const first = await f.request(endpoint, model('tool'));
    const call = JSON.parse((await first.text()).slice(6).trim()).candidates[0].content.parts[0].functionCall;
    assert.deepEqual(call, { id: 'call-tool', name: 'list-flows', args: {} });
    const next = await f.request(endpoint, model('tool', [response('tool', { flows: [{ namespace: 'company.a', id: 'a' }] })]));
    assert.equal(next.status, 200); assert.match(await next.text(), /verified/);
    assert.equal((await f.state('tool')).functionResponses, 1);
    assert.equal((await f.request(endpoint, model('tool'))).status, 409);
});

test('denies out of scope, mismatched ID and non-string function responses', async t => {
    const f = await fixture(t); await f.create(toolConfig('scope'));
    await (await f.request(endpoint, model('scope'))).text();
    for (const bad of [response('scope', { flows: [{ namespace: 'company.b' }] }),
        { ...response('scope', { flows: [] }), id: 'wrong' },
        { id: 'call-scope', name: 'list-flows', response: { response: { flows: [] } } }]) {
        assert.equal((await f.request(endpoint, model('scope', [bad]))).status, 422);
    }
    assert.equal((await f.state('scope')).functionResponses, 0);
});

test('requires declared tool and verifies exact structured result', async t => {
    const f = await fixture(t);
    await f.create({ id: 'exact', mode: 'tool', text: 'done', tool: { name: 'read-flow', args: { namespace: 'company.a', flowId: 'a' }, expect: { exact: { id: 'a' } } } });
    assert.equal((await f.request(endpoint, model('exact'))).status, 422);
    await (await f.request(endpoint, model('exact', [], 'read-flow'))).text();
    const next = { id: 'call-exact', name: 'read-flow', response: { response: '{"id":"a"}' } };
    assert.equal((await f.request(endpoint, model('exact', [next], 'read-flow'))).status, 200);
});

test('isolates scenarios and supports wait latch release', async t => {
    const f = await fixture(t);
    await f.create({ id: 'wait', mode: 'wait', text: 'released' });
    await f.create({ id: 'other', mode: 'text', text: 'other text' });
    const waiting = await f.request(endpoint, model('wait'));
    const reader = waiting.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /Waiting for controlled transport/);
    assert.equal((await f.state('wait')).phase, 'waiting');
    assert.match(await (await f.request(endpoint, model('other'))).text(), /other text/);
    assert.equal((await f.request('/scenarios/wait/release', {})).status, 200);
    let rest = ''; for (;;) { const chunk = await reader.read(); if (chunk.done) break; rest += new TextDecoder().decode(chunk.value); }
    assert.match(rest, /released/);
    assert.equal((await f.state('wait')).phase, 'done');
    assert.equal((await f.request('/scenarios/wait/release', {})).status, 409);
});

test('wait release can return a tool and then verify function response', async t => {
    const f = await fixture(t); await f.create({ ...toolConfig('wait-tool'), mode: 'wait' });
    const waiting = await f.request(endpoint, model('wait-tool'));
    const body = waiting.text();
    assert.equal((await f.request('/scenarios/wait-tool/release', {})).status, 200);
    assert.match(await body, /functionCall/);
    const next = await f.request(endpoint, model('wait-tool', [response('wait-tool', { flows: [{ namespace: 'company.a' }] })]));
    assert.equal(next.status, 200); await next.text();
});

test('observes actual client disconnect and rejects late release', async t => {
    const f = await fixture(t); await f.create({ id: 'cancel', mode: 'wait', text: 'late' });
    const waiting = await f.request(endpoint, model('cancel'));
    const reader = waiting.body.getReader(); await reader.read(); await reader.cancel();
    await eventually(async () => (await f.state('cancel')).disconnected === 1);
    assert.equal((await f.state('cancel')).phase, 'disconnected');
    assert.equal((await f.request('/scenarios/cancel/release', {})).status, 409);
});

test('expires bounded wait and closes connection', async t => {
    const f = await fixture(t); await f.create({ id: 'expire', mode: 'wait', text: 'late', waitTimeoutMs: 100 });
    const waiting = await f.request(endpoint, model('expire'));
    await assert.rejects(waiting.text());
    assert.equal((await f.state('expire')).phase, 'expired');
    assert.equal((await f.state('expire')).disconnected, 0);
});

test('rejects unknown routes, oversized JSON, malformed JSON and unknown schema', async t => {
    const f = await fixture(t, { maxBytes: 1024, maxScenarios: 1 });
    assert.equal((await f.request('/unknown', {})).status, 404);
    assert.equal((await f.request('/models/x:generateContent', {})).status, 404);
    assert.equal((await f.request('/scenarios', { id: 'big', mode: 'text', text: 'x'.repeat(2000) })).status, 413);
    assert.equal((await fetch(f.base + '/scenarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
    assert.equal((await f.request('/scenarios', { id: 'bad', mode: 'text', text: 'x', password: 'no' })).status, 400);
    await f.create({ id: 'one', mode: 'text', text: 'one' });
    assert.equal((await f.request('/scenarios', { id: 'two', mode: 'text', text: 'two' })).status, 429);
    assert.equal((await f.request('/scenarios', { id: 'one', mode: 'text', text: 'one' })).status, 409);
    assert.equal((await f.request('/scenarios/one', undefined, 'DELETE')).status, 200);
});

test('never records credential headers, prompt or function result contents', async t => {
    const f = await fixture(t); await f.create({ id: 'safe', mode: 'text', text: 'private-response' });
    const body = model('safe'); body.contents[0].parts[0].text += ' production-password-canary';
    await (await f.request(endpoint, body, 'POST', { Cookie: 'cookie-canary', Authorization: 'Bearer token-canary' })).text();
    const evidence = JSON.stringify({ logs: f.logs, state: await f.state('safe') });
    for (const secret of ['cookie-canary', 'token-canary', 'production-password-canary', 'private-response']) assert.ok(!evidence.includes(secret));
    for (const entry of f.logs) assert.deepEqual(Object.keys(entry).sort(), ['event', 'scenario']);
});

test('requires one isolated prompt marker and accepts explicit v1beta prefix', async t => {
    const f = await fixture(t); await f.create({ id: 'prefix', mode: 'text', text: 'ok' });
    assert.equal((await f.request(endpoint, { contents: [] })).status, 400);
    const mixed = model('prefix'); mixed.contents[0].parts.push({ text: '[[ai-scenario:other]]' });
    assert.equal((await f.request(endpoint, mixed)).status, 400);
    const success = await f.request('/v1beta' + endpoint, model('prefix'));
    assert.equal(success.status, 200); await success.text();
});

test('exact flow identity set rejects omissions extras duplicates and wrong IDs',async t=>{
    const f=await fixture(t),flowIds=[{namespace:'company.a',id:'sentinel'},{namespace:'company.b',id:'sentinel'},{namespace:'company.outside',id:'sentinel'}];
    await f.create({id:'identities',mode:'tool',text:'verified',tool:{name:'list-flows',args:{},expect:{flowIds}}});
    await (await f.request(endpoint,model('identities'))).text();
    for(const flows of [flowIds.slice(0,1),[...flowIds,flowIds[0]],flowIds.map(row=>({...row,id:'other'})),[...flowIds,{namespace:'other',id:'sentinel'}]])
        assert.equal((await f.request(endpoint,model('identities',[response('identities',{flows})]))).status,422);
    const accepted=await f.request(endpoint,model('identities',[response('identities',{flows:[...flowIds].reverse()})]));
    assert.equal(accepted.status,200);await accepted.text();assert.equal((await f.state('identities')).functionResponses,1);
});

test('flow identity schema rejects ambiguous or duplicate sentinel definitions',async t=>{
    const f=await fixture(t);
    for(const flowIds of [[],[{namespace:'company.a'}],[{namespace:'company.a',id:'a',extra:true}],[{namespace:'company.a',id:'a'},{namespace:'company.a',id:'a'}]])
        assert.equal((await f.request('/scenarios',{id:'bad-identities',mode:'tool',text:'done',tool:{name:'list-flows',args:{},expect:{flowIds}}})).status,400);
});

test('late real POST release after client disconnect returns bounded 409 not_waiting',async t=>{
    const f=await fixture(t);await f.create({id:'late-release',mode:'wait',text:'late',tool:{name:'restart-execution',args:{executionId:'e'},expect:{exact:{executionId:'e'}}}});
    const abort=new AbortController();
    const waiting=await fetch(f.base+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(model('late-release',[],'restart-execution')),signal:abort.signal});
    await waiting.body.getReader().read();abort.abort();
    const deadline=Date.now()+2000;while((await f.state('late-release')).disconnected===0){assert(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,10));}
    const result=await fetch(f.base+'/scenarios/late-release/release',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(2000)});
    assert.equal(result.status,409);assert.deepEqual(await result.json(),{error:'not_waiting'});
    assert.equal((await f.state('late-release')).functionResponses,0);
});

test('authorization denial accepts only exact production refusal and cannot mask a successful tool write',async t=>{
 const f=await fixture(t)
 await f.create({id:'denied',mode:'tool',text:'denied safely',tool:{name:'restart-execution',args:{executionId:'execution'},expect:{authorizationDenied:true}}})
 await (await f.request(endpoint,model('denied',[],'restart-execution'))).text()
 for(const text of ['Error: different error','{"executionId":"execution"}','REJECTED by user.'])assert.equal((await f.request(endpoint,model('denied',[{id:'call-denied',name:'restart-execution',response:{response:text}}],'restart-execution'))).status,422)
 const result=await f.request(endpoint,model('denied',[{id:'call-denied',name:'restart-execution',response:{response:'Error: AI authorization denied'}}],'restart-execution'))
 assert.equal(result.status,200);await result.text();assert.equal((await f.state('denied')).functionResponses,1)
})
