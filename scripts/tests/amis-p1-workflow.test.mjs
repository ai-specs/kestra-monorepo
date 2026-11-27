// Workflow option generation only. No production run, identity or Docker is used.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync,statSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {execFileSync} from 'node:child_process'
const root=resolve('.'),text=readFileSync('.github/workflows/compose-acceptance.yml','utf8')
const match=/<<'AMIS_P1_OPTIONS_JS'\n([\s\S]*?)\n\s*AMIS_P1_OPTIONS_JS/.exec(text)
assert(match)
const code=match[1].split('\n').map(line=>line.slice(10)).join('\n')
function setup(t,stage) {
 mkdirSync('.work',{recursive:true})
 const area=mkdtempSync(resolve('.work/p1-workflow-synthetic-'))
 t.after(()=>rmSync(area,{recursive:true,force:true}))
 const path='.work/amis-ci-browser/node_modules/playwright'
 mkdirSync(join(area,path),{recursive:true});writeFileSync(join(area,path,'index.mjs'),'// synthetic module path only')
 mkdirSync(join(area,'.work/amis-p0-inputs'))
 const prepared={prepared:true,selected:{stage,synthetic:'formal-reader-is-not-executed-here'},probeJar:'/synthetic/probe.jar'}
 writeFileSync(join(area,'.work/amis-p0-inputs/runner-options.json'),JSON.stringify(prepared))
 const output=join(area,'github-output');writeFileSync(output,'')
 return {area,prepared,output,run:()=>execFileSync('node',['--input-type=module','-e',code],{cwd:area,env:{...process.env,GITHUB_OUTPUT:output},stdio:'pipe'})}
}
test('P1 runs only after real P0 and consumes the identical prepared release',t=>{
 const f=setup(t,'P1');f.run()
 const path=join(f.area,'.work/amis-p1-run-options.json'),options=JSON.parse(readFileSync(path))
 assert.deepEqual(options.selected,f.prepared.selected);assert.equal(options.probeJar,f.prepared.probeJar)
 assert.equal(options.directory,join(f.area,'.work/amis-p1-run'));assert.equal(statSync(path).mode&0o777,0o600)
 assert.equal(readFileSync(f.output,'utf8'),'required=true\n')
 assert(text.indexOf('Execute real AMIS P0 production matrix')<text.indexOf('Execute real AMIS P1 production A B matrix'))
 assert(text.includes('node scripts/stage-amis-p1-evidence.mjs'))
})
test('P0 selection does not claim P1 execution or create P1 options',t=>{
 const f=setup(t,'P0');f.run();assert(!existsSync(join(f.area,'.work/amis-p1-run-options.json')));assert.equal(readFileSync(f.output,'utf8'),'')
})
test('unknown stage fails closed before production options',t=>{const f=setup(t,'P5');assert.throws(f.run);assert(!existsSync(join(f.area,'.work/amis-p1-run-options.json')))})

test('input preparation failure publishes only bounded diagnostic receipts, never raw downloads or private configuration',()=>{
 const start=text.indexOf('      - name: Preserve bounded AMIS input preparation diagnostics')
 assert(start>=0)
 const block=text.slice(start,text.indexOf('      - name:',start+20))
 assert(block.includes('if: always()'))
 assert(block.includes('.work/amis-p0-inputs/preparation-report.json'))
 assert(block.includes('.work/amis-p0-inputs/probe-build-failure.json'))
 assert(!block.includes('inputs.private')&&!block.includes('**')&&!block.includes('host-executable')&&!block.includes('commands.json'))
})

test('a newer commit cancels older acceptance in the same single concurrency group',()=>{
 assert(text.includes('group: compose-acceptance-${{ github.head_ref || github.ref_name }}'))
 assert(text.includes('cancel-in-progress: true'))
 assert(!text.includes('cancel-in-progress: false'))
})
