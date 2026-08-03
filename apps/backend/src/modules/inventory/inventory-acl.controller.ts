import type { InventoryAclImpactPreviewDto, UpsertInventoryAclEntryDto } from '@nodeaccess/shared'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { InventoryAclService } from './inventory-acl.service.js'

interface NodeParam { id: string }
interface EffectiveParam extends NodeParam { userId: string }
interface HostEffectiveParam {
  hostId: string
  userId: string
}
interface EntryParam extends NodeParam {
  principalType: 'USER' | 'GROUP' | 'ROLE'
  principalId: string
}

export class InventoryAclController {
  constructor(private readonly service: InventoryAclService) {}

  async list(request: FastifyRequest<{ Params: NodeParam }>, reply: FastifyReply) {
    return reply.send(await this.service.listEntries(
      Number(request.params.id),
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
      request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    ))
  }

  async upsert(
    request: FastifyRequest<{ Params: NodeParam; Body: UpsertInventoryAclEntryDto }>,
    reply: FastifyReply,
  ) {
    return reply.send(await this.service.upsertEntry(
      Number(request.params.id),
      request.body,
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
      request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    ))
  }

  async previewImpact(
    request: FastifyRequest<{ Params: NodeParam; Body: InventoryAclImpactPreviewDto }>,
    reply: FastifyReply,
  ) {
    return reply.send(await this.service.previewImpact(
      Number(request.params.id),
      request.body,
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
      request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    ))
  }

  async delete(request: FastifyRequest<{ Params: EntryParam }>, reply: FastifyReply) {
    await this.service.deleteEntry(
      Number(request.params.id),
      request.params.principalType,
      Number(request.params.principalId),
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
      request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    )
    return reply.status(204).send()
  }

  async effective(request: FastifyRequest<{ Params: EffectiveParam }>, reply: FastifyReply) {
    return reply.send(await this.service.resolveEffectivePermissions(
      Number(request.params.id),
      request.jwtUser!.tenantId,
      Number(request.params.userId),
    ))
  }

  async effectiveHost(request: FastifyRequest<{ Params: HostEffectiveParam }>, reply: FastifyReply) {
    return reply.send(await this.service.resolveEffectiveHostPermissions(
      Number(request.params.hostId),
      request.jwtUser!.tenantId,
      Number(request.params.userId),
    ))
  }
}
