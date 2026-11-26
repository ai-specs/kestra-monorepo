import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'
import {amisAcceptanceSourcePaths, collectAmisSourceEvidence} from '../amis-apps-source-evidence.mjs'

const digest = value => createHash('sha256').update(value).digest('hex')
function fixture(t) {
  const work = resolve('.work')
  mkdirSync(work, {recursive: true})
  const root = mkdtempSync(join(work, 'amis-source-evidence-unit-'))
  t.after(() => rmSync(root, {recursive: true, force: true}))
  for (const name of ['scripts/amis-apps-fault-cases.mjs', 'scripts/amis-apps-expected-http.json', 'scripts/amis-apps-probe/ProbeState.java']) {
    const path = join(root, name);mkdirSync(join(path, '..'), {recursive: true});writeFileSync(path, `fixture:${name}`)
  }
  return root
}
function mini(root, paths = ['scripts/amis-apps-fault-cases.mjs', 'scripts/amis-apps-expected-http.json', 'scripts/amis-apps-probe/ProbeState.java']) {
  return collectAmisSourceEvidence({rootDirectory: root, paths})
}

test('collects explicit production whitelist with canonical repo paths and aggregate hash', t => {
  const root = fixture(t), report = mini(root)
  assert.equal(report.schemaVersion, 1);assert.equal(report.statement, 'localfilebinding');assert.equal(report.rootIndependent, true)
  assert.deepEqual(Object.keys(report.files), ['scripts/amis-apps-expected-http.json', 'scripts/amis-apps-fault-cases.mjs', 'scripts/amis-apps-probe/ProbeState.java'])
  assert.equal(report.files['scripts/amis-apps-fault-cases.mjs'], digest('fixture:scripts/amis-apps-fault-cases.mjs'))
  const canonical = Object.entries(report.files).map(([name, hash]) => `${name}\0${hash}\n`).join('')
  assert.equal(report.aggregateSha256, digest(canonical))
})

test('same bytes in different absolute clones have identical aggregate', t => {
  const a = fixture(t), b = fixture(t)
  assert.deepEqual(mini(a), mini(b))
})

test('source byte changes change only the affected digest and aggregate', t => {
  const root = fixture(t), before = mini(root)
  writeFileSync(join(root, 'scripts/amis-apps-fault-cases.mjs'), 'changed')
  const after = mini(root)
  assert.notEqual(after.files['scripts/amis-apps-fault-cases.mjs'], before.files['scripts/amis-apps-fault-cases.mjs'])
  assert.notEqual(after.aggregateSha256, before.aggregateSha256)
  assert.equal(after.files['scripts/amis-apps-expected-http.json'], before.files['scripts/amis-apps-expected-http.json'])
})

for (const [name, mutate] of [
  ['missing file', root => rmSync(join(root, 'scripts/amis-apps-fault-cases.mjs'))],
  ['external path', root => collectAmisSourceEvidence({rootDirectory: root, paths: ['/tmp/secret']})],
  ['parent traversal', root => collectAmisSourceEvidence({rootDirectory: root, paths: ['scripts/../secret']})],
  ['backslash path', root => collectAmisSourceEvidence({rootDirectory: root, paths: ['scripts\\secret']})],
  ['symlink', root => { const target = join(root, 'scripts/target');writeFileSync(target, 'target');rmSync(join(root, 'scripts/amis-apps-fault-cases.mjs'));symlinkSync(target, join(root, 'scripts/amis-apps-fault-cases.mjs')) }],
  ['duplicate path', root => collectAmisSourceEvidence({rootDirectory: root, paths: ['scripts/amis-apps-fault-cases.mjs', 'scripts/amis-apps-fault-cases.mjs']})],
]) test(`rejects ${name}`, t => {
  const root = fixture(t)
  assert.throws(() => { mutate(root); mini(root) })
})

test('default production whitelist is explicit and includes expected workflow/selection/probe inputs', () => {
  assert(amisAcceptanceSourcePaths.includes('scripts/amis-apps-expected-http.json'))
  assert(amisAcceptanceSourcePaths.includes('deployment/amis-apps-release.json'))
  assert(amisAcceptanceSourcePaths.includes('.github/workflows/compose-acceptance.yml'))
  assert(amisAcceptanceSourcePaths.includes('scripts/amis-apps-probe/compile.sh'))
  assert(amisAcceptanceSourcePaths.includes('scripts/amis-apps-probe/ProbeState.java'))
  assert(!amisAcceptanceSourcePaths.some(path => path.startsWith('.work/') || path.includes('private')))
})

for (const path of ['.env', '.work/inputs.private.json', 'kestra-plugin-amis-apps/src/Secret.java', 'scripts/unlisted.mjs']) {
  test(`existing non-whitelisted path cannot be collected: ${path}`, t => {
    const root = fixture(t), target = join(root, path)
    mkdirSync(dirname(target), {recursive: true});writeFileSync(target, 'DO-NOT-READ-CREDENTIAL')
    assert.throws(() => mini(root, [path]), /production whitelist/)
  })
}

test('directory symlink into another clone is rejected even for a whitelisted relative file', t => {
  const root = fixture(t), other = fixture(t)
  rmSync(join(root, 'scripts'), {recursive: true})
  symlinkSync(join(other, 'scripts'), join(root, 'scripts'))
  assert.throws(() => mini(root), /non-symlink/)
})

test('ordering is canonical and caller list is never mutated', t => {
  const root = fixture(t), paths = ['scripts/amis-apps-probe/ProbeState.java', 'scripts/amis-apps-fault-cases.mjs']
  const copy = [...paths], first = mini(root, paths), second = mini(root, [...paths].reverse())
  assert.deepEqual(paths, copy);assert.deepEqual(first, second)
  assert(!JSON.stringify(first).includes(root));assert(!JSON.stringify(first).includes('fixture:'))
})

test('production default collector reads the explicit current files without emitting contents or absolute root', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const value = collectAmisSourceEvidence({rootDirectory: root})
  assert.equal(Object.keys(value.files).length, amisAcceptanceSourcePaths.length)
  for (const [path, hash] of Object.entries(value.files)) assert.equal(hash, digest(readFileSync(join(root, path))))
  assert(!JSON.stringify(value).includes(root))
  assert(value.limitations.some(text => text.includes('in-memory')))
})
