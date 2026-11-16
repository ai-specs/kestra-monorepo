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
  let browser,context,adapter
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
      adapter=await createPlaywrightApplicationProjectAdapter(await context.newPage(),{artifactDirectory:join(output,'screenshots'),diagnosticDirectory:join(output,'diagnostics')})
    }
    const controls=createAiControls({base,project,command,configuration,record:async event=>{await writeFile(join(output,'last-control.json'),JSON.stringify(event,null,2)+'\n',{mode:0o600})}})
    const platform=process.platform
    if(platform==='linux') {
      configuration.services.kestra.extra_hosts??=[]
      configuration.services.kestra.extra_hosts.push('host.docker.internal:host-gateway')
    }
    return await runApplicationProjectAiRuntime({...options,page:adapter,controls,record:persist,modelHost:'0.0.0.0',modelBaseForPort:port=>'http://host.docker.internal:'+port})
  } finally {
    if(adapter&&!options.uiAdapter)await adapter.dispose()
    await context?.close()
    await browser?.close()
  }
}
