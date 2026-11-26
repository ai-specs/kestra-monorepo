import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {loadAmisP1Examples,seedAmisP1Examples} from '../amis-apps-p1-fixture.mjs'
function fixture(t) {
 const root=mkdtempSync(join(tmpdir(),'amis-p1-fixture-'));t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'examples/p1'),{recursive:true})
 const flow={id:'p1-async',namespace:'company.p1',triggers:[{type:'io.kestra.plugin.amis.apps.PageTrigger',pageId:'home',schema:'nsfile:///p1/controls.json'},{type:'io.kestra.plugin.amis.apps.ApiTrigger',apiId:'run'}]}
 const schema={type:'page',body:{type:'form'}}
 const manifest={schemaVersion:1,scenarios:[{id:'p1-async',flow:'examples/p1/p1-async.yaml',schema:'examples/p1/controls.json',namespaceFile:'/p1/controls.json',namespace:'company.p1',flowId:'p1-async',pageId:'home',apiId:'run'}]}
 const files={};for(const [path,value]of Object.entries({'examples/p1/scenarios.json':manifest,'examples/p1/p1-async.yaml':flow,'examples/p1/controls.json':schema})){const bytes=JSON.stringify(value);writeFileSync(join(root,path),bytes);files[path]=createHash('sha256').update(bytes).digest('hex')}
 writeFileSync(join(root,'release-provenance.json'),JSON.stringify({files}));return {root,flow,schema,manifest}
}
test('formal example relocation changes only tenant-independent namespace and retains source hashes',t=>{const f=fixture(t),r=loadAmisP1Examples(f.root,'company.amis.a');assert.equal(r.scenarios[0].namespace,'company.amis.a');assert.equal(r.scenarios[0].flow.namespace,'company.amis.a');assert.equal(f.flow.namespace,'company.p1');assert.equal(r.scenarios[0].source.flowPath,'examples/p1/p1-async.yaml')})
for(const [name,change]of [['hash drift',f=>writeFileSync(join(f.root,'examples/p1/controls.json'),'{}')],['unlisted file',f=>{writeFileSync(join(f.root,'release-provenance.json'),'{}')}],['non-page schema',f=>{const p='examples/p1/controls.json',s='{"type":"script"}';writeFileSync(join(f.root,p),s);const provenance={files:{}};for(const [path,value]of Object.entries({'examples/p1/scenarios.json':JSON.stringify(f.manifest),'examples/p1/p1-async.yaml':JSON.stringify(f.flow),[p]:s}))provenance.files[path]=createHash('sha256').update(value).digest('hex');writeFileSync(join(f.root,'release-provenance.json'),JSON.stringify(provenance))}]])test('published example rejects '+name,t=>{const f=fixture(t);change(f);assert.throws(()=>loadAmisP1Examples(f.root,'company.amis.a'))})
test('seeding requires schema byte-equivalent JSON readback and actual Flow tuple',async t=>{const f=fixture(t),examples=loadAmisP1Examples(f.root,'company.amis.a'),calls=[];const client={async request(path,options={}){calls.push([path,options.method??'GET']);if(path==='/api/v1/main/flows')return Response.json({id:'p1-async',namespace:'company.amis.a',revision:1});return options.method==='POST'?new Response('',{status:200}):Response.json(f.schema)}};assert.equal((await seedAmisP1Examples(client,examples))[0].schemaReadback,true);assert.deepEqual(calls.map(x=>x[1]),['POST','GET','POST'])})
