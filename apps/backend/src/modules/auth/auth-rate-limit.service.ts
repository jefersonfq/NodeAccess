import { createHmac } from 'node:crypto'
import type { Redis } from 'ioredis'
import { TooManyRequestsError } from '../../shared/errors.js'

export interface AuthRateLimitInput {
  action: 'lookup' | 'login' | 'mfa' | 'refresh' | 'logout' | 'email_otp' | 'google' | 'oidc_begin' | 'oidc_complete'
  ip: string
  tenant?: string
  identity?: string
}

interface RateLimitDimension {
  key: string
  limit: number
}

export interface AuthRateLimitConfig {
  windowSeconds: number
  ip: number
  tenant: number
  identity: number
  keySecret: string
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

export class AuthRateLimitService {
  constructor(
    private readonly redis: Redis,
    private readonly limits: AuthRateLimitConfig,
  ) {}

  async check(input: AuthRateLimitInput): Promise<void> {
    const tenant = input.tenant ? normalize(input.tenant) : ''
    const dimensions: RateLimitDimension[] = [
      { key: this.key(input.action, 'ip', normalize(input.ip)), limit: this.limits.ip },
    ]

    if (tenant) {
      dimensions.push({ key: this.key(input.action, 'tenant', tenant), limit: this.limits.tenant })
    }
    if (input.identity) {
      dimensions.push({
        key: this.key(input.action, 'identity', `${tenant}:${normalize(input.identity)}`),
        limit: this.limits.identity,
      })
    }

    const transaction = this.redis.multi()
    for (const dimension of dimensions) {
      transaction.incr(dimension.key)
      transaction.expire(dimension.key, this.limits.windowSeconds)
    }
    const results = await transaction.exec()
    if (!results) throw new Error('Redis transaction failed while applying authentication rate limit')

    const blocked = dimensions.some((dimension, index) => {
      const increment = results[index * 2]
      const expiration = results[(index * 2) + 1]
      if (!increment || increment[0]) throw increment?.[0] ?? new Error('Missing authentication rate limit result')
      if (!expiration || expiration[0] || Number(expiration[1]) !== 1) {
        throw expiration?.[0] ?? new Error('Authentication rate limit expiration failed')
      }
      return Number(increment[1]) > dimension.limit
    })
    if (blocked) throw new TooManyRequestsError()
  }

  private key(action: AuthRateLimitInput['action'], dimension: string, value: string): string {
    const reference = createHmac('sha256', this.limits.keySecret)
      .update(`nodeaccess:auth-rate:${value}`)
      .digest('hex')
      .slice(0, 32)
    return `auth:rate:${action}:${dimension}:${reference}`
  }
}
