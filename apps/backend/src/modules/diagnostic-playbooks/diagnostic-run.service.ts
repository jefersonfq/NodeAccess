import type { CreateDiagnosticRunDto, DiagnosticRunDetail, DiagnosticRunPublic } from '@nodeaccess/shared'
import { ForbiddenError, NotFoundError } from '../../shared/errors.js'
import type { DiagnosticPlaybookRepository } from './diagnostic-playbook.repository.js'
import type { DiagnosticRunRepository } from './diagnostic-run.repository.js'
import type { SshRepository } from '../ssh/ssh.repository.js'
import type { OnePasswordService } from '../integrations/onepassword.service.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { DiagnosticRunAiService } from './diagnostic-run-ai.service.js'
import { SshIsolatedDiagnosticRunner } from './diagnostic-run.execution.js'
import type { WebhookService } from '../webhooks/webhook.service.js'

const OUTPUT_PREVIEW_MAX = 1000

function sanitizeDiagnosticOutput(value: string): { value: string; redactionApplied: boolean } {
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

export class DiagnosticRunService {
  private readonly runner: SshIsolatedDiagnosticRunner

  constructor(
    private readonly runRepo: DiagnosticRunRepository,
    private readonly playbookRepo: DiagnosticPlaybookRepository,
    private readonly sshRepo: SshRepository,
    private readonly onePassword: OnePasswordService,
    private readonly logRepo: LogRepository,
    private readonly runAiService: DiagnosticRunAiService,
    private readonly webhookService: WebhookService,
  ) {
    this.runner = new SshIsolatedDiagnosticRunner(this.onePassword)
  }

  async createForHost(input: {
    hostId: number
    tenantId: number
    userId: number
    role: 'ADMIN' | 'USER'
    dto: CreateDiagnosticRunDto
  }): Promise<DiagnosticRunDetail> {
    await this.assertCanAccessHost(input.hostId, input.tenantId, input.userId, input.role)
    const playbook = await this.playbookRepo.findById(input.tenantId, input.dto.playbookId)
    if (!playbook) throw new NotFoundError('Playbook de diagnostico')
    const run = await this.runRepo.createRequestedRun({
      tenantId: input.tenantId,
      hostId: input.hostId,
      playbook,
      requestedById: input.userId,
    })
    await this.logRepo.logAdminEvent({
      adminId: input.userId,
      action: 'DIAGNOSTIC_PLAYBOOK_RUN_REQUESTED',
      targetType: 'DiagnosticRun',
      targetId: run.id,
      details: JSON.stringify({ hostId: input.hostId, playbookId: playbook.id, playbookSlug: playbook.slug }),
    }).catch(() => {})
    void this.executeRun(run.id, input.tenantId, input.hostId, input.userId, playbook.commands)
    return run
  }

  async listForHost(input: {
    hostId: number
    tenantId: number
    userId: number
    role: 'ADMIN' | 'USER'
  }): Promise<DiagnosticRunPublic[]> {
    await this.assertCanAccessHost(input.hostId, input.tenantId, input.userId, input.role)
    return this.runRepo.findByHost(input.hostId, input.tenantId)
  }

  async getById(input: {
    id: number
    tenantId: number
    userId: number
    role: 'ADMIN' | 'USER'
  }): Promise<DiagnosticRunDetail> {
    const detail = await this.runRepo.findDetailById(input.id, input.tenantId)
    if (!detail) throw new NotFoundError('Execucao de diagnostico')
    await this.assertCanAccessHost(detail.hostId, input.tenantId, input.userId, input.role)
    return detail
  }

  async regenerateSummary(input: {
    id: number
    tenantId: number
    userId: number
    role: 'ADMIN' | 'USER'
  }): Promise<DiagnosticRunDetail> {
    const detail = await this.getById(input)
    const started = await this.runAiService.requestSummary(detail.id, input.tenantId)
    await this.logRepo.logAdminEvent({
      adminId: input.userId,
      action: 'DIAGNOSTIC_RUN_AI_SUMMARY_REQUESTED',
      targetType: 'DiagnosticRun',
      targetId: detail.id,
      details: JSON.stringify({
        hostId: detail.hostId,
        started,
      }),
    }).catch(() => {})
    return started ? (await this.getById(input)) : detail
  }

  async exportRun(input: {
    id: number
    tenantId: number
    userId: number
    role: 'ADMIN' | 'USER'
  }): Promise<DiagnosticRunDetail> {
    const detail = await this.getById(input)
    await this.logRepo.logAdminEvent({
      adminId: input.userId,
      action: 'DIAGNOSTIC_RUN_EXPORTED',
      targetType: 'DiagnosticRun',
      targetId: detail.id,
      details: JSON.stringify({
        hostId: detail.hostId,
        status: detail.status,
      }),
    }).catch(() => {})
    return detail
  }

  private async assertCanAccessHost(hostId: number, tenantId: number, userId: number, role: 'ADMIN' | 'USER'): Promise<void> {
    const canConnect = await this.sshRepo.hasEffectiveHostPermission(hostId, tenantId, userId, 'connect', role)
    if (!canConnect) throw new ForbiddenError('Sem permissão para conectar a este host')
  }

  private async executeRun(
    runId: number,
    tenantId: number,
    hostId: number,
    requestedById: number,
    commands: Array<{ id: string; command: string; timeoutSeconds: number }>,
  ): Promise<void> {
    await this.runRepo.markRunStarted(runId)
    try {
      const host = await this.sshRepo.findHostWithCredentials(hostId, tenantId)
      if (!host) throw new NotFoundError('Host')

      const results = await this.runner.run({
        host,
        commands,
        onCommandStart: async (command) => {
          await this.runRepo.markCommandStarted(runId, command.id)
        },
      })

      let hasFailure = false

      for (const result of results) {
        const sanitized = sanitizeDiagnosticOutput(result.output)
        const outputPreview = sanitized.value.slice(0, OUTPUT_PREVIEW_MAX) || null
        const outputBody = sanitized.value || null
        if (!result.executionError && (result.exitCode ?? 0) === 0) {
          await this.runRepo.markCommandCompleted({
            runId,
            commandId: result.commandId,
            exitCode: result.exitCode,
            outputPreview,
            outputBody,
            redactionApplied: sanitized.redactionApplied,
          })
        } else {
          hasFailure = true
          await this.runRepo.markCommandFailed({
            runId,
            commandId: result.commandId,
            exitCode: result.exitCode,
            outputPreview,
            outputBody,
            redactionApplied: sanitized.redactionApplied,
          })
        }
      }

      if (results.length < commands.length) {
        hasFailure = true
        await this.runRepo.markPendingCommandsSkipped(runId)
      }

      if (hasFailure) {
        await this.runRepo.markRunFailed(runId, 'Um ou mais comandos falharam durante o diagnostico')
        void this.webhookService.publishEvent({
          tenantId, eventType: 'diagnostic_run.failed', eventVersion: 1,
          resourceType: 'diagnostic_run', resourceId: String(runId),
          occurredAt: new Date(), data: { hostId, commandsExecuted: results.length },
        }).catch(() => {})
      } else {
        await this.runRepo.markRunCompleted(runId)
        void this.webhookService.publishEvent({
          tenantId, eventType: 'diagnostic_run.completed', eventVersion: 1,
          resourceType: 'diagnostic_run', resourceId: String(runId),
          occurredAt: new Date(), data: { hostId, commandsExecuted: results.length },
        }).catch(() => {})
      }
      void this.runAiService.requestAutomaticSummary(runId, tenantId)
      await this.logRepo.logAdminEvent({
        adminId: requestedById,
        action: 'DIAGNOSTIC_PLAYBOOK_RUN_FINISHED',
        targetType: 'DiagnosticRun',
        targetId: runId,
        details: JSON.stringify({
          hostId,
          status: hasFailure ? 'FAILED' : 'COMPLETED',
          commandsExecuted: results.length,
        }),
      }).catch(() => {})
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha desconhecida ao executar diagnostico'
      await this.runRepo.markPendingCommandsSkipped(runId)
      await this.runRepo.markRunFailed(runId, message)
    }
  }
}
