import test from 'node:test'
import assert from 'node:assert/strict'
import {hostBookmarkCaseNames,assertHostBookmarkReports} from '../published-ui-browser-evidence.mjs'
const hashes={sourceSha256:'a'.repeat(64),helperSha256:'b'.repeat(64)}
function fixture(){return Object.fromEntries(['form','env'].map(mode=>{
 const finalUrl='http://localhost:18081/ui/main/dashboards'
 const evidence=[{finalUrl:'http://localhost:18081/ui/main/flows',originalCookieConsumed:true},{status:307,expirationCookieCount:1,transport:'HTTP cookie lifecycle check'},{finalUrl},{finalUrl,originalCookieConsumed:true,destinations:[finalUrl]}]
 const diagnosticSources=hostBookmarkCaseNames.map((name,index)=>({name,documents:[{id:'doc'+index}],integrity:[],events:[{id:'event1',kind:'document',documentId:'doc'+index}]}))
 return ['bookmark-'+mode+'.json',{completed:true,mode,checks:hostBookmarkCaseNames.map((name,index)=>({name,passed:true,evidence:evidence[index]})),...hashes,finalInputHashesEqual:true,candidateImage:'sha256:'+'c'.repeat(64),diagnosticSources,diagnostics:{events:diagnosticSources.flatMap(source=>source.events.map(event=>({...event,sourceName:source.name,sourceEventId:source.name+':'+event.id})))}}]
}))}
const check=reports=>assertHostBookmarkReports(Object.fromEntries(Object.entries(reports).map(([k,v])=>[k,JSON.stringify(v)])),hashes)
test('published bookmark reports require both modes and eight exact cases',()=>assert.equal(check(fixture()).checks,8))
for(const [name,change]of [
 ['missing mode',r=>delete r['bookmark-env.json']],['unfinished',r=>r['bookmark-form.json'].completed=false],
 ['old source',r=>r['bookmark-env.json'].sourceSha256='d'.repeat(64)],['missing case',r=>r['bookmark-env.json'].checks.pop()],
 ['duplicate case',r=>r['bookmark-form.json'].checks[1]=r['bookmark-form.json'].checks[0]],
 ['empty summaries',r=>r['bookmark-form.json'].diagnostics.events=[]],
 ['missing documents',r=>r['bookmark-form.json'].diagnosticSources[0].documents=[]],
 ['source integrity',r=>r['bookmark-env.json'].diagnosticSources[0].integrity=['lost']],
 ['wrong callback',r=>r['bookmark-form.json'].checks[0].evidence.finalUrl='http://localhost:18081/ui/'],
 ['external redirect',r=>r['bookmark-env.json'].checks[3].evidence.destinations=['https://external.invalid/']],
 ['cookie remains',r=>r['bookmark-form.json'].checks[3].evidence.originalCookieConsumed=false],
])test('published bookmark rejects '+name,()=>{const r=fixture();change(r);assert.throws(()=>check(r))})
