// Run through ego-browser nodejs; one TaskSpace is reused for every Compose phase.
const fs=await import('node:fs/promises');
const base=process.env.ADMIN_UI_BASE,phase=process.env.ADMIN_UI_PHASE,directory=process.env.ADMIN_UI_DIRECTORY;
const task=await taskSpace(Number(process.env.ADMIN_UI_SPACE)),page=task.page('p1');
const fixture=JSON.parse(await fs.readFile(`${directory}/${phase}.resources.json`,'utf8'));
await page.goto(`${base}/oidc/logout`).catch(error=>{if(!String(error).includes('ERR_ABORTED'))throw error;});
await page.goto(`${base}/ui/`);
console.log(await page.snapshot());
await page.fill('input[name=username]','tester');await page.fill('input[name=password]','Passw0rd!');
await page.click('button[type=submit]');
await new Promise(resolve=>setTimeout(resolve,1500));
console.log('UI login URL',await page.url());
const paths=['dashboards','flows','flows/search','flows/new','executions','kv','secrets','blueprints/community/flows','plugins','logs','namespaces','docs','preferences','admin/triggers','admin/stats','admin/concurrency-limits','admin/mcp-servers','admin/mcp-servers/new','apps','tests','assets','cases','admin/iam','admin/tenants/list','admin/auditlogs','admin/quotas','admin/policies','admin/instance','promote/targets'];
for(const tab of ['overview','executions','edit','promote','revisions','triggers','logs','metrics','dependencies','concurrency','audit-logs'])paths.push(`flows/edit/${fixture.namespace}/${fixture.flowId}/${tab}`);
for(const tab of ['overview','gantt','logs','outputs','metrics','dependencies','audit-logs','assets'])paths.push(`executions/${fixture.namespace}/${fixture.flowId}/${fixture.executionId}/${tab}`);
for(const tab of ['blueprints','overview','edit','flows','executions','dependencies','secrets','credentials','assets','variables','policies','kv','reusable-inputs','files','history','audit-logs'])paths.push(`namespaces/edit/${fixture.namespace}/${tab}`);
for(const tab of ['edit','connect','tool-flows'])paths.push(`admin/mcp-servers/edit/default/${tab}`);
const rows=[];
for(const path of paths) {
 await page.goto(`${base}/ui/main/${path}`);await new Promise(resolve=>setTimeout(resolve,650));
 const result=await page.evaluate(()=>({url:location.href,title:document.title,text:document.body.innerText.slice(0,1200),denied:performance.getEntriesByType('resource').filter(e=>[401,403].includes(e.responseStatus)).map(e=>({url:e.name,status:e.responseStatus})),links:[...document.querySelectorAll('a[href]')].map(a=>({text:a.textContent.trim(),href:a.getAttribute('href')}))}));
 if(!result.url.startsWith(`${base}/ui/`)||result.denied.length)throw Error(`UI authorization failed ${phase} ${path}: ${JSON.stringify(result)}`);
 rows.push({path,...result});console.log(`PASS ${phase} browser ${path}`);
}
await fs.writeFile(`${directory}/${phase}.ui.json`,JSON.stringify(rows,null,2));
console.log(`PASS ${phase}: ${rows.length} browser routes without 401/403`);
