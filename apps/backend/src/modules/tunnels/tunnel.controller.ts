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
    const { hostId, localPort, remoteHost, remotePort, bindAddress, description } = req.body as {
      hostId: number; localPort: number; remoteHost: string; remotePort: number; bindAddress?: string; description?: string
    }
    const tunnel = await this.service.create(Number(sub), tenantId, role, hostId, localPort, remoteHost, remotePort, {
      ...(bindAddress !== undefined && { bindAddress }),
      ...(description !== undefined && { description }),
    })
    return reply.status(201).send(tunnel)
  }

  async test(req: FastifyRequest, reply: FastifyReply) {
    const { sub, tenantId, role } = (req as AuthReq).user
    const { hostId, remoteHost, remotePort } = req.body as {
      hostId: number; remoteHost: string; remotePort: number
    }
    const result = await this.service.testTarget(Number(sub), tenantId, role, hostId, remoteHost, remotePort)
    return reply.send(result)
  }

  async close(req: FastifyRequest, reply: FastifyReply) {
    const { sub } = (req as AuthReq).user
    const { id }  = req.params as { id: string }
    await this.service.closeForUser(id, Number(sub))
    return reply.status(204).send()
  }
}
