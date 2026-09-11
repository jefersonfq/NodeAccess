import type { FastifyInstance } from 'fastify'
import { requireAdmin, requireAuth } from '../../shared/guards.js'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { z } from 'zod'
import { DEVICE_PROFILES } from '@nodeaccess/shared'
import { CredentialSchema, DeviceSchema, GrantSchema, NetworkSettingsSchema, type NetworkAccessService } from './network-access.service.js'

export async function networkAccessRoutes(app:FastifyInstance, service:NetworkAccessService) {
  app.get('/health',{preHandler:requireAdmin},async request=>service.health(request.jwtUser!.tenantId))
  app.get('/profiles',{preHandler:requireAuth},async request=>({profiles:DEVICE_PROFILES,...await service.settings(request.jwtUser!.tenantId)}))
  app.get('/',{preHandler:requireAdmin},async request=>service.overview(request.jwtUser!.tenantId))
  for(const [path,schema,save] of [
    ['settings',NetworkSettingsSchema,service.saveSettings.bind(service)],
    ['devices',DeviceSchema,service.saveDevice.bind(service)],
    ['credentials',CredentialSchema,service.saveCredential.bind(service)],
    ['grants',GrantSchema,service.saveGrant.bind(service)],
  ] as const) {
    app.put(`/${path}`,{preHandler:requireAdmin,schema:{body:zodToJsonSchema(schema)}},async(request,reply)=>{
      await save(request.jwtUser!.tenantId,Number(request.jwtUser!.sub),request.body)
      return reply.code(204).send()
    })
  }
  app.delete<{Params:{kind:'devices'|'credentials'|'grants';id:number};Querystring:{userId?:number}}>('/:kind/:id',{
    preHandler:requireAdmin,
    schema:{params:zodToJsonSchema(z.object({kind:z.enum(['devices','credentials','grants']),id:z.coerce.number().int().positive()})),querystring:zodToJsonSchema(z.object({userId:z.coerce.number().int().positive().optional()}))},
  },async(request,reply)=>{
    await service.remove(request.jwtUser!.tenantId,Number(request.jwtUser!.sub),request.params.kind,request.params.id,request.query.userId)
    return reply.code(204).send()
  })
}
