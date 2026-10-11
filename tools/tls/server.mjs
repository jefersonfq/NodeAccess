import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CertificateManager } from './manager.mjs'
import { createAdapter } from './adapter.mjs'
import { TlsError } from './certificates.mjs'
export function createServer(manager) {
  return http.createServer(async(req,res)=>{
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
    try {
      if(req.method==='GET'&&req.url==='/status')return send(200,await manager.status())
      const actor=String(req.headers['x-nodeaccess-actor']||'unknown').slice(0,100)
      if(req.method==='GET'&&req.url==='/events')return send(200,{events:manager.events()})
      if(req.method==='GET'&&/^\/operations\/[0-9a-f-]{36}$/i.test(req.url))return send(200,manager.operation(req.url.split('/').pop(),actor))
      if(req.method!=='POST'||!['/operations','/events/ack'].includes(req.url))return send(404,{message:'Not found'})
      let body='',size=0
      for await(const chunk of req){size+=chunk.length;if(size>150000)throw new TlsError('TOO_LARGE','Arquivos muito grandes.',413);body+=chunk}
      let data;try{data=JSON.parse(body)}catch{throw new TlsError('INVALID_JSON','Dados inválidos.',400)}
      if(req.url==='/events/ack'){await manager.acknowledge(data.ids);return send(200,{ok:true})}
      send(202,await manager.submit(data,actor))
    }catch(e){send(e instanceof TlsError?e.status:500,{code:e instanceof TlsError?e.code:'TLS_SERVICE_ERROR',message:e instanceof TlsError?e.message:'Serviço de certificados indisponível.'})}
  })
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const domain=process.env.TLS_DOMAIN, external=process.env.TLS_EXTERNAL==='true'
  const socket=process.env.TLS_SOCKET_PATH||'/run/nodeaccess-tls/control.sock'
  const manager=new CertificateManager({root:'/etc/nginx/certs/managed',stateDir:'/var/lib/nodeaccess-tls',domain,external,adapter:createAdapter({domain,external,trustFile:process.env.TLS_TRUST_FILE,acmeDirectory:process.env.TLS_ACME_DIRECTORY})})
  await fs.mkdir(path.dirname(socket),{recursive:true,mode:0o755})
  // A single service owns this socket. A live socket is never removed by a second instance.
  try {const net=await import('node:net');await new Promise((resolve,reject)=>{const s=net.connect(socket);s.once('connect',()=>{s.end();reject(new Error('TLS service already running'))});s.once('error',resolve)});await fs.unlink(socket).catch(e=>{if(e.code!=='ENOENT')throw e})}catch(e){throw e}
  await manager.init()
  const server=createServer(manager);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socket,resolve)})
  await fs.chmod(socket,0o660)
  manager.on('completed',event=>console.log(JSON.stringify({event:'tls.operation.completed',...event})))
  const timer=setInterval(()=>manager.tick().catch(()=>console.error('TLS scheduler unavailable')),60000)
  for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{clearInterval(timer);server.close(()=>process.exit(0))})
  await manager.tick().catch(()=>console.error('TLS scheduler unavailable'))
}
