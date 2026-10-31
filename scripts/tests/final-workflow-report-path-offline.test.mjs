import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'

test('actual final workflow Python passes the report file after checking both submodule paths',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'root-final-workflow-'))
 try {
  const workflow=await readFile(new URL('../../.github/workflows/compose-acceptance.yml',import.meta.url),'utf8')
  const script=workflow.match(/<<'PYFINAL'\n([\s\S]*?)\n\s*PYFINAL/)[1]
  const root='1'.repeat(40),overlay='2'.repeat(40),plugin='3'.repeat(40),image='ghcr.io/ai-specs/kestra-overlay@sha256:'+'4'.repeat(64),jar=Buffer.from('synthetic jar input'),jarSha256=createHash('sha256').update(jar).digest('hex')
  for(const path of ['.work/ci/application-projects','.work/ci/plugin-artifact/build/libs'])await mkdir(join(directory,path),{recursive:true})
  const inputs={image,jarSha256,rootCommit:root,overlayCommit:overlay,pluginCommit:plugin}
  await writeFile(join(directory,'.work/ci/application-projects/report.json'),JSON.stringify({finishedAt:'2026-10-31',resources:{cleaned:true,containersCreated:true},inputs}))
  await writeFile(join(directory,'.work/ci/image'),image)
  await writeFile(join(directory,'.work/ci/release-evidence.json'),JSON.stringify({jarSha256}))
  await writeFile(join(directory,'.work/ci/plugin-artifact/build/libs/kestra-rbac-authorizer.jar'),jar)
  const setup=`import subprocess,textwrap\nroot=${JSON.stringify(root)};overlay=${JSON.stringify(overlay)};plugin=${JSON.stringify(plugin)}\ndef output(args,**kwargs):\n if args==['git','rev-parse','HEAD']: return root+'\\n'\n if args[:2]==['git','ls-tree']:\n  path=args[-1];return '160000 commit '+({'kestra-overlay':overlay,'kestra-plugin-rbac':plugin}[path])+'\\t'+path+'\\n'\n if args[:2]==['git','-C']:return {'kestra-overlay':overlay,'kestra-plugin-rbac':plugin}[args[2]]+'\\n'\n raise AssertionError(args)\ndef run(args,**kwargs):\n assert args[2]=='.work/ci/application-projects/report.json',args\n assert __import__('pathlib').Path(args[2]).is_file()\n assert kwargs.get('check') is True\n print('actual-final-report-path-verified')\nsubprocess.check_output=output\nsubprocess.run=run\nexec(textwrap.dedent(${JSON.stringify(script)}))\n`
  assert.match(execFileSync('python3',['-c',setup],{cwd:directory,encoding:'utf8'}),/actual-final-report-path-verified/)
 }finally{await rm(directory,{recursive:true,force:true})}
})
