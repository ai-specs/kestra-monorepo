import assert from 'node:assert/strict'
import {createHash,randomBytes} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {applicationProject} from './application-project-cases.mjs'
import {persistentPsqlSession} from './access-control-v3-ui-controls.mjs'

export const transactionCheckIds=Object.freeze([
  'participant-write-then-throw-rollback','host-delete-failure-rollback',
  'concurrent-mutual-delete-last-admin','concurrent-mutual-disable-last-admin',
])

export const transactionRequiredInputs=Object.freeze({
  base:'exact production issuer origin',
  planned:'planFixture output; transactionInputs below is mandatory',
  'planned.transactionInputs':{
    isolated:true,exclusiveWriters:true,profile:'new-install',
    sourceRef:'root publication/owner evidence reference',
    imageDigest:'sha256:<64 lowercase hex>',jarHash:'<64 lowercase hex>',
    bootstrapSubject:'planned.admin.subject',effectsWindowMs:'integer 5000..60000',
  },
  management:'ApplicationGroupManagement instance for planned.admin, same origin',
  assertOwner:'async () => void; throws unless this run owns the isolated database',
  query:'async (sql) => trimmed psql -At scalar string, ON_ERROR_STOP; same owner database as HTTP',
  effects:'{snapshot: async () => ({hash: SHA256})}; no concurrent business writers',
  sessionProbe:'ProductionOAuthClient.probeCurrentIdpSession(); existing cookies only, outside persistent hash windows; memory/HTTP evidence, not a database session table',
  transactionObserver:'{owner,spawnPsql}; existing primary PG owned piped psql observer; required for real concurrent checks, no fallback',
  record:'async (completePartialFragment) => void; persist on every transition including failure',
})

const sourceRef='scripts/access-control-v3-transactions.mjs'
const api='/api/v1/main/extensions/rbac'
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const hashPattern=/^[a-f0-9]{64}$/
const identifier=/^[a-z][a-z0-9_]{0,62}$/
const groupIdentifier=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const accountPath=subject=>api+'/users/detail?subject='+encodeURIComponent(subject)
const grantPath=(group,subject)=>api+'/application-groups/'+encodeURIComponent(group)+'/scope-grants/detail?subject='+encodeURIComponent(subject)

// Formal host OidcSecurityTransactions.lock(Connection), patch 0380, uses this
// bigint advisory transaction lock. No product test hook or alternate lock key.
const securityLock=1380073797
const literal=value=>"'"+String(value).replaceAll("'","''")+"'"
const identitySql="SELECT json_build_object('database',current_database(),'databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),'postmasterEpoch',extract(epoch FROM pg_postmaster_start_time())::text,'sessionUser',session_user,'pid',pg_backend_pid(),'backendStart',(SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()),'applicationName',current_setting('application_name'))::text;"
const databaseBinding=value=>({database:value.database,databaseOid:value.databaseOid,postmasterEpoch:value.postmasterEpoch,sessionUser:value.sessionUser})

/** Prepare an exclusive cohort after the real periodic protocol writer drains.
 * No HTTP mutation is issued here, no scheduler is disabled, and this phase is
 * outside the before/after mutation snapshot. Each hold is server-bounded;
 * the subsequent observer still rejects every unexpected third waiter.
 */
export async function prepareSecurityLockCohort({owner,assertOwner,query,spawnPsql,timeoutMs=75000,heartbeatMs=500,pollMs=25}) {
  assert(owner?.isolated===true&&owner.exclusiveWriters===true)
  assert(/^application-projects-bb-[0-9]+-[0-9]+$/.test(owner.composeProject))
  assert.equal(owner.postgresComposeProject,owner.composeProject);assert.equal(owner.database,'kestra')
  assert(/^[a-f0-9]{12,64}$/.test(owner.postgresContainer))
  for(const callback of [assertOwner,query,spawnPsql])assert.equal(typeof callback,'function')
  assert(Number.isSafeInteger(timeoutMs)&&timeoutMs>=50&&timeoutMs<=75000)
  assert(Number.isSafeInteger(heartbeatMs)&&heartbeatMs>=10&&heartbeatMs<=1000)
  assert(Number.isSafeInteger(pollMs)&&pollMs>=1&&pollMs<=100)
  const owned=Object.freeze({...owner}),applicationName='root_t6_barrier_'+randomBytes(12).toString('hex')
  await assertOwner(owned)
  const initial=JSON.parse(await query(identitySql)),binding=databaseBinding(initial)
  assert.equal(initial.database,owned.database)
  const rowsSql="SELECT coalesce(json_agg(json_build_object('pid',a.pid,'applicationName',a.application_name,'backendStart',a.backend_start::text,'granted',l.granted,'blockers',pg_blocking_pids(a.pid))),'[]'::json)::text FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND l.classid=0 AND l.objid="+securityLock+" AND l.objsubid=1;"
  assert.deepEqual(JSON.parse(await query(rowsSql)),[],'preparation requires no pre-existing lock cohort')
  const child=await spawnPsql({owner:owned,applicationName}),session=persistentPsqlSession(child,{commandTimeoutMs:1500})
  let holder,observed,drained=false,phase='bind-holder'
  const samples=[]
  const began=performance.now(),deadline=began+timeoutMs
  try {
    holder=JSON.parse(await session.query(identitySql));assert.deepEqual(databaseBinding(holder),binding)
    assert.equal(holder.applicationName,applicationName)
    // One continuous owned transaction avoids unobserved gaps between holds.
    // Heartbeats keep only this test holder alive; a stalled runner is still
    // disconnected by PostgreSQL after four idle seconds.
    phase='observe-periodic-writer'
    await session.query("BEGIN ISOLATION LEVEL READ COMMITTED; SET LOCAL statement_timeout='1500ms'; SET LOCAL idle_in_transaction_session_timeout='4s'; SELECT pg_advisory_xact_lock("+securityLock+");")
    try {
      let heartbeat=performance.now()
      do {
          if(performance.now()-heartbeat>=heartbeatMs){await assertOwner(owned);await session.query('SELECT 1;');heartbeat=performance.now()}
          const rows=JSON.parse(await query(rowsSql)),holders=rows.filter(row=>row.granted),waiters=rows.filter(row=>!row.granted)
          samples.push({elapsedMs:Math.ceil(performance.now()-began),rows});if(samples.length>4)samples.shift()
          assert.equal(holders.length,1);assert.equal(holders[0].pid,holder.pid)
          assert(waiters.length<=1,'unexpected multiple background writers before the exclusive HTTP cohort')
          if(waiters.length) {
            const writer=waiters[0]
            assert(Number.isSafeInteger(writer.pid)&&writer.pid!==holder.pid&&writer.applicationName==='PostgreSQL JDBC Driver')
            assert.deepEqual(writer.blockers,[holder.pid])
            observed={writer,observedAt:new Date().toISOString()};break
          }
          await delay(pollMs)
      }while(performance.now()<deadline)
    }finally{await session.query('ROLLBACK;')}
    phase='require-observed-writer'
    assert(observed,'periodic protocol writer was not actually observed within the preparation deadline')
    phase='verify-drained';const drainDeadline=performance.now()+2000
    while(JSON.parse(await query(rowsSql)).length){assert(performance.now()<drainDeadline,'background security writer did not drain');await delay(pollMs)}
    drained=true
  }catch(error){error.preparationEvidence={source:'owned-primary-pg-background-writer-drain',failurePhase:phase,errorKind:error.name,elapsedMs:Math.ceil(performance.now()-began),samples};throw error}
  finally{await session.close()}
  assert(drained)
  return {source:'owned-primary-pg-background-writer-drain',lockKey:securityLock,holderPid:holder.pid,applicationName,...observed,drained:true,elapsedMs:Math.ceil(performance.now()-began),serverIdleTimeoutMs:4000,maxPreparationMs:timeoutMs,heartbeatMs,productHttpRequests:0,schedulerDisabled:false}
}

/** Owned test observer only. spawnPsql must return the existing primary PG's
 * piped psql process, with PGAPPNAME=applicationName; never a new PG/container.
 * Request-to-backend association is an exclusive two-request cohort, not a
 * fabricated per-actor PID mapping (production prepared SQL carries no actor).
 */
export async function observeSecurityLockCompetition({owner,assertOwner,query,spawnPsql,requests,
  waitTimeoutMs=1500,pollIntervalMs=25}) {
  assert(owner?.isolated===true&&owner.exclusiveWriters===true)
  assert(/^application-projects-bb-[0-9]+-[0-9]+$/.test(owner.composeProject))
  assert.equal(owner.postgresComposeProject,owner.composeProject)
  assert.equal(owner.database,'kestra','only the existing primary acceptance database may be held')
  assert(/^[a-f0-9]{12,64}$/.test(owner.postgresContainer))
  for(const callback of [assertOwner,query,spawnPsql])assert.equal(typeof callback,'function','owned primary-PG transaction observer required')
  assert(Array.isArray(requests)&&requests.length===2&&requests.every(item=>typeof item.run==='function'&&hashPattern.test(item.actorHash)&&hashPattern.test(item.targetHash)))
  assert.notEqual(requests[0].actorHash,requests[1].actorHash)
  assert.equal(requests[0].actorHash,requests[1].targetHash);assert.equal(requests[1].actorHash,requests[0].targetHash)
  assert(Number.isSafeInteger(waitTimeoutMs)&&waitTimeoutMs>=50&&waitTimeoutMs<=2000)
  assert(Number.isSafeInteger(pollIntervalMs)&&pollIntervalMs>=1&&pollIntervalMs<=100)
  const owned=Object.freeze({...owner}),applicationName='root_t6_barrier_'+randomBytes(12).toString('hex')
  const bounded=async(operation,timeoutMs,label)=>{
    let timer
    try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('owned security observer timeout: '+label)),timeoutMs)})])}
    finally{clearTimeout(timer)}
  }
  const sql=async statement=>{await bounded(()=>assertOwner(owned),1000,'owner');return String(await bounded(()=>query(statement),1500,'query')).trim()}
  const identity=JSON.parse(await sql(identitySql));assert.equal(identity.database,owned.database)
  assert(/^[1-9][0-9]*$/.test(identity.databaseOid)&&typeof identity.postmasterEpoch==='string'&&identity.postmasterEpoch.length)
  const binding=databaseBinding(identity)
  let session,holder,observation,results,started=false,failure,cleanupFailure,phase='preflight',began,failureElapsed,failureSettled
  const samples=[]
  const requestTimings=[]
  const pending=[],settled=[false,false]
  const lockRowsSql="SELECT coalesce(json_agg(json_build_object('pid',a.pid,'applicationName',a.application_name,'backendStart',a.backend_start::text,'transactionStart',a.xact_start::text,'queryStart',a.query_start::text,'backendXid',a.backend_xid::text,'virtualTransaction',l.virtualtransaction,'granted',l.granted,'waitEventType',a.wait_event_type,'blockers',pg_blocking_pids(a.pid),'securityLockQuery',a.query ~* 'pg_advisory_xact_lock[[:space:]]*[(][[:space:]]*1380073797[[:space:]]*[)]') ORDER BY a.pid),'[]'::json)::text FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND l.classid=0 AND l.objid="+securityLock+" AND l.objsubid=1;"
  const present=()=>sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid="+holder.pid+" AND datname="+literal(owned.database)+" AND application_name="+literal(applicationName)+" AND backend_start::text="+literal(holder.backendStart)+")::text;")
  try {
    assert.deepEqual(JSON.parse(await sql(lockRowsSql)),[],'security lock already has an unrelated holder/waiter')
    await bounded(()=>assertOwner(owned),1000,'spawn-owner')
    let spawnExpired=false
    const spawning=Promise.resolve().then(()=>spawnPsql({owner:owned,applicationName})).then(child=>{
      if(spawnExpired){child.stdin?.end();child.kill('SIGTERM');throw new Error('late owned observer spawn discarded')}
      return child
    })
    let child
    try{child=await bounded(()=>spawning,1500,'spawn')}catch(error){spawnExpired=true;throw error}
    phase='bind-holder';session=persistentPsqlSession(child,{commandTimeoutMs:1500})
    holder=JSON.parse(await session.query(identitySql))
    assert.deepEqual(databaseBinding(holder),binding,'holder is not on the same primary PG/database/user')
    assert.equal(holder.applicationName,applicationName)
    assert(Number.isSafeInteger(holder.pid)&&holder.pid>0&&typeof holder.backendStart==='string'&&holder.backendStart.length)
    // Server-side timeout bounds even a stalled JS observer or failed Docker pipe.
    phase='acquire-holder';await session.query("BEGIN ISOLATION LEVEL READ COMMITTED; SET LOCAL statement_timeout='1500ms'; SET LOCAL idle_in_transaction_session_timeout='4s'; SELECT pg_advisory_xact_lock("+securityLock+");")
    const acquired=JSON.parse(await sql(lockRowsSql))
    assert.equal(acquired.length,1);assert.equal(acquired[0].pid,holder.pid);assert.equal(acquired[0].granted,true)
    began=performance.now();const deadline=began+waitTimeoutMs
    started=true
    for(const [index,item]of requests.entries())pending.push(Promise.resolve().then(()=>{requestTimings[index]={index,startedAfterMs:Math.ceil(performance.now()-began)};return item.run()}).finally(()=>{settled[index]=true;requestTimings[index].settledAfterMs=Math.ceil(performance.now()-began)}))
    // Attach rejection handlers immediately, also on failed observation paths.
    results=Promise.allSettled(pending)
    do {
      phase='observe-waiters';assert(!settled.some(Boolean),'request completed before both transactions were observed waiting')
      const rows=JSON.parse(await sql(lockRowsSql)),holders=rows.filter(row=>row.granted),waiters=rows.filter(row=>!row.granted)
      samples.push({elapsedMs:Math.ceil(performance.now()-began),rows,settled:[...settled]})
      assert.equal(holders.length,1);assert.equal(holders[0].pid,holder.pid)
      assert.equal(holders[0].applicationName,applicationName);assert.equal(holders[0].backendStart,holder.backendStart)
      assert(waiters.length<=2,'unrelated security writer entered the exclusive test cohort')
      if(waiters.length===2) {
        phase='validate-two-waiters';assert.equal(new Set(rows.map(row=>row.pid)).size,3)
        assert.equal(new Set(rows.map(row=>row.virtualTransaction)).size,3,'distinct PostgreSQL virtual transactions required')
        const waiterPids=new Set(waiters.map(row=>row.pid))
        const reachesHolder=(pid,seen=new Set())=>{
          if(pid===holder.pid)return true
          if(seen.has(pid))return false
          seen.add(pid)
          const row=waiters.find(item=>item.pid===pid)
          return Boolean(row?.blockers?.some(blocker=>reachesHolder(blocker,new Set(seen))))
        }
        for(const waiter of waiters) {
          assert(Number.isSafeInteger(waiter.pid)&&waiter.pid>0&&waiter.pid!==holder.pid)
          assert(typeof waiter.applicationName==='string'&&waiter.applicationName.length,'actual JDBC application_name required')
          assert(waiter.backendStart&&waiter.transactionStart&&waiter.queryStart&&waiter.virtualTransaction)
          assert(Date.parse(waiter.transactionStart)>=Date.parse(holders[0].transactionStart),
            'request transaction predates this holder')
          assert(Date.parse(waiter.queryStart)>=Date.parse(waiter.transactionStart),'lock query predates request transaction')
          assert.equal(waiter.waitEventType,'Lock');assert.equal(waiter.securityLockQuery,true)
          assert(Array.isArray(waiter.blockers)&&waiter.blockers.length&&waiter.blockers.every(pid=>pid===holder.pid||waiterPids.has(pid)))
          assert(reachesHolder(waiter.pid),'waiter blocker chain does not reach this owned holder')
        }
        assert(!settled.some(Boolean),'request settled before simultaneous wait observation')
        observation={source:'owned-primary-pg-security-lock-observer',lockKey:securityLock,lockKind:'bigint-transaction-advisory',databaseBinding:binding,
          holder:holders[0],waiters,simultaneousWaiters:2,observedAt:new Date().toISOString(),
          association:{kind:'exclusive-two-request-cohort',individualActorPidMapping:false,requests:requests.map(({actorHash,targetHash})=>({actorHash,targetHash})),baselineLockRows:0}}
        break
      }
      await delay(pollIntervalMs)
    }while(performance.now()<deadline)
    phase='require-simultaneous-wait';assert(observation,'both production management requests did not reach the actual security lock within deadline')
  }catch(error){failure=error;failureElapsed=began===undefined?null:Math.ceil(performance.now()-began);failureSettled=[...settled]}
  finally {
    // Release before awaiting either HTTP request, including assertion failures.
    if(session) {
      try{await session.query('ROLLBACK;')}catch{cleanupFailure=new Error('owned security barrier rollback failed')}
      try{await session.close()}catch{cleanupFailure=new Error('owned security barrier process close failed')}
    }
    if(holder) {
      try {
        assert.deepEqual(databaseBinding(JSON.parse(await sql(identitySql))),binding)
        // Terminate only the exact owned PID + backend incarnation + random name.
        if(await present()==='true')await sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid="+holder.pid+" AND datname="+literal(owned.database)+" AND application_name="+literal(applicationName)+" AND backend_start::text="+literal(holder.backendStart)+";")
        const deadline=performance.now()+1500
        while(await present()==='true'){assert(performance.now()<deadline,'owned holder backend remains');await delay(25)}
        if(observation)observation.release={holderAbsent:true,releasedAt:new Date().toISOString()}
      }catch{cleanupFailure=new Error('owned security barrier release could not be verified')}
    }
    if(started)results=await results
  }
  if(cleanupFailure||failure) {
    const error=cleanupFailure??failure
    error.evidence={source:'owned-primary-pg-security-lock-observer',lockKey:securityLock,simultaneousWaitObserved:Boolean(observation),
      ...(observation?{observation}:{}),releaseVerified:!cleanupFailure,requestsStarted:started,
      failurePhase:phase,errorKind:error.name,waitTimeoutMs,samples,requestTimings,
      elapsedToFailureMs:failureElapsed??null,settledAtFailure:failureSettled??[...settled],
      settledResponses:(Array.isArray(results)?results:[]).map((result,index)=>({index,actorHash:requests[index].actorHash,targetHash:requests[index].targetHash,outcome:result.status,...(result.status==='fulfilled'?{httpStatus:result.value?.status,...(typeof result.value?.value?.code==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(result.value.value.code)?{code:result.value.value.code}:{})}:{errorKind:result.reason?.name??'Error'})})),
      earlyRequestSettledBeforeTwoWaiters:!observation&&['observe-waiters','validate-two-waiters'].includes(phase)&&Boolean(failureSettled?.some(Boolean))}
    throw error
  }
  return {results,evidence:observation}
}

export async function runAccessControlV3Transactions({base,planned,management,assertOwner,query,effects,record,transactionObserver}) {
  // Reject missing wiring before provisioning accounts or revoking administrators.
  assert(transactionObserver?.owner&&typeof transactionObserver.spawnPsql==='function',
    'owned primary-PG transactionObserver {owner,spawnPsql} required; no sequential fallback')
  assert(transactionObserver.owner.isolated===true&&transactionObserver.owner.exclusiveWriters===true)
  assert(/^application-projects-bb-[0-9]+-[0-9]+$/.test(transactionObserver.owner.composeProject))
  assert.equal(transactionObserver.owner.postgresComposeProject,transactionObserver.owner.composeProject)
  assert.equal(transactionObserver.owner.database,'kestra')
  assert(/^[a-f0-9]{12,64}$/.test(transactionObserver.owner.postgresContainer))
  assert.equal(new URL(base).origin,base,'exact origin required')
  for(const callback of [assertOwner,query,record,effects?.snapshot])assert.equal(typeof callback,'function','transaction dependency missing')
  const inputs=planned?.transactionInputs
  assert(inputs?.isolated===true&&inputs.exclusiveWriters===true&&inputs.profile==='new-install','isolated new-install with exclusive writers required')
  assert.equal(planned.base,base);assert.equal(management?.base,base)
  assert.equal(inputs.bootstrapSubject,planned.admin.subject)
  assert.equal(management.account.subject,planned.admin.subject)
  assert.equal(management.account.username,planned.admin.username)
  assert.equal(management.account.password,planned.admin.password)
  assert.equal(typeof planned.admin.password,'string');assert(planned.admin.password.length)
  assert.equal(typeof inputs.sourceRef,'string');assert(inputs.sourceRef.length)
  assert(/^sha256:[a-f0-9]{64}$/.test(inputs.imageDigest));assert(hashPattern.test(inputs.jarHash))
  assert(Number.isSafeInteger(inputs.effectsWindowMs)&&inputs.effectsWindowMs>=5000&&inputs.effectsWindowMs<=60000)
  assert(groupIdentifier.test(applicationProject));assert.equal(planned.expectedAudience,'kestra-ui')
  assert.equal(typeof ProductionOAuthClient.prototype.probeCurrentIdpSession,'function','public existing IdP session probe required')
  const suffix=randomBytes(8).toString('hex'),prefix='t6-'+suffix
  const scope=prefix+'-admin',permission=prefix+'-permission'
  const groups=[prefix+'-a',prefix+'-b'],accounts=[],savedGrants=[],faults=[]
  const resources={groups:[],scope:false,permission:false}
  const fragment={id:'account-lifecycle-transaction-composition',sourceRef,status:'not_run',passed:false,completed:false,
    requiredInputs:structuredClone(transactionRequiredInputs),checks:transactionCheckIds.map(id=>({id,sourceRef,status:'not_run',passed:false})),
    evidence:{backend:'PostgreSQL',session:{storage:'memory',observation:'production-http',includedInPersistentHash:false},imageDigest:inputs.imageDigest,jarHash:inputs.jarHash,ownerSourceRef:inputs.sourceRef,steps:[],requests:[],cleanup:{status:'not_run',resources:[]}}}
  let manager,ownerVerified=false,revocationStarted=false,tables=[],recordFailed=false
  const clientAccounts=new WeakMap()
  const clientSessions=new WeakMap()
  const persist=async()=>{try{await record(structuredClone(fragment))}catch{recordFailed=true}}
  const step=async(id,evidence)=>{fragment.evidence.steps.push({id,...evidence});await persist()}
  const sql=async statement=>{await assertOwner();return String(await query(statement)).trim()}
  const request=async(client,path,method='GET',body,revision)=>{
    assert(path.startsWith(api+'/'))
    if(revision!==undefined)assert(Number.isSafeInteger(revision)&&revision>=0)
    const response=await client.request(path,{method,signal:AbortSignal.timeout(20000),headers:{Accept:'application/json',
      ...(body===undefined?{}:{'Content-Type':'application/json'}),...(revision===undefined?{}:{'If-Match':'"'+revision+'"'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})})
    const text=await response.text()
    let value
    try{value=text?JSON.parse(text):undefined}catch{assert.fail('management response is not JSON; HTTP '+response.status)}
    // Keep only machine error classification, never raw response text or messages.
    const code=typeof value?.code==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(value.code)?value.code:undefined
    const problemType=typeof value?.type==='string'&&/^https:\/\/kestra\.io\/docs\/api-reference\/problems\/[a-z-]+$/.test(value.type)?value.type:undefined
    const forbiddenDetailHash=response.status===403&&typeof value?.detail==='string'?hash(value.detail):undefined
    fragment.evidence.requests.push({method,path:new URL(path,base).pathname,status:response.status,observedAt:new Date().toISOString(),...(code?{code}:{}),...(problemType?{problemType}:{}),...(response.status===403?{failureShape:{forbiddenDetailHash,fields:Object.keys(value??{}).filter(key=>/^(?:message|code|type|title|status|detail|_links|_embedded)$/.test(key)),genericForbidden:value?.message==='Forbidden'||value?.title==='Forbidden'||value?.detail==='Forbidden',csrfNamed:typeof value?.message==='string'&&/csrf/i.test(value.message)},sessionTiming:client.sessionTimingEvidence()}: {})})
    await persist()
    return {status:response.status,value}
  }
  const success=async(...args)=>{const result=await request(...args);assert(result.status>=200&&result.status<300,'production management HTTP '+result.status);return result.value}
  const fresh=async(account=planned.admin)=>{
    const client=new ProductionOAuthClient(base)
    const cookies=new Map(),original=client.request.bind(client)
    client.request=async(...args)=>{
      const response=await original(...args)
      for(const cookie of response.headers.getSetCookie()) {
        const pair=cookie.split(';')[0],separator=pair.indexOf('='),name=pair.slice(0,separator)
        if(separator>0&&['JWT','oidc_session'].includes(name)) {
          if(!pair.slice(separator+1)||/;\s*max-age=0(?:;|$)/i.test(cookie))cookies.delete(name)
          else cookies.set(name,hash(pair.slice(separator+1)))
        }
      }
      return response
    }
    assert.equal((await client.login(account.username,account.password)).authenticated,true,'production login failed')
    const identity=await client.verifiedUiIdentity({applicationGroupId:applicationProject,subject:account.subject,audience:planned.expectedAudience})
    assert(cookies.has('JWT')&&cookies.has('oidc_session'),'production login must issue UI JWT and IdP session cookies')
    clientSessions.set(client,{cookies,identityHash:hash(identity),originalCookies:Object.fromEntries(cookies)})
    clientAccounts.set(client,account)
    return client
  }
  const sessionProbe=async(client,label,{revoked=false,protectedStatus=403}={})=>{
    const session=clientSessions.get(client),account=clientAccounts.get(client)
    assert(session&&account,'existing production client required; session probe must not log in')
    await step(label+'-started',{storage:'memory',observation:'production-http',subjectHash:hash(account.subject),revoked,
      originalAuthenticationCookieHashes:session.originalCookies,currentAuthenticationCookieHashes:Object.fromEntries(session.cookies),relogin:false})
    assert.deepEqual(Object.fromEntries(session.cookies),session.originalCookies,'original authentication cookies changed before observation')
    const idp=await client.probeCurrentIdpSession()
    const observation={storage:'memory',source:idp.source,authenticated:idp.authenticated,passwordRequired:idp.passwordRequired,
      codeIssued:idp.codeIssued,status:idp.status,subjectHash:hash(account.subject),authenticationCookieHashes:session.originalCookies,
      persistentHashComparison:'outside-before-after-window',relogin:false}
    await step(label+'-idp',observation)
    assert.equal(idp.source,'production-authorize-existing-idp-cookie')
    assert.equal(idp.authenticated,!revoked);assert.equal(idp.passwordRequired,revoked);assert.equal(idp.codeIssued,!revoked)
    assert.equal(session.cookies.get('JWT'),session.originalCookies.JWT,'authorize probe replaced original signed UI cookie')
    const protectedResult=await request(client,api+'/users?page=1&size=25')
    await step(label+'-protected',{subjectHash:hash(account.subject),status:protectedResult.status,originalJwtHash:session.originalCookies.JWT,revoked})
    if(revoked)assert([401,403].includes(protectedResult.status),'retired account UI cookie retained protected access')
    else {
      assert.equal(protectedResult.status,protectedStatus,'existing signed UI cookie changed its allow/deny behavior')
      assert.deepEqual(Object.fromEntries(session.cookies),session.originalCookies,'continuity probe changed existing authentication cookies')
      const identity=await client.verifiedUiIdentity({applicationGroupId:applicationProject,subject:account.subject,audience:planned.expectedAudience})
      assert.equal(hash(identity),session.identityHash,'original signed UI identity changed')
    }
    return {...observation,protectedStatus:protectedResult.status,originalJwtVerified:!revoked}
  }
  const pages=async(client,path)=>{
    const items=[];let total,revision
    for(let page=1;page<=1000;page++) {
      const value=await success(client,path+'?page='+page+'&size=100')
      assert(Array.isArray(value.items)&&Number.isSafeInteger(value.total)&&value.total>=0)
      total??=value.total;assert.equal(value.total,total)
      const current=value.directoryRevision??value.parentRevision
      if(current!==undefined){revision??=current;assert.equal(current,revision,'pagination snapshot drift')}
      items.push(...value.items);assert(items.length<=total)
      if(items.length===total)return items
      assert(value.items.length,'pagination stalled')
    }
    assert.fail('pagination limit exceeded')
  }
  const snapshot=async()=>{
    const selects=tables.map(table=>"SELECT '"+table+"' AS name, md5(coalesce(string_agg(row_to_json(t)::text,'|' ORDER BY row_to_json(t)::text),'')) AS digest FROM public."+table+' t')
    const state=JSON.parse(await sql('SELECT json_object_agg(name,digest)::text FROM ('+selects.join(' UNION ALL ')+') fingerprints'))
    assert.deepEqual(Object.keys(state).sort(),tables)
    assert(Object.values(state).every(value=>/^[a-f0-9]{32}$/.test(value)))
    const business=await effects.snapshot();assert(hashPattern.test(business.hash))
    return {hash:hash({state,business:business.hash}),tables:Object.fromEntries(Object.entries(state).map(([name,digest])=>[name,hash(digest)])),businessHash:business.hash}
  }
  const unchanged=async(before,label)=>{
    const started=performance.now(),samples=[]
    do {
      const after=await snapshot();samples.push({elapsedMs:Math.ceil(performance.now()-started),hash:after.hash})
      await step(label,{beforeHash:before.hash,afterHash:after.hash,snapshot:after,samples:[...samples]})
      assert.equal(after.hash,before.hash,'rejected transaction changed persisted state')
      if(performance.now()-started>=inputs.effectsWindowMs)return after
      await delay(250)
    }while(true)
  }
  const groupRead=group=>success(manager,management.groupPath(group))
  const assign=async(client,group,subject,scopeKeys)=>{
    const original=client;client=await fresh(clientAccounts.get(client));if(original===manager)manager=client
    const path=grantPath(group,subject),existing=await request(client,path)
    assert([200,404].includes(existing.status))
    const parent=await success(client,management.groupPath(group))
    await success(client,existing.status===200?path:management.groupPath(group)+'/scope-grants',existing.status===200?'PUT':'POST',
      {issuer:base,subject,scopeKeys},existing.status===200?existing.value.revision:parent.revision)
  }
  const removeGrant=async(client,group,subject)=>{
    const original=client;client=await fresh(clientAccounts.get(client));if(original===manager)manager=client
    const path=grantPath(group,subject),value=await request(client,path)
    if(value.status===404)return
    assert.equal(value.status,200);await success(client,path,'DELETE',undefined,value.value.revision)
  }
  const createAccount=async label=>{
    const username=prefix+'-'+label,password=randomBytes(32).toString('base64url')+'aA1!'
    assert.equal((await request(manager,accountPath(username))).status,404,'test account collision; no cleanup ownership acquired')
    const account={username,subject:username,password};accounts.push(account)
    const result=await success(manager,api+'/users','POST',{username,name:label,email:''})
    assert.equal(result.subject,username);assert.equal(typeof result.temporaryPassword,'string')
    const client=new ProductionOAuthClient(base)
    await client.changeTemporaryPassword(username,result.temporaryPassword,password)
    result.temporaryPassword=undefined
    account.subject=result.subject
    return account
  }
  const check=async(id,operation)=>{
    const row=fragment.checks.find(item=>item.id===id);row.status='running';await persist()
    try{row.evidence=await operation();row.status='passed';row.passed=true;await persist()}
    catch(error){row.status='failed';row.passed=false;row.reason='transaction assertion failed; inspect hash-only steps and cleanup resources';await persist();throw error}
  }
  const dropFault=async fault=>{
    await sql('BEGIN; SET LOCAL lock_timeout=\'5s\'; DROP TRIGGER IF EXISTS '+fault.name+' ON public.'+fault.table+'; DROP FUNCTION IF EXISTS public.'+fault.name+'(); DROP SEQUENCE IF EXISTS public.'+fault.first+', public.'+fault.second+'; COMMIT;')
    fault.removed=true
  }
  const installFault=async(host,subject)=>{
    assert(/^t6-[a-f0-9]{16}-[a-z-]+$/.test(subject))
    const name='t6_'+randomBytes(12).toString('hex'),first=name+'_a',second=name+'_b'
    for(const value of [name,first,second])assert(identifier.test(value))
    const table=host?'oidc_user':'rbac_application_group_state'
    for(const value of [name+'_o'])assert(identifier.test(value))
    const fault={name,first,second,table,removed:false}
    const existing=await sql("SELECT (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('"+first+"','"+second+"')) + (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('"+name+"','"+name+"_o')) + (SELECT count(*) FROM pg_trigger WHERE tgname IN ('"+name+"','"+name+"_o'))")
    assert.equal(existing,'0')
    faults.push(fault)
    const body=host?
      "IF OLD.username = '"+subject+"' THEN PERFORM setval('public."+second+"',txid_current()); RAISE EXCEPTION 'owned transaction failure'; END IF; RETURN OLD;":
      "IF OLD.document_json::text LIKE '%"+subject+"%' AND NEW.document_json::text NOT LIKE '%"+subject+"%' THEN IF OLD.group_id = '"+groups[0]+"' THEN PERFORM setval('public."+first+"',txid_current()); ELSIF OLD.group_id = '"+groups[1]+"' THEN PERFORM setval('public."+second+"',txid_current()); RAISE EXCEPTION 'owned transaction failure'; END IF; END IF; RETURN NEW;"
    const observer=host?"IF OLD.document_json::text LIKE '%"+subject+"%' AND NEW.document_json::text NOT LIKE '%"+subject+"%' AND OLD.group_id = '"+groups[0]+"' THEN PERFORM setval('public."+first+"',txid_current()); END IF; RETURN NEW;":body
    await sql("BEGIN; SET LOCAL lock_timeout='5s'; CREATE SEQUENCE public."+first+'; CREATE SEQUENCE public.'+second+'; CREATE FUNCTION public.'+name+'() RETURNS trigger LANGUAGE plpgsql AS $owned$ BEGIN '+body+' END $owned$; CREATE TRIGGER '+name+(host?' BEFORE DELETE':' AFTER UPDATE')+' ON public.'+table+' FOR EACH ROW EXECUTE FUNCTION public.'+name+'();'+(host?' CREATE FUNCTION public.'+name+'_o() RETURNS trigger LANGUAGE plpgsql AS $owned$ BEGIN '+observer+' END $owned$; CREATE TRIGGER '+name+'_o AFTER UPDATE ON public.rbac_application_group_state FOR EACH ROW EXECUTE FUNCTION public.'+name+'_o();':'')+' COMMIT;')
    return fault
  }
  const clearFault=async fault=>{
    if(fault.table==='oidc_user')await sql('BEGIN; SET LOCAL lock_timeout=\'5s\'; DROP TRIGGER IF EXISTS '+fault.name+'_o ON public.rbac_application_group_state; DROP FUNCTION IF EXISTS public.'+fault.name+'_o(); COMMIT;')
    await dropFault(fault)
    fault.removed=false
    const remaining=await sql("SELECT (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relname IN ('"+fault.first+"','"+fault.second+"')) + (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('"+fault.name+"','"+fault.name+"_o')) + (SELECT count(*) FROM pg_trigger WHERE tgname IN ('"+fault.name+"','"+fault.name+"_o'))")
    assert.equal(remaining,'0','owned fault DDL remains installed');fault.removed=true
  }
  const fullManagement=async(client,target)=>{
    await pages(client,api+'/users');await pages(client,management.permissionsPath(applicationProject))
    const before=await success(client,accountPath(target.subject)),name='verified-'+randomBytes(6).toString('hex')
    await success(client,api+'/users/profile','PUT',{subject:target.subject,name,email:before.email??''},before.revision)
    assert.equal((await success(client,accountPath(target.subject))).name,name)
    const policy=await success(client,management.permissionsPath(applicationProject)+'/'+permission)
    const body={key:policy.key,name:'Verified '+randomBytes(6).toString('hex'),description:policy.description,scopeKeys:policy.scopeKeys,enabled:policy.enabled,grants:policy.grants,managementGrants:policy.managementGrants}
    await success(client,management.permissionsPath(applicationProject)+'/'+permission,'PUT',body,policy.revision)
    assert.equal((await success(client,management.permissionsPath(applicationProject)+'/'+permission)).name,body.name)
  }
  const discoverManagers=async()=>{
    const found=new Set(),allGroups=await pages(manager,api+'/application-groups'),users=await pages(manager,api+'/users')
    const active=new Set(users.filter(user=>user.active===true).map(user=>user.subject))
    for(const group of allGroups) {
      if(group.active!==true)continue
      const apps=await pages(manager,management.groupPath(group.id)+'/applications')
      if(!apps.some(app=>app.clientId===planned.expectedAudience))continue
      const permissions=await pages(manager,management.permissionsPath(group.id))
      const dangerous=new Set(permissions.filter(item=>item.enabled===true&&(item.managementGrants??[]).some(grant=>
        ['IDENTITY','LOCAL_POLICY'].includes(grant.domain)&&grant.actions.includes('MANAGE'))).flatMap(item=>item.scopeKeys))
      for(const grant of await pages(manager,management.groupPath(group.id)+'/scope-grants')) {
        if(grant.issuer===base&&active.has(grant.subject)&&grant.scopeKeys.some(key=>dangerous.has(key)))found.add(grant.subject)
      }
    }
    return [...found].sort()
  }
  const verifyBootstrapGrants=async()=>{
    const actual=[]
    for(const grant of savedGrants) {
      const restored=await success(manager,grantPath(grant.group,grant.subject))
      assert.equal(restored.issuer,base);assert.equal(restored.subject,grant.subject)
      actual.push({group:grant.group,subject:restored.subject,scopeKeys:[...restored.scopeKeys].sort()})
    }
    assert.equal(hash(actual),hash(savedGrants),'original bootstrap grants were not restored')
    await step('bootstrap-grants-restored',{beforeHash:hash(savedGrants),afterHash:hash(actual),verifiedViaProductionApi:true})
  }
  const restoreBootstrap=async()=>{
    if(!revocationStarted) {
      manager=await fresh()
      await verifyBootstrapGrants()
      return
    }
    let effective
    for(const account of [...accounts.filter(item=>item.administrator),planned.admin]) {
      try{const candidate=await fresh(account);await success(candidate,api+'/users?page=1&size=25');effective=candidate;break}catch{}
    }
    assert(effective,'no surviving production administrator; refusing configuration or SQL recovery')
    for(const grant of savedGrants)await assign(effective,grant.group,grant.subject,grant.scopeKeys)
    manager=await fresh()
    await verifyBootstrapGrants()
    await success(manager,api+'/users?page=1&size=25')
    await success(manager,management.permissionsPath(applicationProject)+'?page=1&size=25')
    revocationStarted=false
  }
  await persist()
  try {
    assert(!recordFailed,'initial evidence persistence failed')
    await assertOwner();ownerVerified=true
    tables=JSON.parse(await sql("SELECT coalesce(json_agg(tablename ORDER BY tablename),'[]')::text FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'oidc\\_%' ESCAPE '\\' OR tablename LIKE 'rbac\\_application\\_group\\_%' ESCAPE '\\' OR tablename='rbac_management_audit')"))
    assert(tables.every(name=>identifier.test(name)))
    for(const required of ['oidc_user','oidc_user_auth_method','oidc_authorization_code','oidc_token','rbac_application_group_state','rbac_application_group_invalidation','rbac_application_group_bootstrap','rbac_application_group_retired','rbac_management_audit'])assert(tables.includes(required),'required snapshot table missing: '+required)
    manager=await fresh()
    const originalManagers=await discoverManagers()
    assert.deepEqual(originalManagers,[planned.admin.subject],'exclusive bootstrap management prerequisites not met')
    for(const group of await pages(manager,api+'/application-groups')) {
      const value=await request(manager,grantPath(group.id,planned.admin.subject))
      assert([200,404].includes(value.status))
      if(value.status===200){assert.equal(value.value.issuer,base);savedGrants.push({group:group.id,subject:planned.admin.subject,scopeKeys:[...value.value.scopeKeys].sort()})}
    }
    assert(savedGrants.length,'bootstrap grant snapshot missing')
    await step('bootstrap-grants-saved',{hash:hash(savedGrants),grantCount:savedGrants.length})
    for(const group of groups) {
      assert.equal((await request(manager,management.groupPath(group))).status,404,'test group collision; no cleanup ownership acquired')
      resources.groups.push(group)
      await success(manager,api+'/application-groups','POST',{id:group,tenant:'main',displayName:group,description:''})
      const parent=await groupRead(group)
      await success(manager,management.groupPath(group)+'/scopes','POST',{key:'member',name:'Member',description:''},parent.revision)
    }
    const target=await createAccount('rollback'),zero=await createAccount('zero')
    await assign(manager,applicationProject,target.subject,[])
    await assign(manager,applicationProject,zero.subject,[])
    for(const group of groups)await assign(manager,group,target.subject,['member'])
    manager=await fresh()
    await step('prepared',{accountHashes:accounts.map(account=>hash(account.subject)),groupHashes:groups.map(hash),snapshot:await snapshot()})
    const zeroClient=await fresh(zero)
    await sessionProbe(zeroClient,'zero-baseline-before')
    const beforeDenied=await snapshot()
    const denied=await request(zeroClient,api+'/users/profile','PUT',{subject:target.subject,name:'must-not-save',email:''},(await success(manager,accountPath(target.subject))).revision)
    assert.equal(denied.status,403);await unchanged(beforeDenied,'zero-baseline-denial')
    await sessionProbe(zeroClient,'zero-baseline-after')
    const baseline=await success(manager,accountPath(target.subject))
    await success(manager,api+'/users/profile','PUT',{subject:target.subject,name:'baseline-written',email:''},baseline.revision)
    assert.equal((await success(manager,accountPath(target.subject))).name,'baseline-written')
    const allowed=await createAccount('allowed-delete')
    for(const group of groups)await assign(manager,group,allowed.subject,['member'])
    await assign(manager,applicationProject,allowed.subject,[])
    const allowedClient=await fresh(allowed)
    await sessionProbe(allowedClient,'allowed-delete-before')
    manager=await fresh()
    const beforeAllowed=await snapshot(),allowedRevision=(await success(manager,accountPath(allowed.subject))).revision
    await success(manager,accountPath(allowed.subject),'DELETE',undefined,allowedRevision)
    const afterAllowed=await snapshot();assert.equal(afterAllowed.businessHash,beforeAllowed.businessHash)
    await sessionProbe(allowedClient,'allowed-delete-after',{revoked:true})
    manager=await fresh()
    assert.equal((await request(manager,accountPath(allowed.subject))).status,404)
    for(const group of [applicationProject,...groups])assert.equal((await request(manager,grantPath(group,allowed.subject))).status,404)
    await step('allowed-production-delete-baseline',{beforeHash:beforeAllowed.hash,afterHash:afterAllowed.hash,accountHash:hash(allowed.subject),allGroupGrantsRemoved:true})
    for(const [index,host] of [false,true].entries())await check(transactionCheckIds[index],async()=>{
      manager=await fresh();const targetClient=await fresh(target)
      const sessionBefore={actor:await sessionProbe(manager,'rollback-'+index+'-actor-before',{protectedStatus:200}),target:await sessionProbe(targetClient,'rollback-'+index+'-target-before')}
      const revision=(await success(manager,accountPath(target.subject))).revision
      const fault=await installFault(host,target.subject)
      try {
        const before=await snapshot();await step('before-'+transactionCheckIds[index],{snapshot:before})
        const result=await request(manager,accountPath(target.subject),'DELETE',undefined,revision)
        const observed=JSON.parse(await sql("SELECT json_build_object('first',(SELECT last_value::text FROM public."+fault.first+"),'second',(SELECT last_value::text FROM public."+fault.second+"))::text"))
        await step('fault-observed',{checkId:transactionCheckIds[index],httpStatus:result.status,transactionHash:hash(observed)})
        assert(result.status>=500&&result.status<=599,'fault did not reach server transaction')
        assert(BigInt(observed.first)>1n&&observed.first===observed.second,'participant and failure did not run in the same PostgreSQL transaction')
        const after=await unchanged(before,'rollback-'+index)
        const sessionAfter={actor:await sessionProbe(manager,'rollback-'+index+'-actor-after',{protectedStatus:200}),target:await sessionProbe(targetClient,'rollback-'+index+'-target-after')}
        return {backend:'PostgreSQL',beforeHash:before.hash,afterHash:after.hash,tableHashes:after.tables,httpStatus:result.status,sameTransaction:true,transactionHash:hash(observed),session:{storage:'memory',observation:'production-http',before:sessionBefore,after:sessionAfter}}
      }finally{await clearFault(fault)}
    })
    manager=await fresh()
    assert.equal((await request(manager,management.groupPath(applicationProject)+'/scopes/'+scope)).status,404,'test scope collision')
    resources.scope=true
    await success(manager,management.groupPath(applicationProject)+'/scopes','POST',{key:scope,name:scope,description:''},(await groupRead(applicationProject)).revision)
    manager=await fresh()
    assert.equal((await request(manager,management.permissionsPath(applicationProject)+'/'+permission)).status,404,'test permission collision')
    resources.permission=true
    await success(manager,management.permissionsPath(applicationProject),'POST',{key:permission,name:permission,description:'',scopeKeys:[scope],enabled:true,grants:[],managementGrants:[
      {domain:'IDENTITY',actions:['READ','MANAGE'],applicationGroupIds:[]},
      {domain:'LOCAL_POLICY',actions:['READ','MANAGE'],applicationGroupIds:[applicationProject]},
    ]},(await success(manager,management.applicationPath(applicationProject))).revision)
    for(const [index,disable] of [false,true].entries())await check(transactionCheckIds[index+2],async()=>{
      const pair=[]
      for(const label of ['left','right']) {
        manager=await fresh();const account=await createAccount((disable?'disable-':'delete-')+label)
        account.administrator=true;pair.push(account)
        await assign(manager,applicationProject,account.subject,[scope])
      }
      for(const account of pair){manager=await fresh();await fullManagement(await fresh(account),target)}
      manager=await fresh()
      assert.deepEqual(await discoverManagers(),[planned.admin.subject,...pair.map(account=>account.subject)].sort())
      assert(!recordFailed,'evidence persistence failed; refusing administrator revocation')
      revocationStarted=true
      for(const grant of savedGrants){await removeGrant(manager,grant.group,grant.subject);manager=await fresh(pair[0])}
      manager=await fresh(pair[0]);assert.deepEqual(await discoverManagers(),pair.map(account=>account.subject).sort())
      const sessionClients=await Promise.all(pair.map(account=>fresh(account)))
      for(const [actor,client] of sessionClients.entries())await sessionProbe(client,'concurrent-'+index+'-'+actor+'-before',{protectedStatus:200})
      await step('concurrent-'+index+'-session-witnesses',{separateFromMutationClients:true,issuedBeforeMutation:true,
        accountHashes:pair.map(account=>hash(account.subject)),originalCookieHashes:sessionClients.map(client=>clientSessions.get(client).originalCookies)})
      const accountHash=async account=>{
        assert(/^t6-[a-f0-9]{16}-(?:delete|disable)-(?:left|right)$/.test(account.subject))
        const digest=await sql("SELECT md5(row_to_json(t)::text) FROM public.oidc_user t WHERE username='"+account.subject+"'")
        assert(/^[a-f0-9]{32}$/.test(digest));return hash(digest)
      }
      const grantContent=value=>({applicationGroupId:value.applicationGroupId,issuer:value.issuer,subject:value.subject,scopeKeys:[...value.scopeKeys].sort(),revision:value.revision})
      let preparation
      try{preparation=await prepareSecurityLockCohort({owner:transactionObserver.owner,spawnPsql:transactionObserver.spawnPsql,assertOwner:async()=>assertOwner(),query})}
      catch(error){await step('concurrent-'+index+'-background-preparation-failed',error.preparationEvidence??{source:'owned-primary-pg-background-writer-drain',preflightFailed:true});throw error}
      await step('concurrent-'+index+'-background-writer-drained',preparation)
      // Preparation may span a scheduler period. Acquire fresh mutation HTTP
      // credentials/CSRF only afterwards; retain the original session witnesses
      // unchanged so revocation assertions cannot be satisfied by relogin.
      const clients=await Promise.all(pair.map(account=>fresh(account)))
      for(const [actor,client]of clients.entries())await success(client,accountPath(pair[1-actor].subject))
      for(const [actor,client]of sessionClients.entries())await sessionProbe(client,'concurrent-'+index+'-'+actor+'-immediately-before',{protectedStatus:200})
      await step('concurrent-'+index+'-mutation-clients-prepared',{freshAfterBackgroundDrain:true,originalSessionWitnessesRetained:true,actualAllowedReads:2})
      // Standard login legitimately updates last_login_at. Baseline the full
      // account rows only after every preparation/login/session observation.
      const revisions=await Promise.all(pair.map(account=>success(manager,accountPath(account.subject)).then(value=>value.revision)))
      const accountHashes=await Promise.all(pair.map(accountHash))
      const grantSnapshots=await Promise.all(pair.map(account=>success(manager,grantPath(applicationProject,account.subject))))
      const before=await snapshot();await step('before-concurrent-'+index,{snapshot:before,administratorHashes:pair.map(account=>hash(account.subject))})
      await step('concurrent-'+index+'-mutation-session-timing',{clients:clients.map(client=>client.sessionTimingEvidence())})
      assert(transactionObserver,'owned primary-PG transactionObserver must be supplied; sequential fallback is forbidden')
      let competition
      try {competition=await observeSecurityLockCompetition({owner:transactionObserver.owner,spawnPsql:transactionObserver.spawnPsql,
        assertOwner:async()=>assertOwner(),query,
        requests:pair.map((account,actor)=>({actorHash:hash(account.subject),targetHash:hash(pair[1-actor].subject),
          run:()=>request(clients[actor],disable?api+'/users/state':accountPath(pair[1-actor].subject),disable?'PUT':'DELETE',disable?{subject:pair[1-actor].subject,active:false}:undefined,revisions[1-actor])})),
      })
      }catch(error){
        await step('concurrent-'+index+'-security-lock-observer-failed',error.evidence??{source:'owned-primary-pg-security-lock-observer',preflightFailed:true})
        throw error
      }
      await step('concurrent-'+index+'-actual-security-lock-wait',competition.evidence)
      const results=competition.results
      assert(results.every(result=>result.status==='fulfilled'),'concurrent request transport failure; state unknown')
      const statuses=results.map(result=>result.value.status)
      await step('concurrent-'+index+'-responses',{statuses,fulfilled:results.length})
      assert.equal(statuses.filter(status=>status>=200&&status<300).length,1,'exactly one operation must commit')
      const denied=results.find(result=>!(result.value.status>=200&&result.value.status<300)).value
      assert([401,403].includes(denied.status)||denied.status===409&&denied.value?.code==='last_administrator',
        'other operation must lose authority or explicitly reject last-administrator removal; generic revision conflict is not security evidence')
      const winner=statuses.findIndex(status=>status>=200&&status<300),survivor=pair[winner],victim=pair[1-winner]
      const committed=await snapshot()
      await step('after-concurrent-'+index,{snapshot:committed,statuses})
      assert.equal(committed.businessHash,before.businessHash,'account mutation changed business storage')
      assert.equal(await accountHash(survivor),accountHashes[winner],'losing operation modified the surviving account')
      await unchanged(committed,'concurrent-delayed-effects-'+index)
      const retiredSession=await sessionProbe(sessionClients[1-winner],'concurrent-'+index+'-retired-after',{revoked:true})
      manager=await fresh(survivor)
      const remaining=await success(manager,accountPath(survivor.subject));assert.equal(remaining.active,true)
      const removed=await request(manager,accountPath(victim.subject))
      if(disable){assert.equal(removed.status,200);assert.equal(removed.value.active,false)}else assert.equal(removed.status,404)
      assert.deepEqual(grantContent(await success(manager,grantPath(applicationProject,survivor.subject))),grantContent(grantSnapshots[winner]))
      if(disable)assert.deepEqual(grantContent(await success(manager,grantPath(applicationProject,victim.subject))),grantContent(grantSnapshots[1-winner]))
      else assert.equal((await request(manager,grantPath(applicationProject,victim.subject))).status,404)
      assert.deepEqual(await discoverManagers(),[survivor.subject])
      await fullManagement(manager,target)
      await sessionProbe(manager,'last-admin-'+index+'-before',{protectedStatus:200})
      const last=await success(manager,grantPath(applicationProject,survivor.subject)),beforeLast=await snapshot()
      const rejected=await request(manager,grantPath(applicationProject,survivor.subject),'DELETE',undefined,last.revision)
      assert.equal(rejected.status,409);assert.equal(rejected.value?.code,'last_administrator')
      await unchanged(beforeLast,'last-admin-rejection-'+index)
      const after=await snapshot()
      await sessionProbe(manager,'last-admin-'+index+'-after',{protectedStatus:200})
      await restoreBootstrap()
      for(const account of pair)await removeGrant(manager,applicationProject,account.subject)
      return {backend:'PostgreSQL',backgroundPreparation:preparation,concurrency:competition.evidence,persisted:true,remainingManagers:1,allowedOperations:1,deniedOperations:1,statuses,beforeHash:before.hash,committedHash:committed.hash,afterHash:after.hash,survivorHash:hash(survivor.subject),survivingAccountHash:accountHashes[winner],lastAdministratorRejected:true,session:{storage:'memory',observation:'production-http',retired:retiredSession}}
    })
  }catch(error) {
    fragment.status='failed';fragment.evidence.failure={name:error?.name??'Error',reason:'production transaction preparation or assertion failed; no raw response or database exception is recorded',
      lastStepId:fragment.evidence.steps.at(-1)?.id,lastRequest:fragment.evidence.requests.at(-1),failedCheckIds:fragment.checks.filter(row=>row.status==='failed').map(row=>row.id)}
    await persist()
  }finally {
    const failures=[]
    const cleanup=async(resource,operation)=>{
      try{await operation();fragment.evidence.cleanup.resources.push({resource,status:'restored'})}
      catch{failures.push(resource);fragment.evidence.cleanup.resources.push({resource,status:'failed'})}
      await persist()
    }
    for(const fault of faults.filter(item=>!item.removed))await cleanup('DDL public.'+fault.name,()=>clearFault(fault))
    if(ownerVerified&&manager) {
      let recoverySafe=false
      await cleanup('original-administrator-grants',async()=>{await restoreBootstrap();recoverySafe=true})
      if(recoverySafe&&!revocationStarted) {
        await cleanup('bootstrap-production-login',async()=>{manager=await fresh()})
        for(const account of [...accounts].reverse())await cleanup('test-account:'+account.subject,async()=>{
          for(const group of [applicationProject,...resources.groups])await removeGrant(manager,group,account.subject)
          const result=await request(manager,accountPath(account.subject))
          if(result.status===404)return
          assert.equal(result.status,200);await success(manager,accountPath(account.subject),'DELETE',undefined,result.value.revision)
          assert.equal((await request(manager,accountPath(account.subject))).status,404)
        })
        if(resources.permission)await cleanup('permission:'+permission,async()=>{
          manager=await fresh()
          const path=management.permissionsPath(applicationProject)+'/'+permission,result=await request(manager,path)
          if(result.status===404)return
          assert.equal(result.status,200);await success(manager,path,'DELETE',undefined,result.value.revision)
          manager=await fresh()
          assert.equal((await request(manager,path)).status,404)
        })
        if(resources.scope)await cleanup('scope:'+scope,async()=>{
          manager=await fresh()
          const path=management.groupPath(applicationProject)+'/scopes/'+scope,result=await request(manager,path)
          if(result.status===404)return
          assert.equal(result.status,200);await success(manager,path,'DELETE',undefined,result.value.revision)
          assert.equal((await request(manager,path)).status,404)
        })
        for(const group of [...resources.groups].reverse())await cleanup('test-group:'+group,async()=>{
          const scopePath=management.groupPath(group)+'/scopes/member',child=await request(manager,scopePath)
          if(child.status===200)await success(manager,scopePath,'DELETE',undefined,child.value.revision)
          else assert.equal(child.status,404)
          const parent=await request(manager,management.groupPath(group))
          if(parent.status===404)return
          assert.equal(parent.status,200);await success(manager,management.groupPath(group),'DELETE',undefined,parent.value.revision)
          assert.equal((await request(manager,management.groupPath(group))).status,404)
        })
      }else failures.push('administrator recovery unsafe; retained resources: '+accounts.map(account=>account.subject).join(',')+'; '+resources.groups.join(','))
    }
    if(recordFailed)failures.push('record callback failed; partial evidence may be incomplete')
    fragment.evidence.cleanup.status=failures.length?'failed':'passed'
    fragment.evidence.cleanup.remaining=failures
    fragment.completed=fragment.checks.every(row=>row.passed)&&!failures.length&&fragment.status!=='failed'
    fragment.passed=fragment.completed;fragment.status=fragment.completed?'passed':'failed'
    await persist()
    if(recordFailed) {
      fragment.completed=false;fragment.passed=false;fragment.status='failed'
      fragment.evidence.cleanup.status='failed'
      if(!failures.includes('record callback failed; partial evidence may be incomplete'))failures.push('record callback failed; partial evidence may be incomplete')
    }
  }
  if(!fragment.completed) {
    const error=new Error('T6 transaction composition failed; inspect persisted fragment and cleanup.remaining')
    error.evidence=structuredClone(fragment)
    throw error
  }
  return fragment
}
