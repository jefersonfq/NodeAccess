import { createHash } from 'node:crypto'
import type { CompleteAiInvestigationDto } from '@nodeaccess/shared'
import { AppError, NotFoundError } from '../../shared/errors.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { AiInvestigationRepository } from './ai-investigation.repository.js'

export class AiInvestigationService {
  constructor(private readonly repo: AiInvestigationRepository, private readonly logs: LogRepository) {}
  async start(input: { tenantId: number; userId: number; hostId: number; tokenId?: number | null; objective: string; ttlMinutes?: number }) {
    await this.repo.expire()
    const ttl = Math.min(1440, Math.max(5, input.ttlMinutes ?? 60))
    const id = await this.repo.create({ ...input, expiresAt: new Date(Date.now() + ttl * 60_000) })
    await this.audit(input.userId, 'AI_INVESTIGATION_STARTED', id, { hostId: input.hostId, tokenId: input.tokenId ?? null, ttlMinutes: ttl })
    return this.get(id, input.tenantId)
  }
  async get(id: number, tenantId: number) {
    await this.repo.expire()
    const item = await this.repo.find(id, tenantId); if (!item) throw new NotFoundError('Investigação de IA')
    return { ...item, actionRuns: await this.repo.actionRuns(id, tenantId), reports: await this.repo.reports(id) }
  }
  async list(tenantId: number) { await this.repo.expire(); return this.repo.list(tenantId) }
  async attachRun(id: number, runId: number, tenantId: number) {
    const item = await this.get(id, tenantId); if (!['OPEN','WAITING_USER'].includes(item.status)) throw new AppError('Investigação encerrada', 409, 'AI_INVESTIGATION_CLOSED')
    await this.repo.attachRun(id, runId, tenantId); await this.repo.touch(id, tenantId, 'WAITING_USER')
  }
  async complete(id: number, tenantId: number, userId: number, dto: CompleteAiInvestigationDto) {
    const item = await this.get(id, tenantId); if (!['OPEN','WAITING_USER'].includes(item.status)) throw new AppError('Investigação já encerrada', 409, 'AI_INVESTIGATION_CLOSED')
    const validRuns = new Set(item.actionRuns.map((run: { id: number }) => run.id)); if (dto.evidence.some((e) => !validRuns.has(e.actionRunId))) throw new AppError('Evidência não pertence à investigação', 400, 'AI_INVESTIGATION_INVALID_EVIDENCE')
    const sanitized = sanitizeReport(dto); const checksum = createHash('sha256').update(JSON.stringify({ ...sanitized.value, evidence: dto.evidence })).digest('hex')
    await this.repo.addReport({ investigationId: id, userId, dto, sanitized: sanitized.value, checksum, redactionApplied: sanitized.redacted })
    await this.repo.close(id, tenantId, 'COMPLETED', 'user_confirmed')
    await this.audit(userId, 'AI_INVESTIGATION_COMPLETED', id, { actionRuns: validRuns.size, checksum })
    return this.get(id, tenantId)
  }
  async abandon(id: number, tenantId: number, userId: number) {
    const item = await this.get(id, tenantId)
    if (!['OPEN', 'WAITING_USER'].includes(item.status)) throw new AppError('Investigação já encerrada', 409, 'AI_INVESTIGATION_CLOSED')
    await this.repo.close(id, tenantId, 'ABANDONED', 'user_requested')
    await this.audit(userId, 'AI_INVESTIGATION_ABANDONED', id, {})
    return this.get(id, tenantId)
  }
  private audit(userId: number, action: string, id: number, details: object) { return this.logs.logAdminEvent({ adminId: userId, action, targetType: 'AiInvestigation', targetId: id, details: JSON.stringify(details) }).catch(() => {}) }
}
function sanitizeReport(dto: CompleteAiInvestigationDto) {
  let redacted = false
  const clean = (v: string) => { const n = v.replace(/\b(password|token|secret|api[_-]?key)\s*[:=]\s*\S+/gi, '$1=[redacted]'); if (n !== v) redacted = true; return n }
  const value = { summary: clean(dto.summary), facts: dto.facts.map(clean), hypotheses: dto.hypotheses.map(clean), risks: dto.risks.map(clean), recommendations: dto.recommendations.map(clean), actions: dto.actions.map(clean) }
  return { redacted, value }
}
