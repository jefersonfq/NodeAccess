import type { FastifyRequest, FastifyReply } from 'fastify'
import type { AgentService } from './agent.service.js'
import type { JwtPayload } from '../../shared/guards.js'

type AuthReq = FastifyRequest & { user: JwtPayload }

export class AgentController {
  constructor(private readonly service: AgentService) {}

  async list(req: FastifyRequest, reply: FastifyReply) {
    const { sub, tenantId } = (req as AuthReq).user
    return reply.send(await this.service.list(Number(sub), tenantId))
  }

  async create(req: FastifyRequest, reply: FastifyReply) {
    const { sub, tenantId } = (req as AuthReq).user
    const { name } = req.body as { name: string }
    const result = await this.service.create(Number(sub), tenantId, name)
    // Token retornado apenas aqui — não é armazenado em plaintext
    return reply.status(201).send(result)
  }

  async revoke(req: FastifyRequest, reply: FastifyReply) {
    const { sub, tenantId } = (req as AuthReq).user
    const { id } = req.params as { id: string }
    await this.service.revoke(Number(id), Number(sub), tenantId)
    return reply.status(204).send()
  }
}
