import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {realpath, lstat, readFile, mkdir, writeFile} from 'node:fs/promises'
import {dirname, isAbsolute, relative, resolve, join} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {runAmisAppsBrowser} from './amis-apps-browser.mjs'
import {createEgoApplicationProjectAdapter, createPlaywrightApplicationProjectAdapter} from './application-project-browser-adapters.mjs'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const inside = (parent, child) => { const path = relative(parent, child); return path && !path.startsWith('..') && !isAbsolute(path) }
const hash = /^[a-f0-9]{64}$/
async function privateInput(path) {
  assert(isAbsolute(path), 'Absolute privateFile required')
  const work = await realpath(join(root, '.work')), actual = await realpath(path), info = await lstat(path)
  assert(inside(work, actual) && !info.isSymbolicLink() && info.isFile() && (info.mode & 0o777) === 0o600 && info.uid === process.getuid(), 'Owned 0600 privateFile under real root .work required')
  const value = JSON.parse(await readFile(actual, 'utf8'))
  assert(typeof value.account?.username === 'string' && value.account.username && typeof value.account?.password === 'string' && value.account.password, 'Explicit private account required')
  return value
}
function child(command, args, input) {
  return new Promise((accept, reject) => {
    const process = spawn(command, args, {stdio: ['pipe', 'pipe', 'pipe']})
    let stdout = '', stderr = ''
    process.stdout.on('data', data => { stdout += data; if (stdout.length > 8_000_000) process.kill() })
    process.stderr.on('data', data => { stderr += data; if (stderr.length > 8_000_000) process.kill() })
    process.on('error', () => reject(new Error('Driver child could not start')))
    process.on('close', code => accept({code, stdout, stderr}))
    process.stdin.end(input ?? '')
  })
}
async function outputDirectory(path) {
  assert(isAbsolute(path), 'Absolute output directory required')
  const work = await realpath(join(root, '.work'))
  assert(inside(work, resolve(path)), 'Output must be under root .work')
  await mkdir(path, {recursive: true})
  assert(inside(work, await realpath(path)), 'Output symlink escapes .work')
}
export async function verifyAmisBrowserRuntime(options, execute) {
  const {base, deployment: d} = options
  assert(d && ['A', 'B'].includes(d.mode) && d.project && Array.isArray(d.containerIds) && d.containerIds.includes(d.hostContainerId), 'Explicit owned deployment required')
  assert(d.containerIds.every(id => /^[a-f0-9]{64}$/.test(id)) && new Set(d.containerIds).size === d.containerIds.length)
  assert(/^ghcr\.io\/ai-specs\/kestra-overlay@sha256:[a-f0-9]{64}$/.test(d.formalImage) && /^sha256:[a-f0-9]{64}$/.test(d.actualImageId))
  const url = new URL(base)
  assert(url.origin === base && url.protocol === 'http:' && url.hostname === '127.0.0.1', 'Explicit loopback origin required')
  const result = await execute('docker', ['inspect', ...d.containerIds])
  assert(result.code === 0, 'Owned container inspection failed')
  const records = JSON.parse(result.stdout)
  assert(records.length === d.containerIds.length)
  for (const record of records) {
    assert(d.containerIds.includes(record.Id) && record.State?.Running, 'Actual running container differs')
    assert(record.Config?.Labels?.owner === d.project && record.Config?.Labels?.['com.docker.compose.project'] === d.project, 'Owner/project mismatch')
  }
  const host = records.find(record => record.Id === d.hostContainerId)
  assert(host.Config.Image === d.formalImage && host.Image === d.actualImageId, 'Actual formal image mismatch')
  const bindings = host.NetworkSettings?.Ports?.['8080/tcp']
  assert(bindings?.length && bindings.every(binding => binding.HostIp === '127.0.0.1' && binding.HostPort === url.port), 'Non-owned loopback binding')
  assert(Array.isArray(d.jars) && d.jars.length === (d.mode === 'B' ? 2 : 1), 'Explicit formal jars required')
  const mounts = host.Mounts.filter(mount => mount.Destination.startsWith('/app/libs/'))
  assert(mounts.length === d.jars.length, 'Unexpected runtime libraries')
  for (const jar of d.jars) {
    assert(hash.test(jar.sha256) && /^\/app\/libs\/[A-Za-z0-9._-]+\.jar$/.test(jar.target))
    assert(mounts.some(mount => mount.Destination === jar.target && mount.RW === false), 'Jar must be mounted read-only')
    const actual = await execute('docker', ['exec', d.hostContainerId, 'sha256sum', jar.target])
    assert(actual.code === 0 && actual.stdout.trim().split(/\s/)[0] === jar.sha256, 'Actual mounted jar SHA mismatch')
  }
}
// Called only with an already-owned Page. Uses the same business workflow for both adapters.
export async function runAmisBrowserOnPage(options, page, kind, dependencies = {}) {
  const secret = await privateInput(options.privateFile)
  await outputDirectory(options.outputDirectory)
  for (const dir of ['screenshots', 'diagnostics']) await mkdir(join(options.outputDirectory, dir), {recursive: true})
  const record = async report => writeFile(join(options.outputDirectory, 'report.json'), JSON.stringify(report, null, 2), {mode: 0o600})
  const adapter = await (kind === 'ego' ? dependencies.createEgo ?? createEgoApplicationProjectAdapter : dependencies.createPlaywright ?? createPlaywrightApplicationProjectAdapter)(page, {
    artifactDirectory: join(options.outputDirectory, 'screenshots'), diagnosticDirectory: join(options.outputDirectory, 'diagnostics'), secrets: [secret.account.password, secret.nextAccount?.password].filter(Boolean),
  })
  try {
    const report = await (dependencies.runBrowser ?? runAmisAppsBrowser)(adapter, {...options, account: secret.account, nextAccount: secret.nextAccount, schemaTitle: options.title, record})
    return {completed: report.completed === true, reportPath: join(options.outputDirectory, 'report.json')}
  } finally { if (typeof adapter.dispose === 'function') await adapter.dispose() }
}
export async function runAmisBrowserDriver(options, dependencies = {}) {
  await privateInput(options.privateFile)
  assert(!options.account && !options.nextAccount && !options.password, 'Credentials must come only from privateFile')
  assert(['ego', 'playwright'].includes(options.driver) && options.namespace && options.flowId && options.pageId && options.marker && options.title, 'Explicit browser inputs required')
  await outputDirectory(options.outputDirectory)
  const execute = dependencies.childTransport ?? child
  await verifyAmisBrowserRuntime(options, execute)
  if (options.driver === 'ego') {
    assert(Number.isSafeInteger(options.spaceId) && options.spaceId > 0 && /^p[1-9][0-9]*$/.test(options.pageLabel), 'Explicit existing Ego space/page required')
    const parameterFile = join(options.outputDirectory, 'driver-parameters.json')
    await writeFile(parameterFile, JSON.stringify(options), {mode: 0o600})
    const source = `const {readFile}=await import('node:fs/promises');\nconst {runAmisBrowserOnPage}=await import(${JSON.stringify(import.meta.url)});\nconst options=JSON.parse(await readFile(${JSON.stringify(parameterFile)},'utf8'));\ntry { const entry=(await listTaskSpaces()).find(s=>s.id===options.spaceId); if(!entry || entry.ownership!=='agent') throw new Error('Existing agent-owned space required'); const task=await taskSpace(options.spaceId); const page=task.page(options.pageLabel); const summary=await runAmisBrowserOnPage(options,page,'ego'); console.log(JSON.stringify(summary)); } catch { console.log(JSON.stringify({completed:false,reportPath:options.outputDirectory+'/report.json'})); process.exitCode=1; }`
    const result = await execute('ego-browser', ['nodejs'], source)
    assert(result.code === 0, 'Ego browser workflow failed; inspect retained report/diagnostics')
    const report = JSON.parse(await readFile(join(options.outputDirectory, 'report.json'), 'utf8'))
    assert(report.completed === true, 'Ego report incomplete')
    return {completed: true, reportPath: join(options.outputDirectory, 'report.json')}
  }
  assert(isAbsolute(options.playwrightModule ?? ''), 'Explicit absolute Playwright module required')
  const module = await (dependencies.importModule ?? (path => import(path)))(pathToFileURL(options.playwrightModule).href)
  let browser, context
  try {
    browser = await module.chromium.launch({headless: true})
    context = await browser.newContext()
    return await runAmisBrowserOnPage(options, await context.newPage(), 'playwright', dependencies)
  } finally { try { await context?.close() } finally { await browser?.close() } }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.length === 3, 'Pass one absolute options JSON file')
    const summary = await runAmisBrowserDriver(JSON.parse(await readFile(process.argv[2], 'utf8')))
    console.log(JSON.stringify(summary))
  } catch { console.log(JSON.stringify({completed: false, error: 'Browser driver failed; inspect configured report and diagnostics'})); process.exitCode = 1 }
}
