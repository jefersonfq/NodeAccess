import { Prisma, type PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'

export type AiInteractionChannel = 'assistant' | 'terminal' | 'diagnostic' | 'audit' | 'mcp' | 'api'

export interface RecordAiInteractionInput {
  tenantId: number
  userId: number
  channel: AiInteractionChannel
  purpose: string
  provider: string
  model: string
  routingPolicy: string
  status: 'succeeded' | 'failed' | 'cancelled'
  hostId?: number | null
  sessionId?: number | null
  ticketKey?: string | null
  contextCategories?: string[]
  contextChars?: number
  tools?: string[]
  redactionCount?: number
  latencyMs?: number
  inputTokens?: number
  outputTokens?: number
  errorKind?: string | null
  estimatedUsdMicros?: number | null
  scriptArtifactId?: number | null
  actionRunId?: number | null
  retentionDays?: number
  correlationId?: string
  occurredAt?: Date
}

export class AiInteractionRepository {
  static readonly DEFAULT_RETENTION_DAYS = 30

  constructor(private readonly db: PrismaClient) {}

  async record(input: RecordAiInteractionInput): Promise<string> {
    const correlationId = input.correlationId ?? randomUUID()
    const occurredAt = input.occurredAt ?? new Date()
    const retentionDays = Math.min(365, Math.max(1, Math.trunc(input.retentionDays ?? AiInteractionRepository.DEFAULT_RETENTION_DAYS)))
    const retentionUntil = new Date(occurredAt)
    retentionUntil.setUTCDate(retentionUntil.getUTCDate() + retentionDays)
    await this.db.$executeRaw(Prisma.sql`
      INSERT INTO ai_interactions (
        correlation_id, tenant_id, user_id, channel, purpose, provider, model,
        routing_policy, status, host_id, session_id, ticket_key,
        context_categories, context_chars, tools, redaction_count, latency_ms,
        input_tokens, output_tokens, error_kind, estimated_usd_micros, script_artifact_id, action_run_id, retention_until, created_at
      ) VALUES (
        ${correlationId}, ${input.tenantId}, ${input.userId}, ${input.channel}, ${input.purpose},
        ${input.provider}, ${input.model}, ${input.routingPolicy}, ${input.status},
        ${input.hostId ?? null}, ${input.sessionId ?? null}, ${input.ticketKey ?? null},
        ${JSON.stringify(input.contextCategories ?? [])}, ${safeInteger(input.contextChars)},
        ${JSON.stringify(input.tools ?? [])}, ${safeInteger(input.redactionCount)}, ${safeInteger(input.latencyMs)},
        ${safeInteger(input.inputTokens)}, ${safeInteger(input.outputTokens)}, ${input.errorKind ?? null}, ${input.estimatedUsdMicros ?? null},
        ${input.scriptArtifactId ?? null}, ${input.actionRunId ?? null},
        ${retentionUntil}, ${occurredAt}
      )
    `)
    return correlationId
  }

  async listRecent(tenantId: number, limit = 50) {
    const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)))
    const now = new Date()
    const rows = await this.db.$queryRaw<Array<{
      id: bigint; correlationId: string; channel: AiInteractionChannel; purpose: string; provider: string; model: string
      routingPolicy: string; status: 'succeeded' | 'failed' | 'cancelled'; hostId: number | null; sessionId: number | null
      ticketKey: string | null; contextCategories: string | null; contextChars: number; tools: string | null
      redactionCount: number; latencyMs: number; inputTokens: number; outputTokens: number; errorKind: string | null
      estimatedUsdMicros: bigint | null; scriptArtifactId: number | null; actionRunId: number | null
      retentionUntil: Date; createdAt: Date
    }>>(Prisma.sql`
      SELECT id, correlation_id AS correlationId, channel, purpose, provider, model,
        routing_policy AS routingPolicy, status, host_id AS hostId, session_id AS sessionId,
        ticket_key AS ticketKey, context_categories AS contextCategories, context_chars AS contextChars,
        tools, redaction_count AS redactionCount, latency_ms AS latencyMs,
        input_tokens AS inputTokens, output_tokens AS outputTokens, error_kind AS errorKind,
        estimated_usd_micros AS estimatedUsdMicros, script_artifact_id AS scriptArtifactId, action_run_id AS actionRunId,
        retention_until AS retentionUntil, created_at AS createdAt
      FROM ai_interactions
      WHERE tenant_id = ${tenantId} AND retention_until >= ${now}
      ORDER BY created_at DESC, id DESC
      LIMIT ${safeLimit}
    `)
    return rows.map((row) => ({
      ...row,
      id: row.id.toString(),
      contextCategories: parseStringArray(row.contextCategories),
      tools: parseStringArray(row.tools),
      estimatedUsdMicros: row.estimatedUsdMicros === null ? null : safeNumber(row.estimatedUsdMicros),
      retentionUntil: row.retentionUntil.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }))
  }

  async purgeExpired(now = new Date()): Promise<number> {
    return this.db.$executeRaw(Prisma.sql`DELETE FROM ai_interactions WHERE retention_until < ${now}`)
  }

  async linkArtifacts(input: { tenantId: number; correlationId: string; scriptArtifactId?: number; actionRunId?: number }): Promise<void> {
    await this.db.$executeRaw(Prisma.sql`
      UPDATE ai_interactions SET
        script_artifact_id = COALESCE(${input.scriptArtifactId ?? null}, script_artifact_id),
        action_run_id = COALESCE(${input.actionRunId ?? null}, action_run_id)
      WHERE tenant_id = ${input.tenantId} AND correlation_id = ${input.correlationId}
    `)
  }
}

function safeInteger(value?: number) {
  return Math.max(0, Math.trunc(value ?? 0))
}

function safeNumber(value: bigint) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : Number.MAX_SAFE_INTEGER
}

function parseStringArray(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}
