export function adminUiCases(fixture) {
    for (const key of ['namespace', 'flowId', 'executionId']) {
        if (!fixture[key] || typeof fixture[key] !== 'string') throw new Error(`Missing UI fixture ${key}`);
    }
    const cases = [];
    const add = (path, content) => cases.push({path, content});
    const pages = {
        dashboards: 'dashboard', flows: 'flow', 'flows/search': 'flow', 'flows/new': 'flow',
        executions: 'execution', kv: 'key|value|namespace', secrets: 'secret',
        'blueprints/flow/community': 'blueprint', plugins: 'plugin', logs: 'log',
        namespaces: 'namespace', docs: 'What is Kestra\\?', preferences: 'preference|settings',
        'admin/triggers': 'trigger', 'admin/stats': 'statistic|usage',
        'admin/concurrency-limits': 'concurrency', 'admin/mcp-servers': 'MCP',
        'admin/mcp-servers/new': 'MCP', apps: 'app', tests: 'test', assets: 'asset', cases: 'case',
        'admin/iam': 'access|identity|IAM', 'admin/tenants/list': 'tenant',
        'admin/auditlogs': 'audit', 'admin/quotas': 'quota', 'admin/policies': 'polic',
        'admin/instance': 'instance', 'promote/targets': 'promot|target',
    };
    for (const [path, content] of Object.entries(pages)) add(path === 'admin/triggers' ? 'admin/triggers/add' : path, content);
    for (const tab of ['overview', 'executions', 'edit', 'promote', 'revisions', 'triggers', 'logs', 'metrics', 'dependencies', 'concurrency', 'audit-logs']) {
        add(`flows/edit/${encodeURIComponent(fixture.namespace)}/${encodeURIComponent(fixture.flowId)}/${tab}`, fixture.flowId);
    }
    for (const tab of ['overview', 'gantt', 'logs', 'outputs', 'metrics', 'dependencies', 'audit-logs', 'assets']) {
        add(`executions/${encodeURIComponent(fixture.namespace)}/${encodeURIComponent(fixture.flowId)}/${encodeURIComponent(fixture.executionId)}/${tab}`, fixture.executionId);
    }
    for (const tab of ['blueprints', 'overview', 'edit', 'flows', 'executions', 'dependencies', 'secrets', 'credentials', 'assets', 'variables', 'policies', 'kv', 'reusable-inputs', 'files', 'history', 'audit-logs']) {
        add(`namespaces/edit/${encodeURIComponent(fixture.namespace)}/${tab}`, fixture.namespace.split('.').at(-1));
    }
    for (const tab of ['edit', 'connect', 'tool-flows']) add(`admin/mcp-servers/edit/default/${tab}`, 'MCP|default');
    return cases;
}
