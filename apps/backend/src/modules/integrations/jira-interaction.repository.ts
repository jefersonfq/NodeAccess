import type { Prisma, PrismaClient } from '@prisma/client'

export class JiraInteractionRepository {
  constructor(private readonly db: PrismaClient) {}

  upsert(input: { id: string; tenantId: number; userId: number; hostId: number; ticketKey: string | null; ticketUrl?: string | null; ticketSummary?: string | null; ticketStatus?: string | null; breakGlass?: boolean; breakGlassReason?: string | null }) {
    const data = {
      tenantId: input.tenantId,
      userId: input.userId,
      hostId: input.hostId,
      ticketKey: input.ticketKey,
      ticketUrl: input.ticketUrl ?? null,
      ticketSummary: input.ticketSummary ?? null,
      ticketStatus: input.ticketStatus ?? null,
      ...(input.breakGlass !== undefined ? { breakGlass: input.breakGlass } : {}),
      ...(input.breakGlassReason !== undefined ? { breakGlassReason: input.breakGlassReason } : {}),
    }
    return this.db.jiraInteraction.upsert({ where: { id: input.id }, create: { id: input.id, ...data }, update: data })
  }

  findForUser(id: string, tenantId: number, userId: number) {
    return this.db.jiraInteraction.findFirst({ where: { id, tenantId, userId } })
  }

  attachSession(interactionId: string, sessionId: number) {
    return this.db.jiraInteractionSession.upsert({ where: { sessionId }, create: { interactionId, sessionId }, update: { interactionId } })
  }

  close(id: string, tenantId: number, userId: number) {
    return this.db.jiraInteraction.updateMany({ where: { id, tenantId, userId, state: 'OPEN' }, data: { state: 'CLOSED', explicitlyClosedAt: new Date() } })
  }

  enqueue(input: { tenantId: number; interactionId: string; action: string; idempotencyKey: string; payload: Record<string, unknown> }) {
    return this.db.jiraOutboxEvent.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      create: { tenantId: input.tenantId, interactionId: input.interactionId, action: input.action, idempotencyKey: input.idempotencyKey, payloadJson: input.payload as Prisma.InputJsonValue },
      update: {},
    })
  }

  listDue(limit = 25) {
    return this.db.jiraOutboxEvent.findMany({ where: { status: { in: ['PENDING', 'RETRY'] }, nextAttemptAt: { lte: new Date() } }, orderBy: { id: 'asc' }, take: limit })
  }

  completeOutbox(id: number) {
    return this.db.jiraOutboxEvent.update({ where: { id }, data: { status: 'COMPLETED', completedAt: new Date(), lastError: null } })
  }

  retryOutbox(id: number, attempts: number, error: string) {
    const delayMs = Math.min(15 * 60_000, 2 ** Math.min(attempts, 8) * 1_000)
    return this.db.jiraOutboxEvent.update({ where: { id }, data: { status: 'RETRY', attempts, lastError: error.slice(0, 500), nextAttemptAt: new Date(Date.now() + delayMs) } })
  }
}
