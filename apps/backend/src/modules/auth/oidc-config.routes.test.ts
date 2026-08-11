import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { OidcConfigController } from './oidc-config.controller.js'
import { oidcConfigRoutes } from './oidc-config.routes.js'
import type { OidcConfigService } from './oidc-config.service.js'

const publicConfig = {
  enabled: true, name: 'Corporate', issuer: 'https://idp.example.test', clientId: 'nodeaccess',
  hasClientSecret: true, scopes: ['openid'], allowedDomains: ['example.test'],
  autoProvision: false, requireMfaClaim: false, acceptedAmrValues: ['mfa'], acceptedAcrValues: [],
  updatedAt: new Date('2026-08-10T12:00:00.000Z'),
}

async function appFor(role: 'admin' | 'user' = 'admin') {
  const service = {
    getPublic: vi.fn().mockResolvedValue(publicConfig),
    upsert: vi.fn().mockResolvedValue(publicConfig),
    rotateClientSecret: vi.fn().mockResolvedValue(publicConfig),
  }
  const app = Fastify()
  app.decorateRequest('jwtVerify', function () {
    return Promise.resolve({
      sub: '11', email: 'admin@example.test', role, isPlatformAdmin: false, tenantId: 7,
      canManageHosts: true, canViewLiveSessions: true, forcePasswordChange: false, stage: 'authenticated',
    })
  })
  await app.register(async (instance) => {
    await oidcConfigRoutes(instance, new OidcConfigController(service as unknown as OidcConfigService))
  })
  return { app, service }
}

describe('OIDC administrative HTTP routes', () => {
  it('returns only the public secret marker for an administrator', async () => {
    const { app, service } = await appFor()
    try {
      const response = await app.inject({ method: 'GET', url: '/' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ hasClientSecret: true })
      expect(response.body).not.toContain('clientSecretEncrypted')
      expect(service.getPublic).toHaveBeenCalledWith(7)
    } finally { await app.close() }
  })

  it('forbids a non-administrator from reading configuration', async () => {
    const { app, service } = await appFor('user')
    try {
      const response = await app.inject({ method: 'GET', url: '/' })
      expect(response.statusCode).toBe(403)
      expect(service.getPublic).not.toHaveBeenCalled()
    } finally { await app.close() }
  })

  it('rejects malformed configuration before persisting it', async () => {
    const { app, service } = await appFor()
    try {
      const response = await app.inject({
        method: 'PUT', url: '/',
        payload: { enabled: true, name: '', issuer: 'not-a-url', clientId: '', scopes: [], allowedDomains: [] },
      })
      expect(response.statusCode).toBe(400)
      expect(service.upsert).not.toHaveBeenCalled()
    } finally { await app.close() }
  })

  it('forwards tenant and administrator identity on update', async () => {
    const { app, service } = await appFor()
    const payload = {
      enabled: true, name: 'Corporate', issuer: 'https://idp.example.test', clientId: 'nodeaccess',
      clientSecret: 'secret', scopes: ['openid'], allowedDomains: ['example.test'], autoProvision: false,
      requireMfaClaim: false, acceptedAmrValues: ['mfa'], acceptedAcrValues: [],
    }
    try {
      const response = await app.inject({ method: 'PUT', url: '/', payload })
      expect(response.statusCode).toBe(200)
      expect(service.upsert).toHaveBeenCalledWith(7, 11, payload)
    } finally { await app.close() }
  })

  it('rotates the secret through an admin-only payload without returning it', async () => {
    const { app, service } = await appFor()
    try {
      const response = await app.inject({
        method: 'POST', url: '/rotate-client-secret', payload: { clientSecret: 'new-client-secret' },
      })
      expect(response.statusCode).toBe(200)
      expect(response.body).not.toContain('new-client-secret')
      expect(service.rotateClientSecret).toHaveBeenCalledWith(7, 11, 'new-client-secret')
    } finally { await app.close() }
  })
})
