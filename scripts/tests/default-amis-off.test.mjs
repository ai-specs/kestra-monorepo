import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

const checker=fileURLToPath(new URL('../check-default-multi-policy.py',import.meta.url))
const amis='  amis-apps:\n    enabled: false\n    max-sync-concurrency: 4\n    request-body-timeout: PT30S\n'
const configuration='kestra:\n'+amis+'  rbac:\n    enabled: true\n    policy-source: database\n    application-groups:\n      enabled: true\nmicronaut:\n  scopes: [openid, profile, email]\n'
function run(t,value){
  const area=mkdtempSync(join(tmpdir(),'default-amis-off-'));t.after(()=>rmSync(area,{recursive:true,force:true}))
  const file=join(area,'compose.json');writeFileSync(file,JSON.stringify({services:{kestra:{environment:{KESTRA_CONFIGURATION:value}}}}))
  const result=spawnSync('python3',[checker,file],{encoding:'utf8'})
  assert.ifError(result.error)
  return result
}
test('synthetic default AMIS off passes independently of rbac.enabled true',t=>{
  const result=run(t,configuration);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/disables AMIS/)
})
for(const [name,mutate]of [
  ['enabled true',s=>s.replace(amis,amis.replace('enabled: false','enabled: true'))],
  ['missing block',s=>s.replace(amis,'')],
  ['duplicate block',s=>s.replace(amis,amis+amis)],
  ['duplicate kestra',s=>s+'kestra:\n'+amis],
  ['missing enabled',s=>s.replace('    enabled: false\n','')],
  ['duplicate enabled',s=>s.replace('    enabled: false\n','    enabled: false\n    enabled: true\n')],
  ['zero concurrency',s=>s.replace('max-sync-concurrency: 4','max-sync-concurrency: 0')],
  ['negative concurrency',s=>s.replace('max-sync-concurrency: 4','max-sync-concurrency: -1')],
  ['nondefault positive concurrency',s=>s.replace('max-sync-concurrency: 4','max-sync-concurrency: 8')],
  ['missing timeout',s=>s.replace('    request-body-timeout: PT30S\n','')],
  ['nondefault timeout',s=>s.replace('PT30S','PT60S')],
  ['nested amis under plugins',s=>s.replace(amis,'  plugins:\n'+amis.split('\n').filter(Boolean).map(line=>'  '+line).join('\n')+'\n')],
  ['nested enabled cannot substitute direct enabled',s=>s.replace('    enabled: false\n','    nested:\n      enabled: false\n')],
])test('synthetic checker rejects '+name,t=>{assert.notEqual(run(t,mutate(configuration)).status,0)})
for(const [name,mutate]of [
  ['missing database policy',s=>s.replace('policy-source: database','policy-source: file')],
  ['missing application groups',s=>s.replace('application-groups:','unrelated:')],
  ['missing standard scopes',s=>s.replace('openid, profile, email','openid')],
  ['UI selector',s=>s+'selector: kestra:application-group-scopes\n'],
  ['management administrator bypass',s=>s+'management-admin-subjects: [admin]\n'],
  ['deployment writer',s=>s+'subject: deployment-multi-writer\n'],
  ['deployment reader',s=>s+'subject: deployment-multi-reader\n'],
  ['legacy role mapping',s=>s+'role-mapping: {}\n'],
  ['instance administrator bypass',s=>s+'instance-admin-roles: []\n'],
])test('original RBAC gate still rejects '+name,t=>{assert.notEqual(run(t,mutate(configuration)).status,0)})
