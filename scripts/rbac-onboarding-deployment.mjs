import assert from 'node:assert/strict'
import {copyFileSync,mkdirSync,readFileSync,writeFileSync,chmodSync} from 'node:fs'
import {createHash,randomBytes} from 'node:crypto'
import {createRequire} from 'node:module'
import {join} from 'node:path'
import {createPlaywrightApplicationProjectAdapter} from './application-project-browser-adapters.mjs'
import {runRbacOnboardingBrowser} from './rbac-onboarding-browser.mjs'
import {applicationProjectFeature} from './application-project-fixture.mjs'

export async function runRbacOnboardingDeployment({configuration,compose,saveConfiguration,command,output,project,base,inputs,formalJar,uiAdapter,scenario='missing-jar',record}) {
  assert(['missing-jar','normal'].includes(scenario))
  assert(/^application-projects-bb-[0-9]+-[0-9]+$/.test(project))
  assert.equal(new URL(base).origin,base)
  assert.equal(createHash('sha256').update(readFileSync(formalJar)).digest('hex'),inputs.jarSha256)
  const originalHost=structuredClone(configuration.services.kestra)
  assert(Array.isArray(originalHost.volumes)&&originalHost.volumes.filter(volume=>volume.target==='/app/storage').length===1,
    'Explicit original storage mount required for isolated first installation')
  const database='application_group_acceptance_'+Date.now()+'_'+process.pid
  const directory=join(output,scenario==='normal'?'onboarding-normal':'onboarding'),libs=join(directory,'libs')
  const storage=scenario==='normal'?'onboarding-normal-data':'onboarding-data'
  mkdirSync(libs,{recursive:true,mode:0o755})
  chmodSync(libs,0o755)
  const placeJar=()=>{
    const destination=join(libs,'kestra-rbac-authorizer.jar')
    copyFileSync(formalJar,destination)
    chmodSync(destination,0o644)
  }
  if(scenario==='normal')placeJar()
  const reportPath=join(directory,'report.json')
  const account={username:'onboarding-'+randomBytes(6).toString('hex'),password:randomBytes(24).toString('base64url')+'Aa1!'}
  let postgresContainer,hostContainer,browser,context,adapter
  const inspect=(format,id)=>command('docker',['inspect','-f',format,id])
  const assertOwner=async()=>{
    for(const id of [postgresContainer,hostContainer]) {
      assert(/^[a-f0-9]{12,64}$/.test(id??''))
      assert.equal(inspect('{{index .Config.Labels "owner"}}',id),project)
      assert.equal(inspect('{{index .Config.Labels "com.docker.compose.project"}}',id),project)
    }
    assert.equal(inspect('{{.Config.Image}}',hostContainer),inputs.image)
    const databases=JSON.parse(command('docker',['exec',postgresContainer,'psql','-X','-q','-A','-t','-U','kestra','-d',database,
      '-v','ON_ERROR_STOP=1','-c',"SELECT json_build_object('database',current_database(),'user',current_user)"]))
    assert.equal(databases.database,database);assert.equal(databases.user,'kestra')
    const ports=JSON.parse(inspect('{{json .NetworkSettings.Ports}}',hostContainer))
    assert(ports['8080/tcp']?.some(port=>port.HostPort===new URL(base).port&&port.HostIp==='127.0.0.1'))
  }
  const query=sql=>command('docker',['exec',postgresContainer,'psql','-X','-q','-A','-t','-U','kestra','-d',database,'-v','ON_ERROR_STOP=1','-c',sql])
  const readGroup=async()=>{
    await assertOwner()
    const result=JSON.parse(query("SELECT json_build_object('description',document_json::jsonb->'group'->>'description','revision',revision) FROM rbac_application_group_state WHERE group_id='main'"))
    assert.equal(typeof result.description,'string');assert(Number.isSafeInteger(result.revision)&&result.revision>0)
    return result
  }
  const installationState=async()=>{
    await assertOwner()
    const present=query("SELECT to_regclass('public.rbac_application_group_state') IS NOT NULL")==='t'
    const pluginTables=JSON.parse(query("SELECT coalesce(json_agg(table_name ORDER BY table_name),'[]'::json) FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'rbac\\_%' ESCAPE '\\'"))
    const counts=JSON.parse(query("SELECT json_build_object('accounts',(SELECT count(*) FROM oidc_user),'installations',(SELECT count(*) FROM oidc_setup),'groups',"+(present?'(SELECT count(*) FROM rbac_application_group_state)':'0')+
      ",'clients',(SELECT count(*) FROM oidc_client),'credentials',(SELECT count(*) FROM oidc_user_auth_method))"))
    counts.pluginTables=pluginTables
    if(counts.groups===0)return counts
    assert.equal(counts.groups,1)
    const group=JSON.parse(query("SELECT json_build_object('builtInGroupId',bootstrap.builtin_group_id,'catalogRevision',bootstrap.catalog_revision,'subjects',(SELECT jsonb_agg(grant_value->>'subject' ORDER BY grant_value->>'subject') FROM jsonb_array_elements(state.document_json::jsonb->'userGrants') grant_value),'scopeKeys',(SELECT jsonb_agg(scope_value->>'key' ORDER BY scope_value->>'key') FROM jsonb_array_elements(state.document_json::jsonb->'scopes') scope_value)) FROM rbac_application_group_bootstrap bootstrap JOIN rbac_application_group_state state ON state.group_id=bootstrap.builtin_group_id"))
    return {...counts,...group}
  }
  async function waitForHost() {
    const deadline=Date.now()+180000
    while(Date.now()<deadline) {
      try {
        const response=await fetch(base+'/ping',{signal:AbortSignal.timeout(3000)})
        await response.body?.cancel()
        if(response.ok)return
      } catch {}
      await new Promise(resolve=>setTimeout(resolve,1000))
    }
    throw new Error('Automatic first-install host did not start within deadline')
  }
  const persist=async report=>{
    writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{mode:0o600})
    await record(report)
  }
  try {
    compose('up','-d','postgres')
    postgresContainer=compose('ps','-q','postgres')
    assert.equal(inspect('{{index .Config.Labels "owner"}}',postgresContainer),project)
    const deadline=Date.now()+60000
    for(;;) {
      try {
        if(command('docker',['exec',postgresContainer,'sh','-c','PGPASSWORD="$POSTGRES_PASSWORD" psql -X -h 127.0.0.1 -U kestra -d kestra -Atc "SELECT 1"'])==='1')break
      } catch {}
      assert(Date.now()<deadline,'Shared PostgreSQL readiness deadline exceeded')
      await new Promise(resolve=>setTimeout(resolve,1000))
    }
    command('docker',['exec',postgresContainer,'psql','-X','-U','kestra','-d','kestra','-v','ON_ERROR_STOP=1','-c','CREATE DATABASE '+database+' OWNER kestra'])
    const host=configuration.services.kestra
    const standardConfiguration=applicationProjectFeature(originalHost.environment.KESTRA_CONFIGURATION,false)
    const rbacStart=standardConfiguration.indexOf('  rbac:'),rbacEnd=standardConfiguration.indexOf('  oidc:',rbacStart)
    assert(rbacStart>=0&&rbacEnd>rbacStart)
    const rbac=standardConfiguration.slice(rbacStart,rbacEnd).replace(/^(\s+enabled: )false$/gm,'$1true')
    host.environment.KESTRA_CONFIGURATION=(standardConfiguration.slice(0,rbacStart)+rbac+standardConfiguration.slice(rbacEnd))
      .replaceAll('jdbc:postgresql://postgres:5432/kestra','jdbc:postgresql://postgres:5432/'+database)
    assert(host.environment.KESTRA_CONFIGURATION.includes('jdbc:postgresql://postgres:5432/'+database))
    assert(!host.environment.KESTRA_CONFIGURATION.includes('kestra:application-group-scopes'),
      'First-install acceptance must prove the host adds the UI selector without hidden operator configuration')
    for(const name of ['USERNAME','PASSWORD','NAME','EMAIL'])host.environment['KESTRA_OIDC_BOOTSTRAP_'+name]=''
    host.environment.KESTRA_OIDC_SETUP_ALLOWED='true'
    host.volumes=host.volumes.filter(volume=>volume.target!=='/app/libs/kestra-rbac-authorizer.jar'&&volume.target!=='/app/storage')
    host.volumes.push({type:'volume',source:storage,target:'/app/storage'},
      {type:'bind',source:libs,target:'/app/libs',read_only:true})
    configuration.volumes[storage]={labels:{owner:project}}
    await saveConfiguration()
    compose('up','-d','kestra')
    hostContainer=compose('ps','-q','kestra')
    await assertOwner();await waitForHost()
    const controls={assertOwner,installationState,readGroup,
      initialRuntime:async()=>{
        await assertOwner()
        return {restartCount:Number(inspect('{{.RestartCount}}',hostContainer)),
          jarSha256:command('docker',['exec',hostContainer,'sha256sum','/app/libs/kestra-rbac-authorizer.jar']).split(/\s+/)[0]}
      },
      deliverFormalJar:async()=>{
        await assertOwner()
        placeJar()
        assert.equal(command('docker',['exec',hostContainer,'sha256sum','/app/libs/kestra-rbac-authorizer.jar']).split(/\s+/)[0],inputs.jarSha256)
      },restartJvm:async()=>{
        await assertOwner();compose('restart','kestra');await waitForHost()
        assert.equal(compose('ps','-q','kestra'),hostContainer,'Restart replaced the container unexpectedly')
      }}
    adapter=uiAdapter
    if(!adapter) {
      const {chromium}=createRequire(import.meta.url)('playwright')
      browser=await chromium.launch({headless:true})
      context=await browser.newContext({locale:'en-US',viewport:{width:1440,height:1000}})
      const page=await context.newPage()
      adapter=await createPlaywrightApplicationProjectAdapter(page,{artifactDirectory:join(directory,'screenshots'),
        diagnosticDirectory:join(directory,'diagnostics'),timeoutMs:60000,secrets:[account.password]})
    }
    return await runRbacOnboardingBrowser(adapter,{base,account,inputs,controls,scenario,record:persist})
  } finally {
    const failures=[]
    for(const [name,cleanup] of [
      ['adapter',async()=>{if(adapter&&!uiAdapter)await adapter.dispose()}],
      ['context',async()=>context?.close()],['browser',async()=>browser?.close()],
      ['host',async()=>{if(hostContainer)compose('stop','kestra')}],
      ['configuration',async()=>{configuration.services.kestra=originalHost;await saveConfiguration()}],
    ])try{await cleanup()}catch(error){failures.push({name,error:error.name})}
    if(failures.length) {
      writeFileSync(join(directory,'cleanup-failures.json'),JSON.stringify(failures),{mode:0o600})
      throw new Error('First-install cleanup failed; inspect retained cleanup-failures.json')
    }
  }
}
