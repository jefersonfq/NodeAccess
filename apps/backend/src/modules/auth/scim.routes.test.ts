import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { scimRoutes } from './scim.routes.js'
import { ScimError } from './scim.service.js'

function harness(overrides: Record<string, unknown> = {}) {
  const service = {
    authenticate: vi.fn().mockResolvedValue(7),
    listUsers: vi.fn().mockResolvedValue({ schemas: [], totalResults: 0, Resources: [] }),
    getUser: vi.fn(), createUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
    replaceUser: vi.fn(), patchUser: vi.fn(), listGroups: vi.fn().mockResolvedValue({ Resources: [] }),
    getGroup: vi.fn(), createGroup: vi.fn(), replaceGroup: vi.fn(),
    ...overrides,
  }
  return { service, app: Fastify() }
}

describe('SCIM 2.0 HTTP routes', () => {
  it('authenticates with a dedicated bearer token and scopes list filtering to its tenant', async () => {
    const { app, service } = harness()
    await app.register(async (instance) => scimRoutes(instance, service as never))
    try {
      const response = await app.inject({ method: 'GET', url: '/Users?filter=userName%20eq%20%22user%40example.test%22', headers: { authorization: 'Bearer token' } })
      expect(response.statusCode).toBe(200)
      expect(service.authenticate).toHaveBeenCalledWith('Bearer token')
      expect(service.listUsers).toHaveBeenCalledWith(7, 'userName eq "user@example.test"')
    } finally { await app.close() }
  })

  it('returns a SCIM error document for invalid credentials', async () => {
    const { app, service } = harness({ authenticate: vi.fn().mockRejectedValue(new ScimError(401, 'Credencial SCIM inválida')) })
    await app.register(async (instance) => scimRoutes(instance, service as never))
    try {
      const response = await app.inject({ method: 'GET', url: '/Users' })
      expect(response.statusCode).toBe(401)
      expect(response.headers['content-type']).toContain('application/scim+json')
      expect(response.json()).toMatchObject({ status: '401', detail: 'Credencial SCIM inválida' })
    } finally { await app.close() }
  })

  it('passes user payload without treating password as local authentication', async () => {
    const { app, service } = harness()
    await app.register(async (instance) => scimRoutes(instance, service as never))
    try {
      const payload = { userName: 'user@example.test', displayName: 'User', password: 'must-be-ignored' }
      const response = await app.inject({ method: 'POST', url: '/Users', headers: { authorization: 'Bearer token' }, payload })
      expect(response.statusCode).toBe(201)
      expect(service.createUser).toHaveBeenCalledWith(7, payload)
    } finally { await app.close() }
  })

  it('forwards active=false patch for session-revoking deactivation', async () => {
    const patchUser = vi.fn().mockResolvedValue({ id: 'user-1', active: false })
    const { app } = harness({ patchUser })
    await app.register(async (instance) => scimRoutes(instance, { ...harness().service, patchUser } as never))
    try {
      const Operations = [{ op: 'Replace', path: 'active', value: false }]
      const response = await app.inject({ method: 'PATCH', url: '/Users/user-1', headers: { authorization: 'Bearer token' }, payload: { Operations } })
      expect(response.statusCode).toBe(200)
      expect(patchUser).toHaveBeenCalledWith(7, 'user-1', Operations)
    } finally { await app.close() }
  })
})
