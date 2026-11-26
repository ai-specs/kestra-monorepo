import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {createHash, randomUUID} from 'node:crypto'
import {mkdirSync, readFileSync, realpathSync, lstatSync, writeFileSync} from 'node:fs'
import {dirname, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'
import {validateAmisPublishedRelease, validateAmisReleaseExpected} from './amis-apps-release.mjs'

const execute = promisify(execFile)
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const fixedImage = /^ghcr\.io\/ai-specs\/kestra-plugin-amis-apps-artifact@sha256:([a-f0-9]{64})$/
function safeError(error) {
  const message = String(error?.message ?? error)
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, '[REDACTED]')
    .replace(/((?:password|token|secret|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
  return new Error(message)
}

/** Pull immutable published bytes and cross-check the registry BuildKit source event.
 * BuildKit provenance is a producer origin statement, not a key-signature or complete
 * supply-chain proof. Does not query private GitHub Actions APIs.
 * runner(command, args) returns {stdout: Buffer|string}; it never receives shell text.
 */
export async function download(exactImage, destination, expected, {
  runner = (command, args) => execute(command, args, {encoding: 'buffer', maxBuffer: 32 * 1024 * 1024}),
  releaseReader = validateAmisPublishedRelease
} = {}) {
  const match = fixedImage.exec(exactImage)
  assert(match, 'Exact AMIS artifact digest required')
  assert.match(expected.amisCommit, /^[a-f0-9]{40}$/)
  assert.match(expected.hostImage, /^ghcr\.io\/ai-specs\/kestra-overlay@sha256:[a-f0-9]{64}$/)
  assert.match(expected.jarSha256, /^[a-f0-9]{64}$/)
  assert.match(expected.hostExecutableSha256, /^[a-f0-9]{64}$/)
  validateAmisReleaseExpected(expected)
  const area = resolve(destination)
  assert(area.startsWith(resolve(repository, '.work') + sep), 'New root .work directory required')
  assert.equal(realpathSync(dirname(area)), dirname(area), 'Symlink destination parent forbidden')
  mkdirSync(area, {mode: 0o700}) // Existing downloads cannot be reused.
  const owner = `amis-artifact-${randomUUID()}`
  let containerId
  let foreignOwner = false
  let result
  let failure
  async function docker(args) {
    const response = await runner('docker', args)
    assert(response && (typeof response.stdout === 'string' || Buffer.isBuffer(response.stdout)), 'Runner stdout required')
    return response.stdout
  }
  try {
    await docker(['pull', '--platform', 'linux/amd64', exactImage])
    const rawIndex = await docker(['buildx', 'imagetools', 'inspect', '--raw', exactImage])
    const rawBytes = Buffer.from(rawIndex)
    // A single CLI output terminator is not part of the registry manifest bytes.
    const indexMatches = sha256(rawBytes) === match[1]
      || (rawBytes.at(-1) === 10 && sha256(rawBytes.subarray(0, -1)) === match[1])
    assert(indexMatches, 'Registry raw index SHA differs from selected digest')
    const created = String(await docker(['create', '--platform', 'linux/amd64', '--label', `owner=${owner}`, exactImage, '/artifact-only'])).trim()
    assert.match(created, /^[a-f0-9]{64}$/, 'Actual full container ID required')
    containerId = created
    const inspection = JSON.parse(String(await docker(['inspect', containerId])))
    assert(Array.isArray(inspection) && inspection.length === 1)
    const container = inspection[0]
    assert.equal(container.Id, containerId, 'Container ID differs')
    foreignOwner = container.Config?.Labels?.owner !== owner
    assert(!foreignOwner, 'Container owner differs; foreign container will not be removed')
    assert.equal(container.Config?.Image, exactImage, 'Container image differs')
    assert.equal(container.State?.Running, false, 'Artifact container must never run')
    assert.equal(container.State?.Status, 'created', 'Artifact container must remain created')
    await docker(['cp', `${containerId}:/release`, area])
    const release = resolve(area, 'release')
    assert(lstatSync(release).isDirectory() && !lstatSync(release).isSymbolicLink())
    for (const name of ['release-provenance.json', 'kestra-amis-apps.jar']) {
      const stat = lstatSync(resolve(release, name))
      assert(stat.isFile() && !stat.isSymbolicLink(), 'Copied release file must be a regular file')
    }
    const provenance = JSON.parse(readFileSync(resolve(release, 'release-provenance.json'), 'utf8'))
    assert.equal(provenance.commit, expected.amisCommit)
    assert.equal(provenance.host?.image, expected.hostImage)
    assert.equal(provenance.jarSha256, expected.jarSha256)
    assert.equal(sha256(readFileSync(resolve(release, 'kestra-amis-apps.jar'))), expected.jarSha256)
    const metadataBytes = await docker(['buildx', 'imagetools', 'inspect', exactImage, '--format', '{{json .Provenance}}'])
    const metadataPath = resolve(area, 'registry-provenance.json')
    writeFileSync(metadataPath, metadataBytes, {mode: 0o600, flag: 'wx'})
    const metadata = JSON.parse(String(metadataBytes))
    // Actual single-platform artifact exposes SLSA directly, not a platform map.
    const definition = metadata.SLSA?.buildDefinition
    const parameters = definition?.internalParameters
    assert(parameters, 'Registry SLSA internal parameters missing')
    const repo = 'ai-specs/kestra-plugin-amis-apps'
    assert.equal(parameters.github_event_name, 'workflow_run', 'Publisher event differs')
    assert.equal(parameters.github_repository, repo, 'Publisher repository differs')
    assert.equal(parameters.github_workflow_ref, `${repo}/.github/workflows/publish.yml@refs/heads/main`, 'Publisher workflow ref differs')
    assert.equal(parameters.github_workflow_sha, expected.amisCommit, 'Publisher source commit differs')
    assert.match(String(parameters.github_run_id), /^[1-9][0-9]*$/, 'Publisher run ID missing')
    assert.equal(String(parameters.github_run_id), String(provenance.runId), 'Publisher run ID differs')
    const source = parameters.github_event_payload?.workflow_run
    assert(source, 'Source workflow_run payload missing')
    assert.equal(source.name, 'AMIS independent checks', 'Source workflow name differs')
    assert.equal(source.head_repository?.full_name, repo, 'Source repository differs')
    assert.equal(source.head_sha, expected.amisCommit, 'Source CI commit differs')
    for (const [key, value] of Object.entries({event: 'push', head_branch: 'main', status: 'completed', conclusion: 'success'})) {
      assert.equal(source[key], value, `Source CI ${key} differs`)
    }
    const sourceCi = provenance.sourceCi
    assert(sourceCi, 'Release sourceCi missing')
    assert(Number.isSafeInteger(source.id) && source.id > 0, 'Source run ID missing')
    assert.equal(String(source.id), String(sourceCi.runId), 'Source run ID differs')
    for (const [key, value] of Object.entries({headSha: expected.amisCommit, status: 'completed', conclusion: 'success', event: 'push', branch: 'main'})) {
      assert.equal(sourceCi[key], value, `Release sourceCi ${key} differs`)
    }
    const vcs = definition.externalParameters?.request?.root?.request?.args
    assert.equal(vcs?.['vcs:revision'], expected.amisCommit, 'Image VCS revision differs')
    assert.equal(vcs?.['vcs:source'], `https://github.com/${repo}`, 'Image VCS source differs')
    const audit = await releaseReader(release, structuredClone(expected))
    result = {image: exactImage, rawIndexSha256: match[1], owner, containerId, releaseDirectory: release,
      jarSha256: expected.jarSha256, audit, registryProvenance: {path: metadataPath, sha256: sha256(metadataBytes),
        publisherRunId: String(parameters.github_run_id), sourceRunId: source.id},
      provenanceScope: 'Registry BuildKit source event cross-checked; no key-signature or completeness proof; no live GitHub API queries'}
  } catch (error) { failure = safeError(error) }
  finally {
    if (containerId && !foreignOwner) {
      try { await docker(['rm', containerId]) }
      catch (error) {
        const cleanupFailure = safeError(error)
        if (failure) failure.cleanupError = cleanupFailure.message
        else failure = cleanupFailure
      }
    }
  }
  if (failure) throw failure
  return result
}
