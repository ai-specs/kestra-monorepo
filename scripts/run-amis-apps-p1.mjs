import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync,realpathSync,lstatSync,existsSync} from 'node:fs'
import {resolve,join,isAbsolute} from 'node:path'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {assertEquivalentExecutionState} from './amis-apps-execution-state.mjs'
import {amisP1Cases} from './amis-apps-p1-cases.mjs'
import {validateAmisPublishedRelease} from './amis-apps-release.mjs'
import {createAmisProductionEnvironment} from './amis-apps-production-environment.mjs'
import {loadAmisP1Examples,seedAmisP1Examples} from './amis-apps-p1-fixture.mjs'
import {runAmisP1BrowserDriver} from './amis-apps-p1-browser-driver.mjs'
import {validateAmisP1Report} from './check-amis-apps-p1-report.mjs'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
const root=resolve(fileURLToPath(new URL('..',import.meta.url)))
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const caseName=id=>id.replace(/^[AB]-/,'')
/** Fixed consumer expectations, never derived from observed requests or inventory. */
export function amisP1Expected(id,{caller,marker,namespace='company.amis.a'}={}) {
 assert(amisP1Cases.includes(id),'Unknown P1 case')
 const name=caseName(id)
 const flowIds=name.startsWith('conditional')?['p1-init','p1-conditional','p1-query']:name.startsWith('list')?['p1-query']:name.startsWith('dialog')?['p1-dialog']:name.startsWith('sync-expiry')?['p1-sync-expiry']:name==='sync-success-and-failure'?['p1-sync']:['p1-async']
 const newExecutions=name.startsWith('authenticated-refusal')?0:name.startsWith('conditional')?3:/^(list|sync-success|client-timeout)/.test(name)?2:1
 return {namespace,flowIds,apiId:'run',caller,newExecutions}
}
export function verifyAmisP1DeniedEffects(value) {
 assert(value?.windowMs>=5000,'Five-second denial window required')
 const hash=/^[a-f0-9]{64}$/
 assert(hash.test(value.before)&&value.before===value.immediate,'Immediate denial content changed')
 assert.deepEqual([...value.sources].sort(),['database','queue','storage'])
 for(const source of value.sources)assert(hash.test(value.beforeSources?.[source]),'Missing content hash: '+source)
 assert.equal(value.before,sha(JSON.stringify(value.beforeSources)),'Composite denial digest does not bind content sources')
 assert(value.samples?.length&&value.samples.at(-1).elapsedMs>=value.windowMs,'Incomplete delayed window')
 let previous=-1
 for(const sample of value.samples) {
  assert(Number.isFinite(sample.elapsedMs)&&sample.elapsedMs>=previous);previous=sample.elapsedMs
  assert.equal(sample.hash,value.before);assert.deepEqual(sample.sources,value.beforeSources)
 }
 assert.deepEqual(value.after,value.beforeSources,'Final denial content changed')
 return {windowMs:value.windowMs,before:value.beforeSources,immediate:value.immediate,immediateSources:value.beforeSources,after:value.after,samples:value.samples,beforeHash:value.before,sources:value.sources}
}
export function verifyAmisP1Persisted({id,browser,persisted,before,after,marker,expected}) {
 assert.equal(browser.completed,true)
 assert(browser.checks?.length&&browser.checks.every(row=>row.status==='passed'),'Browser subchecks incomplete')
 const added=after.filter(value=>!before.includes(value))
 assert.equal(new Set(before).size,before.length);assert.equal(new Set(after).size,after.length)
 assert(before.every(value=>after.includes(value)),'Execution inventory lost an existing execution')
 assert.equal(added.length,expected.newExecutions,'Unexpected newly persisted execution count')
 assert.equal(new Set(persisted.map(row=>row.id)).size,persisted.length)
 assert.deepEqual(persisted.map(row=>row.id).sort(),[...added].sort(),'Database detail set differs from inventory')
 assert(browser.executionIds.every(value=>added.includes(value)),'Poll does not bind a newly persisted execution')
 const posts=browser.trace.filter(row=>row.method==='POST')
 assert.equal(posts.length,expected.newExecutions,'POST count differs from fixed case plan')
 const expectedFlows=caseName(id).startsWith('conditional')?expected.flowIds:[]
 if(expected.newExecutions)assert.deepEqual([...new Set(persisted.map(row=>row.flowId))].sort(),[...expected.flowIds].sort(),'Exact Flow set differs')
 const actions=[]
 for(const value of persisted) {
  assert.equal(value.namespace,expected.namespace);assert(expected.flowIds.includes(value.flowId))
  assert.equal(value.trigger?.type,'io.kestra.plugin.amis.apps.ApiTrigger')
  assert.equal(value.trigger?.variables?.apiId,expected.apiId);assert.equal(value.trigger?.variables?.caller,expected.caller)
  const api='/'+expected.namespace+'/'+value.flowId+'/apis/'+expected.apiId
  assert(posts.some(row=>new URL(row.url).pathname===api),'Persisted execution has no matching API POST')
  if(browser.executionIds.includes(value.id))assert(browser.trace.some(row=>row.method==='GET'&&new URL(row.url).pathname===api+'/executions/'+value.id),'Poll route differs from persisted Flow/API')
  assert(value.inputs&&typeof value.inputs==='object');const input=value.inputs;actions.push(input.action)
  assert.equal(value.state?.current,input.action==='fail'?'FAILED':'SUCCESS','Execution terminal outcome differs')
  if(input.action==='init')assert.equal(input.name,'INITIAL-LOADED')
  else if(input.action==='conditional')assert.equal(input.name,'CONDITIONAL-LOADED')
  else if(input.action!=='query')assert.equal(input.name,marker,'Persisted marker differs')
  if(expectedFlows.length)assert.equal(value.flowId,'p1-'+input.action,'Conditional action crossed Flow')
  if(caseName(id).startsWith('complex'))for(const [key,actual]of Object.entries({quantity:7,category:'beta',date:'2026-12-01',enabled:true,details:marker+'-details',tags:[marker+'-tag']}))assert.deepEqual(input[key],actual,'Persisted typed field differs: '+key)
  if(input.action==='query'){assert.equal(input.perPage,2);assert([1,2].includes(input.page));if(caseName(id).startsWith('conditional'))assert.equal(input.page,1)}
  if(input.action!=='fail') {
   const output=value.outputs?.response;assert(output&&typeof output==='object','Persisted Flow output missing')
   assert.equal(output.action,input.action);assert.equal(output.message,input.name)
   for(const key of ['quantity','category','date','enabled','details','tags'])assert.deepEqual(output[key],input[key],'Persisted output differs: '+key)
   if(input.action==='query'){assert.equal(output.total,3);assert.deepEqual(output.items,input.page===1?[{id:1,name:'ROW-ONE'},{id:2,name:'ROW-TWO'}]:[])}
  }
 }
 const name=caseName(id)
 const planned=expected.newExecutions===0?[]:name.startsWith('conditional')?['init','conditional','query']:name.startsWith('list')?['query','query']:name==='sync-success-and-failure'?['fail','save']:/async-failure/.test(name)?['fail']:/paused/.test(name)?['pause']:/async-running|sync-expiry|double-submit|client-timeout/.test(name)?Array(expected.newExecutions).fill('slow'):Array(expected.newExecutions).fill('save')
 assert.deepEqual(actions.sort(),planned.sort(),'Execution action multiplicity differs')
 if(caseName(id).startsWith('list'))assert.deepEqual(persisted.map(row=>row.inputs.page).sort(),[1,2])
 return added
}
/** Genuine flow output API read, bound to the independently persisted execution. */
export function verifyAmisP1OutputRead(execution,read,storage) {
 assert.equal(read.method,'GET');assert.equal(read.path,'/api/v1/main/outputs/executions/'+execution.id)
 assert.equal(read.status,200,'Published flow-output read failed')
 assert(read.outputs&&typeof read.outputs==='object'&&!Array.isArray(read.outputs),'Flow-output map required')
 const records=storage.filter(row=>row.executionId===execution.id&&row.tenantId==='main')
 if(execution.state.current==='SUCCESS') {
  assert.equal(records.length,1,'Exact main-tenant output storage record required')
  assert(records[0].valueBytes===null||records[0].valueBytes===undefined||Number.isSafeInteger(records[0].valueBytes)&&records[0].valueBytes>=0,'Output byte count must be a real nonnegative integer')
  assert(records[0].valueBytes>0||typeof records[0].uri==='string'&&records[0].uri.length>0,'Output storage record has no content')
  if(records[0].valueBytes>0)assert.match(records[0].valueSha256,/^[a-f0-9]{64}$/)
  assert(read.outputs.response&&typeof read.outputs.response==='object'&&!Array.isArray(read.outputs.response),'Published response output missing')
 }
 if(execution.outputs!=null)assert.deepEqual(execution.outputs,read.outputs,'Legacy DB outputs differ from published stored outputs')
 return read.outputs
}
export function amisP1Deployment(mode,environment,inspected,actual,selected) {
 return {mode,project:environment.project,containerIds:[inspected.postgresContainer,inspected.kestraContainer],hostContainerId:inspected.kestraContainer,formalImage:selected.hostImage,actualImageId:actual.Image,jars:[{target:'/app/libs/kestra-amis-apps.jar',sha256:selected.amisJarSha256},...(mode==='B'?[{target:'/app/libs/kestra-rbac-authorizer.jar',sha256:selected.rbacJarSha256}]:[])]}
}
export async function runAmisP1(options) {
 const area=resolve(options.directory)
 assert(area.startsWith(join(root,'.work')+'/')&&realpathSync(resolve(area,'..'))===resolve(area,'..'))
 mkdirSync(area,{mode:0o700});mkdirSync(join(area,'evidence'))
 const selected=options.selected
 const inputs=Object.fromEntries(['rootCommit','hostCommit','amisCommit','rbacCommit','hostImage','amisJarSha256','rbacJarSha256'].map(k=>[k,selected[k]]))
 const report={schemaVersion:1,stage:'P1',completed:false,synthetic:false,identityTransport:'production-oidc',inputs,cases:amisP1Cases.map(id=>({id,status:'not_run'})),summary:{passed:0,failed:0,skipped:0,notRun:24},resources:{cleaned:false}}
 const save=()=>{report.summary={passed:report.cases.filter(x=>x.status==='passed').length,failed:report.cases.filter(x=>x.status==='failed').length,skipped:0,notRun:report.cases.filter(x=>!['passed','failed'].includes(x.status)).length};writeFileSync(join(area,'report.json'),JSON.stringify(report,null,2),{mode:0o600})}
 const evidence=(name,value)=>{const path='evidence/'+name+'.json',bytes=JSON.stringify(value,null,2);writeFileSync(join(area,path),bytes,{mode:0o600});return{path,sha256:sha(bytes)}}
 save()
 let environment
 let failure
 try {
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',cwd:root}).trim(),selected.rootCommit)
 const dirty=execFileSync('git',['status','--porcelain'],{encoding:'utf8',cwd:root}).trim()
 assert(!dirty||options.allowDirty===true&&!process.env.GITHUB_ACTIONS,'Dirty root requires explicit local permission')
 for(const [path,key]of [['kestra-overlay','hostCommit'],['kestra-plugin-amis-apps','amisCommit'],['kestra-plugin-rbac','rbacCommit']]) {
  const committed=execFileSync('git',['ls-tree','HEAD','--',path],{encoding:'utf8',cwd:root}).trim().split(/\s+/)[2]
  assert.equal(committed,selected[key],'P1 selected formal gitlink differs: '+path)
 }
 validateAmisPublishedRelease(selected.amisReleaseDirectory,{...selected,stage:'P1',expectedTests:selected.expectedJavaTests})
 environment=createAmisProductionEnvironment({directory:join(area,'environment'),rootDirectory:root,selected,port:options.port??18129,probeJar:options.probeJar,pollTimeoutMs:5000})
  await environment.startPostgres()
  for(const mode of ['A','B']) {
   await environment.useMode(mode)
   const admin=await environment.login(environment.current.admin)
   const examples=loadAmisP1Examples(selected.amisReleaseDirectory,'company.amis.a')
   report.examples??={};report.examples[mode]=await seedAmisP1Examples(admin,examples);save()
   for(const row of report.cases.filter(x=>x.id.startsWith(mode+'-'))) {
    row.status='running';save()
    try {
     const denied=row.id.endsWith('authenticated-refusal-has-no-delayed-effects')
     const actor=mode==='A'?environment.current.admin:environment.current.actors.find(x=>x.key===(denied?'entry-only':'allow-a'))
     assert(actor,'Exact production actor missing')
     await environment.current.effects.waitForIdle();await environment.current.effects.waitForStable()
     const before=environment.current.effects.executionInventory()
     const marker='p1-'+mode.toLowerCase()+'-'+report.cases.indexOf(row)+'-'+Date.now()
     const expected=amisP1Expected(row.id,{caller:actor.username,marker})
     const inspected=await environment.manager.inspect()
     const actual=JSON.parse(execFileSync('docker',['inspect',inspected.kestraContainer],{encoding:'utf8',timeout:30000}))[0]
     const output=join(area,'browser-'+report.cases.indexOf(row)),file=join(area,'account-'+report.cases.indexOf(row)+'.private.json')
     writeFileSync(file,JSON.stringify({account:actor}),{mode:0o600,flag:'wx'})
     const value={browser:null,persisted:[],before,after:before,marker,expected,databaseExecutions:[],persistedReads:[],outputReads:[],outputStorage:[],resultReads:[]}
     const retain=()=>{row.evidence=[evidence('case-'+report.cases.indexOf(row),value)];save()}
     const databaseRecords=added=>{
      for(const executionId of added)assert.match(executionId,/^[A-Za-z0-9_-]+$/)
      const sql="SELECT coalesce(json_agg(value ORDER BY value->>'id'),'[]') FROM executions WHERE value->>'id' IN ("+(added.length?added.map(id=>"'"+id+"'").join(','):"''")+")"
      return JSON.parse(execFileSync('docker',['exec',inspected.postgresContainer,'psql','-X','-U','kestra','-d',environment.privateInputs.modes[mode].database,'-Atc',sql],{encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024}))
     }
     try {
      const runBrowser=async()=>{
       value.browser=await runAmisP1BrowserDriver({...options.browser,id:row.id,base:environment.base,scenario:examples,marker,privateFile:file,outputDirectory:output,deployment:amisP1Deployment(mode,environment,inspected,actual,selected)})
       const browser=value.browser
       assert.equal(browser.completed,true)
       assert.notEqual(browser.synthetic,true,'Synthetic browser cannot pass production runner')
       assert(browser.productionLogin?.credentialsSubmitted===true,'Actual browser credential POST receipt required')
       assert.equal(browser.productionLogin.subject,actor.username,'Browser subject differs from selected actor')
       assert.equal(browser.productionLogin.httpStatus,303,'Browser credential POST must redirect with 303')
       assert.equal(browser.productionLogin.transport,'production-browser')
       assert.deepEqual(browser.diagnostics?.integrity,[],'Browser diagnostics integrity failed')
       assert.deepEqual(browser.diagnostics?.errors,[],'Unclassified browser errors')
       row.productionLogin=browser.productionLogin
       retain()
      }
      if(denied) {
       const client=mode==='A'?new ProductionOAuthClient(environment.base):await environment.login(actor)
       if(mode==='B') {
        value.refusalIdentity=await client.verifiedUiIdentity({applicationGroupId:'main',subject:actor.username,audience:'kestra-ui'})
        assert.deepEqual([...value.refusalIdentity.applicationGroupScopes].sort(),[...actor.scopeKeys].sort(),'Refusal signed scopes differ')
       }
       const path='/company.amis.a/p1-async/apis/run',status=mode==='A'?401:403
       const observed=await environment.current.effects.observeDenied(async()=>{
        await runBrowser()
        return client.request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',name:marker})})
       },async response=>{
        value.refusal={method:'POST',path,status:response.status,expectedStatus:status,identity:mode==='A'?'anonymous':actor.username}
        retain();assert.equal(response.status,status,'Production refusal status differs');await response.body?.cancel()
       },{windowMs:5000,intervalMs:250})
       value.sideEffects=verifyAmisP1DeniedEffects(observed.observation)
       row.refusal=value.refusal;row.sideEffects=value.sideEffects
      } else await runBrowser()
      await environment.current.effects.waitForIdle();await environment.current.effects.waitForStable()
      value.after=environment.current.effects.executionInventory()
      const added=value.after.filter(id=>!before.includes(id))
      value.persisted=databaseRecords(added)
      // Published output GET reconstructs stored outputs through the output service.
      // Keep both raw DB records and exact native read results; never invent outputs.
      value.databaseExecutions=structuredClone(value.persisted);value.persistedReads=[];value.resultReads=[];value.outputReads=[]
      const outputSql="SELECT coalesce(json_agg(json_build_object('executionId',key,'tenantId',tenant_id,'valueBytes',octet_length(value),'encoded',encode(value,'base64'),'uri',uri)),'[]') FROM execution_outputs WHERE tenant_id='main' AND key IN ("+(added.length?added.map(id=>"'"+id+"'").join(','):"''")+")"
      value.outputStorage=JSON.parse(execFileSync('docker',['exec',inspected.postgresContainer,'psql','-X','-U','kestra','-d',environment.privateInputs.modes[mode].database,'-Atc',outputSql],{encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024})).map(({encoded,...record})=>({...record,...(encoded?{valueSha256:sha(Buffer.from(encoded.replace(/\s/g,''),'base64'))}:{})}))
      for(const execution of value.persisted) {
       const path='/api/v1/main/executions/'+encodeURIComponent(execution.id)
       const response=await admin.request(path);assert.equal(response.status,200,'Native persisted execution read failed')
       const stored=await response.json();value.persistedReads.push({method:'GET',path,status:response.status,execution:stored})
       for(const key of ['id','namespace','flowId','inputs','trigger'])assert.deepEqual(stored[key],execution[key],'Native/DB field differs: '+key)
       assertEquivalentExecutionState(stored.state,execution.state,'Native/DB execution state differs')
       const outputPath='/api/v1/main/outputs/executions/'+encodeURIComponent(execution.id)
       const outputResponse=await admin.request(outputPath)
       const outputRead={method:'GET',path:outputPath,status:outputResponse.status,outputs:await outputResponse.json()}
       value.outputReads.push(outputRead)
       execution.outputs=verifyAmisP1OutputRead(execution,outputRead,value.outputStorage)
       const resultPath='/'+execution.namespace+'/'+execution.flowId+'/apis/run/executions/'+execution.id
       const resultResponse=await admin.request(resultPath)
       const result=await resultResponse.json();value.resultReads.push({method:'GET',path:resultPath,status:resultResponse.status,body:result})
       assert.equal(result.executionId,execution.id);assert.equal(result.executionState,execution.state.current)
       assert.equal(resultResponse.status,200);assert.equal(result.resultReady,true)
       if(execution.state.current==='FAILED')assert.notEqual(result.status,0)
       else {assert.equal(result.status,0);assert.deepEqual(result.data,execution.outputs?.response,'API data differs from persisted native outputs')}
      }
      retain()
      row.executionIds=verifyAmisP1Persisted({id:row.id,...value})
      row.transport='production-browser-and-execution-store'
     } catch(error) {
      if(error.observation||error.sideEffects)value.failedSideEffects=error.observation??error.sideEffects
      const partial=join(output,'report.json')
      if(!value.browser&&existsSync(partial))value.browser=JSON.parse(readFileSync(partial))
      try {
       value.after=environment.current.effects.executionInventory()
       value.failureDatabaseExecutions=databaseRecords(value.after.filter(id=>!before.includes(id)))
      } catch(observationError) {value.failureObservationError=String(observationError.message)}
      value.failure={message:String(error.message)};retain();throw error
     }
     row.status='passed';save()
    } catch(error){row.status='failed';row.error=String(error.message);save();throw error}
   }
  }
 } catch(error){failure=error;report.failure={message:String(error.message)}}
 finally {
  try{if(environment){await environment.cleanup();report.resources={owner:environment.project,ownerVerified:true,cleaned:environment.manager.resources.created.every(x=>x.removed),containers:0,networks:0,volumes:0}}else report.resources={ownerVerified:false,cleaned:true,noEnvironmentConstructed:true,containers:0,networks:0,volumes:0}}
  catch(error){failure??=error;report.cleanupFailure={message:String(error.message)};report.resources={cleaned:false,error:'Owned cleanup failed'}}
  report.completed=!failure;save()
 }
 if(failure){failure.reportPath=join(area,'report.json');throw failure}
 try {validateAmisP1Report(report,inputs,{directory:area})} catch(error){report.completed=false;report.failure={phase:'final-report-validation',message:String(error.message)};save();error.reportPath=join(area,'report.json');throw error}
 return report
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 try {const file=resolve(process.argv[2]);assert(isAbsolute(process.argv[2])&&realpathSync(file).startsWith(join(root,'.work')+'/'));assert.equal(lstatSync(file).mode&0o777,0o600);await runAmisP1(JSON.parse(readFileSync(file)));console.log('P1 production matrix completed')}
 catch{console.error('P1 production matrix failed; inspect owned report');process.exitCode=1}
}
