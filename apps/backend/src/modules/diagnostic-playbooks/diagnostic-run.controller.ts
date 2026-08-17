import type { FastifyReply, FastifyRequest } from 'fastify'
import type { CreateDiagnosticRunDto, PublishDiagnosticRunReportToJiraDto, UpdateDiagnosticRunTraceabilityDto } from '@nodeaccess/shared'
import type { DiagnosticRunService } from './diagnostic-run.service.js'

interface HostParam {
  id: string
}

interface RunParam {
  runId: string
}

interface CompareParam extends RunParam {
  baselineRunId: string
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

  async getHistoryForHost(request: FastifyRequest<{ Params: HostParam }>, reply: FastifyReply) {
    const history = await this.service.getHistoryForHost({
      hostId: Number(request.params.id),
      tenantId: request.jwtUser!.tenantId,
      userId: Number(request.jwtUser!.sub),
      role: request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    })
    return reply.send(history)
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
    const report = await this.service.exportRun({
      id: Number(request.params.runId),
      tenantId: request.jwtUser!.tenantId,
      userId: Number(request.jwtUser!.sub),
      role: request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    })

    const safeName = report.identity.playbookName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'diagnostic-run'

    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${safeName}-${report.identity.runId}.json"`)
      .send(JSON.stringify(report, null, 2))
  }

  async getReport(request: FastifyRequest<{ Params: RunParam }>, reply: FastifyReply) {
    const report = await this.service.getReport({
      id: Number(request.params.runId),
      tenantId: request.jwtUser!.tenantId,
      userId: Number(request.jwtUser!.sub),
      role: request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    })
    return reply.send(report)
  }

  async compareRuns(request: FastifyRequest<{ Params: CompareParam }>, reply: FastifyReply) {
    const comparison = await this.service.compareRuns({
      id: Number(request.params.runId),
      baselineId: Number(request.params.baselineRunId),
      tenantId: request.jwtUser!.tenantId,
      userId: Number(request.jwtUser!.sub),
      role: request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    })
    return reply.send(comparison)
  }

  async updateTraceability(request: FastifyRequest<{ Params: RunParam; Body: UpdateDiagnosticRunTraceabilityDto }>, reply: FastifyReply) {
    const run = await this.service.updateTraceability({
      id: Number(request.params.runId),
      tenantId: request.jwtUser!.tenantId,
      userId: Number(request.jwtUser!.sub),
      role: request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
      dto: request.body,
    })
    return reply.send(run)
  }

  async publishReportToJira(request: FastifyRequest<{ Params: RunParam; Body: PublishDiagnosticRunReportToJiraDto }>, reply: FastifyReply) {
    const result = await this.service.publishReportToJira({
      id: Number(request.params.runId),
      tenantId: request.jwtUser!.tenantId,
      userId: Number(request.jwtUser!.sub),
      role: request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
      reportUrl: request.body.reportUrl,
      includeAttachment: request.body.includeAttachment,
    })
    return reply.status(202).send(result)
  }
}
