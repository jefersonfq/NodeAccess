import type { FastifyRequest, FastifyReply } from 'fastify'
import type { SnippetService } from './snippet.service.js'
import type { JwtPayload } from '../../shared/guards.js'

type AuthReq = FastifyRequest & { user: JwtPayload }

export class SnippetController {
  constructor(private readonly service: SnippetService) {}

  async list(req: FastifyRequest, reply: FastifyReply) {
    const { sub, tenantId } = (req as AuthReq).user
    const snippets = await this.service.list(Number(sub), tenantId)
    return reply.send(snippets)
  }

  async create(req: FastifyRequest, reply: FastifyReply) {
    const { sub, tenantId } = (req as AuthReq).user
    const body = req.body as { name: string; command: string; description?: string; scope: 'PERSONAL' | 'TEAM' }
    const snippet = await this.service.create(Number(sub), tenantId, body)
    return reply.status(201).send(snippet)
  }

  async update(req: FastifyRequest, reply: FastifyReply) {
    const { sub, tenantId } = (req as AuthReq).user
    const { id } = req.params as { id: string }
    const body = req.body as { name?: string; command?: string; description?: string; scope?: 'PERSONAL' | 'TEAM' }
    const snippet = await this.service.update(Number(id), Number(sub), tenantId, body)
    return reply.send(snippet)
  }

  async remove(req: FastifyRequest, reply: FastifyReply) {
    const { sub, tenantId } = (req as AuthReq).user
    const { id } = req.params as { id: string }
    await this.service.remove(Number(id), Number(sub), tenantId)
    return reply.status(204).send()
  }
}
