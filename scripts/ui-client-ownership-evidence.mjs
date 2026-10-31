import assert from 'node:assert/strict'

export function assertUiClientOwnership(events) {
  const members=events.filter(event=>event.kind==='ui-member-created').map(event=>event.clientId)
  const activations=events.filter(event=>event.kind==='ui-client-owner-consent-completed')
  assert(members.length>25,'Full paginated client catalogue required')
  assert.equal(new Set(members).size,members.length,'Duplicate catalogue client')
  assert.equal(activations.length,members.length,'Every long-running client must complete real ownership')
  assert.deepEqual(activations.map(event=>event.clientId).sort(),[...members].sort(),'Owned client set differs from prepared catalogue')
  for(const event of activations){assert.equal(event.productionS256,true);assert.deepEqual(event.issuedScopes,['openid']);assert.equal(event.ownerOnlyDetailStatus,200);assert.equal(event.activatedForFullRun,true)}
  return {clients:members.length,owned:activations.length,pending:0,source:'production-owner-s256-consent-and-owner-only-detail'}
}
