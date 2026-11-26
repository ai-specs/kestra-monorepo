import assert from 'node:assert/strict'
import test from 'node:test'
import {planAmisCompose} from '../amis-apps-compose.mjs'

const original = {
  services: {
    postgres: {image: 'postgres:18', environment: {POSTGRES_DB: 'kestra', POSTGRES_PASSWORD: 'not-public'}, volumes: [{type: 'volume', source: 'user-pg', target: '/var/lib/postgresql'}]},
    kestra: {image: 'old', environment: {KESTRA_CONFIGURATION: 'datasources:\n  postgres:\n    url: jdbc:postgresql://postgres:5432/kestra\n    password: not-public\nkestra:\n  rbac:\n    enabled: true\n    evaluation:\n      enabled: true\n    application-groups:\n      enabled: true\n  url: http://localhost:8080/\n  oidc:\n    enabled: true\n    issuer: http://localhost:8080\nmicronaut:\n  security:\n    oauth2:\n      clients:\n        kestra:\n          scopes: [openid, profile, email]\n'}, volumes: [
      {type: 'volume', source: 'user-storage', target: '/app/storage'},
      {type: 'bind', source: '/user/plugins', target: '/app/plugins'}
    ]}
  }, volumes: {'user-pg': {name: 'user-pg'}, 'user-storage': {name: 'user-storage'}}, networks: {default: {name: 'user-network'}}
}
original.services.kestra.environment.KESTRA_CONFIGURATION += 'token-url: http://localhost:8080/oidc/token\njwks-uri: http://localhost:8080/oidc/jwks\n'
const inputs = mode => ({project: 'application-projects-bb-123-456', mode, base: 'http://127.0.0.1:18080/', hostImage: 'ghcr.io/ai-specs/kestra-overlay@sha256:' + 'c'.repeat(64),
  database: 'application_group_acceptance_123_456', storage: `amis-${mode.toLowerCase()}-deadbeef`,
  amisJar: '/tmp/kestra-amis.jar', rbacJar: '/tmp/kestra-rbac.jar', amisJarSha256: 'a'.repeat(64), rbacJarSha256: 'b'.repeat(64),
  postgresPassword: 'not-public', admin: {username: 'manager', password: 'secret'}})

test('does not mutate source and removes user volume/network names', () => {
  const before = structuredClone(original)
  const result = planAmisCompose(original, inputs('A'))
  assert.deepEqual(original, before)
  assert.equal(result.raw.volumes['user-pg'], undefined)
  assert.equal(result.raw.networks.default.name, 'application-projects-bb-123-456-default')
  assert.equal(result.raw.services.kestra.volumes.some(v => v.source === '/user/plugins'), false)
})

test('mode A has one postgres, no RBAC jar, and owned mounts', () => {
  const {raw} = planAmisCompose(original, inputs('A'))
  assert.deepEqual(Object.keys(raw.services), ['postgres', 'kestra'])
  assert.equal(raw.services.kestra.volumes.filter(v => v.target.startsWith('/app/libs/')).length, 1)
  assert.equal(raw.services.kestra.volumes.some(v => v.source === '/tmp/kestra-rbac.jar'), false)
  assert.equal(raw.services.postgres.volumes[0].source, 'application-projects-bb-123-456-postgres')
  assert.equal(raw.services.kestra.volumes.find(v => v.target === '/app/storage').source, 'application-projects-bb-123-456-amis-a-deadbeef')
  assert.equal(raw.services.postgres.environment.POSTGRES_DB, 'kestra')
  assert.match(raw.services.kestra.environment.KESTRA_CONFIGURATION, /jdbc:postgresql:\/\/postgres:5432\/application_group_acceptance_123_456/)
  assert.equal(raw.services.kestra.environment.KESTRA_CONFIGURATION.includes('/kestra'), false)
  assert.equal(raw.services.postgres.ports, undefined)
  assert.equal(raw.services.postgres.labels['com.docker.compose.project'], undefined)
  for (const service of Object.values(raw.services)) assert.equal(service.labels.owner, 'application-projects-bb-123-456')
})

test('mode B mounts both formal jars read-only and rewrites loopback entrypoints', () => {
  const {raw, public: summary} = planAmisCompose(original, inputs('B'))
  const jars = raw.services.kestra.volumes.filter(v => v.target.startsWith('/app/libs/'))
  assert.equal(jars.length, 2)
  assert(jars.every(v => v.read_only === true && v.type === 'bind'))
  assert(jars.every(v => v.bind.create_host_path === false))
  assert.match(raw.services.kestra.environment.KESTRA_CONFIGURATION, /http:\/\/127\.0\.0\.1:18080/)
  assert.match(raw.services.kestra.environment.KESTRA_CONFIGURATION, /url: http:\/\/localhost:8080\/oidc\/token/)
  assert.match(raw.services.kestra.environment.KESTRA_CONFIGURATION, /jwks-uri: http:\/\/localhost:8080\/oidc\/jwks/)
  assert.equal(summary.rbacJar, 'b'.repeat(64))
})

test('optional probe is explicit and uses a non-creating read-only bind', () => {
  const result = planAmisCompose(original, {...inputs('B'), probeJar: '/tmp/probe.jar', probeJarSha256: 'd'.repeat(64)})
  const probe = result.raw.services.kestra.volumes.find(v => v.target === '/acceptance/probe.jar')
  assert.deepEqual(probe, {type: 'bind', source: '/tmp/probe.jar', target: '/acceptance/probe.jar', read_only: true, bind: {create_host_path: false}})
  assert.match(result.raw.services.kestra.environment.JAVA_TOOL_OPTIONS, /-javaagent:\/acceptance\/probe\.jar/)
  assert.match(result.raw.services.kestra.environment.JAVA_TOOL_OPTIONS, /-Damis\.acceptance\.probe\.enabled=true/)
})

test('rejects unsafe owner, base, image, paths, database, storage, and missing hash inputs', () => {
  for (const change of [
    {project: 'user'}, {base: 'http://localhost:18080/'}, {base: 'http://0.0.0.0:18080/'}, {hostImage: 'latest'},
    {amisJar: 'relative.jar'}, {database: 'kestra'}, {storage: 'user-storage'}, {amisJarSha256: 'bad'}
  ]) assert.throws(() => planAmisCompose(original, {...inputs('A'), ...change}))
  assert.throws(() => planAmisCompose(original, {...inputs('A'), postgresPassword: 'different'}), /password/)
  const extraMount = structuredClone(original)
  extraMount.services.kestra.volumes.push({type: 'volume', source: 'user', target: '/unexpected'})
  assert.throws(() => planAmisCompose(extraMount, inputs('A')), /mount target/)
  const unsafe = structuredClone(original)
  unsafe.services.kestra.environment.KESTRA_CONFIGURATION += '\n  external: https://example.invalid/\n'
  assert.throws(() => planAmisCompose(unsafe, inputs('A')), /non-loopback/)
})

test('public summary excludes password and configuration content', () => {
  const result = planAmisCompose(original, inputs('B'))
  const text = JSON.stringify(result.public)
  assert.equal(text.includes('not-public'), false)
  assert.equal(text.includes('secret'), false)
  assert.equal(text.includes('jdbc:'), false)
})
