import test from 'node:test'
import assert from 'node:assert/strict'
import {derive} from '../access-control-v3-gates.mjs'

// Synthetic evidence verifies rejection paths, not production browser behavior.
function fixture() {
  const observations=['light','dark','dark-2','system'].map(theme=>({theme,kind:'permissions',reopening:0,desktopBottomBoundary:{clearClicked:true,closeClicked:true,scroll:{index:3,stimulus:'explicit existing host-layout scroll; no style or business-state mutation'},viewport:{height:900,width:1280},anchor:{top:848,bottom:880},panel:{top:600,bottom:842,width:720,height:242}}}))
  observations.push(...Array.from({length:44},()=>({})))
  return {ui:[{id:'ui-native-filter-popup-geometry',passed:true,status:'passed',evidence:{source:'real-native-filter-clicks-and-geometry',locations:4,themes:4,observations}}]}
}
const status=report=>derive(report).find(row=>row.id==='access-control-v3-T11').evidence.requiredInputs.find(row=>row.id==='report.ui:ui-native-filter-popup-geometry').status
test('four explicit production boundary records satisfy only the geometry input',()=>assert.equal(status(fixture()),'passed'))
for(const [name,mutate] of [
  ['historical green without boundary',r=>{for(const o of r.ui[0].evidence.observations)delete o.desktopBottomBoundary}],
  ['duplicate theme',r=>{r.ui[0].evidence.observations[1].theme='light'}],
  ['unknown theme',r=>{r.ui[0].evidence.observations[1].theme='invented'}],
  ['missing numeric geometry',r=>{delete r.ui[0].evidence.observations[0].desktopBottomBoundary.panel.bottom}],
  ['offscreen Clear region',r=>{r.ui[0].evidence.observations[0].desktopBottomBoundary.panel.bottom=980}],
  ['click not actually executed',r=>{r.ui[0].evidence.observations[0].desktopBottomBoundary.clearClicked=false}],
  ['invented layout mutation',r=>{r.ui[0].evidence.observations[0].desktopBottomBoundary.scroll.stimulus='set inline style'}],
])test(name+' cannot satisfy geometry gate',()=>{const r=fixture();mutate(r);assert.notEqual(status(r),'passed')})
