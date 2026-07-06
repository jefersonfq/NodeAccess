import type { SessionUsageReportFilters, SessionUsageReportRepository } from './session-usage-report.repository.js'

function toNumber(value: number | bigint | null | undefined) {
  return Number(value ?? 0)
}

export class SessionUsageReportService {
  constructor(private readonly repo: SessionUsageReportRepository) {}

  async getSessionUsageReport(tenantId: number, filters: SessionUsageReportFilters) {
    const result = await this.repo.getReport(tenantId, filters)
    const summary = result.summary

    return {
      summary: {
        totalSessions: toNumber(summary?.totalSessions),
        activeSessions: toNumber(summary?.activeSessions),
        failedSessions: toNumber(summary?.failedSessions),
        uniqueUsers: toNumber(summary?.uniqueUsers),
        uniqueHosts: toNumber(summary?.uniqueHosts),
      },
      topHosts: result.topHosts.map((row) => ({
        hostId: row.hostId,
        hostName: row.hostName,
        hostIp: row.hostIp,
        count: toNumber(row.count),
        failedCount: toNumber(row.failedCount),
      })),
      topUsers: result.topUsers.map((row) => ({
        userId: row.userId,
        userName: row.userName,
        userEmail: row.userEmail,
        count: toNumber(row.count),
        failedCount: toNumber(row.failedCount),
      })),
      sessions: {
        data: result.sessions.map((row) => ({ ...row, active: Boolean(row.active) })),
        total: result.total,
        page: result.page,
        limit: result.limit,
      },
    }
  }
}
