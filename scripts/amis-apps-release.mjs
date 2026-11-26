import {java375Baseline, ui189Baseline, validateP1Reports} from './amis-apps-p1-report-validator.mjs'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {existsSync, lstatSync, readFileSync, readdirSync} from 'node:fs'
import {basename, dirname, extname, join, relative, resolve, sep} from 'node:path'
import {execFileSync} from 'node:child_process'
import {pathToFileURL} from 'node:url'

const HEX64 = /^[a-f0-9]{64}$/
const COMMIT40 = /^[a-f0-9]{40}$/
const HOST_IMAGE = /^ghcr\.io\/ai-specs\/kestra-overlay@sha256:[a-f0-9]{64}$/
const SAFE_RELATIVE = value => typeof value === 'string' && value.length > 0 && !value.startsWith('/') && !value.includes('\\') && !value.includes(':') && !value.split('/').some(part => part === '' || part === '.' || part === '..')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const fileHash = path => sha256(readFileSync(path))

function filesUnder(root) {
  const result = []
  const visit = directory => {
    for (const entry of readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name)
      const rel = relative(root, path).split(sep).join('/')
      const stat = lstatSync(path)
      assert(!stat.isSymbolicLink(), `symlink is forbidden: ${rel}`)
      if (entry.isDirectory()) visit(path)
      else result.push(rel)
    }
  }
  visit(root)
  return result
}

function loadJson(path, label) {
  assert(existsSync(path), `${label} is missing`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

function assertSourceTar(path, expectedCommit, expectedSources) {
  const script = `import hashlib,json,sys,tarfile
p,commit,source_json=sys.argv[1:]
expected=json.loads(source_json)
with tarfile.open(p, 'r:') as archive:
    members=archive.getmembers()
    assert members, 'source.tar is empty'
    assert all(not m.issym() and not m.islnk() and not m.name.startswith('/') and '\\\\' not in m.name and '..' not in m.name.split('/') for m in members), 'unsafe source.tar member'
    comments=[str(v) for m in members for k,v in m.pax_headers.items() if k == 'comment']
    assert commit in comments, 'source.tar pax comment does not contain expected commit'
    forbidden={'.env','.env.bak-round-ap','.git','.work'}
    assert not any(m.name.split('/')[0] in forbidden or m.name.endswith('/deployment.jar') or m.name.endswith('/deployment/libs') for m in members), 'private/build path in source.tar'
    regular={m.name: archive.extractfile(m).read() for m in members if m.isfile()}
    for key,digest in expected.items():
        name='ui/'+key
        assert name in regular, 'UI source missing from source.tar: '+name
        assert len(regular[name]) <= 16*1024*1024, 'UI source too large: '+name
        assert hashlib.sha256(regular[name]).hexdigest() == digest, 'UI source hash differs: '+name
print(json.dumps({'members':len(members),'paxCommentMatched':True,'uiSources':len(expected)}))`
  return JSON.parse(execFileSync('python3', ['-c', script, path, expectedCommit, JSON.stringify(expectedSources)], {encoding: 'utf8'}))
}

function xmlCounts(root, retainJava375 = false) {
  const xml = filesUnder(root).filter(path => /(?:java-results|java-reports)\/.*\.xml$/.test(path))
  const script = `import json,sys,xml.etree.ElementTree as ET
root=sys.argv[1]; suites_seen=set(); total=fail=error=skip=0; identities={}
baseline=json.loads(sys.argv[2])
for rel in json.loads(sys.stdin.read()):
 p=root+'/'+rel; tree=ET.parse(p); suites=[tree.getroot()] if tree.getroot().tag == 'testsuite' else list(tree.getroot())
 for suite in suites:
  suite_id=suite.attrib.get('name',rel)
  assert suite_id not in suites_seen, 'duplicate JUnit suite: '+suite_id
  suites_seen.add(suite_id)
  declared=int(suite.attrib.get('tests','0')); cases=list(suite.findall('testcase'))
  assert declared == len(cases), rel+': tests does not equal testcase count'
  assert all(int(suite.attrib.get(field,'0')) == 0 for field in ('failures','errors','skipped')), rel+': nonzero JUnit result header'
  for case in cases:
   fail += len(case.findall('failure')); error += len(case.findall('error')); skip += len(case.findall('skipped'))
  for case in cases:
   key=json.dumps([suite.attrib.get('name'),case.attrib.get('classname'),case.attrib.get('name')],ensure_ascii=False)
   identities[key]=identities.get(key,0)+1
  total += len(cases)
for suite,classname,name,count in baseline:
 assert identities.get(json.dumps([suite,classname,name],ensure_ascii=False),0)>=count, 'original Java baseline case missing: '+str([suite,classname,name])
print(json.dumps({'xmlFiles':len(json.loads(sys.stdin.read())) if False else len(${JSON.stringify(xml)}),'tests':total,'failures':fail,'errors':error,'skipped':skip}))`
  return JSON.parse(execFileSync('python3', ['-c', script, root, JSON.stringify(retainJava375 ? java375Baseline : [])], {input: JSON.stringify(xml), encoding: 'utf8'}))
}

export function unitCounts(root, expected, retainP0Baseline = false) {
  const path = join(root, 'ui-reports/unit.xml')
  assert(existsSync(path), 'ui-reports/unit.xml is missing')
  const script = `import sys,json,xml.etree.ElementTree as ET
root=ET.parse(sys.argv[1]).getroot(); assert root.tag == 'testsuites', 'unit.xml root must be testsuites'
def canonical(name):
 return name.replace('&quot;',chr(34)).replace('&apos;',chr(39))
seen=set(); normalized=set(); changes=[]; cases=list(root.findall('testcase')); assert len(cases)==int(sys.argv[2]), 'unit testcase count differs'
for case in cases:
 raw=(case.attrib.get('classname',''),case.attrib.get('name','')); ident=(raw[0],canonical(raw[1]))
 assert raw not in seen, 'duplicate raw unit testcase: '+str(raw); seen.add(raw)
 assert ident not in normalized, 'canonical unit testcase collision: '+str(ident); normalized.add(ident)
 if raw!=ident:changes.append({'classname':raw[0],'raw':raw[1],'canonical':ident[1]})
 assert not case.findall('failure') and not case.findall('error') and not case.findall('skipped'), 'unit testcase has failure/error/skipped'
baseline_raw=set();baseline_canonical=set()
for classname,name in json.loads(sys.argv[3]):
 raw=(classname,name);ident=(classname,canonical(name))
 assert raw not in baseline_raw and ident not in baseline_canonical, 'baseline identity collision'
 baseline_raw.add(raw);baseline_canonical.add(ident)
 assert ident in normalized, 'original UI baseline case missing: '+str([classname,name])
print(json.dumps({'testcases':len(cases),'normalization':{'rule':'one-layer quot/apos in testcase name only','changed':len(changes),'changes':changes,'baselineSource':'formal AMIS 68005440/sourceCI45807945363 unit.xml SHA256 1403da2d7a47b2f91f82b16c5c2eccdd2fc78d0605b8be9d7f347b6376b81366'}}))`
  const result = JSON.parse(execFileSync('python3', ['-c', script, path, String(expected), JSON.stringify(retainP0Baseline ? ui189Baseline : [])], {encoding: 'utf8'}))
  return {...result, failures: 0, errors: 0, skipped: 0}

}

function assertJar(root, uiInputs) {
  const jar=join(root,'kestra-amis-apps.jar')
  const script=`import hashlib,json,sys,zipfile
jar,assets_json=sys.argv[1:]; assets=json.loads(assets_json)
with zipfile.ZipFile(jar) as z:
 names=z.namelist(); assert len(names)==len(set(names)), 'duplicate jar entry'; assert all(not n.endswith('.jar') for n in names), 'nested jar forbidden'
 classes=[n for n in names if n.endswith('.class')]; assert all(n.startswith('io/kestra/plugin/amis/apps/') for n in classes), 'non-plugin Java class in jar'
 bean='META-INF/micronaut/io.micronaut.inject.BeanDefinitionReference/'
 intro='META-INF/micronaut/io.micronaut.core.beans.BeanIntrospectionReference/'
 beans=[n for n in names if n.startswith(bean) and not n.endswith('/')]; intros=[n for n in names if n.startswith(intro) and not n.endswith('/')]
 assert len(beans)==1 and beans[0].endswith('$AmisHttpRouteProvider$Definition'), 'bean index set differs'
 assert sorted(intros)==sorted([intro+'io.kestra.plugin.amis.apps.$ApiTrigger$Introspection',intro+'io.kestra.plugin.amis.apps.$PageTrigger$Introspection']), 'introspection index set differs'
 services=z.read('META-INF/services/io.kestra.core.models.Plugin').decode().splitlines(); assert sorted([x for x in services if x])==['io.kestra.plugin.amis.apps.ApiTrigger','io.kestra.plugin.amis.apps.PageTrigger'], 'Plugin services differ'
 for path,digest in assets.items():
  packaged='META-INF/kestra/amis-apps/runtime/'+path
  assert packaged in names and hashlib.sha256(z.read(packaged)).hexdigest()==digest, 'jar asset mismatch: '+path
print(json.dumps({'classes':len(classes),'beans':len(beans),'introspections':len(intros),'assets':len(assets)}))`
  return JSON.parse(execFileSync('python3',['-c',script,jar,JSON.stringify(uiInputs.assets)],{encoding:'utf8'}))
}

const runtimeNames = ['en light', 'en dark', 'en dark-2', 'en syncWithSystem', 'en narrow-focus', 'zh-CN light', 'zh-CN dark', 'zh-CN dark-2', 'zh-CN syncWithSystem', 'zh-CN narrow-focus'].map(theme => `TEST TRANSPORT matrix ${theme}: real AMIS input submit result`)
const runtimeNamesTail = ['TEST TRANSPORT schema loading then real renderer', ...[401, 403, 404, 503].flatMap(status => [`TEST TRANSPORT schema HTTP ${status}: visible error and exit`, `TEST TRANSPORT API HTTP ${status}: no empty success`]), 'TEST TRANSPORT 202 polling waits through terminal state with unreadable outputs', 'TEST TRANSPORT failed execution is visible', 'TEST TRANSPORT external polling rejected before any external request', 'TEST TRANSPORT explicit cancellation stops polling', 'TEST TRANSPORT unload cancels polling', 'TEST TRANSPORT polling timeout has visible error', 'TEST TRANSPORT missing CSRF prevents API write', 'TEST TRANSPORT review bare greet uses bootstrap API base', 'TEST TRANSPORT review SYNC rejects missing execution ID', 'TEST TRANSPORT review SYNC rejects unknown execution state', 'TEST TRANSPORT review SYNC rejects running result claimed ready', 'TEST TRANSPORT review polling rejects unknown state', 'TEST TRANSPORT review polling ignores later external URL', 'TEST TRANSPORT review API rejects ../greet before network write', 'TEST TRANSPORT review API rejects /api/v1/main/flows before network write', 'TEST TRANSPORT review API rejects https://evil.test/greet before network write']
const UI_RUNTIME_CASES = [...runtimeNames, ...runtimeNamesTail]
const UI_PREFERENCE_CASES = ['FORMAL preference regression: selected locale survives refresh', 'FORMAL preference regression: selected theme survives refresh']

// P1 is an explicit input stage, but cannot pass until its published report
// schema and retained named baseline have been reviewed against real artifacts.
export function validateAmisReleaseExpected(expected) {
  assert(expected && ['P0', 'P1'].includes(expected.stage), 'Explicit P0 or P1 stage required')
  if (expected.stage === 'P1') assert(Number.isSafeInteger(expected.expectedTests) && expected.expectedTests >= 375,
    'P1 requires an exact Java test count retaining at least the original 375 cases')
  return expected.stage
}

export function validateAmisPublishedRelease(directory, expected) {
  const root = resolve(directory)
  assert(existsSync(root) && lstatSync(root).isDirectory(), 'release directory is missing')
  validateAmisReleaseExpected(expected)
  assert(COMMIT40.test(expected.amisCommit), 'expected.amisCommit must be a 40-hex commit')
  assert(HOST_IMAGE.test(expected.hostImage), 'expected.hostImage must be immutable formal digest')
  const provenance = loadJson(join(root, 'release-provenance.json'), 'release-provenance.json')
  assert.equal(provenance.schemaVersion, 1)
  assert.equal(provenance.repository, 'ai-specs/kestra-plugin-amis-apps')
  assert.equal(provenance.commit, expected.amisCommit)
  assert.equal(provenance.host?.image, expected.hostImage)
  const sourceCi = provenance.sourceCi
  assert(sourceCi && sourceCi.status === 'completed' && sourceCi.conclusion === 'success' && sourceCi.event === 'push' && sourceCi.branch === 'main' && sourceCi.headSha === expected.amisCommit && Number.isInteger(sourceCi.runId) && sourceCi.runId > 0, 'source CI provenance is incomplete')
  const hostContract = readFileSync(join(root, 'host-contract.properties'), 'utf8').split(/\r?\n/).find(line => line.startsWith('overlay.image='))?.slice('overlay.image='.length)
  assert.equal(hostContract, expected.hostImage)
  const uiInputs = loadJson(join(root, 'ui-reports/inputs.json'), 'UI inputs')
  const hostProvenance = loadJson(join(root, 'host-provenance.json'), 'host-provenance.json')
  assert.equal(hostProvenance.image, expected.hostImage)
  assert(HEX64.test(expected.hostExecutableSha256), 'expected.hostExecutableSha256 must be a SHA-256')
  assert.equal(hostProvenance.sha256, expected.hostExecutableSha256)
  assert.equal(uiInputs.host?.extractedFromSha256, expected.hostExecutableSha256)
  assert(HEX64.test(provenance.jarSha256), 'jarSha256 is invalid')
  assert.equal(fileHash(join(root, 'kestra-amis-apps.jar')), provenance.jarSha256)
  assert.equal(provenance.files['kestra-amis-apps.jar'], provenance.jarSha256)
  const actualFiles = filesUnder(root).filter(path => path !== 'release-provenance.json')
  assert.deepEqual(Object.keys(provenance.files).sort(), actualFiles.sort(), 'release files differ from provenance')
  for (const [path, digest] of Object.entries(provenance.files)) {
    assert(SAFE_RELATIVE(path), `unsafe release path: ${path}`)
    assert(HEX64.test(digest), `invalid release hash: ${path}`)
    assert.equal(fileHash(join(root, path)), digest, `release bytes differ: ${path}`)
  }
  assert(HEX64.test(uiInputs.sourceSha256), 'UI source hash missing')
  const sourceTar = assertSourceTar(join(root, 'source.tar'), expected.amisCommit, uiInputs.source)
  const jarAudit = assertJar(root, uiInputs)
  const java = xmlCounts(root, expected.stage === 'P1')
  assert.equal(java.failures, 0); assert.equal(java.errors, 0); assert.equal(java.skipped, 0)
  if (expected.expectedTests !== undefined) assert.equal(java.tests, expected.expectedTests)
  const translations = loadJson(join(root, 'ui-reports/translations.json'), 'translations report')
  assert.equal(translations.passed, true); assert.equal(translations.reports.length, 13); for (const row of translations.reports) assert.deepEqual(row.errors, [])
  const unitExpected=expected.stage==='P1'?211:189
  if(expected.uiUnitTests!==undefined)assert.equal(expected.uiUnitTests,unitExpected,'Stage UI unit count differs')
  const unit = unitCounts(root, unitExpected, expected.stage==='P1')
  const ui = loadJson(join(root, 'ui-reports/summary.json'), 'ui summary')
  assert.equal(ui.acceptancePassed, true); assert.deepEqual(ui.failures, [])
  assert.deepEqual(ui.cases.map(row => row.name), UI_RUNTIME_CASES)
  assert(ui.cases.every(row => row.status === 'expected' && row.results.length === 1 && row.results[0] === 'passed'))
  assert.deepEqual(ui.preferences.cases.map(row => row.name), UI_PREFERENCE_CASES)
  assert(ui.preferences.cases.every(row => row.status === 'expected' && row.results[0] === 'passed'))
  assert.equal(ui.stats.expected, 35); assert.equal(ui.stats.unexpected, 0); assert.equal(ui.stats.skipped, 0); assert.equal(ui.stats.flaky, 0)
  assert.equal(ui.preferences.stats.expected, 2); assert.equal(ui.preferences.stats.unexpected, 0); assert.equal(ui.preferences.stats.skipped, 0); assert.equal(ui.preferences.stats.flaky, 0)
  assert(typeof ui.sourceSha256 === 'string' && HEX64.test(ui.sourceSha256), 'UI source hash missing')
  assert(HEX64.test(ui.chromiumReportSha256) && HEX64.test(ui.preferences.reportSha256), 'UI report hashes missing')
  assert.equal(provenance.files['ui-reports/summary.json'], fileHash(join(root, 'ui-reports/summary.json')))
  assert.equal(ui.chromiumReportSha256, fileHash(join(root, 'ui-reports/chromium.json')))
  assert.equal(uiInputs.sourceSha256, ui.sourceSha256)
  assert.equal(ui.preferences.reportSha256, fileHash(join(root, 'ui-reports/preferences-red.json')))
  const p1 = expected.stage === 'P1' ? validateP1Reports(root, expected, uiInputs.sourceSha256, provenance) : undefined
  return {stage: expected.stage, ...(p1 ? {p1} : {}), commit: provenance.commit, java, ui: {runtime: 35, preferences: 2, unit: unit.testcases, skipped: 0, flaky: 0}, sourceTar, jarAudit, files: actualFiles.length}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, expectedPath] = process.argv.slice(2)
  assert(directory && expectedPath, 'Usage: node scripts/amis-apps-release.mjs RELEASE_DIRECTORY EXPECTED_JSON')
  console.log(JSON.stringify(validateAmisPublishedRelease(directory, loadJson(resolve(expectedPath), 'expected inputs')), null, 2))
}
