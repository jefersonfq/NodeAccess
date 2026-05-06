import type { FastifyRequest, FastifyReply } from 'fastify'
import type { SnippetGroupService } from './snippet-group.service.js'

export class SnippetGroupController {
  constructor(private readonly service: SnippetGroupService) {}

  async list(req: FastifyRequest, reply: FastifyReply) {
    const { sub, tenantId } = req.jwtUser!
    return reply.send(await this.service.list(Number(sub), tenantId))
  }

  async create(req: FastifyRequest, reply: FastifyReply) {
    const { sub, tenantId } = req.jwtUser!
    const body = req.body as { name: string; description?: string | null; scope: 'PERSONAL' | 'TEAM' }
    return reply.status(201).send(await this.service.create(Number(sub), tenantId, body))
  }

  async update(req: FastifyRequest, reply: FastifyReply) {
    const { sub, tenantId } = req.jwtUser!
    const { id } = req.params as { id: string }
    const body = req.body as { name?: string; description?: string | null; scope?: 'PERSONAL' | 'TEAM' }
    return reply.send(await this.service.update(Number(id), Number(sub), tenantId, body))
  }

  async remove(req: FastifyRequest, reply: FastifyReply) {
    const { sub, tenantId } = req.jwtUser!
    const { id } = req.params as { id: string }
    await this.service.remove(Number(id), Number(sub), tenantId)
    return reply.status(204).send()
  }
}
