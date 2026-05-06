import type { FastifyReply, FastifyRequest } from 'fastify'
import type { CreateDiagnosticPlaybookDto, UpdateDiagnosticPlaybookDto } from '@nodeaccess/shared'
import type { DiagnosticPlaybookService } from './diagnostic-playbook.service.js'

interface HostParam {
  id: string
}

interface PlaybookParam {
  id: string
}

export class DiagnosticPlaybookController {
  constructor(private readonly service: DiagnosticPlaybookService) {}

  async listForHost(request: FastifyRequest<{ Params: HostParam }>, reply: FastifyReply) {
    const playbooks = await this.service.listForHost({
      hostId: Number(request.params.id),
      tenantId: request.jwtUser!.tenantId,
      userId: Number(request.jwtUser!.sub),
      role: request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    })
    return reply.send(playbooks)
  }

  async listAdmin(_request: FastifyRequest, reply: FastifyReply) {
    const playbooks = await this.service.listAdminCatalog({
      tenantId: _request.jwtUser!.tenantId,
    })
    return reply.send(playbooks)
  }

  async createAdmin(request: FastifyRequest<{ Body: CreateDiagnosticPlaybookDto }>, reply: FastifyReply) {
    const playbook = await this.service.createAdminPlaybook({
      tenantId: request.jwtUser!.tenantId,
      adminId: Number(request.jwtUser!.sub),
      dto: request.body,
    })
    return reply.status(201).send(playbook)
  }

  async updateAdmin(
    request: FastifyRequest<{ Params: PlaybookParam; Body: UpdateDiagnosticPlaybookDto }>,
    reply: FastifyReply,
  ) {
    const playbook = await this.service.updateAdminPlaybook({
      id: Number(request.params.id),
      tenantId: request.jwtUser!.tenantId,
      adminId: Number(request.jwtUser!.sub),
      dto: request.body,
    })
    return reply.send(playbook)
  }

  async deleteAdmin(request: FastifyRequest<{ Params: PlaybookParam }>, reply: FastifyReply) {
    await this.service.deleteAdminPlaybook({
      id: Number(request.params.id),
      tenantId: request.jwtUser!.tenantId,
      adminId: Number(request.jwtUser!.sub),
    })
    return reply.status(204).send()
  }

  async listAdminHistory(request: FastifyRequest<{ Params: PlaybookParam }>, reply: FastifyReply) {
    const history = await this.service.listAdminHistory({
      id: Number(request.params.id),
      tenantId: request.jwtUser!.tenantId,
    })
    return reply.send(history)
  }
}
