import test from 'node:test'
import assert from 'node:assert/strict'
import {derive} from '../access-control-v3-gates.mjs'

// Synthetic negative report inputs only, never counted as real UI acceptance.
const style={paddingTop:'20px',paddingRight:'20px',paddingBottom:'20px',paddingLeft:'20px',fontFamily:'Inter',fontSize:'14px',fontWeight:'400',color:'rgb(0,0,0)',backgroundColor:'rgb(255,255,255)'}
function fixture(){return {ui:[{name:'ui-four-drawers-theme-language-light-en',passed:true,status:'passed',evidence:{drawers:[1280,768,390].flatMap(width=>['group','user','permission','subject'].map(kind=>{const view={nativeForm:true,viewport:{width},drawer:{bottom:900},header:{style:{...style}},body:{style:{...style}},footer:{style:{...style},rect:{bottom:900}},save:{nativeIcon:true,gap:6,paths:['save-path']},icons:{expand:['expand-path'],close:['close-path']}};return {kind,width,nativeParity:structuredClone(view),nativeReference:structuredClone(view)}}))}}]}}
function status(report,id='ui-four-drawers-theme-language-light-en'){const gate=derive(report).find(row=>row.id==='access-control-v3-T11');return gate.evidence.requiredInputs.find(row=>row.id==='report.ui:'+id)?.status}
test('complete 4 drawer by 3 width real-shaped reference evidence satisfies only its own named input',()=>assert.equal(status(fixture()),'passed'))
for(const [name,mutate]of [
  ['missing narrow drawer',r=>r.ui[0].evidence.drawers.pop()],
  ['repeated identity',r=>{r.ui[0].evidence.drawers[1]=r.ui[0].evidence.drawers[0]}],
  ['different body inset',r=>{r.ui[0].evidence.drawers[0].nativeParity.body.style.paddingRight='0px'}],
  ['missing style bodies',r=>{for(const v of ['nativeParity','nativeReference'])r.ui[0].evidence.drawers[0][v].body={}}],
  ['text instead of SVG',r=>{r.ui[0].evidence.drawers[0].nativeParity.icons.expand=[]}],
  ['footer in content flow',r=>{r.ui[0].evidence.drawers[0].nativeParity.footer.rect.bottom=326}],
  ['slot save icon without native wrapper',r=>{r.ui[0].evidence.drawers[0].nativeParity.save.nativeIcon=false}],
  ['joined save icon and label',r=>{r.ui[0].evidence.drawers[0].nativeParity.save.gap=0}],
  ['different save SVG',r=>{r.ui[0].evidence.drawers[0].nativeParity.save.paths=['other-path']}],
])test(name+' cannot satisfy native drawer parity',()=>{const r=fixture();mutate(r);assert.notEqual(status(r),'passed')})
test('card accessible whitespace alone with zero measured Range gap cannot pass',()=>{const r={ui:[{name:'ui-four-tabs-cards-counts',passed:true,status:'passed',evidence:{countSpacing:['scope','Applications','subject'].map(unit=>({text:'54 '+unit,count:'54',gap:0,token:4}))}}]};const t=derive(r).find(row=>row.id==='access-control-v3-T1').evidence.requiredInputs.find(row=>row.id==='report.ui:ui-four-tabs-cards-counts');assert.notEqual(t.status,'passed')})
function cardFixture(){return {ui:[{name:'ui-four-tabs-cards-counts',passed:true,status:'passed',evidence:{countSpacing:['scope','Applications','subject'].map(unit=>({text:'54 '+unit,count:'54',gap:4,token:4})),headingLayout:[{vertical:true,nameGap:8,badgeGap:12}]}}]}}
function cardStatus(r){return derive(r).find(row=>row.id==='access-control-v3-T1').evidence.requiredInputs.find(row=>row.id==='report.ui:ui-four-tabs-cards-counts').status}
test('measured card count gap and distinct vertical heading satisfy only their named input',()=>assert.equal(cardStatus(cardFixture()),'passed'))
test('missing measured card heading cannot reuse the old count-only green report',()=>{const r=cardFixture();delete r.ui[0].evidence.headingLayout;assert.notEqual(cardStatus(r),'passed')})
test('joined card title/name cannot pass despite positive count unit spacing',()=>{const r=cardFixture();r.ui[0].evidence.headingLayout[0].nameGap=-12;assert.notEqual(cardStatus(r),'passed')})
function localizedCards(){return {ui:[{name:'ui-theme-language-light-en',passed:true,status:'passed',evidence:{layouts:[1280,768,390].flatMap(width=>[{path:'application-groups',width,...structuredClone(cardFixture().ui[0].evidence)},{path:'application-groups',viewport:width,documentWidth:width,left:0,right:width,text:'Actual card content'}])}}]}}
function localizedCardStatus(r){return derive(r).find(row=>row.id==='access-control-v3-T11').evidence.requiredInputs.find(row=>row.id==='report.ui:ui-theme-language-light-en').status}
test('localized card evidence requires all three actual viewport layouts',()=>assert.equal(localizedCardStatus(localizedCards()),'passed'))
for(const [name,mutate]of [
 ['missing layout',r=>{delete r.ui[0].evidence.layouts}],
 ['missing narrow viewport',r=>r.ui[0].evidence.layouts.splice(4,2)],
 ['duplicate viewport',r=>{r.ui[0].evidence.layouts[4].width=768}],
 ['missing counts',r=>{delete r.ui[0].evidence.layouts[0].countSpacing}],
 ['joined units',r=>{r.ui[0].evidence.layouts[0].countSpacing[0].gap=0}],
 ['missing heading',r=>{delete r.ui[0].evidence.layouts[0].headingLayout}],
 ['joined localized heading',r=>{r.ui[0].evidence.layouts[0].headingLayout[0].nameGap=-4}],
])test(name+' cannot reuse a localized green row as new native card evidence',()=>{const r=localizedCards();mutate(r);assert.notEqual(localizedCardStatus(r),'passed')})
function maximizedFixture(){return {ui:[{name:'ui-drawer-group-maximize',passed:true,status:'passed',evidence:{source:'actual-native-drawer-geometry',initial:{width:800,left:480,right:1280,viewport:1280},restored:{width:800,left:480,right:1280,viewport:1280},maximized:{width:1267.2,left:12.8,right:1280,viewport:1280},nativeMaximized:{width:1267.2,left:12.8,right:1280,viewport:1280}}}]}}
function maximizeStatus(r){return derive(r).find(row=>row.id==='access-control-v3-T12').evidence.requiredInputs.find(row=>row.id==='report.ui:ui-drawer-group-maximize').status}
test('actual native 99-percent maximization passes by matching the measured KV reference',()=>assert.equal(maximizeStatus(maximizedFixture()),'passed'))
for(const [name,mutate]of [['missing native reference',r=>{delete r.ui[0].evidence.nativeMaximized}],['invented 100-percent reference parity',r=>{r.ui[0].evidence.maximized={width:1280,left:0,right:1280,viewport:1280}}],['not restored',r=>{r.ui[0].evidence.restored.width=1267.2}]] )test(name+' cannot satisfy native maximize evidence',()=>{const r=maximizedFixture();mutate(r);assert.notEqual(maximizeStatus(r),'passed')})
