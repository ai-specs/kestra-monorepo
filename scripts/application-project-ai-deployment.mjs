import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {runApplicationProjectAiRuntime} from './application-project-ai-runtime.mjs'
import {createAiControls} from './application-project-ai-controls.mjs'
import {createPlaywrightApplicationProjectAdapter} from './application-project-browser-adapters.mjs'

/** Root-only production composition. No provider, identity or repository bean replacement. */
export async function runAiDeployment(options) {
  const {output,record,base,project,configuration,command}=options
  await mkdir(output,{recursive:true,mode:0o700})
  let browser,context,adapter,rawPage
  const persist=async report=>{
    await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600})
    await record(report)
  }
  try {
    if(options.uiAdapter)adapter=options.uiAdapter
    else {
      const require=createRequire(import.meta.url)
      const {chromium}=require('playwright')
      browser=await chromium.launch({headless:true})
      context=await browser.newContext({viewport:{width:1280,height:900}})
      rawPage=await context.newPage()
    }
    const controls=createAiControls({base,project,command,configuration,record:async event=>{await writeFile(join(output,'last-control.json'),JSON.stringify(event,null,2)+'\n',{mode:0o600})}})
    const platform=process.platform
    if(platform==='linux') {
      configuration.services.kestra.extra_hosts??=[]
      configuration.services.kestra.extra_hosts.push('host.docker.internal:host-gateway')
    }
    const captureRuntimeDiagnostics=async ({mode})=>{
      assert(['A','B'].includes(mode))
      const container=String(await options.compose('ps','-q','kestra')).trim()
      assert.match(container,/^[a-f0-9]{12,64}$/)
      assert.equal(String(await command('docker',['inspect','-f','{{index .Config.Labels "owner"}}',container])).trim(),project)
      const logs=String(await command('docker',['logs',container]))
      const sanitized=logs.split('\n').map(line=>/token|password|secret|cookie|authorization|Bearer|eyJ[A-Za-z0-9_-]+\.|[?&](?:state|code)=/i.test(line)?'[credential-bearing line redacted]':line).join('\n')
      await writeFile(join(output,'mode-'+mode+'-service.log'),sanitized+'\n',{mode:0o600})
    }
    const prepareModePage=async mode=>{
      if(!rawPage)return options.prepareModePage?options.prepareModePage(mode):adapter
      if(adapter){await adapter.dispose();adapter=null}
      await rawPage.goto('about:blank')
      adapter=await createPlaywrightApplicationProjectAdapter(rawPage,{artifactDirectory:join(output,'screenshots',mode),diagnosticDirectory:join(output,'diagnostics')})
      return adapter
    }
    return await runApplicationProjectAiRuntime({...options,page:adapter,prepareModePage,controls,record:persist,captureRuntimeDiagnostics,modelHost:'0.0.0.0',modelBaseForPort:port=>'http://host.docker.internal:'+port})
  } finally {
    if(adapter&&!options.uiAdapter)await adapter.dispose()
    await context?.close()
    await browser?.close()
  }
}
