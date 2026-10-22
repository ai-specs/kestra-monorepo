/** Actual list/usage aggregate evidence, with independently observed sentinels. */
import assert from 'node:assert/strict'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {namespaceDomains,applicationProject} from './application-project-cases.mjs'

export async function runApplicationProjectAggregates(base,{planned,rest,mcp},record) {
  const report={schemaVersion:1,completed:false,checks:[
    {id:'list-total-pagination-aggregate',status:'not_run',passed:false,evidence:{}},
    {id:'denied-write-no-delayed-side-effects',status:'not_run',passed:false,evidence:{}},
  ],requests:[]}
  const save=async()=>{report.completed=report.checks.every(row=>row.passed);await record(structuredClone(report))}
  await save()
  const get=async(client,path)=>{const response=await client.request(path);report.requests.push({path,status:response.status});assert.equal(response.status,200);return response.json()}
  const login=async account=>{const client=new ProductionOAuthClient(base);await client.login(account.username,account.password);await client.verifiedUiIdentity({applicationGroupId:applicationProject,subject:account.subject,audience:planned.expectedAudience});return client}
  async function list(client,resource) {
    const items=[];let total
    for(let page=1;;page++) {
      const result=await get(client,'/api/v1/main/'+resource+'/search?'+new URLSearchParams({page:String(page),size:'1'}))
      assert(Array.isArray(result.results)&&Number.isSafeInteger(result.total));total??=result.total;assert.equal(total,result.total)
      assert(result.results.length<=1);items.push(...result.results)
      if(items.length===total){const beyond=await get(client,'/api/v1/main/'+resource+'/search?'+new URLSearchParams({page:String(page+1),size:'1'}));assert([0,total].includes(beyond.total));assert.deepEqual(beyond.results,[]);return {items,total,pages:page,emptyPage:page+1,emptyPageTotal:beyond.total}}
      assert(result.results.length&&items.length<total&&page<1000,'list pagination did not converge')
    }
  }
  try {
    assert.equal(rest?.completed,true,'real REST fragment must pass before aggregate evidence')
    const observer=await login(planned.admin)
    const allFlows=await list(observer,'flows'),allExecutions=await list(observer,'executions')
    assert(allFlows.items.some(item=>item.namespace===namespaceDomains.outside),'out-of-range flow sentinel required')
    assert(allExecutions.items.some(item=>item.namespace===namespaceDomains.a)&&allExecutions.items.some(item=>item.namespace===namespaceDomains.b),'both execution domains must exist')
    const domains={reader:[namespaceDomains.a],writer:[namespaceDomains.b],'multiple-complete-scopes':[namespaceDomains.a,namespaceDomains.b],'exact-namespace':[namespaceDomains.a]}
    const cases=[]
    for(const [caseId,roots]of Object.entries(domains)) {
      const includes=item=>roots.some(root=>item.namespace===root||(caseId!=='exact-namespace'&&item.namespace?.startsWith(root+'.')))
      const expectedFlows=allFlows.items.filter(includes),expectedExecutions=allExecutions.items.filter(includes)
      assert(expectedFlows.length&&allFlows.items.some(item=>!includes(item)),'each aggregate needs nonempty allowed and denied domains')
      const client=await login(planned.accounts[caseId]),flows=await list(client,'flows'),executions=await list(client,'executions')
      const keys=items=>items.map(item=>item.namespace+'/'+item.id).sort()
      assert.deepEqual(keys(flows.items),keys(expectedFlows));assert.deepEqual(keys(executions.items),keys(expectedExecutions))
      const usage=await get(client,'/api/v1/main/usages/all')
      assert.equal(usage.flows?.count,expectedFlows.length,'flow aggregate leaked or omitted a resource')
      assert.equal(usage.flows?.namespacesCount,new Set(expectedFlows.map(item=>item.namespace)).size,'namespace aggregate leaked or omitted a domain')
      assert(Array.isArray(usage.executions?.dailyExecutionsCount),'daily execution aggregate required')
      const successful=usage.executions.dailyExecutionsCount.reduce((sum,day)=>sum+(day.executionCounts?.SUCCESS??0),0)
      // All executions in this new disposable deployment are created within a day.
      assert.equal(successful,expectedExecutions.filter(item=>item.state?.current==='SUCCESS').length,'execution aggregate differs from authorized stored results')
      cases.push({caseId,flowTotal:flows.total,executionTotal:executions.total,flowPages:flows.pages,executionPages:executions.pages,namespaceCount:usage.flows.namespacesCount,successfulExecutions:successful})
      await save()
    }
    Object.assign(report.checks[0],{passed:true,status:'passed',evidence:{cases,outsideFlowSentinels:allFlows.items.filter(item=>item.namespace===namespaceDomains.outside).length,observerFlowTotal:allFlows.total,observerExecutionTotal:allExecutions.total}})
  }catch(error){Object.assign(report.checks[0],{status:'failed',evidence:{error:String(error.message)}})}
  await save()
  try {
    const observations=rest.matrix.filter(row=>!row.expectedAllowed&&['CREATE','UPDATE','DELETE','EXECUTE'].includes(row.resource.action)).map(row=>({caseId:row.caseId,probeIndex:row.probeIndex,effects:row.observed.sideEffects}))
    assert(observations.length>0&&mcp?.completed===true,'all transport denial observations required')
    for(const row of observations){const e=row.effects;assert(e&&e.before===e.immediate&&e.windowMs>=5000&&e.samples.length>=2);assert(e.samples.every(sample=>sample.hash===e.before));assert(e.samples.at(-1).elapsedMs>=e.windowMs)}
    const mcpObservations=[]
    const collect=(value,path)=>{
      if(!value||typeof value!=='object')return
      for(const [name,item]of Object.entries(value)) {
        if(name==='sideEffects'&&item?.before)mcpObservations.push({path:path+'.'+name,effects:item})
        else collect(item,path+'.'+name)
      }
    }
    for(const row of mcp.checks)if(row.passed)collect(row.evidence,row.id)
    assert(mcpObservations.length>0,'actual MCP denied-call effect observations required')
    for(const {effects:e}of mcpObservations){assert(e.before===e.immediate&&e.windowMs>=5000&&e.samples.length>=2);assert(e.samples.every(sample=>sample.hash===e.before));assert(e.samples.at(-1).elapsedMs>=e.windowMs)}
    assert(mcpObservations.some(row=>row.path.startsWith('mcp-known-plus-unbound-call.')))
    Object.assign(report.checks[1],{passed:true,status:'passed',evidence:{restDeniedWrites:observations,mcpDeniedCalls:mcpObservations}})
  }catch(error){Object.assign(report.checks[1],{status:'failed',evidence:{error:String(error.message)}})}
  await save();return report
}
