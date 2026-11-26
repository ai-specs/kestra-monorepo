import test from 'node:test'
import assert from 'node:assert/strict'
import {p1NetworkTrace,runAmisP1BrowserCase,p1ControlSelector,p1ObserveQueryLoading,p1LocaleState,p1SubmitState,p1ObserveStatus,p1VerifyPausedObservation,p1ObservedPausedReady} from '../amis-apps-p1-browser.mjs'

const base='http://127.0.0.1:18080'
const scenario={id:'p1-async',namespace:'company.p1',flowId:'p1-async',pageId:'home',apiId:'run'}
const api=base+'/company.p1/p1-async/apis/run'
const options={id:'A-async-failure-and-visible-message',base,scenario,account:{authenticated:true,username:'private-user',password:'private-password'},marker:'unique-marker'}
// Offline doubles exercise control flow and failure retention only. They are not acceptance evidence.
function fake({noPost=false,wrongPoll=false,missingResponse=false,loseHistory=false,failGoto=false,text='Execution failed (FAILED)'}={}) {
  let events=[],sequence=0,captures=0,doc=0
  const event=(kind,extra)=>({id:'e'+(++sequence),documentId:'d'+doc,kind,...extra})
  return {
    synthetic:true,
    captures:()=>captures,
    evaluate:async (fn,arg)=>fn.name==='p1LocaleState'?{selected:'en',actualLocale:'en',values:['en','zh_CN']}:fn.name==='p1SubmitState'?{present:false,visible:false,disabled:null,busy:true}:fn.name==='amisBrowserDocument'?{path:'/company.p1/p1-async/pages/home',url:base+'/company.p1/p1-async/pages/home',timeOrigin:doc}:fn.name==='p1ControlSelector'?(arg.text==='Save changed data'?'submit-button':'other-control'):{login:false,text,alert:['Execution failed (FAILED)'],busy:'false'},
    goto:async()=>{if(failGoto)throw new Error('navigation private-password failed');doc++},
    waitForFunction:async()=>{},fill:async()=>{},pressFocused:async()=>{},
    click:async selector=>{
      if(selector==='submit-button'&&!noPost&&!events.length) {
        events.push(event('request',{requestId:'post',method:'POST',url:api}))
        if(!missingResponse)events.push(event('http-response',{requestId:'post',method:'POST',url:api,status:202}))
        const url=(wrongPoll?api.replace('/run','/other'):api)+'/executions/original'
        events.push(event('request',{requestId:'poll',method:'GET',url}),event('http-response',{requestId:'poll',method:'GET',url,status:200}))
      }
    },
    diagnostics:async()=>({events:loseHistory&&events.length?[]:events,documents:[{id:'d'+doc,url:base}]}),
    diagnosticEvidenceReference:async()=>({path:'/retained/diagnostics.json',sha256:'a'.repeat(64)}),
    artifactReferences:()=>[],captureFailure:async()=>{captures++},redactSecrets:()=>{}
  }
}
test('exact URL, request identity and source document bind POST and poll responses',()=>{
  const req={kind:'request',requestId:'one',documentId:'doc',method:'POST',url:api}
  const response={kind:'http-response',requestId:'one',documentId:'doc',url:api,status:202}
  const trace=p1NetworkTrace([req,{...response,documentId:'old'},response,{...req,url:api+'-evil'},{...req,url:api+'/executions/id?fake=1'}],[api])
  assert.equal(trace.length,1);assert.deepEqual(trace[0].responses,[response])
})
test('offline Page flow returns only observed original execution identity',async()=>{
  const records=[];const report=await runAmisP1BrowserCase(fake(),{...options,record:async r=>records.push(r)})
  assert(report.completed);assert.deepEqual(report.executionIds,['original']);assert.equal(report.trace[0].method,'POST')
  assert(report.checks.every(row=>row.evidence?.diagnosticFile.sha256))
  assert.equal(report.trace[0].responses[0].status,202)
  assert(records.length>4);assert.match(report.limitations.join(' '),/No response body/)
})
test('a success-looking page without a real POST fails closed and retains failed phase',async()=>{
  const adapter=fake({noPost:true});const records=[]
  await assert.rejects(runAmisP1BrowserCase(adapter,{...options,record:async r=>records.push(r)}),error=>{
    assert.equal(error.report.completed,false);assert.equal(error.report.failure.phase,'exact-network-contract');assert.match(error.message,/POST absent/);return true
  })
  assert.equal(adapter.captures(),1);assert.equal(records.at(-1).checks.at(-1).status,'failed')
})
test('missing response cannot become a passed network assertion',async()=>{
  await assert.rejects(runAmisP1BrowserCase(fake({missingResponse:true}),options),/No response\/failure retained/)
})
test('failure report redacts account credentials and keeps source document',async()=>{
  const adapter=fake({failGoto:true})
  await assert.rejects(runAmisP1BrowserCase(adapter,options),error=>{
    assert(!JSON.stringify(error.report).includes('private-password'));assert(!error.message.includes('private-password'))
    assert(error.report.checks.at(-1).sourceDocument);assert(error.report.checks.at(-1).evidence);return true
  })
})
test('record persistence errors do not return completed',async()=>{
  await assert.rejects(runAmisP1BrowserCase(fake(),{...options,record:async()=>{throw new Error('disk unavailable')}}),error=>{
    assert.equal(error.report.completed,false);assert.match(error.report.recordError,/disk unavailable/);return true
  })
})
test('unknown cases and absent formal scenario cannot silently run another flow',async()=>{
  await assert.rejects(runAmisP1BrowserCase(fake(),{...options,id:'A-unknown'}),/Unknown P1 case/)
  await assert.rejects(runAmisP1BrowserCase(fake(),{...options,scenario:[]}),/Published scenario missing/)
})
test('live DOM resolver refuses ambiguous controls instead of first or nth shortcuts',()=>{
  const prior=globalThis.document
  globalThis.document={querySelectorAll:()=>[]}
  try {assert.throws(()=>p1ControlSelector({kind:'select',name:'Scenario'}),/one visible label/)} finally {if(prior===undefined)delete globalThis.document;else globalThis.document=prior}
})

test('a poll for another API cannot count as recovering the original execution',async()=>{
  await assert.rejects(runAmisP1BrowserCase(fake({wrongPoll:true,text:'Saved: unique-marker'}),{...options,id:'A-async-running-success-and-result-binding'}),/Original execution poll absent/)
})
test('account must be explicitly bound to an existing production session',async()=>{
  await assert.rejects(runAmisP1BrowserCase(fake(),{...options,account:{username:'private-user',password:'private-password'}}),/Existing session requires explicit authenticated account assertion/)
})

test('mode A refusal performs real logout and verifies anonymous document login redirect',async()=>{
  const adapter=fake();const navigations=[];const originalGoto=adapter.goto;const originalEvaluate=adapter.evaluate
  adapter.goto=async url=>{navigations.push(url);return originalGoto(url)}
  adapter.evaluate=async(fn,arg)=>fn.name==='p1PageObservation'&&navigations.includes(base+'/oidc/logout')?{login:true,path:'/oidc/login',text:'Sign in'}:originalEvaluate(fn,arg)
  const report=await runAmisP1BrowserCase(adapter,{...options,id:'A-authenticated-refusal-has-no-delayed-effects'})
  assert(report.completed);assert(navigations.includes(base+'/oidc/logout'))
  assert.equal(report.checks.find(row=>row.id==='anonymous-document-refusal').observation.expectedExternalPostStatus,401)
  assert.deepEqual(report.executionIds,[]);assert.deepEqual(report.trace,[])
})
test('mode B refusal remains authenticated and leaves forbidden POST to parent evidence',async()=>{
  const adapter=fake();const navigations=[];const originalGoto=adapter.goto
  adapter.goto=async url=>{navigations.push(url);return originalGoto(url)}
  const report=await runAmisP1BrowserCase(adapter,{...options,id:'B-authenticated-refusal-has-no-delayed-effects'})
  assert(report.completed);assert(!navigations.includes(base+'/oidc/logout'))
  assert.equal(report.checks.find(row=>row.id==='authenticated-refusal').observation.expectedExternalPostStatus,403)
  assert.deepEqual(report.executionIds,[])
})
test('timeout and cancel use two explicit submissions and two observed execution identities',async()=>{
  const adapter=fake();const events=[];let submits=0;const originalEvaluate=adapter.evaluate
  adapter.evaluate=async(fn,arg)=>fn.name==='p1PageObservation'?{login:false,text:'Saved: unique-marker',busy:'true',recovery:[{value:{phase:'pending',executionId:'exec-'+submits}}]}:originalEvaluate(fn,arg)
  adapter.click=async selector=>{
    if(selector!=='submit-button')return
    const index=++submits,documentId='doc',url=api+'/executions/exec-'+index
    events.push(
      {id:'post-'+index,kind:'request',requestId:'post-'+index,documentId,method:'POST',url:api},
      {id:'post-response-'+index,kind:'http-response',requestId:'post-'+index,documentId,method:'POST',url:api,status:202},
      {id:'poll-'+index,kind:'request',requestId:'poll-'+index,documentId,method:'GET',url},
      {id:'poll-response-'+index,kind:'http-response',requestId:'poll-'+index,documentId,method:'GET',url,status:200})
  }
  adapter.diagnostics=async()=>({events,documents:[{id:'doc',url:base}]})
  const waits=[];adapter.waitForFunction=async(fn,arg)=>{waits.push(arg)}
  const report=await runAmisP1BrowserCase(adapter,{...options,id:'A-client-timeout-and-cancel-preserve-recoverable-execution'})
  assert(report.completed);assert.equal(submits,2);assert.deepEqual(report.executionIds,['exec-1','exec-2'])
  assert(waits.some(arg=>arg?.recoveryPending===true && arg.busy===true))
  assert(report.checks.find(row=>row.id==='cancel-distinct-pending-execution').observation.explicitSecondSubmission)
})
test('ordinary slow result explicitly recovers actual timeout without another POST',async()=>{
 const adapter=fake({text:'Saved: unique-marker'});const originalEvaluate=adapter.evaluate,originalClick=adapter.click
 let submitted=false,resumed=false
 adapter.evaluate=async(fn,arg)=>{
  if(fn.name==='p1ControlSelector'&&arg.text==='Resume result query')return 'resume-button'
  if(fn.name==='p1PageObservation'&&submitted&&!resumed)return {login:false,text:'Request timed out',alert:['Request timed out'],busy:'false',recovery:[{value:{phase:'pending',executionId:'original'}}]}
  return originalEvaluate(fn,arg)
 }
 adapter.click=async selector=>{if(selector==='submit-button')submitted=true;if(selector==='resume-button')resumed=true;return originalClick(selector)}
 const report=await runAmisP1BrowserCase(adapter,{...options,id:'A-async-running-success-and-result-binding'})
 assert(resumed);assert(report.completed);assert.equal(report.trace.filter(row=>row.method==='POST').length,1)
 assert(report.checks.find(row=>row.id==='visible-result').observation.recoveredAfterActualTimeout)
})

function syntheticNativeLoginAdapter() {
 const adapter=fake();const originalEvaluate=adapter.evaluate,originalClick=adapter.click
 let loggedIn=false
 adapter.synthetic=true
 adapter.evaluate=async(fn,arg)=>fn.name==='p1PageObservation'&&!loggedIn?{login:true,text:'Sign in'}:originalEvaluate(fn,arg)
 adapter.click=async selector=>{if(selector==='button[type="submit"]')loggedIn=true;return originalClick(selector)}
 return {adapter,isLoggedIn:()=>loggedIn}
}
const syntheticIdentity={synthetic:true,subject:'private-user',issuer:base,audiences:['kestra-ui'],signatureVerified:true}
test('local identity callback runs after native login and keeps public subject but no raw JWT',async()=>{
 const {adapter,isLoggedIn}=syntheticNativeLoginAdapter();let calls=0
 const report=await runAmisP1BrowserCase(adapter,{...options,account:{username:'private-user',password:'private-password'},onAuthenticated:async()=>{
  assert(isLoggedIn());calls++;return {...syntheticIdentity,token:'never-retain-this-token'}
 }})
 assert.equal(calls,1);assert.equal(report.identity.subject,'private-user');assert.equal(report.identity.synthetic,true)
 assert.equal(report.identity.signatureVerified,true);assert(!JSON.stringify(report).includes('never-retain-this-token'))
})
for(const [name,change]of [
 ['other subject',v=>v.subject='someone-else'],['other issuer',v=>v.issuer='http://other'],
 ['wrong audience',v=>v.audiences=['different']],['unverified signature',v=>v.signatureVerified=false],
])test('native login rejects identity callback with '+name,async()=>{
 const {adapter}=syntheticNativeLoginAdapter();const identity={...syntheticIdentity};change(identity)
 await assert.rejects(runAmisP1BrowserCase(adapter,{...options,account:{username:'private-user',password:'private-password'},onAuthenticated:async()=>identity}),error=>{
  assert.equal(error.report.failure.phase,'production-login');assert.equal(error.report.completed,false);return true
 })
})
test('mode B identity receipt requires actual application group and version',async()=>{
 for(const extra of [{applicationGroupId:'other',authorizationVersion:1,applicationGroupScopes:[]},{applicationGroupId:'main',authorizationVersion:0,applicationGroupScopes:[]}]) {
  const {adapter}=syntheticNativeLoginAdapter()
  await assert.rejects(runAmisP1BrowserCase(adapter,{...options,id:'B-async-failure-and-visible-message',account:{username:'private-user',password:'private-password'},onAuthenticated:async()=>({...syntheticIdentity,...extra})}),/Authenticated browser/)
 }
})

function syntheticCasePage(flow,{loading=true,pending=true}={}) {
 const adapter=fake(),events=[],actions=[];let doc=0,posts=0
 const url=base+'/company.p1/'+flow+'/apis/run',path='/company.p1/'+flow+'/pages/home'
 const addPost=()=>{const requestId='post-'+(++posts),documentId='doc-'+doc,pollId='poll-'+posts
  events.push({id:requestId,kind:'request',requestId,documentId,method:'POST',url},{id:requestId+'-response',kind:'http-response',requestId,documentId,method:'POST',url,status:202},
   {id:pollId,kind:'request',requestId:pollId,documentId,method:'GET',url:url+'/executions/original'}, {id:pollId+'-response',kind:'http-response',requestId:pollId,documentId,method:'GET',url:url+'/executions/original',status:200})
 }
 adapter.goto=async target=>{doc++;actions.push('goto');if(flow==='p1-query'&&target.includes('/p1-query/')&&posts===0)addPost()}
 adapter.reload=async()=>{actions.push('reload');doc++}
 adapter.waitForFunction=async(fn,arg)=>{actions.push(arg?.recoveryPending?'wait-pending':'wait');if(arg?.recoveryPending&&!pending)throw new Error('Recovery is submitting, not pending')}
 adapter.evaluate=async(fn,arg)=>{
  if(fn.name==='p1LocaleState')return {selected:'en',actualLocale:'en',values:['en','zh_CN']}
  if(fn.name==='p1SubmitState')return {present:false,visible:false,disabled:null,busy:true}
  if(fn.name==='amisBrowserDocument')return {url:base+path,path,timeOrigin:doc}
  if(fn.name==='p1PageObservation')return {login:false,text:'Saved: unique-marker',alert:[],busy:'false',recovery:[{value:{phase:pending?'pending':'submitting',apiUrl:new URL(url).pathname,executionId:'original',executionUrl:new URL(url).pathname+'/executions/original'}}]}
  if(fn.name==='p1ControlSelector') {
   actions.push('resolve:'+arg.kind+':'+arg.text)
   if(arg.kind==='dialog-confirm')return 'dialog-confirm'
   if(arg.text==='Save changed data')return 'submit-button'
   if(arg.text==='2')return 'next-page'
   return 'other-control'
  }
  if(fn.name==='p1ObserveQueryLoading') {actions.push('observer-'+arg.operation);return arg.operation==='start'?{url:base+path,timeOrigin:doc,observingBeforeClick:true}:{url:base+path,timeOrigin:doc,initialBusy:'false',busyTrueObserved:loading,finalBusy:'false',transitions:loading?[{oldValue:'true',current:'false'}]:[]}}
  return false
 }
 adapter.click=async selector=>{actions.push('click:'+selector);if(['submit-button','dialog-confirm','next-page'].includes(selector)&& (posts===0||flow==='p1-query'))addPost()}
 adapter.diagnostics=async()=>({events,documents:[{id:'doc-'+doc,url:base+path}]})
 return {adapter,actions,scenario:{scenarios:[{...scenario,id:flow,flowId:flow},...(flow==='p1-async'?[]:[scenario])]}}
}
test('dialog submits through visible native Confirm, never hidden inner form actions',async()=>{
 const page=syntheticCasePage('p1-dialog')
 const report=await runAmisP1BrowserCase(page.adapter,{...options,id:'A-dialog-form-submits-once',scenario:page.scenario})
 assert(report.completed);assert(page.actions.includes('click:dialog-confirm'))
 assert(!page.actions.includes('resolve:button:Save changed data'))
 assert.equal(report.trace.filter(row=>row.method==='POST').length,1)
})
test('dialog missing native Confirm fails and retains failed submit evidence',async()=>{
 const page=syntheticCasePage('p1-dialog'),evaluate=page.adapter.evaluate
 page.adapter.evaluate=async(fn,arg)=>{if(fn.name==='p1ControlSelector'&&arg.kind==='dialog-confirm')throw Error('Expected one live control: Confirm');return evaluate(fn,arg)}
 await assert.rejects(runAmisP1BrowserCase(page.adapter,{...options,id:'A-dialog-form-submits-once',scenario:page.scenario}),error=>{assert.equal(error.report.failure.phase,'submit');assert.equal(error.report.trace.length,0);return true})
})
test('fast initial query uses native pagination loading observation installed before click',async()=>{
 const page=syntheticCasePage('p1-query')
 const report=await runAmisP1BrowserCase(page.adapter,{...options,id:'A-list-pagination-empty-and-loading',scenario:page.scenario})
 assert(report.completed);assert.equal(report.queryLoading.busyTrueObserved,true)
 assert(page.actions.indexOf('observer-start')<page.actions.indexOf('click:next-page'))
 assert(page.actions.indexOf('observer-stop')>page.actions.indexOf('click:next-page'))
 assert.equal(report.trace.filter(row=>row.method==='POST').length,2)
})
test('HTTP success and correct rows cannot replace actual loading observation',async()=>{
 const page=syntheticCasePage('p1-query',{loading:false})
 await assert.rejects(runAmisP1BrowserCase(page.adapter,{...options,id:'A-list-pagination-empty-and-loading',scenario:page.scenario}),error=>{assert.equal(error.report.failure.phase,'query-loading');assert.equal(error.report.queryLoading.busyTrueObserved,false);return true})
})
test('double-submit confirms exact pending recovery before native reload',async()=>{
 const page=syntheticCasePage('p1-async')
 const report=await runAmisP1BrowserCase(page.adapter,{...options,id:'A-double-submit-refresh-and-reentry-do-not-replay',scenario:page.scenario})
 assert(report.completed);assert(page.actions.indexOf('wait-pending')<page.actions.indexOf('reload'))
 assert.equal(report.trace.filter(row=>row.method==='POST').length,1)
 assert.equal(report.checks.find(row=>row.id==='confirmed-execution-before-refresh').observation.recovery.executionId,'original')
})
test('unacknowledged submitting recovery never gets reloaded as a confirmed execution',async()=>{
 const page=syntheticCasePage('p1-async',{pending:false})
 await assert.rejects(runAmisP1BrowserCase(page.adapter,{...options,id:'A-double-submit-refresh-and-reentry-do-not-replay',scenario:page.scenario}),error=>{assert.equal(error.report.failure.phase,'confirmed-execution-before-refresh');return true})
 assert(!page.actions.includes('reload'))
})
test('read-only loading observer retains a transient busy state through mutation oldValue',()=>{
 const saved={document:globalThis.document,location:globalThis.location,MutationObserver:globalThis.MutationObserver}
 let current='false',observer,disconnected=false
 const main={getAttribute:()=>current}
 globalThis.document={querySelector:()=>main};globalThis.location={href:base+'/query'}
 globalThis.MutationObserver=class {constructor(callback){observer=this;this.callback=callback;this.records=[]}observe(){}takeRecords(){return this.records}disconnect(){disconnected=true}}
 try {
  p1ObserveQueryLoading({operation:'start'})
  // Loading already returned to false by the time the observer drains its batch.
  observer.records=[{target:main,attributeName:'aria-busy',oldValue:'false'},{target:main,attributeName:'aria-busy',oldValue:'true'}]
  const observed=p1ObserveQueryLoading({operation:'stop'})
  assert(observed.busyTrueObserved);assert.equal(observed.finalBusy,'false');assert(disconnected)
  assert.equal(globalThis.__rootAmisP1QueryLoading,undefined)
 } finally {for(const [key,value]of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value;delete globalThis.__rootAmisP1QueryLoading}
})

test('dialog selector scopes native Confirm to the unique visible dialog',()=>{
 const saved={document:globalThis.document,getComputedStyle:globalThis.getComputedStyle}
 const html={tagName:'HTML'},body={tagName:'BODY',parentElement:html},dialog={tagName:'SECTION',parentElement:body,getClientRects:()=>[{}]}
 const button={tagName:'BUTTON',parentElement:dialog,textContent:'Confirm',getClientRects:()=>[{}]}
 html.children=[body];body.children=[dialog];dialog.children=[button];dialog.querySelectorAll=()=>[button]
 globalThis.getComputedStyle=()=>({visibility:'visible'})
 globalThis.document={documentElement:html,querySelectorAll:selector=>{assert.equal(selector,'[role="dialog"]');return [dialog]}}
 try {
  assert.equal(p1ControlSelector({kind:'dialog-confirm',text:'Confirm'}),'html > body:nth-of-type(1) > section:nth-of-type(1) > button:nth-of-type(1)')
  dialog.querySelectorAll=()=>[button,button]
  assert.throws(()=>p1ControlSelector({kind:'dialog-confirm',text:'Confirm'}),/Expected one live control/)
 } finally {for(const [key,value]of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value}
})

function withSyntheticDateDom(run) {
 const saved={document:globalThis.document,getComputedStyle:globalThis.getComputedStyle}
 const html={tagName:'HTML'},body={tagName:'BODY',parentElement:html},picker={tagName:'DIV',parentElement:body}
 const date={tagName:'INPUT',parentElement:picker,name:'',getClientRects:()=>[{}],getAttribute:()=>null}
 html.children=[body];body.children=[picker];picker.children=[date]
 let pickerInputs=[date],inputs=[date]
 globalThis.getComputedStyle=node=>({visibility:node.hidden?'hidden':'visible'})
 globalThis.document={documentElement:html,querySelectorAll:selector=>selector==='.cxd-DatePicker input, .dark-DatePicker input'?pickerInputs:selector==='input'?inputs:[]}
 try {return run({date,picker,setPicker:value=>{pickerInputs=value},setInputs:value=>{inputs=value}})}
 finally {for(const [key,value]of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value}
}
test('AMIS DatePicker input resolves without name, English placeholder or aria label',()=>withSyntheticDateDom(()=>{
 assert.equal(p1ControlSelector({kind:'date'}),'html > body:nth-of-type(1) > div:nth-of-type(1) > input:nth-of-type(1)')
}))
test('date candidates deduplicate component/name/placeholder matches for the same input',()=>withSyntheticDateDom(({date,setPicker})=>{
 date.name='date';date.getAttribute=()=> 'Select Date';setPicker([date,date])
 assert.match(p1ControlSelector({kind:'date'}),/input:nth-of-type\(1\)$/)
}))
test('date resolver excludes hidden alternate-theme candidates but rejects two visible inputs',()=>withSyntheticDateDom(({date,picker,setPicker,setInputs})=>{
 const other={...date,parentElement:picker,hidden:true};picker.children.push(other);setPicker([date,other]);setInputs([date,other])
 assert.match(p1ControlSelector({kind:'date'}),/input:nth-of-type\(1\)$/)
 other.hidden=false
 assert.throws(()=>p1ControlSelector({kind:'date'}),/Expected one live control.*count.*2/)
}))
test('unrelated text input with unknown placeholder cannot impersonate a date picker',()=>withSyntheticDateDom(({date,setPicker})=>{
 setPicker([]);date.getAttribute=()=> 'Pick anything'
 assert.throws(()=>p1ControlSelector({kind:'date'}),/Expected one live control.*count.*0/)
}))

test('native locale preparation occurs on no-init form before query, without extra POST',async()=>{
 const page=syntheticCasePage('p1-query'),evaluate=page.adapter.evaluate,order=[]
 let locale='zh_CN'
 page.adapter.evaluate=async(fn,arg)=>fn.name==='p1LocaleState'?{selected:locale,actualLocale:locale==='en'?'en':'zh-CN',values:['en','zh_CN']}:evaluate(fn,arg)
 page.adapter.selectOption=async(selector,value)=>{order.push('select:'+value);assert.equal(selector,'header label:first-of-type select');locale=value}
 const go=page.adapter.goto;page.adapter.goto=async url=>{order.push(url);return go(url)}
 const report=await runAmisP1BrowserCase(page.adapter,{...options,id:'A-list-pagination-empty-and-loading',scenario:page.scenario})
 assert(report.completed);assert(order.indexOf('select:en')<order.findIndex(value=>value.includes('/p1-query/')))
 assert.equal(report.trace.filter(row=>row.method==='POST').length,2)
 assert(report.checks.filter(row=>row.id.startsWith('native-locale')).every(row=>row.observation.after.actualLocale==='en'))
})
test('locale must actually update html lang after native selection',async()=>{
 const page=syntheticCasePage('p1-async'),evaluate=page.adapter.evaluate
 page.adapter.evaluate=async(fn,arg)=>fn.name==='p1LocaleState'?{selected:'en',actualLocale:'zh-CN',values:['en','zh_CN']}:evaluate(fn,arg)
 await assert.rejects(runAmisP1BrowserCase(page.adapter,{...options,scenario:page.scenario}),error=>{assert.equal(error.report.failure.phase,'native-locale-p1-async');return true})
})
test('busy removal of original submit records protection without looking up old label',async()=>{
 const page=syntheticCasePage('p1-async')
 const report=await runAmisP1BrowserCase(page.adapter,{...options,id:'A-double-submit-refresh-and-reentry-do-not-replay',scenario:page.scenario})
 const duplicate=report.checks.find(row=>row.id==='duplicate-submit').observation
 assert.equal(duplicate.originalSubmit.present,false);assert.equal(duplicate.originalSubmit.busy,true);assert.equal(duplicate.nativeSecondClick,false)
 assert.equal(page.actions.filter(action=>action==='resolve:button:Save changed data').length,1)
})
test('missing original submit without busy or disabled cannot count as duplicate protection',async()=>{
 const page=syntheticCasePage('p1-async'),evaluate=page.adapter.evaluate
 page.adapter.evaluate=async(fn,arg)=>fn.name==='p1SubmitState'?{present:false,visible:false,disabled:null,busy:false}:evaluate(fn,arg)
 await assert.rejects(runAmisP1BrowserCase(page.adapter,{...options,id:'A-double-submit-refresh-and-reentry-do-not-replay',scenario:page.scenario}),error=>{assert.equal(error.report.failure.phase,'duplicate-submit');return true})
})
test('submit read cannot treat replacement non-submit node at same CSS path as second action',()=>{
 const saved=globalThis.document
 globalThis.document={querySelector:selector=>selector==='main'?{getAttribute:()=> 'true'}:{matches:()=>false}}
 try {assert.deepEqual(p1SubmitState('button-path'),{present:false,visible:false,disabled:null,busy:true})}
 finally {if(saved===undefined)delete globalThis.document;else globalThis.document=saved}
})
test('language control identifies first header select by DOM and locale options, independent of aria text',()=>{
 const saved={document:globalThis.document,getComputedStyle:globalThis.getComputedStyle}
 const language={value:'zh_CN',options:[{value:'en'},{value:'zh_CN'}],getClientRects:()=>[{}]},theme={value:'light',options:[{value:'light'}],getClientRects:()=>[{}]}
 let controls=[language,theme]
 globalThis.document={documentElement:{lang:'zh-CN'},querySelectorAll:()=>controls,querySelector:()=>language}
 globalThis.getComputedStyle=()=>({visibility:'visible'})
 try {
  assert.equal(p1LocaleState().selected,'zh_CN')
  controls=[language];assert.throws(()=>p1LocaleState(),/two visible native header selects/)
  controls=[language,theme];language.options=[{value:'zh_CN'}];assert.throws(()=>p1LocaleState(),/invalid locale enumeration/)
 } finally {for(const [key,value]of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value}
})

function statusEvidence() {
 const source={url:base+'/page',timeOrigin:100,startedAt:10}
 const observed={...source,endedAt:20,overflow:false,samples:[{at:10,text:'Result ready',busy:false},{at:12,text:'Execution paused; waiting for resume…',busy:true},{at:19,text:'Result ready',busy:false}]}
 return {source,observed,document:{url:source.url,timeOrigin:100},pausedText:'Execution paused; waiting for resume…'}
}
test('pause history proves short paused+busy after current state already succeeded',()=>{
 const value=statusEvidence();assert.equal(p1VerifyPausedObservation(value.source,value.observed,value.document,value.pausedText),value.observed)
})
for(const [name,change]of [
 ['initial paused text only',v=>v.observed.samples=[{at:11,text:v.pausedText,busy:true}]],
 ['paused text without busy',v=>v.observed.samples[1].busy=false],
 ['busy with unrelated text',v=>v.observed.samples[1].text='Paused in another widget'],
 ['left document',v=>v.document.timeOrigin=101],
 ['left source URL',v=>v.document.url=base+'/other'],
 ['mixed generation',v=>v.observed.timeOrigin=200],
 ['unbounded observation',v=>v.observed.overflow=true],
 ['invalid performance timestamp',v=>v.observed.samples[1].at=9],
])test('paused history rejects '+name,()=>{const value=statusEvidence();change(value);assert.throws(()=>p1VerifyPausedObservation(value.source,value.observed,value.document,value.pausedText))})
test('status observer samples native status and busy, then disconnects only its own observer',()=>{
 const saved={document:globalThis.document,location:globalThis.location,MutationObserver:globalThis.MutationObserver,getComputedStyle:globalThis.getComputedStyle}
 let callback,disconnected=false,text='Result ready',busy='false'
 const status={getClientRects:()=>[{}],get textContent(){return text}}
 const main={querySelector:()=>status,getAttribute:()=>busy}
 globalThis.document={querySelector:()=>main};globalThis.location={href:base+'/page'};globalThis.getComputedStyle=()=>({visibility:'visible'})
 globalThis.MutationObserver=class{constructor(fn){callback=fn}observe(){}takeRecords(){return []}disconnect(){disconnected=true}}
 try {
  const source=p1ObserveStatus({operation:'start'})
  text='Execution paused; waiting for resume…';busy='true';callback()
  text='Result ready';busy='false';callback()
  const observed=p1ObserveStatus({operation:'stop'})
  assert(observed.samples.some(row=>row.text==='Execution paused; waiting for resume…'&&row.busy))
  assert.equal(observed.url,source.url);assert(disconnected);assert.equal(globalThis.__rootAmisP1StatusObservation,undefined)
  assert.throws(()=>p1ObserveStatus({operation:'stop'}),/document may have changed/)
 } finally {for(const [key,value]of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value;delete globalThis.__rootAmisP1StatusObservation}
})
test('paused readiness fails immediately after document change without waiting adapter timeout',()=>{
 const saved=globalThis.location;globalThis.location={href:base+'/different'}
 try {assert.throws(()=>p1ObservedPausedReady({source:statusEvidence().source,pausedText:'paused'}),/left source document/)}
 finally {if(saved===undefined)delete globalThis.location;else globalThis.location=saved}
})

test('pause case installs observer before native submit and reads retained success-after-pause history',async()=>{
 const page=syntheticCasePage('p1-async'),evaluate=page.adapter.evaluate;let source
 page.adapter.evaluate=async(fn,arg)=>{
  if(fn.name==='p1ObserveStatus') {
   page.actions.push('status-'+arg.operation)
   if(arg.operation==='start') {source={url:base+'/company.p1/p1-async/pages/home',timeOrigin:1,startedAt:10};return source}
   return {...source,endedAt:30,overflow:false,samples:[{at:10,text:'Result ready',busy:false},{at:12,text:'Execution paused; waiting for resume…',busy:true},{at:29,text:'Result ready',busy:false}]}
  }
  return evaluate(fn,arg)
 }
 const report=await runAmisP1BrowserCase(page.adapter,{...options,id:'A-paused-execution-remains-pending',scenario:page.scenario})
 assert(report.completed);assert(page.actions.indexOf('status-start')<page.actions.indexOf('click:submit-button'))
 assert(page.actions.indexOf('status-stop')>page.actions.indexOf('click:submit-button'))
 assert.equal(report.trace.filter(row=>row.method==='POST').length,1)
 assert.equal(report.pausedObservation.samples.at(-1).busy,false)
})

function withSyntheticSwitchDom(run) {
 const saved={document:globalThis.document,getComputedStyle:globalThis.getComputedStyle}
 const html={tagName:'HTML'},body={tagName:'BODY',parentElement:html},label={tagName:'LABEL',parentElement:body,getClientRects:()=>[{}]}
 const input={tagName:'INPUT',parentElement:label,getClientRects:()=>[{}],closest:selector=>selector==='label[data-role="switch"]'||selector==='label'?label:null}
 html.children=[body];body.children=[label];label.children=[input]
 let inputs=[input]
 globalThis.document={documentElement:html,querySelectorAll:()=>inputs}
 globalThis.getComputedStyle=node=>({visibility:node.hidden?'hidden':'visible'})
 try {return run({input,label,body,setInputs:value=>{inputs=value}})}
 finally {for(const [key,value]of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value}
}
test('switch prefers native label even when underlying checkbox has client rects',()=>withSyntheticSwitchDom(()=>{
 assert.equal(p1ControlSelector({kind:'switch'}),'html > body:nth-of-type(1) > label:nth-of-type(1)')
}))
test('switch uses closest visible label without data-role rather than underlying input',()=>withSyntheticSwitchDom(({input,label})=>{
 input.closest=selector=>selector==='label'?label:null
 assert.equal(p1ControlSelector({kind:'switch'}),'html > body:nth-of-type(1) > label:nth-of-type(1)')
}))
test('switch deduplicates label targets and rejects multiple visible switches',()=>withSyntheticSwitchDom(({input,label,body,setInputs})=>{
 setInputs([input,input]);assert.match(p1ControlSelector({kind:'switch'}),/label:nth-of-type\(1\)$/)
 const otherLabel={...label},otherInput={...input,closest:()=>otherLabel};body.children.push(otherLabel);setInputs([input,otherInput])
 assert.throws(()=>p1ControlSelector({kind:'switch'}),/Expected one live control.*count.*2/)
}))
test('switch refuses fully hidden input and label',()=>withSyntheticSwitchDom(({input,label})=>{
 input.hidden=true;label.hidden=true
 assert.throws(()=>p1ControlSelector({kind:'switch'}),/Expected one live control.*count.*0/)
}))
