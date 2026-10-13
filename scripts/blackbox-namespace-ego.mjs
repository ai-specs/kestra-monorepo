const fs = await import('node:fs/promises');
const {pathToFileURL} = await import('node:url');
const {runNamespaceUi} = await import(pathToFileURL(`${process.cwd()}/scripts/blackbox-namespace-ui.mjs`));
const fixture = JSON.parse(await fs.readFile(process.env.NAMESPACE_UI_FIXTURE, 'utf8'));
const task = await taskSpace(Number(process.env.NAMESPACE_UI_SPACE));
const page = task.page('p1');
const adapter = {
    async page() {
        await page.goto(`${process.env.NAMESPACE_UI_BASE}/oidc/logout`).catch(error => {
            if (!String(error).includes('ERR_ABORTED')) throw error;
        });
        return page;
    },
    async closePage() {},
};
await runNamespaceUi(adapter, process.env.NAMESPACE_UI_BASE, fixture,
    result => fs.writeFile(process.env.NAMESPACE_UI_REPORT, JSON.stringify(result, null, 2) + '\n'));
