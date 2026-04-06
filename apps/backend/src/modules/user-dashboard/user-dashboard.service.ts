import type { UserDashboardSummary } from '@nodeaccess/shared'
import type { UserDashboardRepository } from './user-dashboard.repository.js'

export class UserDashboardService {
  constructor(private readonly userDashboardRepo: UserDashboardRepository) {}

  async getSummary(userId: number): Promise<UserDashboardSummary> {
    return this.userDashboardRepo.getSummary(userId)
  }
}
