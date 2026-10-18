#!/usr/bin/env node
/** Entry point: --static | --config-check | --run.
 * --image ghcr.io/ai-specs/kestra-overlay@sha256:... --jar PATH --sha256 HASH
 * --root PATH --overlay PATH --plugin PATH --release-evidence FILE
 * Optional --port N --browser ci --migration-releases APPROVED_RELEASE_BUNDLES_JSON.
 * --allow-dirty-root is development only: exit 2 after implemented checks;
 * nonFinal=true and completed=false, no final checker invocation. Outputs go to a NEW private OS temporary directory.
 * release-evidence = {overlayRunId,pluginRunId,pluginArtifactId}.
 * Downloads the selected successful plugin run artifact, checks its jar hash
 * and host-provenance.image against image and the plugin host-contract pin.
 * --static succeeds only as a static entry-point check; acceptance remains false.
 * --config-check does not start containers or prove image publication.
 * --run starts only after immutable image promotion and artifact download gates.
 */
import assert from 'node:assert/strict'
import {execFileSync,spawnSync} from 'node:child_process'
import {createHash,randomBytes} from 'node:crypto'
import {mkdtempSync,writeFileSync,renameSync,readFileSync,statSync,realpathSync,mkdirSync,readdirSync,appendFileSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname,resolve,join} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {prepareApplicationProjectUi,runPreparedApplicationProjectUi,planApplicationProjectUi} from './application-project-ui-fixture.mjs'
import {scopeNames} from './application-project-cases.mjs'
import {initialEvidence,runIntegration} from './application-project-integration-cases.mjs'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {ProjectSideEffects} from './application-project-effects.mjs'
import {planFixture,planRestResources,directoryActivationPlan,provisionFixture,fixtureGaps,applicationProjectFeature,mcpProtocolEvidence,missingExtensionTopology} from './application-project-fixture.mjs'

/** Development can relax only root cleanliness, never independent release inputs. */
export function assertApplicationProjectSources(sources,{allowDirtyRoot=false}={}) {
  for(const name of ['root','overlay','plugin']) {
    assert(sources[name],'actual '+name+' source state required')
    assert(!sources[name].dirty||(name==='root'&&allowDirtyRoot),name+' source must be committed and clean'+(name==='root'?' (development may explicitly allow dirty root)':''))
  }
  return {nonFinal:allowDirtyRoot,finalEligible:!allowDirtyRoot}
}

export async function main(argv=process.argv.slice(2),runtime={}) {
  const options={};let mode
  for(let i=0;i<argv.length;i++) {
    const arg=argv[i]
    if(arg==='--allow-dirty-root'){assert(!options[arg],'duplicate '+arg);options[arg]=true}
    else if(['--static','--config-check','--run'].includes(arg)){assert(!mode,'choose exactly one mode');mode=arg.slice(2)}
    else {assert(['--image','--jar','--sha256','--root','--overlay','--plugin','--release-evidence','--port','--browser','--migration-releases'].includes(arg),'unknown option '+arg);assert(argv[i+1]&&!argv[i+1].startsWith('--'),'missing value '+arg);assert(options[arg]===undefined,'duplicate '+arg);options[arg]=argv[++i]}
  }
  assert(mode,'choose --static, --config-check or --run')
  if(runtime.retainOnFailure)assert(options['--allow-dirty-root']===true,'diagnostic resource retention requires explicit non-final development mode')
  assert(!options['--browser']||options['--browser']==='ci','only --browser ci is accepted; local Ego passes a caller-owned runtime.uiAdapter')
  const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..')
  const output=mkdtempSync(join(tmpdir(),'application-projects-bb-'))
  const project='application-projects-bb-'+Date.now()+'-'+process.pid
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
  const command=(program,args,extra={},attempt=0)=>{
    try{return execFileSync(program,args,{encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe'],env:{...process.env,PATH:process.env.PATH??'/opt/homebrew/opt/node@24/bin:/usr/local/bin:/usr/bin:/bin'},...extra}).trim()}
    catch(error){
      const redact=text=>String(text??'').split('\n').map(line=>/token|password|secret|cookie|authorization|Bearer|eyJ[A-Za-z0-9_-]+\.|[?&](?:state|code)=/i.test(line)?'[credential-bearing line redacted]':line).join('\n')
      appendFileSync(join(output,'command-failures.log'),JSON.stringify({program,args,attempt,status:error.status,code:error.code,stdout:redact(error.stdout),stderr:redact(error.stderr)})+'\n',{mode:0o600})
      const readOnly=program==='gh'&&(args[0]==='api'&&!args.some(value=>['-X','--method','-F','--field','-f','--raw-field','--input'].includes(value))||args[0]==='run'&&args[1]==='view')
      if(readOnly&&attempt<2&&/EOF|ETIMEDOUT|ECONNRESET|TLS handshake timeout/i.test(String(error.code)+' '+String(error.stderr)))return command(program,args,extra,attempt+1)
      throw error
    }
  }
  const git=(path,...args)=>command('git',['-C',path,...args])
  const report={schemaVersion:1,completed:false,nonFinal:options['--allow-dirty-root']===true,development:{allowDirtyRoot:options['--allow-dirty-root']===true},mode,startedAt:new Date().toISOString(),inputs:{image:options['--image']??null,jarSha256:options['--sha256']??null,rootCommit:null,overlayCommit:null,pluginCommit:null},...initialEvidence(),fragments:{},stages:[],failures:0,skipped:0,notRun:0,blockers:[...fixtureGaps],resources:{composeProject:project,containersCreated:false},staticChecks:[]}
  const reportPath=join(output,'report.json')
  let composeConfig,composeEnvironment,planned,composeStarted=false
  const additionalDeployments=[]
  const compose=(...args)=>command('docker',['compose','--env-file','/dev/null','-p',project,'-f',join(output,'compose.json'),...args],{env:composeEnvironment})
  const saveCompose=()=>writeFileSync(join(output,'compose.json'),JSON.stringify(composeConfig,null,2),{mode:0o600})
  const waitForHost=async()=>{
    const deadline=Date.now()+180000
    for(;;){try{const response=await fetch(report.resources.base+'/ping',{signal:AbortSignal.timeout(3000)});await response.body?.cancel();if(response.ok)return}catch{}assert(Date.now()<deadline,'host startup timeout');await new Promise(resolve=>setTimeout(resolve,1000))}
  }
  const canonical=value=>Array.isArray(value)?value.map(canonical).sort((left,right)=>JSON.stringify(left)<JSON.stringify(right)?-1:JSON.stringify(left)>JSON.stringify(right)?1:0):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
  const cli=(className,...args)=>compose('run','--rm','--no-deps','--user','0:0','--entrypoint','java','kestra','-cp','/app/kestra:/app/libs/kestra-rbac-authorizer.jar',className,...args)
  const writePlan=(name,value)=>{writeFileSync(join(output,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});return '/work/'+name}

  const persist=async()=>{
    const rows=[...report.matrix,...report.checks,...report.ui]
    report.notRun=rows.filter(row=>row.status==='not_run').length
    report.failures=rows.filter(row=>row.status==='failed').length+report.stages.filter(row=>row.status==='failed').length
    // Never infer acceptance from static checks or an empty fragment.
    report.completed=!report.nonFinal&&mode==='run'&&report.stages.some(row=>row.id==='final-report-check'&&row.status==='passed')&&report.notRun===0&&report.failures===0
    writeFileSync(reportPath+'.tmp',JSON.stringify(report,null,2)+'\n',{mode:0o600});renameSync(reportPath+'.tmp',reportPath)
    if(runtime.onReport)await runtime.onReport({reportPath,report:structuredClone(report)})
  }
  async function stage(id,operation) {
    const row={id,status:'running',startedAt:new Date().toISOString()};report.stages.push(row);await persist()
    try{row.evidence=await operation();row.status='passed'}catch(error){row.status='failed';row.error=error.stdout!==undefined||error.stderr!==undefined?'command failed ('+(error.code??error.status??'unknown')+'); raw credential-bearing process output is not retained':String(error.message);throw error}finally{row.finishedAt=new Date().toISOString();await persist()}
  }
  await persist()
  console.log(JSON.stringify({report:reportPath,completed:false,phase:'started'}))
  try {
    await stage('source-inputs',async()=>{
      const roots={root:resolve(options['--root']??repository),overlay:resolve(options['--overlay']??join(repository,'kestra-overlay')),plugin:resolve(options['--plugin']??join(repository,'kestra-plugin-rbac'))}
      report.sources={}
      for(const [name,path]of Object.entries(roots)) {
        assert.equal(realpathSync(git(path,'rev-parse','--show-toplevel')),realpathSync(path),'source path must be its own Git repository: '+name)
        report.inputs[name+'Commit']=git(path,'rev-parse','HEAD')
        const dirty=git(path,'status','--porcelain','--untracked-files=normal')
        report.sources[name]={path,dirty:dirty.length>0,diffSha256:hash(git(path,'diff','HEAD')),statusSha256:hash(dirty)}
      }
      assert.equal(realpathSync(roots.root),realpathSync(repository),'root commit must bind the repository containing the running entry point')
      if(mode==='run')assertApplicationProjectSources(report.sources,{allowDirtyRoot:options['--allow-dirty-root']===true})
      report.executionSources=Object.fromEntries(['blackbox-application-projects.sh','blackbox-application-projects.mjs','application-project-fixture.mjs','application-project-integration-cases.mjs','application-project-ui-fixture.mjs','application-project-browser-ci.cjs','application-project-migration-cases.mjs','application-project-security-cases.mjs','application-project-oauth-cases.mjs','application-project-aggregate-cases.mjs','application-project-target-ui.mjs'].map(name=>[name,hash(readFileSync(join(repository,'scripts',name)))]))
      return {actualPlatform:process.platform,node:process.version,commits:structuredClone(report.inputs)}
    })
    await stage('shared-module-interface',async()=>{
      for(const file of ['application-project-cases.mjs','application-project-policy.mjs','application-project-effects.mjs','application-project-rest-cases.mjs','application-project-mcp-cases.mjs','application-project-ui-cases.mjs','application-project-browser-adapters.mjs','production-oauth-client.mjs','check-application-project-report.mjs','application-project-ui-fixture.mjs','application-project-browser-ci.cjs','application-project-security-cases.mjs','application-project-oauth-cases.mjs','application-project-migration-cases.mjs','application-project-aggregate-cases.mjs','application-project-target-ui.mjs']) {
        command('node',['--check',join(repository,'scripts',file)])
        report.staticChecks.push({file,sha256:hash(readFileSync(join(repository,'scripts',file))),syntax:true})
      }
      assert.equal(report.matrix.length,56,'shared REST matrix changed; review integration')
      assert.equal(report.ui.length,52,'full theme/language matrix required')
      const planned=planFixture('http://localhost:18128')
      const resources=planRestResources(planned)
      assert.equal(Object.keys(resources.probes).length,56)
      assert.equal(Object.keys(planned.accounts).length,13)
      const ui=planApplicationProjectUi();for(const list of [ui.projects,ui.scopes,ui.clients,ui.users])assert(list.length>25)
      return {restRows:report.matrix.length,themeLanguageRows:report.ui.length,requiredChecks:report.checks.length,testAccounts:Object.keys(planned.accounts).length,mcpScenarioAccounts:Object.keys(planned.mcpAccounts).length,mcpToolSeeds:planned.mcp.seeds.length,uiDataPlan:{projects:ui.projects.length,scopes:ui.scopes.length,clients:ui.clients.length,assignments:ui.users.length,explicitBindings:Object.keys(ui.localBindings).length,filtersRuntimeVerified:false},pendingSharedMcpScopes:Object.values(planned.mcp.revocationScopes).filter(scope=>!Object.values(scopeNames).includes(scope))}
    })
    if(mode==='static'){report.staticOnly=true;await persist();return {exitCode:0,reportPath}}
    await stage('artifact-inputs',async()=>{
      assert(/^ghcr\.io\/ai-specs\/kestra-overlay@sha256:[a-f0-9]{64}$/.test(report.inputs.image??''),'explicit immutable formal image digest required')
      assert(/^[a-f0-9]{64}$/.test(report.inputs.jarSha256??''),'explicit formal jar SHA-256 required')
      const jar=realpathSync(options['--jar']??'')
      assert(!jar.includes('/deployment-backup/'),'deployment-backup must not be test input')
      assert(statSync(jar).isFile()&&hash(readFileSync(jar))===report.inputs.jarSha256,'actual jar hash differs')
      options.jar=jar;return {jarSha256:report.inputs.jarSha256}
    })
    await stage('compose-config',async()=>{
      const port=Number(options['--port']??18128);assert(Number.isInteger(port)&&port>1024&&port<65536)
      const base='http://localhost:'+port
      planned=planFixture(base)
      const env={PATH:process.env.PATH,HOME:process.env.HOME,DOCKER_CONFIG:process.env.DOCKER_CONFIG,KESTRA_IMAGE:report.inputs.image,POSTGRES_PASSWORD:randomBytes(24).toString('hex'),KESTRA_OIDC_UI_CLIENT_SECRET:randomBytes(24).toString('hex'),KESTRA_OIDC_BOOTSTRAP_USERNAME:planned.admin.username,KESTRA_OIDC_BOOTSTRAP_PASSWORD:planned.admin.password,KESTRA_OIDC_SETUP_ALLOWED:'false',KESTRA_RBAC_ENABLED:'false',KESTRA_OIDC_REGISTRATION_ENABLED:'true',KESTRA_OIDC_UI_SCOPES:'openid,profile,email'}
      // /dev/null excludes repository .env; fresh explicit environment excludes
      // inherited Compose project/files/profiles and real deployment credentials.
      const config=JSON.parse(command('docker',['compose','--env-file','/dev/null','--project-directory',repository,'-p',project,'-f',join(repository,'docker-compose.yml'),'config','--format','json'],{env}))
      delete config.name
      assert.deepEqual(Object.keys(config.services).sort(),['kestra','postgres'],'only owned two-service topology is accepted')
      assert(config.services.postgres.volumes.every(item=>item.type==='volume'),'database may only use own named volume')
      assert(!config.services.postgres.ports?.length,'database must not expose a host port')
      for(const service of Object.values(config.services)){delete service.container_name;delete service.build;assert(!service.network_mode&&!service.external_links)}
      for(const volume of Object.values(config.volumes??{})){delete volume.name;assert(!volume.external)}
      for(const network of Object.values(config.networks??{})){delete network.name;assert(!network.external)}
      const host=config.services.kestra
      host.image=report.inputs.image;host.ports=[{target:8080,published:String(port),host_ip:'127.0.0.1',protocol:'tcp'}]
      host.volumes=host.volumes.filter(item=>item.type==='volume')
      host.volumes.push({type:'bind',source:output,target:'/work',read_only:true})
      host.volumes.push({type:'bind',source:options.jar,target:'/app/libs/kestra-rbac-authorizer.jar',read_only:true})
      host.environment.KESTRA_CONFIGURATION=host.environment.KESTRA_CONFIGURATION.replaceAll('http://localhost:8080',base).replaceAll('url: '+base+'/oidc/token','url: http://localhost:8080/oidc/token').replaceAll('jwks-uri: '+base+'/oidc/jwks','jwks-uri: http://localhost:8080/oidc/jwks')
      host.environment.KESTRA_CONFIGURATION=applicationProjectFeature(host.environment.KESTRA_CONFIGURATION,false)
      assert(host.environment.KESTRA_CONFIGURATION.includes('kestra:\n'),'isolated host configuration root missing')
      host.environment.KESTRA_CONFIGURATION=host.environment.KESTRA_CONFIGURATION.replace('kestra:\n','kestra:\n  anonymous-usage-report:\n    enabled: false\n  ui-anonymous-usage-report:\n    enabled: false\n')
      Object.assign(host.environment,{KESTRA_OIDC_REGISTRATION_PENDING_TTL_MINUTES:'120',RBAC_POLICY_JDBC_URL:'jdbc:postgresql://postgres:5432/kestra',RBAC_POLICY_JDBC_USER:'kestra',RBAC_POLICY_JDBC_PASSWORD:env.POSTGRES_PASSWORD,RBAC_POLICY_OPERATOR_SUBJECT:planned.admin.subject})
      composeConfig=config;composeEnvironment=env
      const compose=join(output,'compose.json');saveCompose()
      command('docker',['compose','--env-file','/dev/null','-p',project,'-f',compose,'config','--quiet'],{env})
      report.resources.composeFile=compose;report.resources.base=base
      return {validated:true,project,loopbackPort:port,isolatedNamedVolumes:true,bindMounts:[{target:'/app/libs/kestra-rbac-authorizer.jar',readOnly:true}]}
    })
    if(mode==='config-check')return {exitCode:0,reportPath}
    await stage('publication-gate',async()=>{
      const evidence=JSON.parse(readFileSync(options['--release-evidence']??'','utf8'))
      const runs={}
      for(const [name,repo]of [['overlay','kestra-overlay'],['plugin','kestra-plugin-rbac']]) {
        assert(Number.isSafeInteger(evidence[name+'RunId']),'formal '+name+' run ID required')
        const run=JSON.parse(command('gh',['run','view',String(evidence[name+'RunId']),'-R','ai-specs/'+repo,'--json','headSha,status,conclusion,url,jobs']))
        assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');assert.equal(run.headSha,report.inputs[name+'Commit'])
        report.sources[name].ci={headSha:run.headSha,status:run.status,conclusion:run.conclusion,url:run.url};runs[name]=run
      }
      const promoted=runs.overlay.jobs.find(job=>job.name==='promote')
      assert(promoted&&promoted.conclusion==='success','successful promotion job required')
      const promoteLog=command('gh',['run','view',String(evidence.overlayRunId),'-R','ai-specs/kestra-overlay','--job',String(promoted.databaseId),'--log'])
      assert(!promoteLog.includes('SKIP: candidate commit is no longer the current main HEAD'),'obsolete main commit was not promoted')
      assert(promoted.steps.some(step=>step.name==='Promote verified immutable candidate to deployment tags'&&step.conclusion==='success'),'promotion step missing or skipped')
      const build=runs.overlay.jobs.find(job=>job.name==='build-push');assert(build&&build.conclusion==='success','successful image build job required')
      const logs=command('gh',['run','view',String(evidence.overlayRunId),'-R','ai-specs/kestra-overlay','--job',String(build.databaseId),'--log'])
      const images=[...logs.matchAll(/Candidate image: (ghcr\.io\/ai-specs\/kestra-overlay@sha256:[a-f0-9]{64})/g)].map(match=>match[1])
      assert(images.includes(report.inputs.image),'actual digest not emitted by selected successful host run')
      assert(Number.isSafeInteger(evidence.pluginArtifactId),'explicit plugin artifact ID required')
      const artifact=JSON.parse(command('gh',['api','repos/ai-specs/kestra-plugin-rbac/actions/artifacts/'+evidence.pluginArtifactId]))
      assert.equal(artifact.name,'kestra-rbac-authorizer');assert.equal(artifact.expired,false)
      assert.equal(artifact.workflow_run?.id,evidence.pluginRunId);assert.equal(artifact.workflow_run?.head_sha,report.inputs.pluginCommit)
      const artifacts=JSON.parse(command('gh',['api','repos/ai-specs/kestra-plugin-rbac/actions/runs/'+evidence.pluginRunId+'/artifacts?per_page=100']))
      assert.equal(artifacts.artifacts.filter(item=>item.name==='kestra-rbac-authorizer'&&!item.expired).length,1,'artifact name is ambiguous')
      assert(artifacts.artifacts.some(item=>item.id===evidence.pluginArtifactId),'artifact is not listed in selected run')
      let downloaded
      if(runtime.downloadedArtifact) {
        assert.equal(runtime.downloadedArtifact.runId,evidence.pluginRunId)
        assert.equal(runtime.downloadedArtifact.artifactId,evidence.pluginArtifactId)
        downloaded=realpathSync(runtime.downloadedArtifact.directory)
      } else {
        downloaded=join(output,'downloaded-plugin');mkdirSync(downloaded,{mode:0o700})
        command('gh',['run','download',String(evidence.pluginRunId),'-R','ai-specs/kestra-plugin-rbac','--name','kestra-rbac-authorizer','--dir',downloaded],{timeout:180000})
      }
      const jar=join(downloaded,'build/libs/kestra-rbac-authorizer.jar')
      for(const name of ['build/libs/kestra-rbac-authorizer.jar','.integration/host-provenance.json','.evidence','build/reports/tests/test','build/test-results/test'])assert(statSync(join(downloaded,name)),'downloaded artifact layout incomplete: '+name)
      assert(readdirSync(join(downloaded,'.evidence')).length,'hidden evidence omitted from artifact')
      assert(readdirSync(join(downloaded,'build/reports/tests/test')).length,'downloaded HTML test report is empty')
      const xmlFiles=readdirSync(join(downloaded,'build/test-results/test')).filter(name=>name.endsWith('.xml'))
      assert(xmlFiles.length,'downloaded XML test results are empty')
      const testResults=JSON.parse(command('python3',['-c',
        'import json,pathlib,sys,xml.etree.ElementTree as ET; result=[]\nfor path in pathlib.Path(sys.argv[1]).glob("*.xml"):\n root=ET.parse(path).getroot(); result.append({"file":path.name,**{key:int(root.attrib.get(key,0)) for key in ("tests","failures","errors","skipped")}})\nprint(json.dumps(result))',join(downloaded,'build/test-results/test')]))
      assert(testResults.every(suite=>suite.failures===0&&suite.errors===0),'downloaded plugin CI test report contains a failure')
      report.sources.plugin.downloadedTestResults=testResults

      assert.equal(hash(readFileSync(jar)),report.inputs.jarSha256,'downloaded jar differs from input SHA-256')
      const provenance=JSON.parse(readFileSync(join(downloaded,'.integration/host-provenance.json'),'utf8'))
      assert.equal(provenance.image,report.inputs.image,'downloaded host provenance image differs')
      assert(/^[a-f0-9]{64}$/.test(provenance.sha256),'host executable hash missing')
      const pin=git(report.sources.plugin.path,'show',report.inputs.pluginCommit+':host-contract.properties').match(/^overlay\.image=(.+)$/m)?.[1]
      assert.equal(pin,report.inputs.image,'plugin commit host-contract pin differs')
      command('docker',['buildx','imagetools','inspect',report.inputs.image])
      // The mounted file is the actual CI download, not the caller's copy.
      const mount=composeConfig.services.kestra.volumes.find(item=>item.target==='/app/libs/kestra-rbac-authorizer.jar');mount.source=jar;saveCompose()
      return {overlayRunId:evidence.overlayRunId,pluginRunId:evidence.pluginRunId,artifactId:artifact.id,downloadedJar:jar,jarSha256:report.inputs.jarSha256,hostExecutableSha256:provenance.sha256,promoted:true}
    })
    await stage('feature-off-production-install',async()=>{
      composeStarted=true;report.resources.startAttempted=true
      compose('pull','kestra')
      compose('up','-d');report.resources.containersCreated=true
      await waitForHost()
      const ids={}
      for(const name of ['postgres','kestra']) {
        ids[name]=compose('ps','-q',name);assert(/^[a-f0-9]{12,64}$/.test(ids[name]))
        assert.equal(command('docker',['inspect','-f','{{index .Config.Labels "com.docker.compose.project"}}',ids[name]]),project)
      }
      report.resources.containerIds=ids
      const imageId=command('docker',['inspect','-f','{{.Image}}',ids.kestra])
      const digests=JSON.parse(command('docker',['image','inspect','-f','{{json .RepoDigests}}',imageId]))
      assert(digests.includes(report.inputs.image),'running container image differs from published digest')
      const hostSha=command('docker',['exec',ids.kestra,'sha256sum','/app/kestra']).split(/\s+/)[0]
      assert.equal(hostSha,report.stages.find(row=>row.id==='publication-gate').evidence.hostExecutableSha256,'running host executable differs from downloaded plugin provenance')
      report.resources.runningImageId=imageId;report.resources.hostExecutableSha256=hostSha
      // Bootstrap environment creates only this isolated account. Production
      // OAuth login proves first installation registered a working UI client.
      const client=new ProductionOAuthClient(planned.base)
      const login=await client.login(planned.admin.username,planned.admin.password)
      const receipt=command('docker',['exec',ids.kestra,'cat','/app/storage/.oidc-installation'])
      const match=receipt.match(/^kestra-oidc-installation-v1\n([a-f0-9-]{36})$/i);assert(match,'own installation receipt format differs')
      planned.activation=directoryActivationPlan(planned,match[1])
      return {subject:planned.admin.subject,callbackPath:login.callbackPath,authenticated:login.authenticated,featureEnabled:false}
    })
    await stage('directory-preview-explicit-apply',async()=>{
      compose('stop','kestra')
      const planPath=writePlan('directory-plan.json',planned.activation)
      const text=cli('io.kestra.webserver.oidc.projects.ApplicationDirectoryCommand','preview',planPath)
      // Keep raw preview privately: it includes the own installation identity.
      writeFileSync(join(output,'directory-preview.txt'),text+'\n',{mode:0o600})
      const jsonLine=text.split('\n').find(line=>line.trim().startsWith('{')&&line.includes('"approvalHash"'))
      assert(jsonLine,'public CLI preview did not emit a JSON report')
      const preview=JSON.parse(jsonLine)
      assert.deepEqual(canonical(preview.plan),canonical(planned.activation));assert.deepEqual(preview.source,[])
      const approvalHash=hash(JSON.stringify(canonical(preview.plan)))
      assert.equal(preview.approvalHash,approvalHash,'CLI approval hash does not bind entire reviewed plan')
      // Explicitly pass the reviewed hash to apply; never mutate identity SQL.
      cli('io.kestra.webserver.oidc.projects.ApplicationDirectoryCommand','apply',planPath,approvalHash)
      return {planSha256:hash(JSON.stringify(planned.activation)),approvalHash,previewSourceProjects:0,applied:true}
    })
    await stage('schema2-public-cli-initialize',async()=>{
      const path=writePlan('local-policy.json',planned.policy)
      cli('io.kestra.extensions.rbac.store.ProjectPolicyCommand','validate',path)
      cli('io.kestra.extensions.rbac.store.ProjectPolicyCommand','initialize',path)
      return {schemaVersion:2,policySha256:hash(JSON.stringify(planned.policy)),operatorSubject:planned.admin.subject}
    })
    await stage('feature-on-restart-jvm',async()=>{
      const host=composeConfig.services.kestra
      let configuration=host.environment.KESTRA_CONFIGURATION
      configuration=applicationProjectFeature(configuration,true)
      host.environment.KESTRA_CONFIGURATION=configuration;saveCompose()
      compose('up','-d','kestra');await waitForHost()
      report.resources.containerIds.kestra=compose('ps','-q','kestra')
      const client=new ProductionOAuthClient(planned.base);const login=await client.login(planned.admin.username,planned.admin.password)
      const identity=await client.verifiedUiIdentity({projectId:'kestra',subject:planned.admin.subject,audience:planned.expectedAudience})
      assert(identity.projectScopes.includes(planned.observerScope))
      return {authenticated:login.authenticated,callbackPath:login.callbackPath,project:identity.project,subject:identity.subject,projectScopes:identity.projectScopes,authorizationVersion:identity.authorizationVersion}
    })
    let missingExtensionPromise
    const prepareMissingExtension=()=>missingExtensionPromise??=(prepareMissingExtensionOnce())
    const prepareMissingExtensionOnce=async()=>{
      const missingProject='application-projects-bb-'+(Date.now()+1)+'-'+process.pid
      assert.notEqual(missingProject,project)
      const missingPort=Number(options['--port']??18128)+1;assert(missingPort<65536)
      const missingBase='http://localhost:'+missingPort
      const missingPlan=planFixture(missingBase)
      const dir=join(output,'missing-extension');mkdirSync(dir,{mode:0o700})
      // A separate CLI-only service consumes the verified jar. The runtime
      // service never receives a classpath extension mount, even during setup.
      const config=missingExtensionTopology({sourceConfig:composeConfig,sourceBase:planned.base,base:missingBase,port:missingPort,directory:dir,planned:missingPlan})
      const host=config.services.kestra
      const file=join(dir,'compose.json')
      const save=()=>writeFileSync(file,JSON.stringify(config,null,2),{mode:0o600})
      const dc=(...args)=>command('docker',['compose','--env-file','/dev/null','-p',missingProject,'-f',file,...args],{env:composeEnvironment})
      const offline=(name,...args)=>dc('run','--rm','--no-deps','--user','0:0','--entrypoint','java','maintenance','-cp','/app/kestra:/app/libs/kestra-rbac-authorizer.jar',name,...args)
      const planFile=(name,value)=>{writeFileSync(join(dir,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});return '/work/'+name}
      save();dc('config','--quiet')
      additionalDeployments.push({project:missingProject,compose:dc})
      report.resources.missingExtension={composeProject:missingProject,base:missingBase,composeFile:file,containersCreated:false,image:report.inputs.image,cliJarSha256:report.inputs.jarSha256,finalJarMounted:false}
      await persist()
      dc('up','-d','postgres','kestra');report.resources.missingExtension.containersCreated=true
      const wait=async()=>{const until=Date.now()+180000;for(;;){try{const response=await fetch(missingBase+'/ping',{signal:AbortSignal.timeout(3000)});await response.body?.cancel();if(response.ok)return}catch{}assert(Date.now()<until,'missing-extension host startup timeout');await new Promise(resolve=>setTimeout(resolve,1000))}}
      await wait()
      const ids={postgres:dc('ps','-q','postgres'),kestra:dc('ps','-q','kestra')}
      for(const id of Object.values(ids))assert.equal(command('docker',['inspect','-f','{{index .Config.Labels "com.docker.compose.project"}}',id]),missingProject)
      const loginClient=new ProductionOAuthClient(missingBase);await loginClient.login(missingPlan.admin.username,missingPlan.admin.password)
      const seed=missingPlan.mcp.seeds.find(item=>item.id==='mcp-allowed')
      const seeded=await loginClient.request('/api/v1/main/flows',{method:'POST',headers:{'Content-Type':'application/x-yaml'},body:seed.source});assert(seeded.ok,'isolated feature-off missing-mode tool seed failed');await seeded.body?.cancel()
      const seededRead=await loginClient.request('/api/v1/main/flows/'+encodeURIComponent(seed.namespace)+'/'+encodeURIComponent(seed.id)+'?source=true');assert.equal(seededRead.status,200)
      const savedSeed=await seededRead.json();assert.equal(savedSeed.namespace,seed.namespace);assert.equal(savedSeed.id,seed.id)
      assert(savedSeed.source?.includes('mcpServer: default')&&savedSeed.triggers?.some(trigger=>trigger.type==='io.kestra.plugin.core.trigger.McpToolTrigger'&&trigger.toolName===seed.toolName&&(trigger.mcpServer??'default')==='default'),'missing-mode stored tool trigger differs')
      report.resources.missingExtension.seededFlow={namespace:seed.namespace,id:seed.id,toolName:seed.toolName,readBack:true}
      report.fragments.featureDisabled={checks:[{id:'feature-disabled-regression',passed:true,status:'passed',evidence:{base:missingBase,image:report.inputs.image,featureEnabled:false,productionLogin:true,write:{method:'POST',path:'/api/v1/main/flows',status:seeded.status,savedId:savedSeed.id,savedNamespace:savedSeed.namespace},readBack:true}}]};await persist()

      // DCR is a real public-client registration before directory activation.
      // Its identity can be approved by the FIRST public CLI plan, without SQL.
      const registered=await loginClient.request('/oidc/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({redirect_uris:['http://127.0.0.1:19997/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:'openid mcp:flows:read mcp:executions:write',client_name:'Isolated missing-extension acceptance'})})
      assert.equal(registered.status,201);const registration=await registered.json();assert(registration.client_id&&!registration.client_secret)
      assert.equal(registration.token_endpoint_auth_method,'none')
      assert.deepEqual(registration.redirect_uris,['http://127.0.0.1:19997/callback'])
      const registrationFile=join(dir,'registered-client.json')
      writeFileSync(registrationFile,JSON.stringify(registration,null,2)+'\n',{mode:0o600})
      report.resources.missingExtension.registration={status:registered.status,path:registrationFile,sha256:hash(JSON.stringify(registration)),clientId:registration.client_id,publicClient:true,callbackPath:'/callback'}

      const installation=command('docker',['exec',ids.kestra,'cat','/app/storage/.oidc-installation']).match(/^kestra-oidc-installation-v1\n([a-f0-9-]{36})$/i)?.[1];assert(installation)
      const activation=directoryActivationPlan(missingPlan,installation)
      activation.projects[0].memberships.push({projectId:'kestra',clientId:registration.client_id,approved:true,firstPartyUi:false,audiences:[missingBase+'/api/v1/main/mcp/default'],allowedProjectScopes:[scopeNames.writeB],revision:1})
      activation.projects[0].assignments[0].projectScopes.push(scopeNames.writeB)
      missingPlan.policy.applicationProjects.kestra.audiences.push(missingBase+'/api/v1/main/mcp/default')
      dc('stop','kestra')
      const path=planFile('directory-plan.json',activation)
      report.resources.missingExtension.activation={planPath:join(dir,'directory-plan.json'),planSha256:hash(JSON.stringify(activation)),clientId:registration.client_id,subject:missingPlan.admin.subject,projectScopes:[scopeNames.writeB]}
      const previewText=offline('io.kestra.webserver.oidc.projects.ApplicationDirectoryCommand','preview',path)
      writeFileSync(join(dir,'directory-preview.txt'),previewText+'\n',{mode:0o600})
      const preview=JSON.parse(previewText.split('\n').find(line=>line.trim().startsWith('{')&&line.includes('"approvalHash"'))??'null')
      assert.deepEqual(canonical(preview?.plan),canonical(activation));assert.deepEqual(preview.source,[])
      const approved=hash(JSON.stringify(canonical(activation)));assert.equal(preview.approvalHash,approved)
      report.resources.missingExtension.activation.approvalHash=approved
      offline('io.kestra.webserver.oidc.projects.ApplicationDirectoryCommand','apply',path,approved)
      const policy=planFile('local-policy.json',missingPlan.policy)
      offline('io.kestra.extensions.rbac.store.ProjectPolicyCommand','validate',policy)
      offline('io.kestra.extensions.rbac.store.ProjectPolicyCommand','initialize',policy)
      host.environment.KESTRA_CONFIGURATION=applicationProjectFeature(host.environment.KESTRA_CONFIGURATION,true);save()
      assert(!host.volumes.some(item=>item.target==='/app/libs/kestra-rbac-authorizer.jar'),'final missing mode must not mount the jar')
      dc('up','-d','kestra');await wait()
      const kestra=dc('ps','-q','kestra')
      command('docker',['exec',kestra,'test','!','-e','/app/libs/kestra-rbac-authorizer.jar'])
      const mounts=JSON.parse(command('docker',['inspect','-f','{{json .Mounts}}',kestra]))
      assert(!mounts.some(mount=>mount.Destination==='/app/libs'||mount.Destination.startsWith('/app/libs/')),'final missing service has a classpath extension mount')
      const imageId=command('docker',['inspect','-f','{{.Image}}',kestra])
      const digests=JSON.parse(command('docker',['image','inspect','-f','{{json .RepoDigests}}',imageId]))
      assert(digests.includes(report.inputs.image),'missing mode image differs from formal input')
      const executableSha=command('docker',['exec',kestra,'sha256sum','/app/kestra']).split(/\s+/)[0]
      assert.equal(executableSha,report.stages.find(row=>row.id==='publication-gate').evidence.hostExecutableSha256)
      const actualEnv=JSON.parse(command('docker',['inspect','-f','{{json .Config.Env}}',kestra]))
      const actualConfig=actualEnv.find(value=>value.startsWith('KESTRA_CONFIGURATION='))?.slice('KESTRA_CONFIGURATION='.length)
      assert(actualConfig);assert.equal(applicationProjectFeature(actualConfig,true),actualConfig,'missing mode must enable all three new-mode switches')
      report.resources.missingExtension.finalRuntime={containerId:kestra,imageId,image:report.inputs.image,hostExecutableSha256:executableSha,configurationSha256:hash(actualConfig),featureEnabled:true,jarAbsent:true,mounts:mounts.map(mount=>({type:mount.Type,destination:mount.Destination,readWrite:mount.RW}))}

      const observed=new ProjectSideEffects({postgresContainer:ids.postgres,kestraContainer:kestra,composeProject:missingProject})
      report.resources.missingExtension.finalFeatureEnabled=true
      report.resources.missingExtension.preRegisteredClientId=registration.client_id
      const deniedClient=new ProductionOAuthClient(missingBase);await deniedClient.login(missingPlan.admin.username,missingPlan.admin.password)
      const flowPath='/api/v1/main/flows/'+encodeURIComponent(seed.namespace)+'/'+encodeURIComponent(seed.id)
      const readDenied=await deniedClient.request(flowPath);assert.equal(readDenied.status,403);await readDenied.body?.cancel()
      const changedSource=seed.source.replace('Explicit MCP acceptance tool','Missing-extension denied explicit saved change')
      const deniedWrite=await observed.observeDenied(()=>deniedClient.request(flowPath,{method:'PUT',headers:{'Content-Type':'application/x-yaml'},body:changedSource}),async response=>{assert.equal(response.status,403);await response.body?.cancel()},{windowMs:5000,intervalMs:250})
      report.fragments.missingExtensionRest={readStatus:403,writeStatus:deniedWrite.response.status,sideEffects:deniedWrite.observation,image:report.inputs.image,jarAbsent:true}
      await persist()
      return {base:missingBase,account:missingPlan.admin,scenario:{...missingPlan.mcp.scenarios.allowed,expectedTools:[seed.toolName]},expectedUiAudience:'kestra-ui',effects:observed,denialErrors:[mcpProtocolEvidence.rpcDenial],denialToolCodes:[],denialToolResults:[mcpProtocolEvidence.toolDenial],
        registeredClient:registration,componentAbsence:report.resources.missingExtension.finalRuntime,componentFailureToolResult:mcpProtocolEvidence.missingProviderFailure,
        management:async()=>{throw new Error('Unexpected new DCR approval in pre-registered missing-extension mode; final service has no management extension')},
        databaseExecution:async()=>{throw new Error('Missing-extension tools must never create an execution')}}
    }
    let fixture
    await stage('public-accounts-and-real-rest-seeds',async()=>{
      const effects=new ProjectSideEffects({composeProject:project,postgresContainer:report.resources.containerIds.postgres,kestraContainer:report.resources.containerIds.kestra})
      fixture=await provisionFixture({planned,effects,observer:{postgresContainer:report.resources.containerIds.postgres,composeProject:project},record:async fragment=>{report.fragments.provisioning=fragment;await persist()}})
      fixture.runMigration=async(recordMigration,recordRecovery)=>{
        const module=await import('./application-project-migration-cases.mjs')
        let context
        if(options['--migration-releases']) {
          try {await stage('migration-independent-release-inputs',async()=>{
            const requested=JSON.parse(readFileSync(options['--migration-releases'],'utf8'))
            assert(requested.legacy?.host&&requested.legacy?.plugin,'explicit approved LEGACY host/plugin release descriptors required')
            const publication=report.stages.find(row=>row.id==='publication-gate').evidence
            const target={host:{image:report.inputs.image,commit:report.inputs.overlayCommit,runId:publication.overlayRunId},plugin:{commit:report.inputs.pluginCommit,sha256:report.inputs.jarSha256,runId:publication.pluginRunId,artifactId:publication.artifactId}}
            // The module independently checks both successful CI runs, promotion,
            // artifact IDs/download hashes and host-contract pins before create.
            context=await module.createMigrationContext({composeFile:join(repository,'docker-compose.yml'),port:Number(options['--port']??18128)+2,target,legacy:requested.legacy,downloadedArtifacts:{...runtime.migrationArtifacts,target:{runId:publication.pluginRunId,artifactId:publication.artifactId,directory:resolve(dirname(publication.downloadedJar),'../..')}}})
            report.resources.migrationDirectory=context.directory
            report.fragments.migrationOperations=context.operations
            return {target,legacy:requested.legacy,supportedChecks:context.supportedChecks,unsupportedChecks:context.unsupportedChecks}
          })}catch(error){report.fragments.migrationReleaseFailure={status:'failed',error:error.stdout!==undefined?'migration release command failed; inspect retained operation evidence':String(error.message)};await persist()}
        }
        await module.runApplicationProjectMigration(planned.base,context,recordMigration)
        await module.runMigrationStorageRecovery(context,recordRecovery)
        if(context?.operations){report.fragments.migrationOperations=context.operations;await persist()}
      }
      fixture.runSecurity=async recordSecurity=>{
        const module=await import('./application-project-security-cases.mjs')
        assert.equal(typeof module.runApplicationProjectSecurity,'function','published driver security module signature missing')
        assert(report.stages.some(row=>row.id==='publication-gate'&&row.status==='passed'),'security driver requires actual successful artifact gate')
        const secondary=await prepareMissingExtension()
        return module.runApplicationProjectSecurity(planned.base,{secondaryIssuer:{base:secondary.base,account:secondary.account},planned,management:fixture.management,effects,observer:{composeProject:project,postgresContainer:report.resources.containerIds.postgres,kestraContainer:report.resources.containerIds.kestra},release:{pluginPublished:true},effectsWindowMs:5000,revokeWindowMs:60000},recordSecurity)
      }
      fixture.prepareMissingExtension=prepareMissingExtension
      fixture.prepareUi=async completedFragments=>{
        const ui=await prepareApplicationProjectUi({base:planned.base,management:fixture.management,planned,completedFragments,isolation:{composeProject:project,kestraContainer:report.resources.containerIds.kestra,postgresContainer:report.resources.containerIds.postgres},record:async fragment=>{report.fragments.uiPreparation=fragment;await persist()}})
        const privatePath=join(output,'ui-fixture.private.json');writeFileSync(privatePath,JSON.stringify(ui,null,2)+'\n',{mode:0o600});report.resources.uiFixture=privatePath;await persist()
        Object.defineProperty(ui,'targetRuntime',{value:{management:fixture.management,planned,effects},enumerable:false})
        return ui
      }
      fixture.runUi=async(ui,record)=>{
        if(runtime.uiAdapter)return runPreparedApplicationProjectUi(runtime.uiAdapter,planned.base,ui,record)
        assert.equal(options['--browser'],'ci','prepared UI requires caller-owned runtime.uiAdapter or --browser ci; no browser space is created')
        const ci=await import('./application-project-browser-ci.cjs')
        const result=await ci.default.runApplicationProjectBrowserCi({base:planned.base,fixture:ui,inputs:report.inputs,nonFinal:report.nonFinal,deployment:{composeProject:project,postgresContainer:report.resources.containerIds.postgres,kestraContainer:report.resources.containerIds.kestra},reportDirectory:join(output,'browser'),record:async envelope=>{if(envelope.fragment)await record(envelope.fragment)}})
        assert(result.uiCompleted,'CI UI matrix incomplete');return result.fragment
      }
      return {seededFlows:report.fragments.provisioning.seededFlows,accounts:Object.keys(fixture.rest.accounts).length,observerSources:['database','queue','storage']}
    })
    await stage('shared-rest-mcp-ui-fragments',async()=>{
      if(runtime.inspectFixture){assert.equal(report.nonFinal,true,'fixture inspection is development only');await runtime.inspectFixture({base:planned.base,fixture,planned,report})}
      await runIntegration(report.resources.base,fixture,null,report,persist)
      assert.equal(report.fragments.rest?.completed,true,'REST matrix did not complete successfully')
      assert.equal(report.fragments.mcp?.completed,true,'MCP checks did not complete successfully; inspect preserved fragment')
      return {restRows:report.matrix.length,restCompleted:true,mcpCompleted:report.fragments.mcp?.completed??false,uiCompleted:report.fragments.ui?.completed??false}
    })
    if(report.nonFinal){report.development.outcome='implemented-checks-finished-non-final';await persist();return {exitCode:2,reportPath,nonFinal:true}}
    await stage('final-report-check',async()=>{
      for(const [name,expected]of Object.entries(report.executionSources))assert.equal(hash(readFileSync(join(repository,'scripts',name))),expected,'execution source changed during acceptance: '+name)
      for(const item of report.staticChecks)assert.equal(hash(readFileSync(join(repository,'scripts',item.file))),item.sha256,'shared assertion source changed during acceptance: '+item.file)
      for(const name of ['root','overlay','plugin']){assert.equal(git(report.sources[name].path,'rev-parse','HEAD'),report.inputs[name+'Commit'],'commit changed during acceptance: '+name);assert.equal(git(report.sources[name].path,'status','--porcelain','--untracked-files=normal'),'','source became dirty during acceptance: '+name)}
      assert.equal(report.nonFinal,false,'development reports cannot enter the final checker')
      assert.equal(report.notRun,0,'required MCP/UI/migration/fault checks still not_run')
      assert.equal(report.failures,0,'acceptance failures remain')
      for(const name of ['rest','security','migration','mcp','aggregates','ui'])assert.equal(report.fragments[name]?.completed,true,name+' fragment or restoration did not complete')
      assert([...report.matrix,...report.checks,...report.ui].every(row=>row.passed===true&&row.status==='passed'&&row.skipped===undefined),'required evidence must be actually passed')
      assert(report.stages.filter(row=>row.id!=='final-report-check').every(row=>row.status==='passed'))
      const candidate=join(output,'report-for-final-check.json')
      writeFileSync(candidate,JSON.stringify({...report,completed:true},null,2)+'\n',{mode:0o600})
      command('node',[join(repository,'scripts/check-application-project-report.mjs'),candidate,...['image','jarSha256','rootCommit','overlayCommit','pluginCommit'].map(name=>report.inputs[name])])
      return {requiredRowsPassed:true,checkerPassed:true}
    })
    return {exitCode:0,reportPath}
  } catch(error) {
    report.error=error.stdout!==undefined||error.stderr!==undefined?'process failed; see failed stage (credential output suppressed)':String(error.message)
    return {exitCode:1,reportPath}
  } finally {
    report.finishedAt=new Date().toISOString();await persist()
    const retained=runtime.retainOnFailure===true&&report.nonFinal&&report.failures>0
    if(retained){report.resources.retainedForDebug=true;report.resources.cleaned=false;await persist()}
    for(const deployment of retained?[]:additionalDeployments.reverse()) {
      try {
        for(const id of deployment.compose('ps','-a','-q').split('\n').filter(Boolean))assert.equal(command('docker',['inspect','-f','{{index .Config.Labels "com.docker.compose.project"}}',id]),deployment.project)
        deployment.compose('down','--volumes')
        if(report.resources.missingExtension)report.resources.missingExtension.cleaned=true
      }catch{report.stages.push({id:'cleanup-'+deployment.project,status:'failed',error:'own additional deployment cleanup failed'});process.exitCode=1}
    }
    if(composeStarted&&!retained) {
      try {
        // Only this fresh project's containers may be removed. No shared Docker
        // prune, no down of user's Compose project, no external volume cleanup.
        const ownIds=compose('ps','-a','-q').split('\n').filter(Boolean)
        if(ownIds.length)report.resources.containersCreated=true
        for(const id of ownIds)assert.equal(command('docker',['inspect','-f','{{index .Config.Labels "com.docker.compose.project"}}',id]),project)
        const host=compose('ps','-a','-q','kestra')
        if(host){const logs=spawnSync('docker',['logs',host],{encoding:'utf8',timeout:20000,maxBuffer:16*1024*1024});if(logs.status!==0)report.stages.push({id:'host-diagnostics',status:'failed',error:'owned host diagnostic collection failed'});else report.fragments.hostMcpDiagnostics=(logs.stdout+logs.stderr).split('\n').filter(line=>line.includes('MCP_TOOL_CALL_FAILED exception=')).map(line=>line.slice(line.indexOf('MCP_TOOL_CALL_FAILED exception=')))}
        compose('down','--volumes')
        report.resources.cleaned=true
      }catch(error){report.resources.cleaned=false;report.resources.cleanupError='own Compose cleanup failed';report.stages.push({id:'cleanup',status:'failed',error:'own Compose resources require inspection'});process.exitCode=1}
      await persist()
    }
    console.log(JSON.stringify({report:reportPath,completed:report.completed,failures:report.failures,notRun:report.notRun,containersCreated:report.resources.containersCreated}))
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try{const result=await main();process.exitCode=Math.max(process.exitCode??0,result.exitCode)}catch(error){console.error(String(error.message));process.exitCode=1}
}
