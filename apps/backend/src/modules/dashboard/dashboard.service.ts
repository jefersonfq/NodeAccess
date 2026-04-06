import type { DashboardStats, AuthLogPublic } from '@nodeaccess/shared'
import type { DashboardRepository } from './dashboard.repository.js'
import type { AuthLogRow } from '../logs/log.repository.js'

function toAuthLogPublic(row: AuthLogRow): AuthLogPublic {
  return {
    id:        row.id,
    userId:    row.userId ?? null,
    userName:  row.user?.name  ?? null,
    userEmail: row.user?.email ?? null,
    eventType: row.eventType as AuthLogPublic['eventType'],
    ip:        row.ip        ?? null,
    userAgent: row.userAgent ?? null,
    success:   row.success,
    timestamp: row.timestamp,
  }
}

export class DashboardService {
  constructor(private readonly dashboardRepo: DashboardRepository) {}

  async getStats(tenantId: number, periodDays = 30): Promise<DashboardStats> {
    const [stats, recentRows] = await Promise.all([
      this.dashboardRepo.getStats(tenantId, periodDays),
      this.dashboardRepo.getRecentAuthLogs(tenantId),
    ])

    return {
      ...stats,
      recentAuthLogs: recentRows.map(toAuthLogPublic),
      tagStats: stats.tagStats.map(({ id, name, color, hostCount }) => ({
        tag: { id, name, color },
        hostCount,
      })),
    }
  }
}
