import assert from 'node:assert/strict'
import {readFileSync,realpathSync,lstatSync} from 'node:fs'
import {resolve,sep} from 'node:path'
import {createHash} from 'node:crypto'

/** Only the downloaded immutable release is an input. No adjacent source lookup. */
export function loadAmisP1Examples(releaseDirectory,namespace) {
  assert.match(namespace,/^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*$/)
  const root=realpathSync(releaseDirectory)
  const provenance=JSON.parse(readFileSync(resolve(root,'release-provenance.json')))
  const load=path=>{
    assert(typeof path==='string'&&/^examples\/p1\/[a-z0-9.-]+\.(json|yaml)$/.test(path),'Exact published P1 example required')
    const file=resolve(root,path),actual=realpathSync(file)
    assert(actual.startsWith(root+sep)&&!lstatSync(file).isSymbolicLink())
    const bytes=readFileSync(file)
    assert.match(provenance.files?.[path]??'',/^[a-f0-9]{64}$/)
    assert.equal(createHash('sha256').update(bytes).digest('hex'),provenance.files[path],'Published example hash differs')
    return JSON.parse(bytes)
  }
  const manifest=load('examples/p1/scenarios.json')
  assert.equal(manifest.schemaVersion,1)
  assert(Array.isArray(manifest.scenarios)&&manifest.scenarios.length>0)
  const ids=new Set()
  const scenarios=manifest.scenarios.map(item=>{
    assert.match(item.id,/^p1-[a-z0-9-]+$/);assert(!ids.has(item.id),'Duplicate P1 scenario');ids.add(item.id)
    const flow=load(item.flow),schema=load(item.schema)
    assert.equal(flow.id,item.flowId);assert.equal(flow.namespace,item.namespace)
    assert.match(item.flowId,/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/)
    assert.match(item.pageId,/^[A-Za-z0-9_][A-Za-z0-9_-]{0,99}$/);assert.match(item.apiId,/^[A-Za-z0-9_][A-Za-z0-9_-]{0,99}$/)
    assert.match(item.namespaceFile,/^\/p1\/[a-z0-9.-]+\.json$/)
    assert.equal(schema.type,'page')
    assert.equal(flow.triggers?.filter(t=>t.type==='io.kestra.plugin.amis.apps.PageTrigger').length,1)
    assert.equal(flow.triggers?.filter(t=>t.type==='io.kestra.plugin.amis.apps.ApiTrigger').length,1)
    const page=flow.triggers.find(t=>t.type==='io.kestra.plugin.amis.apps.PageTrigger'),api=flow.triggers.find(t=>t.type==='io.kestra.plugin.amis.apps.ApiTrigger')
    assert.equal(page.schema,'nsfile://'+item.namespaceFile);assert.equal(page.pageId,item.pageId);assert.equal(api.apiId,item.apiId)
    const adapted={...structuredClone(flow),namespace}
    return {...structuredClone(item),namespace,flow:adapted,schema,source:{flowPath:item.flow,schemaPath:item.schema,flowSha256:provenance.files[item.flow],schemaSha256:provenance.files[item.schema]}}
  })
  return {schemaVersion:1,scenarios}
}

export async function seedAmisP1Examples(client,examples) {
  const observations=[]
  for(const item of examples.scenarios) {
    const body=new FormData();body.append('fileContent',new Blob([JSON.stringify(item.schema)],{type:'application/json'}),'schema.json')
    const path='/api/v1/main/namespaces/'+item.namespace+'/files?'+new URLSearchParams({path:item.namespaceFile})
    const written=await client.request(path,{method:'POST',body});assert.equal(written.status,200);await written.body?.cancel()
    const stored=await client.request(path);assert.equal(stored.status,200);assert.deepEqual(await stored.json(),item.schema)
    const flow=await client.request('/api/v1/main/flows',{method:'POST',headers:{'Content-Type':'application/x-yaml'},body:JSON.stringify(item.flow)})
    assert.equal(flow.status,200,'P1 example Flow must pass actual host validation');const result=await flow.json()
    assert.equal(result.namespace,item.namespace);assert.equal(result.id,item.flowId)
    observations.push({id:item.id,namespace:item.namespace,flowId:item.flowId,revision:result.revision,schemaReadback:true,source:item.source})
  }
  return observations
}
