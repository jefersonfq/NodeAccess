import type { FastifyRequest, FastifyReply } from 'fastify'
import type { CreateGroupDto, UpdateGroupDto } from '@nodeaccess/shared'
import type { GroupService } from './group.service.js'

interface IdParam { id: string }
export interface GroupListQuery {
  page?: number
  limit?: number
  search?: string
}

export class GroupController {
  constructor(private readonly groupService: GroupService) {}

  async list(request: FastifyRequest, reply: FastifyReply) {
    const user = request.jwtUser!
    const groups = await this.groupService.list(
      user.tenantId,
      Number(user.sub),
      user.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.send(groups)
  }

  async listPaginated(request: FastifyRequest<{ Querystring: GroupListQuery }>, reply: FastifyReply) {
    const user = request.jwtUser!
    const groups = await this.groupService.listPaginated(
      user.tenantId,
      Number(user.sub),
      user.role === 'admin' ? 'ADMIN' : 'USER',
      request.query,
    )
    return reply.send(groups)
  }

  async getById(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const group = await this.groupService.getById(Number(request.params.id), request.jwtUser!.tenantId)
    return reply.send(group)
  }

  async create(request: FastifyRequest<{ Body: CreateGroupDto }>, reply: FastifyReply) {
    const adminId = Number(request.jwtUser!.sub)
    const group = await this.groupService.create(request.body, request.jwtUser!.tenantId, adminId)
    return reply.status(201).send(group)
  }

  async update(request: FastifyRequest<{ Params: IdParam; Body: UpdateGroupDto }>, reply: FastifyReply) {
    const adminId = Number(request.jwtUser!.sub)
    const group = await this.groupService.update(
      Number(request.params.id),
      request.body,
      request.jwtUser!.tenantId,
      adminId,
    )
    return reply.send(group)
  }

  async delete(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const adminId = Number(request.jwtUser!.sub)
    await this.groupService.delete(Number(request.params.id), request.jwtUser!.tenantId, adminId)
    return reply.status(204).send()
  }
}
