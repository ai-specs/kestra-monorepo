import assert from 'node:assert/strict'
import test from 'node:test'
import {createHash} from 'node:crypto'
import {AmisSideEffects, amisQueuePredicate,validateAmisControlEvents,amisDispatchQueueTypes} from '../amis-apps-effects.mjs'

const controlSample=()=>({schemaVersion:1,executionIds:['execution_1'],inventory:['execution_1'],events:[{type:'async_operation_processed_event',offset:'1',created:'2026-11-26T12:00:00Z',tenantId:null,executionId:'execution_1',operationId:'operation_1',outcome:'SUCCEEDED'}]})
test('control event query returns only published binding metadata and inventory',()=>{
  const {observer,state,calls}=fixture();state.controlEvents=controlSample().events
  const value=observer.controlEvents(['execution_1'])
  assert.deepEqual(value.events,controlSample().events);assert.deepEqual(value.inventory,[])
  const sql=calls.find(args=>args.at(-1)?.includes("'operationId',CASE")).at(-1)
  assert(sql.includes("value->>'itemId'"));assert(sql.includes("value->>'executionId'"));assert(sql.includes('default_transaction_read_only')===false)
  assert(!/value->>'(?:message|error|inputs)'|row_to_json/.test(sql))
})
for(const [name,change] of [
  ['extra payload',v=>v.events[0].payload='private'],['extra error',v=>v.events[0].error='private'],
  ['unknown type',v=>v.events[0].type='unknown'],['foreign execution',v=>v.events[0].executionId='other'],
  ['foreign tenant',v=>v.events[0].tenantId='other'],['invalid outcome',v=>v.events[0].outcome='UNKNOWN'],
  ['missing operation',v=>v.events[0].operationId=null],['invalid timestamp',v=>v.events[0].created='private'],
  ['invalid offset',v=>v.events[0].offset='x'],['duplicate offset',v=>v.events.push({...v.events[0]})],
  ['extra inventory field',v=>v.payload='private'],['duplicate inventory',v=>v.inventory.push('execution_1')],
  ['wrong schema',v=>v.schemaVersion=2],['follow with outcome',v=>v.events[0].type='follow_log_event'],
])test('control event metadata rejects '+name,()=>{const value=controlSample();change(value);assert.throws(()=>validateAmisControlEvents(value,['execution_1']))})
test('control events allow explicit FAILED outcomes without error text and both follow types',()=>{
  const value=controlSample();value.events[0].outcome='FAILED'
  for(const [index,type] of ['follow_execution_event','follow_log_event'].entries())value.events.push({...value.events[0],offset:String(index+2),type,operationId:null,outcome:null})
  assert.equal(validateAmisControlEvents(value,['execution_1']).events.length,3)
  assert.throws(()=>validateAmisControlEvents(value,["bad'identity"]))
})

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
      ...(name === 'queues'?[{table:name,column:'type',type:'varchar'},{table:name,column:'offset',type:'int8'},{table:name,column:'created',type:'timestamp'}]:[])])
    else if (sql.includes("'digest'")) {
      assert(sql.includes('row_to_json(t)::text'))
      assert(sql.includes('ORDER BY row_text COLLATE "C"'))
      assert(sql.includes('encode(sha256(convert_to('))
      assert(sql.includes(amisQueuePredicate))
      assert(!sql.includes("LIKE 'company.amis"))
      for(const name of names) assert(sql.includes('public.'+name))
      result = Object.fromEntries(names.map(name=>[name,{count:state.rows[name].length,digest:digest(JSON.stringify([...state.rows[name]].sort()))}]))
      const metadata = state.rows.queues.map((row,index)=>typeof row==='string'?{type:'flow_event',offset:String(index+1),created:'2026-11-26 00:00:00'}:row)
      result.queueDiagnostics = [...new Set(metadata.map(row=>row.type))].sort().map(type=>{
        const rows=metadata.filter(row=>row.type===type), offsets=rows.map(row=>BigInt(row.offset)).sort((a,b)=>a<b?-1:a>b?1:0)
        const created=rows.map(row=>row.created).sort()
        return {type,count:rows.length,minOffset:String(offsets[0]),maxOffset:String(offsets.at(-1)),minCreated:created[0],maxCreated:created.at(-1),
          digest:digest(JSON.stringify(rows.map(({type,offset,created})=>[type,offset,created]).sort()))}
      })
      if(state.diagnosticsOverride!==undefined) result.queueDiagnostics=state.diagnosticsOverride
      // Both queue queries must use the same full predicate, without a type allowlist.
      const predicates=[...sql.matchAll(/WHERE (.*?)\) (?:observed_rows|metadata_rows)/g)].map(match=>match[1])
      assert.equal(predicates.length,2);assert.equal(predicates[0],predicates[1])
      const diagnosticSql=sql.slice(sql.indexOf("'queueDiagnostics'"))
      assert(!/\bvalue\b|\bkey\b/.test(diagnosticSql.replaceAll(predicates[1],'')))
    } else if (sql.includes("'operationId',CASE")) {
      assert(!sql.includes("value->>'message'")&&!sql.includes("value->>'error'"))
      result=state.controlEvents??[]
    } else if (sql.includes("'marker',value->'inputs'->'name'")) {
      assert(sql.includes('FROM public.executions'))
      assert(!sql.includes('strpos') && !sql.includes(' WHERE '))
      result = state.executionRows ?? []
      if (state.badExecutionJson) return {stdout:'not-json'}
    } else if(sql.includes('idle_queue_inventory')) {
      result=state.idleQueues??[]
      if(state.drainAfterRead){state.idleQueues=[];state.drainAfterRead=false}
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
      assert(['AMIS_EFFECTS_CHANGED','AMIS_RESPONSE_ASSERTION','AMIS_REQUEST_FAILED'].includes(error.code))
      assert(!JSON.stringify(error).includes('do-not-save'));return true
    })
  }))
})

test('post-action observer transport failure retains partial observation without raw diagnostics', async () => {
  const f=fixture()
  await assert.rejects(f.observer.observeDenied(()=>{f.state.observerError=true;return {status:403}},()=>{}),error=>{
    assert(error.observation.before);assert.equal(error.observation.observerFailed,true)
    assert.equal(error.code,'AMIS_OBSERVER_FAILED')
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

const queueRow = (offset,type='unknown_business') => ({type,offset:String(offset),created:`2026-11-26 00:00:${String(offset).padStart(2,'0')}`,value:'private-identity-payload',key:'private-key'})
test('queue diagnostics distinguish removal, insertion and unknown types without exposing payload or changing source hash contract',()=>{
  const f=fixture();f.state.rows.queues=[queueRow(1),queueRow(2)]
  const before=f.observer.snapshot()
  assert.equal(before.hash,digest(JSON.stringify(before.sources)))
  assert.deepEqual(Object.keys(before.sources),['database','queue','storage'])
  assert.deepEqual(before.queueDiagnostics.map(({type,count,minOffset,maxOffset,minCreated,maxCreated})=>({type,count,minOffset,maxOffset,minCreated,maxCreated})),[
    {type:'unknown_business',count:2,minOffset:'1',maxOffset:'2',minCreated:'2026-11-26 00:00:01',maxCreated:'2026-11-26 00:00:02'}])
  f.state.rows.queues.shift();const deleted=f.observer.snapshot()
  assert.equal(deleted.queueDiagnostics[0].count,1);assert.equal(deleted.queueDiagnostics[0].minOffset,'2')
  f.state.rows.queues.push(queueRow(3));const inserted=f.observer.snapshot()
  assert.equal(inserted.queueDiagnostics[0].count,2);assert.equal(inserted.queueDiagnostics[0].maxOffset,'3')
  f.state.rows.queues.push(queueRow(4,'new_unknown_type'));const unknown=f.observer.snapshot()
  assert(unknown.queueDiagnostics.some(row=>row.type==='new_unknown_type'&&row.count===1))
  for(const snapshot of [deleted,inserted,unknown])assert.notEqual(snapshot.sources.queue,before.sources.queue)
  assert(!JSON.stringify(unknown).includes('private-'))
  f.state.rows.queues[0].value='changed-private-value';const changed=f.observer.snapshot()
  assert.deepEqual(changed.queueDiagnostics,unknown.queueDiagnostics)
  assert.notEqual(changed.hash,unknown.hash,'metadata diagnostics never replace strict full-row digest')
})
test('queue diagnostic corruption fails closed',()=>{
  for(const diagnostics of [null,{},[{type:'unknown',count:1,digest:'bad'}],[]]){
    const f=fixture();f.state.rows.queues=[queueRow(1)];f.state.diagnosticsOverride=diagnostics
    assert.throws(()=>f.observer.snapshot())
  }
})
test('denied observation preserves queue diagnostics at baseline, immediate result and all samples while strict hash rejects mutations',async()=>{
  await Promise.all(['delete','insert','unknown','payload'].map(async kind=>{
    const f=fixture();f.state.rows.queues=[queueRow(1),queueRow(2)]
    await assert.rejects(f.observer.observeDenied(()=>{
      if(kind==='delete')f.state.rows.queues.shift()
      if(kind==='insert')f.state.rows.queues.push(queueRow(3))
      if(kind==='unknown')f.state.rows.queues.push(queueRow(3,'future_business_type'))
      if(kind==='payload')f.state.rows.queues[0].value='new-private-payload'
      return {status:403}
    },response=>assert.equal(response.status,403),{windowMs:5000,intervalMs:1000}),error=>{
      const o=error.observation
      assert.equal(o.beforeQueueDiagnostics[0].count,2)
      assert(Array.isArray(o.immediateQueueDiagnostics));assert(Array.isArray(o.afterQueueDiagnostics))
      assert(o.samples.length>=5);assert(o.samples.every(sample=>Array.isArray(sample.queueDiagnostics)))
      assert.notEqual(o.before,o.immediate)
      if(kind==='payload')assert.deepEqual(o.beforeQueueDiagnostics,o.immediateQueueDiagnostics)
      else assert.notDeepEqual(o.beforeQueueDiagnostics,o.immediateQueueDiagnostics)
      assert(!JSON.stringify(o).includes('private-'));return true
    })
  }))
})

for(const type of amisDispatchQueueTypes)test('idle cannot complete with pending published dispatch '+type,async()=>{
 const f=fixture();f.state.idleQueues=[{type,count:1}]
 let finished=false;const promise=f.observer.waitForIdle({intervalMs:10}).then(value=>{finished=true;return value})
 await new Promise(resolve=>setTimeout(resolve,25));assert.equal(finished,false)
 f.state.idleQueues=[];const value=await promise;assert.equal(value.active,0);assert.equal(value.dispatch,0);assert.deepEqual(value.queueInventory,[])
})
for(const rows of [[{type:'future_dispatch',count:1}],[{type:null,count:1}],[{type:'trigger_event',count:0}],[{type:'trigger_event',count:1},{type:'trigger_event',count:1}],null])test('unknown or malformed idle inventory fails closed '+JSON.stringify(rows),async()=>{
 const f=fixture();f.state.idleQueues=rows
 if(rows===null)f.state.idleQueues={}
 await assert.rejects(f.observer.waitForIdle())
})
test('retained broadcast rows do not require deletion but remain in strict queue hashes',async()=>{
 const f=fixture();f.state.idleQueues=[{type:'follow_execution_event',count:4},{type:'async_operation_processed_event',count:1}]
 const value=await f.observer.waitForIdle();assert.equal(value.dispatch,0);assert.deepEqual(value.queueInventory,f.state.idleQueues)
})
