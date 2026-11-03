import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {runRbacOnboardingDeployment} from '../rbac-onboarding-deployment.mjs'
import {writeBrowserDiagnosticEvidence} from '../browser-diagnostic-evidence.mjs'

for(const scenario of ['missing-jar','normal'])test(scenario+': orchestration uses isolated database and storage, retains failure and restores original host configuration',async()=>{
  const output=mkdtempSync(join(tmpdir(),'onboarding-offline-'))
  try {
    const project='application-projects-bb-123456-123',base='http://localhost:18128'
    const formalJar=join(output,'formal.jar');writeFileSync(formalJar,'offline test jar bytes')
    const image='ghcr.io/ai-specs/kestra-overlay@sha256:'+'a'.repeat(64)
    const inputs={image,jarSha256:createHash('sha256').update(readFileSync(formalJar)).digest('hex'),rootCommit:'b'.repeat(40),overlayCommit:'c'.repeat(40),pluginCommit:'d'.repeat(40)}
    const configuration={services:{kestra:{image,environment:{KESTRA_CONFIGURATION:'datasources:\n  postgres:\n    url: jdbc:postgresql://postgres:5432/kestra\nkestra:\n  rbac:\n    enabled: false\n    evaluation:\n      enabled: false\n    application-groups:\n      enabled: false\n',KESTRA_OIDC_BOOTSTRAP_USERNAME:'old-account',KESTRA_OIDC_BOOTSTRAP_PASSWORD:'offline-private'},
      volumes:[{type:'volume',source:'kestra-data',target:'/app/storage'},{type:'bind',source:formalJar,target:'/app/libs/kestra-rbac-authorizer.jar',read_only:true}],ports:[]},postgres:{}},volumes:{'kestra-data':{labels:{owner:project}}}}
    configuration.services.kestra.environment.KESTRA_CONFIGURATION+='  oidc:\n    enabled: true\nmicronaut:\n  security:\n    oauth2:\n      clients:\n        kestra:\n          scopes: [openid, profile, email]\n'
    const original=structuredClone(configuration.services.kestra),snapshots=[],commands=[],composeCalls=[],reports=[]
    const postgres='1'.repeat(64),host='2'.repeat(64)
    const command=(program,args)=>{
      commands.push({program,args})
      if(args[0]==='inspect') {
        if(args[2]==='{{.RestartCount}}')return '0'
        if(args[2]==='{{.Config.Image}}')return image
        if(args[2]==='{{json .NetworkSettings.Ports}}')return JSON.stringify({'8080/tcp':[{HostPort:'18128',HostIp:'127.0.0.1'}]})
        return project
      }
      if(args.includes('sha256sum'))return inputs.jarSha256+'  /app/libs/kestra-rbac-authorizer.jar'
      if(args.some(value=>value.includes("'database',current_database()")))return JSON.stringify({database:args[args.indexOf('-d')+1],user:'kestra'})
      if(args.includes('SELECT 1'))return '1'
      if(args.some(value=>value.includes('SELECT 1')))return '1'
      if(args.some(value=>value.startsWith('CREATE DATABASE ')))return ''
      throw new Error('Unexpected offline command '+program+' '+args.join(' '))
    }
    const compose=(...args)=>{
      composeCalls.push(args)
      if(args[0]==='ps')return args.at(-1)==='postgres'?postgres:host
      return ''
    }
    const adapter={redactSecrets(){},async diagnostics(){return {events:[],integrity:[]}},async goto(){throw new Error('deliberate first browser navigation failure')},
      async captureFailure(){},async diagnosticEvidenceReference(){return writeBrowserDiagnosticEvidence({events:[],integrity:[]},join(output,'diagnostics'))}}
    const oldFetch=globalThis.fetch
    globalThis.fetch=async()=>({ok:true,body:{async cancel(){}}})
    try {
      await assert.rejects(runRbacOnboardingDeployment({configuration,compose,command,output,project,base,inputs,formalJar,uiAdapter:adapter,scenario,
        saveConfiguration:async()=>snapshots.push(structuredClone(configuration)),record:async report=>reports.push(report)}),/deliberate first browser navigation failure/)
    } finally {globalThis.fetch=oldFetch}
    assert.deepEqual(configuration.services.kestra,original)
    assert.equal(snapshots.length,2)
    const first=snapshots[0].services.kestra
    assert.equal(first.environment.KESTRA_OIDC_BOOTSTRAP_USERNAME,'')
    assert.equal(first.environment.KESTRA_OIDC_BOOTSTRAP_PASSWORD,'')
    assert.equal(first.environment.KESTRA_OIDC_SETUP_ALLOWED,'true')
    assert(first.environment.KESTRA_CONFIGURATION.includes('application_group_acceptance_'))
    assert(first.environment.KESTRA_CONFIGURATION.includes('application-groups:\n      enabled: true'))
    assert(!first.environment.KESTRA_CONFIGURATION.includes('kestra:application-group-scopes'))
    const storage=scenario==='normal'?'onboarding-normal-data':'onboarding-data'
    const directory=scenario==='normal'?'onboarding-normal':'onboarding'
    assert(first.volumes.some(volume=>volume.source===storage&&volume.target==='/app/storage'))
    assert(!first.volumes.some(volume=>volume.target==='/app/libs/kestra-rbac-authorizer.jar'))
    assert(first.volumes.some(volume=>volume.target==='/app/libs'&&volume.read_only))
    assert.deepEqual(configuration.volumes[storage].labels,{owner:project})
    if(scenario==='normal')assert.deepEqual(readFileSync(join(output,directory,'libs/kestra-rbac-authorizer.jar')),readFileSync(formalJar))
    assert.equal(commands.filter(row=>row.args.some(arg=>arg.startsWith('CREATE DATABASE '))).length,1)
    assert(!composeCalls.some(args=>args.includes('down')))
    assert.deepEqual(composeCalls.at(-1),['stop','kestra'])
    const report=JSON.parse(readFileSync(join(output,directory,'report.json')))
    assert.equal(report.completed,false);assert.equal(report.cases[0].status,'failed')
    assert.equal(report.scenario,scenario)
    assert.equal(report.summary.failed,1);assert.equal(report.summary.notRun,scenario==='normal'?8:11)
    assert(!JSON.stringify(report).includes('offline-private'))
    assert(reports.length>=3)
  } finally {rmSync(output,{recursive:true,force:true})}
})
