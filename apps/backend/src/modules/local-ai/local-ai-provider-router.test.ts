import { describe, expect, it, vi } from 'vitest'
import { LocalAiProviderRouter } from './local-ai-provider-router.js'

describe('LocalAiProviderRouter', () => {
  it('falls back in order when the preferred provider fails', async () => {
    const router = new LocalAiProviderRouter()
    const operation = vi.fn(async (provider: 'ollama' | 'openai_compatible') => {
      if (provider === 'ollama') throw new Error('local unavailable')
      return { answer: 'network answer' }
    })

    const result = await router.execute({
      tenantId: 7,
      candidates: ['ollama', 'openai_compatible'],
      operation,
    })

    expect(result.provider).toBe('openai_compatible')
    expect(result.value.answer).toBe('network answer')
    expect(result.attempts.map(({ provider, status }) => ({ provider, status }))).toEqual([
      { provider: 'ollama', status: 'failed' },
      { provider: 'openai_compatible', status: 'succeeded' },
    ])
  })

  it('opens a tenant-scoped circuit after three consecutive failures', async () => {
    const router = new LocalAiProviderRouter()
    const operation = vi.fn().mockRejectedValue(new Error('provider unavailable'))

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(router.execute({ tenantId: 7, candidates: ['ollama'], operation })).rejects.toThrow('provider unavailable')
    }

    expect(router.getCircuitStatus(7, 'ollama')).toBe('open')
    await expect(router.execute({ tenantId: 7, candidates: ['ollama'], operation })).rejects.toMatchObject({
      providerAttempts: [expect.objectContaining({ provider: 'ollama', status: 'circuit_open' })],
    })
    expect(operation).toHaveBeenCalledTimes(3)
    expect(router.getCircuitStatus(8, 'ollama')).toBe('closed')
  })

  it('closes a circuit state after a successful retry path', async () => {
    const router = new LocalAiProviderRouter()
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce({ answer: 'ok' })

    await expect(router.execute({ tenantId: 7, candidates: ['ollama'], operation })).rejects.toThrow('temporary')
    const result = await router.execute({ tenantId: 7, candidates: ['ollama'], operation })

    expect(result.value.answer).toBe('ok')
    expect(router.getCircuitStatus(7, 'ollama')).toBe('closed')
  })

  it('classifies provider failures without retaining sensitive response bodies', async () => {
    const router = new LocalAiProviderRouter()
    await expect(router.execute({
      tenantId: 7,
      candidates: ['ollama'],
      operation: async () => { throw new Error('OpenAI-compatible HTTP 429: secret response') },
    })).rejects.toMatchObject({
      providerAttempts: [expect.objectContaining({ errorKind: 'rate_limited' })],
    })
  })

  it('allows deterministic recovery after the circuit cooldown', async () => {
    let now = 1_000
    const router = new LocalAiProviderRouter({ failureThreshold: 1, cooldownMs: 500, now: () => now })
    const operation = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce('recovered')

    await expect(router.execute({ tenantId: 7, candidates: ['ollama'], operation })).rejects.toThrow('unavailable')
    expect(router.getCircuitStatus(7, 'ollama')).toBe('open')
    now += 501
    await expect(router.execute({ tenantId: 7, candidates: ['ollama'], operation })).resolves.toMatchObject({ value: 'recovered' })
    expect(router.getCircuitStatus(7, 'ollama')).toBe('closed')
  })
})
