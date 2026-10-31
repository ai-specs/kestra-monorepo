/** Test ownership is not a skip policy: migrated rows require published CI evidence. */
export function uiCaseOwner(id) {
  if(id.startsWith('ui-auth-theme-language-'))return 'overlay'
  if(id.startsWith('ui-theme-language-')||id.startsWith('ui-four-drawers-theme-language-')
    ||id.startsWith('ui-drawer-')||id.startsWith('ui-inline-')
    ||['ui-native-filter-popup-geometry','ui-theme-colors-are-distinct',
      'ui-four-drawers-focus-discard','ui-four-drawers-draft-discard',
      'ui-loading-transition','ui-permission-summary-expand',
      'ui-saving-drawer-interaction-lock','ui-delete-focus-fallback',
      'ui-secret-copy-failure-retry'].includes(id))return 'plugin'
  return 'root'
}

export function rootUiPlan(allIds) {
  if(new Set(allIds).size!==allIds.length)throw new Error('duplicate UI plan ID')
  return Object.freeze(allIds.filter(id=>uiCaseOwner(id)==='root'))
}

export function transferredUiPlan(allIds) {
  return allIds.filter(id=>uiCaseOwner(id)!=='root').map(id=>({id,owner:uiCaseOwner(id),
    reason:'Independent repository visual/component responsibility; required published evidence, not a root executed/skip result'}))
}
