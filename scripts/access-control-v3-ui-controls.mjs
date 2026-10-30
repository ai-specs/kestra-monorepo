import assert from 'node:assert/strict'
import {createHash,randomBytes} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {applicationProject} from './application-project-cases.mjs'

const table='public.rbac_application_group_state'
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const source='owned-production-write-barrier'
const projectPattern=/^application-projects-bb-[0-9]+-[0-9]+$/
const identitySql="/* root-ui-controls:identity */ SELECT json_build_object('database',current_database(),'databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),'postmasterEpoch',extract(epoch FROM pg_postmaster_start_time())::text,'sessionUser',session_user,'pid',pg_backend_pid(),'backendStartEpoch',(SELECT extract(epoch FROM backend_start)::text FROM pg_stat_activity WHERE pid=pg_backend_pid()),'applicationName',current_setting('application_name'),'stateTablePresent',to_regclass('public.rbac_application_group_state') IS NOT NULL,'sha256Available',to_regprocedure('pg_catalog.sha256(bytea)') IS NOT NULL)::text;"

function failure(code,stage) {const error=new Error('Owned UI control failed at '+stage);error.code=code;return error}
function literal(value) {return "'"+String(value).replaceAll("'","''")+"'"}
async function bounded(operation,timeoutMs,stage) {
  const started=performance.now();let timer
  try {
    const result=await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure('ui_control_timeout',stage)),timeoutMs)})])
    if(performance.now()-started>timeoutMs)throw failure('ui_control_timeout',stage)
    return result
  }finally{clearTimeout(timer)}
}
function parse(value) {assert.equal(typeof value,'string','psql -At scalar string required');return JSON.parse(value.trim())}
function binding(identity) {return {database:identity.database,databaseOid:identity.databaseOid,postmasterEpoch:identity.postmasterEpoch,sessionUser:identity.sessionUser}}
function validateIdentity(identity,owner) {
  assert.equal(identity.database,owner.database)
  assert(/^[1-9][0-9]*$/.test(identity.databaseOid)&&/^[0-9]+(?:\.[0-9]+)?$/.test(identity.postmasterEpoch))
  assert(typeof identity.sessionUser==='string'&&identity.sessionUser.length)
  assert.equal(identity.stateTablePresent,true);assert.equal(identity.sha256Available,true)
  assert(Number.isSafeInteger(identity.pid)&&identity.pid>0)
  assert(/^[0-9]+(?:\.[0-9]+)?$/.test(identity.backendStartEpoch))
}

export const auditCapability=Object.freeze({
  available:false,status:'not_run',code:'published_audit_contract_missing',
  reason:'No management/account descriptor is bound for the candidate public audit reader; no records or executionId association are inferred',
  sourceRefs:Object.freeze([
    'kestra-overlay/docs/r-ee-rbac.md:263','kestra-overlay/docs/r-oidc-server.md:38',
    'kestra-overlay/patches/webserver/0380-oidc-account-lifecycle-v2.patch:418',
    'kestra-plugin-rbac/src/main/java/io/kestra/extensions/rbac/store/ManagementAuditStore.java',
    'kestra-plugin-rbac/src/main/java/io/kestra/extensions/rbac/management/ManagementAuditController.java',
    '.work/access-control-v3-20261027/resumed/root-stage.md',
  ]),
})

export const auditOperations=Object.freeze(['ACCOUNT_DELETE','ACCOUNT_ACTIVATE','ACCOUNT_DEACTIVATE','PASSWORD_RESET','CLIENT_SECRET_ROTATE'])
const auditFields=Object.freeze(['id','time','issuer','actorSubject','operation','targetSubject','clientId','groupId'])
const auditPath='/api/v1/main/extensions/rbac/audit'
function auditEvent(value,origin) {
  assert(value&&typeof value==='object'&&!Array.isArray(value),'public audit event object required')
  assert(Object.keys(value).every(field=>auditFields.includes(field)),'audit DTO contains an unpublished or credential-bearing field')
  for(const item of Object.values(value))assert(item===null||typeof item==='string'&&!/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(item),'public audit DTO contains invalid or credential-shaped data')
  const event=Object.fromEntries(auditFields.map(field=>[field,value[field]??null]))
  assert(typeof event.id==='string'&&event.id.length>0&&event.id.length<=256)
  assert(typeof event.time==='string'&&Number.isFinite(Date.parse(event.time)))
  assert.equal(event.issuer,origin,'public audit result crossed the trusted issuer')
  assert(typeof event.actorSubject==='string'&&event.actorSubject.length>0&&event.actorSubject.length<=1024)
  assert(auditOperations.includes(event.operation))
  assert(typeof event.groupId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(event.groupId))
  if(event.operation==='CLIENT_SECRET_ROTATE')assert(event.targetSubject===null&&typeof event.clientId==='string'&&event.clientId.length>0)
  else assert(typeof event.targetSubject==='string'&&event.targetSubject.length>0&&event.targetSubject.length<=1024&&event.clientId===null)
  return {...event,sha256:hash(event)}
}

export function createPublicUserAuditEvidence({management,record,sourceRef,pageSize=25,runtimeApplicationGroupId=applicationProject}={}) {
  assert(management&&typeof management.base==='string'&&management.account)
  const origin=new URL(management.base).origin;assert.equal(origin,management.base)
  assert.equal(typeof record,'function');assert(typeof sourceRef==='string'&&sourceRef.trim())
  assert(Number.isSafeInteger(pageSize)&&pageSize>=1&&pageSize<=100)
  assert(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(runtimeApplicationGroupId))
  const readerManagement=management
  const make=actor=>{
    assert.equal(actor?.base,origin,'audit reader must use the same trusted issuer, not an administrator cookie from another issuer')
    assert(actor.account&&typeof actor.account.subject==='string'&&actor.account.subject.length)
    assert(typeof actor.account.username==='string'&&typeof actor.account.password==='string'&&actor.account.password.length)
    const read=async({subject,groupId})=>{
      assert(typeof subject==='string'&&subject.length>0&&subject.length<=1024&&!subject.includes('\0'))
      assert(typeof groupId==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(groupId))
      const actorSubject=actor.account.subject,pages=[],authorizedItems=[],requests=[]
      const emit=details=>record({source:'owned-production-plugin-audit-read',sourceRef,actorSubject,selection:{subject,groupId},...details})
      let lastStatus
      try {
        const client=new ProductionOAuthClient(origin)
        await client.login(actor.account.username,actor.account.password)
        const identity=await client.verifiedUiIdentity({applicationGroupId:runtimeApplicationGroupId,subject:actorSubject,audience:'kestra-ui'})
        assert.equal(identity.subject,actorSubject);assert.equal(identity.issuer,origin)
        await emit({stage:'authenticated',issuer:identity.issuer,audience:'kestra-ui',isolatedProductionSession:true})
        let total
        for(let page=1;page<=10000;page++) {
          const path=auditPath+'?'+new URLSearchParams({page:String(page),size:String(pageSize)})
          const response=await client.request(path,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)})
          lastStatus=response.status;requests.push({path,method:'GET',status:response.status})
          if([401,403].includes(response.status)) {
            await response.body?.cancel();assert.equal(page,1,'audit authorization changed during pagination')
            const denied={source:'owned-production-plugin-audit-read',sourceRef,actorSubject,issuer:origin,status:response.status,subject,groupId,readAllAuthorized:false,authorizedTotal:null,authorizedItems:[],records:[],pages,requests}
            await emit({stage:'denied',status:response.status,requests});return denied
          }
          if(response.status!==200){await response.body?.cancel();throw failure([404,501].includes(response.status)?'acceptance_contract_missing':'public_audit_read_failed','public-audit-http-'+response.status)}
          const body=await response.json()
          assert(body&&Object.keys(body).every(field=>['items','total','page','size'].includes(field))&&Array.isArray(body.items))
          assert(Number.isSafeInteger(body.total)&&body.total>=0&&body.page===page&&body.size===pageSize&&body.items.length<=pageSize,'invalid public audit pagination metadata')
          total??=body.total;assert.equal(body.total,total,'audit total drifted across actual authorized pages')
          const items=body.items.map(item=>auditEvent(item,origin));authorizedItems.push(...items)
          assert.equal(new Set(authorizedItems.map(item=>item.id)).size,authorizedItems.length,'audit event duplicated across pages')
          assert(authorizedItems.length<=total,'audit returned more items than its actual authorized total')
          pages.push({page,size:pageSize,total:body.total,items:items.length,ids:items.map(item=>item.id)})
          await emit({stage:'page',status:200,page:pages.at(-1),items})
          if(authorizedItems.length===total) {
            const result={source:'owned-production-plugin-audit-read',sourceRef,actorSubject,issuer:origin,status:200,subject,groupId,readAllAuthorized:true,authorizedTotal:total,authorizedItems,records:authorizedItems.filter(item=>item.targetSubject===subject&&item.groupId===groupId),pages,requests}
            await emit({stage:'read-complete',status:200,authorizedTotal:total,selectedIds:result.records.map(item=>item.id),pages})
            return result
          }
          assert(items.length>0,'audit pagination ended before its declared authorized total')
        }
        throw failure('public_audit_read_failed','audit-pagination-limit')
      }catch(error) {
        await emit({stage:'failed',status:lastStatus??null,reason:error.code==='acceptance_contract_missing'?'candidate-audit-api-not-present':'production-audit-reader-rejected-incomplete-or-invalid-evidence',pages,requests})
        throw failure(error.code==='acceptance_contract_missing'?'acceptance_contract_missing':'public_audit_read_failed','public-audit-read')
      }
    }
    Object.defineProperty(read,'forManagement',{value:other=>{assert(other!==actor,'restricted audit read requires its own management/account descriptor');return make(other)}})
    return read
  }
  return make(readerManagement)
}

export function permissionWriteTarget(path,method,applicationGroupId) {
  assert.equal(method,'PUT','only real permission PUT may be held')
  assert(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(applicationGroupId))
  const prefix='/api/v1/main/extensions/rbac/application-groups/'+encodeURIComponent(applicationGroupId)+'/applications/'
  assert.equal(typeof path,'string');assert(path.startsWith(prefix),'permission write belongs to another group')
  const match=path.slice(prefix.length).match(/^~([A-Za-z0-9_-]+)\/permissions\/([a-z][a-z0-9-]{0,127})$/)
  assert(match,'canonical existing permission path required')
  const bytes=Buffer.from(match[1],'base64url');assert.equal(bytes.toString('base64url'),match[1])
  const clientId=new TextDecoder('utf-8',{fatal:true}).decode(bytes)
  assert(clientId.length>0&&clientId.length<=256&&!clientId.includes('\0'))
  return {path,method,applicationGroupId,clientId,permissionKey:match[2]}
}

export function persistentPsqlSession(child,{commandTimeoutMs=1500}={}) {
  assert(child&&typeof child.once==='function'&&typeof child.kill==='function','real owner-spawned ChildProcess required')
  for(const name of ['stdin','stdout','stderr'])assert(child[name]&&typeof child[name].on==='function','piped psql '+name+' required')
  assert.equal(typeof child.stdin.write,'function');assert.equal(typeof child.stdin.end,'function')
  let pending,buffer='',closed=false,broken=false,queue=Promise.resolve(),closePromise
  const stderrHash=createHash('sha256')
  let resolveExit
  const exited=new Promise(resolve=>{resolveExit=resolve})
  const rejectPending=stage=>{
    broken=true
    if(pending){clearTimeout(pending.timer);pending.reject(failure(stage.includes('timeout')?'owned_psql_command_timeout':'owned_psql_session_failed',stage));pending=undefined}
  }
  child.stderr.on('data',data=>stderrHash.update(data))
  child.stdin.on('error',()=>rejectPending('psql-stdin-error'))
  child.stdout.on('error',()=>rejectPending('psql-stdout-error'))
  child.stderr.on('error',()=>rejectPending('psql-stderr-error'))
  child.stdout.on('data',data=>{
    buffer+=data.toString('utf8')
    if(buffer.length>65536){rejectPending('psql-output-limit');child.stdin.destroy?.();child.kill('SIGTERM');return}
    let newline
    while((newline=buffer.indexOf('\n'))>=0) {
      const line=buffer.slice(0,newline).replace(/\r$/,'');buffer=buffer.slice(newline+1)
      if(!pending){if(line.trim())rejectPending('unsolicited-psql-output');continue}
      if(line===pending.marker){const current=pending;pending=undefined;clearTimeout(current.timer);current.resolve(current.lines.join('\n').trim())}
      else {pending.byteCount+=Buffer.byteLength(line)+1;if(pending.byteCount>65536){rejectPending('psql-output-limit');child.stdin.destroy?.();child.kill('SIGTERM');return}pending.lines.push(line)}
    }
  })
  child.once('error',()=>{rejectPending('psql-process-error');closed=true;resolveExit()})
  child.once('close',code=>{closed=true;if(pending||code!==0)rejectPending('psql-process-close');resolveExit()})
  if(child.exitCode!==null&&child.exitCode!==undefined){closed=true;broken=true;resolveExit()}
  return {
    query(sql) {
      assert.equal(typeof sql,'string');assert(!sql.includes('\\'),'only internal non-metacommand SQL accepted');assert(/;\s*$/.test(sql),'complete internal SQL command required')
      const result=queue.then(()=>new Promise((resolve,reject)=>{
        if(closed||broken){reject(failure('owned_psql_session_failed','psql-already-closed'));return}
        const marker='ui_control_end_'+randomBytes(12).toString('hex')
        pending={marker,lines:[],byteCount:0,resolve,reject,timer:setTimeout(()=>{rejectPending('psql-command-timeout');child.stdin.destroy?.();child.kill('SIGTERM')},commandTimeoutMs)}
        child.stdin.write(sql+'\n\\echo '+marker+'\n',error=>{if(error)rejectPending('psql-stdin-write')})
      }))
      queue=result.catch(()=>{})
      return result
    },
    close() {
      closePromise??=(async()=>{
        if(!closed)child.stdin.end()
        try{await bounded(()=>exited,commandTimeoutMs,'psql-close')}
        catch{child.stdin.destroy?.();child.kill('SIGTERM');await bounded(()=>exited,commandTimeoutMs,'psql-kill')}
        return {closed:true,stderrSha256:stderrHash.copy().digest('hex')}
      })()
      return closePromise
    },
  }
}

export function createOwnedAccessControlUiControls({origin,applicationGroupId,owner,assertOwner,query,spawnPsql,sourceRef,record,management,
  acquireTimeoutMs=1200,waitTimeoutMs=1500,maxHoldMs=4000,pollIntervalMs=40}={}) {
  assert.equal(new URL(origin).origin,origin)
  assert(['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)&&Number(new URL(origin).port)>1024,'owned loopback acceptance origin required')
  assert(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(applicationGroupId))
  assert(owner?.isolated===true&&owner.exclusiveWriters===true,'isolated acceptance database and exclusive authorization writer required')
  assert(projectPattern.test(owner.composeProject)&&projectPattern.test(owner.postgresComposeProject))
  assert(/^[a-f0-9]{12,64}$/.test(owner.postgresContainer))
  assert(/^[a-z][a-z0-9_]{0,62}$/.test(owner.database))
  if(owner.postgresComposeProject!==owner.composeProject)assert(/^application_group_acceptance_[0-9]+_[0-9]+$/.test(owner.database),'shared PostgreSQL needs its own acceptance database')
  for(const callback of [assertOwner,query,spawnPsql,record])assert.equal(typeof callback,'function')
  assert(typeof sourceRef==='string'&&sourceRef.trim())
  assert(Number.isSafeInteger(acquireTimeoutMs)&&acquireTimeoutMs>=50&&acquireTimeoutMs<=1500)
  assert(Number.isSafeInteger(waitTimeoutMs)&&waitTimeoutMs>=20&&waitTimeoutMs<=2000)
  assert(Number.isSafeInteger(maxHoldMs)&&maxHoldMs>=250&&maxHoldMs<=4500&&waitTimeoutMs<maxHoldMs)
  assert(Number.isSafeInteger(pollIntervalMs)&&pollIntervalMs>=10&&pollIntervalMs<=250)
  const owned=Object.freeze({...owner}),operations=new Map()
  let active,closed=false,databaseBinding
  const sql=statement=>bounded(()=>query(statement),acquireTimeoutMs,'owner-query')
  const emit=async(operation,stage,details={},defer=false)=>{
    operation.stage=stage
    const event={source,sourceRef,operationId:operation.operationId,stage,observedAt:new Date().toISOString(),owner:owned,target:operation.target,...details}
    operation.events.push(event)
    operation.pendingEvents??=[];operation.pendingEvents.push(event)
    if(!defer)while(operation.pendingEvents.length){await bounded(()=>record(structuredClone(operation.pendingEvents[0])),acquireTimeoutMs,'control-record');operation.pendingEvents.shift()}
  }
  const assertBound=async()=>{
    await bounded(()=>assertOwner(owned),acquireTimeoutMs,'owner-validation')
    const identity=parse(await sql(identitySql));validateIdentity(identity,owned)
    if(databaseBinding)assert.deepEqual(binding(identity),databaseBinding,'owner database or server generation changed')
    else databaseBinding=binding(identity)
    return identity
  }
  const fingerprintSql=lock=>"/* root-ui-controls:fingerprint */ SELECT json_build_object('groupId',group_id,'revision',revision::text,'authorizationVersion',authorization_version::text,'documentSha256',encode(pg_catalog.sha256(convert_to(document_json,'UTF8')),'hex'))::text FROM "+table+' WHERE group_id='+literal(applicationGroupId)+(lock?' FOR UPDATE':'')+';'
  const fingerprint=value=>{
    const actual=parse(value);assert.equal(actual.groupId,applicationGroupId)
    assert(/^[1-9][0-9]*$/.test(actual.revision)&&/^[1-9][0-9]*$/.test(actual.authorizationVersion)&&/^[a-f0-9]{64}$/.test(actual.documentSha256))
    return {groupId:actual.groupId,revision:actual.revision,authorizationVersion:actual.authorizationVersion,documentSha256:actual.documentSha256}
  }
  const holderPredicate=operation=>'pid='+operation.backend.pid+' AND datname='+literal(owned.database)+' AND application_name='+literal(operation.applicationName)+' AND extract(epoch FROM backend_start)::text='+literal(operation.backend.backendStartEpoch)
  const holderPresent=operation=>sql('/* root-ui-controls:present */ SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE '+holderPredicate(operation)+')::text;')
  const finish=(operation,{expired=false,partial=false}={})=>{
    if(operation.finishing)return operation.finishing
    operation.expired=expired||Boolean(operation.lockedAt&&performance.now()-operation.lockedAt>=maxHoldMs)
    clearTimeout(operation.timer)
    operation.finishing=(async()=>{
      const issues=[];let bound=false
      if(operation.session) {
        try{await operation.session.query('ROLLBACK;');operation.unlockedAt=performance.now()}catch{operation.rollbackFailed=true}
        try{await operation.session.close()}catch{issues.push('session-close')}
      }
      try{await assertBound();bound=true}catch{issues.push('owner-validation')}
      if(operation.backend&&bound) {
        try {
          if((await holderPresent(operation)).trim()==='true') {
            const terminated=await sql('/* root-ui-controls:terminate-owned-holder */ SELECT coalesce((SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE '+holderPredicate(operation)+'),false)::text;')
            assert(['true','false'].includes(terminated.trim()))
            const deadline=Date.now()+acquireTimeoutMs
            while((await holderPresent(operation)).trim()==='true'){assert(Date.now()<deadline,'owned backend did not exit');await delay(pollIntervalMs)}
          }
          operation.unlockedAt??=performance.now()
        }catch{issues.push('backend-release-proof')}
      }
      if(active===operation)active=undefined
      operation.released=issues.length===0
      const elapsedHoldMs=operation.lockedAt?Math.ceil((operation.unlockedAt??performance.now())-operation.lockedAt):0
      operation.expired||=elapsedHoldMs>=maxHoldMs
      const timing={elapsedHoldMs,maxHoldMs,timeoutReason:operation.expired?'MAX_HOLD_EXCEEDED':['ui_control_timeout','owned_psql_command_timeout'].includes(operation.failureCode)?'CONTROL_QUERY_OR_RECORD_TIMEOUT':null}
      try{await emit(operation,operation.expired?'expired':issues.length?'cleanup-failed':'released',{released:operation.released,expired:operation.expired,partial,cleanupIssues:issues,failureCode:operation.failureCode??null,...(partial?{lastObservation:operation.lastObservation,lastFingerprint:operation.lastFingerprint}:{}),...timing})}catch{issues.push('record')}
      operation.cleanupIssues=issues
      if(issues.length)throw failure('owned_ui_barrier_cleanup_failed','release')
      return {source,operationId:operation.operationId,released:true,expired:operation.expired,observedAt:new Date().toISOString(),...timing}
    })()
    return operation.finishing
  }
  const uiWriteBarrier={
    async acquire({path,method}) {
      const target=permissionWriteTarget(path,method,applicationGroupId)
      assert(!closed&&!active,'one live owned permission-write lease at a time')
      const operation={operationId:'ui-write-barrier-'+randomBytes(12).toString('hex'),target,events:[],expired:false,released:false}
      operation.applicationName='root_ui_barrier_'+operation.operationId.slice(-24)
      operations.set(operation.operationId,operation);active=operation
      try {
        await assertBound();await emit(operation,'acquiring')
        const before=fingerprint(await sql(fingerprintSql(false)))
        const spawned=Promise.resolve().then(()=>spawnPsql({owner:owned,applicationName:operation.applicationName}))
        spawned.then(child=>{if(operation.cancelled&&!operation.session){child.stdin?.end();child.kill?.('SIGTERM')}},()=>{})
        const child=await bounded(()=>spawned,acquireTimeoutMs,'owner-spawn-psql')
        operation.session=persistentPsqlSession(child,{commandTimeoutMs:acquireTimeoutMs+100})
        await operation.session.query('SET application_name='+literal(operation.applicationName)+'; SET lock_timeout='+literal(acquireTimeoutMs+'ms')+'; SET statement_timeout='+literal(acquireTimeoutMs+'ms')+';')
        operation.backend=parse(await operation.session.query(identitySql));validateIdentity(operation.backend,owned)
        assert.deepEqual(binding(operation.backend),databaseBinding,'persistent psql and owner query point to different databases')
        assert.equal(operation.backend.applicationName,operation.applicationName)
        await operation.session.query('BEGIN ISOLATION LEVEL READ COMMITTED; SET LOCAL idle_in_transaction_session_timeout='+literal(maxHoldMs+250+'ms')+';')
        operation.before=fingerprint(await operation.session.query(fingerprintSql(true)))
        assert.deepEqual(operation.before,before,'group changed before the real row lock was acquired')
        operation.lockedAt=performance.now()
        operation.timer=setTimeout(()=>{finish(operation,{expired:true}).catch(()=>{})},maxHoldMs);operation.timer.unref?.()
        await emit(operation,'holding',{holderPid:operation.backend.pid,documentSha256:operation.before.documentSha256,fingerprintSha256:hash(operation.before),maxHoldMs},true)
        assert(!operation.finishing&&!operation.expired,'write lease expired before acquire completed')
        return {source,operationId:operation.operationId,expiresAt:new Date(Date.now()+maxHoldMs-(performance.now()-operation.lockedAt)).toISOString(),maxHoldMs}
      }catch(error) {
        operation.failureCode=error.code??'acquire-assertion'
        operation.cancelled=true
        try{await finish(operation,{partial:true})}catch{throw failure('owned_ui_barrier_cleanup_failed','partial-acquire')}
        throw failure('owned_ui_barrier_acquire_failed','acquire')
      }
    },
    async waitForBlocked({operationId}) {
      const operation=operations.get(operationId);assert(operation&&active===operation&&!operation.finishing,'live owned lease required')
      try {
        const deadline=Math.min(performance.now()+waitTimeoutMs,operation.lockedAt+maxHoldMs)
        const groupStateSelect=fingerprintSql(false).replace(/;$/,'')
        do {
          assert(!operation.finishing&&performance.now()<operation.lockedAt+maxHoldMs,'write lease expired')
          const observation=parse(await sql("/* root-ui-controls:blocked */ SELECT json_build_object('database',current_database(),'databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),'postmasterEpoch',extract(epoch FROM pg_postmaster_start_time())::text,'sessionUser',session_user,'holderPresent',EXISTS(SELECT 1 FROM pg_stat_activity WHERE "+holderPredicate(operation)+" AND xact_start IS NOT NULL AND state='idle in transaction'),'relationLock',EXISTS(SELECT 1 FROM pg_locks WHERE pid="+operation.backend.pid+" AND relation='"+table+"'::regclass AND mode='RowShareLock' AND granted),'groupState',("+groupStateSelect+"),'waiters',(SELECT coalesce(json_agg(json_build_object('pid',pending.pid,'waitEventType',pending.wait_event_type,'blockedByHolder',"+operation.backend.pid+"=ANY(pg_blocking_pids(pending.pid)),'permissionUpdate',pending.query ~* '^[[:space:]]*UPDATE[[:space:]]+(public[.])?rbac_application_group_state[[:space:]]+SET[[:space:]]+revision[[:space:]]*=','startedAfterHolder',pending.query_start>=(SELECT xact_start FROM pg_stat_activity WHERE "+holderPredicate(operation)+")) ORDER BY pending.pid),'[]'::json) FROM pg_stat_activity pending WHERE pending.datname=current_database() AND "+operation.backend.pid+"=ANY(pg_blocking_pids(pending.pid))))::text;"))
          operation.lastObservation=observation
          assert.deepEqual(binding(observation),databaseBinding);assert.equal(observation.holderPresent,true);assert.equal(observation.relationLock,true)
          assert(Array.isArray(observation.waiters)&&observation.waiters.length<=1,'unexpected concurrent authorization writer')
          operation.lastFingerprint=fingerprint(observation.groupState)
          assert.deepEqual(operation.lastFingerprint,operation.before,'blocked request changed the group before release')
          if(observation.waiters.length===1) {
            const waiter=observation.waiters[0]
            assert(Number.isSafeInteger(waiter.pid)&&waiter.pid!==operation.backend.pid&&waiter.waitEventType==='Lock'&&waiter.blockedByHolder===true&&waiter.permissionUpdate===true&&waiter.startedAfterHolder===true,'observed waiter is not the actual permission UPDATE')
            assert(!operation.finishing&&performance.now()<operation.lockedAt+maxHoldMs,'lease expired during blocked-write observation')
            await emit(operation,'blocked',{holderPid:operation.backend.pid,waiterPid:waiter.pid,documentSha256:operation.before.documentSha256},true)
            return {source,operationId,blocked:true,holderPid:operation.backend.pid,waiterPid:waiter.pid,documentSha256:operation.before.documentSha256,observedAt:new Date().toISOString()}
          }
          await delay(pollIntervalMs)
        }while(performance.now()<deadline)
        throw failure('owned_ui_write_not_blocked','wait-for-blocked')
      }catch(error) {
        operation.failureCode=error.code??'blocked-observation-assertion'
        try{await finish(operation,{partial:true})}catch{throw failure('owned_ui_barrier_cleanup_failed','failed-block-observation')}
        throw failure('owned_ui_write_not_blocked','wait-for-blocked')
      }
    },
    async release({operationId}) {const operation=operations.get(operationId);assert(operation,'no corresponding owned write lease');return finish(operation)},
  }
  const close=async()=>{
    closed=true;const issues=[]
    for(const operation of operations.values())try{await finish(operation)}catch{issues.push(operation.operationId)}
    if(issues.length)throw failure('owned_ui_barrier_cleanup_failed','close-owned-controls')
    return {source,closed:true,leases:operations.size}
  }
  if(management)assert.equal(management.base,origin)
  const guardAudit=reader=>{
    const guarded=async selection=>{await bounded(()=>assertOwner(owned),acquireTimeoutMs,'audit-owner-validation');return reader(selection)}
    Object.defineProperty(guarded,'forManagement',{value:other=>guardAudit(reader.forManagement(other))})
    return guarded
  }
  const userAuditEvidence=management?guardAudit(createPublicUserAuditEvidence({management,record:event=>record({...event,owner:owned}),sourceRef,runtimeApplicationGroupId:applicationGroupId})):undefined
  const capability=userAuditEvidence?Object.freeze({available:true,status:'candidate_not_run',apiVerified:false,authorization:'IDENTITY.READ at trusted issuer scope; groupId is exact event selection only',path:auditPath,sourceRef}):auditCapability
  return {uiWriteBarrier,userAuditEvidence,auditCapability:capability,close}
}
