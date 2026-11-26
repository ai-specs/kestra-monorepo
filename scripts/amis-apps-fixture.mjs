import assert from 'node:assert/strict'

const namespacePattern = /^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*$/
const flowPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

export function amisFixtureFlow({namespace = 'company.amis', flowId = 'acceptance', mode = 'ASYNC', syncTimeout = 'PT5S'} = {}) {
  assert(namespacePattern.test(namespace) && namespace.length <= 150)
  assert(flowPattern.test(flowId))
  assert(['ASYNC', 'SYNC'].includes(mode))
  assert(/^PT(?:[1-9]|[12][0-9]|30)S$/.test(syncTimeout))
  return `id: ${flowId}
namespace: ${namespace}
description: Isolated AMIS production acceptance
inputs:
  - id: name
    type: STRING
    required: true
tasks:
  - id: echo
    type: io.kestra.plugin.core.debug.Return
    format: "{{ inputs.name }}"
outputs:
  - id: response
    type: JSON
    value:
      message: "{{ outputs.echo.value }}"
triggers:
  - id: page-home
    type: io.kestra.plugin.amis.apps.PageTrigger
    pageId: home
    schema: nsfile:///amis/home.json
  - id: api-greet
    type: io.kestra.plugin.amis.apps.ApiTrigger
    apiId: greet
${mode === 'SYNC' ? `    mode: SYNC\n    syncTimeout: ${syncTimeout}\n` : ''}`
}

export function amisFixtureSchema() {
  return {
    type: 'page', title: 'AMIS production acceptance',
    body: {type: 'form', title: 'Greeting', api: 'post:greet',
      body: [{type: 'input-text', name: 'name', label: 'Name', required: true},
        {type: 'tpl', tpl: 'Result: ${message}', id: 'saved-response'}],
      actions: [{type: 'submit', label: 'Submit'}]},
  }
}

export function amisFixtureGrants({namespace = 'company.amis.*', entry = false, flow = false, outputs = false, capability = 'amis-apps'} = {}) {
  assert(/^!?[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*(?:\.\*)?$/.test(namespace))
  assert(/^[a-z][a-z0-9-]{0,63}$/.test(capability))
  const grant = (resource, actions, ids = []) => ({scope: 'NAMESPACE', tenant: 'main', namespace,
    resource, actions, ids, allIds: ids.length === 0})
  return [
    ...(entry ? [grant('EXTENSION_ROUTE', ['EXECUTE'], [capability])] : []),
    ...(flow ? [grant('FLOW', ['READ', 'EXECUTE']), grant('EXECUTION', ['CREATE'])] : []),
    ...(outputs ? [grant('EXECUTION', ['READ', 'ACCESS_OUTPUTS'])] : []),
  ]
}
