#!/usr/bin/env node
// Root CI entry. Requires the same shared UI cases as Ego; no reduced matrix.
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');

async function runApplicationProjectBrowserCi({base,fixture,inputs,nonFinal=false,deployment,reportDirectory,phase='full',record=async()=>{}}) {
  assert(['full','frozen'].includes(phase),'unknown browser acceptance phase');
  assert(path.isAbsolute(reportDirectory),'explicit absolute report directory required');
  await fs.mkdir(reportDirectory,{recursive:true,mode:0o700});
  const output=path.join(reportDirectory,'browser-report.json');
  let browser,context,adapter,runtime;
  const runtimeModule=await import(pathToFileURL(path.join(__dirname,'access-control-v3-browser-runtime.mjs')));
  const redactor=runtimeModule.browserRuntimeRedactor(fixture);
  const runtimeSecrets=[];
  const ui=await import(pathToFileURL(path.join(__dirname,'application-project-ui-fixture.mjs')));
  const initial=ui.initialApplicationProjectUiReport();
  const result={schemaVersion:1,completed:false,uiCompleted:false,nonFinal,inputs:inputs??null,ui:initial.ui,zeroGrant:initial.zeroGrant,stages:[]};
  const persist=async()=>{const safe=redactor.redact(result);await fs.writeFile(output+'.tmp',JSON.stringify(safe,null,2)+'\n',{mode:0o600});await fs.rename(output+'.tmp',output);await record(structuredClone(safe));};
  await persist();
  try {
    assert(/^ghcr\.io\/ai-specs\/kestra-overlay@sha256:[a-f0-9]{64}$/.test(inputs?.image??''),'explicit immutable image digest required');
    assert(/^[a-f0-9]{64}$/.test(inputs?.jarSha256??''),'explicit jar SHA-256 required');
    for(const name of ['rootCommit','overlayCommit','pluginCommit'])assert(/^[a-f0-9]{40}$/.test(inputs?.[name]??''),'explicit '+name+' required');
    assert(/^application-projects-bb-[0-9]+-[0-9]+$/.test(deployment?.composeProject??''),'own isolated Compose deployment required');
    assert.equal(new URL(base).origin,base);assert(['localhost','127.0.0.1'].includes(new URL(base).hostname));
    const inspect=(format,id)=>execFileSync('docker',['inspect','-f',format,id],{encoding:'utf8'}).trim();
    for(const name of ['postgresContainer','kestraContainer']){assert(/^[a-f0-9]{12,64}$/.test(deployment[name]??''));assert.equal(inspect('{{index .Config.Labels "com.docker.compose.project"}}',deployment[name]),deployment.composeProject);assert.equal(inspect('{{index .Config.Labels "owner"}}',deployment[name]),deployment.composeProject);}
    const ports=JSON.parse(inspect('{{json .NetworkSettings.Ports}}',deployment.kestraContainer));
    assert(ports['8080/tcp']?.some(binding=>binding.HostPort===new URL(base).port&&binding.HostIp==='127.0.0.1'),'browser base does not match owned loopback port');
    assert.equal(inspect('{{.Config.Image}}',deployment.kestraContainer),inputs.image,'browser deployment image differs');
    const jar=execFileSync('docker',['exec',deployment.kestraContainer,'sha256sum','/app/libs/kestra-rbac-authorizer.jar'],{encoding:'utf8'}).split(/\s+/)[0];assert.equal(jar,inputs.jarSha256);
    result.stages.push({id:'actual-compose-inputs',status:'passed'});await persist();
    const {createPlaywrightApplicationProjectAdapter}=await import(pathToFileURL(path.join(__dirname,'application-project-browser-adapters.mjs')));
    assert(fixture?.admin?.username&&fixture.admin.password&&fixture.admin.subject,'real production administrator required');
    if(phase==='full')assert(fixture?.zeroAccount?.username&&fixture.zeroAccount.password&&fixture.zeroAccount.subject,'real zero-authorization test account required');
    if(phase==='full')assert.equal(fixture.base,base,'prepared fixture base differs');
    if(phase==='full') {
      runtime=await runtimeModule.hydrateAccessControlBrowserRuntime({base,fixture,deployment,inputs,redactor,
        onSecret:secret=>{runtimeSecrets.push(secret);adapter?.redactSecrets([secret]);},
        record:async event=>{result.runtime??={events:[]};result.runtime.events.push(event);await persist();}});
      fixture=runtime.fixture;
      assert(fixture.targetRuntime,'full matrix requires real owned runtime controls');
      result.stages.push({id:'owned-browser-runtime',status:'passed'});await persist();
    }
    const {chromium}=require('playwright');
    browser=await chromium.launch({headless:true});context=await browser.newContext({locale:'en-US',viewport:{width:1440,height:1000}});
    const page=await context.newPage();
    adapter=await createPlaywrightApplicationProjectAdapter(page,{artifactDirectory:path.join(reportDirectory,'screenshots'),secrets:[fixture.admin.password,fixture.zeroAccount?.password,...runtimeSecrets].filter(Boolean)});
    const run=phase==='frozen'?ui.runPreparedFrozenBaselineUi:ui.runPreparedApplicationProjectUi;
    await run(adapter,base,fixture,async fragment=>{result.phase=phase;result.fragment=fragment;result.ui=fragment.ui??[];result.uiCompleted=fragment.completed;result.completed=fragment.completed&&!nonFinal;await persist();});
    assert.equal(result.uiCompleted,true,'browser matrix incomplete');
    return redactor.redact(result);
  } catch(error) {
    result.completed=false;result.uiCompleted=false;
    result.failure=redactor.redact(String(error.message));
    await persist();throw new Error(result.failure);
  } finally {
    const cleanup=[];
    for(const [name,close]of [['owned-runtime',()=>runtime?.close()],['adapter',()=>adapter?.dispose()],['context',()=>context?.close()],['browser',()=>browser?.close()]]){try{await close();}catch(error){cleanup.push({resource:name,error:String(error.name)});}}
    if(cleanup.length){result.completed=false;result.uiCompleted=false;result.cleanupFailures=cleanup;}
    await persist();if(cleanup.length)throw new Error('CI browser resource cleanup failed; inspect browser-report.json');
  }
}
module.exports={runApplicationProjectBrowserCi};
if(require.main===module){
  (async()=>{
    const [fixturePath,inputPath,directory]=process.argv.slice(2);
    if(!fixturePath||!inputPath||!directory)throw new Error('usage: application-project-browser-ci.cjs PRIVATE_FIXTURE_JSON ROOT_COMPOSITION_REPORT_JSON REPORT_DIRECTORY');
    assert(!path.resolve(fixturePath).split(path.sep).includes('deployment-backup'),'real deployment backups must not be read');
    assert.equal((await fs.stat(fixturePath)).mode&0o077,0,'private test credentials file must have mode 0600');
    const fixture=JSON.parse(await fs.readFile(fixturePath,'utf8'));const config=JSON.parse(await fs.readFile(inputPath,'utf8'));
    assert(config.stages?.some(stage=>stage.id==='publication-gate'&&stage.status==='passed'),'root publication gate must have succeeded before standalone browser invocation');
    const deployment={composeProject:config.resources?.composeProject,postgresContainer:config.resources?.containerIds?.postgres,kestraContainer:config.resources?.containerIds?.kestra};
    const result=await runApplicationProjectBrowserCi({base:fixture.base,fixture,inputs:config.inputs,nonFinal:config.nonFinal===true,deployment,reportDirectory:path.resolve(directory)});
    if(result.nonFinal)process.exitCode=2;
  })().catch(error=>{console.error(error.name+': browser acceptance failed; inspect retained browser-report.json');process.exitCode=1;});
}
