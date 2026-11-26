import {java375Baseline, ui189Baseline, p1Cases, validateP1Reports, p1SourceEvidence, validateP1ProductionEvidence} from '../amis-apps-p1-report-validator.mjs'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import test from 'node:test'
import {validateAmisPublishedRelease, unitCounts} from '../amis-apps-release.mjs'

const digest = value => createHash('sha256').update(value).digest('hex')
const commit = 'a'.repeat(40)
const hostImage = `ghcr.io/ai-specs/kestra-overlay@sha256:${'b'.repeat(64)}`
const hostExecutableSha256='f'.repeat(64); const expected = {amisCommit: commit, hostImage, hostExecutableSha256, stage: 'P0', expectedTests: 355, }
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

test('explicit stages reject missing unknown and malformed P1 expected counts before release parsing', t=>{
  const root=buildRelease();t.after(()=>rmSync(root,{recursive:true,force:true}))
  for(const stage of [undefined,null,'P2','p1','',0])assert.throws(()=>validateAmisPublishedRelease(root,{...expected,stage}),/Explicit P0 or P1/)
  for(const expectedTests of [undefined,374,0,375.5,'375'])assert.throws(()=>validateAmisPublishedRelease(root,{...expected,stage:'P1',expectedTests}),/P1 requires an exact Java test count/)
})

test('P1 cannot pass a valid retained P0 report before the actual P1 schema is accepted', t=>{
  const root=buildRelease();t.after(()=>rmSync(root,{recursive:true,force:true}))
  writeFileSync(join(root,'java-results/TEST-runtime.xml'),`<testsuite tests="375" failures="0" errors="0" skipped="0">${Array.from({length:375},(_,i)=>`<testcase classname="fixture" name="case-${i}"/>`).join('')}</testsuite>`)
  const path=join(root,'release-provenance.json'),provenance=JSON.parse(readFileSync(path))
  provenance.files['java-results/TEST-runtime.xml']=digest(readFileSync(join(root,'java-results/TEST-runtime.xml')))
  writeFileSync(path,JSON.stringify(provenance))
  assert.throws(()=>validateAmisPublishedRelease(root,{...expected,stage:'P1',expectedTests:375}),/original Java baseline case missing/)
})

// Synthetic protocol reports only; these do not prove a production run.
function singleProductionEvidence(id) {
 const api='/company.p1/p1-async/apis/run',zero=['P1 PRODUCTION rejected POST has zero side effects','P1 PRODUCTION required validation creates zero execution'].includes(id)
 const ids=zero?[]:['execution-1'],sources={database:'a'.repeat(64),queue:'b'.repeat(64),storage:'c'.repeat(64)}
 return {scope:'production-execution',expectedFlowId:'p1-async',caller:'actor',apiId:'run',executionIds:ids,beforeExecutionIds:[],afterExecutionIds:ids,expectedNewExecutions:ids.length,consoleErrors:[],requests:zero&&id.includes('required')?[]:[{method:'POST',path:api,inputs:{name:'changed'}}],responses:zero&&id.includes('required')?[]:[{method:'POST',path:api,httpStatus:zero?403:200,...(zero?{}:{executionId:ids[0]})}],executions:ids.map(id=>({id,namespace:'company.p1',flowId:'p1-async',state:{current:'SUCCESS'},inputs:{name:'changed'},outputs:{response:{message:'changed'}},trigger:{type:'io.kestra.plugin.amis.apps.ApiTrigger',variables:{apiId:'run',caller:'actor'}}})),...(id.includes('rejected')?{sideEffects:{windowMs:5000,before:sources,after:sources,observations:[{elapsedMs:5000,sources}]}}:{})}
}
function productionEvidence(id) {
 const caseId=id==='normal'?p1Cases.production[0]:id,plan=p1Cases.productionFlows[caseId]
 const flows=Object.entries(plan).map(([flowId,count])=>{
  const base=singleProductionEvidence(count===0?caseId:'normal'),old='/company.p1/p1-async/',next='/company.p1/'+flowId+'/'
  const flow=JSON.parse(JSON.stringify(base).replaceAll(old,next));flow.namespace='company.p1';flow.expectedFlowId=flowId;flow.expectedNewExecutions=count
  if(count>0){flow.executionIds=Array.from({length:count},(_,i)=>flowId+'-'+i);flow.afterExecutionIds=[...flow.executionIds];flow.executions=flow.executionIds.map(id=>({...structuredClone(flow.executions[0]),id,flowId}));flow.responses=flow.executionIds.map(id=>({...structuredClone(flow.responses[0]),executionId:id}))}
  delete flow.sideEffects;delete flow.scope;delete flow.consoleErrors;return flow
 })
 return {scope:'production-execution',caseId,caller:'actor',consoleErrors:[],flows,executionIds:flows.flatMap(f=>f.executionIds),executions:flows.flatMap(f=>f.executions),requests:flows.flatMap(f=>f.requests),responses:flows.flatMap(f=>f.responses),...(caseId.includes('rejected')?{sideEffects:singleProductionEvidence(caseId).sideEffects}:{})}
}
function p1ReportFixture(t) {
  const root=buildRelease();t.after(()=>rmSync(root,{recursive:true,force:true}))
  mkdirSync(join(root,'contracts'));mkdirSync(join(root,'ui-reports'),{recursive:true})
  const manifest=JSON.stringify(p1Cases),provenance={jarSha256:'e'.repeat(64),files:{}}
  writeFileSync(join(root,'contracts/p1-cases.json'),manifest)
  provenance.files['contracts/p1-cases.json']=digest(manifest)
  writeFileSync(join(root,'ui-reports/p1-chromium.json'),'{}');provenance.files['ui-reports/p1-chromium.json']=digest('{}')
  execFileSync('python3',['-c',"import tarfile,sys; t=tarfile.open(sys.argv[1],'a'); t.add(sys.argv[2],arcname='contracts/p1-cases.json'); t.close()",join(root,'source.tar'),join(root,'contracts/p1-cases.json')])
  const fullSource=p1SourceEvidence(join(root,'source.tar'),commit)
  const reports={}
  for(const kind of ['transport','production']) {
    const attachment=`${kind}-evidence.json`,data=JSON.stringify({synthetic:true})
    writeFileSync(join(root,'ui-reports',attachment),data);provenance.files['ui-reports/'+attachment]=digest(data)
    const report={schemaVersion:1,scope:kind==='transport'?'test-transport':'production-execution',manifestSha256:digest(manifest),sourceCommit:commit,sourceSha256:fullSource.sourceSha256,hostImage,hostExecutableSha256,jarSha256:provenance.jarSha256,passed:true,cases:p1Cases[kind].map(id=>({id,status:'passed',evidence:[{path:attachment,sha256:digest(data)}]})),stats:{expected:p1Cases[kind].length,passed:p1Cases[kind].length,failed:0,skipped:0,notRun:0}}
    if(kind==='production')Object.assign(report,{sourceStable:true,sourceAtStart:{sourceCommit:commit,sourceSha256:fullSource.sourceSha256},sourceAtEnd:{sourceCommit:commit,sourceSha256:fullSource.sourceSha256}})
    if(kind==='production')report.cases.forEach((row,index)=>{
      const name=`production-${index}.json`,value=productionEvidence(row.id),bytes=JSON.stringify(value)
      writeFileSync(join(root,'ui-reports',name),bytes);provenance.files['ui-reports/'+name]=digest(bytes)
      row.evidence=[{path:name,sha256:digest(bytes)}]
    })
    reports[kind]=report
  }
  const save=()=>{for(const [kind,report]of Object.entries(reports)){const name=`ui-reports/p1-${kind}.json`,bytes=JSON.stringify(report);writeFileSync(join(root,name),bytes);provenance.files[name]=digest(bytes)}}
  save();return {root,reports,provenance,save,check:()=>validateP1Reports(root,{...expected,stage:'P1'},'c'.repeat(64),provenance)}
}
test('SYNTHETIC P1 protocol validates exact 20/16 matrices and publisher-bound attachments',t=>{
 const f=p1ReportFixture(t);assert.equal(f.check().transport.cases,20);assert.equal(f.check().production.cases,16)
 assert.equal(java375Baseline.reduce((sum,row)=>sum+row[3],0),375)
})
for(const field of ['schemaVersion','scope','manifestSha256','sourceCommit','sourceSha256','hostImage','hostExecutableSha256','jarSha256','passed'])test(`P1 rejects missing or wrong ${field}`,t=>{
 const f=p1ReportFixture(t);delete f.reports.production[field];f.save();assert.throws(f.check)
})
for(const fault of ['missing-case','duplicate-case','reordered-case','failed','skipped','not-run','bad-stats','no-evidence','traversal','wrong-evidence-hash','unregistered-evidence','null-jar','missing-report','unbound-report','changed-source-manifest'])test(`P1 rejects ${fault}`,t=>{
 const f=p1ReportFixture(t),r=f.reports.production
 if(fault==='missing-case')r.cases.pop()
 if(fault==='duplicate-case')r.cases[1]=structuredClone(r.cases[0])
 if(fault==='reordered-case')r.cases.reverse()
 if(['failed','skipped','not-run'].includes(fault))r.cases[0].status=fault
 if(fault==='bad-stats')r.stats.passed--
 if(fault==='no-evidence')r.cases[0].evidence=[]
 if(fault==='traversal')r.cases[0].evidence[0].path='../outside'
 if(fault==='wrong-evidence-hash')r.cases[0].evidence[0].sha256='0'.repeat(64)
 if(fault==='null-jar')r.jarSha256=null
 f.save()
 if(fault==='unregistered-evidence')delete f.provenance.files['ui-reports/production-0.json']
 if(fault==='missing-report')rmSync(join(f.root,'ui-reports/p1-production.json'))
 if(fault==='unbound-report')delete f.provenance.files['ui-reports/p1-production.json']
 if(fault==='changed-source-manifest')writeFileSync(join(f.root,'contracts/p1-cases.json'),JSON.stringify({...p1Cases,transport:[]}))
 assert.throws(f.check)
})

test('SYNTHETIC full P1 reader retains the exact formal 375 Java baseline plus old UI35+2',t=>{
 const f=p1ReportFixture(t)
 execFileSync('python3',['-c',`import json,sys,xml.etree.ElementTree as E
rows=json.loads(sys.stdin.read());root=E.Element('testsuites');suites={}
for suite,classname,name,count in rows:
 if suite not in suites:suites[suite]=E.SubElement(root,'testsuite',name=suite,tests='0',failures='0',errors='0',skipped='0')
 s=suites[suite]
 for _ in range(count):E.SubElement(s,'testcase',classname=classname,name=name)
for s in suites.values():s.set('tests',str(len(s)))
E.ElementTree(root).write(sys.argv[1],encoding='utf-8')`,join(f.root,'java-results/TEST-runtime.xml')],{input:JSON.stringify(java375Baseline)})
 writeP1Unit(f.root)
 const provenance=JSON.parse(readFileSync(join(f.root,'release-provenance.json')))
 for(const name of Object.keys(provenance.files))provenance.files[name]=digest(readFileSync(join(f.root,name)))
 for(const name of ['contracts/p1-cases.json',...Object.keys(f.provenance.files)])provenance.files[name]=digest(readFileSync(join(f.root,name)))
 for(const kind of ['transport','production']){f.reports[kind].jarSha256=provenance.jarSha256}
 f.save()
 for(const name of Object.keys(f.provenance.files))provenance.files[name]=digest(readFileSync(join(f.root,name)))
 writeFileSync(join(f.root,'release-provenance.json'),JSON.stringify(provenance))
 const result=validateAmisPublishedRelease(f.root,{...expected,stage:'P1',expectedTests:375})
 assert.equal(result.stage,'P1');assert.equal(result.java.tests,375);assert.equal(result.ui.runtime,35);assert.equal(result.ui.preferences,2)
 // Replace an original parameterized instance while keeping total=375 and all headers green.
 const xml=join(f.root,'java-results/TEST-runtime.xml')
 execFileSync('python3',['-c',"import sys,xml.etree.ElementTree as E; p=sys.argv[1]; t=E.parse(p); s=next(s for s in t.getroot() if len(s)); s[0].set('name','replacement-not-original'); t.write(p,encoding='utf-8')",xml])
 provenance.files['java-results/TEST-runtime.xml']=digest(readFileSync(xml))
 writeFileSync(join(f.root,'release-provenance.json'),JSON.stringify(provenance))
 assert.throws(()=>validateAmisPublishedRelease(f.root,{...expected,stage:'P1',expectedTests:375}),/original Java baseline case missing/)

})

for(const fault of ['missing-flow','wrong-flow','missing-caller','wrong-caller','wrong-api','missing-inventory','duplicate-id','count-mismatch','foreign-execution','missing-inputs','missing-output','missing-trigger','short-window','changed-queue','no-denial-response'])test(`P1 semantic evidence rejects ${fault}`,()=>{
 const id='P1 PRODUCTION rejected POST has zero side effects',e=productionEvidence(id),normal=productionEvidence('normal')
 const top=['short-window','changed-queue','no-denial-response'].includes(fault)?e:normal
 const value=top.flows[0];value.sideEffects=top.sideEffects
 if(fault==='missing-flow')delete value.expectedFlowId
 if(fault==='wrong-flow')value.executions[0].flowId='foreign'
 if(fault==='missing-caller')delete value.caller
 if(fault==='wrong-caller')value.executions[0].trigger.variables.caller='foreign'
 if(fault==='wrong-api')value.apiId='foreign'
 if(fault==='missing-inventory')delete value.beforeExecutionIds
 if(fault==='duplicate-id')value.executionIds.push(value.executionIds[0])
 if(fault==='count-mismatch')value.expectedNewExecutions=2
 if(fault==='foreign-execution')value.responses[0].executionId='foreign'
 if(fault==='missing-inputs')delete value.executions[0].inputs
 if(fault==='missing-output')delete value.executions[0].outputs
 if(fault==='missing-trigger')delete value.executions[0].trigger
 if(fault==='short-window')value.sideEffects.windowMs=3000
 if(fault==='changed-queue')value.sideEffects.after={...value.sideEffects.after,queue:'0'.repeat(64)}
 if(fault==='no-denial-response')value.responses=[]
 assert.throws(()=>validateP1ProductionEvidence(top,top.caseId))
})

for(const fault of ['wrong-commit','duplicate','traversal','absolute','symlink','private','binary','wrong-source-sha','wrong-tar-manifest'])test(`P1 source.tar rejects ${fault}`,t=>{
 const f=p1ReportFixture(t)
 if(fault==='wrong-commit'){assert.throws(()=>p1SourceEvidence(join(f.root,'source.tar'),'0'.repeat(40)));return}
 if(fault==='wrong-source-sha'){f.reports.production.sourceSha256='0'.repeat(64);f.save();assert.throws(f.check,/full source SHA/);return}
 const path= fault==='duplicate'?'README.md':fault==='traversal'?'../outside':fault==='absolute'?'/outside':fault==='private'?'.work/private.json':fault==='binary'?'build.jar':fault==='wrong-tar-manifest'?'contracts/p1-cases.json':'linked'
 execFileSync('python3',['-c',`import sys,tarfile,io
with tarfile.open(sys.argv[1],'a') as t:
 m=tarfile.TarInfo(sys.argv[2])
 if sys.argv[3]=='symlink':m.type=tarfile.SYMTYPE;m.linkname='README.md';t.addfile(m)
 else:
  b=b'changed';m.size=len(b);t.addfile(m,io.BytesIO(b))`,join(f.root,'source.tar'),path,fault])
 assert.throws(()=>p1SourceEvidence(join(f.root,'source.tar'),commit))
})

test('P1 semantic evidence rejects submitted/persisted input mismatch and API/output mismatch',()=>{
 const e=productionEvidence('normal');e.executions[0].inputs.name='wrong'
 assert.throws(()=>validateP1ProductionEvidence(e,e.caseId),/persisted input differs/)
 const other=productionEvidence('normal');Object.assign(other.responses[0],{resultReady:true,status:0,data:{message:'wrong'}})
 assert.throws(()=>validateP1ProductionEvidence(other,other.caseId),/persisted output differs/)
})

for(const fault of ['missing-flow','extra-flow','duplicate-flow','wrong-count','wrong-caller','wrong-namespace','top-id-extra','top-id-missing','top-request-extra','top-response-missing','top-execution-missing','cross-flow-id'])test(`P1 fixed multiFlow plan rejects ${fault}`,()=>{
 const id='P1 PRODUCTION conditional POST and page init load',e=productionEvidence(id)
 if(fault==='missing-flow')e.flows.pop()
 if(fault==='extra-flow'){const f=structuredClone(e.flows[0]);f.expectedFlowId='unexpected';e.flows.push(f)}
 if(fault==='duplicate-flow')e.flows[1]=structuredClone(e.flows[0])
 if(fault==='wrong-count')e.flows[0].expectedNewExecutions=2
 if(fault==='wrong-caller')e.flows[0].caller='foreign'
 if(fault==='wrong-namespace')e.flows[0].namespace='company.other'
 if(fault==='top-id-extra')e.executionIds.push('extra')
 if(fault==='top-id-missing')e.executionIds.pop()
 if(fault==='top-request-extra')e.requests.push({method:'POST',path:'/other'})
 if(fault==='top-response-missing')e.responses.pop()
 if(fault==='top-execution-missing')e.executions.pop()
 if(fault==='cross-flow-id'){const old=e.flows[1].executionIds[0],id=e.flows[0].executionIds[0];e.flows[1].executionIds=[id];e.flows[1].afterExecutionIds=[id];e.flows[1].executions[0].id=id;e.flows[1].responses[0].executionId=id}
 assert.throws(()=>validateP1ProductionEvidence(e,id))
})
test('P1 conditional multiFlow and two-query plan preserve exact execution unions',()=>{
 for(const id of ['P1 PRODUCTION conditional POST and page init load','P1 PRODUCTION CRUD pagination and empty result'])assert.equal(validateP1ProductionEvidence(productionEvidence(id),id),true)
})

test('P1 published layout resolves evidence from ui-reports and rejects source-layout-only reports',t=>{
 const f=p1ReportFixture(t)
 assert.equal(f.check().production.cases,16)
 // Moving only the report to its source location must not be accepted as a release.
 mkdirSync(join(f.root,'ui/reports'),{recursive:true})
 const bytes=readFileSync(join(f.root,'ui-reports/p1-production.json'))
 writeFileSync(join(f.root,'ui/reports/p1-production.json'),bytes)
 rmSync(join(f.root,'ui-reports/p1-production.json'))
 delete f.provenance.files['ui-reports/p1-production.json']
 f.provenance.files['ui/reports/p1-production.json']=digest(bytes)
 assert.throws(f.check,/ENOENT/)
})

test('P1 evidence closure requires published ui-reports provenance paths',t=>{
 const f=p1ReportFixture(t),path='ui-reports/production-0.json'
 f.provenance.files['ui/reports/production-0.json']=f.provenance.files[path]
 delete f.provenance.files[path]
 assert.throws(f.check,/P1 evidence not registered by publisher/)
})

for(const fault of ['missing-stable','false-stable','truthy-stable','missing-start','missing-end','start-sha-drift','end-sha-drift','start-commit-drift','end-commit-drift','extra-start-field','extra-end-field'])test(`P1 production source freeze rejects ${fault}`,t=>{
 const f=p1ReportFixture(t),r=f.reports.production
 if(fault==='missing-stable')delete r.sourceStable
 if(fault==='false-stable')r.sourceStable=false
 if(fault==='truthy-stable')r.sourceStable='true'
 if(fault==='missing-start')delete r.sourceAtStart
 if(fault==='missing-end')delete r.sourceAtEnd
 if(fault==='start-sha-drift')r.sourceAtStart.sourceSha256='0'.repeat(64)
 if(fault==='end-sha-drift')r.sourceAtEnd.sourceSha256='0'.repeat(64)
 if(fault==='start-commit-drift')r.sourceAtStart.sourceCommit='0'.repeat(40)
 if(fault==='end-commit-drift')r.sourceAtEnd.sourceCommit='0'.repeat(40)
 if(fault==='extra-start-field')r.sourceAtStart.extra=true
 if(fault==='extra-end-field')r.sourceAtEnd.extra=true
 // Rebind mutated report bytes so rejection reaches the source-freeze gate.
 f.save()
 assert.throws(f.check,/P1 production (source freeze|start source|end source)/)
})

function writeP1Unit(root,change=()=>{}) {
 const rows=[...ui189Baseline.map(([classname,name])=>({classname,name})),...Array.from({length:22},(_,i)=>({classname:'synthetic-p1',name:'new-case-'+i}))]
 change(rows)
 execFileSync('python3',['-c',`import json,sys,xml.etree.ElementTree as E
r=E.Element('testsuites')
for row in json.loads(sys.stdin.read()):
 c=E.SubElement(r,'testcase',classname=row['classname'],name=row['name'])
 if row.get('result'):E.SubElement(c,row['result'])
E.ElementTree(r).write(sys.argv[1],encoding='utf-8')`,join(root,'ui-reports/unit.xml')],{input:JSON.stringify(rows)})
}
test('P1 exact UI211 retains formal P0 named189 baseline',t=>{const root=buildRelease();t.after(()=>rmSync(root,{recursive:true,force:true}));writeP1Unit(root);assert.equal(unitCounts(root,211,true).testcases,211);assert.equal(ui189Baseline.length,189)})
for(const fault of ['missing','replacement','failure','error','skipped','extra'])test('P1 UI211 baseline rejects '+fault,t=>{
 const root=buildRelease();t.after(()=>rmSync(root,{recursive:true,force:true}))
 writeP1Unit(root,rows=>{if(fault==='missing')rows.shift();if(fault==='replacement')rows[0]={classname:'replacement',name:'keeps-total-211'};if(['failure','error','skipped'].includes(fault))rows[0].result=fault;if(fault==='extra')rows.push({classname:'extra',name:'extra'})})
 assert.throws(()=>unitCounts(root,211,true))
})

test('P1 controlled one-layer quote/apostrophe report encoding retains named baseline and audit',t=>{
 const root=buildRelease();t.after(()=>rmSync(root,{recursive:true,force:true}))
 writeP1Unit(root,rows=>{for(const row of rows)row.name=row.name.replaceAll('"','&quot;').replaceAll("'",'&apos;')})
 const result=unitCounts(root,211,true);assert.equal(result.testcases,211);assert(result.normalization.changed>0)
 assert(result.normalization.changes.every(row=>row.raw!==row.canonical))
})
for(const fault of ['collision','double-layer-residual','unknown-entity','renamed','missing'])test('P1 controlled entity normalization rejects '+fault,t=>{
 const root=buildRelease();t.after(()=>rmSync(root,{recursive:true,force:true}))
 writeP1Unit(root,rows=>{
  const index=rows.findIndex(row=>row.name.includes('"'))
  if(fault==='collision')rows[189]={...rows[index],name:rows[index].name.replaceAll('"','&quot;')}
  if(fault==='double-layer-residual')rows[index].name=rows[index].name.replaceAll('"','&amp;quot;')
  if(fault==='unknown-entity')rows[index].name=rows[index].name.replaceAll('"','&unknown;')
  if(fault==='renamed')rows[index].name+=' altered'
  if(fault==='missing')rows.splice(index,1)
 })
 assert.throws(()=>unitCounts(root,211,true))
})
