import Fastify from 'fastify'
import { expect, it, vi } from 'vitest'
import { settingsRoutes } from './settings.routes.js'
import { SettingsController } from './settings.controller.js'
import { SettingsService } from './settings.service.js'
import type { SettingsRepository } from './settings.repository.js'
import type { LogRepository } from '../logs/log.repository.js'

async function fixture(role:'admin'|'user'='admin', tenantId=7, authenticated=true) {
  const values = new Map<number,boolean>()
  const repo = {getManualEnabled:vi.fn(async (id:number)=>await Promise.resolve(values.get(id))??false),updateManualEnabled:vi.fn((id:number,enabled:boolean)=>{values.set(id,enabled)
  return Promise.resolve()
})}
  const audit={logAdminEvent:vi.fn().mockResolvedValue(undefined)}
  const service=new SettingsService(repo as unknown as SettingsRepository,audit as unknown as LogRepository)
  const app=Fastify()
  app.decorateRequest('jwtVerify',async()=>{if(!authenticated)throw new Error('unauthorized');return await Promise.resolve({sub:'11',tenantId,role,stage:'authenticated'})})
  await settingsRoutes(app,new SettingsController(service))
  return {app,repo,audit,values}
}
it('starts disabled and allows an authenticated user to read only the current tenant flag',async()=>{
  const {app,repo,values}=await fixture('user');values.set(8,true)
  try { const res=await app.inject({url:'/manual?tenantId=8'});expect(res.statusCode).toBe(200);expect(res.json()).toEqual({enabled:false});expect(repo.getManualEnabled).toHaveBeenCalledWith(7) } finally {await app.close()}
})
it('lets an administrator enable and disable its tenant with an audit event',async()=>{
  const {app,audit,values}=await fixture()
  try {for(const enabled of [true,false]) {const res=await app.inject({method:'PATCH',url:'/manual',payload:{enabled}});expect(res.statusCode).toBe(200);expect(res.json()).toEqual({enabled});expect(values.get(7)).toBe(enabled)}
    expect(audit.logAdminEvent).toHaveBeenLastCalledWith(expect.objectContaining({adminId:11,action:'UPDATE_TENANT_MANUAL',targetId:7,details:'{"enabled":false}'}))
  } finally {await app.close()}
})
it('cannot redirect a write to another tenant using the payload',async()=>{
  const {app,values}=await fixture()
  try {const res=await app.inject({method:'PATCH',url:'/manual',payload:{enabled:true,tenantId:8}});expect([200,400]).toContain(res.statusCode);expect(values.has(8)).toBe(false)}finally{await app.close()}
})
it('denies changes by ordinary users',async()=>{
  const {app,repo}=await fixture('user')
  try {expect((await app.inject({method:'PATCH',url:'/manual',payload:{enabled:true}})).statusCode).toBe(403);expect(repo.updateManualEnabled).not.toHaveBeenCalled()}finally{await app.close()}
})
it.each(['GET','PATCH'] as const)('requires authentication for %s',async method=>{
  const {app}=await fixture('admin',7,false)
  try {expect((await app.inject({method,url:'/manual',...(method==='PATCH'?{payload:{enabled:true}}:{})})).statusCode).toBe(401)}finally{await app.close()}
})
it.each([{}, {enabled:{}}, {enabled:null}])('rejects malformed settings %j',async payload=>{
  const {app,repo}=await fixture()
  try {expect((await app.inject({method:'PATCH',url:'/manual',payload})).statusCode).toBe(400);expect(repo.updateManualEnabled).not.toHaveBeenCalled()}finally{await app.close()}
})
it('does not report success or audit a write when persistence fails',async()=>{
  const {app,repo,audit}=await fixture();repo.updateManualEnabled.mockRejectedValue(new Error('db unavailable'))
  try {expect((await app.inject({method:'PATCH',url:'/manual',payload:{enabled:true}})).statusCode).toBe(500);expect(audit.logAdminEvent).not.toHaveBeenCalled()}finally{await app.close()}
})
