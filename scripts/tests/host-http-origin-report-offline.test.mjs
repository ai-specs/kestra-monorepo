import test from 'node:test'
import assert from 'node:assert/strict'
import {hostHttpOriginCases,assertHostHttpOriginReport} from '../access-control-v3-gates.mjs'
const xml=(names=hostHttpOriginCases,body='')=>'<testsuite tests="'+names.length+'" failures="0" errors="0" skipped="0">'+names.map(name=>'<testcase classname="io.kestra.webserver.rbac.AuthorizationHttpOriginBoundaryTest" name="'+name+'()">'+body+'</testcase>').join('')+'</testsuite>'
test('all five published origin case identities are required',()=>assert.equal(assertHostHttpOriginReport(xml()).tests,5))
test('missing named case fails',()=>{assert.throws(()=>assertHostHttpOriginReport(xml(hostHttpOriginCases.slice(1))))})
test('duplicate replacing another named case fails',()=>{assert.throws(()=>assertHostHttpOriginReport(xml([...hostHttpOriginCases.slice(1),hostHttpOriginCases[1]])))})
test('failed origin case cannot satisfy publication',()=>{assert.throws(()=>assertHostHttpOriginReport(xml(hostHttpOriginCases,'<failure message="failed"/>')))})
test('skipped origin case cannot satisfy publication',()=>{assert.throws(()=>assertHostHttpOriginReport(xml(hostHttpOriginCases,'<skipped/>')))})
