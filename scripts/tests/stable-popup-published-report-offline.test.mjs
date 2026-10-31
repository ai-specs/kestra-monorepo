import test from 'node:test'
import assert from 'node:assert/strict'
import {assertStablePopupReferenceCases,stablePopupReferenceCaseName} from '../published-ui-browser-evidence.mjs'
const fixture=()=>['light','dark','dark-2','system'].map(theme=>({name:stablePopupReferenceCaseName,theme,width:1280,passed:true,evidence:{nativeTransitionsSettled:true,sameTriggerClosed:true,sameTriggerReopened:true,afterScrollClosed:true,triggerPopoverRelation:{trigger:'button owned by source root',ariaAttribute:'aria-describedby',ariaValue:'owned-popup',popoverId:'owned-popup'}}}))
test('published host stable trigger regressions require all four exact theme rows',()=>assert.equal(assertStablePopupReferenceCases(fixture()).length,4))
for(const [name,mutate]of [
 ['old60 gate without new rows',rows=>rows.splice(0)],
 ['missing theme',rows=>rows.pop()],
 ['duplicate theme',rows=>{rows[1].theme='light'}],
 ['incorrect viewport',rows=>{rows[0].width=390}],
 ['failed behavior',rows=>{rows[0].passed=false}],
 ['visible without native transition settlement',rows=>{rows[0].evidence.nativeTransitionsSettled=false}],
 ['same trigger reopens instead of closing',rows=>{rows[0].evidence.sameTriggerClosed=false}],
 ['missing reopen proof',rows=>{delete rows[0].evidence.sameTriggerReopened}],
 ['missing scroll proof',rows=>{delete rows[0].evidence.afterScrollClosed}],
 ['unrelated popover',rows=>{rows[0].evidence.triggerPopoverRelation.ariaValue='another-popup'}],
 ['no trigger identity',rows=>{delete rows[0].evidence.triggerPopoverRelation.trigger}],
])test(name+' cannot reuse historical geometry green',()=>{const rows=fixture();mutate(rows);assert.throws(()=>assertStablePopupReferenceCases(rows))})
