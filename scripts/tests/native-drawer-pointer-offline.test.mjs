import test from 'node:test'
import assert from 'node:assert/strict'
import {nativeDrawerHeaderPoint,cardCountSpacingMeasurements} from '../access-control-v3-ui.mjs'

// Synthetic DOM negative inputs only. No browser clicks or UI acceptance here.
function scenario({count=1,disabled=false,inert=false,covered=false,wrongHit=false,left=722,visibility='visible'}={}){
 const button={disabled,getAttribute:()=>null,closest:()=>inert?{}:null,getClientRects:()=>[{}],getBoundingClientRect:()=>({left,top:17,width:30,height:20}),contains:n=>n===icon}
 const icon={},host={};const root={querySelectorAll:()=>Array(count).fill(button),elementFromPoint:()=>wrongHit?{}:icon};host.shadowRoot=root
 globalThis.document={querySelector:()=>host,querySelectorAll:root.querySelectorAll,elementFromPoint:()=>covered?{}:host}
 globalThis.getComputedStyle=()=>({visibility});globalThis.innerWidth=768;globalThis.innerHeight=900
 return {button,root,host,icon}
}
test.afterEach(()=>{for(const name of ['document','getComputedStyle','innerWidth','innerHeight'])delete globalThis[name]})
test('owned visible native close uses the fresh actual button center, not cached CSS coordinates',()=>{scenario();assert.deepEqual(nativeDrawerHeaderPoint(),{x:737,y:27,action:'close',shadow:true,rect:{left:722,top:17,width:30,height:20}})})
for(const [name,options]of [['duplicate',{count:2}],['missing',{count:0}],['disabled',{disabled:true}],['inert',{inert:true}],['covered by host alert',{covered:true}],['wrong inner hit',{wrongHit:true}],['outside viewport',{left:800}],['hidden',{visibility:'hidden'}]])test(name+' native drawer header cannot provide a pointer target',()=>{scenario(options);assert.throws(()=>nativeDrawerHeaderPoint())})
test('host native reference uses the same visible hit-tested coordinate contract',()=>{const {button}=scenario();globalThis.document.elementFromPoint=()=>button;assert.equal(nativeDrawerHeaderPoint({shadow:false}).x,737)})
test('unknown native header action fails closed before locating a control',()=>{scenario();assert.throws(()=>nativeDrawerHeaderPoint({action:'save'}))})
test('an exiting confirmation overlay is not clickable readiness; the same actual button becomes ready only after real hit-test clears',()=>{const {root,icon}=scenario({wrongHit:true});assert.equal(nativeDrawerHeaderPoint({readyOnly:true}),false);assert.throws(()=>nativeDrawerHeaderPoint(),/actual hit-test/);root.elementFromPoint=()=>icon;assert.equal(nativeDrawerHeaderPoint({readyOnly:true}).x,737)})
test('count spacing records computed CSS pixels rather than parsing a rem token as pixels',()=>{
 const text={nodeType:3,textContent:' scope'},count={textContent:'19',getBoundingClientRect:()=>({right:100})},label={childNodes:[count,text]},button={textContent:'19 scope',getClientRects:()=>[{}],querySelector:s=>s==='b'?count:label,getAttribute:()=> 'group-count-scopes'}
 globalThis.Node={TEXT_NODE:3};globalThis.document={querySelector:()=>({shadowRoot:{querySelectorAll:()=>[button]}}),createRange:()=>({setStart(){},setEnd(){},getBoundingClientRect:()=>({left:104})})};globalThis.getComputedStyle=()=>({columnGap:'4px',getPropertyValue:()=>'.25rem'})
 try{assert.deepEqual(cardCountSpacingMeasurements(),[{text:'19 scope',count:'19',gap:4,token:4,control:'group-count-scopes'}])}finally{delete globalThis.Node}
})
