import assert from 'node:assert/strict'
import {copyFileSync,mkdirSync,readFileSync,writeFileSync,chmodSync} from 'node:fs'
import {createHash,randomBytes} from 'node:crypto'
import {createRequire} from 'node:module'
import {join} from 'node:path'
import {createPlaywrightApplicationProjectAdapter} from './application-project-browser-adapters.mjs'
import {runRbacOnboardingBrowser} from './rbac-onboarding-browser.mjs'
import {ApplicationGroupManagement} from './application-project-fixture.mjs'
import {applicationProjectFeature} from './application-project-fixture.mjs'

export async function runRbacOnboardingDeployment({configuration,compose,saveConfiguration,command,output,project,base,inputs,formalJar,uiAdapter,scenario='missing-jar',sessionState,record}) {
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
  const readExecution=async id=>{
    await assertOwner();assert.match(id,/^[A-Za-z0-9_-]+$/)
    return JSON.parse(query("SELECT json_build_object('id',value->>'id','namespace',value->>'namespace','flowId',value->>'flowId','state',value->'state'->>'current') FROM executions WHERE tenant_id='main' AND value->>'id'='"+id+"'"))
  }
  // Owned storage observers never supply authorization or perform allowed business writes.
  let namespacePrefix
  const namespaceEffects=async()=>{
    await assertOwner();assert.match(namespacePrefix,/^namespace_[0-9]+$/)
    const tables={}
    for(const table of ['flows','kv_metadata','executions','triggers','execution_outputs','execution_queued','queues']) {
      const present=query("SELECT to_regclass('public."+table+"') IS NOT NULL")==='t'
      const filter=['queues','execution_outputs','execution_queued'].includes(table)?'':" WHERE row_to_json(t)::text LIKE '%"+namespacePrefix+"%'"
      tables[table]=present?JSON.parse(query("SELECT coalesce(json_agg(x ORDER BY x::text),'[]'::json) FROM (SELECT row_to_json(t) x FROM "+table+" t"+filter+") q")):[]
    }
    const storage=command('docker',['exec',hostContainer,'sh','-c',"find /app/storage -type f -exec sha256sum {} + | LC_ALL=C sort"])
    return {tables,storage,coverage:{queues:'full-owner-table',execution_outputs:'full-owner-table',execution_queued:'full-owner-table',storage:'all-owner-files'}}
  }
  const expectedNamespaceLists=async()=>{
    await assertOwner()
    const result=JSON.parse(query(`SELECT json_build_object('source','owned-database','namespace','company.sub','descendants',true,
      'flow',(SELECT coalesce(json_agg(json_build_object('namespace',namespace,'id',id) ORDER BY namespace,id),'[]'::json)
        FROM (SELECT DISTINCT ON (namespace,id) namespace,id,deleted FROM flows WHERE tenant_id='main'
          AND (namespace='company.sub' OR namespace LIKE 'company.sub.%') AND value->>'draft' IS DISTINCT FROM 'true'
          ORDER BY namespace,id,revision DESC) latest WHERE NOT deleted),
      'kv',(SELECT coalesce(json_agg(json_build_object('namespace',namespace,'id',name) ORDER BY namespace,name),'[]'::json)
        FROM kv_metadata WHERE tenant_id='main' AND (namespace='company.sub' OR namespace LIKE 'company.sub.%')
          AND "last" AND NOT deleted AND (expiration_date IS NULL OR expiration_date>current_timestamp)))`))
    assert.equal(result.source,'owned-database');assert(Array.isArray(result.flow)&&Array.isArray(result.kv))
    return result
  }
  const readNamespaceResource=async({namespace,kind,id})=>{
    await assertOwner();assert.match(namespace,/^[a-z][a-z0-9.]+$/);assert.match(id,/^namespace_[0-9]+$/)
    namespacePrefix=id
    const table=kind==='flow'?'flows':'kv_metadata',field=kind==='flow'?'id':'name'
    return JSON.parse(query("SELECT coalesce(json_agg(value ORDER BY key),'[]'::json) FROM "+table+" WHERE tenant_id='main' AND namespace='"+namespace+"' AND "+field+"='"+id+"'"))
  }
  const seedNamespaceBaselines=async({id,sourceNamespace,namespaces})=>{
    await assertOwner();assert.equal(id,namespacePrefix);assert.equal(sourceNamespace,'company')
    for(const namespace of namespaces) {
      assert(['company.sub.child','company.other','company2','outside'].includes(namespace))
      assert.equal(query("SELECT count(*) FROM flows WHERE namespace='company' AND id='"+id+"' AND key NOT LIKE 'main_company_%'"),'0')
      assert.equal(query("SELECT count(*) FROM kv_metadata WHERE namespace='company' AND name='"+id+"' AND key NOT LIKE 'main_company_%'"),'0')
      query("INSERT INTO flows(key,value,source_code) SELECT regexp_replace(key,'^main_company_','main_"+namespace+"_'),jsonb_set(value,'{namespace}',to_jsonb('"+namespace+"'::text)) || CASE WHEN value ? 'source' THEN jsonb_build_object('source',replace(value->>'source','namespace: company','namespace: "+namespace+"')) ELSE '{}'::jsonb END,replace(source_code,'namespace: company','namespace: "+namespace+"') FROM flows WHERE namespace='company' AND id='"+id+"'; INSERT INTO kv_metadata(key,value) SELECT regexp_replace(key,'^main_company_','main_"+namespace+"_'),jsonb_set(value,'{namespace}',to_jsonb('"+namespace+"'::text)) FROM kv_metadata WHERE namespace='company' AND name='"+id+"'")
      // Use the actual persisted file location, and require a unique source file.
      const source=command('docker',['exec',hostContainer,'find','/app/storage','-type','f','-path','*/company/_kv/'+id+'.ion']).split('\n').filter(Boolean)
      assert.equal(source.length,1,'Expected one actual KV seed value')
      const target=source[0].replace('/company/_kv/','/'+namespace.replaceAll('.','/')+'/_kv/')
      assert(target!==source[0]&&target.startsWith('/app/storage/'))
      command('docker',['exec',hostContainer,'mkdir','-p',target.slice(0,target.lastIndexOf('/'))])
      command('docker',['exec',hostContainer,'cp',source[0],target])
    }
    return {transport:'owned-database-and-storage-seed',id,namespaces,sourceNamespace}
  }
  const revokeNamespaceSubject=async({subject,account:admin})=>{
    await assertOwner();assert.equal(subject,namespacePrefix)
    const management=new ApplicationGroupManagement(base,{...admin,subject:admin.username})
    await management.login()
    const identity=await management.client.verifiedUiIdentity({applicationGroupId:'main',subject:admin.username,audience:'kestra-ui'})
    const path='/api/v1/main/extensions/rbac/application-groups/main/scope-grants/detail?subject='+encodeURIComponent(subject)
    const current=await management.request(path)
    await management.request(path,'PUT',{issuer:base,subject,scopeKeys:[]},current.revision)
    await management.login()
    await management.client.verifiedUiIdentity({applicationGroupId:'main',subject:admin.username,audience:'kestra-ui'})
    const stored=await management.request(path)
    assert.deepEqual(stored.scopeKeys,[],'Revocation did not persist an empty subject grant')
    return {transport:'production-management-api-assistance',subject,scopeKeys:[],verifiedOperator:{subject:identity.subject,applicationGroupId:identity.applicationGroupId},revision:stored.revision,requests:management.requests}
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
    let rbac=standardConfiguration.slice(rbacStart,rbacEnd)
    for(const pattern of [/^(    enabled: )false$/m,/(    evaluation:\n      enabled: )false/,
      /(    application-groups:\n      enabled: )false/]) {
      assert(pattern.test(rbac),'Known first-install RBAC switch required')
      rbac=rbac.replace(pattern,(_,prefix)=>prefix+'true')
    }
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
    compose('up','--no-start','kestra')
    hostContainer=command('docker',['ps','-aq','--filter','label=com.docker.compose.project='+project,'--filter','label=com.docker.compose.service=kestra'])
    command('docker',['start',hostContainer],{timeout:120000})
    await assertOwner();await waitForHost()
    const controls={assertOwner,installationState,readGroup,readExecution,namespaceEffects,expectedNamespaceLists,readNamespaceResource,seedNamespaceBaselines,revokeNamespaceSubject,
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
        await assertOwner();command('docker',['restart',hostContainer],{timeout:120000});await waitForHost()
        const actualContainer=compose('ps','-q','kestra');assert(actualContainer.length>=12&&(hostContainer===actualContainer||hostContainer.startsWith(actualContainer)),'Restart replaced the container unexpectedly')
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
    controls.restorePriorSession=async()=>{
      assert(sessionState?.value,'Normal installation requires the preceding real production session')
      return adapter.restoreOwnedSession(base,sessionState.value)
    }
    const result=await runRbacOnboardingBrowser(adapter,{base,account,inputs,controls,scenario,record:persist})
    if(scenario==='missing-jar') {
      assert(sessionState,'Production session transfer state is required')
      sessionState.value=await adapter.captureOwnedSession(base)
      result.sessionExport=sessionState.value.proof
      await persist(result)
    }
    return result
  } finally {
    const failures=[]
    for(const [name,cleanup] of [
      ['adapter',async()=>{if(adapter&&!uiAdapter)await adapter.dispose()}],
      ['context',async()=>context?.close()],['browser',async()=>browser?.close()],
      ['host',async()=>{if(hostContainer)command('docker',['stop',hostContainer],{timeout:120000})}],
      ['configuration',async()=>{configuration.services.kestra=originalHost;await saveConfiguration()}],
    ])try{await cleanup()}catch(error){failures.push({name,error:error.name})}
    if(failures.length) {
      writeFileSync(join(directory,'cleanup-failures.json'),JSON.stringify(failures),{mode:0o600})
      throw new Error('First-install cleanup failed; inspect retained cleanup-failures.json')
    }
  }
}
