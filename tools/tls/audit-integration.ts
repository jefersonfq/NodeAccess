// Opt-in disposable MySQL: never uses DATABASE_URL from the developer or production environment.
import {execFileSync} from 'node:child_process'
import {randomBytes,randomUUID} from 'node:crypto'
import {readFileSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {PrismaClient} from '@prisma/client'
import {TlsMonitor} from '../../apps/backend/src/modules/tls/tls.monitor.js'
const name='na-tls-audit-'+randomBytes(4).toString('hex'),password=randomBytes(24).toString('hex')
const docker=(...args:string[])=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()
let db:PrismaClient|undefined
async function main(){
 docker('run','-d','--name',name,'-e','MYSQL_ROOT_PASSWORD='+password,'-e','MYSQL_DATABASE=tls_test','--tmpfs','/var/lib/mysql','-p','127.0.0.1::3306','mysql:8.0')
 const port=docker('port',name,'3306/tcp').split(':').pop()
 db=new PrismaClient({datasources:{db:{url:`mysql://root:${password}@127.0.0.1:${port}/tls_test`}}})
 let connected=false
 for(let i=0;i<90;i++){try{await db.$queryRaw`SELECT 1`;connected=true;break}catch{await new Promise(resolve=>setTimeout(resolve,1000))}}
 assert.ok(connected,'Disposable MySQL did not become ready')
 const migration=readFileSync('apps/backend/prisma/migrations/20260926000100_tls_audit_events/migration.sql','utf8')
 await db.$executeRawUnsafe(migration)
 const event={id:randomUUID(),type:'operation.completed',domain:'tls.example.test',occurredAt:new Date().toISOString(),data:{actor:'scheduler',requestId:randomUUID(),action:'renew',status:'succeeded'}}
 let acknowledgements=0,loseAck=true
 const client={request:async(_method:string,path:string)=>{
  if(path==='/status')return {alerts:[]}
  if(path==='/events')return {events:[event]}
  if(path==='/events/ack'){acknowledgements++;if(loseAck)throw Error('Lost acknowledgement');return {ok:true}}
  throw Error('Unexpected route')
 }}
 const first=new TlsMonitor(db,client,true);await first.poll()
 assert.equal(await db.tlsAuditEvent.count(),1)
 assert.equal(first.status().alerts[0].code,'TLS_AUDIT_PENDING')
 // A second API process/restart replays the same event: unique PK prevents duplicates.
 loseAck=false;const second=new TlsMonitor(db,client,true)
 await Promise.all([first.poll(),second.poll()])
 assert.equal(await db.tlsAuditEvent.count(),1)
 const row=await db.tlsAuditEvent.findUniqueOrThrow({where:{id:event.id}})
 assert.equal(row.actor,'scheduler');assert.equal((row.details as any).requestId,event.data.requestId)
 assert.ok(acknowledgements>=3)
 await first.stop();await second.stop()
 const report={passed:true,realMySqlMigration:true,lostAcknowledgement:true,concurrentCollectors:true,noDuplicateEvents:true,systemActorPreserved:true}
 writeFileSync('/tmp/nodeaccess-tls-audit-integration.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
}
main().catch(()=>{console.error('TLS audit integration failed. Disposable database or assertion unavailable.');process.exitCode=1}).finally(async()=>{await db?.$disconnect();try{docker('rm','-f','-v',name)}catch{}})
