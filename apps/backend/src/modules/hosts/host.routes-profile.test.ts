import { describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import { hostRoutes } from './host.routes.js'

// Exercise actual AJV default injection, not only the Zod DTO or service mock.
describe('partial host updates preserve omitted fields', () => {
  it.each([{deviceProfile:'cisco_ios'}, {name:'Renamed'}, {deviceProfile:'server_ssh',port:2222}])('passes only explicitly supplied fields: %j',async payload=>{
    const app=Fastify()
    await app.register(jwt,{secret:'disposable-profile-routing-test-secret'})
    const update=vi.fn(async (_request,reply)=>reply.code(204).send())
    const controller=new Proxy({}, {get:(_target,key)=>key==='update'?update:vi.fn()})
    await hostRoutes(app,controller as never)
    try {
      const token=app.jwt.sign({sub:'1',tenantId:1,role:'admin',stage:'authenticated'})
      const result=await app.inject({method:'PATCH',url:'/10',headers:{authorization:'Bearer '+token},payload})
      expect(result.statusCode).toBe(204)
      expect(update.mock.calls[0]?.[0].body).toEqual(payload)
    } finally {await app.close()}
  })
})
