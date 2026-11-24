#!/usr/bin/env node
// Formal baseline is a deployment input, never an instruction to build either repository.
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {resolve,join} from 'node:path'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import {validateConfig,verifyPublishedXml} from './upstream-upgrade-rehearsal.mjs'
const [releaseDirectory,outputDirectory]=process.argv.slice(2)
assert(releaseDirectory&&outputDirectory&&process.argv.length===4,'release directory and new output directory required')
const release=resolve(releaseDirectory), output=resolve(outputDirectory)
await mkdir(output,{mode:0o700})
const baseline=JSON.parse(await readFile(new URL('../deployment/upstream-upgrade-baseline.json',import.meta.url)))
const selection=JSON.parse(await readFile(join(release,'release-evidence.json')))
const run=(program,args)=>execFileSync(program,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:180000,maxBuffer:128*1024*1024}).trim()
const source=repository=>run('git',['-C',repository,'rev-parse','HEAD'])
const oldArtifact=join(output,'old-artifact')
run('gh',['run','download',String(baseline.plugin.runId),'-R',baseline.plugin.repository,'--name','kestra-rbac-authorizer','--dir',oldArtifact])
const jarPath=directory=>join(directory,'build/libs/kestra-rbac-authorizer.jar')
const sha=async path=>createHash('sha256').update(await readFile(path)).digest('hex')
assert.equal(await sha(jarPath(oldArtifact)),baseline.jarSha256)
const xmlGates=[]
for(const path of ['.evidence/unit/results','.evidence/postgres/results','.evidence/lifecycle/results']) {
 const {readdir}=await import('node:fs/promises');let tests=0
 for(const file of await readdir(join(release,'plugin-artifact',path))) if(file.endsWith('.xml')) for(const match of (await readFile(join(release,'plugin-artifact',path,file),'utf8')).matchAll(/<testsuite\s+[^>]*\btests="(\d+)"/g)) tests+=Number(match[1])
 xmlGates.push({path,tests})
}
await verifyPublishedXml(join(release,'plugin-artifact'),xmlGates)
const image=(await readFile(join(release,'image'),'utf8')).trim()
const current={image,overlay:{repository:'ai-specs/kestra-overlay',runId:selection.overlayRunId,commit:source('kestra-overlay')},plugin:{repository:'ai-specs/kestra-plugin-rbac',runId:selection.pluginRunId,commit:source('kestra-plugin-rbac'),xmlGates},jar:{path:jarPath(join(release,'plugin-artifact')),sha256:selection.jarSha256}}
assert.equal(await sha(current.jar.path),current.jar.sha256)
const old={image:baseline.image,overlay:baseline.overlay,plugin:baseline.plugin,jar:{path:jarPath(oldArtifact),sha256:baseline.jarSha256}}
for(const mode of ['A','B']) {
 const config={mode,ownerLabel:`upgrade-ci-${mode.toLowerCase()}-${process.env.GITHUB_RUN_ID??Date.now()}`,appPort:18199,postgres:{container:process.env.UPGRADE_PG_CONTAINER,network:process.env.UPGRADE_PG_NETWORK,admin:process.env.UPGRADE_PG_ADMIN},old:structuredClone(old),new:structuredClone(current)}
 if(mode==='A') for(const side of ['old','new']) {delete config[side].jar;delete config[side].plugin}
 validateConfig(config)
 await writeFile(join(output,`mode-${mode.toLowerCase()}.json`),JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'})
}
