// Deployment acceptance contract. Drivers obtain identities through the production
// issuer and execute real UI/REST/MCP operations; these values never inject claims.
export const applicationProject = 'kestra'
export const scopeNames = Object.freeze({
  readA: 'kestra:acceptance:a-read',
  writeB: 'kestra:acceptance:b-operate',
  readOnlyA: 'kestra:acceptance:a-read-only',
  listOnlyA: 'kestra:acceptance:a-list-only',
  listOnlyB: 'kestra:acceptance:b-list-only',
  exactA: 'kestra:acceptance:a-exact',
  restrictedId: 'kestra:acceptance:a-one-flow',
  restrictedIdB: 'kestra:acceptance:b-one-flow',
  readOnlyIdA: 'kestra:acceptance:a-one-read',
  listOnlyOtherIdA: 'kestra:acceptance:a-other-list',
  unbound: 'kestra:acceptance:unbound',
  deleteB: 'kestra:acceptance:b-delete',
  outputsA: 'kestra:acceptance:a-outputs',
  identityManager: 'kestra:acceptance:identity-manage',
  policyManager: 'kestra:acceptance:policy-manage',
  mcpLocalOperate: 'kestra:acceptance:mcp-local-operate',
  mcpDirectoryOperate: 'kestra:acceptance:mcp-directory-operate',
  mcpSubjectOperate: 'kestra:acceptance:mcp-subject-operate',
})
export const namespaceDomains = Object.freeze({a: 'scope.acceptance.a', b: 'scope.acceptance.b', outside: 'scope.acceptance.outside'})
const probe = (namespace, action, allowed, extra = {}) => Object.freeze({namespace, resource: 'FLOW', action, allowed, ...extra})
export const projectScopeCases = Object.freeze([
  {id: 'reader', scopes: [scopeNames.readA], probes: [
    probe(namespaceDomains.a, 'READ', true), probe(namespaceDomains.a, 'LIST', true),
    ...['CREATE', 'UPDATE', 'DELETE', 'EXECUTE'].map(action => probe(namespaceDomains.a, action, false)),
    probe(namespaceDomains.a, 'ACCESS_OUTPUTS', false, {resource: 'EXECUTION'}),
    probe(namespaceDomains.outside, 'READ', false),
  ]},
  {id: 'writer', scopes: [scopeNames.writeB], probes: [
    ...['READ', 'LIST', 'CREATE', 'UPDATE', 'EXECUTE'].map(action => probe(namespaceDomains.b, action, true)),
    probe(namespaceDomains.b, 'DELETE', false), probe(namespaceDomains.a, 'UPDATE', false),
    probe(namespaceDomains.outside, 'CREATE', false),
  ]},
  {id: 'delete-is-independent', scopes: [scopeNames.deleteB], probes: [
    probe(namespaceDomains.b, 'DELETE', true), probe(namespaceDomains.a, 'DELETE', false),
    probe(namespaceDomains.b, 'UPDATE', false),
  ]},
  {id: 'outputs-are-independent', scopes: [scopeNames.outputsA], probes: [
    probe(namespaceDomains.a, 'ACCESS_OUTPUTS', true, {resource: 'EXECUTION'}),
    probe(namespaceDomains.b, 'ACCESS_OUTPUTS', false, {resource: 'EXECUTION'}),
    probe(namespaceDomains.a, 'UPDATE', false),
  ]},
  {id: 'multiple-complete-scopes', scopes: [scopeNames.readA, scopeNames.writeB], probes: [
    probe(namespaceDomains.a, 'READ', true), probe(namespaceDomains.a, 'LIST', true),
    probe(namespaceDomains.a, 'UPDATE', false), probe(namespaceDomains.b, 'READ', true),
    probe(namespaceDomains.b, 'UPDATE', true), probe(namespaceDomains.outside, 'READ', false),
    probe(namespaceDomains.outside, 'UPDATE', false),
  ]},
  {id: 'same-namespace-split-read-list', scopes: [scopeNames.readOnlyA, scopeNames.listOnlyA], probes: [
    probe(namespaceDomains.a, 'READ', true), probe(namespaceDomains.a, 'LIST', false),
  ]},
  {id: 'different-namespace-split-read-list', scopes: [scopeNames.readOnlyA, scopeNames.listOnlyB], probes: [
    probe(namespaceDomains.a, 'LIST', false), probe(namespaceDomains.b, 'LIST', false),
  ]},
  {id: 'exact-namespace', scopes: [scopeNames.exactA], probes: [
    probe(namespaceDomains.a, 'READ', true), probe(namespaceDomains.a + '.child', 'READ', false),
    probe(namespaceDomains.a + '2', 'READ', false),
  ]},
  {id: 'resource-id-boundary', scopes: [scopeNames.restrictedId], probes: [
    probe(namespaceDomains.a, 'READ', true, {resourceId: 'allowed-id'}),
    probe(namespaceDomains.a, 'UPDATE', true, {resourceId: 'allowed-id'}),
    probe(namespaceDomains.a, 'LIST', true, {expectedIds: ['allowed-id']}),
    probe(namespaceDomains.a, 'READ', false, {resourceId: 'other-id'}),
    probe(namespaceDomains.b, 'READ', false, {resourceId: 'allowed-id'}),
  ]},
  {id: 'correlated-namespace-id-union', scopes: [scopeNames.restrictedId, scopeNames.restrictedIdB], probes: [
    probe(namespaceDomains.a, 'READ', true, {resourceId: 'allowed-id'}),
    probe(namespaceDomains.b, 'READ', true, {resourceId: 'other-id'}),
    probe(namespaceDomains.a, 'READ', false, {resourceId: 'other-id'}),
    probe(namespaceDomains.b, 'READ', false, {resourceId: 'allowed-id'}),
    probe(namespaceDomains.a, 'LIST', true, {expectedIds: ['allowed-id']}),
    probe(namespaceDomains.b, 'LIST', true, {expectedIds: ['other-id']}),
  ]},
  {id: 'resource-id-split-read-list', scopes: [scopeNames.readOnlyIdA, scopeNames.listOnlyOtherIdA], probes: [
    probe(namespaceDomains.a, 'READ', true, {resourceId: 'allowed-id'}),
    probe(namespaceDomains.a, 'READ', false, {resourceId: 'other-id'}),
    probe(namespaceDomains.a, 'LIST', false),
  ]},
  {id: 'known-plus-unbound-project-scope', scopes: [scopeNames.readA, scopeNames.unbound], probes: [
    probe(namespaceDomains.a, 'READ', false), probe(namespaceDomains.a, 'LIST', false),
    probe(namespaceDomains.a, 'UPDATE', false),
  ]},
  {id: 'protocol-only', scopes: [], probes: [
    probe(namespaceDomains.a, 'READ', false), probe(namespaceDomains.a, 'LIST', false),
    probe(namespaceDomains.b, 'UPDATE', false),
  ]},
].map(value => Object.freeze({...value, scopes: Object.freeze(value.scopes), probes: Object.freeze(value.probes)})))

export const legacyMigrationChecks = Object.freeze([
  'migration-preview-explicit-approval', 'migration-stale-review-no-change',
  'migration-legacy-subject-no-scope', 'migration-legacy-role-no-scope',
  'migration-old-ui-cookie', 'migration-old-idp-session', 'migration-old-access',
  'migration-old-refresh', 'migration-old-code', 'migration-old-mcp-session',
  'migration-identity-only-partial', 'migration-local-only-partial',
  'migration-old-api-writes-removed', 'migration-backup-rollback',
])

export const requiredProjectChecks = Object.freeze([
  'production-ui-login-canonical-path', 'ui-role-grant-edit-refresh',
  'ui-client-membership-approval', 'ui-subject-grant-revoke', 'ui-zero-grant-logout-switch',
  'ui-light', 'ui-dark', 'ui-dark-2', 'ui-system', 'ui-narrow', 'ui-languages',
  'ui-filter-search-pagination', 'ui-keyboard-focus', 'ui-empty-loading-error-conflict',
  'mcp-capability-without-project', 'mcp-project-without-capability',
  'mcp-known-plus-unbound-list', 'mcp-known-plus-unbound-call',
  'mcp-same-session-local-revoke', 'mcp-same-session-directory-revoke',
  'ui-subject-revoke', 'rest-subject-revoke', 'mcp-subject-revoke', 'refresh-cannot-restore-revoked-scope',
  'wrong-issuer', 'wrong-audience', 'wrong-project', 'wrong-tenant',
  'directory-unavailable', 'policy-unavailable', 'missing-extension', 'feature-disabled-regression',
  'list-total-pagination-aggregate', 'denied-write-no-delayed-side-effects',
  'legacy-write-api-removed',
  'last-identity-administrator', 'last-local-policy-administrator',
  'ui-create-project-explicit-local-policy-target', 'local-policy-unapproved-project-denied',
  'management-target-action-cross-scope-denied', 'reconciliation-complete-project-atomic',
  'oauth-error-callback-preserves-session', 'oauth-error-callback-state-rejection',
])
