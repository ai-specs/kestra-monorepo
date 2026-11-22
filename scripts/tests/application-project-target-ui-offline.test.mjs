import test from 'node:test'
import assert from 'node:assert/strict'
import {visibleNativeFlowCell,waitForNativeFlowCell} from '../application-project-target-ui.mjs'

function fakeDocument({cellText='ui-reference-row',namespace='company.sub',visible=true,shadow=true}) {
  const rect=()=>visible?[{}]:[]
  const cell={textContent:cellText,getClientRects:rect}
  const row={getClientRects:rect,querySelectorAll:()=>[cell,{textContent:namespace,getClientRects:rect}]}
  const shadowRoot={querySelectorAll:selector=>selector==='*'?[]:[row]}
  const host={shadowRoot:shadow?shadowRoot:null}
  return {
    querySelectorAll:selector=>selector==='*'?[host]:shadow?[row]:[]
  }
}

test('native Flow readiness traverses a visible cell in an open shadow root',()=> {
  const previous={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle}
  globalThis.location={pathname:'/ui/main/flows'}
  globalThis.getComputedStyle=()=>({visibility:'visible',display:'table-cell'})
  globalThis.document=fakeDocument({})
  try {
    assert.equal(visibleNativeFlowCell({id:'ui-reference-row',namespace:'company.sub'}),true)
    globalThis.document=fakeDocument({cellText:'another-flow'});assert.equal(visibleNativeFlowCell({id:'ui-reference-row',namespace:'company.sub'}),false)
    globalThis.document=fakeDocument({namespace:'outside'});assert.equal(visibleNativeFlowCell({id:'ui-reference-row',namespace:'company.sub'}),false)
    globalThis.document=fakeDocument({visible:false});assert.equal(visibleNativeFlowCell({id:'ui-reference-row',namespace:'company.sub'}),false)
    globalThis.document=fakeDocument({cellText:''});assert.equal(visibleNativeFlowCell({id:'ui-reference-row',namespace:'company.sub'}),false)
    globalThis.document=fakeDocument({shadow:false});assert.equal(visibleNativeFlowCell({id:'ui-reference-row',namespace:'company.sub'}),false)
    globalThis.document=fakeDocument({});globalThis.location.pathname='/ui/main/dashboards';assert.equal(visibleNativeFlowCell({id:'ui-reference-row',namespace:'company.sub'}),false)
  } finally {for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}
})

test('target UI uses the shadow-aware native Flow readiness helper',async()=> {
  const previous={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle}
  const calls=[]
  globalThis.location={pathname:'/ui/main/flows'}
  globalThis.getComputedStyle=()=>({visibility:'visible',display:'table-cell'})
  globalThis.document=fakeDocument({})
  try {await waitForNativeFlowCell({waitForFunction:async (callback,target)=>{calls.push(callback);return callback(target)}},{id:'ui-reference-row',namespace:'company.sub'})}
  finally {for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}
  assert.equal(calls.length,1);assert.equal(calls[0].name,'visibleNativeFlowCell')
})
