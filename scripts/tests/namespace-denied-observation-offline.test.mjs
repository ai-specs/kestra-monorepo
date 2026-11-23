import test from 'node:test'
import assert from 'node:assert/strict'
import {observeNamespaceDenied} from '../namespace-permission-browser.mjs'

for(const scenario of ['allowed-denial','wrong-status','immediate-mutation','delayed-mutation','request-error'])test('namespace denied observation retains complete evidence: '+scenario,async()=>{
  let clock=0,reads=0
  const records=[]
  const operation=observeNamespaceDenied({
    snapshot:async()=>({value:(scenario==='immediate-mutation'&&reads++>0)||(scenario==='delayed-mutation'&&clock>=1000)?'changed':'original'}),
    invoke:async()=>{if(scenario==='request-error')throw new Error('network failed');return {status:scenario==='wrong-status'?200:403,response:{status:scenario==='wrong-status'?200:403}}},
    verify:result=>assert.equal(result.status,403),
    now:()=>clock,wait:async ms=>{clock+=Math.max(ms,1)},record:async evidence=>records.push(structuredClone(evidence))})
  let evidence
  if(scenario==='allowed-denial')evidence=await operation
  else await assert.rejects(operation,error=>{evidence=error.evidence;return true})
  assert(evidence.samples.length>=2)
  assert(evidence.observedMs>=2500)
  assert.equal(evidence.before.value,'original')
  assert.deepEqual(records.at(-1),evidence)
  if(scenario==='immediate-mutation')assert.equal(evidence.immediate.value,'changed')
  if(scenario==='delayed-mutation')assert(evidence.samples.some(row=>row.snapshot.value==='changed'))
})

test('slow snapshot recording cannot end the window before its final sample reaches the deadline',async()=>{
 let clock=0
 const evidence=await observeNamespaceDenied({snapshot:async()=>{clock+=80;return {same:true}},invoke:async()=>({status:403,response:{status:403}}),verify:value=>assert.equal(value.status,403),now:()=>clock,wait:async ms=>{clock+=Math.max(ms,1)},record:async()=>{clock+=90}})
 assert(evidence.samples.at(-1).elapsedMs>=2500)
 assert(evidence.samples.at(-1).elapsedMs<=evidence.observedMs)
})
