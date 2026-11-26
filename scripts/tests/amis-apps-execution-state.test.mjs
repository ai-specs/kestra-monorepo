import test from 'node:test'
import assert from 'node:assert/strict'
import {assertEquivalentExecutionState} from '../amis-apps-execution-state.mjs'
const state = duration => ({current:'SUCCESS',histories:[{state:'CREATED',date:'2026-11-27T01:00:00Z'},{state:'SUCCESS',date:'2026-11-27T01:00:00.212911Z'}],startDate:'2026-11-27T01:00:00Z',endDate:'2026-11-27T01:00:00.212911Z',duration})
test('real DB numeric seconds and native ISO seconds compare without mutating evidence',()=>{
 const db=state(0.212911),native=state('PT0.212911S'),before=structuredClone({db,native})
 assert(assertEquivalentExecutionState(native,db));assert.deepEqual({db,native},before)
})
for(const [number,iso] of [[0,'PT0S'],[1,'PT1S'],[60,'PT60S'],[1e-9,'PT0.000000001S'],[1e-7,'PT0.0000001S'],[1.000000001,'PT1S']])test('bounded seconds equivalence '+number+' / '+iso,()=>assert(assertEquivalentExecutionState(state(number),state(iso))))
test('exact one-nanosecond tolerance uses decimal rational arithmetic',()=>{
 assert(assertEquivalentExecutionState(state('PT0.212911001S'),state(0.212911)))
 assert.throws(()=>assertEquivalentExecutionState(state('PT0.212911002S'),state(0.212911)),/more than 1 ns/)
})
for(const value of [-1,NaN,Infinity,-Infinity,null,undefined,{},'0.212911','PT-1S','P1D','PT1M','PT1H','PT1M1S','PT1e-3S','PT.2S','PT01S','PT0.0000000001S'])test('unknown duration fails closed: '+String(value),()=>assert.throws(()=>assertEquivalentExecutionState(state(value),state(value))))
for(const [name,change] of [
 ['current',value=>value.current='FAILED'],['history state',value=>value.histories[0].state='RUNNING'],
 ['history date',value=>value.histories[0].date+='x'],['history order',value=>value.histories.reverse()],
 ['start',value=>value.startDate+='x'],['end',value=>value.endDate+='x'],['extra field',value=>value.extra=true],
])test('state '+name+' remains exact',()=>{const other=state('PT0.212911S');change(other);assert.throws(()=>assertEquivalentExecutionState(other,state(0.212911)))})
test('duration field presence remains exact; states without durations remain valid',()=>{
 assert(assertEquivalentExecutionState({current:'RUNNING'},{current:'RUNNING'}))
 assert.throws(()=>assertEquivalentExecutionState({current:'RUNNING',duration:0},{current:'RUNNING'}))
})
