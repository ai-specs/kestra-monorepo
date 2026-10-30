/** Rehydrate JSON UI inputs against the same owned deployment; importing does no I/O. */
import assert from 'node:assert/strict'
import {execFileSync,spawn} from 'node:child_process'
import {randomBytes} from 'node:crypto'
import {ApplicationGroupManagement} from './application-project-fixture.mjs'
import {applicationProject} from './application-project-cases.mjs'
import {ProjectSideEffects} from './application-project-effects.mjs'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {ownedPermissionDependencyControls} from './access-control-v3-dependency.mjs'
import {createOwnedAccessControlUiControls} from './access-control-v3-ui-controls.mjs'
import {uiBrowserFixture} from './application-project-ui-fixture.mjs'

export function browserRuntimeRedactor(fixture) {
  const secrets=new Set()
  const remember=value=>{if(typeof value==='string'&&value)secrets.add(value)}
  const collect=value=>{if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)) {
    if(/^(?:password|temporaryPassword|clientSecret|client_secret|access_token|id_token|refresh_token)$/i.test(key)&&typeof item==='string')remember(item)
    else if(item&&typeof item==='object')collect(item)
  }}
  collect(fixture)
  const text=value=>{
    for(const secret of [...secrets].sort((a,b)=>b.length-a.length))value=value.replaceAll(secret,'[redacted]')
    return value.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted-jwt]')
      .replace(/([?&](?:code|state|from|client_secret|access_token|id_token|refresh_token)=)[^&#\s"']*/gi,'$1[redacted]')
  }
  const redact=value=>typeof value==='string'?text(value):Array.isArray(value)?value.map(redact):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,/^(?:password|clientSecret|client_secret|access_token|id_token|refresh_token)$/i.test(key)&&typeof item==='string'?'[redacted]':redact(item)])):value
  return {remember,redact}
}

function validateRuntime(runtime) {
  for(const [object,methods]of [[runtime.management,['login','request','mutateDirectory']],[runtime.effects,['snapshot']],
    [runtime.credentialControls,['verifySecret']],[runtime.dependencyControls,['makeUnavailable','recover']],
    [runtime.uiWriteBarrier,['acquire','waitForBlocked','release']]])for(const name of methods)assert.equal(typeof object?.[name],'function','real browser runtime missing '+name)
  assert.equal(typeof runtime.userAuditEvidence,'function','real public audit reader required')
  assert(runtime.planned?.admin&&runtime.planned.observerScope&&runtime.credentialControls.clientId)
}

export async function hydrateAccessControlBrowserRuntime({base,fixture,deployment,inputs,record,redactor=browserRuntimeRedactor(fixture),onSecret=()=>{}}) {
  assert.equal(typeof record,'function','persistent runtime evidence callback required')
  assert.equal(new URL(base).origin,base);assert.equal(fixture.base,base)
  assert.equal(fixture.applicationGroupId,applicationProject)
  const project=deployment.composeProject
  assert(/^application-projects-bb-[0-9]+-[0-9]+$/.test(project))
  for(const key of ['postgresContainer','kestraContainer'])assert(/^[a-f0-9]{12,64}$/.test(deployment[key]))
  assert.notEqual(deployment.postgresContainer,deployment.kestraContainer,'distinct owned PG and host containers required')
  const owner=Object.freeze({composeProject:project,postgresComposeProject:project,postgresContainer:deployment.postgresContainer,database:'kestra',isolated:true,exclusiveWriters:true})
  const docker=(args,options={})=>{
    try{return execFileSync('docker',args,{encoding:'utf8',timeout:20000,maxBuffer:2*1024*1024,stdio:['pipe','pipe','pipe'],...options}).trim()}
    catch{throw new Error('Owned browser runtime Docker command failed; raw process output is not retained')}
  }
  const inspect=(format,id)=>docker(['inspect','-f',format,id])
  const assertOwner=async supplied=>{
    assert.deepEqual(supplied,owner,'browser runtime owner changed')
    for(const id of [owner.postgresContainer,deployment.kestraContainer]) {
      assert.equal(inspect('{{index .Config.Labels "owner"}}',id),project)
      assert.equal(inspect('{{index .Config.Labels "com.docker.compose.project"}}',id),project)
      assert.equal(inspect('{{.State.Running}}',id),'true')
    }
    assert.equal(inspect('{{index .Config.Labels "com.docker.compose.service"}}',owner.postgresContainer),'postgres')
    assert.equal(inspect('{{index .Config.Labels "com.docker.compose.service"}}',deployment.kestraContainer),'kestra')
    assert.equal(inspect('{{.Config.Image}}',deployment.kestraContainer),inputs.image)
    const ports=JSON.parse(inspect('{{json .NetworkSettings.Ports}}',deployment.kestraContainer))
    assert(ports['8080/tcp']?.some(binding=>binding.HostIp==='127.0.0.1'&&binding.HostPort===new URL(base).port),'runtime origin differs from owned host')
    const jar=docker(['exec',deployment.kestraContainer,'sha256sum','/app/libs/kestra-rbac-authorizer.jar']).split(/\s+/)[0]
    assert.equal(jar,inputs.jarSha256,'runtime jar changed')
  }
  await assertOwner(owner)
  if(fixture.targetRuntime) {
    validateRuntime(fixture.targetRuntime)
    assert.equal(fixture.targetRuntime.management.base,base)
    assert.equal(fixture.targetRuntime.planned.base,base)
    assert.equal(fixture.targetRuntime.planned.admin.subject,fixture.admin.subject)
    await record({source:'owned-browser-runtime',stage:'caller-runtime-reused',owner})
    return {fixture,redact:redactor.redact,close:async()=>({borrowed:true,closed:false})}
  }
  const query=async sql=>{await assertOwner(owner);return docker(['exec',owner.postgresContainer,'psql','-X','-q','-A','-t','-U','kestra','-d',owner.database,'-v','ON_ERROR_STOP=1','-c',sql])}
  assert.equal(await query('SELECT current_database()'),owner.database,'owned PG database differs')
  const management=new ApplicationGroupManagement(base,fixture.admin)
  const effects=new ProjectSideEffects({...deployment,composeProject:project,database:owner.database})
  const planned={base,admin:fixture.admin,observerScope:'acceptance-observer-complete'}
  const pendingOutages=new Set()
  const dependency=ownedPermissionDependencyControls({origin:base,applicationGroupId:applicationProject,assertOwner:()=>assertOwner(owner),query})
  const dependencyControls={
    async makeUnavailable(options){pendingOutages.add(options.operationId);return dependency.makeUnavailable(options)},
    async recover(options){const result=await dependency.recover(options);pendingOutages.delete(options.operationId);return result},
  }
  let controls,currentSecret='',closed=false
  const close=async()=>{
    if(closed)return {closed:true}
    const issues=[]
    try{await controls?.close()}catch{issues.push('write-barrier')}
    for(const operationId of pendingOutages)try{await dependencyControls.recover({operationId})}catch{issues.push('dependency-recovery')}
    currentSecret=''
    if(issues.length)throw new Error('Owned browser runtime cleanup failed: '+issues.join(','))
    closed=true
    return {closed:true,temporaryClientLifetime:'owned-deployment-teardown'}
  }
  try {
    await management.login()
    await management.request(management.groupPath(applicationProject)+'/scopes/'+planned.observerScope)
    const clientId='acceptance-confidential-'+randomBytes(8).toString('hex'),redirectUri='http://127.0.0.1:19996/callback'
    const plan={clientId,ownerSubject:fixture.admin.subject,redirectUris:[redirectUri],grantTypes:['authorization_code','refresh_token'],protocolScopes:['openid']}
    // Same formal JVM class/config/PG as blackbox maintenance, inside its existing host container.
    const command='set -eu; plan="$(mktemp /tmp/root-ui-client.XXXXXX)"; trap \'rm -f "$plan"\' EXIT; chmod 600 "$plan"; cat > "$plan"; java -cp /app/kestra:/app/libs/kestra-rbac-authorizer.jar io.kestra.webserver.oidc.cli.OidcClientCredentialsCommand register-confidential "$plan"'
    await assertOwner(owner)
    const output=docker(['exec','-i','--user','0:0',deployment.kestraContainer,'sh','-c',command],{input:JSON.stringify(plan)+'\n',timeout:60000})
    let issued
    try{issued=JSON.parse(output.split('\n').findLast(line=>line.startsWith('{')))}catch{throw new Error('Published confidential-client CLI did not return a valid receipt')}
    if(typeof issued.clientSecret==='string'){redactor.remember(issued.clientSecret);onSecret(issued.clientSecret)}
    assert.equal(issued.status?.clientId,clientId)
    assert(typeof issued.clientSecret==='string'&&issued.clientSecret.length>=32,'Published confidential client secret required')
    currentSecret=issued.clientSecret;issued.clientSecret=undefined
    const group=await management.request(management.groupPath(applicationProject))
    await management.mutateDirectory(management.groupPath(applicationProject)+'/applications','POST',{clientId,description:'Ordinary confidential credential acceptance',audiences:[]},group.revision)
    const credentialControls={clientId,verifySecret:async({clientId:requested,newSecret})=>{
      assert.equal(requested,clientId);assert(!closed)
      redactor.remember(newSecret);onSecret(newSecret);await assertOwner(owner)
      const client=new ProductionOAuthClient(base);await client.login(planned.admin.username,planned.admin.password)
      const result=await client.verifyConfidentialRotation({clientId,redirectUri,oldSecret:currentSecret,newSecret});currentSecret=newSecret;return result
    }}
    controls=createOwnedAccessControlUiControls({origin:base,applicationGroupId:applicationProject,owner,management,assertOwner,query,
      sourceRef:'browser.full.owned-runtime',record:event=>record(redactor.redact(event)),
      spawnPsql:async({owner:supplied,applicationName})=>{
        await assertOwner(supplied);assert(/^root_ui_barrier_[a-f0-9]{24}$/.test(applicationName))
        return spawn('docker',['exec','-i','-e','PGAPPNAME='+applicationName,owner.postgresContainer,'psql','-X','-q','-A','-t','-U','kestra','-d',owner.database,'-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe'],shell:false})
      }})
    // Client was registered after JSON preparation. Refresh only the owned client inventory
    // and its derived expected filters/pagination; do not provision the UI data a second time.
    const clients=[];let total,revision
    for(let page=1;;page++) {
      const result=await management.request(management.groupPath(applicationProject)+'/applications?page='+page+'&size=100')
      assert(Array.isArray(result.items)&&Number.isSafeInteger(result.total)&&Number.isSafeInteger(result.directoryRevision))
      total??=result.total;revision??=result.directoryRevision;assert.equal(result.total,total);assert.equal(result.directoryRevision,revision)
      clients.push(...result.items);assert(clients.length<=total)
      if(clients.length===total)break
      assert(result.items.length,'owned client inventory pagination stalled')
    }
    assert(clients.some(item=>item.clientId===clientId))
    const derived=uiBrowserFixture({...fixture,records:{...fixture.records,clients}})
    const hydrated={...fixture,records:derived.records,filters:derived.filters,pagination:derived.pagination}
    const targetRuntime={management,planned,effects,credentialControls,dependencyControls,uiWriteBarrier:controls.uiWriteBarrier,userAuditEvidence:controls.userAuditEvidence}
    validateRuntime(targetRuntime);Object.defineProperty(hydrated,'targetRuntime',{value:targetRuntime,enumerable:false})
    await record({source:'owned-browser-runtime',stage:'hydrated',owner,clientId,registeredThrough:'published-host-maintenance-cli',credentialRevision:issued.status.credentialRevision,resourceAudiences:[],applicationScopes:[],auditCapability:controls.auditCapability,clientInventoryCount:clients.length,temporaryClientLifetime:'owned-deployment-teardown'})
    return {fixture:hydrated,redact:redactor.redact,close}
  }catch(error){
    try{await close()}catch{throw new Error('Owned browser runtime preparation and cleanup failed; inspect retained runtime evidence')}
    throw new Error(redactor.redact(String(error.message)))
  }
}
