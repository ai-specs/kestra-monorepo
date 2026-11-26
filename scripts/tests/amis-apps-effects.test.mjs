import assert from 'node:assert/strict'
import test from 'node:test'
import {createHash} from 'node:crypto'
import {AmisSideEffects, amisQueuePredicate} from '../amis-apps-effects.mjs'

const owner = 'application-projects-bb-123-456', pg = 'a'.repeat(64), app = 'b'.repeat(64)
const database = 'application_group_acceptance_123_456'
const names = ['flows','executions','execution_queued','namespace_file_metadata','kv_metadata','execution_outputs','queues']
const digest = value => createHash('sha256').update(value).digest('hex')
const journal = {owner, created: [['container', pg], ['container', app], ['database', database], ['volume', 'owned-storage']]
  .map(([kind,id]) => ({kind,id,owner,removed:false}))}
function fixture(options = {}) {
  const state = {rows: Object.fromEntries(names.map(name => [name, []])), storage: '/app/storage/parent/schema.json\nabcdef /app/storage/parent/schema.json', idle: 0,
    owner, actualDatabase: database, missing: undefined, observerError: false}
  const calls = []
  const runner = (command, args) => {
    assert.equal(command, 'docker'); calls.push(args)
    if (state.observerError) throw new Error('password=not-allowed-in-report')
    if (args[0] === 'inspect') return {stdout: JSON.stringify([{Id: args[1], Config: {Image: args[1] === pg ? 'postgres:18' : 'formal-host',
      Labels: {owner:state.owner,'com.docker.compose.project':owner,'com.docker.compose.service':args[1] === pg ? 'postgres':'kestra'}},
      State:{Running:true},Mounts:[{Destination:'/app/storage',Type:'volume',Name:'owned-storage'}]}])}
    if (args.includes('sh')) {
      assert.deepEqual(args.slice(0,4), ['exec', app, 'sh', '-c'])
      assert(args[4].includes('! -path /app/storage/.oidc-installation'))
      assert(!args[4].includes('cat '))
      return {stdout:state.storage}
    }
    assert.deepEqual(args.slice(0,4), ['exec','-e','PGOPTIONS=-c default_transaction_read_only=on',pg])
    assert.equal(args[args.indexOf('-d')+1], database)
    const sql = args.at(-1)
    assert(sql.startsWith('SELECT '))
    assert(!/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE)\b/i.test(sql))
    let result
    if (sql.includes('information_schema.columns')) result = names.filter(name => name !== state.missing).flatMap(name => [
      {table:name,column:'value',type:name === 'execution_outputs'?'bytea':'jsonb'},
      ...(name === 'queues'?[{table:name,column:'type',type:'varchar'}]:[])])
    else if (sql.includes("'digest'")) {
      assert(sql.includes('row_to_json(t)::text'))
      assert(sql.includes('ORDER BY row_text COLLATE "C"'))
      assert(sql.includes('encode(sha256(convert_to('))
      assert(sql.includes(amisQueuePredicate))
      assert(!sql.includes("LIKE 'company.amis"))
      for(const name of names) assert(sql.includes('public.'+name))
      result = Object.fromEntries(names.map(name=>[name,{count:state.rows[name].length,digest:digest(JSON.stringify([...state.rows[name]].sort()))}]))
    } else if (sql.includes("'marker',value->'inputs'->'name'")) {
      assert(sql.includes('FROM public.executions'))
      assert(!sql.includes('strpos') && !sql.includes(' WHERE '))
      result = state.executionRows ?? []
      if (state.badExecutionJson) return {stdout:'not-json'}
    } else result = state.idle
    return {stdout:JSON.stringify({database:state.actualDatabase,result})}
  }
  const observer = new AmisSideEffects({owner,postgresContainer:pg,kestraContainer:app,database,journalPassed:true,journal,
    markers:['acceptance-greeting','company.amis','company2'],runner,...options})
  return {observer,state,calls}
}

test('whole-table snapshot includes parent, siblings, company2 and foreign changes; returns only hashes/counts', () => {
  const f = fixture(); const before=f.observer.snapshot()
  for(const table of names) {
    f.state.rows[table].push('private-row-company.amis-parent-company2-foreign')
    assert.notEqual(f.observer.snapshot().hash,before.hash)
    f.state.rows[table]=[]
  }
  f.state.storage+='\nnew-file';assert.notEqual(f.observer.snapshot().sources.storage,before.sources.storage)
  assert(!JSON.stringify(f.observer.snapshot()).includes('private-row'))
  assert(f.calls.filter(args=>args[0]==='inspect').length>=2)
})

test('owner, actual database and missing business table fail closed', () => {
  for(const change of ['owner','database','table']) {
    const f=fixture()
    if(change==='owner')f.state.owner='foreign'
    if(change==='database')f.state.actualDatabase='kestra'
    if(change==='table')f.state.missing='namespace_file_metadata'
    assert.throws(()=>f.observer.snapshot())
    if(change==='owner')assert(!f.calls.some(args=>args[0]==='exec'))
  }
})

test('explicit owner journal, database and container identifiers are mandatory', () => {
  for(const options of [{journalPassed:false},{journal:undefined},{owner:'user'},{database:'kestra'},
    {postgresContainer:'short'},{markers:["x';DROP"]},{project:'other'},
    {journal:{owner,created:journal.created.filter(item=>item.kind!=='volume')}}]) {
    if(options.journal?.created?.length===3) assert.throws(()=>fixture(options).observer.snapshot())
    else assert.throws(()=>fixture(options))
  }
})

test('queue exclusion is exact, identity-bearing and unknown messages remain in predicate', () => {
  assert(amisQueuePredicate.includes("type='scheduler_event'"))
  for(const type of ['REQUEST','REPLY','RELEASE','REJECTED'])assert(amisQueuePredicate.includes('VNODES_ASSIGNMENT_'+type))
  for(const field of ['namespace','flowId','executionId','tenantId'])assert(amisQueuePredicate.includes("'"+field+"'"))
  assert(amisQueuePredicate.startsWith('NOT (('));assert(amisQueuePredicate.endsWith('IS TRUE)'))
})

test('idle checks the complete isolated DB and bounds timing parameters', async () => {
  const f=fixture();assert.equal((await f.observer.waitForIdle()).active,0)
  await assert.rejects(f.observer.waitForIdle({timeoutMs:1}))
  await assert.rejects(f.observer.waitForStable({windowMs:1}))
  await assert.rejects(f.observer.observeDenied(()=>{},()=>{},{windowMs:1}))
})

test('real-time delayed no-effect sampling catches all three mutations and retains response/action failures', async () => {
  await Promise.all(['pass','database','queue','storage','response','action','stable'].map(async kind=>{
    const f=fixture()
    if(kind==='stable') {
      const stable=await f.observer.waitForStable({windowMs:5000,timeoutMs:10000,intervalMs:1000})
      assert(stable.samples.at(-1).elapsedMs>=5000)
      return
    }
    const action=async()=>{
      if(kind==='database')f.state.rows.namespace_file_metadata.push('parent-mutation')
      if(kind==='queue')f.state.rows.queues.push('company2-flow-event')
      if(kind==='storage')f.state.storage+='changed'
      if(kind==='action')throw new Error('password=do-not-save')
      return {status:403}
    }
    const verify=async response=>{assert.equal(response.status,403);if(kind==='response')throw new Error('secret=do-not-save')}
    if(kind==='pass') {
      const result=await f.observer.observeDenied(action,verify,{windowMs:5000,intervalMs:1000})
      assert(result.observation.samples.at(-1).elapsedMs>=5000)
      assert.equal(result.observation.before,result.observation.immediate)
    } else await assert.rejects(f.observer.observeDenied(action,verify,{windowMs:5000,intervalMs:1000}),error=>{
      assert(error.observation.samples.at(-1).elapsedMs>=5000)
      assert(!JSON.stringify(error).includes('do-not-save'));return true
    })
  }))
})

test('post-action observer transport failure retains partial observation without raw diagnostics', async () => {
  const f=fixture()
  await assert.rejects(f.observer.observeDenied(()=>{f.state.observerError=true;return {status:403}},()=>{}),error=>{
    assert(error.observation.before);assert.equal(error.observation.observerFailed,true)
    assert(!JSON.stringify(error).includes('not-allowed-in-report'));return true
  })
})

test('stable transport failure preserves partial observation and queue schema changes fail unsupported', async () => {
  const f=fixture();f.state.observerError=true
  await assert.rejects(f.observer.waitForStable(),error=>{
    assert.deepEqual(error.observation.samples,[])
    assert(!error.message.includes('not-allowed-in-report'));return true
  })
  const unsupported=fixture();unsupported.state.missing='queues'
  assert.throws(()=>unsupported.observer.snapshot(),/Unsupported missing public table: queues/)
})

const execution = (id, marker, flowId='flow') => ({id,namespace:'company.amis',flowId,state:'SUCCESS',marker,valid:true})
test('execution inventory covers entire DB sorted; marker matches exact inputs.name across Flow bindings',()=>{
  const f=fixture();f.state.executionRows=[execution('z','exact','other'),execution('b','exact-prefix'),execution('a','exact'),execution('foreign',null)]
  assert.deepEqual(f.observer.executionInventory(),['a','b','foreign','z'])
  assert.deepEqual(f.observer.executionDetails('exact'),[
    {id:'a',namespace:'company.amis',flowId:'flow',state:'SUCCESS'},
    {id:'z',namespace:'company.amis',flowId:'other',state:'SUCCESS'},
  ])
  assert.equal(f.observer.executionCount('exact'),2)
  assert.deepEqual(f.observer.executionDetails('missing'),[])
  const queries=f.calls.filter(args=>args.at(-1)?.includes("'marker',value->'inputs'->'name'"))
  assert.equal(queries.length,4)
  assert.equal(f.calls.filter(args=>args[0]==='inspect').length,8)
  assert.equal(f.calls.filter(args=>args.at(-1)?.includes('information_schema.columns')).length,4)
})
test('each execution observer rechecks owner/schema/actual DB and rejects corrupt observations',()=>{
  for(const method of ['executionInventory','executionDetails','executionCount'])for(const change of ['owner','schema','database','json','shape','record','duplicate','unknown-state']){
    const f=fixture();f.state.executionRows=[execution('one','exact')]
    if(change==='owner')f.state.owner='foreign'
    if(change==='schema')f.state.missing='executions'
    if(change==='database')f.state.actualDatabase='kestra'
    if(change==='json')f.state.badExecutionJson=true
    if(change==='shape')f.state.executionRows={}
    if(change==='record')f.state.executionRows.push({...execution('bad','unrelated'),valid:false})
    if(change==='duplicate')f.state.executionRows.push(execution('one','unrelated'))
    if(change==='unknown-state')f.state.executionRows[0].state='UNKNOWN'
    assert.throws(()=>f.observer[method]('exact'),method+' '+change)
  }
})
test('invalid marker rejected before transport and never interpolated into SQL',()=>{
  for(const marker of [null,undefined,'',"exact'; DROP TABLE executions;--",'exact\n','a'.repeat(129),{},'exact%']){
    const f=fixture();assert.throws(()=>f.observer.executionDetails(marker));assert.throws(()=>f.observer.executionCount(marker));assert.equal(f.calls.length,0)
  }
})
test('missing binding fields and nonstring inputs.name fail even when unrelated to requested marker',()=>{
  for(const field of ['id','namespace','flowId','state','marker','valid']){
    const f=fixture();const row=execution('unrelated','other');delete row[field];f.state.executionRows=[row]
    assert.throws(()=>f.observer.executionDetails('exact'))
  }
  const f=fixture();f.state.executionRows=[execution('unrelated',{nested:'exact'})];assert.throws(()=>f.observer.executionInventory())
})
