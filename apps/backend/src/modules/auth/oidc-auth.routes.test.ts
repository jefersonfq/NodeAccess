import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'mysql://user:pass@127.0.0.1:3306/nodeaccess_test'
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379'
  process.env.JWT_SECRET ||= 'test-jwt-secret-with-at-least-32-chars'
  process.env.PEM_ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  process.env.NODE_ENV ||= 'test'
})

import { OidcAuthController } from './oidc-auth.controller.js'
import { oidcAuthRoutes } from './oidc-auth.routes.js'
import type { OidcAuthService } from './oidc-auth.service.js'

async function appFor() {
  const service = {
    getPublicConfig: vi.fn().mockResolvedValue({ enabled: true, name: 'Entra ID' }),
    begin: vi.fn().mockResolvedValue({ authorizationUrl: 'https://idp.example.test/authorize' }),
    complete: vi.fn().mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh' }),
  }
  const app = Fastify()
  await app.register(async (instance) => {
    await oidcAuthRoutes(instance, new OidcAuthController(
      service as unknown as OidcAuthService,
      { check: vi.fn().mockResolvedValue(undefined) } as never,
    ))
  })
  return { app, service }
}

describe('OIDC public HTTP routes', () => {
  it('uses the explicitly selected tenant from the config query', async () => {
    const { app, service } = await appFor()
    try {
      const response = await app.inject({ method: 'GET', url: '/config?tenantSlug=Acme%20Corp' })
      expect(response.statusCode).toBe(200)
      expect(service.getPublicConfig).toHaveBeenCalledWith('acme-corp')
    } finally { await app.close() }
  })

  it('uses the explicitly selected tenant when starting authorization', async () => {
    const { app, service } = await appFor()
    try {
      const response = await app.inject({ method: 'POST', url: '/start', payload: { tenantSlug: 'Acme' } })
      expect(response.statusCode).toBe(200)
      expect(service.begin).toHaveBeenCalledWith('acme')
    } finally { await app.close() }
  })

  it.each([
    { state: 'short', code: 'code' },
    { state: 'valid-state-with-more-than-20-characters', code: '' },
  ])('rejects malformed callback data before calling the service', async (payload) => {
    const { app, service } = await appFor()
    try {
      const response = await app.inject({ method: 'POST', url: '/complete', payload })
      expect(response.statusCode).toBe(400)
      expect(service.complete).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
})
