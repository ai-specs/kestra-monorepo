import test from 'node:test'
import assert from 'node:assert/strict'
import {validateAiThread,validateAiRuntimeInspection,validateAiExecutionChange,createAiControls,captureEffects} from '../application-project-ai-controls.mjs'

const expected={project:'application-projects-bb-123-1',base:'http://localhost:8088',image:'formal-image',mode:'A',configuration:'actual-config'}
function inspection(mode='A') {
    return {Config:{Image:expected.image,Labels:{owner:expected.project,'com.docker.compose.project':expected.project},Env:['KESTRA_CONFIGURATION=actual-config']},
        NetworkSettings:{Ports:{'8080/tcp':[{HostIp:'127.0.0.1',HostPort:'8088'}]}},
        Mounts:[{Destination:'/app/storage',Type:'volume',Name:'owned-storage'},...(mode==='B'?[{Destination:'/app/libs/kestra-rbac-authorizer.jar',Type:'bind',RW:false}]:[])]}
}

test('runtime validator verifies owner image loopback config and named storage',()=>{
    assert.equal(validateAiRuntimeInspection(inspection(),expected),'owned-storage')
    assert.equal(validateAiRuntimeInspection(inspection('B'),{...expected,mode:'B'}),'owned-storage')
})

test('runtime validator denies foreign owner config image mount or port',()=>{
    for(const change of [v=>v.Config.Labels.owner='foreign',v=>v.Config.Image='candidate',v=>v.Config.Env=['KESTRA_CONFIGURATION=other'],
        v=>v.NetworkSettings.Ports['8080/tcp'][0].HostIp='0.0.0.0',v=>v.Mounts.push({Destination:'/app/libs'})]) {
        const value=inspection();change(value);assert.throws(()=>validateAiRuntimeInspection(value,expected))
    }
    const writable=inspection('B');writable.Mounts[1].RW=true
    assert.throws(()=>validateAiRuntimeInspection(writable,{...expected,mode:'B'}),/read-only/)
})

test('thread observation validates actual USER prompt marker and identity',()=>{
    const detail={uid:'thread',status:'RUNNING',messages:[{role:'USER',type:'TEXT',content:'hello [[ai-scenario:case]]'}]}
    assert.equal(validateAiThread(detail,'thread','case'),detail)
    assert.throws(()=>validateAiThread(detail,'other','case'))
    assert.throws(()=>validateAiThread(detail,'thread','wrong'))
    assert.throws(()=>validateAiThread({...detail,messages:[{role:'ASSISTANT',type:'TEXT',content:detail.messages[0].content}]},'thread','case'))
})

test('restart requires exactly one saved attempt and terminal result, not success text',()=>{
    const before={id:'e',namespace:'company.a',flowId:'f',metadata:{attemptNumber:1},state:{current:'FAILED'}}
    assert.doesNotThrow(()=>validateAiExecutionChange(before,{...before,metadata:{attemptNumber:2}},'APPROVE'))
    for(const after of [before,{...before,metadata:{attemptNumber:3}},{...before,metadata:{attemptNumber:2},state:{current:'RUNNING'}},
        {...before,id:'other',metadata:{attemptNumber:2}}])assert.throws(()=>validateAiExecutionChange(before,after,'APPROVE'))
})

test('reject and duplicate require unchanged actual persisted execution',()=>{
    const before={id:'e',namespace:'company.a',flowId:'f',metadata:{attemptNumber:1}}
    for(const decision of ['REJECT','DUPLICATE']) {
        assert.doesNotThrow(()=>validateAiExecutionChange(before,structuredClone(before),decision))
        assert.throws(()=>validateAiExecutionChange(before,{...before,metadata:{attemptNumber:2}},decision))
    }
})

test('controls construction is inert and only registers real observation methods',()=>{
    let commands=0
    const controls=createAiControls({base:expected.base,project:expected.project,configuration:{},command:()=>{commands++},record:()=>{}})
    assert.equal(commands,0)
    for(const name of ['waitForHost','assertRuntime','thread','readThread','captureEffects','observeEffects','revokeWait','verifyRejectedTransport'])assert.equal(typeof controls[name],'function')
    assert.throws(()=>createAiControls({base:expected.base,project:'user-deployment',configuration:{},command:()=>{},record:()=>{}}))
})

test('captureEffects retains full SQL execution fields and detaches the baseline',async()=>{
    const execution={id:'e',namespace:'company.a',flowId:'f',metadata:{attemptNumber:2},state:{current:'FAILED'},taskRunList:[{id:'task',outputs:{saved:true}}]}
    const business={hash:'actual-observed-hash',sources:{queue:'queue-hash'}}
    const snapshot=await captureEffects({executionId:'e'},{snapshot:()=>business},async uid=>{assert.equal(uid,'e');return execution})
    assert.deepEqual(snapshot,{execution,business})
    execution.taskRunList[0].outputs.saved=false;business.sources.queue='changed'
    assert.equal(snapshot.execution.taskRunList[0].outputs.saved,true)
    assert.equal(snapshot.business.sources.queue,'queue-hash')
})

test('captureEffects rejects HTTP projections missing stored attempt metadata',async()=>{
    for(const metadata of [undefined,{}, {attemptNumber:'1'}, {attemptNumber:0}, {attemptNumber:1.5}]) {
        await assert.rejects(captureEffects({executionId:'e'},{snapshot:()=>({hash:'hash'})},async()=>({id:'e',namespace:'company.a',flowId:'f',metadata})),/metadata.attemptNumber/)
    }
})

test('captureEffects fails closed for missing execution identity or business evidence',async()=>{
    const execution={id:'e',namespace:'company.a',flowId:'f',metadata:{attemptNumber:1}}
    await assert.rejects(captureEffects({executionId:'e'},{snapshot:()=>({hash:'hash'})},async()=>({...execution,id:'other'})),/identity/)
    await assert.rejects(captureEffects({executionId:'e'},{snapshot:()=>({})},async()=>execution),/hash/)
    await assert.rejects(captureEffects({executionId:'e'},{snapshot:()=>({hash:'hash'})},async()=>({...execution,namespace:undefined})),/namespace/)
    await assert.rejects(captureEffects({executionId:"unsafe'id"},{snapshot:()=>({hash:'hash'})},async()=>execution),/ID/)
})
