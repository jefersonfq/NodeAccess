import api from './api'
import type { UserDashboard, UserDashboardPeriodDays, UserDashboardSummary } from '@nodeaccess/shared'

export const userDashboardService = {
  getSummary: () => api.get<UserDashboardSummary>('/user-dashboard/summary'),

  get: (periodDays: UserDashboardPeriodDays = 30, userId?: number, forceRefresh = false) =>
    api.get<UserDashboard>('/user-dashboard/dashboard', {
      params: {
        periodDays,
        ...(userId !== undefined ? { userId } : {}),
        ...(forceRefresh ? { forceRefresh: 'true' } : {}),
      },
    }),
}
