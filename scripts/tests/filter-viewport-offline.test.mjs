import test from 'node:test'
import assert from 'node:assert/strict'
import {desktopFilterViewportReady,desktopFilterBoundaryScroll} from '../access-control-v3-ui.mjs'

// Predicate-only regression tests; these do not claim real browser acceptance.
function ready({anchorLeft=200,panelLeft=200,panelWidth=720,panelTop=138,panelHeight=100,anchorTop=100,anchorBottom=132,limit='630px',offsetLeft=0}={}) {
  const saved=Object.fromEntries(['document','visualViewport','innerWidth','innerHeight','getComputedStyle'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]))
  const panel={getAnimations:()=>[],scrollHeight:panelHeight,getBoundingClientRect:()=>({left:panelLeft,right:panelLeft+panelWidth,top:panelTop,bottom:panelTop+panelHeight,width:panelWidth,height:panelHeight})}
  const anchor={getBoundingClientRect:()=>({left:anchorLeft,top:anchorTop,bottom:anchorBottom})}
  Object.assign(globalThis,{document:{querySelector:()=>({shadowRoot:{querySelector:selector=>selector==='.adv-builder'?panel:anchor}})},visualViewport:{offsetLeft,offsetTop:0,width:1280,height:900},innerWidth:1280,innerHeight:900,getComputedStyle:()=>({maxHeight:limit})})
  try{return desktopFilterViewportReady()}finally{for(const [key,descriptor]of Object.entries(saved))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}
}
test('desktop below gap follows its owned anchor',()=>assert.equal(ready(),true))
test('visible panel at another filter anchor is rejected',()=>assert.equal(ready({panelLeft:300}),false))
test('right edge clamps relative to current viewport',()=>assert.equal(ready({anchorLeft:1100,panelLeft:552}),true))
test('visual viewport horizontal offset participates in the clamp',()=>assert.equal(ready({offsetLeft:50,anchorLeft:0,panelLeft:58}),true))
test('bottom anchor flips above',()=>assert.equal(ready({anchorTop:848,anchorBottom:880,panelTop:742}),true))
test('old offscreen bottom panel fails',()=>assert.equal(ready({anchorTop:848,anchorBottom:880,panelTop:886}),false))
test('zero width is not usable',()=>assert.equal(ready({panelWidth:0}),false))
test('zero height limit is not usable',()=>assert.equal(ready({limit:'0px'}),false))

function scrollScenario(run,{scrollTop=1000}={}) {
  const keys=['document','innerHeight','getComputedStyle'],saved=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)])),commands=[]
  const owner={tagName:'MAIN',id:'layout',scrollTop,scrollLeft:12,scrollHeight:2400,clientHeight:900,parentElement:null,getRootNode:()=>({}),scrollTo:options=>{commands.push(options);owner.scrollTop=options.top}}
  const host={parentElement:owner,tagName:'DIV',getRootNode:()=>({})}
  const anchor={parentElement:null,tagName:'BUTTON',getRootNode:()=>({host}),getBoundingClientRect:()=>({bottom:450})}
  host.shadowRoot={querySelector:()=>anchor}
  Object.assign(globalThis,{document:{querySelector:()=>host,scrollingElement:null},innerHeight:900,getComputedStyle:node=>({overflowY:node===owner?'auto':'visible'})})
  try{return run({owner,commands})}finally{for(const [key,descriptor]of Object.entries(saved))if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}
}
test('boundary stimulus traverses the shadow host and scrolls only the existing owner',()=>scrollScenario(({commands})=>{
  const token=desktopFilterBoundaryScroll();assert.equal(token.index,2);assert.equal(token.top,1000);assert.deepEqual(commands,[{top:570,left:12,behavior:'instant'}])
  assert.deepEqual(desktopFilterBoundaryScroll(token),{restored:true});assert.deepEqual(commands[1],{top:1000,left:12,behavior:'instant'})
}))
test('unreachable boundary fails rather than mutating layout styles',()=>scrollScenario(({commands})=>{
  assert.throws(()=>desktopFilterBoundaryScroll(),/No existing host scroll owner/);assert.deepEqual(commands,[])
},{scrollTop:0}))
test('changed scroll owner refuses restoration',()=>scrollScenario(({owner,commands})=>{
  const token=desktopFilterBoundaryScroll();owner.id='different';assert.throws(()=>desktopFilterBoundaryScroll(token),/scroll owner changed/);assert.equal(commands.length,1)
}))
