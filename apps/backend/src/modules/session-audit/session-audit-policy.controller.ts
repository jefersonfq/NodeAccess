import type { FastifyReply, FastifyRequest } from 'fastify'
import type { UpdateSessionAuditPolicyDto } from '@nodeaccess/shared'
import type { SessionAuditPolicyService } from './session-audit-policy.service.js'

export class SessionAuditPolicyController {
  constructor(private readonly service: SessionAuditPolicyService) {}

  async get(request: FastifyRequest, reply: FastifyReply) {
    const result = await this.service.getPolicy(request.jwtUser!.tenantId)
    return reply.send(result)
  }

  async update(request: FastifyRequest<{ Body: UpdateSessionAuditPolicyDto }>, reply: FastifyReply) {
    const result = await this.service.updatePolicy(request.jwtUser!.tenantId, request.body)
    return reply.send(result)
  }
}
