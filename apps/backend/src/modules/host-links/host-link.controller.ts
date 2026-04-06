import type { FastifyReply, FastifyRequest } from 'fastify'
import type { CreateHostLinkDto } from '@nodeaccess/shared'
import type { HostLinkService } from './host-link.service.js'

interface HostLinkIdParam { id: string }
interface HostLinkTokenParam { token: string }

export class HostLinkController {
  constructor(private readonly service: HostLinkService) {}

  async create(request: FastifyRequest<{ Body: CreateHostLinkDto }>, reply: FastifyReply) {
    const { jwtUser } = request
    const data = await this.service.create(
      request.body,
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.status(201).send(data)
  }

  async resolve(request: FastifyRequest<{ Params: HostLinkTokenParam }>, reply: FastifyReply) {
    const { jwtUser } = request
    const data = await this.service.resolve(
      request.params.token,
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.send(data)
  }

  async revoke(request: FastifyRequest<{ Params: HostLinkIdParam }>, reply: FastifyReply) {
    const { jwtUser } = request
    await this.service.revoke(
      Number(request.params.id),
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.status(204).send()
  }
}
