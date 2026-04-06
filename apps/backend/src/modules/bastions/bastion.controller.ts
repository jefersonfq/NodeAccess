import type { FastifyRequest, FastifyReply } from 'fastify'
import type { CreateBastionDto, UpdateBastionDto } from '@nodeaccess/shared'
import type { BastionService } from './bastion.service.js'

interface IdParam { id: string }

export class BastionController {
  constructor(private readonly bastionService: BastionService) {}

  async list(_request: FastifyRequest, reply: FastifyReply) {
    const bastions = await this.bastionService.list()
    return reply.send(bastions)
  }

  async getById(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const bastion = await this.bastionService.getById(Number(request.params.id))
    return reply.send(bastion)
  }

  async create(request: FastifyRequest<{ Body: CreateBastionDto }>, reply: FastifyReply) {
    const adminId = Number(request.jwtUser!.sub)
    const bastion = await this.bastionService.create(request.body, adminId)
    return reply.status(201).send(bastion)
  }

  async update(request: FastifyRequest<{ Params: IdParam; Body: UpdateBastionDto }>, reply: FastifyReply) {
    const adminId = Number(request.jwtUser!.sub)
    const bastion = await this.bastionService.update(Number(request.params.id), request.body, adminId)
    return reply.send(bastion)
  }

  async delete(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const adminId = Number(request.jwtUser!.sub)
    await this.bastionService.delete(Number(request.params.id), adminId)
    return reply.status(204).send()
  }
}
