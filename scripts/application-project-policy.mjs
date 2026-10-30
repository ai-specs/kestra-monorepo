import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {scopeNames, namespaceDomains, applicationProject, projectScopeCases} from './application-project-cases.mjs'

const complete = (namespace, resource, actions, descendants = true, ids = []) => ({scope: 'NAMESPACE', tenant: 'main', namespace, descendants,
  resource, actions: [...actions], ids: [...ids], allIds: ids.length === 0})
const metadata = () => ({scope: 'TENANT', tenant: 'main', namespace: null, descendants: false, resource: 'METADATA', actions: ['READ', 'LIST'], ids: [], allIds: true})
const serverRead = () => ({scope: 'TENANT', tenant: 'main', namespace: null, descendants: false, resource: 'MCP_SERVER', actions: ['READ', 'LIST'], ids: [], allIds: true})
const reader = (namespace, descendants = true) => [
  ...['FLOW', 'EXECUTION', 'NAMESPACE', 'LOG', 'METRIC', 'TRIGGER', 'KVSTORE', 'NAMESPACE_FILE'].map(resource => complete(namespace, resource, ['READ', 'LIST'], descendants)),
  metadata(), serverRead(),
]
const scope = (description, grants, managementGrants = []) => ({description, enabled: true, grants, managementGrants})
export function localApplicationPolicy({issuer, audiences}) {
  assert(new URL(issuer).origin === issuer, 'Acceptance issuer must be an exact origin')
  assert(Array.isArray(audiences) && audiences.length && audiences.every(value => typeof value === 'string' && value.length && !value.includes('*')))
  const scopes = {
    [scopeNames.readA]: scope('A complete read', reader(namespaceDomains.a)),
    [scopeNames.writeB]: scope('B complete operate', [
      complete(namespaceDomains.b, 'FLOW', ['READ', 'LIST', 'CREATE', 'UPDATE', 'EXECUTE']),
      complete(namespaceDomains.b, 'EXECUTION', ['READ', 'LIST', 'CREATE', 'ACCESS_OUTPUTS']),
      ...['NAMESPACE', 'LOG', 'METRIC', 'TRIGGER'].map(resource => complete(namespaceDomains.b, resource, ['READ', 'LIST'])),
      ...['KVSTORE', 'NAMESPACE_FILE'].map(resource => complete(namespaceDomains.b, resource, ['READ', 'LIST', 'CREATE', 'UPDATE'])),
      metadata(), serverRead(),
    ]),
    [scopeNames.deleteB]: scope('B read and deletion without update', [complete(namespaceDomains.b, 'FLOW', ['READ','DELETE']), metadata()]),
    [scopeNames.outputsA]: scope('A execution read/list and output access without update', [complete(namespaceDomains.a, 'EXECUTION', ['READ','LIST','ACCESS_OUTPUTS']), metadata()]),
    [scopeNames.readOnlyA]: scope('A READ without LIST', [complete(namespaceDomains.a, 'FLOW', ['READ']), metadata()]),
    [scopeNames.listOnlyA]: scope('A LIST without READ', [complete(namespaceDomains.a, 'FLOW', ['LIST']), metadata()]),
    [scopeNames.listOnlyB]: scope('B LIST without READ', [complete(namespaceDomains.b, 'FLOW', ['LIST']), metadata()]),
    [scopeNames.exactA]: scope('A exact namespace read', reader(namespaceDomains.a, false)),
    [scopeNames.restrictedId]: scope('Only the named A flow', [complete(namespaceDomains.a, 'FLOW', ['READ', 'LIST', 'UPDATE'], false, ['allowed-id']), metadata()]),
    [scopeNames.restrictedIdB]: scope('Only the named B flow', [complete(namespaceDomains.b, 'FLOW', ['READ', 'LIST'], false, ['other-id']), metadata()]),
    [scopeNames.readOnlyIdA]: scope('A named flow READ without LIST', [complete(namespaceDomains.a, 'FLOW', ['READ'], false, ['allowed-id']), metadata()]),
    [scopeNames.listOnlyOtherIdA]: scope('A different named flow LIST without READ', [complete(namespaceDomains.a, 'FLOW', ['LIST'], false, ['other-id']), metadata()]),
    [scopeNames.identityManager]: scope('Explicit application group management', [metadata()], [{domain: 'IDENTITY', actions: ['READ', 'MANAGE'], applicationGroupIds: []}]),
    [scopeNames.policyManager]: scope('Explicit Kestra application policy management', [metadata()], [{domain: 'LOCAL_POLICY', actions: ['READ', 'MANAGE'], applicationGroupIds: []}]),
  }
  return {schemaVersion: 2, applicationGroups: {[applicationProject]: {issuer, audiences: [...audiences], enabled: true, scopes}}}
}
const roleName = key => key===scopeNames.identityManager?'Application group administrator':key===scopeNames.policyManager?'Kestra application policy administrator':key.replace(/^acceptance-/, '').split('-').map(word => word[0].toUpperCase() + word.slice(1)).join(' ')
export function directoryScopeInputs(localPolicy) {
  const project = localPolicy.applicationGroups[applicationProject]
  const definitions = Object.entries(project.scopes).map(([key, definition]) => ({key, name: roleName(key), description: definition.description}))
  definitions.push({key: scopeNames.unbound, name: 'Unassigned application role', description: 'Defined group role without a Kestra resource policy'})
  assert(definitions.every(definition => /^[a-z][a-z0-9-]{0,63}$/.test(definition.key)), 'Invalid group scope key')
  assert.equal(new Set(definitions.map(definition => definition.key)).size, definitions.length, 'Duplicate scope key')
  assert.equal(new Set(definitions.map(definition => definition.name)).size, definitions.length, 'Duplicate role name')
  return definitions
}
export const projectTestAccounts = Object.freeze(projectScopeCases.map((item, index) => Object.freeze({caseId: item.id,
  username: 'scope-test-' + String(index + 1).padStart(2, '0'), password: 'ProjectScopeTest123!', applicationGroupScopes: item.scopes})))

export const applicationPermission = (scopeKey, roleName = scopeKey) => ({key: 'access-' + createHash('sha256').update(scopeKey).digest('hex').slice(0, 20), name: 'Access ' + roleName})
export function applicationPermissionRecords(fixture, scopeKeys, {kestraPolicy}) {
  assert.equal(typeof kestraPolicy, 'boolean', 'Explicit application execution kind required')
  assert(Array.isArray(scopeKeys) && new Set(scopeKeys).size === scopeKeys.length, 'Unique permission scope keys required')
  const definitions = new Map(fixture.directoryScopes.map(definition => [definition.key, definition]))
  const policies = fixture.policy.applicationGroups[applicationProject].scopes
  return scopeKeys.map(scopeKey => {
    const definition = definitions.get(scopeKey)
    assert(definition, 'Permission references an unknown group scope')
    const policy = Object.hasOwn(policies, scopeKey) ? policies[scopeKey] : null
    return {...applicationPermission(scopeKey, definition.name), description: definition.description,
      scopeKeys: [scopeKey], enabled: kestraPolicy ? policy?.enabled ?? true : true,
      grants: kestraPolicy ? structuredClone(policy?.grants ?? []) : [],
      managementGrants: kestraPolicy ? structuredClone(policy?.managementGrants ?? []) : [],
      details: '', revision: 1}
  })
}
export function applicationDeclarations(fixture, clientId, keys = fixture.projectScopeCatalog) {
  const definitions = new Map(fixture.directoryScopes.map(scope => [scope.key, scope]))
  const scopes = keys.map(key => {
    const definition = definitions.get(key)
    assert(definition, 'declaration references an unknown application-group scope')
    return {key, permissions: [applicationPermission(key, definition.name)]}
  })
  assert.equal(new Set(scopes.map(scope => scope.key)).size, scopes.length)
  return {applicationGroupId: applicationProject, clientId, scopes}
}
