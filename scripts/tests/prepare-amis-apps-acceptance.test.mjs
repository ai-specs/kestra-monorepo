import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync,symlinkSync} from 'node:fs'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {prepareAmisAppsAcceptance} from '../prepare-amis-apps-acceptance.mjs'

// Explicit synthetic runner/files. Never invokes git, gh, Python, bash or Docker.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')
const hash=value=>createHash('sha256').update(value).digest('hex')
const amis=Buffer.from('SYNTHETIC AMIS thin jar'),rbac=Buffer.from('SYNTHETIC RBAC jar'),exe=Buffer.from('SYNTHETIC formal executable'),probe=Buffer.from('SYNTHETIC compiled probe')
const hostImage=readFileSync(join(root,'.env.example'),'utf8').split(/\r?\n/).find(line=>line.startsWith('KESTRA_IMAGE=')).slice('KESTRA_IMAGE='.length)
const selection={stage:'P0',hostCommit:'a'.repeat(40),amisCommit:'b'.repeat(40),rbacCommit:'c'.repeat(40),hostImage,
  hostExecutableSha256:hash(exe),amisArtifactImage:'ghcr.io/ai-specs/kestra-plugin-amis-apps-artifact@sha256:'+'d'.repeat(64),
  amisJarSha256:hash(amis),rbacJarSha256:hash(rbac),expectedJavaTests:355}
const id='e'.repeat(64)
function fixture(t,fault={}) {
  mkdirSync(join(root,'.work'),{recursive:true})
  const parent=mkdtempSync(join(root,'.work/amis-preparer-synthetic-'));t.after(()=>rmSync(parent,{recursive:true,force:true}))
  const options={directory:join(parent,'new'),selection:structuredClone(selection)},calls=[],downloads=[]
  let owner
  const output=(stdout='')=>({stdout})
  const put=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,typeof value==='object'&&!Buffer.isBuffer(value)?JSON.stringify(value):value)}
  const runner=async(command,args,extra={})=>{
    calls.push({command,args:[...args],extra})
    assert(!args.some(arg=>/\/kestra-plugin-amis-apps(?:\/|\.git$)/.test(arg)),'No private AMIS checkout/source path')
    assert(!['start','run','exec','compose','stop','prune'].includes(args[0]),'Never start runtime services')
    if(command==='git') {
      if(args[0]==='clone') {
        assert.deepEqual(args.slice(0,5),['clone','--no-checkout','--depth','1','--'])
        const remote=args[5],path=args[6]
        assert(['kestra-overlay','kestra-plugin-rbac'].some(name=>remote===`https://github.com/ai-specs/${name}.git`))
        assert(path.startsWith(options.directory+'/public/'));mkdirSync(path);return output()
      }
      assert.equal(args[0],'-C');const cwd=args[1],tail=args.slice(2)
      if(cwd===root){
        if(tail.join(' ')==='rev-parse HEAD')return output('f'.repeat(40))
        assert.equal(tail[0],'ls-tree')
        return output([['hostCommit','kestra-overlay'],['amisCommit','kestra-plugin-amis-apps'],['rbacCommit','kestra-plugin-rbac']].map(([key,name])=>`160000 commit ${fault.gitlink&&key==='amisCommit'?'0'.repeat(40):selection[key]}\t${name}`).join('\n'))
      }
      assert(cwd.startsWith(options.directory+'/public/'),'No adjacent development checkout access')
      const name=cwd.endsWith('kestra-overlay')?'kestra-overlay':'kestra-plugin-rbac',commit=name==='kestra-overlay'?selection.hostCommit:selection.rbacCommit
      if(tail[0]==='fetch'){assert.deepEqual(tail,['fetch','--depth','1','origin',commit]);return output()}
      if(tail[0]==='checkout'){assert.deepEqual(tail,['checkout','--detach',commit]);return output()}
      if(tail.join(' ')==='rev-parse HEAD')return output(fault.publicCommit?'0'.repeat(40):commit)
      if(tail.join(' ')==='rev-parse --abbrev-ref HEAD')return output(fault.publicAttached?'main':'HEAD')
      if(tail.join(' ')==='rev-parse --show-toplevel')return output(cwd)
      assert.deepEqual(tail,['config','--get','remote.origin.url']);return output(fault.publicRemote?'https://evil.invalid/repo.git':`https://github.com/ai-specs/${name}.git`)
    }
    if(command==='python3') {
      assert.equal(args[0],join(options.directory,'public/scripts/select-application-project-release.py'))
      assert.deepEqual(readFileSync(args[0]),readFileSync(join(root,'scripts/select-application-project-release.py')))
      const dest=args[1]
      assert.equal(readFileSync(join(dest,'image'),'utf8').trim(),selection.hostImage)
      put(join(dest,'release-evidence.json'),{overlayRunId:101,pluginRunId:102,pluginArtifactId:103,jarSha256:selection.rbacJarSha256})
      const jar=join(dest,'plugin-artifact/build/libs/kestra-rbac-authorizer.jar')
      put(jar,fault.rbacHash?'bad jar':rbac)
      if(fault.rbacSymlink){rmSync(jar);put(join(dest,'linked.jar'),rbac);symlinkSync(join(dest,'linked.jar'),jar)}
      put(join(dest,'plugin-artifact/.integration/host-provenance.json'),{image:fault.rbacHost?'wrong':selection.hostImage,sha256:fault.rbacExeHash?'0'.repeat(64):selection.hostExecutableSha256})
      return output()
    }
    if(command==='gh') {
      assert.equal(args[0],'api');assert.match(args[1],/^repos\/ai-specs\/(kestra-overlay|kestra-plugin-rbac)\/actions\/runs\/(101|102)$/)
      const host=args[1].includes('kestra-overlay')
      return output(JSON.stringify({id:host?101:102,head_sha:host?selection.hostCommit:selection.rbacCommit,head_branch:'main',event:'push',status:fault.sourceIncomplete?'in_progress':'completed',conclusion:fault.sourceCI?'failure':'success',path:'.github/workflows/'+(host?'overlay.yml':'build.yml'),head_repository:{full_name:'ai-specs/'+(host?'kestra-overlay':'kestra-plugin-rbac')}}))
    }
    if(command==='docker') {
      if(args[0]==='pull'){assert.deepEqual(args,['pull','--platform','linux/amd64',selection.hostImage]);if(fault.pull)throw new Error('synthetic pull failure');return output()}
      if(args[0]==='create'){assert.equal(args.at(-2),selection.hostImage);assert.equal(args.at(-1),'/artifact-only');owner=args[args.indexOf('--label')+1].slice(6);return output(id)}
      if(args[0]==='inspect')return output(JSON.stringify([{Id:id,Config:{Image:selection.hostImage,Labels:{owner:fault.owner?'foreign-owner':owner}},State:{Running:!!fault.running,Status:fault.running?'running':'created'}}]))
      if(args[0]==='cp'){
        assert.equal(args[1],id+':/app/kestra');assert.equal(args[2],join(options.directory,'host-executable.jar'))
        if(fault.cp)throw new Error('synthetic cp failure')
        put(args[2],fault.exeHash?'bad executable':exe);return output()
      }
      assert.deepEqual(args,['rm',id]);if(fault.cleanup)throw new Error('synthetic cleanup failure');return output()
    }
    assert.equal(command,'bash');assert.deepEqual(args,[join(root,'scripts/amis-apps-probe/compile.sh')])
    assert.equal(extra.cwd,root)
    assert.equal(extra.env.AMIS_PROBE_HOST_JAR,join(options.directory,'host-executable.jar'))
    assert.equal(extra.env.AMIS_PROBE_HOST_SHA256,selection.hostExecutableSha256)
    assert.equal(hash(readFileSync(extra.env.AMIS_PROBE_HOST_JAR)),selection.hostExecutableSha256)
    assert.equal(extra.env.AMIS_PROBE_COMPILER_JAR,join(options.directory,'micronaut-inject-java-4.10.33.jar'))
    if(fault.compile)throw new Error('synthetic compile failure')
    const out=extra.env.AMIS_PROBE_OUT
    put(join(out,'amis-apps-probe.jar'),probe)
    put(join(out,'compile-report.json'),{hostSha256:selection.hostExecutableSha256,jdk:'25',runtimeHost:false,compiler:'micronaut-inject-java:4.10.33',compilerSha256:'01e63084f1b466f5202aee78f3b7a7a19a1900c1bc8b35985284a21e741784f0',sourceHash:'1'.repeat(64),probeJarSha256:fault.probeHash?'0'.repeat(64):hash(probe),selfTest:'PASS: synthetic only',readiness:Object.fromEntries(['flowRepositoryListener','flowMetaStoreListener','namespaceFactoryListener','storageListener','authorizationListener'].map(key=>[key,fault.probeReadiness?'missing':'present']))})
    return output()
  }
  const downloadAmis=async(image,dest,expected,transport)=>{
    downloads.push({image,dest,expected})
    assert.equal(transport.runner,runner)
    assert.deepEqual(expected,{stage:'P0',amisCommit:selection.amisCommit,hostImage:selection.hostImage,hostExecutableSha256:selection.hostExecutableSha256,jarSha256:selection.amisJarSha256,expectedTests:355})
    if(fault.reader)throw new Error('synthetic source/publisher/reader refusal')
    put(join(dest,'release/kestra-amis-apps.jar'),fault.amisHash?'bad amis':amis)
    return {image,releaseDirectory:join(dest,'release'),registryProvenance:{publisherRunId:11,sourceRunId:10},audit:{stage:'P0',commit:fault.auditCommit?'0'.repeat(40):selection.amisCommit,java:{tests:fault.auditCount?354:355,failures:0,errors:0,skipped:fault.auditSkip?1:0},ui:{runtime:35,preferences:2,unit:189}}}
  }
  return {options,calls,downloads,dependencies:{runner,downloadAmis},parent}
}
test('SYNTHETIC fixed selection -> public checkout/selector + delegated OCI reader + never-started executable + probe + runner options',async t=>{
  const f=fixture(t),result=await prepareAmisAppsAcceptance(f.options,f.dependencies)
  assert.equal(result.prepared,true);assert.equal(result.selected.rootCommit,'f'.repeat(40))
  assert.equal(result.selected.amisReleaseDirectory,join(f.options.directory,'amis-oci/release'))
  assert.equal(result.selected.amisJar,join(result.selected.amisReleaseDirectory,'kestra-amis-apps.jar'))
  assert.equal(result.selected.expectedTests,selection.expectedJavaTests)
  for(const key of Object.keys(selection))assert.deepEqual(result.selected[key],selection[key])
  assert.equal(result.rootDirectory,root);assert.equal(result.probeJar,result.selected.probeJar)
  assert.equal(hash(readFileSync(result.selected.amisJar)),selection.amisJarSha256)
  assert.equal(hash(readFileSync(result.selected.rbacJar)),selection.rbacJarSha256)
  assert.equal(hash(readFileSync(result.selected.hostExecutable)),selection.hostExecutableSha256)
  assert.equal(hash(readFileSync(result.probeJar)),result.selected.probeJarSha256)
  assert.equal(f.downloads.length,1)
  const docker=f.calls.filter(row=>row.command==='docker').map(row=>row.args[0])
  assert.deepEqual(docker,['pull','create','inspect','cp','rm'])
  assert.equal(f.calls.filter(row=>row.command==='git'&&row.args[0]==='clone').length,2)
  assert.equal(JSON.parse(readFileSync(join(f.options.directory,'preparation-report.json'))).cleanup.hostContainer,'removed')
  assert.deepEqual(JSON.parse(readFileSync(join(f.options.directory,'runner-options.json'))),result)
})
for(const [fault,phase]of [['gitlink','root-selection'],['reader','formal-amis-oci'],['amisHash','formal-amis-oci'],['auditCommit','formal-amis-oci'],['auditCount','formal-amis-oci'],['auditSkip','formal-amis-oci'],['publicCommit','public-actions-selection'],['publicAttached','public-actions-selection'],['publicRemote','public-actions-selection'],['rbacHash','public-actions-selection'],['rbacSymlink','public-actions-selection'],['rbacHost','public-actions-selection'],['rbacExeHash','public-actions-selection'],['sourceIncomplete','public-actions-selection'],['sourceCI','public-actions-selection'],['pull','formal-host-executable'],['owner','formal-host-executable'],['running','formal-host-executable'],['cp','formal-host-executable'],['exeHash','formal-host-executable'],['cleanup','formal-host-executable'],['compile','compile-root-probe'],['probeHash','compile-root-probe'],['probeReadiness','compile-root-probe']])test(`SYNTHETIC rejects ${fault}; retains partial evidence and exact cleanup`,async t=>{
  const f=fixture(t,{[fault]:true})
  await assert.rejects(prepareAmisAppsAcceptance(f.options,f.dependencies),error=>{
    assert.equal(error.report.prepared,false);assert.equal(error.report.failure.phase,phase)
    assert.equal(error.evidenceDirectory,f.options.directory);return true
  })
  assert(!existsSync(join(f.options.directory,'runner-options.json')))
  const created=f.calls.some(row=>row.command==='docker'&&row.args[0]==='create'),removed=f.calls.some(row=>row.command==='docker'&&row.args[0]==='rm')
  assert.equal(removed,created&&fault!=='owner')
  if(fault==='owner')assert.equal(JSON.parse(readFileSync(join(f.options.directory,'preparation-report.json'))).cleanup.hostContainer,'ownership-unverified-retained')
})
test('SYNTHETIC selection file and options are ordinary JSON; no .env or adjacent checkout reads',async t=>{
  const f=fixture(t);const selectionFile=join(f.parent,'selection.json');writeFileSync(selectionFile,JSON.stringify(f.options.selection))
  delete f.options.selection;f.options.selectionFile=selectionFile
  const result=await prepareAmisAppsAcceptance(f.options,f.dependencies);assert.equal(result.prepared,true)
  const text=JSON.stringify(f.calls)
  for(const name of ['kestra-overlay','kestra-plugin-rbac','kestra-plugin-amis-apps'])assert(!text.includes(join(root,name)))
  assert(!text.includes('submodule'));assert(!text.includes('docker login'))
})
test('SYNTHETIC refuses reused destination before running commands',async t=>{
  const f=fixture(t);mkdirSync(f.options.directory)
  await assert.rejects(prepareAmisAppsAcceptance(f.options,f.dependencies),/EEXIST/);assert.equal(f.calls.length,0)
})
for(const kind of ['outside','symlink','tag','count','extra','env-image'])test(`SYNTHETIC rejects invalid ${kind}`,async t=>{
  const f=fixture(t)
  if(kind==='outside')f.options.directory=join(root,'not-allowed')
  if(kind==='symlink'){const link=join(f.parent,'link');symlinkSync(f.parent,link);f.options.directory=join(link,'new')}
  if(kind==='tag')f.options.selection.amisArtifactImage='ghcr.io/ai-specs/kestra-plugin-amis-apps-artifact:latest'
  if(kind==='count')f.options.selection.expectedJavaTests=0
  if(kind==='extra')f.options.selection.token='must-not-consume'
  if(kind==='env-image')f.options.selection.hostImage='ghcr.io/ai-specs/kestra-overlay@sha256:'+'0'.repeat(64)
  await assert.rejects(prepareAmisAppsAcceptance(f.options,f.dependencies));assert.equal(f.downloads.length,0)
})

test('SYNTHETIC rejects unknown stages and incomplete P1 counts without commands or downloads',async t=>{
  for(const change of [{stage:undefined},{stage:'P2'},{stage:'p1'},{stage:'P1',expectedJavaTests:374}]){
    const f=fixture(t);Object.assign(f.options.selection,change)
    await assert.rejects(prepareAmisAppsAcceptance(f.options,f.dependencies),/Explicit P0 or P1|P1 requires an exact Java/)
    assert.equal(f.calls.length,0);assert.equal(f.downloads.length,0)
  }
})

test('SYNTHETIC P1 selection reaches OCI with P1 and rejects a P0 audit',async t=>{
  const f=fixture(t);Object.assign(f.options.selection,{stage:'P1',expectedJavaTests:375})
  let actual
  const fixtureDownload=f.dependencies.downloadAmis
  f.dependencies.downloadAmis=async(...args)=>{actual=structuredClone(args[2]);args[2]={...args[2],stage:'P0',expectedTests:355};return fixtureDownload(...args)}
  await assert.rejects(prepareAmisAppsAcceptance(f.options,f.dependencies),error=>{assert.equal(error.cause?.actual,'P0');assert.equal(error.cause?.expected,'P1');return true})
  assert.equal(actual.stage,'P1');assert.equal(actual.expectedTests,375)
})
