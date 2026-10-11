import { Prisma, type PrismaClient, type JiraInteraction, type JiraInteractionSession, type JiraOutboxEvent } from '@prisma/client'

export class JiraInteractionRepository {
  constructor(private readonly db: PrismaClient) {}

  upsert(input: { id: string; tenantId: number; userId: number; hostId: number; ticketKey: string | null; ticketUrl?: string | null; ticketSummary?: string | null; ticketStatus?: string | null; breakGlass?: boolean; breakGlassReason?: string | null }): Promise<JiraInteraction> {
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

  findForUser(id: string, tenantId: number, userId: number): Promise<JiraInteraction | null> {
    return this.db.jiraInteraction.findFirst({ where: { id, tenantId, userId } })
  }

  findRecentByTicket(input: { tenantId: number; hostId: number; ticketKey: string; userId?: number }): Promise<JiraInteraction | null> {
    return this.db.jiraInteraction.findFirst({
      where: {
        tenantId: input.tenantId,
        hostId: input.hostId,
        ticketKey: input.ticketKey,
        ...(input.userId !== undefined ? { userId: input.userId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    })
  }

  attachSession(interactionId: string, sessionId: number): Promise<JiraInteractionSession> {
    return this.db.jiraInteractionSession.upsert({ where: { sessionId }, create: { interactionId, sessionId }, update: { interactionId } })
  }

  close(id: string, tenantId: number, userId: number): Promise<Prisma.BatchPayload> {
    return this.db.jiraInteraction.updateMany({ where: { id, tenantId, userId, state: 'OPEN' }, data: { state: 'CLOSED', explicitlyClosedAt: new Date() } })
  }

  async enqueue(input: { tenantId: number; interactionId: string; action: string; idempotencyKey: string; payload: Record<string, unknown> }): Promise<JiraOutboxEvent> {
    try { return await this.db.jiraOutboxEvent.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      create: { tenantId: input.tenantId, interactionId: input.interactionId, action: input.action, idempotencyKey: input.idempotencyKey, payloadJson: input.payload as Prisma.InputJsonValue },
      update: {},
    }) } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
      const winner = await this.db.jiraOutboxEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
      if (!winner) throw error
      return winner
    }
  }

  listDue(limit = 25): Promise<JiraOutboxEvent[]> {
    const now = new Date()
    return this.db.jiraOutboxEvent.findMany({ where: { OR: [
      { status: { in: ['PENDING', 'RETRY'] }, nextAttemptAt: { lte: now } },
      { status: 'PROCESSING', leaseUntil: { lte: now } },
    ] }, orderBy: { id: 'asc' }, take: limit })
  }

  async claimOutbox(id: number, claimToken: string): Promise<boolean> {
    const now = new Date()
    const result = await this.db.jiraOutboxEvent.updateMany({ where: { id, OR: [
      { status: { in: ['PENDING', 'RETRY'] }, nextAttemptAt: { lte: now } },
      { status: 'PROCESSING', leaseUntil: { lte: now } },
    ] }, data: { status: 'PROCESSING', claimToken, leaseUntil: new Date(now.getTime() + 300_000) } })
    return result.count === 1
  }

  completeOutbox(id: number, claimToken: string): Promise<Prisma.BatchPayload> {
    return this.db.jiraOutboxEvent.updateMany({ where: { id, claimToken, leaseUntil: { gt: new Date() } }, data: { status: 'COMPLETED', completedAt: new Date(), lastError: null, claimToken: null, leaseUntil: null } })
  }

  retryOutbox(id: number, attempts: number, error: string, claimToken: string, permanent = false): Promise<Prisma.BatchPayload> {
    const delayMs = Math.min(15 * 60_000, 2 ** Math.min(attempts, 10) * 1_000) * (0.8 + Math.random() * 0.4)
    return this.db.jiraOutboxEvent.updateMany({ where: { id, claimToken, leaseUntil: { gt: new Date() } }, data: { status: permanent || attempts >= 8 ? 'FAILED' : 'RETRY', attempts, lastError: error.slice(0, 500), nextAttemptAt: new Date(Date.now() + delayMs), claimToken: null, leaseUntil: null } })
  }
}
