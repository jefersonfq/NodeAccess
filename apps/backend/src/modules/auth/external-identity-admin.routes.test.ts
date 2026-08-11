import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { ExternalIdentityAdminController } from './external-identity-admin.controller.js'
import { externalIdentityAdminRoutes } from './external-identity-admin.routes.js'

async function appFor(role: 'admin' | 'user' = 'admin') {
  const service = {
    list: vi.fn().mockResolvedValue([]),
    revoke: vi.fn().mockResolvedValue({ changed: true }),
  }
  const app = Fastify()
  app.decorateRequest('jwtVerify', function () {
    return Promise.resolve({
      sub: '11', email: 'admin@example.test', role, isPlatformAdmin: false, tenantId: 7,
      canManageHosts: true, canViewLiveSessions: true, forcePasswordChange: false,
      sessionVersion: 0, stage: 'authenticated',
    })
  })
  await app.register(async (instance) => {
    await externalIdentityAdminRoutes(instance, new ExternalIdentityAdminController(service as never))
  })
  return { app, service }
}

describe('External identity administrative HTTP routes', () => {
  it('lists identities only in the authenticated tenant', async () => {
    const { app, service } = await appFor()
    try {
      const response = await app.inject({ method: 'GET', url: '/identities' })
      expect(response.statusCode).toBe(200)
      expect(service.list).toHaveBeenCalledWith(7)
    } finally { await app.close() }
  })

  it('forbids non-administrators', async () => {
    const { app, service } = await appFor('user')
    try {
      const response = await app.inject({ method: 'GET', url: '/identities' })
      expect(response.statusCode).toBe(403)
      expect(service.list).not.toHaveBeenCalled()
    } finally { await app.close() }
  })

  it('forwards tenant and administrator identity on revocation', async () => {
    const { app, service } = await appFor()
    try {
      const response = await app.inject({ method: 'POST', url: '/identities/31/revoke' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ changed: true })
      expect(service.revoke).toHaveBeenCalledWith(31, 7, 11)
    } finally { await app.close() }
  })

  it('rejects malformed identity identifiers before the service', async () => {
    const { app, service } = await appFor()
    try {
      const response = await app.inject({ method: 'POST', url: '/identities/invalid/revoke' })
      expect(response.statusCode).toBe(400)
      expect(service.revoke).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
})
