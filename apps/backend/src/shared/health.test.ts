import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const JWT_SECRET = 'test-secret-with-at-least-thirty-two-chars'

describe('health reports', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('DATABASE_URL', 'mysql://user:super-secret-password@localhost:3306/nodeaccess')
    vi.stubEnv('REDIS_URL', 'redis://:super-secret-redis@localhost:6379')
    vi.stubEnv('JWT_SECRET', JWT_SECRET)
    vi.stubEnv('PEM_ENCRYPTION_KEY', '0'.repeat(64))
  })

  it('returns live report without probing dependencies', async () => {
    const { buildHealthReport } = await import('./health.js')
    const db = { $queryRaw: vi.fn() }
    const redis = { ping: vi.fn() }

    const report = await buildHealthReport('api', 'live', { db: db as never, redis: redis as never })

    expect(report.status).toBe('ok')
    expect(report.mode).toBe('api')
    expect(report.checks).toEqual([expect.objectContaining({ name: 'process', status: 'ok' })])
    expect(db.$queryRaw).not.toHaveBeenCalled()
    expect(redis.ping).not.toHaveBeenCalled()
  })

  it('returns ready report with dependency checks', async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), 'nodeaccess-health-test-'))
    vi.stubEnv('SESSION_AUDIT_STORAGE_DIR', storageDir)
    const { buildHealthReport } = await import('./health.js')
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]) }
    const redis = { ping: vi.fn().mockResolvedValue('PONG') }

    try {
      const report = await buildHealthReport('gateway', 'ready', { db: db as never, redis: redis as never })

      expect(report.status).toBe('ok')
      expect(report.mode).toBe('gateway')
      expect(report.checks.map((check) => check.name)).toEqual([
        'process',
        'mysql',
        'redis',
        'session_audit_storage',
      ])
    } finally {
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('marks report down when dependency fails without leaking DSN secrets', async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), 'nodeaccess-health-test-'))
    vi.stubEnv('SESSION_AUDIT_STORAGE_DIR', storageDir)
    const { buildHealthReport } = await import('./health.js')
    const db = { $queryRaw: vi.fn().mockRejectedValue(new Error('mysql unavailable at localhost')) }
    const redis = { ping: vi.fn().mockRejectedValue(new Error('redis auth failed for configured connection')) }

    try {
      const report = await buildHealthReport('api', 'ready', { db: db as never, redis: redis as never })
      const serialized = JSON.stringify(report)

      expect(report.status).toBe('down')
      expect(report.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'mysql', status: 'down' }),
        expect.objectContaining({ name: 'redis', status: 'down' }),
      ]))
      expect(serialized).not.toContain('super-secret-password')
      expect(serialized).not.toContain('super-secret-redis')
    } finally {
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('registers compatible HTTP health routes', async () => {
    const storageDir = await mkdtemp(path.join(os.tmpdir(), 'nodeaccess-health-test-'))
    vi.stubEnv('SESSION_AUDIT_STORAGE_DIR', storageDir)
    const { registerHealthRoutes } = await import('./health.js')
    const app = Fastify()
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]) }
    const redis = { ping: vi.fn().mockResolvedValue('PONG') }

    registerHealthRoutes(app, 'api', { db: db as never, redis: redis as never })

    try {
      const live = await app.inject({ method: 'GET', url: '/health' })
      const ready = await app.inject({ method: 'GET', url: '/health/ready' })

      expect(live.statusCode).toBe(200)
      expect(live.json()).toMatchObject({ status: 'ok', mode: 'api' })
      expect(live.json().checks).toEqual([expect.objectContaining({ name: 'process' })])
      expect(ready.statusCode).toBe(200)
      expect(ready.json().checks.map((check: { name: string }) => check.name)).toContain('session_audit_storage')
    } finally {
      await app.close()
      await rm(storageDir, { recursive: true, force: true })
    }
  })
})
