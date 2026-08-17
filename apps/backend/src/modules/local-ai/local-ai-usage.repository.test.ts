import { describe, expect, it, vi } from 'vitest'
import { LocalAiUsageRepository, estimateUsdMicros } from './local-ai-usage.repository.js'

describe('AI provider usage pricing', () => {
  it('calculates micro-dollar estimates using the explicit model price', () => {
    expect(estimateUsdMicros(
      { inputTokens: 1_000_000, outputTokens: 500_000 },
      5_000_000n,
      30_000_000n,
    )).toBe(20_000_000n)
  })

  it('normalizes missing or invalid token counts without producing negative cost', () => {
    expect(estimateUsdMicros({ inputTokens: -10 }, 1_000_000n, 1_000_000n)).toBe(0n)
    expect(estimateUsdMicros(undefined, 1_000_000n, 1_000_000n)).toBe(0n)
  })

  it('does not expose a partial tenant cost when any provider row is unpriced', async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([
      { provider: 'ollama', model: 'qwen', requests: 2n, successes: 2n, failures: 0n, circuitOpen: 0n, rateLimited: 0n, timeouts: 0n, unavailable: 0n, inputTokens: 20n, outputTokens: 10n, totalLatencyMs: 100n, estimatedUsdMicros: null, pricedRows: 0n },
      { provider: 'openai_compatible', model: 'gpt', requests: 1n, successes: 1n, failures: 0n, circuitOpen: 0n, rateLimited: 0n, timeouts: 0n, unavailable: 0n, inputTokens: 5n, outputTokens: 2n, totalLatencyMs: 20n, estimatedUsdMicros: 30n, pricedRows: 1n },
    ]) }
    const summary = await new LocalAiUsageRepository(db as never).summarize(7, 30, new Date('2026-08-14T12:00:00Z'))
    expect(summary.totals).toMatchObject({ requests: 3, successes: 3, estimatedUsdMicros: null, unpricedRequests: 2 })
    expect(summary.providers[0]).toMatchObject({ averageLatencyMs: 50, priced: false })
  })

  it('reserves a request while holding the monthly counter transaction', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValue([{ requestCount: 4n }]),
    }
    const db = { $transaction: vi.fn((operation) => operation(tx)) }
    const result = await new LocalAiUsageRepository(db as never)
      .reserveMonthlyRequest(7, 5, new Date('2026-08-14T12:00:00Z'))

    expect(result).toEqual({ allowed: true, used: 5, limit: 5 })
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2)
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it('blocks without incrementing after the monthly limit is reached', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValue([{ requestCount: 5n }]),
    }
    const db = { $transaction: vi.fn((operation) => operation(tx)) }
    const result = await new LocalAiUsageRepository(db as never)
      .reserveMonthlyRequest(7, 5, new Date('2026-08-14T12:00:00Z'))

    expect(result).toEqual({ allowed: false, used: 5, limit: 5 })
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
  })
})
