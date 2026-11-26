import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {configureAmisRuntime} from './amis-apps-runtime-inputs.mjs'

const sha256 = value => createHash('sha256').update(value).digest('hex')

function ownerName(value) {
  assert.match(value, /^application-projects-bb-[0-9]+-[0-9]+$/)
  return value
}
function baseUrl(value) {
  const parsed = new URL(value)
  assert.equal(parsed.protocol, 'http:')
  assert.equal(parsed.hostname, '127.0.0.1')
  assert(parsed.port && Number(parsed.port) >= 1024 && Number(parsed.port) <= 65535)
  assert.equal(parsed.pathname, '/')
  assert.equal(parsed.search, '')
  assert.equal(parsed.hash, '')
  return `http://127.0.0.1:${parsed.port}`
}

function requiredHash(value, label) {
  assert.match(value, /^[a-f0-9]{64}$/, `${label} SHA-256 required`)
  return value
}

function replaceEntrypoints(value, base) {
  assert.equal(typeof value, 'string')
  const replaced = value.replaceAll('http://localhost:8080', base)
  for (const match of replaced.matchAll(/https?:\/\/([^/\s:'"}]+)/g)) {
    assert(['127.0.0.1', 'localhost'].includes(match[1]), `Unknown non-loopback entrypoint: ${match[1]}`)
  }
  return replaced
}

export function planAmisCompose(originalComposeConfig, inputs) {
  assert(originalComposeConfig && typeof originalComposeConfig === 'object')
  assert(inputs && typeof inputs === 'object')
  const source = structuredClone(originalComposeConfig)
  assert(source.services?.postgres && source.services?.kestra, 'postgres and kestra services required')
  for (const volume of source.services.kestra.volumes ?? []) {
    assert(['/app/storage', '/app/plugins', '/app/libs'].includes(volume.target)
      || (typeof volume.target === 'string' && volume.target.startsWith('/app/libs/')), 'Unsupported source mount target')
  }
  const project = ownerName(inputs.project)
  const mode = inputs.mode
  assert(['A', 'B'].includes(mode))
  const base = baseUrl(inputs.base)
  assert.match(inputs.hostImage, /^ghcr\.io\/ai-specs\/kestra-overlay@sha256:[a-f0-9]{64}$/, 'Overlay image digest required')
  assert.equal(typeof inputs.amisJar, 'string')
  assert.equal(typeof inputs.rbacJar, 'string')
  assert(inputs.amisJar.startsWith('/'))
  assert(inputs.rbacJar.startsWith('/'))
  const amisJarSha256 = requiredHash(inputs.amisJarSha256, 'AMIS jar')
  const rbacJarSha256 = requiredHash(inputs.rbacJarSha256, 'RBAC jar')
  assert.match(inputs.database, /^application_group_acceptance_[0-9]+_[0-9]+$/)
  assert.match(inputs.storage, new RegExp(`^amis-${mode.toLowerCase()}-[a-f0-9]+$`))
  assert(inputs.admin?.username && inputs.admin?.password)
  assert.equal(typeof inputs.postgresPassword, 'string')
  assert.equal(inputs.postgresPassword, source.services.postgres.environment?.POSTGRES_PASSWORD, 'PostgreSQL password must match source')
  assert.equal(source.services.kestra.environment.KESTRA_CONFIGURATION.includes(`password: ${inputs.postgresPassword}`), true,
    'Datasource password must match source PostgreSQL password')

  const host = configureAmisRuntime(source.services.kestra, inputs)
  host.image = inputs.hostImage
  host.ports = [`127.0.0.1:${new URL(base).port}:8080`]
  host.environment = Object.fromEntries(Object.entries(host.environment ?? {}).map(([key, value]) =>
    [key, typeof value === 'string' ? replaceEntrypoints(value, base) : value]))
  host.labels = {...host.labels, owner: project}
  const postgres = structuredClone(source.services.postgres)
  for (const key of ['container_name', 'build', 'network_mode', 'external_links', 'depends_on', 'ports', 'networks']) delete postgres[key]
  postgres.volumes = [{type: 'volume', source: `${project}-postgres`, target: '/var/lib/postgresql'}]
  postgres.environment = {...postgres.environment, POSTGRES_DB: source.services.postgres.environment.POSTGRES_DB}
  postgres.labels = {...postgres.labels, owner: project}
  delete host.networks
  delete host.container_name
  delete host.build
  delete host.network_mode
  delete host.external_links
  delete host.depends_on
  host.environment.KESTRA_CONFIGURATION = replaceEntrypoints(host.environment.KESTRA_CONFIGURATION, base)
  host.environment.KESTRA_CONFIGURATION = host.environment.KESTRA_CONFIGURATION
    .replaceAll(`url: ${base}/oidc/token`, 'url: http://localhost:8080/oidc/token')
    .replaceAll(`jwks-uri: ${base}/oidc/jwks`, 'jwks-uri: http://localhost:8080/oidc/jwks')

  const plugins = `${project}-plugins`
  const actualStorage = `${project}-${inputs.storage}`
  host.volumes = [...host.volumes.filter(volume => volume.target !== '/app/plugins'),
    {type: 'volume', source: plugins, target: '/app/plugins'}]
  host.volumes = host.volumes.map(volume => volume.target === '/app/storage'
    ? {...volume, source: actualStorage}
    : volume.type === 'bind' ? {...volume, bind: {create_host_path: false}} : volume)
  if (inputs.probeJar !== undefined) {
    assert(inputs.probeJar.startsWith('/'))
    requiredHash(inputs.probeJarSha256, 'Probe jar')
    host.volumes.push({type: 'bind', source: inputs.probeJar, target: '/acceptance/probe.jar', read_only: true, bind: {create_host_path: false}})
    host.environment.JAVA_TOOL_OPTIONS = `${host.environment.JAVA_TOOL_OPTIONS ?? ''} -javaagent:/acceptance/probe.jar -Damis.acceptance.probe.enabled=true`.trim()
  }
  const volumes = {
    [`${project}-postgres`]: {name: `${project}-postgres`, labels: {owner: project}},
    [actualStorage]: {name: actualStorage, labels: {owner: project}},
    [plugins]: {name: plugins, labels: {owner: project}}
  }
  const network = `${project}-default`
  for (const service of [postgres, host]) {
    for (const key of Object.keys(service.labels ?? {})) if (key.startsWith('com.docker.compose.')) delete service.labels[key]
  }
  const raw = {name: project, services: {postgres, kestra: host}, volumes, networks: {
    default: {name: network, labels: {owner: project}}
  }}
  return {
    raw,
    public: {
      project, mode, base, image: inputs.hostImage,
      inputHashes: {amisJar: amisJarSha256, rbacJar: rbacJarSha256, configuration: sha256(host.environment.KESTRA_CONFIGURATION)},
      expectedMounts: {postgres: `${project}-postgres`, storage: actualStorage, plugins},
      rbacJar: mode === 'B' ? rbacJarSha256 : null
    }
  }
}
