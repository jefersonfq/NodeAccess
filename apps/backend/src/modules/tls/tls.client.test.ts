import { it, expect } from 'vitest'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { TlsClient } from './tls.client.js'
async function fixture(handler:http.RequestListener){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'na-tls-client-')),socket=path.join(dir,'control.sock'),server=http.createServer(handler)
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve)})
 return {client:new TlsClient(socket),close:async()=>{await new Promise<void>(r=>server.close(()=>r()));await fs.rm(dir,{recursive:true,force:true})}}
}
it('Unix transport returns job and preserves platform actor attribution',async()=>{
 let actor:string|undefined,payload=''
 const {client,close}=await fixture((req,res)=>{actor=String(req.headers['x-nodeaccess-actor']);req.on('data',d=>payload+=d);req.on('end',()=>{res.writeHead(202);res.end(JSON.stringify({id:'accepted'}))})})
 try{expect(await client.request('POST','/operations',{action:'check'},'user:7')).toEqual({id:'accepted'});expect(actor).toBe('user:7');expect(JSON.parse(payload)).toEqual({action:'check'})}finally{await close()}
})
it('Unavailable worker has an actionable local error',async()=>{await expect(new TlsClient('/tmp/no-such-nodeaccess-tls-socket').request('GET','/status')).rejects.toMatchObject({statusCode:503,code:'TLS_UNAVAILABLE'})})
it('Rejects malformed response without exposing its contents',async()=>{
 const {client,close}=await fixture((_req,res)=>res.end('PRIVATE KEY DATA'))
 try{await expect(client.request('GET','/status')).rejects.toMatchObject({statusCode:502,code:'TLS_UNAVAILABLE'})}finally{await close()}
})
it('Interrupted worker response rejects instead of hanging',async()=>{
 const {client,close}=await fixture((_req,res)=>{res.writeHead(200,{'Content-Length':'100'});res.write('{');setTimeout(()=>res.destroy(),10)})
 try{await expect(client.request('GET','/status')).rejects.toMatchObject({statusCode:503})}finally{await close()}
})
it('Preserves conflict status for concurrent operations',async()=>{
 const {client,close}=await fixture((_req,res)=>{res.writeHead(409);res.end(JSON.stringify({code:'TLS_BUSY',message:'Operação em andamento.'}))})
 try{await expect(client.request('POST','/operations',{action:'check'})).rejects.toMatchObject({statusCode:409,code:'TLS_BUSY'})}finally{await close()}
})

it('Unconfigured transport is distinct from an unreachable worker',async()=>{await expect(new TlsClient('').request('GET','/status')).rejects.toMatchObject({statusCode:503,code:'TLS_NOT_CONFIGURED'})})
