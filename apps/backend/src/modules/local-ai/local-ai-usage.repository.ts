import { Prisma, type PrismaClient } from '@prisma/client'
import type { LocalAiProviderAttempt, LocalAiRoutedProvider } from './local-ai-provider-router.js'

export interface RecordLocalAiUsageInput {
  tenantId: number
  purpose: string
  attempts: LocalAiProviderAttempt[]
  models: Record<LocalAiRoutedProvider, string>
  usage?: { inputTokens?: number; outputTokens?: number }
  occurredAt?: Date
}

interface EffectivePrice {
  version: string
  inputRate: bigint
  outputRate: bigint
}

export class LocalAiUsageRepository {
  constructor(private readonly db: PrismaClient) {}

  async record(input: RecordLocalAiUsageInput): Promise<{ estimatedUsdMicros: number | null }> {
    const occurredAt = input.occurredAt ?? new Date()
    const usageDate = new Date(Date.UTC(
      occurredAt.getUTCFullYear(),
      occurredAt.getUTCMonth(),
      occurredAt.getUTCDate(),
    ))

    let interactionEstimate: bigint | null = null
    for (const attempt of input.attempts) {
      const model = input.models[attempt.provider]
      const succeeded = attempt.status === 'succeeded'
      const usage = succeeded ? input.usage : undefined
      const price = succeeded
        ? await this.findEffectivePrice(attempt.provider, model, occurredAt)
        : null
      const estimatedUsdMicros = price
        ? estimateUsdMicros(usage, price.inputRate, price.outputRate)
        : null
      if (succeeded) interactionEstimate = estimatedUsdMicros

      await this.db.$executeRaw(Prisma.sql`
        INSERT INTO local_ai_provider_usage_daily (
          tenant_id, usage_date, provider, model, purpose, pricing_version,
          request_count, success_count, failure_count, circuit_open_count,
          rate_limited_count, timeout_count, unavailable_count,
          input_tokens, output_tokens, total_latency_ms, estimated_usd_micros,
          created_at, updated_at
        ) VALUES (
          ${input.tenantId}, ${usageDate}, ${attempt.provider}, ${model}, ${input.purpose}, ${price?.version ?? 'unpriced'},
          1, ${succeeded ? 1 : 0}, ${attempt.status === 'failed' ? 1 : 0}, ${attempt.status === 'circuit_open' ? 1 : 0},
          ${attempt.errorKind === 'rate_limited' ? 1 : 0}, ${attempt.errorKind === 'timeout' ? 1 : 0}, ${attempt.errorKind === 'unavailable' ? 1 : 0},
          ${usage?.inputTokens ?? 0}, ${usage?.outputTokens ?? 0}, ${attempt.durationMs}, ${estimatedUsdMicros},
          ${occurredAt}, ${occurredAt}
        )
        ON DUPLICATE KEY UPDATE
          request_count = request_count + VALUES(request_count),
          success_count = success_count + VALUES(success_count),
          failure_count = failure_count + VALUES(failure_count),
          circuit_open_count = circuit_open_count + VALUES(circuit_open_count),
          rate_limited_count = rate_limited_count + VALUES(rate_limited_count),
          timeout_count = timeout_count + VALUES(timeout_count),
          unavailable_count = unavailable_count + VALUES(unavailable_count),
          input_tokens = input_tokens + VALUES(input_tokens),
          output_tokens = output_tokens + VALUES(output_tokens),
          total_latency_ms = total_latency_ms + VALUES(total_latency_ms),
          estimated_usd_micros = CASE
            WHEN VALUES(estimated_usd_micros) IS NULL THEN estimated_usd_micros
            ELSE COALESCE(estimated_usd_micros, 0) + VALUES(estimated_usd_micros)
          END,
          updated_at = VALUES(updated_at)
      `)
    }
    return { estimatedUsdMicros: interactionEstimate === null ? null : safeNumber(interactionEstimate) }
  }

  async reserveMonthlyRequest(tenantId: number, limit: number, now = new Date()): Promise<{ allowed: boolean; used: number; limit: number }> {
    const periodMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        INSERT IGNORE INTO local_ai_budget_counters
          (tenant_id, period_month, request_count, created_at, updated_at)
        VALUES (${tenantId}, ${periodMonth}, 0, ${now}, ${now})
      `)
      const rows = await tx.$queryRaw<Array<{ requestCount: bigint }>>(Prisma.sql`
        SELECT request_count AS requestCount
        FROM local_ai_budget_counters
        WHERE tenant_id = ${tenantId} AND period_month = ${periodMonth}
        FOR UPDATE
      `)
      const used = safeNumber(rows[0]?.requestCount ?? 0n)
      if (used >= limit) return { allowed: false, used, limit }
      await tx.$executeRaw(Prisma.sql`
        UPDATE local_ai_budget_counters
        SET request_count = request_count + 1, updated_at = ${now}
        WHERE tenant_id = ${tenantId} AND period_month = ${periodMonth}
      `)
      return { allowed: true, used: used + 1, limit }
    })
  }

  async summarize(tenantId: number, days: number, now = new Date()) {
    const safeDays = Math.min(366, Math.max(1, Math.trunc(days)))
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const from = new Date(to)
    from.setUTCDate(from.getUTCDate() - safeDays + 1)
    const rows = await this.db.$queryRaw<Array<{
      provider: LocalAiRoutedProvider
      model: string
      requests: bigint
      successes: bigint
      failures: bigint
      circuitOpen: bigint
      rateLimited: bigint
      timeouts: bigint
      unavailable: bigint
      inputTokens: bigint
      outputTokens: bigint
      totalLatencyMs: bigint
      estimatedUsdMicros: bigint | null
      pricedRows: bigint
    }>>(Prisma.sql`
      SELECT provider, model,
        SUM(request_count) AS requests,
        SUM(success_count) AS successes,
        SUM(failure_count) AS failures,
        SUM(circuit_open_count) AS circuitOpen,
        SUM(rate_limited_count) AS rateLimited,
        SUM(timeout_count) AS timeouts,
        SUM(unavailable_count) AS unavailable,
        SUM(input_tokens) AS inputTokens,
        SUM(output_tokens) AS outputTokens,
        SUM(total_latency_ms) AS totalLatencyMs,
        SUM(estimated_usd_micros) AS estimatedUsdMicros,
        SUM(CASE WHEN pricing_version <> 'unpriced' THEN request_count ELSE 0 END) AS pricedRows
      FROM local_ai_provider_usage_daily
      WHERE tenant_id = ${tenantId} AND usage_date BETWEEN ${from} AND ${to}
      GROUP BY provider, model
      ORDER BY requests DESC, provider, model
    `)
    const providers = rows.map((row) => ({
      provider: row.provider,
      model: row.model,
      requests: safeNumber(row.requests),
      successes: safeNumber(row.successes),
      failures: safeNumber(row.failures),
      circuitOpen: safeNumber(row.circuitOpen),
      rateLimited: safeNumber(row.rateLimited),
      timeouts: safeNumber(row.timeouts),
      unavailable: safeNumber(row.unavailable),
      inputTokens: safeNumber(row.inputTokens),
      outputTokens: safeNumber(row.outputTokens),
      averageLatencyMs: safeNumber(row.requests) ? Math.round(safeNumber(row.totalLatencyMs) / safeNumber(row.requests)) : 0,
      estimatedUsdMicros: row.estimatedUsdMicros === null ? null : safeNumber(row.estimatedUsdMicros),
      priced: safeNumber(row.pricedRows) === safeNumber(row.requests),
    }))
    const sum = (key: 'requests' | 'successes' | 'failures' | 'inputTokens' | 'outputTokens') => providers.reduce((total, row) => total + row[key], 0)
    const allPriced = providers.every((row) => row.priced)
    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      days: safeDays,
      providers,
      totals: {
        requests: sum('requests'), successes: sum('successes'), failures: sum('failures'),
        inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'),
        estimatedUsdMicros: allPriced ? providers.reduce((total, row) => total + (row.estimatedUsdMicros ?? 0), 0) : null,
        unpricedRequests: providers.filter((row) => !row.priced).reduce((total, row) => total + row.requests, 0),
      },
    }
  }

  private async findEffectivePrice(provider: string, model: string, at: Date): Promise<EffectivePrice | null> {
    const rows = await this.db.$queryRaw<Array<{
      version: string
      inputRate: bigint
      outputRate: bigint
    }>>(Prisma.sql`
      SELECT
        version,
        input_usd_micros_per_million AS inputRate,
        output_usd_micros_per_million AS outputRate
      FROM ai_model_prices
      WHERE provider = ${provider}
        AND model = ${model}
        AND effective_from <= ${at}
        AND (effective_until IS NULL OR effective_until > ${at})
      ORDER BY effective_from DESC, id DESC
      LIMIT 1
    `)
    return rows[0] ?? null
  }
}

function safeNumber(value: bigint): number {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : Number.MAX_SAFE_INTEGER
}

export function estimateUsdMicros(
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
  inputUsdMicrosPerMillion: bigint,
  outputUsdMicrosPerMillion: bigint,
): bigint {
  const input = BigInt(Math.max(0, Math.trunc(usage?.inputTokens ?? 0)))
  const output = BigInt(Math.max(0, Math.trunc(usage?.outputTokens ?? 0)))
  return ((input * inputUsdMicrosPerMillion) + (output * outputUsdMicrosPerMillion) + 500_000n) / 1_000_000n
}
