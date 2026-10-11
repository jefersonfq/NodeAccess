/** End-to-end API review of a local recording. Creates only its derived version. */
import {PrismaClient} from '@prisma/client'
import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import assert from 'node:assert/strict'
import {writeFileSync} from 'node:fs'
import {SessionAuditRepository} from '../../apps/backend/src/modules/session-audit/session-audit.repository.js'
import {SessionAuditStorage} from '../../apps/backend/src/modules/session-audit/session-audit.storage.js'
import {SessionAuditReconstructionRepository} from '../../apps/backend/src/modules/session-audit/session-audit-reconstruction.repository.js'
import {SessionAuditService} from '../../apps/backend/src/modules/session-audit/session-audit.service.js'
import {SessionAuditController} from '../../apps/backend/src/modules/session-audit/session-audit.controller.js'
import {sessionAuditRoutes} from '../../apps/backend/src/modules/session-audit/session-audit.routes.js'
const db=new PrismaClient(),app=Fastify()
async function main(){
 assert.ok(['localhost','127.0.0.1'].includes(new URL(process.env.DATABASE_URL!).hostname),'Local database required')
 const id=Number(process.env.AUDIT_REVIEW_SESSION_ID??4177),tenant=Number(process.env.AUDIT_REVIEW_TENANT_ID??1)
 const repo=new SessionAuditRepository(db),store=new SessionAuditReconstructionRepository(db)
 assert.equal((await repo.findBySessionId(tenant,id))?.status,'COMPLETED')
 const service=new SessionAuditService(repo,new SessionAuditStorage(),undefined,undefined,undefined,undefined,store)
 await app.register(jwt,{secret:'disposable-local-audit-review-token-only'})
 app.setErrorHandler((error,_req,reply)=>reply.code(error.statusCode??500).send({message:error.message}))
 await app.register(instance=>sessionAuditRoutes(instance,new SessionAuditController(service)),{prefix:'/session-audit'})
 const headers={authorization:`Bearer ${app.jwt.sign({sub:'1',tenantId:tenant,role:'admin',stage:'authenticated'})}`}
 const call=(path:string,method:'GET'|'POST'='GET')=>app.inject({url:`/session-audit/${id}/${path}`,method,headers})
 const reconstruction=await call('reconstruction','POST');assert.equal(reconstruction.statusCode,200)
 const metadata=reconstruction.json();assert.equal(metadata.state,'complete');assert.equal(metadata.persisted,true)
 const responses=await Promise.all(['commands','command-stats','transcript?format=technical','reconstructions'].map(path=>call(path)))
 for(const response of responses)assert.equal(response.statusCode,200)
 const [commands,stats,txt,history]=responses
 assert.equal(commands!.json().length,stats!.json().total);assert.equal(metadata.commandCount,commands!.json().length)
 assert.ok(txt!.body.includes('stdin'));assert.ok(txt!.body.includes('stdout'));assert.ok(txt!.body.includes('htop'))
 const readable=await call('transcript');assert.equal(readable.statusCode,200);assert.ok(!readable.body.includes('EVENTOS VÁLIDOS'))
 const commandsTxt=await call('transcript?format=commands');assert.equal(commandsTxt.statusCode,200);assert.ok(commandsTxt.body.includes('htop'))
 assert.equal((await call('reconstruction','POST')).json().id,metadata.id)
 assert.equal((await call('reconstructions')).json().length,history!.json().length)
 const comparison=await call(`reconstructions/${metadata.id}/compare`);assert.equal(comparison.statusCode,200);assert.equal(comparison.json().modified,0)
 const result={ok:true,sessionId:id,tenantId:tenant,commands:metadata.commandCount,events:metadata.eventCount,version:metadata.processorVersion,persisted:true,integrity:metadata.state,txtBytes:Buffer.byteLength(txt!.body),readableBytes:Buffer.byteLength(readable.body),threeFormats:true,idempotentReprocess:true,compare:true}
 writeFileSync('/tmp/nodeaccess-audit-reconstruction-local.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result))
}
main().finally(async()=>{await app.close();await db.$disconnect()}).catch(e=>{console.error(e);process.exitCode=1})
