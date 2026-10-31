import test from 'node:test'
import assert from 'node:assert/strict'
import {assertUiClientOwnership} from '../ui-client-ownership-evidence.mjs'
const catalogue=()=>Array.from({length:30},(_,index)=>[{kind:'ui-member-created',clientId:'client-'+index},{kind:'ui-client-owner-consent-completed',clientId:'client-'+index,productionS256:true,issuedScopes:['openid'],ownerOnlyDetailStatus:200,activatedForFullRun:true}]).flat()
test('complete paginated catalogue has no pending-only long-running member',()=>assert.deepEqual(assertUiClientOwnership(catalogue()),{clients:30,owned:30,pending:0,source:'production-owner-s256-consent-and-owner-only-detail'}))
for(const [name,mutate]of [
  ['old only-first-two activated behaviour',events=>events.splice(4,events.length-4,...events.slice(4).filter(event=>event.kind==='ui-member-created'))],
  ['one missed client',events=>events.splice(1,1)],
  ['borrowed activation of another client',events=>{events[1].clientId='other'}],
  ['duplicate activation',events=>events.push({...events[1]})],
  ['no production S256',events=>{events[1].productionS256=false}],
  ['owner detail denied',events=>{events[1].ownerOnlyDetailStatus=403}],
  ['no activation assertion',events=>{delete events[1].activatedForFullRun}],
])test(name+' fails catalogue preparation',()=>{const events=catalogue();mutate(events);assert.throws(()=>assertUiClientOwnership(events))})
