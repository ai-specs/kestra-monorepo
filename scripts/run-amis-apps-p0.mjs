import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {mkdirSync, readFileSync, writeFileSync, realpathSync, lstatSync, existsSync} from 'node:fs'
import {resolve, dirname, join, sep, extname, isAbsolute} from 'node:path'
import {fileURLToPath} from 'node:url'
import {setTimeout as wait} from 'node:timers/promises'
import {amisP0Cases, amisP0NoEffectCases, amisP0ZeroLookupCases} from './amis-apps-acceptance-cases.mjs'
import {createAmisP0Recorder} from './amis-apps-evidence.mjs'
import {validateAmisP0Report, verifyAmisEvidenceFiles} from './check-amis-apps-report.mjs'
import {validateAmisPublishedRelease} from './amis-apps-release.mjs'
import {createAmisProductionEnvironment} from './amis-apps-production-environment.mjs'
import {runAmisBrowserDriver} from './amis-apps-browser-driver.mjs'
import {runAmisPermissionCases} from './amis-apps-permission-cases.mjs'
import {runAmisSecurityCases} from './amis-apps-security-cases.mjs'
import {runAmisSyncCases} from './amis-apps-sync-cases.mjs'
import {runAmisRevocationCases} from './amis-apps-revocation-cases.mjs'
import {runAmisNativeCases, runAmisAssetCases} from './amis-apps-native-cases.mjs'
import {runAmisFaultCases} from './amis-apps-fault-cases.mjs'
import {verifyAmisQueueObservation} from './amis-apps-observer-control.mjs'
import {amisApiPath, invokeAmisApi} from './amis-apps-http.mjs'
import {amisFixtureFlow} from './amis-apps-fixture.mjs'
import {collectAmisSourceEvidence} from './amis-apps-source-evidence.mjs'
import {runAmisBodyCases} from './amis-apps-body-cases.mjs'
import {createAmisUiOAuth} from './amis-apps-ui-oauth.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const defaultExecute = (command, args) => execFileSync(command, args, {encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024})
const target = {namespace:'company.amis.a',flowId:'greeting',pageId:'home',apiId:'greet'}
const counters = {namespace:'namespaceResolve',flow:'flowLookup',schema:'schemaStorage',flowAuthorization:'flowAuthorization'}

function descendant(path, parent) {
  const actual=realpathSync(path)
  assert(actual.startsWith(realpathSync(parent)+sep),'Evidence escapes owned directory')
  assert(!lstatSync(path).isSymbolicLink(),'Symlink evidence forbidden')
  return actual
}
function successful(row) {
  const incomplete=value=>value&&typeof value==='object'&&(
    ['failed','not_run','notRun','running'].includes(value.status)||value.completed===false||value.passed===false
    ||Object.values(value).some(child=>child&&typeof child==='object'&&incomplete(child)))
  return Boolean(row&&!incomplete(row)&&(row.status==='passed'||row.status===undefined&&row.completed===true))
}
function assertPassed(row) { assert(successful(row),'Case has no completed successful observation') }
function findEffects(value, found=[]) {
  if(value&&typeof value==='object') {
    if(value.beforeSources&&value.samples&&value.windowMs!==undefined) found.push(value)
    else for(const child of Object.values(value))findEffects(child,found)
  }
  return found
}
function safetyFields(id, row) {
  const result={}
  if(amisP0NoEffectCases.includes(id)) {
    const observations=findEffects(row)
    assert(observations.length,'Missing real delayed side-effect evidence')
    for(const observed of observations) {
      assert(observed.windowMs>=5000&&observed.immediate===observed.before)
      assert(observed.samples.length&&observed.samples.at(-1).elapsedMs>=observed.windowMs)
      for(const sample of observed.samples) {
        assert.equal(sample.hash,observed.before)
        for(const source of ['database','queue','storage'])assert.equal(sample.sources[source],observed.beforeSources[source])
      }
    }
    const observed=observations[0]
    result.sideEffects={windowMs:observed.windowMs,before:observed.beforeSources,after:observed.samples.at(-1).sources}
  }
  if(amisP0ZeroLookupCases.includes(id)) {
    const observations=row.observations?.filter(observed => observed.kind === 'deny')
    assert(observations?.length,'Probe observations missing')
    for(const observed of observations) {
      assert.equal(observed.zeroLookups, true, 'Zero-lookup matrix row must bind an actual first-gate denial')
      assert(observed.completed&&observed.before?.generation===observed.after?.generation)
      for(const counter of [...Object.values(counters),'flowMeta'])assert.equal(observed.difference?.[counter],0)
    }
    result.lookups=Object.fromEntries(Object.keys(counters).map(key=>[key,0]))
    result.lookupEvidence='instrumented-public-contract-probe'
  }
  return result
}

/** Real production orchestration by default. All injected functions are explicit
 * test transports and require synthetic:true; they cannot emit a production pass.
 * Native/fault expectations are caller-supplied contract inputs, never learned
 * from the response under test. No fragment or case may be omitted.
 */
export async function runAmisP0(options, dependencies={}) {
  const synthetic=options.synthetic===true
  assert(!Object.keys(dependencies).length||synthetic,'Injected transports require synthetic:true')
  const execute=dependencies.execute??defaultExecute
  const moduleFns={permission:runAmisPermissionCases,security:runAmisSecurityCases,sync:runAmisSyncCases,
    revocation:runAmisRevocationCases,native:runAmisNativeCases,assets:runAmisAssetCases,fault:runAmisFaultCases,body:runAmisBodyCases,...dependencies.fragments}
  const directory=resolve(options.directory)
  assert(directory.startsWith(join(root,'.work')+sep))
  assert.equal(realpathSync(dirname(directory)),dirname(directory))
  mkdirSync(directory,{mode:0o700})
  const initial={schemaVersion:1,stage:'P0',status:'running',completed:false,synthetic,cases:amisP0Cases.map(id=>({id,status:'notRun'})),
    note:'Matrix order is report order, not fragment invocation order.'}
  writeFileSync(join(directory,'bootstrap-report.json'),JSON.stringify(initial,null,2),{mode:0o600,flag:'wx'})
  let env,recorder,primaryFailure,cleanupFailure,finalReport,transportEvidence
  const validationFailures=[]
  let sourceState
  const resources=new Map(),outcomes=new Map(),fragments=new Map(),events=[]
  const browserFiles=new Map(),allBrowserAttachments=[]
  let currentMode
  options={...options,nativeCases:options.expected?.nativeCases,expectedFaultStatuses:options.expected?.faultStatuses,
    faultNativeCases:options.expected?.faultNativeCases,
    zeroGrantDenialText:options.expected?.zeroGrantDenialText??options.zeroGrantDenialText}
  let sequence=0,serial=0
  const secrets=new Set()
  function collect(value,key='') {
    if(typeof value==='string'&&/password|secret|token|cookie/i.test(key)&&value)secrets.add(value)
    else if(value&&typeof value==='object')for(const [name,child]of Object.entries(value))collect(child,name)
  }
  function safe(value) {
    if(typeof value==='string') {
      for(const secret of secrets)value=value.split(secret).join('[REDACTED]')
      return value.replace(/Bearer\s+[^\s,;"']+/gi,'Bearer [REDACTED]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[REDACTED-JWT]')
    }
    if(Array.isArray(value))return value.map(safe)
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>! /^(password|temporarypassword|token|accesstoken|refreshtoken|idtoken|cookie|cookies|secret|clientsecret|authorization|authorizationheader)$/i.test(key.replace(/[-_]/g,''))).map(([key,child])=>[key,safe(child)]))
    return value
  }
  function capture(name,value) {return recorder.captureEvidence(`${name}-${++serial}.json`,safe(value))}
  function retainBrowserFiles(report,outputDirectory) {
    const references=[]
    function visit(value) {
      if(!value||typeof value!=='object')return
      if(typeof value.path==='string'&&(value.kind==='immutable-browser-diagnostics'||typeof value.label==='string')) {
        const source=descendant(value.path,outputDirectory)
        assert(lstatSync(source).isFile())
        const extension=extname(source)
        assert(['.png','.json'].includes(extension),'Unexpected browser evidence file type')
        const bytes=readFileSync(source),sha256=digest(bytes)
        if(value.sha256!==undefined)assert.equal(value.sha256,sha256,'Browser evidence bytes differ')
        if(extension==='.json') {
          const text=bytes.toString('utf8')
          for(const secret of secrets)assert(!text.includes(secret),'Credential in browser diagnostics')
          assert(!/Bearer\s+[A-Za-z0-9._~-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(text),'Credential-shaped browser diagnostics')
        }
        const path=`browser-assets/${extension==='.png'?'screenshots':'diagnostics'}/${sha256}${extension}`
        if(!browserFiles.has(path)) {
          mkdirSync(dirname(join(directory,path)),{recursive:true,mode:0o700})
          writeFileSync(join(directory,path),bytes,{mode:0o600,flag:'wx'});browserFiles.set(path,sha256)
        }
        references.push({path,sha256});value.path=path;value.sha256=sha256
      }
      for(const child of Object.values(value))if(child&&typeof child==='object')visit(child)
    }
    visit(report)
    const unique=[...new Map(references.map(ref=>[ref.path,ref])).values()]
    allBrowserAttachments.push(...unique)
    return unique
  }
  function syncResources() {
    if(!env||!recorder)return
    for(const resource of env.manager.resources.created) {
      const key=resource.kind+':'+resource.id
      if(!resources.has(key)) {recorder.journalResource(resource);resources.set(key,false)}
      if(resource.removed&&!resources.get(key)) {recorder.markRemoved(resource);resources.set(key,true)}
    }
  }
  function event(phase,detail) {
    events.push({sequence:++sequence,at:new Date().toISOString(),phase,...detail})
    writeFileSync(join(directory,'execution-order.json'),JSON.stringify(safe(events),null,2),{mode:0o600})
  }
  async function mode(value) {
    if(currentMode===value)return
    event('mode-start',{mode:value})
    await env.useMode(value);collect(env.privateInputs);collect(env.current.actors)
    if(value==='B') {
      const actorReport=join(directory,'environment','actors-public.json')
      assert(synthetic||existsSync(actorReport),'Production actor readback evidence missing')
      if(existsSync(actorReport))capture('actors-public-readback',{sha256:digest(readFileSync(actorReport)),report:JSON.parse(readFileSync(actorReport))})
    }
    syncResources()
    const readiness=await (dependencies.observerControl??verifyAmisQueueObservation)({owner:env.project,
      postgresContainer:env.current.deployment.postgresContainer,database:env.privateInputs.modes[value].database,effects:env.current.effects})
    assert.equal(readiness.passed,true,'Queue observer positive control must pass')
    assert.equal(readiness.restored,true,'Queue observer positive control must restore its exact baseline')
    capture('observability-readiness-'+value,{mode:value,readiness})
    currentMode=value;event('mode-ready',{mode:value})
  }
  function actor(key) {const value=env.current.actors?.find(item=>item.key===key);assert(value,`Missing production actor ${key}`);return {...value,expectedScopeKeys:[...value.scopeKeys]}}
  function account() {return env.current.mode==='B'?actor('allow-a'):env.current.admin}
  async function identity(session,selected) {
    if(env.current.mode==='B') {
      const signed=await session.verifiedUiIdentity({applicationGroupId:'main',subject:selected.username,audience:'kestra-ui'})
      assert.deepEqual([...signed.applicationGroupScopes].sort(),[...selected.expectedScopeKeys].sort())
      return {authenticated:true,subject:selected.username,signed}
    }
    return {authenticated:true,subject:selected.username,mode:'A',transport:'production-oidc'}
  }
  async function fragment(key,fn) {
    if(fragments.has(key))return fragments.get(key)
    event('fragment-start',{fragment:key})
    const saved=[]
    const persist=async report=>{
      const wrapped={fragment:key,sequence:sequence+1,at:new Date().toISOString(),report}
      saved.push(capture('fragment-'+key,wrapped));event('fragment-snapshot',{fragment:key})
    }
    let report,error
    try {report=await fn(persist)}catch(failure){error=failure;report=failure.report}
    if(report)await persist(report)
    if(error)await persist({completed:false,status:'failed',failure:{message:String(error.message)},...(report?{partialReport:report}:{})})
    const value={report,error,evidence:saved}
    fragments.set(key,value);event('fragment-end',{fragment:key,failed:Boolean(error)})
    if(report?.cases)for(const row of report.cases)if(amisP0Cases.includes(row.id))outcomes.set(row.id,{row,evidence:saved,error})
    syncResources()
    return value
  }
  async function browser(value,zero=false,afterZero=false) {
    const key=value+'-browser'+(zero?'-zero':afterZero?'-after-zero':'')
    return fragment(key,async persist=>{
      const selected=account(),browserOptions=options.browser
      assert(browserOptions&&['ego','playwright'].includes(browserOptions.driver),'Explicit real browser options required')
      const privateFile=join(directory,`${key}.private.json`)
      const privateValue={account:{...selected,access:'allowed'}}
      if(zero) {
        const zeroActor=actor('zero-grant')
        assert.deepEqual(zeroActor.expectedScopeKeys,[],'Zero-grant account must have zero issued scope keys')
        const zeroSession=await env.login(zeroActor)
        const signed=await identity(zeroSession,zeroActor)
        capture('zero-grant-signed-identity',signed)
        privateValue.nextAccount={...zeroActor,access:'zero',denialText:options.zeroGrantDenialText}
      }
      writeFileSync(privateFile,JSON.stringify(privateValue),{mode:0o600,flag:'wx'})
      const deployment=await env.manager.inspect()
      const inspected=JSON.parse(execute('docker',['inspect',deployment.kestraContainer]))[0]
      const outputDirectory=join(directory,key)
      const marker=`p0-${value.toLowerCase()}-${zero?'zero':afterZero?'after-zero':'browser'}`
      let result
      try {result=await (dependencies.browser??runAmisBrowserDriver)({...browserOptions,privateFile,outputDirectory,base:env.base,
        ...target,marker,title:'Published AMIS parent schema',deployment:{mode:value,project:env.project,
          containerIds:[deployment.postgresContainer,deployment.kestraContainer],hostContainerId:deployment.kestraContainer,
          formalImage:options.selected.hostImage,actualImageId:inspected.Image,jars:[{target:'/app/libs/kestra-amis-apps.jar',sha256:options.selected.amisJarSha256},
            ...(value==='B'?[{target:'/app/libs/kestra-rbac-authorizer.jar',sha256:options.selected.rbacJarSha256}]:[])]}})}
      catch(error) {
        const reportFile=join(outputDirectory,'report.json')
        if(existsSync(reportFile)) {
          const partial=JSON.parse(readFileSync(descendant(reportFile,outputDirectory)))
          const attachments=retainBrowserFiles(partial,outputDirectory)
          await persist({completed:false,browser:partial,attachments})
        }
        throw error
      }
      const report=JSON.parse(readFileSync(descendant(result.reportPath,outputDirectory)))
      const attachments=retainBrowserFiles(report,outputDirectory)
      if(result.completed!==true||report.completed!==true)await persist({completed:false,browser:report,attachments})
      assert.equal(result.completed,true)
      assert.equal(report.completed,true)
      for(const name of ['bookmark','production-login','canonical-page','fill-input','submit-result','refresh-page','logout','logged-out-bookmark'])assert(report.checks.some(row=>row.id===name&&row.status==='passed'),`Browser phase missing ${name}`)
      if(zero)for(const name of ['next-production-login','next-zero-authority-denial','next-logout','next-logged-out-bookmark'])assert(report.checks.some(row=>row.id===name&&row.status==='passed'))
      const rows=await env.current.effects.executionDetails(marker)
      assert.equal(rows.length,1,'Browser submission must persist exactly one real execution')
      assert.equal(rows[0].namespace,target.namespace);assert.equal(rows[0].flowId,target.flowId);assert.equal(rows[0].state,'SUCCESS')
      await persist({browser:report,storedExecution:rows[0]})
      return {completed:true,status:'passed',browser:report,storedExecution:rows[0],attachments}
    })
  }
  async function native(value,assets=false) {
    return fragment(value+(assets?'-assets':'-native'),async persist=>{
      const selected=account(),session=await env.login(selected),signed=await identity(session,selected)
      const result=await moduleFns[assets?'assets':'native']({mode:value,base:env.base,...target,authClient:session,identityEvidence:signed,
        probe:env.probe,nativeCases:options.nativeCases?.[value],expectedPublishedAssets:options.expectedPublishedAssets,
        anonymousTransport:dependencies.fetch??fetch,persist})
      assertPassed(result);return result
    })
  }
  async function fault(value) {
    return fragment(value+'-fault',persist=>moduleFns.fault({mode:value,base:env.base,env,originalVariant:{},account:account(),target:{...target,marker:`p0-${value.toLowerCase()}-fault`},
      nativeCases:options.nativeCases?.[value],faultNativeCases:options.faultNativeCases?.[value],expectedFaultStatuses:options.expectedFaultStatuses?.[value],
      persist,control:async()=>{
        const marker=`p0-fault-${++serial}`
        return {inputs:{name:marker},expectedData:{message:marker}}
      }}))
  }
  const securityTargets=new Map()
  async function bodyBoundaries(value) {
    return fragment(value+'-body-boundaries',async persist=>{
      if(synthetic)return moduleFns.body({mode:value,persist})
      const selected=account(),session=await env.login(selected)
      const inspected=await env.manager.inspect()
      const raw=JSON.parse(execute('docker',['inspect',inspected.kestraContainer]))[0]
      const configuration=raw.Config.Env.find(item=>item.startsWith('KESTRA_CONFIGURATION=')).slice('KESTRA_CONFIGURATION='.length)
      assert(/  amis-apps:\n    enabled: true\n    max-sync-concurrency: 1\n    request-body-timeout: PT30S/.test(configuration), 'Actual body timeout must match the production boundary')
      let streaming,identityEvidence
      if(value==='B') {
        streaming=await createAmisUiOAuth({base:env.base,client:session,clientSecret:env.privateInputs.clientSecret,
          namespace:target.namespace,flowId:target.flowId,expectedSubject:selected.username,groupId:'main',expectedScopeKeys:selected.scopeKeys})
        identityEvidence=streaming.evidence().current
      } else {
        streaming={requestAccess:(path,options)=>session.request(path,options),requestStreaming:(path,options)=>session.requestStreaming(path,options)}
        identityEvidence={subject:selected.username,issuer:env.base,exactAudiences:['kestra-ui'],productionLogin:true}
      }
      const effects=env.current.effects
      const result=await moduleFns.body({mode:value,base:env.base,client:streaming,identityEvidence,
        ownershipEvidence:{verified:true,owner:env.project,containerId:inspected.kestraContainer,base:env.base,mode:value},
        target:{...target,marker:`p0-${value.toLowerCase()}-streaming`,bodyTimeoutMs:30000},effects,
        executionInventory:()=>effects.executionInventory(),persist})
      assertPassed(result);return result
    })
  }
  async function prepareSecurity(value) {
    if(securityTargets.has(value))return securityTargets.get(value)
    const admin=await env.login(env.current.admin),marker=`p0-${value.toLowerCase()}-foreign`
    const foreign={...target,namespace:'company.amis.b'}
    const other=await invokeAmisApi(admin,{...foreign,inputs:{name:marker},expectedData:{message:marker}})
    let outputCase
    if(value==='B') {
      const own=await invokeAmisApi(admin,{...target,inputs:{name:marker+'-output'},expectedData:{message:marker+'-output'}})
      const noOutput=actor('no-output')
      outputCase={kind:'output-access',...target,executionId:own.executionId,path:own.executionUrl,marker:marker+'-output',account:noOutput,expectedScopeKeys:noOutput.expectedScopeKeys,expectedStatus:403,seeded:true}
    }else {
      const form=new FormData();form.set('name',marker+'-native')
      const response=await admin.request(`/api/v1/main/executions/${target.namespace}/${target.flowId}`,{method:'POST',body:form})
      assert([200,201].includes(response.status));const execution=await response.json()
      assert.equal(execution.namespace,target.namespace);assert.equal(execution.flowId,target.flowId)
      assert(execution.id&&execution.trigger?.type!=='io.kestra.plugin.amis.apps.ApiTrigger','Native execution must not be an ApiTrigger execution')
      const deadline=Date.now()+60000
      for(;;) {
        const storedResponse=await admin.request('/api/v1/main/executions/'+execution.id)
        assert.equal(storedResponse.status,200)
        const stored=await storedResponse.json()
        assert.equal(stored.id,execution.id);assert.equal(stored.namespace,target.namespace);assert.equal(stored.flowId,target.flowId)
        assert.notEqual(stored.trigger?.type,'io.kestra.plugin.amis.apps.ApiTrigger')
        if(stored.state?.current==='SUCCESS')break
        assert(!['FAILED','KILLED','CANCELLED'].includes(stored.state?.current),'Native positive control failed')
        assert(Date.now()<deadline,'Native execution did not reach SUCCESS')
        await wait(250)
      }
      await env.current.effects.waitForIdle()
      const rows=await env.current.effects.executionDetails(marker+'-native')
      assert.equal(rows.length,1);assert.equal(rows[0].id,execution.id);assert.equal(rows[0].state,'SUCCESS')
      outputCase={kind:'output-access',...target,executionId:execution.id,path:amisApiPath(target)+'/executions/'+execution.id,marker:marker+'-native',expectedStatus:404,seeded:true}
    }
    const schemaCases=[
      {id:'sibling',kind:'sibling',path:`/${target.namespace}/missing-schema/schemas/home`,expectedStatus:404,seeded:true},
      {id:'invalid-schema',kind:'invalid-schema',path:`/${target.namespace}/invalid-schema/schemas/home`,expectedStatus:400,seeded:true},
      ...[['authority','nsfile://evil/home.json'],['traversal','nsfile:///../home.json']].map(([kind,uri])=>({id:kind,kind,phase:'declaration-validation',path:'/api/v1/main/flows',expectedStatus:422,seeded:true,
        source:amisFixtureFlow({namespace:target.namespace,flowId:'invalid-'+kind}).replace('nsfile:///amis/home.json',uri)}))]
    const result={...target,conflictingApiId:'forged-api',markers:Object.fromEntries(['anonymous','missingCsrf','invalidCsrf','crossOrigin','routeIdentity'].map(key=>[key,`p0-${value.toLowerCase()}-${key}`])),
      foreignCases:[{kind:'foreign-execution',...foreign,executionId:other.executionId,path:amisApiPath(target)+'/executions/'+other.executionId,marker,expectedStatus:404,seeded:true},outputCase],schemaCases}
    securityTargets.set(value,{target:result,schemaAdminClient:admin})
    capture('security-seeded-'+value,{foreign:other,outputBinding:safe(outputCase),schemaCases:schemaCases.map(({source,...row})=>row)})
    return securityTargets.get(value)
  }
  async function ensure(id) {
    const value=id[0];await mode(value)
    if(id.endsWith('cookie-write-missing-and-invalid-csrf')) {
      const body=await bodyBoundaries(value)
      if(body.error) {
        const cached=outcomes.get(id)
        outcomes.set(id,{row:{...(cached?.row??{}),id,status:'failed',streamingBoundaries:body.report},
          evidence:[...(cached?.evidence??[]),...body.evidence],error:body.error})
        throw body.error
      }
      assertPassed(body.report)
      const cached=outcomes.get(id)
      if(cached) {
        cached.row={...cached.row,streamingBoundaries:body.report}
        cached.evidence=[...cached.evidence,...body.evidence]
      }
    }
    if(outcomes.has(id))return outcomes.get(id)
    if(/production-login-bookmark|page-renders-current-schema|form-creates-real-flow-execution|zero-grant-logout/.test(id)) {
      const result=await browser(value,id.includes('zero-grant'))
      if(result.error)throw result.error
      assertPassed(result.report)
      if(id.includes('zero-grant')) {
        const switched=await browser(value,false,true)
        if(switched.error)throw switched.error
        assertPassed(switched.report)
        return {row:{status:'passed',zeroLogout:result.report,switchedAccount:switched.report,attachments:[...result.report.attachments,...switched.report.attachments]},evidence:[...result.evidence,...switched.evidence]}
      }
      return {row:result.report,evidence:result.evidence}
    }
    if(id==='A-no-rbac-jar-authentication-retained') {
      const deployment=await env.manager.inspect();assert(!deployment.actualMounts.some(item=>item.target.startsWith('/app/libs')&&item.target.includes('rbac')))
      const anonymous=await (dependencies.fetch??fetch)(env.base+amisApiPath(target),{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',redirect:'manual',credentials:'omit'})
      assert.equal(anonymous.status,401);await anonymous.body?.cancel()
      const session=await env.login(account());return {row:{status:'passed',deployment,anonymousStatus:401,identity:await identity(session,account())},evidence:[]}
    }
    if(id==='B-page-and-api-both-gates-allowed'||id.endsWith('default-async-real-execution-and-bounded-poll')) {
      const session=await env.login(account()),signed=await identity(session,account()),marker=`p0-${value.toLowerCase()}-async-${++serial}`
      const page=await session.request(`/${target.namespace}/${target.flowId}/pages/${target.pageId}`);assert.equal(page.status,200);await page.body?.cancel()
      const result=await invokeAmisApi(session,{...target,inputs:{name:marker},expectedData:{message:marker}})
      if(id.endsWith('default-async-real-execution-and-bounded-poll'))assert.equal(result.observations[0]?.status,202,'Default ASYNC must acknowledge pending before polling')
      const rows=await env.current.effects.executionDetails(marker);assert.equal(rows.length,1);assert.equal(rows[0].id,result.executionId)
      return {row:{status:'passed',identity:signed,result,rows},evidence:[]}
    }
    if(id==='B-missing-duplicate-and-faulted-authorization-fail-closed'||id.includes('missing-and-disabled-extension')||id.includes('faulted-route-provider')) {
      const result=await fault(value)
      if(!outcomes.has(id)&&result.error)throw result.error
    }
    else if(id.includes('native-controller-static')) {const result=await native(value);if(result.error)throw result.error;return {row:result.report,evidence:result.evidence}}
    else if(id.includes('declared-runtime-assets')) {const result=await native(value,true);if(result.error)throw result.error;return {row:result.report,evidence:result.evidence}}
    else if(id.includes('explicit-sync-')) {
      const result=await fragment(value+'-sync',async persist=>{
        const selected=account(),client=await env.login(selected);await identity(client,selected)
        const effects=env.current.effects
        return moduleFns.sync({mode:value,client,effects,target:{namespace:target.namespace,apiId:target.apiId,normalFlowId:'sync-greeting',timeoutFlowId:'sync-timeout',capacityFlowId:'sync-capacity',maxSyncConcurrency:1,marker:`p0-${value.toLowerCase()}-sync`},
          executionCount:marker=>effects.executionCount(marker),executionDetails:marker=>effects.executionDetails(marker),executionInventory:()=>effects.executionInventory(),persist})
      });if(result.error)throw result.error;assertPassed(result.report);return {row:result.report,evidence:result.evidence}
    }else if(id.startsWith('B-revoke-')) {
      const result=await fragment('B-revocation',persist=>moduleFns.revocation({base:env.base,admin:env.current.admin,actors:env.current.actors,
        clientSecret:env.privateInputs.clientSecret,target:{...target,marker:'p0-revocation'},effects:env.current.effects,login:env.login,persist}))
      if(!outcomes.has(id)&&result.error)throw result.error
    }
    else if(/^B-(page-entry|api-entry|entry-only|flow-only|multiple-scopes|namespace-exact)/.test(id))await fragment('B-permission',async persist=>{
      capture('outside-entry-boundary',{namespace:'company2',flowId:target.flowId,
        targetExistenceRequired:false,reason:'Entry capability denies before Flow lookup; the permission fragment checks 403 and zero lookup counters. No outside-scope seed write is authorized or attempted.'})
      return moduleFns.permission({base:env.base,actors:env.current.actors,effects:env.current.effects,probe:env.probe,
        target:{namespaceA:'company.amis.a',namespaceB:'company.amis.b',namespaceOutside:'company2',flowId:'greeting',pageId:'home',apiId:'greet',marker:'p0-permission',missingPath:'/company.amis.a/missing-flow/pages/home'},persist})
    })
    else if(id.includes('parent-schema-render')) {
      const result=await browser(value);if(result.error)throw result.error
      const selected=account(),session=await env.login(selected),schema=await session.request(`/${target.namespace}/${target.flowId}/schemas/home`)
      assert.equal(schema.status,200);const document=await schema.json();assert.equal(document.title,'Published AMIS parent schema')
      return {row:{status:'passed',browser:result.report,schema:document,attachments:result.report.attachments},evidence:result.evidence}
    }else {
      await fragment(value+'-security',async persist=>{
      const seeded=await prepareSecurity(value)
      return moduleFns.security({mode:value,base:env.base,account:account(),effects:env.current.effects,probe:env.probe,persist,...seeded})
      })
    }
    const observed=outcomes.get(id)
    assert(observed,`Required fragment did not execute ${id}; no fallback pass`)
    return observed
  }
  try {
    assert.equal(resolve(options.rootDirectory),root,'Exact rootDirectory required')
    const selected=options.selected;assert(selected&&selected.amisReleaseDirectory,'Formal AMIS release directory required')
    for(const path of [selected.amisReleaseDirectory,selected.amisJar,selected.rbacJar])assert(isAbsolute(path),'Absolute formal artifact paths required')
    for(const key of ['rootCommit','hostCommit','amisCommit','rbacCommit'])assert.match(selected[key],/^[a-f0-9]{40}$/)
    const head=execute('git',['-C',root,'rev-parse','HEAD']).trim();assert.equal(head,selected.rootCommit)
    const dirty=execute('git',['-C',root,'status','--porcelain']).trim()
    const ci=dependencies.ci??(process.env.CI==='true'||Boolean(process.env.GITHUB_ACTIONS))
    assert(!dirty||options.allowDirty===true&&!ci,'Dirty checkout requires explicit local-only permission')
    sourceState={rootCommit:head,dirty:Boolean(dirty),allowDirty:options.allowDirty===true,ci,gitlinks:[]}
    for(const [path,key]of [['kestra-overlay','hostCommit'],['kestra-plugin-amis-apps','amisCommit'],['kestra-plugin-rbac','rbacCommit']]) {
      const tree=execute('git',['-C',root,'ls-tree','HEAD','--',path]).trim().split(/\s+/)
      const committed=tree[0]==='160000'&&tree[1]==='commit'&&tree[3]===path?tree[2]:null
      let actual=committed,origin='committed-gitlink'
      if(committed!==selected[key]) {
        assert(dirty&&options.allowDirty===true&&!ci,`Selected ${key} differs from committed gitlink`)
        // Explicit local rehearsal only. CI never needs or reads private AMIS source.
        actual=execute('git',['-C',join(root,path),'rev-parse','HEAD']).trim();origin='local-uncommitted-submodule-head'
      }
      assert.equal(actual,selected[key],`Selected ${key} differs from actual source pin`)
      sourceState.gitlinks.push({path,committed,selected:actual,origin})
    }
    for(const [path,key]of [[selected.amisJar,'amisJarSha256'],[selected.rbacJar,'rbacJarSha256']])assert.equal(digest(readFileSync(path)),selected[key])
    assert.equal(digest(readFileSync(join(selected.amisReleaseDirectory,'kestra-amis-apps.jar'))),selected.amisJarSha256)
    const audit=await (dependencies.releaseReader??validateAmisPublishedRelease)(selected.amisReleaseDirectory,{...selected,stage:'P0'})
    const provenance=JSON.parse(readFileSync(join(selected.amisReleaseDirectory,'release-provenance.json')))
    assert.equal(provenance.commit,selected.amisCommit);assert.equal(provenance.host.image,selected.hostImage);assert.equal(provenance.jarSha256,selected.amisJarSha256)
    const packagedManifest=JSON.parse(execute('python3',['-c',
      'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(z.read("META-INF/kestra/amis-apps/runtime/runtime-manifest.json").decode())',selected.amisJar]))
    if(options.expectedPublishedAssets)assert.deepEqual(options.expectedPublishedAssets,packagedManifest)
    options.expectedPublishedAssets=packagedManifest
    env=(dependencies.createEnvironment??createAmisProductionEnvironment)({directory:join(directory,'environment'),rootDirectory:root,selected,port:options.port,probeJar:options.probeJar})
    collect(env.privateInputs)
    recorder=createAmisP0Recorder({directory:join(directory,'evidence'),owner:env.project,inputs:Object.fromEntries(['rootCommit','hostCommit','amisCommit','rbacCommit','hostImage','amisJarSha256','rbacJarSha256'].map(key=>[key,selected[key]])),synthetic})
    capture('release-audit',{audit,sourceState})
    if(!synthetic)capture('acceptance-source-inputs',collectAmisSourceEvidence({rootDirectory:root}))
    await env.startPostgres();syncResources()
    for(const id of amisP0Cases)await recorder.record(id,async()=>{
      try {
        event('matrix-row-start',{id})
        const observed=await ensure(id);assertPassed(observed.row)
        outcomes.set(id,observed)
        const rowEvidence=capture('case-'+id,{id,actualFragmentEvidence:observed.evidence,observation:observed.row})
        let ownerEvidence
        if(!transportEvidence&&id==='A-production-login-bookmark-and-refresh') {
          ownerEvidence=capture('inspected-owner',await env.manager.inspect())
          transportEvidence={productionLogin:rowEvidence,inspectedOwner:ownerEvidence}
        }
        event('matrix-row-passed',{id})
        const result={evidence:[rowEvidence,...(ownerEvidence?[ownerEvidence]:[]),...observed.evidence],...safetyFields(id,observed.row)}
        observed.matrixResult=result
        return result
      }catch(error){
        if(!outcomes.has(id))outcomes.set(id,{row:{id,status:'failed'},evidence:[]})
        throw error
      }finally{syncResources()}
    })
    const failedFragment=[...fragments.entries()].find(([,fragment])=>fragment.error)
    if(failedFragment)throw new Error(`Fragment ${failedFragment[0]} failed despite individually completed rows: ${failedFragment[1].error.message}`)
  }catch(error){primaryFailure=error}
  finally {
    if(env) {
      try {syncResources();await env.cleanup();syncResources()}
      catch(error){cleanupFailure=error;try{syncResources()}catch{}}
    }
    if(recorder) {
      if(primaryFailure)try{recorder.journalResource({kind:'driver-failure',id:'retained-driver-error',owner:env.project})}catch{}
      if(cleanupFailure)try{recorder.journalResource({kind:'cleanup-failure',id:'retained-cleanup-error',owner:env.project})}catch{}
      try {finalReport=recorder.finalize({verifiedTransportEvidence:transportEvidence})}
      catch(error){
        primaryFailure??=error
        validationFailures.push({stage:'recorder-finalize',name:error.name,message:String(error.message),...(error.code?{code:error.code}:{})})
      }
    }
    if(primaryFailure||cleanupFailure) {
      initial.status='failed'
      writeFileSync(join(directory,'bootstrap-report.json'),JSON.stringify(initial,null,2),{mode:0o600})
      writeFileSync(join(directory,'driver-failure.json'),JSON.stringify(safe({status:'failed',primaryFailure:primaryFailure?.message,cleanupFailure:cleanupFailure?.message,
        resources:env?.manager.resources,completed:false}),null,2),{mode:0o600})
    }
    // The canonical final matrix reflects actual fragment execution even where
    // batch order differs from recorder's incremental fixed-order projection.
    const actualCases=amisP0Cases.map(id=>{
      const observed=outcomes.get(id)
      const status=successful(observed?.row)?'passed'
        :observed?.row?.status==='failed'?'failed':'notRun'
      return {id,status,evidence:observed?.matrixResult?.evidence??observed?.evidence??[],
        ...(observed?.matrixResult??{})}
    })
    const actualReport=finalReport&&!primaryFailure&&!cleanupFailure?structuredClone(finalReport):{...initial,cases:actualCases,
      status:'failed',resources:env?.manager.resources??{created:[],retained:[]},
      summary:{passed:actualCases.filter(r=>r.status==='passed').length,failed:actualCases.filter(r=>r.status==='failed').length,
        notRun:actualCases.filter(r=>r.status==='notRun').length,skipped:0},
      note:'Actual fragment outcomes in fixed display order. execution-order.json records actual invocation order; evidence/report-final.json is the incremental recorder projection.'}
    for(const row of actualReport.cases)row.evidence=(row.evidence??[]).map(reference=>({...reference,path:'evidence/'+reference.path}))
    actualReport.browserAttachments=[...new Map(allBrowserAttachments.map(reference=>[reference.path,reference])).values()]
    actualReport.sourceState=sourceState
    for(const row of actualReport.cases) {
      const observed=outcomes.get(row.id)
      const attachments=observed?.row?.attachments??[]
      row.evidence.push(...attachments)
    }
    if(actualReport.verifiedTransportEvidence)for(const reference of Object.values(actualReport.verifiedTransportEvidence))reference.path='evidence/'+reference.path
    try {
      for(const reference of actualReport.browserAttachments) {
        const actual=digest(readFileSync(descendant(join(directory,reference.path),directory)))
        assert.equal(actual,reference.sha256,`Final browser attachment hash differs: ${reference.path}`)
      }
      if(!primaryFailure&&!cleanupFailure) {
        if(!synthetic)validateAmisP0Report(actualReport,finalReport.inputs)
        verifyAmisEvidenceFiles(actualReport,directory)
      }
    }catch(error){
      primaryFailure??=error
      validationFailures.push({stage:'final-report-validation',name:error.name,message:String(error.message),...(error.code?{code:error.code}:{})})
    }
    if(validationFailures.length) {
      actualReport.status='failed'
      actualReport.completed=false
      actualReport.validationFailures=validationFailures
      writeFileSync(join(directory,'driver-failure.json'),JSON.stringify(safe({status:'failed',completed:false,
        primaryFailure:primaryFailure?.message,cleanupFailure:cleanupFailure?.message,validationFailures,
        resources:env?.manager.resources}),null,2),{mode:0o600})
    }
    writeFileSync(join(directory,'report.json'),JSON.stringify(safe(actualReport),null,2),{mode:0o600})
  }
  if(primaryFailure||cleanupFailure) {
    const failure=new Error('AMIS P0 driver failed; inspect retained reports')
    failure.reportDirectory=directory
    throw failure
  }
  return {status:finalReport.status,completed:finalReport.completed,reportPath:join(directory,'report.json'),synthetic}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length,3,'Pass an owned 0600 options JSON file')
    assert(isAbsolute(process.argv[2]),'Absolute options JSON path required')
    const file=resolve(process.argv[2]);descendant(file,join(root,'.work'))
    const info=lstatSync(file);assert(info.isFile()&&(info.mode&0o777)===0o600&&info.uid===process.getuid())
    const result=await runAmisP0(JSON.parse(readFileSync(file,'utf8')))
    console.log(JSON.stringify(result))
  }catch(error){console.error('AMIS P0 driver failed; inspect configured evidence directory');process.exitCode=1}
}
