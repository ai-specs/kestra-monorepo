import test from 'node:test'
import assert from 'node:assert/strict'
import {verifyAmisQueueObservation} from '../amis-apps-observer-control.mjs'

// Stateful synthetic queue only; no Docker or database is used.
function setup(fault) {
  let rows = 0
  const commands = []
  const database = 'application_group_acceptance_1_2'
  const options = {owner:'application-projects-bb-1-2',postgresContainer:'a'.repeat(64),database,
    effects:{waitForIdle:async()=>{},waitForStable:async()=>{},snapshot:()=>({hash:rows?'changed':'initial',
      counts:{queues:rows},sources:{queue:fault==='blind'?'constant':rows?'changed':'initial',database:'database',storage:'storage'}})},
    execute(command,args){
      assert.equal(command,'docker');assert(args.includes(database))
      const sql=args.at(-1);commands.push(sql)
      if(sql.startsWith('SELECT'))return fault==='foreign-db'?'user-database\n':database+'\n'
      if(sql.startsWith('INSERT')){rows++;if(fault==='lost-response')throw new Error('transport lost after write');return ''}
      assert(sql.startsWith('DELETE')&&sql.includes("value->>'owner'='application-projects-bb-1-2'"))
      if(fault==='cleanup')throw new Error('cleanup failed')
      rows--;return ''
    }}
  return {options,commands,get rows(){return rows}}
}
test('synthetic positive control must change queue only and restore its exact baseline',async()=>{
  const f=setup(),result=await verifyAmisQueueObservation(f.options)
  assert.equal(result.passed,true);assert.equal(result.restored,true);assert.equal(f.rows,0)
  assert.equal(f.commands.length,3)
})
for(const fault of ['blind','lost-response','cleanup','foreign-db'])test('reject synthetic '+fault+'; attempt owned cleanup only after mutation intent',async()=>{
  const f=setup(fault)
  await assert.rejects(verifyAmisQueueObservation(f.options),/queue observation control failed/)
  assert.equal(f.commands.some(sql=>sql.startsWith('DELETE')),fault!=='foreign-db')
  if(fault!=='cleanup')assert.equal(f.rows,0)
})
