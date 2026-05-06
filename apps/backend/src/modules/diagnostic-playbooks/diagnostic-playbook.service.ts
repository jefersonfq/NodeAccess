import type { CreateDiagnosticPlaybookDto, DiagnosticPlaybookPublic, UpdateDiagnosticPlaybookDto } from '@nodeaccess/shared'
import { ForbiddenError, NotFoundError } from '../../shared/errors.js'
import type { UserRepository } from '../users/user.repository.js'
import type { HostDashboardRepository } from '../host-dashboard/host-dashboard.repository.js'
import type { DiagnosticPlaybookRepository } from './diagnostic-playbook.repository.js'
import type { LogRepository } from '../logs/log.repository.js'

export class DiagnosticPlaybookService {
  constructor(
    private readonly repo: DiagnosticPlaybookRepository,
    private readonly hostDashboardRepo: HostDashboardRepository,
    private readonly userRepo: UserRepository,
    private readonly logRepo: LogRepository,
  ) {}

  async listForHost(input: {
    hostId: number
    tenantId: number
    userId: number
    role: 'ADMIN' | 'USER'
  }): Promise<DiagnosticPlaybookPublic[]> {
    const viewer = {
      tenantId: input.tenantId,
      userId: input.userId,
      role: input.role,
      userGroupIds: input.role === 'USER' ? await this.userRepo.findGroupIdsByUser(input.userId) : [],
    }
    const host = await this.hostDashboardRepo.findVisibleHost(input.hostId, viewer)
    if (!host) {
      if (input.role === 'ADMIN') throw new NotFoundError('Host')
      throw new ForbiddenError('Sem acesso a este host')
    }
    return this.repo.listCatalog(input.tenantId)
  }

  async listAdminCatalog(input: {
    tenantId: number
  }): Promise<DiagnosticPlaybookPublic[]> {
    const playbooks = await this.repo.listCatalog(input.tenantId, { includeDisabled: true })
    const withAudit = await Promise.all(playbooks.map(async (playbook) => {
      const [event] = await this.logRepo.findRecentAdminEventsByTarget(
        input.tenantId,
        'DiagnosticPlaybook',
        playbook.id,
        ['UPDATE_DIAGNOSTIC_PLAYBOOK', 'CREATE_DIAGNOSTIC_PLAYBOOK'],
        1,
      )
      return {
        ...playbook,
        lastUpdatedByName: event?.admin?.name ?? null,
      }
    }))
    return withAudit
  }

  async createAdminPlaybook(input: {
    tenantId: number
    adminId: number
    dto: CreateDiagnosticPlaybookDto
  }): Promise<DiagnosticPlaybookPublic> {
    const playbook = await this.repo.create(input.tenantId, input.dto)
    await this.logRepo.logAdminEvent({
      adminId: input.adminId,
      action: 'CREATE_DIAGNOSTIC_PLAYBOOK',
      targetType: 'DiagnosticPlaybook',
      targetId: playbook.id,
      details: JSON.stringify({ slug: playbook.slug }),
    }).catch(() => {})
    return playbook
  }

  async updateAdminPlaybook(input: {
    id: number
    tenantId: number
    adminId: number
    dto: UpdateDiagnosticPlaybookDto
  }): Promise<DiagnosticPlaybookPublic> {
    const playbook = await this.repo.update(input.tenantId, input.id, input.dto)
    await this.logRepo.logAdminEvent({
      adminId: input.adminId,
      action: 'UPDATE_DIAGNOSTIC_PLAYBOOK',
      targetType: 'DiagnosticPlaybook',
      targetId: playbook.id,
      details: JSON.stringify({ slug: playbook.slug }),
    }).catch(() => {})
    return playbook
  }

  async deleteAdminPlaybook(input: {
    id: number
    tenantId: number
    adminId: number
  }): Promise<void> {
    const playbook = await this.repo.findById(input.tenantId, input.id, { includeDisabled: true })
    if (!playbook) throw new NotFoundError('Playbook de diagnostico')
    await this.repo.delete(input.tenantId, input.id)
    await this.logRepo.logAdminEvent({
      adminId: input.adminId,
      action: 'DELETE_DIAGNOSTIC_PLAYBOOK',
      targetType: 'DiagnosticPlaybook',
      targetId: input.id,
      details: JSON.stringify({ slug: playbook.slug }),
    }).catch(() => {})
  }

  async listAdminHistory(input: {
    id: number
    tenantId: number
  }): Promise<Array<{
    id: number
    action: string
    timestamp: Date
    adminName: string
    details: string | null
  }>> {
    const events = await this.logRepo.findRecentAdminEventsByTarget(
      input.tenantId,
      'DiagnosticPlaybook',
      input.id,
      [
        'CREATE_DIAGNOSTIC_PLAYBOOK',
        'UPDATE_DIAGNOSTIC_PLAYBOOK',
        'DELETE_DIAGNOSTIC_PLAYBOOK',
      ],
      20,
    )

    return events.map((event) => ({
      id: event.id,
      action: event.action,
      timestamp: event.timestamp,
      adminName: event.admin.name,
      details: event.details ?? null,
    }))
  }
}
