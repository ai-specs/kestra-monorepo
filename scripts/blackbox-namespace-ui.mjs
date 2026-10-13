import {namespaceUiCases, namespaceUsers} from './namespace-ui-cases.mjs';

export async function runNamespaceUi(browser, base, fixture, record) {
    const rows = [];
    const verify = async (user, name, action) => {
        const row = {user: user.name, case: name, passed: false};
        rows.push(row);
        try {
            await action(row);
            row.passed = true;
            console.log(`PASS ${user.name} browser ${name}`);
        } catch (error) {
            row.failure = {type: error.name, message: error.message.slice(0, 200)};
            throw error;
        } finally {
            await record({completed: false, rows});
        }
    };
    for (const user of namespaceUsers) {
        const page = await browser.page(user.name);
        await verify(user, 'password-login', async () => {
            await page.goto(`${base}/ui/`);
            await page.fill('input[name=username]', user.username);
            await page.fill('input[name=password]', user.password);
            await page.click('button[type=submit]');
            await page.waitForFunction(() => location.pathname.startsWith('/ui/') && !document.querySelector('input[name=password]'));
        });
        for (const menu of ['dashboards', 'flows', 'executions', 'logs', 'namespaces', 'kv', 'plugins']) {
            await verify(user, `menu:${menu}`, async row => {
                await page.goto(`${base}/ui/main/flows`);
                await page.waitForFunction(() => document.querySelectorAll('a[href]').length > 3);
                if (['namespaces', 'plugins'].includes(menu)) {
                    const expanded = await page.evaluate(() => [...document.querySelectorAll('button[aria-expanded]')]
                        .some(button => button.textContent.includes('Resources') && button.getAttribute('aria-expanded') === 'true'));
                    if (!expanded) await page.click('button:has-text("Resources")');
                }
                if (menu === 'kv') {
                    const expanded = await page.evaluate(() => [...document.querySelectorAll('button[aria-expanded]')]
                        .some(button => button.textContent.includes('Tenant') && button.getAttribute('aria-expanded') === 'true'));
                    if (!expanded) await page.click('button:has-text("Tenant")');
                }
                const links = await page.evaluate(target => [...document.querySelectorAll('a[href]')]
                    .filter(link => link.getClientRects().length && new URL(link.href).pathname === target)
                    .map(link => ({href: link.getAttribute('href'), text: link.textContent.trim()})), `/ui/main/${menu}`);
                if (!links.length) throw new Error(`Missing visible menu ${menu}`);
                await page.click(`a[href="${links[0].href}"] >> nth=0`);
                await page.waitForFunction(target => location.pathname === target, `/ui/main/${menu}`);
                row.menu = links[0].text;
            });
        }
        for (const testCase of namespaceUiCases(fixture)) {
            await verify(user, `page:${testCase.path}`, async row => {
                await page.goto(`${base}/ui/main/${testCase.path}`);
                await page.waitForFunction(pattern => {
                    const content = [...document.querySelectorAll('main, [role=main], section.full-container, section.main-container, section.empty, .settings-wrapper')]
                        .filter(element => element.getClientRects().length).map(element => element.innerText).join('\n');
                    const title = [...document.querySelectorAll('h1')].map(element => element.innerText).join('\n');
                    return content.length > 25 && new RegExp(pattern, 'i').test(`${title}\n${content}`);
                }, testCase.content);
                const result = await page.evaluate(() => ({path: location.pathname,
                    denied: performance.getEntriesByType('resource').filter(entry => [401, 403].includes(entry.responseStatus))
                        .map(entry => ({path: new URL(entry.name).pathname, status: entry.responseStatus}))}));
                row.observed = result;
                if (result.path !== `/ui/main/${testCase.path}` || result.denied.length) throw new Error(`Page authorization failed ${testCase.path}: ${JSON.stringify(result)}`);
                row.path = result.path;
                row.contentVerified = true;
                row.authorizationVerified = true;
            });
        }
        await verify(user, 'visible-namespace-data-scope', async row => {
            await page.goto(`${base}/ui/main/namespaces`);
            await page.waitForFunction(() => [...document.querySelectorAll('a[href]')].some(link => link.getAttribute('href')?.includes('/namespaces/edit/rbac.allowed')));
            const ids = await page.evaluate(() => [...document.querySelectorAll('a[href]')]
                .filter(link => link.getAttribute('href')?.includes('/namespaces/edit/'))
                .map(link => new URL(link.href).pathname.split('/namespaces/edit/')[1].split('/')[0]));
            if (!ids.includes('rbac.allowed') || ids.includes('rbac.denied') || ids.includes('rbac.allowed2') || user.name === 'exact' && ids.includes('rbac.allowed.child'))
                throw new Error('Namespace table scope leaked');
            row.dataScopeVerified = true;
        });
        await verify(user, 'visible-flow-data-scope', async row => {
            await page.goto(`${base}/ui/main/flows`);
            await page.waitForFunction(() => document.querySelector('tbody tr'));
            const text = await page.evaluate(() => [...document.querySelectorAll('tbody tr')].map(element => element.innerText).join('\n'));
            if (!text.includes(fixture.flowId) || text.includes('rbac.denied') || text.includes('rbac.allowed2')
                || user.name === 'exact' && text.includes('rbac.allowed.child')) throw new Error('Flow table scope leaked or hid allowed data');
            row.dataScopeVerified = true;
        });
        await verify(user, 'flow-detail-from-list', async row => {
            const target = `/ui/main/flows/edit/${fixture.namespace}/${fixture.flowId}`;
            const links = await page.evaluate(target => [...document.querySelectorAll('tbody a[href]')]
                .filter(link => new URL(link.href).pathname.startsWith(target)).map(link => link.getAttribute('href')), target);
            if (!links.length) throw new Error('Allowed flow is missing from table links');
            await page.click(`a[href="${links[0]}"] >> nth=0`);
            await page.waitForFunction(target => location.pathname.startsWith(target), target);
            row.navigationVerified = true;
        });
        if (!user.write) {
            await verify(user, 'action:readonly-save-denied', async row => {
                const endpoint = `/api/v1/main/flows/${fixture.namespace}/${fixture.flowId}`;
                await page.goto(`${base}/ui/main/flows/edit/${fixture.namespace}/${fixture.flowId}/edit`);
                const before = await page.evaluate(async endpoint => (await (await fetch(endpoint)).json()).source, `${endpoint}?source=true`);
                await page.fill('[data-testid="monaco-editor-hidden-synced-textarea"]', `${before}\ndescription: forbidden-reader-edit\n`);
                await page.click('h1');
                await page.click('button:has-text("Save")');
                await page.waitForFunction(() => performance.getEntriesByType('resource').some(entry => entry.responseStatus === 403));
                const after = await page.evaluate(async endpoint => (await (await fetch(endpoint)).json()).source, `${endpoint}?source=true`);
                if (before !== after) throw new Error('Read-only browser save mutated persisted flow');
                row.refusalVerified = true;
                row.persistenceVerified = true;
            });
        }
        if (user.write) {
            const flowId = `browser-${user.name}-${Date.now()}`;
            const endpoint = `/api/v1/main/flows/${user.namespace}/${flowId}`;
            const yaml = description => `id: ${flowId}\nnamespace: ${user.namespace}\ndescription: ${description}\ntasks:\n  - id: result\n    type: io.kestra.plugin.core.debug.Return\n    format: verified\n`;
            const editor = async source => {
                await page.fill('[data-testid="monaco-editor-hidden-synced-textarea"]', source);
                await page.click('h1');
                await page.click('button:has-text("Save")');
            };
            const persisted = async description => {
                const result = await page.evaluate(async ({endpoint, description}) => {
                    const result = await fetch(endpoint);
                    if (!result.ok) return false;
                    const flow = await result.json();
                    return flow.description === description;
                }, {endpoint, description});
                if (!result) throw new Error('Browser mutation is not persisted');
            };
            await verify(user, 'action:flow-create', async row => {
                await page.goto(`${base}/ui/main/flows`);
                await page.click('[data-test="flows-create"]');
                await page.waitForFunction(() => location.pathname.endsWith('/flows/new'));
                await editor(yaml('browser-created'));
                await page.waitForFunction(id => location.pathname.includes(`/flows/edit/`) && location.pathname.includes(id), flowId);
                await persisted('browser-created');
                row.persistenceVerified = true;
            });
            await verify(user, 'action:flow-update', async row => {
                await page.goto(`${base}/ui/main/flows/edit/${user.namespace}/${flowId}/edit`);
                await editor(yaml('browser-updated'));
                await page.waitForFunction(async ({endpoint}) => {
                    const result = await fetch(endpoint);
                    return result.ok && (await result.json()).description === 'browser-updated';
                }, {endpoint});
                await persisted('browser-updated');
                row.persistenceVerified = true;
            });
            await verify(user, 'action:flow-execute', async row => {
                await page.goto(`${base}/ui/main/flows/edit/${user.namespace}/${flowId}/overview`);
                await page.click('[data-onboarding-target="flow-execute-button"] button');
                await page.click('[data-test="execute-dialog-button"]');
                await page.waitForFunction(() => location.pathname.includes('/executions/'));
                const executionId = await page.evaluate(() => {
                    const segments = location.pathname.split('/').filter(Boolean);
                    return segments[segments.indexOf('executions') + 3];
                });
                await page.waitForFunction(async executionId => {
                    const result = await fetch(`/api/v1/main/executions/${executionId}`);
                    return result.ok && (await result.json()).state?.current === 'SUCCESS';
                }, executionId);
                row.persistenceVerified = true;
            });
            await verify(user, 'action:flow-delete', async row => {
                await page.goto(`${base}/ui/main/flows/edit/${user.namespace}/${flowId}/edit`);
                await page.click('loc=role:button[name="Actions"]');
                await page.click('loc=role:menuitem[name="Delete"]');
                await page.waitForFunction(() => [...document.querySelectorAll('[role=dialog] button')]
                    .some(button => button.getClientRects().length && /^(OK|Confirm|Delete)$/i.test(button.textContent.trim())));
                const confirmName = await page.evaluate(() => [...document.querySelectorAll('[role=dialog] button')]
                    .filter(button => button.getClientRects().length && /^(OK|Confirm|Delete)$/i.test(button.textContent.trim())).at(-1).textContent.trim());
                await page.click(`loc=role:button[name="${confirmName}"]`);
                await page.waitForFunction(async endpoint => (await fetch(endpoint)).status === 404, endpoint);
                row.persistenceVerified = true;
            });
        }
        await browser.closePage(user.name);
    }
    await record({completed: true, rows});
    return rows;
}
