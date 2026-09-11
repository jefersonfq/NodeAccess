// Opt-in: creates and removes ONLY its own database tenant; listener binds loopback.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import { Prisma, PrismaClient } from '@prisma/client'
import { SshRepository } from '../../apps/backend/src/modules/ssh/ssh.repository.ts'
import { InventoryAclRepository } from '../../apps/backend/src/modules/inventory/inventory-acl.repository.ts'
import { NetworkAccessService } from '../../apps/backend/src/modules/network-access/network-access.service.ts'
import { networkAccessRoutes } from '../../apps/backend/src/modules/network-access/network-access.routes.ts'
import { TacacsHealthStore } from '../../apps/backend/src/modules/network-access/tacacs-health.ts'
import { createTacacsServer } from '../../apps/backend/src/modules/network-access/tacacs-server.ts'
if(process.env.RUN_NETWORK_ACCESS_LIVE!=='true')throw Error('Set RUN_NETWORK_ACCESS_LIVE=true for disposable tenant tests')
const healthStore=process.env.RUN_NETWORK_DAEMON_HEALTH==='true'?new TacacsHealthStore(process.env.REDIS_URL,process.env.REDIS_PASSWORD):undefined
const db=new PrismaClient(), api=Fastify(), ssh=new SshRepository(db,new InventoryAclRepository(db)),service=new NetworkAccessService(db,ssh,healthStore)
const runtime=createTacacsServer(service),secret='disposable-tacacs-secret-at-least-32-characters'
let tenant,user,host,node,acl,foreignTenant,foreignUser
const checks=[]
function checked(name){checks.push(name);console.log('PASS '+name)}
async function probe(action,extra={}){return new Promise((resolve,reject)=>{const child=spawn(process.env.PYTHON??'python3',['tools/network-access/tacacs-client.py'],{env:process.env});let output='',error='';const deadline=setTimeout(()=>child.kill('SIGKILL'),10000);child.once('close',()=>clearTimeout(deadline));child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);child.on('error',reject);child.on('exit',code=>{try{if(code)throw Error(error);resolve(JSON.parse(output))}catch(e){reject(e)}});child.stdin.end(JSON.stringify({port:Number(process.env.NETWORK_TACACS_EXTERNAL_PORT)||runtime.server.address().port,secret,action,...extra}))})}
try{
 tenant=await db.tenant.create({data:{name:'Disposable network AAA',slug:'network-aaa-'+randomUUID()}})
 user=await db.user.create({data:{tenantId:tenant.id,name:'Alice network pilot',email:randomUUID()+'@example.test'}})
 foreignTenant=await db.tenant.create({data:{name:'Disposable foreign AAA',slug:'network-foreign-'+randomUUID()}})
 foreignUser=await db.user.create({data:{tenantId:foreignTenant.id,name:'Foreign user',email:randomUUID()+'@example.test'}})
 host=await db.host.create({data:{tenantId:tenant.id,name:'Disposable network device',ip:'127.0.0.1',sshUser:'alice',authType:'PASSWORD',scope:'GLOBAL'}})
 node=await db.inventoryNode.create({data:{tenantId:tenant.id,hostId:host.id,name:host.name,type:'HOST',path:'/lab/'+randomUUID(),createdById:user.id}})
 await api.register(jwt,{secret:randomUUID()});await networkAccessRoutes(api,service)
 const token=api.jwt.sign({sub:String(user.id),tenantId:tenant.id,role:'admin',stage:'authenticated'})
 const headers={authorization:'Bearer '+token}
 const put=async(path,payload,status=204)=>{const response=await api.inject({method:'PUT',url:'/'+path,headers,payload});assert.equal(response.statusCode,status,response.body)}
 assert.equal((await api.inject({method:'GET',url:'/'})).statusCode,401)
 assert.equal((await api.inject({method:'GET',url:'/',headers:{authorization:'Bearer '+api.jwt.sign({sub:String(user.id),tenantId:tenant.id,role:'user',stage:'authenticated'})}})).statusCode,403)
 checked('HTTP authentication and administrator restriction')
 await put('settings',{defaultProfile:'network_generic',tacacsEnabled:true})
 assert.equal((await service.settings(tenant.id)).defaultProfile,'network_generic')
 await put('devices',{hostId:host.id,sourceIp:'127.0.0.1',secret,enabled:true})
 await put('credentials',{userId:user.id,username:'alice',password:'disposable-aaa-password',enabled:true})
 await put('grants',{userId:user.id,hostId:host.id,commands:[['show','version']]})
 await put('grants',{userId:user.id,hostId:host.id,commands:[['show','version;reload']]},400)
 await assert.rejects(service.saveCredential(tenant.id,user.id,{userId:foreignUser.id,username:'foreign',password:'disposable-aaa-password',enabled:true}),/cliente/)
 checked('CRUD validation and cross-tenant identity isolation')
 const overview=JSON.stringify(await service.overview(tenant.id));assert.ok(!overview.includes(secret));assert.ok(!overview.includes('disposable-aaa-password'));assert.ok(!overview.includes('password_hash'));checked('API never returns secrets or password hashes')
 if(!process.env.NETWORK_TACACS_EXTERNAL_PORT)await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve))
 assert.equal((await probe('pap')).valid,false);checked('connect ACL required independently of AAA credentials')
 acl=await db.resourceAclEntry.create({data:{tenantId:tenant.id,inventoryNodeId:node.id,principalType:'USER',principalId:user.id,canView:true,canConnect:true,createdById:user.id}})
 assert.equal((await probe('pap')).valid,true);assert.equal((await probe('ascii')).valid,true);checked('independent Python client PAP and ASCII success')
 assert.equal((await probe('pap',{password:'wrong-password'})).valid,false);checked('wrong password denied')
 const query={args:['service=shell','cmd=show','cmd-arg=version']}
 assert.equal((await probe('authorize',query)).valid,true)
 assert.equal((await probe('authorize',{args:['service=shell','cmd=configure','cmd-arg=terminal']})).valid,false);checked('exact command authorization with configuration denied')
 for(const flags of [2,4,8])assert.equal((await probe('accounting',{flags,...query})).valid,true);checked('start stop update accounting persisted')
 await db.resourceAclEntry.update({where:{id:acl.id},data:{canConnect:false}})
 assert.equal((await probe('authorize',query)).valid,false);checked('ACL revocation effective on next authorization')
 await db.resourceAclEntry.update({where:{id:acl.id},data:{canConnect:true}})
 await db.user.update({where:{id:user.id},data:{active:false}});assert.equal((await probe('pap')).valid,false);await db.user.update({where:{id:user.id},data:{active:true}});checked('inactive identity denied')
 await put('settings',{defaultProfile:'server_ssh',tacacsEnabled:false});assert.equal((await probe('pap')).unavailable,true);await put('settings',{defaultProfile:'server_ssh',tacacsEnabled:true});checked('disabled tenant has no AAA acceptance or fallback')
 const brokenDb=new Proxy(db,{get(target,key){if(key==='$transaction')return operation=>target.$transaction(tx=>operation(new Proxy(tx,{get(t,k){return k==='adminLog'?{create:async()=>{throw Error('audit failure')}}:Reflect.get(t,k)}})));return Reflect.get(target,key)}})
 await assert.rejects(new NetworkAccessService(brokenDb,ssh).saveSettings(tenant.id,user.id,{defaultProfile:'network_generic',tacacsEnabled:false}),/audit failure/)
 assert.equal((await service.settings(tenant.id)).tacacsEnabled,true);checked('audit failure rolls back administrative change')
 // Bounded waves stay within the pilot's per-source limit. Distinct task IDs
 // allow checking accounting loss/duplication against actual persisted rows.
 const concurrentStarted=performance.now()
 for(let wave=0;wave<8;wave++)await Promise.all(Array.from({length:4},async(_,i)=>{
   const allowed=(wave*4+i)%3!==0
   const result=await probe('authorize',{args:allowed?query.args:['service=shell','cmd=reload']})
   assert.equal(result.valid,allowed)
 }))
 checked('32 mixed authorizations in waves of four preserve individual outcomes')
 const accountingBefore=await db.networkTacacsEvent.count({where:{tenantId:tenant.id,kind:'accounting'}})
 for(let wave=0;wave<3;wave++)await Promise.all(Array.from({length:4},async(_,i)=>{
   assert.equal((await probe('accounting',{flags:[2,4,8][wave],args:[...query.args,'task_id=concurrent-'+(wave*4+i)]})).valid,true)
 }))
 const accountingAfter=await db.networkTacacsEvent.findMany({where:{tenantId:tenant.id,kind:'accounting'}})
 assert.equal(accountingAfter.length-accountingBefore,12)
 for(let i=0;i<12;i++)assert.equal(accountingAfter.filter(e=>JSON.parse(e.commandJson).arguments.includes('task_id=concurrent-'+i)).length,1)
 checked('12 concurrent accounting events persist exactly once per submitted task')
 const concurrencyMs=performance.now()-concurrentStarted
 await put('grants',{userId:user.id,hostId:host.id,commands:[]})
 assert.equal((await probe('authorize',query)).valid,false)
 assert.equal((await probe('authorize',{args:['service=shell','cmd=']})).valid,true)
 await put('grants',{userId:user.id,hostId:host.id,commands:[['show','version'],['show','interfaces']]})
 assert.equal((await probe('authorize',{args:['service=shell','cmd=show','cmd-arg=interfaces']})).valid,true)
 assert.equal((await probe('authorize',{args:['service=shell','cmd=show','cmd-arg=interfaces','cmd-arg=extra']})).valid,false)
 checked('grant removal preserves exec ACL and replacement permits only complete vectors')
 const rotatedPassword='disposable-aaa-password-rotated'
 await put('credentials',{userId:user.id,username:'alice',password:rotatedPassword,enabled:true})
 assert.equal((await probe('pap')).valid,false)
 assert.equal((await probe('pap',{password:rotatedPassword})).valid,true)
 await put('credentials',{userId:user.id,username:'alice',password:'disposable-aaa-password',enabled:true})
 checked('password rotation refuses the old password and accepts the new password')
 await db.user.update({where:{id:user.id},data:{lockedUntil:new Date(Date.now()+60000)}})
 assert.equal((await probe('authorize',query)).valid,false)
 await db.user.update({where:{id:user.id},data:{lockedUntil:null}})
 assert.equal((await probe('authorize',query)).valid,true)
 checked('locked user is denied and recovers after administrative unlock')
 const rotatedSecret=secret+'-rotated'
 await put('devices',{hostId:host.id,sourceIp:'127.0.0.1',secret:rotatedSecret,enabled:true})
 assert.equal((await probe('authorize',query)).unavailable,true)
 assert.equal((await probe('authorize',{...query,secret:rotatedSecret})).valid,true)
 await put('devices',{hostId:host.id,sourceIp:'127.0.0.1',secret,enabled:false})
 assert.equal((await probe('authorize',query)).unavailable,true)
 await put('devices',{hostId:host.id,sourceIp:'127.0.0.1',secret,enabled:true})
 assert.equal((await probe('authorize',query)).valid,true)
 checked('device key rotation and disable/enable are effective without listener restart')
 // Corrupt only the disposable tenant's policy, exercising real DB deserialization.
 await db.$executeRaw(Prisma.sql`UPDATE network_tacacs_grants SET commands_json=${'{invalid-json'} WHERE tenant_id=${tenant.id}`)
 assert.equal((await probe('authorize',query)).status,17)
 await put('grants',{userId:user.id,hostId:host.id,commands:[['show','version']]})
 assert.equal((await probe('authorize',query)).valid,true)
 checked('corrupted stored policy fails closed and recovers after replacement')
 let injectAuditFault=true
 const faultService=new Proxy(service,{get(target,key,receiver){
   if(key==='event'&&injectAuditFault)return async()=>{throw Error('Injected audit outage')}
   return Reflect.get(target,key,receiver)
 }})
 const faultRuntime=createTacacsServer(faultService)
 await new Promise(resolve=>faultRuntime.server.listen(0,'127.0.0.1',resolve))
 try{
   const port=faultRuntime.server.address().port
   const before=await db.networkTacacsEvent.count({where:{tenantId:tenant.id}})
   for(const [action,status] of [['pap',7],['authorize',17],['accounting',2]]){
     const result=await probe(action,{...query,port});assert.equal(result.valid,false);assert.equal(result.status,status)
   }
   assert.equal(await db.networkTacacsEvent.count({where:{tenantId:tenant.id}}),before)
   injectAuditFault=false
   for(const action of ['pap','authorize','accounting'])assert.equal((await probe(action,{...query,port})).valid,true)
   assert.equal(await db.networkTacacsEvent.count({where:{tenantId:tenant.id}}),before+3)
   checked('injected audit outage refuses all AAA acknowledgments and recovers with real persistence')
 }finally{await faultRuntime.close()}
 let emulation=null
 if(process.env.RUN_NETWORK_DEVICE_EMULATION==='true'){
   const {runDeviceEmulation}=await import('./device-emulator.mjs')
   emulation=await runDeviceEmulation({service,probe,primaryPort:Number(process.env.NETWORK_TACACS_EXTERNAL_PORT)||runtime.server.address().port,setCommands:commands=>put('grants',{userId:user.id,hostId:host.id,commands})})
   checked('emulated network CLI enforces AAA over real SSH, including failover and recovery')
 }
 let soak=null
 if(process.env.RUN_NETWORK_ACCESS_SOAK==='true'){
   const {runSoak}=await import('./soak.mjs');soak=await runSoak({service,probe});checked('sustained real database load, injected faults, timeouts and recovery')
 }
 let daemonHealth=null
 if(healthStore){
   const until=Date.now()+20000
   do{daemonHealth=(await api.inject({url:'/health',headers})).json();if(daemonHealth.status==='ready'&&daemonHealth.instances.some(i=>i.activity?.requests>0))break;await new Promise(r=>setTimeout(r,500))}while(Date.now()<until)
   assert.equal(daemonHealth.status,'ready');assert.ok(daemonHealth.instances.some(i=>i.activity?.requests>0))
   const foreign=await healthStore.read(foreignTenant.id);assert.ok(foreign.instances.every(i=>i.activity===null))
   checked('compiled daemon heartbeat reaches tenant-scoped administrator HTTP diagnostics')
 }
 const durations=[]
 for(let i=0;i<25;i++){const started=performance.now();const d=await service.device('127.0.0.1');assert.equal(await service.authorize(d,'alice',query.args),true);durations.push(performance.now()-started)}
 durations.sort((a,b)=>a-b);checked('25 actual database authorizations')
 const deviceId=(await service.overview(tenant.id)).devices[0].id
 await service.remove(tenant.id,user.id,'credentials',user.id)
 assert.equal((await probe('pap')).valid,false)
 await service.remove(tenant.id,user.id,'grants',host.id,user.id)
 await service.remove(tenant.id,user.id,'devices',deviceId)
 const events=await db.adminLog.findMany({where:{adminId:user.id}});assert.ok(events.some(e=>e.action==='NETWORK_REMOVED'));assert.ok(!JSON.stringify(events).includes(secret));checked('revocation and deletion retain redacted administrative audit')
 const report={ok:true,checks,emulation,soak,daemonHealth,concurrency:{authorizationRequests:32,accountingRequests:12,parallelClients:4,elapsedMs:concurrencyMs},authorizationMs:{p50:durations[12],p95:durations[23],max:durations[24]},protocolStats:process.env.NETWORK_TACACS_EXTERNAL_PORT?null:runtime.stats,externalDaemon:Boolean(process.env.NETWORK_TACACS_EXTERNAL_PORT),limits:'Local pilot only; vendor hardware and production load not certified'}
 writeFileSync(process.env.NETWORK_REPORT_PATH??'/tmp/nodeaccess-network-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report))
}finally{
 if(runtime.server.listening)await runtime.close();await api.close()
 if(tenant){for(const table of ['network_tacacs_events','network_tacacs_grants','network_tacacs_credentials','network_tacacs_devices','network_settings'])await db.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw(table)} WHERE tenant_id=${tenant.id}`);await db.resourceAclEntry.deleteMany({where:{tenantId:tenant.id}})}
 if(node)await db.inventoryNode.delete({where:{id:node.id}})
 if(host)await db.host.delete({where:{id:host.id}})
 if(user){await db.adminLog.deleteMany({where:{adminId:user.id}});await db.user.delete({where:{id:user.id}})}
 if(tenant)await db.tenant.delete({where:{id:tenant.id}})
 if(foreignUser)await db.user.delete({where:{id:foreignUser.id}})
 if(foreignTenant)await db.tenant.delete({where:{id:foreignTenant.id}})
 healthStore?.close()
 await db.$disconnect()
}
