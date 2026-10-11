/** Local test API: real audit routes/services/renderers with synthetic in-memory storage. */
import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import {randomUUID} from 'node:crypto'
import {writeFileSync} from 'node:fs'
import {operationalCorpus} from './operational-corpus.js'
import {SessionAuditService} from '../../apps/backend/src/modules/session-audit/session-audit.service.js'
import {SessionAuditController} from '../../apps/backend/src/modules/session-audit/session-audit.controller.js'
import {sessionAuditRoutes} from '../../apps/backend/src/modules/session-audit/session-audit.routes.js'
import type {SessionAuditRepository} from '../../apps/backend/src/modules/session-audit/session-audit.repository.js'
import type {SessionAuditStorage} from '../../apps/backend/src/modules/session-audit/session-audit.storage.js'
const corpus=operationalCorpus(),app=Fastify()
const repo={
  findBySessionId:(tenant:number,id:number)=>{
    const scenario=corpus.find(s=>s.id===id)
    return Promise.resolve(tenant===1&&scenario?{sessionId:id,tenantId:1,userId:1,userNameSnapshot:'Audit Lab',userEmailSnapshot:'audit@example.test',hostId:9,hostNameSnapshot:scenario.name,hostIpSnapshot:'192.0.2.10',hostDeleted:false,connectionMethod:'direct',routeSnapshotJson:null,clientIp:'127.0.0.1',userAgent:'synthetic-corpus',agentRemoteIp:null,ticketProvider:null,ticketKey:null,ticketUrl:null,startedAt:'2026-09-29T12:00:00Z',endedAt:'2026-09-29T13:00:00Z',status:'COMPLETED',chunkCount:1,commandCount:scenario.expected.length,bytesIn:scenario.content.length,bytesOut:scenario.content.length,aiSummaryStatus:'NOT_REQUESTED',aiSummaryText:null,aiRiskLevel:null,aiSummaryJson:null}:null)
  },
  listChunks:(id:number)=>Promise.resolve([{seq:1,storageKey:String(id)}]),
}
const storage={readChunk:(key:string)=>Promise.resolve(corpus.find(s=>s.id===Number(key))!.content)}
const service=new SessionAuditService(repo as unknown as SessionAuditRepository,storage as SessionAuditStorage)
await app.register(jwt,{secret:randomUUID()})
app.setErrorHandler((error,_request,reply)=>reply.code(error.statusCode??500).send({message:error.message}))
await app.register(instance=>sessionAuditRoutes(instance,new SessionAuditController(service)),{prefix:'/api/v1/session-audit'})
const token=app.jwt.sign({sub:'1',tenantId:1,role:'admin',stage:'authenticated'},{expiresIn:'1h'})
await app.listen({host:'127.0.0.1',port:3191})
writeFileSync('/tmp/nodeaccess-operational-api.json',JSON.stringify({base:'http://127.0.0.1:3191',token,scenarios:corpus.map(({content,...scenario})=>scenario)}),{mode:0o600})
console.log('Operational audit test API ready on 127.0.0.1:3191 (synthetic storage only)')
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void app.close().then(()=>process.exit(0))})
