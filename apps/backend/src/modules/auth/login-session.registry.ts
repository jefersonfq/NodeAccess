/**
 * NA-0187 — login sessions per refresh token, kept in Redis next to `refresh:<jti>` (whose format is unchanged).
 * Lets a tenant admin see who is online, from which IP, and disconnect one session. The jti never leaves the
 * server: callers get an opaque reference (a domain-separated hash).
 */
import { createHash } from 'node:crypto'
import type { Redis } from 'ioredis'
import type { AuthMethod } from '../../shared/guards.js'

const META_PREFIX = 'login-session:'
const INDEX_PREFIX = 'login-sessions:'
const REFRESH_PREFIX = 'refresh:'
const TOUCH_INTERVAL_MS = 60_000
const INDEX_RETENTION_MS = 31 * 24 * 60 * 60 * 1000
const INDEX_SCAN_LIMIT = 5000
const USER_AGENT_MAX = 256
export const ONLINE_WINDOW_MS = 15 * 60_000
const JTI = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export interface LoginSessionRecord {
  userId: number; tenantId: number; authMethod: AuthMethod
  ip: string | null; userAgent: string | null; lastIp: string | null
  createdAt: number; lastSeenAt: number
}
export interface LoginSessionView {
  ref: string; authMethod: AuthMethod; ip: string | null; lastIp: string | null; userAgent: string | null
  createdAt: number; lastSeenAt: number; current: boolean
}
export interface LoginSessionMeta { ip?: string; userAgent?: string }

export const isLoginSessionId = (value: unknown): value is string => typeof value === 'string' && JTI.test(value)
export function loginSessionRef(jti: string): string {
  return createHash('sha256').update(`nodeaccess-login-session-ref:${jti}`).digest('hex').slice(0, 32)
}
const clip = (value: string | undefined, max: number): string | null => (value ? value.slice(0, max) : null)

function parse(raw: string | null): LoginSessionRecord | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as LoginSessionRecord
    return Number.isSafeInteger(value.userId) && Number.isSafeInteger(value.tenantId) ? value : null
  } catch { return null }
}

export class LoginSessionRegistry {
  constructor(private readonly redis: Redis, private readonly now: () => number = Date.now) {}

  /** Called once per issued refresh token. Failures are the caller's to swallow: login never depends on this record. */
  async record(jti: string, owner: { userId: number; tenantId: number; authMethod: AuthMethod }, meta: LoginSessionMeta, ttlSeconds: number): Promise<void> {
    if (!isLoginSessionId(jti) || !Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) return
    const now = this.now(), index = `${INDEX_PREFIX}${owner.tenantId}`
    const record: LoginSessionRecord = { ...owner, ip: clip(meta.ip, 64), userAgent: clip(meta.userAgent, USER_AGENT_MAX), lastIp: clip(meta.ip, 64), createdAt: now, lastSeenAt: now }
    await this.redis.multi()
      .set(`${META_PREFIX}${jti}`, JSON.stringify(record), 'EX', ttlSeconds)
      .zadd(index, now, `${owner.userId}:${jti}`)
      .zremrangebyscore(index, 0, now - INDEX_RETENTION_MS)
      .exec()
    if (await this.redis.ttl(index) < ttlSeconds) await this.redis.expire(index, ttlSeconds)
  }

  /**
   * On refresh: last use and last IP, at most once a minute unless the IP changed. A session opened before
   * NA-0187 has no record yet; it gets one here, valid for what is left of its refresh token.
   */
  async touch(jti: string, owner: { userId: number; tenantId: number; authMethod: AuthMethod }, meta: LoginSessionMeta): Promise<void> {
    if (!isLoginSessionId(jti)) return
    const record = parse(await this.redis.get(`${META_PREFIX}${jti}`))
    if (!record) {
      const ttl = await this.redis.ttl(`${REFRESH_PREFIX}${jti}`)
      if (ttl > 0) await this.record(jti, owner, meta, ttl)
      return
    }
    if (record.userId !== owner.userId || record.tenantId !== owner.tenantId) return
    const now = this.now(), ip = clip(meta.ip, 64) ?? record.lastIp
    if (now - record.lastSeenAt < TOUCH_INTERVAL_MS && ip === record.lastIp) return
    await this.redis.multi()
      // XX: a record removed meanwhile (disconnect/logout) is never recreated, so no record outlives its refresh token.
      .set(`${META_PREFIX}${jti}`, JSON.stringify({ ...record, lastSeenAt: now, lastIp: ip }), 'KEEPTTL', 'XX')
      .zadd(`${INDEX_PREFIX}${record.tenantId}`, 'XX', now, `${record.userId}:${jti}`)
      .exec()
  }

  /** Normal logout: drop the record with the refresh token. */
  async forget(jti: string): Promise<void> {
    if (!isLoginSessionId(jti)) return
    const record = parse(await this.redis.get(`${META_PREFIX}${jti}`))
    await this.redis.del(`${META_PREFIX}${jti}`)
    if (record) await this.redis.zrem(`${INDEX_PREFIX}${record.tenantId}`, `${record.userId}:${jti}`)
  }

  /** Whether the refresh token behind an access token still exists (disconnect/logout remove it). */
  async isActive(jti: string): Promise<boolean> {
    return isLoginSessionId(jti) && await this.redis.exists(`${REFRESH_PREFIX}${jti}`) === 1
  }

  /** Live entries of the tenant, pruning those whose refresh token or record is gone. */
  private async live(tenantId: number, minScore: number, userId?: number): Promise<Array<{ jti: string; record: LoginSessionRecord }>> {
    const index = `${INDEX_PREFIX}${tenantId}`
    const members = await this.redis.zrevrangebyscore(index, '+inf', minScore, 'LIMIT', 0, INDEX_SCAN_LIMIT)
    const entries = members.map(member => {
      const at = member.indexOf(':')
      return { member, userId: Number(member.slice(0, at)), jti: member.slice(at + 1) }
    }).filter(e => isLoginSessionId(e.jti) && Number.isSafeInteger(e.userId) && (userId === undefined || e.userId === userId))
    if (!entries.length) return []
    const pipeline = this.redis.pipeline()
    for (const e of entries) pipeline.exists(`${REFRESH_PREFIX}${e.jti}`).get(`${META_PREFIX}${e.jti}`)
    const replies = (await pipeline.exec()) ?? []
    const alive: Array<{ jti: string; record: LoginSessionRecord }> = [], dead: string[] = []
    entries.forEach((e, i) => {
      const exists = replies[i * 2]?.[1], record = parse((replies[i * 2 + 1]?.[1] as string | null | undefined) ?? null)
      if (exists === 1 && record && record.tenantId === tenantId && record.userId === e.userId) alive.push({ jti: e.jti, record })
      else dead.push(e.member)
    })
    if (dead.length) await this.redis.zrem(index, ...dead)
    return alive
  }

  /** Users with a session used within the online window, with how many sessions each. */
  async online(tenantId: number): Promise<Array<{ userId: number; sessions: number; lastSeenAt: number }>> {
    const byUser = new Map<number, { userId: number; sessions: number; lastSeenAt: number }>()
    for (const { record } of await this.live(tenantId, this.now() - ONLINE_WINDOW_MS)) {
      const entry = byUser.get(record.userId) ?? { userId: record.userId, sessions: 0, lastSeenAt: 0 }
      entry.sessions++; entry.lastSeenAt = Math.max(entry.lastSeenAt, record.lastSeenAt)
      byUser.set(record.userId, entry)
    }
    return [...byUser.values()]
  }

  async list(tenantId: number, userId: number, currentJti?: string): Promise<LoginSessionView[]> {
    return (await this.live(tenantId, 0, userId)).map(({ jti, record }) => ({
      ref: loginSessionRef(jti), authMethod: record.authMethod, ip: record.ip, lastIp: record.lastIp, userAgent: record.userAgent,
      createdAt: record.createdAt, lastSeenAt: record.lastSeenAt, current: jti === currentJti,
    }))
  }

  /** Removes the refresh token first, so a racing refresh cannot mint another access token. */
  async revoke(tenantId: number, userId: number, ref: string, currentJti?: string): Promise<{ state: 'missing' } | { state: 'current' } | { state: 'revoked'; record: LoginSessionRecord }> {
    const target = (await this.live(tenantId, 0, userId)).find(e => loginSessionRef(e.jti) === ref)
    if (!target) return { state: 'missing' }
    if (target.jti === currentJti) return { state: 'current' }
    await this.redis.del(`${REFRESH_PREFIX}${target.jti}`)
    await this.redis.del(`${META_PREFIX}${target.jti}`)
    await this.redis.zrem(`${INDEX_PREFIX}${tenantId}`, `${userId}:${target.jti}`)
    return { state: 'revoked', record: target.record }
  }
}
