import type { FastifyReply, FastifyRequest } from 'fastify'
import type { CreateSecretDto, RotateSecretDto, UpdateSecretDto } from '@nodeaccess/shared'
import type { SecretService } from './secret.service.js'

interface IdParam {
  id: string
}

interface ListQuery {
  includeRevoked?: string
}

function userRole(request: FastifyRequest): 'admin' | 'user' {
  return request.jwtUser!.role === 'admin' ? 'admin' : 'user'
}

export class SecretController {
  constructor(private readonly service: SecretService) {}

  async list(request: FastifyRequest<{ Querystring: ListQuery }>, reply: FastifyReply) {
    const user = request.jwtUser!
    const includeRevoked = request.query.includeRevoked === 'true'
    const secrets = await this.service.list(Number(user.sub), user.tenantId, userRole(request), includeRevoked)
    return reply
      .header('Cache-Control', 'no-store')
      .send(secrets)
  }

  async create(request: FastifyRequest<{ Body: CreateSecretDto }>, reply: FastifyReply) {
    const user = request.jwtUser!
    const secret = await this.service.create(Number(user.sub), user.tenantId, userRole(request), request.body)
    return reply
      .header('Cache-Control', 'no-store')
      .status(201)
      .send(secret)
  }

  async update(request: FastifyRequest<{ Params: IdParam; Body: UpdateSecretDto }>, reply: FastifyReply) {
    const user = request.jwtUser!
    const secret = await this.service.update(
      Number(request.params.id),
      Number(user.sub),
      user.tenantId,
      userRole(request),
      request.body,
    )
    return reply.header('Cache-Control', 'no-store').send(secret)
  }

  async rotate(request: FastifyRequest<{ Params: IdParam; Body: RotateSecretDto }>, reply: FastifyReply) {
    const user = request.jwtUser!
    const secret = await this.service.rotate(
      Number(request.params.id),
      Number(user.sub),
      user.tenantId,
      userRole(request),
      request.body,
    )
    return reply.header('Cache-Control', 'no-store').send(secret)
  }

  async revoke(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const user = request.jwtUser!
    const secret = await this.service.revoke(
      Number(request.params.id),
      Number(user.sub),
      user.tenantId,
      userRole(request),
    )
    return reply.header('Cache-Control', 'no-store').send(secret)
  }

  async delete(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const user = request.jwtUser!
    await this.service.delete(
      Number(request.params.id),
      Number(user.sub),
      user.tenantId,
      userRole(request),
    )
    return reply.header('Cache-Control', 'no-store').status(204).send()
  }
}
