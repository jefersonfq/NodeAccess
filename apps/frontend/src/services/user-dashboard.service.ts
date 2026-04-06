import api from './api'
import type { UserDashboardSummary } from '@nodeaccess/shared'

export const userDashboardService = {
  getSummary: () => api.get<UserDashboardSummary>('/user-dashboard/summary'),
}
