import assert from 'node:assert/strict'
import test from 'node:test'
import {createHash} from 'node:crypto'
import {mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs'
import {resolve, join} from 'node:path'
import {download} from '../amis-apps-oci.mjs'

// Synthetic runner responses only. No Docker command is executed by these tests.
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const index = Buffer.from('{"schemaVersion":2,"manifests":[]}')
const image = 'ghcr.io/ai-specs/kestra-plugin-amis-apps-artifact@sha256:' + digest(index)
const id = 'a'.repeat(64)
const jar = Buffer.from('synthetic jar bytes')
const expected = {stage: 'P0', amisCommit: 'b'.repeat(40), hostImage: 'ghcr.io/ai-specs/kestra-overlay@sha256:' + 'c'.repeat(64),
  jarSha256: digest(jar), hostExecutableSha256: 'd'.repeat(64)}
function setup(t, options = {}) {
  mkdirSync('.work', {recursive: true})
  const parent = mkdtempSync(resolve('.work/amis-oci-unit-'))
  t.after(() => rmSync(parent, {recursive: true}))
  const destination = join(parent, 'new-download')
  const calls = []
  const repo = 'ai-specs/kestra-plugin-amis-apps'
  const sourceCi = {runId: 45708620275, headSha: expected.amisCommit, status: 'completed', conclusion: 'success', event: 'push', branch: 'main'}
  const metadata = {SLSA: {buildDefinition: {
    internalParameters: {github_event_name: 'workflow_run', github_repository: repo, github_run_id: '45709423471',
      github_workflow_ref: `${repo}/.github/workflows/publish.yml@refs/heads/main`, github_workflow_sha: expected.amisCommit,
      github_event_payload: {workflow_run: {id: sourceCi.runId, head_sha: expected.amisCommit, event: 'push', head_branch: 'main',
        status: 'completed', conclusion: 'success', name: 'AMIS independent checks', head_repository: {full_name: repo}}}},
    externalParameters: {request: {root: {request: {args: {'vcs:revision': expected.amisCommit, 'vcs:source': `https://github.com/${repo}`}}}}}
  }}}
  options.mutateMetadata?.(metadata.SLSA.buildDefinition)
  let owner
  const runner = async (command, args) => {
    assert.equal(command, 'docker')
    calls.push(args)
    if (options.fail === args[0] || (options.failCleanup && args[0] === 'rm')) throw new Error(`${args[0]} failed token=syntheticSecret`)
    let stdout = ''
    if (args[0] === 'buildx') stdout = args.includes('--format') ? JSON.stringify(metadata)
      : options.badIndex ? Buffer.from('wrong bytes') : options.cliNewline ? Buffer.concat([index, Buffer.from('\n')]) : index
    if (args[0] === 'create') { owner = args[args.indexOf('--label') + 1].slice('owner='.length); stdout = id }
    if (args[0] === 'inspect') stdout = JSON.stringify([{Id: id, Config: {Image: image, Labels: {owner: options.wrongOwner ? 'foreign' : owner}},
      State: {Running: options.running ?? false, Status: options.running ? 'running' : 'created'}}])
    if (args[0] === 'cp') {
      assert.equal(args[1], `${id}:/release`)
      mkdirSync(join(destination, 'release'))
      writeFileSync(join(destination, 'release/kestra-amis-apps.jar'), options.badJar ? 'wrong jar' : jar)
      writeFileSync(join(destination, 'release/release-provenance.json'), JSON.stringify({commit: expected.amisCommit,
        host: {image: expected.hostImage}, jarSha256: expected.jarSha256, runId: '45709423471', sourceCi}))
    }
    return {stdout}
  }
  let readerCalls = 0
  const releaseReader = (directory, actual) => { readerCalls++; assert.equal(directory, join(destination, 'release')); assert.deepEqual(actual, expected); return {syntheticAudit: true} }
  return {destination, parent, calls, runner, releaseReader, readerCalls: () => readerCalls}
}

test('fixed digest pull/create/inspect/cp/read/rm follows exact non-starting sequence', async t => {
  const fixture = setup(t)
  const result = await download(image, fixture.destination, expected, fixture)
  assert.deepEqual(fixture.calls.map(args => args[0]), ['pull', 'buildx', 'create', 'inspect', 'cp', 'buildx', 'rm'])
  assert.deepEqual(fixture.calls[0], ['pull', '--platform', 'linux/amd64', image])
  assert.deepEqual(fixture.calls.at(-1), ['rm', id])
  assert.equal(fixture.calls[2].at(-1), '/artifact-only')
  assert.equal(result.rawIndexSha256, digest(index))
  assert.equal(fixture.readerCalls(), 1)
  assert.deepEqual(fixture.calls[5], ['buildx', 'imagetools', 'inspect', image, '--format', '{{json .Provenance}}'])
  const metadata = JSON.parse(readFileSync(result.registryProvenance.path))
  assert.equal(metadata.SLSA.buildDefinition.internalParameters.github_event_name, 'workflow_run')
  assert.equal(result.registryProvenance.sha256, digest(readFileSync(result.registryProvenance.path)))
  assert(fixture.calls.every(args => !['run', 'start', 'prune'].includes(args[0])))
})

test('registry source and publisher mismatches reject and finally remove the created container', async t => {
  const mutations = [
    d => { d.internalParameters.github_event_payload.workflow_run.conclusion = 'failure' },
    d => { d.internalParameters.github_event_payload.workflow_run.status = 'in_progress' },
    d => { d.internalParameters.github_event_payload.workflow_run.event = 'pull_request' },
    d => { d.internalParameters.github_event_payload.workflow_run.head_branch = 'other' },
    d => { d.internalParameters.github_event_payload.workflow_run.id++ },
    d => { d.internalParameters.github_event_payload.workflow_run.head_sha = 'f'.repeat(40) },
    d => { d.internalParameters.github_event_payload.workflow_run.head_repository.full_name = 'foreign/repo' },
    d => { d.internalParameters.github_event_name = 'push' },
    d => { d.internalParameters.github_run_id = '999' },
    d => { d.internalParameters.github_workflow_ref = 'other/workflow@refs/heads/main' },
    d => { d.internalParameters.github_repository = 'foreign/repo' },
    d => { d.internalParameters.github_workflow_sha = 'f'.repeat(40) },
    d => { d.externalParameters.request.root.request.args['vcs:revision'] = 'f'.repeat(40) }
  ]
  for (const mutateMetadata of mutations) {
    const fixture = setup(t, {mutateMetadata})
    await assert.rejects(download(image, fixture.destination, expected, fixture))
    assert.deepEqual(fixture.calls.at(-1), ['rm', id])
    assert.equal(fixture.readerCalls(), 0)
    assert(readFileSync(join(fixture.destination, 'registry-provenance.json')).length > 0)
  }
})

test('pull and raw-index failures never create or remove a container', async t => {
  for (const options of [{fail: 'pull'}, {badIndex: true}]) {
    const fixture = setup(t, options)
    await assert.rejects(download(image, fixture.destination, expected, fixture))
    assert(!fixture.calls.some(args => ['create', 'rm'].includes(args[0])))
  }
})

test('one CLI output newline is accepted only when manifest hash still matches pinned digest', async t => {
  const fixture = setup(t, {cliNewline: true})
  const result = await download(image, fixture.destination, expected, fixture)
  assert.equal(result.rawIndexSha256, digest(index))
})

test('cleanup failure retains original copy error with redacted secondary diagnostic', async t => {
  const fixture = setup(t, {fail: 'cp', failCleanup: true})
  await assert.rejects(download(image, fixture.destination, expected, fixture), error => {
    assert.match(error.message, /cp failed/)
    assert.match(error.cleanupError, /rm failed/)
    assert(!JSON.stringify({message: error.message, cleanupError: error.cleanupError}).includes('syntheticSecret'))
    return true
  })
  assert.deepEqual(fixture.calls.at(-1), ['rm', id])
})

test('inspect or copy failure cleans only returned container ID and retains primary error', async t => {
  for (const fail of ['inspect', 'cp']) {
    const fixture = setup(t, {fail})
    await assert.rejects(download(image, fixture.destination, expected, fixture), error => {
      assert(error.message.includes(`${fail} failed`)); assert(!error.message.includes('syntheticSecret')); return true
    })
    assert.deepEqual(fixture.calls.at(-1), ['rm', id])
    assert.equal(fixture.readerCalls(), 0)
  }
})

test('foreign owner fails without copying or deleting foreign resources', async t => {
  const fixture = setup(t, {wrongOwner: true})
  await assert.rejects(download(image, fixture.destination, expected, fixture), /owner differs/)
  assert(!fixture.calls.some(args => ['cp', 'rm'].includes(args[0])))
})

test('unexpected running state and copied jar hash mismatch fail and clean own container', async t => {
  for (const options of [{running: true}, {badJar: true}]) {
    const fixture = setup(t, options)
    await assert.rejects(download(image, fixture.destination, expected, fixture))
    assert.deepEqual(fixture.calls.at(-1), ['rm', id])
    assert.equal(fixture.readerCalls(), 0)
  }
})

test('nonfixed image, unsafe destination, old directory and malformed expected hash reject', async t => {
  const fixture = setup(t)
  for (const wrong of ['latest', 'ghcr.io/other/artifact@sha256:' + 'a'.repeat(64)]) {
    await assert.rejects(download(wrong, fixture.destination, expected, fixture))
  }
  await assert.rejects(download(image, '/tmp/not-owned', expected, fixture))
  await assert.rejects(download(image, fixture.destination, {...expected, jarSha256: 'bad'}, fixture))
  mkdirSync(fixture.destination)
  await assert.rejects(download(image, fixture.destination, expected, fixture), /EEXIST/)
  assert.equal(fixture.calls.length, 0)
})
