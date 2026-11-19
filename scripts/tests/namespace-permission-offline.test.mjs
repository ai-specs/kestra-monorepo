import test from 'node:test'
import assert from 'node:assert/strict'
import {namespacePermissionCaseIds,initialNamespacePermissionReport,assertNamespacePermissionReport,runNamespacePermissionBrowser,redactNamespacePermissionError,namespacePickerState,waitNamespacePermissionResponse,namespaceFlowLandingReady,namespaceKvTargetReady,dismissNamespaceInstallPrompt} from '../namespace-permission-browser.mjs'

export function completeNamespacePermissionReport() {
  const report=initialNamespacePermissionReport()
  for(const row of report.cases) {
    Object.assign(row,{status:'passed',passed:true,evidence:{transport:'offline-contract-example'}})
    if(row.id.endsWith('-ui-save'))row.evidence={transport:'native-ui',before:'old',value:'new',readBack:'new',response:{status:200,requestId:'save',source:{documentId:'document'}}}
    if(row.id.endsWith('-denied')&&!row.id.includes('refresh'))row.evidence={response:{status:403},before:{stored:'unchanged'},immediate:{stored:'unchanged'},samples:[{snapshot:{stored:'unchanged'}},{snapshot:{stored:'unchanged'}}],minimumObservationMs:2500,observedMs:2500}
  }
  report.loginTransitions=Array.from({length:5},(_,index)=>({requestedTarget:'/ui/main/flows',temporaryPasswordFlow:index===2,
    anonymous:{status:401},previousDocument:{documentId:'previous'},loginDocument:{path:'/oidc/login',documentId:'login'},
    finalDocument:{path:index===2?'/oidc/password':'/ui/main/flows',documentId:'final'},
    businessContent:index===2?'restricted-password-change-form':'visible-flow-list-and-native-response',listResponses:[{status:200,documentId:'final'}]}))
  report.logoutTransitions=Array.from({length:4},()=>({clicked:true,automatic:false,finalDocument:{path:'/oidc/login',documentId:'login'},
    anonymous:{status:401,source:{documentId:'login'}},logoutResponses:[{requestId:'exit',documentId:'login',status:307}]}))
  const list=report.cases.find(row=>row.id==='second-exact-flow-kv-list-and-total').evidence
  const rows=[{namespace:'company.sub',id:'test'},{namespace:'company.sub.child',id:'test'}]
  for(const kind of ['flow','kv'])list[kind]={rows:structuredClone(rows),total:2,namespaces:['company.sub','company.sub.child']}
  list.expectedLists={source:'owned-database',namespace:'company.sub',descendants:true,flow:structuredClone(rows),kv:structuredClone(rows)}
  report.completed=true
  return report
}
test('namespace plan has unique named unexecuted cases and both actors/resources',()=>{
  const report=initialNamespacePermissionReport()
  assert.equal(new Set(namespacePermissionCaseIds).size,namespacePermissionCaseIds.length)
  assert(report.cases.every(row=>row.status==='not_run'&&row.passed===false))
  for(const actor of ['admin','second'])for(const kind of ['flow','kv'])for(const action of ['create','update','delete'])assert(namespacePermissionCaseIds.some(id=>id.startsWith(actor+'-outside-'+kind+'-'+action)))
  assert.throws(()=>assertNamespacePermissionReport(report))
  assertNamespacePermissionReport(completeNamespacePermissionReport())
})
for(const [name,change] of [
  ['omitted case',report=>report.cases.pop()],
  ['missing bookmark callback evidence',report=>delete report.loginTransitions],
  ['manually repaired dashboard landing',report=>report.loginTransitions[0].finalDocument.path='/ui/main/dashboards'],
  ['missing native list response',report=>report.loginTransitions[0].listResponses=[]],
  ['duplicate case',report=>report.cases[1]=report.cases[0]],
  ['unrun case',report=>report.cases[0].status='not_run'],
  ['API write called UI',report=>report.cases[0].evidence.transport='request'],
  ['no actual change',report=>report.cases[0].evidence.before='new'],
  ['save not read back',report=>report.cases[0].evidence.readBack='old'],
  ['save without source',report=>delete report.cases[0].evidence.response.source.documentId],
  ['403 with immediate mutation',report=>report.cases.find(row=>row.id==='admin-outside-kv-update-denied').evidence.immediate={stored:'changed'}],
  ['403 with delayed mutation',report=>report.cases.find(row=>row.id==='second-outside-flow-delete-denied').evidence.samples[1].snapshot={stored:'changed'}],
  ['no delayed observation',report=>report.cases.find(row=>row.id==='admin-outside-flow-create-denied').evidence.samples=[]],
  ['short observation',report=>report.cases.find(row=>row.id==='admin-outside-flow-create-denied').evidence.observedMs=100],
])test('namespace report rejects '+name,()=>{const report=completeNamespacePermissionReport();change(report);assert.throws(()=>assertNamespacePermissionReport(report))})
test('failed production journey retains failed case and remaining not-run matrix',async()=>{
  const reports=[]
  const page={redactSecrets:()=>{},goto:async()=>{throw Error('deliberate UI failure')}}
  await assert.rejects(runNamespacePermissionBrowser(page,{base:'http://localhost:8080',account:{password:'secret'},controls:{readNamespaceResource:async()=>[]},record:async value=>reports.push(value)}),/deliberate UI failure/)
  assert.equal(reports.at(-1).completed,false)
  assert.equal(reports.at(-1).cases[0].status,'failed')
  assert(reports.at(-1).cases.slice(1).every(row=>row.status==='not_run'))
})

test('all account secrets are removed from report and parent error with original cause retained',()=>{
  const secrets=['initial-secret','temporary-credential','initial-secretSecond1!']
  const original=new Error(secrets.join(' / ')+' / '+secrets[1])
  const safe=redactNamespacePermissionError(original,secrets)
  assert.equal(safe.message,'[redacted] / [redacted] / [redacted] / [redacted]')
  assert.equal(safe.cause,original)
  assert.equal(Object.getOwnPropertyDescriptor(safe,'cause').enumerable,false)
  for(const secret of secrets){assert(!safe.message.includes(secret));assert(!safe.stack.includes(secret));assert(!JSON.stringify({error:safe.message}).includes(secret))}
})

for(const [name,{value='',expanded='true',label,options=[],selected=false,count=0,ready=false}] of [
  ['hidden autocomplete result',{options:[{text:'company',visible:false}]}],
  ['one visible autocomplete result',{options:[{text:' company ',visible:true}],count:1,ready:true}],
  ['duplicate visible autocomplete results',{options:[{text:'company',visible:true},{text:'company',visible:true}],count:2}],
  ['committed default with empty search input',{label:'company',value:'',expanded:'false',selected:true,ready:true}],
  ['uncommitted closed search string',{value:'company',expanded:'false'}],
  ['typed query while popup is open',{value:'company',expanded:'true'}],
])test('namespace picker waits correctly for '+name,()=>{
  const previousDocument=globalThis.document,previousStyle=globalThis.getComputedStyle
  const node=(text,shown=true)=>({innerText:text,getClientRects:()=>shown?[{}]:[],getAttribute:()=>null,style:{visibility:shown?'visible':'hidden',display:'block'}})
  const nodes=options.map(option=>node(option.text,option.visible))
  const root={...node('namespace'),querySelectorAll:()=>label?[node(label)]:[]}
  globalThis.document={querySelectorAll:selector=>selector==='[data-test="kv-namespace"]'?[root]:nodes}
  globalThis.getComputedStyle=node=>node.style
  try {
    assert.deepEqual(namespacePickerState('company'),{selected,visibleOptions:count,ready})
    assert.equal(namespacePickerState({namespace:'company',waitFor:'selected'}),selected)
    assert.equal(namespacePickerState({namespace:'company',waitFor:'ready'}),ready)
  } finally {if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;if(previousStyle===undefined)delete globalThis.getComputedStyle;else globalThis.getComputedStyle=previousStyle}
})

test('existing Flow save waits for delayed exact response before readback',async()=>{
  const base='http://localhost:8080',path='/api/v1/main/flows/company.sub/current'
  const source={requestId:'save',documentId:'editor',url:base+path+'?draft=false',method:'PUT'}
  const request={...source,id:'request',kind:'request'},response={...source,id:'response',kind:'http-response',status:200}
  let calls=0
  const result=await waitNamespacePermissionResponse({diagnostics:async()=>({events:++calls===1?[request]:[request,response]})},
    {base,path,method:'PUT',before:new Set(),allowDraftQuery:true,timeoutMs:1000})
  assert.equal(result,response);assert.equal(calls,2)
})
for(const [name,events] of [
  ['two exact responses',[{id:'one',kind:'http-response'},{id:'two',kind:'http-response'}]],
  ['response without source request',[{id:'orphan',kind:'http-response'}]],
  ['no response',[{id:'request',kind:'request'}]],
])test('save response rejects '+name,async()=>{
  const base='http://localhost:8080',path='/api/v1/main/flows/company.sub/current'
  const rows=events.map(event=>({...event,url:base+path,method:'PUT',requestId:'save',documentId:'editor',status:200}))
  await assert.rejects(waitNamespacePermissionResponse({diagnostics:async()=>({events:rows})},
    {base,path,method:'PUT',before:new Set(),timeoutMs:0}))
})

test('login landing accepts visible native table headers with current data on another page',()=>{
  const previous={document:globalThis.document,location:globalThis.location,getComputedStyle:globalThis.getComputedStyle}
  const header={textContent:'ID',getClientRects:()=>[{}]},table={getClientRects:()=>[{}]}
  globalThis.location={pathname:'/ui/main/flows'}
  globalThis.getComputedStyle=()=>({visibility:'visible',display:'block'})
  globalThis.document={querySelector:selector=>selector==='.flows-table'?table:null,querySelectorAll:()=>[header]}
  try {
    assert.equal(namespaceFlowLandingReady(),true)
    globalThis.location.pathname='/ui/main/dashboards';assert.equal(namespaceFlowLandingReady(),false)
    globalThis.location.pathname='/ui/main/flows';header.textContent='';assert.equal(namespaceFlowLandingReady(),false)
  } finally {for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}
})

test('KV edit waits for the unique loaded visible namespace/key row',()=>{
  const previous={document:globalThis.document,getComputedStyle:globalThis.getComputedStyle}
  const button={getClientRects:()=>[{}]}
  const row=(namespace,id,visible=true)=>({getClientRects:()=>visible?[{}]:[],querySelector:()=>button,querySelectorAll:()=>[{textContent:namespace},{textContent:id}]})
  let rows=[]
  globalThis.document={querySelectorAll:()=>rows};globalThis.getComputedStyle=()=>({visibility:'visible',display:'block'})
  try {
    assert.equal(namespaceKvTargetReady({ns:'company.sub',id:'current'}),false)
    rows=[row('company.sub','old')];assert.equal(namespaceKvTargetReady({ns:'company.sub',id:'current'}),false)
    rows.push(row('company.sub','current'));assert.equal(namespaceKvTargetReady({ns:'company.sub',id:'current'}),true)
    rows.push(row('company.sub','current'));assert.equal(namespaceKvTargetReady({ns:'company.sub',id:'current'}),false)
    rows=[row('company.sub','current',false)];assert.equal(namespaceKvTargetReady({ns:'company.sub',id:'current'}),false)
  } finally {for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}
})

for(const label of ['暂不','Not now'])test('native PWA prompt uses real '+label+' click and waits for dismissal',async()=>{
  const actions=[]
  const page={evaluate:async()=>label,click:async selector=>actions.push(['click',selector]),waitForFunction:async()=>actions.push(['wait-dismissed'])}
  assert.equal(await dismissNamespaceInstallPrompt(page),true)
  assert.deepEqual(actions,[['click','.pwa-install-actions button:text-is('+JSON.stringify(label)+')'],['wait-dismissed']])
})
test('absent native install prompt does not dispatch an action',async()=>{
  const page={evaluate:async()=>null,click:async()=>{throw Error('unexpected click')}}
  assert.equal(await dismissNamespaceInstallPrompt(page),false)
})
