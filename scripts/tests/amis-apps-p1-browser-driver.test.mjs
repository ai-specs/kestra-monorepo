// Synthetic collector events verify binding only; no production login is claimed.
import test from 'node:test'
import assert from 'node:assert/strict'
import {verifyP1CredentialSubmission} from '../amis-apps-p1-browser-driver.mjs'
const base='http://127.0.0.1:18129'
const request={kind:'request',method:'POST',url:base+'/oidc/login',requestId:'request-1',documentId:'document-1'}
const response={...request,kind:'http-response',status:303}
test('credential receipt binds successful native POST to its source document and request',()=>{
 assert.deepEqual(verifyP1CredentialSubmission([request,response],base,'caller'),{subject:'caller',credentialsSubmitted:true,requestId:'request-1',documentId:'document-1',httpStatus:303,transport:'production-browser'})
})
for(const [name,delta] of Object.entries({oldDocument:{documentId:'old'},otherRequest:{requestId:'other'},badPassword:{status:200},oidcRedirect:{url:base+'/oauth/login/kestra'},otherOrigin:{url:'http://localhost:18129/oidc/login'}}))test('reject unbound credential redirect '+name,()=>{
 assert.throws(()=>verifyP1CredentialSubmission([request,{...response,...delta}],base,'caller'),/redirect/)
})
test('existing cookies or GET redirect cannot impersonate credential login',()=>{
 assert.throws(()=>verifyP1CredentialSubmission([{...request,method:'GET'},response],base,'caller'),/submission/)
 assert.throws(()=>verifyP1CredentialSubmission([response],base,'caller'),/submission/)
})

import {generateKeyPairSync,sign} from 'node:crypto'
import {verifyP1UiIdentity} from '../amis-apps-p1-browser-driver.mjs'
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048})
const key={...publicKey.export({format:'jwk'}),kid:'synthetic-key'}
const claims={iss:base,sub:'synthetic-caller',aud:'kestra-ui',iat:100,exp:300,kestra_application_group_v1:{application_group_id:'main',client_id:'kestra-ui',authorization_version:2,application_group_scopes:['synthetic-scope']}}
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url')
function signed(value=claims) {const data=encode({alg:'RS256',kid:key.kid})+'.'+encode(value);return data+'.'+sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url')}
const options={base,subject:'synthetic-caller',mode:'B',jwks:{keys:[key]},now:200}
test('same-browser signed identity exposes only verified public claims',()=>{
 const token=signed(),receipt=verifyP1UiIdentity(token,options)
 assert.equal(receipt.subject,'synthetic-caller');assert.equal(receipt.signatureVerified,true);assert.equal(receipt.authorizationVersion,2)
 assert(!JSON.stringify(receipt).includes(token));assert(!('exp'in receipt))
})
for(const [name,delta] of Object.entries({otherSubject:{sub:'other'},otherIssuer:{iss:'http://other.invalid'},otherAudience:{aud:['kestra-ui','other']},expired:{exp:199},future:{iat:240},wrongGroup:{kestra_application_group_v1:{...claims.kestra_application_group_v1,application_group_id:'other'}},noAuthorization:{kestra_application_group_v1:null}}))test('reject wrong same-browser identity '+name,()=>{
 assert.throws(()=>verifyP1UiIdentity(signed({...claims,...delta}),options))
})
test('tampered signature and unknown signing key are rejected',()=>{
 const token=signed(),parts=token.split('.');parts[2]=Buffer.alloc(256).toString('base64url')
 assert.throws(()=>verifyP1UiIdentity(parts.join('.'),options),/signature/)
 assert.throws(()=>verifyP1UiIdentity(token,{...options,jwks:{keys:[]}}))
})
test('mode A does not require an RBAC group claim',()=>{
 const value={...claims};delete value.kestra_application_group_v1
 assert(verifyP1UiIdentity(signed(value),{...options,mode:'A'}).signatureVerified)
})

import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {retainP1BrowserEvidence} from '../amis-apps-p1-browser-driver.mjs'
test('failed partial browser reports retain hash-bound screenshots and immutable diagnostics',t=>{
 const area=mkdtempSync(join(tmpdir(),'p1-retain-synthetic-'));t.after(()=>rmSync(area,{recursive:true,force:true}))
 const output=join(area,'browser-0');mkdirSync(join(output,'diagnostics'),{recursive:true});mkdirSync(join(output,'screenshots'))
 const file=join(output,'diagnostics','synthetic.json'),bytes='{"events":[],"integrity":[]}',hash=createHash('sha256').update(bytes).digest('hex');writeFileSync(file,bytes)
 const png=join(output,'screenshots','failed.png');writeFileSync(png,'SYNTHETIC IMAGE BYTES')
 const original={completed:false,failure:{phase:'typed-submit'},checks:[{status:'failed',evidence:{diagnosticFile:{kind:'immutable-browser-diagnostics',path:file,sha256:hash},artifacts:[{path:png,label:'failed-submit',createdAt:'synthetic'}]}}]}
 const retained=retainP1BrowserEvidence(original,output)
 assert.equal(retained.completed,false);assert.equal(retained.failure.phase,'typed-submit');assert.equal(retained.attachments.length,2)
 assert.deepEqual(retained.attachments.map(x=>x.path),['browser-0/diagnostics/synthetic.json','browser-0/screenshots/failed.png'])
 assert.equal(original.checks[0].evidence.diagnosticFile.path,file,'Collector source references remain immutable')
 assert.deepEqual(retainP1BrowserEvidence(retained,output),retained,'Normalized retained manifests survive subsequent persistence')
 writeFileSync(file,'changed');assert.throws(()=>retainP1BrowserEvidence(original,output))
})
