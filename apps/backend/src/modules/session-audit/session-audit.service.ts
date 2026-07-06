import type { Paginated, SessionAuditAiArtifactPublic, SessionAuditAiJobPublic, SessionAuditAiSummaryStructured, SessionAuditCommand, SessionAuditCommandParticipantStats, SessionAuditCommandStats, SessionAuditControlEpoch, SessionAuditCriticalEvent, SessionAuditEventType, SessionAuditPreviewEvent, SessionAuditPublic, SessionAuditSharedContext, SessionAuditSharedParticipant } from '@nodeaccess/shared'
import { AppError } from '../../shared/errors.js'
import type { IntegrationService } from '../integrations/integration.service.js'
import type { SharedSessionControlLeaseRow, SharedSessionParticipantRow, SharedSessionRepository } from '../shared-sessions/shared-session.repository.js'
import type { SessionAuditAiRepository } from './session-audit-ai.repository.js'
import type { SessionAuditAiService } from './session-audit-ai.service.js'
import type { SessionAuditRepository, SessionAuditListFilters, SessionAuditRow } from './session-audit.repository.js'
import type { SessionAuditStorage } from './session-audit.storage.js'
import { countSessionAuditCommands, parseSessionAuditEventsFromJsonl } from './session-audit-command-counter.js'
import {
  buildCommandTimeline,
  cleanCommandOutput,
  compactEvidence,
  dedupeCriticalEvents,
  extractLastToken,
  extractRelevantOutputLine,
  extractServiceState,
  hasMeaningfulOutput,
  inferConfidence,
  isLikelyInteractiveCommand,
  normalizeCommand,
  resolveCommand,
  stripAnsi,
  summarizeInteractiveOutput,
} from './session-audit-normalizer.js'

export interface SessionAuditAiSummaryContext {
  session: SessionAuditPublic
  commands: SessionAuditCommand[]
  preview: SessionAuditPreviewEvent[]
  criticalEvents: SessionAuditCriticalEvent[]
}

type SessionAuditAiPromptTemplate = 'summary-v1' | 'cab-v1' | 'risk-v1'

function toSessionAuditPublic(row: SessionAuditRow): SessionAuditPublic {
  return {
    sessionId: row.sessionId,
    tenantId: row.tenantId,
    userId: row.userId,
    userNameSnapshot: row.userNameSnapshot,
    userEmailSnapshot: row.userEmailSnapshot,
    hostId: row.hostId,
    hostNameSnapshot: row.hostNameSnapshot,
    hostIpSnapshot: row.hostIpSnapshot,
    hostDeleted: Boolean(row.hostDeleted),
    hostDeletedAt: row.hostDeletedAt,
    connectionMethod: row.connectionMethod,
    routeSnapshot: parseJsonObject(row.routeSnapshotJson),
    clientIp: row.clientIp,
    userAgent: row.userAgent,
    agentRemoteIp: row.agentRemoteIp,
    ticketProvider: row.ticketProvider,
    ticketKey: row.ticketKey,
    ticketUrl: row.ticketUrl,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    status: row.status,
    chunkCount: row.chunkCount,
    commandCount: row.commandCount ?? 0,
    bytesIn: Number(row.bytesIn),
    bytesOut: Number(row.bytesOut),
    aiSummaryStatus: row.aiSummaryStatus,
    aiSummaryText: row.aiSummaryText,
    aiRiskLevel: row.aiRiskLevel,
    aiSummaryStructured: parseStructuredSummary(row.aiSummaryJson),
    criticalEvents: [],
    sharedSessionContext: null,
  }
}

export class SessionAuditService {
  constructor(
    private readonly repo: SessionAuditRepository,
    private readonly storage: SessionAuditStorage,
    private readonly aiRepo?: SessionAuditAiRepository,
    private readonly aiService?: SessionAuditAiService,
    private readonly integrationService?: IntegrationService,
    private readonly sharedSessionRepo?: SharedSessionRepository,
  ) {}

  async list(tenantId: number, filters: SessionAuditListFilters): Promise<Paginated<SessionAuditPublic>> {
    const page = filters.page ?? 1
    const limit = filters.limit ?? 20
    const { rows, total } = await this.repo.findAll(tenantId, filters)
    const enrichedRows = await Promise.all(rows.map((row) => this.ensureCommandCount(tenantId, row)))
    return {
      data: enrichedRows.map(toSessionAuditPublic),
      total,
      page,
      limit,
    }
  }

  async getBySessionId(tenantId: number, sessionId: number): Promise<SessionAuditPublic> {
    const row = await this.repo.findBySessionId(tenantId, sessionId)
    if (!row) throw new AppError('Sessão auditada não encontrada', 404, 'SESSION_AUDIT_NOT_FOUND')
    const audit = await this.enrichSharedContext(toSessionAuditPublic(row))
    const commands = await this.commands(tenantId, sessionId, 200)
    return {
      ...audit,
      criticalEvents: extractCriticalEvents(commands),
    }
  }

  async download(tenantId: number, sessionId: number): Promise<{ filename: string; content: string }> {
    const row = await this.repo.findBySessionId(tenantId, sessionId)
    if (!row) throw new AppError('Sessão auditada não encontrada', 404, 'SESSION_AUDIT_NOT_FOUND')

    const chunks = await this.repo.listChunks(sessionId)
    const parts: string[] = []
    for (const chunk of chunks) {
      parts.push(await this.storage.readChunk(chunk.storageKey))
    }

    return {
      filename: `session-audit-${sessionId}.jsonl`,
      content: parts.join(''),
    }
  }

  async preview(tenantId: number, sessionId: number, limit = 200): Promise<SessionAuditPreviewEvent[]> {
    const events = await this.readEvents(tenantId, sessionId)

    if (events.length <= limit) return events
    return events.slice(events.length - limit)
  }

  async commands(tenantId: number, sessionId: number, limit = 100): Promise<SessionAuditCommand[]> {
    const events = await this.readEvents(tenantId, sessionId)
    const commands = buildCommandTimeline(events)
    if (commands.length <= limit) return commands
    return commands.slice(commands.length - limit)
  }

  async commandStats(tenantId: number, sessionId: number): Promise<SessionAuditCommandStats> {
    const row = await this.repo.findBySessionId(tenantId, sessionId)
    if (!row) throw new AppError('Sessão auditada não encontrada', 404, 'SESSION_AUDIT_NOT_FOUND')

    const audit = await this.enrichSharedContext(toSessionAuditPublic(row))
    const commands = buildCommandTimeline(await this.readEvents(tenantId, sessionId))
    return buildCommandStats(audit, commands)
  }

  async jobs(tenantId: number, sessionId: number): Promise<SessionAuditAiJobPublic[]> {
    const row = await this.repo.findBySessionId(tenantId, sessionId)
    if (!row) throw new AppError('Sessão auditada não encontrada', 404, 'SESSION_AUDIT_NOT_FOUND')

    const jobs = await this.aiRepo?.listBySessionId(tenantId, sessionId) ?? []
    return jobs.map((job) => ({
      id: job.id,
      sessionId: job.sessionId,
      tenantId: job.tenantId,
      requestedByUserId: job.requestedByUserId,
      kind: job.kind,
      triggerSource: job.triggerSource,
      provider: job.provider,
      model: job.model,
      status: job.status,
      promptVersion: job.promptVersion,
      errorMessage: job.errorMessage,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    }))
  }

  async artifacts(tenantId: number, sessionId: number): Promise<SessionAuditAiArtifactPublic[]> {
    const row = await this.repo.findBySessionId(tenantId, sessionId)
    if (!row) throw new AppError('Sessão auditada não encontrada', 404, 'SESSION_AUDIT_NOT_FOUND')

    const artifacts = await this.aiRepo?.listArtifactsBySessionId(tenantId, sessionId) ?? []
    return artifacts.map((artifact) => ({
      id: artifact.id,
      sessionId: artifact.sessionId,
      jobId: artifact.jobId,
      triggerSource: artifact.triggerSource,
      template: artifact.template,
      summaryText: artifact.summaryText,
      summaryStructured: parseStructuredSummary(artifact.summaryJson),
      riskLevel: artifact.riskLevel,
      createdAt: artifact.createdAt,
    }))
  }

  async retrySummary(tenantId: number, sessionId: number, requestedByUserId: number, template: SessionAuditAiPromptTemplate): Promise<void> {
    const row = await this.repo.findBySessionId(tenantId, sessionId)
    if (!row) throw new AppError('Sessão auditada não encontrada', 404, 'SESSION_AUDIT_NOT_FOUND')
    if (row.status !== 'COMPLETED') {
      throw new AppError('Só é possível reprocessar sessões concluídas', 409, 'SESSION_AUDIT_NOT_COMPLETED')
    }
    if (!this.aiService) {
      throw new AppError('IA da auditoria não disponível', 409, 'SESSION_AUDIT_AI_UNAVAILABLE')
    }

    await this.aiService.scheduleManualSummary(sessionId, tenantId, requestedByUserId, template)
  }

  async linkJiraTicket(tenantId: number, sessionId: number, ticketKey: string): Promise<SessionAuditPublic> {
    const row = await this.repo.findBySessionId(tenantId, sessionId)
    if (!row) throw new AppError('Sessão auditada não encontrada', 404, 'SESSION_AUDIT_NOT_FOUND')
    if (!this.integrationService) {
      throw new AppError('Integração JIRA não disponível', 409, 'JIRA_INTEGRATION_UNAVAILABLE')
    }

    const ticket = await this.integrationService.getJiraTicket(tenantId, ticketKey)
    await this.repo.linkTicket({
      tenantId,
      sessionId,
      ticketProvider: 'jira',
      ticketKey: ticket.key,
      ticketUrl: ticket.url,
    })

    return this.getBySessionId(tenantId, sessionId)
  }

  async buildAiSummaryContext(tenantId: number, sessionId: number): Promise<SessionAuditAiSummaryContext> {
    const session = await this.getBySessionId(tenantId, sessionId)
    const preview = await this.preview(tenantId, sessionId, 400)
    const commands = await this.commands(tenantId, sessionId, 100)
    const criticalEvents = extractCriticalEvents(commands)
    return {
      session,
      commands,
      preview,
      criticalEvents,
    }
  }

  async repairOrphanedRunningSessions(): Promise<number> {
    return this.repo.repairOrphanedRunningSessions()
  }

  private async readEvents(tenantId: number, sessionId: number): Promise<SessionAuditPreviewEvent[]> {
    const row = await this.repo.findBySessionId(tenantId, sessionId)
    if (!row) throw new AppError('Sessão auditada não encontrada', 404, 'SESSION_AUDIT_NOT_FOUND')

    const chunks = await this.repo.listChunks(sessionId)
    const events: SessionAuditPreviewEvent[] = []

    for (const chunk of chunks) {
      const content = await this.storage.readChunk(chunk.storageKey)
      events.push(...parseSessionAuditEventsFromJsonl(content))
    }

    return events
  }

  private async ensureCommandCount(tenantId: number, row: SessionAuditRow): Promise<SessionAuditRow> {
    if (row.commandCount !== null && row.commandCount !== undefined) return row

    const commandCount = await this.countCommands(tenantId, row.sessionId)
    await this.repo.updateCommandCount({ sessionId: row.sessionId, commandCount })
    return { ...row, commandCount }
  }

  private async countCommands(tenantId: number, sessionId: number): Promise<number> {
    try {
      return countSessionAuditCommands(await this.readEvents(tenantId, sessionId))
    } catch {
      return 0
    }
  }

  private async enrichSharedContext(audit: SessionAuditPublic): Promise<SessionAuditPublic> {
    if (!this.sharedSessionRepo) return audit

    const shared = await this.sharedSessionRepo.findBySessionId(audit.sessionId)
    if (!shared) return audit

    const [participants, controlLeases] = await Promise.all([
      this.sharedSessionRepo.findParticipants(shared.sharedSessionId),
      this.sharedSessionRepo.findControlLeases(shared.sharedSessionId),
    ])

    return {
      ...audit,
      sharedSessionContext: {
        sharedSessionId: shared.sharedSessionId,
        status: shared.status.toLowerCase() as SessionAuditSharedContext['status'],
        ownerUserId: shared.ownerUserId,
        ownerName: shared.ownerName,
        participantsCount: participants.length,
        participants: participants.map(toSharedParticipant),
        controlEpochs: controlLeases.map((lease) => toControlEpoch(lease, participants)),
      },
    }
  }
}

function toSharedParticipant(participant: SharedSessionParticipantRow): SessionAuditSharedParticipant {
  return {
    userId: participant.userId,
    name: participant.name,
    email: participant.email,
    role: participant.role === 'OWNER' ? 'owner' : 'viewer',
    joinedAt: participant.joinedAt,
    leftAt: participant.leftAt,
  }
}

function toControlEpoch(
  lease: SharedSessionControlLeaseRow,
  participants: SharedSessionParticipantRow[],
): SessionAuditControlEpoch {
  const controller = participants.find((item) => item.userId === lease.controllerUserId)
  const grantor = participants.find((item) => item.userId === lease.grantedByUserId)

  return {
    leaseId: lease.id,
    controllerUserId: lease.controllerUserId,
    controllerName: controller?.name ?? `#${lease.controllerUserId}`,
    grantedByUserId: lease.grantedByUserId,
    grantedByName: grantor?.name ?? `#${lease.grantedByUserId}`,
    startedAt: lease.startedAt,
    expiresAt: lease.expiresAt,
    endedAt: lease.endedAt,
    endReason: lease.endReason?.toLowerCase() as SessionAuditControlEpoch['endReason'],
    revokeReason: lease.revokeReason,
  }
}

function buildCommandStats(audit: SessionAuditPublic, commands: SessionAuditCommand[]): SessionAuditCommandStats {
  const participants = new Map<string, SessionAuditCommandParticipantStats>()

  for (const command of commands) {
    const actor = resolveCommandActor(audit, command)
    const existing = participants.get(actor.key)
    if (existing) {
      existing.count += 1
      continue
    }
    participants.set(actor.key, {
      ...actor,
      count: 1,
    })
  }

  return {
    total: commands.length,
    participants: [...participants.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  }
}

function resolveCommandActor(
  audit: SessionAuditPublic,
  command: SessionAuditCommand,
): Omit<SessionAuditCommandParticipantStats, 'count'> {
  const context = audit.sharedSessionContext
  const owner = {
    key: `owner:${audit.userId}`,
    userId: audit.userId,
    name: audit.userNameSnapshot || `#${audit.userId}`,
    role: 'owner' as const,
  }

  if (!context) return owner

  if (command.actorUserId) {
    const participant = context.participants.find((item) => item.userId === command.actorUserId)
    if (participant) {
      return {
        key: `${participant.role}:${participant.userId}`,
        userId: participant.userId,
        name: participant.name,
        role: participant.role,
      }
    }
  }

  const submittedAt = new Date(command.submittedAt).getTime()
  const epoch = context.controlEpochs.find((item) => {
    const start = new Date(item.startedAt).getTime()
    const end = item.endedAt
      ? new Date(item.endedAt).getTime()
      : new Date(item.expiresAt).getTime()
    return submittedAt >= start && submittedAt <= end
  })

  if (epoch) {
    return {
      key: `${context.ownerUserId === epoch.controllerUserId ? 'owner' : 'viewer'}:${epoch.controllerUserId}`,
      userId: epoch.controllerUserId,
      name: epoch.controllerName,
      role: context.ownerUserId === epoch.controllerUserId ? 'owner' : 'viewer',
    }
  }

  return owner
}

function parseStructuredSummary(value: string | null): SessionAuditAiSummaryStructured | null {
  if (!value) return null
  try {
    return JSON.parse(value) as SessionAuditAiSummaryStructured
  } catch {
    return null
  }
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function extractCriticalEvents(commands: SessionAuditCommand[]): SessionAuditCriticalEvent[] {
  const events: SessionAuditCriticalEvent[] = []

  for (const command of commands) {
    const normalized = command.command.toLowerCase()
    const output = command.output.toLowerCase()

    if (/\brm\s+-rf\b/.test(normalized)) {
      const target = extractLastToken(command.command)
      events.push({
        type: 'destructive_delete',
        severity: 'high',
        title: 'Remoção destrutiva detectada',
        summary: target
          ? `Remoção forçada executada sobre "${target}".`
          : 'Remoção forçada executada com rm -rf.',
        commandIndex: command.index,
        command: command.command,
        evidence: compactEvidence([command.command, target ? `Target: ${target}` : null]),
      })
      continue
    }

    const serviceMatch = normalized.match(/\b(?:service|systemctl)\s+([a-z0-9_.@-]+)\s+(start|stop|restart|status)\b/)
    if (serviceMatch) {
      const serviceName = serviceMatch[1] ?? 'unknown'
      const action = serviceMatch[2] ?? 'status'
      const type = action === 'start'
        ? 'service_start'
        : action === 'stop'
          ? 'service_stop'
          : action === 'restart'
            ? 'service_restart'
            : 'service_status'
      const severity = action === 'stop' || action === 'restart' ? 'high' : action === 'start' ? 'medium' : 'low'
      const finalState = extractServiceState(command.output)
      events.push({
        type,
        severity,
        title: `Serviço ${serviceName}: ${action}`,
        summary: finalState
          ? `Comando de serviço executado para "${serviceName}" com estado observado "${finalState}".`
          : `Comando de serviço executado para "${serviceName}".`,
        commandIndex: command.index,
        command: command.command,
        evidence: compactEvidence([
          command.command,
          finalState ? `Observed state: ${finalState}` : null,
          extractRelevantOutputLine(command.output, /(active|inactive|dead|stopped|started)/i),
        ]),
      })
      continue
    }

    if (/\b(chmod|chown|chgrp)\b/.test(normalized)) {
      events.push({
        type: 'permission_change',
        severity: 'high',
        title: 'Mudança de permissão ou ownership',
        summary: 'Comando de alteração de permissão ou ownership detectado.',
        commandIndex: command.index,
        command: command.command,
        evidence: compactEvidence([command.command]),
      })
      continue
    }

    if (/\b(useradd|userdel|usermod|passwd)\b/.test(normalized)) {
      events.push({
        type: 'identity_change',
        severity: 'high',
        title: 'Mudança de identidade ou credencial',
        summary: 'Comando relacionado a usuário ou senha detectado.',
        commandIndex: command.index,
        command: command.command,
        evidence: compactEvidence([command.command]),
      })
      continue
    }

    if (/\b(yum|dnf|apt|apt-get|rpm)\b/.test(normalized) && /\b(install|remove|upgrade|update|erase)\b/.test(normalized)) {
      events.push({
        type: 'package_change',
        severity: 'medium',
        title: 'Mudança de pacote detectada',
        summary: 'Comando de instalação, remoção ou atualização de pacote detectado.',
        commandIndex: command.index,
        command: command.command,
        evidence: compactEvidence([command.command]),
      })
      continue
    }

    if (/\b(vim|vi|nano)\b/.test(normalized) && hasMeaningfulOutput(command.output)) {
      events.push({
        type: 'config_edit',
        severity: 'medium',
        title: 'Edição interativa detectada',
        summary: 'Sessão de edição interativa detectada. Validar se houve alteração persistida.',
        commandIndex: command.index,
        command: command.command,
        evidence: compactEvidence([command.command, extractRelevantOutputLine(command.output, /(gravado|written|saved)/i)]),
      })
    }
  }

  return dedupeCriticalEvents(events).slice(0, 20)
}
