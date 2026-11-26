import assert from 'node:assert/strict'
import test from 'node:test'
import {registerHooks} from 'node:module'

const replacements=new Map([
  [new URL('../application-project-rest-cases.mjs',import.meta.url).href,
    'export async function runApplicationProjectRest(base,fixture,record){return fixture.run(record)}'],
  [new URL('../application-project-mcp-cases.mjs',import.meta.url).href,
    'export async function runApplicationProjectMcp(base,fixture,record){return fixture.run(record)}'],
  [new URL('../application-project-aggregate-cases.mjs',import.meta.url).href,
    'export async function runApplicationProjectAggregates(base,fixture,record){return fixture.planned.runAggregates(record)}'],
])
const hooks=registerHooks({load(url,context,nextLoad){
  if(replacements.has(url))return {format:'module',source:replacements.get(url),shortCircuit:true}
  return nextLoad(url,context)
}})
let integration
try {integration=await import('../application-project-integration-cases.mjs?boundary-unit')}
finally {hooks.deregister()}
const {initialEvidence,runIntegration}=integration

function setup({rest={completed:true,failures:0},security={completed:true,failures:0}}={}) {
  const events=[],saved=[]
  const report={...initialEvidence(),fragments:{}}
  const original=structuredClone(report)
  const persist=async()=>{await Promise.resolve();saved.push(structuredClone(report));events.push('persist')}
  const fixture={
    frozenUiBaseline:{completed:true,passed:true,status:'passed',phase:'before-boundary-data',evidence:{source:'real-browser-before-boundary-data'}},
    rest:{run:async record=>{
      events.push('rest-start')
      const fragment={...rest,matrix:structuredClone(report.matrix)}
      if(rest.failures>0)Object.assign(fragment.matrix[0],{passed:false,status:'failed',error:'synthetic REST failure'})
      await record({...fragment,completed:false})
      events.push('rest-recovery');await record(fragment);events.push('rest-return');return fragment
    }},
    runSecurity:async record=>{
      events.push('security-start')
      const fragment={...security,checks:[{...report.checks[0],status:security.failures?'failed':'passed',passed:security.failures===0,evidence:{synthetic:true}}]}
      await record({...fragment,completed:false})
      events.push('security-fragment-recovery');await record(fragment)
      events.push('security-wrapper-recovery');await persist();events.push('security-return');return fragment
    },
    checkHostHealth:async label=>events.push(label),
    runMigration:async record=>{events.push('migration');await record({completed:true,checks:[]})},
    prepareMcp:async()=>{events.push('prepare-mcp');return {run:async record=>{events.push('mcp');await record({completed:true,checks:[]})}}},
    cleanupAuxiliaryDeployments:async()=>events.push('auxiliary-cleanup'),
    planned:{runAggregates:async record=>{events.push('aggregates');await record({completed:true,checks:[]})}},
    prepareUi:async()=>{events.push('prepare-ui');return {}},
    runUi:async(ui,record)=>{events.push('ui');await record({completed:true,ui:[]})},
  }
  return {fixture,report,original,events,saved,persist}
}

for(const fragment of ['rest','security'])for(const result of [
  {completed:false,failures:1},
  {completed:false,failures:0},
  {completed:true,failures:1},
  {completed:true},
])test(`${fragment} boundary rejects ${JSON.stringify(result)} after persistence and recovery`,async()=>{
  const f=setup({[fragment]:result})
  await assert.rejects(runIntegration('https://synthetic.invalid',f.fixture,null,f.report,f.persist),new RegExp(fragment==='rest'?'REST':'Security'))
  assert(f.events.includes(fragment+'-return'))
  assert(f.events.includes(fragment==='rest'?'rest-recovery':'security-wrapper-recovery'))
  assert(!f.events.includes('prepare-mcp'));assert(!f.events.includes('prepare-ui'));assert(!f.events.includes('migration'))
  if(fragment==='rest')assert(!f.events.includes('security-start'))
  assert.deepEqual(f.saved.at(-1),f.report)
  assert.deepEqual(f.report.ui,f.original.ui)
  assert.deepEqual(f.report.checks.map(row=>row.id),f.original.checks.map(row=>row.id))
  assert.deepEqual(f.report.matrix.map(row=>[row.caseId,row.probeIndex]),f.original.matrix.map(row=>[row.caseId,row.probeIndex]))
  if(fragment==='rest')assert.deepEqual(f.report.checks,f.original.checks)
  else assert.deepEqual(f.report.checks.slice(1),f.original.checks.slice(1))
  assert(f.report.ui.every(row=>row.passed===false))
  assert.equal(f.report.fragments[fragment].completed,result.completed)
  if(result.failures)assert.equal(fragment==='rest'?f.report.matrix[0].status:f.report.checks[0].status,'failed')
})

test('successful final fragments retain intermediate incomplete reports and original execution order',async()=>{
  const f=setup()
  await runIntegration('https://synthetic.invalid',f.fixture,null,f.report,f.persist)
  assert.deepEqual(f.events.filter(event=>event!=='persist'),[
    'rest-start','rest-recovery','rest-return','security-start','security-fragment-recovery','security-wrapper-recovery','security-return',
    'after-security','migration','after-migration','prepare-mcp','before-mcp','mcp','auxiliary-cleanup','aggregates','prepare-ui','ui',
  ])
  assert(f.saved.some(report=>report.fragments.rest?.completed===false))
  assert(f.saved.some(report=>report.fragments.security?.completed===false))
  assert.deepEqual(f.report.checks.slice(0,f.original.checks.length).map(row=>row.id),f.original.checks.map(row=>row.id))
  assert.deepEqual(f.report.matrix.map(row=>[row.caseId,row.probeIndex]),f.original.matrix.map(row=>[row.caseId,row.probeIndex]))
})

test('security wrapper recovery rejection is not hidden by a successful fragment',async()=>{
  const f=setup(),run=f.fixture.runSecurity
  f.fixture.runSecurity=async record=>{await run(record);throw new Error('synthetic wrapper recovery failed')}
  await assert.rejects(runIntegration('https://synthetic.invalid',f.fixture,null,f.report,f.persist),/wrapper recovery failed/)
  assert.equal(f.report.fragments.security.completed,true)
  assert(!f.events.includes('prepare-mcp'));assert(!f.events.includes('prepare-ui'))
  assert.deepEqual(f.saved.at(-1),f.report)
})
