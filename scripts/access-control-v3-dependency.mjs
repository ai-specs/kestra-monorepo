import assert from 'node:assert/strict'

export function ownedPermissionDependencyControls({origin,applicationGroupId,assertOwner,query}) {
  assert.equal(new URL(origin).origin,origin)
  assert(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(applicationGroupId))
  assert.equal(typeof assertOwner,'function');assert.equal(typeof query,'function')
  const operations=new Map(),table='rbac_application_group_state'
  const fingerprint=async name=>{
    assert(/^rbac_application_group_state(?:_ui_[a-f0-9]{16})?$/.test(name))
    return query("SELECT md5(coalesce(string_agg(row_to_json(owned_state)::text,'|' ORDER BY group_id),'')) FROM public."+name+' owned_state')
  }
  const names=async temporary=>JSON.parse(await query("SELECT json_build_object('original',to_regclass('public."+table+"') IS NOT NULL,'temporary',to_regclass('public."+temporary+"') IS NOT NULL)::text"))
  return {
    async makeUnavailable({operationId,origin:requestedOrigin,path,method}) {
      assert.equal(requestedOrigin,origin);assert.equal(method,'PUT')
      assert(/^ui-dependency-[a-f0-9]{16}$/.test(operationId))
      assert(path.startsWith('/api/v1/main/extensions/rbac/application-groups/'+applicationGroupId+'/applications/~')&&/\/permissions\/[a-z][a-z0-9-]{0,127}$/.test(path))
      assert(!operations.has(operationId),'A dependency outage cannot be retried automatically')
      await assertOwner()
      const temporary=table+'_ui_'+operationId.slice(-16)
      const initial=await names(temporary)
      assert(initial.original&&!initial.temporary,'Ambiguous isolated dependency table state')
      const before=await fingerprint(table)
      operations.set(operationId,{temporary,before,recovered:false})
      await query("SET lock_timeout='5s'; ALTER TABLE public."+table+' RENAME TO '+temporary)
      const unavailable=await names(temporary)
      assert(!unavailable.original&&unavailable.temporary,'Dependency remained available after the owned fault action')
      return {source:'owned-production-dependency-control',operationId,origin,dependencyId:table,observedAt:new Date().toISOString()}
    },
    async recover({operationId}) {
      assert(/^ui-dependency-[a-f0-9]{16}$/.test(operationId))
      const operation=operations.get(operationId)
      assert(operation,'No corresponding owned dependency operation')
      await assertOwner()
      const current=await names(operation.temporary)
      if(!current.original&&current.temporary)await query("SET lock_timeout='5s'; ALTER TABLE public."+operation.temporary+' RENAME TO '+table)
      else assert(current.original&&!current.temporary,'Ambiguous dependency state; refusing destructive recovery')
      if(!operation.recovered)assert.equal(await fingerprint(table),operation.before,'Rejected request changed permission storage while the dependency was unavailable')
      operation.recovered=true
      return {source:'owned-production-dependency-control',operationId,recovered:true,observedAt:new Date().toISOString()}
    },
  }
}
