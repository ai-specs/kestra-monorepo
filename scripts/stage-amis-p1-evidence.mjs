import assert from 'node:assert/strict'
import {amisP1Cases} from './amis-apps-p1-cases.mjs'
import {readFileSync,writeFileSync,mkdirSync,readdirSync,lstatSync,realpathSync,existsSync,rmSync,openSync,closeSync,fstatSync,constants} from 'node:fs'
import {resolve,join,dirname,isAbsolute,relative,sep} from 'node:path'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
const hash=b=>createHash('sha256').update(b).digest('hex')
const forbidden=new Set(['password','temporarypassword','secret','clientsecret','token','accesstoken','idtoken','refreshtoken','sessiontoken','csrftoken','apikey','privatekey','cookie','cookies','setcookie','authorization'])
const sensitive=k=>forbidden.has(k.toLowerCase().replace(/[^a-z]/g,''))
const token=/Bearer\s+[A-Za-z0-9._~+/=-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+|(?:password|client_secret|access_token|refresh_token|id_token|csrf_token)=[^\s&]+/i
const safe=p=>typeof p==='string'&&p.length&&!isAbsolute(p)&&!p.includes('\\')&&!p.includes(':')&&!p.split('/').some(x=>!x||x==='.'||x==='..')
const privatePath=p=>p.split('/').some(x=>/private|options|accounts?|environment/i.test(x))||/\.(?:log|env|ya?ml)$/i.test(p)
const meaningful=v=>v!==null&&v!==''&&v!==false&&!['[redacted]','[REDACTED]'].includes(v)


export function stageAmisP1Evidence({source,target}) {
 assert(isAbsolute(source)&&isAbsolute(target),'Absolute source and target required')
 source=resolve(source);target=resolve(target)
 assert(realpathSync(dirname(target))===dirname(target),'Unsafe public parent')
 assert(!existsSync(target),'New public directory required')
 assert(!target.startsWith(source+sep)&&!source.startsWith(target+sep)&&source!==target,'Separate source and public directories required')
 mkdirSync(target,{mode:0o700})
 const issues=[],secrets=new Set(),files=new Map(),staged=[];let report
 const issue=code=>{if(!issues.includes(code))issues.push(code)}
 try {
  assert(realpathSync(source)===source&&lstatSync(source).isDirectory()&&!lstatSync(source).isSymbolicLink()&&lstatSync(source).uid===process.getuid(),'Unsafe owned source')
  // Cache only an owned regular report opened without following its final link.
  // All later projection reads use these exact bytes, never an untrusted path.
  const reportPath=join(source,'report.json'),reportStat=lstatSync(reportPath)
  assert(reportStat.isFile()&&!reportStat.isSymbolicLink()&&reportStat.uid===process.getuid()&&realpathSync(reportPath)===reportPath,'Unsafe report')
  const reportFd=openSync(reportPath,constants.O_RDONLY|constants.O_NOFOLLOW)
  let reportBytes
  try {const opened=fstatSync(reportFd);assert(opened.isFile()&&opened.uid===process.getuid()&&opened.dev===reportStat.dev&&opened.ino===reportStat.ino,'Report changed during validation');reportBytes=readFileSync(reportFd)}finally{closeSync(reportFd)}
  report=JSON.parse(reportBytes.toString('utf8'))
  // Inspect every directory entry without following links. Private JSON is read
  // only to identify secrets; none is included in the publication candidates.
  function scan(dir){for(const item of readdirSync(dir)){const p=join(dir,item),st=lstatSync(p),name=relative(source,p).split(sep).join('/');assert(!st.isSymbolicLink(),'Source contains symlink');assert(st.isDirectory()||st.isFile(),'Source contains special file');if(st.isDirectory())scan(p);else if(privatePath(name)&&!name.endsWith('.json')){
   // Private env/YAML/options text may contain values later echoed in public logs.
   const text=readFileSync(p,'utf8')
   for(const match of text.matchAll(/(?:password|client[_-]?secret|access[_-]?token|refresh[_-]?token|secret|token)\s*[:=]\s*["']?([^\s"',}]+)/gi))if(match[1].length>=4&&meaningful(match[1]))secrets.add(match[1])
  }else if(name.endsWith('.json')){
   let value;try{value=JSON.parse(p===reportPath?reportBytes.toString('utf8'):readFileSync(p,'utf8'))}catch{if(privatePath(name))throw Error('Unreadable private JSON');continue}
   function collect(v,secret=false){if(typeof v==='string'){if(secret&&v.length>=4&&meaningful(v))secrets.add(v)}else if(Array.isArray(v))v.forEach(x=>collect(x,secret));else if(v&&typeof v==='object')for(const [k,x]of Object.entries(v))collect(x,secret||sensitive(k))}
   collect(value)
  }}}
  scan(source)
  function inspect(bytes,name){const text=bytes.toString('utf8');assert(!token.test(text),'Credential token pattern');for(const secret of secrets)assert(!text.includes(secret),'Known private secret reused');if(name.endsWith('.json')){const value=JSON.parse(text);function check(v){if(Array.isArray(v))v.forEach(check);else if(v&&typeof v==='object')for(const [k,x]of Object.entries(v)){assert(!sensitive(k)||!meaningful(x),'Credential field');check(x)}}check(value);return value}}
  function add(name,expected){assert(safe(name)&&!privatePath(name),'Unsafe or private publication path');assert(/^[a-f0-9]{64}$/.test(expected)||expected===undefined,'Invalid reference hash');const p=join(source,name);assert(realpathSync(p).startsWith(source+sep)&&lstatSync(p).isFile()&&!lstatSync(p).isSymbolicLink(),'Unsafe publication file');const bytes=name==='report.json'?reportBytes:readFileSync(p);if(expected)assert.equal(hash(bytes),expected,'Reference hash mismatch');if(files.has(name))assert.equal(hash(files.get(name)),hash(bytes),'Conflicting reference');inspect(Buffer.from(name),'filename');const value=inspect(bytes,name);files.set(name,bytes);return value}
  add('report.json')
  assert(Array.isArray(report.cases),'Missing case matrix')
  const candidates=readdirSync(join(source,'evidence')).filter(n=>n.endsWith('.json'))
  for(const name of candidates)add('evidence/'+name)
  for(const row of report.cases){assert(Array.isArray(row.evidence),'Case evidence references missing');for(const ref of row.evidence){assert(/^evidence\/[^/]+\.json$/.test(ref.path),'Case evidence outside whitelist');assert(/^[a-f0-9]{64}$/.test(ref.sha256),'Case reference hash missing');const value=add(ref.path,ref.sha256);for(const attachment of value?.browser?.attachments??[]){assert(/\.(?:json|png|jpg|jpeg|webp)$/.test(attachment.path),'Unsupported attachment format');assert(/^[a-f0-9]{64}$/.test(attachment.sha256),'Attachment reference hash missing');add(attachment.path,attachment.sha256)}}}
  // Validate everything before copying any candidate, so rejected content never
  // remains in the public directory after a failure.
  for(const [name,bytes]of files){const path=join(target,name);mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,bytes,{flag:'wx',mode:0o600});staged.push({path:name,sha256:hash(bytes)})}
 } catch {issue('publication-validation-failed')}
 if(issues.length){
  for(const name of readdirSync(target))rmSync(join(target,name),{recursive:true,force:true})
  // Fixed fields only. Untrusted IDs, paths, errors and evidence are never echoed.
  let rows=[];try{const r=report;if(Array.isArray(r?.cases))rows=r.cases.map((row,index)=>({index,id:amisP1Cases.includes(row.id)&&!token.test(row.id)&&![...secrets].some(s=>row.id.includes(s))?row.id:'[redacted]',status:['passed','failed','running','not-run','not_run','skipped'].includes(row.status)?row.status:'unknown'}))}catch{}
  writeFileSync(join(target,'report.json'),JSON.stringify({schemaVersion:1,stage:'P1',completed:false,status:'failed',projection:true,cases:rows,limitation:'Safe failure projection only; cannot satisfy business acceptance'},null,2)+'\n',{mode:0o600})
 }
 const summary={schemaVersion:1,status:issues.length?'failed':'passed',businessAcceptance:'not-evaluated',issues,files:issues.length?[]:staged}
 writeFileSync(join(target,'staging-summary.json'),JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600})
 return summary
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{const summary=stageAmisP1Evidence({source:process.argv[2],target:process.argv[3]});console.log(JSON.stringify(summary));if(summary.status!=='passed')process.exitCode=1}catch{console.error('P1 staging refused unsafe input/output');process.exitCode=1}}
