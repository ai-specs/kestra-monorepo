import assert from 'node:assert/strict'
import test from 'node:test'
import {createHash} from 'node:crypto'
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync,readdirSync,unlinkSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {runAmisP0} from '../run-amis-apps-p0.mjs'
import {amisP0Cases} from '../amis-apps-acceptance-cases.mjs'
import {amisPermissionCaseIds} from '../amis-apps-permission-cases.mjs'

// Synthetic orchestration tests. Injected fragments never prove production cases.
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
function setup(t,mutation={}) {
  mkdirSync('.work',{recursive:true})
  const parent=mkdtempSync(resolve('.work/p0-runner-unit-'));t.after(()=>rmSync(parent,{recursive:true}))
  const release=join(parent,'release');mkdirSync(release)
  const amisJar=join(release,'kestra-amis-apps.jar'),rbacJar=join(parent,'rbac.jar')
  writeFileSync(amisJar,'synthetic-amis');writeFileSync(rbacJar,'synthetic-rbac')
  const selected={rootCommit:'a'.repeat(40),hostCommit:'b'.repeat(40),amisCommit:'c'.repeat(40),rbacCommit:'d'.repeat(40),
    hostImage:'ghcr.io/ai-specs/kestra-overlay@sha256:'+'e'.repeat(64),hostExecutableSha256:'f'.repeat(64),
    amisJar,rbacJar,amisJarSha256:sha('synthetic-amis'),rbacJarSha256:sha('synthetic-rbac'),amisReleaseDirectory:release}
  writeFileSync(join(release,'release-provenance.json'),JSON.stringify({commit:selected.amisCommit,host:{image:selected.hostImage},jarSha256:selected.amisJarSha256}))
  const owner='application-projects-bb-123-456',pg='1'.repeat(64)
  const journal={owner,created:[{kind:'container',id:pg,owner,removed:false}]}
  const executions=new Map(),events=[],fragmentsCalled=[]
  let active,env,container=1,cleanupCalls=0,readerCalls=0
  const account={username:'synthetic-manager',password:'private-synthetic-value'}
  const scopes=['scope-a']
  const actors=['allow-a','no-output','zero-grant','revoke-entry','revoke-flow','revoke-grant'].map(key=>({key,username:key,password:'private-synthetic-value',scopeKeys:key==='zero-grant'?[]:scopes}))
  const sideEffects={windowMs:5000,before:'1'.repeat(64),immediate:'1'.repeat(64),sources:['database','queue','storage'],beforeSources:{database:'2'.repeat(64),queue:'3'.repeat(64),storage:'4'.repeat(64)},samples:[{elapsedMs:5001,hash:'1'.repeat(64),sources:{database:'2'.repeat(64),queue:'3'.repeat(64),storage:'4'.repeat(64)}}]}
  function row(id){
    const before={generation:'probe',namespaceResolve:12,flowLookup:20,schemaStorage:8,flowAuthorization:17,flowMeta:19}
    const difference={namespaceResolve:0,flowLookup:0,schemaStorage:0,flowAuthorization:0,flowMeta:0}
    const firstGate=['B-page-entry-denied-zero-lookups','B-api-entry-denied-zero-lookups'].includes(id)
    if(firstGate&&mutation.deniedLookup)difference[mutation.deniedLookup]=1
    const deny={kind:'deny',completed:true,zeroLookups:firstGate&&!mutation.notFirstGate,
      before,after:{...before,...Object.fromEntries(Object.entries(difference).map(([key,value])=>[key,before[key]+value]))},
      difference,sideEffects}
    const observations=[]
    if(id==='B-page-entry-denied-zero-lookups') {
      observations.push({kind:'allow',path:'/company.amis.a/greeting/apis/greet',method:'POST',before:{...before},
        after:{...before,flowLookup:23,flowMeta:22,flowAuthorization:20},execution:{executionId:'real-positive-control'}})
      observations.push({kind:'allow-schema',path:'/company.amis.a/greeting/schemas/home',method:'GET',status:200,
        before:{...before},after:{...before,namespaceResolve:14,schemaStorage:10},completed:true,schemaType:'page'})
    }
    observations.push(deny)
    return {id,status:'passed',observations}
  }
  const client={async verifiedUiIdentity({subject}){return {subject,applicationGroupScopes:subject==='zero-grant'?[]:scopes,authorizationVersion:1}},async request(path,request={}){
    if(path==='/api/v1/main/flows'||path.includes('/flows/company2/'))assert.fail('No unauthorized company2 seed may be attempted')
    if(path==='/api/v1/main/executions/company.amis.a/greeting'){
      const marker=request.body.get('name'),id='native_'+executions.size
      executions.set(marker,{id,namespace:'company.amis.a',flowId:'greeting',state:'SUCCESS'})
      return Response.json({id,namespace:'company.amis.a',flowId:'greeting'})
    }
    if(path.startsWith('/api/v1/main/executions/')){
      const id=path.split('/').at(-1),stored=[...executions.values()].find(row=>row.id===id)
      assert(stored);return Response.json({...stored,state:{current:stored.state}})
    }
    if(path.endsWith('/pages/home'))return new Response('page',{status:200})
    if(path.endsWith('/schemas/home'))return Response.json({type:'page',title:'Published AMIS parent schema'})
    if(path.includes('/executions/')){
      const id=path.split('/').at(-1),stored=[...executions.values()].find(r=>r.id===id)
      const marker=[...executions].find(([,r])=>r.id===id)[0]
      return Response.json({version:1,status:0,resultReady:true,executionState:'SUCCESS',executionId:id,executionUrl:path,data:{message:marker}})
    }
    assert(path.endsWith('/apis/greet'),path)
    const input=JSON.parse(request.body),namespace=path.split('/')[1],id='execution_'+executions.size
    executions.set(input.name,{id,namespace,flowId:'greeting',state:'SUCCESS'})
    return Response.json({version:1,status:0,resultReady:false,executionState:'RUNNING',executionId:id,executionUrl:path+'/executions/'+id,data:{}},{status:202})
  }}
  const effects={async executionDetails(marker){return executions.has(marker)?[executions.get(marker)]:[]},async executionCount(marker){return executions.has(marker)?1:0},async executionInventory(){return [...executions.values()].map(r=>r.id)},async waitForIdle(){return {active:0}}}
  function deployment(mode){return {owner,mode,base:'http://127.0.0.1:18129',postgresContainer:pg,kestraContainer:String(++container).padStart(64,'0'),configurationSha256:'5'.repeat(64),actualMounts:[{target:'/app/libs/kestra-amis-apps.jar'}]}}
  const createEnvironment=()=>{
    env={project:owner,base:'http://127.0.0.1:18129',privateInputs:{clientSecret:'private-synthetic-value',modes:{A:{database:'application_group_acceptance_123_1'},B:{database:'application_group_acceptance_123_2'}}},probe:{snapshot:()=>({})},
      manager:{get resources(){return structuredClone(journal)},async inspect(){assert(active);return active.deployment}},
      get current(){assert(active);return active},async startPostgres(){events.push('pg')},async login(){return client},
      async useMode(mode){events.push(mode);active={mode,deployment:deployment(mode),admin:account,actors,effects};journal.created.push({kind:'container',id:active.deployment.kestraContainer,owner,removed:false})},
      async cleanup(){
        cleanupCalls++;events.push('cleanup')
        if(mutation.cleanup)throw new Error('private-synthetic-value')
        for(const r of journal.created)r.removed=true
        if(mutation.lateAttachment) {
          const folder=join(parent,'run','browser-assets','screenshots')
          const file=join(folder,readdirSync(folder)[0])
          if(mutation.lateAttachment==='missing')unlinkSync(file)
          else writeFileSync(file,'corrupted after all actual case observations')
        }
        return structuredClone(journal)
      }}
    return env
  }
  const execute=(command,args)=>{
    if(command==='python3')return JSON.stringify({version:1,entry:'index.html',assets:{}})
    if(command==='docker')return JSON.stringify([{Image:'sha256:'+'f'.repeat(64)}])
    assert.equal(command,'git')
    if(args.includes('rev-parse')) {
      const directory=args[args.indexOf('-C')+1]
      if(directory===resolve('.'))return selected.rootCommit
      const key={'kestra-overlay':'hostCommit','kestra-plugin-amis-apps':'amisCommit','kestra-plugin-rbac':'rbacCommit'}[directory.split('/').at(-1)]
      return selected[key]
    }
    if(args.includes('status'))return mutation.dirty?' M pending':''
    const key={'kestra-overlay':'hostCommit','kestra-plugin-amis-apps':'amisCommit','kestra-plugin-rbac':'rbacCommit'}[args.at(-1)]
    return `160000 commit ${mutation.gitlink?'0'.repeat(40):selected[key]}\t${args.at(-1)}`
  }
  const browser=async options=>{
    assert(options.privateFile&&!options.account)
    mkdirSync(options.outputDirectory)
    mkdirSync(join(options.outputDirectory,'diagnostics'));mkdirSync(join(options.outputDirectory,'screenshots'))
    const diagnostic=join(options.outputDirectory,'diagnostics','snapshot.json'),screenshot=join(options.outputDirectory,'screenshots','page.png')
    writeFileSync(diagnostic,JSON.stringify({synthetic:true,events:[]}));writeFileSync(screenshot,'synthetic-png')
    const report={completed:true,checks:['bookmark','production-login','canonical-page','fill-input','submit-result','refresh-page','logout','logged-out-bookmark',
      ...(options.outputDirectory.endsWith('-zero')?['next-production-login','next-zero-authority-denial','next-logout','next-logged-out-bookmark']:[])].map(id=>({id,status:'passed'}))}
    report.checks[0].evidence={diagnosticFile:{kind:'immutable-browser-diagnostics',path:diagnostic,sha256:mutation.browserHash?'0'.repeat(64):sha(readFileSync(diagnostic))},artifacts:[{path:screenshot,label:'masked-page'}]}
    executions.set(options.marker,{id:'browser_'+executions.size,namespace:'company.amis.a',flowId:'greeting',state:'SUCCESS'})
    if(mutation.browser)report.completed=false
    const reportPath=join(options.outputDirectory,'report.json');writeFileSync(reportPath,JSON.stringify(report))
    return {completed:report.completed,reportPath}
  }
  const batch=async(name,ids,options)=>{
    fragmentsCalled.push(name)
    const report={completed:true,cases:ids.map(row)}
    if(mutation.fragment===name){const index=mutation.failureIndex??0;report.completed=false;report.cases[index].status='failed';for(const item of report.cases.slice(index+1))item.status='not_run'}
    await options.persist(report)
    if(mutation.lateFragment===name){const error=new Error('late fragment persistence or restoration failure');error.report=report;throw error}
    if(!report.completed){const error=new Error('injected fragment failure');error.report=report;throw error}
    return report
  }
  const deps={ci:false,execute,createEnvironment,observerControl:async input=>{
    assert.equal(input.owner,owner);assert.equal(input.postgresContainer,pg)
    assert.equal(input.database,env.privateInputs.modes[active.mode].database)
    assert.equal(input.effects,active.effects)
    events.push('observer-'+active.mode)
    if(mutation.observer)throw new Error('Observer failed')
    return {passed:true,restored:true,synthetic:true}
  },releaseReader:()=>{readerCalls++;if(mutation.release)throw new Error('invalid release');return {syntheticAudit:true}},browser,
    fetch:async()=>new Response('',{status:401}),fragments:{
      body:async o=>{
        const name='body-'+o.mode
        fragmentsCalled.push(name)
        assert(fragmentsCalled.includes('security-'+o.mode),'Body must execute even after security batch populated cached outcomes')
        const report={completed:true,status:'passed',synthetic:true,mode:o.mode,checks:[{name:'synthetic-body-boundaries',passed:true}]}
        if(mutation.bodyFailure===o.mode){report.completed=false;report.status='failed';report.checks[0].passed=false}
        await o.persist(report)
        if(report.status==='failed'){const error=new Error('synthetic body boundary failure');error.report=report;throw error}
        return report
      },
      permission:o=>batch('permission',amisPermissionCaseIds,o),revocation:o=>batch('revocation',amisP0Cases.filter(id=>id.startsWith('B-revoke-')),o),
      security:o=>batch('security-'+o.mode,amisP0Cases.filter(id=>id[0]===o.mode&&/anonymous-api|cookie-write|same-site|body-cannot|foreign-execution|sibling-authority/.test(id)),o),
      sync:async o=>{fragmentsCalled.push('sync-'+o.mode);assert.equal(typeof o.executionInventory,'function');await o.executionInventory();await o.executionCount('p0-sync');await o.executionDetails('p0-sync');const report={completed:true,checks:[{passed:true}]};await o.persist(report);return report},
      native:async o=>{assert(o.nativeCases);const report={status:mutation.failedCompleted?'failed':'passed',completed:true,checks:[{status:mutation.failedChild?'failed':'passed'}]};await o.persist(report);return report},
      assets:async o=>{assert(o.expectedPublishedAssets);const report={status:'passed',checks:[{status:'passed'}]};await o.persist(report);return report},
      fault:o=>batch('fault-'+o.mode,amisP0Cases.filter(id=>id[0]===o.mode&&/missing-and-disabled|faulted-route-provider|faulted-authorization/.test(id)),o)
    }}
  const options={synthetic:true,directory:join(parent,'run'),rootDirectory:resolve('.'),selected,probeJar:'/explicit/probe.jar',port:18129,
    browser:{driver:'ego',spaceId:23,pageLabel:'p1'},zeroGrantDenialText:'Access denied',expected:{nativeCases:{A:[{explicit:true}],B:[{explicit:true}]},faultStatuses:{A:{explicit:503},B:{explicit:503}}}}
  return {options,deps,events,fragmentsCalled,get cleanupCalls(){return cleanupCalls},get readerCalls(){return readerCalls}}
}

test('synthetic full dispatcher maps 44 actual fragment outcomes, preserves order and cleans in finally',async t=>{
  const f=setup(t)
  const result=await runAmisP0(f.options,f.deps)
  assert.equal(result.status,'schema-validated');assert.equal(result.synthetic,true)
  const report=JSON.parse(readFileSync(result.reportPath))
  assert.deepEqual(report.cases.map(r=>r.id),amisP0Cases)
  assert.equal(report.summary.passed,44);assert(report.resources.created.every(r=>r.removed))
  assert(report.browserAttachments.length>=2)
  for(const reference of report.browserAttachments)assert.equal(sha(readFileSync(join(f.options.directory,reference.path))),reference.sha256)
  assert(report.cases[0].evidence.some(ref=>ref.path.startsWith('browser-assets/')))
  const ownerReference=report.cases[0].evidence.find(ref=>ref.path.startsWith('evidence/inspected-owner-'))
  assert(ownerReference,'Actual owner inspection must be registered on the login case')
  assert.equal(sha(readFileSync(join(f.options.directory,ownerReference.path))),ownerReference.sha256)
  assert.notEqual(report.verifiedTransportEvidence.productionLogin.path,report.verifiedTransportEvidence.inspectedOwner.path)
  for(const reference of Object.values(report.verifiedTransportEvidence))assert(report.cases.some(row=>row.evidence.some(item=>item.path===reference.path&&item.sha256===reference.sha256)))
  assert.equal(f.cleanupCalls,1);assert.equal(f.events.filter(e=>e==='pg').length,1)
  assert.deepEqual(f.events.filter(e=>['A','B'].includes(e)),['A','B','A','B'])
  assert.deepEqual(f.events.filter(e=>e.startsWith('observer-')),['observer-A','observer-B','observer-A','observer-B'])
  for(const name of ['permission','revocation','security-A','security-B','sync-A','sync-B','fault-A','fault-B','body-A','body-B'])assert(f.fragmentsCalled.includes(name),name)
  assert.equal(f.readerCalls,1)
})

test('fragment failure retains completed prefix, actual partial fragment and remaining notRun, then cleans',async t=>{
  const f=setup(t,{fragment:'permission'})
  await assert.rejects(runAmisP0(f.options,f.deps),/driver failed/)
  assert.equal(f.cleanupCalls,1)
  const report=JSON.parse(readFileSync(join(f.options.directory,'evidence/report-final.json')))
  assert.equal(report.status,'failed');assert(report.summary.passed>0);assert(report.summary.notRun>0)
  assert.equal(report.cases.find(r=>r.id==='B-page-entry-denied-zero-lookups').status,'failed')
})

test('release, jar and committed gitlink failures occur before service construction',async t=>{
  for(const mutation of [{release:true},{gitlink:true},{jar:true}]){
    const f=setup(t,mutation)
    if(mutation.jar)writeFileSync(f.options.selected.amisJar,'changed')
    await assert.rejects(runAmisP0(f.options,f.deps))
    assert.equal(f.cleanupCalls,0);assert.equal(f.events.length,0)
    const initial=JSON.parse(readFileSync(join(f.options.directory,'bootstrap-report.json')))
    assert(initial.cases.every(r=>r.status==='notRun'))
  }
})

test('cleanup failure never yields passed and missing browser never receives a default pass',async t=>{
  for(const mutation of [{cleanup:true},{browser:true}]){
    const f=setup(t,mutation)
    await assert.rejects(runAmisP0(f.options,f.deps))
    assert.equal(f.cleanupCalls,1)
    assert.equal(JSON.parse(readFileSync(join(f.options.directory,'evidence/report-final.json'))).status,'failed')
    assert(!readFileSync(join(f.options.directory,'driver-failure.json'),'utf8').includes('private-synthetic-value'))
  }
})

test('test injection cannot masquerade as a production pass and dirty checkout needs local opt in',async t=>{
  const f=setup(t);f.options.synthetic=false
  await assert.rejects(runAmisP0(f.options,f.deps),/synthetic/)
  const dirty=setup(t,{dirty:true})
  await assert.rejects(runAmisP0(dirty.options,dirty.deps))
  const allowed=setup(t,{dirty:true});allowed.options.allowDirty=true
  const result=await runAmisP0(allowed.options,allowed.deps)
  assert.equal(result.status,'schema-validated')
})

test('local pending gitlinks require explicit dirty opt-in and are recorded as uncommitted source pins',async t=>{
  const f=setup(t,{dirty:true,gitlink:true});f.options.allowDirty=true
  const result=await runAmisP0(f.options,f.deps)
  const report=JSON.parse(readFileSync(result.reportPath))
  assert.equal(report.sourceState.dirty,true)
  assert(report.sourceState.gitlinks.every(pin=>pin.origin==='local-uncommitted-submodule-head'))
  assert.equal(report.status,'schema-validated')
})

test('CI refuses dirty or pending pins even when local opt-in is set',async t=>{
  for(const mutation of [{dirty:true},{dirty:true,gitlink:true}]){
    const f=setup(t,mutation);f.options.allowDirty=true;f.deps.ci=true
    await assert.rejects(runAmisP0(f.options,f.deps))
    assert.equal(f.cleanupCalls,0);assert.equal(f.events.length,0)
  }
})

test('failed status wins over completed true and corrupted browser attachment hashes fail closed',async t=>{
  for(const mutation of [{failedCompleted:true},{failedChild:true},{browserHash:true},{observer:true}]){
    const f=setup(t,mutation)
    await assert.rejects(runAmisP0(f.options,f.deps))
    assert.equal(f.cleanupCalls,1)
    const report=JSON.parse(readFileSync(join(f.options.directory,'report.json')))
    assert.equal(report.status,'failed')
    if(mutation.failedCompleted)assert.equal(report.cases.find(r=>r.id==='A-native-controller-static-oauth-and-alias-precedence').status,'failed')
  }
})

test('partial batch final matrix preserves actual future failure and notRun rather than inventing display-order execution',async t=>{
  const f=setup(t,{fragment:'permission',failureIndex:2})
  await assert.rejects(runAmisP0(f.options,f.deps))
  const report=JSON.parse(readFileSync(join(f.options.directory,'report.json')))
  assert.equal(report.cases.find(r=>r.id==='B-page-entry-denied-zero-lookups').status,'passed')
  assert.equal(report.cases.find(r=>r.id==='B-api-entry-denied-zero-lookups').status,'passed')
  assert.equal(report.cases.find(r=>r.id==='B-flow-only-entry-denied').status,'failed')
  assert.equal(report.cases.find(r=>r.id==='B-entry-only-missing-target-404').status,'notRun')
  assert.equal(f.cleanupCalls,1)
})

test('real fault fragment rejects missing exact caller expectations before making any HTTP request',async t=>{
  const f=setup(t)
  delete f.deps.fragments.fault
  await assert.rejects(runAmisP0(f.options,f.deps))
  assert.equal(f.cleanupCalls,1)
  const report=JSON.parse(readFileSync(join(f.options.directory,'report.json')))
  assert.equal(report.cases.find(r=>r.id==='B-missing-duplicate-and-faulted-authorization-fail-closed').status,'failed')
  assert(report.cases.some(r=>r.status==='notRun'))
})

test('late corrupt or missing attachment preserves the complete actual matrix as failed before throwing',async t=>{
  for(const lateAttachment of ['corrupt','missing']) {
    const f=setup(t,{lateAttachment})
    await assert.rejects(runAmisP0(f.options,f.deps),/driver failed/)
    assert.equal(f.cleanupCalls,1)
    assert.equal(f.events.at(-1),'cleanup')
    const report=JSON.parse(readFileSync(join(f.options.directory,'report.json')))
    assert.equal(report.status,'failed');assert.equal(report.completed,false)
    assert.deepEqual(report.cases.map(row=>row.id),amisP0Cases)
    assert.equal(report.cases.length,44)
    assert(report.cases.every(row=>row.status==='passed'),'Actual successful observations must not be lost or rewritten as unexecuted')
    assert(report.resources.created.every(resource=>resource.removed))
    assert(report.browserAttachments.length>0)
    assert(report.validationFailures.some(failure=>failure.stage==='final-report-validation'))
    const failure=report.validationFailures.find(failure=>failure.stage==='final-report-validation')
    if(lateAttachment==='missing')assert.equal(failure.code,'ENOENT')
    else assert.match(failure.message,/attachment hash differs/)
    const diagnostic=JSON.parse(readFileSync(join(f.options.directory,'driver-failure.json')))
    assert.equal(diagnostic.status,'failed')
    assert.deepEqual(diagnostic.validationFailures,report.validationFailures)
    assert(!JSON.stringify(diagnostic).includes('private-synthetic-value'))
  }
})

test('late fragment error cannot be swallowed even when all its rows report passed',async t=>{
  const f=setup(t,{lateFragment:'permission'})
  await assert.rejects(runAmisP0(f.options,f.deps),/driver failed/)
  assert.equal(f.cleanupCalls,1)
  const report=JSON.parse(readFileSync(join(f.options.directory,'report.json')))
  assert.equal(report.status,'failed');assert.equal(report.completed,false)
  for(const id of amisPermissionCaseIds)assert.equal(report.cases.find(row=>row.id===id).status,'passed')
  assert.equal(JSON.parse(readFileSync(join(f.options.directory,'evidence/report-final.json'))).status,'failed')
})

test('caller manifest cannot replace the actual formal jar manifest',async t=>{
  const f=setup(t);f.options.expectedPublishedAssets={version:1,entry:'forged.html',assets:{}}
  await assert.rejects(runAmisP0(f.options,f.deps))
  assert.equal(f.events.length,0);assert.equal(f.cleanupCalls,0)
})

test('mixed permission observations retain nonzero positive controls while projecting only first-gate deny deltas',async t=>{
  const f=setup(t)
  const result=await runAmisP0(f.options,f.deps)
  const report=JSON.parse(readFileSync(result.reportPath))
  assert.equal(report.status,'schema-validated')
  const first=report.cases.find(row=>row.id==='B-page-entry-denied-zero-lookups')
  assert.deepEqual(first.lookups,{namespace:0,flow:0,schema:0,flowAuthorization:0})
  const evidence=first.evidence.find(reference=>reference.path.startsWith('evidence/case-B-page-entry-denied-zero-lookups-'))
  const observed=JSON.parse(readFileSync(join(f.options.directory,evidence.path))).observation
  assert.deepEqual(observed.observations.map(row=>row.kind),['allow','allow-schema','deny'])
  const [allow,schema,deny]=observed.observations
  assert.equal(allow.completed,undefined,'Actual API positive control does not carry denial completed flag')
  for(const key of ['flowLookup','flowMeta','flowAuthorization'])assert(allow.after[key]>allow.before[key])
  for(const key of ['namespaceResolve','schemaStorage'])assert(schema.after[key]>schema.before[key])
  assert(Object.values(deny.before).filter(value=>typeof value==='number').every(value=>value>0))
  assert.equal(deny.zeroLookups,true)
  assert(Object.values(deny.difference).every(value=>value===0))
})

test('nonzero deny delta or missing first-gate binding still fails mixed positive-control projection',async t=>{
  const mutations=['namespaceResolve','flowLookup','schemaStorage','flowAuthorization','flowMeta'].map(deniedLookup=>({deniedLookup}))
  for(const mutation of [...mutations,{notFirstGate:true}]) {
    const f=setup(t,mutation)
    await assert.rejects(runAmisP0(f.options,f.deps),/driver failed/)
    assert.equal(f.cleanupCalls,1)
    const report=JSON.parse(readFileSync(join(f.options.directory,'report.json')))
    assert.equal(report.status,'failed')
    const incremental=JSON.parse(readFileSync(join(f.options.directory,'evidence/report-final.json')))
    assert.equal(incremental.cases.find(row=>row.id==='B-page-entry-denied-zero-lookups').status,'failed')
    const evidence=readFileSync(join(f.options.directory,'driver-failure.json'),'utf8')
    assert(!evidence.includes('private-synthetic-value'))
  }
})

test('cached cookie cases still execute and persist each mode body boundary exactly once',async t=>{
  const f=setup(t),result=await runAmisP0(f.options,f.deps)
  const report=JSON.parse(readFileSync(result.reportPath))
  assert.deepEqual(report.cases.map(row=>row.id),amisP0Cases)
  assert.equal(report.cases.length,44)
  for(const mode of ['A','B']) {
    assert.equal(f.fragmentsCalled.filter(name=>name==='body-'+mode).length,1)
    const row=report.cases.find(row=>row.id===mode+'-cookie-write-missing-and-invalid-csrf')
    assert.equal(row.status,'passed')
    const reference=row.evidence.find(item=>item.path.startsWith('evidence/fragment-'+mode+'-body-boundaries-'))
    assert(reference,'Cookie case must register its actual persisted body boundary report')
    const body=JSON.parse(readFileSync(join(f.options.directory,reference.path))).report
    assert.equal(body.status,'passed');assert.equal(body.completed,true)
    assert.equal(body.mode,mode);assert.equal(body.synthetic,true)
  }
})

test('body boundary failure rejects already cached cookie case and retains failed body evidence',async t=>{
  for(const mode of ['A','B']) {
    const f=setup(t,{bodyFailure:mode})
    await assert.rejects(runAmisP0(f.options,f.deps))
    assert.equal(f.cleanupCalls,1)
    assert.equal(f.fragmentsCalled.filter(name=>name==='body-'+mode).length,1)
    const incremental=JSON.parse(readFileSync(join(f.options.directory,'evidence/report-final.json')))
    assert.equal(incremental.status,'failed')
    assert.equal(incremental.cases.find(row=>row.id===mode+'-cookie-write-missing-and-invalid-csrf').status,'failed')
    const report=JSON.parse(readFileSync(join(f.options.directory,'report.json')))
    assert.equal(report.status,'failed')
    assert.equal(report.cases.find(row=>row.id===mode+'-cookie-write-missing-and-invalid-csrf').status,'failed')
    const logs=JSON.parse(readFileSync(join(f.options.directory,'execution-order.json')))
    assert(logs.some(event=>event.fragment===mode+'-body-boundaries'&&event.phase==='fragment-snapshot'))
  }
})
