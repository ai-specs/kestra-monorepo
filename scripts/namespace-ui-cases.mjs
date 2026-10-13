export function namespaceUiCases(fixture) {
    for (const key of ['namespace', 'flowId', 'executionId']) {
        if (typeof fixture[key] !== 'string' || !fixture[key]) throw new Error(`Missing fixture ${key}`);
    }
    const cases = [
        {path: 'dashboards', content: 'dashboard'},
        {path: 'flows', content: 'flow'},
        {path: 'executions', content: 'execution'},
        {path: 'logs', content: 'log'},
        {path: 'namespaces', content: 'namespace'},
        {path: 'kv', content: 'key|value|namespace'},
        {path: 'plugins', content: 'plugin'},
        {path: 'preferences', content: 'preference|settings'},
    ];
    for (const tab of ['overview', 'executions', 'edit', 'revisions', 'triggers', 'logs', 'metrics', 'dependencies']) {
        cases.push({path: `flows/edit/${fixture.namespace}/${fixture.flowId}/${tab}`, content: fixture.flowId});
    }
    for (const tab of ['overview', 'gantt', 'logs', 'outputs', 'metrics', 'dependencies']) {
        cases.push({path: `executions/${fixture.namespace}/${fixture.flowId}/${fixture.executionId}/${tab}`, content: fixture.executionId});
    }
    for (const tab of ['overview', 'edit', 'flows', 'executions', 'dependencies', 'kv', 'files']) {
        cases.push({path: `namespaces/edit/${fixture.namespace}/${tab}`, content: fixture.namespace.split('.').at(-1)});
    }
    return cases;
}

export const namespaceUsers = [
    {name: 'reader', username: 'rbac-reader', password: 'ReaderPass123!', namespace: 'rbac.allowed', write: false},
    {name: 'writer', username: 'rbac-writer', password: 'WriterPass123!', namespace: 'rbac.allowed', write: true},
    {name: 'multi', username: 'rbac-multi', password: 'MultiPass123!', namespace: 'rbac.allowed', write: true},
    {name: 'exact', username: 'rbac-exact', password: 'ExactPass123!', namespace: 'rbac.allowed', write: false},
];
