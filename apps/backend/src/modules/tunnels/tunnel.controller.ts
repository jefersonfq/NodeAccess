import type { FastifyRequest, FastifyReply } from 'fastify'
import type { TunnelService } from './tunnel.service.js'
import type { JwtPayload } from '../../shared/guards.js'

type AuthReq = FastifyRequest & { user: JwtPayload }

export class TunnelController {
  constructor(private readonly service: TunnelService) {}

  async list(req: FastifyRequest, reply: FastifyReply) {
    const { sub } = (req as AuthReq).user
    const tunnels = this.service.listForUser(Number(sub))
    return reply.send(tunnels)
  }

  async create(req: FastifyRequest, reply: FastifyReply) {
    const { sub, tenantId, role } = (req as AuthReq).user
    const { hostId, localPort, remoteHost, remotePort } = req.body as {
      hostId: number; localPort: number; remoteHost: string; remotePort: number
    }
    const tunnel = await this.service.create(Number(sub), tenantId, role, hostId, localPort, remoteHost, remotePort)
    return reply.status(201).send(tunnel)
  }

  async close(req: FastifyRequest, reply: FastifyReply) {
    const { sub } = (req as AuthReq).user
    const { id }  = req.params as { id: string }
    await this.service.closeForUser(id, Number(sub))
    return reply.status(204).send()
  }
}
