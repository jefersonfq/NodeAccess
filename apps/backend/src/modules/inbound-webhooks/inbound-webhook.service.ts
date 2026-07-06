import { createHash, randomBytes } from 'node:crypto'
import { NotFoundError, ValidationError } from '../../shared/errors.js'
import { encrypt, decrypt } from '../../shared/crypto.js'
import type { LogRepository } from '../logs/log.repository.js'
import type { InboundWebhookRepository } from './inbound-webhook.repository.js'
import type { InboundWebhookSignatureService } from './inbound-webhook-signature.service.js'
import type {
  CreateInboundWebhookEndpointDto,
  InboundWebhookEndpointCreated,
  InboundWebhookEndpointPublic,
  InboundWebhookIngestResult,
  InboundWebhookReceiptPublic,
  InboundWebhookReceiptStatus,
  UpdateInboundWebhookEndpointDto,
} from '@nodeaccess/shared'

interface IngestInput {
  provider: string
  endpointToken: string
  body: unknown
  headers: Record<string, string | string[] | undefined>
  sourceIp?: string
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function generateToken(): string {
  return `inwh_${randomBytes(32).toString('base64url')}`
}

function stablePayload(body: unknown): string {
  return JSON.stringify(body ?? {})
}

function readHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(value)) return value[0]
  return value
}

function bodyRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function eventTypeFromBody(body: unknown, headers: Record<string, string | string[] | undefined>): string {
  const record = bodyRecord(body)
  return (
    readString(record.type) ??
    readString(record.eventType) ??
    readHeader(headers, 'x-nodeaccess-event') ??
    'unknown'
  )
}

function externalEventIdFromBody(body: unknown, headers: Record<string, string | string[] | undefined>): string | undefined {
  const record = bodyRecord(body)
  return readString(record.id) ?? readString(record.eventId) ?? readHeader(headers, 'x-nodeaccess-event-id')
}

function correlationIdFromBody(body: unknown, headers: Record<string, string | string[] | undefined>): string | undefined {
  const record = bodyRecord(body)
  return readString(record.correlationId) ?? readHeader(headers, 'x-correlation-id')
}

function normalizeReceivedEvent(input: {
  provider: string
  tenantId: number
  eventType: string
  externalEventId?: string | undefined
  correlationId?: string | undefined
  body: unknown
}) {
  return {
    id: input.externalEventId ?? null,
    provider: input.provider,
    type: input.eventType,
    occurredAt: new Date().toISOString(),
    tenantId: input.tenantId,
    correlationId: input.correlationId ?? null,
    resource: bodyRecord(input.body).resource ?? null,
    data: input.body,
  }
}

export class InboundWebhookService {
  constructor(
    private readonly repo: InboundWebhookRepository,
    private readonly signature: InboundWebhookSignatureService,
    private readonly logRepo: LogRepository,
  ) {}

  async listEndpoints(tenantId: number): Promise<InboundWebhookEndpointPublic[]> {
    return this.repo.listEndpoints(tenantId)
  }

  async createEndpoint(
    tenantId: number,
    userId: number,
    dto: CreateInboundWebhookEndpointDto,
  ): Promise<InboundWebhookEndpointCreated> {
    const endpointToken = generateToken()
    const endpointTokenHash = sha256(endpointToken)
    const encryptedSecret = dto.secret ? encrypt(dto.secret) : null

    const row = await this.repo.createEndpoint({
      tenantId,
      provider: dto.provider,
      name: dto.name,
      ...(dto.description ? { description: dto.description } : {}),
      endpointTokenHash,
      ...(encryptedSecret ? { secretEncrypted: encryptedSecret.encrypted, secretIv: encryptedSecret.iv } : {}),
      allowedEventTypesJson: JSON.stringify(dto.allowedEventTypes ?? []),
      mappingMode: dto.mappingMode ?? 'GENERIC',
      createdByUserId: userId,
    })

    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'INBOUND_WEBHOOK_ENDPOINT_CREATED',
      targetType: 'inbound_webhook_endpoint',
      targetId: row.id,
      details: JSON.stringify({ provider: row.provider, name: row.name }),
    })

    return { endpoint: await this.getEndpoint(row.id, tenantId), endpointToken }
  }

  async updateEndpoint(
    id: number,
    tenantId: number,
    userId: number,
    dto: UpdateInboundWebhookEndpointDto,
  ): Promise<InboundWebhookEndpointPublic> {
    const existing = await this.repo.findEndpointById(id, tenantId)
    if (!existing) throw new NotFoundError('Inbound webhook endpoint')

    let secretEncrypted: string | null | undefined
    let secretIv: string | null | undefined
    if (dto.secret !== undefined) {
      if (dto.secret) {
        const enc = encrypt(dto.secret)
        secretEncrypted = enc.encrypted
        secretIv = enc.iv
      } else {
        secretEncrypted = null
        secretIv = null
      }
    }

    await this.repo.updateEndpoint(id, tenantId, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(secretEncrypted !== undefined ? { secretEncrypted } : {}),
      ...(secretIv !== undefined ? { secretIv } : {}),
      ...(dto.allowedEventTypes !== undefined ? { allowedEventTypesJson: JSON.stringify(dto.allowedEventTypes) } : {}),
      ...(dto.mappingMode !== undefined ? { mappingMode: dto.mappingMode } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      updatedByUserId: userId,
    })

    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: 'INBOUND_WEBHOOK_ENDPOINT_UPDATED',
      targetType: 'inbound_webhook_endpoint',
      targetId: id,
      details: JSON.stringify({ provider: existing.provider, name: dto.name ?? existing.name }),
    })

    return this.getEndpoint(id, tenantId)
  }

  async setEndpointStatus(
    id: number,
    tenantId: number,
    userId: number,
    status: 'ACTIVE' | 'PAUSED' | 'REVOKED',
  ): Promise<void> {
    const existing = await this.repo.findEndpointById(id, tenantId)
    if (!existing) throw new NotFoundError('Inbound webhook endpoint')

    await this.repo.updateEndpoint(id, tenantId, { status, updatedByUserId: userId })
    await this.logRepo.logAdminEvent({
      adminId: userId,
      action: `INBOUND_WEBHOOK_ENDPOINT_${status}`,
      targetType: 'inbound_webhook_endpoint',
      targetId: id,
      details: JSON.stringify({ provider: existing.provider, name: existing.name }),
    })
  }

  async getEndpoint(id: number, tenantId: number): Promise<InboundWebhookEndpointPublic> {
    const endpoint = (await this.repo.listEndpoints(tenantId)).find((item) => item.id === id)
    if (!endpoint) throw new NotFoundError('Inbound webhook endpoint')
    return endpoint
  }

  async listReceipts(
    endpointId: number,
    tenantId: number,
    opts?: { status?: InboundWebhookReceiptStatus },
  ): Promise<InboundWebhookReceiptPublic[]> {
    const endpoint = await this.repo.findEndpointById(endpointId, tenantId)
    if (!endpoint) throw new NotFoundError('Inbound webhook endpoint')
    return this.repo.listReceipts(endpointId, tenantId, opts)
  }

  async ingest(input: IngestInput): Promise<InboundWebhookIngestResult> {
    const endpoint = await this.repo.findEndpointByTokenHash(sha256(input.endpointToken))
    if (!endpoint || endpoint.provider !== input.provider) {
      throw new NotFoundError('Inbound webhook endpoint')
    }

    const payloadJson = stablePayload(input.body)
    const payloadHash = sha256(payloadJson)
    const eventType = eventTypeFromBody(input.body, input.headers)
    const externalEventId = externalEventIdFromBody(input.body, input.headers)
    const correlationId = correlationIdFromBody(input.body, input.headers)
    const idempotencyKey = readHeader(input.headers, 'x-nodeaccess-idempotency-key')
      ?? readHeader(input.headers, 'x-idempotency-key')
      ?? externalEventId

    await this.repo.updateEndpoint(endpoint.id, endpoint.tenantId, { lastReceivedAt: new Date() })

    const reject = async (errorCode: string, errorMessage: string, signatureValid = false): Promise<InboundWebhookIngestResult> => {
      const receipt = await this.repo.createReceipt({
        tenantId: endpoint.tenantId,
        endpointId: endpoint.id,
        provider: endpoint.provider,
        externalEventId: externalEventId ?? null,
        eventType,
        idempotencyKey: idempotencyKey ?? null,
        status: 'REJECTED',
        sourceIp: input.sourceIp ?? null,
        signatureValid,
        payloadHash,
        payloadJson,
        errorCode,
        errorMessage,
        correlationId: correlationId ?? null,
        processedAt: new Date(),
      })
      await this.repo.updateEndpoint(endpoint.id, endpoint.tenantId, { lastRejectedAt: new Date() })
      return { accepted: false, duplicate: false, receiptId: receipt.id, status: 'REJECTED' }
    }

    if (endpoint.status !== 'ACTIVE') {
      return reject('ENDPOINT_NOT_ACTIVE', `Endpoint status is ${endpoint.status}`)
    }

    if (!idempotencyKey) {
      return reject('IDEMPOTENCY_KEY_REQUIRED', 'Missing X-NodeAccess-Idempotency-Key or external event id')
    }

    const duplicate = await this.repo.findReceiptByIdempotencyKey(endpoint.id, idempotencyKey)
    if (duplicate) {
      return { accepted: duplicate.status !== 'REJECTED', duplicate: true, receiptId: duplicate.id, status: duplicate.status }
    }

    let signatureValid = true
    if (endpoint.secretEncrypted && endpoint.secretIv) {
      const secret = decrypt({ encrypted: endpoint.secretEncrypted, iv: endpoint.secretIv })
      signatureValid = this.signature.verify(
        secret,
        payloadJson,
        readHeader(input.headers, 'x-nodeaccess-signature') ?? readHeader(input.headers, 'x-hub-signature-256'),
      )
      if (!signatureValid) {
        return reject('INVALID_SIGNATURE', 'Invalid or missing webhook signature', false)
      }
    }

    const allowedEvents = JSON.parse(endpoint.allowedEventTypesJson) as string[]
    if (allowedEvents.length > 0 && !allowedEvents.includes(eventType)) {
      return reject('EVENT_TYPE_NOT_ALLOWED', `Event type ${eventType} is not allowed`, signatureValid)
    }

    const normalized = normalizeReceivedEvent({
      provider: endpoint.provider,
      tenantId: endpoint.tenantId,
      eventType,
      externalEventId,
      correlationId,
      body: input.body,
    })

    const receipt = await this.repo.createReceipt({
      tenantId: endpoint.tenantId,
      endpointId: endpoint.id,
      provider: endpoint.provider,
      externalEventId: externalEventId ?? null,
      eventType,
      idempotencyKey,
      status: 'ACCEPTED',
      sourceIp: input.sourceIp ?? null,
      signatureValid,
      payloadHash,
      payloadJson,
      normalizedEventJson: JSON.stringify(normalized),
      correlationId: correlationId ?? null,
    })

    await this.repo.updateEndpoint(endpoint.id, endpoint.tenantId, { lastAcceptedAt: new Date() })
    return { accepted: true, duplicate: false, receiptId: receipt.id, status: 'ACCEPTED' }
  }

  validateCreateDto(dto: CreateInboundWebhookEndpointDto): void {
    if ((dto.allowedEventTypes ?? []).some((eventType: string) => eventType.trim() === '')) {
      throw new ValidationError('Allowed event types cannot be empty')
    }
  }
}
