import type { FastifyReply, FastifyRequest } from 'fastify'
import type { CreateDiagnosticRunDto } from '@nodeaccess/shared'
import type { DiagnosticRunService } from './diagnostic-run.service.js'

interface HostParam {
  id: string
}

interface RunParam {
  runId: string
}

export class DiagnosticRunController {
  constructor(private readonly service: DiagnosticRunService) {}

  async createForHost(request: FastifyRequest<{ Params: HostParam; Body: CreateDiagnosticRunDto }>, reply: FastifyReply) {
    const run = await this.service.createForHost({
      hostId: Number(request.params.id),
      tenantId: request.jwtUser!.tenantId,
      userId: Number(request.jwtUser!.sub),
      role: request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
      dto: request.body,
    })
    return reply.status(201).send(run)
  }

  async listForHost(request: FastifyRequest<{ Params: HostParam }>, reply: FastifyReply) {
    const runs = await this.service.listForHost({
      hostId: Number(request.params.id),
      tenantId: request.jwtUser!.tenantId,
      userId: Number(request.jwtUser!.sub),
      role: request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    })
    return reply.send(runs)
  }

  async getById(request: FastifyRequest<{ Params: RunParam }>, reply: FastifyReply) {
    const run = await this.service.getById({
      id: Number(request.params.runId),
      tenantId: request.jwtUser!.tenantId,
      userId: Number(request.jwtUser!.sub),
      role: request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    })
    return reply.send(run)
  }

  async regenerateSummary(request: FastifyRequest<{ Params: RunParam }>, reply: FastifyReply) {
    const run = await this.service.regenerateSummary({
      id: Number(request.params.runId),
      tenantId: request.jwtUser!.tenantId,
      userId: Number(request.jwtUser!.sub),
      role: request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    })
    return reply.send(run)
  }

  async download(request: FastifyRequest<{ Params: RunParam }>, reply: FastifyReply) {
    const run = await this.service.exportRun({
      id: Number(request.params.runId),
      tenantId: request.jwtUser!.tenantId,
      userId: Number(request.jwtUser!.sub),
      role: request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    })

    const safeName = run.playbookName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'diagnostic-run'

    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${safeName}-${run.id}.json"`)
      .send(JSON.stringify(run, null, 2))
  }
}
