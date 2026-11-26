import assert from 'node:assert/strict'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {planAmisActors} from './amis-apps-actors.mjs'
import {invokeAmisApi} from './amis-apps-http.mjs'

export const amisPermissionCaseIds = Object.freeze([
  'B-page-entry-denied-zero-lookups', 'B-api-entry-denied-zero-lookups', 'B-flow-only-entry-denied',
  'B-entry-only-missing-target-404', 'B-entry-only-existing-flow-execution-denied',
  'B-multiple-scopes-distinct-resource-ranges', 'B-namespace-exact-subtree-complement-boundaries'
])
const counters = ['flowLookup', 'flowMeta', 'schemaStorage', 'namespaceResolve', 'flowAuthorization']
const listeners = ['flowRepositoryListener', 'flowMetaStoreListener', 'storageListener', 'namespaceFactoryListener', 'authorizationListener']
const hashPattern = /^[a-f0-9]{64}$/
const sorted = array => [...array].sort()

function verifyProbe(value) {
  assert(typeof value?.generation === 'string' && value.generation, 'Real probe generation required')
  assert.equal(value.integrity, 'ok', 'Probe integrity must be ok')
  for (const name of listeners) assert.equal(value.readiness?.[name], true, `Probe listener not ready: ${name}`)
  for (const name of counters) assert(Number.isSafeInteger(value[name]) && value[name] >= 0, `Missing probe counter ${name}`)
  return structuredClone(value)
}
function verifyDeniedObservation(value) {
  assert(Number.isFinite(value?.windowMs) && value.windowMs >= 5000, 'Denied effects window must be >=5000ms')
  assert.deepEqual(sorted(value.sources ?? []), ['database', 'queue', 'storage'])
  assert(hashPattern.test(value.before) && value.immediate === value.before, 'Denied immediate effect changed')
  for (const source of ['database', 'queue', 'storage']) assert(hashPattern.test(value.beforeSources?.[source]), `Missing before ${source}`)
  assert(Array.isArray(value.samples) && value.samples.length > 0, 'Actual delayed effect samples required')
  assert(value.samples.at(-1).elapsedMs >= value.windowMs, 'Delayed observation ended too early')
  let previous = -1
  for (const sample of value.samples) {
    assert(Number.isFinite(sample.elapsedMs) && sample.elapsedMs >= previous, 'Invalid effect sample time')
    previous = sample.elapsedMs
    assert.equal(sample.hash, value.before, 'Denied delayed effect changed')
    for (const source of ['database', 'queue', 'storage']) assert.equal(sample.sources?.[source], value.beforeSources[source], `Denied ${source} changed or missing`)
  }
}

/** Existing deployment only. REST fragment, never a complete browser/P0 acceptance result. */
export async function runAmisPermissionCases({base, actors, clientFactory = () => new ProductionOAuthClient(base), target, effects, probe, persist}) {
  assert.equal(new URL(base).origin, base)
  assert.equal(typeof persist, 'function')
  for (const method of ['waitForIdle', 'waitForStable', 'observeDenied']) assert.equal(typeof effects?.[method], 'function', `effects.${method} required`)
  assert.equal(typeof probe?.snapshot, 'function', 'Real public-contract probe required')
  const ns = value => typeof value === 'string' && value.length <= 150 && /^[a-z0-9][a-z0-9_-]*(\.[a-z0-9_-]+)*$/.test(value)
  assert(ns(target?.namespaceA) && ns(target.namespaceB) && target.namespaceA !== target.namespaceB)
  assert(typeof target.flowId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(target.flowId))
  for (const id of [target.pageId, target.apiId]) assert(typeof id === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_-]{0,99}$/.test(id))
  assert(typeof target.marker === 'string' && target.marker.trim(), 'Caller supplies execution marker')
  assert(ns(target.namespaceOutside) && ![target.namespaceA, target.namespaceB].includes(target.namespaceOutside), 'Explicit outside/company2 namespace required')
  const pathFor = (namespace, kind, id) => `/${namespace}/${target.flowId}/${kind}/${id}`
  const page = namespace => pathFor(namespace, 'pages', target.pageId)
  const schema = namespace => pathFor(namespace, 'schemas', target.pageId)
  const api = namespace => pathFor(namespace, 'apis', target.apiId)
  assert(typeof target.missingPath === 'string' && target.missingPath.startsWith(`/${target.namespaceA}/`) && !/[\\%?#:]|\/\./.test(target.missingPath), 'Explicit known nonexistent in-scope missingPath required')
  assert(![page(target.namespaceA), schema(target.namespaceA), api(target.namespaceA)].includes(target.missingPath), 'missingPath must differ from known target')
  const plan = planAmisActors({namespaceA: target.namespaceA, namespaceB: target.namespaceB})
  assert(Array.isArray(actors) && actors.length === plan.actors.length, 'Explicit current-plan private actors required')
  assert.equal(new Set(actors.map(actor => actor.key)).size, plan.actors.length)
  assert.equal(new Set(actors.map(actor => actor.username)).size, plan.actors.length)
  for (const actor of plan.actors) {
    const actual = actors.find(value => value.key === actor.key)
    assert(actual && typeof actual.username === 'string' && actual.username && typeof actual.password === 'string' && actual.password, `Private actor missing ${actor.key}`)
    assert.deepEqual(sorted(actual.scopeKeys), sorted(actor.scopeKeys), `Actor plan scope mismatch: ${actor.key}`)
  }
  const secrets = actors.map(actor => actor.password)
  const clean = value => {
    if (typeof value === 'string') {for (const secret of secrets) value = value.replaceAll(secret, '[redacted]').replaceAll(encodeURIComponent(secret), '[redacted]'); return value.replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')}
    if (Array.isArray(value)) return value.map(clean)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(password|temporarypassword|token|accesstoken|idtoken|refreshtoken|cookie|authorization|clientsecret)$/.test(key.toLowerCase().replace(/[^a-z]/g,''))).map(([key, item]) => [key, clean(item)]))
    return value
  }
  const report = {schemaVersion: 1, completed: false, scope: 'REST permission fragment only; no browser, UI completion, deployment or full 44-case/P0 verdict', transport: 'client-supplied; actual identity and effects depend on caller environment', cases: amisPermissionCaseIds.map(id => ({id, status: 'not_run', observations: []})), positiveControl: null}
  let current
  const record = async () => persist(clean(structuredClone(report)))
  const stable = async () => {
    const idle = await effects.waitForIdle()
    assert.equal(idle?.active, 0, 'Acceptance namespace not idle')
    const stability = await effects.waitForStable()
    assert(stability?.windowMs >= 5000 && Array.isArray(stability.samples) && stability.samples.length > 0, 'Real stable effects evidence required')
    for (const sample of stability.samples) {
      assert(hashPattern.test(sample.hash), 'Missing stable snapshot hash')
      for (const source of ['database','queue','storage']) assert(hashPattern.test(sample.sources?.[source]), `Missing stable ${source} source`)
    }
    return {idle, stability}
  }
  const snapshot = async () => verifyProbe(await probe.snapshot())
  const login = async key => {
    const actor = actors.find(value => value.key === key)
    const client = clientFactory()
    assert.equal(typeof client?.request, 'function')
    const logout = await client.request('/oidc/logout')
    assert([200,302,303,307,308].includes(logout.status), 'Production logout failed')
    await logout.body?.cancel()
    const result = await client.login(actor.username, actor.password)
    assert(result.authenticated === true && result.credentialsSubmitted === true, 'Fresh credential submission required')
    const identity = await client.verifiedUiIdentity({applicationGroupId: 'main', subject: actor.username, audience: 'kestra-ui'})
    assert.deepEqual(sorted(identity.applicationGroupScopes), sorted(actor.scopeKeys), `Signed exact scopes differ: ${key}`)
    assert(Number.isSafeInteger(identity.authorizationVersion) && identity.authorizationVersion > 0, 'Signed authorization version missing')
    const evidence = {actor: key, subject: actor.username, scopeKeys: identity.applicationGroupScopes, authorizationVersion: identity.authorizationVersion}
    current.identities ??= []; current.identities.push(evidence)
    return client
  }
  const allow = async (client, namespace, label) => {
    const marker = `${target.marker}-${label}`
    const before = await snapshot()
    if (report.positiveControl) assert.equal(before.generation, report.positiveControl.after.generation, 'Probe generation differs from positive control')
    const result = await invokeAmisApi(client, {namespace, flowId: target.flowId, apiId: target.apiId, inputs: {name: marker}, expectedData: {message: marker}, timeoutMs: target.timeoutMs ?? 60000, intervalMs: target.intervalMs ?? 250})
    const after = await snapshot()
    assert.equal(after.generation, before.generation, 'Probe generation changed during positive control')
    for (const counter of ['flowLookup','flowMeta','flowAuthorization']) assert(after[counter] > before[counter], `Positive control did not exercise ${counter}`)
    const observation = {kind: 'allow', path: api(namespace), method: 'POST', marker, before, after, execution: result}
    current.observations.push(observation)
    await stable()
    return observation
  }
  const allowSchema = async client => {
    await stable()
    const before = await snapshot()
    assert.equal(before.generation, report.positiveControl.after.generation, 'Schema probe generation differs from API positive control')
    const identity = structuredClone(current.identities.at(-1))
    assert.equal(identity.actor, 'split', 'Schema control must use the split allow identity')
    const observation = {kind:'allow-schema',path:schema(target.namespaceA),method:'GET',identity,before,completed:false}
    current.observations.push(observation)
    const response = await client.request(observation.path, {method:'GET',redirect:'manual',signal:AbortSignal.timeout(30000)})
    observation.status = response.status
    assert.equal(response.status,200,'Schema positive control must succeed')
    const value = await response.json()
    assert(value && !Array.isArray(value) && value.type === 'page', 'Schema positive control must return an AMIS page')
    const after = await snapshot(); observation.after = after
    assert.equal(after.generation,before.generation,'Probe generation changed during schema positive control')
    for (const name of ['namespaceResolve','schemaStorage']) assert(after[name]>before[name],`Schema positive control did not exercise ${name}`)
    Object.assign(observation,{schemaType:value.type,completed:true})
    await record()
    return observation
  }
  const deny = async (client, path, method, expectedStatus, zeroLookups) => {
    await stable()
    const before = await snapshot()
    assert.equal(before.generation, report.positiveControl?.after.generation, 'Probe generation differs from positive control')
    assert.equal(before.generation, report.schemaPositiveControl?.after.generation, 'Probe generation differs from schema positive control')
    const observation = {kind:'deny',path,method,expectedStatus,zeroLookups,before,completed:false,
      positiveControls:{apiGeneration:report.positiveControl.after.generation,schemaGeneration:report.schemaPositiveControl.after.generation,schemaPath:report.schemaPositiveControl.path,schemaIdentity:report.schemaPositiveControl.identity}}
    current.observations.push(observation)
    let actualStatus
    const result = await effects.observeDenied(() => client.request(path, {method, ...(method === 'POST' ? {headers: {'Content-Type':'application/json'},body:JSON.stringify({name:target.marker})} : {})}), async response => {
      actualStatus = response.status
      observation.status = actualStatus
      await response.body?.cancel()
      assert.equal(response.status, expectedStatus, `Unexpected ${method} ${path} status`)
    }, {windowMs:5000,intervalMs:250})
    verifyDeniedObservation(result.observation)
    const after = await snapshot()
    assert.equal(after.generation,before.generation,'Probe generation changed during denial')
    const difference = Object.fromEntries(counters.map(key => [key,after[key]-before[key]]))
    if (zeroLookups) for (const key of counters) assert.equal(difference[key],0,`First gate denial queried ${key}`)
    Object.assign(observation,{status:actualStatus,after,difference,sideEffects:result.observation,completed:true})
  }
  await record()
  for (const row of report.cases) {
    current = row
    try {
      row.baseline = await stable()
      if (!report.positiveControl) {
        const client = await login('split')
        report.positiveControl = await allow(client,target.namespaceA,'counter-positive')
        report.schemaPositiveControl = await allowSchema(client)
      }
      if (row.id === amisPermissionCaseIds[0]) await deny(await login('flow-only'),page(target.namespaceA),'GET',403,true)
      if (row.id === amisPermissionCaseIds[1]) await deny(await login('flow-only'),api(target.namespaceA),'POST',403,true)
      if (row.id === amisPermissionCaseIds[2]) await deny(await login('flow-only'),schema(target.namespaceA),'GET',403,true)
      if (row.id === amisPermissionCaseIds[3]) await deny(await login('entry-only'),target.missingPath,'GET',404,false)
      if (row.id === amisPermissionCaseIds[4]) await deny(await login('entry-only'),api(target.namespaceA),'POST',403,false)
      if (row.id === amisPermissionCaseIds[5]) {
        await allow(await login('split'),target.namespaceA,'split-a')
        const mixed = await login('mixed-ranges')
        await deny(mixed,api(target.namespaceA),'POST',403,false)
        await deny(mixed,api(target.namespaceB),'POST',403,true)
      }
      if (row.id === amisPermissionCaseIds[6]) {
        const exact = await login('exact-a')
        await allow(exact,target.namespaceA,'exact-a')
        await deny(exact,api(target.namespaceA+'.child'),'POST',403,true)
        const complement = await login('complement')
        await allow(complement,target.namespaceA,'complement-a')
        await deny(complement,api(target.namespaceB),'POST',403,true)
        await deny(complement,api(target.namespaceB+'.child'),'POST',403,true)
        await deny(await login('allow-a'),api(target.namespaceOutside),'POST',403,true)
      }
      row.status='passed'
      await record()
    } catch (error) {
      row.status='failed'; row.error=String(error.message)
      if(error.sideEffects)row.failedSideEffects=error.sideEffects
      report.failure={id:row.id,message:String(error.message)}
      report.counts={passed:report.cases.filter(value=>value.status==='passed').length,failed:1,notRun:report.cases.filter(value=>value.status==='not_run').length,skipped:0}
      const retained=clean(structuredClone(report))
      try {await persist(retained)} catch(failure) {retained.persistenceFailure=clean(String(failure.message))}
      const failure=new Error(clean(`AMIS REST fragment ${row.id}: ${error.message}`)); failure.report=retained; throw failure
    }
  }
  report.completed=true
  report.counts={passed:report.cases.length,failed:0,notRun:0,skipped:0}
  await record()
  return clean(structuredClone(report))
}
