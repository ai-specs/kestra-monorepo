// Offline injection only: no Docker daemon or browser is contacted.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, writeFile, chmod, rm, mkdir} from 'node:fs/promises'
import {resolve, join} from 'node:path'
import {runAmisBrowserDriver} from '../amis-apps-browser-driver.mjs'
const id = 'a'.repeat(64), sha = 'b'.repeat(64), image = 'ghcr.io/ai-specs/kestra-overlay@sha256:'+sha
async function setup(t) {
  await mkdir(resolve('.work'), {recursive:true})
  const dir = await mkdtemp(resolve('.work/driver-unit-'))
  t.after(() => rm(dir, {recursive:true, force:true}))
  const privateFile = join(dir, 'private.json')
  await writeFile(privateFile, JSON.stringify({account:{username:'actor',password:'private-never-output'}}), {mode:0o600})
  const calls = [], record = {Id:id, State:{Running:true}, Config:{Image:image,Labels:{owner:'owned','com.docker.compose.project':'owned'}},Image:'sha256:'+sha,NetworkSettings:{Ports:{'8080/tcp':[{HostIp:'127.0.0.1',HostPort:'19001'}]}},Mounts:[{Destination:'/app/libs/amis.jar',RW:false}]}
  const options = {privateFile,base:'http://127.0.0.1:19001',namespace:'company.amis',flowId:'acceptance',pageId:'home',marker:'marker',title:'title',driver:'playwright',playwrightModule:'/explicit/playwright/index.mjs',outputDirectory:join(dir,'report'),deployment:{mode:'A',project:'owned',containerIds:[id],hostContainerId:id,formalImage:image,actualImageId:'sha256:'+sha,jars:[{target:'/app/libs/amis.jar',sha256:sha}]}}
  const dependencies = {childTransport:async(command,args,input) => {calls.push({command,args,input});return {code:0,stdout:args[0]==='inspect'?JSON.stringify([record]):sha+'  /app/libs/amis.jar',stderr:''}},createPlaywright:async()=>({}),runBrowser:async(adapter, args)=>{assert.equal(args.account.password,'private-never-output');await args.record({completed:true});return {completed:true}},importModule:async()=>({chromium:{launch:async()=>({newContext:async()=>({newPage:async()=>({}),close:async()=>calls.push('context-close')}),close:async()=>calls.push('browser-close')})}})}
  return {options,dependencies,calls,record,privateFile}
}
test('readonly inspect/hash precedes isolated Chromium workflow and cleanup; no secret summary',async t=>{
  const f=await setup(t),summary=await runAmisBrowserDriver(f.options,f.dependencies)
  assert.equal(summary.completed,true);assert(!JSON.stringify(summary).includes('private-never-output'))
  assert.deepEqual(f.calls[0].args,['inspect',id]);assert.deepEqual(f.calls[1].args,['exec',id,'sha256sum','/app/libs/amis.jar'])
  assert(f.calls.includes('context-close')&&f.calls.includes('browser-close'))
})
test('owner mismatch rejects before browser launch',async t=>{
  const f=await setup(t);f.record.Config.Labels.owner='foreign';await assert.rejects(runAmisBrowserDriver(f.options,f.dependencies),/Owner/);assert.equal(f.calls.length,1)
})
test('private input must be 0600 and absolute within root .work',async t=>{
  const f=await setup(t);await chmod(f.privateFile,0o644);await assert.rejects(runAmisBrowserDriver(f.options,f.dependencies),/0600/)
  await assert.rejects(runAmisBrowserDriver({...f.options,privateFile:'relative.json'},f.dependencies),/Absolute/)
})
test('Ego child only references explicit existing space/page via stdin and never creates or claims',async t=>{
  const f=await setup(t);f.options.driver='ego';f.options.spaceId=23;f.options.pageLabel='p1'
  const original=f.dependencies.childTransport
  f.dependencies.childTransport=async(command,args,input)=>command==='ego-browser'?(f.calls.push({command,args,input}),await (async()=>{await writeFile(join(f.options.outputDirectory,'report.json'),JSON.stringify({completed:true}));return {code:0,stdout:'safe',stderr:''}})()):original(command,args,input)
  await runAmisBrowserDriver(f.options,f.dependencies)
  const call=f.calls.at(-1);assert.deepEqual(call.args,['nodejs']);assert(call.input.includes('taskSpace(options.spaceId)'));assert(!/newPage|claimTaskSpace|takeOverTaskSpace|taskSpace\("/.test(call.input));assert(!call.input.includes('private-never-output'))
})
test('workflow failure still closes context/browser and retains partial report',async t=>{
  const f=await setup(t);f.dependencies.runBrowser=async(adapter,args)=>{await args.record({completed:false,checks:[{sourceFile:'scripts/amis-apps-browser.mjs',status:'failed'}]});throw new Error('synthetic failure')}
  await assert.rejects(runAmisBrowserDriver(f.options,f.dependencies));assert(f.calls.includes('context-close')&&f.calls.includes('browser-close'))
})
test('actual image, public binding, writable mount and wrong jar hash fail before browser',async t=>{
  for(const mutation of [f=>{f.record.Image='sha256:'+'c'.repeat(64)},f=>{f.record.NetworkSettings.Ports['8080/tcp'][0].HostIp='0.0.0.0'},f=>{f.record.Mounts[0].RW=true},f=>{f.options.deployment.jars[0].sha256='c'.repeat(64)}]){
    const f=await setup(t);mutation(f);let launched=false;f.dependencies.importModule=async()=>{launched=true;throw new Error('not allowed')}
    await assert.rejects(runAmisBrowserDriver(f.options,f.dependencies));assert.equal(launched,false)
  }
})
test('missing explicit Ego page and inline credentials fail without browser commands',async t=>{
  const f=await setup(t);await assert.rejects(runAmisBrowserDriver({...f.options,account:{password:'inline'}},f.dependencies),/privateFile/)
  f.options.driver='ego';await assert.rejects(runAmisBrowserDriver(f.options,f.dependencies),/existing Ego/)
  assert(!f.calls.some(call=>call.command==='ego-browser'))
})

test('driver preserves private zero-account switch inputs and real browser partial denial failure',async t=>{
  const f=await setup(t)
  await writeFile(f.privateFile,JSON.stringify({account:{username:'actor',password:'private-never-output'},
    nextAccount:{username:'zero',password:'private-zero-never-output',access:'zero',denialText:'Access denied'}}),{mode:0o600})
  f.dependencies.runBrowser=async(adapter,args)=>{
    assert.equal(args.nextAccount.access,'zero')
    assert.equal(args.nextAccount.password,'private-zero-never-output')
    await args.record({completed:false,checks:[{id:'submit-result',status:'passed'},
      {id:'next-production-login',status:'failed'},{id:'next-zero-authority-denial',status:'not_run'}],
      failure:{phase:'next-production-login',message:'Native return-to-login button missing'}})
    throw new Error('Native return-to-login button missing')
  }
  await assert.rejects(runAmisBrowserDriver(f.options,f.dependencies),/return-to-login/)
  assert(f.calls.includes('context-close')&&f.calls.includes('browser-close'))
})
