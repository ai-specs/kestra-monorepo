import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {ownedStorageSnapshotCommand} from '../rbac-onboarding-deployment.mjs'

for(const status of [0,1,2])test('storage snapshot propagates find/hash status '+status,()=>{
  // A shell function models find returning partial output before a read error.
  const result=spawnSync('sh',['-c',`find() { printf '%s\n' 'bbbb file-b' 'aaaa file-a'; return ${status}; }; ${ownedStorageSnapshotCommand}`],{encoding:'utf8'})
  if(status===0){assert.equal(result.status,0);assert.equal(result.stdout,'aaaa file-a\nbbbb file-b\n')}
  else {assert.notEqual(result.status,0);assert.equal(result.stdout,'')}
})
