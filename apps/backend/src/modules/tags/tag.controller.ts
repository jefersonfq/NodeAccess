import type { FastifyRequest, FastifyReply } from 'fastify'
import type { TagService } from './tag.service.js'

export class TagController {
  constructor(private readonly tagService: TagService) {}

  async list(request: FastifyRequest, reply: FastifyReply) {
    const tenantId = request.jwtUser!.tenantId
    return reply.send(await this.tagService.list(tenantId))
  }

  async create(request: FastifyRequest<{ Body: { name: string } }>, reply: FastifyReply) {
    const tenantId = request.jwtUser!.tenantId
    const tag = await this.tagService.create(request.body.name, tenantId)
    return reply.status(201).send(tag)
  }

  async delete(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const tenantId = request.jwtUser!.tenantId
    await this.tagService.delete(Number(request.params.id), tenantId)
    return reply.status(204).send()
  }
}
