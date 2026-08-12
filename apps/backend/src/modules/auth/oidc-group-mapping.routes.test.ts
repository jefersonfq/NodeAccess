import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { OidcGroupMappingController } from './oidc-group-mapping.controller.js'
import { oidcGroupMappingRoutes } from './oidc-group-mapping.routes.js'

async function appFor(role: 'admin' | 'user' = 'admin') {
  const service = { list: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({ id: 4 }), delete: vi.fn().mockResolvedValue(undefined) }
  const app = Fastify()
  app.decorateRequest('jwtVerify', function () {
    return Promise.resolve({ sub: '11', email: 'admin@example.test', role, isPlatformAdmin: false, tenantId: 7, canManageHosts: true, canViewLiveSessions: true, forcePasswordChange: false, sessionVersion: 0, stage: 'authenticated' })
  })
  await app.register(async (instance) => oidcGroupMappingRoutes(instance, new OidcGroupMappingController(service as never)))
  return { app, service }
}

describe('OIDC group mapping HTTP routes', () => {
  it('scopes listing to the authenticated tenant', async () => {
    const { app, service } = await appFor()
    try {
      expect((await app.inject({ method: 'GET', url: '/group-mappings' })).statusCode).toBe(200)
      expect(service.list).toHaveBeenCalledWith(7)
    } finally { await app.close() }
  })

  it('forbids non-administrators', async () => {
    const { app, service } = await appFor('user')
    try {
      expect((await app.inject({ method: 'POST', url: '/group-mappings', payload: { externalGroup: 'ops', groupId: 2 } })).statusCode).toBe(403)
      expect(service.create).not.toHaveBeenCalled()
    } finally { await app.close() }
  })

  it('validates and forwards an explicit mapping approval', async () => {
    const { app, service } = await appFor()
    try {
      expect((await app.inject({ method: 'POST', url: '/group-mappings', payload: { externalGroup: ' ops ', groupId: 2 } })).statusCode).toBe(201)
      expect(service.create).toHaveBeenCalledWith({ tenantId: 7, adminId: 11, externalGroup: 'ops', groupId: 2 })
    } finally { await app.close() }
  })

  it('rejects malformed mapping identifiers', async () => {
    const { app, service } = await appFor()
    try {
      expect((await app.inject({ method: 'DELETE', url: '/group-mappings/nope' })).statusCode).toBe(400)
      expect(service.delete).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
})
