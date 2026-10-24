import { afterEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import bcrypt from 'bcrypt'
import { envSchema } from '../../config/env.js'
import { AuthRateLimitService } from '../auth/auth-rate-limit.service.js'
import { trialRoutes } from './trial.routes.js'
import { TrialService } from './trial.service.js'

vi.mock('bcrypt', () => ({ default: { hash: vi.fn(() => Promise.resolve('fixture-password-hash')) } }))
const apps: FastifyInstance[] = []
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); vi.clearAllMocks() })

function fakeRedis(): { redis: unknown; keys: string[] } {
  const counts = new Map<string, number>(), keys: string[] = []
  return { keys, redis: { multi() {
    const commands: Array<{ kind: 'increment' | 'expiry'; key: string }> = []
    const multi = {
      incr(key: string) { commands.push({ kind: 'increment', key }); return multi },
      expire(key: string) { commands.push({ kind: 'expiry', key }); return multi },
      exec() {
        return Promise.resolve(commands.map(command => {
          keys.push(command.key)
          if (command.kind === 'expiry') return [null, 1]
          const count = (counts.get(command.key) ?? 0) + 1
          counts.set(command.key, count)
          return [null, count]
        }))
      },
    }
    return multi
  } } }
}
async function fixture(): Promise<{ app: FastifyInstance; invite: ReturnType<typeof vi.fn>; activate: ReturnType<typeof vi.fn>; keys: string[] }> {
  const app = Fastify(); apps.push(app)
  const invite = vi.fn(() => Promise.resolve({ ok: true })), activate = vi.fn(() => Promise.resolve({ ok: true }))
  const { redis, keys } = fakeRedis()
  const limiter = new AuthRateLimitService(redis as never, { windowSeconds: 60, ip: 120, tenant: 5000, identity: 3, keySecret: 'fixture-key-not-a-production-secret' })
  await trialRoutes(app, { invite, activate, publicConfig: () => ({ enabled: false }) } as never, limiter)
  await app.ready()
  return { app, invite, activate, keys }
}

describe('public trial abuse limits using actual Fastify routes and limiter', () => {
  it('limits invite messages by recipient even when caller token and IP change', async () => {
    const f = await fixture()
    const statuses = []
    for (let n = 1; n <= 4; n++) {
      const response = await f.app.inject({ method: 'POST', url: '/trials/public/invite', remoteAddress: `192.0.2.${n}`,
        headers: { authorization: `Bearer ${String(n).repeat(64)}` }, payload: { name: 'Guest', email: 'guest@example.test' } })
      statuses.push(response.statusCode)
    }
    expect(statuses).toEqual([200, 200, 200, 429])
    expect(f.invite).toHaveBeenCalledTimes(3)
    expect(f.keys.join(' ')).not.toContain('guest@example.test')
  })
  it('limits expensive activation per capability across IP changes', async () => {
    const f = await fixture(), token = 'a'.repeat(64)
    const statuses = []
    for (let n = 1; n <= 4; n++) {
      const response = await f.app.inject({ method: 'POST', url: '/trials/public/activate', remoteAddress: `192.0.2.${n}`,
        headers: { authorization: `Bearer ${token}` }, payload: { password: 'Fixture-Password-2026' } })
      statuses.push(response.statusCode)
    }
    expect(statuses).toEqual([200, 200, 200, 429])
    expect(f.activate).toHaveBeenCalledTimes(3)
    expect(f.keys.join(' ')).not.toContain(token)
  })
  it('rejects malformed management capability before activation', async () => {
    const f = await fixture()
    const response = await f.app.inject({ method: 'POST', url: '/trials/public/activate', headers: { authorization: 'Bearer not-an-opaque-token' }, payload: { password: 'Fixture-Password-2026' } })
    expect(response.statusCode).toBe(401)
    expect(f.activate).not.toHaveBeenCalled()
  })
  it('does not expose SMTP/provider errors or opaque capability in public errors', async () => {
    const f = await fixture(), token = 'c'.repeat(64)
    f.invite.mockRejectedValueOnce(new Error(`smtp://private-user:private-password@internal ${token}`))
    const response = await f.app.inject({ method: 'POST', url: '/trials/public/invite', headers: { authorization: `Bearer ${token}` }, payload: { name: 'Guest', email: 'guest@example.test' } })
    expect(response.statusCode).toBe(503)
    expect(response.body).not.toContain('private-password')
    expect(response.body).not.toContain(token)
    expect(response.json()).toMatchObject({ code: 'TRIAL_UNAVAILABLE' })
  })
  it.each(['expired', 'cancelled', 'activated'])('rejects %s owner before computing password hash', async state => {
    const row = { status: state === 'cancelled' ? 'CANCELLED' : 'ACTIVE', expiresAt: new Date(Date.now() + (state === 'expired' ? -1000 : 60000)), activatedAt: state === 'activated' ? new Date() : null }
    const db = { trialRegistration: { findUnique: vi.fn(() => Promise.resolve(row)) } }
    const service = new TrialService(db as never, { registrationsEnabled: false })
    await expect(service.activate('a'.repeat(64), { password: 'Fixture-Password-2026' })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(bcrypt.hash).not.toHaveBeenCalled()
  })
})

describe('trial public URL environment validation', () => {
  const base = { DATABASE_URL: 'mysql://fixture:fixture@localhost/nodeaccess_test', REDIS_URL: 'redis://localhost:6379', JWT_SECRET: 'fixture-signing-key-not-a-production-secret', PEM_ENCRYPTION_KEY: '0'.repeat(64) }
  it('keeps onboarding disabled by default and accepts explicit HTTPS origin', () => {
    const parsed = envSchema.parse({ ...base, TRIAL_PUBLIC_URL: 'https://demo.example.test' })
    expect(parsed.TRIAL_REGISTRATION_ENABLED).toBe(false)
  })
  it.each(['http://demo.example.test','https://u:p@demo.example.test','https://demo.example.test?secret=value','https://demo.example.test#token=value','javascript:alert(1)'])('rejects unsafe public URL shape %#', url => {
    expect(envSchema.safeParse({ ...base, TRIAL_PUBLIC_URL: url }).success).toBe(false)
  })
})
