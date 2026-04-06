import type { FastifyRequest, FastifyReply } from 'fastify'
import type { CreateUserDto, UpdateUserDto, PatchUserPreferencesDto } from '@nodeaccess/shared'
import type { UserService } from './user.service.js'

interface IdParam { id: string }
interface PageQuery { page?: number; limit?: number; search?: string; role?: 'admin' | 'user'; active?: string }

export class UserController {
  constructor(private readonly userService: UserService) {}

  async list(request: FastifyRequest<{ Querystring: PageQuery }>, reply: FastifyReply) {
    const { page, limit, search, role, active } = request.query
    const tenantId = request.jwtUser!.tenantId

    const result = await this.userService.list(tenantId, {
      ...(page !== undefined && { page }),
      ...(limit !== undefined && { limit }),
      ...(search !== undefined && { search }),
      ...(role !== undefined && { role: role === 'admin' ? 'ADMIN' : 'USER' }),
      ...(active !== undefined && { active: active === 'true' }),
    })
    return reply.send(result)
  }

  async getById(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const id       = Number(request.params.id)
    const tenantId = request.jwtUser!.tenantId
    const user     = await this.userService.getById(id, tenantId)
    return reply.send(user)
  }

  async create(request: FastifyRequest<{ Body: CreateUserDto }>, reply: FastifyReply) {
    const tenantId = request.jwtUser!.tenantId
    const adminId  = Number(request.jwtUser!.sub)
    const result   = await this.userService.create(request.body, tenantId, adminId)
    return reply.status(201).send(result)
  }

  async update(request: FastifyRequest<{ Params: IdParam; Body: UpdateUserDto }>, reply: FastifyReply) {
    const id       = Number(request.params.id)
    const tenantId = request.jwtUser!.tenantId
    const adminId  = Number(request.jwtUser!.sub)
    const user     = await this.userService.update(id, request.body, tenantId, adminId)
    return reply.send(user)
  }

  async activate(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const id       = Number(request.params.id)
    const tenantId = request.jwtUser!.tenantId
    const adminId  = Number(request.jwtUser!.sub)
    const user     = await this.userService.setActive(id, true, tenantId, adminId)
    return reply.send(user)
  }

  async deactivate(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const id       = Number(request.params.id)
    const tenantId = request.jwtUser!.tenantId
    const adminId  = Number(request.jwtUser!.sub)
    const user     = await this.userService.setActive(id, false, tenantId, adminId)
    return reply.send(user)
  }

  async resetPassword(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const id       = Number(request.params.id)
    const tenantId = request.jwtUser!.tenantId
    const adminId  = Number(request.jwtUser!.sub)
    const result   = await this.userService.resetPassword(id, tenantId, adminId)
    return reply.send(result)
  }

  async changePassword(
    request: FastifyRequest<{ Body: { currentPassword: string; newPassword: string } }>,
    reply: FastifyReply,
  ) {
    const userId   = Number(request.jwtUser!.sub)
    const tenantId = request.jwtUser!.tenantId
    await this.userService.changePassword(userId, tenantId, request.body.currentPassword, request.body.newPassword)
    return reply.status(204).send()
  }

  async getPreferences(request: FastifyRequest, reply: FastifyReply) {
    const userId = Number(request.jwtUser!.sub)
    const tenantId = request.jwtUser!.tenantId
    const preferences = await this.userService.getPreferences(userId, tenantId)
    return reply.send(preferences)
  }

  async updatePreferences(
    request: FastifyRequest<{ Body: PatchUserPreferencesDto }>,
    reply: FastifyReply,
  ) {
    const userId = Number(request.jwtUser!.sub)
    const tenantId = request.jwtUser!.tenantId
    const preferences = await this.userService.updatePreferences(userId, tenantId, request.body)
    return reply.send(preferences)
  }
}
