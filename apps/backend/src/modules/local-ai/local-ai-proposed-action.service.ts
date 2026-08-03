import type { JwtPayload } from '../../shared/guards.js'
import { NotFoundError, ValidationError } from '../../shared/errors.js'
import type {
  CreateLocalAiProposedActionDto,
  LocalAiProposedAction,
  ReviewLocalAiProposedActionDto,
} from '@nodeaccess/shared'
import type { PrismaClient } from '@prisma/client'
import type { LicenseEntitlementService } from '../license/license-entitlement.service.js'
import type { LocalAiProposedActionRepository } from './local-ai-proposed-action.repository.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { SshRepository } from '../ssh/ssh.repository.js'

export class LocalAiProposedActionService {
  constructor(
    private readonly repository: LocalAiProposedActionRepository,
    private readonly db: PrismaClient,
    private readonly entitlements: LicenseEntitlementService,
    private readonly logRepository: LogRepository,
    private readonly sshRepository: SshRepository,
  ) {}

  async listMine(user: JwtPayload): Promise<LocalAiProposedAction[]> {
    await this.ensureLicensed(user.tenantId)
    const rows = await this.repository.listMine(user.tenantId, Number(user.sub))
    return rows.filter(isActionRecord).map(mapAction)
  }

  async listForAdmin(user: JwtPayload): Promise<LocalAiProposedAction[]> {
    await this.ensureLicensed(user.tenantId)
    const rows = await this.repository.listForAdmin(user.tenantId)
    return rows.filter(isActionRecord).map(mapAction)
  }

  async create(user: JwtPayload, input: CreateLocalAiProposedActionDto): Promise<LocalAiProposedAction> {
    await this.ensureLicensed(user.tenantId)

    if (input.actionType !== 'test_host_connection' || input.targetType !== 'host') {
      throw new ValidationError('Apenas a ação de teste de conexão de host está disponível nesta versão')
    }

    const title = input.title.trim()
    const reason = input.reason.trim()
    if (title.length < 4) throw new ValidationError('Informe um título mais descritivo para a proposta')
    if (reason.length < 10) throw new ValidationError('Descreva melhor o motivo da proposta')

    const host = await this.findAclVisibleHost(user, input.targetId)
    if (!host) throw new NotFoundError('Host')

    const row = await this.repository.create({
      tenantId: user.tenantId,
      requesterUserId: Number(user.sub),
      actionType: 'TEST_HOST_CONNECTION',
      targetType: 'host',
      targetId: input.targetId,
      title,
      reason,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    if (!row) throw new ValidationError('Não foi possível criar a proposta de ação')

    return mapAction(row)
  }

  async review(user: JwtPayload, id: number, input: ReviewLocalAiProposedActionDto): Promise<LocalAiProposedAction> {
    await this.ensureLicensed(user.tenantId)
    const existing = await this.repository.findById(user.tenantId, id)
    if (!existing) throw new NotFoundError('Proposta de ação da IA')
    if (existing.status !== 'PENDING') {
      throw new ValidationError('Esta proposta já foi revisada')
    }

    const row = await this.repository.review({
      id,
      reviewerUserId: Number(user.sub),
      status: input.decision === 'approved' ? 'APPROVED' : 'REJECTED',
      reviewNote: normalizeNote(input.reviewNote),
    })
    if (!row) throw new ValidationError('Não foi possível revisar a proposta de ação')

    await this.logRepository.logAdminEvent({
      adminId: Number(user.sub),
      action: input.decision === 'approved' ? 'APPROVE_LOCAL_AI_PROPOSED_ACTION' : 'REJECT_LOCAL_AI_PROPOSED_ACTION',
      targetType: 'LocalAiProposedAction',
      targetId: row.id,
      details: JSON.stringify({
        actionType: row.actionType,
        targetType: row.targetType,
        targetId: row.targetId,
        requesterUserId: row.requesterUserId,
      }),
    })

    return mapAction(row)
  }

  private async ensureLicensed(tenantId: number): Promise<void> {
    await this.entitlements.requireFeature(
      tenantId,
      'localAi',
      'Assistente local não está habilitado na licença deste tenant',
    )
  }

  private async findAclVisibleHost(user: JwtPayload, hostId: number) {
    const host = await this.db.host.findFirst({
      where: {
        id: hostId,
        tenantId: user.tenantId,
        deletedAt: null,
      },
      select: { id: true },
    })
    if (!host) return null

    const role = user.role === 'admin' ? 'ADMIN' : 'USER'
    const canView = await this.sshRepository.hasEffectiveHostPermission(host.id, user.tenantId, Number(user.sub), 'view', role)
    return canView ? host : null
  }
}

function normalizeNote(value?: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function isActionRecord<T>(value: T | null): value is T {
  return value !== null
}

function mapAction(action: {
  requesterUserId: number
  id: number
  actionType: 'TEST_HOST_CONNECTION'
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  targetType: string
  targetId: number
  title: string
  reason: string
  riskLevel: string
  requiresApproval: boolean
  executionEnabled: boolean
  reviewNote: string | null
  approvedAt: Date | null
  rejectedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
  requester: { id: number; name: string; email: string } | null
  reviewedBy: { id: number; name: string; email: string } | null
}): LocalAiProposedAction {
  return {
    id: action.id,
    actionType: 'test_host_connection',
    status: action.status.toLowerCase() as 'pending' | 'approved' | 'rejected',
    targetType: action.targetType as 'host',
    targetId: action.targetId,
    title: action.title,
    reason: action.reason,
    riskLevel: action.riskLevel,
    requiresApproval: action.requiresApproval,
    executionEnabled: action.executionEnabled,
    reviewNote: action.reviewNote,
    approvedAt: action.approvedAt?.toISOString() ?? null,
    rejectedAt: action.rejectedAt?.toISOString() ?? null,
    expiresAt: action.expiresAt?.toISOString() ?? null,
    createdAt: action.createdAt.toISOString(),
    updatedAt: action.updatedAt.toISOString(),
    requester: action.requester ?? {
      id: action.requesterUserId,
      name: 'Usuário',
      email: '',
    },
    reviewedBy: action.reviewedBy,
  }
}
