import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import test from 'node:test'
import {validateAmisPublishedRelease} from '../amis-apps-release.mjs'

const digest = value => createHash('sha256').update(value).digest('hex')
const commit = 'a'.repeat(40)
const hostImage = `ghcr.io/ai-specs/kestra-overlay@sha256:${'b'.repeat(64)}`
const hostExecutableSha256='f'.repeat(64); const expected = {amisCommit: commit, hostImage, hostExecutableSha256, stage: 'P0', expectedTests: 355, uiUnitTests: 189}
const runtimeCases = ['en light','en dark','en dark-2','en syncWithSystem','en narrow-focus','zh-CN light','zh-CN dark','zh-CN dark-2','zh-CN syncWithSystem','zh-CN narrow-focus'].map(theme => `TEST TRANSPORT matrix ${theme}: real AMIS input submit result`)
const tail = ['TEST TRANSPORT schema loading then real renderer', ...[401,403,404,503].flatMap(status => [`TEST TRANSPORT schema HTTP ${status}: visible error and exit`, `TEST TRANSPORT API HTTP ${status}: no empty success`]), 'TEST TRANSPORT 202 polling waits through terminal state with unreadable outputs','TEST TRANSPORT failed execution is visible','TEST TRANSPORT external polling rejected before any external request','TEST TRANSPORT explicit cancellation stops polling','TEST TRANSPORT unload cancels polling','TEST TRANSPORT polling timeout has visible error','TEST TRANSPORT missing CSRF prevents API write','TEST TRANSPORT review bare greet uses bootstrap API base','TEST TRANSPORT review SYNC rejects missing execution ID','TEST TRANSPORT review SYNC rejects unknown execution state','TEST TRANSPORT review SYNC rejects running result claimed ready','TEST TRANSPORT review polling rejects unknown state','TEST TRANSPORT review polling ignores later external URL','TEST TRANSPORT review API rejects ../greet before network write','TEST TRANSPORT review API rejects /api/v1/main/flows before network write','TEST TRANSPORT review API rejects https://evil.test/greet before network write']
const uiCases = [...runtimeCases, ...tail]
function buildRelease() {
  const root = mkdtempSync(join(tmpdir(), 'amis-release-')); const payload = root
  const jar = 'thin jar bytes';
  mkdirSync(join(payload, 'ui-reports'));
  const uiSource = {host:{extractedFromSha256:hostExecutableSha256},source: {'src/source.js': 'd'.repeat(64)}, sourceSha256:'c'.repeat(64), assets: {'index.html':digest(Buffer.from('html'))}};
  writeFileSync(join(payload, 'ui-reports/inputs.json'), JSON.stringify(uiSource));
  writeFileSync(join(payload, 'ui-reports/translations.json'), JSON.stringify({passed:true,reports:Array.from({length:13},()=>({errors:[]}))}));
  writeFileSync(join(payload, 'ui-reports/unit.xml'), `<testsuites>${Array.from({length:189},(_,i)=>`<testcase classname="unit" name="case-${i}"/>`).join('')}</testsuites>`);
  const jarPath=join(payload,'kestra-amis-apps.jar'); execFileSync('python3',['-c', `import zipfile,sys,hashlib
p=sys.argv[1]
with zipfile.ZipFile(p,'w') as z:
 z.writestr('io/kestra/plugin/amis/apps/Only.class',b'x')
 z.writestr('META-INF/micronaut/io.micronaut.inject.BeanDefinitionReference/io.kestra.plugin.amis.apps.runtime.$AmisHttpRouteProvider$Definition',b'')
 z.writestr('META-INF/micronaut/io.micronaut.core.beans.BeanIntrospectionReference/io.kestra.plugin.amis.apps.$ApiTrigger$Introspection',b'')
 z.writestr('META-INF/micronaut/io.micronaut.core.beans.BeanIntrospectionReference/io.kestra.plugin.amis.apps.$PageTrigger$Introspection',b'')
 z.writestr('META-INF/services/io.kestra.core.models.Plugin',chr(10).join(['io.kestra.plugin.amis.apps.ApiTrigger','io.kestra.plugin.amis.apps.PageTrigger','']))
 z.writestr('META-INF/kestra/amis-apps/runtime/index.html',b'html')`, jarPath]); writeFileSync(jarPath, readFileSync(jarPath))
  writeFileSync(join(payload, 'host-contract.properties'), `overlay.image=${hostImage}\n`)
  writeFileSync(join(payload, 'host-provenance.json'), JSON.stringify({image: hostImage, sha256: hostExecutableSha256}))
  mkdirSync(join(payload, 'java-results')); writeFileSync(join(payload, 'java-results/TEST-runtime.xml'), `<testsuite tests="355" failures="0" errors="0" skipped="0">${Array.from({length:355},(_,i)=>`<testcase classname="fixture" name="case-${i}"/>`).join('')}</testsuite>`)
  const chromium = JSON.stringify({ok:true}); const prefs = JSON.stringify({ok:true})
  writeFileSync(join(payload, 'ui-reports/chromium.json'), chromium); writeFileSync(join(payload, 'ui-reports/preferences-red.json'), prefs)
  writeFileSync(join(payload, 'ui-reports/summary.json'), JSON.stringify({acceptancePassed:true, failures:[], sourceSha256:'c'.repeat(64), chromiumReportSha256:digest(chromium), preferences:{reportSha256:digest(prefs),stats:{expected:2,unexpected:0,skipped:0,flaky:0},cases:[{name:'FORMAL preference regression: selected locale survives refresh',status:'expected',results:['passed']},{name:'FORMAL preference regression: selected theme survives refresh',status:'expected',results:['passed']}]}, stats:{expected:35,unexpected:0,skipped:0,flaky:0}, cases:uiCases.map(name => ({name,status:'expected',results:['passed']}))}))
  const sourcePath=join(payload,'ui','src'); mkdirSync(sourcePath,{recursive:true}); writeFileSync(join(sourcePath,'source.js'),'source'); uiSource.source['src/source.js']=digest(Buffer.from('source')); writeFileSync(join(payload,'ui-reports/inputs.json'),JSON.stringify(uiSource));
  const tarPath = join(payload, 'source.tar'); execFileSync('python3', ['-c', `import tarfile,sys
with tarfile.open(sys.argv[1],'w') as t:
 i=tarfile.TarInfo('README.md'); b=b'release test'; i.size=len(b); i.pax_headers={'comment':sys.argv[2]}; t.addfile(i,__import__('io').BytesIO(b))
 i=tarfile.TarInfo('ui/src/source.js'); b=b'source'; i.size=len(b); t.addfile(i,__import__('io').BytesIO(b))`, tarPath, commit])
  const files = {}; for (const name of ['kestra-amis-apps.jar','host-contract.properties','host-provenance.json','java-results/TEST-runtime.xml','ui-reports/chromium.json','ui-reports/inputs.json','ui-reports/translations.json','ui-reports/unit.xml','ui-reports/preferences-red.json','ui-reports/summary.json','source.tar','ui/src/source.js']) files[name] = digest(readFileSync(join(payload,name)))
  writeFileSync(join(payload, 'release-provenance.json'), JSON.stringify({schemaVersion:1,repository:'ai-specs/kestra-plugin-amis-apps',commit,sourceCi:{status:'completed',conclusion:'success',event:'push',branch:'main',headSha:commit,runId:7},jarSha256:files['kestra-amis-apps.jar'],host:{image:hostImage},files}))
  return root
}
test('accepts a complete release fixture', context => { const root=buildRelease(); context.after(()=>rmSync(root,{recursive:true,force:true})); assert.equal(validateAmisPublishedRelease(root, expected).java.tests,355) })
for (const [name, mutate] of Object.entries({
  'wrong commit': p => {const v=JSON.parse(readFileSync(join(p,'release-provenance.json')));v.commit='d'.repeat(40);writeFileSync(join(p,'release-provenance.json'),JSON.stringify(v))},
  'wrong host': p => writeFileSync(join(p,'host-contract.properties'),'overlay.image=ghcr.io/ai-specs/kestra-overlay@sha256:'+'e'.repeat(64)),
  'bad hash': p => writeFileSync(join(p,'kestra-amis-apps.jar'),'changed'),
  'header skip zero but child skipped': p => writeFileSync(join(p,'java-results/TEST-runtime.xml'), `<testsuite tests="1" failures="0" errors="0" skipped="0"><testcase classname="x" name="x"><skipped/></testcase></testsuite>`),
  'tests one empty suite': p => writeFileSync(join(p,'java-results/TEST-runtime.xml'), '<testsuite tests="1" failures="0" errors="0" skipped="0"></testsuite>'),
  'skipped Java': p => writeFileSync(join(p,'java-results/TEST-runtime.xml'),'<testsuite tests="355" failures="0" errors="0" skipped="1"/>'),
  'path traversal': p => {const v=JSON.parse(readFileSync(join(p,'release-provenance.json')));v.files['../escape']='a'.repeat(64);writeFileSync(join(p,'release-provenance.json'),JSON.stringify(v))},
  'symlink': p => {symlinkSync(join(p,'kestra-amis-apps.jar'),join(p,'link.jar'))},
  'source CI failed': p => {const v=JSON.parse(readFileSync(join(p,'release-provenance.json')));v.sourceCi.conclusion='failure';writeFileSync(join(p,'release-provenance.json'),JSON.stringify(v))},
  'missing unit.xml': p => {const v=JSON.parse(readFileSync(join(p,'release-provenance.json')));delete v.files['ui-reports/unit.xml'];writeFileSync(join(p,'release-provenance.json'),JSON.stringify(v));},
  'unit child failure': p => writeFileSync(join(p,'ui-reports/unit.xml'), '<testsuites><testcase classname="x" name="x"><failure/></testcase></testsuites>'),
  'unit missing case': p => writeFileSync(join(p,'ui-reports/unit.xml'), '<testsuites></testsuites>'),
  'missing UI case': p => {const v=JSON.parse(readFileSync(join(p,'ui-reports/summary.json')));v.cases.pop();writeFileSync(join(p,'ui-reports/summary.json'),JSON.stringify(v))},
})) test(`rejects ${name}`, context => {
  const root=buildRelease()
  context.after(()=>rmSync(root,{recursive:true,force:true}))
  mutate(root)
  // Keep the mutated bytes bound by provenance so semantic rejection cases
  // reach their intended matrix check rather than only a checksum mismatch.
  if (['header skip zero but child skipped', 'tests one empty suite', 'skipped Java',
    'unit child failure', 'unit missing case', 'missing UI case'].includes(name)) {
    const path=join(root,'release-provenance.json')
    const provenance=JSON.parse(readFileSync(path,'utf8'))
    for (const file of Object.keys(provenance.files)) provenance.files[file]=digest(readFileSync(join(root,file)))
    writeFileSync(path,JSON.stringify(provenance))
  }
  assert.throws(()=>validateAmisPublishedRelease(root,expected))
})
