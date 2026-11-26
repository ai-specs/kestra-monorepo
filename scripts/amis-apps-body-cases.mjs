import assert from 'node:assert/strict'
import {setTimeout as wait} from 'node:timers/promises'
import {amisApiPath, invokeAmisApi} from './amis-apps-http.mjs'

const sha = /^[a-f0-9]{64}$/
function verifyEffects(value) {
  assert(value?.windowMs >= 5000 && value.samples?.length)
  assert.deepEqual([...value.sources].sort(), ['database','queue','storage'])
  assert(sha.test(value.before) && value.immediate === value.before)
  assert(value.samples.at(-1).elapsedMs >= value.windowMs)
  let previous = -1
  for (const row of value.samples) {
    assert(row.elapsedMs >= previous); previous = row.elapsedMs
    assert.equal(row.hash,value.before)
    for (const key of ['database','queue','storage']) {
      assert(sha.test(value.beforeSources?.[key]));assert.equal(row.sources?.[key],value.beforeSources[key])
    }
  }
}
function inventory(value) {
  assert(Array.isArray(value) && value.every(id => typeof id === 'string' && id.length) && new Set(value).size === value.length)
  return [...value].sort()
}

/** Streaming authenticated boundary checks only. Caller owns production login, the
 * authenticated streaming closure, runtime ownership and isolated observations. */
export async function runAmisBodyCases({mode,base,client,identityEvidence,ownershipEvidence,target,effects,executionInventory,persist,signal,deadlineMs = 45000}) {
  const origin = new URL(base)
  assert(origin.origin === base && origin.protocol === 'http:' && origin.hostname === '127.0.0.1' && origin.port, 'Owned loopback origin required')
  assert(['A','B'].includes(mode) && ownershipEvidence?.verified === true && ownershipEvidence.base === base && ownershipEvidence.mode === mode)
  assert(typeof ownershipEvidence.owner === 'string' && ownershipEvidence.owner && /^[a-f0-9]{64}$/.test(ownershipEvidence.containerId))
  assert(typeof identityEvidence?.subject === 'string' && identityEvidence.subject && identityEvidence.issuer === base)
  assert.deepEqual(identityEvidence.exactAudiences,['kestra-ui'])
  if (mode === 'A') {
    assert.equal(identityEvidence.productionLogin,true,'Mode A requires explicit production login evidence')
    assert(!Object.hasOwn(identityEvidence,'group'),'Mode A identity must not invent an application group')
  } else {
    assert.equal(identityEvidence.group,'main','Mode B requires the signed main group')
    assert(Array.isArray(identityEvidence.scopeKeys) && identityEvidence.scopeKeys.every(key => typeof key === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(key))
      && new Set(identityEvidence.scopeKeys).size === identityEvidence.scopeKeys.length,'Mode B requires explicit signed scope keys')
    assert(Number.isSafeInteger(identityEvidence.authVersion) && identityEvidence.authVersion > 0,'Mode B signed authorization version required')
  }
  for (const method of ['requestStreaming','requestAccess']) assert.equal(typeof client?.[method],'function')
  for (const method of ['observeDenied','waitForIdle']) assert.equal(typeof effects?.[method],'function')
  assert.equal(typeof executionInventory,'function');assert.equal(typeof persist,'function')
  assert.equal(deadlineMs,45000,'Streaming deadline must remain 45 seconds')
  assert.equal(target.bodyTimeoutMs,30000,'Inspect the actual 30-second host body timeout')
  assert(/^[A-Za-z0-9_-]{1,80}$/.test(target.marker))
  const path = amisApiPath(target)
  const report = {mode,scope:'Streaming request boundaries; not complete P0 or browser proof',completed:false,
    identity:{subject:identityEvidence.subject,issuer:identityEvidence.issuer,exactAudiences:[...identityEvidence.exactAudiences],
      ...(mode==='A'?{productionLogin:true}:{group:'main',scopeKeys:[...identityEvidence.scopeKeys].sort(),authVersion:identityEvidence.authVersion})},checks:[]}
  let current
  const save = () => persist(structuredClone(report))
  const requestClient = {request:(url, options={})=>client.requestAccess(url,options)}
  await save()
  try {
    for (const [name,status] of [['body-over-1mib',400],['body-read-timeout',408],['body-cancel-before-submission',null]]) {
      current={name,status:'running',expectedStatus:status};report.checks.push(current)
      assert.equal((await effects.waitForIdle())?.active,0,'Isolated execution database must be idle')
      const before=inventory(await executionInventory());current.beforeInventory=before
      const controller=new AbortController(),abort=()=>controller.abort()
      signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort()
      const timer=setTimeout(abort,deadlineMs)
      let yielded=0,cancelRequested=false
      const started=performance.now()
      async function* chunks() {
        controller.signal.throwIfAborted()
        yielded++;yield Buffer.from('{"name":"'+target.marker+'-'+name+'","padding":"')
        if (name==='body-over-1mib') {
          controller.signal.throwIfAborted();yielded++;yield Buffer.alloc(1_048_577,0x61)
          controller.signal.throwIfAborted();yielded++;yield Buffer.from('"}')
        } else if (name==='body-cancel-before-submission') {
          await wait(100,{},{signal:controller.signal})
          cancelRequested=true;controller.abort()
          controller.signal.throwIfAborted()
        } else {
          for (;;) {
            await wait(1000,{},{signal:controller.signal})
            controller.signal.throwIfAborted();yielded++;yield Buffer.from('a')
          }
        }
      }
      try {
        const result=await effects.observeDenied(async()=>{
          try {
            const response=await client.requestStreaming(path,{chunks:chunks(),signal:controller.signal,timeoutMs:deadlineMs})
            assert.notEqual(name,'body-cancel-before-submission','Cancellation must reject, not return an HTTP response')
            return response
          } catch(error) {
            if(name!=='body-cancel-before-submission')throw error
            assert(cancelRequested && yielded===1,'Cancellation must follow one incomplete JSON chunk')
            assert(error?.name==='AbortError'||error?.code==='ABORT_ERR','Cancellation must retain abort classification')
            return {cancelled:true,abortClass:error.name==='AbortError'?'AbortError':'ABORT_ERR'}
          }
        },async response=>{
          if(status===null)assert.equal(response.cancelled,true)
          else {assert.equal(response.status,status,'Exact streaming rejection required');await response.body?.cancel()}
        },{windowMs:5000,intervalMs:250})
        verifyEffects(result.observation);current.effects=result.observation
        current.elapsedMs=Math.ceil(performance.now()-started)
        if(name==='body-read-timeout')assert(current.elapsedMs>=target.bodyTimeoutMs,'Premature timeout is not the host body-read deadline')
        assert.deepEqual(inventory(await executionInventory()),before,'Rejected upload created an execution')
        current.afterInventory=before;current.stream={chunksSent:yielded,cancelRequested,status,cancelled:status===null}
      } finally {clearTimeout(timer);controller.abort();signal?.removeEventListener('abort',abort)}
      const marker=target.marker+'-positive-'+name
      current.positive=await invokeAmisApi(requestClient,{...target,inputs:{name:marker},expectedData:{message:marker},timeoutMs:45000,signal})
      assert.equal((await effects.waitForIdle())?.active,0,'Positive execution must finish before final inventory')
      const after=inventory(await executionInventory())
      assert(!before.includes(current.positive.executionId))
      assert.deepEqual(after,[...before,current.positive.executionId].sort(),'Positive request must add exactly one execution')
      current.status='passed';await save()
    }
    report.completed=true;await save();return report
  } catch {
    if(current)current.status='failed'
    report.failure={case:current?.name??'initialization',message:'Streaming boundary assertion failed; raw transport details withheld'}
    await save()
    const error=new Error(report.failure.message);error.report=structuredClone(report);throw error
  }
}
