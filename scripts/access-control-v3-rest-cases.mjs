import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {applicationProject,namespaceDomains} from './application-project-cases.mjs'

export const accessControlV3RestCheckIds=Object.freeze([
  'access-control-v3-rest-fixture',
  'access-control-v3-T3-rest-support-union',
  'access-control-v3-T3-rest-metadata-old-session',
  'access-control-v3-T3-rest-enabled-support',
  'access-control-v3-T3-rest-typed-business',
  'access-control-v3-T3-rest-external-isolation',
  'access-control-v3-T9-rest-domain-matrix',
  'access-control-v3-T9-rest-manage-only-receipts',
  'access-control-v3-T9-rest-dual-domain-support',
  'access-control-v3-T9-rest-reference-redaction',
  'access-control-v3-T9-rest-zero-scope',
])

export function permissionWriteBody(permission) {
  assert(['kestra-policy','external-declaration'].includes(permission.implementationKind),'unknown permission implementation kind')
  const fields=['key','name','description','scopeKeys',...(permission.implementationKind==='external-declaration'?['details']:['enabled','grants','managementGrants'])]
  const input=Object.fromEntries(fields.map(field=>[field,structuredClone(permission[field])]))
  if(input.grants)input.grants=input.grants.map(grant=>grant.scope==='TENANT'&&grant.namespace===undefined?{...grant,namespace:null}:grant)
  return input
}

export function assertMutationReceipt(value,identifier,expected) {
  assert.deepEqual(Object.keys(value).sort(),[identifier,'parentRevision','revision'].sort(),'MANAGE response leaked content or omitted a precise receipt')
  assert.equal(value[identifier],expected)
  for(const field of ['revision','parentRevision'])assert(Number.isSafeInteger(value[field])&&value[field]>0)
}

export async function readPermissionPages(get,client,path,size=25) {
  const items=[];let total,parentRevision
  for(let page=1;;page++) {
    const value=await get(client,path+'?page='+page+'&size='+size)
    assert(Array.isArray(value.items)&&Number.isSafeInteger(value.total)&&value.total>=0)
    assert(Number.isSafeInteger(value.parentRevision)&&value.parentRevision>0)
    total??=value.total;parentRevision??=value.parentRevision
    assert.equal(value.total,total);assert.equal(value.parentRevision,parentRevision,'permission snapshot drift')
    for(const item of value.items) {
      assert(typeof item.key==='string'&&/^[a-z][a-z0-9-]{0,127}$/.test(item.key))
      assert(Number.isSafeInteger(item.revision)&&item.revision>0)
      assert.equal(item.parentRevision,parentRevision);assert(Array.isArray(item.scopeKeys))
    }
    items.push(...value.items);assert(items.length<=total)
    if(items.length===total)break
    assert(value.items.length&&page<1000,'permission pagination stalled')
  }
  assert.equal(new Set(items.map(item=>item.key)).size,items.length,'duplicate permission keys across pages')
  return {items,total,parentRevision}
}

export async function runAccessControlV3RestCases(base,context) {
  const {check,step,request,get,deny,login,manager,restore,quiesceBusiness,management,planned,passwords,Unavailable}=context
  const api='/api/v1/main/extensions/rbac',group=api+'/application-groups/'+encodeURIComponent(applicationProject)
  const application=management.applicationPath(applicationProject),permissions=management.permissionsPath(applicationProject)
  const suffix=randomBytes(5).toString('hex'),prefix='v3-'+suffix+'-'
  const scopes={first:prefix+'first',second:prefix+'second',empty:prefix+'empty'}
  const actors={},createdScopes=[],createdPermissions=[],createdAccounts=[]
  const businessA='/api/v1/main/flows/'+encodeURIComponent(namespaceDomains.a)+'/allowed-id'
  const businessB='/api/v1/main/flows/'+encodeURIComponent(namespaceDomains.b)+'/other-id'
  const sourceType={contentType:'application/x-yaml'}
  const same=(actual,expected)=>assert.deepEqual([...actual].sort(),[...expected].sort())
  const deniedBody=(value,path)=>{
    if(typeof value.code==='string')assert.deepEqual(Object.keys(value),['code'])
    else {
      assert.deepEqual(Object.keys(value).sort(),['detail','instance','status','title','type'])
      assert.equal(value.status,403);assert.equal(value.instance,new URL(path,base).pathname)
      assert.equal(value.type,'https://kestra.io/docs/api-reference/problems/forbidden')
      assert.equal(typeof value.title,'string');assert.equal(typeof value.detail,'string')
    }
  }
  const grant=(namespace,actions=['READ','LIST','UPDATE'])=>({scope:'NAMESPACE',tenant:'main',namespace,descendants:false,resource:'FLOW',actions,ids:[],allIds:true})
  const managementGrant=(domain,actions)=>({domain,actions,applicationGroupIds:domain==='IDENTITY'?[]:[applicationProject]})
  const specs={
    identityRead:[managementGrant('IDENTITY',['READ'])],identityManage:[managementGrant('IDENTITY',['MANAGE'])],
    policyRead:[managementGrant('LOCAL_POLICY',['READ'])],policyManage:[managementGrant('LOCAL_POLICY',['MANAGE'])],
    bothManage:[managementGrant('IDENTITY',['MANAGE']),managementGrant('LOCAL_POLICY',['MANAGE'])],
    identityReadManage:[managementGrant('IDENTITY',['READ','MANAGE'])],
    identityManagePolicyRead:[managementGrant('IDENTITY',['MANAGE']),managementGrant('LOCAL_POLICY',['READ'])],
    business:[],union:[],external:[],zero:[],
  }
  let ready=false,externalClientId,externalPath,externalPermission,originalSource
  const firstKey=prefix+'p1',secondKey=prefix+'p2',emptyKey=prefix+'empty'
  const current=async(key,path=permissions)=>get(await manager(),path+'/'+key)
  const put=async(key,changes,client,path=permissions)=>{
    const before=await current(key,path),input={...permissionWriteBody(before),...structuredClone(changes)}
    const result=await request(client??await manager(),path+'/'+key,'PUT',input,before.revision)
    assert.equal(result.status,200);assertMutationReceipt(result.value,'key',key);assert(result.value.revision>before.revision)
    const after=await current(key,path)
    const comparable=value=>Array.isArray(value)?value.map(comparable).sort((left,right)=>JSON.stringify(left).localeCompare(JSON.stringify(right))):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(field=>[field,comparable(value[field])])):value
    assert.deepEqual(comparable(permissionWriteBody(after)),comparable(input));assert.equal(after.revision,result.value.revision)
    return after
  }
  const create=async(input)=>{
    createdPermissions.push(input.key)
    const parent=await get(await manager(),application),response=await request(await manager(),permissions,'POST',input,parent.revision)
    assert.equal(response.status,200);assertMutationReceipt(response.value,'key',input.key)
    return current(input.key)
  }
  const supported=async()=>{
    const view=await get(await manager(),application),snapshot=await readPermissionPages(get,await manager(),permissions)
    same(view.supportedScopeKeys,[...new Set(snapshot.items.flatMap(item=>item.scopeKeys))])
    return view.supportedScopeKeys
  }
  const epoch=async()=>(await get(await manager(),group)).authorizationVersion
  const actor=async name=>login(actors[name],'v3-rest-'+name)
  async function boundedStatus(client,path,status,label) {
    const start=performance.now(),samples=[]
    do {
      const result=await request(client,path);samples.push({elapsedMs:Math.ceil(performance.now()-start),status:result.status})
      if(result.status===status){await step(label,{boundMs:60000,samples,oldSession:true});assert(samples.at(-1).elapsedMs<=60000);return}
      assert([200,401,403].includes(result.status),'infrastructure failure cannot prove a policy transition')
      await new Promise(resolve=>setTimeout(resolve,100))
    }while(performance.now()-start<60000)
    await step(label,{boundMs:60000,samples,oldSession:true});assert.fail(label+' exceeded 60 seconds')
  }
  const run=async(id,operation)=>check(id,async()=>{
    await step('rest-submatrix-boundary',{gate:id.includes('-T3-')?'T3':'T9',layer:'rest',scope:'rest-submatrix',finalGateVerdict:false})
    if(!ready)throw new Unavailable('v3 REST fixture failed; no substitute assertions')
    await operation()
  })
  try {
    await check('access-control-v3-rest-fixture',async()=>{
      for(const name of [...Object.values(scopes),...Object.keys(specs).filter(name=>!['business','union','external','zero'].includes(name)).map(name=>prefix+name.toLowerCase())]) {
        createdScopes.push(name)
        const parent=await get(await manager(),group)
        await management.mutateDirectory(group+'/scopes','POST',{key:name,name:'REST '+name,description:'Isolated v3 REST security scope'},parent.revision)
      }
      const typed=(key,scopeKeys,grants=[],managementGrants=[])=>({key,name:'REST '+key,description:'',scopeKeys,enabled:true,grants,managementGrants})
      await create(typed(firstKey,[scopes.first,scopes.second],[grant(namespaceDomains.a)]))
      await create(typed(secondKey,[scopes.second],[grant(namespaceDomains.a,['READ','LIST'])]))
      await create(typed(emptyKey,[scopes.empty]))
      for(const [name,grants]of Object.entries(specs)) {
        const username=prefix+name.toLowerCase(),account={username,subject:username,password:randomBytes(24).toString('base64url')+'aA1!'}
        passwords.push(account.password);actors[name]=account;createdAccounts.push(account)
        const response=await request(await manager(),api+'/users','POST',{username,name:'REST '+name,email:username+'@acceptance.invalid'})
        assert.equal(response.status,201);assert.equal(response.value.subject,username)
        assert.deepEqual(Object.keys(response.value).sort(),['revision','subject','temporaryPassword'])
        assert(response.value.temporaryPassword);passwords.push(response.value.temporaryPassword)
        await new ProductionOAuthClient(base).changeTemporaryPassword(username,response.value.temporaryPassword,account.password)
        response.value.temporaryPassword=undefined
        let scopeKeys=[]
        if(name==='business')scopeKeys=[scopes.first]
        else if(name==='union')scopeKeys=[scopes.first,scopes.second]
        else if(name==='external')scopeKeys=[scopes.empty]
        else if(name!=='zero') {
          const scopeKey=prefix+name.toLowerCase();scopeKeys=[scopeKey]
          await create(typed(prefix+name.toLowerCase(),scopeKeys,[],grants))
        }
        const parent=await get(await manager(),group)
        await management.mutateDirectory(group+'/scope-grants','POST',{issuer:base,subject:account.subject,scopeKeys},parent.revision)
      }
      const externalOwner=await actor('external'),protocol=['openid','mcp:flows:read']
      await externalOwner.issueMcpScopes([...protocol,scopes.empty],async registration=>{
        externalClientId=registration.clientId;externalPath=management.permissionsPath(applicationProject,externalClientId)
        await management.registerOrdinaryClient({clientId:externalClientId,audiences:registration.audiences,applicationGroupScopes:[scopes.empty],registeredProtocolScopes:protocol,requestedProtocolScopes:protocol})
      },async client=>client.login(actors.external.username,actors.external.password))
      const externalSnapshot=await readPermissionPages(get,await manager(),externalPath)
      assert.equal(externalSnapshot.total,1);externalPermission=externalSnapshot.items[0].key
      const typedSnapshot=await readPermissionPages(get,await manager(),permissions)
      assert(typedSnapshot.total>25,'v3 fixture must exercise multiple permission pages, not a truncated first page')
      originalSource=await get(await manager(),businessA+'?source=true');assert(originalSource.source)
      ready=true
      await step('http-accounts-prepared',{accountCount:createdAccounts.length,temporaryPasswordChangedViaHttp:true,realUiForcedPasswordChangeTested:false,scopeCount:createdScopes.length,permissionCount:typedSnapshot.total,externalClientId})
    })

    await run('access-control-v3-T3-rest-support-union',async()=>{
      const client=await actor('union'),beforeEpoch=await epoch(),beforeSupport=await supported()
      assert(beforeSupport.includes(scopes.first)&&beforeSupport.includes(scopes.second))
      const identity=await client.verifiedUiIdentity({applicationGroupId:applicationProject,subject:actors.union.subject,audience:planned.expectedAudience})
      same(identity.applicationGroupScopes,[scopes.first,scopes.second]);assert.equal((await request(client,businessA)).status,200)
      try {
        await put(firstKey,{scopeKeys:[scopes.first]})
        same(await supported(),beforeSupport);assert.equal(await epoch(),beforeEpoch)
        assert.equal((await request(client,businessA)).status,200,'non-last relationship removal revoked the old session')
        const second=await current(secondKey)
        const revokedAt=performance.now()
        const deletion=await request(await manager(),permissions+'/'+secondKey,'DELETE',undefined,second.revision)
        assert.equal(deletion.status,200);assertMutationReceipt(deletion.value,'key',secondKey)
        assert.equal((await request(await manager(),permissions+'/'+secondKey)).status,404)
        assert(!(await supported()).includes(scopes.second));assert((await epoch())>beforeEpoch)
        await create({...permissionWriteBody(second),scopeKeys:[]})
        const empty=await current(secondKey);same(empty.scopeKeys,[]);assert.equal(empty.enabled,true)
        const start=revokedAt,samples=[]
        do {
          const result=await request(client,businessA);samples.push({elapsedMs:Math.ceil(performance.now()-start),status:result.status})
          if([401,403].includes(result.status))break
          assert.equal(result.status,200);await new Promise(resolve=>setTimeout(resolve,100))
        }while(performance.now()-start<60000)
        await step('last-reference-revokes-old-session',{samples,boundMs:60000})
        assert([401,403].includes(samples.at(-1).status)&&samples.at(-1).elapsedMs<=60000)
        await deny(client,businessA,'GET',undefined,undefined,{statuses:[401,403]})
        const fresh=await actor('union'),nextIdentity=await fresh.verifiedUiIdentity({applicationGroupId:applicationProject,subject:actors.union.subject,audience:planned.expectedAudience})
        same(nextIdentity.applicationGroupScopes,[scopes.first]);assert.equal((await request(fresh,businessA)).status,200)
      }finally{await restore('v3-support-relations',async()=>{
        await put(firstKey,{scopeKeys:[scopes.first,scopes.second]})
        const existing=await request(await manager(),permissions+'/'+secondKey)
        if(existing.status===404)await create({key:secondKey,name:'REST '+secondKey,description:'',scopeKeys:[scopes.second],enabled:true,grants:[grant(namespaceDomains.a,['READ','LIST'])],managementGrants:[]})
        else {assert.equal(existing.status,200);await put(secondKey,{scopeKeys:[scopes.second]})}
        same(await supported(),beforeSupport)
      })}
    })

    await run('access-control-v3-T3-rest-metadata-old-session',async()=>{
      const client=await actor('business'),beforeEpoch=await epoch(),before=await current(firstKey),beforeSupport=await supported()
      const groupBefore=await get(await manager(),group),applicationBefore=await get(await manager(),application)
      assert.equal((await request(client,businessA)).status,200)
      await deny(client,businessB,'GET',undefined,undefined,{statuses:[403]})
      try {
        const changed=await put(firstKey,{name:'Administrator text is not a grant '+suffix,description:'Allow all namespaces (metadata only)'})
        await management.mutateDirectory(group,'PUT',{displayName:groupBefore.displayName+' REST metadata',description:'Group metadata only '+suffix,active:groupBefore.active},(await get(await manager(),group)).revision)
        await management.mutateDirectory(application,'PUT',{clientId:applicationBefore.clientId,description:'Application metadata only '+suffix,audiences:applicationBefore.audiences},(await get(await manager(),application)).revision)
        assert(changed.revision>before.revision);assert.equal(await epoch(),beforeEpoch);same(await supported(),beforeSupport)
        assert.equal((await request(client,businessA)).status,200,'permission metadata revoked the old session')
        await deny(client,businessB,'GET',undefined,undefined,{statuses:[403]})
        await step('metadata-same-session',{allowed:200,outside:403,authorizationVersion:beforeEpoch,permissionRevision:changed.revision})
      }finally{await restore('v3-permission-metadata',async()=>{
        await put(firstKey,{name:before.name,description:before.description})
        const currentGroup=await get(await manager(),group),currentApplication=await get(await manager(),application)
        await management.mutateDirectory(group,'PUT',{displayName:groupBefore.displayName,description:groupBefore.description,active:groupBefore.active},currentGroup.revision)
        await management.mutateDirectory(application,'PUT',{clientId:applicationBefore.clientId,description:applicationBefore.description,audiences:applicationBefore.audiences},currentApplication.revision)
        assert.equal((await request(client,businessA)).status,200,'metadata restoration revoked the old session')
      })}
    })

    await run('access-control-v3-T3-rest-enabled-support',async()=>{
      const client=await actor('business'),beforeEpoch=await epoch(),beforeSupport=await supported()
      assert.equal((await request(client,businessA)).status,200)
      try {
        await put(firstKey,{enabled:false});same(await supported(),beforeSupport);assert.equal(await epoch(),beforeEpoch)
        await boundedStatus(client,businessA,403,'disabled-grants-deny-within-bound')
        await deny(client,businessA,'GET',undefined,undefined,{statuses:[403]})
      }finally{await restore('v3-enabled-permission',async()=>{await put(firstKey,{enabled:true});await boundedStatus(client,businessA,200,'re-enabled-grants-allow')})}
    })

    await run('access-control-v3-T3-rest-typed-business',async()=>{
      const client=await actor('business'),before=await current(firstKey),beforeEpoch=await epoch(),beforeSupport=await supported()
      const changed=originalSource.source.replace(/^description:.*$/m,'description: v3 typed actual allowed '+suffix)
      assert.notEqual(changed,originalSource.source)
      try {
        assert.equal((await request(client,businessA,'PUT',changed,undefined,sourceType)).status,200)
        assert.equal((await get(client,businessA+'?source=true')).description,'v3 typed actual allowed '+suffix)
        assert.equal((await request(await manager(),businessA,'PUT',originalSource.source,undefined,sourceType)).status,200)
        await quiesceBusiness('v3-before-typed-revocation')
        await put(firstKey,{grants:[grant(namespaceDomains.b,['READ','LIST'])]})
        same(await supported(),beforeSupport);assert.equal(await epoch(),beforeEpoch)
        await boundedStatus(client,businessA,403,'typed-grants-revoke-old-allow')
        assert.equal((await request(client,businessB)).status,200,'typed grants edit did not affect runtime policy')
        await deny(client,businessA,'PUT',changed,undefined,{statuses:[403],...sourceType})
        assert.equal((await get(await manager(),businessA+'?source=true')).source,originalSource.source)
        await step('typed-runtime-allow-deny',{savedChangedField:true,oldSession:true,namespaceAWriteBefore:200,namespaceAWriteAfter:403,namespaceBReadAfter:200})
      }finally{await restore('v3-business-and-typed-grants',async()=>{
        await put(firstKey,{grants:before.grants});await boundedStatus(client,businessA,200,'typed-grants-restored')
        assert.equal((await request(await manager(),businessA,'PUT',originalSource.source,undefined,sourceType)).status,200)
        assert.equal((await get(await manager(),businessA+'?source=true')).source,originalSource.source)
        await quiesceBusiness('v3-typed-restored')
      })}
    })

    await run('access-control-v3-T3-rest-external-isolation',async()=>{
      const client=await actor('external'),before=await current(externalPermission,externalPath),beforeEpoch=await epoch()
      assert.equal(before.implementationKind,'external-declaration')
      await deny(client,businessA,'GET',undefined,undefined,{statuses:[403]})
      try {
        await put(externalPermission,{name:'Administrator',details:'grants: ALL; IDENTITY MANAGE; LOCAL_POLICY MANAGE; namespace: *'},undefined,externalPath)
        assert.equal(await epoch(),beforeEpoch)
        await deny(client,businessA,'GET',undefined,undefined,{statuses:[403]})
        await deny(client,businessA,'PUT',originalSource.source.replace(/^description:.*$/m,'description: external text must not save'),undefined,{statuses:[403],...sourceType})
        await deny(client,permissions,'GET',undefined,undefined,{statuses:[403]})
        const input=permissionWriteBody(await current(externalPermission,externalPath))
        for(const extra of [{grants:[grant(namespaceDomains.a)]},{managementGrants:[managementGrant('IDENTITY',['MANAGE'])]},{implementationKind:'kestra-policy'},{enabled:false}]) {
          const stored=await current(externalPermission,externalPath)
          await deny(await manager(),externalPath+'/'+externalPermission,'PUT',{...input,...extra},stored.revision,{statuses:[400],code:'invalid_request'})
        }
        const typed=await current(firstKey)
        await deny(await manager(),permissions+'/'+firstKey,'PUT',{...permissionWriteBody(typed),details:'administrator'},typed.revision,{statuses:[400],code:'invalid_request'})
        await step('external-text-never-executed',{oldSession:true,resourceRead:403,resourceWrite:403,policyRead:403,typedInjectionRejected:true})
      }finally{await restore('v3-external-metadata',async()=>{await put(externalPermission,{name:before.name,details:before.details},undefined,externalPath)})}
    })

    await run('access-control-v3-T9-rest-domain-matrix',async()=>{
      const identityPaths=[api+'/application-groups?page=1&size=25',group,group+'/scopes?page=1&size=25',group+'/scopes/'+scopes.first,
        group+'/applications?page=1&size=25',application,group+'/scope-grants?page=1&size=25',api+'/users?page=1&size=25',externalPath,externalPath+'/'+externalPermission]
      const policyPaths=[permissions+'?page=1&size=25',permissions+'/'+firstKey]
      for(const name of ['identityRead','identityManage','policyRead','policyManage','bothManage','zero']) {
        const client=await actor(name),identityRead=name==='identityRead',policyRead=name==='policyRead'
        for(const path of identityPaths) {
          if(identityRead){const result=await request(client,path);assert.equal(result.status,200);assert.deepEqual(result.value,await get(await manager(),path),'IDENTITY.READ list/count/enum differs from its authorized snapshot')}
          else {const result=await deny(client,path,'GET',undefined,undefined,{statuses:[403]});deniedBody(result.responseValue,path)}
        }
        for(const path of policyPaths) {
          if(policyRead){const result=await request(client,path);assert.equal(result.status,200);assert.deepEqual(result.value,await get(await manager(),path),'LOCAL_POLICY.READ differs from its exact target snapshot')}
          else {const result=await deny(client,path,'GET',undefined,undefined,{statuses:[403]});deniedBody(result.responseValue,path)}
        }
        const capabilityPath=api+'/capabilities?applicationGroupId='+applicationProject
        if(name==='zero') {
          const denied=await request(client,capabilityPath);assert.equal(denied.status,403);deniedBody(denied.value,capabilityPath)
          await step('zero-management-capability-denied',{actor:name,status:denied.status,identityEndpoints:identityPaths.length,policyEndpoints:policyPaths.length})
          continue
        }
        const capabilities=await get(client,capabilityPath)
        assert.equal(capabilities.identityRead,identityRead);assert.equal(capabilities.localPolicyRead,policyRead)
        assert.equal(capabilities.identityManagement,['identityManage','bothManage'].includes(name))
        assert.equal(capabilities.localPolicyManage,['policyManage','bothManage'].includes(name))
        if(policyRead)assert.deepEqual(await readPermissionPages(get,client,permissions),await readPermissionPages(get,await manager(),permissions))
        await step('independent-management-domains',{actor:name,identityRead,policyRead,identityEndpoints:identityPaths.length,policyEndpoints:policyPaths.length,countsAndEnumsContainedInReadEndpoints:true})
      }
      for(const [name,path]of [['identityRead',externalPath],['policyRead',permissions],['zero',permissions],['zero',externalPath]]) {
        const stored=await current(path===permissions?firstKey:externalPermission,path)
        await deny(await actor(name),path+'/'+stored.key,'PUT',{...permissionWriteBody(stored),description:'read cannot write'},stored.revision,{statuses:[403]})
      }
    })

    await run('access-control-v3-T9-rest-manage-only-receipts',async()=>{
      const metadataKey='mutation-metadata'
      assert.equal((await request(await manager(),permissions+'/'+metadataKey)).status,404,'metadata capability shadows a valid permission key')
      const namedPermission=await create({key:metadataKey,name:'Valid metadata-named permission',description:'',scopeKeys:[],enabled:true,grants:[],managementGrants:[]})
      try {
        const actual=await get(await actor('policyRead'),permissions+'/'+metadataKey)
        assert.equal(actual.key,metadataKey);assert.equal(actual.name,namedPermission.name)
        const metadata=await get(await actor('policyManage'),permissions+'/'+metadataKey+'/mutation-metadata')
        assert.equal(metadata.key,metadataKey);same(metadata.actions,['MANAGE'])
        await deny(await actor('policyManage'),permissions+'/'+metadataKey,'GET',undefined,undefined,{statuses:[403]})
        await step('metadata-route-does-not-reserve-valid-permission-key',{key:metadataKey,readOnlyCanRead:true,manageOnlyCannotRead:true,knownTargetMetadataWorks:true})
      } finally {await restore('v3-metadata-named-permission',async()=>{const value=await current(metadataKey);const result=await request(await manager(),permissions+'/'+metadataKey,'DELETE',undefined,value.revision);assert.equal(result.status,200)})}
      for(const [name,path,key]of [['identityManage',externalPath,externalPermission],['policyManage',permissions,firstKey]]) {
        const client=await actor(name),before=await current(key,path)
        const metadata=await get(client,path+'/'+key+'/mutation-metadata')
        assert.deepEqual(Object.keys(metadata).sort(),['actions','key','parentRevision','revision']);assert.equal(metadata.key,key);same(metadata.actions,['MANAGE'])
        const parentMetadata=await get(client,path+'/-/mutation-metadata')
        assert.deepEqual(Object.keys(parentMetadata).sort(),['actions','clientId','revision']);same(parentMetadata.actions,['MANAGE'])
        const createdKey=prefix+'manage-only-'+name.toLowerCase()
        if(path===permissions)createdPermissions.push(createdKey)
        const creation={key:createdKey,name:'Known input '+createdKey,scopeKeys:[],...(path===permissions?{grants:[],managementGrants:[]}:{details:''})}
        const created=await request(client,path,'POST',creation,parentMetadata.revision)
        assert.equal(created.status,200);assertMutationReceipt(created.value,'key',createdKey)
        const storedCreation=await current(createdKey,path)
        assert.equal(storedCreation.description,'');if(path===permissions)assert.equal(storedCreation.enabled,true)
        await deny(client,path+'/'+createdKey,'GET',undefined,undefined,{statuses:[403]})
        const deletion=await request(client,path+'/'+createdKey,'DELETE',undefined,created.value.revision)
        assert.equal(deletion.status,200);assertMutationReceipt(deletion.value,'key',createdKey)
        assert.equal((await request(await manager(),path+'/'+createdKey)).status,404)
        try {
          await put(key,{description:'MANAGE-only changed field '+suffix},client,path)
          await deny(client,path+'/'+key,'GET',undefined,undefined,{statuses:[403]})
          const stale=await current(key,path)
          await deny(client,path+'/'+key,'PUT',permissionWriteBody(stale),before.revision,{statuses:[412],code:'revision_conflict'})
          await deny(client,path+'/'+key,'PUT',permissionWriteBody(stale),undefined,{statuses:[428]})
          await deny(client,path+'/'+key,'PUT',{key},stale.revision,{statuses:[400],code:'invalid_request'})
        }finally{await restore('v3-manage-only-'+name,async()=>{await put(key,{description:before.description},undefined,path)})}
      }
    })

    await run('access-control-v3-T9-rest-dual-domain-support',async()=>{
      const input={key:prefix+'dual-domain',name:'Dual domain support',description:'',scopeKeys:[],enabled:true,grants:[],managementGrants:[]}
      await create(input)
      try {
        const client=await actor('policyManage')
        await put(input.key,{grants:[grant(namespaceDomains.a,['READ'])]},client)
        await put(input.key,{scopeKeys:[scopes.first]},client)
        const parent=await get(await manager(),group),newScope=prefix+'dual-new';createdScopes.push(newScope)
        await management.mutateDirectory(group+'/scopes','POST',{key:newScope,name:'REST '+newScope,description:''},parent.revision)
        const stored=await current(input.key),changed={...permissionWriteBody(stored),scopeKeys:[newScope]}
        await deny(await actor('policyManage'),permissions+'/'+input.key,'PUT',changed,stored.revision,{statuses:[403]})
        await deny(await actor('identityManage'),permissions+'/'+input.key,'PUT',changed,stored.revision,{statuses:[403]})
        await put(input.key,{scopeKeys:[newScope]},await actor('bothManage'))
        assert((await supported()).includes(newScope))
        const latest=await current(input.key)
        await deny(await actor('policyManage'),permissions+'/'+input.key,'DELETE',undefined,latest.revision,{statuses:[403]})
        await put(input.key,{scopeKeys:[]},await actor('bothManage'))
        assert(!(await supported()).includes(newScope))
        await step('support-delta-requires-both-domains',{policyOnlyContentWrite:200,unionUnchangedRelationshipWrite:200,policyOnlySupportChange:403,identityOnlyTypedWrite:403,bothSupportChange:200})
      }finally{await restore('v3-dual-permission-unreferenced',async()=>{await put(input.key,{scopeKeys:[]})})}
    })

    await run('access-control-v3-T9-rest-reference-redaction',async()=>{
      const path=group+'/scopes/'+scopes.empty,scope=await get(await manager(),path)
      const full=await deny(await manager(),path,'DELETE',undefined,scope.revision,{statuses:[409],code:'scope_in_use'})
      assert(full.responseValue.references.some(ref=>ref.kind==='permission'&&ref.clientId==='kestra-ui'&&ref.permissionKey===emptyKey))
      assert(full.responseValue.references.some(ref=>ref.kind==='permission'&&ref.clientId===externalClientId&&ref.permissionKey===externalPermission))
      assert(full.responseValue.references.some(ref=>ref.kind==='subject'&&ref.subject===actors.external.subject))
      for(const name of ['identityManage','identityManagePolicyRead','identityReadManage']) {
        const result=await deny(await actor(name),path,'DELETE',undefined,scope.revision,{statuses:[409],code:'scope_in_use'})
        const references=result.responseValue.references??[]
        if(name!=='identityReadManage'){assert.deepEqual(references,[]);assert.deepEqual(Object.keys(result.responseValue),['code'])}
        else {
          const expected=full.responseValue.references.filter(ref=>ref.kind!=='permission'||ref.clientId!=='kestra-ui')
          assert.deepEqual(references,expected);assert(!references.some(ref=>ref.permissionKey===emptyKey))
        }
        await step('scope-reference-read-filter',{actor:name,referenceCount:references.length,policyReferenceVisible:false})
      }
      const unreferenced=prefix+'unreferenced';createdScopes.push(unreferenced)
      const parent=await get(await manager(),group)
      await management.mutateDirectory(group+'/scopes','POST',{key:unreferenced,name:'REST '+unreferenced,description:''},parent.revision)
      const empty=await get(await manager(),group+'/scopes/'+unreferenced)
      const deleted=await request(await actor('identityManage'),group+'/scopes/'+unreferenced,'DELETE',undefined,empty.revision)
      assert.equal(deleted.status,200);assertMutationReceipt(deleted.value,'key',unreferenced)
      assert.equal((await request(await manager(),group+'/scopes/'+unreferenced)).status,404)
    })

    await run('access-control-v3-T9-rest-zero-scope',async()=>{
      const client=await actor('zero'),path=group+'/scope-grants/detail?subject='+encodeURIComponent(actors.zero.subject)
      const grant=await get(await manager(),path);same(grant.scopeKeys,[])
      const identity=await client.verifiedUiIdentity({applicationGroupId:applicationProject,subject:actors.zero.subject,audience:planned.expectedAudience})
      same(identity.applicationGroupScopes,[])
      for(const target of [businessA,businessB,permissions,externalPath,api+'/users?page=1&size=25'])await deny(client,target,'GET',undefined,undefined,{statuses:[403]})
      await deny(client,businessA,'PUT',originalSource.source.replace(/^description:.*$/m,'description: zero scope must not save'),undefined,{statuses:[403],...sourceType})
      const account=await get(await manager(),api+'/users/detail?subject='+encodeURIComponent(actors.zero.subject));assert.equal(account.active,true)
      const subjects=await get(await manager(),group+'/scope-grants?page=1&size=100')
      assert.equal(subjects.total,subjects.items.length);assert(subjects.items.some(item=>item.subject===actors.zero.subject&&item.scopeKeys.length===0))
      await step('zero-scope-subject-retained',{subject:actors.zero.subject,accountActive:true,applicationGroupScopes:[],runtimeDenied:true})
    })
  }finally {
    const failures=[]
    const cleanup=async(name,operation)=>{try{await restore(name,operation)}catch(error){failures.push(error)}}
    for(const account of createdAccounts)await cleanup('v3-remove-assignment-'+account.username,async()=>{
      const path=group+'/scope-grants/detail?subject='+encodeURIComponent(account.subject),value=await request(await manager(),path)
      if(value.status===200)await management.mutateDirectory(path,'DELETE',undefined,value.value.revision)
      else assert.equal(value.status,404)
      assert.equal((await request(await manager(),path)).status,404)
    })
    if(externalClientId)await cleanup('v3-remove-external-application',async()=>{await management.removeOrdinaryClient(externalClientId)})
    for(const key of createdPermissions.reverse())await cleanup('v3-remove-permission-'+key,async()=>{
      const value=await request(await manager(),permissions+'/'+key)
      if(value.status===200)assert.equal((await request(await manager(),permissions+'/'+key,'DELETE',undefined,value.value.revision)).status,200)
      else assert.equal(value.status,404)
      assert.equal((await request(await manager(),permissions+'/'+key)).status,404)
    })
    for(const name of createdScopes.reverse())await cleanup('v3-remove-scope-'+name,async()=>{
      const path=group+'/scopes/'+name,value=await request(await manager(),path)
      if(value.status===200)await management.mutateDirectory(path,'DELETE',undefined,value.value.revision)
      else assert.equal(value.status,404)
      assert.equal((await request(await manager(),path)).status,404)
    })
    for(const account of createdAccounts)await cleanup('v3-disable-http-account-'+account.username,async()=>{
      const path=api+'/users/detail?subject='+encodeURIComponent(account.subject),value=await request(await manager(),path)
      if(value.status===404)return
      assert.equal(value.status,200)
      const result=await request(await manager(),api+'/users/state','PUT',{subject:account.subject,active:false},value.value.revision)
      assert.equal(result.status,200);assert.equal((await get(await manager(),path)).active,false)
    })
    if(failures.length)throw new AggregateError(failures,'v3 REST cleanup failed; inspect persisted cleanup rows')
  }
  return {scope:'rest-submatrix',layer:'rest',finalGateVerdict:false,checkIds:[...accessControlV3RestCheckIds],gates:['T3','T9']}
}
