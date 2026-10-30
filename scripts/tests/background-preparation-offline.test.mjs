import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {prepareSecurityLockCohort} from '../access-control-v3-transactions.mjs'
// Synthetic process transport only; real scheduled writer proof is separate.
function setup(options={}) {
  const owner={isolated:true,exclusiveWriters:true,composeProject:'application-projects-bb-1-2',postgresComposeProject:'application-projects-bb-1-2',postgresContainer:'a'.repeat(64),database:'kestra'}
  const state={held:false,closed:false,spawned:false,observed:false,rollbacks:0};let name
  const identity=pid=>({database:'kestra',databaseOid:'42',postmasterEpoch:'12.5',sessionUser:'kestra',pid,backendStart:'2026-10-30',applicationName:name})
  const child=new EventEmitter();child.exitCode=null;child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.stdin.destroy=()=>{}
  child.stdin.write=(text,callback)=>{
    const marker=text.match(/\\echo ([^\n]+)/)[1],sql=text.slice(0,text.indexOf('\n\\echo'));let output=''
    if(sql.includes("'database',current_database()"))output=JSON.stringify({...identity(100),...(options.wrongBinding?{databaseOid:'99'}:{})})
    if(sql.startsWith('BEGIN'))state.held=true
    if(sql==='ROLLBACK;'){state.held=false;state.rollbacks++;if(options.rollbackFailure){queueMicrotask(()=>child.stdin.emit('error',Error('synthetic failure')));return true}}
    queueMicrotask(()=>{child.stdout.emit('data',output+'\n'+marker+'\n');callback?.()});return true
  }
  child.stdin.end=()=>{state.held=false;if(!state.closed){state.closed=true;queueMicrotask(()=>child.emit('close',0))}};child.kill=()=>child.stdin.end()
  const writer={pid:201,applicationName:'PostgreSQL JDBC Driver',backendStart:'2026-10-30',granted:false,blockers:[100]}
  const query=async sql=>{
    if(sql.includes("'database',current_database()"))return JSON.stringify(identity(999))
    if(!state.held)return '[]'
    const rows=[{pid:100,granted:true}]
    if(!options.noBackground){rows.push({...writer,...(options.unrelatedBlocker?{blockers:[777]}:{})});state.observed=true;if(options.extraWriter)rows.push({...writer,pid:202})}
    return JSON.stringify(rows)
  }
  return {state,args:{owner,assertOwner:async()=>{},query,spawnPsql:async supplied=>{state.spawned=true;name=supplied.applicationName;return child},timeoutMs:50,holdMs:10,pollMs:1}}
}
test('actual-shaped observed background writer must drain before successful preparation',async()=>{const {args,state}=setup();const r=await prepareSecurityLockCohort(args);assert.equal(r.drained,true);assert.equal(r.productHttpRequests,0);assert.equal(r.schedulerDisabled,false);assert(state.closed&&!state.held&&state.observed)})
for(const [name,options]of [['no observed writer',{noBackground:true}],['multiple unexpected writers',{extraWriter:true}],['unrelated blocker',{unrelatedBlocker:true}],['wrong primary binding',{wrongBinding:true}],['rollback failure',{rollbackFailure:true}]])test(name+' rejects and closes only owned transport',async()=>{const {args,state}=setup(options);await assert.rejects(prepareSecurityLockCohort(args));assert(state.closed&&!state.held)})
test('invalid owner is rejected before process creation',async()=>{const {args,state}=setup();args.owner.isolated=false;await assert.rejects(prepareSecurityLockCohort(args));assert.equal(state.spawned,false)})
