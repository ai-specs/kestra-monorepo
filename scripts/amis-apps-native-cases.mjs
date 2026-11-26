import {createHash} from 'node:crypto'
const check = (condition, message) => { if (!condition) throw new Error(message) }
const counters = ['flowLookup','flowMeta','schemaStorage','storageCalls','namespaceResolve','flowAuthorization']
const listeners = ['flowRepositoryListener','flowMetaStoreListener','namespaceFactoryListener','storageListener','authorizationListener']
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const safePath = path => typeof path === 'string' && path.startsWith('/') && !/[?%#\\\s]/.test(path) && !path.includes('//') && !path.split('/').some(part => part === '.' || part === '..')
const nativePaths = ['/ui/main/page/x','/ui-extensions/app/pages/x','/api/v1/api/x','/oidc/app/pages/x','/oauth/app/pages/x','/.well-known/app/pages/x','/static/app/pages/x','/swagger/app/pages/x','/ping']
export function classifyAmisNativePath(path) {
  if (path === '/ui/main/page/x') return 'ui'
  if (safePath(path) && /^\/ui-extensions\/[A-Za-z0-9_-]+\/pages\/x$/.test(path)) return 'ui-extensions'
  const index = nativePaths.indexOf(path)
  return index >= 2 ? path.split('/')[1] : null
}
function snapshot(raw) {
  check(raw && raw.integrity === 'ok' && typeof raw.generation === 'string' && raw.generation.length > 0 && listeners.every(key => raw.readiness?.[key] === true), 'Live probe not ready')
  check(counters.every(key => Number.isSafeInteger(raw[key]) && raw[key] >= 0), 'Invalid live probe counts')
  return {generation:raw.generation, readiness:Object.fromEntries(listeners.map(key => [key,true])), counts:Object.fromEntries(counters.map(key => [key,raw[key]]))}
}
async function run(options, name, action, zero) {
  const report = {case:name,mode:options.mode,scope:'HTTP observations only; no browser render or production identity proof',status:'running',checks:[],failure:null}
  const persist = async () => options.persist(structuredClone(report))
  const step = async (id, fn) => {
    const row = {id,status:'running'};report.checks.push(row)
    try { row.evidence = await fn();row.status='passed';await persist() }
    catch { row.status='failed';throw new Error(id+' failed') }
  }
  try {
    check(['A','B'].includes(options.mode) && typeof options.persist === 'function', 'Explicit mode/persist required')
    const url = new URL(options.base); check(url.origin === options.base && ['http:','https:'].includes(url.protocol), 'Exact origin required')
    check(options.identityEvidence?.authenticated === true && typeof options.identityEvidence.subject === 'string' && options.identityEvidence.subject, 'Caller production identity evidence required')
    const before = snapshot(await options.probe.snapshot()); report.before=before
    await action(step)
    const after = snapshot(await options.probe.snapshot());report.after=after
    check(before.generation === after.generation, 'Probe generation changed')
    report.delta=Object.fromEntries(counters.map(key => {const delta=after.counts[key]-before.counts[key];check(delta>=0 && (!zero || delta===0), 'Unexpected probe count');return [key,delta]}))
    report.status='passed'
  } catch (error) { report.status='failed'; report.failure=/^(Live probe|Invalid live|Probe generation|Unexpected probe|Caller production|Exact origin|Explicit mode)/.test(error.message)?error.message:'Request-layer assertion failed: '+(report.checks.find(row=>row.status==='failed')?.id ?? 'input') }
  if (typeof options.persist === 'function') await persist()
  return report
}
async function get(client,path,method='GET') {
  return client.request(path,{method,redirect:'manual',signal:AbortSignal.timeout(30_000)})
}
export async function runAmisNativeCases(options) {
  return run(options,'native-controller-static-oauth-and-alias-precedence',async step=>{
    check(Array.isArray(options.nativeCases), 'Native cases required')
    const classes=options.nativeCases.map(row=>classifyAmisNativePath(row.path))
    check(classes.every(Boolean) && new Set(classes).size===9 && classes.length===9,'Exact native matrix required')
    for(const row of options.nativeCases) {
      check(Number.isInteger(row.status) && row.status>=200 && row.status<=599 && typeof row.contentType==='string' && row.contentType.length>0,'Explicit native status/MIME required')
      if(row.path==='/ui/main/page/x') check(row.status===200 && /text\/html/.test(row.contentType) && row.marker,'Explicit native SPA marker required')
      await step(row.path,async()=>{
        const response=await get(options.authClient,row.path),bytes=Buffer.from(await response.arrayBuffer())
        check(response.status===row.status && response.headers.get('content-type')===row.contentType,'Native response mismatch')
        const text=bytes.toString('utf8');check(!text.includes('amis-bootstrap'),'AMIS intercepted native path')
        if(row.marker)check(text.includes(row.marker),'Native marker missing')
        return {path:row.path,status:response.status,contentType:row.contentType,sha256:digest(bytes)}
      })
    }
  },true)
}
function attributes(tag) {
  const attrs={};const rest=tag.replace(/^<\/?[A-Za-z]+\b/,'').replace(/\/?\s*>$/,'')
  const pattern=/\s+([A-Za-z][A-Za-z0-9_-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g
  let match;while((match=pattern.exec(rest))) {check(!Object.hasOwn(attrs,match[1].toLowerCase()),'Duplicate HTML attribute');attrs[match[1].toLowerCase()]=match[2]??match[3]??''}
  check(rest.replace(pattern,'').trim()==='', 'Unsupported HTML attributes')
  return attrs
}
export async function runAmisAssetCases(options) {
  return run(options,'declared-runtime-assets-authenticated-and-loadable',async step=>{
    const {namespace,flowId,pageId,expectedPublishedAssets: manifest}=options
    check(typeof namespace==='string' && namespace.length<=150 && /^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*$/.test(namespace) && typeof flowId==='string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(flowId) && /^[A-Za-z0-9_][A-Za-z0-9_-]{0,99}$/.test(pageId),'Invalid target')
    check(manifest?.version===1 && manifest.entry==='index.html' && manifest.assets?.['index.html'] && options.anonymousTransport,'Exact published manifest/anonymous transport required')
    const prefix=`/${namespace}/${flowId}/`, assetPrefix=prefix+'assets/'
    const entries=Object.entries(manifest.assets).filter(([key])=>key!=='index.html')
    check(entries.length>0 && entries.length<=2048,'Empty asset manifest')
    for(const [key,value]of entries) check(key.startsWith('assets/') && safePath('/'+key) && /^assets\/[A-Za-z0-9_/-]+(?:[.][A-Za-z0-9_-]+)*$/.test(key) && /^[a-f0-9]{64}$/.test(value.sha256) && typeof value.contentType==='string' && !/html|json/i.test(value.contentType),'Invalid manifest entry')
    await step('page-html-tags',async()=>{
      const response=await get(options.authClient,prefix+'pages/'+pageId),html=await response.text()
      check(response.status===200 && /^text\/html\b/.test(response.headers.get('content-type')??''),'Page is not HTML')
      // Only standard build tags are inspected; script bodies are never parsed as HTML or executed.
      const stripped=html.replace(/<!--[\s\S]*?-->/g,'').replace(/(<script\b[^>]*>)[\s\S]*?<\/script\s*>/gi,'$1</script>')
      const bases=[...stripped.matchAll(/<base\b[^>]*>/gi)].map(match=>attributes(match[0]))
      check(bases.length===1 && bases[0].href===prefix,'Unexpected HTML base')
      const references=[]
      for(const match of stripped.matchAll(/<(script|link)\b[^>]*>/gi)) {
        const attrs=attributes(match[0]),script=match[1].toLowerCase()==='script'
        if(script && !Object.hasOwn(attrs,'src'))continue
        if(!script && !['stylesheet','modulepreload','preload'].includes(attrs.rel))continue
        const raw=attrs[script?'src':'href'];check(typeof raw==='string' && !/[?%#\\&\s]/.test(raw)
          && !raw.split('/').some(part=>part==='.'||part==='..') && !raw.replace(/^https?:\/\//,'').includes('//'),'Invalid asset tag reference')
        const url=new URL(raw,options.base+prefix)
        check(url.origin===options.base && safePath(url.pathname) && url.pathname.startsWith(assetPrefix),'Foreign or non-asset reference')
        const key=url.pathname.slice(prefix.length);check(Object.hasOwn(manifest.assets,key),'Undeclared HTML asset');references.push(key)
      }
      check(references.some(key=>/javascript/.test(manifest.assets[key].contentType)) && references.some(key=>/text\/css/.test(manifest.assets[key].contentType)),'Script/CSS tags missing')
      return {path:prefix+'pages/'+pageId,status:response.status,references}
    })
    for(const [key,descriptor]of entries) await step(key,async()=>{
      const path=prefix+key,response=await get(options.authClient,path),bytes=Buffer.from(await response.arrayBuffer())
      check(response.status===200 && response.headers.get('content-type')===descriptor.contentType && response.headers.get('cache-control')==='no-store','Asset status/MIME/cache mismatch')
      check(digest(bytes)===descriptor.sha256,'Asset hash mismatch')
      if(/javascript|text\/css/.test(descriptor.contentType))check(!/^\s*(?:<!doctype|<html|<form|[{[])/i.test(bytes.toString('utf8')),'Login HTML/JSON substituted')
      const length=response.headers.get('content-length');check(length===String(bytes.length),'GET content length mismatch')
      const head=await get(options.authClient,path,'HEAD');check(head.status===200 && head.headers.get('content-length')===length && head.headers.get('content-type')===descriptor.contentType && head.headers.get('cache-control')==='no-store' && (await head.arrayBuffer()).byteLength===0,'HEAD mismatch')
      const anonymous=await options.anonymousTransport(options.base+path,{method:'GET',redirect:'manual',credentials:'omit',headers:{},signal:AbortSignal.timeout(30_000)})
      check(anonymous.status===401 && !anonymous.headers.get('location'),'Anonymous asset not rejected')
      return {path,status:200,sha256:descriptor.sha256,contentType:descriptor.contentType,bytes:bytes.length,headStatus:head.status,anonymousStatus:anonymous.status}
    })
    for(const suffix of ['assets/','assets/index.html','assets/runtime-manifest.json']) await step('not-public-'+suffix,async()=>{
      const response=await get(options.authClient,prefix+suffix);check(response.status===404,'Internal asset entry exposed');return {path:prefix+suffix,status:response.status}
    })
  },false)
}
