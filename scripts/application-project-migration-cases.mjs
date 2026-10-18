/**
 * 隔离迁移验收片段；无生产默认目录、命令执行器或凭据导出。
 * runApplicationProjectMigration(base, context, record) -> fragment，与其他
 * runApplicationProject* 片段相同。record 必须持久化每次状态更新。
 *
 * context.release = {verified:true, host:{commit,image,runId},
 *   plugin:{commit,sha256,runId,artifactId}, legacy:{image,sha256}}。
 * verified 只能由 driver 的成功 CI、下载产物与 hash 门设置；本模块不能替代发布门。
 * context.create({caseId,base,release}) 创建每用例独立 Compose 项目，返回 env：
 *   identity:{project,containers:[{id,project}],volumes:[{name,project}]}
 *   base: 明确 loopback origin，必须不同于主 driver base。
 *   cli(className,args) -> {exitCode,stdout}，不得抛出含命令输出的错误；
 *   files.write(name,json)->容器绝对路径；files.read(path)->JSON 对象；
 *   snapshot()->{legacy:{revision,sha256},local:{revision,sha256},
 *     directory:{revision,sha256},effects:{sha256},installation:{sha256}}。
 *   prepareLegacy() -> {target,decisions,directoryPlan,accounts:{subject,role}}；
 *     仅恢复已批准的隔离旧数据库备份，或调用旧发布产物公开 API；禁止身份表写入。
 *   credentials.capture() 在旧产物运行时经生产 OAuth 获取旧凭据，返回不透明句柄。
 *     必须含 ui-cookie,idp-session,access,refresh,code,mcp-session，code 尚未兑换。
 *   credentials.probe(handle,{phase}) -> {status,observedAt,credentialSha256,
 *     authenticated,authenticationInvalidated,authenticationCheck,authorizationError,issued,sideEffectsSha256,lifetime:{createdAt,expiresAt,source}}，不返回原始凭据。
 *     code/refresh 有效期只读查询隔离库；UI 用已验签 iat/exp；IdP 用真实 Set-Cookie。
 *     refresh before 轮换后报告 issuedSha256，后续 probe 使用新签发 refresh。
 *     403 仅是业务授权拒绝，不是凭据失效。UI/IdP/MCP 须有认证层 401 或
 *     精确生产 login 跳转；access 使用同 token 的 userinfo 401。code/refresh
 *     须是 400 invalid_grant。after 不得签发非清除 cookie、code 或 consent。
 *     phase=before 必须证明凭据可用；code 的 before 用同流程独立孪生 code
 *     成功兑换，不得消耗将用于 after 的旧 code；该配对由 adapter 保留证据。
 *   compose(action,{release})：stop/start-new/start-legacy；返回后必须等健康。
 *   backup()->{handle,policySha256,identitySha256,installationSha256,archiveSha256}；
 *   restore(handle) 恢复整个备份，不得只换 jar；返回后 snapshot 核对。
 *   advanceLegacyRevision() 经旧公开 API 实际改一项策略；
 *   probeAccount(kind,{phase}) -> {status,identity:{subject,projectScopes,roles},
 *     sideEffectsSha256}；必须使用 ProductionOAuthClient 新登录并校验签名。
 *   probeLegacyWrites() -> [{method,path,status}] 全部旧写端点的实际请求。
 *   assertOwned() 重新核对 Docker label/卷归属，失败必须抛错；
 *   destroy() 仅清理本次用例创建资源；失败保留到 fragment.cleanup。
 * context.oldWriteEndpoints=[{method,path,status}]：冻结的旧写端点拒绝契约。
 * 离线迁移不声明在线撤权时限。timeline 记录停止、CLI 成功返回、健康与首次请求。
 * CLI 完成时间是客户端观察到的提交完成上界，不伪称数据库精确提交时刻。
 *
 * 所有回调是明确运维/观测能力，不接受 case passed 或整组成功回执。
 * 缺运行能力/正式产物时 not_run；已开始用例的断言失败为 failed。
 * adapter 必须保留命令、HTTP、配对 code、数据库只读观测的脱敏原始证据；
 * 本片段只记录白名单状态/hash，绝不转存 stdout、错误消息或凭据句柄。
 */
import assert from 'node:assert/strict'
import {createHash,randomBytes,createPublicKey,verify} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,chmodSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {resolve,join,basename} from 'node:path'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {planFixture,directoryActivationPlan,applicationProjectFeature,ProjectManagement,flowSource} from './application-project-fixture.mjs'
import {requiredProjectChecks,scopeNames} from './application-project-cases.mjs'

export const migrationCheckIds=Object.freeze(requiredProjectChecks.filter(id=>id.startsWith('migration-')))
export const migrationCommands=Object.freeze({local:'io.kestra.extensions.rbac.store.ProjectPolicyCommand',directory:'io.kestra.webserver.oidc.projects.ApplicationDirectoryCommand'})
const kinds=['ui-cookie','idp-session','access','refresh','code','mcp-session']
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value
const sha=value=>assert.match(value??'',/^[a-f0-9]{64}$/)
const redactFailure=value=>String(value??'').split('\n').map(line=>/Bearer|eyJ[A-Za-z0-9_-]+\.|github_pat_|password|client_secret|refresh_token|access_token|Cookie:/i.test(line)?'[credential-bearing line redacted]':line).join('\n')
const refused=status=>[401,403].includes(status)
function state(value) {
  for(const key of ['legacy','local','directory']){sha(value?.[key]?.sha256);assert(Number.isSafeInteger(value[key].revision)&&value[key].revision>=0)}
  for(const key of ['effects','installation'])sha(value?.[key]?.sha256)
  for(const key of ['schemaSha256','policyStateSha256','directoryStateSha256'])if(value[key]!==undefined)sha(value[key])
  return Object.fromEntries([
    ...['legacy','local','directory'].map(key=>[key,{revision:value[key].revision,sha256:value[key].sha256}]),
    ...['effects','installation'].map(key=>[key,{sha256:value[key].sha256}]),
    ...['schemaSha256','policyStateSha256','directoryStateSha256'].filter(key=>value[key]!==undefined).map(key=>[key,value[key]]),
  ])
}
function releaseGate(release) {
  assert.equal(release?.verified,true)
  for(const name of ['host','plugin']){assert.match(release[name].commit,/^[a-f0-9]{40}$/);assert(Number.isSafeInteger(release[name].runId))}
  for(const name of ['host','legacy'])assert.match(release[name].image,/@sha256:[a-f0-9]{64}$/)
  for(const name of ['plugin','legacy'])sha(release[name].sha256)
  assert(Number.isSafeInteger(release.plugin.artifactId))
}
function owned(env,base) {
  const url=new URL(env.base);assert(['127.0.0.1','localhost','[::1]'].includes(url.hostname));assert.equal(url.protocol,'http:');assert.notEqual(url.origin,new URL(base).origin)
  const identity=env.identity;assert.match(identity.project,/^application-projects-migration-[a-z0-9-]+$/)
  for(const key of ['containers','volumes']){assert(identity[key]?.length>0);for(const item of identity[key])assert.equal(item.project,identity.project)}
}
async function command(env,kind,args,success=true) {
  await env.assertOwned()
  const result=await env.cli(migrationCommands[kind],args)
  assert(Number.isInteger(result.exitCode));assert.equal(result.exitCode===0,success)
  return result
}
async function preview(env,input) {
  const target=await env.files.write('target.json',input.target)
  const decisions=await env.files.write('decisions.json',input.decisions)
  const review=await env.files.write('review-destination.json',null)
  // write(name,null) reserves an absent output pathname, not an existing file:
  // ProjectPolicyCommand uses CREATE_NEW for preview-migration.
  await command(env,'local',['preview-migration',target,decisions,review])
  const envelope=await env.files.read(review)
  sha(envelope.approvalHash)
  // Java is authoritative: Jackson canonicalizes arrays too, while schema 1
  // uses its own field/action ordering. Never reserialize parsed JSON for hashes.
  assert.equal(typeof env.verifyReview,'function','published Java review verifier required')
  const hashes=await env.verifyReview({review,target})
  for(const key of ['approvalHash','sourceHash','sourceRawSha256','targetHash','storedTargetSha256'])sha(hashes[key])
  assert.equal(hashes.approvalHash,envelope.approvalHash)
  const report=envelope.report
  assert.equal(report.sourceSchemaVersion,1);assert.equal(report.targetSchemaVersion,2)
  sha(report.sourceHash);sha(report.targetHash)
  assert.equal(hashes.sourceHash,report.sourceHash);assert.equal(hashes.targetHash,report.targetHash)
  assert.equal(report.approvalScope,'LOCAL_POLICY_STORAGE_ONLY');assert.equal(report.productionActivationApproved,false)
  for(const key of ['legacyPolicy','targetPolicy','roleDecisions','grantDifferences','requiredConfirmations'])assert(report[key])
  return {target,review,approval:envelope.approvalHash,report,hashes}
}
async function applyLocal(env,review,approval=review.approval,success=true) {
  const result=await command(env,'local',['migrate',review.target,review.review,approval],success)
  ;(env.timeline??=[]).push({event:success?'local-migrate-completed':'local-migrate-refused',at:Date.now(),timeSource:'cli-return-observed'})
  return result
}
async function applyIdentity(env,input,success=true) {
  const path=await env.files.write('directory-plan.json',input.directoryPlan)
  const result=await command(env,'directory',['preview',path])
  const report=JSON.parse(result.stdout.split('\n').find(line=>line.trim().startsWith('{')&&line.includes('\"approvalHash\"'))??'null');sha(report?.approvalHash)
  await command(env,'directory',['apply',path,success?report.approvalHash:'0'.repeat(64)],success)
  ;(env.timeline??=[]).push({event:success?'identity-apply-completed':'identity-apply-refused',at:Date.now(),timeSource:'cli-return-observed'})
}
async function credentialProbe(env,handle,phase) {
  const result=await env.credentials.probe(handle,{phase})
  const evidence=Object.fromEntries(['kind','status','observedAt','credentialSha256','authenticated','authenticationInvalidated','authenticationCheck','authorizationError','issued','issuance','sideEffectsSha256','beforeSideEffectsSha256','protocolError','paired','identity','lifetime','rotation','timing'].map(key=>[key,result[key]]))
  try {
    sha(result.credentialSha256);sha(result.sideEffectsSha256)
    assert(Number.isInteger(result.status));assert(Number.isFinite(result.observedAt))
    assert(Number.isFinite(result.lifetime?.createdAt)&&Number.isFinite(result.lifetime?.expiresAt))
    assert(result.lifetime.createdAt<=result.observedAt+30000&&result.observedAt<result.lifetime.expiresAt,'denial must precede natural expiry')
    if(result.rotation){assert.equal(result.rotation.storedCredential,'issued-refresh');assert.equal(result.credentialSha256,result.rotation.issuedSha256);assert.equal(result.rotation.status,200)}
    if(result.lifetime.credentialSha256)assert.equal(result.credentialSha256,result.lifetime.credentialSha256)
    if(phase==='before'){assert(result.status>=200&&result.status<300);assert.equal(result.authenticated,true);if(result.authenticationCheck)assert(result.authenticationCheck.status>=200&&result.authenticationCheck.status<300)}
    else {
      assert(result.status<500,'service unavailability is not credential revocation')
      assert(Number.isFinite(result.timing?.firstRequestAt)&&Number.isFinite(result.timing?.serviceAvailableAt))
      assert(result.timing.firstRequestAt>=result.timing.serviceAvailableAt)
      if(['code','refresh'].includes(result.kind)){assert.equal(result.status,400);assert.equal(result.protocolError,'invalid_grant')}
      else {assert.equal(result.authenticationInvalidated,true);assert(result.authenticationCheck?.status===401||result.authenticationCheck?.loginRedirect===true)}
      assert.equal(result.authenticated,false);assert.equal(result.issued,false)
    }
    return evidence
  } catch(error){error.probeEvidence=evidence;throw error}
}

export async function runApplicationProjectMigration(base,context,record) {
  assert.equal(typeof record,'function')
  const report={schemaVersion:1,completed:false,checks:migrationCheckIds.map(id=>({id,status:'not_run',passed:false,evidence:{}})),cleanup:[],failures:0,notRun:migrationCheckIds.length,skipped:0}
  const persist=async()=>{report.failures=report.checks.filter(r=>r.status==='failed').length+report.cleanup.length;report.notRun=report.checks.filter(r=>r.status==='not_run').length;report.completed=report.failures===0&&report.notRun===0;await record(structuredClone(report))}
  await persist()
  try {releaseGate(context?.release);assert.equal(typeof context.create,'function')}
  catch {report.preconditionFailure='formal release evidence or explicit isolated migration context unavailable';await persist();return report}
  for(const row of report.checks) {
    if(context.supportedChecks&&!context.supportedChecks.includes(row.id)){row.evidence.reason='concrete production credential adapter not implemented for this check';await persist();continue}
    let env
    try {
      env=await context.create({caseId:row.id,base,release:context.release});owned(env,base);await env.assertOwned()
      const input=await env.prepareLegacy();const before=state(await env.snapshot())
      const noScopeKind=row.id==='migration-legacy-role-no-scope'?'role':row.id==='migration-legacy-subject-no-scope'?'subject':null
      const baselines=[]
      for(const accountKind of noScopeKind?[noScopeKind]:[]) {
        const baseline=await env.probeAccount(accountKind,{phase:'legacy'})
        assert.equal(baseline.status,200);assert(baseline.identity?.subject)
        if(accountKind==='role')assert(baseline.identity.roles?.length>0)
        assert.equal(baseline.sideEffectsSha256,before.effects.sha256)
        baselines.push({kind:accountKind,...baseline})
      }
      row.evidence={before,baselines,timeline:env.timeline??=[],migrationMode:'offline-maintenance',timingInterpretation:'No requests are accepted while the service is stopped. Check the first old-credential request after availability for authentication rejection; online subject/scope revocation deadlines are covered by separate online UI/MCP checks. CLI completion timestamps are observed return times, not exact database commit timestamps.',artifacts:{hostImage:context.release.host.image,pluginSha256:context.release.plugin.sha256,legacyImage:context.release.legacy.image,legacySha256:context.release.legacy.sha256}}
      row.status='running';await persist()
      await env.compose('stop',{release:context.release})
      const review=await preview(env,input)
      row.evidence.review={approvalSha256:review.approval,sourceSha256:review.report.sourceHash,targetSha256:review.report.targetHash,sourceRevision:review.report.sourceRevision,sourceRawSha256:review.hashes.sourceRawSha256,storedTargetSha256:review.hashes.storedTargetSha256}
      assert.equal(review.hashes.sourceRawSha256,before.legacy.sha256);assert.equal(review.report.sourceRevision,before.legacy.revision)
      assert.deepEqual(state(await env.snapshot()),before,'preview changed persisted state')
      if(row.id==='migration-preview-explicit-approval') {
        await applyLocal(env,review,'0'.repeat(64),false)
        const denied=state(await env.snapshot());assert.deepEqual(denied,before)
        await applyLocal(env,review)
        const after=state(await env.snapshot());assert.equal(after.local.sha256,review.hashes.storedTargetSha256);assert(after.local.revision>before.local.revision)
        row.evidence.after=after
      } else if(row.id==='migration-stale-review-no-change') {
        await env.compose('start-legacy',{release:context.release});await env.advanceLegacyRevision();await env.compose('stop',{release:context.release});const changed=state(await env.snapshot());assert(changed.legacy.revision>before.legacy.revision)
        await applyLocal(env,review,review.approval,false);const after=state(await env.snapshot());assert.deepEqual(after,changed);row.evidence.after=after
      } else {
        const requestedKind=row.id.replace('migration-old-','')
        const credentialKinds=kinds.includes(requestedKind)?[requestedKind]:row.id==='migration-backup-rollback'?kinds:[]
        if(credentialKinds.length)await env.compose('start-legacy',{release:context.release})
        const handles=credentialKinds.length?await env.credentials.capture({phase:'legacy',kinds:credentialKinds}):{}
        for(const kind of credentialKinds)assert(handles[kind],'missing old credential handle')
        row.evidence.oldCredentials={}
        for(const kind of credentialKinds)row.evidence.oldCredentials[kind]={before:await credentialProbe(env,handles[kind],'before')}
        let backup
        if(row.id==='migration-backup-rollback') {
          await env.compose('stop',{release:context.release});backup=await env.backup()
          for(const key of ['policySha256','identitySha256','installationSha256','archiveSha256'])sha(backup[key])
          assert.equal(backup.installationSha256,before.installation.sha256)
          row.evidence.backup=Object.fromEntries(['policySha256','identitySha256','installationSha256','archiveSha256'].map(k=>[k,backup[k]]))
        } else await env.compose('stop',{release:context.release})
        const identityOnly=row.id==='migration-identity-only-partial',localOnly=row.id==='migration-local-only-partial'
        if(!localOnly)await applyIdentity(env,input)
        if(!identityOnly)await applyLocal(env,review)
        // Exercise the refused second half, rather than merely omitting it.
        if(identityOnly)await applyLocal(env,review,'0'.repeat(64),false)
        if(localOnly)await applyIdentity(env,input,false)
        await env.compose('start-new',{release:context.release})
        const after=state(await env.snapshot());row.evidence.after=after
        if(identityOnly){assert.notEqual(after.directory.sha256,before.directory.sha256);assert.equal(after.local.sha256,before.local.sha256)}
        else assert.equal(after.local.sha256,review.hashes.storedTargetSha256)
        if(localOnly)assert.equal(after.directory.sha256,before.directory.sha256)
        if(context.storageOnly&&(identityOnly||localOnly)) {
          const probe=await env.probeAccount('subject',{phase:'new'})
          if(localOnly){
            assert.equal(probe.failClosed,true);assert.equal(probe.oauth.newValidProjectCredentials,false)
            assert(refused(probe.status)||probe.protectedRequest.loginRedirect===true)
          } else assert(refused(probe.status))
          assert.equal(probe.sideEffectsSha256,after.effects.sha256)
          row.evidence.partialDenial=probe
        }
        const kind=row.id.replace('migration-old-','')
        if(kinds.includes(kind)) {
          const result=await credentialProbe(env,handles[kind],'after');assert.equal(result.credentialSha256,row.evidence.oldCredentials[kind].before.credentialSha256)
          assert(result.timing?.firstRequestAt>=result.timing?.serviceAvailableAt,'old credential must be probed after service is available')
          assert.equal(result.sideEffectsSha256,after.effects.sha256);row.evidence.oldCredentials[kind].after=result
        } else if(row.id==='migration-old-api-writes-removed') {
          const actual=await env.probeLegacyWrites();assert(context.oldWriteEndpoints?.length>0);assert.deepEqual(actual,context.oldWriteEndpoints)
          for(const item of actual){assert(['POST','PUT','PATCH','DELETE'].includes(item.method));assert.equal(item.status,410)}
          assert.equal(state(await env.snapshot()).effects.sha256,after.effects.sha256);row.evidence.requests=actual
        } else if(row.id==='migration-backup-rollback') {
          const fresh=await env.credentials.capture({phase:'new',kinds});
          const freshBefore={}
          for(const type of kinds){assert(fresh[type]);freshBefore[type]=await credentialProbe(env,fresh[type],'before')}
          await env.compose('stop',{release:context.release});await env.restore(backup.handle)
          await env.compose('start-legacy',{release:context.release});const restored=state(await env.snapshot());assert.deepEqual(restored,before);row.evidence.restored=restored
          row.evidence.newCredentialsAfterRestore={}
          for(const type of kinds){
            const observed=await credentialProbe(env,fresh[type],'after')
            assert.equal(observed.credentialSha256,freshBefore[type].credentialSha256)
            assert.equal(observed.sideEffectsSha256,restored.effects.sha256)
            row.evidence.newCredentialsAfterRestore[type]={before:freshBefore[type],after:observed}
          }
          const allowed=await env.probeAccount('subject',{phase:'rollback'});assert.equal(allowed.status,200);row.evidence.rollbackLoginStatus=allowed.status
          assert.equal(state(await env.snapshot()).effects.sha256,restored.effects.sha256)
        } else if(noScopeKind) {
          const accountKind=row.id==='migration-legacy-role-no-scope'?'role':'subject'
          const probe=await env.probeAccount(accountKind,{phase:'new'})
          assert(refused(probe.status));assert(probe.identity?.subject);assert.deepEqual(probe.identity.projectScopes,[])
          if(accountKind==='role')assert(probe.identity.roles?.length>0)
          sha(probe.sideEffectsSha256);assert.equal(probe.sideEffectsSha256,after.effects.sha256)
          row.evidence.account={status:probe.status,identity:{subject:probe.identity.subject,projectScopes:probe.identity.projectScopes,roles:probe.identity.roles},sideEffectsSha256:probe.sideEffectsSha256}
        }
        assert.equal(state(await env.snapshot()).effects.sha256,after.effects.sha256)
      }
      row.passed=true;row.status='passed'
    } catch(error) {row.passed=false;row.status='failed';if(error.probeEvidence)row.evidence.failedCredentialProbe=error.probeEvidence;if(error.partialEvidence)row.evidence.partialDenial=error.partialEvidence;row.evidence.failure={name:error.name,message:redactFailure(error.message),locations:String(error.stack??'').split('\n').filter(line=>line.trim().startsWith('at ')).slice(0,8).map(redactFailure)}}
    finally {
      if(env)row.evidence.timeline=structuredClone(env.timeline??[])
      if(env)try {await env.assertOwned();await env.destroy()}catch {report.cleanup.push({caseId:row.id,status:'failed'})}
      await persist()
    }
  }
  return report
}

/**
 * 真实运维工厂（异步发布门，在任何 Docker 创建操作之前运行）。
 * options = {composeFile:<显式根 Compose 文件>,port:<专用空闲 loopback 端口>,
 *   target:{host:{image,commit,runId},plugin:{commit,runId,artifactId,sha256}},
 *   legacy:{host:{image,commit,runId},plugin:{commit,runId,artifactId,sha256}}}
 * 不接收 jar 路径或 verified。options.legacy 必须由调用方显式传入，代码不固定旧版本。
 * 两个 jar 都从指定成功 CI 下载并验证 provenance；目标本地 host pin 由根 driver 核对。
 * 本工厂仅需 Actions read，不请求仓库 Contents read。
 * 具体适配入口由 storageMigrationCheckIds 列出；全部 14 项均有具体适配；未运行不代表通过。
 * backup()/restore() 是实际全库 pg_dump + storage tar；rollback 检查同时要求
 * 六类新凭据回退后失效和旧账号重新登录，不能仅凭备份恢复操作标为通过。
 * 返回上下文不会创建容器；create() 才为单一用例创建全新资源。
 * 每个 env 提供 backup/restore，可由后续真实旧凭据适配复用。
 */
export const legacyWriteEndpoints=Object.freeze([
  {method:'POST',path:'/api/v1/main/extensions/rbac/roles',status:410},
  {method:'PUT',path:'/api/v1/main/extensions/rbac/roles/migration-reader',status:410},
  {method:'DELETE',path:'/api/v1/main/extensions/rbac/roles/migration-reader',status:410},
  {method:'PUT',path:'/api/v1/main/extensions/rbac/bindings',status:410},
  {method:'PUT',path:'/api/v1/main/extensions/rbac/role-mappings',status:410},
].map(Object.freeze))
export const storageMigrationCheckIds=Object.freeze([
  'migration-preview-explicit-approval','migration-stale-review-no-change',
  'migration-identity-only-partial','migration-local-only-partial','migration-old-ui-cookie',
  'migration-old-idp-session','migration-old-access','migration-old-refresh','migration-old-code','migration-old-mcp-session','migration-backup-rollback',
  'migration-legacy-subject-no-scope','migration-legacy-role-no-scope','migration-old-api-writes-removed',
])
/** Normalize only the configured first-party UI OAuth scopes, independently
 * of RBAC feature switches. Explicitly reject an unknown YAML layout rather
 * than silently leaving the target-only selector on a legacy host.
 */
export function migrationUiScopes(configuration,mode) {
  assert(['legacy','target'].includes(mode))
  const start=configuration.indexOf('oauth2:')
  assert(start>=0,'explicit OAuth2 UI client configuration required')
  const prefix=configuration.slice(0,start),oauth=configuration.slice(start)
  assert(/clients:\s*\n\s+kestra:/.test(oauth),'known first-party kestra OAuth client required')
  const lines=[...oauth.matchAll(/^(\s*scopes:)[ \t]*\[[^\n]*\][ \t]*$/gm)]
  assert.equal(lines.length,1,'exactly one inline UI scopes list required')
  const scopes=mode==='legacy'?'[openid, profile, email]':'[openid, profile, email, "kestra:project-scopes"]'
  const result=prefix+oauth.replace(/^(\s*scopes:)[ \t]*\[[^\n]*\][ \t]*$/m,(_,key)=>key+' '+scopes)
  const selected=result.slice(start).match(/^\s*scopes:[ \t]*(\[[^\n]*\])/m)?.[1]
  assert.equal(selected,scopes)
  return result
}
export const concreteMigrationCheckIds=storageMigrationCheckIds
const bytesHash=value=>createHash('sha256').update(value).digest('hex')
export async function createMigrationContext(options) {
  assert(options&&typeof options.composeFile==='string','explicit Compose source required')
  assert(options.legacy?.host&&options.legacy?.plugin,'explicit legacy release bundle required')
  assert(options.target?.host&&options.target?.plugin,'explicit target release bundle required')
  assert(Number.isInteger(options.port)&&options.port>1024&&options.port<65536,'explicit reserved test port required')
  const sourceFile=resolve(options.composeFile)
  assert(existsSync(sourceFile))
  const directory=mkdtempSync(join(tmpdir(),'application-project-migration-'));chmodSync(directory,0o700)
  // Deliberately do not inherit Compose settings, bootstrap credentials or .env.
  const processEnv=Object.fromEntries(['PATH','HOME','DOCKER_CONFIG','GH_CONFIG_DIR','GH_HOST','GH_TOKEN','GITHUB_TOKEN','TMPDIR'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]))
  const operations=[]
  const exec=(program,args,{input,binary=false,allowFailure=false,env=processEnv}={},attempt=0)=>{
    try {
      const output=execFileSync(program,args,{env,input,encoding:binary?undefined:'utf8',timeout:180000,maxBuffer:128*1024*1024,stdio:['pipe','pipe','pipe']})
      operations.push({program,exitCode:0,at:Date.now()})
      return {exitCode:0,stdout:binary?output:output.trim()}
    } catch(error) {
      const exitCode=Number.isInteger(error.status)?error.status:-1
      operations.push({program,exitCode,at:Date.now(),code:error.code,stdout:redactFailure(error.stdout),stderr:redactFailure(error.stderr)})
      const readOnly=program==='gh'&&(args[0]==='api'&&!args.some(value=>['-X','--method','-F','--field','-f','--raw-field','--input'].includes(value))||args[0]==='run'&&args[1]==='view')
      if(readOnly&&attempt<2&&/EOF|ETIMEDOUT|ECONNRESET|TLS handshake timeout/i.test(String(error.code)+' '+String(error.stderr)))return exec(program,args,{input,binary,allowFailure,env},attempt+1)
      // Never print raw arguments, stdout/stderr, environment or the Error object.
      if(!allowFailure)throw new Error('migration external operation failed; program='+program+'; status='+exitCode)
      return {exitCode,stdout:''}
    }
  }
  const run=(program,args,extra)=>exec(program,args,extra).stdout
  const json=(program,args)=>JSON.parse(run(program,args))
  const verified={}
  for(const [name,bundle]of Object.entries({target:options.target,legacy:options.legacy})) {
    assert(bundle?.host&&bundle?.plugin,'explicit target and legacy release bundles required')
    const {host,plugin}=bundle
    assert.match(host.image??'',/^ghcr\.io\/ai-specs\/kestra-overlay@sha256:[a-f0-9]{64}$/)
    for(const descriptor of [host,plugin]){assert.match(descriptor.commit??'',/^[a-f0-9]{40}$/);assert(Number.isSafeInteger(descriptor.runId)&&descriptor.runId>0)}
    sha(plugin.sha256);assert(Number.isSafeInteger(plugin.artifactId)&&plugin.artifactId>0)
    let hostRun
    for(const [repo,descriptor]of [['kestra-overlay',host],['kestra-plugin-rbac',plugin]]) {
      const result=json('gh',['run','view',String(descriptor.runId),'-R','ai-specs/'+repo,'--json','headSha,status,conclusion,jobs'])
      assert.equal(result.headSha,descriptor.commit);assert.equal(result.status,'completed');assert.equal(result.conclusion,'success')
      assert(result.jobs.length&&result.jobs.every(job=>!['failure','cancelled','timed_out'].includes(job.conclusion)))
      if(repo==='kestra-overlay')hostRun=result
    }
    const promote=hostRun.jobs.find(job=>job.name==='promote'),build=hostRun.jobs.find(job=>job.name==='build-push')
    assert.equal(promote?.conclusion,'success');assert.equal(build?.conclusion,'success')
    assert(promote.steps.some(step=>step.name==='Promote verified immutable candidate to deployment tags'&&step.conclusion==='success'))
    const promotionLog=run('gh',['run','view',String(host.runId),'-R','ai-specs/kestra-overlay','--job',String(promote.databaseId),'--log'])
    assert(!promotionLog.includes('SKIP: candidate commit is no longer the current main HEAD'))
    const buildLog=run('gh',['run','view',String(host.runId),'-R','ai-specs/kestra-overlay','--job',String(build.databaseId),'--log'])
    assert([...buildLog.matchAll(/Candidate image: (ghcr\.io\/ai-specs\/kestra-overlay@sha256:[a-f0-9]{64})/g)].some(match=>match[1]===host.image))
    const artifact=json('gh',['api','repos/ai-specs/kestra-plugin-rbac/actions/artifacts/'+plugin.artifactId])
    assert.equal(artifact.name,'kestra-rbac-authorizer');assert.equal(artifact.expired,false)
    assert.equal(artifact.workflow_run?.id,plugin.runId);assert.equal(artifact.workflow_run?.head_sha,plugin.commit)
    const artifacts=json('gh',['api','repos/ai-specs/kestra-plugin-rbac/actions/runs/'+plugin.runId+'/artifacts?per_page=100']).artifacts
    assert.equal(artifacts.filter(item=>item.name===artifact.name&&!item.expired).length,1)
    assert(artifacts.some(item=>item.id===plugin.artifactId))
    let downloaded
    const existing=options.downloadedArtifacts?.[name]
    if(existing){assert.equal(existing.runId,plugin.runId);assert.equal(existing.artifactId,plugin.artifactId);downloaded=resolve(existing.directory)}
    else {downloaded=join(directory,name);mkdirSync(downloaded,{mode:0o700});run('gh',['run','download',String(plugin.runId),'-R','ai-specs/kestra-plugin-rbac','--name',artifact.name,'--dir',downloaded])}
    const jar=join(downloaded,'build/libs/kestra-rbac-authorizer.jar')
    assert.equal(bytesHash(readFileSync(jar)),plugin.sha256)
    const provenance=JSON.parse(readFileSync(join(downloaded,'.integration/host-provenance.json'),'utf8'))
    assert.equal(provenance.image,host.image);sha(provenance.sha256)
    // Provenance comes from this successful CI's downloaded artifact; its
    // image is bound above to the selected successful/published host run.
    // The root driver validates target host-contract.properties from its local
    // fixed gitlink checkout. No repository Contents permission is required here.
    run('docker',['buildx','imagetools','inspect',host.image])
    verified[name]={host:structuredClone(host),plugin:structuredClone(plugin),jar,hostSha256:provenance.sha256}
  }
  const release={verified:true,host:verified.target.host,plugin:verified.target.plugin,legacy:{image:verified.legacy.host.image,sha256:verified.legacy.plugin.sha256}}
  const compilerHost=join(directory,'published-host.jar')
  const extraction=run('docker',['create',verified.target.host.image])
  try{run('docker',['cp',extraction+':/app/kestra',compilerHost]);assert.equal(bytesHash(readFileSync(compilerHost)),verified.target.hostSha256)}finally{run('docker',['rm','-v',extraction])}
  const context={release,storageOnly:true,oldWriteEndpoints:legacyWriteEndpoints,supportedChecks:storageMigrationCheckIds,directory,
    unsupportedChecks:migrationCheckIds.filter(id=>!storageMigrationCheckIds.includes(id)),operations}
  context.create=async({caseId})=>{
    assert(storageMigrationCheckIds.includes(caseId),'case has no concrete production adapter')
    const project='application-projects-migration-'+randomBytes(10).toString('hex')
    const work=join(directory,project);mkdirSync(work,{mode:0o700})
    const base='http://localhost:'+options.port,planned=planFixture(base)
    const subjectAccount={username:'migration-subject-'+randomBytes(6).toString('hex'),password:randomBytes(24).toString('base64url')+'aA1!'}
    subjectAccount.subject=subjectAccount.username
    const managerAccount={username:'migration-manager-'+randomBytes(6).toString('hex'),password:randomBytes(24).toString('base64url')+'aA1!'}
    managerAccount.subject=managerAccount.username
    const noScopeCase=['migration-legacy-subject-no-scope','migration-legacy-role-no-scope'].includes(caseId)
    const env={...processEnv,KESTRA_IMAGE:verified.legacy.host.image,POSTGRES_PASSWORD:randomBytes(32).toString('hex'),
      KESTRA_OIDC_UI_CLIENT_SECRET:randomBytes(32).toString('hex'),KESTRA_OIDC_BOOTSTRAP_USERNAME:planned.admin.username,
      KESTRA_OIDC_BOOTSTRAP_PASSWORD:planned.admin.password,KESTRA_OIDC_SETUP_ALLOWED:'false',KESTRA_RBAC_ENABLED:'false',KESTRA_OIDC_REGISTRATION_ENABLED:'true'}
    const config=JSON.parse(run('docker',['compose','--env-file','/dev/null','-p',project,'-f',sourceFile,'config','--format','json'],{env}))
    assert.deepEqual(Object.keys(config.services).sort(),['kestra','postgres'])
    delete config.name
    for(const [key,volume]of Object.entries(config.volumes??{})){assert(!volume.external);volume.name=project+'_'+key}
    for(const [key,network]of Object.entries(config.networks??{})){assert(!network.external);network.name=project+'_'+key}
    for(const service of Object.values(config.services)){delete service.container_name;assert(!service.build&&!service.network_mode&&!service.external_links&&!service.privileged&&!service.devices);delete service.restart}
    const host=config.services.kestra,postgres=config.services.postgres
    assert(!postgres.ports?.length);assert(postgres.volumes.every(v=>v.type==='volume'))
    host.volumes=host.volumes.filter(v=>v.type==='volume')
    host.volumes.push({type:'bind',source:work,target:'/work',read_only:false})
    host.ports=[{target:8080,published:String(options.port),host_ip:'127.0.0.1',protocol:'tcp'}]
    let configuration=host.environment.KESTRA_CONFIGURATION.replaceAll('http://localhost:8080',base)
    configuration=configuration.replaceAll('url: '+base+'/oidc/token','url: http://localhost:8080/oidc/token').replaceAll('jwks-uri: '+base+'/oidc/jwks','jwks-uri: http://localhost:8080/oidc/jwks')
    configuration=applicationProjectFeature(configuration,false)
    assert(configuration.includes('    management:'))
    configuration=configuration.replace('    management:','    management-admin-subjects: ["'+planned.admin.subject+'"]\n    management:')
    host.environment.KESTRA_CONFIGURATION=configuration
    Object.assign(host.environment,{RBAC_POLICY_JDBC_URL:'jdbc:postgresql://postgres:5432/kestra',RBAC_POLICY_JDBC_USER:'kestra',RBAC_POLICY_JDBC_PASSWORD:env.POSTGRES_PASSWORD,RBAC_POLICY_OPERATOR_SUBJECT:planned.admin.subject})
    const newConfiguration=migrationUiScopes(applicationProjectFeature(configuration,true).replace(/^    management-admin-subjects:.*\n/m,''),'target')
    const maintenance=structuredClone(host);delete maintenance.ports;delete maintenance.depends_on
    maintenance.image=verified.target.host.image;maintenance.profiles=['maintenance'];maintenance.environment.KESTRA_CONFIGURATION=newConfiguration
    maintenance.volumes.push({type:'bind',source:verified.target.jar,target:'/app/libs/kestra-rbac-authorizer.jar',read_only:true})
    config.services.maintenance=maintenance
    // Compile/run this tiny observer against the verified published artifacts only.
    // No plugin/host source tree participates. readReview rebuilds the entire
    // review with the production Java parsers and verifies its approval hash.
    writeFileSync(join(work,'MigrationReviewEvidence.java'),String.raw`import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import io.kestra.extensions.rbac.store.ProjectMigrationReview;
import io.kestra.extensions.rbac.store.PolicyDocumentValidator;
import io.kestra.extensions.rbac.project.ProjectPolicyParser;
class MigrationReviewEvidence {
  static String hash(byte[] b) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(b)); }
  public static void main(String[] args) throws Exception {
    var review = new ProjectMigrationReview().readReview(Files.readAllBytes(Path.of(args[0])));
    byte[] source = Files.readAllBytes(Path.of(args[2]));
    var old = new PolicyDocumentValidator().parse(source);
    if (!hash(old.canonicalJson().getBytes(StandardCharsets.UTF_8)).equals(review.sourceHash())) throw new IllegalStateException("source differs");
    var parser = new ProjectPolicyParser();
    var target = parser.parse(Files.readAllBytes(Path.of(args[1])));
    System.out.println("{\"approvalHash\":\"" + review.approvalHash() + "\",\"sourceHash\":\"" + review.sourceHash() + "\",\"sourceRawSha256\":\"" + hash(source) + "\",\"targetHash\":\"" + review.targetHash() + "\",\"storedTargetSha256\":\"" + hash(parser.canonicalJson(target).getBytes(StandardCharsets.UTF_8)) + "\"}");
  }
}
`,{mode:0o600})
    run('javac',['-cp',compilerHost+':'+verified.target.jar,'-d',work,join(work,'MigrationReviewEvidence.java')])
    const file=join(work,'compose.json')
    const save=()=>writeFileSync(file,JSON.stringify(config),{mode:0o600})
    const dc=(args,extra={})=>exec('docker',['compose','--env-file','/dev/null','-p',project,'-f',file,...args],{env,...extra})
    let legacyPolicyActive=false,legacyRoleMappingOnly=false
    const legacyConfiguration=()=>{
      let current=migrationUiScopes(configuration,'legacy')
      if(legacyPolicyActive){
        current=applicationProjectFeature(current,true).replace(/(    application-projects:\n      enabled: )true/,'$1false')
        if(legacyRoleMappingOnly)current=current.replace(/^    management-admin-subjects:.*\n/m,'    management-admin-subjects: ["'+managerAccount.subject+'"]\n')
      }
      return migrationUiScopes(current,'legacy')
    }
    const use=which=>{const bundle=verified[which];host.image=bundle.host.image;host.volumes=host.volumes.filter(v=>v.target!=='/app/libs/kestra-rbac-authorizer.jar');host.volumes.push({type:'bind',source:bundle.jar,target:'/app/libs/kestra-rbac-authorizer.jar',read_only:true});host.environment.KESTRA_CONFIGURATION=which==='legacy'?legacyConfiguration():newConfiguration;save()}
    use('legacy');dc(['config','--quiet'])
    const identity={project,containers:[],volumes:[]}
    const inspect=()=>{
      const ids=dc(['ps','--all','-q']).stdout.split('\n').filter(Boolean)
      identity.containers=ids.map(id=>{assert.match(id,/^[a-f0-9]{12,64}$/);const obj=json('docker',['inspect',id])[0];assert.equal(obj.Config.Labels['com.docker.compose.project'],project);return {id,project}})
      identity.volumes=Object.values(config.volumes).map(v=>{const actual=json('docker',['volume','inspect',v.name])[0];assert.equal(actual.Labels['com.docker.compose.project'],project);return {name:v.name,project}})
      assert(identity.containers.length>=2)
    }
    const wait=async()=>{const until=Date.now()+180000;while(Date.now()<until){try{const res=await fetch(base+'/ping',{signal:AbortSignal.timeout(2000)});await res.body?.cancel();if(res.ok)return}catch{}await new Promise(resolve=>setTimeout(resolve,500))}throw new Error('isolated host startup timeout')}
    const pg=()=>{const id=dc(['ps','-q','postgres']).stdout;assert.match(id,/^[a-f0-9]{12,64}$/);return id}
    const sql=query=>run('docker',['exec',pg(),'psql','-X','-U','kestra','-d','kestra','-v','ON_ERROR_STOP=1','-Atc',query])
    const exists=table=>sql("SELECT to_regclass('public."+table+"') IS NOT NULL")==='t'
    const tableRows=table=>exists(table)?JSON.parse(sql('SELECT COALESCE(json_agg(x ORDER BY x::text),\'[]\'::json) FROM (SELECT row_to_json(t) x FROM '+table+' t) q')):[]
    const cli=(name,args,{legacy=false}={})=>{inspect();return dc(['run','--rm','-T','--no-deps','--user','0:0','--entrypoint','java',legacy?'kestra':'maintenance','-cp','/app/kestra:/app/libs/kestra-rbac-authorizer.jar',name,...args],{allowFailure:true})}
    const write=(name,value)=>{assert.equal(basename(name),name);const destination=join(work,name);if(value===null){assert(!existsSync(destination));return '/work/'+name}writeFileSync(destination,JSON.stringify(value)+'\n',{mode:0o600});return '/work/'+name}
    const read=path=>{assert(path.startsWith('/work/')&&basename(path)===path.slice(6));return JSON.parse(readFileSync(join(work,basename(path)),'utf8'))}
    const snapshot=async()=>{
      inspect()
      const policy=prefix=>{if(!exists(prefix+'_head'))return {revision:0,sha256:bytesHash('')};const revision=Number(sql('SELECT revision FROM '+prefix+'_head WHERE policy_id=1'));const encoded=revision?sql("SELECT encode(convert_to(document_json,'UTF8'),'base64') FROM "+prefix+'_snapshot WHERE revision='+revision):'';return {revision,sha256:bytesHash(Buffer.from(encoded.replace(/\s/g,''),'base64'))}}
      const directory=tableRows('oidc_project_state').map(row=>JSON.parse(row.document_json))
      const receipt=dc(['run','--rm','-T','--no-deps','--entrypoint','cat','maintenance','/app/storage/.oidc-installation']).stdout
      const running=dc(['ps','--status','running','-q','kestra']).stdout
      const storageCommand=['sh','-c',"set -eu; entries=$(find /app/storage -type f ! -name .oidc-installation -exec sha256sum {} +); printf '%s\\n' \"$entries\" | LC_ALL=C sort"]
      const storage=running?run('docker',['exec','--user','0:0',running,...storageCommand]):dc(['run','--rm','-T','--no-deps','--user','0:0','--entrypoint',...storageCommand.slice(0,1),'maintenance',...storageCommand.slice(1)]).stdout
      const queue=Object.fromEntries(['queues','execution_queued'].map(table=>[table,exists(table)?sql("SELECT COALESCE(string_agg(value::text,'|' ORDER BY value::text),'') FROM "+table+" WHERE value::text LIKE '%scope.acceptance.%'"):'']))
      return {policyStateSha256:digest(Object.fromEntries(['rbac_policy_head','rbac_policy_snapshot','rbac_project_policy_head','rbac_project_policy_snapshot'].map(table=>[table,tableRows(table)]))),directoryStateSha256:digest(Object.fromEntries(['oidc_project_state','oidc_project_bootstrap','oidc_project_invalidation'].map(table=>[table,tableRows(table)]))),schemaSha256:digest(JSON.parse(sql("SELECT COALESCE(json_agg(t ORDER BY table_name,column_name),'[]'::json) FROM (SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='public') t"))),legacy:policy('rbac_policy'),local:policy('rbac_project_policy'),directory:{revision:directory.reduce((sum,item)=>sum+(item.project?.revision??0),0),sha256:digest(directory)},
        effects:{sha256:digest({database:Object.fromEntries(['flows','executions','triggers','kv_metadata','execution_outputs'].map(table=>[table,tableRows(table)])),queue,storage:bytesHash(storage)})},installation:{sha256:bytesHash(receipt)}}
    }
    const login=async(account=planned.admin)=>{const client=new ProductionOAuthClient(base);await client.login(account.username,account.password);return client}
    const loginIdentity=async(account,mode)=>{
      const client=new ProductionOAuthClient(base);let jwt
      const request=client.request.bind(client)
      client.request=async(...args)=>{const response=await request(...args);for(const value of response.headers.getSetCookie()){const pair=value.split(';')[0];if(pair.startsWith('JWT='))jwt=pair.slice(4)}return response}
      await client.login(account.username,account.password);assert(jwt)
      const identity=await verifyCredentialJwt(client,jwt,'kestra-ui',mode,account.subject)
      return {client,identity}
    }
    const verifyCredentialJwt=async(client,token,audience,mode,expectedSubject=planned.admin.subject)=>{
      assert(token)
      const metadata=await client.discover(),parts=token.split('.');assert.equal(parts.length,3)
      const header=JSON.parse(Buffer.from(parts[0],'base64url'));assert.equal(header.alg,'RS256')
      const response=await client.request(metadata.jwks_uri);assert.equal(response.status,200)
      const keys=(await response.json()).keys.filter(key=>key.kid===header.kid&&key.kty==='RSA');assert.equal(keys.length,1)
      assert(verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:keys[0],format:'jwk'}),Buffer.from(parts[2],'base64url')))
      const claims=JSON.parse(Buffer.from(parts[1],'base64url'))
      assert.equal(claims.iss,base);assert.equal(claims.sub,expectedSubject)
      assert(claims.exp>Date.now()/1000&&claims.iat<=Date.now()/1000+30)
      const audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud];assert.deepEqual(audiences,[audience])
      assert(claims.roles===undefined||Array.isArray(claims.roles)&&claims.roles.every(role=>typeof role==='string'&&role.length>0))
      const scopes=typeof claims.scope==='string'?claims.scope.split(' ').filter(Boolean):claims.scope??[];assert(Array.isArray(scopes))
      if(mode==='legacy')assert(!claims.kestra_project_v1,'legacy source unexpectedly issued project envelope')
      else {assert.equal(claims.kestra_project_v1?.project_id,'kestra');assert(Number.isSafeInteger(claims.kestra_project_v1.authorization_version))}
      return {subject:claims.sub,issuer:claims.iss,audiences,scopes,createdAt:claims.iat*1000,expiresAt:claims.exp*1000,roles:claims.roles??[],...(mode==='new'?{project:'kestra',projectScopes:claims.kestra_project_v1.project_scopes}:{projectScopes:[]})}
    }
    const lifetimeFromDatabase=(kind,secret)=>{
      // Read only this isolated database, selecting timestamps/flags only.
      // Pass a fingerprint, never a raw token/code, through argv or SQL logs.
      const fingerprint=createHash('md5').update(secret).digest('hex')
      const isCode=kind==='code',table=isCode?'oidc_authorization_code':'oidc_token',column=isCode?'code':'value'
      const text=sql("SELECT json_build_object('createdAt',extract(epoch from "+(isCode?'created_at':'issued_at')+")*1000,'expiresAt',extract(epoch from expires_at)*1000,'inactive',"+(isCode?'used':'revoked')+") FROM "+table+" WHERE md5("+column+")='"+fingerprint+"'"+(isCode?'':" AND token_type='refresh'"))
      const result=JSON.parse(text);assert(Number.isFinite(result.createdAt)&&Number.isFinite(result.expiresAt));assert(result.expiresAt>Date.now())
      return {...result,source:'isolated-database-read-only',credentialSha256:bytesHash(secret)}
    }
    const backups=new Map(),credentialHandles=new Map(),timeline=[]
    let activeRelease='legacy'
    const instance={base,identity,timeline,files:{write,read},cli:(name,args)=>cli(name,args),snapshot,
      verifyReview:async({review,target})=>{
        inspect()
        const revision=Number(sql('SELECT revision FROM rbac_policy_head WHERE policy_id=1'));assert(Number.isSafeInteger(revision)&&revision>0)
        // psql base64 transfer preserves the exact TEXT bytes, including trailing
        // whitespace; command output trimming is never applied to the document.
        const encoded=sql("SELECT encode(convert_to(document_json,'UTF8'),'base64') FROM rbac_policy_snapshot WHERE revision="+revision)
        const source=Buffer.from(encoded.replace(/\s/g,''),'base64')
        writeFileSync(join(work,'source-current.json'),source,{mode:0o600})
        const result=dc(['run','--rm','-T','--no-deps','--user','0:0','--entrypoint','java','maintenance','-cp','/app/kestra:/app/libs/kestra-rbac-authorizer.jar:/work','MigrationReviewEvidence',review,target,'/work/source-current.json'])
        return JSON.parse(result.stdout.split('\n').find(line=>line.startsWith('{')&&line.includes('"sourceRawSha256"'))??'null')
      },
      credentials:{
        capture:async({phase,kinds:requested=kinds})=>{
          assert(['legacy','new'].includes(phase))
          const captured={},cookies=new Map(),cookieLifetimes=new Map(),client=new ProductionOAuthClient(base)
          let tokens,exchange,authorize,registration,pendingCode=false,heldExchange,exchangeReceipt
          const stopExchange=Symbol('unconsumed production code')
          const request=client.request.bind(client)
          client.request=async(path,options={},...rest)=>{
            const url=new URL(path,base)
            assert.equal(url.origin,base)
            const body=options.body instanceof URLSearchParams?new URLSearchParams(options.body):null
            if(url.pathname==='/oidc/authorize')authorize=url.toString()
            if(url.pathname==='/oidc/token'&&body?.get('grant_type')==='authorization_code') {
              if(pendingCode){heldExchange=body;throw stopExchange}
              exchange=body
            }
            const requestStartedAt=Date.now()
            const response=await request(path,options,...rest)
            for(const value of response.headers.getSetCookie()) {
              const pair=value.split(';')[0],at=pair.indexOf('=')
              if(at>0){
                const name=pair.slice(0,at),content=pair.slice(at+1)
                if(!content||/;\s*max-age=0(?:;|$)/i.test(value)){cookies.delete(name);cookieLifetimes.delete(name)}
                else {
                  cookies.set(name,content)
                  const maxAge=value.match(/;\s*max-age=(\d+)/i)?.[1],expires=value.match(/;\s*expires=([^;]+)/i)?.[1]
                  const expiresAt=maxAge?requestStartedAt+Number(maxAge)*1000:expires?Date.parse(expires):null
                  if(Number.isFinite(expiresAt))cookieLifetimes.set(name,{createdAt:requestStartedAt,expiresAt,source:maxAge?'production-set-cookie-max-age':'production-set-cookie-expires'})
                }
              }
            }
            if(url.pathname==='/oidc/register'&&response.status===201)registration=await response.clone().json()
            if(url.pathname==='/oidc/token'&&response.status===200){tokens=await response.clone().json();exchangeReceipt={status:response.status,observedAt:Date.now(),accessSha256:bytesHash(tokens.access_token),codeSha256:bytesHash(body.get('code')),lifetime:lifetimeFromDatabase('code',body.get('code'))}}
            return response
          }
          const authenticate=async c=>c.login(planned.admin.username,planned.admin.password)
          await authenticate(client)
          const put=(kind,value)=>{const handle=randomBytes(24).toString('hex');credentialHandles.set(handle,{kind,...value});captured[kind]=handle}
          
          const protocols=['openid','mcp:flows:read','mcp:executions:write']
          const projectScopes=phase==='new'?[planned.observerScope]:[]
          const scopes=[...protocols,...projectScopes]
          const approve=async registered=>{
            // This no-op is permitted exclusively against the verified legacy
            // release, whose issuer has no application-project membership model.
            if(phase==='legacy')return
            const manager=new ProjectManagement(base,planned.admin,projection=>({...projection.project,directoryRevision:projection.directoryRevision}))
            await manager.approveOrdinaryClient({clientId:registered.clientId,audiences:registered.audiences,projectScopes,registeredProtocolScopes:protocols,requestedProtocolScopes:protocols})
          }
          if(requested.some(kind=>kind!=='ui-cookie')) {
            await client.issueMcpScopes(scopes,approve,authenticate)
            assert(tokens?.access_token&&tokens?.refresh_token&&exchange&&authorize&&registration)
            const signed=await verifyCredentialJwt(client,tokens.access_token,base+'/api/v1/main/mcp/default',phase)
            assert.deepEqual([...signed.scopes].sort(),[...scopes].sort(),'issuer must issue exactly the requested, actually granted scopes')
            if(phase==='new')assert.deepEqual([...signed.projectScopes].sort(),[...projectScopes].sort())
            const paired={...exchangeReceipt,subject:signed.subject,scopes:signed.scopes};assert.equal(paired.status,200);assert.equal(paired.lifetime.inactive,true)
            
            if(requested.includes('refresh'))put('refresh',{form:new URLSearchParams({grant_type:'refresh_token',client_id:exchange.get('client_id'),refresh_token:tokens.refresh_token,resource:exchange.get('resource')}),identity:signed,lifetime:lifetimeFromDatabase('refresh',tokens.refresh_token)})
            if(requested.includes('mcp-session')||requested.includes('access')) {
              const initialized=await client.rpc(null,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'migration-acceptance',version:'1'}},1)
              assert.equal(initialized.status,200);assert(initialized.session&&initialized.message?.result)
              await client.rpc(initialized.session,'notifications/initialized')
              if(requested.includes('mcp-session'))put('mcp-session',{access:tokens.access_token,session:initialized.session,identity:signed,lifetime:{createdAt:signed.createdAt,expiresAt:signed.expiresAt,source:'verified-access-jwt'}})
              if(requested.includes('access'))put('access',{access:tokens.access_token,session:initialized.session,identity:signed,lifetime:{createdAt:signed.createdAt,expiresAt:signed.expiresAt,source:'verified-access-jwt'}})
            }
            if(requested.includes('idp-session')) {
              // Published OidcSessionService.SESSION_COOKIE_NAME is oidc_session.
              // Obtain a fresh provider login without following its authorize
              // redirect. Do not mistake the UI JWT for the provider session.
              const response=await client.request('/oidc/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:planned.admin.username,password:planned.admin.password,from:authorize})})
              assert.equal(response.status,303);await response.body?.cancel();assert(cookies.get('oidc_session'))
              assert(cookieLifetimes.get('oidc_session'));put('idp-session',{cookie:cookies.get('oidc_session'),authorize,lifetime:cookieLifetimes.get('oidc_session')})
            }
            if(requested.includes('code')) {
              // Same client/owner/scopes/PKCE path twice. First exchange really
              // succeeded and its signed token was verified above. Intercept
              // only the second exchange BEFORE any network send.
              pendingCode=true
              try {await client.issueMcpScopes(scopes,approve,authenticate,{registeredClient:registration});assert.fail('second code was consumed')}
              catch(error){if(error!==stopExchange)throw error}
              assert(heldExchange?.get('code'));assert.notEqual(heldExchange.get('code'),exchange.get('code'))
              const lifetime=lifetimeFromDatabase('code',heldExchange.get('code'));assert.equal(lifetime.inactive,false)
              put('code',{form:heldExchange,paired,unconsumed:true,lifetime})
            }
          }
          if(requested.includes('ui-cookie')){await authenticate(client);assert(cookies.get('JWT'));const signed=await verifyCredentialJwt(client,cookies.get('JWT'),'kestra-ui',phase);const cookieLifetime=cookieLifetimes.get('JWT');put('ui-cookie',{jwt:cookies.get('JWT'),identity:signed,lifetime:{createdAt:signed.createdAt,expiresAt:Math.min(signed.expiresAt,cookieLifetime?.expiresAt??signed.expiresAt),source:'verified-ui-jwt-and-cookie'}})}
          for(const kind of requested)assert(captured[kind])
          return captured
        },
        probe:async(handle,{phase})=>{
          inspect();const credential=credentialHandles.get(handle);assert(credential,'only production-issued own handles accepted')
          const before=(await snapshot()).effects.sha256
          assert(Number.isFinite(credential.lifetime?.createdAt)&&Number.isFinite(credential.lifetime?.expiresAt))
          assert(credential.lifetime.expiresAt>Date.now(),'natural credential expiry cannot prove migration invalidation')
          if(phase==='after')assert(Number.isFinite(credential.baselineAt))
          if(credential.identity)assert(credential.identity.expiresAt>Date.now(),'natural token expiry cannot prove migration invalidation')
          let response,status,denied=false,issued=false,authenticated=null,protocolError,paired,authenticationCheck
          const issuance={cookieNames:[],authorizationCode:false,consent:false}
          const observeIssuance=response=>{
            for(const value of response.headers.getSetCookie()){
              const pair=value.split(';')[0],at=pair.indexOf('=');const expires=value.match(/;\s*expires=([^;]+)/i)?.[1]
              if(at>0&&pair.slice(at+1)&&!/;\s*max-age=0(?:;|$)/i.test(value)&&!(expires&&Date.parse(expires)<=Date.now()))issuance.cookieNames.push(pair.slice(0,at))
            }
            const location=response.headers.get('location')
            if(location)issuance.authorizationCode=issuance.authorizationCode||new URL(location,base).searchParams.has('code')
            issued=issued||issuance.cookieNames.some(name=>['JWT','oidc_session'].includes(name))||issuance.authorizationCode
          }
          const authReceipt=(response,allowedLoginPaths)=>{
            const location=response.headers.get('location'),url=location?new URL(location,base):null
            const loginRedirect=[302,303,307,308].includes(response.status)&&url?.origin===base&&allowedLoginPaths.includes(url.pathname)
            return {status:response.status,loginRedirect:Boolean(loginRedirect),...(url?{redirectPath:url.pathname}:{})}
          }
          const resource=base+'/api/v1/main/mcp/default'
          let firstRequestAt
          const available=[...timeline].reverse().find(item=>item.event==='service-available')
          const applied=[...timeline].reverse().find(item=>item.event==='identity-apply-completed')
          const stopped=[...timeline].reverse().find(item=>item.event==='jvm-stopped'&&available&&item.at<=available.at)
          const send=(path,options={})=>{
            if(firstRequestAt===undefined){
              firstRequestAt=Date.now()
              if(phase==='after'){
                assert(available&&firstRequestAt>=available.at,'do not treat maintenance unavailability as revocation')
                timeline.push({event:'first-old-credential-request',at:firstRequestAt,kind:credential.kind,release:activeRelease,path:new URL(path,base).pathname})
              }
            }
            return fetch(new URL(path,base),{redirect:'manual',signal:AbortSignal.timeout(15000),...options})
          }
          if(credential.kind==='ui-cookie')response=await send('/api/v1/main/flows/search?namespace=scope.acceptance.a',{headers:{Cookie:'JWT='+credential.jwt}})
          else if(credential.kind==='idp-session')response=await send(credential.authorize,{headers:{Cookie:'oidc_session='+credential.cookie}})
          else if(['access','mcp-session'].includes(credential.kind)) {
            response=await send(resource,{method:'POST',headers:{Authorization:'Bearer '+credential.access,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(credential.session?{'Mcp-Session-Id':credential.session,'MCP-Protocol-Version':'2025-06-18'}:{})},body:JSON.stringify({jsonrpc:'2.0',id:77,method:'tools/list'})})
          } else {
            if(credential.kind==='code'&&phase==='before') {
              assert(credential.unconsumed);assert(credential.paired?.accessSha256)
              paired=credential.paired;status=200;authenticated=true
            } else {
              response=await send('/oidc/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:credential.form})
              let result
              try{result=await response.clone().json()}catch{result={error:'non_json_token_response'}}
              issued=Boolean(result.access_token||result.refresh_token||result.id_token)
              protocolError=typeof result.error==='string'&&/^[a-z_]{1,80}$/.test(result.error)?result.error:result.error?'unrecognized_protocol_error':undefined
              if(response.ok&&phase==='before'){
                assert(issued);const signed=await verifyCredentialJwt(new ProductionOAuthClient(base),result.access_token,resource,credential.identity?.project?'new':'legacy')
                if(credential.kind==='refresh'&&phase==='before'){
                  const consumedSha256=bytesHash(credential.form.get('refresh_token'));assert(result.refresh_token)
                  const lifetime=lifetimeFromDatabase('refresh',result.refresh_token);assert.equal(lifetime.inactive,false)
                  credential.form.set('refresh_token',result.refresh_token);credential.identity=signed;credential.lifetime=lifetime
                  credential.rotation={status:response.status,observedAt:Date.now(),consumedSha256,issuedSha256:bytesHash(result.refresh_token),accessSha256:bytesHash(result.access_token),storedCredential:'issued-refresh'}
                  assert.notEqual(credential.rotation.consumedSha256,credential.rotation.issuedSha256)
                }
              }
              denied=response.status===400&&protocolError==='invalid_grant'&&!issued
              if(credential.kind==='code')credential.unconsumed=false
            }
          }
          if(response) {
            status=response.status;observeIssuance(response)
            if(credential.kind==='idp-session')authenticationCheck=authReceipt(response,['/oidc/login'])
            if(credential.kind==='mcp-session')authenticationCheck=authReceipt(response,[])
            if(credential.kind==='ui-cookie'){
              // ID token is checked only as the original UI cookie, never sent
              // to userinfo. This is the protected production UI entry.
              const auth=await send('/ui/',{headers:{Cookie:'JWT='+credential.jwt}})
              observeIssuance(auth);authenticationCheck=authReceipt(auth,['/oauth/login/kestra','/oidc/login']);await auth.body?.cancel()
              if(phase==='after'&&authenticationCheck.redirectPath==='/oidc/logout'&&[302,303,307,308].includes(auth.status)) {
                const logout=await send('/oidc/logout',{headers:{Cookie:'JWT='+credential.jwt}})
                observeIssuance(logout)
                const cleared=logout.headers.getSetCookie().filter(value=>/;\s*max-age=0(?:;|$)/i.test(value)).map(value=>value.split('=')[0])
                assert(cleared.includes('JWT')&&cleared.includes('oidc_session'),'invalidated UI identity must clear both authentication cookies')
                await logout.body?.cancel()
                const fresh=new ProductionOAuthClient(base),chain=[];let next='/ui/',loginForm=false
                for(let hop=0;hop<8;hop++) {
                  const response=await fresh.request(next);observeIssuance(response);const url=new URL(next,base)
                  chain.push({path:url.pathname,status:response.status})
                  if(response.status===200){const html=await response.text();loginForm=url.pathname==='/oidc/login'&&/name="username"/.test(html)&&/name="password"/.test(html);break}
                  assert([302,303,307,308].includes(response.status));const location=new URL(response.headers.get('location'),base);assert.equal(location.origin,base);assert(!location.searchParams.has('code'));next=location.pathname+location.search;await response.body?.cancel()
                }
                assert(loginForm,'cleared UI session must reach the production login form without credentials')
                authenticationCheck={...authenticationCheck,loginRedirect:true,logoutClearedCookies:cleared,finalLoginPath:'/oidc/login',unauthenticatedLoginForm:true,chain}
              }
            }
            if(['access','mcp-session'].includes(credential.kind)){
              const auth=await send('/oidc/userinfo',{headers:{Authorization:'Bearer '+credential.access}})
              observeIssuance(auth);const check=authReceipt(auth,[])
              if(auth.ok){const identity=await auth.json();check.subjectMatches=identity.sub===credential.identity.subject;if(phase==='before')assert.equal(check.subjectMatches,true)}else await auth.body?.cancel()
              if(credential.kind==='access')authenticationCheck=check
              else authenticationCheck.tokenAuthentication=check
            }
            if(phase==='before'&&['access','mcp-session'].includes(credential.kind)&&response.ok) {
              let message
              if(response.headers.get('content-type')?.includes('text/event-stream')) {
                const reader=response.body.getReader(),decoder=new TextDecoder();let buffer=''
                try {
                  while(!message) {
                    const {done,value}=await reader.read();assert(!done,'RPC stream ended without tools/list result')
                    buffer+=decoder.decode(value,{stream:true});buffer=buffer.replaceAll('\r\n','\n');assert(buffer.length<4*1024*1024)
                    let split
                    while((split=buffer.indexOf('\n\n'))>=0) {
                      const event=buffer.slice(0,split);buffer=buffer.slice(split+2)
                      const data=event.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n')
                      if(data){const item=JSON.parse(data);if(item.id===77)message=item}
                    }
                  }
                } finally {await reader.cancel()}
              } else message=await response.json()
              assert(message?.id===77&&message?.result&&Array.isArray(message.result.tools),'tools/list must succeed, arbitrary RPC errors are not authorization denial')
            } else if(credential.kind==='idp-session'&&response.ok) {
              const consent=(await response.text()).includes('name="interaction"')
              if(phase==='before')assert(consent,'provider cookie must reach actual consent')
              issuance.consent=consent;issued=issued||(phase==='after'&&consent)
            } else await response.body?.cancel()
            if(['code','refresh'].includes(credential.kind))authenticated=denied?false:response.ok?true:null
            else authenticated=authenticationCheck.status===401||authenticationCheck.loginRedirect?false:authenticationCheck.status>=200&&authenticationCheck.status<300?true:null
            denied=denied||status===403
          }
          const after=(await snapshot()).effects.sha256;assert.equal(after,before,'credential probe changed business storage')
          const observedAt=Date.now();assert(observedAt<credential.lifetime.expiresAt,'credential expired during probe')
          if(phase==='before')credential.baselineAt=observedAt
          const secret=credential.jwt??credential.cookie??credential.form?.get(credential.kind==='code'?'code':'refresh_token')??(credential.kind==='mcp-session'?credential.access+'\n'+credential.session:credential.access)
          const authenticationInvalidated=!['code','refresh'].includes(credential.kind)&&Boolean(authenticationCheck?.status===401||authenticationCheck?.loginRedirect)
          const timing={maintenanceStoppedAt:stopped?.at??null,offlineMaintenanceMs:available&&stopped?available.at-stopped.at:null,firstRequestAt:firstRequestAt??null,serviceAvailableAt:available?.at??null,identityApplyCompletedAt:applied?.at??null,msSinceIdentityApplyCompletion:firstRequestAt!==undefined&&applied?firstRequestAt-applied.at:null,msSinceServiceAvailable:firstRequestAt!==undefined&&available?firstRequestAt-available.at:null,mode:'offline-maintenance',onlineRevocationDeadlineClaimed:false}
          return {kind:credential.kind,status,observedAt,timing,authenticationCheck,authenticationInvalidated,issuance,lifetime:{...credential.lifetime,baselineAt:credential.baselineAt},...(credential.rotation?{rotation:credential.rotation}:{}),credentialSha256:bytesHash(secret),authenticated,authorizationError:denied,issued,sideEffectsSha256:after,beforeSideEffectsSha256:before,...(protocolError?{protocolError}:{}),...(paired?{paired}:{}),...(credential.identity?{identity:credential.identity}:{})}
        },
      },
      assertOwned:async()=>inspect(),
      compose:async action=>{
        inspect()
        if(action==='stop'){
          const running=Boolean(dc(['ps','--status','running','-q','kestra']).stdout)
          timeline.push({event:'jvm-stop-requested',release:activeRelease,at:Date.now()})
          dc(['stop','kestra']);assert(!dc(['ps','--status','running','-q','kestra']).stdout)
          timeline.push({event:running?'jvm-stopped':'jvm-already-stopped',release:activeRelease,at:Date.now()})
          return
        }
        assert(['start-new','start-legacy'].includes(action))
        const release=action==='start-new'?'target':'legacy'
        use(release);timeline.push({event:'jvm-start-requested',release,at:Date.now()})
        dc(['up','-d','kestra']);await wait()
        const healthyAt=Date.now();timeline.push({event:'jvm-health-observed',release,at:healthyAt})
        inspect();const id=dc(['ps','-q','kestra']).stdout
        const actual=run('docker',['exec',id,'sha256sum','/app/kestra']).split(/\s+/)[0];assert.equal(actual,verified[release].hostSha256)
        activeRelease=release;timeline.push({event:'service-available',release,at:healthyAt,artifactVerifiedAt:Date.now()})
      },
      backup:async()=>{
        inspect();assert(!dc(['ps','--status','running','-q','kestra']).stdout,'stop JVM before consistent backup')
        const database=exec('docker',['exec',pg(),'pg_dump','-U','kestra','-d','kestra','-Fc'],{binary:true}).stdout
        const storage=dc(['run','--rm','-T','--no-deps','--entrypoint','tar','maintenance','-cf','-','-C','/app/storage','.'],{binary:true}).stdout
        const before=await snapshot(),handle=randomBytes(16).toString('hex')
        const dbFile=join(work,handle+'.dump'),storageFile=join(work,handle+'.tar');writeFileSync(dbFile,database,{mode:0o600});writeFileSync(storageFile,storage,{mode:0o600})
        backups.set(handle,{dbFile,storageFile,before,databaseHash:bytesHash(database),storageHash:bytesHash(storage)})
        return {handle,policySha256:before.legacy.sha256,identitySha256:bytesHash(database),installationSha256:before.installation.sha256,archiveSha256:bytesHash(storage)}
      },
      restore:async handle=>{
        inspect();assert(!dc(['ps','--status','running','-q','kestra']).stdout)
        const saved=backups.get(handle);assert(saved,'only own backup handles accepted')
        timeline.push({event:'backup-restore-started',at:Date.now()})
        const database=readFileSync(saved.dbFile),storage=readFileSync(saved.storageFile)
        assert.equal(bytesHash(database),saved.databaseHash);assert.equal(bytesHash(storage),saved.storageHash)
        run('docker',['exec',pg(),'psql','-X','-U','kestra','-d','postgres','-v','ON_ERROR_STOP=1','-c','DROP DATABASE kestra WITH (FORCE)'])
        run('docker',['exec',pg(),'createdb','-U','kestra','kestra'])
        exec('docker',['exec','-i',pg(),'pg_restore','-U','kestra','-d','kestra','--exit-on-error'],{input:database})
        dc(['run','--rm','-T','--no-deps','--entrypoint','find','maintenance','/app/storage','-mindepth','1','-delete'])
        dc(['run','--rm','-T','--no-deps','--entrypoint','tar','maintenance','-xf','-','-C','/app/storage'],{input:storage})
        assert.deepEqual(await snapshot(),saved.before)
        timeline.push({event:'backup-restore-completed',at:Date.now()})
      },
      advanceLegacyRevision:async()=>{
        const client=await login(),root='/api/v1/main/extensions/rbac',response=await client.request(root+'/policy');assert.equal(response.status,200);const policy=await response.json()
        const role=structuredClone(policy.policy.roles[0]);role.description+=' reviewed change'
        const result=await client.request(root+'/roles/'+encodeURIComponent(role.id),{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'"'+policy.revision+'"'},body:JSON.stringify(role)})
        assert.equal(result.status,200);await result.body?.cancel()
      },
      probeAccount:async(kind,{phase}={})=>{
        if(caseId==='migration-local-only-partial'&&phase==='new') {
          const before=state(await snapshot()),client=new ProductionOAuthClient(base)
          const trace=[],issued={jwt:false,code:false,token:false},errors=[]
          let submitted=false,response,url=new URL('/oauth/login/kestra',base)
          const request=async(path,options={})=>{
            const target=new URL(path,base);assert.equal(target.origin,base)
            let result
            try {result=await client.request(target,options)}catch {
              const error=new Error('local-only OAuth transport failed')
              error.partialEvidence={oauth:{trace:[...trace],errors:[...errors],issued:{...issued}},transportFailure:{path:target.pathname,status:null},failClosed:false}
              throw error
            }
            const location=result.headers.get('location'),next=location?new URL(location,base):null
            if(next)assert.equal(next.origin,base,'OAuth failure must stay on the isolated issuer origin')
            const error=next?.searchParams.get('error')
            const safeError=error&&/^(?:[a-z_]{1,80}|1)$/.test(error)?error:undefined
            if(safeError)errors.push({stage:target.pathname,error:safeError,status:result.status})
            if(next?.searchParams.has('code'))issued.code=true
            for(const value of result.headers.getSetCookie()) {
              const pair=value.split(';')[0],at=pair.indexOf('=')
              if(pair.slice(0,at)==='JWT'&&pair.slice(at+1)&&!/;\s*max-age=0(?:;|$)/i.test(value))issued.jwt=true
            }
            let protocolError
            if(result.headers.get('content-type')?.includes('application/json')) {
              const body=await result.clone().json()
              issued.token=issued.token||Boolean(body.access_token||body.refresh_token||body.id_token)
              if(typeof body.error==='string'&&/^[a-z_]{1,80}$/.test(body.error))protocolError=body.error
              if(protocolError)errors.push({stage:target.pathname,error:protocolError,status:result.status})
            }
            // Keep origin/path and parameter names. OAuth state, from and code
            // values are credentials/context and must never enter the report.
            const locationEvidence=next?{origin:next.origin,path:next.pathname,queryKeys:[...new Set(next.searchParams.keys())],...(safeError?{error:safeError}:{})}:null
            trace.push({stage:target.pathname==='/oidc/authorize'?'authorization':target.pathname==='/oidc/login'?'provider-login':target.pathname.startsWith('/oauth/callback/')?'callback':target.pathname==='/oidc/token'?'token':target.pathname.startsWith('/api/')?'protected-request':'ui-entry',method:options.method??'GET',path:target.pathname,status:result.status,location:locationEvidence,...(protocolError?{protocolError}:{})})
            return result
          }
          // Follow the production UI OAuth chain ourselves so a precise issuer
          // refusal is observable without ProductionOAuthClient.login asserting
          // that every login must succeed. No broad catch converts errors.
          for(let hop=0;hop<16;hop++) {
            if(url.pathname==='/oidc/login'&&!submitted) {
              submitted=true
              response=await request(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:planned.admin.username,password:planned.admin.password,from:url.searchParams.get('from')??''})})
            } else response=await request(url)
            const location=response.headers.get('location')
            await response.body?.cancel()
            if(![301,302,303,307,308].includes(response.status))break
            assert(location,'OAuth redirect missing location')
            url=new URL(location,base);assert.equal(url.origin,base)
            if(url.pathname==='/oidc/login'&&submitted){
              // Observe the final login page rather than re-submit credentials.
              const final=await request(url);await final.body?.cancel();break
            }
            assert(hop<15,'OAuth redirect loop')
          }
          const protectedPath='/api/v1/main/flows/search?namespace=scope.acceptance.a'
          const protectedResponse=await request(protectedPath)
          const protectedLocation=protectedResponse.headers.get('location'),next=protectedLocation?new URL(protectedLocation,base):null
          const protectedRequest={status:protectedResponse.status,loginRedirect:[302,303,307,308].includes(protectedResponse.status)&&next?.origin===base&&['/oauth/login/kestra','/oidc/login'].includes(next.pathname),location:trace.at(-1).location}
          await protectedResponse.body?.cancel()
          const after=state(await snapshot());assert.deepEqual(after,before,'partial OAuth failure changed policy/directory/business storage')
          const exactRefusal=errors.some(item=>['invalid_scope','invalid_grant'].includes(item.error)&&[302,303,307,308,400,401,403].includes(item.status))
          const directRefusal=trace.some(item=>['authorization','callback'].includes(item.stage)&&[401,403].includes(item.status))
          const failClosed=(exactRefusal||directRefusal)&&!issued.jwt&&!issued.code&&!issued.token&&trace.every(item=>item.status<500)&&Boolean(refused(protectedRequest.status)||protectedRequest.loginRedirect)
          const result={status:protectedRequest.status,protectedRequest,failClosed,oauth:{trace,errors,issued,newValidProjectCredentials:issued.jwt||issued.code||issued.token,tokenExchange:'server-side-not-observable'},sideEffectsSha256:after.effects.sha256}
          if(!failClosed){const error=new Error('local-only production OAuth refusal did not match frozen failure contract');error.partialEvidence=result;throw error}
          return result
        }
        const account=kind==='subject'&&['legacy','new'].includes(phase)&&noScopeCase?subjectAccount:planned.admin
        const {client,identity}=await loginIdentity(account,phase==='new'?'new':'legacy')
        if(kind==='role')assert(Array.isArray(identity.roles)&&identity.roles.length>0,'signed role claim is required; username is not role evidence')
        const before=await snapshot()
        const response=await client.request('/api/v1/main/flows/scope.acceptance.a/migration-in-range');const status=response.status;await response.body?.cancel()
        const list=await client.request('/api/v1/main/flows/search?filters[namespace][PREFIX]=scope.acceptance.a&size=100')
        const outside=await client.request('/api/v1/main/flows/scope.acceptance.outside/migration-outside');const outsideStatus=outside.status;await outside.body?.cancel()
        let authorizedIds
        if(phase!=='new') {
          assert.equal(status,200);assert.equal(list.status,200);const value=await list.json();authorizedIds=value.results.map(item=>item.namespace+'/'+item.id).sort()
          assert.deepEqual(authorizedIds,['scope.acceptance.a.child/migration-child','scope.acceptance.a/migration-in-range']);assert.equal(value.total,2)
          if(noScopeCase)assert.equal(outsideStatus,403,'legacy role/subject must not cross its namespace')
        } else {assert.equal(list.status,status);await list.body?.cancel();assert.equal(outsideStatus,status)}
        const current=await snapshot();assert.deepEqual(current,before,'account probe changed policy, directory or business state')
        return {status,identity,authorizedIds,outsideStatus,sideEffectsSha256:current.effects.sha256,sources:['database','queue','storage']}
      },
      probeLegacyWrites:async()=>{
        const {client,identity}=await loginIdentity(planned.admin,'new')
        assert(identity.projectScopes.includes(scopeNames.policyManager));assert(identity.projectScopes.includes(scopeNames.identityManager))
        // Prove this caller can reach both management domains before checking
        // tombstones; a zero-grant identity or an authentication failure is not 410.
        for(const path of ['/api/v1/main/extensions/rbac/projects/kestra','/api/v1/main/extensions/rbac/identity/projects/kestra']) {
          const response=await client.request(path)
          if(response.status!==200){const body=await response.json().catch(()=>null);const recovery=await client.request('/api/v1/main/extensions/rbac/projects/kestra/reconciliation');const projection=await recovery.json().catch(()=>null);throw new Error('Migration manager baseline failed: '+JSON.stringify({path,status:response.status,code:body?.code,identity,recoveryStatus:recovery.status,localDirectoryRevision:projection?.project?.directoryRevision,currentDirectoryRevision:projection?.directoryRevision}))}
          await response.body?.cancel()
        }
        const before=state(await snapshot()),actual=[]
        const bodies={roles:{id:'migration-reader',name:'Changed old role',description:'Must never persist',grants:[]},bindings:{subject:subjectAccount.subject,roles:['migration-reader']},'role-mappings':{trustedRole:'admin',roles:['migration-reader']}}
        for(const item of legacyWriteEndpoints) {
          const key=item.path.includes('/role-mappings')?'role-mappings':item.path.endsWith('/bindings')?'bindings':'roles'
          const response=await client.request(item.path,{method:item.method,headers:{'Content-Type':'application/json','If-Match':'"'+before.local.revision+'"'},...(item.method==='DELETE'?{}:{body:JSON.stringify(bodies[key])})})
          assert.equal(response.status,410,'authentication/authorization denial is not legacy endpoint removal')
          const body=await response.json();assert.equal(body.code??body.error?.code,'legacy_policy_api_removed')
          actual.push({method:item.method,path:item.path,status:response.status})
          assert.deepEqual(state(await snapshot()),before,'removed endpoint changed full policy, directory or business state')
        }
        return actual
      },
      prepareLegacy:async()=>{
        dc(['stop','kestra'])
        const grant={scope:'NAMESPACE',tenant:'main',namespace:'scope.acceptance.a',descendants:true,resource:'FLOW',actions:['READ','LIST'],ids:[],allIds:true}
        const legacy={schemaVersion:1,roles:[{id:'migration-reader',name:'Migration reader',description:'Original isolated input',grants:[grant]}],subjects:{[planned.admin.subject]:['migration-reader']},roleMapping:{'migration-trusted':['migration-reader']}}
        const path=write('legacy-policy.json',legacy)
        const result=cli('io.kestra.extensions.rbac.store.PolicyImportCommand',['initialize',path],{legacy:true});assert.equal(result.exitCode,0)
        const id=dc(['run','--rm','-T','--no-deps','--entrypoint','cat','maintenance','/app/storage/.oidc-installation']).stdout.match(/^kestra-oidc-installation-v1\n([a-f0-9-]{36})$/i)?.[1];assert(id)
        const directoryPlan=directoryActivationPlan(planned,id)
        const target=planned.policy
        // The isolated manager is granted shared management scopes but the local
        // migration-reader permission is an explicit MAP, never a subject bypass.
        const scope='kestra:acceptance:migration-reader'
        target.applicationProjects.kestra.scopes[scope]={description:'Explicit migrated read grant',enabled:true,grants:[grant],managementGrants:[]}
        directoryPlan.projects[0].scopes.push({projectId:'kestra',scope,description:'Explicit migrated read grant',active:true,resourceIntents:[{vocabularyVersion:'kestra-resources-v1',resourceType:'FLOW',namespaces:{kind:'RESTRICTED',exact:[],subtrees:['scope.acceptance.a']},resourceIds:{kind:'ALL',ids:[]},actions:['READ','LIST']}],managementIntents:[],revision:1})
        directoryPlan.projects[0].memberships[0].allowedProjectScopes.push(scope)
        legacyPolicyActive=true;use('legacy')
        dc(['up','-d','kestra']);await wait()
        const admin=await login(),root='/api/v1/main/extensions/rbac'
        for(const [namespace,id]of [['scope.acceptance.a','migration-in-range'],['scope.acceptance.a.child','migration-child'],['scope.acceptance.outside','migration-outside']]) {
          const response=await admin.request('/api/v1/main/flows',{method:'POST',headers:{'Content-Type':'application/x-yaml'},body:flowSource(namespace,id)})
          assert([200,201].includes(response.status),'legacy migration data must actually be saved');await response.body?.cancel()
        }
        if(noScopeCase) {
          for(const account of [subjectAccount,managerAccount]) {
            const response=await admin.request(root+'/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:account.username,name:'Isolated migration account',email:account.username+'@example.invalid',password:account.password})})
            assert.equal(response.status,201);const user=await response.json();assert.equal(user.subject,account.subject);assert.equal(user.active,true)
          }
          const sourceIdentity=await loginIdentity(planned.admin,'legacy')
          assert(Array.isArray(sourceIdentity.identity.roles)&&sourceIdentity.identity.roles.length>0)
          const mutate=async(path,body)=>{
            const current=await admin.request(root+'/policy');assert.equal(current.status,200);const policy=await current.json()
            const response=await admin.request(root+path,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':'"'+policy.revision+'"'},body:JSON.stringify(body)})
            assert.equal(response.status,200);await response.body?.cancel()
          }
          await mutate('/bindings',{subject:subjectAccount.subject,roles:['migration-reader']})
          // Actual signed roles, never an inferred role from an account name.
          for(const trustedRole of sourceIdentity.identity.roles)await mutate('/role-mappings',{trustedRole,roles:['migration-reader']})
          await mutate('/bindings',{subject:planned.admin.subject,roles:[]})
          // Separate new manager retains management; both migration identities
          // have explicit empty assignments and receive no business scope.
          directoryPlan.projects[0].assignments[0].subject=managerAccount.subject
          for(const account of [subjectAccount,planned.admin])directoryPlan.projects[0].assignments.push({projectId:'kestra',issuer:base,subject:account.subject,projectScopes:[],revision:1,authorizationVersion:1})
        }
        legacyRoleMappingOnly=caseId==='migration-legacy-role-no-scope';use('legacy');dc(['up','-d','kestra']);await wait();inspect()
        const deadline=Date.now()+60000;let previous=(await snapshot()).effects.sha256,stableAt=Date.now()
        for(;;){await new Promise(resolve=>setTimeout(resolve,250));const next=(await snapshot()).effects.sha256;if(next!==previous){previous=next;stableAt=Date.now()}if(Date.now()-stableAt>=5000)break;assert(Date.now()<deadline,'migration source business state did not become stable')}
        return {target,directoryPlan,decisions:[{roleId:'migration-reader',disposition:'MAP',targets:[{project:'kestra',scope}],reason:'Explicit isolated read-only migration test'}]}
      },
      destroy:async()=>{inspect();try{dc(['down','--volumes','--remove-orphans'])}finally{credentialHandles.clear();backups.clear()}},
    }
    try {
      dc(['pull','kestra','maintenance']);dc(['up','-d']);await wait();inspect()
      const id=dc(['ps','-q','kestra']).stdout
      assert.equal(run('docker',['exec',id,'sha256sum','/app/kestra']).split(/\s+/)[0],verified.legacy.hostSha256)
      await login()
      dc(['stop','kestra'])
      use('target');host.environment.KESTRA_CONFIGURATION=applicationProjectFeature(newConfiguration,false);save()
      dc(['up','-d','kestra']);await wait();inspect()
      assert.equal(run('docker',['exec',dc(['ps','-q','kestra']).stdout,'sha256sum','/app/kestra']).split(/\s+/)[0],verified.target.hostSha256)
      assert(exists('oidc_project_state'),'published host migration must prepare the identity directory before CLI use')
      timeline.push({event:'target-identity-schema-prepared',at:Date.now(),featureEnabled:false,hostImage:verified.target.host.image})
      dc(['stop','kestra']);use('legacy');dc(['up','-d','kestra']);await wait();inspect();await login()
      return instance
    } catch {
      // Failed create must clean its own resources; no caller receives an env.
      const ids=dc(['ps','--all','-q']).stdout.split('\n').filter(Boolean)
      for(const id of ids)assert.equal(json('docker',['inspect',id])[0].Config.Labels['com.docker.compose.project'],project)
      for(const volume of Object.values(config.volumes))if(exec('docker',['volume','inspect',volume.name],{allowFailure:true}).exitCode===0)assert.equal(json('docker',['volume','inspect',volume.name])[0].Labels['com.docker.compose.project'],project)
      dc(['down','--volumes','--remove-orphans'])
      throw new Error('isolated migration source setup failed; no credential output retained')
    }
  }
  return context
}

/** 可独立调用的真实备份恢复演练。它只证明隔离数据库/存储恢复，不代替
 * requiredProjectChecks 的 migration-backup-rollback 六类新凭据回退测试。
 * await runMigrationStorageRecovery(context, record)
 */
export async function runMigrationStorageRecovery(context,record) {
  assert.equal(typeof record,'function')
  const row={id:'storage-backup-restore-roundtrip',passed:false,status:'not_run',evidence:{}}
  let env
  await record(structuredClone(row))
  try {
    releaseGate(context?.release);assert.equal(typeof context.create,'function')
  } catch {row.evidence.reason='verified target and legacy CI artifacts unavailable';await record(structuredClone(row));return row}
  try {
    env=await context.create({caseId:'migration-preview-explicit-approval'})
    const input=await env.prepareLegacy();await env.compose('stop')
    const before=state(await env.snapshot()),review=await preview(env,input),backup=await env.backup()
    for(const field of ['policySha256','identitySha256','installationSha256','archiveSha256'])sha(backup[field])
    assert.equal(backup.policySha256,before.legacy.sha256);assert.equal(backup.installationSha256,before.installation.sha256)
    row.status='running';row.evidence={before,backup:Object.fromEntries(['policySha256','identitySha256','installationSha256','archiveSha256'].map(key=>[key,backup[key]]))};await record(structuredClone(row))
    await applyIdentity(env,input);await applyLocal(env,review)
    const changed=state(await env.snapshot());assert.equal(changed.local.sha256,review.hashes.storedTargetSha256);assert.notEqual(changed.directory.sha256,before.directory.sha256)
    await env.restore(backup.handle)
    const restored=state(await env.snapshot());assert.deepEqual(restored,before)
    await env.compose('start-legacy');const login=await env.probeAccount('subject',{phase:'rollback'});assert.equal(login.status,200)
    assert.equal((await env.snapshot()).effects.sha256,before.effects.sha256)
    row.evidence.changed=changed;row.evidence.restored=restored;row.evidence.restoredLoginStatus=login.status
    row.status='passed';row.passed=true
  } catch {row.status='failed';row.passed=false;row.evidence.failure='isolated backup/restore operation or assertion failed'}
  finally {
    if(env)try{await env.assertOwned();await env.destroy()}catch{row.status='failed';row.passed=false;row.evidence.cleanupFailed=true}
    await record(structuredClone(row))
  }
  return row
}
