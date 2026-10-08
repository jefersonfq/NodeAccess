import { sendPublicWebhook } from '../../shared/webhook-http.js'
import { randomUUID } from 'node:crypto'
import { logger } from '../../config/logger.js'
import type { WebhookRepository } from './webhook.repository.js'
import type { WebhookSignerService } from './webhook-signer.service.js'
import { decrypt } from '../../shared/crypto.js'
import { assertNotSsrfUrl } from '../../shared/ssrf-guard.js'

const BACKOFF_DELAYS_MS = [0, 30_000, 120_000, 600_000, 3_600_000]

function nextDelay(attempt: number): number {
  return BACKOFF_DELAYS_MS[attempt] ?? BACKOFF_DELAYS_MS[BACKOFF_DELAYS_MS.length - 1]!
}

export class WebhookDispatcherService {
  private running = false
  private inFlight: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly repo: WebhookRepository,
    private readonly signer: WebhookSignerService,
  ) {}

  start(intervalMs = 5_000): void {
    if (this.running) return
    this.running = true
    logger.info('WebhookDispatcher iniciado')
    const tick = async (): Promise<void> => {
      try {
        this.inFlight = (async (): Promise<void> => { await this.processOutbox(); if (this.running) await this.dispatchPending() })()
        await this.inFlight
      } catch (err) {
        logger.error(err, 'Erro no WebhookDispatcher')
      } finally {
        this.inFlight = null
        if (this.running) this.timer = setTimeout(() => { void tick() }, intervalMs)
      }
    }
    this.timer = setTimeout(() => { void tick() }, intervalMs)
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    await this.inFlight
  }

  private async processOutbox(): Promise<void> {
    const events = await this.repo.findUnprocessedOutbox(50)
    for (const evt of events) {
      try {
        const subs = await this.repo.findActiveSubscriptionsByEvent(evt.tenantId, evt.eventType)
        for (const sub of subs) {
          const idempotencyKey = `${evt.id}:${sub.id}`
          await this.repo.createDelivery({
            subscriptionId: sub.id,
            tenantId:       evt.tenantId,
            eventId:        `evt_${randomUUID().replace(/-/g, '')}`,
            eventType:      evt.eventType,
            eventVersion:   evt.eventVersion,
            resourceType:   evt.resourceType,
            resourceId:     evt.resourceId,
            payloadJson:    evt.eventPayloadJson,
            idempotencyKey,
            nextAttemptAt:  new Date(),
          })
        }
        await this.repo.markOutboxProcessed(evt.id)
      } catch (err) {
        logger.error({ err, outboxId: evt.id }, 'Erro ao processar evento do outbox')
      }
    }
  }

  private async dispatchPending(): Promise<void> {
    const deliveries = await this.repo.findPendingDeliveries(10)
    await Promise.allSettled(deliveries.map((d: Awaited<ReturnType<WebhookRepository['findPendingDeliveries']>>[number]) => this.dispatch(d)))
  }

  private async dispatch(delivery: Awaited<ReturnType<WebhookRepository['findPendingDeliveries']>>[number]): Promise<void> {
    const sub = delivery.subscription
    const claimToken = randomUUID()
    if (!await this.repo.claimDelivery(delivery.id, claimToken, sub.timeoutMs)) return
    const update = async (data: Parameters<WebhookRepository['updateDelivery']>[1]): Promise<Awaited<ReturnType<WebhookRepository['updateDelivery']>>> => {
      const result = await this.repo.updateDelivery(delivery.id, data, claimToken)
      if (result && 'count' in result && result.count === 0) throw new Error('WEBHOOK_LEASE_LOST')
      return result
    }
    const now = Date.now()

    // SSRF guard — bloqueia entrega para IPs privados sem retry
    try {
      await assertNotSsrfUrl(sub.targetUrl)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Endereço bloqueado por política de segurança'
      await update({
        status: 'DEAD', lastAttemptAt: new Date(),
        attemptCount: delivery.attemptCount + 1,
        lastErrorCode: 'SSRF_BLOCKED', lastErrorMessage: msg,
      })
      await this.repo.updateSubscription(delivery.subscriptionId, delivery.tenantId, {
        lastTriggeredAt: new Date(), lastFailureAt: new Date(), status: 'FAILED' as const,
      })
      logger.warn({ deliveryId: delivery.id, url: sub.targetUrl }, 'Entrega bloqueada por proteção SSRF')
      return
    }


    let secret: string | null = null
    if (sub.secretEncrypted && sub.secretIv) {
      try { secret = decrypt({ encrypted: sub.secretEncrypted, iv: sub.secretIv }) } catch {
        await update({ status: 'DEAD', nextAttemptAt: null, lastErrorCode: 'SECRET_DECRYPT_FAILED', lastErrorMessage: 'Unable to read signing secret' })
        await this.repo.updateSubscription(delivery.subscriptionId, delivery.tenantId, { status: 'FAILED', lastFailureAt: new Date() })
        return
      }
    }

    const timestamp = Math.floor(now / 1000)
    const signature = secret
      ? this.signer.sign(secret, delivery.id, timestamp, delivery.payloadJson)
      : ''

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-NodeAccess-Event': delivery.eventType,
      'X-NodeAccess-Delivery': String(delivery.id),
      ...(secret ? this.signer.buildHeaders(delivery.eventType, delivery.id, signature, timestamp) : {}),
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), sub.timeoutMs)
    const start = Date.now()

    try {
      const res = await sendPublicWebhook(sub.targetUrl, {
        redirect: 'error',
        method:  sub.httpMethod,
        headers,
        body:    delivery.payloadJson,
        signal:  controller.signal,
      })

      const latency = Date.now() - start
      const snippet = res.snippet
      controller.abort()
      clearTimeout(timeout)
      const success = res.status >= 200 && res.status < 300

      if (success) {
        await update({
          status:              'DELIVERED',
          responseStatus:      res.status,
          responseLatencyMs:   latency,
          responseBodySnippet: snippet,
          attemptCount:        delivery.attemptCount + 1,
        })
        await this.repo.updateSubscription(delivery.subscriptionId, delivery.tenantId, {
          lastTriggeredAt: new Date(),
          lastSuccessAt:   new Date(),
        })
      } else {
        const attempt = delivery.attemptCount + 1
        const dead = attempt >= sub.maxRetries || [400, 401, 403, 404, 410, 422].includes(res.status)
        const delay = nextDelay(attempt)

        await update({
          status:              dead ? 'DEAD' : 'RETRY_SCHEDULED',
          responseStatus:      res.status,
          responseLatencyMs:   latency,
          responseBodySnippet: snippet,
          attemptCount:        attempt,
          nextAttemptAt:       dead ? null : new Date(Date.now() + delay),
          lastErrorCode:       String(res.status),
          lastErrorMessage:    `HTTP ${res.status}`,
        })
        await this.repo.updateSubscription(delivery.subscriptionId, delivery.tenantId, {
          lastTriggeredAt: new Date(),
          lastFailureAt:   new Date(),
          ...(dead ? { status: 'FAILED' as const } : {}),
        })
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'WEBHOOK_LEASE_LOST') { controller.abort(); clearTimeout(timeout); return }
      controller.abort()
      clearTimeout(timeout)
      const attempt = delivery.attemptCount + 1
      const dead    = attempt >= sub.maxRetries
      const delay   = nextDelay(attempt)
      const msg     = err instanceof Error ? err.message : String(err)

      await update({
        status:          dead ? 'DEAD' : 'RETRY_SCHEDULED',
        attemptCount:    attempt,
        nextAttemptAt:   dead ? null : new Date(Date.now() + delay),
        lastErrorCode:   'NETWORK_ERROR',
        lastErrorMessage: msg.slice(0, 512),
      })
      await this.repo.updateSubscription(delivery.subscriptionId, delivery.tenantId, {
        lastTriggeredAt: new Date(),
        lastFailureAt:   new Date(),
      })

      logger.warn({ err, deliveryId: delivery.id }, 'Falha ao entregar webhook')
    }
  }
}
