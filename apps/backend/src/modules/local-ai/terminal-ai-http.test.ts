import { createServer, request } from 'node:http'
import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { LocalAiController } from './local-ai.controller.js'
import { OllamaProvider } from './providers/ollama.provider.js'

describe('terminal HTTP cancellation through provider transport', () => {
  it.each([false,true])('keeps completed request bodies alive; cancels disconnected clients (%s)', async cancel => {
    let started=false, closed=false
    const server=createServer((req,res) => {
      req.resume();started=true
      res.on('close',()=>{closed=true})
      if(!cancel) setTimeout(()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({message:{content:'{"content":"ss -lntup"}'}}))},40)
    })
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
    const address=server.address()
    if(!address||typeof address==='string')throw new Error('No provider listener')
    const provider=new OllamaProvider('http://127.0.0.1:'+address.port)
    const controller=new LocalAiController({terminalAssist:async (_user:unknown,_body:unknown,signal:AbortSignal)=>provider.chat({model:'fixture',systemPrompt:'JSON',userMessage:'ports',signal})} as never,{} as never,{} as never,{} as never)
    const app=Fastify()
    app.post('/terminal',controller.terminalAssist.bind(controller) as never)
    const url=await app.listen({port:0,host:'127.0.0.1'})
    try {
      if(cancel){
        const client=request(url+'/terminal',{method:'POST',headers:{'Content-Type':'application/json'}},res=>res.resume())
        client.on('error',()=>{})
        client.end('{}')
        await vi.waitFor(()=>expect(started).toBe(true))
        client.destroy()
        await vi.waitFor(()=>expect(closed).toBe(true),{timeout:3000})
      } else {
        const result=await fetch(url+'/terminal',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
        expect(result.status).toBe(200)
        expect(await result.json()).toMatchObject({answer:'{"content":"ss -lntup"}'})
      }
    } finally {
      await app.close()
      server.closeAllConnections()
      await new Promise<void>(resolve=>server.close(()=>resolve()))
    }
  })
})
