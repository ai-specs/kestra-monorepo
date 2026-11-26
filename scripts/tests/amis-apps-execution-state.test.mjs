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

test('known UTC state dates accept trailing zeros and preserve original evidence',()=>{
 const native=state('PT0.212911S'),db=state(0.212911)
 native.histories[1].date='2026-11-26T22:55:24.075Z';db.histories[1].date='2026-11-26T22:55:24.075000Z'
 native.startDate='2026-11-26T22:55:24Z';db.startDate='2026-11-26T22:55:24.000000000Z'
 native.endDate='2026-11-26T22:55:24.123456780Z';db.endDate='2026-11-26T22:55:24.12345678Z'
 const original=structuredClone({native,db})
 assert(assertEquivalentExecutionState(native,db));assert.deepEqual({native,db},original)
})
for(const field of ['startDate','endDate','history'])test(field+' rejects one nanosecond difference',()=>{
 const first=state(1),second=state('PT1S')
 if(field==='history'){first.histories[0].date='2026-11-27T01:00:00.123456789Z';second.histories[0].date='2026-11-27T01:00:00.123456788Z'}
 else {first[field]='2026-11-27T01:00:00.123456789Z';second[field]='2026-11-27T01:00:00.123456788Z'}
 assert.throws(()=>assertEquivalentExecutionState(first,second))
})
for(const date of ['2026-02-29T00:00:00Z','1900-02-29T00:00:00Z','2026-04-31T00:00:00Z','2026-00-01T00:00:00Z','2026-13-01T00:00:00Z','2026-01-00T00:00:00Z','2026-01-01T24:00:00Z','2026-01-01T00:60:00Z','2026-01-01T00:00:60Z','2026-01-01T00:00:00','2026-01-01T00:00:00+00:00','2026-01-01T00:00:00.1234567890Z','0000-01-01T00:00:00Z'])test('invalid or unsupported UTC date rejects even identical values: '+date,()=>{
 const first=state(1),second=state(1);first.startDate=date;second.startDate=date
 assert.throws(()=>assertEquivalentExecutionState(first,second))
})
test('valid leap-day and nullable end date remain supported',()=>{
 const first=state(1),second=state(1);first.startDate='2000-02-29T00:00:00Z';second.startDate='2000-02-29T00:00:00.000Z';first.endDate=null;second.endDate=null
 assert(assertEquivalentExecutionState(first,second))
})
test('history count and unrecognized date-like fields remain exact',()=>{
 const first=state(1),second=state(1);first.histories.push({...first.histories[0]})
 assert.throws(()=>assertEquivalentExecutionState(first,second))
 first.histories.pop();first.customDate='2026-01-01T00:00:00Z';second.customDate='2026-01-01T00:00:00.000Z'
 assert.throws(()=>assertEquivalentExecutionState(first,second))
})
