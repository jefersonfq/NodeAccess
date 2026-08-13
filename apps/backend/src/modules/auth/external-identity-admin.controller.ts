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

  async listLinkRequests(request: FastifyRequest, reply: FastifyReply) {
    return reply.send(await this.service.listLinkRequests(request.jwtUser!.tenantId))
  }

  async reviewLinkRequest(
    request: FastifyRequest<{ Params: { id: number }; Body: { decision: 'approve' | 'reject' } }>,
    reply: FastifyReply,
  ) {
    const user = request.jwtUser!
    return reply.send(await this.service.reviewLinkRequest(
      request.params.id,
      user.tenantId,
      Number(user.sub),
      request.body.decision === 'approve',
    ))
  }
}
