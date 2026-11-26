import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,readdirSync,realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {stageAmisP1Evidence} from '../stage-amis-p1-evidence.mjs'
const hash=b=>createHash('sha256').update(b).digest('hex')
function fixture(t){const parent=mkdtempSync(join(realpathSync(tmpdir()),'p1-stage-'));t.after(()=>rmSync(parent,{recursive:true,force:true}));const source=join(parent,'run'),target=join(parent,'public');mkdirSync(source);mkdirSync(join(source,'evidence'));mkdirSync(join(source,'browser-0'));const attachment=Buffer.from('{"events":[],"integrity":[]}\n');writeFileSync(join(source,'browser-0','diagnostic.json'),attachment);const evidence=JSON.stringify({browser:{attachments:[{path:'browser-0/diagnostic.json',sha256:hash(attachment)}]}});writeFileSync(join(source,'evidence','case-0.json'),evidence);const report={schemaVersion:1,stage:'P1',completed:true,cases:[{id:'A-complex-form-validates-and-persists-typed-inputs',status:'passed',evidence:[{path:'evidence/case-0.json',sha256:hash(evidence)}]}]};const save=()=>writeFileSync(join(source,'report.json'),JSON.stringify(report));save();writeFileSync(join(source,'account-0.private.json'),JSON.stringify({account:{username:'actor',password:'private-known-value'}}));writeFileSync(join(source,'raw.log'),'private-known-value');return {source,target,report,save}}
function output(f){return JSON.parse(readFileSync(join(f.target,'report.json')))}
test('stages only exact public closure with original bytes and hashes; does not claim business success',t=>{const f=fixture(t),s=stageAmisP1Evidence(f);assert.equal(s.status,'passed');assert.equal(s.businessAcceptance,'not-evaluated');assert.deepEqual(s.files.map(x=>x.path).sort(),['browser-0/diagnostic.json','evidence/case-0.json','report.json']);for(const x of s.files){assert.deepEqual(readFileSync(join(f.source,x.path)),readFileSync(join(f.target,x.path)));assert.equal(hash(readFileSync(join(f.target,x.path))),x.sha256)}assert(!readdirSync(f.target).includes('account-0.private.json'))})
for(const fault of ['secret-field','token','known-secret','symlink-private','symlink-attachment','wrong-evidence-hash','wrong-attachment-hash','escape','private-reference','unsupported-format','unindexed-secret-json'])test(`fails closed and retains safe matrix for ${fault}`,t=>{
 const f=fixture(t);f.report.cases.push({id:'B-dialog-form-submits-once',status:'failed',evidence:[]});f.save()
 if(fault==='secret-field'){f.report.password='secret-value';f.save()}
 if(fault==='token'){f.report.error='Bearer abcdef012345';f.save()}
 if(fault==='known-secret'){f.report.error='private-known-value';f.save()}
 if(fault==='symlink-private')symlinkSync(join(f.source,'report.json'),join(f.source,'unused.private.json'))
 if(fault==='symlink-attachment'){rmSync(join(f.source,'browser-0/diagnostic.json'));symlinkSync(join(f.source,'report.json'),join(f.source,'browser-0/diagnostic.json'))}
 if(fault==='wrong-evidence-hash'){f.report.cases[0].evidence[0].sha256='0'.repeat(64);f.save()}
 if(fault==='escape'){f.report.cases[0].evidence[0].path='../outside.json';f.save()}
 if(fault==='unindexed-secret-json')writeFileSync(join(f.source,'evidence','orphan.json'),JSON.stringify({cookie:'sensitive'}))
 if(['wrong-attachment-hash','private-reference','unsupported-format'].includes(fault)){const p=join(f.source,'evidence/case-0.json'),v=JSON.parse(readFileSync(p));if(fault==='wrong-attachment-hash')v.browser.attachments[0].sha256='0'.repeat(64);if(fault==='private-reference')v.browser.attachments[0].path='account-0.private.json';if(fault==='unsupported-format')v.browser.attachments[0].path='raw.log';const bytes=JSON.stringify(v);writeFileSync(p,bytes);f.report.cases[0].evidence[0].sha256=hash(bytes);f.save()}
 const s=stageAmisP1Evidence(f);assert.equal(s.status,'failed');assert.deepEqual(readdirSync(f.target).sort(),['report.json','staging-summary.json']);const r=output(f);assert.equal(r.completed,false);assert.equal(r.projection,true);assert.deepEqual(r.cases.map(x=>x.status),['passed','failed']);assert.equal(r.cases[0].id,f.report.cases[0].id);assert(!JSON.stringify(r).includes('private-known-value'));assert(!JSON.stringify(r).includes('Bearer'))
})
test('business failure matrix stages unchanged when public evidence is safe',t=>{const f=fixture(t);f.report.completed=false;f.report.cases[0].status='failed';f.save();assert.equal(stageAmisP1Evidence(f).status,'passed');assert.equal(output(f).completed,false);assert.equal(output(f).cases[0].status,'failed')})
test('new target required and nested destination refused',t=>{const f=fixture(t);mkdirSync(f.target);assert.throws(()=>stageAmisP1Evidence(f));assert.throws(()=>stageAmisP1Evidence({...f,target:join(f.source,'public')}))})
test('CLI failure exits one while retaining safe report and summary',t=>{const f=fixture(t);f.report.token='sensitive';f.save();const run=spawnSync(process.execPath,['scripts/stage-amis-p1-evidence.mjs',f.source,f.target],{encoding:'utf8'});assert.equal(run.status,1);assert.equal(output(f).projection,true);assert.equal(JSON.parse(readFileSync(join(f.target,'staging-summary.json'))).status,'failed')})

for(const location of ['case','attachment'])test(`missing ${location} reference hash is rejected`,t=>{const f=fixture(t);if(location==='case')delete f.report.cases[0].evidence[0].sha256;else{const p=join(f.source,'evidence/case-0.json'),e=JSON.parse(readFileSync(p));delete e.browser.attachments[0].sha256;const b=JSON.stringify(e);writeFileSync(p,b);f.report.cases[0].evidence[0].sha256=hash(b)}f.save();assert.equal(stageAmisP1Evidence(f).status,'failed')})
test('private YAML secret reused under harmless public key is rejected',t=>{const f=fixture(t);writeFileSync(join(f.source,'environment.yaml'),'password: yaml-private-value\n');f.report.note='yaml-private-value';f.save();assert.equal(stageAmisP1Evidence(f).status,'failed');assert(!readFileSync(join(f.target,'report.json'),'utf8').includes('yaml-private-value'))})
test('unreferenced safe browser files are not copied',t=>{const f=fixture(t);writeFileSync(join(f.source,'browser-0/unreferenced.json'),'{}');const s=stageAmisP1Evidence(f);assert.equal(s.status,'passed');assert(!s.files.some(x=>x.path.includes('unreferenced')))})
test('source directory symlink fails with safe summary; target parent symlink is never written',t=>{const f=fixture(t);const link=join(f.source,'..','source-link');symlinkSync(f.source,link);assert.equal(stageAmisP1Evidence({source:link,target:f.target}).status,'failed');const parent=join(f.source,'..','target-link');symlinkSync(f.source,parent);assert.throws(()=>stageAmisP1Evidence({source:f.source,target:join(parent,'public')}))})

for(const kind of ['source','report'])test(`rejected external ${kind} symlink is never opened for projection`,async t=>{
 const fs=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module')
 const f=fixture(t),outside=join(f.source,'..','external-secret.json')
 writeFileSync(outside,JSON.stringify({password:'external-only-secret',cases:[{id:'A-complex-form-validates-and-persists-typed-inputs',status:'passed'}]}))
 let source=f.source
 if(kind==='source'){source=join(f.source,'..','external-source');const external=join(f.source,'..','external-dir');mkdirSync(external);writeFileSync(join(external,'report.json'),readFileSync(outside));symlinkSync(external,source)}
 else{rmSync(join(f.source,'report.json'));symlinkSync(outside,join(f.source,'report.json'))}
 const original=fs.default.readFileSync;let forbiddenReads=0
 const mock=t.mock.method(fs.default,'readFileSync',function(path,...args){
  if(typeof path==='string'&&(path===outside||path===join(source,'report.json'))){forbiddenReads++;throw Error('Forbidden external report read')}
  return original.call(this,path,...args)
 });syncBuiltinESMExports()
 let summary
 try{summary=stageAmisP1Evidence({source,target:f.target})}finally{mock.mock.restore();syncBuiltinESMExports()}
 assert.equal(forbiddenReads,0);assert.equal(summary.status,'failed');assert.deepEqual(output(f).cases,[])
 assert(!readFileSync(join(f.target,'report.json'),'utf8').includes('external-only-secret'))
})

test('evidence symlink failure projects only the already validated report bytes',async t=>{
 const fs=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module'),f=fixture(t)
 symlinkSync(join(f.source,'report.json'),join(f.source,'evidence/link.json'))
 const original=fs.default.readFileSync;let pathReads=0,fdReads=0
 const mock=t.mock.method(fs.default,'readFileSync',function(path,...args){if(path===join(f.source,'report.json')){pathReads++;throw Error('Report path must not be reopened')}if(typeof path==='number')fdReads++;return original.call(this,path,...args)});syncBuiltinESMExports()
 let summary
 try{summary=stageAmisP1Evidence(f)}finally{mock.mock.restore();syncBuiltinESMExports()}
 assert.equal(summary.status,'failed');assert.equal(pathReads,0);assert.equal(fdReads,1)
 assert.equal(output(f).cases[0].id,f.report.cases[0].id);assert.equal(output(f).cases[0].status,'passed')
})

test('partial 24-row business failure preserves omitted unrun evidence and referenced screenshot bytes',t=>{
 const f=fixture(t)
 f.report.completed=false;f.report.cases[0].status='failed'
 f.report.summary={passed:0,failed:1,skipped:0,notRun:23}
 for(let i=1;i<24;i++)f.report.cases.push({id:'synthetic-unrun-'+i,status:'not_run'})
 const image=Buffer.from([137,80,78,71,13,10,26,10]);writeFileSync(join(f.source,'browser-0/failure.png'),image)
 const path=join(f.source,'evidence/case-0.json'),value=JSON.parse(readFileSync(path));value.browser.attachments.push({path:'browser-0/failure.png',sha256:hash(image)})
 const bytes=JSON.stringify(value);writeFileSync(path,bytes);f.report.cases[0].evidence[0].sha256=hash(bytes);f.save()
 const original=readFileSync(join(f.source,'report.json')),s=stageAmisP1Evidence(f)
 assert.equal(s.status,'passed');assert.equal(s.businessAcceptance,'not-evaluated')
 assert.deepEqual(readFileSync(join(f.target,'report.json')),original)
 assert.deepEqual(readFileSync(join(f.target,'browser-0/failure.png')),image)
 assert.deepEqual(output(f).summary,{passed:0,failed:1,skipped:0,notRun:23})
 assert.equal(output(f).cases.filter(x=>x.status==='not_run').length,23)
})
for(const status of ['passed','failed'])test(`executed ${status} row cannot omit its evidence field`,t=>{const f=fixture(t);f.report.cases[0].status=status;delete f.report.cases[0].evidence;f.save();assert.equal(stageAmisP1Evidence(f).status,'failed')})
for(const status of ['not_run','not-run','skipped'])test(`${status} row permits absent evidence but rejects malformed supplied reference`,t=>{const f=fixture(t);f.report.cases[0]={...f.report.cases[0],status};delete f.report.cases[0].evidence;f.save();assert.equal(stageAmisP1Evidence(f).status,'passed');const other=fixture(t);other.report.cases[0].status=status;delete other.report.cases[0].evidence[0].sha256;other.save();assert.equal(stageAmisP1Evidence(other).status,'failed')})
