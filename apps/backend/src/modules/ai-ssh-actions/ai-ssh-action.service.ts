import type { AiSshActionRunDetail, CreateAiSshActionRunDto } from '@nodeaccess/shared'
import { ForbiddenError, NotFoundError } from '../../shared/errors.js'
import type { UserRepository } from '../users/user.repository.js'
import type { HostDashboardRepository } from '../host-dashboard/host-dashboard.repository.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { AiSshActionRepository } from './ai-ssh-action.repository.js'
import type { AiSshActionPolicyService } from './ai-ssh-action.policy.js'
import type { SshRepository } from '../ssh/ssh.repository.js'
import type { OnePasswordService } from '../integrations/onepassword.service.js'
import { SshIsolatedAiActionRunner } from './ai-ssh-action.execution.js'
import { classifyActionCommand, summarizeCommandRisk, type ActionCommandPolicyPatterns } from './ai-ssh-action-command-policy.js'
import type { AiSshActionCommandPolicyRepository } from './ai-ssh-action-command-policy.repository.js'
import type { WebhookService } from '../webhooks/webhook.service.js'

const OUTPUT_PREVIEW_MAX = 1000

function sanitizeActionOutput(value: string): { value: string; redactionApplied: boolean } {
  let sanitized = value
  let redactionApplied = false
  const replacers: Array<[RegExp, string]> = [
    [/(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g, '[redacted-private-key]'],
    [/\b(authorization\s*:\s*bearer)\s+[^\s]+/gi, '$1 [redacted-token]'],
    [/\b(password|passwd|pwd|token|secret|api[_-]?key)\s*=\s*([^\s'"]+)/gi, '$1=[redacted]'],
    [/\b(password|passwd|pwd|token|secret|api[_-]?key)\s*:\s*([^\s'"]+)/gi, '$1: [redacted]'],
  ]

  for (const [pattern, replacement] of replacers) {
    const next = sanitized.replace(pattern, replacement)
    if (next !== sanitized) {
      sanitized = next
      redactionApplied = true
    }
  }

  return { value: sanitized, redactionApplied }
}

export class AiSshActionService {
  private readonly runner: SshIsolatedAiActionRunner
  private readonly activeRuns = new Map<number, { controller: AbortController; cancelTransport?: () => void }>()

  constructor(
    private readonly repository: AiSshActionRepository,
    private readonly policy: AiSshActionPolicyService,
    private readonly hostDashboardRepo: HostDashboardRepository,
    private readonly userRepo: UserRepository,
    private readonly sshRepo: SshRepository,
    private readonly onePassword: OnePasswordService,
    private readonly logRepo: LogRepository,
    private readonly commandPolicyRepo: AiSshActionCommandPolicyRepository,
    private readonly webhookService: WebhookService,
  ) {
    this.runner = new SshIsolatedAiActionRunner(this.onePassword)
  }

  async createRequestedRun(input: {
    tenantId: number
    userId: number
    role: 'ADMIN' | 'USER'
    dto: CreateAiSshActionRunDto
  }): Promise<AiSshActionRunDetail> {
    await this.policy.assertFeatureLicensed(input.tenantId)
    await this.assertCanAccessHost(input.dto.hostId, input.tenantId, input.userId, input.role)
    await this.policy.assertCreateAllowed({
      tenantId: input.tenantId,
      role: input.role,
      dto: input.dto,
    })
    const commandPolicy = await this.loadCommandPolicy(input.tenantId)
    const risk = this.assertActionPlanAllowed(input.dto, commandPolicy)

    const detail = await this.repository.createRequestedRun({
      tenantId: input.tenantId,
      requestedById: input.userId,
      dto: input.dto,
    })

    await this.logRepo.logAdminEvent({
      adminId: input.userId,
      action: 'AI_SSH_ACTION_RUN_REQUESTED',
      targetType: 'AiSshActionRun',
      targetId: detail.id,
      details: JSON.stringify({
        hostId: detail.hostId,
        mode: detail.mode,
        channel: detail.channel,
        status: detail.status,
        risk: risk.maxRisk,
        approvalRequiredSteps: risk.approvalRequiredSteps,
      }),
    }).catch(() => {})

    void this.webhookService.publishEvent({
      tenantId: input.tenantId,
      eventType: 'action_run.created',
      eventVersion: 1,
      resourceType: 'action_run',
      resourceId: String(detail.id),
      occurredAt: new Date(),
      data: { hostId: detail.hostId, mode: detail.mode, status: detail.status },
    }).catch(() => {})

    if (detail.status === 'approved') {
      void this.executeApprovedRun(detail.id, input.tenantId, input.dto.hostId, input.userId)
    }

    return detail
  }

  async getById(input: {
    id: number
    tenantId: number
    userId: number
    role: 'ADMIN' | 'USER'
  }): Promise<AiSshActionRunDetail> {
    await this.policy.assertFeatureLicensed(input.tenantId)
    const detail = await this.repository.findDetailById(input.id, input.tenantId)
    if (!detail) throw new NotFoundError('Action run por IA')
    await this.assertCanAccessHost(detail.hostId, input.tenantId, input.userId, input.role)
    return detail
  }

  async listForHost(input: {
    hostId: number
    tenantId: number
    userId: number
    role: 'ADMIN' | 'USER'
  }): Promise<AiSshActionRunDetail[]> {
    await this.policy.assertFeatureLicensed(input.tenantId)
    await this.assertCanAccessHost(input.hostId, input.tenantId, input.userId, input.role)
    const runs = await this.repository.findByHost(input.hostId, input.tenantId)
    return Promise.all(runs.map(async (run) => {
      const detail = await this.repository.findDetailById(run.id, input.tenantId)
      if (!detail) throw new NotFoundError('Action run por IA')
      return detail
    }))
  }

  async approve(input: {
    id: number
    tenantId: number
    adminId: number
    approvalReason?: string | null
  }): Promise<AiSshActionRunDetail> {
    await this.policy.assertFeatureLicensed(input.tenantId)
    const detail = await this.repository.findDetailById(input.id, input.tenantId)
    if (!detail) throw new NotFoundError('Action run por IA')
    const approved = await this.repository.approveRun({
      id: input.id,
      tenantId: input.tenantId,
      approvedById: input.adminId,
      ...(input.approvalReason !== undefined && { approvalReason: input.approvalReason }),
    })
    await this.logRepo.logAdminEvent({
      adminId: input.adminId,
      action: 'AI_SSH_ACTION_RUN_APPROVED',
      targetType: 'AiSshActionRun',
      targetId: approved.id,
      details: JSON.stringify({
        hostId: approved.hostId,
        mode: approved.mode,
      }),
    }).catch(() => {})
    void this.webhookService.publishEvent({
      tenantId: input.tenantId,
      eventType: 'action_run.approved',
      eventVersion: 1,
      resourceType: 'action_run',
      resourceId: String(approved.id),
      occurredAt: new Date(),
      data: { hostId: approved.hostId, mode: approved.mode, approvedById: input.adminId },
    }).catch(() => {})

    void this.executeApprovedRun(approved.id, input.tenantId, approved.hostId, input.adminId)
    return approved
  }

  async reject(input: {
    id: number
    tenantId: number
    adminId: number
    approvalReason?: string | null
  }): Promise<AiSshActionRunDetail> {
    await this.policy.assertFeatureLicensed(input.tenantId)
    const detail = await this.repository.findDetailById(input.id, input.tenantId)
    if (!detail) throw new NotFoundError('Action run por IA')
    const rejected = await this.repository.rejectRun({
      id: input.id,
      tenantId: input.tenantId,
      approvedById: input.adminId,
      ...(input.approvalReason !== undefined && { approvalReason: input.approvalReason }),
    })
    await this.logRepo.logAdminEvent({
      adminId: input.adminId,
      action: 'AI_SSH_ACTION_RUN_REJECTED',
      targetType: 'AiSshActionRun',
      targetId: rejected.id,
      details: JSON.stringify({
        hostId: rejected.hostId,
        mode: rejected.mode,
      }),
    }).catch(() => {})
    return rejected
  }

  async cancel(input: {
    id: number
    tenantId: number
    userId: number
    role: 'ADMIN' | 'USER'
  }): Promise<AiSshActionRunDetail> {
    await this.policy.assertFeatureLicensed(input.tenantId)
    const detail = await this.repository.findDetailById(input.id, input.tenantId)
    if (!detail) throw new NotFoundError('Action run por IA')
    await this.assertCanAccessHost(detail.hostId, input.tenantId, input.userId, input.role)

    if (input.role !== 'ADMIN' && detail.requestedById !== input.userId) {
      throw new ForbiddenError('Voce so pode cancelar action runs solicitados por voce')
    }

    const canceled = await this.repository.cancelRun({
      id: input.id,
      tenantId: input.tenantId,
      errorMessage: 'Execucao cancelada manualmente',
    })

    const activeRun = this.activeRuns.get(input.id)
    activeRun?.controller.abort()
    activeRun?.cancelTransport?.()

    await this.repository.markRunningStepsSkipped(input.id, 'Execucao cancelada manualmente')
    await this.repository.markPendingStepsSkipped(input.id)

    await this.logRepo.logAdminEvent({
      adminId: input.userId,
      action: 'AI_SSH_ACTION_RUN_CANCELED',
      targetType: 'AiSshActionRun',
      targetId: canceled.id,
      details: JSON.stringify({
        hostId: canceled.hostId,
        mode: canceled.mode,
        channel: canceled.channel,
      }),
    }).catch(() => {})

    const refreshed = await this.repository.findDetailById(input.id, input.tenantId)
    if (!refreshed) throw new NotFoundError('Action run por IA')
    return refreshed
  }

  private async assertCanAccessHost(hostId: number, tenantId: number, userId: number, role: 'ADMIN' | 'USER'): Promise<void> {
    const viewer = {
      tenantId,
      userId,
      role,
      userGroupIds: role === 'USER' ? await this.userRepo.findGroupIdsByUser(userId) : [],
    }
    const host = await this.hostDashboardRepo.findVisibleHost(hostId, viewer)
    if (!host) throw new ForbiddenError('Sem acesso a este host')
  }

  private async executeApprovedRun(
    runId: number,
    tenantId: number,
    hostId: number,
    actorUserId: number,
  ): Promise<void> {
    const controller = new AbortController()
    this.activeRuns.set(runId, { controller })
    try {
      const started = await this.repository.markRunStarted(runId, tenantId)
      if (!started) return
      const detail = await this.repository.findDetailById(runId, tenantId)
      if (!detail) throw new NotFoundError('Action run por IA')

      const commandPolicy = await this.loadCommandPolicy(tenantId)
      for (const step of detail.steps) {
        const risk = classifyActionCommand(step.command, commandPolicy)
        if (risk === 'blocked') {
          throw new ForbiddenError(`Step bloqueado por policy: ${step.stepId}`)
        }
        if (risk === 'approval_required' && detail.mode !== 'approval_required' && detail.mode !== 'full_operational_access') {
          throw new ForbiddenError(`Step exige approval_required: ${step.stepId}`)
        }
      }

      const host = await this.sshRepo.findHostWithCredentials(hostId, tenantId)
      if (!host) throw new NotFoundError('Host')

      const results = await this.runner.run({
        host,
        steps: detail.steps.map((step) => ({
          id: step.stepId,
          command: step.command,
          timeoutSeconds: Number((step as { timeoutSeconds?: number }).timeoutSeconds ?? 60),
        })),
        signal: controller.signal,
        onCancelableReady: (cancelTransport) => {
          const current = this.activeRuns.get(runId)
          if (!current) return
          current.cancelTransport = cancelTransport
          if (current.controller.signal.aborted) {
            cancelTransport()
          }
        },
        onStepStart: async (step) => {
          if (controller.signal.aborted) throw new Error('ACTION_RUN_CANCELED')
          await this.repository.markStepStarted(runId, step.id)
        },
      })

      let hasFailure = false

      for (const result of results) {
        if (controller.signal.aborted) break
        const sanitized = sanitizeActionOutput(result.output)
        const outputPreview = sanitized.value.slice(0, OUTPUT_PREVIEW_MAX) || null

        if (!result.executionError && (result.exitCode ?? 0) === 0) {
          await this.repository.markStepCompleted({
            runId,
            stepId: result.stepId,
            exitCode: result.exitCode,
            outputPreview,
            redactionApplied: sanitized.redactionApplied,
          })
        } else {
          hasFailure = true
          await this.repository.markStepFailed({
            runId,
            stepId: result.stepId,
            exitCode: result.exitCode,
            outputPreview,
            redactionApplied: sanitized.redactionApplied,
          })
        }
      }

      if (results.length < detail.steps.length) {
        hasFailure = true
        await this.repository.markPendingStepsSkipped(runId)
      }

      if (controller.signal.aborted) {
        await this.repository.markRunningStepsSkipped(runId, 'Execucao cancelada manualmente')
        await this.repository.markPendingStepsSkipped(runId)
        return
      }

      if (hasFailure) {
        await this.repository.markRunFailed(runId, tenantId, 'Um ou mais steps falharam durante a execucao')
        void this.webhookService.publishEvent({
          tenantId,
          eventType: 'action_run.failed',
          eventVersion: 1,
          resourceType: 'action_run',
          resourceId: String(runId),
          occurredAt: new Date(),
          data: { hostId, stepsExecuted: results.length },
        }).catch(() => {})
      } else {
        await this.repository.markRunCompleted(runId, tenantId)
        void this.webhookService.publishEvent({
          tenantId,
          eventType: 'action_run.completed',
          eventVersion: 1,
          resourceType: 'action_run',
          resourceId: String(runId),
          occurredAt: new Date(),
          data: { hostId, stepsExecuted: results.length },
        }).catch(() => {})
      }

      await this.logRepo.logAdminEvent({
        adminId: actorUserId,
        action: 'AI_SSH_ACTION_RUN_FINISHED',
        targetType: 'AiSshActionRun',
        targetId: runId,
        details: JSON.stringify({
          hostId,
          status: hasFailure ? 'FAILED' : 'COMPLETED',
          stepsExecuted: results.length,
        }),
      }).catch(() => {})
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.message === 'ACTION_RUN_CANCELED')) {
        await this.repository.markRunningStepsSkipped(runId, 'Execucao cancelada manualmente')
        await this.repository.markPendingStepsSkipped(runId)
        return
      }
      const message = error instanceof Error ? error.message : 'Falha desconhecida ao executar action run'
      await this.repository.markPendingStepsSkipped(runId)
      await this.repository.markRunFailed(runId, tenantId, message)
      void this.webhookService.publishEvent({
        tenantId,
        eventType: 'action_run.failed',
        eventVersion: 1,
        resourceType: 'action_run',
        resourceId: String(runId),
        occurredAt: new Date(),
        data: { hostId, errorMessage: message },
      }).catch(() => {})
    } finally {
      this.activeRuns.delete(runId)
    }
  }

  private async loadCommandPolicy(tenantId: number): Promise<ActionCommandPolicyPatterns> {
    const record = await this.commandPolicyRepo.findByTenant(tenantId)
    if (!record) return {}
    return {
      safePatterns: record.safePatterns,
      approvalPatterns: record.approvalPatterns,
      blockedPatterns: record.blockedPatterns,
    }
  }

  private assertActionPlanAllowed(dto: CreateAiSshActionRunDto, commandPolicy: ActionCommandPolicyPatterns): ReturnType<typeof summarizeCommandRisk> {
    const risk = summarizeCommandRisk(dto.steps, commandPolicy)

    if (risk.blockedSteps.length) {
      throw new ForbiddenError(`Plano contem steps bloqueados por policy: ${risk.blockedSteps.join(', ')}`)
    }

    if (risk.approvalRequiredSteps.length && dto.mode !== 'approval_required' && dto.mode !== 'full_operational_access') {
      throw new ForbiddenError(`Plano contem steps que exigem approval_required: ${risk.approvalRequiredSteps.join(', ')}`)
    }

    return risk
  }
}
