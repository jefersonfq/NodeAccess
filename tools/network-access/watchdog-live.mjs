// Freeze only this disposable daemon's database TCP proxy. Never pause the real DB.
import assert from 'node:assert/strict'
import { createServer, connect } from 'node:net'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
if(process.env.RUN_NETWORK_WATCHDOG_LIVE!=='true')throw Error('Set RUN_NETWORK_WATCHDOG_LIVE=true')
const database=new URL(process.env.DATABASE_URL), peers=new Set()
let frozen=false,child,client
const proxy=createServer(downstream=>{
  const upstream=connect(Number(database.port)||3306,database.hostname)
  peers.add(downstream);peers.add(upstream)
  downstream.on('data',b=>{if(!frozen)upstream.write(b)})
  upstream.on('data',b=>{if(!frozen)downstream.write(b)})
  for(const socket of [downstream,upstream]){
    socket.on('error',()=>{downstream.destroy();upstream.destroy()})
    socket.on('close',()=>{peers.delete(socket);downstream.destroy();upstream.destroy()})
  }
})
await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve))
async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p}
const port=await freePort(),healthPort=await freePort()
const target=new URL(database);target.hostname='127.0.0.1';target.port=String(proxy.address().port)
const pause=ms=>new Promise(r=>setTimeout(r,ms))
try{
  child=spawn(process.execPath,['--env-file=apps/backend/.env','apps/backend/dist/modules/network-access/tacacs-main.js'],{env:{...process.env,DATABASE_URL:target.toString(),NODEACCESS_TACACS_ENABLE:'true',NODEACCESS_TACACS_BIND:'127.0.0.1',NODEACCESS_TACACS_PORT:String(port),NODEACCESS_TACACS_HEALTH_PORT:String(healthPort),NODEACCESS_TACACS_STALL_MS:'15000'},stdio:['ignore','ignore','pipe']})
  let watchdogLogged=false
  child.stderr.on('data',b=>{if(b.toString().includes('supervisor restart required'))watchdogLogged=true})
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})))
  let ready=false
  for(let i=0;i<100;i++){
    if(child.exitCode!==null)throw Error('Disposable daemon exited before readiness')
    try{ready=(await fetch(`http://127.0.0.1:${healthPort}/ready`,{signal:AbortSignal.timeout(1000)})).ok}catch{}
    if(ready)break;await pause(500)
  }
  assert.equal(ready,true,'daemon must be healthy before fault injection')
  const metrics=await (await fetch(`http://127.0.0.1:${healthPort}/metrics`)).json()
  assert.equal(metrics.listening,true);assert.equal('tenants' in metrics,false)
  frozen=true
  client=connect(port,'127.0.0.1');client.on('error',()=>{})
  const frames=[];client.on('data',b=>frames.push(b))
  const closed=new Promise(resolve=>client.once('close',resolve))
  // Header is valid. Backend source lookup stalls before body decryption.
  await new Promise(resolve=>client.once('connect',resolve))
  const frame=Buffer.alloc(13);frame[0]=0xc0;frame[1]=2;frame[2]=1;frame.writeUInt32BE(42,4);frame.writeUInt32BE(1,8)
  client.write(frame)
  const started=Date.now()
  await pause(6000)
  assert.equal((await fetch(`http://127.0.0.1:${healthPort}/ready`)).status,503)
  const stalled=await (await fetch(`http://127.0.0.1:${healthPort}/metrics`)).json()
  assert.equal(stalled.pendingOperations,1)
  const result=await Promise.race([exited,pause(25000).then(()=>{throw Error('Watchdog did not exit the stalled daemon')})])
  await closed;assert.equal(result.code,1);assert.equal(watchdogLogged,true);assert.equal(frames.length,0)
  const report={ok:true,healthyBeforeFault:true,readiness503AfterStall:true,pendingCapacityRetained:true,exitCode:result.code,noAaaAcknowledgment:true,elapsedMs:Date.now()-started,scope:'Only this daemon database proxy was frozen; actual MySQL remained running. Supervisor restart itself not exercised.'}
  writeFileSync('/tmp/nodeaccess-tacacs-watchdog-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}finally{
  client?.destroy();if(child&&child.exitCode===null)child.kill('SIGKILL')
  for(const socket of peers)socket.destroy()
  await new Promise(resolve=>proxy.close(resolve))
}
