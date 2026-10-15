import {copyFileSync, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';

const [base, directory] = process.argv.slice(2);
const root = '/api/v1/main/extensions/rbac';
const run = `api-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
const rows = [];
const sessions = new Map();
const coverage = Object.fromEntries(['authentication', 'roleCrud', 'roleMapping', 'strictJson', 'policyConcurrency',
    'zeroAuthorization', 'managementDenials', 'subjectValidation', 'exactNamespaceMatrix', 'splitReadList',
    'liveUnbinding', 'accountConcurrency', 'protectedAdministrator', 'accountLifecycle', 'manifestResources']
    .map(name => [name, 'not_executed']));
const password = randomBytes(24).toString('base64url') + 'Aa1!';
const replacement = randomBytes(24).toString('base64url') + 'Bb2!';
const namespaces = {a: `${run}.a`, b: `${run}.b`, outside: `${run}.outside`, child: `${run}.a.child`};
let policy;
let completed = false;
let failure;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function check(condition, label, evidence = {}) {
    rows.push({case: label, passed: Boolean(condition), ...evidence});
    if (!condition) throw new Error(label);
    console.log(`PASS management: ${label}`);
}
function session(key) {
    if (!sessions.has(key)) sessions.set(key, {cookies: new Map(), csrf: undefined});
    return sessions.get(key);
}
async function request(key, endpoint, options = {}) {
    const url = new URL(endpoint, base);
    if (url.origin !== new URL(base).origin) throw new Error('Cross-origin request rejected');
    const current = key === null ? undefined : session(key);
    let response;
    try {
        response = await fetch(url, {...options, redirect: 'manual', signal: AbortSignal.timeout(30000), headers: {
            ...(current ? {Cookie: [...current.cookies].map(([name, value]) => `${name}=${value}`).join('; ')} : {}),
            ...options.headers,
        }});
    } catch {
        throw new Error('HTTP request failed or timed out');
    }
    if (current) for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0];
        const split = pair.indexOf('=');
        current.cookies.set(pair.slice(0, split), pair.slice(split + 1));
    }
    return response;
}
function csrfFrom(html) {
    return html.match(/name="csrf-token"[^>]*content="([^"]+)"/)?.[1]
        || html.match(/content="([^"]+)"[^>]*name="csrf-token"/)?.[1];
}
async function login(key, username, secret, accepted = true) {
    sessions.delete(key);
    let response = await request(key, '/oauth/login/kestra');
    check(response.status === 302, `${key} OAuth start`);
    response = await request(key, response.headers.get('location'));
    check([303, 307].includes(response.status), `${key} authorization redirects`);
    const loginUrl = new URL(response.headers.get('location'), base);
    check(loginUrl.pathname === '/oidc/login', `${key} production password login`);
    response = await request(key, '/oidc/login', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({username, password: secret, from: loginUrl.searchParams.get('from')})});
    if (!accepted) {
        check([200, 400, 401, 403].includes(response.status), `${key} invalid password rejected`, {status: response.status});
        check(!session(key).cookies.get('JWT'), `${key} rejected login has no application cookie`);
        return;
    }
    check(response.status === 303, `${key} credentials accepted`);
    let callback = false;
    for (let hop = 0; hop < 12 && [301, 302, 303, 307, 308].includes(response.status); hop++) {
        const location = response.headers.get('location');
        callback ||= new URL(location, base).pathname.includes('/oauth/callback/');
        response = await request(key, location);
    }
    const html = await response.text();
    session(key).csrf = csrfFrom(html);
    check(callback && response.status === 200 && session(key).cookies.get('JWT') && session(key).csrf,
        `${key} OAuth callback cookie and CSRF`);
}
async function mutate(key, method, endpoint, body, revision, type = 'application/json') {
    const shell = await request(key, '/ui/');
    const token = csrfFrom(await shell.text());
    if (token) session(key).csrf = token;
    return request(key, endpoint, {method, headers: {
        'X-CSRF-TOKEN': session(key).csrf,
        ...(revision === undefined ? {} : {'If-Match': `"${revision}"`}),
        ...(body === undefined ? {} : {'Content-Type': type}),
    }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)});
}
function sql(query) {
    try {
        return execFileSync('docker', ['exec', process.env.BB_MANAGEMENT_PG, 'psql', '-U', 'kestra', '-d', 'kestra',
            '-v', 'ON_ERROR_STOP=1', '-Atc', query], {encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe']}).trim();
    } catch {
        throw new Error('Read-only persistence snapshot failed');
    }
}
function snapshot() {
    const tables = ['rbac_policy_head', 'rbac_policy_snapshot', 'oidc_user', 'oidc_user_auth_method',
        'flows', 'executions', 'execution_queued', 'queues'];
    const expressions = tables.map(table => {
        const filter = table.startsWith('oidc_')
            ? `WHERE ${table === 'oidc_user' ? 'username' : 'user_id'} LIKE '${run}%' OR ${table === 'oidc_user' ? 'username' : 'user_id'}='tester'`
            : ['flows', 'executions', 'execution_queued', 'queues'].includes(table)
                ? `WHERE row_to_json(record)::text LIKE '%${run}%'` : '';
        return `'${table}',(SELECT md5(coalesce(string_agg(document,'|' ORDER BY document),'')) FROM
            (SELECT row_to_json(record)::text AS document FROM ${table} record ${filter}) selected)`;
    });
    return JSON.parse(sql(`SELECT json_build_object(${expressions.join(',')})::text`));
}
async function refusal(label, operation, status, code) {
    const before = snapshot();
    const response = await operation();
    const actualStatus = response.status;
    let actualCode;
    if (code) {
        let body;
        try { body = await response.json(); } catch { body = {}; }
        actualCode = body.code;
    } else await response.body?.cancel();
    const deadline = Date.now() + 1500;
    let unchanged = true;
    let after;
    do {
        after = snapshot();
        unchanged &&= JSON.stringify(after) === JSON.stringify(before);
        await pause(250);
    } while (Date.now() < deadline);
    check(unchanged, `${label} preserves policy/accounts/flows/executions/queue`, {before, after, status: actualStatus});
    check(actualStatus === status, `${label} status`, {expectedStatus: status, status: actualStatus});
    if (code) check(actualCode === code, `${label} error code`, {expectedCode: code, actualCode});
}
async function json(response, label, status = 200) {
    check(response.status === status, label, {status: response.status});
    try { return await response.json(); } catch { throw new Error(`${label} invalid JSON`); }
}
async function readPolicy() {
    const response = await request('admin', `${root}/policy`);
    const result = await json(response, 'read policy');
    check(response.headers.get('etag') === `"${result.revision}"`, 'policy ETag matches revision');
    policy = result;
    return result;
}
async function policyWrite(method, endpoint, body) {
    const previous = policy.revision;
    policy = await json(await mutate('admin', method, root + endpoint, body, previous), `${method} ${endpoint}`);
    check(policy.revision === previous + 1, `${method} ${endpoint} advances revision`);
    const persisted = await readPolicy();
    check(persisted.revision === previous + 1, 'policy revision persists');
    return policy;
}
const role = (id, grants = []) => ({id, name: id, description: 'API acceptance', grants});
const grant = (namespace, actions) => ({scope: 'NAMESPACE', tenant: 'main', namespace, descendants: false,
    resource: 'FLOW', actions, allIds: true, ids: []});
const flow = (namespace, id, value = 'verified') => `id: ${id}\nnamespace: ${namespace}\ntasks:\n  - id: result\n    type: io.kestra.plugin.core.debug.Return\n    format: ${value}\n`;
async function account(subject) {
    return json(await request('admin', `${root}/users/detail?subject=${encodeURIComponent(subject)}`), 'account detail');
}
async function accountList(subject) {
    const subjects = new Set();
    let expectedTotal;
    for (let page = 1; page <= 100; page++) {
        const result = await json(await request('admin', `${root}/users?page=${page}&size=20`), `account list page ${page}`);
        check(Number.isInteger(result.total) && result.total >= 0 && result.page === page && result.size === 20
            && Array.isArray(result.items), 'account list pagination shape');
        expectedTotal ??= result.total;
        check(result.total === expectedTotal, 'account list total remains stable');
        for (const item of result.items) {
            check(!subjects.has(item.subject), 'account list does not repeat subjects');
            subjects.add(item.subject);
        }
        if (subjects.size >= result.total || result.items.length === 0) break;
    }
    check(subjects.size === expectedTotal && subjects.has(subject), 'account list total matches enumerated unique accounts');
}
async function assets(key) {
    const manifest = await json(await request(key, '/ui-extensions/main/manifest'), `${key ?? 'anonymous'} management manifest`);
    const extension = manifest.extensions?.find(entry => entry.id === 'rbac');
    check(extension?.files && extension.entry && extension.files[extension.entry], 'RBAC manifest contains entry and resource hashes');
    for (const [name, metadata] of Object.entries(extension.files)) {
        check(!name.split('/').includes('..'), 'manifest resource remains inside extension');
        const response = await request(key, `/ui-extensions/main/rbac/${name}`);
        check(response.status === 200, `resource ${name} available`);
        check(response.headers.get('content-type')?.split(';')[0] === metadata.mime, `resource ${name} MIME`);
        check(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex') === metadata.sha256,
            `resource ${name} SHA-256`);
    }
    check((await request(key, `/ui-extensions/main/rbac/${run}-missing.js`)).status === 404, 'unknown management resource 404');
}
try {
    if (!base || !directory || !process.env.BB_MANAGEMENT_PG || process.argv.length !== 4) {
        throw new Error('usage: BB_MANAGEMENT_PG=container node blackbox-management.mjs BASE EVIDENCE_DIR');
    }
    if (existsSync(`${directory}/api.json`)) copyFileSync(`${directory}/api.json`, `${directory}/api-before-${run}.json`);
    check(['http:', 'https:'].includes(new URL(base).protocol), 'HTTP base URL');
    await login('admin', 'tester', 'Passw0rd!');
    coverage.authentication = 'passed';
    const capabilities = await json(await request('admin', `${root}/capabilities`), 'administrator capabilities');
    check(capabilities.allowed && capabilities.mode === 'database' && !capabilities.readOnly && capabilities.userDirectory,
        'database management and user directory enabled');
    await readPolicy();
    check(policy.protectedSubjects.includes('tester'), 'administrator protected subject');
    const ids = {write: `${run}-write`, read: `${run}-read`, list: `${run}-list`, temporary: `${run}-temporary`};
    const candidate = role(ids.temporary);
    await refusal('role missing If-Match', () => mutate('admin', 'POST', `${root}/roles`, candidate), 428, 'revision_required');
    await refusal('role stale If-Match', () => mutate('admin', 'POST', `${root}/roles`, candidate, policy.revision - 1), 412, 'revision_conflict');
    await refusal('role unknown JSON', () => mutate('admin', 'POST', `${root}/roles`, {...candidate, unexpected: true}, policy.revision), 400, 'invalid_request');
    await refusal('role duplicate JSON', () => mutate('admin', 'POST', `${root}/roles`,
        `{"id":"${ids.temporary}","id":"${ids.write}","name":"API","description":"","grants":[]}`, policy.revision), 400, 'invalid_request');
    coverage.strictJson = 'passed';
    coverage.policyConcurrency = 'passed';
    await policyWrite('POST', '/roles', candidate);
    await policyWrite('PUT', `/roles/${candidate.id}`, {...candidate, name: 'API renamed', description: 'Changed description'});
    check(policy.policy.roles.some(entry => entry.id === candidate.id && entry.name === 'API renamed'), 'role rename preserves stable ID');
    await refusal('role path ID mismatch', () => mutate('admin', 'PUT', `${root}/roles/${candidate.id}`, {...candidate, id: ids.write}, policy.revision), 400, 'invalid_request');
    await policyWrite('PUT', '/role-mappings', {trustedRole: `${run}-trusted`, roles: [candidate.id]});
    check(policy.policy.roleMapping[`${run}-trusted`]?.includes(candidate.id), 'trusted role mapping persists');
    await refusal('mapping referenced role delete', () => mutate('admin', 'DELETE', `${root}/roles/${candidate.id}`, undefined, policy.revision), 409, 'role_conflict');
    await policyWrite('PUT', '/role-mappings', {trustedRole: `${run}-trusted`, roles: []});
    check(!policy.policy.roleMapping[`${run}-trusted`], 'removed trusted role mapping absent');
    coverage.roleMapping = 'passed';
    await policyWrite('DELETE', `/roles/${candidate.id}`);
    check(!policy.policy.roles.some(entry => entry.id === candidate.id), 'deleted role absent');
    coverage.roleCrud = 'passed';
    await policyWrite('POST', '/roles', role(ids.write, [grant(namespaces.a, ['READ', 'LIST', 'CREATE', 'UPDATE', 'DELETE'])]));
    await policyWrite('POST', '/roles', role(ids.read, [grant(namespaces.b, ['READ'])]));
    await policyWrite('POST', '/roles', role(ids.list, [grant(namespaces.b, ['LIST'])]));
    await refusal('unknown subject binding', () => mutate('admin', 'PUT', `${root}/bindings`, {subject: `${run}-missing`, roles: [ids.read]}, policy.revision), 404);
    coverage.subjectValidation = 'passed';
    const username = `${run}-user`;
    let user = await json(await mutate('admin', 'POST', `${root}/users`, {username, name: 'API user', email: `${username}@example.invalid`, password}), 'create ordinary user', 201);
    check(user.subject === username && user.active && Number.isInteger(user.revision), 'created user has exact subject and revision');
    await accountList(username);
    check(!policy.policy.subjects[username], 'new user has no policy binding');
    await login('ordinary', username, password);
    const beforeCapabilities = snapshot();
    const capabilitiesResponse = await request('ordinary', `${root}/capabilities`);
    if (capabilitiesResponse.status === 403) {
        await capabilitiesResponse.body?.cancel();
        check(true, 'ordinary capabilities denied by host SYSTEM gate', {status: 403});
    } else {
        const ordinaryCapabilities = await json(capabilitiesResponse, 'ordinary capabilities');
        check(ordinaryCapabilities.allowed === false, 'ordinary user has no management capability');
    }
    check(JSON.stringify(snapshot()) === JSON.stringify(beforeCapabilities), 'ordinary capabilities denial preserves persistence');
    await refusal('zero authorization read', () => request('ordinary', '/api/v1/main/flows/search'), 403);
    await refusal('zero authorization write', () => mutate('ordinary', 'POST', '/api/v1/main/flows', flow(namespaces.a, 'api-zero'), undefined, 'application/x-yaml'), 403);
    coverage.zeroAuthorization = 'passed';
    const managementDenials = [
        ['GET', '/policy'], ['GET', '/users'], ['GET', `/users/detail?subject=${encodeURIComponent(username)}`],
        ['POST', '/roles', candidate], ['PUT', `/roles/${ids.read}`, role(ids.read)], ['DELETE', `/roles/${ids.read}`],
        ['PUT', '/bindings', {subject: username, roles: [ids.write]}],
        ['PUT', '/role-mappings', {trustedRole: `${run}-trusted`, roles: [ids.write]}],
        ['POST', '/users', {username: `${run}-forbidden`, name: 'Forbidden', email: 'api@example.invalid', password}],
        ['PUT', '/users/profile', {subject: username, name: 'Forbidden', email: 'api@example.invalid'}],
        ['PUT', '/users/state', {subject: username, active: false}],
        ['PUT', '/users/password', {subject: username, password: replacement}],
    ];
    for (const [method, endpoint, body] of managementDenials) await refusal(`nonadministrator ${method} ${endpoint}`,
        () => method === 'GET' ? request('ordinary', root + endpoint) : mutate('ordinary', method, root + endpoint, body, policy.revision), 403);
    coverage.managementDenials = 'passed';
    for (const namespace of Object.values(namespaces)) {
        await json(await mutate('admin', 'POST', '/api/v1/main/flows', flow(namespace, 'api-probe'), undefined, 'application/x-yaml'), `seed ${namespace}`);
    }
    await policyWrite('PUT', '/bindings', {subject: username, roles: [ids.read]});
    const singleRead = await request('ordinary', `/api/v1/main/flows/${namespaces.b}/api-probe`);
    let singleReadProblem;
    let administratorStatus;
    if (singleRead.status !== 200) {
        try {
            const problem = await singleRead.json();
            singleReadProblem = {status: problem.status ?? problem.statusCode, code: problem.code, title: problem.title};
        } catch { singleReadProblem = {format: 'non-JSON'}; }
        const administratorRead = await request('admin', `/api/v1/main/flows/${namespaces.b}/api-probe`);
        administratorStatus = administratorRead.status;
        await administratorRead.body?.cancel();
    } else await singleRead.body?.cancel();
    check(singleRead.status === 200, 'single READ role detail allowed', {status: singleRead.status,
        administratorStatus, problem: singleReadProblem, endpoint: `/api/v1/main/flows/${namespaces.b}/api-probe`});
    await refusal('single READ role cannot list', () => request('ordinary', '/api/v1/main/flows/search'), 403);
    await policyWrite('PUT', '/bindings', {subject: username, roles: [ids.write, ids.read, ids.list]});
    await refusal('subject referenced role delete', () => mutate('admin', 'DELETE', `${root}/roles/${ids.read}`, undefined, policy.revision), 409, 'role_conflict');
    const listed = await json(await request('ordinary', '/api/v1/main/flows/search?page=1&size=1'), 'scoped paginated flows');
    check(listed.total === 2 && listed.results.length === 1, 'list total computed after scope before pagination');
    const all = await json(await request('ordinary', '/api/v1/main/flows/search?page=1&size=100'), 'complete scoped flow list');
    check(all.total === 2 && JSON.stringify(all.results.map(entry => entry.namespace).sort()) === JSON.stringify([namespaces.a, namespaces.b].sort()),
        'READ and LIST from different roles compose exact namespace union');
    coverage.splitReadList = 'passed';
    check((await request('ordinary', `/api/v1/main/flows/${namespaces.b}/api-probe`)).status === 200, 'B detail read allowed');
    const created = await json(await mutate('ordinary', 'POST', '/api/v1/main/flows', flow(namespaces.a, 'api-write'), undefined, 'application/x-yaml'), 'A flow create allowed');
    check(created.namespace === namespaces.a && created.id === 'api-write', 'A write identity');
    await json(await mutate('ordinary', 'PUT', `/api/v1/main/flows/${namespaces.a}/api-write`, flow(namespaces.a, 'api-write', 'changed'), undefined, 'application/x-yaml'), 'A flow update allowed');
    const persistedFlow = await json(await request('admin', `/api/v1/main/flows/${namespaces.a}/api-write`), 'read persisted A flow');
    check(persistedFlow.tasks?.[0]?.format === 'changed', 'allowed flow update persisted explicit field');
    for (const namespace of [namespaces.b, namespaces.outside, namespaces.child]) {
        await refusal(`${namespace} write denied`, () => mutate('ordinary', 'POST', '/api/v1/main/flows', flow(namespace, 'api-forbidden'), undefined, 'application/x-yaml'), 403);
        await refusal(`${namespace} execution denied`, () => request('ordinary', `/api/v1/main/executions/${namespace}/api-probe`, {
            method: 'POST', headers: {'X-CSRF-TOKEN': session('ordinary').csrf}, body: new FormData()}), 403);
    }
    for (const namespace of [namespaces.outside, namespaces.child]) await refusal(`${namespace} read denied`,
        () => request('ordinary', `/api/v1/main/flows/${namespace}/api-probe`), 403);
    coverage.exactNamespaceMatrix = 'passed';
    await policyWrite('PUT', '/bindings', {subject: username, roles: []});
    await refusal('existing session unbound new request denied', () => request('ordinary', `/api/v1/main/flows/${namespaces.a}/api-write`), 403);
    coverage.liveUnbinding = 'passed';
    user = await account(username);
    const profile = {subject: username, name: 'API profile changed', email: `${run}-changed@example.invalid`};
    await refusal('profile missing If-Match', () => mutate('admin', 'PUT', `${root}/users/profile`, profile), 428, 'revision_required');
    await refusal('profile unknown JSON', () => mutate('admin', 'PUT', `${root}/users/profile`, {...profile, unexpected: true}, user.revision), 400, 'invalid_request');
    await refusal('profile duplicate JSON', () => mutate('admin', 'PUT', `${root}/users/profile`,
        `{"subject":"${username}","name":"First","name":"Second","email":"api@example.invalid"}`, user.revision), 400, 'invalid_request');
    const originalRevision = user.revision;
    user = await json(await mutate('admin', 'PUT', `${root}/users/profile`, profile, user.revision), 'update ordinary profile');
    const savedUser = await account(username);
    check(savedUser.subject === username && savedUser.name === profile.name && savedUser.email === profile.email && savedUser.revision === originalRevision + 1,
        'profile fields and account revision persist');
    await refusal('profile stale If-Match', () => mutate('admin', 'PUT', `${root}/users/profile`, {...profile, name: 'Stale'}, originalRevision), 412, 'revision_conflict');
    coverage.accountConcurrency = 'passed';
    const admin = await account('tester');
    await refusal('protected administrator disable', () => mutate('admin', 'PUT', `${root}/users/state`, {subject: 'tester', active: false}, admin.revision), 403, 'protected_subject');
    await refusal('protected administrator password reset', () => mutate('admin', 'PUT', `${root}/users/password`, {subject: 'tester', password: replacement}, admin.revision), 403, 'protected_subject');
    coverage.protectedAdministrator = 'passed';
    await policyWrite('PUT', '/bindings', {subject: username, roles: [ids.read, ids.list]});
    check((await request('ordinary', `/api/v1/main/flows/${namespaces.b}/api-probe`)).status === 200, 'old session allowed before disable');
    user = await json(await mutate('admin', 'PUT', `${root}/users/state`, {subject: username, active: false}, user.revision), 'disable ordinary user');
    check(!user.active && !(await account(username)).active, 'inactive state persists');
    const oldSession = {cookies: new Map(session('ordinary').cookies), csrf: session('ordinary').csrf};
    await refusal('disabled cookie rejected', () => request('ordinary', `/api/v1/main/flows/${namespaces.b}/api-probe`), 401);
    user = await json(await mutate('admin', 'PUT', `${root}/users/state`, {subject: username, active: true}, user.revision), 'enable ordinary user');
    sessions.set('old-enabled', {cookies: new Map(oldSession.cookies), csrf: oldSession.csrf});
    await refusal('enable does not revive old cookie', () => request('old-enabled', `/api/v1/main/flows/${namespaces.b}/api-probe`), 401);
    await login('fresh', username, password);
    check((await request('fresh', `/api/v1/main/flows/${namespaces.b}/api-probe`)).status === 200, 'enabled user fresh login allowed');
    user = await json(await mutate('admin', 'PUT', `${root}/users/password`, {subject: username, password: replacement}, user.revision), 'reset ordinary password');
    await refusal('password reset invalidates old cookie', () => request('fresh', `/api/v1/main/flows/${namespaces.b}/api-probe`), 401);
    await login('old-password', username, password, false);
    await refusal('old password has no business access', () => request('old-password', `/api/v1/main/flows/${namespaces.b}/api-probe`), 401);
    await login('new-password', username, replacement);
    check((await request('new-password', `/api/v1/main/flows/${namespaces.b}/api-probe`)).status === 200, 'new password session reads authorized flow');
    coverage.accountLifecycle = 'passed';
    check((await request(null, '/ui-extensions/main/manifest')).status === 401, 'anonymous management manifest requires authentication');
    await assets('admin');
    const hiddenManifest = await json(await request('new-password', '/ui-extensions/main/manifest'), 'ordinary management discovery');
    check(Array.isArray(hiddenManifest.extensions) && !hiddenManifest.extensions.some(entry => entry.id === 'rbac'), 'ordinary management manifest excludes RBAC page');
    coverage.manifestResources = 'passed';
    await policyWrite('PUT', '/bindings', {subject: username, roles: []});
    for (const identifier of [ids.write, ids.read, ids.list]) await policyWrite('DELETE', `/roles/${identifier}`);
    completed = true;
} catch (error) {
    failure = error instanceof Error ? error.message : 'Management acceptance failed';
    rows.push({case: 'run', passed: false, error: failure});
    process.exitCode = 1;
    console.error(`FAIL management: ${failure}`);
} finally {
    if (directory) {
        mkdirSync(directory, {recursive: true, mode: 0o700});
        writeFileSync(`${directory}/api.json`, JSON.stringify({run, completed, failure, rows,
            coverage, unexecuted: Object.keys(coverage).filter(name => coverage[name] !== 'passed'),
            retainedResources: {accountPrefix: run, namespaces: Object.values(namespaces)},
        }, null, 2) + '\n', {mode: 0o600});
    }
}
