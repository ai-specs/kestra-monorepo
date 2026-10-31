import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
import {writeBrowserDiagnosticEvidence} from '../browser-diagnostic-evidence.mjs'

test('actual CI preservation and sanitization retain immutable diagnostic bytes after a failed report',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'root-artifact-offline-')),source=await mkdtemp(join(tmpdir(),'application-projects-bb-evidence-'))
  try {
    const workflow=await readFile(new URL('../../.github/workflows/compose-acceptance.yml',import.meta.url),'utf8')
    const preserve=workflow.match(/<<'PYREPORT'\n([\s\S]*?)\n\s*PYREPORT/)[1]
    const sanitize=workflow.slice(workflow.indexOf('- name: Sanitize artifact text')).match(/<<'PY'\n([\s\S]*?)\n\s*PY\n/)[1]
    const reference=await writeBrowserDiagnosticEvidence({events:[{id:'event:1',documentId:'old',kind:'page-error',message:'Retain this failure'}],integrity:[]},join(source,'browser/diagnostics'))
    const report={completed:false,failures:1,ui:[{case:'failed-case',status:'failed',passed:false}],adapterDiagnostics:reference}
    await writeFile(join(source,'report.json'),JSON.stringify(report))
    await mkdir(join(workspace,'.work/ci'),{recursive:true})
    await writeFile(join(workspace,'.work/ci/application-project-driver.log'),JSON.stringify({report:join(source,'report.json')})+'\n')
    for(const script of [preserve,sanitize])execFileSync('python3',['-c','import textwrap;exec(textwrap.dedent('+JSON.stringify(script)+'))'],{cwd:workspace})
    const copied=join(workspace,'.work/ci/application-projects/browser/diagnostics',reference.name)
    assert.deepEqual(await readFile(copied),await readFile(reference.path),'Sanitizer rewrote hashed diagnostic bytes')
    const retained=JSON.parse(await readFile(join(workspace,'.work/ci/application-projects/report.json'),'utf8'))
    assert.equal(retained.ui[0].status,'failed');assert.equal(retained.completed,false);assert.equal(retained.adapterDiagnostics.sha256,reference.sha256)
    await writeFile(copied,JSON.stringify({message:'password=synthetic-test-only'}))
    assert.throws(()=>execFileSync('python3',['-c','import textwrap;exec(textwrap.dedent('+JSON.stringify(sanitize)+'))'],{cwd:workspace,stdio:'pipe'}),'Credential-shaped snapshot must fail upload eligibility')
  }finally{await rm(workspace,{recursive:true,force:true});await rm(source,{recursive:true,force:true})}
})
