import type { FastifyReply, FastifyRequest } from 'fastify'
import type { McpTokenService } from './mcp-token.service.js'

interface TokenParams {
  id: string
}

interface CreateMcpTokenBody {
  name: string
  allowedCapabilities?: string[]
  allowedActionModes?: string[]
  allowedHostIds?: number[]
  expiresAt?: string | null
}

interface UpdateMcpTokenBody {
  name: string
  allowedCapabilities?: string[]
  allowedActionModes?: string[]
  allowedHostIds?: number[]
  expiresAt?: string | null
}

export class McpTokenController {
  constructor(private readonly service: McpTokenService) {}

  async listCapabilities(request: FastifyRequest, reply: FastifyReply) {
    return reply.send(await this.service.listCapabilities({
      tenantId: request.jwtUser!.tenantId,
    }))
  }

  async list(request: FastifyRequest, reply: FastifyReply) {
    return reply.send(await this.service.list({
      tenantId: request.jwtUser!.tenantId,
    }))
  }

  async create(request: FastifyRequest<{ Body: CreateMcpTokenBody }>, reply: FastifyReply) {
    const created = await this.service.create({
      tenantId: request.jwtUser!.tenantId,
      adminId: Number(request.jwtUser!.sub),
      name: request.body.name,
      ...(request.body.allowedCapabilities !== undefined && { allowedCapabilities: request.body.allowedCapabilities }),
      ...(request.body.allowedActionModes !== undefined && { allowedActionModes: request.body.allowedActionModes }),
      ...(request.body.allowedHostIds !== undefined && { allowedHostIds: request.body.allowedHostIds }),
      ...(request.body.expiresAt !== undefined && { expiresAt: request.body.expiresAt }),
    })
    return reply.status(201).send(created)
  }

  async revoke(request: FastifyRequest<{ Params: TokenParams }>, reply: FastifyReply) {
    const record = await this.service.revoke({
      id: Number(request.params.id),
      tenantId: request.jwtUser!.tenantId,
      adminId: Number(request.jwtUser!.sub),
    })
    return reply.send(record)
  }

  async update(request: FastifyRequest<{ Params: TokenParams; Body: UpdateMcpTokenBody }>, reply: FastifyReply) {
    const record = await this.service.update({
      id: Number(request.params.id),
      tenantId: request.jwtUser!.tenantId,
      adminId: Number(request.jwtUser!.sub),
      name: request.body.name,
      ...(request.body.allowedCapabilities !== undefined && { allowedCapabilities: request.body.allowedCapabilities }),
      ...(request.body.allowedActionModes !== undefined && { allowedActionModes: request.body.allowedActionModes }),
      ...(request.body.allowedHostIds !== undefined && { allowedHostIds: request.body.allowedHostIds }),
      ...(request.body.expiresAt !== undefined && { expiresAt: request.body.expiresAt }),
    })
    return reply.send(record)
  }
}
