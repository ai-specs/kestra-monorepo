const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

async function main() {
    const {chromium} = require('playwright');
    const {runNamespaceUi} = await import(pathToFileURL(path.join(__dirname, 'blackbox-namespace-ui.mjs')));
    const fixture = JSON.parse(await fs.readFile(process.env.NAMESPACE_UI_FIXTURE, 'utf8'));
    const output = process.env.NAMESPACE_UI_REPORT;
    const engine = await chromium.launch({headless: true});
    const contexts = new Map();
    const adapter = {
        async page(user) {
            const context = await engine.newContext({locale: 'en-US', viewport: {width: 1600, height: 1000}});
            contexts.set(user, context);
            const page = await context.newPage();
            page.setDefaultTimeout(30000);
            return {
                goto: url => page.goto(url, {waitUntil: 'networkidle'}),
                fill: (selector, value) => page.locator(selector).fill(value),
                click: selector => {
                    const role = selector.match(/^loc=role:(\w+)\[name="(.+)"\]$/);
                    return role ? page.getByRole(role[1], {name: role[2], exact: true}).first().click()
                        : page.locator(selector).first().click();
                },
                evaluate: (callback, argument) => page.evaluate(callback, argument),
                waitForFunction: (callback, argument) => page.waitForFunction(callback, argument),
            };
        },
        async closePage(user) {
            await contexts.get(user).close();
            contexts.delete(user);
        },
    };
    try {
        await fs.mkdir(path.dirname(output), {recursive: true});
        await runNamespaceUi(adapter, process.env.NAMESPACE_UI_BASE, fixture,
            result => fs.writeFile(output, JSON.stringify(result, null, 2) + '\n'));
    } finally {
        await engine.close();
    }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
