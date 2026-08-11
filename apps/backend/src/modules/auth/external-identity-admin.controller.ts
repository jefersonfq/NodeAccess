import type { FastifyReply, FastifyRequest } from 'fastify'
import type { ExternalIdentityAdminService } from './external-identity-admin.service.js'

export class ExternalIdentityAdminController {
  constructor(private readonly service: ExternalIdentityAdminService) {}

  async list(request: FastifyRequest, reply: FastifyReply) {
    return reply.send(await this.service.list(request.jwtUser!.tenantId))
  }

  async revoke(
    request: FastifyRequest<{ Params: { id: number } }>,
    reply: FastifyReply,
  ) {
    const user = request.jwtUser!
    const result = await this.service.revoke(request.params.id, user.tenantId, Number(user.sub))
    return reply.send(result)
  }
}
