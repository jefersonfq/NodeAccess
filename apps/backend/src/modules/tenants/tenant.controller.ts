import type { FastifyReply, FastifyRequest } from 'fastify'
import type { CreateTenantDto, UpdateTenantDto } from '@nodeaccess/shared'
import type { TenantService } from './tenant.service.js'

interface IdParam {
  id: string
}

export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  async list(_request: FastifyRequest, reply: FastifyReply) {
    const result = await this.tenantService.list()
    return reply.send(result)
  }

  async create(request: FastifyRequest<{ Body: CreateTenantDto }>, reply: FastifyReply) {
    const result = await this.tenantService.create(request.body)
    return reply.status(201).send(result)
  }

  async update(request: FastifyRequest<{ Params: IdParam; Body: UpdateTenantDto }>, reply: FastifyReply) {
    const id = Number(request.params.id)
    const result = await this.tenantService.update(id, request.body)
    return reply.send(result)
  }
}
