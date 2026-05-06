import type { FastifyRequest, FastifyReply } from 'fastify'
import type { EmailConfigService, EmailConfigInput } from './email-config.service.js'

export class EmailConfigController {
  constructor(private readonly service: EmailConfigService) {}

  async get(request: FastifyRequest, reply: FastifyReply) {
    const user = request.jwtUser!
    const config = await this.service.get(user.tenantId)
    return reply.send(config ?? null)
  }

  async upsert(request: FastifyRequest<{ Body: EmailConfigInput }>, reply: FastifyReply) {
    const user = request.jwtUser!
    const result = await this.service.upsert(user.tenantId, request.body)
    return reply.send(result)
  }

  async test(request: FastifyRequest<{ Body: { email?: string } }>, reply: FastifyReply) {
    const user = request.jwtUser!
    const toEmail = request.body?.email ?? user.email
    await this.service.test(user.tenantId, toEmail)
    return reply.status(204).send()
  }

  async testCredentials(
    request: FastifyRequest<{ Body: import('./email-config.service.js').EmailConfigInput & { email?: string } }>,
    reply: FastifyReply,
  ) {
    const user = request.jwtUser!
    const { email, ...config } = request.body
    await this.service.testCredentials(config, email ?? user.email)
    return reply.status(204).send()
  }

  async delete(request: FastifyRequest, reply: FastifyReply) {
    const user = request.jwtUser!
    await this.service.delete(user.tenantId)
    return reply.status(204).send()
  }
}
