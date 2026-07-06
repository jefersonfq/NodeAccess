import type { PrismaClient } from '@prisma/client'
import type {
  InboundWebhookEndpointPublic,
  InboundWebhookEndpointStatus,
  InboundWebhookMappingMode,
  InboundWebhookReceiptPublic,
  InboundWebhookReceiptStatus,
} from '@nodeaccess/shared'

interface EndpointRow {
  id: number
  tenantId: number
  provider: string
  name: string
  description: string | null
  endpointTokenHash: string
  secretEncrypted: string | null
  secretIv: string | null
  status: InboundWebhookEndpointStatus
  allowedEventTypesJson: string
  mappingMode: InboundWebhookMappingMode
  createdByUserId: number
  updatedByUserId: number | null
  lastReceivedAt: Date | null
  lastAcceptedAt: Date | null
  lastRejectedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

interface ReceiptRow {
  id: number
  tenantId: number
  endpointId: number
  provider: string
  externalEventId: string | null
  eventType: string
  idempotencyKey: string | null
  status: InboundWebhookReceiptStatus
  receivedAt: Date
  processedAt: Date | null
  sourceIp: string | null
  signatureValid: boolean | number
  payloadHash: string
  normalizedEventJson: string | null
  errorCode: string | null
  errorMessage: string | null
  correlationId: string | null
  createdAt: Date
  updatedAt: Date
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

function mapEndpoint(row: EndpointRow): InboundWebhookEndpointPublic {
  return {
    id: row.id,
    tenantId: row.tenantId,
    provider: row.provider,
    name: row.name,
    description: row.description,
    status: row.status,
    hasSecret: row.secretEncrypted !== null,
    allowedEventTypes: parseJsonArray(row.allowedEventTypesJson),
    mappingMode: row.mappingMode,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    lastReceivedAt: row.lastReceivedAt,
    lastAcceptedAt: row.lastAcceptedAt,
    lastRejectedAt: row.lastRejectedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function mapReceipt(row: ReceiptRow): InboundWebhookReceiptPublic {
  return {
    id: row.id,
    tenantId: row.tenantId,
    endpointId: row.endpointId,
    provider: row.provider,
    externalEventId: row.externalEventId,
    eventType: row.eventType,
    idempotencyKey: row.idempotencyKey,
    status: row.status,
    receivedAt: row.receivedAt,
    processedAt: row.processedAt,
    sourceIp: row.sourceIp,
    signatureValid: Boolean(row.signatureValid),
    payloadHash: row.payloadHash,
    normalizedEventJson: row.normalizedEventJson,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    correlationId: row.correlationId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

const endpointSelect = `
  SELECT
    id,
    tenant_id AS tenantId,
    provider,
    name,
    description,
    endpoint_token_hash AS endpointTokenHash,
    secret_encrypted AS secretEncrypted,
    secret_iv AS secretIv,
    status,
    allowed_event_types_json AS allowedEventTypesJson,
    mapping_mode AS mappingMode,
    created_by_user_id AS createdByUserId,
    updated_by_user_id AS updatedByUserId,
    last_received_at AS lastReceivedAt,
    last_accepted_at AS lastAcceptedAt,
    last_rejected_at AS lastRejectedAt,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM inbound_webhook_endpoints
`

const receiptSelect = `
  SELECT
    id,
    tenant_id AS tenantId,
    endpoint_id AS endpointId,
    provider,
    external_event_id AS externalEventId,
    event_type AS eventType,
    idempotency_key AS idempotencyKey,
    status,
    received_at AS receivedAt,
    processed_at AS processedAt,
    source_ip AS sourceIp,
    signature_valid AS signatureValid,
    payload_hash AS payloadHash,
    normalized_event_json AS normalizedEventJson,
    error_code AS errorCode,
    error_message AS errorMessage,
    correlation_id AS correlationId,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM inbound_webhook_receipts
`

export class InboundWebhookRepository {
  constructor(private readonly db: PrismaClient) {}

  async listEndpoints(tenantId: number): Promise<InboundWebhookEndpointPublic[]> {
    const rows = await this.db.$queryRawUnsafe<EndpointRow[]>(
      `${endpointSelect} WHERE tenant_id = ? ORDER BY created_at DESC`,
      tenantId,
    )
    return rows.map(mapEndpoint)
  }

  async findEndpointById(id: number, tenantId: number): Promise<EndpointRow | null> {
    const rows = await this.db.$queryRawUnsafe<EndpointRow[]>(
      `${endpointSelect} WHERE id = ? AND tenant_id = ? LIMIT 1`,
      id,
      tenantId,
    )
    return rows[0] ?? null
  }

  async findEndpointByTokenHash(endpointTokenHash: string): Promise<EndpointRow | null> {
    const rows = await this.db.$queryRawUnsafe<EndpointRow[]>(
      `${endpointSelect} WHERE endpoint_token_hash = ? LIMIT 1`,
      endpointTokenHash,
    )
    return rows[0] ?? null
  }

  async createEndpoint(data: {
    tenantId: number
    provider: string
    name: string
    description?: string
    endpointTokenHash: string
    secretEncrypted?: string
    secretIv?: string
    allowedEventTypesJson: string
    mappingMode: InboundWebhookMappingMode
    createdByUserId: number
  }): Promise<EndpointRow> {
    await this.db.$executeRawUnsafe(
      `INSERT INTO inbound_webhook_endpoints
        (tenant_id, provider, name, description, endpoint_token_hash, secret_encrypted, secret_iv, allowed_event_types_json, mapping_mode, created_by_user_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
      data.tenantId,
      data.provider,
      data.name,
      data.description ?? null,
      data.endpointTokenHash,
      data.secretEncrypted ?? null,
      data.secretIv ?? null,
      data.allowedEventTypesJson,
      data.mappingMode,
      data.createdByUserId,
    )

    const created = await this.findEndpointByTokenHash(data.endpointTokenHash)
    if (!created) throw new Error('Inbound webhook endpoint insert failed')
    return created
  }

  async updateEndpoint(id: number, tenantId: number, data: {
    name?: string
    description?: string | null
    secretEncrypted?: string | null
    secretIv?: string | null
    allowedEventTypesJson?: string
    mappingMode?: InboundWebhookMappingMode
    status?: InboundWebhookEndpointStatus
    updatedByUserId?: number
    lastReceivedAt?: Date
    lastAcceptedAt?: Date
    lastRejectedAt?: Date
  }): Promise<void> {
    const fields: string[] = []
    const values: unknown[] = []

    function set(field: string, value: unknown) {
      fields.push(`${field} = ?`)
      values.push(value)
    }

    if (data.name !== undefined) set('name', data.name)
    if (data.description !== undefined) set('description', data.description)
    if (data.secretEncrypted !== undefined) set('secret_encrypted', data.secretEncrypted)
    if (data.secretIv !== undefined) set('secret_iv', data.secretIv)
    if (data.allowedEventTypesJson !== undefined) set('allowed_event_types_json', data.allowedEventTypesJson)
    if (data.mappingMode !== undefined) set('mapping_mode', data.mappingMode)
    if (data.status !== undefined) set('status', data.status)
    if (data.updatedByUserId !== undefined) set('updated_by_user_id', data.updatedByUserId)
    if (data.lastReceivedAt !== undefined) set('last_received_at', data.lastReceivedAt)
    if (data.lastAcceptedAt !== undefined) set('last_accepted_at', data.lastAcceptedAt)
    if (data.lastRejectedAt !== undefined) set('last_rejected_at', data.lastRejectedAt)
    if (fields.length === 0) return

    fields.push('updated_at = NOW(3)')
    await this.db.$executeRawUnsafe(
      `UPDATE inbound_webhook_endpoints SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`,
      ...values,
      id,
      tenantId,
    )
  }

  async createReceipt(data: {
    tenantId: number
    endpointId: number
    provider: string
    externalEventId?: string | null
    eventType: string
    idempotencyKey?: string | null
    status: InboundWebhookReceiptStatus
    sourceIp?: string | null
    signatureValid: boolean
    payloadHash: string
    payloadJson: string
    normalizedEventJson?: string | null
    errorCode?: string | null
    errorMessage?: string | null
    correlationId?: string | null
    processedAt?: Date | null
  }): Promise<ReceiptRow> {
    await this.db.$executeRawUnsafe(
      `INSERT INTO inbound_webhook_receipts
        (tenant_id, endpoint_id, provider, external_event_id, event_type, idempotency_key, status, processed_at, source_ip, signature_valid, payload_hash, payload_json, normalized_event_json, error_code, error_message, correlation_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
      data.tenantId,
      data.endpointId,
      data.provider,
      data.externalEventId ?? null,
      data.eventType,
      data.idempotencyKey ?? null,
      data.status,
      data.processedAt ?? null,
      data.sourceIp ?? null,
      data.signatureValid,
      data.payloadHash,
      data.payloadJson,
      data.normalizedEventJson ?? null,
      data.errorCode ?? null,
      data.errorMessage ?? null,
      data.correlationId ?? null,
    )

    const rows = await this.db.$queryRawUnsafe<ReceiptRow[]>(
      `${receiptSelect} WHERE endpoint_id = ? AND payload_hash = ? ORDER BY id DESC LIMIT 1`,
      data.endpointId,
      data.payloadHash,
    )
    const created = rows[0]
    if (!created) throw new Error('Inbound webhook receipt insert failed')
    return created
  }

  async findReceiptByIdempotencyKey(endpointId: number, idempotencyKey: string): Promise<ReceiptRow | null> {
    const rows = await this.db.$queryRawUnsafe<ReceiptRow[]>(
      `${receiptSelect} WHERE endpoint_id = ? AND idempotency_key = ? LIMIT 1`,
      endpointId,
      idempotencyKey,
    )
    return rows[0] ?? null
  }

  async listReceipts(endpointId: number, tenantId: number, opts?: {
    status?: InboundWebhookReceiptStatus
    limit?: number
  }): Promise<InboundWebhookReceiptPublic[]> {
    const rows = opts?.status
      ? await this.db.$queryRawUnsafe<ReceiptRow[]>(
          `${receiptSelect} WHERE endpoint_id = ? AND tenant_id = ? AND status = ? ORDER BY received_at DESC LIMIT ?`,
          endpointId,
          tenantId,
          opts.status,
          opts.limit ?? 100,
        )
      : await this.db.$queryRawUnsafe<ReceiptRow[]>(
          `${receiptSelect} WHERE endpoint_id = ? AND tenant_id = ? ORDER BY received_at DESC LIMIT ?`,
          endpointId,
          tenantId,
          opts?.limit ?? 100,
        )
    return rows.map(mapReceipt)
  }
}
