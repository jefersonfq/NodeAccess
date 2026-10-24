import { describe, expect, it } from 'vitest'
import type { Redis } from 'ioredis'
import { TrialWriteLimiter } from './trial-write-limiter.js'

function fixture(fail = false): { limiter: TrialWriteLimiter; keys: Set<string> } {
  const counts = new Map<string, number>(), keys = new Set<string>()
  const redis = { multi(): unknown {
    const calls: Array<[string, string]> = []
    const transaction = {
      incr(key: string): typeof transaction { calls.push(['incr', key]); keys.add(key); return transaction },
      expire(key: string, seconds: number): typeof transaction { expect(seconds).toBe(60); calls.push(['expire', key]); return transaction },
      exec(): Promise<Array<[Error | null, number]>> {
        return Promise.resolve(calls.map(([command,key]): [Error | null, number] => {
          if (fail) return [new Error('unavailable'), 0]
          if (command === 'expire') return [null,1]
          const count = (counts.get(key) ?? 0) + 1; counts.set(key,count); return [null,count]
        }))
      },
    }
    return transaction
  } } as unknown as Redis
  return { limiter: new TrialWriteLimiter(redis,'test-secret-not-a-production-credential'), keys }
}
describe('trial write budgets', () => {
  it('limits repeated writes per user while another participant retains a budget', async () => {
    const { limiter,keys } = fixture()
    for (let index = 0; index < 30; index++) await limiter.check({ tenantId: 2,userId: 3,ip: '192.0.2.1' })
    await expect(limiter.check({ tenantId: 2,userId: 3,ip: '192.0.2.1' })).rejects.toMatchObject({ statusCode: 429 })
    await expect(limiter.check({ tenantId: 2,userId: 4,ip: '192.0.2.1' })).resolves.toBeUndefined()
    expect([...keys].every(key => /^trial:writes:[a-f0-9]{64}$/.test(key))).toBe(true)
    expect([...keys].some(key => key.includes('192.0.2.1') || key.startsWith('auth:'))).toBe(false)
  })
  it('does not silently allow writes when Redis cannot enforce the budget', async () => {
    await expect(fixture(true).limiter.check({ tenantId: 2,userId: 3,ip: '192.0.2.1' })).rejects.toThrow('unavailable')
  })
})
