import { CreateOidcGroupMappingSchema } from '@nodeaccess/shared'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { OidcGroupMappingService } from './oidc-group-mapping.service.js'

export class OidcGroupMappingController {
  constructor(private readonly service: OidcGroupMappingService) {}
  async list(request: FastifyRequest, reply: FastifyReply) { return reply.send(await this.service.list(request.jwtUser!.tenantId)) }
  async create(request: FastifyRequest, reply: FastifyReply) {
    const body = CreateOidcGroupMappingSchema.parse(request.body)
    const user = request.jwtUser!
    return reply.code(201).send(await this.service.create({ ...body, tenantId: user.tenantId, adminId: Number(user.sub) }))
  }
  async delete(request: FastifyRequest<{ Params: { id: number } }>, reply: FastifyReply) {
    const user = request.jwtUser!
    await this.service.delete(user.tenantId, Number(user.sub), request.params.id)
    return reply.code(204).send()
  }
}
