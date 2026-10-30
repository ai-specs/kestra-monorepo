import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createEgoApplicationProjectAdapter} from '../application-project-browser-adapters.mjs'

// Simulated protocol/filesystem transport only. Real keyboard evidence is in
// production-drawer-native-review/*escape*.json; no browser launched here.
async function setup({sensitive=true,imageError=false,clipboard=false,missingPermission=false}={}) {
  const state={keys:[],clicks:[],commands:[],events:[],screenshots:0,clickError:null}
  let currentTarget
  const page={get targetId(){return currentTarget},keyboard:{press:async key=>{state.keys.push(key)}},mouse:{click:async(x,y)=>{state.clicks.push({x,y})}},
    cdp:async(method,params)=>{state.commands.push({method,params});currentTarget='test-target';return method==='Page.getFrameTree'?{frameTree:{frame:{id:'frame',loaderId:'loader',url:'http://localhost:18128/ui/main/extensions/rbac'}}}:{}},
    events:async()=>state.events.splice(0),evaluate:async fn=>{const source=String(fn);if(/let found=false/.test(source))return sensitive;if(source.includes('location.origin'))return 'http://localhost:18128';if(source.includes('width:innerWidth'))return {width:768,height:900};if(source.includes('state:(await navigator.permissions.query'))return ['clipboard-read','clipboard-write'].map(name=>({name,state:'prompt'}));if(source.includes('navigator.permissions.query'))return ['granted','granted'];return null},
    screenshot:async()=>{state.screenshots++;if(imageError)throw Error('synthetic filesystem failure')},
    click:async()=>{if(state.clickError)throw state.clickError},goto:async()=>{},reload:async()=>{},fill:async()=>{},selectOption:async()=>{},focus:async()=>{},press:async()=>{},waitForFunction:async()=>{},
  }
  const artifactDirectory=await fs.mkdtemp(path.join(os.tmpdir(),'root-adapter-offline-'))
  const browserCdp=async(method,params)=>{state.commands.push({method,params});if(missingPermission&&method==='Browser.setPermission')throw Error("'Browser.setPermission' wasn't found");return method==='Target.getTargetInfo'?{targetInfo:{targetId:'test-target',type:'page',url:'http://localhost:18128/ui/main/extensions/rbac',browserContextId:'owned-context'}}:{}}
  const adapter=await createEgoApplicationProjectAdapter(page,{artifactDirectory,...(clipboard?{browserCdp}:{})})
  return {state,adapter,artifactDirectory}
}
test('focused keyboard delegates Tab/ShiftTab/Escape to the native Page API, not fabricated platform keycodes',async()=>{
  const {state,adapter}=await setup();try{for(const key of ['Tab','Shift+Tab','Escape'])await adapter.pressFocused(key);assert.deepEqual(state.keys,['Tab','Shift+Tab','Escape']);assert(!state.commands.some(x=>x.method==='Input.dispatchKeyEvent'))}finally{await adapter.dispose()}
})
test('measured header pointer delegates only viewport x/y to native mouse and rejects metadata or outside coordinates',async()=>{
 const {state,adapter}=await setup({sensitive:false});try{await adapter.clickAt({x:737,y:27});assert.deepEqual(state.clicks,[{x:737,y:27}]);await assert.rejects(adapter.clickAt({x:737,y:27,rect:{}}),/finite CSS viewport point/);await assert.rejects(adapter.clickAt({x:800,y:27}),/outside the viewport/);assert.equal(state.clicks.length,1)}finally{await adapter.dispose()}
})
test('credential screenshot suppression is explicit and never erases the original failed action',async()=>{
  const {state,adapter}=await setup();const original=Error('original business assertion failed');state.clickError=original
  try{await assert.rejects(adapter.click('button'),error=>error===original);assert(original.artifactCaptureError.includes('Credential-bearing'));assert.equal(state.screenshots,0);const diag=await adapter.diagnostics();assert(diag.events.some(x=>x.kind==='operation-error'));assert(diag.events.some(x=>x.kind==='artifact-suppressed'));assert(!diag.events.some(x=>x.kind==='diagnostic-integrity-error'));const suppression=await adapter.captureFailure(original,'credential-case');assert.deepEqual({kind:suppression.kind,captured:suppression.captured,reason:suppression.reason},{kind:'screenshot-suppressed',captured:false,reason:'credential-visible'});await adapter.pressFocused('Escape')}finally{await adapter.dispose()}
})
test('real protocol attribution corruption still fails closed after a suppressed credential screenshot',async()=>{
  const {state,adapter}=await setup();state.events.push({unexpected:'unknown envelope'});try{await assert.rejects(adapter.diagnostics(),/diagnostic collection incomplete/);await assert.rejects(adapter.diagnostics(),/diagnostic collection incomplete/)}finally{await adapter.dispose().catch(()=>{})}
})
test('non-credential screenshot IO loss remains a diagnostic integrity failure',async()=>{
  const {state,adapter}=await setup({sensitive:false,imageError:true});try{await adapter.captureFailure(Error('original case failure'));assert.equal(state.screenshots,1);await assert.rejects(adapter.diagnostics(),/failure screenshot unavailable/)}finally{await adapter.dispose().catch(()=>{})}
})
test('clipboard resolves the lazy current Page target and never another focused browser client',async()=>{
  const {state,adapter}=await setup({clipboard:true});try{await adapter.setClipboardPermission('granted');const request=state.commands.find(x=>x.method==='Target.getTargetInfo');assert.deepEqual(request.params,{targetId:'test-target'});const grants=state.commands.filter(x=>x.method==='Browser.setPermission');assert(grants.length===2&&grants.every(x=>x.params.browserContextId==='owned-context'&&x.params.origin==='http://localhost:18128'))}finally{await adapter.dispose()}
})
test('missing browser permission method remains unexecuted, not passed, and does not fabricate a failed restoration',async()=>{
  const {state,adapter}=await setup({clipboard:true,missingPermission:true});await assert.rejects(adapter.setClipboardPermission('granted'),e=>e.code==='acceptance_contract_missing');const evidence=await adapter.diagnostics();assert(evidence.events.some(e=>e.kind==='tool-capability-unavailable'));assert(!evidence.events.some(e=>e.kind==='diagnostic-integrity-error'));await adapter.dispose();assert.equal(state.commands.filter(x=>x.method==='Browser.setPermission').length,1,'Never reset permissions that were not changed')
})
