import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {amisAcceptanceSourcePaths} from '../amis-apps-source-evidence.mjs'

// Static source contract only. Does not compile or instantiate host beans.
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8')
const warmup = read('amis-apps-probe/ProbeWarmup.java')
const compile = read('amis-apps-probe/compile.sh')
function assertSource(source) {
  const code=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'')
  assert.match(code,/@Context\b/)
  assert.match(code,/@Requires\(\s*property\s*=\s*"amis\.acceptance\.probe\.enabled"\s*,\s*value\s*=\s*"true"\s*\)/)
  const imports=[...code.matchAll(/^import\s+([^;]+);/gm)].map(match=>match[1]).sort()
  assert.deepEqual(imports,['io.kestra.webserver.rbac.RbacGate','io.micronaut.context.annotation.Context','io.micronaut.context.annotation.Requires'].sort())
  assert.match(code,/public final class ProbeWarmup\s*\{/)
  assert.match(code,/public ProbeWarmup\(RbacGate gate\)\s*\{\s*java\.util\.Objects\.requireNonNull\(gate\);\s*\}/)
  const body=code.slice(code.indexOf('public final class ProbeWarmup'))
    .replace(/public final class ProbeWarmup\s*\{\s*public ProbeWarmup\(RbacGate gate\)\s*\{\s*java\.util\.Objects\.requireNonNull\(gate\);\s*\}\s*\}/,'').trim()
  assert.equal(body,'','Warmup may only require the generic host gate; no extra members or calls')
}

test('probe warmup is eager only behind explicit switch and only requires generic host gate',()=>assertSource(warmup))

test('static contract rejects disabled guard, extra dependencies, business calls and explicit readiness writes',()=>{
  for(const source of [
    warmup.replace('@Context',''),
    warmup.replace('value = "true"','value = "false"'),
    warmup.replace('amis.acceptance.probe.enabled','unrelated.enabled'),
    warmup.replace('RbacGate gate)','RbacGate gate, Object storage)'),
    warmup.replace('java.util.Objects.requireNonNull(gate);','gate.authorize(null,null,null);'),
    warmup.replace('java.util.Objects.requireNonNull(gate);','storage.get(null);'),
    warmup.replace('java.util.Objects.requireNonNull(gate);','ProbeState.INSTANCE.ready("authorization");'),
    warmup.replace('java.util.Objects.requireNonNull(gate);','ProbeState.INSTANCE.authorizationListener=true;')
  ])assert.throws(()=>assertSource(source))
})

test('acceptance source binding includes warmup exactly once',()=>{
  assert.equal(amisAcceptanceSourcePaths.filter(path=>path==='scripts/amis-apps-probe/ProbeWarmup.java').length,1)
})

test('formal compilation and source hashing include Java glob and generated bean index',()=>{
  assert.match(compile,/root\.glob\('\*\.java'\)/)
  assert.match(compile,/"\$JAVAC"[^\n]+"\$ROOT\/scripts\/amis-apps-probe"\/\*\.java/)
  assert.match(compile,/META-INF\/micronaut\/io\.micronaut\.inject\.BeanDefinitionReference/)
  assert.match(compile,/ACTUAL_HOST_SHA.*EXPECTED|ACTUAL_HOST_SHA.*HOST_SHA/)
})

test('warmup never substitutes its own ready flag for actual gate listener wrapping',()=>{
  const listener=read('amis-apps-probe/RbacGateListener.java')
  assert(listener.indexOf('new ProbeGate(event.getBean())')<listener.indexOf('ProbeState.INSTANCE.ready("authorization")'))
  assert.match(listener,/return wrapped;/)
  assert(!warmup.includes('ProbeState'))
})
