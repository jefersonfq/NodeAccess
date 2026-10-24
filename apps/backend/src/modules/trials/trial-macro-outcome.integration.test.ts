import Fastify, { type FastifyInstance } from 'fastify'
import fastifyJwt from '@fastify/jwt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureTrialPolicy } from './trial-policy.js'
import { SnippetController } from '../snippets/snippet.controller.js'
import { SnippetService } from '../snippets/snippet.service.js'
import { snippetRoutes } from '../snippets/snippet.routes.js'

let app: FastifyInstance | undefined
afterEach(async () => { await app?.close();configureTrialPolicy(() => Promise.resolve(null)) })
async function fixture(trial: boolean, expired = false) {
  configureTrialPolicy(() => Promise.resolve(trial ? { status: 'ACTIVE', expiresAt: new Date(Date.now()+(expired?-1000:60000)), profileJson: { resources: ['ssh'] } } : null))
  const db = { $executeRaw: vi.fn(() => Promise.resolve(1)) }
  const entitlements = { requireFeature: vi.fn(() => Promise.resolve()) }
  app = Fastify({ logger: false })
  await app.register(fastifyJwt,{secret:'synthetic-release-integration-secret'})
  app.setErrorHandler((error,_req,reply)=>reply.code((error as {statusCode?:number}).statusCode??500).send({code:(error as {code?:string}).code}))
  await app.register(scope=>snippetRoutes(scope,new SnippetController(new SnippetService(db as never,entitlements as never))),{prefix:'/api/v1/snippets'})
  await app.ready()
  const token=app.jwt.sign({sub:'17',tenantId:3,email:'fixture@example.test',role:'user',stage:'authenticated',sessionVersion:0})
  return { app,db,entitlements,headers:{authorization:`Bearer ${token}`} }
}
describe('integrated macro outcomes with real JWT guard, route, controller and service',()=>{
  it('discards trial outcome metadata with 204 before persistence or licensing',async()=>{
    const {app,db,entitlements,headers}=await fixture(true)
    const response=await app.inject({method:'POST',url:'/api/v1/snippets/5/execution-status',headers,payload:{executionId:'trial-run',status:'completed',step:2,total:2}})
    expect(response.statusCode).toBe(204);expect(response.body).toBe('')
    expect(db.$executeRaw).not.toHaveBeenCalled();expect(entitlements.requireFeature).not.toHaveBeenCalled()
  })
  it('preserves normal owner-scoped outcome persistence',async()=>{
    const {app,db,entitlements,headers}=await fixture(false)
    const response=await app.inject({method:'POST',url:'/api/v1/snippets/5/execution-status',headers,payload:{executionId:'normal-run',status:'completed',step:2,total:2}})
    expect(response.statusCode).toBe(204);expect(entitlements.requireFeature).toHaveBeenCalledWith(3,'snippets',expect.any(String))
    expect(db.$executeRaw).toHaveBeenCalledOnce()
    const values=db.$executeRaw.mock.calls[0] as unknown as unknown[]
    expect(values.slice(-4)).toEqual([3,17,5,'normal-run'])
  })
  it('keeps normal payload validation and pending-event retry semantics',async()=>{
    const {app,db,headers}=await fixture(false)
    expect((await app.inject({method:'POST',url:'/api/v1/snippets/5/execution-status',headers,payload:{status:'invented'}})).statusCode).toBe(400)
    expect(db.$executeRaw).not.toHaveBeenCalled();db.$executeRaw.mockResolvedValue(0)
    expect((await app.inject({method:'POST',url:'/api/v1/snippets/5/execution-status',headers,payload:{executionId:'pending',status:'completed',step:1,total:1}})).statusCode).toBe(202)
  })
  it('denies expired trial and anonymous calls before discard',async()=>{
    const {app,db,headers}=await fixture(true,true)
    expect((await app.inject({method:'POST',url:'/api/v1/snippets/5/execution-status',headers,payload:{}})).statusCode).toBe(403)
    expect((await app.inject({method:'POST',url:'/api/v1/snippets/5/execution-status',payload:{}})).statusCode).toBe(401)
    expect(db.$executeRaw).not.toHaveBeenCalled()
  })
})
