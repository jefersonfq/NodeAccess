import { randomUUID } from 'node:crypto'
import { NotFoundError } from '../../shared/errors.js'
import { encrypt, decrypt } from '../../shared/crypto.js'
import { assertNotSsrfUrl } from '../../shared/ssrf-guard.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { WebhookRepository } from './webhook.repository.js'
import type { WebhookSignerService } from './webhook-signer.service.js'
import type { WebhookDomainEvent } from './webhook.types.js'
import type {
  CreateWebhookSubscriptionDto,
  UpdateWebhookSubscriptionDto,
  WebhookSubscriptionPublic,
  WebhookDeliveryPublic,
  WebhookDeliveryStatus,
  WebhookTestResult,
} from '@nodeaccess/shared'

function buildPublicEnvelope(event: WebhookDomainEvent) {
  return {
    id:            `evt_${randomUUID().replace(/-/g, '')}`,
    type:          event.eventType,
    version:       event.eventVersion,
    occurredAt:    event.occurredAt.toISOString(),
    tenantId:      String(event.tenantId),
    environment:   process.env.NODE_ENV ?? 'production',
    correlationId: event.correlationId ?? null,
    resource: {
      type: event.resourceType,
      id:   event.resourceId,
    },
    data: event.data,
  }
}

export class WebhookService {
  constructor(
    private readonly repo: WebhookRepository,
    private readonly signer: WebhookSignerService,
    private readonly logRepo: LogRepository,
  ) {}

  async listSubscriptions(tenantId: number): Promise<WebhookSubscriptionPublic[]> {
    return this.repo.listSubscriptions(tenantId)
  }

  async getSubscription(id: number, tenantId: number): Promise<WebhookSubscriptionPublic> {
    const sub = await this.repo.findSubscriptionById(id, tenantId)
    if (!sub) throw new NotFoundError('Webhook subscription not found')
    const subs = await this.repo.listSubscriptions(tenantId)
    return subs.find((s) => s.id === id)!
  }

  async createSubscription(
    tenantId: number,
    userId: number,
    dto: CreateWebhookSubscriptionDto,
  ): Promise<WebhookSubscriptionPublic> {
    let secretEncrypted: string | undefined
    let secretIv: string | undefined

    if (dto.secret) {
      const enc = encrypt(dto.secret)
      secretEncrypted = enc.encrypted
      secretIv        = enc.iv
    }

    const row = await this.repo.createSubscription({
      tenantId,
      name:                dto.name,
      targetUrl:           dto.targetUrl,
      httpMethod:          dto.httpMethod ?? 'POST',
      subscribedEventsJson: JSON.stringify(dto.subscribedEvents),
      payloadMode:         dto.payloadMode ?? 'AUTOMATIC',
      timeoutMs:           dto.timeoutMs ?? 5000,
      maxRetries:          dto.maxRetries ?? 5,
      createdByUserId:     userId,
      ...(dto.description ? { description: dto.description } : {}),
      ...(secretEncrypted ? { secretEncrypted } : {}),
      ...(secretIv ? { secretIv } : {}),
      ...(dto.payloadTemplateJson ? { payloadTemplateJson: dto.payloadTemplateJson } : {}),
      ...(dto.payloadSchemaJson ? { payloadSchemaJson: dto.payloadSchemaJson } : {}),
    })

    await this.logRepo.logAdminEvent({
      adminId:    userId,
      action:     'WEBHOOK_SUBSCRIPTION_CREATED',
      targetType: 'webhook_subscription',
      targetId:   row.id,
      details:    JSON.stringify({ name: row.name, targetUrl: row.targetUrl }),
    })

    return this.getSubscription(row.id, tenantId)
  }

  async updateSubscription(
    id: number,
    tenantId: number,
    userId: number,
    dto: UpdateWebhookSubscriptionDto,
  ): Promise<WebhookSubscriptionPublic> {
    const existing = await this.repo.findSubscriptionById(id, tenantId)
    if (!existing) throw new NotFoundError('Webhook subscription not found')

    let secretEncrypted: string | null | undefined = undefined
    let secretIv: string | null | undefined = undefined

    if (dto.secret !== undefined) {
      if (dto.secret) {
        const enc = encrypt(dto.secret)
        secretEncrypted = enc.encrypted
        secretIv        = enc.iv
      } else {
        secretEncrypted = null
        secretIv        = null
      }
    }

    await this.repo.updateSubscription(id, tenantId, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description ?? null } : {}),
      ...(dto.targetUrl !== undefined ? { targetUrl: dto.targetUrl } : {}),
      ...(dto.httpMethod !== undefined ? { httpMethod: dto.httpMethod } : {}),
      ...(dto.subscribedEvents !== undefined ? { subscribedEventsJson: JSON.stringify(dto.subscribedEvents) } : {}),
      ...(secretEncrypted !== undefined ? { secretEncrypted } : {}),
      ...(secretIv !== undefined ? { secretIv } : {}),
      ...(dto.payloadMode !== undefined ? { payloadMode: dto.payloadMode } : {}),
      ...(dto.payloadTemplateJson !== undefined ? { payloadTemplateJson: dto.payloadTemplateJson ?? null } : {}),
      ...(dto.payloadSchemaJson !== undefined ? { payloadSchemaJson: dto.payloadSchemaJson ?? null } : {}),
      ...(dto.timeoutMs !== undefined ? { timeoutMs: dto.timeoutMs } : {}),
      ...(dto.maxRetries !== undefined ? { maxRetries: dto.maxRetries } : {}),
      updatedByUserId: userId,
    })

    await this.logRepo.logAdminEvent({
      adminId:    userId,
      action:     'WEBHOOK_SUBSCRIPTION_UPDATED',
      targetType: 'webhook_subscription',
      targetId:   id,
      details:    JSON.stringify({ name: dto.name ?? existing.name }),
    })

    return this.getSubscription(id, tenantId)
  }

  async pauseSubscription(id: number, tenantId: number, userId: number): Promise<void> {
    const existing = await this.repo.findSubscriptionById(id, tenantId)
    if (!existing) throw new NotFoundError('Webhook subscription not found')
    await this.repo.updateSubscription(id, tenantId, { status: 'PAUSED' })
    await this.logRepo.logAdminEvent({
      adminId:    userId,
      action:     'WEBHOOK_SUBSCRIPTION_PAUSED',
      targetType: 'webhook_subscription',
      targetId:   id,
    })
  }

  async activateSubscription(id: number, tenantId: number, userId: number): Promise<void> {
    const existing = await this.repo.findSubscriptionById(id, tenantId)
    if (!existing) throw new NotFoundError('Webhook subscription not found')
    await this.repo.updateSubscription(id, tenantId, { status: 'ACTIVE' })
    await this.logRepo.logAdminEvent({
      adminId:    userId,
      action:     'WEBHOOK_SUBSCRIPTION_ACTIVATED',
      targetType: 'webhook_subscription',
      targetId:   id,
    })
  }

  async rotateSecret(id: number, tenantId: number, userId: number): Promise<{ secret: string }> {
    const existing = await this.repo.findSubscriptionById(id, tenantId)
    if (!existing) throw new NotFoundError('Webhook subscription not found')

    const newSecret = this.signer.generateSecret()
    const enc = encrypt(newSecret)
    await this.repo.updateSubscription(id, tenantId, {
      secretEncrypted: enc.encrypted,
      secretIv:        enc.iv,
      updatedByUserId: userId,
    })

    await this.logRepo.logAdminEvent({
      adminId:    userId,
      action:     'WEBHOOK_SECRET_ROTATED',
      targetType: 'webhook_subscription',
      targetId:   id,
    })

    return { secret: newSecret }
  }

  async deleteSubscription(id: number, tenantId: number, userId: number): Promise<void> {
    const existing = await this.repo.findSubscriptionById(id, tenantId)
    if (!existing) throw new NotFoundError('Webhook subscription not found')
    await this.repo.deleteSubscription(id, tenantId)
    await this.logRepo.logAdminEvent({
      adminId:    userId,
      action:     'WEBHOOK_SUBSCRIPTION_DELETED',
      targetType: 'webhook_subscription',
      targetId:   id,
      details:    JSON.stringify({ name: existing.name }),
    })
  }

  async listDeliveries(
    subscriptionId: number,
    tenantId: number,
    opts?: { status?: WebhookDeliveryStatus },
  ): Promise<WebhookDeliveryPublic[]> {
    const sub = await this.repo.findSubscriptionById(subscriptionId, tenantId)
    if (!sub) throw new NotFoundError('Webhook subscription not found')
    return this.repo.listDeliveries(subscriptionId, tenantId, opts)
  }

  async retryDelivery(deliveryId: number, tenantId: number): Promise<void> {
    await this.repo.updateDelivery(deliveryId, {
      status:       'PENDING',
      nextAttemptAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: null,
    })
  }

  async publishEvent(event: WebhookDomainEvent): Promise<void> {
    const envelope = buildPublicEnvelope(event)
    await this.repo.createOutboxEvent({
      tenantId:         event.tenantId,
      eventType:        event.eventType,
      eventVersion:     event.eventVersion,
      resourceType:     event.resourceType,
      resourceId:       event.resourceId,
      eventPayloadJson: JSON.stringify(envelope),
      occurredAt:       event.occurredAt,
      ...(event.correlationId !== undefined ? { correlationId: event.correlationId } : {}),
    })
  }

  async getDecryptedSecret(id: number, tenantId: number): Promise<string | null> {
    const sub = await this.repo.findSubscriptionById(id, tenantId)
    if (!sub || !sub.secretEncrypted || !sub.secretIv) return null
    return decrypt({ encrypted: sub.secretEncrypted, iv: sub.secretIv })
  }

  async testDelivery(id: number, tenantId: number): Promise<WebhookTestResult> {
    const sub = await this.repo.findSubscriptionById(id, tenantId)
    if (!sub) throw new NotFoundError('Webhook subscription not found')

    try {
      await assertNotSsrfUrl(sub.targetUrl)
    } catch (err) {
      return { ok: false, status: null, latencyMs: 0, snippet: null, error: err instanceof Error ? err.message : String(err) }
    }

    const timestamp = Math.floor(Date.now() / 1000)
    const payload = JSON.stringify({
      id:          `test_${randomUUID().replace(/-/g, '')}`,
      type:        'webhook.test',
      version:     1,
      occurredAt:  new Date().toISOString(),
      tenantId:    String(tenantId),
      environment: process.env.NODE_ENV ?? 'production',
      correlationId: null,
      resource: { type: 'webhook_subscription', id: String(id) },
      data: { message: 'NodeAccess webhook connectivity test', subscriptionId: id },
    })

    let secret: string | null = null
    if (sub.secretEncrypted && sub.secretIv) {
      try { secret = decrypt({ encrypted: sub.secretEncrypted, iv: sub.secretIv }) } catch {}
    }

    const signature = secret ? this.signer.sign(secret, 0, timestamp, payload) : ''
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(secret ? this.signer.buildHeaders('webhook.test', 0, signature, timestamp) : {}),
    }

    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), sub.timeoutMs)
    const start = Date.now()

    try {
      const res = await fetch(sub.targetUrl, {
        method: sub.httpMethod,
        headers,
        body: payload,
        signal: controller.signal,
      })
      clearTimeout(timeoutHandle)
      const latencyMs = Date.now() - start
      const snippet = (await res.text().catch(() => '')).slice(0, 512)
      return { ok: res.status >= 200 && res.status < 300, status: res.status, latencyMs, snippet: snippet || null, error: null }
    } catch (err) {
      clearTimeout(timeoutHandle)
      return { ok: false, status: null, latencyMs: Date.now() - start, snippet: null, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
