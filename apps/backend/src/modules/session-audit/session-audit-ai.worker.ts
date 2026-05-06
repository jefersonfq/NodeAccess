import { env } from '../../config/env.js'
import { logger } from '../../config/logger.js'
import type { IntegrationRepository } from '../integrations/integration.repository.js'
import type { LocalAiIntegrationService } from '../integrations/local-ai.service.js'
import type { OpenAiIntegrationService } from '../integrations/openai.service.js'
import type { SessionAuditAiRepository, SessionAuditAiJobRow } from './session-audit-ai.repository.js'
import type { SessionAuditService } from './session-audit.service.js'

export class SessionAuditAiWorker {
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    private readonly repo: SessionAuditAiRepository,
    private readonly integrations: IntegrationRepository,
    private readonly openai: OpenAiIntegrationService,
    private readonly localAi: LocalAiIntegrationService,
    private readonly sessionAuditService: SessionAuditService,
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setTimeout(() => void this.tick(), env.SESSION_AUDIT_AI_WORKER_INITIAL_DELAY_MS)
  }

  stop(): void {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
  }

  private scheduleNext(): void {
    this.timer = setTimeout(() => void this.tick(), env.SESSION_AUDIT_AI_WORKER_POLL_MS)
  }

  private async tick(): Promise<void> {
    if (this.running) {
      this.scheduleNext()
      return
    }

    this.running = true
    try {
      const requeued = await this.repo.requeueStaleProcessingJobs(
        new Date(Date.now() - env.SESSION_AUDIT_AI_JOB_STALE_MS),
      )
      if (requeued > 0) {
        logger.warn({ count: requeued }, 'Session audit AI stale processing jobs requeued')
      }

      const jobs = await this.repo.listPendingSummaryJobs(10)
      if (jobs.length > 0) {
        logger.debug({ count: jobs.length }, 'Session audit AI worker picked pending jobs')
      }
      for (const job of jobs) {
        await this.processJob(job)
      }
    } catch (err) {
      logger.error({ err }, 'Session audit AI worker tick failed')
    } finally {
      this.running = false
      this.scheduleNext()
    }
  }

  private async processJob(job: SessionAuditAiJobRow): Promise<void> {
    if (job.triggerSource === 'AUTO_POST_SESSION' && !env.FEATURE_SESSION_AUDIT_AI_AUTO_SUMMARY) {
      await this.repo.markCanceled(job.id, 'Resumo automático de auditoria desabilitado no ambiente')
      logger.info({ jobId: job.id, sessionId: job.sessionId, tenantId: job.tenantId }, 'Session audit AI auto-summary job canceled by environment flag')
      return
    }

    await this.repo.markProcessing(job.id)

    try {
      const context = await this.sessionAuditService.buildAiSummaryContext(job.tenantId, job.sessionId)
      const summaryInput = buildSummaryInput(context)
      const result = await this.generateSummary(job, summaryInput)

      const summaryText = buildSummaryText(result)
      await this.repo.markReady(job.id, {
        summaryText,
        summaryJson: JSON.stringify(result),
        riskLevel: result.riskLevel,
      })

      logger.debug({ jobId: job.id, sessionId: job.sessionId, tenantId: job.tenantId }, 'Session audit AI summary completed')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown worker error'
      await this.repo.markFailed(job.id, message)
      logger.warn({ err, jobId: job.id, sessionId: job.sessionId, tenantId: job.tenantId }, 'Session audit AI summary failed')
    }
  }

  private async generateSummary(
    job: SessionAuditAiJobRow,
    sessionContext: {
      session: Record<string, unknown>
      commands: Array<Record<string, unknown>>
      preview: Array<Record<string, unknown>>
    },
  ) {
    if (job.provider === 'openai') {
      const integration = await this.integrations.findByProvider(job.tenantId, 'openai')
      if (!integration?.enabled || !integration.config) {
        throw new Error('Integração OpenAI indisponível para o tenant')
      }

      const config = parseOpenAiConfig(integration.config)
      const apiKey = this.openai.decryptApiKey(config)
      const summaryInput = {
        apiKey,
        model: job.model ?? config.defaultModel ?? 'gpt-5-mini',
        template: normalizePromptTemplate(job.promptVersion),
        auditInstructions: config.auditInstructions ?? null,
        sessionContext,
      }

      return this.openai.summarizeSessionAudit(
        config.baseUrl ? { ...summaryInput, baseUrl: config.baseUrl } : summaryInput,
      )
    }

    if (job.provider === 'ollama' || job.provider === 'openai_compatible') {
      const integration = await this.integrations.findByProvider(job.tenantId, 'local_ai')
      if (!integration?.enabled || !integration.config) {
        throw new Error('Integração de IA local indisponível para o tenant')
      }

      const config = this.localAi.parseConfig(integration.config)
      return this.localAi.summarizeSessionAudit({
        provider: job.provider,
        config,
        model: job.model ?? this.localAi.resolveSummaryModel(job.provider, config),
        template: normalizePromptTemplate(job.promptVersion),
        sessionContext,
      })
    }

    throw new Error(`Provider de IA da auditoria não suportado: ${job.provider}`)
  }
}

function normalizePromptTemplate(value: string | null): 'summary-v1' | 'cab-v1' | 'risk-v1' {
  if (value === 'cab-v1' || value === 'risk-v1') return value
  return 'summary-v1'
}

function parseOpenAiConfig(value: string): {
  apiKeyEncrypted?: string
  apiKeyIv?: string
  baseUrl?: string
  defaultModel?: string
  auditInstructions?: string
} {
  try {
    return JSON.parse(value) as {
      apiKeyEncrypted?: string
      apiKeyIv?: string
      baseUrl?: string
      defaultModel?: string
      auditInstructions?: string
    }
  } catch {
    return {}
  }
}

function truncateText(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n...[truncated]`
}

function buildSummaryInput(context: Awaited<ReturnType<SessionAuditService['buildAiSummaryContext']>>) {
  const preparedCommands = context.commands
    .map((command) => ({
      index: command.index,
      command: normalizeCommandText(command.command),
      submittedAt: command.submittedAt,
      output: normalizeOutputText(command.output),
      confidence: command.confidence,
    }))
    .filter((command) => command.command.length > 0)

  const prioritizedCommands = preparedCommands
    .slice()
    .sort((left, right) => scoreCommandForSummary(right) - scoreCommandForSummary(left))
    .slice(0, 20)
    .sort((left, right) => left.index - right.index)

  const riskSignals = collectRiskSignals(prioritizedCommands)
  const commandHighlights = prioritizedCommands
    .filter((command) => scoreCommandForSummary(command) >= 2)
    .slice(0, 8)
    .map((command) => ({
      index: command.index,
      command: command.command,
      confidence: command.confidence,
      reason: describeCommandRisk(command.command),
    }))

  const filteredPreview = context.preview
    .filter((event) => event.type !== 'session_started' && event.type !== 'session_ended')
    .map((event) => ({
      seq: event.seq,
      timestamp: event.timestamp,
      type: event.type,
      text: normalizeOutputText(event.text ?? '', 800),
      bytes: event.bytes,
      cols: event.cols,
      rows: event.rows,
    }))
    .filter((event) => event.text.length > 0 || event.type === 'session_error')
    .slice(-40)

  return {
    session: {
      sessionId: context.session.sessionId,
      userName: context.session.userNameSnapshot,
      userEmail: context.session.userEmailSnapshot,
      hostName: context.session.hostNameSnapshot,
      hostIp: context.session.hostIpSnapshot,
      connectionMethod: context.session.connectionMethod,
      ticketProvider: context.session.ticketProvider,
      ticketKey: context.session.ticketKey,
      startedAt: context.session.startedAt.toISOString(),
      endedAt: context.session.endedAt?.toISOString() ?? null,
      status: context.session.status,
      bytesIn: context.session.bytesIn,
      bytesOut: context.session.bytesOut,
    },
    commandStats: {
      total: preparedCommands.length,
      highConfidence: preparedCommands.filter((command) => command.confidence === 'high').length,
      risky: preparedCommands.filter((command) => scoreCommandForSummary(command) >= 3).length,
      interactive: preparedCommands.filter((command) => isInteractiveCommand(command.command)).length,
    },
    riskSignals,
    commandHighlights,
    criticalEvents: context.criticalEvents.map((event) => ({
      type: event.type,
      severity: event.severity,
      title: event.title,
      summary: event.summary,
      commandIndex: event.commandIndex,
      command: event.command,
      evidence: event.evidence,
    })),
    commands: prioritizedCommands.map((command) => ({
      index: command.index,
      command: command.command,
      submittedAt: command.submittedAt,
      output: truncateText(command.output, 1600),
      confidence: command.confidence,
    })),
    preview: filteredPreview,
  }
}

function buildSummaryText(result: {
  summary: string
  keyFindings: string[]
  nextActions: string[]
  confidence: 'low' | 'medium' | 'high'
}): string {
  const parts = [result.summary.trim()]
  if (result.keyFindings.length > 0) {
    parts.push(`Findings: ${result.keyFindings.join(' | ')}`)
  }
  if (result.nextActions.length > 0) {
    parts.push(`Next actions: ${result.nextActions.join(' | ')}`)
  }
  parts.push(`Confidence: ${result.confidence}`)
  return parts.filter(Boolean).join('\n\n')
}

function normalizeCommandText(value: string): string {
  return value
    .replace(/\u0007/g, ' ')
    .replace(/\u0008+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeOutputText(value: string, max = 2500): string {
  const cleaned = value
    .replace(/\u0007/g, ' ')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, ' ')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return truncateText(cleaned, max)
}

function scoreCommandForSummary(command: {
  command: string
  output: string
  confidence: 'low' | 'medium' | 'high'
}): number {
  const normalized = command.command.toLowerCase()
  const output = command.output.toLowerCase()
  let score = 0

  if (command.confidence === 'high') score += 2
  if (command.confidence === 'medium') score += 1
  if (isInteractiveCommand(normalized)) score -= 2
  if (/\brm\s+-rf\b|\bmkfs\b|\buserdel\b|\bshutdown\b|\breboot\b|\bpoweroff\b/.test(normalized)) score += 6
  if (/\bsystemctl\s+(stop|disable|restart)\b|\bservice\s+\S+\s+(stop|restart)\b/.test(normalized)) score += 5
  if (/\bchmod\b|\bchown\b|\bchgrp\b|\bpasswd\b|\bvisudo\b|\bsudo\b/.test(normalized)) score += 4
  if (/\bvim\b|\bvi\b|\bnano\b|\bhtop\b|\btop\b|\bless\b|\bmore\b/.test(normalized)) score -= 1
  if (/\b(error|failed|denied|stopped|removed|deleted|inactive)\b/.test(output)) score += 2
  if (/\bactive: active\b|\bstarted\b/.test(output)) score += 1

  return score
}

function isInteractiveCommand(command: string): boolean {
  return /\b(vim|vi|nano|htop|top|less|more|tail -f|watch)\b/.test(command.toLowerCase())
}

function collectRiskSignals(commands: Array<{
  index: number
  command: string
  output: string
}>): string[] {
  const signals = new Set<string>()

  for (const command of commands) {
    const normalized = command.command.toLowerCase()
    if (/\brm\s+-rf\b/.test(normalized)) {
      signals.add(`Command #${command.index} used rm -rf`)
    }
    if (/\bsystemctl\s+stop\b|\bservice\s+\S+\s+stop\b/.test(normalized)) {
      signals.add(`Command #${command.index} stopped a service`)
    }
    if (/\b(systemctl|service)\b/.test(normalized) && /\bcrond\b/.test(normalized)) {
      signals.add(`Command #${command.index} targeted the crond service`)
    }
    if (/\bchmod\b|\bchown\b|\bchgrp\b/.test(normalized)) {
      signals.add(`Command #${command.index} changed permissions or ownership`)
    }
    if (/\buser(add|del|mod)\b|\bpasswd\b/.test(normalized)) {
      signals.add(`Command #${command.index} changed account state`)
    }
  }

  return Array.from(signals).slice(0, 10)
}

function describeCommandRisk(command: string): string {
  const normalized = command.toLowerCase()
  if (/\brm\s+-rf\b/.test(normalized)) return 'destructive delete'
  if (/\bsystemctl\s+stop\b|\bservice\s+\S+\s+stop\b/.test(normalized)) return 'service interruption'
  if (/\bchmod\b|\bchown\b|\bchgrp\b/.test(normalized)) return 'permission change'
  if (/\buser(add|del|mod)\b|\bpasswd\b/.test(normalized)) return 'identity change'
  if (/\bvim\b|\bvi\b|\bnano\b/.test(normalized)) return 'interactive file edit'
  if (/\bcat\b|\bls\b|\bps\b|\bgrep\b/.test(normalized)) return 'inspection'
  return 'notable command'
}
