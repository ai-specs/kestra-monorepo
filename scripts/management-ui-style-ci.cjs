const {writeFile, mkdir} = require('node:fs/promises');
const {dirname, join} = require('node:path');
const {pathToFileURL} = require('node:url');

async function main() {
    const {chromium} = require('playwright');
    const {runManagementStyleChecks} = await import(pathToFileURL(join(__dirname, 'management-ui-style-cases.mjs')));
    const [base, output] = process.argv.slice(2);
    const browser = await chromium.launch({headless: true});
    try {
        const page = await browser.newPage({viewport: {width: 1600, height: 1000}});
        await mkdir(dirname(output), {recursive: true});
        await runManagementStyleChecks(page, base, report => writeFile(output, JSON.stringify(report, null, 2) + '\n'));
    } finally {
        await browser.close();
    }
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
