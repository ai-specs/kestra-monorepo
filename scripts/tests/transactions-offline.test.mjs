import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {observeSecurityLockCompetition} from '../access-control-v3-transactions.mjs'

// Synthetic transport only. No PostgreSQL, Docker, HTTP, accounts or credentials.
function scenario(options={}) {
  const owner={isolated:true,exclusiveWriters:true,composeProject:'application-projects-bb-1-2',postgresComposeProject:'application-projects-bb-1-2',postgresContainer:'a'.repeat(64),database:'kestra'}
  const state={holder:false,closed:false,started:0,rollbacks:0,waitReads:0,releases:[],commands:[],ownerChecks:0}
  let applicationName
  const identity=pid=>({database:'kestra',databaseOid:'42',postmasterEpoch:'1234.5',sessionUser:'kestra',pid,backendStart:'2026-10-30 00:00:00+00',applicationName:pid===100?applicationName:'observer'})
  const holderRow=()=>({pid:100,applicationName,backendStart:identity(100).backendStart,transactionStart:'2026-10-30 00:00:01+00',virtualTransaction:'1/1',granted:true,blockers:[]})
  const waiter=(pid,blocker)=>({pid,applicationName:'PostgreSQL JDBC Driver',backendStart:'2026-10-30 00:00:00+00',transactionStart:'2026-10-30 00:00:02+00',queryStart:'2026-10-30 00:00:02+00',virtualTransaction:pid+'/2',backendXid:null,granted:false,waitEventType:'Lock',securityLockQuery:true,blockers:[blocker]})
  const child=new EventEmitter()
  child.exitCode=null
  child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter()
  child.stdin.destroy=()=>{}
  const release=()=>{state.holder=false;for(const [i,resolve]of state.releases.entries())resolve({status:i===0?200:403})}
  child.stdin.write=(text,cb)=>{
    const marker=text.match(/\\echo ([^\n]+)/)?.[1]
    const sql=text.slice(0,text.indexOf('\n\\echo'))
    state.commands.push(sql)
    let result=''
    if(sql.includes("'database',current_database()"))result=JSON.stringify({...identity(100),...(options.wrongBinding?{databaseOid:'999'}:{})})
    if(sql.startsWith('BEGIN'))state.holder=true
    if(sql==='ROLLBACK;'){state.rollbacks++;release();if(options.rollbackFailure){queueMicrotask(()=>child.stdin.emit('error',Error('synthetic pipe error')));return true}}
    queueMicrotask(()=>{child.stdout.emit('data',result+'\n'+marker+'\n');cb?.()})
    return true
  }
  child.stdin.end=()=>{if(!state.closed){state.closed=true;release();queueMicrotask(()=>child.emit('close',0))}}
  child.kill=()=>{child.stdin.end();return true}
  const query=async sql=>{
    if(sql.includes("'database',current_database()"))return JSON.stringify(identity(999))
    if(sql.includes('SELECT EXISTS'))return String(!state.closed)
    if(sql.includes('pg_terminate_backend')){child.stdin.end();return 'true'}
    if(sql.includes('FROM pg_locks')){
      if(!state.holder)return JSON.stringify(options.baselineBusy?[waiter(777,888)]:[])
      if(!state.started)return JSON.stringify([holderRow()])
      state.waitReads++
      if(options.queryTimeout)return new Promise(()=>{})
      const rows=[holderRow(),waiter(201,100)]
      if(!options.oneWaiter)rows.push(waiter(202,options.unrelatedBlocker?777:201))
      if(options.extraWaiter)rows.push(waiter(203,100))
      if(options.wrongQuery)rows[1].securityLockQuery=false
      return JSON.stringify(rows)
    }
    throw Error('unexpected SQL')
  }
  const run=index=>()=>{state.started++;if(options.early)return Promise.resolve({status:403});return new Promise(resolve=>{state.releases[index]=resolve})}
  const args={owner,query,assertOwner:async supplied=>{state.ownerChecks++;assert.deepEqual(supplied,owner)},spawnPsql:async args=>{applicationName=args.applicationName;assert.deepEqual(args.owner,owner);return child},
    requests:[{actorHash:'a'.repeat(64),targetHash:'b'.repeat(64),run:run(0)},{actorHash:'b'.repeat(64),targetHash:'a'.repeat(64),run:run(1)}],waitTimeoutMs:50,pollIntervalMs:2}
  return {state,args}
}

test('two real-shaped waiters, indirect blocker chain, release before response settlement',async()=>{
  const {args,state}=scenario();const result=await observeSecurityLockCompetition(args)
  assert.equal(result.evidence.simultaneousWaiters,2)
  assert.equal(result.evidence.association.individualActorPidMapping,false)
  assert.equal(result.evidence.release.holderAbsent,true)
  assert.deepEqual(result.results.map(row=>row.value.status),[200,403])
  assert(state.closed&&state.rollbacks===1&&state.ownerChecks>0)
  assert(state.commands.some(sql=>sql.includes("idle_in_transaction_session_timeout='4s'")))
  assert(state.commands.some(sql=>sql.includes('pg_advisory_xact_lock(1380073797)')))
})
for(const [name,options]of [
  ['one waiter cannot satisfy concurrent coverage',{oneWaiter:true}],
  ['sequential early settlement is rejected',{early:true}],
  ['unrelated third writer fails closed',{extraWaiter:true}],
  ['unrelated blocker fails closed',{unrelatedBlocker:true}],
  ['non-security SQL cannot count as waiter',{wrongQuery:true}],
  ['borrowed process on another database is rejected',{wrongBinding:true}],
])test(name,async()=>{
  const {args,state}=scenario(options)
  await assert.rejects(observeSecurityLockCompetition(args))
  assert(state.closed,'owned observer process must close on failure')
  assert.equal(state.holder,false)
  assert.equal(state.rollbacks,1)
})
test('pre-existing security holder/waiter rejected before spawning or requesting',async()=>{
  const {args,state}=scenario({baselineBusy:true})
  await assert.rejects(observeSecurityLockCompetition(args),/already has an unrelated/)
  assert.equal(state.started,0);assert.deepEqual(state.commands,[])
})
test('invalid ownership rejected without spawning or requests',async()=>{
  const {args,state}=scenario();args.owner.isolated=false
  await assert.rejects(observeSecurityLockCompetition(args))
  assert.equal(state.started,0);assert.deepEqual(state.commands,[])
})

test('rollback transport failure remains failed even when close releases the holder',async()=>{
  const {args,state}=scenario({rollbackFailure:true})
  await assert.rejects(observeSecurityLockCompetition(args),/rollback failed/)
  assert(state.closed);assert.equal(state.holder,false)
})
test('observer query timeout releases holder and drains pending requests',async()=>{
  const {args,state}=scenario({queryTimeout:true})
  await assert.rejects(observeSecurityLockCompetition(args),/timeout: query/)
  assert(state.closed);assert.equal(state.rollbacks,1);assert.equal(state.holder,false)
})
test('early completed requests retain pre-cleanup timing and settled flags without exposing raw response text',async()=>{
  const {args}=scenario({early:true});let failure
  try{await observeSecurityLockCompetition(args)}catch(error){failure=error}
  assert(failure);assert.equal(failure.evidence.earlyRequestSettledBeforeTwoWaiters,true)
  assert.equal(failure.evidence.failurePhase,'validate-two-waiters')
  assert(failure.evidence.settledAtFailure.some(Boolean));assert(Number.isFinite(failure.evidence.elapsedToFailureMs))
  assert.equal(failure.evidence.requestTimings.length,2)
  for(const row of failure.evidence.requestTimings){assert(Number.isFinite(row.startedAfterMs));assert(Number.isFinite(row.settledAfterMs));assert(row.settledAfterMs>=row.startedAfterMs)}
  assert(!JSON.stringify(failure.evidence).includes('responseBody'))
})
test('missing driver wiring is rejected before any SQL or production request',async()=>{
  const {runAccessControlV3Transactions}=await import('../access-control-v3-transactions.mjs')
  await assert.rejects(runAccessControlV3Transactions({}),/transactionObserver/)
})
