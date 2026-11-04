import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

test('deployment disables upstream server and UI usage reporting using the published configuration names', () => {
  const compose = readFileSync(new URL('../../docker-compose.yml', import.meta.url), 'utf8')
  assert.match(compose, /^          anonymous-usage-report:\n            enabled: false$/m)
  assert.match(compose, /^          ui-anonymous-usage-report:\n            enabled: false$/m)
  assert.doesNotMatch(compose, /^          telemetry:/m)
})
