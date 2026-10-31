import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile,rm,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {writeBrowserDiagnosticEvidence,readBrowserDiagnosticEvidence,canonicalDiagnosticLabels} from '../browser-diagnostic-evidence.mjs'

test('only fixed redacted login label normalizes; identities and real failures stay distinct',()=>{
  assert.deepEqual(canonicalDiagnosticLabels({id:'one',url:'/?from=[redacted-login-target]'}),{id:'one',url:'/?from=[redacted]'})
  assert.notDeepEqual(canonicalDiagnosticLabels({id:'one',message:'failure'}),canonicalDiagnosticLabels({id:'two',message:'failure'}))
  assert.notDeepEqual(canonicalDiagnosticLabels({message:'failed'}),canonicalDiagnosticLabels({message:'passed'}))
})

test('large diagnostic snapshots retain all events without duplicating them in parent JSON',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'root-diagnostics-offline-'))
  try {
    const events=Array.from({length:10000},(_,index)=>({id:'event:'+index,documentId:'document:old',kind:index===9999?'page-error':'request',message:'source evidence '+index}))
    const first=await writeBrowserDiagnosticEvidence({events,integrity:[]},directory),firstBytes=await readFile(first.path)
    const second=await writeBrowserDiagnosticEvidence({events:[...events,{id:'event:10000',documentId:'document:new',kind:'request'}],integrity:[]},directory)
    assert.notEqual(first.path,second.path);assert.deepEqual(await readFile(first.path),firstBytes)
    assert(JSON.stringify({first,second}).length<1500,'Parent embeds full snapshots again')
    assert.deepEqual(readBrowserDiagnosticEvidence(first,[directory]).events,events)
    assert.equal(readBrowserDiagnosticEvidence(second,[directory]).events.length,10001)
    await writeFile(first.path,'{}')
    assert.throws(()=>readBrowserDiagnosticEvidence(first,[directory]),/hash differs/)
    assert.throws(()=>readBrowserDiagnosticEvidence({...second,name:'../../.env'},[directory]))
    await rm(second.path)
    assert.throws(()=>readBrowserDiagnosticEvidence(second,[directory]),/missing/)
  }finally{await rm(directory,{recursive:true,force:true})}
})
test('integrity and unknown failures are preserved, never filtered by snapshot persistence',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'root-diagnostics-integrity-'))
  try {
    const error={id:'error:1',documentId:'document:old',kind:'diagnostic-integrity-error',message:'unknown envelope'}
    const reference=await writeBrowserDiagnosticEvidence({events:[error],integrity:[error]},directory)
    assert.equal(reference.integrity,1);assert.deepEqual(readBrowserDiagnosticEvidence(reference,[directory]).integrity,[error])
    await symlink(reference.path,join(directory,'00000000-0000-0000-0000-000000000000.json'))
    assert.throws(()=>readBrowserDiagnosticEvidence({...reference,name:'00000000-0000-0000-0000-000000000000.json',events:2},[directory]))
    const outside=await mkdtemp(join(tmpdir(),'root-diagnostics-outside-'))
    try {
      const external=await writeBrowserDiagnosticEvidence({events:[error],integrity:[error]},outside)
      await symlink(external.path,join(directory,external.name))
      assert.throws(()=>readBrowserDiagnosticEvidence(external,[directory]),/escapes/)
    }finally{await rm(outside,{recursive:true,force:true})}
  }finally{await rm(directory,{recursive:true,force:true})}
})
