import api from './api'
import type { HostDashboard, HostDashboardPeriodDays } from '@nodeaccess/shared'

export const hostDashboardService = {
  get: (hostId: number, periodDays: HostDashboardPeriodDays = 30, forceRefresh = false) =>
    api.get<HostDashboard>(`/hosts/${hostId}/dashboard`, { params: { periodDays, ...(forceRefresh ? { forceRefresh: 'true' } : {}) } }),
}
