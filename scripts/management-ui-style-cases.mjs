export async function runManagementStyleChecks(page, base, record = async () => {}) {
const report = {completed: false, checks: []}
const check = (name, passed, evidence = {}) => {
    report.checks.push({name, passed, ...evidence})
    if (!passed) throw new Error(name)
}
async function login() {
    await page.goto(`${base}/ui/`)
    await page.waitForFunction(() => location.pathname.startsWith('/ui/main/') || Boolean(document.querySelector('input[name="username"]')))
    if (await page.evaluate(() => location.pathname.startsWith('/ui/main/'))) return
    await page.fill('input[name="username"]', 'tester')
    await page.fill('input[name="password"]', 'Passw0rd!')
    await page.click('button[type="submit"]')
    await page.waitForFunction(() => location.pathname === '/ui/main/dashboards')
}
async function openManagement() {
    await page.goto(`${base}/ui/main/extensions/rbac`)
    await page.waitForSelector('[data-test="extension-container"]')
    await page.waitForSelector('input[name="management-search"]')
    await page.waitForFunction(() => document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy') === 'false')
}
function inspect(label) {
    return page.evaluate(theme => {
        const root = document.querySelector('[data-test="extension-container"]')?.shadowRoot
        const button = root?.querySelector('button.kel-button:not(:disabled)')
        const tab = root?.querySelector('.kel-tabs__item')
        const header = root?.querySelector('.kel-table__header-wrapper th, th')
        const row = root?.querySelector('.kel-table__body-wrapper td, tbody td')
        const input = root?.querySelector('input[name="management-search"]')
        const style = element => element && (() => { const value = getComputedStyle(element); return {fontSize: value.fontSize, fontWeight: value.fontWeight, border: value.border, borderBottomWidth: value.borderBottomWidth, borderBottomStyle: value.borderBottomStyle, radius: value.borderRadius, background: value.backgroundColor, color: value.color} })()
        return {theme, button: style(button), tab: style(tab), header: style(header), row: style(row), search: Boolean(input), path: location.pathname}
    }, label)
}
try {
    await login()
    await page.goto(`${base}/ui/main/admin/mcp-servers/edit/default/edit`)
    await page.waitForSelector('[role="tab"]')
    const reference = await page.evaluate(() => {
        const tab = document.querySelector('[role="tab"]')
        const button = document.querySelector('button.kel-button:not(:disabled)')
        const style = getComputedStyle(tab)
        return {fontSize: style.fontSize, fontWeight: style.fontWeight, radius: style.borderRadius, buttonRadius: button ? getComputedStyle(button).borderRadius : null}
    })
    await page.goto(`${base}/ui/main/namespaces`)
    await page.waitForSelector('input[placeholder="Search namespaces"]')
    const namespaceReference = await page.evaluate(() => {
        const input = document.querySelector('input[placeholder="Search namespaces"]')
        return {fontSize: getComputedStyle(input).fontSize, componentClass: input.className, layout: document.querySelector('[role="tree"]') ? 'tree' : 'table'}
    })
    await openManagement()
    const setup = await page.evaluate(async () => {
        const token = document.querySelector('meta[name="csrf-token"]')?.content
        const response = await fetch('/api/v1/main/extensions/rbac/policy')
        let policy = await response.json()
        for (const id of ['style-alpha', 'style-beta']) {
            if (policy.policy.roles.some(role => role.id === id)) continue
            const saved = await fetch('/api/v1/main/extensions/rbac/roles', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-CSRF-TOKEN': token, 'If-Match': '"' + policy.revision + '"'}, body: JSON.stringify({id, name: id, description: 'Style acceptance', grants: []})})
            if (!saved.ok) return false
            policy = await saved.json()
        }
        return true
    })
    check('style test roles exist through authenticated management API', setup)
    await page.evaluate(() => localStorage.setItem('theme', 'light'))
    await page.reload()
    await page.waitForSelector('input[name="management-search"]')
    const light = await inspect('light')
    check('tabs and buttons match MCP Servers metrics', light.tab?.fontSize === reference.fontSize && light.tab?.fontWeight === reference.fontWeight && light.tab?.radius === reference.radius && light.button?.radius === reference.buttonRadius, {reference, light})
    check('light uses published button component styles', light.button?.radius !== '0px' && !/^2px/.test(light.button?.border ?? ''), light)
    check('light uses published tab styles', light.tab?.fontSize === '11px' && light.tab?.fontWeight === '500' && light.tab?.radius === '6px', light)
    check('search uses Namespaces component typography', await page.evaluate(reference => {
        const input = document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('input[name="management-search"]')
        return input.classList.contains('kel-input__inner') && getComputedStyle(input).fontSize === reference.fontSize
    }, namespaceReference), {namespaceReference})
    check('light renders search and table separation', light.search && Boolean(light.header) && Number.parseFloat(light.row?.borderBottomWidth) > 0 && light.row?.borderBottomStyle === 'solid', light)
    await page.evaluate(() => localStorage.setItem('theme', 'dark'))
    await page.reload()
    await page.waitForSelector('input[name="management-search"]')
    const dark = await inspect('dark')
    check('dark theme changes component surface colors', dark.button?.background !== light.button?.background && dark.header?.background !== light.header?.background, dark)
    check('dark preserves published tab metrics', dark.tab?.fontSize === '11px' && dark.tab?.fontWeight === '500' && dark.tab?.radius === '6px', dark)
    const rowsBefore = await page.evaluate(() => document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelectorAll('tbody tr').length ?? 0)
    await page.fill('input[name="management-search"]', '__management_style_no_match__')
    await page.waitForFunction(() => (document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelectorAll('tbody tr').length ?? 0) === 0)
    const rowsAfter = await page.evaluate(() => document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelectorAll('tbody tr').length ?? 0)
    check('search filters rendered rows', rowsAfter === 0 && rowsBefore >= 2, {rowsBefore, rowsAfter})
    await page.fill('input[name="management-search"]', '')
    await page.waitForFunction(expected => (document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelectorAll('tbody tr').length ?? 0) === expected, rowsBefore)
    check('clearing search restores rows', true, {rowsBefore})
    for (const theme of ['light', 'dark']) {
        await page.evaluate(value => localStorage.setItem('theme', value), theme)
        for (const section of ['roles', 'users', 'bindings']) {
            await page.goto(new URL('/ui/main/extensions/rbac/' + section, base).href)
            await page.waitForSelector('input[name="management-search"]')
            await page.waitForFunction(() => document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy') === 'false')
            const before = await page.evaluate(() => document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('tbody tr').length)
            await page.fill('input[name="management-search"]', '__management_style_no_match__')
            await page.waitForFunction(() => document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('tbody tr').length === 0)
            await page.fill('input[name="management-search"]', '')
            await page.waitForFunction(expected => document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('tbody tr').length === expected, before)
            check(`${theme} ${section} search and clear`, true, {before})
        }
    }
    report.completed = true
} finally {
    await record(report)
}
return report
}
