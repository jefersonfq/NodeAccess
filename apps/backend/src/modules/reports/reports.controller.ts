import type { FastifyReply, FastifyRequest } from 'fastify'
import type { SnippetUsageReportService } from './snippet-usage-report.service.js'
import type { SessionUsageReportService } from './session-usage-report.service.js'
import type { SshTunnelReportService } from './ssh-tunnel-report.service.js'
import type { UserAdoptionReportService } from './user-adoption-report.service.js'
import type { ClientUxReportService } from './client-ux-report.service.js'
import type { HostKeyReportService } from './host-key-report.service.js'

interface SnippetReportQuery {
  search?: string
  status?: string
  userId?: number
  snippetId?: number
  hostId?: number
  dateFrom?: string
  dateTo?: string
  periodDays?: number
  page?: number
  limit?: number
}

export class ReportsController {
  constructor(
    private readonly snippetUsageReportService: SnippetUsageReportService,
    private readonly sessionUsageReportService: SessionUsageReportService,
    private readonly sshTunnelReportService: SshTunnelReportService,
    private readonly userAdoptionReportService: UserAdoptionReportService,
    private readonly clientUxReportService: ClientUxReportService,
    private readonly hostKeyReportService: HostKeyReportService,
  ) {}

  async getSnippetUsage(request: FastifyRequest<{ Querystring: SnippetReportQuery }>, reply: FastifyReply) {
    const periodDays = Number(request.query.periodDays ?? 30)
    const defaultFrom = new Date(Date.now() - Math.max(1, periodDays) * 24 * 60 * 60 * 1000)
    const defaultTo = new Date()

    const result = await this.snippetUsageReportService.getSnippetUsageReport(request.jwtUser!.tenantId, {
      dateFrom: request.query.dateFrom ? new Date(request.query.dateFrom) : defaultFrom,
      dateTo: request.query.dateTo ? new Date(request.query.dateTo) : defaultTo,
      ...(request.query.search !== undefined && { search: request.query.search }),
      ...(request.query.status !== undefined && { status: request.query.status }),
      ...(request.query.userId !== undefined && { userId: Number(request.query.userId) }),
      ...(request.query.snippetId !== undefined && { snippetId: Number(request.query.snippetId) }),
      ...(request.query.hostId !== undefined && { hostId: Number(request.query.hostId) }),
      ...(request.query.page !== undefined && { page: Number(request.query.page) }),
      ...(request.query.limit !== undefined && { limit: Number(request.query.limit) }),
    })

    return reply.send(result)
  }

  async getSessionUsage(request: FastifyRequest<{ Querystring: SnippetReportQuery }>, reply: FastifyReply) {
    const periodDays = Number(request.query.periodDays ?? 30)
    const defaultFrom = new Date(Date.now() - Math.max(1, periodDays) * 24 * 60 * 60 * 1000)
    const defaultTo = new Date()

    const result = await this.sessionUsageReportService.getSessionUsageReport(request.jwtUser!.tenantId, {
      dateFrom: request.query.dateFrom ? new Date(request.query.dateFrom) : defaultFrom,
      dateTo: request.query.dateTo ? new Date(request.query.dateTo) : defaultTo,
      ...(request.query.search !== undefined && { search: request.query.search }),
      ...(request.query.status !== undefined && { status: request.query.status }),
      ...(request.query.userId !== undefined && { userId: Number(request.query.userId) }),
      ...(request.query.hostId !== undefined && { hostId: Number(request.query.hostId) }),
      ...(request.query.page !== undefined && { page: Number(request.query.page) }),
      ...(request.query.limit !== undefined && { limit: Number(request.query.limit) }),
    })

    return reply.send(result)
  }

  async getSshTunnelUsage(request: FastifyRequest<{ Querystring: SnippetReportQuery }>, reply: FastifyReply) {
    const periodDays = Number(request.query.periodDays ?? 30)
    const defaultFrom = new Date(Date.now() - Math.max(1, periodDays) * 24 * 60 * 60 * 1000)
    const defaultTo = new Date()

    const result = await this.sshTunnelReportService.getSshTunnelReport(request.jwtUser!.tenantId, {
      dateFrom: request.query.dateFrom ? new Date(request.query.dateFrom) : defaultFrom,
      dateTo: request.query.dateTo ? new Date(request.query.dateTo) : defaultTo,
      ...(request.query.search !== undefined && { search: request.query.search }),
      ...(request.query.status !== undefined && { type: request.query.status }),
      ...(request.query.userId !== undefined && { userId: Number(request.query.userId) }),
      ...(request.query.snippetId !== undefined && { forwardingId: Number(request.query.snippetId) }),
      ...(request.query.hostId !== undefined && { hostId: Number(request.query.hostId) }),
      ...(request.query.page !== undefined && { page: Number(request.query.page) }),
      ...(request.query.limit !== undefined && { limit: Number(request.query.limit) }),
    })

    return reply.send(result)
  }

  async getUserAdoption(request: FastifyRequest<{ Querystring: SnippetReportQuery }>, reply: FastifyReply) {
    const periodDays = Number(request.query.periodDays ?? 30)
    const defaultFrom = new Date(Date.now() - Math.max(1, periodDays) * 24 * 60 * 60 * 1000)
    const defaultTo = new Date()

    const result = await this.userAdoptionReportService.getUserAdoptionReport(request.jwtUser!.tenantId, {
      dateFrom: request.query.dateFrom ? new Date(request.query.dateFrom) : defaultFrom,
      dateTo: request.query.dateTo ? new Date(request.query.dateTo) : defaultTo,
      ...(request.query.search !== undefined && { search: request.query.search }),
      ...(request.query.page !== undefined && { page: Number(request.query.page) }),
      ...(request.query.limit !== undefined && { limit: Number(request.query.limit) }),
    })

    return reply.send(result)
  }

  async getClientUx(request: FastifyRequest<{ Querystring: SnippetReportQuery }>, reply: FastifyReply) {
    const periodDays = Number(request.query.periodDays ?? 30)
    const defaultFrom = new Date(Date.now() - Math.max(1, periodDays) * 24 * 60 * 60 * 1000)
    const defaultTo = new Date()

    const result = await this.clientUxReportService.getClientUxReport(request.jwtUser!.tenantId, {
      dateFrom: request.query.dateFrom ? new Date(request.query.dateFrom) : defaultFrom,
      dateTo: request.query.dateTo ? new Date(request.query.dateTo) : defaultTo,
      ...(request.query.search !== undefined && { search: request.query.search }),
      ...(request.query.status !== undefined && { action: request.query.status }),
      ...(request.query.userId !== undefined && { userId: Number(request.query.userId) }),
      ...(request.query.page !== undefined && { page: Number(request.query.page) }),
      ...(request.query.limit !== undefined && { limit: Number(request.query.limit) }),
    })

    return reply.send(result)
  }

  async getHostKeys(request: FastifyRequest<{ Querystring: SnippetReportQuery }>, reply: FastifyReply) {
    const periodDays = Number(request.query.periodDays ?? 30)
    const defaultFrom = new Date(Date.now() - Math.max(1, periodDays) * 24 * 60 * 60 * 1000)
    const defaultTo = new Date()

    const result = await this.hostKeyReportService.getHostKeyReport(request.jwtUser!.tenantId, {
      dateFrom: request.query.dateFrom ? new Date(request.query.dateFrom) : defaultFrom,
      dateTo: request.query.dateTo ? new Date(request.query.dateTo) : defaultTo,
      ...(request.query.search !== undefined && { search: request.query.search }),
      ...(request.query.status !== undefined && { action: request.query.status }),
      ...(request.query.userId !== undefined && { userId: Number(request.query.userId) }),
      ...(request.query.hostId !== undefined && { hostId: Number(request.query.hostId) }),
      ...(request.query.page !== undefined && { page: Number(request.query.page) }),
      ...(request.query.limit !== undefined && { limit: Number(request.query.limit) }),
    })

    return reply.send(result)
  }
}
