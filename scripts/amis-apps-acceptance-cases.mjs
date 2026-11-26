const sharedCases = [
  'anonymous-api-denied-without-side-effects',
  'cookie-write-missing-and-invalid-csrf',
  'same-site-cross-origin-cookie-write-denied',
  'parent-schema-render-without-extra-file-grant',
  'sibling-authority-traversal-and-invalid-schema-denied',
  'default-async-real-execution-and-bounded-poll',
  'explicit-sync-timeout-cancel-and-capacity',
  'body-cannot-replace-route-identity',
  'foreign-execution-and-output-access-denied',
  'native-controller-static-oauth-and-alias-precedence',
  'missing-and-disabled-extension-native-regression',
  'missing-duplicate-and-faulted-route-provider-fail-closed',
  'declared-runtime-assets-authenticated-and-loadable',
]

export const amisP0Cases = Object.freeze([
  'A-production-login-bookmark-and-refresh',
  'A-page-renders-current-schema',
  'A-form-creates-real-flow-execution',
  'A-no-rbac-jar-authentication-retained',
  'B-production-login-bookmark-and-refresh',
  'B-page-and-api-both-gates-allowed',
  'B-page-entry-denied-zero-lookups',
  'B-api-entry-denied-zero-lookups',
  'B-entry-only-missing-target-404',
  'B-entry-only-existing-flow-execution-denied',
  'B-flow-only-entry-denied',
  'B-multiple-scopes-distinct-resource-ranges',
  'B-namespace-exact-subtree-complement-boundaries',
  'B-revoke-entry-capability',
  'B-revoke-flow-execution',
  'B-revoke-scope-and-refresh',
  'B-zero-grant-logout-and-switch-account',
  'B-missing-duplicate-and-faulted-authorization-fail-closed',
  // Keep each mode's shared cases together so the same single PostgreSQL can
  // serve serial A/B deployments without recreating the JVM for every case.
  ...['A', 'B'].flatMap(mode => sharedCases.map(name => `${mode}-${name}`)),
])

export const amisP0ZeroLookupCases = Object.freeze([
  'B-page-entry-denied-zero-lookups',
  'B-api-entry-denied-zero-lookups',
])

export const amisP0NoEffectCases = Object.freeze([
  ...amisP0ZeroLookupCases,
  'B-entry-only-existing-flow-execution-denied',
  'B-flow-only-entry-denied',
  ...[
    'anonymous-api-denied-without-side-effects',
    'cookie-write-missing-and-invalid-csrf',
    'same-site-cross-origin-cookie-write-denied',
    'body-cannot-replace-route-identity',
    'foreign-execution-and-output-access-denied',
  ].flatMap(name => [`A-${name}`, `B-${name}`]),
])
