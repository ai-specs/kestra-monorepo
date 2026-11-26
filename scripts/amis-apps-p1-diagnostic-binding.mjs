import assert from 'node:assert/strict'

const responseKinds=new Set(['http-response','http-error','request-failed'])
const businessPath=/^\/company\.amis\.a\/p1-[a-z-]+\/apis\/run(?:\/executions\/[A-Za-z0-9_-]+)?$/
const tuple=e=>JSON.stringify([e.documentId,e.requestId,e.url,e.method])

/** Revalidates public production-verification receipts and immutable collector
 * linkage. Does not receive a JWT and does not reverify its signature offline. */
export function validateP1DiagnosticBinding(row,evidence,diagnostics) {
 assert(Array.isArray(diagnostics.events));assert.deepEqual(diagnostics.integrity,[])
 const events=diagnostics.events,login=row.productionLogin
 assert(events.every(e=>e&&e.id&&e.documentId&&e.kind),'Collector event identity missing')
 assert.equal(new Set(events.map(e=>e.id)).size,events.length,'Duplicate collector event ID')
 assert(login&&login.subject&&login.credentialsSubmitted===true)
 assert.equal(login.transport,'production-browser');assert.equal(login.httpStatus,303)
 const credentials=events.filter(e=>e.kind==='request'&&e.method==='POST'&&e.requestId===login.requestId&&e.documentId===login.documentId)
 assert.equal(credentials.length,1,'Exact credential request missing or duplicated')
 const credential=credentials[0],base=new URL(credential.url).origin
 assert.equal(credential.url,base+'/oidc/login')
 assert.equal(events.filter(e=>e.kind==='http-response'&&e.status===303&&tuple(e)===tuple(credential)).length,1,'Exact credential redirect missing or duplicated')
 const identity=login.identity
 assert(identity&&identity.signatureVerified===true,'Production signature-verification receipt missing')
 assert.notEqual(identity.synthetic,true)
 assert.equal(identity.subject,login.subject);assert.equal(identity.issuer,base)
 assert.deepEqual(identity.audiences,['kestra-ui'])
 if(row.id.startsWith('B-')) {
  assert.equal(identity.applicationGroupId,'main')
  assert(Number.isSafeInteger(identity.authorizationVersion)&&identity.authorizationVersion>0)
  assert(Array.isArray(identity.applicationGroupScopes)&&identity.applicationGroupScopes.every(s=>typeof s==='string'&&s.length>0))
  assert.equal(new Set(identity.applicationGroupScopes).size,identity.applicationGroupScopes.length)
 }
 assert.deepEqual(evidence.browser.productionLogin,login);assert.deepEqual(evidence.browser.identity,identity)
 const relevant=e=>{if(typeof e.url!=='string')return false;const url=new URL(e.url);return url.origin===base&&businessPath.test(url.pathname)&&!url.search&&!url.hash&&!url.username&&!url.password}
 const requests=events.filter(e=>e.kind==='request'&&relevant(e))
 assert(requests.every(e=>e.requestId&&e.method),'Business request identity missing')
 assert.equal(new Set(requests.map(tuple)).size,requests.length,'Duplicate business request identity')
 const responses=events.filter(e=>responseKinds.has(e.kind)&&relevant(e))
 for(const response of responses)assert.equal(requests.filter(request=>tuple(request)===tuple(response)).length,1,'Orphan business response')
 const derived=requests.map(request=>({...request,responses:responses.filter(response=>tuple(response)===tuple(request))}))
 assert(derived.every(request=>request.responses.length>0),'Business response/failure missing')
 assert.deepEqual(evidence.browser.trace,derived,'Business trace differs from complete immutable collector')
 if(row.id.endsWith('authenticated-refusal-has-no-delayed-effects')) {
  const status=row.id.startsWith('A-')?401:403
  const refusal=row.refusal
  assert.equal(refusal?.method,'POST');assert.equal(refusal.path,'/company.amis.a/p1-async/apis/run')
  assert.equal(refusal.status,status);assert.equal(refusal.expectedStatus,status)
  assert.equal(refusal.identity,row.id.startsWith('A-')?'anonymous':login.subject)
  assert.deepEqual(evidence.refusal,refusal);assert.deepEqual(evidence.sideEffects,row.sideEffects)
  const effects=row.sideEffects
  assert(Number.isFinite(effects.windowMs)&&effects.windowMs>=5000)
  const snapshot=value=>{assert(value&&typeof value==='object');assert.deepEqual(Object.keys(value).sort(),['database','queue','storage']);for(const sha of Object.values(value))assert.match(sha,/^[a-f0-9]{64}$/);assert.deepEqual(value,effects.before)}
  snapshot(effects.before);snapshot(effects.after)
  if(effects.immediateSources!==undefined)snapshot(effects.immediateSources)
  assert(Array.isArray(effects.samples)&&effects.samples.length>0)
  let previous=-1
  for(const sample of effects.samples){assert(Number.isFinite(sample.elapsedMs)&&sample.elapsedMs>=0&&sample.elapsedMs>previous,'Nonmonotonic or nonfinite side-effect sampling');previous=sample.elapsedMs;snapshot(sample.sources)}
  assert(previous>=effects.windowMs,'Incomplete delayed observation')
 }
 return {scope:'immutable-diagnostics-and-public-identity-receipt',origin:base,requests:requests.length,responses:responses.length,posts:requests.filter(e=>e.method==='POST').length,identityScope:'Producer signature-verification receipt validated; JWT signature not reverified offline',refusalChecked:row.id.endsWith('authenticated-refusal-has-no-delayed-effects')}
}
