import { createHmac } from 'node:crypto'
import type { Redis } from 'ioredis'
import { TooManyRequestsError } from '../../shared/errors.js'

/** Separate keys: trial writes cannot exhaust normal login/MFA budgets. */
export class TrialWriteLimiter {
  constructor(private readonly redis: Redis, private readonly secret: string) {}
  async check(input: { tenantId: number; userId: number; ip: string }): Promise<void> {
    const dimensions: Array<[string, number]> = [[`user:${input.tenantId}:${input.userId}`, 30], [`tenant:${input.tenantId}`, 60], [`ip:${input.ip}`, 120]]
    const transaction = this.redis.multi()
    for (const [dimension] of dimensions) {
      const key = `trial:writes:${createHmac('sha256', this.secret).update(dimension).digest('hex')}`
      transaction.incr(key); transaction.expire(key, 60)
    }
    const result = await transaction.exec()
    if (!result) throw new Error('Trial write limiter unavailable')
    const exceeded = dimensions.some(([,limit], index) => {
      const count = result[index * 2], ttl = result[index * 2 + 1]
      if (!count || count[0] || !ttl || ttl[0] || Number(ttl[1]) !== 1) throw new Error('Trial write limiter unavailable')
      return Number(count[1]) > limit
    })
    if (exceeded) throw new TooManyRequestsError()
  }
}
