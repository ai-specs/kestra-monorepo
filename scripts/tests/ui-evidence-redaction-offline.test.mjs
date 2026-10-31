import test from 'node:test'
import assert from 'node:assert/strict'
import {sanitizeUiEvidence} from '../access-control-v3-ui.mjs'

test('repeated production logins do not multiply secret replacement work or change redacted evidence',()=>{
  const secrets=['example-password-Aa1!','example-password-Bb2!']
  const value={rows:[{message:'example-password-Aa1! then example-password-Bb2!',password:'private',nested:{authorization:'private',count:3}}],url:'/?code=private&state=private',message:'Bearer private'}
  const expected=sanitizeUiEvidence(value,secrets)
  assert.deepEqual(sanitizeUiEvidence(value,Array.from({length:500},(_,index)=>secrets[index%2])),expected)
  assert.equal(expected.rows[0].message,'[redacted] then [redacted]')
  assert.equal(expected.rows[0].password,'[redacted]')
  assert.equal(expected.rows[0].nested.authorization,'[redacted]')
  assert.equal(expected.url,'/?code=[redacted]&state=[redacted]')
  assert.equal(expected.message,'Bearer [redacted]')
  assert.equal(value.rows[0].password,'private','sanitizing must not mutate the live report')
  assert.notEqual(expected.rows,value.rows)
})

test('newly issued credentials remain redacted after earlier snapshots and duplicate logins',()=>{
  const secrets=['first-secret'],value={message:'first-secret later-secret',interaction:'private',evidence:[{client_secret:'private',access_token:'private'}]}
  const first=sanitizeUiEvidence(value,secrets)
  secrets.push('first-secret','later-secret')
  const second=sanitizeUiEvidence(value,secrets)
  assert.equal(first.message,'[redacted] later-secret')
  assert.equal(second.message,'[redacted] [redacted]')
  assert.equal(second.interaction,'[redacted]')
  assert.equal(second.evidence[0].client_secret,'[redacted]')
  assert.equal(second.evidence[0].access_token,'[redacted]')
})
