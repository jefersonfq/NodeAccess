import { createServer, type Socket } from 'node:net'
import { TacacsMetrics } from './tacacs-metrics.js'
import type { NetworkAccessService } from './network-access.service.js'
import { MAX_BODY, readHeader, cryptBody, reply, authStart, authContinue, authReply, requestArgs, authorizationReply, accountingReply } from './tacacs-protocol.js'

type Backend=Pick<NetworkAccessService,'device'|'authenticate'|'authorize'|'event'>
export function createTacacsServer(backend:Backend,limits={connections:64,perSource:8,operations:32,timeoutMs:5000}) {
  const sockets=new Set<Socket>(),bySource=new Map<string,number>()
  const authenticationWindows=new Map<string,{started:number;count:number}>()
  let operations=0
  const stats={accepted:0,rejected:0,requests:0,errors:0,timeouts:0}
  const metrics=new TacacsMetrics()
  const server=createServer(socket=>{
    const ip=(socket.remoteAddress??'').replace(/^::ffff:/,'')
    if(sockets.size>=limits.connections||(bySource.get(ip)??0)>=limits.perSource){stats.rejected++;socket.destroy();return}
    sockets.add(socket);bySource.set(ip,(bySource.get(ip)??0)+1);stats.accepted++
    let buffer=Buffer.alloc(0),busy=false,sequence=1,sessionId:number|undefined,username='',waiting:'user'|'password'|undefined
    const lifetime=setTimeout(()=>socket.destroy(),90000);lifetime.unref()
    socket.setTimeout(limits.timeoutMs,()=>socket.destroy())
    socket.on('error',()=>{stats.errors++})
    socket.on('close',()=>{clearTimeout(lifetime);sockets.delete(socket);const n=(bySource.get(ip)??1)-1;if(n)bySource.set(ip,n);else bySource.delete(ip)})
    socket.on('data',chunk=>{
      if(busy||buffer.length+chunk.length>MAX_BODY+12){stats.rejected++;socket.destroy();return}
      buffer=Buffer.concat([buffer,chunk])
      if(buffer.length<12)return
      let header:ReturnType<typeof readHeader>
      try{header=readHeader(buffer)}catch{stats.rejected++;socket.destroy();return}
      if(buffer.length<12+header.length)return
      if(buffer.length!==12+header.length||header.sequence!==sequence||(sessionId!==undefined&&sessionId!==header.sessionId)||operations>=limits.operations){stats.rejected++;socket.destroy();return}
      if(header.type===1 && header.sequence===1) {
        const now=Date.now()
        for(const [source,window] of authenticationWindows)if(now-window.started>=60000)authenticationWindows.delete(source)
        const window=authenticationWindows.get(ip)??{started:now,count:0}
        if(window.count>=60||(!authenticationWindows.has(ip)&&authenticationWindows.size>=1024)){stats.rejected++;socket.destroy();return}
        window.count++;authenticationWindows.set(ip,window)
      }
      sessionId=header.sessionId;busy=true;operations++;stats.requests++
      const operationId=metrics.begin()
      const packet=buffer.subarray(12);buffer=Buffer.alloc(0)
      const deadline=setTimeout(()=>{stats.timeouts++;metrics.timeout(operationId);socket.destroy()},limits.timeoutMs);deadline.unref()
      let validated=false,activeDevice:Awaited<ReturnType<Backend['device']>>=null
      void (async()=>{
        // Fresh source binding, tenant activation and secret on EVERY request.
        const device=await backend.device(ip)
        if(!device||socket.destroyed)return
        activeDevice=device;metrics.bind(operationId,device.tenantId)
        const body=cryptBody(header,packet,device.secret)
        let response:Buffer,done=true
        if(header.type===1){
          if(sequence===1){
            const start=authStart(body);validated=true;username=start.username
            if(start.action!==1||start.service!==1||username.length>64)response=authReply(2)
            else if(start.type===2&&header.version===0xc1)response=authReply(await backend.authenticate(device,username,start.password)?1:2)
            else if(start.type===1&&header.version===0xc0){waiting=username?'password':'user';done=false;response=authReply(username?5:4,username?'Password:':'Username:')}
            else response=authReply(2)
          }else{
            if(header.version!==0xc0||!waiting)throw new Error('Unexpected continuation')
            const answer=authContinue(body);validated=true
            if(waiting==='user'){
              if(!answer||answer.length>64)response=authReply(2)
              else{username=answer;waiting='password';done=false;response=authReply(5,'Password:')}
            }else response=authReply(await backend.authenticate(device,username,answer)?1:2)
          }
        }else if(header.type===2){
          if(sequence!==1)throw new Error('Unexpected authorization')
          const request=requestArgs(body);validated=true
          response=authorizationReply(await backend.authorize(device,request.username,request.args)?1:0x10)
        }else{
          if(sequence!==1)throw new Error('Unexpected accounting')
          const request=requestArgs(body,true)
          if(![2,4,8].includes(request.flags))throw new Error('Unsupported accounting flags')
          validated=true
          await backend.event(device,request.username,'accounting',request.flags===2?'start':request.flags===4?'stop':'update',request.args)
          response=accountingReply(1)
        }
        if(socket.destroyed)return
        const encoded=reply(header,response,device.secret)
        if(done)socket.end(encoded)
        else{sequence+=2;busy=false;socket.setTimeout(30000);socket.write(encoded)}
      })().catch(()=>{
        stats.errors++;metrics.error(operationId)
        if(validated&&activeDevice&&!socket.destroyed)socket.end(reply(header,header.type===1?authReply(7):header.type===2?authorizationReply(0x11):accountingReply(2),activeDevice.secret))
        else socket.destroy()
      }).finally(()=>{operations--;metrics.finish(operationId);clearTimeout(deadline);if(busy&&!socket.writableEnded)socket.destroy()})
    })
  })
  return {server,stats,snapshot:()=>({listening:server.listening,connections:sockets.size,limits:{...limits},...stats,...metrics.snapshot()}),close:async()=>{for(const socket of sockets)socket.destroy();await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()))}}
}
