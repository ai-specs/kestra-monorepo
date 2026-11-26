import test from 'node:test'
import assert from 'node:assert/strict'
import {amisFixtureFlow, amisFixtureSchema, amisFixtureGrants} from '../amis-apps-fixture.mjs'

test('P0 test Flow defaults to ASYNC and binds one page and one API to real execution output', () => {
  const source = amisFixtureFlow()
  assert(source.includes('namespace: company.amis'))
  assert.equal((source.match(/type: io.kestra.plugin.amis.apps.PageTrigger/g) ?? []).length, 1)
  assert.equal((source.match(/type: io.kestra.plugin.amis.apps.ApiTrigger/g) ?? []).length, 1)
  assert(!source.includes('mode:'))
  assert(source.includes('value:\n      message: "{{ outputs.echo.value }}"'))
  assert(amisFixtureFlow({mode: 'SYNC'}).includes('mode: SYNC\n    syncTimeout: PT5S'))
})

test('Flow test-data builder rejects YAML injection and invalid limits', () => {
  for (const options of [{namespace: 'company\nx: evil'}, {flowId: 'x\ny: evil'}, {mode: 'OTHER'},
    {syncTimeout: 'PT31S'}, {syncTimeout: 'PT0S'}]) assert.throws(() => amisFixtureFlow(options))
})

test('AMIS test schema uses same-Flow API and captures real submitted response', () => {
  const schema = amisFixtureSchema()
  assert.equal(schema.body.api, 'post:greet')
  assert.equal(schema.body.body[1].tpl, 'Result: ${message}')
  assert.equal(schema.body.body[0].name, 'name')
  schema.body.api = 'mutated'
  assert.equal(amisFixtureSchema().body.api, 'post:greet')
})

test('test permission plans separate entry, execution and output authority', () => {
  assert.deepEqual(amisFixtureGrants(), [])
  assert.deepEqual(amisFixtureGrants({entry: true}).map(grant => grant.resource), ['EXTENSION_ROUTE'])
  assert.deepEqual(amisFixtureGrants({flow: true}).map(grant => grant.resource), ['FLOW', 'EXECUTION'])
  assert.deepEqual(amisFixtureGrants({outputs: true})[0].actions, ['READ', 'ACCESS_OUTPUTS'])
  const entry = amisFixtureGrants({entry: true, namespace: '!company.*', capability: 'other-app'})[0]
  assert.equal(entry.namespace, '!company.*')
  assert.equal(entry.allIds, false)
  assert.deepEqual(entry.ids, ['other-app'])
  assert.throws(() => amisFixtureGrants({namespace: 'company..*'}))
  assert.throws(() => amisFixtureGrants({capability: 'invalid/route'}))
})
