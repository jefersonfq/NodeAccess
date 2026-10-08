import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { durableWrite, StateStore } from './storage.mjs'
import { classifyAcmeError } from './certificates.mjs'
import { retryAt, certificateAlerts } from './retry.mjs'

test('failed writes and renames preserve the last committed state and remove temporary files',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tls-storage-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}))
 const file=path.join(dir,'state.json');await durableWrite(file,'original')
 for(const code of ['ENOSPC','EROFS','EACCES']){
  const io={...fs,rename:async()=>{throw Object.assign(Error('secret path'),{code})}}
  await assert.rejects(durableWrite(file,'replacement',io))
  assert.equal(await fs.readFile(file,'utf8'),'original');assert.deepEqual(await fs.readdir(dir),['state.json'])
 }
 assert.equal((await fs.stat(file)).mode&0o777,0o600)
})
test('data is synced before rename and directory is synced after rename',async()=>{
 const events=[],io={open:async(name)=>({writeFile:async()=>events.push('write'),sync:async()=>events.push(name==='/state'?'directory-sync':'file-sync'),close:async()=>{}}),rename:async()=>events.push('rename'),unlink:async()=>{}}
 await durableWrite('/state/state.json','data',io)
 assert.deepEqual(events,['write','file-sync','rename','directory-sync'])
})
test('invalid recovery paths in persisted state fail closed',async()=>{
 const store=new StateStore('/state',{readFile:async()=>JSON.stringify({mode:'provided',history:[],pending:{previous:'../../outside',fingerprint:'AA'}})})
 await assert.rejects(store.load(),{code:'STATE_CORRUPT'})
})
test('ACME diagnostics redact output and honor Retry-After seconds, UTC and HTTP dates',()=>{
 const now=Date.parse('2026-09-26T00:00:00Z')
 for(const [message,code] of [['DNS problem: NXDOMAIN','ACME_DNS'],['Type: connection Fetching http://host','ACME_CHALLENGE'],['Connection refused to ACME directory','ACME_NETWORK'],['Request timed out','ACME_TIMEOUT']]){
  const error=classifyAcmeError({stderr:message+' PRIVATE KEY secret'},now);assert.equal(error.code,code);assert.ok(!JSON.stringify(error).includes('secret'))
 }
 for(const value of ['172800','2026-09-28 00:00:00 UTC','Mon, 28 Sep 2026 00:00:00 GMT']){
  const error=classifyAcmeError({stderr:'rateLimited\nRetry-After: '+value},now)
  assert.equal(error.retryAfter,'2026-09-28T00:00:00.000Z')
  assert.equal(retryAt(error,1,now),error.retryAfter)
 }
 assert.equal(classifyAcmeError({stderr:'rateLimited Retry-After: invalid'},now).retryAfter,undefined)
})
test('expiry thresholds, expired certificates and clock-based recomputation cover every mode',()=>{
 const now=Date.now()
 for(const days of [40,30,14,7,1,-1]){
  const alerts=certificateAlerts({}, {validTo:new Date(now+days*86400000).toISOString()},now)
  assert.equal(alerts.length,days<=30?1:0)
  if(alerts.length)assert.equal(alerts[0].severity,days<=7?'error':'warning')
 }
})
test('valid JSON with corrupt job, request or outbox shapes is rejected',async()=>{
 for(const extra of [{requests:null},{requests:[]},{outbox:'broken'},{history:['broken']},{job:{status:'unknown'}}]){
  const store=new StateStore('/state',{readFile:async()=>JSON.stringify({mode:'provided',history:[],...extra})})
  await assert.rejects(store.load(),{code:'STATE_CORRUPT'})
 }
})
