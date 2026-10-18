import assert from 'node:assert/strict'
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
export function localApplicationPolicy({issuer, audiences, directoryRevision}) {
  assert(new URL(issuer).origin === issuer, 'Acceptance issuer must be an exact origin')
  assert(Array.isArray(audiences) && audiences.length && audiences.every(value => typeof value === 'string' && value.length && !value.includes('*')))
  assert(Number.isSafeInteger(directoryRevision) && directoryRevision > 0)
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
    [scopeNames.identityManager]: scope('Explicit issuer directory management', [metadata()], [{domain: 'IDENTITY', actions: ['READ', 'MANAGE'], projectIds: []}]),
    [scopeNames.policyManager]: scope('Explicit project local policy management', [metadata()], [{domain: 'LOCAL_POLICY', actions: ['READ', 'MANAGE'], projectIds: []}]),
  }
  // An intentionally unbound directory scope is omitted from local policy. A token
  // mixing it with a known scope must be denied, rather than using a known subset.
  return {schemaVersion: 2, applicationProjects: {[applicationProject]: {issuer, audiences: [...audiences], enabled: true, directoryRevision, scopes}}}
}
export function directoryScopeInputs(localPolicy) {
  const project = localPolicy.applicationProjects[applicationProject]
  const definitions = Object.entries(project.scopes).map(([name, definition]) => ({scope: name, description: definition.description, active: definition.enabled,
    resourceIntents: definition.grants.map(grant => ({vocabularyVersion: 'kestra-resources-v1', resourceType: grant.resource,
      namespaces: grant.scope === 'TENANT' ? {kind: 'ALL', exact: [], subtrees: []}
        : {kind: 'RESTRICTED', exact: grant.descendants ? [] : [grant.namespace], subtrees: grant.descendants ? [grant.namespace] : []},
      resourceIds: {kind: grant.allIds ? 'ALL' : 'RESTRICTED', ids: [...grant.ids]}, actions: [...grant.actions]})),
    managementIntents: definition.managementGrants.map(grant => ({domain: grant.domain, actions: [...grant.actions], projectIds: [...(grant.projectIds ?? [])]})),
  }))
  definitions.push({scope: scopeNames.unbound, description: 'Known directory role without a local binding', active: true,
    resourceIntents: [{vocabularyVersion: 'kestra-resources-v1', resourceType: 'FLOW', namespaces: {kind: 'RESTRICTED', exact: [namespaceDomains.a], subtrees: []}, resourceIds: {kind: 'ALL', ids: []}, actions: ['READ', 'LIST']}], managementIntents: []})
  return definitions
}
export const projectTestAccounts = Object.freeze(projectScopeCases.map((item, index) => Object.freeze({caseId: item.id,
  username: 'scope-test-' + String(index + 1).padStart(2, '0'), password: 'ProjectScopeTest123!', projectScopes: item.scopes})))
