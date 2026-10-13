const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

async function main() {
    const base = process.env.BASE || process.env.ADMIN_UI_BASE;
    const phase = process.env.PHASE || process.env.ADMIN_UI_PHASE;
    const directory = process.env.DIRECTORY || process.env.ADMIN_UI_DIRECTORY;
    if (process.env.ADMIN_UI_DEBUG_READ_ONLY) throw new Error('UI mutation checks cannot be bypassed');
    if (!base || !phase || !directory) throw new Error('BASE, PHASE and DIRECTORY are required');
    const origin = new URL(base).origin;
    if (!/^https?:$/.test(new URL(base).protocol)) throw new Error('HTTP browser base required');
    const {chromium} = require('playwright');
    const {adminUiCases} = await import(pathToFileURL(path.join(__dirname, 'admin-ui-cases.mjs')));
    if (!['seed', 'enabled', 'disabled'].includes(phase)) throw new Error('Invalid administrator browser phase');
    const fixture = JSON.parse(await fs.readFile(path.join(directory, `${phase}.resources.json`), 'utf8'));
    const output = path.resolve(process.env.ADMIN_UI_REPORT_DIR || '.work/admin-ui');
    await fs.mkdir(output, {recursive: true});
    const browser = await chromium.launch({headless: true});
    const context = await browser.newContext({locale: 'en-US', viewport: {width: 1600, height: 1000}});
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const rows = [];
    const validation = [];
    let current = {path: 'login', responses: [], errors: [], requests: []};
    const expectedConcurrencyAbsence = response => response.status() === 404 && new URL(response.url()).pathname === `/api/v1/main/concurrency-limit/${fixture.namespace}/${fixture.flowId}` && current.path.endsWith('/concurrency');
    page.on('response', response => {
        const url = new URL(response.url());
        if (url.origin === origin && response.status() >= 400 && !expectedConcurrencyAbsence(response)) {
            current.responses.push({path: url.pathname, status: response.status()});
        }
        if (url.origin !== origin && response.status() >= 400) {
            current.responses.push({host: url.hostname, path: url.pathname, status: response.status()});
        }
        if (url.origin === origin && url.pathname === '/api/v1/main/flows/validate') {
            validation.push(response.json().then(body => {
                current.validation = {status: response.status(), valid: Array.isArray(body) && body.every(item => !item.constraints && !item.exception)};
            }).catch(() => {}));
        }
    });
    page.on('pageerror', error => current.errors.push(error.name));
    page.on('console', message => {
        if (message.type() === 'error') {
            if (current.path.endsWith('/concurrency') && /Failed to load resource:.*404/.test(message.text()) && message.location().url && new URL(message.location().url).pathname === `/api/v1/main/concurrency-limit/${fixture.namespace}/${fixture.flowId}`) return;
            current.errors.push(message.text().replace(/https?:\/\/[^\s]+/g, '[url]').replace(/(?:token|password|secret|cookie|authorization|Bearer).*$/i, '[redacted]').slice(0, 300));
        }
    });
    page.on('requestfailed', request => {
        if (request.failure()?.errorText !== 'net::ERR_ABORTED') current.requests.push(new URL(request.url()).pathname);
    });
    const begin = name => {
        current = {path: name, responses: [], errors: [], requests: []};
        rows.push(current);
    };
    const finish = () => {
        if (current.responses.length || current.errors.length || current.requests.length) throw new Error('Browser operation emitted errors');
        current.passed = true;
        console.log(`PASS ${phase} ${current.path}`);
    };
    const read = async endpoint => {
        const url = new URL(endpoint, base);
        if (url.origin !== origin) throw new Error('Cross-origin verification denied');
        return context.request.get(url.href, {maxRedirects: 0});
    };
    const json = async endpoint => {
        const response = await read(endpoint);
        if (!response.ok()) throw new Error('Persistence read failed');
        return response.json();
    };
    const mutate = async (method, endpoint, action, query = undefined) => {
        const [response] = await Promise.all([page.waitForResponse(response => {
            const url = new URL(response.url());
            return url.origin === origin && url.pathname === endpoint && response.request().method() === method &&
                (!query || url.searchParams.get(query.key)?.replace(/^\//, '') === query.value.replace(/^\//, ''));
        }), action()]);
        current.mutation = {method, path: endpoint, status: response.status()};
        if (!response.ok()) throw new Error('UI mutation response failed');
        return response;
    };
    const navigate = async route => {
        await page.goto(`${base}/ui/main/${route}`, {waitUntil: 'networkidle'});
    };
    const confirm = async () => {
        await page.getByRole('dialog').filter({visible: true}).getByRole('button', {name: /^(OK|Confirm|Delete)$/i}).last().click();
    };
    const replaceYaml = async source => {
        current.step = 'yaml-editor';
        const editor = page.locator('.monaco-editor:visible').first();
        const synced = page.locator('[data-testid="monaco-editor-hidden-synced-textarea"]').first();
        await synced.fill(source, {force: true});
        await synced.blur();
        await page.getByRole('button', {name: 'Save', exact: true}).focus();
        current.step = 'yaml-content';
        await page.waitForFunction(id => [...document.querySelectorAll('.monaco-editor .view-lines')].some(editor => editor.textContent.includes(id)), source.split('\n')[0].slice(4));
    };
    const pickOption = async (testId, label) => {
        const combo = page.locator(`[data-test="${testId}"]`).getByRole('combobox');
        await combo.focus();
        await combo.press('Enter');
        const listbox = await combo.getAttribute('aria-controls');
        if (!listbox) throw new Error('Select has no option list');
        await page.locator(`[id="${listbox}"]`).getByRole('option', {name: label, exact: true}).click();
    };
    try {
        await page.goto(`${base}/ui/`, {waitUntil: 'networkidle'});
        await page.locator('input[name=username]').fill('tester');
        await page.locator('input[name=password]').fill('Passw0rd!');
        await Promise.all([
            page.waitForURL(`${base}/ui/**`, {waitUntil: 'networkidle'}),
            page.locator('button[type=submit]').click(),
        ]);
        if (current.errors.length || current.responses.length) throw new Error('Browser login errors');
        const namespace = fixture.namespace;
        const flowId = `admin-ui-${phase}-${Date.now()}`;
        const flowEndpoint = `/api/v1/main/flows/${namespace}/${flowId}`;
        const flowRoute = `flows/edit/${namespace}/${flowId}/edit`;
        const flowSource = value => `id: ${flowId}\nnamespace: ${namespace}\ndescription: ${value}\ntasks:\n  - id: write\n    type: io.kestra.plugin.core.storage.Write\n    content: ${value}\n`;
        begin('action:flow-create');
        await navigate('flows');
        current.step = 'create-button';
        await page.locator('[data-test="flows-create"]').click();
        current.step = 'create-url';
        await page.waitForURL('**/flows/new');
        await replaceYaml(flowSource('ui-created'));
        await mutate('POST', '/api/v1/main/flows', () => page.getByRole('button', {name: 'Save', exact: true}).click());
        const created = await json(flowEndpoint);
        if (created.id !== flowId || created.namespace !== namespace || created.description !== 'ui-created') throw new Error('Flow create not persisted');
        current.persistenceVerified = true;
        finish();

        begin('action:flow-edit');
        await navigate(flowRoute);
        await replaceYaml(flowSource('ui-updated'));
        await mutate('PUT', flowEndpoint, () => page.getByRole('button', {name: 'Save', exact: true}).click());
        if ((await json(flowEndpoint)).description !== 'ui-updated') throw new Error('Flow edit not persisted');
        current.persistenceVerified = true;
        finish();

        begin('action:flow-execute');
        await navigate(`flows/edit/${namespace}/${flowId}/overview`);
        await page.locator('[data-onboarding-target="flow-execute-button"] button').click();
        const executed = await mutate('POST', `/api/v1/main/executions/${namespace}/${flowId}`, () => page.locator('[data-test="execute-dialog-button"]').click());
        const execution = await executed.json();
        if (!execution.id || execution.flowId !== flowId || execution.namespace !== namespace) throw new Error('Wrong execution created');
        const deadline = Date.now() + 90000;
        let persisted;
        do {
            persisted = await json(`/api/v1/main/executions/${execution.id}`);
            if (['SUCCESS', 'FAILED', 'KILLED', 'CANCELLED'].includes(persisted.state?.current)) break;
            await new Promise(resolve => setTimeout(resolve, 500));
        } while (Date.now() < deadline);
        if (persisted.state?.current !== 'SUCCESS' || persisted.flowId !== flowId) throw new Error('UI execution did not succeed');
        current.persistenceVerified = true;
        finish();

        const key = `admin-ui-${phase}-${Date.now()}`;
        const kvEndpoint = `/api/v1/main/namespaces/${namespace}/kv/${key}`;
        begin('action:kv-create');
        await navigate('kv');
        await page.locator('[data-test="kv-add"]').click();
        await pickOption('kv-namespace', namespace);
        await page.locator('[data-test="kv-key"] input').fill(key);
        await pickOption('kv-type', 'STRING');
        await page.locator('[data-test="kv-value"] textarea').fill('ui-created');
        await mutate('PUT', kvEndpoint, () => page.locator('[data-test="kv-save"]').click());
        await page.locator('[data-test="kv-save"]').waitFor({state: 'hidden'});
        if ((await json(kvEndpoint)).value !== 'ui-created') throw new Error('KV create not persisted');
        current.persistenceVerified = true;
        finish();

        begin('action:kv-update');
        const row = page.getByRole('row').filter({hasText: key});
        await row.locator('[data-test="kv-edit"]').click();
        await page.locator('[data-test="kv-value"] textarea').fill('ui-updated');
        await mutate('PUT', kvEndpoint, () => page.locator('[data-test="kv-save"]').click());
        await page.locator('[data-test="kv-save"]').waitFor({state: 'hidden'});
        if ((await json(kvEndpoint)).value !== 'ui-updated') throw new Error('KV update not persisted');
        current.persistenceVerified = true;
        finish();

        begin('action:kv-delete');
        await row.getByRole('button', {name: 'Delete', exact: true}).click();
        await mutate('DELETE', kvEndpoint, confirm);
        if ((await read(kvEndpoint)).status() !== 404) throw new Error('KV deletion not persisted');
        current.persistenceVerified = true;
        finish();

        const fileName = `admin-ui-${phase}-${Date.now()}.txt`;
        const filesEndpoint = `/api/v1/main/namespaces/${namespace}/files`;
        const fileQuery = {key: 'path', value: `/${fileName}`};
        begin('action:namespace-file-upload');
        await navigate(`namespaces/edit/${namespace}/files`);
        const bootstrapFile = `admin-ui-bootstrap-${phase}-${Date.now()}.txt`;
        let bootstrapCreated = false;
        const newFile = page.getByRole('button', {name: 'New File', exact: true});
        if (await newFile.isVisible()) {
            await newFile.click();
            await page.getByRole('dialog').filter({visible: true}).locator('input').first().fill(bootstrapFile);
            await mutate('POST', filesEndpoint, () => page.getByRole('dialog').filter({visible: true}).getByRole('button', {name: 'Create', exact: true}).click(), {key: 'path', value: `/${bootstrapFile}`});
            bootstrapCreated = true;
        }
        await mutate('POST', filesEndpoint, async () => {
            const importButton = page.getByRole('button', {name: 'Import', exact: true});
            await importButton.click();
            const [chooser] = await Promise.all([
                page.waitForEvent('filechooser'),
                page.getByRole('menuitem', {name: 'Import files', exact: true}).click(),
            ]);
            await chooser.setFiles({name: fileName, mimeType: 'text/plain', buffer: Buffer.from('ui-uploaded')});
        }, fileQuery);
        const uploaded = await read(`${filesEndpoint}?path=${encodeURIComponent(fileQuery.value)}`);
        if (!uploaded.ok() || (await uploaded.text()) !== 'ui-uploaded') throw new Error('File upload not persisted');
        current.persistenceVerified = true;
        finish();
        if (bootstrapCreated) {
            begin('action:namespace-file-bootstrap-delete');
            await page.locator('.filename').getByText(bootstrapFile, {exact: true}).click({button: 'right'});
            await page.getByRole('menuitem', {name: 'Delete file', exact: true}).click();
            await mutate('DELETE', filesEndpoint, confirm, {key: 'path', value: `/${bootstrapFile}`});
            if ((await read(`${filesEndpoint}?path=${encodeURIComponent(`/${bootstrapFile}`)}`)).status() !== 404) throw new Error('Bootstrap file deletion not persisted');
            current.persistenceVerified = true;
            finish();
        }

        begin('action:namespace-file-delete');
        await page.locator('.filename').getByText(fileName, {exact: true}).click({button: 'right'});
        await page.getByRole('menuitem', {name: 'Delete file', exact: true}).click();
        await mutate('DELETE', filesEndpoint, confirm, fileQuery);
        if ((await read(`${filesEndpoint}?path=${encodeURIComponent(fileQuery.value)}`)).status() !== 404) throw new Error('File deletion not persisted');
        current.persistenceVerified = true;
        finish();

        begin('action:mcp-save');
        const mcpEndpoint = '/api/v1/main/mcp-servers/default';
        const before = await json(mcpEndpoint);
        await navigate('admin/mcp-servers/edit/default/edit');
        await page.getByText("Protected by this instance's built-in OIDC server").waitFor();
        const saved = await mutate('PUT', mcpEndpoint, () => page.getByRole('button', {name: 'Save', exact: true}).click());
        const payload = saved.request().postDataJSON();
        const after = await json(mcpEndpoint);
        if (after.id !== 'default' || after.authType !== 'OAUTH' || after.disabled !== payload.disabled || after.serverType !== payload.serverType || after.id !== before.id) throw new Error('MCP save not persisted');
        current.persistenceVerified = true;
        finish();

        begin('action:flow-delete');
        await navigate(flowRoute);
        await page.getByRole('button', {name: 'Actions', exact: true}).click();
        await page.getByRole('menuitem', {name: 'Delete', exact: true}).click();
        await mutate('DELETE', flowEndpoint, confirm);
        if ((await read(flowEndpoint)).status() !== 404) throw new Error('Flow deletion not persisted');
        current.persistenceVerified = true;
        finish();
        const pageFailures = [];
        for (const testCase of adminUiCases(fixture)) {
            begin(testCase.path);
            try {
            current.step = 'navigation';
            await page.goto(`${base}/ui/main/${testCase.path}`, {waitUntil: 'domcontentloaded'});
            current.step = 'content-container';
            const content = page.locator('main, [role=main], .main-content, #main-content, section.full-container, section.main-container, section.empty, .settings-wrapper').filter({visible: true}).first();
            await content.waitFor({state: 'visible', timeout: 15000});
            current.step = 'content-text';
            await page.waitForFunction(pattern => {
                const title = [...document.querySelectorAll('h1')].map(heading => heading.innerText).join('\n');
                return [...document.querySelectorAll('main, [role=main], .main-content, #main-content, section.full-container, section.main-container, section.empty, .settings-wrapper')].some(main =>
                    main.getClientRects().length && main.innerText.trim().length > 25 && new RegExp(pattern, 'i').test(`${title}\n${main.innerText}`));
            }, testCase.content, {timeout: 15000});
            current.contentVerified = true;
            await page.waitForLoadState('networkidle', {timeout: 5000}).catch(error => { if (error.name !== 'TimeoutError') throw error; });
            current.step = 'route-and-errors';
            current.urlPath = new URL(page.url()).pathname;
            if (current.urlPath !== `/ui/main/${testCase.path}` || current.responses.length || current.errors.length || current.requests.length) {
                throw new Error(`Browser route failed: ${testCase.path}`);
            }
            current.passed = true;
            console.log(`PASS ${phase} browser content ${testCase.path}`);
            } catch (error) {
                current.failure = {type: error.name, case: current.path};
                pageFailures.push(current.path);
                await page.screenshot({path: path.join(output, `${phase}-${current.path.replace(/[^a-zA-Z0-9_-]/g, '_')}-failure.png`), fullPage: true, mask: [page.locator('input, textarea, [contenteditable=true], .monaco-editor')]}).catch(() => {});
                console.log(`FAIL ${phase} browser content ${testCase.path}`);
            }
        }
        if (pageFailures.length) throw new Error('Browser page checks failed');
    } catch (error) {
        await Promise.all(validation);
        current.failure = {type: error.name, case: current.path};
        current.diagnostic = {
            urlPath: new URL(page.url()).pathname,
            editors: await page.locator('.monaco-editor').count().catch(() => 0),
            contentLengths: await page.locator('section.full-container').evaluateAll(elements => elements.map(element => element.innerText.length)).catch(() => []),
        };
        await page.screenshot({path: path.join(output, `${phase}-failure.png`), fullPage: true, mask: [page.locator('input, textarea, [contenteditable=true], .monaco-editor')]}).catch(() => {});
        throw new Error(`Failed case: ${current.path}`);
    } finally {
        await fs.writeFile(path.join(output, `${phase}.json`), JSON.stringify({phase, coverage: 'administrator UI mutations, persisted results and route content', browserVersion: browser.version(), counts: {actions: rows.filter(row => row.passed && row.path.startsWith('action:')).length, pages: rows.filter(row => row.passed && !row.path.startsWith('action:')).length, failures: rows.filter(row => row.failure).length}, rows, lastCase: current}, null, 2));
        await browser.close();
    }
}

main().catch(error => {
    const message = /^Failed case: [a-zA-Z0-9:./_-]+$/.test(error.message) ? error.message : error.name;
    console.error(`Administrator UI checks failed (${message}); see sanitized phase report`);
    process.exitCode = 1;
});
