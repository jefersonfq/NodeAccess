import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  CreateSharedSessionDto,
  DenySharedSessionControlDto,
  GrantSharedSessionControlDto,
  RevokeSharedSessionControlDto,
  RequestSharedSessionControlDto,
} from '@nodeaccess/shared'
import type { SharedSessionService } from './shared-session.service.js'

interface SharedSessionIdParam { id: string }
interface SharedSessionTokenParam { token: string }
interface SharedSessionControlTargetParam extends SharedSessionIdParam { userId: string }

export class SharedSessionController {
  constructor(private readonly service: SharedSessionService) {}

  async create(request: FastifyRequest<{ Body: CreateSharedSessionDto }>, reply: FastifyReply) {
    const { jwtUser } = request
    const data = await this.service.create(
      request.body,
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.status(201).send(data)
  }

  async getById(request: FastifyRequest<{ Params: SharedSessionIdParam }>, reply: FastifyReply) {
    const { jwtUser } = request
    const data = await this.service.getById(
      Number(request.params.id),
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.send(data)
  }

  async resolve(request: FastifyRequest<{ Params: SharedSessionTokenParam }>, reply: FastifyReply) {
    const { jwtUser } = request
    const data = await this.service.resolve(
      request.params.token,
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.send(data)
  }

  async revoke(request: FastifyRequest<{ Params: SharedSessionIdParam }>, reply: FastifyReply) {
    const { jwtUser } = request
    await this.service.revoke(
      Number(request.params.id),
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.status(204).send()
  }

  async requestControl(request: FastifyRequest<{ Params: SharedSessionIdParam; Body: RequestSharedSessionControlDto }>, reply: FastifyReply) {
    const { jwtUser } = request
    const data = await this.service.requestControl(
      Number(request.params.id),
      (request.body ?? {}) as RequestSharedSessionControlDto,
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.send(data)
  }

  async grantControl(request: FastifyRequest<{ Params: SharedSessionControlTargetParam; Body: GrantSharedSessionControlDto }>, reply: FastifyReply) {
    const { jwtUser } = request
    const data = await this.service.grantControl(
      Number(request.params.id),
      Number(request.params.userId),
      request.body,
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.send(data)
  }

  async denyControl(request: FastifyRequest<{ Params: SharedSessionControlTargetParam; Body: DenySharedSessionControlDto }>, reply: FastifyReply) {
    const { jwtUser } = request
    const data = await this.service.denyControl(
      Number(request.params.id),
      Number(request.params.userId),
      request.body,
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.send(data)
  }

  async revokeControl(request: FastifyRequest<{ Params: SharedSessionIdParam; Body: RevokeSharedSessionControlDto }>, reply: FastifyReply) {
    const { jwtUser } = request
    const data = await this.service.revokeControl(
      Number(request.params.id),
      request.body,
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.send(data)
  }
}
