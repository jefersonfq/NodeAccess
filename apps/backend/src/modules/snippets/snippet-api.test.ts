import Fastify from 'fastify'
import { describe, it, expect, vi } from 'vitest'
import { SnippetService } from './snippet.service.js'
import { SnippetController } from './snippet.controller.js'
import { snippetRoutes } from './snippet.routes.js'
vi.mock('../../shared/guards.js', () => ({ requireAuth: (req: {user: unknown}) => { req.user = {sub:'7',tenantId:3}; return Promise.resolve() } }))
async function fixture() {
  const db = { $executeRaw: vi.fn(()=>Promise.resolve(1)), snippet: {create:vi.fn(({data}: {data:unknown})=>Promise.resolve({id:1,...data as object})),findFirst:vi.fn(()=>Promise.resolve({id:1,tenantId:3,createdById:7})),findMany:vi.fn(()=>Promise.resolve([])),update:vi.fn(({data}:{data:unknown})=>Promise.resolve(data)),delete:vi.fn()}, snippetGroup:{findFirst:vi.fn(()=>Promise.resolve({id:4}))} }
  const entitlement={requireFeature:vi.fn(()=>Promise.resolve())}
  const app=Fastify()
  app.setErrorHandler((error,_,reply)=>{const e=error as {statusCode?:number;code?:string};reply.code(e.statusCode??500).send({code:e.code})})
  await app.register(async scoped=>snippetRoutes(scoped,new SnippetController(new SnippetService(db as never,entitlement as never))),{prefix:'/snippets'})
  return {app,db,entitlement}
}
describe('snippets API validation and access integration',()=>{
  it('persists versioned macro under authenticated tenant and owner',async()=>{
    const {app,db}=await fixture()
    try {
      const command='#!nodeaccess:macro-v1\n'+JSON.stringify({version:1,steps:[{type:'send',text:'pwd',enter:true}]})
      const response=await app.inject({method:'POST',url:'/snippets',payload:{name:'test',command,scope:'PERSONAL'}})
      expect(response.statusCode).toBe(201)
      expect(db.snippet.create.mock.calls[0]?.[0].data).toMatchObject({tenantId:3,createdById:7,command})
    }finally{await app.close()}
  })
  it.each(['#!nodeaccess:sequence\n{"steps":[]}','#!nodeaccess:macro-v1\n{"version":2,"steps":[]}',' ','#!nodeaccess:expect-send\n{"steps":[{"expect":"","send":"pwd"}]}'])('rejects malformed payload without writing: %s',async command=>{
    const {app,db}=await fixture()
    try {
      expect((await app.inject({method:'POST',url:'/snippets',payload:{name:'test',command,scope:'PERSONAL'}})).statusCode).toBe(400)
      expect(db.snippet.create).not.toHaveBeenCalled()
    }finally{await app.close()}
  })
  it('rejects invalid update and leaves stored macro intact',async()=>{
    const {app,db}=await fixture()
    try {
      expect((await app.inject({method:'PUT',url:'/snippets/1',payload:{command:'#!nodeaccess:macro-v1\n{}'}})).statusCode).toBe(400)
      expect(db.snippet.update).not.toHaveBeenCalled()
    }finally{await app.close()}
  })
  it('checks owner on edit and delete',async()=>{
    const {app,db}=await fixture()
    db.snippet.findFirst.mockResolvedValue({id:1,tenantId:3,createdById:99})
    try {
      expect((await app.inject({method:'PUT',url:'/snippets/1',payload:{name:'changed'}})).statusCode).toBe(403)
      expect((await app.inject({method:'DELETE',url:'/snippets/1'})).statusCode).toBe(403)
      expect(db.snippet.update).not.toHaveBeenCalled();expect(db.snippet.delete).not.toHaveBeenCalled()
    }finally{await app.close()}
  })
  it('scopes list and item lookup to the current tenant',async()=>{
    const {app,db}=await fixture()
    try {
      await app.inject({method:'GET',url:'/snippets'})
      expect(db.snippet.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{tenantId:3,OR:[{scope:'TEAM'},{scope:'PERSONAL',createdById:7}]}}))
      await app.inject({method:'PUT',url:'/snippets/1',payload:{name:'new'}})
      expect(db.snippet.findFirst).toHaveBeenCalledWith({where:{id:1,tenantId:3}})
    }finally{await app.close()}
  })
  it('does not write when entitlement rejects',async()=>{
    const {app,db,entitlement}=await fixture()
    entitlement.requireFeature.mockRejectedValue(Object.assign(new Error('denied'),{statusCode:403}))
    try {
      expect((await app.inject({method:'POST',url:'/snippets',payload:{name:'test',command:'pwd',scope:'PERSONAL'}})).statusCode).toBe(403)
      expect(db.snippet.create).not.toHaveBeenCalled()
    }finally{await app.close()}
  })
  it('records only bounded client progress using authenticated event ownership',async()=>{
    const {app,db}=await fixture()
    try{
      const outcome={executionId:'run-1',status:'completed',step:2,total:2}
      expect((await app.inject({method:'POST',url:'/snippets/1/execution-status',payload:outcome})).statusCode).toBe(204)
      const call=db.$executeRaw.mock.calls[0] as unknown as unknown[]
      expect(call.slice(2)).toEqual([3,7,1,'run-1'])
      expect(JSON.stringify(call[0])).toContain('user_id')
      expect((await app.inject({method:'POST',url:'/snippets/1/execution-status',payload:{...outcome,tenantId:99,output:'not allowed'}})).statusCode).toBe(400)
      expect(db.$executeRaw).toHaveBeenCalledTimes(1)
    }finally{await app.close()}
  })
  it('hides versioned macros from clients without format capability',async()=>{
    const {app,db}=await fixture()
    db.snippet.findMany.mockResolvedValue([{id:1,command:'pwd'},{id:2,command:'#!nodeaccess:macro-v1\n{}'}] as never)
    try{
      expect((await app.inject({method:'GET',url:'/snippets'})).json()).toEqual([{id:1,command:'pwd'}])
      expect((await app.inject({method:'GET',url:'/snippets',headers:{'x-nodeaccess-snippet-format':'macro-v1'}})).json()).toHaveLength(2)
    }finally{await app.close()}
  })
  it('reports pending when gateway has not recorded an event yet',async()=>{
    const {app,db}=await fixture();db.$executeRaw.mockResolvedValue(0)
    try{
      expect((await app.inject({method:'POST',url:'/snippets/1/execution-status',payload:{executionId:'run-1',status:'cancelled',step:0,total:1}})).statusCode).toBe(202)
    }finally{await app.close()}
  })

})
