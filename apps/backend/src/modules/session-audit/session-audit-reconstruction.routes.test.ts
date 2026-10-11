import {beforeAll,describe,it,expect,vi} from 'vitest'
import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import {sessionAuditRoutes} from './session-audit.routes.js'
import {SessionAuditController} from './session-audit.controller.js'
import {SessionAuditService} from './session-audit.service.js'
import type {SessionAuditRepository,SessionAuditRow} from './session-audit.repository.js'
import type {SessionAuditStorage} from './session-audit.storage.js'
async function fixture(){
 const app=Fastify();await app.register(jwt,{secret:'audit-test-only-disposable-signing-secret'})
 app.setErrorHandler((error,_req,reply)=>reply.code(error.statusCode??500).send({message:error.message}))
 const row={tenantId:1,sessionId:42,status:'COMPLETED',chunkCount:1,bytesIn:5,bytesOut:5} as SessionAuditRow
 const repo={findBySessionId:vi.fn((tenant:number,id:number)=>Promise.resolve(tenant===1&&id===42?row:null)),listChunks:vi.fn(()=>Promise.resolve([{seq:1,storageKey:'fixture'}]))}
 const content=[{seq:1,type:'session_started'},{seq:2,type:'stdin',data:'echo ok\r'},{seq:3,type:'stdout',data:'ok\r\n'},{seq:4,type:'session_ended'}].map(e=>JSON.stringify({seq:e.seq,ts:'2026-09-29T12:00:00Z',type:e.type,payload:{data:e.data??'',actorUserId:9}})).join('\n')
 const service=new SessionAuditService(repo as unknown as SessionAuditRepository,{readChunk:()=>Promise.resolve(content)} as SessionAuditStorage)
 await app.register(async instance=>sessionAuditRoutes(instance,new SessionAuditController(service)),{prefix:'/session-audit'})
 return {app,repo,row,token:(extra:Record<string,unknown>={})=>app.jwt.sign({sub:'1',tenantId:1,role:'admin',stage:'authenticated',...extra})}
}
describe('reconstruction API access and downloads',()=>{
 // Fastify/AJV lazily loads its compilers on first boot. Keep that one-time
 // infrastructure setup outside individual request/retention test deadlines.
 beforeAll(async()=>{
  const {app}=await fixture()
  try {await app.ready()} finally {await app.close()}
 },30000)
 it('rechecks retention after rendering, before sending the TXT',async()=>{
  const {app,token,repo,row}=await fixture()
  repo.findBySessionId.mockResolvedValueOnce(row).mockResolvedValueOnce(row).mockResolvedValueOnce({...row,status:'PURGED'})
  try {
   const response=await app.inject({url:'/session-audit/42/transcript',headers:{authorization:`Bearer ${token()}`}})
   expect(response.statusCode).toBe(410)
   expect(response.headers['content-disposition']).toBeUndefined()
  }finally{await app.close()}
 })
 it('protects reprocessing POST before any storage access',async()=>{
  const {app,token,repo}=await fixture()
  try {
   expect((await app.inject({method:'POST',url:'/session-audit/42/reconstruction'})).statusCode).toBe(401)
   expect((await app.inject({method:'POST',url:'/session-audit/42/reconstruction',headers:{authorization:`Bearer ${token({role:'user'})}`}})).statusCode).toBe(403)
   expect(repo.listChunks).not.toHaveBeenCalled()
  }finally{await app.close()}
 })
 it('denies TXT and history after retention even after warming the cache',async()=>{
  const {app,token,row}=await fixture();const headers={authorization:`Bearer ${token()}`}
  try {
   expect((await app.inject({url:'/session-audit/42/transcript',headers})).statusCode).toBe(200)
   row.status='PURGED'
   for(const path of ['transcript','reconstruction','reconstructions',`reconstructions/${'a'.repeat(64)}/commands`]) {
    const response=await app.inject({url:`/session-audit/42/${path}`,headers})
    expect(response.statusCode).toBe(410)
    expect(response.body).not.toContain('echo ok')
   }
  }finally{await app.close()}
 })
 it.each(['transcript','reconstruction','reconstructions',`reconstructions/${'a'.repeat(64)}/commands`,`reconstructions/${'a'.repeat(64)}/compare`])('protects %s from unauthenticated and non-admin users',async path=>{
  const {app,token,repo}=await fixture()
  try {
   expect((await app.inject({url:`/session-audit/42/${path}`})).statusCode).toBe(401)
   expect((await app.inject({url:`/session-audit/42/${path}`,headers:{authorization:`Bearer ${token({role:'user'})}`}})).statusCode).toBe(403)
   expect(repo.findBySessionId).not.toHaveBeenCalled()
  }finally{await app.close()}
 })
 it('applies tenant scope to reads and reprocessing',async()=>{
  const {app,token}=await fixture()
  try{for(const method of ['GET','POST'] as const)expect((await app.inject({method,url:'/session-audit/42/reconstruction',headers:{authorization:`Bearer ${token({tenantId:2})}`}})).statusCode).toBe(404)}finally{await app.close()}
 })
 it('returns a UTF-8 TXT attachment with no browser caching',async()=>{
  const {app,token}=await fixture()
  try{
   const res=await app.inject({url:'/session-audit/42/transcript',headers:{authorization:`Bearer ${token()}`}})
   expect(res.statusCode).toBe(200);expect(res.headers['content-type']).toContain('text/plain');expect(res.headers['content-disposition']).toContain('session-audit-42.txt');expect(res.headers['cache-control']).toBe('no-store');expect(res.headers['x-content-type-options']).toBe('nosniff')
   expect(res.body).toContain('ok');expect(res.body).not.toContain('stdout');expect(res.body).not.toContain('Processador:')
  }finally{await app.close()}
 })
 it.each(['terminal','commands','technical'])('serves the requested %s format with scoped filenames',async format=>{
  const {app,token}=await fixture()
  try {
   const response=await app.inject({url:`/session-audit/42/transcript?format=${format}`,headers:{authorization:`Bearer ${token()}`}})
   expect(response.statusCode).toBe(200)
   expect(response.headers['content-disposition']).toContain(`session-audit-42${format==='terminal'?'':`-${format}`}.txt`)
   if(format==='technical')expect(response.body).toContain('EVENTOS VÁLIDOS')
   if(format==='commands'){expect(response.body).toContain('echo ok');expect(response.body).not.toContain('SAÍDA ASSOCIADA')}
   if(format==='terminal')expect(response.body).not.toContain('echo ok') // stdin is not an echoed command in this fixture.
  }finally{await app.close()}
 })
 it('rejects unsupported export formats',async()=>{
  const {app,token}=await fixture()
  try {expect((await app.inject({url:'/session-audit/42/transcript?format=raw-script',headers:{authorization:`Bearer ${token()}`}})).statusCode).toBe(400)}finally{await app.close()}
 })
 it('validates identifiers and returns reconstruction provenance',async()=>{
  const {app,token}=await fixture();const headers={authorization:`Bearer ${token()}`}
  try {
   expect((await app.inject({url:'/session-audit/not-a-number/reconstruction',headers})).statusCode).toBe(400)
   const res=await app.inject({method:'POST',url:'/session-audit/42/reconstruction',headers})
   expect(res.statusCode).toBe(200);expect(res.json()).toMatchObject({state:'complete',eventCount:4,commandCount:1})
   const commands=await app.inject({url:'/session-audit/42/commands',headers})
   expect(commands.json<Array<{source:unknown}>>()[0]?.source).toEqual({inputFrom:2,inputTo:2,outputFrom:3,outputTo:3})
  }finally{await app.close()}
 })
})
