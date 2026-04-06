import { env } from '../../config/env.js'
import { logger } from '../../config/logger.js'
import type { IntegrationRepository } from '../integrations/integration.repository.js'
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
    await this.repo.markProcessing(job.id)

    try {
      const integration = await this.integrations.findByProvider(job.tenantId, 'openai')
      if (!integration?.enabled || !integration.config) {
        throw new Error('Integração OpenAI indisponível para o tenant')
      }

      const config = parseOpenAiConfig(integration.config)
      const apiKey = this.openai.decryptApiKey(config)
      const context = await this.sessionAuditService.buildAiSummaryContext(job.tenantId, job.sessionId)

      const summaryInput = {
        apiKey,
        model: job.model ?? config.defaultModel ?? 'gpt-5-mini',
        template: normalizePromptTemplate(job.promptVersion),
        sessionContext: {
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
          commands: context.commands.map((command) => ({
            index: command.index,
            command: command.command,
            submittedAt: command.submittedAt,
            output: truncateText(command.output, 3000),
            confidence: command.confidence,
          })),
          preview: context.preview.map((event) => ({
            seq: event.seq,
            timestamp: event.timestamp,
            type: event.type,
            text: truncateText(event.text ?? '', 2000),
            bytes: event.bytes,
            cols: event.cols,
            rows: event.rows,
          })),
        },
      }

      const result = await this.openai.summarizeSessionAudit(
        config.baseUrl ? { ...summaryInput, baseUrl: config.baseUrl } : summaryInput,
      )

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
} {
  try {
    return JSON.parse(value) as {
      apiKeyEncrypted?: string
      apiKeyIv?: string
      baseUrl?: string
      defaultModel?: string
    }
  } catch {
    return {}
  }
}

function truncateText(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}\n...[truncated]`
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
