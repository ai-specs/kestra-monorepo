import assert from 'node:assert/strict'

// Production journey shared by Ego and CI. Transport adapters only provide native input
// and source-attributed CDP events; no mocked authorization or execution transport.
export async function runFirstAccountExecutions(page,{base,prefix,readExecution,record=async()=>{}}) {
  assert.match(prefix,/^[a-z][a-z0-9_]{0,60}$/)
  assert.equal(typeof readExecution,'function')
  const report={completed:false,planned:10,executions:[]}
  await record(report)
  for(let index=0;index<10;index++) {
    const namespace=index%2?'company.consistency.child':'company.consistency'
    const flowId=prefix+'_'+index
    const row={index,namespace,flowId,status:'running'}
    report.executions.push(row);await record(report)
    try {
      await page.goto(base+'/ui/main/flows/new')
      await page.waitForFunction(()=>Boolean(document.querySelector('.monaco-editor .view-lines')))
      await page.evaluate(()=>{
        window.__firstAccountExecutionObserver?.disconnect()
        const state={errors:[],streams:[]};window.__firstAccountExecution=state
        // The upstream SDK uses fetch streaming, not EventSource. Observe a clone of
        // the actual response; leave the request, response and original stream intact.
        if(!window.__firstAccountOriginalFetch) {
          window.__firstAccountOriginalFetch=window.fetch
          window.fetch=async function(...args) {
            const response=await window.__firstAccountOriginalFetch.apply(this,args)
            if(/\/api\/v1\/main\/executions\/[^/]+\/follow(?:\?|$)/.test(response.url)&&response.body) {
              const stream={url:response.url,status:response.status,ids:[],completed:false}
              window.__firstAccountExecution.streams.push(stream)
              ;(async()=>{
                const reader=response.clone().body.getReader(),decoder=new TextDecoder();let pending=''
                try {for(;;){const {value,done}=await reader.read();if(done)break
                  pending+=decoder.decode(value,{stream:true}).replaceAll('\r\n','\n')
                  let boundary;while((boundary=pending.indexOf('\n\n'))>=0){const event=pending.slice(0,boundary);pending=pending.slice(boundary+2)
                    const id=event.split('\n').find(line=>line.startsWith('id:'))?.slice(3).trim();if(id)stream.ids.push(id)}
                }stream.completed=true}catch(error){stream.error=String(error)}
              })()
            }
            return response
          }
        }
        const observe=()=>{
          for(const node of document.querySelectorAll('.kel-notification')) {
            const error=node.classList.contains('kel-notification--error')||Boolean(node.querySelector('.kel-notification__icon--error'))
              || /^(Error|错误|Connection interrupted|连接中断)\s/.test(node.innerText)
            if(error&&!state.errors.some(item=>item.text===node.innerText))state.errors.push({text:node.innerText,url:location.href})
          }
        }
        window.__firstAccountExecutionObserver=new MutationObserver(observe)
        window.__firstAccountExecutionObserver.observe(document.body,{childList:true,subtree:true,characterData:true})
        observe()
      })
      await page.replaceEditorText(`id: ${flowId}\nnamespace: ${namespace}\ntasks:\n  - id: hello\n    type: io.kestra.plugin.core.log.Log\n    message: First account execution regression\n`)
      const save=await page.evaluate(()=>{
        const buttons=[...document.querySelectorAll('button')].filter(node=>node.getClientRects().length&&/^(Save|保存)$/.test(node.innerText.trim()))
        if(buttons.length!==1)throw new Error('Expected one native save button')
        return buttons[0].innerText.trim()
      })
      await page.click('button:text-is('+JSON.stringify(save)+')')
      await page.waitForFunction(({namespace,flowId})=>location.pathname.startsWith('/ui/main/flows/edit/'+namespace+'/'+flowId),{namespace,flowId})
      await page.click('#execute-button')
      await page.waitForFunction(()=>Boolean(document.querySelector('[data-test="execute-dialog-button"]')?.getClientRects().length))
      await page.click('[data-test="execute-dialog-button"]')
      await page.waitForFunction(({namespace,flowId})=>location.pathname.startsWith('/ui/main/executions/'+namespace+'/'+flowId+'/'),{namespace,flowId})
      row.path=await page.evaluate(()=>location.pathname)
      row.executionId=row.path.split('/')[6]
      assert(row.executionId)
      const follow=base+'/api/v1/main/executions/'+row.executionId+'/follow'
      const deadline=Date.now()+60000
      for(;;) {
        const streams=await page.evaluate(()=>window.__firstAccountExecution.streams)
        row.streams=streams
        row.notifications=await page.evaluate(()=>window.__firstAccountExecution?.errors??[])
        assert.deepEqual(row.notifications,[],'Production execution displayed an error notification')
        const events=(await page.diagnostics()).events
        const stream=streams.find(value=>value.url===follow&&value.status===200&&value.ids.includes('end')&&value.completed&&!value.error)
        const response=events.find(event=>event.kind==='http-response'&&event.url===follow&&event.status===200)
        if(stream&&response){row.followEnd={requestId:response.requestId,documentId:response.documentId,eventId:'end',stream};break}
        assert(Date.now()<deadline,'Execution follow did not deliver a terminal SSE event')
        await new Promise(resolve=>setTimeout(resolve,200))
      }
      await page.waitForFunction(()=>document.body.innerText.includes('1 Succeeded'))
      row.stored=await readExecution(row.executionId)
      assert.equal(row.stored.id,row.executionId);assert.equal(row.stored.namespace,namespace)
      assert.equal(row.stored.flowId,flowId);assert.equal(row.stored.state,'SUCCESS')
      row.status='passed'
    } catch(error) {row.status='failed';row.error=error.message;throw error}
    finally {await page.evaluate(()=>{window.__firstAccountExecutionObserver?.disconnect();if(window.__firstAccountOriginalFetch){window.fetch=window.__firstAccountOriginalFetch;delete window.__firstAccountOriginalFetch}});await record(report)}
  }
  report.completed=true;await record(report)
  return report
}

export function assertFirstAccountExecutions(report) {
  assert.equal(report.completed,true);assert.equal(report.planned,10)
  assert.equal(report.executions.length,10)
  assert.equal(new Set(report.executions.map(row=>row.executionId)).size,10)
  for(const [index,row]of report.executions.entries()) {
    assert.equal(row.index,index);assert.equal(row.status,'passed');assert.deepEqual(row.notifications,[])
    assert.equal(row.namespace,index%2?'company.consistency.child':'company.consistency')
    assert.equal(row.path,`/ui/main/executions/${row.namespace}/${row.flowId}/${row.executionId}/gantt`)
    assert.equal(row.followEnd.eventId,'end');assert(row.followEnd.requestId&&row.followEnd.documentId)
    assert.equal(row.followEnd.stream.status,200);assert.equal(row.followEnd.stream.completed,true)
    assert(row.followEnd.stream.ids.includes('end'));assert.equal(row.followEnd.stream.error,undefined)
    assert.equal(new URL(row.followEnd.stream.url).pathname,'/api/v1/main/executions/'+row.executionId+'/follow')
    assert.deepEqual(row.stored,{id:row.executionId,namespace:row.namespace,flowId:row.flowId,state:'SUCCESS'})
  }
}
