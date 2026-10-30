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
import {execFileSync,spawnSync,spawn} from 'node:child_process'
import {createHash,randomBytes} from 'node:crypto'
import {mkdtempSync,writeFileSync,renameSync,readFileSync,statSync,realpathSync,mkdirSync,readdirSync,appendFileSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname,resolve,join} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {prepareApplicationProjectUi,runPreparedApplicationProjectUi,planApplicationProjectUi} from './application-project-ui-fixture.mjs'
import {applicationProject,namespaceDomains,scopeNames} from './application-project-cases.mjs'
import {applicationProjectUiLocales,applicationProjectUiSupportedLocales} from './application-project-ui-cases.mjs'
import {checkPublishedTranslationSources} from './access-control-translation-coverage.mjs'
import {initialEvidence,runIntegration} from './application-project-integration-cases.mjs'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {ProjectSideEffects} from './application-project-effects.mjs'
import {planFixture,planRestResources,directoryActivationPlan,provisionFixture,fixtureGaps,applicationProjectFeature,mcpProtocolEvidence,missingExtensionTopology,ApplicationGroupManagement} from './application-project-fixture.mjs'
import {applicationPermissionRecords} from './application-project-policy.mjs'
import {runLoginClientMaintenance} from './access-control-v3-maintenance.mjs'
import {prepareFrozenBaseline,runPreparedFrozenBaselineUi} from './access-control-v3-frozen.mjs'
import {ownedPermissionDependencyControls} from './access-control-v3-dependency.mjs'
import {derive as deriveAccessControlGates,lifecycleXmlInputs,parseLifecycleJUnit} from './access-control-v3-gates.mjs'
import {runAccessControlV3Transactions} from './access-control-v3-transactions.mjs'
import {createOwnedAccessControlUiControls} from './access-control-v3-ui-controls.mjs'
import {assertApplicationGroupPluginEntries,assertApplicationGroupSchemaTables} from './application-group-artifact-contract.mjs'

/** Development can relax only root cleanliness, never independent release inputs. */
export function assertApplicationProjectSources(sources,{allowDirtyRoot=false}={}) {
  for(const name of ['root','overlay','plugin']) {
    assert(sources[name],'actual '+name+' source state required')
    assert(!sources[name].dirty||(name==='root'&&allowDirtyRoot),name+' source must be committed and clean'+(name==='root'?' (development may explicitly allow dirty root)':''))
  }
  return {nonFinal:allowDirtyRoot,finalEligible:!allowDirtyRoot}
}

export function applicationProjectFatalDiagnostics(text) {
  const lines=String(text??'').replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,'').split('\n')
  const index=lines.findIndex(line=>/fatal|shutting down|caught an exception/i.test(line))
  if(index<0)return []
  return lines.slice(Math.max(0,index-5),Math.max(0,index-5)+100).map(line=>/token|password|secret|cookie|authorization|Bearer|eyJ[A-Za-z0-9_-]+\.|[?&](?:state|code)=/i.test(line)?'[credential-bearing line redacted]':line)
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
  const legacyMigration=Boolean(options['--migration-releases'])
  const report={schemaVersion:1,completed:false,nonFinal:options['--allow-dirty-root']===true,development:{allowDirtyRoot:options['--allow-dirty-root']===true},mode,startedAt:new Date().toISOString(),inputs:{image:options['--image']??null,jarSha256:options['--sha256']??null,rootCommit:null,overlayCommit:null,pluginCommit:null},...initialEvidence({legacyMigration}),fragments:{},stages:[],failures:0,skipped:0,notRun:0,blockers:[...fixtureGaps],resources:{composeProject:project,containersCreated:false},staticChecks:[]}
  const reportPath=join(output,'report.json')
  let composeConfig,composeEnvironment,planned,preparedFrozen,composeStarted=false
  let verifyFinalReport
  let uiControls
  const finalOutcome={exitCode:0,reportPath}
  const additionalDeployments=[]
  const compose=(...args)=>command('docker',['compose','--env-file','/dev/null','-p',project,'-f',join(output,'compose.json'),...args],{env:composeEnvironment})
  const saveCompose=()=>writeFileSync(join(output,'compose.json'),JSON.stringify(composeConfig,null,2),{mode:0o600})
  const waitForHost=async()=>{
    const deadline=Date.now()+180000
    for(;;){try{const response=await fetch(report.resources.base+'/ping',{signal:AbortSignal.timeout(3000)});await response.body?.cancel();if(response.ok)return}catch{}assert(Date.now()<deadline,'host startup timeout');await new Promise(resolve=>setTimeout(resolve,1000))}
  }
  const canonical=value=>Array.isArray(value)?value.map(canonical).sort((left,right)=>JSON.stringify(left)<JSON.stringify(right)?-1:JSON.stringify(left)>JSON.stringify(right)?1:0):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value
  const canonicalPlan=value=>Array.isArray(value)?value.map(canonicalPlan):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalPlan(value[key])])):value
  const cli=(className,...args)=>compose('run','--rm','--no-deps','--user','0:0','--entrypoint','java','kestra','-cp','/app/kestra:/app/libs/kestra-rbac-authorizer.jar',className,...args)
  const writePlan=(name,value)=>{writeFileSync(join(output,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});return '/work/'+name}

  let persistence=Promise.resolve()
  const persist=()=>{
    const current=persistence.then(async()=>{
      const rows=[...report.matrix,...report.checks,...report.ui]
      report.notRun=rows.filter(row=>row.status==='not_run').length
      report.failures=rows.filter(row=>row.status==='failed').length+report.stages.filter(row=>row.status==='failed').length
      // Never infer acceptance from static checks or an empty fragment.
      report.completed=!report.nonFinal&&mode==='run'&&report.stages.some(row=>row.id==='final-report-check'&&row.status==='passed')&&report.notRun===0&&report.failures===0
      report.blockers=report.completed?[]:[...fixtureGaps,...(legacyMigration?['explicit legacy-migration profile requires its historical credential and physical rollback checks']:[])]
      writeFileSync(reportPath+'.tmp',JSON.stringify(report,null,2)+'\n',{mode:0o600});renameSync(reportPath+'.tmp',reportPath)
      if(runtime.onReport)await runtime.onReport({reportPath,report:structuredClone(report)})
    })
    persistence=current.catch(()=>{})
    return current
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
      report.executionSources=Object.fromEntries(['application-group-artifact-contract.mjs','blackbox-application-projects.sh','blackbox-application-projects.mjs','application-project-fixture.mjs','application-project-integration-cases.mjs','application-project-ui-fixture.mjs','application-project-browser-ci.cjs','application-project-migration-cases.mjs','application-project-security-cases.mjs','application-project-oauth-cases.mjs','application-project-aggregate-cases.mjs','application-project-target-ui.mjs'].map(name=>[name,hash(readFileSync(join(repository,'scripts',name)))]))
      for(const name of ['access-control-translation-coverage.mjs','check-access-control-prototype.py','access-control-v3-ui.mjs','access-control-v3-rest-cases.mjs','access-control-v3-maintenance.mjs','access-control-v3-frozen.mjs','access-control-v3-dependency.mjs','access-control-v3-gates.mjs','access-control-v3-transactions.mjs','access-control-v3-ui-controls.mjs','access-control-v3-browser-runtime.mjs','application-project-policy.mjs','application-project-browser-adapters.mjs','production-oauth-client.mjs'])report.executionSources[name]=hash(readFileSync(join(repository,'scripts',name)))
      return {actualPlatform:process.platform,node:process.version,commits:structuredClone(report.inputs)}
    })
    await stage('access-control-prototype',async()=>JSON.parse(command('python3',[join(repository,'scripts/check-access-control-prototype.py')])) )
    await stage('shared-module-interface',async()=>{
      for(const file of ['application-group-artifact-contract.mjs','application-project-cases.mjs','application-project-policy.mjs','application-project-effects.mjs','application-project-rest-cases.mjs','application-project-mcp-cases.mjs','application-project-ui-cases.mjs','application-project-browser-adapters.mjs','production-oauth-client.mjs','check-application-project-report.mjs','application-project-ui-fixture.mjs','application-project-browser-ci.cjs','application-project-security-cases.mjs','application-project-oauth-cases.mjs','application-project-migration-cases.mjs','application-project-aggregate-cases.mjs','application-project-target-ui.mjs']) {
        command('node',['--check',join(repository,'scripts',file)])
        report.staticChecks.push({file,sha256:hash(readFileSync(join(repository,'scripts',file))),syntax:true})
      }
      for(const file of ['access-control-v3-ui.mjs','access-control-v3-rest-cases.mjs','access-control-v3-maintenance.mjs','access-control-v3-frozen.mjs','access-control-v3-dependency.mjs','access-control-v3-gates.mjs','access-control-v3-transactions.mjs','access-control-v3-ui-controls.mjs','access-control-v3-browser-runtime.mjs']) {
        command('node',['--check',join(repository,'scripts',file)])
        report.staticChecks.push({file,sha256:hash(readFileSync(join(repository,'scripts',file))),syntax:true})
      }
      assert.equal(report.matrix.length,56,'shared REST matrix changed; review integration')
      assert.equal(report.ui.filter(row=>row.case==='theme-language').length,4*applicationProjectUiLocales.length,'full English/Chinese theme matrix required')
      const planned=planFixture('http://localhost:18128')
      const observerTriggers=planned.policy.applicationGroups[applicationProject].scopes[planned.observerScope].grants.filter(grant=>grant.resource==='TRIGGER')
      assert.deepEqual(observerTriggers,[namespaceDomains.a,namespaceDomains.b,namespaceDomains.outside,namespaceDomains.a+'2'].map(namespace=>({
        scope:'NAMESPACE',tenant:'main',namespace,descendants:true,resource:'TRIGGER',actions:['READ','LIST'],ids:[],allIds:true,
      })),'bootstrap observer requires bounded read-only native dashboard trigger queries')
      const resources=planRestResources(planned)
      assert.equal(Object.keys(resources.probes).length,56)
      assert.equal(Object.keys(planned.accounts).length,13)
      const ui=planApplicationProjectUi();for(const list of [ui.projects,ui.scopes,ui.clients,ui.users])assert(list.length>25)
      return {restRows:report.matrix.length,themeLanguageRows:report.ui.filter(row=>row.case==='theme-language').length,plannedBrowserRows:report.ui.length,requiredChecks:report.checks.length,testAccounts:Object.keys(planned.accounts).length,mcpScenarioAccounts:Object.keys(planned.mcpAccounts).length,mcpToolSeeds:planned.mcp.seeds.length,uiDataPlan:{projects:ui.projects.length,scopes:ui.scopes.length,clients:ui.clients.length,assignments:ui.users.length,explicitApplicationPolicies:Object.keys(ui.applicationPolicies).length,filtersRuntimeVerified:false},pendingSharedMcpScopes:Object.values(planned.mcp.revocationScopes).filter(scope=>!Object.values(scopeNames).includes(scope))}
    })
    if(mode==='static'){report.staticOnly=true;await persist();return {exitCode:0,reportPath}}
    await stage('artifact-inputs',async()=>{
      assert(/^ghcr\.io\/ai-specs\/kestra-overlay@sha256:[a-f0-9]{64}$/.test(report.inputs.image??''),'explicit immutable formal image digest required')
      assert(/^[a-f0-9]{64}$/.test(report.inputs.jarSha256??''),'explicit formal jar SHA-256 required')
      const jar=realpathSync(options['--jar']??'')
      assert(!jar.includes('/deployment-backup/'),'deployment-backup must not be test input')
      assert(statSync(jar).isFile()&&hash(readFileSync(jar))===report.inputs.jarSha256,'actual jar hash differs')
      const contract=assertApplicationGroupPluginEntries(command('jar',['tf',jar]).split('\n'))
      options.jar=jar;return {jarSha256:report.inputs.jarSha256,applicationGroupContract:contract}
    })
    await stage('translation-key-coverage',async()=>checkPublishedTranslationSources({pluginRoot:report.sources.plugin.path,pluginCommit:report.inputs.pluginCommit,jarSha256:report.inputs.jarSha256}))
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
      for(const service of Object.values(config.services)){delete service.container_name;delete service.build;assert(!service.network_mode&&!service.external_links);service.labels={...service.labels,owner:project}}
      for(const volume of Object.values(config.volumes??{})){delete volume.name;assert(!volume.external);volume.labels={...volume.labels,owner:project}}
      for(const network of Object.values(config.networks??{})){delete network.name;assert(!network.external);network.labels={...network.labels,owner:project}}
      const host=config.services.kestra
      host.image=report.inputs.image;host.ports=[{target:8080,published:String(port),host_ip:'127.0.0.1',protocol:'tcp'}]
      host.volumes=host.volumes.filter(item=>item.type==='volume')
      host.volumes.push({type:'bind',source:output,target:'/work',read_only:true})
      host.volumes.push({type:'bind',source:options.jar,target:'/app/libs/kestra-rbac-authorizer.jar',read_only:true})
      host.environment.KESTRA_CONFIGURATION=host.environment.KESTRA_CONFIGURATION.replaceAll('http://localhost:8080',base).replaceAll('url: '+base+'/oidc/token','url: http://localhost:8080/oidc/token').replaceAll('jwks-uri: '+base+'/oidc/jwks','jwks-uri: http://localhost:8080/oidc/jwks')
      host.environment.KESTRA_CONFIGURATION=applicationProjectFeature(host.environment.KESTRA_CONFIGURATION,false)
      assert(host.environment.KESTRA_CONFIGURATION.includes('kestra:\n'),'isolated host configuration root missing')
      host.environment.KESTRA_CONFIGURATION=host.environment.KESTRA_CONFIGURATION.replace('kestra:\n','kestra:\n  anonymous-usage-report:\n    enabled: false\n  ui-anonymous-usage-report:\n    enabled: false\n')
      // Keep queue evidence throughout the multi-hour browser matrix. The ordinary
      // cleaner still runs; extending test-data retention prevents an unrelated
      // scheduled deletion from invalidating a rejected-write before/after hash.
      // Never filter queue rows or relax equality to hide an enqueue side effect.
      Object.assign(host.environment,{KESTRA_JDBC_QUEUE_CLEANER_RETENTION:'24h'})
      Object.assign(host.environment,{KESTRA_OIDC_REGISTRATION_PENDING_TTL_MINUTES:'120',RBAC_POLICY_JDBC_URL:'jdbc:postgresql://postgres:5432/kestra',RBAC_POLICY_JDBC_USER:'kestra',RBAC_POLICY_JDBC_PASSWORD:env.POSTGRES_PASSWORD,RBAC_POLICY_OPERATOR_SUBJECT:planned.admin.subject})
      Object.assign(host.environment,{OIDC_MAINTENANCE_RECEIPT_PATH:'/app/storage/.oidc-installation',OIDC_MAINTENANCE_ISSUER:base,OIDC_MAINTENANCE_LOGIN_CLIENT_ID:'kestra-ui',OIDC_MAINTENANCE_JDBC_URL:'jdbc:postgresql://postgres:5432/kestra',OIDC_MAINTENANCE_JDBC_USER:'kestra',OIDC_MAINTENANCE_JDBC_PASSWORD:env.POSTGRES_PASSWORD})
      composeConfig=config;composeEnvironment=env
      const compose=join(output,'compose.json');saveCompose()
      command('docker',['compose','--env-file','/dev/null','-p',project,'-f',compose,'config','--quiet'],{env})
      report.resources.composeFile=compose;report.resources.base=base
      report.resources.queueEvidenceRetention={configuration:'kestra.jdbc.queue.cleaner.retention',value:'24h',scope:'isolated acceptance test data only',cleanerScheduleUnchanged:true,queueHashEqualityUnchanged:true}
      return {validated:true,project,loopbackPort:port,isolatedNamedVolumes:true,bindMounts:[{target:'/app/libs/kestra-rbac-authorizer.jar',readOnly:true}]}
    })
    if(mode==='config-check')return {exitCode:0,reportPath}
    await stage('publication-gate',async()=>{
      const evidence=JSON.parse(readFileSync(options['--release-evidence']??'','utf8'))
      const previouslyDownloadedHostArtifact=(name,metadata)=>{
        const cached=runtime.downloadedHostArtifacts?.[name]
        if(!cached)return null
        assert.equal(report.nonFinal,true,'Cached host report reuse is limited to explicit local qualification')
        assert.equal(cached.runId,evidence.overlayRunId);assert.equal(cached.artifactId,metadata.id);assert.equal(cached.commit,report.inputs.overlayCommit)
        const directory=realpathSync(cached.directory)
        assert(cached.files&&Object.keys(cached.files).length>0,'Previously downloaded host artifact requires frozen file hashes')
        for(const [name,expected]of Object.entries(cached.files)) {
          assert(!name.startsWith('/')&&!name.split('/').includes('..'),'Host artifact path escapes verified download')
          assert(/^[a-f0-9]{64}$/.test(expected));assert.equal(hash(readFileSync(join(directory,name))),expected,'Previously downloaded host report changed: '+name)
        }
        return directory
      }
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
      const sdkJobs=runs.overlay.jobs.filter(job=>job.name==='ui-sdk-blackbox')
      assert.equal(sdkJobs.length,1,'Final host SDK browser job missing or ambiguous')
      assert.equal(sdkJobs[0].status,'completed');assert.equal(sdkJobs[0].conclusion,'success')
      const sdkArtifactList=JSON.parse(command('gh',['api','repos/ai-specs/kestra-overlay/actions/runs/'+evidence.overlayRunId+'/artifacts?per_page=100']))
      const sdkArtifacts=sdkArtifactList.artifacts.filter(item=>item.name==='ui-sdk-browser'&&!item.expired)
      assert.equal(sdkArtifacts.length,1,'Final host SDK browser artifact missing or ambiguous')
      assert.equal(sdkArtifacts[0].workflow_run?.head_sha,report.inputs.overlayCommit)
      const sdkCached=previouslyDownloadedHostArtifact('ui-sdk-browser',sdkArtifacts[0])
      const sdkDirectory=sdkCached??join(output,'downloaded-host-sdk')
      if(!sdkCached){mkdirSync(sdkDirectory,{mode:0o700});command('gh',['run','download',String(evidence.overlayRunId),'-R','ai-specs/kestra-overlay','--name','ui-sdk-browser','--dir',sdkDirectory],{timeout:180000})}
      const sdkReportPath=join(sdkDirectory,'ui-sdk-browser.json'),sdkReportBytes=readFileSync(sdkReportPath),sdkReport=JSON.parse(sdkReportBytes)
      assert(sdkReport.completed&&sdkReport.passedGate&&sdkReport.driverPassed,'Downloaded final host SDK browser gate did not pass')
      assert.equal(sdkReport.expectedRows,949);assert.equal(sdkReport.passed,949);assert.equal(sdkReport.failures,0);assert.equal(sdkReport.notRun,0)
      assert.equal(sdkReport.candidateImage,report.inputs.image,'Downloaded SDK browser used a different candidate image')
      assert.equal(sdkReport.rows.length,949);assert.equal(new Set(sdkReport.rows.map(row=>row.id)).size,949)
      const sdkExpectedIds=['canonical-query-refresh','host-menu-dirty','keyboard-host-dirty','history-back-forward-dirty','concurrent-navigation','save-confinement','focus-tab-loop','maximize-reset','focus-fallback','dispose-pending-dirty','dispose-uncooperative-guard','public-safety-abort','unmount-open-popup'].map(name=>'behavior/'+name)
      for(const theme of ['light','dark','dark-2','system'])for(const locale of applicationProjectUiSupportedLocales)for(const width of [1280,768,390])for(const kind of ['drawer-0','drawer-1','drawer-2','drawer-3','native-filter','refresh-and-system'])sdkExpectedIds.push('preferences/'+theme+'/'+locale+'/'+width+'/'+kind)
      assert.deepEqual(sdkReport.rows.map(row=>row.id),sdkExpectedIds,'Downloaded host SDK case IDs or order differ from the complete required plan')
      assert(sdkReport.rows.every(row=>row.status==='passed'&&Array.isArray(row.diagnostics?.errorIds)&&row.diagnostics.errorIds.length===0),'Downloaded SDK browser rows are failed or incomplete')
      const sdkMatrixSha256=hash(readFileSync(join(report.sources.overlay.path,'scripts/rbac-ui-probe/sdk-browser-matrix.mjs')))
      assert.equal(sdkReport.matrixSha256,sdkMatrixSha256,'Downloaded browser matrix differs from the final host commit')
      const geometryPath=join(sdkDirectory,'filter-geometry.json'),geometryBytes=readFileSync(geometryPath),geometry=JSON.parse(geometryBytes)
      assert.equal(geometry.completed,true,'Final host native filter geometry gate did not complete')
      assert.equal(geometry.candidateImage,report.inputs.image,'Filter geometry used another image')
      assert.equal(geometry.build?.buildId,sdkReport.build?.buildId,'Geometry and SDK949 inputs differ')
      assert.equal(geometry.checks?.length,60,'Complete native filter geometry matrix required')
      assert(geometry.checks.every(row=>row.passed===true&&!row.error),'Native filter geometry has failed or missing checks')
      const geometryIds=geometry.checks.map(row=>row.theme+'/'+row.width+'/'+row.name)
      assert.equal(new Set(geometryIds).size,60,'Duplicate native geometry cases')
      for(const theme of ['light','dark','dark-2','system'])for(const width of [1280,390]) {
        const expected=['two-owned-native-filter-instances','native-condition-and-nested-select-escape','rules-pill-reopen-scroll-resize',...(width===1280?['direct-chip-and-add-filter-autoopen-retain-native-position']:[]),...(width===390?['mobile-bottom-anchor-flip','mobile-offscreen-anchor-clamp','mobile-boundary-reopen-resize']:[]),...(width===1280?['desktop-bottom-anchor-flip','desktop-offscreen-anchor-clamp','desktop-boundary-expand-reopen-resize']:[]),'dispose-cleans-owned-layers-and-listeners']
        assert.deepEqual(geometry.checks.filter(row=>row.theme===theme&&row.width===width).map(row=>row.name),expected,'Native geometry case coverage changed')
      }
      assert.equal(geometry.driverSha256,hash(readFileSync(join(report.sources.overlay.path,'scripts/blackbox-filter-geometry.cjs'))),'Downloaded geometry driver differs from final host source')
      for(const file of ['scripts/blackbox-filter-geometry.cjs','scripts/rbac-ui-probe/sdk-filter-geometry.js','scripts/rbac-ui-probe/sdk-filter-geometry.html']) {
        const hashes=Object.entries(geometry.sourceSha256??{}).filter(([path])=>path.endsWith('/'+file))
        assert.equal(hashes.length,1,'Geometry source hash missing or ambiguous: '+file)
        assert.equal(hashes[0][1],hash(readFileSync(join(report.sources.overlay.path,file))),'Downloaded geometry source differs from final host commit: '+file)
      }
      assert.equal(geometry.finalSourceHashesEqual,true,'Geometry sources changed during execution')
      assert.equal(geometry.finalInputHashesEqual,true,'Geometry frozen build changed during execution')
      assert(Array.isArray(geometry.diagnostics)&&geometry.diagnostics.length===8,'Native geometry diagnostic sources missing')
      assert(!geometry.diagnostics.flatMap(snapshot=>snapshot.events??[]).some(event=>['console-error','page-error','http-error','request-failed','diagnostic-integrity-error'].includes(event.kind)),'Native geometry has browser errors')
      report.sources.overlay.downloadedFilterGeometryGate={runId:evidence.overlayRunId,artifactId:sdkArtifacts[0].id,commit:report.inputs.overlayCommit,path:geometryPath,sha256:hash(geometryBytes),buildId:geometry.build.buildId,checks:60,image:geometry.candidateImage}
      report.sources.overlay.downloadedSdkBrowserGate={runId:evidence.overlayRunId,artifactId:sdkArtifacts[0].id,commit:report.inputs.overlayCommit,jobId:sdkJobs[0].databaseId,path:sdkReportPath,sha256:hash(sdkReportBytes),matrixSha256:sdkMatrixSha256,buildId:sdkReport.build?.buildId,passed:949,failures:0,notRun:0,image:sdkReport.candidateImage}
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
      const unitGate=command('python3',[join(report.sources.plugin.path,'scripts/check-application-project-tests.py'),join(downloaded,'.evidence/unit/results')])
      const postgresGate=command('python3',[join(report.sources.plugin.path,'scripts/check-policy-tests.py'),join(downloaded,'.evidence/postgres/results')])
      const upgradeGate=command('python3',[join(report.sources.plugin.path,'scripts/check-declaration-upgrade-tests.py'),join(downloaded,'.evidence/postgres/results')])
      const upgrade=JSON.parse(upgradeGate.trim().split('\n').at(-1))
      assert.equal(upgrade.profile,'declaration-upgrade');assert.equal(upgrade.backend,'PostgreSQL')
      assert(Number.isSafeInteger(upgrade.tests)&&upgrade.tests>0)
      for(const field of ['failures','errors','skipped'])assert.equal(upgrade[field],0)
      assert(Array.isArray(upgrade.requiredCases)&&upgrade.requiredCases.length>0)
      assert.equal(new Set(upgrade.requiredCases).size,upgrade.requiredCases.length)
      const lifecycleGate=JSON.parse(command('python3',[join(report.sources.plugin.path,'scripts/check-lifecycle-tests.py'),join(downloaded,'.evidence/lifecycle/results'),join(downloaded,'.integration/host-provenance.json')]))
      assert.equal(lifecycleGate.backend,'PostgreSQL');assert.equal(lifecycleGate.hostAdapter,'published-adapter-participant')
      assert.equal(lifecycleGate.hostImage,report.inputs.image)
      assert(Number.isSafeInteger(lifecycleGate.tests)&&lifecycleGate.tests>=lifecycleXmlInputs.pluginAccounts.length)
      assert(Number.isSafeInteger(lifecycleGate.additionalTests)&&lifecycleGate.additionalTests>0)
      for(const field of ['failures','errors','skipped'])assert.equal(lifecycleGate[field],0)
      report.sources.plugin.downloadedReportGates={unit:unitGate,postgres:postgresGate,declarationUpgrade:upgradeGate,lifecycle:lifecycleGate}
      report.gateEvidence??={}
      report.gateEvidence.lifecycleArtifacts=[]
      const hostArtifactList=JSON.parse(command('gh',['api','repos/ai-specs/kestra-overlay/actions/runs/'+evidence.overlayRunId+'/artifacts?per_page=100']))
      const hostArtifacts=hostArtifactList.artifacts.filter(item=>item.name==='host-scoped-tests'&&!item.expired)
      assert.equal(hostArtifacts.length,1,'Final host lifecycle report artifact missing or ambiguous')
      const hostArtifact=hostArtifacts[0]
      assert.equal(hostArtifact.workflow_run.head_sha,report.inputs.overlayCommit)
      const hostCached=previouslyDownloadedHostArtifact('host-scoped-tests',hostArtifact)
      const hostDirectory=hostCached??join(output,'downloaded-host-lifecycle')
      if(!hostCached){mkdirSync(hostDirectory,{mode:0o700});command('gh',['run','download',String(evidence.overlayRunId),'-R','ai-specs/kestra-overlay','--name','host-scoped-tests','--dir',hostDirectory],{timeout:180000})}
      for(const [repository,directory,artifactId,runId,workflow]of [
        ['overlay',join(hostDirectory,'test-results/test'),hostArtifact.id,evidence.overlayRunId,runs.overlay],
        ['plugin',join(downloaded,'.evidence/postgres/results'),evidence.pluginArtifactId,evidence.pluginRunId,runs.plugin],
      ]) {
        const requiredClasses=new Set(Object.entries(lifecycleXmlInputs).filter(([key])=>key.startsWith(repository==='overlay'?'host':'plugin')).flatMap(([,tests])=>tests.map(test=>test.classname)))
        for(const classname of requiredClasses) {
          const actualDirectory=repository==='plugin'&&classname==='io.kestra.extensions.rbac.applicationgroup.AccountLifecyclePostgresTest'?join(downloaded,'.evidence/lifecycle/results'):directory
          const path=join(actualDirectory,'TEST-'+classname+'.xml')
          const xml=readFileSync(path,'utf8')
          assert(!/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(xml),'Lifecycle XML contains a credential-shaped token; fix report generation before publishing')
          let backendEvidence
          if(repository==='plugin'&&classname==='io.kestra.extensions.rbac.store.ManagementAuditStoreTest') {
            const jobs=workflow.jobs.filter(job=>job.name==='build')
            assert.equal(jobs.length,1,'Exact final plugin PostgreSQL job missing or ambiguous')
            assert.equal(jobs[0].status,'completed');assert.equal(jobs[0].conclusion,'success')
            assert(Number.isSafeInteger(jobs[0].databaseId)&&jobs[0].databaseId>0,'Actual PostgreSQL job identity missing')
            const steps=jobs[0].steps.filter(step=>step.name==='Verify policy storage against PostgreSQL')
            assert.equal(steps.length,1,'Exact plugin PostgreSQL step missing or ambiguous')
            assert.equal(steps[0].status,'completed');assert.equal(steps[0].conclusion,'success')
            assert(Number.isSafeInteger(steps[0].number)&&steps[0].number>0,'Actual PostgreSQL step identity missing')
            backendEvidence={source:'plugin-check-postgres',jobName:jobs[0].name,jobId:jobs[0].databaseId,stepName:steps[0].name,stepNumber:steps[0].number,status:jobs[0].status,conclusion:jobs[0].conclusion,stepStatus:steps[0].status,stepConclusion:steps[0].conclusion,headSha:workflow.headSha,runId,artifactId,path,sha256:hash(xml)}
          }
          report.gateEvidence.lifecycleArtifacts.push({repository,commit:report.inputs[repository+'Commit'],downloaded:true,downloadedAt:new Date().toISOString(),path,runId,artifactId,workflow:{headSha:workflow.headSha,status:workflow.status,conclusion:workflow.conclusion},sha256:hash(xml),xml,backend:classname.endsWith('.TrustedIdentityBorrowedConnectionTest')?'unit':'PostgreSQL',...(backendEvidence?{backendEvidence}:{})})
        }
      }
      const upgradeCheck=report.checks.find(row=>row.id==='declaration-upgrade')
      assert(upgradeCheck,'Mandatory declaration-upgrade row missing')
      Object.assign(upgradeCheck,{passed:true,status:'passed',evidence:{source:'plugin-ci-postgres',runId:evidence.pluginRunId,artifactId:evidence.pluginArtifactId,commit:report.inputs.pluginCommit,...upgrade}})
      assert(readdirSync(join(downloaded,'build/reports/tests/test')).length,'downloaded HTML test report is empty')
      const xmlFiles=readdirSync(join(downloaded,'build/test-results/test')).filter(name=>name.endsWith('.xml'))
      assert(xmlFiles.length,'downloaded XML test results are empty')
      const testResults=JSON.parse(command('python3',['-c',
        'import json,pathlib,sys,xml.etree.ElementTree as ET; result=[]\nfor path in pathlib.Path(sys.argv[1]).glob("*.xml"):\n root=ET.parse(path).getroot(); result.append({"file":path.name,**{key:int(root.attrib.get(key,0)) for key in ("tests","failures","errors","skipped")}})\nprint(json.dumps(result))',join(downloaded,'build/test-results/test')]))
      assert(testResults.every(suite=>suite.failures===0&&suite.errors===0),'downloaded plugin CI test report contains a failure')
      report.sources.plugin.downloadedTestResults=testResults
      report.sources.plugin.downloadedTestResultsByPhase={}
      for(const phase of ['unit','postgres','lifecycle']) {
        const directory=join(downloaded,'.evidence',phase,'results')
        const suites=JSON.parse(command('python3',['-c',
          'import json,pathlib,sys,xml.etree.ElementTree as ET; result=[]\nfor path in pathlib.Path(sys.argv[1]).glob("*.xml"):\n root=ET.parse(path).getroot(); result.append({"file":path.name,**{key:int(root.attrib.get(key,0)) for key in ("tests","failures","errors","skipped")}})\nprint(json.dumps(result))',directory]))
        assert(suites.length>0,'Downloaded plugin phase has no XML: '+phase)
        assert(suites.reduce((total,suite)=>total+suite.tests,0)>0,'Downloaded plugin phase executed no tests: '+phase)
        assert(suites.every(suite=>suite.failures===0&&suite.errors===0&&suite.skipped===0),'Downloaded plugin phase has failed or skipped tests: '+phase)
        report.sources.plugin.downloadedTestResultsByPhase[phase]={runId:evidence.pluginRunId,artifactId:evidence.pluginArtifactId,commit:report.inputs.pluginCommit,path:directory,suites,totals:Object.fromEntries(['tests','failures','errors','skipped'].map(field=>[field,suites.reduce((total,suite)=>total+suite[field],0)]))}
      }
      const pluginUiPath=join(downloaded,'.evidence/ui/results.xml'),pluginUiXml=readFileSync(pluginUiPath,'utf8'),pluginUi=parseLifecycleJUnit(pluginUiXml)
      assert.equal(pluginUi.status,'passed','Downloaded plugin UI report contains failed or skipped tests')
      assert(pluginUi.cases.length>=175,'Downloaded plugin UI matrix omitted original and required filter/subject/tab/native drawer/delete focus/closed lifecycle regressions')
      for(const name of [
        'users: native Add condition creates rows and serializes supported AND filters with history recovery',
        'permissions: native Add condition creates rows and serializes supported AND filters with history recovery',
        'subjects: native Add condition creates rows and serializes supported AND filters with history recovery',
        'AND owner restores native attribute-only patches without mutation-observer loops',
        'AND owner accepts keyboard-style click without pointer activation on customize and rules-pill',
        'owned mobile shown=false hides only Saved/Save, survives attribute patches and restores on detach/dispose',
        'real mobile filter false configuration preserves All/field/Clear/Apply, locale change, and malformed sheet clear remount',
        'scope sidebar synchronizes deep links, selection and directory changes without overriding manual paging or search',
        'application sidebar synchronizes deep links, selection and directory changes without overriding manual paging or search',
        'App native query echo preserves advanced instance, focus and multiple conditions through full authorized reload',
        'App consecutive native queries supersede slow reads and host echo keeps latest URL and data',
        'App host acknowledgement ordering coalesces newer native query without reverting visible input or formal URL',
        'App rejected host query navigation releases acknowledgement and same-target real history reloads',
        'owned rejection delayed notification isolation: once',
        'owned rejection delayed notification isolation: dispose',
        'owned rejection delayed notification isolation: reset-new-generation',
        'published SDK mobile owned cleanup, two instances and repeated recovery: normal',
        'published SDK mobile owned cleanup, two instances and repeated recovery: other-modal',
        'published SDK mobile owned cleanup, two instances and repeated recovery: ambiguous-scrim',
        'public design-system styleBase side-effect entry survives production tree shaking and supplies native kel overlay rules',
        'App top navigation uses published box tabs and preserves real tab switching',
        'App group navigation uses published box tabs and preserves real tab switching',
        ...['revoked','partial','missing','disabled','invalid'].map(mode=>'App subject deep link revalidates '+mode+' without broadening rows'),
        ...['group','scope','application'].map(kind=>'App native box tab cancel and same-target retry preserves '+kind+' draft and controlled active'),
        'App native box tabs retain active and host URL during real editor save and one-time credential',
        'App slow subject query retains real credential-write and oneTime navigation locks',
        'native drawer owns title/header SVGs, footer/form association, body padding and reopen reset',
        'native drawer CSS leaves padding/header/width to published component and counts own explicit token gap',
        'actual native card buttons retain spaced accessible text, counts, destinations and unavailable/busy locks',
        'published shadow adapter keeps native header and footer in focus ring; Escape closes then restores trigger/fallback',
        'published native drawer dirty nested Escape keeps draft, saving rejects Escape/mask/close and submit',
        'public native forms translate real labels in all published locales and retain immutable permission key/account identity',
        'native clean mask closes; readonly and pending App save stay locked while native maximize remains presentation-only',
        'original public KsButton stays globally unwrapped and preserves public props/events including bare disabled',
        ...['selected','nonselected'].map(kind=>'successful real App scope deletion '+kind+' restores only the replacement fallback after slow reload and canonical navigation'),
        'cancel preserves the connected original trigger and does not delete, reload or jump to fallback',
        '412 keeps the original trigger/sidebar, rejects duplicate mutation, and cancel restores that trigger',
        'successful delete does not steal focus from an original trigger that remains connected',
        'successful DELETE followed by failed authorized reload does not target a missing or stale fallback',
        'canonical navigation failure after real deletion retains error focus rather than overriding it with fallback',
        'read-only and in-flight delete locks survive; revoked reload never restores unauthorized sidebar',
        'native focus lifecycle: closing retains the cycle kind marker and registration until native release, then public closed cleans up',
        'native focus lifecycle: stale public closed cannot clean a quickly reopened cycle or retain native maximize',
        'native focus lifecycle: async-disabled subject trigger is restored after Enter-style close and native release',
      ])assert.equal(pluginUi.cases.filter(test=>test.name===name&&test.status==='passed').length,1,'Required final plugin UI regression missing or ambiguous: '+name)
      report.sources.plugin.downloadedUiTests={runId:evidence.pluginRunId,artifactId:evidence.pluginArtifactId,commit:report.inputs.pluginCommit,path:pluginUiPath,sha256:hash(pluginUiXml),tests:pluginUi.cases.length,failures:0,errors:0,skipped:0,cases:pluginUi.cases}

      assert.equal(hash(readFileSync(jar)),report.inputs.jarSha256,'downloaded jar differs from input SHA-256')
      const provenance=JSON.parse(readFileSync(join(downloaded,'.integration/host-provenance.json'),'utf8'))
      assert.equal(provenance.image,report.inputs.image,'downloaded host provenance image differs')
      assert(/^[a-f0-9]{64}$/.test(provenance.sha256),'host executable hash missing')
      assert.equal(lifecycleGate.hostExecutableSha256,provenance.sha256,'Downloaded lifecycle evidence used another host executable')
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
        assert.equal(command('docker',['inspect','-f','{{index .Config.Labels "owner"}}',ids[name]]),project)
      }
      report.resources.containerIds=ids
      const imageId=command('docker',['inspect','-f','{{.Image}}',ids.kestra])
      const digests=JSON.parse(command('docker',['image','inspect','-f','{{json .RepoDigests}}',imageId]))
      assert(digests.includes(report.inputs.image),'running container image differs from published digest')
      const hostSha=command('docker',['exec',ids.kestra,'sha256sum','/app/kestra']).split(/\s+/)[0]
      assert.equal(hostSha,report.stages.find(row=>row.id==='publication-gate').evidence.hostExecutableSha256,'running host executable differs from downloaded plugin provenance')
      report.resources.runningImageId=imageId;report.resources.hostExecutableSha256=hostSha
      const runningEnvironment=JSON.parse(command('docker',['inspect','-f','{{json .Config.Env}}',ids.kestra]))
      assert(runningEnvironment.includes('KESTRA_JDBC_QUEUE_CLEANER_RETENTION=24h'),'long-running acceptance must preserve queue evidence for24h')
      assert(!runningEnvironment.some(value=>/^KESTRA_JDBC_QUEUE_CLEANER_(?:INITIAL_DELAY|FIXED_DELAY)=/.test(value)),'queue cleaner schedule must remain enabled and unchanged')
      report.resources.queueEvidenceRetention.actualContainerEnvironmentVerified=true
      report.gateEvidence??={}
      report.gateEvidence.runtimeSource={sourceRef:'stages.feature-off-production-install',...structuredClone(report.inputs)}
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
      const text=cli('io.kestra.extensions.rbac.store.ApplicationGroupDirectoryCommand','preview',planPath)
      // Keep raw preview privately: it includes the own installation identity.
      writeFileSync(join(output,'directory-preview.txt'),text+'\n',{mode:0o600})
      const jsonLine=text.split('\n').find(line=>line.trim().startsWith('{')&&line.includes('"approvalHash"'))
      assert(jsonLine,'public CLI preview did not emit a JSON report')
      const preview=JSON.parse(jsonLine)
      assert.deepEqual(canonicalPlan(preview.plan),canonicalPlan(planned.activation));assert.deepEqual(preview.source,[])
      const approvalHash=hash(JSON.stringify(canonicalPlan(preview.plan)))
      assert.equal(preview.approvalHash,approvalHash,'CLI approval hash does not bind entire reviewed plan')
      // Explicitly pass the reviewed hash to apply; never mutate identity SQL.
      cli('io.kestra.extensions.rbac.store.ApplicationGroupDirectoryCommand','apply',planPath,approvalHash)
      return {planSha256:hash(JSON.stringify(planned.activation)),approvalHash,previewSourceProjects:0,applied:true}
    })
    await stage('unified-permission-initialization',async()=>{
      assert.equal(planned.activation.formatVersion,2)
      const applications=planned.activation.applicationGroups[0].applications
      assert(applications.every(application=>!Object.hasOwn(application,'approved')&&!Object.hasOwn(application,'supportedScopeKeys')))
      const permissions=applications.flatMap(application=>application.permissions)
      assert.equal(permissions.length,planned.projectScopeCatalog.length)
      return {formatVersion:2,source:'directory-preview-explicit-apply',permissionPlanSha256:hash(JSON.stringify(permissions)),permissions:permissions.length,operatorSubject:planned.admin.subject,separatePolicyInitialization:false,separateDeclarationInitialization:false}
    })
    await stage('feature-on-restart-jvm',async()=>{
      const host=composeConfig.services.kestra
      let configuration=host.environment.KESTRA_CONFIGURATION
      configuration=applicationProjectFeature(configuration,true)
      host.environment.KESTRA_CONFIGURATION=configuration;saveCompose()
      compose('up','-d','kestra');await waitForHost()
      report.resources.containerIds.kestra=compose('ps','-q','kestra')
      const client=new ProductionOAuthClient(planned.base);const login=await client.login(planned.admin.username,planned.admin.password)
      const identity=await client.verifiedUiIdentity({applicationGroupId:'kestra',subject:planned.admin.subject,audience:planned.expectedAudience})
      assert(identity.applicationGroupScopes.includes(planned.observerScope))
      return {authenticated:login.authenticated,callbackPath:login.callbackPath,applicationGroupId:identity.applicationGroupId,subject:identity.subject,applicationGroupScopes:identity.applicationGroupScopes,authorizationVersion:identity.authorizationVersion}
    })
    await stage('new-install-storage-contract',async()=>{
      const postgres=report.resources.containerIds.postgres
      assert(/^[a-f0-9]{12,64}$/.test(postgres),'owned PostgreSQL container required')
      assert.equal(command('docker',['inspect','-f','{{index .Config.Labels "com.docker.compose.project"}}',postgres]),project,'storage inspection requires the owned Compose project')
      const tables=command('docker',['exec',postgres,'psql','-X','-U','kestra','-d','kestra','-v','ON_ERROR_STOP=1','-Atc',"SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' ORDER BY table_name"]).split('\n').filter(Boolean)
      return assertApplicationGroupSchemaTables(tables)
    })
    await stage('login-client-maintenance-lifecycle',async()=>{
      const host=composeConfig.services.kestra
      const result=await runLoginClientMaintenance({clientId:'kestra-ui',originalSecret:host.environment.KESTRA_OIDC_UI_CLIENT_SECRET,
        command:async(...args)=>{
          let output
          try {output=cli('io.kestra.webserver.oidc.cli.OidcClientCredentialsCommand',...args)}
          catch(error){
            const matches=String(error.stderr??'').split('\n').map(line=>line.trim()).filter(line=>/^Client credential maintenance failed: (INVALID|NOT_FOUND|CONFLICT|FORBIDDEN|UNAVAILABLE)$/.test(line))
            if(error.status===1&&matches.length===1)error.credentialFailure=matches[0].slice('Client credential maintenance failed: '.length)
            throw error
          }
          const line=output.split('\n').findLast(line=>line.startsWith('{'))
          assert(line,'Public maintenance CLI did not emit JSON')
          return JSON.parse(line)
        },
        stop:async()=>{compose('stop','kestra')},
        start:async secret=>{
          host.environment.KESTRA_OIDC_UI_CLIENT_SECRET=secret;saveCompose()
          compose('up','-d','kestra');await waitForHost()
          report.resources.containerIds.kestra=compose('ps','-q','kestra')
        },
        login:async({expectedInvalidConsumer=false}={})=>{
          try {return await new ProductionOAuthClient(planned.base).login(planned.admin.username,planned.admin.password)}
          catch(error){
            if(expectedInvalidConsumer&&error.code==='ERR_ASSERTION'&&error.actual===500&&error.message.startsWith('Production UI OAuth entry')) {
              const log=compose('logs','--no-color','kestra')
              const matches=[...log.matchAll(/Problem \[traceId=([A-Za-z0-9_-]+)\] GET \/oauth\/login\/kestra -> 500 internal-error: OIDC initialization configuration is invalid/g)]
              assert.equal(matches.length,1,'Old consumer configuration rejection must have one exact source-attributed host error')
              error.credentialFailure='CONFIGURED_CLIENT_MISMATCH'
              error.protocolRejection={source:'production-host-error-log',path:'/oauth/login/kestra',status:500,traceId:matches[0][1],reason:'OIDC initialization configuration is invalid'}
            }
            throw error
          }
        },
        record:async fragment=>{report.fragments.maintenance=fragment;report.gateEvidence??={};report.gateEvidence.maintenanceSourceRef='stages.login-client-maintenance-lifecycle';await persist()},
      })
      assert.equal(result.completed,true,'Login client maintenance or recovery failed; see retained step receipts')
      return result
    })
    await stage('frozen-baseline-production-preparation',async()=>{
      preparedFrozen=await prepareFrozenBaseline(planned,new ApplicationGroupManagement(planned.base,planned.admin),{record:async fragment=>{report.fragments.frozenPreparation=fragment;await persist()}})
      return preparedFrozen.evidence
    })
    await stage('frozen-baseline-real-browser',async()=>{
      const recordFrozen=async fragment=>{report.fragments.frozenUiBaseline=fragment;await persist()}
      if(runtime.uiAdapter)await runPreparedFrozenBaselineUi(runtime.uiAdapter,planned.base,preparedFrozen,recordFrozen)
      else {
        assert.equal(options['--browser'],'ci','Frozen baseline requires the same existing Ego adapter or CI browser')
        const ci=await import('./application-project-browser-ci.cjs')
        await ci.default.runApplicationProjectBrowserCi({phase:'frozen',base:planned.base,fixture:preparedFrozen,inputs:report.inputs,nonFinal:report.nonFinal,deployment:{composeProject:project,postgresContainer:report.resources.containerIds.postgres,kestraContainer:report.resources.containerIds.kestra},reportDirectory:join(output,'frozen-browser'),record:async envelope=>{if(envelope.fragment)await recordFrozen(envelope.fragment)}})
      }
      assert.equal(report.fragments.frozenUiBaseline?.completed,true,'Frozen browser baseline did not pass before boundary data')
      return report.fragments.frozenUiBaseline
    })
    await stage('account-lifecycle-transaction-composition',async()=>{
      // A local caller-owned Ego Page survives the frozen-baseline phase.
      // Unload its authenticated application before asserting an exclusive
      // two-request security-lock cohort. CI's frozen browser is already closed.
      let browserIsolation
      if(runtime.uiAdapter) {
        await runtime.uiAdapter.goto('about:blank')
        const actual=await runtime.uiAdapter.evaluate(()=>({url:location.href,ready:document.readyState}))
        assert.equal(actual.url,'about:blank');assert.equal(actual.ready,'complete')
        browserIsolation={source:'caller-owned-page-unloaded-before-exclusive-two-request-cohort',...actual}
      }else browserIsolation={source:'separate-frozen-ci-browser-already-closed'}
      const ids=report.resources.containerIds
      planned.transactionInputs={isolated:true,exclusiveWriters:true,profile:'new-install',sourceRef:'stages.publication-gate+resources.containerIds',imageDigest:report.inputs.image.split('@')[1],jarHash:report.inputs.jarSha256,bootstrapSubject:planned.admin.subject,effectsWindowMs:5000}
      const transactions=await runAccessControlV3Transactions({base:planned.base,planned,management:new ApplicationGroupManagement(planned.base,planned.admin),
        assertOwner:async()=>{
          for(const id of [ids.postgres,ids.kestra]) {
            assert.equal(command('docker',['inspect','-f','{{index .Config.Labels "owner"}}',id]),project)
            assert.equal(command('docker',['inspect','-f','{{index .Config.Labels "com.docker.compose.project"}}',id]),project)
          }
        },
        query:async sql=>command('docker',['exec',ids.postgres,'psql','-X','-U','kestra','-d','kestra','-v','ON_ERROR_STOP=1','-Atc',sql]),
        transactionObserver:{
          owner:{composeProject:project,postgresComposeProject:project,postgresContainer:ids.postgres,database:'kestra',isolated:true,exclusiveWriters:true},
          spawnPsql:async({owner,applicationName})=>{
            assert.equal(owner.composeProject,project);assert.equal(owner.postgresContainer,ids.postgres);assert.equal(owner.database,'kestra')
            assert(/^root_t6_barrier_[a-f0-9]{24}$/.test(applicationName))
            for(const id of [ids.postgres,ids.kestra])assert.equal(command('docker',['inspect','-f','{{index .Config.Labels "owner"}}',id]),project)
            return spawn('docker',['exec','-i','-e','PGAPPNAME='+applicationName,ids.postgres,'psql','-X','-q','-A','-t','-U','kestra','-d','kestra','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe'],shell:false})
          },
        },
        effects:new ProjectSideEffects({composeProject:project,postgresContainer:ids.postgres,kestraContainer:ids.kestra}),
        record:async fragment=>{report.gateEvidence??={};report.gateEvidence.transactions=fragment;await persist()},
      })
      assert.equal(transactions.completed,true,'Real account transaction composition did not complete safely')
      return {...transactions,browserIsolation}
    })
    let secondaryIssuerPromise,missingExtensionPromise
    const prepareSecondaryIssuer=()=>secondaryIssuerPromise??=(prepareSecondaryIssuerOnce())
    const prepareMissingExtension=()=>missingExtensionPromise??=prepareSecondaryIssuer().then(secondary=>secondary.makeMissing())
    const prepareSecondaryIssuerOnce=async()=>{
      const missingProject='application-projects-bb-'+(Date.now()+1)+'-'+process.pid
      assert.notEqual(missingProject,project)
      const missingPort=Number(options['--port']??18128)+1;assert(missingPort<65536)
      const missingBase='http://localhost:'+missingPort
      const missingPlan=planFixture(missingBase)
      const dir=join(output,'missing-extension');mkdirSync(dir,{mode:0o700})
      // The same second issuer first verifies cross-issuer rejection with the
      // published extension, then removes the jar for missing-component checks.
      const config=missingExtensionTopology({sourceConfig:composeConfig,sourceBase:planned.base,base:missingBase,port:missingPort,directory:dir,planned:missingPlan})
      const primaryPostgres=report.resources.containerIds.postgres
      const primaryNetworkNames=Object.keys(JSON.parse(command('docker',['inspect','-f','{{json .NetworkSettings.Networks}}',primaryPostgres])))
      assert.equal(primaryNetworkNames.length,1,'one owned primary PostgreSQL network required')
      const primaryNetwork=primaryNetworkNames[0]
      assert.equal(command('docker',['network','inspect','-f','{{index .Labels "com.docker.compose.project"}}',primaryNetwork]),project)
      const database='application_group_acceptance_'+Date.now()+'_'+process.pid
      assert(/^application_group_acceptance_[0-9]+_[0-9]+$/.test(database))
      command('docker',['exec',primaryPostgres,'psql','-X','-U','kestra','-d','postgres','-v','ON_ERROR_STOP=1','-c','CREATE DATABASE "'+database+'"'])
      delete config.services.postgres
      config.networks={default:{external:true,name:primaryNetwork}}
      for(const service of Object.values(config.services)) {
        service.labels={...service.labels,owner:missingProject}
        delete service.depends_on?.postgres
        service.environment.KESTRA_CONFIGURATION=service.environment.KESTRA_CONFIGURATION.replaceAll('jdbc:postgresql://postgres:5432/kestra','jdbc:postgresql://postgres:5432/'+database)
        assert.equal(service.environment.RBAC_POLICY_JDBC_URL,'jdbc:postgresql://postgres:5432/kestra')
        service.environment.RBAC_POLICY_JDBC_URL='jdbc:postgresql://postgres:5432/'+database
      }
      for(const volume of Object.values(config.volumes??{}))volume.labels={...volume.labels,owner:missingProject}
      const host=config.services.kestra
      const file=join(dir,'compose.json')
      const save=()=>writeFileSync(file,JSON.stringify(config,null,2),{mode:0o600})
      const dc=(...args)=>command('docker',['compose','--env-file','/dev/null','-p',missingProject,'-f',file,...args],{env:composeEnvironment})
      const offline=(name,...args)=>dc('run','--rm','--no-deps','--user','0:0','--entrypoint','java','maintenance','-cp','/app/kestra:/app/libs/kestra-rbac-authorizer.jar',name,...args)
      const planFile=(name,value)=>{writeFileSync(join(dir,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});return '/work/'+name}
      save();dc('config','--quiet')
      additionalDeployments.push({project:missingProject,compose:dc,base:missingBase,sharedPostgres:true})
      report.resources.missingExtension={composeProject:missingProject,base:missingBase,composeFile:file,containersCreated:false,image:report.inputs.image,cliJarSha256:report.inputs.jarSha256,finalJarMounted:null,postgresComposeProject:project,postgresContainer:primaryPostgres,primaryNetwork,database,sharedPostgres:true}
      await persist()
      dc('up','-d','kestra');report.resources.missingExtension.containersCreated=true
      const wait=async()=>{const until=Date.now()+180000;for(;;){try{const response=await fetch(missingBase+'/ping',{signal:AbortSignal.timeout(3000)});await response.body?.cancel();if(response.ok)return}catch{}assert(Date.now()<until,'missing-extension host startup timeout');await new Promise(resolve=>setTimeout(resolve,1000))}}
      await wait()
      const ids={postgres:primaryPostgres,kestra:dc('ps','-q','kestra')}
      assert.equal(command('docker',['inspect','-f','{{index .Config.Labels "com.docker.compose.project"}}',ids.postgres]),project)
      assert.equal(command('docker',['inspect','-f','{{index .Config.Labels "com.docker.compose.project"}}',ids.kestra]),missingProject)
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
      activation.applicationGroups[0].applications.push({clientId:registration.client_id,description:'Missing-extension acceptance client',audiences:[missingBase+'/api/v1/main/mcp/default'],permissions:applicationPermissionRecords(missingPlan,[scopeNames.writeB],{kestraPolicy:false}),revision:1})
      activation.applicationGroups[0].userGrants[0].scopeKeys.push(scopeNames.writeB)
      dc('stop','kestra')
      const path=planFile('directory-plan.json',activation)
      report.resources.missingExtension.activation={planPath:join(dir,'directory-plan.json'),planSha256:hash(JSON.stringify(activation)),clientId:registration.client_id,subject:missingPlan.admin.subject,applicationGroupScopes:[scopeNames.writeB]}
      const previewText=offline('io.kestra.extensions.rbac.store.ApplicationGroupDirectoryCommand','preview',path)
      writeFileSync(join(dir,'directory-preview.txt'),previewText+'\n',{mode:0o600})
      const preview=JSON.parse(previewText.split('\n').find(line=>line.trim().startsWith('{')&&line.includes('"approvalHash"'))??'null')
      assert.deepEqual(canonicalPlan(preview?.plan),canonicalPlan(activation));assert.deepEqual(preview.source,[])
      const approved=hash(JSON.stringify(canonicalPlan(activation)));assert.equal(preview.approvalHash,approved)
      report.resources.missingExtension.activation.approvalHash=approved
      offline('io.kestra.extensions.rbac.store.ApplicationGroupDirectoryCommand','apply',path,approved)
      const formalJar=composeConfig.services.kestra.volumes.find(item=>item.target==='/app/libs/kestra-rbac-authorizer.jar')?.source
      assert(formalJar,'published extension mount required for second-issuer identity test')
      host.volumes.push({type:'bind',source:formalJar,target:'/app/libs/kestra-rbac-authorizer.jar',read_only:true})
      host.environment.KESTRA_CONFIGURATION=applicationProjectFeature(host.environment.KESTRA_CONFIGURATION,true);save()
      dc('up','-d','kestra');await wait()
      const secondaryClient=new ProductionOAuthClient(missingBase)
      await secondaryClient.login(missingPlan.admin.username,missingPlan.admin.password)
      const secondaryIdentity=await secondaryClient.verifiedUiIdentity({applicationGroupId:applicationProject,subject:missingPlan.admin.subject,audience:'kestra-ui'})
      assert(secondaryIdentity.applicationGroupScopes.includes(scopeNames.writeB),'second issuer did not sign the shared test scope')
      report.resources.secondaryIssuer={base:missingBase,image:report.inputs.image,jarSha256:report.inputs.jarSha256,
        signedScope:scopeNames.writeB,subject:missingPlan.admin.subject,issuer:secondaryIdentity.issuer}
      await persist()
      return {base:missingBase,account:missingPlan.admin,makeMissing:async()=>{
      const issuedClient=new ProductionOAuthClient(missingBase)
      await issuedClient.login(missingPlan.admin.username,missingPlan.admin.password)
      const issuedScopes=[...missingPlan.mcp.scenarios.allowed.protocolScopes,scopeNames.writeB]
      await issuedClient.issueMcpScopes(issuedScopes,undefined,current=>current.login(missingPlan.admin.username,missingPlan.admin.password),{registeredClient:registration})
      const issuedIdentity=await issuedClient.verifiedAccessIdentity({applicationGroupId:applicationProject,subject:missingPlan.admin.subject,
        expectedApplicationGroupScopes:[scopeNames.writeB],expectedProtocolScopes:missingPlan.mcp.scenarios.allowed.protocolScopes})
      const initialized=await issuedClient.rpc(null,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'missing-provider-before-removal',version:'1'}},9801)
      assert.equal(initialized.status,200);assert(initialized.session&&initialized.message?.result)
      assert([200,202,204].includes((await issuedClient.rpc(initialized.session,'notifications/initialized')).status))
      const priorList=await issuedClient.rpc(initialized.session,'tools/list',{},9802)
      assert.equal(priorList.status,200);assert(priorList.message?.result?.tools?.some(tool=>tool.name===seed.toolName),'missing-provider baseline must expose actual allowed tool')
      dc('stop','kestra')
      host.volumes=host.volumes.filter(item=>item.target!=='/app/libs/kestra-rbac-authorizer.jar')
      save()
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

      const observed=new ProjectSideEffects({postgresContainer:ids.postgres,kestraContainer:kestra,composeProject:missingProject,postgresComposeProject:project,database})
      report.resources.missingExtension.finalFeatureEnabled=true
      report.resources.missingExtension.finalJarMounted=false
      report.resources.missingExtension.preRegisteredClientId=registration.client_id
      const deniedClient=new ProductionOAuthClient(missingBase);await deniedClient.login(missingPlan.admin.username,missingPlan.admin.password)
      const flowPath='/api/v1/main/flows/'+encodeURIComponent(seed.namespace)+'/'+encodeURIComponent(seed.id)
      const readDenied=await deniedClient.request(flowPath);assert.equal(readDenied.status,403);await readDenied.body?.cancel()
      const changedSource=seed.source.replace('Explicit MCP acceptance tool','Missing-extension denied explicit saved change')
      const deniedWrite=await observed.observeDenied(()=>deniedClient.request(flowPath,{method:'PUT',headers:{'Content-Type':'application/x-yaml'},body:changedSource}),async response=>{assert.equal(response.status,403);await response.body?.cancel()},{windowMs:5000,intervalMs:250})
      report.fragments.missingExtensionRest={readStatus:403,writeStatus:deniedWrite.response.status,sideEffects:deniedWrite.observation,image:report.inputs.image,jarAbsent:true}
      await issuedClient.login(missingPlan.admin.username,missingPlan.admin.password)
      const protocolState=()=>command('docker',['exec',primaryPostgres,'psql','-X','-U','kestra','-d',database,'-v','ON_ERROR_STOP=1','-Atc',
        "SELECT json_build_object('codes',(SELECT count(*) FROM oidc_authorization_code),'tokens',(SELECT count(*) FROM oidc_token))::text"])
      const protocolBefore=protocolState()
      const authorizationDenied=await issuedClient.expectMcpAuthorizationDenied(issuedScopes)
      assert.equal(protocolState(),protocolBefore,'missing projection authorization created a code or token')
      authorizationDenied.protocolStateUnchanged=true
      await persist()
      return {base:missingBase,account:missingPlan.admin,scenario:{...missingPlan.mcp.scenarios.allowed,applicationGroupScopes:[],expectedTools:[seed.toolName]},expectedUiAudience:'kestra-ui',effects:observed,denialErrors:[mcpProtocolEvidence.rpcDenial],denialToolCodes:[],denialToolResults:[mcpProtocolEvidence.toolDenial],
        registeredClient:registration,issuedClient,issuedIdentity,previousSession:initialized.session,authorizationDenied,
        componentAbsence:report.resources.missingExtension.finalRuntime,componentFailureToolResult:mcpProtocolEvidence.missingProviderFailure,
        management:async()=>{throw new Error('Unexpected new DCR approval in pre-registered missing-extension mode; final service has no management extension')},
        databaseExecution:async()=>{throw new Error('Missing-extension tools must never create an execution')}}
      }}
    }
    let fixture
    await stage('public-accounts-and-real-rest-seeds',async()=>{
      let effects=new ProjectSideEffects({composeProject:project,postgresContainer:report.resources.containerIds.postgres,kestraContainer:report.resources.containerIds.kestra})
      fixture=await provisionFixture({planned,effects,preparedAccounts:preparedFrozen.preparedAccounts,observer:{postgresContainer:report.resources.containerIds.postgres,composeProject:project},record:async fragment=>{report.fragments.provisioning=fragment;await persist()}})
      fixture.frozenUiBaseline=report.fragments.frozenUiBaseline
      if(legacyMigration)fixture.runMigration=async(recordMigration,recordRecovery)=>{
        await fixture.checkHostHealth('before-planned-migration-pause')
        const deployments=[{project,compose,base:planned.base},...additionalDeployments]
        const lifecycle={reason:'planned exclusive migration resource window',startedAt:new Date().toISOString(),deployments:[],restored:false}
        report.fragments.migrationLifecycle=lifecycle
        for(const deployment of deployments){
          const services=[]
          for(const service of deployment.sharedPostgres?['kestra']:['postgres','kestra']){
            const id=deployment.compose('ps','-aq',service)
            assert(id,'planned migration pause requires existing '+deployment.project+'/'+service)
            const inspected=JSON.parse(command('docker',['inspect',id]))[0]
            assert.equal(inspected.Config.Labels['com.docker.compose.project'],deployment.project,'planned pause ownership mismatch')
            const state=Object.fromEntries(['Status','Running','Restarting','Paused','OOMKilled','Dead'].map(key=>[key,inspected.State[key]]))
            services.push({service,id,state})
            assert.equal(state.Running,true,'planned pause refuses an already stopped '+deployment.project+'/'+service)
            assert.equal(state.Restarting,false,'planned pause refuses a restarting service')
            assert.equal(state.Paused,false,'planned pause refuses a paused service')
          }
          lifecycle.deployments.push({project:deployment.project,base:deployment.base,services,pauseRequested:false,restored:false})
        }
        await persist()
        let migrationError
        try {
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
        await fixture.checkHostHealth('immediately-before-planned-migration-pause')
        for(const [index,deployment]of deployments.entries()){
          const evidence=lifecycle.deployments[index]
          for(const service of evidence.services){
            const inspected=JSON.parse(command('docker',['inspect',service.id]))[0]
            assert.equal(inspected.State.Running,true,'service stopped during migration input preparation')
          }
          evidence.pauseRequested=true;await persist()
          deployment.compose('stop',...evidence.services.map(service=>service.service).reverse())
          evidence.pausedAt=new Date().toISOString();await persist()
        }
        await module.runApplicationProjectMigration(planned.base,context,recordMigration)
        await module.runMigrationStorageRecovery(context,recordRecovery)
        if(context?.operations){report.fragments.migrationOperations=context.operations;await persist()}
        } catch(error) {
          migrationError=error
          lifecycle.migrationError=error.stdout!==undefined?'migration command failed; see retained command evidence':String(error.message)
          throw error
        } finally {
          const restorationErrors=[]
          for(const [index,deployment]of deployments.entries()){
            const evidence=lifecycle.deployments[index]
            if(!evidence.pauseRequested)continue
            try {
              deployment.compose('up','-d',...evidence.services.map(service=>service.service))
              const deadline=Date.now()+180000
              for(;;){
                let healthy=false
                try{const response=await fetch(deployment.base+'/ping',{signal:AbortSignal.timeout(3000)});evidence.pingStatus=response.status;await response.body?.cancel();healthy=response.ok}catch{}
                if(healthy)break
                assert(Date.now()<deadline,'planned migration resume ping timeout for '+deployment.project)
                await new Promise(resolve=>setTimeout(resolve,1000))
              }
              for(const service of evidence.services){
                const id=deployment.compose('ps','-q',service.service)
                const inspected=JSON.parse(command('docker',['inspect',id]))[0]
                assert.equal(inspected.Config.Labels['com.docker.compose.project'],deployment.project)
                assert.equal(inspected.State.Running,true)
                assert.equal(inspected.State.Restarting,false)
                service.resumedId=id
              }
              evidence.restored=true;evidence.restoredAt=new Date().toISOString()
            }catch(error){evidence.restoreError=error.stdout!==undefined?'planned service restoration command failed':String(error.message);restorationErrors.push(deployment.project)}
            await persist()
          }
          lifecycle.finishedAt=new Date().toISOString();lifecycle.restored=restorationErrors.length===0;await persist()
          if(restorationErrors.length&&!migrationError)throw new Error('planned migration service restoration failed: '+restorationErrors.join(', '))
        }
      }
      fixture.runSecurity=async recordSecurity=>{
        const module=await import('./application-project-security-cases.mjs')
        assert.equal(typeof module.runApplicationProjectSecurity,'function','published driver security module signature missing')
        assert(report.stages.some(row=>row.id==='publication-gate'&&row.status==='passed'),'security driver requires actual successful artifact gate')
        const secondary=await prepareSecondaryIssuer()
        const security=await module.runApplicationProjectSecurity(planned.base,{secondaryIssuer:{base:secondary.base,account:secondary.account},planned,management:fixture.management,effects,observer:{composeProject:project,postgresContainer:report.resources.containerIds.postgres,kestraContainer:report.resources.containerIds.kestra},release:{pluginPublished:true},effectsWindowMs:5000,revokeWindowMs:60000},recordSecurity)
        const dependencyFaultInjected=security.checks.some(row=>row.evidence?.steps?.some(step=>step.name==='fault-injected'))
        if(dependencyFaultInjected) {
          assert.equal(command('docker',['exec',report.resources.containerIds.postgres,'psql','-X','-U','kestra','-d','kestra','-v','ON_ERROR_STOP=1','-Atc',"SELECT to_regclass('public.rbac_application_group_state') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relname LIKE 'security_fault_%')"]),'t','faulted storage must be fully restored before JVM recovery')
          const recovery={reason:'restart isolated JVM after dependency fault injection and verify allowed read',startedAt:new Date().toISOString(),checks:[],restarted:false}
          report.fragments.securityHostRecovery=recovery;await persist()
          const current=compose('ps','-aq','kestra')
          const host=JSON.parse(command('docker',['inspect',current]))[0]
          assert.equal(host.Config.Labels['com.docker.compose.project'],project,'recovery container is not owned by this Compose')
          assert.equal(host.Config.Image,report.inputs.image,'recovery source image differs from the published input')
          recovery.oldContainerId=current
          recovery.before={running:host.State.Running,exitCode:host.State.ExitCode,startedAt:host.State.StartedAt}
          if(host.State.Running)compose('restart','kestra')
          else {
            const logs=command('docker',['logs',current])
            const expectedFault=logs.includes('[FlowInterface] fatal error while consuming messages')
              && logs.includes('canceling statement due to user request')
            recovery.checks.push({at:new Date().toISOString(),oldContainerId:current,exitCode:host.State.ExitCode,expectedFault,logSha256:hash(logs)})
            assert(expectedFault && host.State.ExitCode===0,'unexpected host exit after fault injection')
            compose('up','-d','kestra')
          }
          await waitForHost()
          const resumed=compose('ps','-q','kestra')
          const inspected=JSON.parse(command('docker',['inspect',resumed]))[0]
          assert.equal(inspected.Config.Labels['com.docker.compose.project'],project)
          assert.equal(inspected.Config.Image,report.inputs.image)
          assert.equal(inspected.State.Running,true)
          assert.notEqual(inspected.State.StartedAt,host.State.StartedAt,'isolated JVM did not restart after fault injection')
          report.resources.containerIds.kestra=resumed
          effects=new ProjectSideEffects({composeProject:project,postgresContainer:report.resources.containerIds.postgres,kestraContainer:resumed})
          fixture.setEffects(effects)
          recovery.restarted=true;recovery.resumedContainerId=resumed
          recovery.resumedAt=inspected.State.StartedAt;await persist()
          const verified=new ProductionOAuthClient(planned.base)
          await verified.login(planned.admin.username,planned.admin.password)
          const response=await verified.request('/api/v1/main/flows/'+encodeURIComponent(namespaceDomains.b)+'/allowed-id?source=true')
          assert.equal(response.status,200,'host did not restore allowed business read after fault injection')
          await response.body?.cancel()
          recovery.allowedReadStatus=response.status;recovery.finishedAt=new Date().toISOString();await persist()
        }
        return security
      }
      fixture.prepareMissingExtension=prepareMissingExtension
      fixture.cleanupAuxiliaryDeployments=async()=>{
        for(const deployment of additionalDeployments) {
          if(deployment.cleaned)continue
          for(const id of deployment.compose('ps','-a','-q').split('\n').filter(Boolean)) {
            assert.equal(command('docker',['inspect','-f','{{index .Config.Labels "com.docker.compose.project"}}',id]),deployment.project)
            assert.equal(command('docker',['inspect','-f','{{index .Config.Labels "owner"}}',id]),deployment.project)
          }
          deployment.compose('down','--volumes');deployment.cleaned=true
        }
        if(report.resources.missingExtension) {
          const auxiliary=report.resources.missingExtension
          assert(/^application_group_acceptance_[0-9]+_[0-9]+$/.test(auxiliary.database))
          assert.equal(command('docker',['inspect','-f','{{index .Config.Labels "owner"}}',auxiliary.postgresContainer]),project)
          command('docker',['exec',auxiliary.postgresContainer,'psql','-X','-U','kestra','-d','postgres','-v','ON_ERROR_STOP=1','-c','DROP DATABASE "'+auxiliary.database+'"'])
          auxiliary.cleaned=true;auxiliary.databaseCleaned=true
        }
        await persist()
      }
      fixture.checkHostHealth=async stage=>{
        const host=JSON.parse(command('docker',['inspect',report.resources.containerIds.kestra]))[0]
        const state={stage,observedAt:new Date().toISOString(),id:host.Id,project:host.Config.Labels['com.docker.compose.project'],image:host.Config.Image,state:Object.fromEntries(['Status','Running','Paused','Restarting','OOMKilled','Dead','Pid','ExitCode','StartedAt','FinishedAt'].map(key=>[key,host.State[key]])),ports:host.NetworkSettings.Ports,restartCount:host.RestartCount}
        report.fragments.hostHealth??=[];report.fragments.hostHealth.push(state);await persist()
        assert.equal(state.project,project,'main host project changed at '+stage)
        assert.equal(state.image,report.inputs.image,'main host image changed at '+stage)
        assert.equal(state.state.Running,true,'main host stopped at '+stage+'; inspect hostHealth evidence')
        assert.equal(state.state.Restarting,false,'main host restarting at '+stage)
        assert(state.ports['8080/tcp']?.some(binding=>binding.HostIp==='127.0.0.1'&&binding.HostPort===new URL(planned.base).port),'main host port changed at '+stage)
        const response=await fetch(planned.base+'/ping',{signal:AbortSignal.timeout(5000)})
        state.pingStatus=response.status;await response.body?.cancel();await persist()
        assert.equal(response.ok,true,'main host ping failed at '+stage)
      }
      fixture.prepareUi=async completedFragments=>{
        const clientId='acceptance-confidential-'+randomBytes(8).toString('hex')
        const redirectUri='http://127.0.0.1:19996/callback'
        const registrationPath=writePlan('confidential-registration.json',{clientId,ownerSubject:planned.admin.subject,redirectUris:[redirectUri],grantTypes:['authorization_code','refresh_token'],protocolScopes:['openid']})
        const registrationOutput=cli('io.kestra.webserver.oidc.cli.OidcClientCredentialsCommand','register-confidential',registrationPath)
        const issued=JSON.parse(registrationOutput.split('\n').findLast(line=>line.startsWith('{')))
        assert.equal(issued.status.clientId,clientId)
        assert(typeof issued.clientSecret==='string'&&issued.clientSecret.length>=32)
        let currentSecret=issued.clientSecret
        issued.clientSecret=undefined
        await fixture.management.login()
        const group=await fixture.management.request(fixture.management.groupPath(applicationProject))
        await fixture.management.mutateDirectory(fixture.management.groupPath(applicationProject)+'/applications','POST',{clientId,description:'Ordinary confidential credential acceptance',audiences:[]},group.revision)
        const ui=await prepareApplicationProjectUi({base:planned.base,management:fixture.management,planned,completedFragments,isolation:{composeProject:project,kestraContainer:report.resources.containerIds.kestra,postgresContainer:report.resources.containerIds.postgres},record:async fragment=>{report.fragments.uiPreparation=fragment;await persist()}})
        const credentialControls={clientId,verifySecret:async({clientId:requestedClient,newSecret})=>{
          assert.equal(requestedClient,clientId)
          const client=new ProductionOAuthClient(planned.base)
          await client.login(planned.admin.username,planned.admin.password)
          const result=await client.verifyConfidentialRotation({clientId,redirectUri,oldSecret:currentSecret,newSecret})
          currentSecret=newSecret
          return result
        }}
        report.fragments.confidentialClientPreparation={clientId,registeredThrough:'published-host-maintenance-cli',credentialRevision:issued.status.credentialRevision,resourceAudiences:[],applicationScopes:[]}
        const dependencyControls=ownedPermissionDependencyControls({origin:planned.base,applicationGroupId:applicationProject,
          assertOwner:async()=>{
            const id=report.resources.containerIds.postgres
            assert.equal(command('docker',['inspect','-f','{{index .Config.Labels "owner"}}',id]),project)
            assert.equal(command('docker',['inspect','-f','{{index .Config.Labels "com.docker.compose.project"}}',id]),project)
          },
          query:async sql=>command('docker',['exec',report.resources.containerIds.postgres,'psql','-X','-U','kestra','-d','kestra','-v','ON_ERROR_STOP=1','-Atc',sql]),
        })
        const privatePath=join(output,'ui-fixture.private.json');writeFileSync(privatePath,JSON.stringify(ui,null,2)+'\n',{mode:0o600});report.resources.uiFixture=privatePath;await persist()
        const uiOwner={composeProject:project,postgresComposeProject:project,postgresContainer:report.resources.containerIds.postgres,database:'kestra',isolated:true,exclusiveWriters:true}
        const assertUiOwner=async owner=>{
          assert.deepEqual(owner,uiOwner,'UI control owner changed')
          for(const id of [owner.postgresContainer,report.resources.containerIds.kestra]) {
            assert.equal(command('docker',['inspect','-f','{{index .Config.Labels "owner"}}',id]),project)
            assert.equal(command('docker',['inspect','-f','{{index .Config.Labels "com.docker.compose.project"}}',id]),project)
          }
        }
        uiControls=createOwnedAccessControlUiControls({origin:planned.base,applicationGroupId:applicationProject,owner:uiOwner,management:fixture.management,
          sourceRef:'stages.public-accounts-and-real-rest-seeds.owned-ui-controls',assertOwner:assertUiOwner,
          query:async sql=>{await assertUiOwner(uiOwner);return command('docker',['exec',uiOwner.postgresContainer,'psql','-X','-q','-A','-t','-U','kestra','-d',uiOwner.database,'-v','ON_ERROR_STOP=1','-c',sql])},
          spawnPsql:async({owner,applicationName})=>{
            await assertUiOwner(owner)
            assert(/^root_ui_barrier_[a-f0-9]{24}$/.test(applicationName))
            return spawn('docker',['exec','-i','-e','PGAPPNAME='+applicationName,owner.postgresContainer,'psql','-X','-q','-A','-t','-U','kestra','-d',owner.database,'-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe'],shell:false})
          },record:async event=>{report.fragments.uiControls??={events:[]};report.fragments.uiControls.events.push(event);await persist()},
        })
        report.fragments.uiAuditCapability=uiControls.auditCapability
        Object.defineProperty(ui,'targetRuntime',{value:{management:fixture.management,planned,effects,credentialControls,dependencyControls,uiWriteBarrier:uiControls.uiWriteBarrier,userAuditEvidence:uiControls.userAuditEvidence},enumerable:false})
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
    verifyFinalReport=()=>stage('final-report-check',async()=>{
      for(const [name,expected]of Object.entries(report.executionSources))assert.equal(hash(readFileSync(join(repository,'scripts',name))),expected,'execution source changed during acceptance: '+name)
      for(const item of report.staticChecks)assert.equal(hash(readFileSync(join(repository,'scripts',item.file))),item.sha256,'shared assertion source changed during acceptance: '+item.file)
      for(const name of ['root','overlay','plugin']){assert.equal(git(report.sources[name].path,'rev-parse','HEAD'),report.inputs[name+'Commit'],'commit changed during acceptance: '+name);assert.equal(git(report.sources[name].path,'status','--porcelain','--untracked-files=normal'),'','source became dirty during acceptance: '+name)}
      assert.equal(report.nonFinal,false,'development reports cannot enter the final checker')
      assert.equal(report.notRun,0,'required MCP/UI/migration/fault checks still not_run')
      assert.equal(report.failures,0,'acceptance failures remain')
      for(const name of ['rest','security',...(legacyMigration?['migration']:[]),'mcp','aggregates','ui'])assert.equal(report.fragments[name]?.completed,true,name+' fragment or restoration did not complete')
      assert([...report.matrix,...report.checks,...report.ui].every(row=>row.passed===true&&row.status==='passed'&&row.skipped===undefined),'required evidence must be actually passed')
      assert(report.stages.filter(row=>row.id!=='final-report-check').every(row=>row.status==='passed'))
      const candidate=join(output,'report-for-final-check.json')
      writeFileSync(candidate,JSON.stringify({...report,completed:true,blockers:[]},null,2)+'\n',{mode:0o600})
      command('node',[join(repository,'scripts/check-application-project-report.mjs'),candidate,...['image','jarSha256','rootCommit','overlayCommit','pluginCommit'].map(name=>report.inputs[name])])
      return {requiredRowsPassed:true,checkerPassed:true}
    })
    return finalOutcome
  } catch(error) {
    report.error=error.stdout!==undefined||error.stderr!==undefined?'process failed; see failed stage (credential output suppressed)':String(error.message)
    return {exitCode:1,reportPath}
  } finally {
    if(uiControls) {
      try {await uiControls.close()}
      catch {report.stages.push({id:'cleanup-ui-controls',status:'failed',error:'Owned UI control connection cleanup failed'});finalOutcome.exitCode=1;process.exitCode=1}
    }
    report.finishedAt=new Date().toISOString();await persist()
    const retained=runtime.retainOnFailure===true&&report.nonFinal&&report.failures>0
    if(retained){report.resources.retainedForDebug=true;report.resources.cleaned=false;await persist()}
    for(const deployment of retained?[]:additionalDeployments.filter(deployment=>!deployment.cleaned).reverse()) {
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
        for(const id of ownIds) {
          assert.equal(command('docker',['inspect','-f','{{index .Config.Labels "com.docker.compose.project"}}',id]),project)
          assert.equal(command('docker',['inspect','-f','{{index .Config.Labels "owner"}}',id]),project)
        }
        const host=compose('ps','-a','-q','kestra')
        if(host){report.fragments.hostRuntimeState=JSON.parse(command('docker',['inspect','-f','{{json .State}}',host]));const logs=spawnSync('docker',['logs',host],{encoding:'utf8',timeout:20000,maxBuffer:16*1024*1024});if(logs.status!==0)report.stages.push({id:'host-diagnostics',status:'failed',error:'owned host diagnostic collection failed'});else report.fragments.hostMcpDiagnostics=(logs.stdout+logs.stderr).split('\n').filter(line=>line.includes('MCP_TOOL_CALL_FAILED exception=')).map(line=>line.slice(line.indexOf('MCP_TOOL_CALL_FAILED exception=')))}
        if(host){const diagnostic=spawnSync('docker',['logs',host],{encoding:'utf8',timeout:20000,maxBuffer:16*1024*1024});report.fragments.hostFatalDiagnostics=applicationProjectFatalDiagnostics(diagnostic.stdout+diagnostic.stderr);report.fragments.hostExitDiagnostics=(diagnostic.stdout+diagnostic.stderr).replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted-jwt]').split('\n').slice(-200).filter(line=>/shutdown|shutting|stopping|stopped|fatal|outofmemory|exception|error|signal/i.test(line))}
        compose('down','--volumes')
        report.resources.cleaned=true
      }catch(error){report.resources.cleaned=false;report.resources.cleanupError='own Compose cleanup failed';report.stages.push({id:'cleanup',status:'failed',error:'own Compose resources require inspection'});process.exitCode=1}
      await persist()
    }
    if(composeStarted) {
      report.gateEvidence??={}
      try {
        const remainingContainers=command('docker',['ps','-a','--filter','label=owner='+project,'-q']).split('\n').filter(Boolean).length
        const remainingNetworks=command('docker',['network','ls','--filter','label=owner='+project,'-q']).split('\n').filter(Boolean).length
        const remainingVolumes=command('docker',['volume','ls','--filter','label=owner='+project,'-q']).split('\n').filter(Boolean).length
        report.resources.cleanupInventory={owner:project,ownerVerified:true,containers:remainingContainers,networks:remainingNetworks,volumes:remainingVolumes}
        report.resources.cleaned=report.resources.cleaned===true&&remainingContainers===0&&remainingNetworks===0&&remainingVolumes===0
        report.gateEvidence.cleanup={checks:[
          {id:'owned-containers-cleaned',sourceRef:'finally.owner-container-inventory',passed:remainingContainers===0&&report.resources.cleaned===true,status:remainingContainers===0&&report.resources.cleaned===true?'passed':'failed',evidence:{ownerVerified:true,remaining:remainingContainers}},
          {id:'owned-networks-cleaned',sourceRef:'finally.owner-network-inventory',passed:remainingNetworks===0&&report.resources.cleaned===true,status:remainingNetworks===0&&report.resources.cleaned===true?'passed':'failed',evidence:{ownerVerified:true,remaining:remainingNetworks}},
          {id:'owned-auxiliary-databases-cleaned',sourceRef:'resources.missingExtension.databaseCleaned',passed:report.resources.missingExtension?.databaseCleaned===true,status:report.resources.missingExtension?.databaseCleaned===true?'passed':'not_run',evidence:{ownerVerified:true,remaining:report.resources.missingExtension?.databaseCleaned===true?0:1}},
        ]}
        for(const gate of deriveAccessControlGates(report)) {
          const index=report.checks.findIndex(row=>row.id===gate.id)
          assert(index>=0,'Mandatory access-control gate was not initialized')
          report.checks[index]=gate
        }
        await persist()
      } catch(error) {
        report.resources.cleaned=false
        report.resources.cleanupError='Owned resource inventory or final gate derivation failed'
        report.stages.push({id:'cleanup-inventory',status:'failed',error:'Owned resource inventory or final gate derivation failed'})
        finalOutcome.exitCode=1
        process.exitCode=1
        await persist()
      }
    }
    if(verifyFinalReport) {
      try {await verifyFinalReport()}
      catch(error){finalOutcome.exitCode=1;report.error=error.stdout!==undefined||error.stderr!==undefined?'Final report validation failed; credential-bearing process output suppressed':String(error.message)}
    }
    report.finishedAt=new Date().toISOString();await persist()
    console.log(JSON.stringify({report:reportPath,completed:report.completed,failures:report.failures,notRun:report.notRun,containersCreated:report.resources.containersCreated}))
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try{const result=await main();process.exitCode=Math.max(process.exitCode??0,result.exitCode)}catch(error){console.error(String(error.message));process.exitCode=1}
}
