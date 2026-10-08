/** Disposable database only. Validates the real migration, transactional writes and search index. */
import {PrismaClient,Prisma} from '@prisma/client'
import {readFileSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {SessionAuditReconstructionRepository} from '../../apps/backend/src/modules/session-audit/session-audit-reconstruction.repository.js'
import {reconstructAudit} from '../../apps/backend/src/modules/session-audit/session-audit-reconstruction.js'
const url='mysql://root@127.0.0.1:13319/audit_reconstruction_test'
const db=new PrismaClient({datasources:{db:{url}}})
async function main(){
 // This URL is deliberately fixed to the disposable test container above.
 await db.$executeRawUnsafe('DROP TABLE IF EXISTS session_audit_derived_commands')
 await db.$executeRawUnsafe('DROP TABLE IF EXISTS session_audit_reconstructions')
 await db.$executeRawUnsafe('DROP TABLE IF EXISTS session_audits')
 await db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS session_audits (session_id INT NOT NULL PRIMARY KEY,tenant_id INT NOT NULL,status VARCHAR(16) NOT NULL)')
 for(const sql of readFileSync('apps/backend/prisma/migrations/20260929000000_audit_reconstruction/migration.sql','utf8').split(';').filter(s=>s.trim()))await db.$executeRawUnsafe(sql)
 await db.$executeRaw`INSERT INTO session_audits VALUES (42,1,'COMPLETED'),(43,2,'COMPLETED'),(44,1,'COMPLETED')`
 const repo=new SessionAuditReconstructionRepository(db)
 const source=(text:string)=>[{seq:1,content:[{seq:1,type:'session_started'},{seq:2,type:'stdin',data:text+'\r'},{seq:3,type:'stdout',data:'ok\r\n'},{seq:4,type:'session_ended'}].map(e=>JSON.stringify({seq:e.seq,ts:'2026-09-29T12:00:00Z',type:e.type,payload:{data:e.data??'',actorUserId:9}})).join('\n')}]
 const first=reconstructAudit(source('SELECT customer_report FROM reports;'),'COMPLETED',1)
 await Promise.all(Array.from({length:4},()=>repo.save(1,42,first)))
 assert.equal((await repo.history(1,42)).length,1)
 assert.equal((await repo.commands(1,42,first.metadata.id))?.[0]?.command,'SELECT customer_report FROM reports;')
 assert.equal(await repo.commands(2,42,first.metadata.id),null)
 assert.deepEqual(await repo.history(2,42),[])
 const next=reconstructAudit(source('SELECT monthly_report FROM reports;'),'COMPLETED',1)
 await repo.save(1,42,next)
 assert.equal((await repo.history(1,42)).length,2)
 assert.equal((await repo.commands(1,42,first.metadata.id))?.[0]?.command,first.commands[0]?.command)
 const other=reconstructAudit(source('SELECT monthly_report FROM tenant_two;'),'COMPLETED',1)
 await repo.save(2,43,other)
 const matches=await db.$queryRaw<Array<{run_id:string}>>(Prisma.sql`SELECT run_id FROM session_audit_derived_commands WHERE tenant_id=1 AND MATCH(command_text) AGAINST (${'monthly_report'} IN NATURAL LANGUAGE MODE)`)
 assert.equal(matches.length,1)
 const plan=await db.$queryRaw<Array<{type?:string;key?:string;f4?:string;f6?:string}>>(Prisma.sql`EXPLAIN FORMAT=TRADITIONAL SELECT run_id FROM session_audit_derived_commands WHERE tenant_id=1 AND MATCH(command_text) AGAINST (${'monthly_report'} IN NATURAL LANGUAGE MODE)`)
 assert.equal(plan[0]?.type ?? plan[0]?.f4,'fulltext')
 const broken=reconstructAudit(source('echo transaction'),'COMPLETED',1)
 broken.commands.push({...broken.commands[0]!})
 await assert.rejects(()=>repo.save(1,44,broken))
 assert.equal((await repo.history(1,44)).length,0)
 await db.$executeRaw`UPDATE session_audits SET status='PURGED' WHERE session_id=42`
 assert.equal(await repo.commands(1,42,first.metadata.id),null)
 await db.$executeRaw`DELETE FROM session_audits WHERE session_id=42`
 const remaining=await db.$queryRaw<Array<{n:bigint}>>`SELECT COUNT(*) AS n FROM session_audit_derived_commands WHERE tenant_id=1`
 assert.equal(Number(remaining[0]?.n),0)
 assert.equal((await repo.history(2,43)).length,1)
 const result={ok:true,concurrentIdempotency:true,tenantIsolation:true,preservedVersions:true,transactionRollback:true,purgedAccessDenied:true,cascadeCleanup:true,fulltextIndex:plan[0]?.key ?? plan[0]?.f6}
 writeFileSync('/tmp/nodeaccess-audit-reconstruction-mysql.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result))
}
main().finally(()=>db.$disconnect()).catch(e=>{console.error(e);process.exitCode=1})
