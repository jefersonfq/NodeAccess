import type { CreateInventoryFolderDto, MoveInventoryFolderDto, MoveInventoryHostDto, UpdateInventoryFolderDto } from '@nodeaccess/shared'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { InventoryService } from './inventory.service.js'

interface IdParam {
  id: string
}

export class InventoryController {
  constructor(private readonly service: InventoryService) {}

  async list(request: FastifyRequest, reply: FastifyReply) {
    return reply.send(await this.service.list(
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
      request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    ))
  }

  async createFolder(request: FastifyRequest<{ Body: CreateInventoryFolderDto }>, reply: FastifyReply) {
    const actorId = Number(request.jwtUser!.sub)
    const folder = await this.service.createFolder(request.body, request.jwtUser!.tenantId, actorId)
    return reply.status(201).send(folder)
  }

  async updateFolder(
    request: FastifyRequest<{ Params: IdParam; Body: UpdateInventoryFolderDto }>,
    reply: FastifyReply,
  ) {
    const folder = await this.service.updateFolder(
      Number(request.params.id),
      request.body,
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
    )
    return reply.send(folder)
  }

  async deleteFolder(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    await this.service.deleteFolder(
      Number(request.params.id),
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
    )
    return reply.status(204).send()
  }

  async moveFolder(request: FastifyRequest<{ Params: IdParam; Body: MoveInventoryFolderDto }>, reply: FastifyReply) {
    const node = await this.service.moveFolder(
      Number(request.params.id),
      request.body,
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
    )
    return reply.send(node)
  }

  async moveHost(request: FastifyRequest<{ Params: IdParam; Body: MoveInventoryHostDto }>, reply: FastifyReply) {
    const node = await this.service.moveHost(
      Number(request.params.id),
      request.body,
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
    )
    return reply.send(node)
  }

  async getHostNode(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    return reply.send(await this.service.getHostNode(
      Number(request.params.id),
      request.jwtUser!.tenantId,
    ))
  }

  async integrity(request: FastifyRequest, reply: FastifyReply) {
    return reply.send(await this.service.getIntegrityReport(request.jwtUser!.tenantId))
  }

  async repairIntegrity(request: FastifyRequest, reply: FastifyReply) {
    return reply.send(await this.service.repairIntegrity(
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
    ))
  }
}
