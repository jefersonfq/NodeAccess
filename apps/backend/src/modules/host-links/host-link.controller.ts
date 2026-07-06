import type { FastifyReply, FastifyRequest } from 'fastify'
import { ResolvePublicHostLinkSchema, type CreateHostLinkDto, type ResolvePublicHostLinkDto } from '@nodeaccess/shared'
import type { HostLinkService } from './host-link.service.js'

interface HostLinkIdParam { id: string }
interface HostLinkTokenParam { token: string }
interface HostLinkListQuery { hostId?: number }
interface HostLinkPublicResolveRequest {
  Params: HostLinkTokenParam
  Body: ResolvePublicHostLinkDto
}

export class HostLinkController {
  constructor(private readonly service: HostLinkService) {}

  async create(request: FastifyRequest<{ Body: CreateHostLinkDto }>, reply: FastifyReply) {
    const { jwtUser } = request
    const data = await this.service.create(
      request.body,
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
      jwtUser!.canManageHosts,
    )
    return reply.status(201).send(data)
  }

  async options(request: FastifyRequest, reply: FastifyReply) {
    const data = await this.service.getOptions(request.jwtUser!.tenantId)
    return reply.send(data)
  }

  async list(request: FastifyRequest<{ Querystring: HostLinkListQuery }>, reply: FastifyReply) {
    const { jwtUser } = request
    if (!request.query.hostId) {
      const data = await this.service.listTemporary(
        jwtUser!.tenantId,
        Number(jwtUser!.sub),
        jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
        jwtUser!.canManageHosts,
      )
      return reply.send(data)
    }
    const data = await this.service.listForHost(
      Number(request.query.hostId),
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
      jwtUser!.canManageHosts,
    )
    return reply.send(data)
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

  async publicInfo(request: FastifyRequest<{ Params: HostLinkTokenParam }>, reply: FastifyReply) {
    const data = await this.service.getPublicInfo(request.params.token)
    return reply.send(data)
  }

  async resolvePublic(request: FastifyRequest<HostLinkPublicResolveRequest>, reply: FastifyReply) {
    const body = ResolvePublicHostLinkSchema.parse(request.body)
    const data = await this.service.resolvePublic(
      request.params.token,
      body.guestName,
      body.pin,
      {
        clientIp: request.ip,
        userAgent: Array.isArray(request.headers['user-agent'])
          ? request.headers['user-agent'][0]
          : request.headers['user-agent'],
      },
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
