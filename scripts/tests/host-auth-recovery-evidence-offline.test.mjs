import test from 'node:test'
import assert from 'node:assert/strict'
import {assertHostAuthenticationRecoveryBrowserReport as check} from '../published-ui-browser-evidence.mjs'

const sha='a'.repeat(64)
const fixture=()=>{
  const sourceFiles=Object.fromEntries(['ui/src/utils/authentication.ts','ui/src/utils/basicAuth.ts','ui/src/utils/csrf.ts',
    'ui/src/override/utils/route.ts','ui/src/extensions/runtime.ts','ui/src/extensions/protocol.ts',
    'ui/src/components/extensions/ExtensionPage.vue'].map(path=>[path,sha]))
  return {completed:true,environment:'real-chromium-host-http-substitute',productionFirstInstall:false,
    sourceFiles,finalSourceFiles:{...sourceFiles},runnerSha256:sha,errors:[],
    checks:[...[403,503,401].map(status=>({name:'host-context-request-'+status+'-single-write',status,passed:true,
      counts:{writes:1,reads:1,logins:status===401?1:0}})),{name:'logout-pending-401',status:401,passed:true,logoutRequests:1,counts:{writes:1,reads:1,logins:0}}]}
}
test('published host recovery requires three exact browser checks and unchanged source inputs',()=>{
  assert.equal(check(JSON.stringify(fixture()),sha).cases,4)
})
for(const [name,change] of [
  ['wrong runner',r=>{r.runnerSha256='b'.repeat(64)}],
  ['missing source',r=>{delete r.sourceFiles['ui/src/extensions/runtime.ts']}],
  ['source drift',r=>{r.finalSourceFiles['ui/src/extensions/runtime.ts']='b'.repeat(64)}],
  ['missing check',r=>{r.checks.pop()}],
  ['duplicate check',r=>{r.checks[0]=r.checks[1]}],
  ['replayed write',r=>{r.checks[2].counts.writes=2}],
  ['multiple redirects',r=>{r.checks[2].counts.logins=2}],
  ['503 redirects',r=>{r.checks[1].counts.logins=1}],
  ['false production claim',r=>{r.productionFirstInstall=true}],
  ['browser error',r=>{r.errors.push('unexpected')}],
  ['runner failure',r=>{r.error='failed'}],
])test('rejects '+name,()=>{const report=fixture();change(report);assert.throws(()=>check(JSON.stringify(report),sha))})
