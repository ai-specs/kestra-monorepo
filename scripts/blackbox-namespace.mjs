import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const [base, directory, phase] = process.argv.slice(2);
const identities = {
    admin: ['tester', 'Passw0rd!'], reader: ['rbac-reader', 'ReaderPass123!'],
    writer: ['rbac-writer', 'WriterPass123!'], multi: ['rbac-multi', 'MultiPass123!'], exact: ['rbac-exact', 'ExactPass123!'],
};
const cookies = new Map();
const csrf = new Map();
const rows = [];
function check(condition, label) {
    rows.push({case: label, passed: Boolean(condition)});
    if (!condition) throw new Error(label);
    console.log(`PASS namespace ${phase}: ${label}`);
}
async function request(user, endpoint, options = {}) {
    const url = new URL(endpoint, base);
    if (url.origin !== new URL(base).origin) throw new Error('Cross-origin test request');
    if (!cookies.has(user)) cookies.set(user, new Map());
    const jar = cookies.get(user);
    const result = await fetch(url, {redirect: 'manual', signal: AbortSignal.timeout(90000), ...options,
        headers: {Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; '), ...options.headers}});
    for (const entry of result.headers.getSetCookie()) {
        const pair = entry.split(';')[0];
        const split = pair.indexOf('=');
        jar.set(pair.slice(0, split), pair.slice(split + 1));
    }
    return result;
}
async function login(user) {
    let result = await request(user, '/oauth/login/kestra');
    result = await request(user, result.headers.get('location'));
    const login = new URL(result.headers.get('location'), base);
    check(login.pathname === '/oidc/login', `${user} production login`);
    result = await request(user, '/oidc/login', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({username: identities[user][0], password: identities[user][1], from: login.searchParams.get('from')})});
    check(result.status === 303, `${user} credential accepted`);
    for (let hop = 0; hop < 10 && [301, 302, 303, 307, 308].includes(result.status); hop++) {
        result = await request(user, result.headers.get('location'));
    }
    const html = await result.text();
    const token = html.match(/name="csrf-token"[^>]*content="([^"]+)"/)?.[1] || html.match(/content="([^"]+)"[^>]*name="csrf-token"/)?.[1];
    check(result.status === 200 && token, `${user} OAuth UI session`);
    csrf.set(user, token);
}
function sql(query) {
    return execFileSync('docker', ['exec', process.env.BB_RBAC_PG, 'psql', '-U', 'kestra', '-d', 'kestra', '-Atc', query], {encoding: 'utf8'}).trim();
}
function snapshot() {
    return sql("SELECT json_build_object('flows',(SELECT md5(coalesce(string_agg(value::text,'|' ORDER BY key),'')) FROM flows),'executions',(SELECT count(*) FROM executions),'pending',(SELECT count(*) FROM execution_queued),'queue',(SELECT count(*) FROM queues WHERE type ILIKE '%execution%'),'kv',(SELECT md5(coalesce(string_agg(value::text,'|' ORDER BY key),'')) FROM kv_metadata))::text");
}
async function mutation(user, method, endpoint, body, type = 'application/x-yaml') {
    const shell = await request(user, '/ui/');
    const html = await shell.text();
    const current = html.match(/name="csrf-token"[^>]*content="([^"]+)"/)?.[1] || html.match(/content="([^"]+)"[^>]*name="csrf-token"/)?.[1];
    if (current) csrf.set(user, current);
    if (method === 'POST' && endpoint.includes('/executions/')) {
        return request(user, endpoint, {method, body: new FormData(), headers: {'X-CSRF-TOKEN': csrf.get(user)}});
    }
    return request(user, endpoint, {method, body, headers: {...(body === undefined ? {} : {'Content-Type': type}), 'X-CSRF-TOKEN': csrf.get(user)}});
}
const source = (namespace, id) => `id: ${id}\nnamespace: ${namespace}\ntasks:\n  - id: result\n    type: io.kestra.plugin.core.debug.Return\n    format: verified\n`;
try {
    await login('admin');
    if (phase === 'seed') {
        for (const namespace of ['rbac.allowed', 'rbac.allowed.child', 'rbac.allowed2', 'rbac.denied']) {
            check((await mutation('admin', 'POST', '/api/v1/main/flows', source(namespace, 'namespace-probe'))).ok, `seed ${namespace}`);
            check((await mutation('admin', 'PUT', `/api/v1/main/namespaces/${namespace}/kv/scope-probe`, '"verified"', 'text/plain')).ok,
                `seed KV ${namespace}`);
            const run = await mutation('admin', 'POST', `/api/v1/main/executions/${namespace}/namespace-probe?wait=true`, undefined);
            check(run.ok && (await run.json()).state?.current === 'SUCCESS', `seed execution ${namespace}`);
        }
        const result = await mutation('admin', 'POST', '/api/v1/main/executions/rbac.allowed/namespace-probe?wait=true', undefined);
        check(result.ok, 'seed execution');
        const execution = await result.json();
        check(execution.state?.current === 'SUCCESS', 'seed execution succeeds');
        writeFileSync(`${directory}/resources.json`, JSON.stringify({namespace: 'rbac.allowed', flowId: 'namespace-probe', executionId: execution.id}));
    } else if (phase === 'missing') {
        const before = snapshot();
        for (const user of ['reader', 'writer', 'multi', 'exact']) {
            await login(user);
            check((await request(user, '/api/v1/main/flows/search')).status === 403, `${user} missing jar fails closed`);
        }
        check(snapshot() === before, 'missing jar creates no persistence');
    } else if (phase === 'disabled') {
        await login('reader');
        check((await request('reader', '/api/v1/main/flows/rbac.denied/namespace-probe')).ok, 'disabled cross-domain vanilla read');
        check((await mutation('reader', 'POST', '/api/v1/main/flows', source('rbac.denied', 'disabled-reader-write'))).ok,
            'disabled vanilla write');
    } else {
        for (const user of ['reader', 'writer', 'multi', 'exact']) await login(user);
        for (const user of ['reader', 'writer', 'multi', 'exact']) {
            const result = await request(user, '/api/v1/main/flows/search?size=1&page=1');
            check(result.ok, `${user} paginated query`);
            const list = await result.json();
            check(list.total === (user === 'exact' ? 1 : 2) && list.results.length === 1, `${user} filtered total before pagination`);
            const second = await request(user, '/api/v1/main/flows/search?size=1&page=2');
            const next = await second.json();
            check(next.results.length === (user === 'exact' ? 0 : 1), `${user} second page scope`);
            const before = snapshot();
            const denied = await mutation(user, 'POST', '/api/v1/main/flows', source('rbac.denied', `denied-${user}`));
            check(denied.status === 403 && snapshot() === before, `${user} cross-domain create has no persistence`);
            const prefix = await request(user, '/api/v1/main/flows/rbac.allowed2/namespace-probe');
            check(prefix.status === 403, `${user} prefix collision denies`);
            const kv = await request(user, '/api/v1/main/kv?size=1&page=1');
            check(kv.ok, `${user} KV search`);
            const keys = await kv.json();
            check(keys.total === (user === 'exact' ? 1 : 2), `${user} KV filtered total`);
            const chart = 'id: scoped-count\ntype: io.kestra.plugin.core.dashboard.chart.KPI\nchartOptions:\n  displayName: Scoped count\n  numberType: FLAT\ndata:\n  type: io.kestra.plugin.core.dashboard.data.ExecutionsKPI\n  columns:\n    field: ID\n    agg: COUNT\n';
            const preview = await mutation(user, 'POST', '/api/v1/main/dashboards/charts/preview',
                JSON.stringify({chart}), 'application/json');
            check(preview.ok, `${user} dashboard aggregate`);
            const values = await preview.json();
            check(values.results?.[0]?.value === (user === 'exact' ? 2 : 3), `${user} dashboard aggregate scope before count`);
            const excluded = await mutation(user, 'POST', '/api/v1/main/dashboards/charts/preview',
                JSON.stringify({chart, globalFilter: {filters: [{field: 'namespace', operation: 'EQUALS', value: 'rbac.denied'}]}}), 'application/json');
            check(excluded.ok && (await excluded.json()).results?.[0]?.value === 0, `${user} dashboard global filter intersection`);
            const unknownSource = chart.replace('io.kestra.plugin.core.dashboard.data.ExecutionsKPI', 'custom.sql.Source');
            const unknown = await mutation(user, 'POST', '/api/v1/main/dashboards/charts/preview', JSON.stringify({chart: unknownSource}), 'application/json');
            check([400, 403, 422].includes(unknown.status), `${user} unknown dashboard datasource rejected`);
            check((await request(user, '/api/v1/main/namespaces/rbac.denied/kv/scope-probe')).status === 403,
                `${user} KV cross-domain owner denies`);
            const beforeDeniedExecution = snapshot();
            check((await mutation(user, 'POST', '/api/v1/main/executions/rbac.denied/namespace-probe', undefined)).status === 403,
                `${user} cross-domain execution rejected`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            check(snapshot() === beforeDeniedExecution, `${user} denied execution has no queue or persistence`);
            if (user === 'exact') check((await request(user, '/api/v1/main/flows/rbac.allowed.child/namespace-probe')).status === 403, 'exact excludes child details');
        }
        for (const user of ['reader', 'exact']) {
            const before = snapshot();
            check((await mutation(user, 'POST', '/api/v1/main/flows', source('rbac.allowed', `readonly-${user}`))).status === 403, `${user} write rejected`);
            check(snapshot() === before, `${user} rejected write has no persistence`);
            check((await mutation(user, 'PUT', '/api/v1/main/namespaces/rbac.allowed/kv/readonly', '"forbidden"', 'text/plain')).status === 403,
                `${user} KV write rejected`);
            check(snapshot() === before, `${user} rejected KV has no persistence`);
        }
        for (const user of ['writer', 'multi']) {
            const id = `write-${user}`;
            const endpoint = `/api/v1/main/flows/rbac.allowed/${id}`;
            check((await mutation(user, 'POST', '/api/v1/main/flows', source('rbac.allowed', id))).ok, `${user} create`);
            check((await mutation(user, 'PUT', endpoint, source('rbac.allowed', id).replace('verified', 'updated'))).ok, `${user} update`);
            const execute = await mutation(user, 'POST', `/api/v1/main/executions/rbac.allowed/${id}?wait=true`, undefined);
            check(execute.ok && (await execute.json()).state?.current === 'SUCCESS', `${user} execute succeeds`);
            const deleted = await mutation(user, 'DELETE', endpoint, undefined);
            if (!deleted.ok) console.log('Delete problem:', await deleted.text());
            check(deleted.ok, `${user} delete`);
            check((await request('admin', endpoint)).status === 404, `${user} delete persisted`);
        }
    }
    writeFileSync(`${directory}/${phase}.passed`, 'passed\n');
} finally {
    writeFileSync(`${directory}/${phase}.report.json`, JSON.stringify({completed: rows.length > 0 && rows.every(row => row.passed), rows}, null, 2));
}
