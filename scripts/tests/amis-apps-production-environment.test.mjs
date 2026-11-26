import assert from 'node:assert/strict'
import test from 'node:test'
import {createHash} from 'node:crypto'
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {createAmisProductionEnvironment} from '../amis-apps-production-environment.mjs'
import {AmisSideEffects} from '../amis-apps-effects.mjs'

// Synthetic transports: no Docker, SQL or production identity is used.
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
function setup(t, config = {}) {
  mkdirSync('.work',{recursive:true})
  const parent=mkdtempSync(resolve('.work/production-env-unit-'))
  t.after(()=>rmSync(parent,{recursive:true}))
  const amisJar=join(parent,'amis.jar'),rbacJar=join(parent,'rbac.jar')
  writeFileSync(amisJar,'amis');writeFileSync(rbacJar,'rbac')
  const selected={amisJar,rbacJar,amisJarSha256:sha('amis'),rbacJarSha256:sha('rbac'),hostExecutableSha256:'d'.repeat(64),hostImage:'ghcr.io/ai-specs/kestra-overlay@sha256:'+'a'.repeat(64)}
  const containers=new Map(),volumes=new Map(),networks=new Map(),dbs=new Map(),files=new Map(),flows=new Map(),queries=[],identities=[]
  let owner,base,count=0,foreign=false,wrongDb=false
  const inspect=args=>({stdout:JSON.stringify([containers.get(args[1])])})
  const managerRunner=async(command,args,{input}={})=>{
    assert.equal(command,'docker')
    if(args[0]==='inspect')return inspect(args)
    if(args[0]==='ps')return {stdout:args.some(x=>x.startsWith('ancestor='))?'':[...containers.keys()].join('\n')}
    if(args[0]==='rm'){containers.delete(args.at(-1));return {stdout:''}}
    if(['volume','network'].includes(args[0])) {
      const map=args[0]==='volume'?volumes:networks
      if(args[1]==='ls')return {stdout:[...map.keys()].join('\n')}
      if(args[1]==='inspect')return {stdout:JSON.stringify([map.get(args[2])])}
      if(args[1]==='rm'){map.delete(args[2]);return {stdout:''}}
    }
    if(args[0]==='exec') {
      if(input.startsWith('CREATE')){const name=/CREATE DATABASE "([^"]+)"/.exec(input)[1];assert(!dbs.has(name));dbs.set(name,{owner:'kestra',comment:owner});return {stdout:''}}
      return {stdout:JSON.stringify(dbs.get(/datname='([^']+)'/.exec(input)[1]))}
    }
    assert.equal(args[0],'compose')
    const raw=JSON.parse(readFileSync(args[args.indexOf('-f')+1]))
    const service=args.at(-1)
    if(args.includes('up')) {
      for(const [kind,map] of [['volumes',volumes],['networks',networks]])for(const value of Object.values(raw[kind])) {
        if(kind==='networks'||raw.services[service].volumes.some(v=>v.source===value.name))map.set(value.name,{Name:value.name,Labels:{owner,'com.docker.compose.project':owner}})
      }
      const id=(++count).toString(16).padStart(64,'0'),s=raw.services[service]
      containers.set(id,{Id:id,Config:{Image:s.image,Labels:{owner,'com.docker.compose.project':owner,'com.docker.compose.service':service},
        Env:Object.entries(s.environment).map(([k,v])=>k+'='+String(v).split('$$').join('$'))},State:{Running:true,Health:{Status:'healthy'}},
        NetworkSettings:{Ports:service==='kestra'?{'8080/tcp':[{HostIp:'127.0.0.1',HostPort:'18129'}]}:{}},
        Mounts:s.volumes.map(v=>({Type:v.type,Source:v.source,Name:v.type==='volume'?v.source:undefined,Destination:v.target,RW:!v.read_only}))})
      return {stdout:''}
    }
    if(args.includes('ps'))return {stdout:[...containers.values()].find(c=>c.Config.Labels['com.docker.compose.service']===service)?.Id??''}
    assert(args.includes('config'));return {stdout:''}
  }
  const execFileSync=(command,args,options)=>{
    assert.equal(command,'docker')
    if(args[0]==='compose') {
      owner=args[args.indexOf('-p')+1];base='http://127.0.0.1:18129'
      const password=options.env.POSTGRES_PASSWORD
      const raw={services:{postgres:{image:'postgres:18',environment:{POSTGRES_DB:'kestra',POSTGRES_USER:'kestra',POSTGRES_PASSWORD:password},volumes:[]},
        kestra:{environment:{KESTRA_CONFIGURATION:`datasources:\n  postgres:\n    url: jdbc:postgresql://postgres:5432/kestra\n    password: ${password}\nkestra:\n  rbac:\n    enabled: false\n    evaluation:\n      enabled: false\n    application-groups:\n      enabled: false\n  oidc:\n    issuer: http://localhost:8080\nmicronaut:\n  security:\n    oauth2:\n      clients:\n        kestra:\n          scopes: [openid, profile, email]\n`},volumes:[]}}}
      if(config.escapedClientSecret) {
        raw.services.kestra.environment.KESTRA_CONFIGURATION+='          client-secret: $${KESTRA_OIDC_UI_CLIENT_SECRET}\n'
        raw.services.kestra.environment.KESTRA_OIDC_UI_CLIENT_SECRET=options.env.KESTRA_OIDC_UI_CLIENT_SECRET
      }
      return JSON.stringify(raw)
    }
    assert.equal(args[0],'exec')
    if(args.includes('test'))return ''
    assert(args.includes('sha256sum'))
    const path=args.at(-1)
    return (path==='/app/kestra'?selected.hostExecutableSha256:path.endsWith('kestra-amis-apps.jar')?selected.amisJarSha256:selected.rbacJarSha256)+' '+path
  }
  const effectsRunner=(command,args)=>{
    assert.equal(command,'docker')
    if(args[0]==='inspect'){
      const result=structuredClone(containers.get(args[1]));assert(result,'stale container ID')
      if(foreign)result.Config.Labels.owner='foreign'
      return {stdout:JSON.stringify([result])}
    }
    if(args.includes('sh'))return {stdout:'/app/storage/schema.json\nabc /app/storage/schema.json'}
    const db=args[args.indexOf('-d')+1],sql=args.at(-1);assert(dbs.has(db));queries.push({db,sql})
    let result
    const names=['flows','executions','execution_queued','namespace_file_metadata','kv_metadata','execution_outputs','queues']
    if(sql.includes('information_schema'))result=names.flatMap(table=>[{table,column:'value',type:table==='execution_outputs'?'bytea':'jsonb'},...(table==='queues'?[{table,column:'type',type:'varchar'},{table,column:'offset',type:'int8'},{table,column:'created',type:'timestamp'}]:[])])
    else if(sql.includes("'digest'")) {
      assert(sql.includes('min("offset")::text'))
      assert(sql.includes('min(created)::text'))
      const predicates=[...sql.matchAll(/WHERE (.*?)\) (?:observed_rows|metadata_rows)/g)].map(match=>match[1])
      assert.equal(predicates.length,2)
      assert.equal(predicates[0],predicates[1],'Queue digest and diagnostics must observe the same rows')
      result={...Object.fromEntries(names.map(n=>[n,{count:0,digest:'e'.repeat(64)}])),
        queues:{count:1,digest:'f'.repeat(64)},
        queueDiagnostics:[{type:'flow_event',count:1,minOffset:'1',maxOffset:'1',
          minCreated:'2026-11-26T00:00:00Z',maxCreated:'2026-11-26T00:00:00Z',digest:'a'.repeat(64)}]}
    }
    else result=0
    return {stdout:JSON.stringify({database:wrongDb?'kestra':db,result})}
  }
  const clientFactory=()=>({
    async login(){return {authenticated:true,credentialsSubmitted:true}},
    async verifiedUiIdentity(expected){identities.push(expected);return {applicationGroupScopes:['admin']}},
    async request(path,options={}) {
      if(path==='/oidc/logout')return new Response('',{status:200})
      if(path.includes('/files?')) {
        if(options.method==='POST'){files.set(path,await options.body.get('fileContent').text());return new Response('',{status:200})}
        return new Response(files.get(path),{status:200})
      }
      if(path==='/api/v1/main/flows'){
        const id=/^id: (.+)$/m.exec(options.body)[1],namespace=/^namespace: (.+)$/m.exec(options.body)[1],saved={id,namespace,revision:1}
        flows.set(namespace+'/'+id,saved);return Response.json(saved)
      }
      assert(path.startsWith('/api/v1/main/flows/'));return Response.json(flows.get(path.slice('/api/v1/main/flows/'.length)))
    }
  })
  const env=createAmisProductionEnvironment({directory:join(parent,'run'),rootDirectory:resolve('.'),selected,
    transport:{execFileSync,managerRunner,effectsRunner,clientFactory,fetch:async()=>Response.json({issuer:base}),
      provisionActors:async()=>({private:{actors:[]},public:{transport:'explicit-test-double'}})}})
  return {env,queries,files,flows,identities,containers,foreign:()=>{foreign=true},wrongDb:()=>{wrongDb=true}}
}

test('environment wires whole DB observer from live journal through A/B/A and app reconfigure',async t=>{
  const f=setup(t)
  // Keep real schema/ownership snapshots; independent effects tests cover timed windows.
  t.mock.method(AmisSideEffects.prototype,'waitForStable',async function(){return {snapshot:this.snapshot()}})
  await f.env.startPostgres()
  const a=await f.env.useMode('A');assert(a.effects instanceof AmisSideEffects)
  const assertQueueRetention=deployment=>{
    const entries=f.containers.get(deployment.kestraContainer).Config.Env
    const configurations=entries.filter(entry=>entry.startsWith('KESTRA_CONFIGURATION='))
    assert.equal(configurations.length,1)
    const configuration=configurations[0].slice('KESTRA_CONFIGURATION='.length)
    const kestra=/^kestra:\n((?:[ \t].*\n|\n)*)/m.exec(configuration)?.[1]
    const micronaut=/^micronaut:\n((?:[ \t].*\n|\n)*)/m.exec(configuration)?.[1]
    assert.match(kestra,/^  jdbc:\n    queue:\n      cleaner:\n        retention: 24h$/m)
    assert.equal((configuration.match(/retention: 24h/g)??[]).length,1)
    assert.deepEqual(entries.filter(entry=>entry.startsWith('KESTRA_JDBC_QUEUE_CLEANER_RETENTION=')),
      ['KESTRA_JDBC_QUEUE_CLEANER_RETENTION=24h'])
    assert.doesNotMatch(micronaut,/retention|cleaner/)
    assert.doesNotMatch(configuration,/initial-delay|fixed-delay|cleaner:\n\s+enabled: false/)
    assert(!entries.some(entry=>/^KESTRA_JDBC_QUEUE_CLEANER_(INITIAL_DELAY|FIXED_DELAY|ENABLED)=/.test(entry)))
  }
  assertQueueRetention(a.deployment)
  const initialSnapshot=a.effects.snapshot()
  assert.equal(initialSnapshot.counts.queues,1)
  assert.equal(initialSnapshot.queueDiagnostics[0].minOffset,'1')
  assert.equal(initialSnapshot.queueDiagnostics[0].minCreated,'2026-11-26T00:00:00Z')
  const aDb=f.queries.at(-1).db,aId=a.deployment.kestraContainer
  assert(f.files.size===3&&f.flows.size===9)
  const filesBefore=f.files.size
  await f.env.reconfigure({amisEnabled:false})
  assertQueueRetention(f.env.current.deployment)
  assert.notEqual(f.env.current.deployment.kestraContainer,aId)
  f.env.current.effects.snapshot()
  const b=await f.env.useMode('B');const bDb=f.queries.at(-1).db
  assertQueueRetention(b.deployment)
  assert.notEqual(aDb,bDb);assert(f.identities.length>0)
  const returned=await f.env.useMode('A');returned.effects.snapshot()
  assertQueueRetention(returned.deployment)
  assert.equal(f.queries.at(-1).db,aDb);assert.equal(f.files.size,filesBefore)
  const journal=f.env.manager.resources
  assert(journal.created.some(r=>r.kind==='database'&&r.id===aDb&&r.mode==='A'&&!r.removed))
  assert(journal.created.some(r=>r.kind==='database'&&r.id===bDb&&r.mode==='B'&&!r.removed))
  assert(f.queries.some(q=>q.sql.includes('public.namespace_file_metadata')))
  assert(f.queries.every(q=>!q.sql.includes("LIKE 'company.amis")))
  await f.env.manager.cleanup()
})

test('live owner and database mismatches fail the wired observer instead of becoming empty effects',async t=>{
  const f=setup(t)
  t.mock.method(AmisSideEffects.prototype,'waitForStable',async function(){return {snapshot:this.snapshot()}})
  await f.env.startPostgres();await f.env.useMode('A')
  f.wrongDb();assert.throws(()=>f.env.current.effects.snapshot(),/Actual database differs/)
  f.foreign();assert.throws(()=>f.env.current.effects.snapshot(),/Foreign owner/)
  await f.env.manager.cleanup()
})

test('mode observer requires actual database journal record with the matching mode',async t=>{
  for(const missing of [true,false]) {
    const f=setup(t)
    t.mock.method(AmisSideEffects.prototype,'waitForStable',async function(){return {snapshot:this.snapshot()}})
    await f.env.startPostgres()
    const manager=f.env.manager
    const descriptor=Object.getOwnPropertyDescriptor(manager,'resources')
    Object.defineProperty(manager,'resources',{configurable:true,get(){
      const journal=descriptor.get.call(manager)
      if(missing)journal.created=journal.created.filter(r=>r.kind!=='database')
      else for(const record of journal.created)if(record.kind==='database')record.mode='B'
      return journal
    }})
    await assert.rejects(f.env.useMode('A'),missing?/absent from manager journal/:/belongs to another mode/)
    assert.equal(f.files.size,0,'Seed must not begin without the live database journal proof')
    Object.defineProperty(manager,'resources',descriptor)
    await manager.cleanup()
  }
})

test('first Compose escaped client-secret placeholder is normalized exactly once through A/B/restoration',async t=>{
  const f=setup(t,{escapedClientSecret:true})
  t.mock.method(AmisSideEffects.prototype,'waitForStable',async function(){return {snapshot:this.snapshot()}})
  await f.env.startPostgres()
  const expectedSecret=f.env.privateInputs.clientSecret
  function verify(deployment) {
    const environment=f.containers.get(deployment.kestraContainer).Config.Env
    const configuration=environment.filter(entry=>entry.startsWith('KESTRA_CONFIGURATION='))
    assert.equal(configuration.length,1)
    const text=configuration[0].slice('KESTRA_CONFIGURATION='.length)
    assert.equal(text.split('client-secret: ${KESTRA_OIDC_UI_CLIENT_SECRET}').length-1,1)
    assert(!text.includes('$${KESTRA_OIDC_UI_CLIENT_SECRET}'))
    assert(!text.includes(expectedSecret),'Client secret must remain a runtime placeholder in configuration')
    const secretEntries=environment.filter(entry=>entry.startsWith('KESTRA_OIDC_UI_CLIENT_SECRET='))
    assert.equal(secretEntries.length,1)
    assert.equal(secretEntries[0].slice('KESTRA_OIDC_UI_CLIENT_SECRET='.length),expectedSecret)
  }
  const a=await f.env.useMode('A');verify(a.deployment)
  const b=await f.env.useMode('B');verify(b.deployment)
  assert(f.identities.some(identity=>identity.subject===b.admin.username),'Mode B signed manager verification remains required')
  verify(await f.env.reconfigure({amisEnabled:false}))
  verify(await f.env.reconfigure({}))
  verify((await f.env.useMode('A')).deployment)
  assert.equal(f.env.privateInputs.clientSecret,expectedSecret)
  await f.env.manager.cleanup()
})
