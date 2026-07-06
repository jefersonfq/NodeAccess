import type { SshTunnelReportFilters, SshTunnelReportRepository } from './ssh-tunnel-report.repository.js'

function toNumber(value: number | bigint | null | undefined) {
  return Number(value ?? 0)
}

export class SshTunnelReportService {
  constructor(private readonly repo: SshTunnelReportRepository) {}

  async getSshTunnelReport(tenantId: number, filters: SshTunnelReportFilters) {
    const result = await this.repo.getReport(tenantId, filters)
    const summary = result.summary

    return {
      summary: {
        totalAccesses: toNumber(summary?.totalAccesses),
        webAccesses: toNumber(summary?.webAccesses),
        tunnelAccesses: toNumber(summary?.tunnelAccesses),
        uniqueUsers: toNumber(summary?.uniqueUsers),
        uniqueForwardings: toNumber(summary?.uniqueForwardings),
      },
      topForwardings: result.topForwardings.map((row) => ({
        forwardingId: row.forwardingId,
        label: row.label?.trim() || `${row.remoteHost}:${row.remotePort}`,
        hostId: row.hostId,
        hostName: row.hostName,
        remoteHost: row.remoteHost,
        remotePort: row.remotePort,
        count: toNumber(row.count),
      })),
      topUsers: result.topUsers.map((row) => ({
        userId: row.userId,
        userName: row.userName,
        userEmail: row.userEmail,
        count: toNumber(row.count),
      })),
      events: {
        data: result.events.map((row) => ({
          ...row,
          label: row.label?.trim() || `${row.remoteHost}:${row.remotePort}`,
        })),
        total: result.total,
        page: result.page,
        limit: result.limit,
      },
    }
  }
}
