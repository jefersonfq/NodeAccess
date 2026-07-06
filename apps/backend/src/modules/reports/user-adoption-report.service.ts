import type { UserAdoptionReportFilters, UserAdoptionReportRepository } from './user-adoption-report.repository.js'

function toNumber(value: number | bigint | null | undefined) {
  return Number(value ?? 0)
}

export class UserAdoptionReportService {
  constructor(private readonly repo: UserAdoptionReportRepository) {}

  async getUserAdoptionReport(tenantId: number, filters: UserAdoptionReportFilters) {
    const result = await this.repo.getReport(tenantId, filters)
    const summary = result.summary

    return {
      summary: {
        activeUsers: toNumber(summary?.activeUsers),
        totalSessions: toNumber(summary?.totalSessions),
        totalSnippets: toNumber(summary?.totalSnippets),
        totalSshTunnels: toNumber(summary?.totalSshTunnels),
        totalLiveSessions: toNumber(summary?.totalLiveSessions),
      },
      users: {
        data: result.rows.map((row) => ({
          userId: row.userId,
          userName: row.userName,
          userEmail: row.userEmail,
          sessions: toNumber(row.sessions),
          snippets: toNumber(row.snippets),
          sshTunnels: toNumber(row.sshTunnels),
          liveSessions: toNumber(row.liveSessions),
          lastActivityAt: row.lastActivityAt,
        })),
        total: result.total,
        page: result.page,
        limit: result.limit,
      },
    }
  }
}
