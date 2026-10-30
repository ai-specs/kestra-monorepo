import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {accessControlLocales,accessControlSupportedLocales} from './access-control-v3-ui.mjs'

const sha256=value=>createHash('sha256').update(value).digest('hex')
function flatten(value,path='',result={}) {
  if(typeof value==='string'){assert(value.trim(),'Empty translation: '+path);result[path]=value;return result}
  assert(value&&typeof value==='object'&&!Array.isArray(value),'Invalid translation: '+path)
  for(const [key,child]of Object.entries(value))flatten(child,path?path+'.'+key:key,result)
  return result
}
function placeholders(message) {
  const text=message.replace(/\\[{}]/g,'').replace(/\{'[^']*'\}/g,'')
  assert(!/\{\{/.test(text),'Nested interpolation braces')
  const names=[...text.matchAll(/\{([^{}]*)\}/g)].map(match=>match[1].trim())
  assert(names.every(name=>/^(?:[A-Za-z_$][\w$]*|\d+)$/.test(name)),'Invalid interpolation name')
  return [...new Set(names)].sort()
}
export function checkTranslationCatalogues(catalogues,requiredKeys=[]) {
  assert.deepEqual(Object.keys(catalogues).sort(),[...accessControlSupportedLocales].sort(),'All published locales required')
  const english=flatten(catalogues.en.en),keys=Object.keys(english).sort()
  assert(keys.length>0)
  for(const key of requiredKeys)assert(key in english,'UI lookup absent from every catalogue: '+key)
  return accessControlSupportedLocales.map(locale=>{
    assert.deepEqual(Object.keys(catalogues[locale]),[locale],'Locale wrapper differs: '+locale)
    const messages=flatten(catalogues[locale][locale])
    assert.deepEqual(Object.keys(messages).sort(),keys,'Translation keys differ: '+locale)
    for(const key of keys)assert.deepEqual(placeholders(messages[key]),placeholders(english[key]),'Translation placeholders differ: '+locale+':'+key)
    return {locale,keys:keys.length,missing:0,extra:0,empty:0,placeholderMismatches:0,fallbackRequired:false}
  })
}
export function checkPublishedTranslationSources({pluginRoot,pluginCommit,jarSha256}) {
  assert(/^[a-f0-9]{40}$/.test(pluginCommit));assert(/^[a-f0-9]{64}$/.test(jarSha256))
  const git=(...args)=>execFileSync('git',['-C',pluginRoot,...args],{encoding:'utf8',maxBuffer:16*1024*1024})
  const files=git('ls-tree','-r','--name-only',pluginCommit,'ui/src').trim().split('\n')
  const catalogues={},sourceHashes={},required=new Set()
  for(const locale of accessControlSupportedLocales){const path='ui/src/translations/'+locale+'.json',source=git('show',pluginCommit+':'+path);catalogues[locale]=JSON.parse(source);sourceHashes[path]=sha256(source)}
  for(const path of files.filter(path=>/\.(vue|js)$/.test(path))){const source=git('show',pluginCommit+':'+path);sourceHashes[path]=sha256(source);for(const match of source.matchAll(/\bt\(['"]([A-Za-z][A-Za-z0-9_]*)['"]/g))required.add(match[1])}
  const locales=checkTranslationCatalogues(catalogues,[...required])
  return {policy:'maintainer-2026-10-30-en-zh_CN-business-browser',pluginCommit,jarSha256,sourceHashes,locales,browserLocales:[...accessControlLocales],excludedBrowserLocales:accessControlSupportedLocales.filter(locale=>!accessControlLocales.includes(locale)).map(locale=>({locale,reason:'Maintainer excludes repeated business browser operations; translation keys and placeholders checked. Visual layout, translation quality and interaction in this locale are not claimed.'}))}
}
