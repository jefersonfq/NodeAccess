import { describe, expect, it, vi } from 'vitest'
import { TooManyRequestsError } from '../../shared/errors.js'
import { AuthRateLimitService } from './auth-rate-limit.service.js'

function makeRedis(counts: number[]) {
  const keys: string[] = []
  const transaction = {
    incr: vi.fn((key: string) => {
      keys.push(key)
      return transaction
    }),
    expire: vi.fn(() => transaction),
    exec: vi.fn().mockResolvedValue(
      counts.flatMap((count) => [[null, count], [null, 1]]),
    ),
  }
  return {
    redis: { multi: vi.fn(() => transaction) },
    transaction,
    keys,
  }
}

const limits = { windowSeconds: 60, ip: 3, tenant: 5, identity: 2 }

describe('AuthRateLimitService', () => {
  it('applies independent counters for IP, tenant and identity without exposing raw values', async () => {
    const { redis, transaction, keys } = makeRedis([1, 1, 1])
    const service = new AuthRateLimitService(redis as never, limits)

    await service.check({
      action: 'login',
      ip: '203.0.113.10',
      tenant: 'Acme',
      identity: 'Admin@Example.com',
    })

    expect(transaction.incr).toHaveBeenCalledTimes(3)
    expect(transaction.expire).toHaveBeenCalledTimes(3)
    expect(keys.every((key) => key.startsWith('auth:rate:login:'))).toBe(true)
    expect(keys.join(' ')).not.toContain('203.0.113.10')
    expect(keys.join(' ')).not.toContain('acme')
    expect(keys.join(' ')).not.toContain('admin@example.com')
  })

  it.each([
    { label: 'IP', counts: [4, 1, 1] },
    { label: 'tenant', counts: [1, 6, 1] },
    { label: 'identity', counts: [1, 1, 3] },
  ])('returns the same public error when the $label limit is exceeded', async ({ counts }) => {
    const { redis } = makeRedis(counts)
    const service = new AuthRateLimitService(redis as never, limits)

    await expect(service.check({
      action: 'login',
      ip: '203.0.113.10',
      tenant: 'acme',
      identity: 'admin@example.com',
    })).rejects.toMatchObject({
      constructor: TooManyRequestsError,
      statusCode: 429,
      code: 'TOO_MANY_REQUESTS',
      message: 'Muitas tentativas. Tente novamente mais tarde.',
    })
  })

  it('keeps action counters isolated', async () => {
    const { redis, keys } = makeRedis([1])
    const service = new AuthRateLimitService(redis as never, limits)

    await service.check({ action: 'refresh', ip: '203.0.113.10' })

    expect(keys[0]).toMatch(/^auth:rate:refresh:ip:/)
  })

  it('fails closed when Redis cannot complete the transaction', async () => {
    const redis = { multi: () => ({
      incr() { return this },
      expire() { return this },
      exec: vi.fn().mockResolvedValue(null),
    }) }
    const service = new AuthRateLimitService(redis as never, limits)

    await expect(service.check({ action: 'login', ip: '203.0.113.10' }))
      .rejects.toThrow('Redis transaction failed')
  })
})
