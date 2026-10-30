import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash,randomBytes} from 'node:crypto'
import {applicationProject} from './application-project-cases.mjs'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {permissionInput,runAccessControlFrozenUi,sanitizeUiEvidence} from './access-control-v3-ui.mjs'

const api='/api/v1/main/extensions/rbac'
const sort=value=>[...value].sort()
const profile=value=>value==='—'?'':value??''
const equalKeys=(items,expected,field)=>assert.deepEqual(sort(items.map(item=>item[field])),sort(expected),'frozen '+field+' set differs')

export function frozenBaselinePlan(planned,{prototypeSource,requirementsSource,applicationGroupId=applicationProject}={}) {
  prototypeSource??=readFileSync(new URL('../docs/prototype-application-groups.html',import.meta.url),'utf8')
  requirementsSource??=readFileSync(new URL('../docs/access-control-ui-requirements.md',import.meta.url),'utf8')
  const hash=createHash('sha256').update(prototypeSource).digest('hex')
  const frozenHash=requirementsSource.match(/当前冻结文件 SHA-256：\s*`([0-9a-f]{64})`/)
  assert(frozenHash,'reviewed prototype hash missing');assert.equal(hash,frozenHash[1],'prototype differs from reviewed frozen input')
  const match=prototypeSource.match(/const DATA\s*=\s*(\{.*?\});/s);assert(match,'prototype DATA missing')
  const data=JSON.parse(match[1])
  assert.equal(data.userDirectory.length,22);assert.equal(new Set(data.userDirectory).size,22)
  assert.equal(data.scopes.length,19);assert.equal(Object.keys(data.declarations).length,19)
  assert.equal(data.groups.length,1);assert.equal(data.user.subject,'admin')
  assert.equal(planned.admin.subject,planned.admin.username)
  assert.notEqual(planned.admin.subject,data.user.subject,'prototype admin role must map to the separate bootstrap manager account')
  assert(data.userDirectory.includes(planned.admin.subject),'bootstrap subject must retain its own frozen directory entry')
  const accounts=[...Object.values(planned.accounts),...Object.values(planned.mcpAccounts)]
  assert.equal(accounts.length,20);assert.equal(new Set(accounts.map(account=>account.subject)).size,20)
  for(const account of accounts){assert.equal(account.username,account.subject);assert(data.userDirectory.includes(account.subject));assert.notEqual(account.subject,planned.admin.subject)}
  const users=data.userDirectory.map(subject=>({subject,name:profile(data.userMeta[subject].name),email:profile(data.userMeta[subject].email)}))
  const expected={scopes:data.scopes.map(({key,name,description})=>({key,name,description})),permissions:data.scopes.map(scope=>({...data.declarations[scope.key],scopeKeys:[scope.key]})),users,subjects:[{issuer:planned.base,subject:planned.admin.subject,scopeKeys:[...data.user.scopes]}],bootstrapMapping:{prototypeSubject:'admin',runtimeSubject:planned.admin.subject,roleOnly:true},userSubjectMapping:data.userDirectory.map(subject=>({prototypeSubject:subject,runtimeSubject:subject})),groupMapping:{prototypeKey:data.groups[0].key,runtimeId:applicationGroupId}}
  assert.equal(new Set(expected.permissions.map(permission=>permission.key)).size,19)
  return {prototypeSha256:hash,applicationGroupId,currentApplicationClientId:data.app.clientId,expected}
}

export async function prepareFrozenBaseline(planned,management,{record=async()=>{},...options}={}) {
  assert.equal(management.base,planned.base);assert.equal(management.account.subject,planned.admin.subject)
  const plan=frozenBaselinePlan(planned,options),groupPath=management.groupPath(plan.applicationGroupId)
  const secrets=[planned.admin.password,...Object.values(planned.accounts).map(account=>account.password),...Object.values(planned.mcpAccounts).map(account=>account.password)]
  const report={source:'production-api-before-rest-mcp-grants',phase:'before-rest-mcp-grants',completed:false,status:'running',prototypeSha256:plan.prototypeSha256,groupMapping:plan.expected.groupMapping,bootstrapMapping:plan.expected.bootstrapMapping,userSubjectMapping:plan.expected.userSubjectMapping,events:[]}
  const preparedAccounts={}
  const requestOffset=management.requests.length
  const persist=()=>record(sanitizeUiEvidence({...structuredClone(report),requests:management.requests.slice(requestOffset)},secrets))
  const list=async path=>{
    const result=await management.request(path+'?page=1&size=100')
    assert(Array.isArray(result.items));assert.equal(result.total,result.items.length,'frozen preparation requires complete unfiltered collection')
    return result.items
  }
  await persist()
  try {
    await management.login()
    equalKeys(await list(api+'/application-groups'),[plan.applicationGroupId],'id')
    const group=await management.request(groupPath)
    assert.equal(group.id,plan.applicationGroupId)
    const grants=await list(groupPath+'/scope-grants')
    assert.equal(grants.length,1,'frozen phase must precede REST/MCP grants')
    assert.equal(grants[0].subject,planned.admin.subject);assert.equal(grants[0].issuer,planned.base)
    assert.deepEqual(sort(grants[0].scopeKeys),sort(plan.expected.subjects[0].scopeKeys))
    const scopes=await list(groupPath+'/scopes');equalKeys(scopes,plan.expected.scopes.map(scope=>scope.key),'key')
    const applications=await list(groupPath+'/applications');equalKeys(applications,[plan.currentApplicationClientId],'clientId')
    const permissions=await management.readPermissions(plan.applicationGroupId,plan.currentApplicationClientId)
    equalKeys(permissions.items,plan.expected.permissions.map(permission=>permission.key),'key')
    const existing=await list(api+'/users');equalKeys(existing,[planned.admin.subject],'subject')
    for(const scope of plan.expected.scopes) {
      const current=await management.request(groupPath+'/scopes/'+encodeURIComponent(scope.key))
      if(current.name!==scope.name||current.description!==scope.description){await management.reauthenticateGroup(plan.applicationGroupId);await management.request(groupPath+'/scopes/'+encodeURIComponent(scope.key),'PUT',scope,current.revision)}
    }
    for(const expected of plan.expected.permissions) {
      const current=(await management.readPermissions(plan.applicationGroupId,plan.currentApplicationClientId)).items.find(permission=>permission.key===expected.key)
      assert.deepEqual(sort(current.scopeKeys),sort(expected.scopeKeys),'frozen permission support differs')
      if(current.name!==expected.name){await management.reauthenticateGroup(plan.applicationGroupId);await management.request(management.permissionsPath(plan.applicationGroupId,plan.currentApplicationClientId)+'/'+encodeURIComponent(current.key),'PUT',permissionInput({...current,name:expected.name}),current.revision)}
    }
    const plannedAccounts=new Map([planned.admin,...Object.values(planned.accounts),...Object.values(planned.mcpAccounts)].map(account=>[account.subject,account]))
    for(const user of plan.expected.users) {
      const account=plannedAccounts.get(user.subject)??{username:user.subject,subject:user.subject,password:randomBytes(24).toString('base64url')+'Aa1!'}
      secrets.push(account.password)
      let passwordPreparation
      await management.login()
      if(user.subject!==planned.admin.subject) {
        const receipt=await management.request(api+'/users','POST',{username:account.username,name:user.name,email:user.email})
        assert.equal(receipt.subject,account.subject);assert.equal(typeof receipt.temporaryPassword,'string');assert(receipt.temporaryPassword.length)
        secrets.push(receipt.temporaryPassword)
        passwordPreparation=await new ProductionOAuthClient(planned.base).changeTemporaryPassword(account.username,receipt.temporaryPassword,account.password)
        delete receipt.temporaryPassword
      }
      await management.login()
      let saved=await management.request(api+'/users/detail?subject='+encodeURIComponent(user.subject))
      if(saved.name!==user.name||saved.email!==user.email) {
        await management.reauthenticateGroup(plan.applicationGroupId)
        await management.request(api+'/users/profile','PUT',user,saved.revision)
        saved=await management.request(api+'/users/detail?subject='+encodeURIComponent(user.subject))
      }
      assert.equal(saved.subject,user.subject);assert.equal(saved.name??'',user.name);assert.equal(saved.email??'',user.email);assert.equal(saved.active,true)
      const client=new ProductionOAuthClient(planned.base),login=await client.login(account.username,account.password)
      assert.equal(login.authenticated,true,'frozen account normal login failed')
      preparedAccounts[user.subject]={...account,verified:true,passwordChangeCompleted:user.subject!==planned.admin.subject,revision:saved.revision}
      report.events.push({kind:'frozen-account-verified',subject:user.subject,bootstrap:user.subject===planned.admin.subject,...(passwordPreparation?{passwordPreparation}: {})})
      await persist()
    }
    await management.login()
    const finalUsers=await list(api+'/users');equalKeys(finalUsers,plan.expected.users.map(user=>user.subject),'subject')
    for(const expected of plan.expected.users) {
      const user=finalUsers.find(item=>item.subject===expected.subject)
      assert.equal(user.name??'',expected.name);assert.equal(user.email??'',expected.email)
    }
    const finalScopes=await list(groupPath+'/scopes')
    for(const expected of plan.expected.scopes) {
      const scope=finalScopes.find(item=>item.key===expected.key);assert(scope)
      assert.equal(scope.name,expected.name);assert.equal(scope.description,expected.description)
    }
    const finalPermissions=await management.readPermissions(plan.applicationGroupId,plan.currentApplicationClientId)
    for(const expected of plan.expected.permissions) {
      const permission=finalPermissions.items.find(item=>item.key===expected.key);assert(permission)
      assert.equal(permission.name,expected.name);assert.deepEqual(sort(permission.scopeKeys),sort(expected.scopeKeys))
    }
    const finalGrants=await list(groupPath+'/scope-grants');assert.equal(finalGrants.length,1);assert.equal(finalGrants[0].subject,planned.admin.subject);assert.deepEqual(sort(finalGrants[0].scopeKeys),sort(grants[0].scopeKeys))
    const finalGroup=await management.request(groupPath)
    assert.equal(finalGroup.displayName,group.displayName,'installed group must not be renamed')
    assert.deepEqual(finalGroup.counts,{scopes:19,applications:1,subjects:1})
    Object.assign(report,{completed:true,status:'passed',counts:{users:22,scopes:19,permissions:19,subjects:1},browserVerified:false})
  }catch(error){report.status='failed';report.error=String(error.message);throw error}
  finally{await persist()}
  return {...plan,admin:planned.admin,preparedAccounts,evidence:sanitizeUiEvidence(report,secrets)}
}

export async function runPreparedFrozenBaselineUi(adapter,base,prepared,record) {
  assert(prepared.evidence?.completed&&prepared.evidence.status==='passed','early production preparation required')
  assert.equal(base,new URL(prepared.expected.subjects[0].issuer).origin)
  return runAccessControlFrozenUi(adapter,base,prepared,record)
}
