import assert from 'node:assert/strict'
import {createHash,randomUUID} from 'node:crypto'
import {mkdir,writeFile} from 'node:fs/promises'
import {readFileSync,realpathSync} from 'node:fs'
import {isAbsolute,resolve,basename,sep} from 'node:path'

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex')
// The collector and business report use different fixed labels for the same
// already-redacted login target. Normalize labels only, never event identities.
export function canonicalDiagnosticLabels(value) {
  if(typeof value==='string')return value.replaceAll('[redacted-login-target]','[redacted]')
  if(Array.isArray(value))return value.map(canonicalDiagnosticLabels)
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,canonicalDiagnosticLabels(item)]))
  return value
}
// Store every event once per immutable snapshot, not multiple times in parent JSON.
// This is lossless persistence, not a diagnostic filter or an acceptance decision.
export async function writeBrowserDiagnosticEvidence(evidence,directory) {
  assert(isAbsolute(directory),'Explicit diagnostic directory required')
  assert(Array.isArray(evidence.events)&&Array.isArray(evidence.integrity))
  await mkdir(directory,{recursive:true})
  const bytes=JSON.stringify({schemaVersion:1,...evidence})+'\n'
  const name=randomUUID()+'.json',path=resolve(directory,name)
  await writeFile(path,bytes,{mode:0o600,flag:'wx'})
  return {kind:'immutable-browser-diagnostics',name,path,sha256:sha256(bytes),events:evidence.events.length,integrity:evidence.integrity.length}
}
export function readBrowserDiagnosticEvidence(reference,directories) {
  assert.equal(reference?.kind,'immutable-browser-diagnostics')
  assert(/^[a-f0-9-]{36}\.json$/.test(reference.name)&&basename(reference.name)===reference.name)
  assert(/^[a-f0-9]{64}$/.test(reference.sha256))
  let bytes
  for(const directory of directories) {
    const candidate=resolve(directory,reference.name)
    try {
      assert(realpathSync(candidate).startsWith(realpathSync(directory)+sep),'Diagnostic file escapes its evidence directory')
      bytes=readFileSync(candidate);break
    }catch(error){if(error.code==='ENOENT')continue;throw error}
  }
  assert(bytes,'Immutable diagnostic evidence missing: '+reference.name)
  assert.equal(sha256(bytes),reference.sha256,'Diagnostic evidence hash differs')
  const evidence=JSON.parse(bytes)
  assert.equal(evidence.schemaVersion,1)
  assert.equal(evidence.events.length,reference.events)
  assert.equal(evidence.integrity.length,reference.integrity)
  assert.equal(new Set(evidence.events.map(event=>event.id)).size,evidence.events.length,'Diagnostic event identities duplicated')
  assert(evidence.events.every(event=>event.id&&event.documentId&&event.kind),'Diagnostic event identity missing')
  return evidence
}
