import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { configureCurrentSessionReader } from '../auth/current-session.js'
import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import { observabilityRoutes } from './observability.routes.js'
import { buildObservabilitySnapshot } from './observability.service.js'

vi.mock('./observability.service.js', () => ({ buildObservabilitySnapshot: vi.fn().mockResolvedValue({ status: 'ok', timestamp: '2026-09-24T12:00:00Z' }) }))
beforeEach(() => vi.clearAllMocks())
afterEach(() => configureCurrentSessionReader(undefined))

describe('observability platform access', () => {
  it.each([
    ['platform administrator', { role: 'admin', isPlatformAdmin: true, stage: 'authenticated' }, 200],
    ['tenant administrator', { role: 'admin', isPlatformAdmin: false, stage: 'authenticated' }, 403],
    ['ordinary user', { role: 'user', isPlatformAdmin: false, stage: 'authenticated' }, 403],
    ['MFA pending token', { role: 'admin', isPlatformAdmin: true, stage: 'mfa_pending' }, 401],
    ['refresh token', { role: 'admin', isPlatformAdmin: true, stage: 'refresh' }, 401],
    ['unauthenticated request', null, 401],
  ])('%s receives %s without running collectors on denial', async (_label, claims, expected) => {
    configureCurrentSessionReader((userId, tenantId) => Promise.resolve([1, 2, 3].includes(userId) && tenantId === 7 ? {
      tenantId: 7, role: userId === 3 ? 'USER' : 'ADMIN', isPlatformAdmin: userId === 1,
      active: true, deletedAt: null, tenantActive: true, targetTenantActive: true, sessionVersion: 0,
      canManageHosts: false, canViewLiveSessions: false,
    } : null))
    const app = Fastify()
    await app.register(jwt, { secret: 'observability-disposable-test-secret' })
    await app.register(async scope => observabilityRoutes(scope, { db: {} as never, redis: {} as never }))
    // Routes consume dependencies only after the platform guard has succeeded.
    try {
      const sub = claims?.isPlatformAdmin ? '1' : claims?.role === 'admin' ? '2' : '3'
      const response = await app.inject({ method: 'GET', url: '/summary', headers: claims ? { authorization: `Bearer ${app.jwt.sign({ sub, tenantId: 7, sessionVersion: 0, canManageHosts: false, canViewLiveSessions: false, ...claims })}` } : {} })
      expect(response.statusCode).toBe(expected)
      expect(buildObservabilitySnapshot).toHaveBeenCalledTimes(expected === 200 ? 1 : 0)
      if (expected === 200) expect(response.json()).toMatchObject({ status: 'ok' })
    } finally { await app.close() }
  })
})
