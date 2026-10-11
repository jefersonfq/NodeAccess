import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { requirePlatformAdmin } from '../../shared/guards.js'
import { BadRequestError, ForbiddenError } from '../../shared/errors.js'
import { TlsMonitor } from './tls.monitor.js'
import { TlsClient, type TlsTransport } from './tls.client.js'
export function tlsRoutes(app:FastifyInstance,deps:{db:PrismaClient;client?:TlsTransport}):Promise<void> {
  const client=deps.client||new TlsClient()
  const monitor=new TlsMonitor(deps.db,client,!!process.env.TLS_CONTROL_SOCKET)
  app.addHook('onReady', (done) => { monitor.start(); done() })
  app.addHook('onClose',async()=>await monitor.stop())
  const guard=async(request:Parameters<typeof requirePlatformAdmin>[0],reply:Parameters<typeof requirePlatformAdmin>[1]): Promise<void>=>{
    await requirePlatformAdmin(request,reply)
    if(request.jwtUser?.actingTenantId)throw new ForbiddenError('Retorne ao contexto da plataforma para administrar certificados.')
  }
  app.get('/alerts',{preHandler:[guard]},async(_request,reply)=>{reply.header('Cache-Control','no-store');return monitor.status()})
  app.get('/audit',{preHandler:[guard]},async(_request,reply)=>{reply.header('Cache-Control','no-store');return deps.db.tlsAuditEvent.findMany({orderBy:{occurredAt:'desc'},take:100})})
  app.get<{Params:{id:string}}>('/operations/:id',{preHandler:[guard]},async(request,reply)=>{
    if(!/^[0-9a-f-]{36}$/i.test(request.params.id))throw new BadRequestError('Identificador inválido.')
    reply.header('Cache-Control','no-store');return client.request('GET','/operations/'+request.params.id,undefined,`user:${request.jwtUser!.sub}`)
  })
  app.get('/status',{preHandler:[guard]},async(_request,reply)=>{reply.header('Cache-Control','no-store');return client.request('GET','/status')})
  app.post<{Body:Record<string,unknown>}>('/operations',{bodyLimit:150000,preHandler:[guard]},async(request,reply)=>{
    const body=request.body
    const fields=['action','certificate','privateKey','candidateId','requestId','email','agreeTerms','expectedFingerprint']
    if(!body||typeof body!=='object'||Object.keys(body).some(k=>!fields.includes(k))||!['check','simulate','validate','apply','automatic','renew','external','pause'].includes(String(body.action)))throw new BadRequestError('Operação de certificados inválida.')
    if(typeof body.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId))throw new BadRequestError('Identificador de operação obrigatório.')
    // Audit intent before dispatch; never log uploaded PEM, keys or the raw request.
    await deps.db.adminLog.create({data:{adminId:Number(request.jwtUser!.sub),action:'TLS_OPERATION_REQUESTED',targetType:'platform_tls',targetId:0,details:JSON.stringify({operation:body.action,requestId:body.requestId})}})
    const job=await client.request('POST','/operations',body,`user:${request.jwtUser!.sub}`)
    reply.code(202).header('Cache-Control','no-store');return job
  })

  return Promise.resolve()
}
