import test from 'node:test'
import assert from 'node:assert/strict'
import {checkTranslationCatalogues} from '../access-control-translation-coverage.mjs'
import {accessControlLocales,accessControlSupportedLocales,accessControlCaseIds} from '../access-control-v3-ui.mjs'

const catalogues=()=>Object.fromEntries(accessControlSupportedLocales.map(locale=>[locale,{[locale]:{title:'Title',count:'Count {count}'}}]))
test('business browser uses English/Chinese while published SDK retains thirteen locales',()=>{
  assert.deepEqual(accessControlLocales,['en','zh_CN'])
  assert.equal(accessControlSupportedLocales.length,13)
  assert.equal(accessControlCaseIds.filter(id=>id.startsWith('ui-theme-language-')).length,8)
  assert.equal(13+4*accessControlSupportedLocales.length*3*6,949)
})
test('complete catalogues satisfy static coverage without claiming browser behavior',()=>assert.equal(checkTranslationCatalogues(catalogues(),['title']).length,13))
for(const [name,mutate]of [
  ['missing locale',data=>{delete data.de}],
  ['missing key',data=>{delete data.de.de.title}],
  ['extra key',data=>{data.de.de.extra='Unexpected'}],
  ['empty translation',data=>{data.de.de.title=' '}],
  ['placeholder mismatch',data=>{data.de.de.count='Count {other}'}],
  ['invalid placeholder',data=>{data.de.de.count='Count {bad-name}'}],
])test(name+' rejects static acceptance',()=>{const data=catalogues();mutate(data);assert.throws(()=>checkTranslationCatalogues(data))})
test('lookup absent in every language cannot pass matching catalogue keys',()=>assert.throws(()=>checkTranslationCatalogues(catalogues(),['missingEverywhere'])))
