import type { FastifyRequest, FastifyReply } from 'fastify'
import type { FolderService } from './folder.service.js'

interface IdParam       { id: string }
interface CreateBody    { name: string }

export class FolderController {
  constructor(private readonly folderService: FolderService) {}

  async list(request: FastifyRequest, reply: FastifyReply) {
    const { sub: userId, tenantId } = request.jwtUser!
    const folders = await this.folderService.list(Number(userId), tenantId)
    return reply.send(folders)
  }

  async create(request: FastifyRequest<{ Body: CreateBody }>, reply: FastifyReply) {
    const { sub: userId, tenantId } = request.jwtUser!
    const folder = await this.folderService.create(request.body.name, Number(userId), tenantId)
    return reply.status(201).send(folder)
  }

  async update(request: FastifyRequest<{ Params: IdParam; Body: CreateBody }>, reply: FastifyReply) {
    const { sub: userId, tenantId } = request.jwtUser!
    const folder = await this.folderService.update(
      Number(request.params.id),
      request.body.name,
      Number(userId),
      tenantId,
    )
    return reply.send(folder)
  }

  async delete(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const { sub: userId } = request.jwtUser!
    await this.folderService.delete(Number(request.params.id), Number(userId))
    return reply.status(204).send()
  }
}
