import test from 'node:test'
import assert from 'node:assert/strict'
import {redactOwnedServiceLog} from '../owned-service-log.mjs'

test('owned service logs retain SQL cancellation and transaction diagnostics',()=>{
  const text='ERROR: canceling statement due to user request\nERROR: current transaction is aborted\nqueue-postgres fatal error'
  assert.equal(redactOwnedServiceLog(text),text)
})
for(const text of ['password=local-value','Authorization: Bearer abc','Cookie: session=abc','client_secret=abc','url?code=abc','url?sig=abc','eyJabcdefghijk.abcdefghijk.abcdefghijk'])test('owned log redacts sensitive line '+text.split(/[=:?]/)[0],()=>{
  assert.equal(redactOwnedServiceLog('before\n'+text+'\nafter'),'before\n[credential-bearing line redacted]\nafter')
})
