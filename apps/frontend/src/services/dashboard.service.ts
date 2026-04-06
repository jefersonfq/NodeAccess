import api from './api'
import type { DashboardStats } from '@nodeaccess/shared'

export const dashboardService = {
  getStats: (periodDays = 30) => api.get<DashboardStats>('/dashboard/stats', { params: { periodDays } }),
}
