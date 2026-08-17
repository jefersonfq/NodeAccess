import type { CreateDiagnosticRunDto, DiagnosticRunComparison, DiagnosticRunDetail, DiagnosticRunHistory, DiagnosticRunPublic, DiagnosticRunReport, UpdateDiagnosticRunTraceabilityDto } from '@nodeaccess/shared'
import { createHash } from 'node:crypto'
import { ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors.js'
import type { DiagnosticPlaybookRepository } from './diagnostic-playbook.repository.js'
import type { DiagnosticRunRepository } from './diagnostic-run.repository.js'
import type { SshRepository } from '../ssh/ssh.repository.js'
import type { OnePasswordService } from '../integrations/onepassword.service.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { DiagnosticRunAiService } from './diagnostic-run-ai.service.js'
import { SshIsolatedDiagnosticRunner } from './diagnostic-run.execution.js'
import type { WebhookService } from '../webhooks/webhook.service.js'
import type { IntegrationRepository } from '../integrations/integration.repository.js'
import type { JiraInteractionRepository } from '../integrations/jira-interaction.repository.js'
import type { JiraIntegrationService, StoredJiraConfig } from '../integrations/jira.service.js'
import { env } from '../../config/env.js'
import { compareDiagnosticRunReports } from './diagnostic-run-comparison.js'

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
    private readonly integrationRepo: IntegrationRepository,
    private readonly jiraInteractionRepo: JiraInteractionRepository,
    private readonly jira: JiraIntegrationService,
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

  async getHistoryForHost(input: {
    hostId: number
    tenantId: number
    userId: number
    role: 'ADMIN' | 'USER'
  }): Promise<DiagnosticRunHistory> {
    await this.assertCanAccessHost(input.hostId, input.tenantId, input.userId, input.role)
    const rows = await this.runRepo.findHistoryByHost(input.hostId, input.tenantId, 30)
    const findings = new Map<string, { finding: string; occurrences: number; lastSeenAt: string; runIds: number[] }>()
    for (const row of rows) {
      for (const finding of row.aiSummaryStructured?.keyFindings ?? []) {
        const normalized = finding.trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ')
        if (!normalized) continue
        const current = findings.get(normalized)
        if (current) {
          current.occurrences += 1
          current.runIds.push(row.runId)
        } else {
          findings.set(normalized, {
            finding: finding.trim(),
            occurrences: 1,
            lastSeenAt: row.createdAt.toISOString(),
            runIds: [row.runId],
          })
        }
      }
    }
    const trend = rows.map((row) => ({
      runId: row.runId,
      playbookId: row.playbookId,
      playbookName: row.playbookName,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      riskLevel: row.aiSummaryStructured?.riskLevel ?? null,
      completedCommands: row.completedCommands,
      failedCommands: row.failedCommands,
      skippedCommands: row.skippedCommands,
    })).reverse()
    const history: DiagnosticRunHistory = {
      hostId: input.hostId,
      windowSize: 30,
      totals: {
        runs: rows.length,
        completed: rows.filter((row) => row.status === 'completed').length,
        failed: rows.filter((row) => row.status === 'failed').length,
        commandFailures: rows.reduce((total, row) => total + row.failedCommands, 0),
        highRisk: rows.filter((row) => row.aiSummaryStructured?.riskLevel === 'high').length,
      },
      trend,
      recurringFindings: [...findings.values()]
        .filter((finding) => finding.occurrences > 1)
        .sort((left, right) => right.occurrences - left.occurrences || right.lastSeenAt.localeCompare(left.lastSeenAt))
        .slice(0, 10),
      warnings: rows.some((row) => !row.aiSummaryStructured)
        ? ['Execuções sem resumo estruturado participam dos totais, mas não da tendência de risco e dos achados recorrentes.']
        : [],
    }
    await this.logRepo.logAdminEvent({
      adminId: input.userId,
      action: 'DIAGNOSTIC_RUN_HISTORY_VIEWED',
      targetType: 'Host',
      targetId: input.hostId,
      details: JSON.stringify({ runs: history.totals.runs, recurringFindings: history.recurringFindings.length }),
    }).catch(() => {})
    return history
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

  async updateTraceability(input: {
    id: number
    tenantId: number
    userId: number
    role: 'ADMIN' | 'USER'
    dto: UpdateDiagnosticRunTraceabilityDto
  }): Promise<DiagnosticRunDetail> {
    const detail = await this.getById(input)
    const sessionId = input.dto.sessionId !== undefined ? input.dto.sessionId : (detail.originSessionId ?? null)
    const ticketKey = input.dto.ticketKey !== undefined
      ? (input.dto.ticketKey?.trim().toUpperCase() || null)
      : (detail.originTicketKey ?? null)
    const actionRunId = input.dto.actionRunId !== undefined ? input.dto.actionRunId : (detail.originActionRunId ?? null)
    const validation = await this.runRepo.validateTraceabilityReferences({
      tenantId: input.tenantId,
      hostId: detail.hostId,
      userId: input.userId,
      role: input.role,
      sessionId,
      ticketKey,
      actionRunId,
    })
    if (!validation.sessionValid) throw new ValidationError('A sessão não pertence ao mesmo tenant, host e escopo do diagnóstico')
    if (!validation.ticketValid) throw new ValidationError('O ticket não possui auditoria no mesmo tenant, host e escopo do diagnóstico')
    if (!validation.actionRunValid) throw new ValidationError('O ActionRun não pertence ao mesmo tenant, host e escopo do diagnóstico')

    await this.runRepo.updateTraceability({ id: detail.id, tenantId: input.tenantId, sessionId, ticketKey, actionRunId })
    await this.logRepo.logAdminEvent({
      adminId: input.userId,
      action: 'DIAGNOSTIC_RUN_TRACEABILITY_UPDATED',
      targetType: 'DiagnosticRun',
      targetId: detail.id,
      details: JSON.stringify({ hostId: detail.hostId, sessionId, ticketKey, actionRunId }),
    })
    return this.getById(input)
  }

  async getReport(input: {
    id: number
    tenantId: number
    userId: number
    role: 'ADMIN' | 'USER'
  }): Promise<DiagnosticRunReport> {
    const detail = await this.getById(input)
    const evidence = {
      total: detail.commands.length,
      completed: detail.commands.filter((command) => command.status === 'completed').length,
      failed: detail.commands.filter((command) => command.status === 'failed').length,
      skipped: detail.commands.filter((command) => command.status === 'skipped').length,
      redacted: detail.commands.filter((command) => command.redactionApplied).length,
      commands: detail.commands.map((command) => ({
        commandId: command.commandId,
        command: command.command,
        status: command.status,
        exitCode: command.exitCode,
        redactionApplied: command.redactionApplied,
        output: command.outputBody,
      })),
    }
    const checksumPayload = {
      identity: {
        runId: detail.id,
        hostId: detail.hostId,
        hostName: detail.hostName ?? null,
        hostIp: detail.hostIp ?? null,
        playbookId: detail.playbookId,
        playbookName: detail.playbookName,
        status: detail.status,
        startedAt: detail.startedAt ? new Date(detail.startedAt).toISOString() : null,
        finishedAt: detail.finishedAt ? new Date(detail.finishedAt).toISOString() : null,
      },
      traceability: {
        sessionId: detail.originSessionId ?? null,
        ticketKey: detail.originTicketKey ?? null,
        actionRunId: detail.originActionRunId ?? null,
        note: detail.originSessionId || detail.originTicketKey || detail.originActionRunId
          ? 'Origem vinculada explicitamente e validada no mesmo tenant, host e escopo do diagnóstico.'
          : 'Execução SSH isolada de diagnóstico; origem ainda não vinculada a sessão, ticket ou ActionRun.',
      },
      summary: {
        status: detail.aiSummaryStatus,
        text: detail.aiSummaryText,
        structured: detail.aiSummaryStructured ?? null,
      },
      evidence,
    }
    const checksum = createHash('sha256').update(JSON.stringify(checksumPayload)).digest('hex')
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      ...checksumPayload,
      integrity: { algorithm: 'sha256', checksum },
    }
  }

  async compareRuns(input: {
    id: number
    baselineId: number
    tenantId: number
    userId: number
    role: 'ADMIN' | 'USER'
  }): Promise<DiagnosticRunComparison> {
    if (input.id === input.baselineId) throw new ValidationError('Selecione duas execuções diferentes para comparar')
    const [current, baseline] = await Promise.all([
      this.getReport(input),
      this.getReport({ ...input, id: input.baselineId }),
    ])
    if (current.identity.hostId !== baseline.identity.hostId) {
      throw new ValidationError('As execuções comparadas devem pertencer ao mesmo host')
    }
    const comparison = compareDiagnosticRunReports(baseline, current)
    await this.logRepo.logAdminEvent({
      adminId: input.userId,
      action: 'DIAGNOSTIC_RUNS_COMPARED',
      targetType: 'DiagnosticRun',
      targetId: input.id,
      details: JSON.stringify({
        hostId: current.identity.hostId,
        baselineRunId: input.baselineId,
        currentRunId: input.id,
        verdict: comparison.verdict,
      }),
    }).catch(() => {})
    return comparison
  }

  async exportRun(input: {
    id: number
    tenantId: number
    userId: number
    role: 'ADMIN' | 'USER'
  }): Promise<DiagnosticRunReport> {
    const report = await this.getReport(input)
    await this.logRepo.logAdminEvent({
      adminId: input.userId,
      action: 'DIAGNOSTIC_RUN_EXPORTED',
      targetType: 'DiagnosticRun',
      targetId: report.identity.runId,
      details: JSON.stringify({
        hostId: report.identity.hostId,
        status: report.identity.status,
        checksum: report.integrity.checksum,
      }),
    }).catch(() => {})
    return report
  }

  async publishReportToJira(input: {
    id: number
    tenantId: number
    userId: number
    role: 'ADMIN' | 'USER'
    reportUrl: string
    includeAttachment: boolean
  }): Promise<{ ticketKey: string; checksum: string; queuedActions: Array<'COMMENT_DIAGNOSTIC_REPORT' | 'ATTACH_DIAGNOSTIC_REPORT'> }> {
    assertTrustedReportUrl(input.reportUrl, input.id)
    const report = await this.getReport(input)
    const ticketKey = report.traceability.ticketKey
    if (!ticketKey) throw new ValidationError('Vincule um ticket válido ao diagnóstico antes de publicar no Jira')

    const interaction = await this.jiraInteractionRepo.findRecentByTicket({
      tenantId: input.tenantId,
      hostId: report.identity.hostId,
      ticketKey,
      ...(input.role === 'USER' ? { userId: input.userId } : {}),
    })
    if (!interaction) throw new ValidationError('Nenhum atendimento Jira válido foi encontrado para este ticket e host')

    const integration = await this.integrationRepo.findByProvider(input.tenantId, 'jira')
    if (!integration?.enabled) throw new ValidationError('Integração Jira desabilitada para este tenant')
    const capabilities = this.jira.capabilities(parseStoredJiraConfig(integration.config))
    if (!capabilities.comment) throw new ValidationError('A credencial Jira não permite publicar comentários')
    if (input.includeAttachment && !capabilities.attachment) throw new ValidationError('A credencial Jira não permite anexar relatórios')

    const checksum = report.integrity.checksum
    const queuedActions: Array<'COMMENT_DIAGNOSTIC_REPORT' | 'ATTACH_DIAGNOSTIC_REPORT'> = ['COMMENT_DIAGNOSTIC_REPORT']
    await this.jiraInteractionRepo.enqueue({
      tenantId: input.tenantId,
      interactionId: interaction.id,
      action: 'COMMENT_DIAGNOSTIC_REPORT',
      idempotencyKey: `diagnostic:${report.identity.runId}:${checksum}:comment`,
      payload: {
        ticketKey,
        text: `Relatório de diagnóstico NodeAccess #${report.identity.runId} para ${report.identity.hostName ?? `host #${report.identity.hostId}`}. Status: ${report.identity.status}. Evidências: ${report.evidence.completed}/${report.evidence.total} concluídas, ${report.evidence.failed} falhas. SHA-256: ${checksum}. Relatório: ${input.reportUrl}`,
      },
    })
    if (input.includeAttachment) {
      queuedActions.push('ATTACH_DIAGNOSTIC_REPORT')
      await this.jiraInteractionRepo.enqueue({
        tenantId: input.tenantId,
        interactionId: interaction.id,
        action: 'ATTACH_DIAGNOSTIC_REPORT',
        idempotencyKey: `diagnostic:${report.identity.runId}:${checksum}:attachment`,
        payload: { ticketKey, fileName: `nodeaccess-diagnostic-${report.identity.runId}.json`, reportJson: JSON.stringify(report, null, 2) },
      })
    }
    await this.logRepo.logAdminEvent({
      adminId: input.userId,
      action: 'DIAGNOSTIC_RUN_JIRA_PUBLICATION_QUEUED',
      targetType: 'DiagnosticRun',
      targetId: report.identity.runId,
      details: JSON.stringify({ ticketKey, checksum, queuedActions }),
    })
    return { ticketKey, checksum, queuedActions }
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

function parseStoredJiraConfig(raw: string | null | undefined): StoredJiraConfig {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as StoredJiraConfig
  } catch {
    return {}
  }
}

function assertTrustedReportUrl(value: string, runId: number): void {
  const url = new URL(value)
  const allowedOrigins = new Set([env.APP_URL, env.APP_FRONTEND_URL].filter(Boolean).map((item) => new URL(item!).origin))
  if (!allowedOrigins.has(url.origin) || !url.pathname.includes(`diagnostic-runs/${runId}`)) {
    throw new ValidationError('URL do relatório não pertence ao NodeAccess configurado')
  }
}
