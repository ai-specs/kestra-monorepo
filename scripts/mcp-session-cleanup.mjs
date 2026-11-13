import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'

/** Private session handles never enter reports; a failed cleanup remains a failure. */
export class McpSessionCleanup {
  #sessions=[]
  register({client,session,scenario,subject,clientId,refresh=false,reauthorize}) {
    assert(client&&typeof client.terminateMcpSession==='function')
    assert(typeof session==='string'&&session.length)
    assert(!this.#sessions.some(item=>item.client===client&&item.session===session),'Duplicate session registration')
    this.#sessions.push({client,session,scenario,subject,clientId,refresh,reauthorize})
  }
  async closeAll() {
    const results=[]
    for(const item of this.#sessions.splice(0).reverse()) {
      const row={scenario:item.scenario,subject:item.subject,clientId:item.clientId,sessionSha256:createHash('sha256').update(item.session).digest('hex'),startedAt:new Date().toISOString(),passed:false}
      try {
        if(item.reauthorize) {
          const identity=await item.reauthorize()
          assert.equal(identity.subject,item.subject,'MCP cleanup changed the original subject')
          if(item.clientId)assert.equal(identity.clientId,item.clientId,'MCP cleanup changed the original client')
          row.reauthorized=true
        }
        if(item.refresh) {
          row.refreshStatus=await item.client.refresh()
          assert.equal(row.refreshStatus,200,'Original MCP client could not refresh after policy restoration')
        }
        const result=await item.client.terminateMcpSession(item.session)
        row.status=result.status
        assert.equal(result.status,200,'MCP session termination was not accepted')
        row.oldSessionStatus=result.oldSessionStatus
        assert.equal(result.oldSessionStatus,404,'Terminated MCP session remains usable or was not checked')
        row.passed=true
      } catch(error) {
        // Do not serialize transport errors which could contain tokens or raw session IDs.
        row.errorKind=error?.name??'Error'
      }
      row.finishedAt=new Date().toISOString();results.push(row)
    }
    return results
  }
}
