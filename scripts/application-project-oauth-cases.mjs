import assert from 'node:assert/strict'
import {createHash,randomBytes} from 'node:crypto'
import {ProductionOAuthClient} from './production-oauth-client.mjs'
import {applicationProject,namespaceDomains} from './application-project-cases.mjs'

export const oauthCheckIds=Object.freeze(['oauth-error-callback-preserves-session','oauth-error-callback-state-rejection'])
export async function runApplicationProjectOauth(base,{planned,snapshot},record) {
  assert.equal(base,planned.base)
  assert.equal(typeof snapshot,'function')
  const report={completed:false,checks:oauthCheckIds.map(id=>({id,status:'not_run',passed:false,evidence:{}})),requests:[]}
  const persist=async()=>{report.completed=report.checks.every(row=>row.passed);await record(structuredClone(report))}
  const hash=value=>createHash('sha256').update(value).digest('hex')
  const businessPath='/api/v1/main/flows/'+encodeURIComponent(namespaceDomains.a)+'/allowed-id'
  await persist()
  for(const row of report.checks) {
    row.status='running';await persist()
    let client
    try {
      const cookieHashes=new Map()
      client=new ProductionOAuthClient(base)
      const original=client.request.bind(client)
      client.request=async(path,options,includeSession)=>{
        const response=await original(path,options,includeSession)
        for(const value of response.headers.getSetCookie()) {
          const pair=value.split(';')[0],separator=pair.indexOf('='),name=pair.slice(0,separator)
          if(separator>0){if(pair.slice(separator+1)&&!/;\s*max-age=0(?:;|$)/i.test(value))cookieHashes.set(name,hash(pair.slice(separator+1)));else cookieHashes.delete(name)}
        }
        report.requests.push({check:row.id,path:new URL(path,base).pathname,method:options?.method??'GET',status:response.status})
        return response
      }
      await client.login(planned.admin.username,planned.admin.password)
      const beforeIdentity=await client.verifiedUiIdentity({projectId:applicationProject,subject:planned.admin.subject,audience:planned.expectedAudience})
      const authenticationHashes=()=>Object.fromEntries(['JWT','oidc_session'].map(name=>[name,cookieHashes.get(name)]))
      const beforeAuthentication=authenticationHashes()
      assert(beforeAuthentication.JWT&&beforeAuthentication.oidc_session,'production login must issue both authentication cookies')
      const readable=async()=>{const response=await client.request(businessPath);assert.equal(response.status,200,'same authenticated session must retain real business access');const flow=await response.json();assert.equal(flow.id,'allowed-id');assert.equal(flow.namespace,namespaceDomains.a)}
      await readable()
      const before=snapshot()
      const start=async()=>{
        const response=await client.request('/oauth/login/kestra')
        assert.equal(response.status,302)
        const authorization=new URL(response.headers.get('location'),base);await response.body?.cancel()
        assert.equal(authorization.origin,base);assert.equal(authorization.pathname,'/oidc/authorize')
        assert.equal(authorization.searchParams.get('client_id'),planned.expectedAudience)
        const callback=new URL(authorization.searchParams.get('redirect_uri'))
        assert.equal(callback.origin,base);assert.equal(callback.pathname,'/oauth/callback/kestra')
        const state=authorization.searchParams.get('state')
        assert(state&&cookieHashes.has('OAUTH2_STATE'),'actual OAuth entry must create framework state and its cookie')
        return {callback,state,stateHash:cookieHashes.get('OAUTH2_STATE')}
      }
      const attempt=async(flow,{state=flow.state,error='invalid_scope',status,clearState=false}={})=>{
        const marker='must-not-echo-'+randomBytes(12).toString('hex')
        const target=new URL(flow.callback)
        target.searchParams.set('error',error);target.searchParams.set('error_description',marker)
        if(state!==null)target.searchParams.set('state',state)
        const stateBefore=cookieHashes.get('OAUTH2_STATE')
        const response=await client.request(target)
        const body=await response.text(),location=response.headers.get('location')??''
        assert.equal(response.status,status,'specific OAuth callback response required')
        assert(!body.includes(marker)&&!location.includes(marker),'provider description must not be reflected')
        assert(!body.includes(flow.state)&&!location.includes(flow.state),'OAuth state must not be reflected')
        assert.deepEqual(authenticationHashes(),beforeAuthentication,'error callback must preserve both existing authentication cookies')
        const expired=response.headers.getSetCookie().filter(value=>/;\s*max-age=0(?:;|$)/i.test(value)).map(value=>value.split('=')[0])
        if(clearState){assert(location==='/oidc/login?error=1','valid error must use the fixed configured failure path');assert(expired.includes('OAUTH2_STATE'));assert(!cookieHashes.has('OAUTH2_STATE'))}
        else {assert(!location,'invalid state/error must not redirect');assert(!expired.includes('OAUTH2_STATE'));assert.equal(cookieHashes.get('OAUTH2_STATE'),stateBefore)}
        await readable()
        const after=snapshot();assert.equal(after.hash,before.hash,'error callback changed policy, directory, database, queue or storage')
        return {status:response.status,error,stateProvided:state!==null,stateCookieCleared:clearState,expiredCookieNames:expired,authenticationCookieHashes:authenticationHashes(),businessStatus:200,sideEffects:{before:before.hash,after:after.hash,sources:Object.keys(before.sources)}}
      }
      const first=await start()
      if(row.id==='oauth-error-callback-preserves-session') {
        const valid=await attempt(first,{status:303,clearState:true})
        const replay=await attempt(first,{status:400})
        const afterIdentity=await client.verifiedUiIdentity({projectId:applicationProject,subject:planned.admin.subject,audience:planned.expectedAudience})
        assert.deepEqual(afterIdentity,beforeIdentity)
        row.evidence={beforeIdentity,afterIdentity,valid,replay,productionLogin:true}
      } else {
        const current=await start()
        assert(first.state!==current.state,'two real OAuth starts must produce distinct state')
        const wrong=await attempt(current,{state:first.state,status:400})
        assert.equal(cookieHashes.get('OAUTH2_STATE'),current.stateHash)
        const missing=await attempt(current,{state:null,status:400})
        const unknown=await attempt(current,{error:'unexpected_custom_error',status:400})
        const validAfterRefusals=await attempt(current,{error:'access_denied',status:303,clearState:true})
        row.evidence={identity:beforeIdentity,wrong,missing,unknown,validAfterRefusals,legitimateStatePreservedUntilMatchingError:true}
      }
      row.passed=true;row.status='passed'
    }catch(error){row.status='failed';row.evidence.error=String(error.message).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted-jwt]').replaceAll(planned.admin.password,'[redacted]')}
    finally{await persist()}
  }
  return report
}
