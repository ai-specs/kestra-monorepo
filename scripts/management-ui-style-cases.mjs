const {base, spaceId} = globalThis.managementStyleInput ?? {base: 'http://localhost:8080', spaceId: 11}
const task = await taskSpace(Number(spaceId))
const page = task.page('p1')
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
}
function inspect(label) {
    return page.evaluate(theme => {
        const root = document.querySelector('[data-test="extension-container"]')?.shadowRoot
        const button = root?.querySelector('button.kel-button')
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
    await openManagement()
    await page.evaluate(() => localStorage.setItem('theme', 'light'))
    await page.reload()
    await page.waitForSelector('input[name="management-search"]')
    const light = await inspect('light')
    check('light uses published button component styles', light.button?.radius !== '0px' && !/^2px/.test(light.button?.border ?? ''), light)
    check('light uses published tab styles', light.tab?.fontSize === '11px' && light.tab?.fontWeight === '500' && light.tab?.radius === '6px', light)
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
    check('search filters rendered rows', rowsAfter === 0 && rowsAfter <= rowsBefore, {rowsBefore, rowsAfter})
    await page.fill('input[name="management-search"]', '')
    await page.waitForFunction(expected => (document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelectorAll('tbody tr').length ?? 0) === expected, rowsBefore)
    check('clearing search restores rows', true, {rowsBefore})
    report.completed = true
} finally {
    console.log(JSON.stringify(report, null, 2))
}
