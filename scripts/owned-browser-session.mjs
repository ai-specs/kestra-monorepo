import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'

function validateOrigin(origin) {
  const url = new URL(origin)
  assert.equal(url.origin, origin)
  assert.equal(url.protocol, 'http:')
  assert(['localhost', '127.0.0.1'].includes(url.hostname))
  return url
}

function validate(origin, cookie) {
  const url = validateOrigin(origin)
  assert.equal(cookie?.name, 'JWT')
  assert.equal(cookie.domain?.replace(/^\./, ''), url.hostname)
  assert.equal(cookie.path, '/')
  assert.equal(cookie.httpOnly, true)
  const claims = JSON.parse(Buffer.from(cookie.value.split('.')[1], 'base64url').toString())
  assert.equal(claims.iss, origin)
  assert.equal(typeof claims.sub, 'string')
  assert(claims.sub.length > 0)
  return {source: 'previous-production-onboarding', issuer: origin, subject: claims.sub,
    sha256: createHash('sha256').update(cookie.value).digest('hex')}
}

export async function captureOwnedSession(send, origin) {
  validateOrigin(origin)
  const {cookies} = await send('Network.getCookies', {urls: [origin + '/']})
  const matches = cookies.filter(cookie => cookie.name === 'JWT')
  assert.equal(matches.length, 1)
  const cookie = matches[0]
  return {cookie, proof: validate(origin, cookie)}
}

export async function restoreOwnedSession(send, origin, session) {
  const proof = validate(origin, session?.cookie)
  assert.deepEqual(proof, session.proof)
  const {name, value, path, httpOnly, secure, sameSite, expires} = session.cookie
  const parameters = {name, value, url: origin, path, httpOnly, secure}
  if (sameSite) parameters.sameSite = sameSite
  if (expires > 0) parameters.expires = expires
  const result = await send('Network.setCookie', parameters)
  assert.equal(result.success, true)
  const restored = await captureOwnedSession(send, origin)
  assert.deepEqual(restored.proof, proof)
  return {...proof, restored: true}
}
