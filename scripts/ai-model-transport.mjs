#!/usr/bin/env node
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TOOL = /^[A-Za-z0-9_-]{1,128}$/;
const LIMIT = 65536;
class RequestError extends Error {
    constructor(status, code) { super(code); this.status = status; }
}
const reject = (status, code) => { throw new RequestError(status, code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed) {
    if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) reject(400, 'invalid_schema');
}
function text(value, max = 8192) {
    if (typeof value !== 'string' || !value.length || value.length > max) reject(400, 'invalid_text');
    return value;
}
function parseScenario(body) {
    keys(body, ['id', 'mode', 'text', 'tool', 'waitTimeoutMs']);
    if (typeof body.id !== 'string' || !ID.test(body.id) || !['text', 'tool', 'wait'].includes(body.mode)) reject(400, 'invalid_scenario');
    text(body.text);
    if (body.mode === 'tool' && !body.tool) reject(400, 'tool_required');
    if (body.mode === 'text' && body.tool) reject(400, 'unexpected_tool');
    if (body.waitTimeoutMs !== undefined && (body.mode !== 'wait' || !Number.isInteger(body.waitTimeoutMs)
        || body.waitTimeoutMs < 100 || body.waitTimeoutMs > 600000)) reject(400, 'invalid_wait_timeout');
    if (body.tool) {
        keys(body.tool, ['name', 'args', 'expect']);
        if (typeof body.tool.name !== 'string' || !TOOL.test(body.tool.name) || !object(body.tool.args)) reject(400, 'invalid_tool');
        keys(body.tool.expect, ['exact', 'rejectedText','authorizationDenied', 'namespaces', 'forbiddenNamespaces', 'minItems', 'flowIds', 'total']);
        const expectation = body.tool.expect;
        if (expectation.flowIds !== undefined && (!Array.isArray(expectation.flowIds) || !expectation.flowIds.length || expectation.flowIds.length > 64
            || expectation.flowIds.some(row => !object(row) || Object.keys(row).some(key => !['namespace','id'].includes(key))
                || typeof row.namespace !== 'string' || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(row.namespace)
                || typeof row.id !== 'string' || !TOOL.test(row.id))
            || new Set(expectation.flowIds.map(row => JSON.stringify([row.namespace,row.id]))).size !== expectation.flowIds.length)) reject(400, 'invalid_flow_ids');
        if (expectation.total !== undefined && (!Number.isSafeInteger(expectation.total) || expectation.total < 0)) reject(400,'invalid_total');
        if (!Object.keys(expectation).length) reject(400, 'expectation_required');
        if (expectation.rejectedText !== undefined && expectation.rejectedText !== true) reject(400, 'invalid_rejected_expectation');
        if (expectation.authorizationDenied !== undefined && expectation.authorizationDenied !== true) reject(400, 'invalid_denial_expectation');
        for (const name of ['namespaces', 'forbiddenNamespaces']) {
            if (expectation[name] !== undefined && (!Array.isArray(expectation[name]) || expectation[name].length > 64
                || expectation[name].some(ns => typeof ns !== 'string' || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(ns))))
                reject(400, 'invalid_namespaces');
        }
        if (expectation.minItems !== undefined && (!Number.isInteger(expectation.minItems) || expectation.minItems < 0 || expectation.minItems > 1000))
            reject(400, 'invalid_min_items');
    }
    return structuredClone(body);
}
function readJson(req, maxBytes) {
    if (!(req.headers['content-type'] ?? '').split(';')[0].trim().match(/^application\/json$/i))
        return Promise.reject(new RequestError(415, 'json_required'));
    return new Promise((resolve, fail) => {
        let chunks = [], size = 0, settled = false;
        const timer = setTimeout(() => finish(new RequestError(408, 'body_timeout')), 10000);
        const finish = (error, value) => {
            if (settled) return;
            settled = true; clearTimeout(timer); chunks = [];
            error ? fail(error) : resolve(value);
        };
        req.on('data', chunk => {
            if (settled) return;
            size += chunk.length;
            if (size > maxBytes) return finish(new RequestError(413, 'json_too_large'));
            chunks.push(chunk);
        });
        req.on('end', () => {
            if (settled) return;
            try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch { finish(new RequestError(400, 'invalid_json')); }
        });
        req.on('aborted', () => finish(new RequestError(400, 'body_aborted')));
        req.on('error', () => finish(new RequestError(400, 'body_error')));
    });
}
function candidate(part, stop = false) {
    return { candidates: [{ index: 0, content: { role: 'model', parts: [part] }, ...(stop ? { finishReason: 'STOP' } : {}) }] };
}
function inspectRequest(body) {
    if (!object(body) || !Array.isArray(body.contents)) reject(400, 'contents_required');
    const ids = new Set(), responses = [], declared = new Set();
    for (const content of body.contents) {
        if (!object(content) || !Array.isArray(content.parts)) reject(400, 'invalid_contents');
        for (const part of content.parts) {
            if (content.role === 'user' && typeof part?.text === 'string')
                for (const match of part.text.matchAll(/\[\[ai-scenario:([A-Za-z0-9][A-Za-z0-9_-]{0,63})\]\]/g)) ids.add(match[1]);
            if (part?.functionResponse) responses.push(part.functionResponse);
        }
    }
    for (const tool of body.tools ?? [])
        for (const fn of tool.functionDeclarations ?? []) if (typeof fn.name === 'string') declared.add(fn.name);
    if (ids.size !== 1) reject(400, 'one_scenario_marker_required');
    return { id: [...ids][0], responses, declared };
}
function verifyResponse(response, config, callId) {
    if (!object(response) || response.id !== callId || response.name !== config.name
        || !object(response.response) || typeof response.response.response !== 'string') reject(422, 'function_response_mismatch');
    let result;
    if(config.expect.authorizationDenied===true){
        if(response.response.response!=='Error: AI authorization denied')reject(422,'authorization_denial_mismatch');
        return;
    }
    if (config.expect.rejectedText === true) {
        if (!/^REJECTED by user\.(?: Reason: [^\r\n]*)?$/.test(response.response.response)) reject(422, 'rejected_text_mismatch');
        return;
    }
    try { result = JSON.parse(response.response.response); }
    catch { reject(422, 'function_response_not_json'); }
    const expect = config.expect;
    if (expect.flowIds !== undefined) {
        if (!Array.isArray(result?.flows)) reject(422, 'result_flows_required');
        const actual = result.flows.map(row => JSON.stringify([row?.namespace,row?.id])).sort();
        const expected = expect.flowIds.map(row => JSON.stringify([row.namespace,row.id])).sort();
        if (!isDeepStrictEqual(actual, expected)) reject(422, 'result_flow_ids_mismatch');
    }
    if (expect.total !== undefined && (!Number.isSafeInteger(result?.total) || result.total !== expect.total)) reject(422,'result_total_mismatch');
    if (Object.hasOwn(expect, 'exact') && !isDeepStrictEqual(result, expect.exact)) reject(422, 'function_result_mismatch');
    if (expect.namespaces !== undefined || expect.forbiddenNamespaces !== undefined || expect.minItems !== undefined) {
        const rows = result?.flows ?? result?.executions;
        if (!Array.isArray(rows) || rows.length < (expect.minItems ?? 0)) reject(422, 'result_rows_mismatch');
        for (const row of rows) {
            if (typeof row?.namespace !== 'string' || (expect.namespaces && !expect.namespaces.includes(row.namespace))
                || expect.forbiddenNamespaces?.includes(row.namespace)) reject(422, 'result_namespace_mismatch');
        }
    }
}

// This external Gemini transport never authenticates a Kestra user or grants platform permissions.
export async function startModelTransport({ host = '127.0.0.1', port = 8089, maxBytes = LIMIT, maxScenarios = 64, log = () => {} } = {}) {
    const scenarios = new Map();
    const serverClosing = new WeakSet();
    function record(scenario, event) {
        scenario.events.push(event);
        if (scenario.events.length > 128) scenario.events.shift();
        try { log({ scenario: scenario.config.id, event }); } catch { /* Diagnostics must not alter transport state. */ }
    }
    const json = (res, status, body) => {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(body));
    };
    function state(s) {
        return { id: s.config.id, mode: s.config.mode, phase: s.phase, requests: s.requests,
            functionResponses: s.verified, disconnected: s.disconnected, events: [...s.events] };
    }
    function sendFrame(res, frame) { res.write(`data: ${JSON.stringify(frame)}\n\n`); }
    function answer(s, res) {
        if (s.config.tool && s.phase !== 'verified') {
            s.phase = 'awaiting_function_response';
            sendFrame(res, candidate({ functionCall: { id: s.callId, name: s.config.tool.name, args: s.config.tool.args } }, true));
            record(s, 'function_call_sent');
        } else {
            s.phase = 'done';
            sendFrame(res, candidate({ text: s.config.text }, true));
            record(s, 'text_sent');
        }
        res.end();
    }
    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, 'http://transport.invalid');
            if (url.pathname === '/health' && req.method === 'GET' && !url.search) return json(res, 200, { status: 'ok' });
            if (url.pathname === '/scenarios' && req.method === 'POST' && !url.search) {
                const config = parseScenario(await readJson(req, maxBytes));
                if (scenarios.has(config.id)) reject(409, 'scenario_exists');
                if (scenarios.size >= maxScenarios) reject(429, 'scenario_limit');
                const s = { config, phase: 'ready', requests: 0, verified: 0, disconnected: 0, events: [], callId: `call-${config.id}`, waiting: null };
                scenarios.set(config.id, s); record(s, 'created'); return json(res, 201, state(s));
            }
            const control = /^\/scenarios\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})(\/release)?$/.exec(url.pathname);
            if (control && !url.search) {
                const s = scenarios.get(control[1]);
                if (!s) reject(404, 'unknown_scenario');
                if (!control[2] && req.method === 'GET') return json(res, 200, state(s));
                if (!control[2] && req.method === 'DELETE') {
                    if (s.waiting) { clearTimeout(s.waiting.timer); serverClosing.add(s.waiting.res); s.waiting.res.destroy(); }
                    scenarios.delete(control[1]); return json(res, 200, { deleted: true });
                }
                if (control[2] && req.method === 'POST') {
                    keys(await readJson(req, maxBytes), []);
                    if (!s.waiting || s.phase !== 'waiting') reject(409, 'not_waiting');
                    const { res: waiting, timer } = s.waiting; s.waiting = null; clearTimeout(timer);
                    record(s, 'released'); answer(s, waiting); return json(res, 200, state(s));
                }
                reject(405, 'method_not_allowed');
            }
            if (!/^\/(?:v1beta\/)?models\/[A-Za-z0-9_.-]+:streamGenerateContent$/.test(url.pathname)
                || req.method !== 'POST' || url.searchParams.get('alt') !== 'sse'
                || [...url.searchParams].length !== 1) reject(404, 'unknown_route');
            const parsed = inspectRequest(await readJson(req, maxBytes));
            const s = scenarios.get(parsed.id);
            if (!s) reject(404, 'unknown_scenario');
            if (!['ready', 'awaiting_function_response'].includes(s.phase)) reject(409, 'scenario_not_ready');
            if (s.config.tool && !parsed.declared.has(s.config.tool.name)) reject(422, 'tool_not_declared');
            if (s.phase === 'awaiting_function_response') {
                if (parsed.responses.length !== 1) reject(422, 'one_function_response_required');
                verifyResponse(parsed.responses[0], s.config.tool, s.callId);
                s.verified++; s.phase = 'verified'; record(s, 'function_response_verified');
            } else if (parsed.responses.length) reject(422, 'unexpected_function_response');
            s.requests++; record(s, 'model_request');
            res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
            res.flushHeaders();
            res.on('close', () => {
                if (!res.writableFinished) {
                    if (serverClosing.has(res)) { record(s, 'server_closed'); return; }
                    s.disconnected++; record(s, 'client_disconnected');
                    if (s.waiting?.res === res) { clearTimeout(s.waiting.timer); s.waiting = null; s.phase = 'disconnected'; }
                }
            });
            if (s.config.mode === 'wait' && s.phase !== 'verified') {
                s.phase = 'waiting';
                sendFrame(res, candidate({ text: 'Waiting for controlled transport release.' }));
                const timer = setTimeout(() => {
                    if (s.waiting?.res !== res) return;
                    s.waiting = null; s.phase = 'expired'; record(s, 'wait_expired'); serverClosing.add(res); res.destroy();
                }, s.config.waitTimeoutMs ?? 120000);
                s.waiting = { res, timer }; record(s, 'first_frame_sent'); return;
            }
            answer(s, res);
        } catch (error) {
            if (!res.headersSent) json(res, error instanceof RequestError ? error.status : 400,
                { error: error instanceof RequestError ? error.message : 'invalid_request' });
            else res.destroy();
        }
    });
    server.requestTimeout = 15000;
    await new Promise((resolve, fail) => { server.once('error', fail); server.listen(port, host, resolve); });
    return { server, address: server.address(), async close() {
        for (const s of scenarios.values()) if (s.waiting) {
            clearTimeout(s.waiting.timer); serverClosing.add(s.waiting.res); s.waiting.res.destroy();
        }
        const closed = new Promise(resolve => server.close(resolve)); server.closeAllConnections(); await closed;
    } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const args = process.argv.slice(2);
    if (args.includes('--help')) {
        console.log('Usage: node scripts/ai-model-transport.mjs [--host 127.0.0.1] [--port 8089]\nPOST /scenarios {id, mode:text|tool|wait, text, tool?:{name,args,expect:{exact?,rejectedText?,namespaces?,forbiddenNamespaces?,minItems?,flowIds?:[{namespace,id}]}}, waitTimeoutMs?}\nflowIds requires the exact returned flow identity set (no omissions, duplicates or extras).\nPrompt marker: [[ai-scenario:ID]]. GET /scenarios/ID; POST /scenarios/ID/release {}; DELETE /scenarios/ID.\nGemini: POST /models/MODEL:streamGenerateContent?alt=sse (optional /v1beta).\nThis unauthenticated control service belongs on an isolated test network. Never route production model traffic to it.');
    } else {
        try {
            const options = { log: event => console.log(JSON.stringify(event)) };
            for (let i = 0; i < args.length; i += 2) {
                if (!['--host', '--port'].includes(args[i]) || !args[i + 1]) throw new Error('Invalid arguments');
                options[args[i].slice(2)] = args[i] === '--port' ? Number(args[i + 1]) : args[i + 1];
            }
            if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)) throw new Error('Invalid port');
            const service = await startModelTransport(options);
            console.log(JSON.stringify({ event: 'listening', port: service.address.port }));
            for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => service.close().then(() => process.exit(0)));
        } catch { console.error('Model transport startup failed'); process.exitCode = 1; }
    }
}
