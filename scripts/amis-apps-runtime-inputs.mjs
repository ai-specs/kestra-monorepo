import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {isAbsolute} from 'node:path'
import {applicationProjectFeature} from './application-project-fixture.mjs'

const amisTarget = '/app/libs/kestra-amis-apps.jar'
const rbacTarget = '/app/libs/kestra-rbac-authorizer.jar'
const knownLibraryTargets = new Set(['/app/libs', amisTarget, rbacTarget])

export function configureAmisRuntime(originalHost, {mode, database, storage, amisJar, rbacJar, admin}) {
  assert(['A', 'B'].includes(mode))
  assert(/^application_group_acceptance_[0-9]+_[0-9]+$/.test(database), 'Owned acceptance database required')
  assert(new RegExp(`^amis-${mode.toLowerCase()}-[a-f0-9]+$`).test(storage), 'Mode-specific owned storage required')
  assert(isAbsolute(amisJar) && isAbsolute(rbacJar), 'Absolute formal jar paths required')
  assert(admin?.username && admin?.password, 'Generated test account required')
  const host = structuredClone(originalHost)
  let configuration = applicationProjectFeature(host.environment.KESTRA_CONFIGURATION, mode === 'B')
  assert(/^  oidc:/m.test(configuration), 'Known Kestra OIDC configuration boundary required')
  configuration = configuration.replace(/^  oidc:/m, '  jdbc:\n    queue:\n      cleaner:\n        retention: 24h\n  oidc:')
  const heading = /^kestra:[ \t]*\n/m.exec(configuration)
  assert(heading, 'Kestra configuration root missing')
  const contentStart = heading.index + heading[0].length
  const nextRoot = configuration.slice(contentStart).search(/^\S/m)
  const sectionEnd = nextRoot < 0 ? configuration.length : contentStart + nextRoot
  let section = configuration.slice(contentStart, sectionEnd)
  const existingSwitch = /^  amis-apps:\n    enabled: (?:true|false)(?=\n|$)/m
  if (existingSwitch.test(section)) section = section.replace(existingSwitch, '  amis-apps:\n    enabled: true')
  else {
    assert(!/^  amis-apps:/m.test(section), 'Unrecognized AMIS test configuration; do not silently overwrite')
    section = '  amis-apps:\n    enabled: true\n' + section
  }
  configuration = configuration.slice(0, contentStart) + section + configuration.slice(sectionEnd)
  assert(configuration.includes('jdbc:postgresql://postgres:5432/kestra'), 'Known original database URL required')
  configuration = configuration.replaceAll('jdbc:postgresql://postgres:5432/kestra', `jdbc:postgresql://postgres:5432/${database}`)
  host.environment.KESTRA_CONFIGURATION = configuration
  for (const [key, value] of Object.entries({USERNAME: admin.username, PASSWORD: admin.password,
    EMAIL: `${admin.username}@acceptance.invalid`, NAME: 'AMIS acceptance manager'})) {
    host.environment[`KESTRA_OIDC_BOOTSTRAP_${key}`] = value
  }
  const volumes = host.volumes ?? []
  assert(volumes.every(volume => typeof volume === 'object' && volume.target), 'Explicit long-form mounts required')
  assert(!volumes.some(volume => volume.target.startsWith('/app/libs') && !knownLibraryTargets.has(volume.target)),
    'Unapproved extension mount in isolated AMIS acceptance')
  host.volumes = volumes.filter(volume => volume.target !== '/app/storage' && !knownLibraryTargets.has(volume.target))
  host.volumes.push({type: 'volume', source: storage, target: '/app/storage'})
  host.volumes.push({type: 'bind', source: amisJar, target: amisTarget, read_only: true})
  if (mode === 'B') host.volumes.push({type: 'bind', source: rbacJar, target: rbacTarget, read_only: true})
  return host
}

export function validateAmisRuntimeInspection(actual, expected) {
  assert(['A', 'B'].includes(expected.mode))
  assert(/^ghcr\.io\/ai-specs\/kestra-overlay@sha256:[a-f0-9]{64}$/.test(expected.image), 'Formal image digest required')
  assert(typeof expected.project === 'string' && expected.project.length > 0, 'Explicit owner required')
  assert(typeof expected.storageVolume === 'string' && expected.storageVolume.length > 0, 'Explicit storage volume required')
  assert(typeof expected.configuration === 'string' && expected.configuration.length > 0, 'Explicit configuration required')
  assert.equal(actual.Config?.Image, expected.image, 'Runtime image differs')
  for (const key of ['owner', 'com.docker.compose.project']) {
    assert.equal(actual.Config?.Labels?.[key], expected.project, 'Runtime owner differs')
  }
  const port = String(new URL(expected.base).port || '80')
  const bindings = actual.NetworkSettings?.Ports?.['8080/tcp'] ?? []
  assert(bindings.some(binding => binding.HostIp === '127.0.0.1' && binding.HostPort === port), 'Owned loopback port differs')
  const mounts = actual.Mounts ?? []
  const storage = mounts.filter(mount => mount.Destination === '/app/storage')
  assert.equal(storage.length, 1)
  assert.equal(storage[0].Type, 'volume')
  assert.equal(storage[0].Name, expected.storageVolume)
  const libraries = mounts.filter(mount => mount.Destination.startsWith('/app/libs'))
  assert.deepEqual(libraries.map(mount => mount.Destination).sort(),
    (expected.mode === 'B' ? [amisTarget, rbacTarget] : [amisTarget]).sort(), 'Actual A/B libraries differ')
  for (const library of libraries) {
    assert.equal(library.Type, 'bind')
    assert.equal(library.RW, false, 'Formal jars must be read-only')
    assert.equal(library.Source, library.Destination === amisTarget ? expected.amisJar : expected.rbacJar,
      'Runtime mounted a different artifact path')
  }
  const configuration = actual.Config.Env.filter(value => value.startsWith('KESTRA_CONFIGURATION='))
  assert.equal(configuration.length, 1)
  const digest = value => createHash('sha256').update(value).digest('hex')
  assert.equal(digest(configuration[0].slice('KESTRA_CONFIGURATION='.length)), digest(expected.configuration),
    'Actual configuration differs; credential-bearing content is not included in diagnostics')
  return {mode: expected.mode, amisPresent: true, rbacPresent: expected.mode === 'B', storageVolume: storage[0].Name}
}
