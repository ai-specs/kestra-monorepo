import test from 'node:test'
import assert from 'node:assert/strict'
import {formatAcceptanceProgress} from '../ci-acceptance-progress.mjs'
const progress={stagesPassed:7,checksPassed:15,restPassed:56,uiPassed:2,failures:0,notRun:120}
test('CI live progress emits only known numeric counters',()=>{
 assert.equal(formatAcceptanceProgress(JSON.stringify({acceptanceProgress:progress})),'ACCEPTANCE_PROGRESS stagesPassed=7 checksPassed=15 restPassed=56 uiPassed=2 failures=0 notRun=120')
})
test('raw logs, secrets, invalid JSON and oversized lines are never echoed',()=>{
 for(const value of ['password=SECRET','{"access_token":"SECRET"}','{invalid','x'.repeat(2049),JSON.stringify({acceptanceProgress:progress,password:'SECRET'}),JSON.stringify({acceptanceProgress:{...progress,password:'SECRET'}})])assert.equal(formatAcceptanceProgress(value),null)
})
test('missing, unsafe, negative and credential-bearing counter values are rejected',()=>{
 for(const value of ['SECRET',-1,1.5,10000001,null,Infinity])assert.equal(formatAcceptanceProgress(JSON.stringify({acceptanceProgress:{...progress,checksPassed:value}})),null)
 const copy={...progress};delete copy.restPassed;assert.equal(formatAcceptanceProgress(JSON.stringify({acceptanceProgress:copy})),null)
})

test('real CLI filters mixed driver output without leaking raw messages',async()=>{
 const {spawnSync}=await import('node:child_process');const {fileURLToPath}=await import('node:url')
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../ci-acceptance-progress.mjs',import.meta.url))],{input:'password=SECRET\n'+JSON.stringify({acceptanceProgress:progress})+'\nBearer SECRET\n',encoding:'utf8'})
 assert.equal(result.status,0);assert.equal(result.stderr,'');assert.equal(result.stdout,formatAcceptanceProgress(JSON.stringify({acceptanceProgress:progress}))+'\n');assert(!result.stdout.includes('SECRET'))
})
