import type { FastifyRequest, FastifyReply } from 'fastify'
import type { CreateHostDto, TestConnectionDto, TrustHostKeyDto } from '@nodeaccess/shared'
import type { HostService } from './host.service.js'
import type { TestConnectionService } from './test-connection.service.js'
import type { HostFilters } from './host.repository.js'

interface IdParam   { id: string }
interface HostQuery { page?: number; limit?: number; search?: string; scope?: string; groupId?: number }

export class HostController {
  constructor(
    private readonly hostService: HostService,
    private readonly testConnectionService: TestConnectionService,
  ) {}

  async list(request: FastifyRequest<{ Querystring: HostQuery }>, reply: FastifyReply) {
    const { jwtUser } = request
    const filters = {
      ...(request.query.page !== undefined ? { page: request.query.page } : {}),
      ...(request.query.limit !== undefined ? { limit: request.query.limit } : {}),
      ...(request.query.search !== undefined ? { search: request.query.search } : {}),
      ...(request.query.scope !== undefined ? { scope: request.query.scope as HostFilters['scope'] } : {}),
      ...(request.query.groupId !== undefined ? { groupId: request.query.groupId } : {}),
    } as HostFilters
    const result = await this.hostService.list(
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
      filters,
    )
    return reply.send(result)
  }

  async getById(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const { jwtUser } = request
    const host = await this.hostService.getById(
      Number(request.params.id),
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.send(host)
  }

  async create(request: FastifyRequest<{ Body: CreateHostDto }>, reply: FastifyReply) {
    const { jwtUser } = request
    const host = await this.hostService.create(request.body, jwtUser!.tenantId, Number(jwtUser!.sub))
    return reply.status(201).send(host)
  }

  async update(request: FastifyRequest<{ Params: IdParam; Body: Partial<CreateHostDto> }>, reply: FastifyReply) {
    const { jwtUser } = request
    const host = await this.hostService.update(
      Number(request.params.id),
      request.body,
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.send(host)
  }

  async delete(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const { jwtUser } = request
    await this.hostService.delete(
      Number(request.params.id),
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.status(204).send()
  }

  async trustHostKey(request: FastifyRequest<{ Params: IdParam; Body: TrustHostKeyDto }>, reply: FastifyReply) {
    const { jwtUser } = request
    const host = await this.hostService.trustHostKey(
      Number(request.params.id),
      request.body,
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
      !!jwtUser!.canManageHosts,
    )
    return reply.send(host)
  }

  async listHostKeyHistory(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const { jwtUser } = request
    const history = await this.hostService.listHostKeyHistory(
      Number(request.params.id),
      jwtUser!.tenantId,
      Number(jwtUser!.sub),
      jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.send(history)
  }

  async testConnection(request: FastifyRequest<{ Body: TestConnectionDto }>, reply: FastifyReply) {
    const result = await this.testConnectionService.test(
      request.body,
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
    )
    return reply.send(result)
  }
}
