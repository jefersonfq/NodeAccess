import type { FastifyReply, FastifyRequest } from 'fastify'
import type { TenantAuthPolicyDto, ValidateBreakGlassDto } from '@nodeaccess/shared'
import type { TenantAuthPolicyService } from './tenant-auth-policy.service.js'

export class TenantAuthPolicyController {
  constructor(private readonly service: TenantAuthPolicyService) {}

  async get(request: FastifyRequest, reply: FastifyReply) {
    return reply.send(await this.service.get(request.jwtUser!.tenantId))
  }

  async update(request: FastifyRequest<{ Body: TenantAuthPolicyDto }>, reply: FastifyReply) {
    return reply.send(await this.service.update(
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
      request.body,
    ))
  }

  async getBreakGlass(request: FastifyRequest, reply: FastifyReply) {
    return reply.send(await this.service.getBreakGlass(request.jwtUser!.tenantId))
  }

  async validateBreakGlass(request: FastifyRequest<{ Body: ValidateBreakGlassDto }>, reply: FastifyReply) {
    return reply.send(await this.service.validateBreakGlass(
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
      request.body.email,
      request.body.password,
    ))
  }
}
