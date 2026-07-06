import type { FastifyRequest, FastifyReply } from 'fastify'
import type { CreatePemKeyDto } from '@nodeaccess/shared'
import type { PemKeyService } from './pem-key.service.js'

interface IdParam { id: string }

export class PemKeyController {
  constructor(private readonly pemKeyService: PemKeyService) {}

  async list(request: FastifyRequest, reply: FastifyReply) {
    const { sub, role, tenantId } = request.jwtUser!
    const keys = await this.pemKeyService.list(Number(sub), tenantId, role === 'admin')
    return reply.send(keys)
  }

  async create(request: FastifyRequest<{ Body: CreatePemKeyDto }>, reply: FastifyReply) {
    const key = await this.pemKeyService.create(request.body, Number(request.jwtUser!.sub))
    return reply.status(201).send(key)
  }

  async delete(request: FastifyRequest<{ Params: IdParam }>, reply: FastifyReply) {
    const { sub, role, tenantId } = request.jwtUser!
    await this.pemKeyService.delete(Number(request.params.id), Number(sub), tenantId, role === 'admin')
    return reply.status(204).send()
  }
}
