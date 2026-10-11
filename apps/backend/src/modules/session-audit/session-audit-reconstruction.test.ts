/* eslint-disable @typescript-eslint/unbound-method -- Assertions inspect vi mocks; no unbound instance methods are invoked. */
import {describe,it,expect,vi} from 'vitest'
import {reconstructAudit,auditTranscript,printableAuditText} from './session-audit-reconstruction.js'
import {SessionAuditReconstructionService} from './session-audit-reconstruction.service.js'
import type {SessionAuditRepository,SessionAuditRow} from './session-audit.repository.js'
import type {AuditReconstructionStore} from './session-audit-reconstruction.repository.js'
const line=(seq:number,type:string,data='')=>JSON.stringify({seq,ts:new Date(1790672400000+seq*100).toISOString(),type,payload:{data,actorUserId:type==='stdin'?9:null}})+'\n'
const recording=()=>line(1,'session_started')+line(2,'stdout','lab$ ')+line(3,'stdin','echo ok\r')+line(4,'stdout','ok\r\nlab$ ')+line(5,'session_ended')
function fixture(options?:ConstructorParameters<typeof SessionAuditReconstructionService>[3]) {
 const row={sessionId:42,tenantId:1,status:'COMPLETED',chunkCount:1,bytesIn:8,bytesOut:4} as SessionAuditRow
 const repo={findBySessionId:vi.fn((tenant:number,id:number)=>Promise.resolve(tenant===1&&id===42?row:null)),listChunks:vi.fn(()=>Promise.resolve([{seq:1,storageKey:'test'}]))}
 const storage={readChunk:vi.fn(()=>Promise.resolve(recording()))}
 const store:AuditReconstructionStore={save:vi.fn((_tenant,_session,s)=>Promise.resolve({...s.metadata,persisted:true})),history:vi.fn(()=>Promise.resolve([])),commands:vi.fn(()=>Promise.resolve(null))}
 const service=new SessionAuditReconstructionService(repo as Pick<SessionAuditRepository,'findBySessionId'|'listChunks'>,storage,store,options)
 return {service,repo,storage,store,row}
}
describe('versioned audit reconstruction',()=>{
 it('links commands to original input/output sequences and gives a stable content identity',()=>{
  const a=reconstructAudit([{seq:1,content:recording()}],'COMPLETED',1)
  const b=reconstructAudit([{seq:1,content:recording()}],'COMPLETED',1,new Date(0))
  expect(a.metadata.state).toBe('complete');expect(a.metadata.id).toBe(b.metadata.id)
  expect(a.commands[0]?.source).toEqual({inputFrom:3,inputTo:3,outputFrom:4,outputTo:4})
  expect(a.commands[0]?.processorVersion).toBe(a.metadata.processorVersion)
  expect(reconstructAudit([{seq:1,content:recording().replace('echo ok','echo no')}],'COMPLETED',1).metadata.id).not.toBe(a.metadata.id)
 })
 it('does not join keystrokes across missing events',()=>{
  const raw=line(1,'session_started')+line(2,'stdin','echo sec')+line(4,'stdin','ret\r')+line(5,'session_ended')
  const result=reconstructAudit([{seq:1,content:raw}],'COMPLETED',1)
  expect(result.metadata.state).toBe('partial')
  expect(result.metadata.issues.some(i=>i.code==='EVENT_GAP')).toBe(true)
  expect(result.commands.some(c=>c.command==='echo secret')).toBe(false)
  expect(result.commands.every(c=>c.confidence==='low')).toBe(true)
 })
 it.each(['bad json',JSON.stringify({seq:2,ts:'invalid',type:'stdin',payload:{data:'bad\r'}}),JSON.stringify({seq:2,ts:new Date().toISOString(),type:'unknown'})])('reports malformed events: %s',(bad)=>{
  const result=reconstructAudit([{seq:1,content:line(1,'session_started')+bad+'\n'+line(3,'session_ended')}],'COMPLETED',1)
  expect(result.metadata.issues.some(i=>i.code==='INVALID_EVENT')).toBe(true)
 })
 it('reports missing chunks, duplicated events and missing end markers',()=>{
  const result=reconstructAudit([{seq:1,content:line(1,'session_started')+line(1,'stdin','echo fake\r')},{seq:3,content:'',unavailable:true}],'COMPLETED',3)
  expect(result.metadata.issues.map(i=>i.code)).toEqual(expect.arrayContaining(['CHUNK_COUNT','EVENT_ORDER','CHUNK_SEQUENCE','CHUNK_UNAVAILABLE','MISSING_END']))
  expect(result.commands).toEqual([])
 })
 it('distinguishes active and unavailable captures',()=>{
  expect(reconstructAudit([{seq:1,content:line(1,'session_started')}],'RUNNING',1).metadata.state).toBe('running')
  expect(reconstructAudit([],'COMPLETED',1).metadata.state).toBe('unavailable')
 })
 it('bounds diagnostics for corrupted files',()=>{
  expect(reconstructAudit([{seq:1,content:'invalid\n'.repeat(1000)}],'COMPLETED',1).metadata.issues).toHaveLength(101)
 })
 it('exports commands and both directions without executing escapes or revealing masked secrets',()=>{
  const source=line(1,'session_started')+line(2,'stdin','{{secret:lab:***}}\n')+line(3,'stdout','\x1b[2Jação\r\n')+line(4,'session_ended')
  const text=auditTranscript(42,reconstructAudit([{seq:1,content:source}],'COMPLETED',1))
  expect(text).toContain('session_started');expect(text).toContain('stdin');expect(text).toContain('stdout');expect(text).toContain('{{secret:lab:***}}')
  expect(text).toContain('<ESC>[2Jação<CR>');expect(text).not.toContain('\x1b')
  expect(printableAuditText('\u202e\0')).toBe('<U+202E><U+0000>')
 })
})
describe('bounded cache, isolation and failure recovery',()=>{
 it('shares one reconstruction across concurrent endpoints',async()=>{
  const {service,storage,store}=fixture()
  const results=await Promise.all(Array.from({length:20},()=>service.snapshot(1,42)))
  expect(storage.readChunk).toHaveBeenCalledTimes(1);expect(store.save).toHaveBeenCalledTimes(1)
  expect(new Set(results.map(r=>r.metadata.id)).size).toBe(1)
 })
 it('revalidates ownership even on a cache hit and refuses cross-tenant history',async()=>{
  const {service,storage,store}=fixture();await service.snapshot(1,42)
  await expect(service.snapshot(2,42)).rejects.toMatchObject({statusCode:404})
  await expect(service.historicalCommands(2,42,'a'.repeat(64))).rejects.toMatchObject({statusCode:404})
  expect(storage.readChunk).toHaveBeenCalledTimes(1);expect(store.commands).not.toHaveBeenCalled()
 })
 it('invalidates on new chunks, expiry and explicit reprocessing',async()=>{
  let now=100
  const {service,storage,row}=fixture({cacheBytes:1000000,maxSourceBytes:1000000,completedTtlMs:10,runningTtlMs:2,now:()=>now})
  await service.snapshot(1,42);await service.snapshot(1,42);expect(storage.readChunk).toHaveBeenCalledTimes(1)
  now+=11;await service.snapshot(1,42);expect(storage.readChunk).toHaveBeenCalledTimes(2)
  row.chunkCount++;await service.snapshot(1,42);expect(storage.readChunk).toHaveBeenCalledTimes(3)
  await service.snapshot(1,42,true);expect(storage.readChunk).toHaveBeenCalledTimes(4)
 })
 it('does not serve cached captures after retention',async()=>{
  const {service,row}=fixture();await service.snapshot(1,42);row.status='PURGED'
  await expect(service.snapshot(1,42)).rejects.toMatchObject({statusCode:410})
 })
 it('shares oversize-for-cache results without storing them',async()=>{
  const {service,storage}=fixture({cacheBytes:1,maxSourceBytes:1000000,completedTtlMs:1000,runningTtlMs:1,now:()=>100})
  await Promise.all([service.snapshot(1,42),service.snapshot(1,42)]);expect(storage.readChunk).toHaveBeenCalledTimes(1)
  await service.snapshot(1,42);expect(storage.readChunk).toHaveBeenCalledTimes(2)
 })
 it('rejects source overflow and clears the failed in-flight request',async()=>{
  const {service,storage}=fixture({cacheBytes:1,maxSourceBytes:100,completedTtlMs:1000,runningTtlMs:1,now:()=>100})
  await expect(service.snapshot(1,42)).rejects.toMatchObject({statusCode:413})
  storage.readChunk.mockResolvedValue('')
  expect((await service.snapshot(1,42)).metadata.state).toBe('unavailable')
 })
 it('warns about persistence failure while keeping the original reconstruction usable',async()=>{
  const {service,store}=fixture();vi.mocked(store.save).mockRejectedValue(new Error('database offline'))
  const {metadata}=await service.snapshot(1,42)
  expect(metadata.persisted).toBe(false);expect(metadata.issues.at(-1)?.code).toBe('PERSISTENCE_UNAVAILABLE')
 })
 it('never persists a running capture and retries missing storage after refresh',async()=>{
  const {service,row,storage,store}=fixture();row.status='RUNNING';storage.readChunk.mockRejectedValueOnce(new Error('unavailable'))
  expect((await service.snapshot(1,42)).metadata.state).toBe('unavailable')
  expect((await service.snapshot(1,42,true)).commands).toHaveLength(1)
  expect(store.save).not.toHaveBeenCalled()
 })
 it('compares preserved versions without changing either record',async()=>{
  const {service,store}=fixture();const current=await service.snapshot(1,42)
  vi.mocked(store.commands).mockResolvedValue([{...current.commands[0]!,command:'echo before'}])
  const diff=await service.compare(1,42,'a'.repeat(64))
  expect(diff.modified).toBe(1);expect(diff.changes[0]?.after).toBe('echo ok')
  expect(current.commands[0]?.command).toBe('echo ok')
 })
})

describe('reconstruction load control',()=>{
 it('rejects a capture purged during storage reading before persisting or caching it',async()=>{
  const {service,storage,row,store}=fixture()
  storage.readChunk.mockImplementationOnce(()=>{row.status='PURGED';return Promise.resolve(recording())})
  await expect(service.snapshot(1,42)).rejects.toMatchObject({statusCode:410})
  expect(store.save).not.toHaveBeenCalled()
  row.status='COMPLETED'
  expect((await service.snapshot(1,42)).metadata.state).toBe('complete')
  expect(storage.readChunk).toHaveBeenCalledTimes(2)
 })
 it('recovers persisted history after a database outage and explicit retry',async()=>{
  const {service,store}=fixture()
  vi.mocked(store.save).mockRejectedValueOnce(new Error('connection reset'))
  const failed=await service.snapshot(1,42)
  expect(failed.metadata.persisted).toBe(false)
  const recovered=await service.snapshot(1,42,true)
  expect(recovered.metadata.persisted).toBe(true)
  expect(recovered.metadata.id).toBe(failed.metadata.id)
  expect(recovered.metadata.issues.some(i=>i.code==='PERSISTENCE_UNAVAILABLE')).toBe(false)
 })
 it('does not misreport an unavailable history database as an empty history',async()=>{
  const {service,store}=fixture()
  vi.mocked(store.history).mockRejectedValueOnce(new Error('connection refused'))
  await expect(service.history(1,42)).rejects.toMatchObject({statusCode:503,code:'AUDIT_HISTORY_UNAVAILABLE'})
  await expect(service.history(1,42)).resolves.toEqual([])
 })
 it('bounds large version comparisons without truncating preserved commands',async()=>{
  const {service,store}=fixture()
  const current=await service.snapshot(1,42)
  const previous=Array.from({length:30},(_,index)=>({...current.commands[0]!,index:index+1,command:'x'.repeat(5000)}))
  vi.mocked(store.commands).mockResolvedValue(previous)
  const comparison=await service.compare(1,42,'a'.repeat(64))
  expect(comparison).toMatchObject({modified:1,removed:29,added:0,truncated:true})
  expect(comparison.changes).toHaveLength(20)
  expect(comparison.changes[0]?.before).toHaveLength(2000)
  expect(comparison.changes[0]?.beforeChars).toBe(5000)
  expect(previous[0]?.command).toHaveLength(5000)
 })
 it('limits active work to two and rejects overload without leaking queue slots',async()=>{
  let release!:()=>void
  const gate=new Promise<void>(resolve=>{release=resolve})
  const repo={findBySessionId:(tenant:number,id:number)=>Promise.resolve({sessionId:id,tenantId:tenant,status:'COMPLETED',chunkCount:1,bytesIn:1,bytesOut:1} as SessionAuditRow),listChunks:()=>Promise.resolve([{seq:1,storageKey:'fixture'}])}
  const read=vi.fn(async()=>{await gate;return recording()})
  const service=new SessionAuditReconstructionService(repo,{readChunk:read})
  const all=Promise.allSettled(Array.from({length:11},(_,i)=>service.snapshot(1,100+i)))
  await vi.waitFor(()=>expect(read).toHaveBeenCalledTimes(2))
  release()
  const results=await all
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(10)
  const failure=results.find(r=>r.status==='rejected')
  expect(failure?.status==='rejected'?(failure.reason as {code:string}).code:null).toBe('AUDIT_PROCESSOR_BUSY')
  expect((await service.snapshot(1,200)).metadata.state).toBe('complete')
 })
 it('joins repeated concurrent reprocess requests into one fresh read',async()=>{
  const {service,storage}=fixture()
  await service.snapshot(1,42)
  await Promise.all(Array.from({length:10},()=>service.snapshot(1,42,true)))
  expect(storage.readChunk).toHaveBeenCalledTimes(2)
 })
 it('keeps at most 64 cache entries, including small or empty captures',async()=>{
  const repo={findBySessionId:(tenant:number,id:number)=>Promise.resolve({sessionId:id,tenantId:tenant,status:'COMPLETED',chunkCount:0,bytesIn:0,bytesOut:0} as SessionAuditRow),listChunks:vi.fn(()=>Promise.resolve([]))}
  const service=new SessionAuditReconstructionService(repo,{readChunk:()=>Promise.resolve('')})
  for(let i=1;i<=65;i++)await service.snapshot(1,i)
  await service.snapshot(1,1)
  expect(repo.listChunks).toHaveBeenCalledTimes(66)
 })
})
