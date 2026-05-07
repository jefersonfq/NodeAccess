import type { FastifyRequest, FastifyReply } from 'fastify'
import type { AgentService, CreateAgentInput } from './agent.service.js'
import type { JwtPayload } from '../../shared/guards.js'

type AuthReq = FastifyRequest & { user: JwtPayload }

export class AgentController {
  constructor(private readonly service: AgentService) {}

  async list(req: FastifyRequest, reply: FastifyReply) {
    const { sub, tenantId, role } = (req as AuthReq).user
    return reply.send(await this.service.list(Number(sub), tenantId, role === 'admin'))
  }

  async status(req: FastifyRequest, reply: FastifyReply) {
    const { sub, tenantId } = (req as AuthReq).user
    return reply.send(await this.service.status(Number(sub), tenantId))
  }

  async create(req: FastifyRequest, reply: FastifyReply) {
    const { sub, tenantId } = (req as AuthReq).user
    const result = await this.service.create(Number(sub), tenantId, req.body as CreateAgentInput)
    return reply.status(201).send(result)
  }

  async revoke(req: FastifyRequest, reply: FastifyReply) {
    const { sub, tenantId, role } = (req as AuthReq).user
    const { id } = req.params as { id: string }
    await this.service.revoke(Number(id), Number(sub), tenantId, role === 'admin')
    return reply.status(204).send()
  }

  async reactivate(req: FastifyRequest, reply: FastifyReply) {
    const { sub, tenantId, role } = (req as AuthReq).user
    const { id } = req.params as { id: string }
    await this.service.reactivate(Number(id), Number(sub), tenantId, role === 'admin')
    return reply.status(204).send()
  }

  async permanentDelete(req: FastifyRequest, reply: FastifyReply) {
    const { sub, tenantId, role } = (req as AuthReq).user
    const { id } = req.params as { id: string }
    await this.service.permanentDelete(Number(id), Number(sub), tenantId, role === 'admin')
    return reply.status(204).send()
  }

  async setDefault(req: FastifyRequest, reply: FastifyReply) {
    const { sub, tenantId, role } = (req as AuthReq).user
    const { id } = req.params as { id: string }
    await this.service.setDefault(Number(id), Number(sub), tenantId, role === 'admin')
    return reply.status(204).send()
  }
}
