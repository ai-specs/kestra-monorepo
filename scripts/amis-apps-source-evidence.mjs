import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {lstatSync, readFileSync, realpathSync, existsSync} from 'node:fs'
import {resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const hex = /^[a-f0-9]{64}$/

// Deliberately explicit. This is a local source binding, not a signature or CI claim.
export const amisAcceptanceSourcePaths = Object.freeze([
  'scripts/amis-apps-acceptance-cases.mjs', 'scripts/amis-apps-actors.mjs', 'scripts/amis-apps-effects.mjs',
  'scripts/amis-apps-fault-cases.mjs', 'scripts/amis-apps-fixture.mjs', 'scripts/amis-apps-http.mjs',
  'scripts/amis-apps-managed-compose.mjs', 'scripts/amis-apps-native-cases.mjs', 'scripts/amis-apps-oci.mjs',
  'scripts/amis-apps-permission-cases.mjs', 'scripts/amis-apps-production-environment.mjs',
  'scripts/amis-apps-body-cases.mjs', 'scripts/amis-apps-browser-driver.mjs', 'scripts/amis-apps-browser.mjs',
  'scripts/amis-apps-compose.mjs', 'scripts/amis-apps-evidence.mjs', 'scripts/amis-apps-observer-control.mjs',
  'scripts/amis-apps-release.mjs', 'scripts/amis-apps-revocation-cases.mjs', 'scripts/amis-apps-revocation.mjs',
  'scripts/amis-apps-runtime-inputs.mjs', 'scripts/amis-apps-security-cases.mjs', 'scripts/amis-apps-sync-cases.mjs',
  'scripts/amis-apps-ui-oauth.mjs', 'scripts/amis-apps-source-evidence.mjs', 'scripts/check-amis-apps-report.mjs',
  'scripts/production-oauth-client.mjs', 'scripts/production-streaming-request.mjs',
  'scripts/application-project-browser-adapters.mjs', 'scripts/browser-diagnostic-evidence.mjs',
  'scripts/owned-browser-session.mjs', 'scripts/owned-service-log.mjs',
  'scripts/application-project-fixture.mjs', 'scripts/application-project-cases.mjs', 'scripts/application-project-policy.mjs',
  'scripts/select-application-project-release.py', 'docker-compose.yml', '.env.example',
  'scripts/amis-apps-probe/design.md', 'scripts/amis-apps-probe/compile.sh',
  'scripts/amis-apps-probe/FlowMetaStoreListener.java', 'scripts/amis-apps-probe/FlowRepositoryListener.java',
  'scripts/amis-apps-probe/NamespaceFactoryListener.java', 'scripts/amis-apps-probe/OwnedDuplicateAuthorization.java',
  'scripts/amis-apps-probe/OwnedFaultRouteProvider.java', 'scripts/amis-apps-probe/OwnedFaultSelfTest.java',
  'scripts/amis-apps-probe/OwnedUnavailableAuthorizationListener.java', 'scripts/amis-apps-probe/ProbeAgent.java',
  'scripts/amis-apps-probe/ProbeDelegationSelfTest.java', 'scripts/amis-apps-probe/ProbeProxies.java',
  'scripts/amis-apps-probe/ProbeState.java', 'scripts/amis-apps-probe/RbacGateListener.java',
  'scripts/amis-apps-probe/StorageListener.java', 'scripts/prepare-amis-apps-acceptance.mjs',
  'scripts/amis-apps-expected-http.json', 'scripts/run-amis-apps-p0.mjs',
  'deployment/amis-apps-release.json', '.github/workflows/compose-acceptance.yml',
])

function safeRelative(root, value) {
  assert(typeof value === 'string' && value.length > 0 && !value.includes('\\') && !value.startsWith('/') && !value.includes(':'), 'Invalid source path')
  assert(!value.split('/').some(part => part === '' || part === '.' || part === '..'), 'Unsafe source path')
  const path = resolve(root, value)
  assert(path.startsWith(resolve(root) + sep), 'Source escapes repository')
  return path
}

export function collectAmisSourceEvidence({rootDirectory, paths = amisAcceptanceSourcePaths} = {}) {
  assert(typeof rootDirectory === 'string' && rootDirectory.length > 0, 'Explicit repository root required')
  const root = realpathSync(resolve(rootDirectory))
  assert(lstatSync(root).isDirectory(), 'Repository root directory required')
  assert(Array.isArray(paths) && paths.length > 0, 'Explicit source whitelist required')
  const names = [...paths]
  assert(new Set(names).size === names.length, 'Duplicate source path')
  for (const name of names) assert(amisAcceptanceSourcePaths.includes(name), 'Source path is not in the production whitelist')
  const files = {}
  for (const name of names.sort()) {
    const path = safeRelative(root, name)
    assert(existsSync(path), `Missing source evidence file: ${name}`)
    const stat = lstatSync(path)
    assert(stat.isFile() && !stat.isSymbolicLink() && realpathSync(path) === path, `Source must be regular and non-symlink: ${name}`)
    const digest = sha256(readFileSync(path))
    assert(hex.test(digest))
    files[name] = digest
  }
  const aggregateInput = Object.entries(files).map(([name, digest]) => `${name}\0${digest}\n`).join('')
  return {
    schemaVersion: 1,
    statement: 'localfilebinding',
    rootIndependent: true,
    limitations: ['Local file bytes at collection time only; not a signature, CI provenance or proof of loaded in-memory modules',
      'Explicit whitelist only; no claim of complete dependency or installed artifact coverage'],
    files,
    aggregateSha256: sha256(aggregateInput),
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootDirectory = process.argv[2]
  try { console.log(JSON.stringify(collectAmisSourceEvidence({rootDirectory}), null, 2)) }
  catch (error) { console.error(`AMIS source evidence failed: ${error.message}`); process.exitCode = 1 }
}
