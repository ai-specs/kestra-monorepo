import assert from 'node:assert/strict'
import {setTimeout as wait} from 'node:timers/promises'
import {amisApiPath, invokeAmisApi} from './amis-apps-http.mjs'
import {createAmisUiOAuth} from './amis-apps-ui-oauth.mjs'
import {createAmisRevocationControls} from './amis-apps-revocation.mjs'

// This fragment retains a live access/refresh session across each real policy
// edit. A fresh login alone would not test revocation of an issued credential.
export async function runAmisRevocationCases({base, admin, actors, clientSecret, target, effects,
  login, persist, deadlineMs = 65000, intervalMs = 250,
  controls = createAmisRevocationControls({base, admin}), oauthFactory = createAmisUiOAuth}) {
  assert.equal(typeof login, 'function')
  assert.equal(typeof persist, 'function')
  assert(deadlineMs >= 1000 && deadlineMs <= 120000 && intervalMs > 0 && intervalMs <= 1000)
  const apiPath = amisApiPath(target)
  assert(/^[A-Za-z0-9_-]{1,80}$/.test(target.marker))
  const definitions = [
    {key: 'revoke-entry', id: 'B-revoke-entry-capability', permissionKey: 'permission-amis-revoke-entry'},
    {key: 'revoke-flow', id: 'B-revoke-flow-execution', permissionKey: 'permission-amis-revoke-flow'},
    {key: 'revoke-grant', id: 'B-revoke-scope-and-refresh'},
  ]
  const report = {completed: false, scope: 'Production policy revocation and existing signed OAuth sessions', cases: []}
  const save = () => persist(structuredClone({...report, control: controls.publicEvidence()}))
  await save()
  for (const definition of definitions) {
    const row = {id: definition.id, status: 'running', checks: []}
    report.cases.push(row)
    let revoked = false, failure
    const operationId = 'test-' + definition.key
    try {
      const actor = actors.find(value => value.key === definition.key)
      assert(actor && actor.scopeKeys?.length > 0)
      const client = await login(actor)
      const oauth = await oauthFactory({base, client, clientSecret, namespace: target.namespace, flowId: target.flowId,
        expectedSubject: actor.username, groupId: 'main', expectedScopeKeys: actor.scopeKeys})
      const bearer = {request: (path, options) => oauth.requestAccess(path, options)}
      const initialMarker = target.marker + '-' + definition.key + '-before'
      const before = await invokeAmisApi(bearer, {...target, inputs: {name: initialMarker}, expectedData: {message: initialMarker}})
      row.checks.push({name: 'issued-token-positive-control', passed: true, executionId: before.executionId, identity: oauth.evidence()})
      await effects.waitForIdle()
      await effects.waitForStable()
      const changedAt = performance.now()
      row.change = definition.permissionKey
        ? await controls.revokePermission({operationId, permissionKey: definition.permissionKey})
        : await controls.revokeSubjectGrants({operationId, subject: actor.username})
      revoked = true
      // GET cannot start another execution while we wait for the bounded policy
      // propagation. Always probe the same tuple issued by the positive control.
      let status
      for (;;) {
        const response = await bearer.request(before.executionUrl)
        status = response.status
        await response.body?.cancel()
        if ([401, 403].includes(status)) break
        assert.equal(status, 200, 'Unexpected revocation observation response')
        assert(performance.now() - changedAt < deadlineMs, 'Issued token remained authorized beyond the bounded window')
        await wait(intervalMs)
      }
      const denial = await effects.observeDenied(() => bearer.request(apiPath, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: target.marker + '-' + definition.key + '-denied'})}), async response => {
        assert([401, 403].includes(response.status))
        await response.body?.cancel()
      })
      row.checks.push({name: 'issued-token-denied-without-side-effects', passed: true, status,
        elapsedMs: Math.ceil(performance.now() - changedAt), sideEffects: denial.observation})
      const refreshed = await oauth.refresh()
      row.refresh = refreshed
      if (refreshed.success) {
        if (!definition.permissionKey) assert.deepEqual(refreshed.after.scopeKeys, [], 'Refresh must not retain revoked user grants')
        const refreshedDenial = await effects.observeDenied(() => bearer.request(apiPath, {method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({name: target.marker + '-' + definition.key + '-refreshed-denied'})}), async response => {
          assert([401, 403].includes(response.status))
          await response.body?.cancel()
        })
        row.checks.push({name: 'rotated-token-remains-denied', passed: true, sideEffects: refreshedDenial.observation})
      } else assert([400, 401, 403].includes(refreshed.status), 'Refresh failed for an unrelated reason')
      row.status = 'passed'
    } catch (error) {
      failure = error
      row.status = 'failed'
      row.failure = {message: String(error.message), ...(error.observation ? {observation: error.observation} : {})}
    } finally {
      if (revoked) {
        try {
          row.restoration = await controls.restore({operationId})
          assert.equal(row.restoration?.operationId, operationId)
          assert.equal(row.restoration?.restored, true, 'Policy restoration must be explicitly confirmed')
        }
        catch (error) {row.status = 'failed'; row.restorationFailure = String(error.message); failure ??= error}
      }
      await save()
    }
    if (failure) {const error = new Error('AMIS revocation case failed: ' + definition.id); error.report = report; throw error}
  }
  report.completed = true
  await save()
  return report
}
