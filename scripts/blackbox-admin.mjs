#!/usr/bin/env node
// Verify actual first-install identity with the default Compose administrator policy.
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const [base,directory,phase]=process.argv.slice(2);
const check=(ok,label)=>{if(!ok)throw Error(label);console.log(`PASS ${phase}: ${label}`);};
const cookies=new Map();
async function request(path,options={}) {
 const url=new URL(path,base);if(url.origin!==new URL(base).origin)throw Error('Cross-origin test request');
 const r=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(90000),...options,headers:{Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; '),...options.headers}});
 for(const c of r.headers.getSetCookie()){const pair=c.split(';')[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}return r;
}
let r=await request('/oauth/login/kestra');check(r.status===302,'OAuth login starts');
r=await request(r.headers.get('location'));const login=new URL(r.headers.get('location'),base);
check(login.pathname==='/oidc/login','first administrator uses password login');
r=await request('/oidc/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:'tester',password:'Passw0rd!',from:login.searchParams.get('from')})});
check(r.status===303,'first administrator credential accepted');
for(let hop=0;hop<10 && [301,302,303,307,308].includes(r.status);hop++)r=await request(r.headers.get('location'));
const html=await r.text();const csrf=html.match(/name="csrf-token"[^>]*content="([^"]+)"/)?.[1]||html.match(/content="([^"]+)"[^>]*name="csrf-token"/)?.[1];
check(r.status===200&&csrf&&cookies.has('JWT'),'OAuth callback, UI and CSRF available');
if(phase==='missing') {
 for(const path of ['/api/v1/configs','/api/v1/main/flows/search','/api/v1/main/executions/search'])check((await request(path)).status===403,`missing jar fails closed: ${path}`);
} else {
 const roles=execFileSync('docker',['exec',process.env.BB_RBAC_PG,'psql','-U','kestra','-d','kestra','-Atc',"SELECT roles FROM oidc_user WHERE username='tester'"],{encoding:'utf8'});
 check(JSON.parse(roles).includes('admin'),'first-install database role is admin');
 const reads=['/api/v1/configs','/api/v1/main/flows/search','/api/v1/main/executions/search','/api/v1/main/namespaces/search','/api/v1/main/kv','/api/v1/plugins','/api/v1/main/mcp-servers'];
 for(const path of reads){const result=await request(path);check(result.ok,`global UI API ${path} (${result.status})`);await result.body?.cancel();}
 const ns='admin.outside.examples',id=`admin-parity-${phase}`;
 const source=`id: ${id}\nnamespace: ${ns}\nvariables:\n  text: verified\ntasks:\n  - id: write\n    type: io.kestra.plugin.core.storage.Write\n    content: "{{ vars.text }}"\n`;
 const headers={'Content-Type':'application/x-yaml','X-CSRF-TOKEN':csrf};
 r=await request('/api/v1/main/flows',{method:'POST',headers:{'Content-Type':'application/x-yaml'},body:source});check(r.status===403,'administrator cannot bypass CSRF');
 r=await request('/api/v1/main/flows',{method:'POST',headers,body:source});check(r.ok,`create flow outside restricted namespace (${r.status})`);
 r=await request(`/api/v1/main/flows/${ns}/${id}`,{method:'PUT',headers,body:source.replace('verified','updated')});check(r.ok,'update flow');
 r=await request(`/api/v1/main/flows/${ns}/${id}/revisions`);check(r.ok,'read revisions beyond ordinary-role whitelist');
 r=await request(`/api/v1/main/executions/${ns}/${id}?wait=true`,{method:'POST',headers:{'X-CSRF-TOKEN':csrf}});
 check(r.ok,`execute dynamic flow outside restricted namespace (${r.status})`);const execution=await r.json();check(execution.id&&execution.state?.current==='SUCCESS','dynamic flow actually succeeded');
 const kv=`/api/v1/main/namespaces/${ns}/kv/parity`;
 r=await request(kv,{method:'PUT',headers:{'Content-Type':'text/plain','X-CSRF-TOKEN':csrf},body:'"admin-value"'});check(r.ok,'create KV');
 r=await request(kv);check(r.ok,'read KV');const value=await r.json();check(value.value==='admin-value','KV persisted');
 r=await request(kv,{method:'DELETE',headers:{'X-CSRF-TOKEN':csrf}});check(r.ok,'delete KV');check((await request(kv)).status===404,'KV deletion persisted');
 const file=`/api/v1/main/namespaces/${ns}/files?path=%2Fadmin-parity.txt`;
 const form=new FormData();form.set('fileContent',new Blob(['admin-file']),'admin-parity.txt');
 r=await request(file,{method:'POST',headers:{'X-CSRF-TOKEN':csrf},body:form});check(r.ok,'upload namespace file');
 r=await request(file);check(r.ok&&(await r.text())==='admin-file','download persisted namespace file');
 r=await request(file,{method:'DELETE',headers:{'X-CSRF-TOKEN':csrf}});check(r.ok,'delete namespace file');
 // Browser visits the real resource details before the isolated project is removed.
 writeFileSync(`${directory}/${phase}.resources.json`,JSON.stringify({namespace:ns,flowId:id,executionId:execution.id}));
 writeFileSync(`${directory}/${phase}.cookies.json`,JSON.stringify([...cookies]));
}
writeFileSync(`${directory}/${phase}.passed`,'passed\n');
