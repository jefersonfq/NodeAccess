import type { ClientUxReportFilters, ClientUxReportRepository } from './client-ux-report.repository.js'

function toNumber(value: number | bigint | null | undefined) {
  return Number(value ?? 0)
}

function toDateKey(value: string | Date) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)
}

export class ClientUxReportService {
  constructor(private readonly repo: ClientUxReportRepository) {}

  async getClientUxReport(tenantId: number, filters: ClientUxReportFilters) {
    const result = await this.repo.getReport(tenantId, filters)
    const summary = result.summary

    return {
      summary: {
        totalEvents: toNumber(summary?.totalEvents),
        sessionExpired: toNumber(summary?.sessionExpired),
        sessionExpiredTerminal: toNumber(summary?.sessionExpiredTerminal),
        staleReloadRecovered: toNumber(summary?.staleReloadRecovered),
        staleReloadFailed: toNumber(summary?.staleReloadFailed),
        uniqueUsers: toNumber(summary?.uniqueUsers),
      },
      byAction: result.byAction.map((row) => ({
        action: row.action,
        count: toNumber(row.count),
      })),
      topUsers: result.topUsers.map((row) => ({
        userId: row.userId,
        userName: row.userName,
        userEmail: row.userEmail,
        count: toNumber(row.count),
        lastEventAt: row.lastEventAt.toISOString(),
      })),
      daily: result.daily.map((row) => ({
        date: toDateKey(row.date),
        action: row.action,
        count: toNumber(row.count),
      })),
      events: {
        data: result.events.map((row) => ({
          ...row,
          timestamp: row.timestamp.toISOString(),
        })),
        total: result.total,
        page: result.page,
        limit: result.limit,
      },
    }
  }
}
