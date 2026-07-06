import type { SnippetUsageReportRepository, SnippetUsageReportFilters } from './snippet-usage-report.repository.js'

function toNumber(value: number | bigint | null | undefined) {
  return Number(value ?? 0)
}

export class SnippetUsageReportService {
  constructor(private readonly repo: SnippetUsageReportRepository) {}

  async getSnippetUsageReport(tenantId: number, filters: SnippetUsageReportFilters) {
    const result = await this.repo.getReport(tenantId, filters)
    const summary = result.summary

    return {
      summary: {
        totalExecutions: toNumber(summary?.totalExecutions),
        uniqueUsers: toNumber(summary?.uniqueUsers),
        uniqueSnippets: toNumber(summary?.uniqueSnippets),
        failedExecutions: toNumber(summary?.failedExecutions),
      },
      topSnippets: result.topSnippets.map((row) => ({
        snippetId: row.snippetId,
        snippetName: row.snippetName,
        count: toNumber(row.count),
        failedCount: toNumber(row.failedCount),
      })),
      topUsers: result.topUsers.map((row) => ({
        userId: row.userId,
        userName: row.userName,
        userEmail: row.userEmail,
        count: toNumber(row.count),
      })),
      executions: {
        data: result.executions,
        total: result.total,
        page: result.page,
        limit: result.limit,
      },
    }
  }
}
