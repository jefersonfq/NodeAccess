import type { FastifyRequest, FastifyReply } from 'fastify'
import type { CreateUserDto, UpdateUserDto, PatchUserPreferencesDto } from '@nodeaccess/shared'
import type { UserService } from './user.service.js'

interface IdParam { id: string }
interface PageQuery { page?: number; limit?: number; search?: string; role?: 'admin' | 'user'; active?: string; includeDeleted?: string }

export class UserController {
  constructor(private readonly userService: UserService) {}

  async list(request: FastifyRequest<{ Querystring: PageQuery }>, reply: FastifyReply) {
    const { page, limit, search, role, active, includeDeleted } = request.query
    const tenantId = request.jwtUser!.tenantId

    const result = await this.userService.list(tenantId, {
      ...(page !== undefined && { page }),
      ...(limit !== undefined && { limit }),
      ...(search !== undefined && { search }),
      ...(role !== undefined && { role: role === 'admin' ? 'ADMIN' : 'USER' }),
      ...(active !== undefined && { active: active === 'true' }),
      ...(includeDeleted !== undefined && { includeDeleted: includeDeleted === 'true' }),
    })
    return reply.send(result)
  }

  async getById(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const id       = Number(request.params.id)
    const tenantId = request.jwtUser!.tenantId
    const user     = await this.userService.getById(id, tenantId)
    return reply.send(user)
  }

  async listInventoryAccess(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const id = Number(request.params.id)
    const tenantId = request.jwtUser!.tenantId
    return reply.send(await this.userService.listInventoryAccess(id, tenantId))
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

  async delete(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const id       = Number(request.params.id)
    const tenantId = request.jwtUser!.tenantId
    const adminId  = Number(request.jwtUser!.sub)
    await this.userService.softDelete(id, tenantId, adminId)
    return reply.status(204).send()
  }

  async restore(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const id       = Number(request.params.id)
    const tenantId = request.jwtUser!.tenantId
    const adminId  = Number(request.jwtUser!.sub)
    const user     = await this.userService.restore(id, tenantId, adminId)
    return reply.send(user)
  }

  async resetPassword(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const id       = Number(request.params.id)
    const tenantId = request.jwtUser!.tenantId
    const adminId  = Number(request.jwtUser!.sub)
    const result   = await this.userService.resetPassword(id, tenantId, adminId)
    return reply.send(result)
  }

  async resetMfa(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const id       = Number(request.params.id)
    const tenantId = request.jwtUser!.tenantId
    const adminId  = Number(request.jwtUser!.sub)
    const user     = await this.userService.resetMfa(id, tenantId, adminId)
    return reply.send(user)
  }

  async changePassword(
    request: FastifyRequest<{ Body: { currentPassword?: string; newPassword: string } }>,
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

  async updateOwnAvatar(request: FastifyRequest, reply: FastifyReply) {
    const userId = Number(request.jwtUser!.sub)
    const tenantId = request.jwtUser!.tenantId
    const file = await (request as any).file() as { filename?: string; mimetype?: string; toBuffer(): Promise<Buffer> } | undefined
    if (!file) return reply.status(400).send({ code: 'AVATAR_FILE_REQUIRED', message: 'Arquivo de avatar obrigatório' })
    const user = await this.userService.updateOwnAvatar(userId, tenantId, {
      buffer: await file.toBuffer(),
      ...(file.filename !== undefined && { filename: file.filename }),
      ...(file.mimetype !== undefined && { mimetype: file.mimetype }),
    }, userId)
    return reply.send(user)
  }

  async removeOwnAvatar(request: FastifyRequest, reply: FastifyReply) {
    const userId = Number(request.jwtUser!.sub)
    const tenantId = request.jwtUser!.tenantId
    const user = await this.userService.removeOwnAvatar(userId, tenantId, userId)
    return reply.send(user)
  }

  async getAvatar(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const userId = Number(request.params.id)
    const tenantId = request.jwtUser!.tenantId
    const avatar = await this.userService.getAvatar(userId, tenantId)
    return reply
      .header('Content-Type', avatar.mimeType)
      .header('Content-Length', avatar.buffer.length)
      .header('Cache-Control', 'private, max-age=86400, immutable')
      .header('ETag', `"user-avatar-${userId}-${avatar.updatedAt.getTime()}"`)
      .send(avatar.buffer)
  }
}
