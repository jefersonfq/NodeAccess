import type { Paginated, SessionAuditAiArtifactPublic, SessionAuditAiJobPublic, SessionAuditAiSummaryStructured, SessionAuditCommand, SessionAuditControlEpoch, SessionAuditEventType, SessionAuditPreviewEvent, SessionAuditPublic, SessionAuditSharedContext, SessionAuditSharedParticipant } from '@nodeaccess/shared'
import { AppError } from '../../shared/errors.js'
import type { IntegrationService } from '../integrations/integration.service.js'
import type { SharedSessionControlLeaseRow, SharedSessionParticipantRow, SharedSessionRepository } from '../shared-sessions/shared-session.repository.js'
import type { SessionAuditAiRepository } from './session-audit-ai.repository.js'
import type { SessionAuditAiService } from './session-audit-ai.service.js'
import type { SessionAuditRepository, SessionAuditListFilters, SessionAuditRow } from './session-audit.repository.js'
import type { SessionAuditStorage } from './session-audit.storage.js'

export interface SessionAuditAiSummaryContext {
  session: SessionAuditPublic
  commands: SessionAuditCommand[]
  preview: SessionAuditPreviewEvent[]
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
    connectionMethod: row.connectionMethod,
    ticketProvider: row.ticketProvider,
    ticketKey: row.ticketKey,
    ticketUrl: row.ticketUrl,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    status: row.status,
    chunkCount: row.chunkCount,
    bytesIn: Number(row.bytesIn),
    bytesOut: Number(row.bytesOut),
    aiSummaryStatus: row.aiSummaryStatus,
    aiSummaryText: row.aiSummaryText,
    aiRiskLevel: row.aiRiskLevel,
    aiSummaryStructured: parseStructuredSummary(row.aiSummaryJson),
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
    return {
      data: rows.map(toSessionAuditPublic),
      total,
      page,
      limit,
    }
  }

  async getBySessionId(tenantId: number, sessionId: number): Promise<SessionAuditPublic> {
    const row = await this.repo.findBySessionId(tenantId, sessionId)
    if (!row) throw new AppError('Sessão auditada não encontrada', 404, 'SESSION_AUDIT_NOT_FOUND')
    return this.enrichSharedContext(toSessionAuditPublic(row))
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

    const updated = await this.repo.findBySessionId(tenantId, sessionId)
    if (!updated) throw new AppError('Sessão auditada não encontrada', 404, 'SESSION_AUDIT_NOT_FOUND')
    return this.enrichSharedContext(toSessionAuditPublic(updated))
  }

  async buildAiSummaryContext(tenantId: number, sessionId: number): Promise<SessionAuditAiSummaryContext> {
    const session = await this.getBySessionId(tenantId, sessionId)
    const preview = await this.preview(tenantId, sessionId, 400)
    const commands = await this.commands(tenantId, sessionId, 100)
    return {
      session,
      commands,
      preview,
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
      const lines = content.split('\n').filter(Boolean)

      for (const line of lines) {
        const event = parsePreviewLine(line)
        if (event) events.push(event)
      }
    }

    return events
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

function parseStructuredSummary(value: string | null): SessionAuditAiSummaryStructured | null {
  if (!value) return null
  try {
    return JSON.parse(value) as SessionAuditAiSummaryStructured
  } catch {
    return null
  }
}

function buildCommandTimeline(events: SessionAuditPreviewEvent[]): SessionAuditCommand[] {
  const commands: SessionAuditCommand[] = []
  let inputBuffer = ''
  let activeCommand: { command: string; submittedAt: string; output: string } | null = null

  for (const event of events) {
    if (event.type === 'stdin' && event.text) {
      const parsed = applyInputChunk(inputBuffer, event.text)
      inputBuffer = parsed.remaining

      for (const submitted of parsed.submitted) {
        if (!submitted.command.trim()) continue

        if (activeCommand) {
          commands.push(finalizeCommand(commands.length + 1, activeCommand))
        }

        activeCommand = {
          command: submitted.command,
          submittedAt: event.timestamp,
          output: '',
        }
      }
      continue
    }

    if (event.type === 'stdout' && event.text && activeCommand) {
      activeCommand.output += event.text
      continue
    }

    if ((event.type === 'session_ended' || event.type === 'session_error') && activeCommand) {
      commands.push(finalizeCommand(commands.length + 1, activeCommand))
      activeCommand = null
    }
  }

  if (activeCommand) {
    commands.push(finalizeCommand(commands.length + 1, activeCommand))
  }

  return commands
}

function applyInputChunk(currentBuffer: string, chunk: string): {
  remaining: string
  submitted: Array<{ command: string }>
} {
  const submitted: Array<{ command: string }> = []
  let buffer = currentBuffer
  const normalized = stripAnsi(chunk)

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i] ?? ''

    if (char === '\x1b') {
      const consumed = consumeEscapeSequence(normalized, i)
      i = consumed - 1
      continue
    }

    if (char === '\r' || char === '\n') {
      const command = normalizeCommand(buffer)
      if (command) submitted.push({ command })
      buffer = ''
      continue
    }

    if (char === '\b' || char === '\x7f') {
      buffer = buffer.slice(0, -1)
      continue
    }

    if (char === '\t') {
      buffer += '\t'
      continue
    }

    if (isPrintableInputChar(char)) {
      buffer += char
    }
  }

  return { remaining: buffer, submitted }
}

function finalizeCommand(index: number, input: { command: string; submittedAt: string; output: string }): SessionAuditCommand {
  const resolvedCommand = resolveCommand(input.command, input.output)
  const cleanedOutput = cleanCommandOutput(input.output, resolvedCommand)
  return {
    index,
    command: resolvedCommand,
    submittedAt: input.submittedAt,
    output: cleanedOutput,
    confidence: inferConfidence(resolvedCommand, cleanedOutput),
  }
}

function cleanCommandOutput(output: string, command: string): string {
  if (isLikelyInteractiveCommand(command)) {
    return summarizeInteractiveOutput(command, output)
  }

  const noAnsi = stripAnsi(output).replace(/\r/g, '')
  let cleaned = noAnsi.replace(/^\n+/, '')

  const commandVariants = buildEchoVariants(command)
  for (const variant of commandVariants) {
    if (cleaned.startsWith(variant)) {
      cleaned = cleaned.slice(variant.length).replace(/^\n+/, '')
      break
    }
  }

  cleaned = removeTrailingPrompt(cleaned)
  cleaned = collapseNoise(cleaned)

  return cleaned.trimEnd()
}

function summarizeInteractiveOutput(command: string, output: string): string {
  const normalized = stripAnsi(output)
    .replace(/\r/g, '\n')
    .replace(/\u001b/g, '')
    .replace(/\u009b/g, '')
  const lines = normalized
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
  const firstToken = command.trim().split(/\s+/)[0]?.toLowerCase() ?? 'comando interativo'
  const lastLines = lines.slice(-8)

  if (lastLines.length === 0) {
    return `Saída interativa contínua detectada para "${firstToken}". Use Preview/Download para a trilha bruta.`
  }

  return [
    `Saída interativa contínua detectada para "${firstToken}". Exibindo apenas as últimas linhas legíveis do buffer.`,
    '',
    ...lastLines,
  ].join('\n').trim()
}

function inferConfidence(command: string, output: string): 'low' | 'medium' | 'high' {
  if (!command.trim()) return 'low'
  if (isLikelyInteractiveCommand(command)) return 'low'
  if (output.length === 0) return 'medium'
  if (output.includes(command)) return 'medium'
  if (looksLikePrompt(output)) return 'medium'
  return 'high'
}

function stripAnsi(value: string): string {
  return value
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_][0-?]*[ -/]*[@-~]/g, '')
}

function resolveCommand(command: string, rawOutput: string): string {
  const normalizedCommand = normalizeCommand(command)
  const resolvedCdCommand = resolveCdCommand(normalizedCommand, rawOutput)
  if (resolvedCdCommand) {
    return resolvedCdCommand
  }
  return normalizedCommand
}

function resolveCdCommand(command: string, rawOutput: string): string | null {
  if (!/^cd(?:\s|$)/i.test(command)) {
    return null
  }

  const cwd = extractPromptCwd(rawOutput)
  if (!cwd) {
    return null
  }

  return normalizeCommand(`cd ${cwd}`)
}

function extractPromptCwd(rawOutput: string): string | null {
  const oscTitleMatch = rawOutput.match(/\x1b\]0;[^:\x07]*:(.+?)(?:\x07|\x1b\\)/)
  if (oscTitleMatch?.[1]) {
    return oscTitleMatch[1].trim()
  }

  const promptPathMatch = rawOutput.match(/(?:^|\r?\n)[^@\r\n]+@[^:\r\n]+:(.+?)(?:[#>$%])/)
  if (promptPathMatch?.[1]) {
    return promptPathMatch[1].trim()
  }

  return null
}

function isPrintableInputChar(char: string): boolean {
  return char >= ' ' && char !== '\u007f'
}

function consumeEscapeSequence(value: string, start: number): number {
  let i = start + 1
  while (i < value.length) {
    const char = value[i] ?? ''
    if ((char >= '@' && char <= '~') || char === '\u0007') {
      return i + 1
    }
    i += 1
  }
  return value.length
}

function normalizeCommand(value: string): string {
  return value
    .replace(/\t/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildEchoVariants(command: string): string[] {
  return [
    command,
    `${command}\n`,
    `${command}\r\n`,
    ` ${command}`,
    ` ${command}\n`,
  ]
}

function removeTrailingPrompt(value: string): string {
  const lines = value.split('\n')
  while (lines.length > 0 && looksLikePrompt(lines[lines.length - 1] ?? '')) {
    lines.pop()
  }
  return lines.join('\n')
}

function looksLikePrompt(value: string): boolean {
  const line = value.trim()
  if (!line) return false
  return /^[\w.@:/~-]+[#$>%] ?$/.test(line)
    || /^\[[^\]]+\][#$>%] ?$/.test(line)
}

function collapseNoise(value: string): string {
  return value
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
}

function isLikelyInteractiveCommand(command: string): boolean {
  const firstToken = command.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  return [
    'vim',
    'vi',
    'nano',
    'top',
    'htop',
    'less',
    'more',
    'watch',
    'tmux',
    'screen',
    'man',
  ].includes(firstToken)
}

function parsePreviewLine(line: string): SessionAuditPreviewEvent | null {
  try {
    const raw = JSON.parse(line) as {
      seq?: number
      ts?: string
      type?: SessionAuditEventType
      payload?: Record<string, unknown>
    }

    if (typeof raw.seq !== 'number' || typeof raw.ts !== 'string' || typeof raw.type !== 'string') {
      return null
    }

    const payload = raw.payload ?? {}

    return {
      seq: raw.seq,
      timestamp: raw.ts,
      type: raw.type,
      text: decodePreviewText(payload),
      bytes: typeof payload.bytes === 'number' && Number.isFinite(payload.bytes) ? payload.bytes : null,
      cols: typeof payload.cols === 'number' && Number.isFinite(payload.cols) ? payload.cols : null,
      rows: typeof payload.rows === 'number' && Number.isFinite(payload.rows) ? payload.rows : null,
    }
  } catch {
    return null
  }
}

function decodePreviewText(payload: Record<string, unknown>): string | null {
  const data = payload.data
  const encoding = payload.encoding

  if (typeof data !== 'string') return null

  if (encoding === 'base64') {
    const text = Buffer.from(data, 'base64').toString('utf-8')
    return text.length > 4000 ? `${text.slice(0, 4000)}\n...[truncated]` : text
  }

  return data
}
