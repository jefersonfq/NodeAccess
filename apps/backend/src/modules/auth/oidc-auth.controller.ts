import type { FastifyReply, FastifyRequest } from 'fastify'
import type { OidcAuthService } from './oidc-auth.service.js'
import { tenantSlug } from './auth.controller.js'

export class OidcAuthController {
  constructor(private readonly service: OidcAuthService) {}

  async config(request: FastifyRequest<{ Querystring: { tenantSlug?: string } }>, reply: FastifyReply) {
    return reply.send(await this.service.getPublicConfig(tenantSlug(request)))
  }

  async begin(request: FastifyRequest<{ Body: { tenantSlug?: string } }>, reply: FastifyReply) {
    return reply.send(await this.service.begin(tenantSlug(request)))
  }

  async complete(request: FastifyRequest<{ Body: { state: string; code: string } }>, reply: FastifyReply) {
    return reply.send(await this.service.complete(request.body.state, request.body.code))
  }
}
