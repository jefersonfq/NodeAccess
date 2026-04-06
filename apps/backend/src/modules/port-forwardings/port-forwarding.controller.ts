import type { FastifyRequest, FastifyReply } from 'fastify'
import type { PortForwardingService } from './port-forwarding.service.js'
import type { JwtPayload } from '../../shared/guards.js'

type AuthReq = FastifyRequest & { user: JwtPayload }

export class PortForwardingController {
  constructor(private readonly service: PortForwardingService) {}

  async listAll(req: FastifyRequest, reply: FastifyReply) {
    const { tenantId, sub, role } = (req as AuthReq).user
    const data = await this.service.listAll(tenantId, Number(sub), role)
    return reply.send(data)
  }

  async list(req: FastifyRequest, reply: FastifyReply) {
    const { tenantId, sub, role } = (req as AuthReq).user
    const { hostId } = req.params as { hostId: string }
    const data = await this.service.list(Number(hostId), tenantId, Number(sub), role)
    return reply.send(data)
  }

  async create(req: FastifyRequest, reply: FastifyReply) {
    const { tenantId, sub, role } = (req as AuthReq).user
    const { hostId } = req.params as { hostId: string }
    const body = req.body as { description?: string; bindAddress?: string; webEnabled?: boolean; webProtocol?: string; localPort: number; remoteHost: string; remotePort: number; autoStart?: boolean }
    const data = await this.service.create(Number(hostId), tenantId, Number(sub), role, body)
    return reply.status(201).send(data)
  }

  async update(req: FastifyRequest, reply: FastifyReply) {
    const { tenantId, sub, role } = (req as AuthReq).user
    const { id } = req.params as { id: string }
    const body = req.body as Partial<{ description: string | null; bindAddress: string; webEnabled: boolean; webProtocol: string; localPort: number; remoteHost: string; remotePort: number; autoStart: boolean }>
    const data = await this.service.update(Number(id), tenantId, Number(sub), role, body)
    return reply.send(data)
  }

  async remove(req: FastifyRequest, reply: FastifyReply) {
    const { tenantId, sub, role } = (req as AuthReq).user
    const { id } = req.params as { id: string }
    await this.service.remove(Number(id), tenantId, Number(sub), role)
    return reply.status(204).send()
  }
}
