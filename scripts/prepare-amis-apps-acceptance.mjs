#!/usr/bin/env node
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createHash,randomUUID} from 'node:crypto'
import {mkdirSync,readFileSync,writeFileSync,lstatSync,realpathSync} from 'node:fs'
import {dirname,join,resolve,sep} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {download} from './amis-apps-oci.mjs'

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const execute=promisify(execFile),hex=/^[a-f0-9]{64}$/,commit=/^[a-f0-9]{40}$/
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
const defaultRunner=(command,args,{cwd,env}={})=>execute(command,args,{cwd,env:{...process.env,...env},encoding:'buffer',timeout:1200000,maxBuffer:32*1024*1024})
const repositories={hostCommit:'kestra-overlay',amisCommit:'kestra-plugin-amis-apps',rbacCommit:'kestra-plugin-rbac'}
const fields=['stage','hostCommit','amisCommit','rbacCommit','hostImage','hostExecutableSha256','amisArtifactImage','amisJarSha256','rbacJarSha256','expectedJavaTests']
function regular(path) {
  const stat=lstatSync(path)
  assert(stat.isFile()&&!stat.isSymbolicLink()&&realpathSync(path)===path,'Regular file without symlink ancestry required: '+path)
  return readFileSync(path)
}
function json(path){return JSON.parse(regular(path).toString('utf8'))}
function selectionValue(value) {
  assert(value&&typeof value==='object'&&!Array.isArray(value),'Selection object required')
  assert.deepEqual(Object.keys(value).sort(),[...fields].sort(),'Exact selection fields required')
  assert.equal(value.stage,'P0')
  for(const key of Object.keys(repositories))assert(commit.test(value[key]),'Invalid selection commit: '+key)
  for(const key of ['hostExecutableSha256','amisJarSha256','rbacJarSha256'])assert(hex.test(value[key]),'Invalid selection hash: '+key)
  assert.match(value.hostImage,/^ghcr\.io\/ai-specs\/kestra-overlay@sha256:[a-f0-9]{64}$/)
  assert.match(value.amisArtifactImage,/^ghcr\.io\/ai-specs\/kestra-plugin-amis-apps-artifact@sha256:[a-f0-9]{64}$/)
  assert(Number.isSafeInteger(value.expectedJavaTests)&&value.expectedJavaTests>0,'Exact positive Java test count required')
  return structuredClone(value)
}

/** Preparation only; never starts a container or executes business acceptance.
 * options: {directory: NEW absolute root .work child, selectionFile?: path}.
 * selectionFile defaults to deployment/amis-apps-release.json; selection may be
 * supplied directly for programmatic callers/tests. Never reads .env or adjacent
 * submodule sources. Public checkouts and the unchanged public Actions selector
 * live in the new area. downloadAmis is a synthetic unit seam; production uses
 * the existing OCI downloader with its complete registry/release reader checks.
 * runner(command,argv,{cwd?,env?}) receives argv, never shell command text.
 */
export async function prepareAmisAppsAcceptance(options,{runner=defaultRunner,downloadAmis=download}={}) {
  assert(options&&typeof options.directory==='string','New output directory required')
  assert(!options.selection||!options.selectionFile,'Choose selection or selectionFile')
  const selection=selectionValue(options.selection??json(resolve(options.selectionFile??join(repository,'deployment/amis-apps-release.json'))))
  const area=resolve(options.directory)
  assert(area.startsWith(join(repository,'.work')+sep),'Output must be a new root .work child')
  mkdirSync(join(repository,'.work'),{recursive:true,mode:0o700})
  assert.equal(realpathSync(join(repository,'.work')),join(repository,'.work'),'Root .work symlink forbidden')
  assert.equal(realpathSync(dirname(area)),dirname(area),'Symlink output parent forbidden')
  mkdirSync(area,{mode:0o700})
  const commands=[],report={schemaVersion:1,prepared:false,scope:'Formal input preparation only; no business/UI/P0 acceptance executed',selection,steps:[],cleanup:{hostContainer:'not-created'}}
  const write=(name,value)=>writeFileSync(join(area,name),JSON.stringify(value,null,2)+'\n',{mode:0o600})
  const save=()=>{write('preparation-report.json',report);write('commands.json',commands)}
  const run=async(command,args,extra={})=>{
    commands.push({command,args:[...args],...(extra.cwd?{cwd:extra.cwd}:{})})
    const value=await runner(command,args,extra)
    assert(value&&(typeof value.stdout==='string'||Buffer.isBuffer(value.stdout)),'Runner stdout required')
    return String(value.stdout).trim()
  }
  const step=async(name,action)=>{
    const row={name,status:'running'};report.steps.push(row);save()
    try{row.evidence=await action();row.status='passed';save();return row.evidence}
    catch(cause){row.status='failed';save();throw cause}
  }
  save();write('selection.json',selection)
  let selected
  try {
    const rootCommit=await step('root-selection',async()=>{
      const root=await run('git',['-C',repository,'rev-parse','HEAD']);assert(commit.test(root),'Root commit required')
      const tree=await run('git',['-C',repository,'ls-tree','HEAD','--',...Object.values(repositories)])
      const links=new Map(tree.split('\n').map(line=>{const match=/^160000 commit ([a-f0-9]{40})\t(.+)$/.exec(line);assert(match,'Exact root gitlink required');return [match[2],match[1]]}))
      assert.equal(links.size,3,'Three independent gitlinks required')
      for(const [key,name]of Object.entries(repositories))assert.equal(links.get(name),selection[key],'Root gitlink differs: '+name)
      const images=regular(join(repository,'.env.example')).toString('utf8').split(/\r?\n/).filter(line=>line.startsWith('KESTRA_IMAGE='))
      assert.deepEqual(images,['KESTRA_IMAGE='+selection.hostImage],'.env.example host image differs')
      return root
    })
    const amis=await step('formal-amis-oci',async()=>{
      const result=await downloadAmis(selection.amisArtifactImage,join(area,'amis-oci'),{
        stage:'P0',amisCommit:selection.amisCommit,hostImage:selection.hostImage,hostExecutableSha256:selection.hostExecutableSha256,
        jarSha256:selection.amisJarSha256,expectedTests:selection.expectedJavaTests,
      },{runner})
      assert.equal(result.image,selection.amisArtifactImage)
      assert.equal(result.releaseDirectory,join(area,'amis-oci/release'))
      assert.equal(digest(regular(join(result.releaseDirectory,'kestra-amis-apps.jar'))),selection.amisJarSha256)
      assert.equal(result.audit?.stage,'P0');assert.equal(result.audit.commit,selection.amisCommit)
      assert.equal(result.audit.java.tests,selection.expectedJavaTests)
      assert.equal(result.audit.java.failures,0);assert.equal(result.audit.java.errors,0);assert.equal(result.audit.java.skipped,0)
      // UI/source/report correctness is enforced by the existing release reader.
      return result
    })
    const publicRoot=join(area,'public'),publicEvidence=join(area,'public-release')
    const publication=await step('public-actions-selection',async()=>{
      mkdirSync(publicRoot);mkdirSync(join(publicRoot,'scripts'));mkdirSync(publicEvidence)
      const selector=regular(join(repository,'scripts/select-application-project-release.py'))
      const selectorPath=join(publicRoot,'scripts/select-application-project-release.py')
      writeFileSync(selectorPath,selector,{mode:0o600,flag:'wx'})
      for(const [key,name]of [['hostCommit','kestra-overlay'],['rbacCommit','kestra-plugin-rbac']]) {
        const checkout=join(publicRoot,name),remote=`https://github.com/ai-specs/${name}.git`
        await run('git',['clone','--no-checkout','--depth','1','--',remote,checkout])
        await run('git',['-C',checkout,'fetch','--depth','1','origin',selection[key]])
        await run('git',['-C',checkout,'checkout','--detach',selection[key]])
        assert.equal(await run('git',['-C',checkout,'rev-parse','HEAD']),selection[key],'Public checkout commit differs')
        assert.equal(await run('git',['-C',checkout,'rev-parse','--abbrev-ref','HEAD']),'HEAD','Public checkout must have detached HEAD')
        assert.equal(await run('git',['-C',checkout,'rev-parse','--show-toplevel']),checkout,'Independent public checkout required')
        assert.equal(await run('git',['-C',checkout,'config','--get','remote.origin.url']),remote,'Public remote differs')
      }
      writeFileSync(join(publicEvidence,'image'),selection.hostImage+'\n',{mode:0o600,flag:'wx'})
      await run('python3',[selectorPath,publicEvidence])
      const evidence=json(join(publicEvidence,'release-evidence.json'))
      for(const key of ['overlayRunId','pluginRunId','pluginArtifactId'])assert(Number.isSafeInteger(evidence[key])&&evidence[key]>0,'Positive public Actions receipt required: '+key)
      assert.equal(evidence.jarSha256,selection.rbacJarSha256)
      const runs=[]
      for(const [name,key,shaKey,workflow]of [['kestra-overlay','overlayRunId','hostCommit','overlay.yml'],['kestra-plugin-rbac','pluginRunId','rbacCommit','build.yml']]) {
        const runEvidence=JSON.parse(await run('gh',['api',`repos/ai-specs/${name}/actions/runs/${evidence[key]}`]))
        for(const [field,expected]of Object.entries({id:evidence[key],head_sha:selection[shaKey],head_branch:'main',event:'push',status:'completed',conclusion:'success',path:'.github/workflows/'+workflow}))assert.equal(runEvidence[field],expected,'Public source CI differs: '+field)
        assert.equal(runEvidence.head_repository?.full_name,'ai-specs/'+name)
        write(name+'-source-ci.json',runEvidence);runs.push({repository:name,runId:evidence[key],commit:selection[shaKey]})
      }
      const rbacJar=join(publicEvidence,'plugin-artifact/build/libs/kestra-rbac-authorizer.jar')
      assert.equal(digest(regular(rbacJar)),selection.rbacJarSha256,'Downloaded RBAC jar SHA differs')
      const host=json(join(publicEvidence,'plugin-artifact/.integration/host-provenance.json'))
      assert.equal(host.image,selection.hostImage,'RBAC host image differs')
      assert.equal(host.sha256,selection.hostExecutableSha256,'RBAC host executable SHA differs')
      return {evidence,runs,selectorSha256:digest(selector),rbacJar}
    })
    const hostPath=join(area,'host-executable.jar')
    await step('formal-host-executable',async()=>{
      const owner='amis-acceptance-preparer-'+randomUUID();let containerId,owned=false,failure
      try {
        await run('docker',['pull','--platform','linux/amd64',selection.hostImage])
        const id=await run('docker',['create','--platform','linux/amd64','--label','owner='+owner,selection.hostImage,'/artifact-only'])
        assert(hex.test(id),'Full actual host container ID required');containerId=id
        report.cleanup={hostContainer:'created',owner,containerId};save()
        const inspect=JSON.parse(await run('docker',['inspect',id]));assert.equal(inspect.length,1)
        assert.equal(inspect[0].Id,id);owned=inspect[0].Config?.Labels?.owner===owner
        assert(owned,'Host container owner differs; foreign container must not be removed')
        assert.equal(inspect[0].Config.Image,selection.hostImage,'Host container image differs')
        assert.equal(inspect[0].State?.Running,false,'Host extraction container must never run')
        assert.equal(inspect[0].State?.Status,'created','Host extraction container must remain created')
        await run('docker',['cp',id+':/app/kestra',hostPath])
        assert.equal(digest(regular(hostPath)),selection.hostExecutableSha256,'Formal executable SHA differs')
        writeFileSync(join(area,'host-executable.sha256'),selection.hostExecutableSha256+'  host-executable.jar\n',{mode:0o600,flag:'wx'})
      }catch(error){failure=error}
      finally {
        if(containerId&&owned){try{await run('docker',['rm',containerId]);report.cleanup.hostContainer='removed'}catch(error){report.cleanup.hostContainer='remove-failed';failure??=error}}
        else if(containerId)report.cleanup.hostContainer='ownership-unverified-retained'
        save()
      }
      if(failure)throw failure
      return {path:hostPath,sha256:selection.hostExecutableSha256,owner,containerId,started:false}
    })
    const probe=await step('compile-root-probe',async()=>{
      const out=join(area,'probe-build')
      await run('bash',[join(repository,'scripts/amis-apps-probe/compile.sh')],{cwd:repository,env:{AMIS_PROBE_HOST_JAR:hostPath,AMIS_PROBE_HOST_SHA256:selection.hostExecutableSha256,AMIS_PROBE_OUT:out,
        AMIS_PROBE_COMPILER_JAR:join(area,'micronaut-inject-java-4.10.33.jar')}})
      const compile=json(join(out,'compile-report.json')),probeJar=join(out,'amis-apps-probe.jar')
      assert.equal(compile.hostSha256,selection.hostExecutableSha256)
      assert.equal(compile.jdk,'25');assert.equal(compile.runtimeHost,false)
      assert.equal(compile.compiler,'micronaut-inject-java:4.10.33')
      assert.equal(compile.compilerSha256,'01e63084f1b466f5202aee78f3b7a7a19a1900c1bc8b35985284a21e741784f0')
      assert(hex.test(compile.sourceHash));assert.match(compile.selfTest,/^PASS:/)
      for(const name of ['flowRepositoryListener','flowMetaStoreListener','namespaceFactoryListener','storageListener','authorizationListener'])assert.equal(compile.readiness?.[name],'present')
      assert(hex.test(compile.probeJarSha256));assert.equal(digest(regular(probeJar)),compile.probeJarSha256)
      return {probeJar,probeJarSha256:compile.probeJarSha256,compileReport:join(out,'compile-report.json'),sourceHash:compile.sourceHash}
    })
    selected={...selection,rootCommit,expectedTests:selection.expectedJavaTests,amisReleaseDirectory:amis.releaseDirectory,amisJar:join(amis.releaseDirectory,'kestra-amis-apps.jar'),rbacJar:publication.rbacJar,
      hostExecutable:hostPath,probeJar:probe.probeJar,probeJarSha256:probe.probeJarSha256}
    const result={schemaVersion:1,prepared:true,scope:report.scope,rootDirectory:repository,selected,probeJar:probe.probeJar,
      evidenceDirectory:area,amisEvidence:join(area,'preparation-report.json'),publicEvidence:join(publicEvidence,'release-evidence.json')}
    write('runner-options.json',result);report.prepared=true;report.runnerOptions=join(area,'runner-options.json');save()
    return result
  }catch(cause){
    report.prepared=false;report.failure={phase:report.steps.find(row=>row.status==='failed')?.name??'preparation',message:cause instanceof assert.AssertionError?cause.message.split('\n')[0]:'External command or filesystem failure; retained steps and commands must be reviewed'};save()
    const error=new Error('AMIS acceptance preparation failed: '+report.failure.phase);error.report=structuredClone(report);error.evidenceDirectory=area;error.cause=cause;throw error
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{assert.equal(process.argv.length,3,'Usage: node scripts/prepare-amis-apps-acceptance.mjs OPTIONS_JSON');const result=await prepareAmisAppsAcceptance(json(resolve(process.argv[2])));console.log(JSON.stringify(result,null,2))}
  catch(error){console.error(error.evidenceDirectory?JSON.stringify({prepared:false,evidenceDirectory:error.evidenceDirectory,message:error.message}):'Invalid AMIS preparation options');process.exitCode=1}
}
