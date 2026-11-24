#!/usr/bin/env node
import {createInterface} from 'node:readline'
import {pathToFileURL} from 'node:url'
import {resolve} from 'node:path'
const fields=['stagesPassed','checksPassed','restPassed','uiPassed','failures','notRun']
// Live logs expose counters only. Raw driver lines stay in the artifact log and
// pass through the existing final sanitizer; arbitrary messages are never echoed.
export function formatAcceptanceProgress(line) {
  if(typeof line!=='string'||line.length>2048)return null
  let data;try{data=JSON.parse(line)}catch{return null}
  if(!data||Array.isArray(data)||Object.keys(data).length!==1)return null
  const value=data.acceptanceProgress
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...fields].sort().join(','))return null
  if(!fields.every(key=>Number.isSafeInteger(value[key])&&value[key]>=0&&value[key]<=10000000))return null
  return 'ACCEPTANCE_PROGRESS '+fields.map(key=>key+'='+value[key]).join(' ')
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})) {
    const message=formatAcceptanceProgress(line);if(message)console.log(message)
  }
}
