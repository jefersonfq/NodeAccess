import type { FastifyReply, FastifyRequest } from 'fastify'
import type { RotateOidcClientSecretDto, UpsertOidcDto } from '@nodeaccess/shared'
import type { OidcConfigService } from './oidc-config.service.js'

export class OidcConfigController {
  constructor(private readonly service: OidcConfigService) {}

  async get(request: FastifyRequest, reply: FastifyReply) {
    return reply.send(await this.service.getPublic(request.jwtUser!.tenantId))
  }

  async update(request: FastifyRequest<{ Body: UpsertOidcDto }>, reply: FastifyReply) {
    return reply.send(await this.service.upsert(
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
      request.body,
    ))
  }

  async testDiscovery(request: FastifyRequest<{ Body: { issuer: string } }>, reply: FastifyReply) {
    return reply.send(await this.service.testDiscovery(request.jwtUser!.tenantId, request.body.issuer))
  }

  async rotateClientSecret(request: FastifyRequest<{ Body: RotateOidcClientSecretDto }>, reply: FastifyReply) {
    return reply.send(await this.service.rotateClientSecret(
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
      request.body.clientSecret,
    ))
  }
}
