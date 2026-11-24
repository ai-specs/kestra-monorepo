import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, readFile, writeFile, mkdir, stat, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {parseArgs, validateConfig, validateRun, cleanupEligible, privateWrite, runRehearsal, executeRecovery, recoveryOrder, verifyPublishedXml, checkPublication, requireResourceAbsent, finalizeRehearsalReport, verifyRestoredStorage, storageRestoreArgs} from './upstream-upgrade-rehearsal.mjs'

const ci = kind => ({repository: 'ai-specs/kestra-' + (kind === 'overlay' ? 'overlay' : 'plugin-rbac'), runId: 123, commit: 'a'.repeat(40)})
const config = () => ({mode: 'A', ownerLabel: 'upgrade-owned-example', appPort: 18199, postgres: {container: 'existing-pg', network: 'existing-net', admin: 'admin'}, old: {image: 'ghcr.io/ai-specs/kestra-overlay@sha256:' + 'a'.repeat(64), overlay: ci('overlay')}, new: {image: 'ghcr.io/ai-specs/kestra-overlay@sha256:' + 'b'.repeat(64), overlay: ci('overlay')}})
const temporary = async action => { const path = await mkdtemp(join(tmpdir(), 'upgrade-unit-')); try { return await action(path) } finally { await rm(path, {recursive: true, force: true}) } }

test('CLI requires explicit run, absolute paths, unique known switches', () => {
  for (const args of [[], ['--config', '/a', '--evidence', '/b'], ['--run', '--config', 'relative', '--evidence', '/b'], ['--run', '--config', '/a', '--evidence', '/b', '--run'], ['--run', '--config', '/a', '--evidence', '/b', '--simulate'], ['--run', '--config', '--evidence', '/b']]) assert.throws(() => parseArgs(args))
  assert.deepEqual(parseArgs(['--run', '--config', '/a', '--evidence', '/b']), {config: '/a', evidence: '/b'})
})
test('formal images, mode A without jar and mode B corresponding jars', () => {
  assert.equal(validateConfig(config()).mode, 'A')
  for (const mutate of [c => { c.new.image = 'latest' }, c => { c.new.image = c.old.image }, c => { c.old.overlay.commit = 'abc' }, c => { delete c.postgres.network }, c => { c.old.jar = {} }, c => { c.appPort = 80 }, c => { c.mode = 'B' }]) { const c = config(); mutate(c); assert.throws(() => validateConfig(c)) }
  const c = config(); c.mode = 'B'; for (const side of ['old', 'new']) { c[side].jar = {path: '/formal/' + side + '.jar', sha256: 'c'.repeat(64)}; c[side].plugin = ci('plugin') }
  assert.equal(validateConfig(c).mode, 'B')
})
test('CI rejects uncompleted, branch, commit, workflow, event and repository mismatches', () => {
  const input = ci('overlay'), run = {id: input.runId, repository: {full_name: input.repository}, head_sha: input.commit, status: 'completed', conclusion: 'success', event: 'push', head_branch: 'main', path: '.github/workflows/overlay.yml'}
  validateRun(input, run, 'overlay')
  for (const change of [{status: 'in_progress'}, {conclusion: 'failure'}, {event: 'workflow_dispatch'}, {head_branch: 'candidate'}, {head_sha: 'b'.repeat(40)}, {path: 'other.yml'}, {id: 999}, {repository: {full_name: 'another/repo'}}]) assert.throws(() => validateRun(input, {...run, ...change}, 'overlay'))
})
test('cleanup refuses adopted, incomplete and mismatched ownership', () => {
  const owner = 'upgrade-owned-example', resource = {created: true, owner}
  assert.equal(cleanupEligible(resource, owner, owner), true)
  for (const [row, current, expected] of [[undefined, owner, owner], [{...resource, created: false}, owner, owner], [resource, 'another-owner', owner], [resource, owner, 'another-owner'], [resource, undefined, owner]]) assert.equal(cleanupEligible(row, current, expected), false)
})
test('private evidence uses 0600 and exclusive writes', () => temporary(async path => {
  await privateWrite(path, 'evidence.json', {safe: true}); assert.equal((await stat(join(path, 'evidence.json'))).mode & 0o777, 0o600)
  await assert.rejects(privateWrite(path, 'evidence.json', 'overwrite'), {code: 'EEXIST'})
}))
test('input failure retains all later notRun and does not invoke resources', () => temporary(async path => {
  const input = join(path, 'input.json'), evidence = join(path, 'evidence'); await writeFile(input, JSON.stringify({password: 'MUST_NOT_LEAK'}))
  const report = await runRehearsal({config: input, evidence})
  assert.equal(report.status, 'failed'); assert.equal(report.phases.inputValidation.status, 'failed')
  for (const [name, row] of Object.entries(report.phases)) if (name !== 'inputValidation') assert.equal(row.status, 'notRun')
  assert.deepEqual(report.resources, []); assert.equal((await stat(evidence)).mode & 0o777, 0o700)
  const text = await readFile(join(evidence, 'report.json'), 'utf8'); assert(!text.includes('MUST_NOT_LEAK')); assert.equal((await stat(join(evidence, 'report.json'))).mode & 0o777, 0o600)
  await assert.rejects(runRehearsal({config: input, evidence}), {code: 'EEXIST'})
}))
test('recovery requires backup verification, DB/storage/config before old start', async () => {
  const seen = []; await executeRecovery(Object.fromEntries(recoveryOrder.map(name => [name, async () => { seen.push(name) }])))
  assert.deepEqual(seen, ['verifySnapshot', 'restoreDatabase', 'restoreStorage', 'restoreOldConfiguration', 'startRestoredOld', 'restoredDataAndBoundary'])
  for (const failed of ['verifySnapshot', 'restoreDatabase', 'restoreStorage', 'restoreOldConfiguration']) {
    const visited = []; await assert.rejects(executeRecovery(Object.fromEntries(recoveryOrder.map(name => [name, async () => { visited.push(name); if (name === failed) throw Error('failure') }]))))
    assert(!visited.includes('startRestoredOld')); assert.equal(visited.at(-1), failed)
  }
})
test('published XML gates reject missing reports, skips and wrong exact counts', () => temporary(async directory => {
  const paths = ['.evidence/unit/results', '.evidence/postgres/results', '.evidence/lifecycle/results']
  const gates = paths.map(path => ({path, tests: 1})), xml = '<testsuite name="one" tests="1" failures="0" errors="0" skipped="0"><testcase name="real"/></testsuite>'
  for (const path of paths) { await mkdir(join(directory, path), {recursive: true}); await writeFile(join(directory, path, 'one.xml'), xml) }
  assert.equal((await verifyPublishedXml(directory, gates)).length, 3)
  await assert.rejects(verifyPublishedXml(directory, gates.map(g => ({...g, tests: 2}))))
  await writeFile(join(directory, paths[0], 'one.xml'), xml.replace('skipped="0"', 'skipped="1"')); await assert.rejects(verifyPublishedXml(directory, gates))
}))
test('publication gate rejects skipped promotion before Docker operations', () => temporary(async directory => {
  const c = config(), calls = []
  const invoke = (program, args) => {
    calls.push(program)
    if (args[0] === 'api') return JSON.stringify({id: 123, repository: {full_name: c.old.overlay.repository}, head_sha: c.old.overlay.commit, status: 'completed', conclusion: 'success', event: 'push', head_branch: 'main', path: '.github/workflows/overlay.yml'})
    if (args.includes('--json')) return JSON.stringify({jobs: [{name: 'promote', conclusion: 'success', databaseId: 10, steps: [{name: 'Promote verified immutable candidate to deployment tags', conclusion: 'success'}]}, {name: 'build-push', conclusion: 'success', databaseId: 11}]})
    return 'SKIP: candidate commit is no longer the current main HEAD'
  }
  await assert.rejects(checkPublication(c, directory, invoke)); assert(!calls.includes('docker'))
}))
test('publication gate rejects candidate digest not bound to selected successful CI', () => temporary(async directory => {
  const c = config(); let docker = false
  const invoke = (program, args) => {
    if (program === 'docker') docker = true
    if (args[0] === 'api') return JSON.stringify({id: 123, repository: {full_name: c.old.overlay.repository}, head_sha: c.old.overlay.commit, status: 'completed', conclusion: 'success', event: 'push', head_branch: 'main', path: '.github/workflows/overlay.yml'})
    if (args.includes('--json')) return JSON.stringify({jobs: [{name: 'promote', conclusion: 'success', databaseId: 10, steps: [{name: 'Promote verified immutable candidate to deployment tags', conclusion: 'success'}]}, {name: 'build-push', conclusion: 'success', databaseId: 11}]})
    return args.includes('10') ? 'Promoted' : 'Candidate image: ' + c.new.image
  }
  await assert.rejects(checkPublication(c, directory, invoke), /formal CI build digest/); assert.equal(docker, false)
}))


test('resource absence requires successful complete inventory including stopped containers', () => {
  const calls = []
  requireResourceAbsent('container', 'new-app', (program, args) => { calls.push({program, args}); return '"stopped-app"\n"existing-app"\n' })
  requireResourceAbsent('volume', 'new-volume', (program, args) => { calls.push({program, args}); return '"existing-volume"\n' })
  assert.deepEqual(calls, [
    {program: 'docker', args: ['container', 'ls', '--all', '--format', '{{json .Names}}']},
    {program: 'docker', args: ['volume', 'ls', '--format', '{{json .Name}}']},
  ])
  assert.throws(() => requireResourceAbsent('container', 'stopped-app', () => '"stopped-app"\n'), /existing resource/)
  assert.throws(() => requireResourceAbsent('volume', 'existing-volume', () => '"existing-volume"\n'), /existing resource/)
  assert.doesNotThrow(() => requireResourceAbsent('volume', 'new-volume', () => ''))
})
test('inventory network, permission and malformed output fail closed without creation', () => {
  for (const failure of [Error('network unavailable'), Error('permission denied')]) {
    let calls = 0
    assert.throws(() => requireResourceAbsent('container', 'new-app', () => { calls++; throw failure }), error => error === failure)
    assert.equal(calls, 1)
  }
  for (const output of ['not-json', 'null', '{}', '""', '"existing"\ntruncated']) assert.throws(() => requireResourceAbsent('volume', 'new-volume', () => output))
})
test('existing PG config has no host port requirement', () => {
  const value = config()
  assert.equal(Object.hasOwn(value.postgres, 'hostPort'), false)
  assert.equal(validateConfig(value), value)
})
test('storage restoration must match mode and numeric owners as well as content', () => {
  const expected = {metadata: '\td\t750\t1000\t1001\t\nstate\tf\t640\t1000\t1001\t\n', contentSha256: 'a'.repeat(64)}
  assert.doesNotThrow(() => verifyRestoredStorage(expected, {...expected}))
  for (const metadata of [expected.metadata.replace('750', '755'), expected.metadata.replace('640', '600'), expected.metadata.replaceAll('1000', '0'), expected.metadata.replaceAll('1001', '0')]) assert.throws(() => verifyRestoredStorage(expected, {...expected, metadata}), /mode\/UID\/GID/)
  assert.throws(() => verifyRestoredStorage(expected, {...expected, contentSha256: 'b'.repeat(64)}), /content mismatch/)
  assert.throws(() => verifyRestoredStorage({}, {}), /evidence missing/)
  assert.deepEqual(storageRestoreArgs, ['tar', '--numeric-owner', '--same-owner', '-xpf', '-', '-C', '/app/storage'])
})
test('partial creation and partial cleanup cannot finalize as success; retained evidence survives', () => {
  for (const [status, phases] of [
    ['failed', {ownedProvision: {status: 'failed'}, oldBootstrapLogin: {status: 'notRun'}}],
    ['passed', {ownedProvision: {status: 'passed'}, ownedCleanup: {status: 'failed'}}],
    ['passed', {ownedProvision: {status: 'passed'}, ownedCleanup: {status: 'passed'}}],
  ]) {
    const retained = {kind: 'role', id: 'partial-role', owner: 'upgrade-owned-example', created: true}
    const removed = {kind: 'container', id: 'stopped-app', created: true, removed: true}
    const report = {status, phases, resources: [retained, removed]}
    finalizeRehearsalReport(report)
    assert.equal(report.status, 'failed'); assert.deepEqual(report.retainedResources, [retained])
  }
  const report = {status: 'passed', phases: {ownedCleanup: {status: 'passed'}}, resources: [{kind: 'volume', id: 'removed', removed: true}]}
  finalizeRehearsalReport(report); assert.equal(report.status, 'passed'); assert.deepEqual(report.retainedResources, [])
})

test('identity preservation excludes only volatile login timestamps, not authorization fields', async () => {
  const source = await readFile(new URL('./upstream-upgrade-rehearsal.mjs', import.meta.url), 'utf8')
  assert(source.includes("- 'updated_at' - 'last_login_at'"))
  assert(!source.includes("- 'last_login'"))
})
