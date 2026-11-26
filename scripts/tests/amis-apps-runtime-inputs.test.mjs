import assert from 'node:assert/strict'
import test from 'node:test'
import {configureAmisRuntime, validateAmisRuntimeInspection} from '../amis-apps-runtime-inputs.mjs'

const original = {
  environment: {KESTRA_CONFIGURATION: `datasources:
  postgres:
    url: jdbc:postgresql://postgres:5432/kestra
kestra:
  rbac:
    enabled: true
    evaluation:
      enabled: true
    application-groups:
      enabled: true
  oidc:
    enabled: true
micronaut:
  security:
    oauth2:
      clients:
        kestra:
          scopes: [openid, profile, email]
`},
  volumes: [{type: 'bind', source: '/old/libs', target: '/app/libs'},
    {type: 'volume', source: 'original-data', target: '/app/storage'},
    {type: 'bind', source: '/formal/plugins', target: '/app/plugins'}],
}
const inputs = mode => ({mode, database: 'application_group_acceptance_123_456', storage: `amis-${mode.toLowerCase()}-abc123`,
  amisJar: '/formal/amis.jar', rbacJar: '/formal/rbac.jar', admin: {username: 'test-manager', password: 'test-only-not-real'}})

for (const mode of ['A', 'B']) {
  test(`${mode} configures an isolated AMIS runtime without changing its caller`, () => {
    const before = structuredClone(original)
    const host = configureAmisRuntime(original, inputs(mode))
    assert.deepEqual(original, before)
    assert(host.environment.KESTRA_CONFIGURATION.includes('amis-apps:\n    enabled: true'))
    assert(host.environment.KESTRA_CONFIGURATION.includes(`rbac:\n    enabled: ${mode === 'B'}`))
    assert.equal(host.environment.KESTRA_CONFIGURATION.includes('kestra:application-group-scopes'), mode === 'B')
    assert(host.environment.KESTRA_CONFIGURATION.includes('jdbc:postgresql://postgres:5432/application_group_acceptance_123_456'))
    const libraries = host.volumes.filter(volume => volume.target.startsWith('/app/libs'))
    assert.equal(libraries.length, mode === 'A' ? 1 : 2)
    assert(libraries.some(volume => volume.target === '/app/libs/kestra-amis-apps.jar' && volume.read_only))
    assert.equal(libraries.some(volume => volume.target === '/app/libs/kestra-rbac-authorizer.jar'), mode === 'B')
    assert(host.volumes.some(volume => volume.target === '/app/plugins'))
    assert(host.volumes.some(volume => volume.target === '/app/storage' && volume.source === inputs(mode).storage))
  })
}

test('existing controlled AMIS switch changes without dropping other limits', () => {
  const source = structuredClone(original)
  source.environment.KESTRA_CONFIGURATION = source.environment.KESTRA_CONFIGURATION.replace('  oidc:',
    '  amis-apps:\n    enabled: false\n    schema-max-bytes: 1048576\n  oidc:')
  const host = configureAmisRuntime(source, inputs('A'))
  assert(host.environment.KESTRA_CONFIGURATION.includes('amis-apps:\n    enabled: true\n    schema-max-bytes: 1048576'))
})

test('configuration rejects unknown library mounts, ambiguous YAML and unowned resources', () => {
  const source = structuredClone(original)
  source.volumes.push({type: 'bind', source: '/other.jar', target: '/app/libs/other.jar'})
  assert.throws(() => configureAmisRuntime(source, inputs('A')), /Unapproved extension/)
  source.volumes.pop()
  source.environment.KESTRA_CONFIGURATION = source.environment.KESTRA_CONFIGURATION.replace('  oidc:',
    '  amis-apps:\n    other: true\n  oidc:')
  assert.throws(() => configureAmisRuntime(source, inputs('A')), /Unrecognized AMIS/)
  assert.throws(() => configureAmisRuntime(original, {...inputs('A'), database: 'user-data'}))
  assert.throws(() => configureAmisRuntime(original, {...inputs('A'), storage: 'original-data'}))
  assert.throws(() => configureAmisRuntime(original, {...inputs('A'), amisJar: 'relative.jar'}))
})

function inspection(mode) {
  const expected = {...inputs(mode), image: `ghcr.io/ai-specs/kestra-overlay@sha256:${'a'.repeat(64)}`,
    project: 'owned-amis-test', base: 'http://127.0.0.1:18080', storageVolume: 'owned-amis-storage', configuration: 'test-configuration'}
  const actual = {
    Config: {Image: expected.image, Labels: {owner: expected.project, 'com.docker.compose.project': expected.project},
      Env: [`KESTRA_CONFIGURATION=${expected.configuration}`]},
    NetworkSettings: {Ports: {'8080/tcp': [{HostIp: '127.0.0.1', HostPort: '18080'}]}},
    Mounts: [{Destination: '/app/storage', Type: 'volume', Name: expected.storageVolume},
      {Destination: '/app/libs/kestra-amis-apps.jar', Type: 'bind', Source: expected.amisJar, RW: false},
      ...(mode === 'B' ? [{Destination: '/app/libs/kestra-rbac-authorizer.jar', Type: 'bind', Source: expected.rbacJar, RW: false}] : [])],
  }
  return {actual, expected}
}

for (const mode of ['A', 'B']) {
  test(`${mode} inspection requires actual image, owner, mounts, port and configuration`, () => {
    const {actual, expected} = inspection(mode)
    assert.deepEqual(validateAmisRuntimeInspection(actual, expected),
      {mode, amisPresent: true, rbacPresent: mode === 'B', storageVolume: expected.storageVolume})
  })
}

const invalidInspections = {
  'wrong image': actual => { actual.Config.Image = 'unverified:latest' },
  'wrong owner': actual => { actual.Config.Labels.owner = 'user-deployment' },
  'public bind': actual => { actual.NetworkSettings.Ports['8080/tcp'][0].HostIp = '0.0.0.0' },
  'wrong storage': actual => { actual.Mounts[0].Name = 'user-data' },
  'different jar bytes source': actual => { actual.Mounts[1].Source = '/candidate.jar' },
  'writable jar': actual => { actual.Mounts[1].RW = true },
  'missing AMIS jar': actual => { actual.Mounts.splice(1, 1) },
  'extra library directory': actual => { actual.Mounts.push({Destination: '/app/libs', Type: 'bind', Source: '/unverified', RW: false}) },
  'different configuration': actual => { actual.Config.Env[0] = 'KESTRA_CONFIGURATION=other' },
}
for (const [name, mutate] of Object.entries(invalidInspections)) {
  test(`inspection rejects ${name}`, () => {
    const {actual, expected} = inspection('A')
    mutate(actual)
    assert.throws(() => validateAmisRuntimeInspection(actual, expected))
  })
}

test('mode A rejects an installed RBAC jar even when its runtime flag says disabled', () => {
  const {actual, expected} = inspection('B')
  assert.throws(() => validateAmisRuntimeInspection(actual, {...expected, mode: 'A'}), /libraries differ/)
})

test('inspection requires selected formal inputs and does not include configuration secrets in failures', () => {
  const {actual, expected} = inspection('A')
  for (const field of ['project', 'storageVolume', 'configuration']) {
    assert.throws(() => validateAmisRuntimeInspection(actual, {...expected, [field]: undefined}))
  }
  assert.throws(() => validateAmisRuntimeInspection(actual, {...expected, image: 'unverified:latest'}))
  actual.Config.Env[0] = 'KESTRA_CONFIGURATION=password: private-test-marker'
  assert.throws(() => validateAmisRuntimeInspection(actual, expected), error => {
    assert(!error.message.includes('private-test-marker'))
    return true
  })
})
