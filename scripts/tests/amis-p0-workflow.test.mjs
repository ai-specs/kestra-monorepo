import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,readdirSync,statSync,symlinkSync,existsSync} from 'node:fs'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

// Offline workflow regression only. Node/Python execute generated options and
// publication staging against synthetic files; never run Docker, gh or browsers.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const workflow=readFileSync(join(root,'.github/workflows/compose-acceptance.yml'),'utf8')
const start=workflow.indexOf('\n  amis-p0:\n'),job=workflow.slice(start)
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const block=tag=>{
  const match=job.match(new RegExp("<<'"+tag+"'\\n([\\s\\S]*?)\\n\\s*"+tag))
  assert(match,'Missing executable workflow block '+tag)
  return match[1].split('\n').map(line=>line.startsWith('          ')?line.slice(10):line).join('\n')
}
function fixture(t){
  mkdirSync(join(root,'.work'),{recursive:true})
  const area=mkdtempSync(join(root,'.work/amis-workflow-synthetic-'));t.after(()=>rmSync(area,{force:true,recursive:true}))
  const put=(relative,bytes)=>{const path=join(area,relative);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,Buffer.isBuffer(bytes)||typeof bytes==='string'?bytes:JSON.stringify(bytes));return path}
  const execute=(command,tag)=>execFileSync(command,command==='node'?['--input-type=module','-e',block(tag)]:['-c',block(tag)],{cwd:area,encoding:'utf8',stdio:['ignore','pipe','pipe']})
  return {area,put,execute}
}
function evidence(t){
  const f=fixture(t),source='.work/amis-p0-run/'
  const row=Buffer.from(JSON.stringify({status:'failed',safeError:'Retain failed business assertion'}))
  const diag=Buffer.from(JSON.stringify({events:[{documentId:'SYNTHETIC-document',message:'retained diagnostic'}]}))
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('SYNTHETIC STAGING TEST ONLY')])
  const refs=[{path:'evidence/case-one.json',sha256:hash(row)},{path:'browser-assets/diagnostics/'+hash(diag)+'.json',sha256:hash(diag)},{path:'browser-assets/screenshots/'+hash(png)+'.png',sha256:hash(png)}]
  f.put(source+refs[0].path,row);f.put(source+refs[1].path,diag);f.put(source+refs[2].path,png)
  f.put(source+'report.json',{completed:false,status:'failed',cases:[{id:'A-synthetic',status:'failed',evidence:refs}],browserAttachments:refs.slice(1),verifiedTransportEvidence:{productionLogin:refs[0]}})
  f.put(source+'bootstrap-report.json',{completed:false});f.put(source+'driver-failure.json',{completed:false,primaryFailure:'synthetic failure'})
  f.put(source+'execution-order.json',[{id:'A-synthetic',event:'failed'}])
  return {...f,refs,source}
}
const files=directory=>readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?files(join(directory,entry.name)).map(path=>entry.name+'/'+path):[entry.name]).sort()

test('existing compose and upgrade jobs preserve their baseline with explicit noncancelling queue policy',()=>{
  assert(start>0)
  const prefix=workflow.slice(0,start)
  assert(prefix.includes('  cancel-in-progress: false'))
  const baselinePrefix=prefix.replace('  # Keep the running production acceptance; queue a newer commit behind it.\n  cancel-in-progress: false','  cancel-in-progress: true')
  assert.equal(hash(baselinePrefix),'7e6e82d091e3ad69fe2abf0410ee98364deb1cbdebb1dcdb41de59dddd77babe')
  assert.equal((job.match(/^  [a-z][a-z0-9-]+:\s*$/gm)??[]).length,1)
})
test('AMIS CI uses root-only checkout, fixed JDK/Node/Playwright and read-only authenticated OCI',()=>{
  assert.equal((job.match(/uses: actions\/checkout@/g)??[]).length,1)
  for(const text of ['submodules: false','persist-credentials: false',"java-version: '25'","node-version: '24'",'playwright@1.61.1','packages: read','actions: read','GH_TOKEN: ${{ github.token }}','--password-stdin','timeout-minutes: 65'])assert(job.includes(text),text)
  assert(!/submodule update|kestra-plugin-amis-apps\.git|select-amis-apps-release\.py|OVERLAY_READ_DEPLOY_KEY|RBAC_READ_DEPLOY_KEY/.test(job))
  assert(!/^\s+services:|docker compose|docker run|pg_isready|docker exec/m.test(job),'No independent PostgreSQL/start/cleanup path')
  assert(job.includes('node scripts/run-amis-apps-p0.mjs "$GITHUB_WORKSPACE/.work/amis-p0-run-options.json"'))
  assert(!job.includes('node scripts/run-amis-apps-p0.mjs .work/amis-p0-run-options.json'))
  assert(!/continue-on-error:|allowDirty|synthetic:\s*true/.test(job))
})
test('formal inputs are mandatory and no candidate values embedded',()=>{
  assert(job.includes('test -f deployment/amis-apps-release.json'))
  assert(job.includes('test -f scripts/amis-apps-expected-http.json'))
  assert(job.includes('node scripts/prepare-amis-apps-acceptance.mjs .work/amis-p0-prepare-options.json'))
  assert(!/@sha256:[a-f0-9]{64}|amisCommit\s*:/.test(job))
})
test('executable options block preserves selected release paths and exact expected/http/denial/module contract',t=>{
  const f=fixture(t),selected={amisReleaseDirectory:join(f.area,'formal/release'),expectedTests:355,expectedJavaTests:355,rootCommit:'a'.repeat(40)}
  const probeJar=join(f.area,'formal/probe.jar')
  f.put('.work/amis-p0-inputs/runner-options.json',{prepared:true,rootDirectory:f.area,selected,probeJar})
  const expected={zeroGrantDenialText:'精确拒绝文案',nativeCases:{A:Array(9).fill({explicit:true}),B:Array(9).fill({explicit:true})},faultStatuses:{A:{explicit:503},B:{explicit:503}},faultNativeCases:{A:{explicit:true},B:{explicit:true}}}
  f.put('scripts/amis-apps-expected-http.json',expected)
  const module=f.put('.work/amis-ci-browser/node_modules/playwright/index.mjs','// synthetic path only')
  f.execute('node','AMIS_OPTIONS_JS')
  const path=join(f.area,'.work/amis-p0-run-options.json'),value=JSON.parse(readFileSync(path))
  assert.equal(statSync(path).mode&0o777,0o600)
  assert.deepEqual(value.selected,selected);assert.equal(value.probeJar,probeJar);assert.deepEqual(value.expected,expected)
  assert.equal(value.zeroGrantDenialText,expected.zeroGrantDenialText)
  assert.deepEqual(value.browser,{driver:'playwright',playwrightModule:module})
  assert.equal(value.port,18129);assert.equal(value.directory,join(f.area,'.work/amis-p0-run'));assert.equal(value.rootDirectory,f.area)
})
test('prepare options use formal consumer file and new area with 0600 mode',t=>{
  const f=fixture(t);f.execute('node','AMIS_PREPARE_JS')
  const path=join(f.area,'.work/amis-p0-prepare-options.json'),value=JSON.parse(readFileSync(path))
  assert.deepEqual(value,{directory:join(f.area,'.work/amis-p0-inputs'),selectionFile:join(f.area,'deployment/amis-apps-release.json')})
  assert.equal(statSync(path).mode&0o777,0o600)
})
test('staging preserves failed report references and immutable bytes; excludes private AMIS and raw runtime/config',t=>{
  const f=evidence(t)
  for(const path of ['inputs.private.json','environment/compose.json','environment/inputs.private.json','raw-browser/screenshots/private.png','source.tar','kestra-amis-apps.jar','assets/runtime.js'])f.put(f.source+path,'DO-NOT-PUBLISH-SYNTHETIC-PRIVATE')
  f.put('.work/amis-p0-inputs/amis-oci/release/source.tar','PRIVATE-SOURCE-NOT-PUBLIC')
  f.execute('python3','AMIS_EVIDENCE_PY')
  const staged=join(f.area,'.work/amis-p0-public')
  assert.deepEqual(files(staged),['bootstrap-report.json','driver-failure.json','execution-order.json','report.json','evidence/staging-summary.json',...f.refs.map(ref=>ref.path)].sort())
  for(const ref of f.refs)assert.equal(hash(readFileSync(join(staged,ref.path))),ref.sha256)
  assert.equal(JSON.parse(readFileSync(join(staged,'report.json'))).completed,false)
  f.execute('node','AMIS_ENFORCE_JS')
})
for(const kind of ['password','bearer','jwt','private-file','symlink','wrong-browser-hash','missing-reference'])test(`staging isolates ${kind}, keeps safe failed matrix evidence and upload-ready summary; final gate fails`,t=>{
  const f=evidence(t)
  if(kind==='password')f.put(f.source+'evidence/credential.json',{password:'SYNTHETIC-MUST-NOT-UPLOAD'})
  if(kind==='bearer')f.put(f.source+'evidence/credential.json',{message:'Bearer SYNTHETIC-RAW-ACCESS'})
  if(kind==='jwt')f.put(f.source+'evidence/credential.json',{message:'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1In0.signature'})
  if(kind==='private-file')f.put(f.source+'evidence/credential.private.json',{status:'redacted'})
  if(kind==='symlink'){const link=join(f.area,f.source,'evidence/link.json');symlinkSync(join(f.area,f.source,f.refs[0].path),link)}
  if(kind==='wrong-browser-hash')f.put(f.source+f.refs[1].path,{message:'changed bytes'})
  if(kind==='missing-reference')rmSync(join(f.area,f.source,f.refs[0].path))
  f.execute('python3','AMIS_EVIDENCE_PY')
  const staged=join(f.area,'.work/amis-p0-public')
  const summary=JSON.parse(readFileSync(join(staged,'evidence/staging-summary.json')))
  assert.equal(summary.status,'failed');assert(summary.quarantined.length>0)
  const report=JSON.parse(readFileSync(join(staged,'report.json')))
  assert.equal(report.completed,false);assert.equal(report.status,'failed');assert.equal(report.cases[0].id,'A-synthetic');assert.equal(report.cases[0].status,'failed')
  assert.equal(report.artifactSanitization.status,'failed')
  assert.equal(JSON.parse(readFileSync(join(staged,'driver-failure.json'))).completed,false)
  assert.equal(hash(readFileSync(join(staged,f.refs[2].path))),f.refs[2].sha256)
  const publicText=files(staged).filter(path=>path.endsWith('.json')).map(path=>readFileSync(join(staged,path),'utf8')).join('')
  for(const secret of ['SYNTHETIC-MUST-NOT-UPLOAD','SYNTHETIC-RAW-ACCESS','eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1In0.signature'])assert(!publicText.includes(secret))
  assert.throws(()=>f.execute('node','AMIS_ENFORCE_JS'))
  assert(job.includes("if: always() && steps.amis-evidence.outputs.safe_ready == 'true'"))
})
test('setup/preparation failure produces only a failed bootstrap summary, never fake business completion',t=>{
  const f=fixture(t);f.execute('python3','AMIS_EVIDENCE_PY')
  const staged=join(f.area,'.work/amis-p0-public');assert.deepEqual(files(staged),['bootstrap-report.json','evidence/staging-summary.json'])
  const report=JSON.parse(readFileSync(join(staged,'bootstrap-report.json')))
  assert.equal(report.completed,false);assert.equal(report.status,'failed')
  assert(!existsSync(join(staged,'report.json')))
})
test('artifact always uploads verified-safe files even after quarantine; separate post-upload gate fails job',()=>{
  assert(job.includes('id: amis-evidence\n        if: always()'))
  const upload=job.slice(job.indexOf('- name: Upload sanitized AMIS P0 evidence'))
  const listed=upload.match(/          path: \|\n((?:            [^\n]+\n)+)/)[1].trim().split('\n').map(line=>line.trim())
  assert.deepEqual(listed,['.work/amis-p0-public/report.json','.work/amis-p0-public/bootstrap-report.json','.work/amis-p0-public/execution-order.json','.work/amis-p0-public/driver-failure.json','.work/amis-p0-public/evidence/*.json','.work/amis-p0-public/browser-assets/screenshots/*.png','.work/amis-p0-public/browser-assets/diagnostics/*.json'])
  assert(upload.includes('include-hidden-files: true'));assert(upload.includes('if-no-files-found: error'))
  assert(!upload.includes("steps.amis-evidence.outcome == 'success'"))
  assert(job.indexOf('- name: Fail AMIS job when evidence required isolation')>job.indexOf('- name: Upload sanitized AMIS P0 evidence'))
  assert(job.includes('echo "safe_ready=true" >> "$GITHUB_OUTPUT"'))
})

test('staging quarantines leaked root report, preserves every failed row in redacted projection and unrelated immutable evidence',t=>{
  const f=evidence(t),secret='SYNTHETIC-PRIVATE-PASSWORD-IN-ROOT'
  const report=JSON.parse(readFileSync(join(f.area,f.source,'report.json')))
  report.password=secret
  report.cases.push({id:'B-failed-row',status:'failed',message:'failed with '+secret,evidence:[]})
  const original=JSON.stringify(report);f.put(f.source+'report.json',original)
  f.put(f.source+'evidence/unrelated.json',{status:'failed',message:'Unrelated failure retained'})
  f.execute('python3','AMIS_EVIDENCE_PY')
  const staged=join(f.area,'.work/amis-p0-public'),retained=JSON.parse(readFileSync(join(staged,'report.json')))
  assert.deepEqual(retained.cases.map(row=>[row.id,row.status]),[['A-synthetic','failed'],['B-failed-row','failed']])
  assert.equal(retained.password,'[redacted]');assert.equal(retained.cases[1].message,'failed with [redacted]')
  assert.equal(retained.artifactSanitization.sourceReportSha256,hash(original))
  for(const ref of f.refs)assert.equal(hash(readFileSync(join(staged,ref.path))),ref.sha256)
  assert.equal(JSON.parse(readFileSync(join(staged,'evidence/unrelated.json'))).status,'failed')
  assert.equal(readFileSync(join(f.area,f.source,'report.json'),'utf8'),original,'Local source evidence must not be rewritten')
  assert(!files(staged).filter(path=>path.endsWith('.json')).map(path=>readFileSync(join(staged,path),'utf8')).join('').includes(secret))
  assert.throws(()=>f.execute('node','AMIS_ENFORCE_JS'))
})
test('known credential reused without sensitive key and in filename is isolated before any public copy',t=>{
  const f=evidence(t),secret='SYNTHETIC-LONG-REUSED-SECRET'
  f.put(f.source+'evidence/first.json',{password:secret})
  f.put(f.source+'evidence/'+secret+'.json',{message:'otherwise harmless'})
  f.put(f.source+'evidence/reused.json',{message:'Unexpected failure '+secret})
  f.put(f.source+'evidence/broken.json','{malformed-json')
  f.execute('python3','AMIS_EVIDENCE_PY')
  const staged=join(f.area,'.work/amis-p0-public'),all=files(staged)
  assert(!all.some(path=>path.includes(secret)))
  const text=all.filter(path=>path.endsWith('.json')).map(path=>readFileSync(join(staged,path),'utf8')).join('')
  assert(!text.includes(secret))
  const summary=JSON.parse(readFileSync(join(staged,'evidence/staging-summary.json')))
  assert(summary.quarantined.some(item=>item.reason==='unreadable-or-invalid-file'))
  assert(summary.quarantined.some(item=>item.reason==='credential-value-reused'))
  assert.equal(JSON.parse(readFileSync(join(staged,'report.json'))).cases[0].status,'failed')
})

test('otherwise passed business report becomes explicitly failed artifact projection when an extra credential file is isolated',t=>{
  const f=evidence(t),report=JSON.parse(readFileSync(join(f.area,f.source,'report.json')))
  report.completed=true;report.status='passed';report.cases[0].status='passed'
  f.put(f.source+'report.json',report)
  f.put(f.source+'evidence/unexpected.json',{secret:'SYNTHETIC-ISOLATE-NOT-IGNORE'})
  f.execute('python3','AMIS_EVIDENCE_PY')
  const target=join(f.area,'.work/amis-p0-public'),projected=JSON.parse(readFileSync(join(target,'report.json')))
  assert.equal(projected.completed,false);assert.equal(projected.status,'failed')
  assert.equal(projected.artifactSanitization.status,'failed')
  assert.equal(projected.cases[0].status,'passed','Actual business row must not be erased or invented')
  assert(!existsSync(join(target,'evidence/unexpected.json')))
  assert.equal(JSON.parse(readFileSync(join(f.area,f.source,'report.json'))).status,'passed','Local source report remains immutable')
  assert.throws(()=>f.execute('node','AMIS_ENFORCE_JS'),'Post-upload gate must fail job even if business runner had passed')
})
