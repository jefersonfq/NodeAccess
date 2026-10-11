import {afterEach,describe,it,expect,vi} from 'vitest'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {gzipSync} from 'node:zlib'
vi.mock('../../config/env.js',()=>({env:{SESSION_AUDIT_STORAGE_DIR:'/tmp'}}))
vi.mock('../../config/logger.js',()=>({logger:{warn:vi.fn()}}))
import {SessionAuditStorage} from './session-audit.storage.js'
const dirs:string[]=[]
afterEach(async()=>{await Promise.all(dirs.splice(0).map(dir=>rm(dir,{recursive:true,force:true})))})
async function file(name:string,content:Buffer|string){const dir=await mkdtemp(join(tmpdir(),'nodeaccess-audit-limit-'));dirs.push(dir);const path=join(dir,name);await writeFile(path,content);return path}
describe('bounded audit decompression',()=>{
 it('reads a valid compressed chunk and keeps Unicode',async()=>{
  const path=await file('chunk.gz',gzipSync('ação\n'))
  expect(await new SessionAuditStorage().readChunk(path,100)).toBe('ação\n')
 })
 it('rejects expansion beyond the processing limit',async()=>{
  const path=await file('chunk.gz',gzipSync('x'.repeat(10000)))
  await expect(new SessionAuditStorage().readChunk(path,100)).rejects.toMatchObject({code:'ERR_BUFFER_TOO_LARGE'})
 })
 it('rejects oversized plain files before decoding',async()=>{
  const path=await file('chunk.jsonl','x'.repeat(1000))
  await expect(new SessionAuditStorage().readChunk(path,100)).rejects.toMatchObject({code:'AUDIT_CHUNK_TOO_LARGE'})
 })
 it('distinguishes a missing chunk from a corrupt gzip',async()=>{
  const path=await file('chunk.gz','broken')
  await expect(new SessionAuditStorage().readChunk(path,100)).rejects.toMatchObject({code:'Z_DATA_ERROR'})
  expect(await new SessionAuditStorage().readChunk(path+'.missing',100)).toBe('')
 })
})
