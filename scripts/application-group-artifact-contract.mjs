import assert from 'node:assert/strict'

export const applicationGroupPluginClasses=Object.freeze([
  'io/kestra/extensions/rbac/applicationgroup/ApplicationGroupPolicy.class',
  'io/kestra/extensions/rbac/applicationgroup/ApplicationGroupPolicy$ApplicationGroup.class',
  'io/kestra/extensions/rbac/applicationgroup/ApplicationGroupPolicyParser.class',
  'io/kestra/extensions/rbac/applicationgroup/ApplicationGroupAuthorization.class',
  'io/kestra/extensions/rbac/ApplicationGroupRuntimePolicies.class',
  'io/kestra/extensions/rbac/ApplicationGroupRuntimeConfiguration.class',
  'io/kestra/extensions/rbac/management/ApplicationGroupPolicyManagement.class',
  'io/kestra/extensions/rbac/management/ApplicationGroupScope.class',
  'io/kestra/extensions/rbac/management/ApplicationGroupApplication.class',
  'io/kestra/extensions/rbac/management/ApplicationGroupScopeGrant.class',
  'io/kestra/extensions/rbac/store/ApplicationGroupPolicyStore.class',
  'io/kestra/extensions/rbac/store/ApplicationGroupPolicyCommand.class',
  'io/kestra/extensions/rbac/applicationgroup/ApplicationGroupDirectory.class',
  'io/kestra/extensions/rbac/applicationgroup/ApplicationGroupDirectoryReader.class',
  'io/kestra/extensions/rbac/applicationgroup/ApplicationGroupDirectoryService.class',
  'io/kestra/extensions/rbac/applicationgroup/ApplicationGroupInstallationPlan.class',
  'io/kestra/extensions/rbac/management/ApplicationGroupDirectoryManagement.class',
  'io/kestra/extensions/rbac/store/ApplicationGroupDirectoryStore.class',
  'io/kestra/extensions/rbac/store/ApplicationGroupDirectoryCommand.class',
])

export function assertApplicationGroupPluginEntries(entries) {
  assert(Array.isArray(entries)&&entries.every(entry=>typeof entry==='string'),'Actual jar entries required')
  const classes=entries.filter(entry=>entry.startsWith('io/kestra/extensions/rbac/')&&entry.endsWith('.class'))
  const names=new Set(classes)
  assert.equal(names.size,classes.length,'Plugin jar contains duplicate class entries')
  for(const required of applicationGroupPluginClasses)assert(names.has(required),'Missing application-group plugin class: '+required)
  const obsolete=classes.filter(entry=>/^io\/kestra\/extensions\/rbac\/(?:project\/|ProjectRuntime(?:Policies|Configuration)(?:\$|\.)|ProjectTypedPolicy(?:\$|\.)|store\/ProjectPolicy(?:Store|Command)(?:\$|\.)|management\/ProjectPolicyManagement(?:\$|\.))/.test(entry))
  assert.equal(obsolete.length,0,'Plugin jar retains obsolete project model classes')
  return {model:'application-group',requiredClasses:applicationGroupPluginClasses.length,obsoleteClasses:obsolete.length}
}

export const applicationGroupTables=Object.freeze([
  'rbac_application_group_bootstrap',
  'rbac_application_group_invalidation',
  'rbac_application_group_retired',
  'rbac_application_group_state',
  'rbac_application_group_policy_head',
  'rbac_application_group_policy_snapshot',
  'rbac_application_scope_declaration',
])

export const obsoleteProjectTables=Object.freeze([
  'oidc_project_bootstrap','oidc_project_invalidation','oidc_project_state',
  'rbac_project_policy_head','rbac_project_policy_snapshot','rbac_policy_head','rbac_policy_snapshot',
  'oidc_application_group_bootstrap','oidc_application_group_invalidation','oidc_application_group_retired','oidc_application_group_state',
])

export function assertApplicationGroupSchemaTables(tables) {
  assert(Array.isArray(tables)&&tables.every(table=>typeof table==='string'),'Actual schema table names required')
  const actual=new Set(tables)
  assert.equal(actual.size,tables.length,'Duplicate schema table names')
  for(const required of applicationGroupTables)assert(actual.has(required),'Missing application-group table: '+required)
  const obsolete=tables.filter(table=>obsoleteProjectTables.includes(table))
  assert.deepEqual(obsolete,[],'New-install contains obsolete or misplaced group/schema1 storage')
  return {model:'application-group',requiredTables:[...applicationGroupTables],obsoleteTables:obsolete}
}
