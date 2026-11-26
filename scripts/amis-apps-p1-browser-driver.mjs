import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync,realpathSync,lstatSync} from 'node:fs'
import {resolve,join,isAbsolute,relative,dirname} from 'node:path'
import {spawn,execFileSync} from 'node:child_process'
import {pathToFileURL,fileURLToPath} from 'node:url'
import {createHash,createPublicKey,verify} from 'node:crypto'
import {classifyAccessControlDiagnostics} from './access-control-browser-diagnostics.mjs'
import {createEgoApplicationProjectAdapter,createPlaywrightApplicationProjectAdapter} from './application-project-browser-adapters.mjs'
import {verifyAmisBrowserRuntime} from './amis-apps-browser-driver.mjs'
import {runAmisP1BrowserCase} from './amis-apps-p1-browser.mjs'
const root=resolve(fileURLToPath(new URL('..',import.meta.url)))
function privateOptions(file) {
 assert(isAbsolute(file)&&realpathSync(file).startsWith(realpathSync(join(root,'.work'))+'/')&&!lstatSync(file).isSymbolicLink())
 assert.equal(lstatSync(file).mode&0o777,0o600);assert(lstatSync(file).isFile()&&lstatSync(file).uid===process.getuid())
 return JSON.parse(readFileSync(file))
}
export function verifyP1CredentialSubmission(events,base,subject) {
 assert.equal(new URL(base).origin,base)
 assert(typeof subject==='string'&&subject)
 const credential=events.find(event=>event.kind==='request'&&event.method==='POST'&&event.url===base+'/oidc/login')
 assert(credential?.requestId&&credential?.documentId,'Real browser credential submission absent')
 const response=events.find(event=>event.kind==='http-response'&&event.status===303&&event.requestId===credential.requestId&&event.documentId===credential.documentId&&event.url===credential.url)
 assert(response,'Real browser credential POST did not redirect successfully')
 return {subject,credentialsSubmitted:true,requestId:credential.requestId,documentId:credential.documentId,httpStatus:303,transport:'production-browser'}
}
// The raw UI credential stays in memory. Reports retain only verified public claims.
export function verifyP1UiIdentity(token,{base,subject,mode,jwks,now=Date.now()/1000}) {
 assert(typeof token==='string','Production UI identity absent')
 const segments=token.split('.');assert.equal(segments.length,3)
 const header=JSON.parse(Buffer.from(segments[0],'base64url'))
 assert.equal(header.alg,'RS256');assert(typeof header.kid==='string')
 const keys=jwks.keys.filter(key=>key.kid===header.kid&&key.kty==='RSA');assert.equal(keys.length,1)
 assert(verify('RSA-SHA256',Buffer.from(segments[0]+'.'+segments[1]),createPublicKey({key:keys[0],format:'jwk'}),Buffer.from(segments[2],'base64url')),'UI identity signature failed')
 const claims=JSON.parse(Buffer.from(segments[1],'base64url'))
 assert.equal(claims.sub,subject);assert.equal(claims.iss,base)
 const audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud]
 assert.deepEqual(audiences,['kestra-ui'])
 assert(Number.isFinite(claims.exp)&&claims.exp>now&&Number.isFinite(claims.iat)&&claims.iat<=now+30)
 const receipt={subject:claims.sub,issuer:claims.iss,audiences,signatureVerified:true}
 if(mode==='B') {
  const group=claims.kestra_application_group_v1
  assert.equal(group?.application_group_id,'main');assert.equal(group.client_id,'kestra-ui')
  assert(Number.isSafeInteger(group.authorization_version)&&group.authorization_version>0)
  assert(Array.isArray(group.application_group_scopes)&&group.application_group_scopes.every(x=>typeof x==='string'))
  receipt.applicationGroupId=group.application_group_id;receipt.authorizationVersion=group.authorization_version;receipt.applicationGroupScopes=group.application_group_scopes
 }
 return receipt
}
async function browserIdentity(page,kind,options,subject) {
 const cookies=kind==='ego'?(await page.cdp('Network.getCookies',{urls:[options.base]})).cookies:await page.context().cookies(options.base)
 const selected=cookies.filter(cookie=>cookie.name==='JWT');assert.equal(selected.length,1,'One actual UI credential required')
 const response=await fetch(options.base+'/.well-known/openid-configuration',{signal:AbortSignal.timeout(10000)})
 assert.equal(response.status,200);const metadata=await response.json();assert.equal(metadata.issuer,options.base)
 const url=new URL(metadata.jwks_uri);assert.equal(url.origin,options.base);assert(!url.username&&!url.password&&!url.hash)
 const keys=await fetch(url,{signal:AbortSignal.timeout(10000)});assert.equal(keys.status,200)
 return verifyP1UiIdentity(selected[0].value,{base:options.base,subject,mode:options.deployment.mode,jwks:await keys.json()})
}
export function retainP1BrowserEvidence(report,outputDirectory) {
 const assets=new Map()
 function normalize(value) {
  if(Array.isArray(value))return value.map(normalize)
  if(!value||typeof value!=='object')return value
  const item=Object.fromEntries(Object.entries(value).map(([key,v])=>[key,normalize(v)]))
  if(typeof item.path==='string'&&isAbsolute(item.path)&&(item.kind==='immutable-browser-diagnostics'||item.label&&item.createdAt)) {
   const file=realpathSync(item.path)
   assert(file.startsWith(realpathSync(outputDirectory)+'/')&&!lstatSync(item.path).isSymbolicLink(),'Browser evidence escaped owned output')
   const bytes=readFileSync(file),hash=createHash('sha256').update(bytes).digest('hex')
   if(item.sha256)assert.equal(item.sha256,hash)
   item.path=relative(dirname(realpathSync(outputDirectory)),file);item.sha256=hash
   assets.set(item.path,{path:item.path,sha256:hash})
  }
  return item
 }
 const retained=normalize(report)
 for(const ref of report.attachments??[]) {
  assert(typeof ref.path==='string'&&!isAbsolute(ref.path)&&!ref.path.includes('\\')&&!ref.path.split('/').some(x=>!x||x==='.'||x==='..'))
  const file=realpathSync(resolve(dirname(realpathSync(outputDirectory)),ref.path))
  assert(file.startsWith(realpathSync(outputDirectory)+'/'))
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),ref.sha256)
  assets.set(ref.path,{path:ref.path,sha256:ref.sha256})
 }
 retained.attachments=[...assets.values()]
 return retained
}
export async function runAmisP1OnPage(page,options,kind) {
 const value=privateOptions(options.privateFile)
 assert(isAbsolute(options.outputDirectory)&&resolve(options.outputDirectory).startsWith(join(root,'.work')+'/'))
 assert(value.account?.username&&value.account.password)
 mkdirSync(options.outputDirectory,{recursive:true,mode:0o700})
 assert(realpathSync(options.outputDirectory).startsWith(realpathSync(join(root,'.work'))+'/'))
 const adapter=await(kind==='ego'?createEgoApplicationProjectAdapter:createPlaywrightApplicationProjectAdapter)(page,{artifactDirectory:join(options.outputDirectory,'screenshots'),diagnosticDirectory:join(options.outputDirectory,'diagnostics'),timeoutMs:60000,secrets:[value.account.password]})
 const save=report=>writeFileSync(join(options.outputDirectory,'report.json'),JSON.stringify(retainP1BrowserEvidence(report,options.outputDirectory),null,2),{mode:0o600})
 try{
  // Ego retains cookies between calls; every case starts with a real logout.
  await adapter.goto(options.base+'/oidc/logout')
  const report=await runAmisP1BrowserCase(adapter,{...options,account:{...value.account,authenticated:false},onAuthenticated:()=>browserIdentity(page,kind,options,value.account.username),record:async report=>save(report)})
  const diagnostics=await adapter.diagnostics()
  report.productionLogin={...verifyP1CredentialSubmission(diagnostics.events,options.base,value.account.username),identity:report.identity}
  assert.equal(report.identity?.signatureVerified,true);assert.equal(report.identity.subject,value.account.username)
  const expected=[]
  if(options.id==='B-authenticated-refusal-has-no-delayed-effects')for(const event of diagnostics.events) {
   if(event.kind!=='http-error'||event.status!==403||event.method!=='GET')continue
   const url=new URL(event.url)
   if(url.origin!==options.base||!/^\/company\.amis\.a\/p1-async\/pages\/home$/.test(url.pathname)||url.search||url.hash)continue
   expected.push({requestId:event.requestId,source:{documentId:event.documentId},path:url.pathname,method:'GET',status:403,expectedStatuses:[403]})
  }
  const classified=classifyAccessControlDiagnostics({events:diagnostics.events,base:options.base,requests:expected})
  const finalEvidence=await adapter.diagnosticEvidenceReference()
  const fullDiagnostics=JSON.parse(readFileSync(finalEvidence.path))
  assert.equal(fullDiagnostics.events.length,finalEvidence.events)
  report.diagnostics={integrity:fullDiagnostics.integrity,classifications:classified.classifications,errors:classified.errors,finalEvidence}
  save(report)
  assert.deepEqual(fullDiagnostics.integrity,[],'Collector integrity failed')
  assert.deepEqual(classified.errors,[],'Unexpected browser errors; inspect retained report')
  const retained=retainP1BrowserEvidence(report,options.outputDirectory)
  writeFileSync(join(options.outputDirectory,'report.json'),JSON.stringify(retained,null,2),{mode:0o600});return retained
 }
 finally{await adapter.dispose()}
}
export async function runAmisP1BrowserDriver(options) {
 assert(!options.account&&!options.password&&!options.token,'Credentials must come from the private account file')
 privateOptions(options.privateFile)
 assert(['ego','playwright'].includes(options.driver))
 await verifyAmisBrowserRuntime(options,async(command,args)=>{try{return {code:0,stdout:execFileSync(command,args,{encoding:'utf8',timeout:30000,maxBuffer:8_000_000})}}catch{return {code:1,stdout:''}}})
 assert(isAbsolute(options.outputDirectory)&&resolve(options.outputDirectory).startsWith(join(root,'.work')+'/'))
 mkdirSync(options.outputDirectory,{recursive:true,mode:0o700})
 assert(realpathSync(options.outputDirectory).startsWith(realpathSync(join(root,'.work'))+'/'))
 if(options.driver==='playwright') {
  assert(isAbsolute(options.playwrightModule));const {chromium}=await import(pathToFileURL(options.playwrightModule).href)
  const browser=await chromium.launch({headless:true});let context
  try{context=await browser.newContext({locale:'en-US'});return await runAmisP1OnPage(await context.newPage(),options,'playwright')}
  finally{await context?.close();await browser.close()}
 }
 assert(Number.isSafeInteger(options.spaceId)&&/^p[1-9][0-9]*$/.test(options.pageLabel))
 const file=join(options.outputDirectory,'driver-options.private.json');writeFileSync(file,JSON.stringify(options),{mode:0o600})
 const source=`const fs=await import('node:fs');const {runAmisP1OnPage}=await import(${JSON.stringify(import.meta.url)});const o=JSON.parse(fs.readFileSync(${JSON.stringify(file)}));const spaces=await listTaskSpaces();if(!spaces.some(s=>s.id===o.spaceId&&s.ownership==='agent'))throw Error('Existing task-owned space required');const task=await taskSpace(o.spaceId);await runAmisP1OnPage(task.page(o.pageLabel),o,'ego');console.log('P1 browser case complete');`
 await new Promise((accept,reject)=>{const child=spawn('ego-browser',['nodejs'],{stdio:['pipe','pipe','pipe']});const timer=setTimeout(()=>child.kill('SIGTERM'),180000);let text='';child.stdout.on('data',b=>{text+=b;if(text.length>100000)child.kill()});child.stderr.on('data',()=>{});child.on('error',()=>{clearTimeout(timer);reject(Error('Ego child could not start'))});child.on('close',code=>{clearTimeout(timer);code===0?accept():reject(Error('P1 browser case failed; inspect retained case report'))});child.stdin.end(source)})
 return JSON.parse(readFileSync(join(options.outputDirectory,'report.json')))
}
