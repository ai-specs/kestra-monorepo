import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {pluginUiExpectedIds,assertPluginUiBrowserReport,assertHostAuthenticationUiReports,hostAuthThemeIds,hostAuthLocaleIds,committedPluginUiHashes,aggregateUiHashes} from '../published-ui-browser-evidence.mjs'
const commit='a'.repeat(40),image='ghcr.io/ai-specs/kestra-overlay@sha256:'+'b'.repeat(64),hash='c'.repeat(64)
const caseMetadata=id=>{const [,theme,locale,width,behavior]=id.split('/');return{id,theme,locale,width:Number(width),behavior}}
const fixture=()=>{const inputs={sourceCommit:commit,image,hostExecutableSha256:hash,sourceSha256:hash,lockSha256:hash,bundleSha256:hash,sdkSha256:hash,harnessSha256:hash};return {report:{schemaVersion:1,gate:'plugin-ui-chromium',gatePassed:true,errors:[],inputs,finalInputs:{...inputs},summary:{planned:720,executed:720,passed:720,failed:0,notRun:0,skipped:0},cases:pluginUiExpectedIds.map(id=>({...caseMetadata(id),status:'passed',durationMs:1,errors:[],attachments:[]}))},manifest:{schemaVersion:1,gate:'plugin-ui-chromium',cases:pluginUiExpectedIds.map(caseMetadata)}}}
const check=x=>assertPluginUiBrowserReport(JSON.stringify(x.report),{commit,image,hostExecutableSha256:hash,manifestRaw:JSON.stringify(x.manifest),expectedHashes:{sourceSha256:hash,lockSha256:hash,sdkSha256:hash,bundleSha256:hash,harnessSha256:hash}})
test('published plugin browser plan requires all actual 720 owner cases with immutable inputs',()=>assert.equal(check(fixture()).cases,720))
for(const [name,mutate]of [
 ['old commit',x=>{x.report.inputs.sourceCommit='d'.repeat(40)}],
 ['different image',x=>{x.report.inputs.image='other'}],
 ['unpublished host',x=>{x.report.inputs.hostExecutableSha256='d'.repeat(64)}],
 ['missing row',x=>{x.report.cases.pop()}],
 ['duplicate row',x=>{x.report.cases[1]=x.report.cases[0]}],
 ['changed plan',x=>{x.manifest.cases.pop()}],
 ['failed case',x=>{x.report.cases[0].status='failed'}],
 ['unclassified console',x=>{x.report.cases[0].errors.push('unknown')}],
 ['runner failure',x=>{x.report.errors.push('source changed')}],
 ['skip',x=>{x.report.summary.skipped=1}],
 ['not run',x=>{x.report.summary.notRun=1}],
 ['source drift',x=>{x.report.finalInputs.sourceSha256='d'.repeat(64)}],
 ['bundle drift',x=>{x.report.finalInputs.bundleSha256='d'.repeat(64)}],
 ['self-consistent counterfeit source',x=>{x.report.inputs.sourceSha256=x.report.finalInputs.sourceSha256='d'.repeat(64)}],
 ['self-consistent counterfeit lock',x=>{x.report.inputs.lockSha256=x.report.finalInputs.lockSha256='d'.repeat(64)}],
 ['self-consistent counterfeit SDK',x=>{x.report.inputs.sdkSha256=x.report.finalInputs.sdkSha256='d'.repeat(64)}],
 ['different test harness',x=>{x.report.inputs.harnessSha256='d'.repeat(64)}],
 ['named dark case actually light',x=>{x.report.cases[0].theme='dark'}],
 ['same ID with wrong viewport',x=>{x.report.cases[0].width=390}],
])test(name+' fails published UI gate',()=>{const x=fixture();mutate(x);assert.throws(()=>check(x))})

const authFixture=()=>Object.fromEntries(['auth-theme-env.json','auth-theme-setup.json','auth-i18n-env.json','auth-i18n-setup.json'].map(name=>[name,JSON.stringify({completed:true,rows:(name.startsWith('auth-theme')?hostAuthThemeIds:hostAuthLocaleIds).map(id=>{const [value,width,page]=id.split('/');return {...(name.startsWith('auth-theme')?{case:value}:{locale:value}),width:Number(width),page,passed:true,overflow:false}})})]))
test('host authentication visuals are consumed from both published install modes, not rerun in root',()=>assert.equal(assertHostAuthenticationUiReports(authFixture()).cases,156))
for(const [name,mutate]of [
 ['missing published mode',x=>{delete x['auth-theme-env.json']}],
 ['incomplete mode',x=>{const r=JSON.parse(x['auth-theme-env.json']);r.completed=false;x['auth-theme-env.json']=JSON.stringify(r)}],
 ['lost case',x=>{const r=JSON.parse(x['auth-theme-env.json']);r.rows.pop();x['auth-theme-env.json']=JSON.stringify(r)}],
 ['duplicate case',x=>{const r=JSON.parse(x['auth-theme-env.json']);r.rows[1]=r.rows[0];x['auth-theme-env.json']=JSON.stringify(r)}],
 ['overflow',x=>{const r=JSON.parse(x['auth-theme-env.json']);r.rows[0].overflow=true;x['auth-theme-env.json']=JSON.stringify(r)}],
 ['failed translation',x=>{const r=JSON.parse(x['auth-i18n-env.json']);r.rows[0].passed=false;x['auth-i18n-env.json']=JSON.stringify(r)}],
 ['same count wrong theme',x=>{const r=JSON.parse(x['auth-theme-env.json']);r.rows[0].case='unknown';x['auth-theme-env.json']=JSON.stringify(r)}],
 ['same count wrong locale',x=>{const r=JSON.parse(x['auth-i18n-env.json']);r.rows[0].locale='unknown';x['auth-i18n-env.json']=JSON.stringify(r)}],
 ['same count lost narrow width',x=>{const r=JSON.parse(x['auth-theme-env.json']);r.rows[13].width=768;x['auth-theme-env.json']=JSON.stringify(r)}],
])test(name+' fails host published visual evidence',()=>{const x=authFixture();mutate(x);assert.throws(()=>assertHostAuthenticationUiReports(x))})

test('source and lock binding reads the selected commit, never adjacent dirty development files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'published-ui-git-')),sha=x=>createHash('sha256').update(x).digest('hex')
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
 try {
  await mkdir(join(root,'ui/src/nested'),{recursive:true})
  await mkdir(join(root,'ui/browser'),{recursive:true})
  await writeFile(join(root,'ui/browser/matrix.mjs'),'published browser plan\n')
  await writeFile(join(root,'ui/src/nested/a.js'),'export const value=1\n')
  await writeFile(join(root,'ui/src/z.txt'),'published\n')
  await writeFile(join(root,'ui/package-lock.json'),'{}\n')
  git('init');git('add','ui');git('-c','core.hooksPath=/dev/null','-c','user.name=Offline Test','-c','user.email=offline@example.invalid','commit','-m','Synthetic published inputs')
  const commit=git('rev-parse','HEAD'),before=committedPluginUiHashes(root,commit)
  assert.equal(before.sourceSha256,aggregateUiHashes({'nested/a.js':sha('export const value=1\n'),'z.txt':sha('published\n')}))
  assert.equal(before.lockSha256,sha('{}\n'))
  assert.equal(before.harnessSha256,aggregateUiHashes({'matrix.mjs':sha('published browser plan\n')}))
  await writeFile(join(root,'ui/src/nested/a.js'),'unpublished change')
  await writeFile(join(root,'ui/package-lock.json'),'unpublished lock')
  assert.deepEqual(committedPluginUiHashes(root,commit),before)
 }finally{await rm(root,{recursive:true,force:true})}
})
