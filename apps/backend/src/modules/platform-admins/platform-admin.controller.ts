import type { FastifyReply, FastifyRequest } from 'fastify'
import type { PlatformAdminService, CreatePlatformAdminDto } from './platform-admin.service.js'

interface IdParam {
  id: string
}

interface PromoteUserBody {
  resetPassword?: boolean | undefined
}

export class PlatformAdminController {
  constructor(private readonly platformAdminService: PlatformAdminService) {}

  async list(_request: FastifyRequest, reply: FastifyReply) {
    const result = await this.platformAdminService.list()
    return reply.send(result)
  }

  async create(request: FastifyRequest<{ Body: CreatePlatformAdminDto }>, reply: FastifyReply) {
    const actorId = Number(request.jwtUser!.sub)
    const result = await this.platformAdminService.createOrPromote(request.body, actorId)
    return reply.status(201).send(result)
  }

  async promoteUser(request: FastifyRequest<{ Params: IdParam; Body: PromoteUserBody }>, reply: FastifyReply) {
    const actorId = Number(request.jwtUser!.sub)
    const result = await this.platformAdminService.promoteUser(
      Number(request.params.id),
      actorId,
      request.body?.resetPassword === true,
    )
    return reply.status(201).send(result)
  }

  async resetPassword(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const actorId = Number(request.jwtUser!.sub)
    const result = await this.platformAdminService.resetPassword(Number(request.params.id), actorId)
    return reply.send(result)
  }

  async revoke(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const actorId = Number(request.jwtUser!.sub)
    await this.platformAdminService.revoke(Number(request.params.id), actorId)
    return reply.status(204).send()
  }
}
