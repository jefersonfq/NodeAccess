import { Prisma, type PrismaClient, type WebhookSubscription, type WebhookDelivery, type WebhookEventOutbox } from '@prisma/client'
import type {
  WebhookSubscriptionStatus,
  WebhookDeliveryStatus,
  WebhookPayloadMode,
  WebhookSubscriptionPublic,
  WebhookDeliveryPublic,
} from '@nodeaccess/shared'

function mapSubscription(row: {
  id: number
  tenantId: number
  name: string
  description: string | null
  targetUrl: string
  httpMethod: string
  status: WebhookSubscriptionStatus
  subscribedEventsJson: string
  secretEncrypted: string | null
  secretIv: string | null
  payloadMode: WebhookPayloadMode
  timeoutMs: number
  maxRetries: number
  lastTriggeredAt: Date | null
  lastSuccessAt: Date | null
  lastFailureAt: Date | null
  createdByUserId: number
  createdAt: Date
  updatedAt: Date
}): WebhookSubscriptionPublic {
  return {
    id:              row.id,
    tenantId:        row.tenantId,
    name:            row.name,
    description:     row.description,
    targetUrl:       row.targetUrl,
    httpMethod:      row.httpMethod,
    status:          row.status,
    subscribedEvents: JSON.parse(row.subscribedEventsJson) as string[],
    hasSecret:       row.secretEncrypted !== null,
    timeoutMs:       row.timeoutMs,
    maxRetries:      row.maxRetries,
    payloadMode:     row.payloadMode,
    lastTriggeredAt: row.lastTriggeredAt,
    lastSuccessAt:   row.lastSuccessAt,
    lastFailureAt:   row.lastFailureAt,
    createdByUserId: row.createdByUserId,
    createdAt:       row.createdAt,
    updatedAt:       row.updatedAt,
  }
}

function mapDelivery(row: {
  id: number
  subscriptionId: number
  tenantId: number
  eventId: string
  eventType: string
  eventVersion: number
  resourceType: string
  resourceId: string
  status: WebhookDeliveryStatus
  attemptCount: number
  nextAttemptAt: Date | null
  lastAttemptAt: Date | null
  responseStatus: number | null
  responseLatencyMs: number | null
  responseBodySnippet: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  createdAt: Date
  updatedAt: Date
}): WebhookDeliveryPublic {
  return {
    id:                  row.id,
    subscriptionId:      row.subscriptionId,
    tenantId:            row.tenantId,
    eventId:             row.eventId,
    eventType:           row.eventType,
    eventVersion:        row.eventVersion,
    resourceType:        row.resourceType,
    resourceId:          row.resourceId,
    status:              row.status,
    attemptCount:        row.attemptCount,
    nextAttemptAt:       row.nextAttemptAt,
    lastAttemptAt:       row.lastAttemptAt,
    responseStatus:      row.responseStatus,
    responseLatencyMs:   row.responseLatencyMs,
    responseBodySnippet: row.responseBodySnippet,
    lastErrorCode:       row.lastErrorCode,
    lastErrorMessage:    row.lastErrorMessage,
    createdAt:           row.createdAt,
    updatedAt:           row.updatedAt,
  }
}

export class WebhookRepository {
  constructor(private readonly db: PrismaClient) {}

  // ── Subscriptions ─────────────────────────────────────────────────────────

  async listSubscriptions(tenantId: number): Promise<WebhookSubscriptionPublic[]> {
    const rows = await this.db.webhookSubscription.findMany({
      where:   { tenantId },
      orderBy: { createdAt: 'desc' },
    })
    return rows.map(mapSubscription)
  }

  async findSubscriptionById(id: number, tenantId: number): Promise<WebhookSubscription | null> {
    return this.db.webhookSubscription.findFirst({ where: { id, tenantId } })
  }

  async findActiveSubscriptionsByEvent(tenantId: number, eventType: string): Promise<WebhookSubscription[]> {
    const subs = await this.db.webhookSubscription.findMany({
      where: { tenantId, status: 'ACTIVE' },
    })
    return subs.filter((s) => {
      const events = JSON.parse(s.subscribedEventsJson) as string[]
      return events.includes(eventType)
    })
  }

  async createSubscription(data: {
    tenantId: number
    name: string
    description?: string
    targetUrl: string
    httpMethod: string
    subscribedEventsJson: string
    secretEncrypted?: string
    secretIv?: string
    payloadMode: WebhookPayloadMode
    payloadTemplateJson?: string
    payloadSchemaJson?: string
    timeoutMs: number
    maxRetries: number
    createdByUserId: number
  }): Promise<WebhookSubscription> {
    return this.db.webhookSubscription.create({ data })
  }

  async updateSubscription(id: number, tenantId: number, data: {
    name?: string
    description?: string | null
    targetUrl?: string
    httpMethod?: string
    subscribedEventsJson?: string
    secretEncrypted?: string | null
    secretIv?: string | null
    payloadMode?: WebhookPayloadMode
    payloadTemplateJson?: string | null
    payloadSchemaJson?: string | null
    timeoutMs?: number
    maxRetries?: number
    updatedByUserId?: number
    status?: WebhookSubscriptionStatus
    lastTriggeredAt?: Date
    lastSuccessAt?: Date
    lastFailureAt?: Date
  }): Promise<Prisma.BatchPayload> {
    return this.db.webhookSubscription.updateMany({ where: { id, tenantId }, data })
  }

  async deleteSubscription(id: number, tenantId: number): Promise<Prisma.BatchPayload> {
    return this.db.webhookSubscription.deleteMany({ where: { id, tenantId } })
  }

  // ── Deliveries ────────────────────────────────────────────────────────────

  async listDeliveries(subscriptionId: number, tenantId: number, opts?: {
    status?: WebhookDeliveryStatus
    limit?: number
    beforeId?: number
  }): Promise<WebhookDeliveryPublic[]> {
    const rows = await this.db.webhookDelivery.findMany({
      where:   { subscriptionId, tenantId, ...(opts?.beforeId ? { id: { lt: opts.beforeId } } : {}), ...(opts?.status ? { status: opts.status } : {}) },
      orderBy: { id: 'desc' },
      take:    opts?.limit ?? 100,
    })
    return rows.map(mapDelivery)
  }

  async createDelivery(data: {
    subscriptionId: number
    tenantId: number
    eventId: string
    eventType: string
    eventVersion: number
    resourceType: string
    resourceId: string
    payloadJson: string
    idempotencyKey: string
    nextAttemptAt: Date
  }): Promise<WebhookDelivery> {
    try {
      return await this.db.webhookDelivery.upsert({ where: { deduplicationKey: data.idempotencyKey }, create: { ...data, deduplicationKey: data.idempotencyKey }, update: {} })
    } catch (error) {
      // Prisma may emulate upsert with SELECT + INSERT on MySQL. Resolve its race.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
      const winner = await this.db.webhookDelivery.findUnique({ where: { deduplicationKey: data.idempotencyKey } })
      if (!winner) throw error
      return winner
    }
  }

  async updateDelivery(id: number, data: {
    status?: WebhookDeliveryStatus
    attemptCount?: number
    nextAttemptAt?: Date | null
    lastAttemptAt?: Date
    responseStatus?: number | null
    responseLatencyMs?: number | null
    responseBodySnippet?: string | null
    lastErrorCode?: string | null
    lastErrorMessage?: string | null
  }, claimToken?: string): Promise<WebhookDelivery | Prisma.BatchPayload> {
    if (claimToken) return this.db.webhookDelivery.updateMany({ where: { id, claimToken, leaseUntil: { gt: new Date() } }, data: { ...data, ...(data.status && data.status !== 'PROCESSING' ? { claimToken: null, leaseUntil: null } : {}) } })
    return this.db.webhookDelivery.update({ where: { id }, data })
  }

  async findPendingDeliveries(limit = 20): Promise<Prisma.WebhookDeliveryGetPayload<{ include: { subscription: true } }>[]> {
    return this.db.webhookDelivery.findMany({
      where: {
        OR: [
          { status: { in: ['PENDING', 'RETRY_SCHEDULED'] }, nextAttemptAt: { lte: new Date() } },
          { status: 'PROCESSING', OR: [{ leaseUntil: { lte: new Date() } }, { leaseUntil: null }] },
        ],
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: limit,
      include: { subscription: true },
    })
  }

  retryDelivery(id: number, tenantId: number, subscriptionId: number): Promise<Prisma.BatchPayload> {
    return this.db.webhookDelivery.updateMany({ where: { id, tenantId, subscriptionId, OR: [{ lastErrorCode: null }, { lastErrorCode: { not: 'LEGACY_DUPLICATE' } }], status: { in: ['DEAD', 'RETRY_SCHEDULED'] } }, data: { status: 'PENDING', nextAttemptAt: new Date(), attemptCount: 0, lastErrorCode: null, lastErrorMessage: null, claimToken: null, leaseUntil: null } })
  }

  async claimDelivery(id: number, claimToken: string, timeoutMs: number): Promise<boolean> {
    const now = new Date()
    const result = await this.db.webhookDelivery.updateMany({ where: { id, OR: [
      { status: { in: ['PENDING', 'RETRY_SCHEDULED'] }, nextAttemptAt: { lte: now } },
      { status: 'PROCESSING', OR: [{ leaseUntil: { lte: now } }, { leaseUntil: null }] },
    ] }, data: { status: 'PROCESSING', claimToken, leaseUntil: new Date(now.getTime() + Math.max(300_000, timeoutMs + 60_000)), lastAttemptAt: now } })
    return result.count === 1
  }

  // ── Outbox ────────────────────────────────────────────────────────────────

  async createOutboxEvent(data: {
    tenantId: number
    eventType: string
    eventVersion: number
    resourceType: string
    resourceId: string
    eventPayloadJson: string
    occurredAt: Date
    correlationId?: string
  }): Promise<WebhookEventOutbox> {
    return this.db.webhookEventOutbox.create({ data })
  }

  async findUnprocessedOutbox(limit = 50): Promise<WebhookEventOutbox[]> {
    return this.db.webhookEventOutbox.findMany({
      where:   { processedAt: null },
      orderBy: { createdAt: 'asc' },
      take:    limit,
    })
  }

  async markOutboxProcessed(id: number): Promise<WebhookEventOutbox> {
    return this.db.webhookEventOutbox.update({
      where: { id },
      data:  { processedAt: new Date() },
    })
  }
}
