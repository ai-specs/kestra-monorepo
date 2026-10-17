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
    await page.waitForSelector('.ks-search input')
    await page.waitForFunction(() => document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy') === 'false')
    if (await page.evaluate(() => [...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('button')].some(button => button.textContent.trim() === 'Clear all' && !button.disabled))) await page.click('button:has-text("Clear all")')
}
function inspect(label) {
    return page.evaluate(theme => {
        const root = document.querySelector('[data-test="extension-container"]')?.shadowRoot
        const button = root?.querySelector('button.kel-button:not(:disabled)')
        const tab = root?.querySelector('.kel-tabs__item')
        const header = root?.querySelector('.kel-table__header-wrapper th, th')
        const row = root?.querySelector('.kel-table__body-wrapper td, tbody td')
        const input = root?.querySelector('.ks-search input')
        const style = element => element && (() => { const value = getComputedStyle(element); return {fontSize: value.fontSize, fontWeight: value.fontWeight, border: value.border, borderBottomWidth: value.borderBottomWidth, borderBottomStyle: value.borderBottomStyle, radius: value.borderRadius, background: value.backgroundColor, color: value.color} })()
        return {theme, button: style(button), tab: style(tab), header: style(header), row: style(row), search: Boolean(input), path: location.pathname}
    }, label)
}
try {
    await login()
    if (await page.evaluate(() => [...document.querySelectorAll('.pwa-install-actions button')].some(button => button.textContent.trim() === 'Not now'))) await page.click('.pwa-install-actions button:has-text("Not now")')
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
    await page.waitForSelector('.ks-search input')
    const light = await inspect('light')
    check('tabs attach directly below host navigation without duplicate page title', await page.evaluate(() => {
        const container = document.querySelector('[data-test="extension-container"]')
        const root = container.shadowRoot
        return !root.querySelector('h1') && Math.abs(root.querySelector('.kel-tabs').getBoundingClientRect().top - container.getBoundingClientRect().top) < 2
    }))
    check('lists use host data-table and filter containers', await page.evaluate(() => {
        const root = document.querySelector('[data-test="extension-container"]').shadowRoot
        return Boolean(root.querySelector('.ks-data-table-wrapper')) && Boolean(root.querySelector('.filter')) && [...root.querySelectorAll('button')].some(button => button.textContent.trim() === 'Add filters')
    }))
    check('tabs and buttons match MCP Servers metrics', light.tab?.fontSize === reference.fontSize && light.tab?.fontWeight === reference.fontWeight && light.tab?.radius === reference.radius && light.button?.radius === reference.buttonRadius, {reference, light})
    check('light uses published button component styles', light.button?.radius !== '0px' && !/^2px/.test(light.button?.border ?? ''), light)
    check('light uses published tab styles', light.tab?.fontSize === '11px' && light.tab?.fontWeight === '500' && light.tab?.radius === '6px', light)
    check('search uses Namespaces component typography', await page.evaluate(reference => {
        const input = document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.ks-search input')
        return input.classList.contains('kel-input__inner') && getComputedStyle(input).fontSize === reference.fontSize
    }, namespaceReference), {namespaceReference})
    check('light renders search and table separation', light.search && Boolean(light.header) && Number.parseFloat(light.row?.borderBottomWidth) > 0 && light.row?.borderBottomStyle === 'solid', light)
    await page.evaluate(() => localStorage.setItem('theme', 'dark'))
    await page.reload()
    await page.waitForSelector('.ks-search input')
    const dark = await inspect('dark')
    check('dark theme changes component surface colors', dark.button?.background !== light.button?.background && dark.header?.background !== light.header?.background, dark)
    check('dark preserves published tab metrics', dark.tab?.fontSize === '11px' && dark.tab?.fontWeight === '500' && dark.tab?.radius === '6px', dark)
    const rowsBefore = await page.evaluate(() => document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelectorAll('tbody tr').length ?? 0)
    await page.fill('.ks-search input', '__management_style_no_match__')
    await page.waitForFunction(() => (document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelectorAll('tbody tr').length ?? 0) === 0)
    const rowsAfter = await page.evaluate(() => document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelectorAll('tbody tr').length ?? 0)
    check('search filters rendered rows', rowsAfter === 0 && rowsBefore >= 2, {rowsBefore, rowsAfter})
    await page.fill('.ks-search input', '')
    await page.waitForFunction(expected => (document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelectorAll('tbody tr').length ?? 0) === expected, rowsBefore)
    check('clearing search restores rows', true, {rowsBefore})
    const directorySetup = await page.evaluate(async () => {
        const token = document.querySelector('meta[name="csrf-token"]').content
        const existing = await (await fetch('/api/v1/main/extensions/rbac/users?page=1&size=100')).json()
        for (let index = 0; index < 21; index++) {
            const username = 'style-user-' + String(index).padStart(2, '0')
            if (existing.items.some(user => user.subject === username)) continue
            const response = await fetch('/api/v1/main/extensions/rbac/users', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-CSRF-TOKEN': token}, body: JSON.stringify({username, name: username, email: username + '@example.invalid', password: 'StyleAcceptance123!'})})
            if (!response.ok) return false
        }
        let policy = await (await fetch('/api/v1/main/extensions/rbac/policy')).json()
        for (const suffix of ['alpha', 'beta']) {
            const response = await fetch('/api/v1/main/extensions/rbac/role-mappings', {method: 'PUT', headers: {'Content-Type': 'application/json', 'X-CSRF-TOKEN': token, 'If-Match': '"' + policy.revision + '"'}, body: JSON.stringify({trustedRole: 'style-claim-' + suffix, roles: ['style-' + suffix]})})
            if (!response.ok) return false
            policy = await response.json()
        }
        return true
    })
    check('directory spans multiple display pages', directorySetup)
    await page.goto(new URL('/ui/main/extensions/rbac/users', base).href)
    await page.waitForSelector('.ks-search input')
    if (await page.evaluate(() => [...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('button')].some(button => button.textContent.trim() === 'Clear all' && !button.disabled))) await page.click('button:has-text("Clear all")')
    await page.waitForSelector('.kel-pagination')
    await page.click('.kel-pagination button.btn-next')
    await page.waitForFunction(() => document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.kel-pager .is-active')?.textContent.trim() === '2')
    check('host-style pagination advances displayed page', true)
    await page.click('.kel-pagination button.btn-prev')
    await page.waitForFunction(() => document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.kel-pager .is-active')?.textContent.trim() === '1')
    check('host-style pagination returns to first page', true)
    for (const theme of ['light', 'dark']) {
        await page.evaluate(value => localStorage.setItem('theme', value), theme)
        for (const section of ['roles', 'users', 'bindings']) {
            await page.goto(new URL('/ui/main/extensions/rbac/' + section, base).href)
            await page.waitForSelector('.ks-search input')
            await page.waitForFunction(() => document.querySelector('[data-test="extension-container"]')?.shadowRoot?.querySelector('main')?.getAttribute('aria-busy') === 'false')
            if (await page.evaluate(() => [...document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('button')].some(button => button.textContent.trim() === 'Clear all' && !button.disabled))) await page.click('button:has-text("Clear all")')
            await page.waitForFunction(() => {
                const root = document.querySelector('[data-test="extension-container"]').shadowRoot
                return root.querySelector('.ks-search input')?.value === '' && root.querySelectorAll('tbody tr').length >= 2
            })
            const before = await page.evaluate(() => document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('tbody tr').length)
            check(`${theme} ${section} has searchable test data`, before >= 2, {before})
            const query = section === 'roles' ? 'style-alpha' : section === 'users' ? 'style-user-20' : 'style-claim-alpha'
            await page.fill('.ks-search input', query)
            await page.waitForFunction(expected => {
                const root = document.querySelector('[data-test="extension-container"]').shadowRoot
                return root.querySelectorAll('tbody tr').length === 1 && root.querySelector('tbody').textContent.includes(expected)
            }, query)
            check(`${theme} ${section} search selects matching record`, true, {query})
            await page.click('button:has-text("Clear all")')
            await page.waitForFunction(() => document.querySelector('[data-test="extension-container"]').shadowRoot.querySelector('.ks-search input').value === '')
            await page.click('button:has-text("Add filters")')
            const field = section === 'roles' ? 'Name' : section === 'users' ? 'User identity' : 'Trusted identity role'
            await page.click('button[aria-label="Add filter for ' + field + '"]')
            await page.waitForSelector('.edit-popup input')
            const condition = section === 'roles' ? 'style-alpha' : section === 'users' ? 'style-user-20' : 'style-claim-alpha'
                await page.fill('.edit-popup input', condition)
                await page.waitForFunction(expected => {
                    const root = document.querySelector('[data-test="extension-container"]').shadowRoot
                    return root.querySelectorAll('tbody tr').length === 1 && root.querySelector('tbody').textContent.includes(expected)
                }, condition)
            check(`${theme} ${section} native condition filter applies inside ShadowRoot`, await page.evaluate(() => {
                return document.querySelectorAll('.edit-overlay').length === 0 && document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('.edit-overlay').length === 1
            }))
            await page.click('.edit-popup button[aria-label="Close"]')
            await page.reload()
            await page.waitForFunction(expected => {
                const root = document.querySelector('[data-test="extension-container"]')?.shadowRoot
                return root?.querySelectorAll('tbody tr').length === 1 && root.querySelector('tbody').textContent.includes(expected)
            }, condition)
            check(`${theme} ${section} condition survives refresh`, true)
            await page.click('button:has-text("Clear all")')
            await page.fill('.ks-search input', '__management_style_no_match__')
            await page.waitForFunction(() => document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('tbody tr').length === 0)
            await page.fill('.ks-search input', '')
            await page.waitForFunction(expected => document.querySelector('[data-test="extension-container"]').shadowRoot.querySelectorAll('tbody tr').length === expected, before)
            check(`${theme} ${section} search and clear`, true, {before})
            if (section === 'users') {
                await page.fill('.ks-search input', 'style-user-20')
                await page.waitForFunction(() => {
                    const root = document.querySelector('[data-test="extension-container"]').shadowRoot
                    return root.querySelectorAll('tbody tr').length === 1 && root.querySelector('tbody').textContent.includes('style-user-20')
                })
                check(`${theme} user search includes other display pages`, true)
                await page.fill('.ks-search input', '')
            }
        }
    }
    report.completed = true
} finally {
    await record(report)
}
return report
}
