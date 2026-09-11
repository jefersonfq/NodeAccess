import Fastify from 'fastify'
import jwt from '@fastify/jwt'
import { describe, expect, it, vi } from 'vitest'
import { inventoryAclRoutes } from './inventory-acl.routes.js'
import { InventoryAclController } from './inventory-acl.controller.js'
import type { EffectiveAclSourceRow } from './inventory-acl.repository.js'
import { InventoryAclService } from './inventory-acl.service.js'

async function fixture() {
  const repo = {
    searchUsers: vi.fn(() => Promise.resolve({ data: [{ id: 20, name: 'User', email: 'user@test.invalid' }], total: 1, page: 1, limit: 30 })),
    nodeExists: vi.fn((id: number, tenantId: number) => Promise.resolve(id === 27 && tenantId === 7)),
    findPrincipalName: vi.fn((_type: string, id: number, tenantId: number) => Promise.resolve(id === 20 && tenantId === 7 ? 'User' : null)),
    findEffectiveSources: vi.fn((): Promise<EffectiveAclSourceRow[]> => Promise.resolve([])),
    findLocalEntry: vi.fn(() => Promise.resolve(null)),
    upsert: vi.fn(() => Promise.resolve(undefined)),
    findNodeContext: vi.fn(() => Promise.resolve(null)),
    findApplicableEntries: vi.fn(() => Promise.resolve([])),
  }
  const app = Fastify()
  await app.register(jwt, { secret: 'acl-route-fixture-secret-not-for-production' })
  const inventoryRepo = { findByHostId: vi.fn((id: number, tenantId: number) => Promise.resolve(id === 5 && tenantId === 7 ? { id: 27 } : null)) }
  await inventoryAclRoutes(app, new InventoryAclController(new InventoryAclService(repo as never, undefined, undefined, inventoryRepo as never)))
  const token = (overrides: Record<string, unknown> = {}) => app.jwt.sign({ sub: '10', tenantId: 7, role: 'admin', canManageHosts: true, stage: 'authenticated', ...overrides })
  return { app, repo, token }
}

const body = { principalType: 'USER', principalId: 20, permissions: { view: true, connect: true, edit: false, admin: false } }

describe('ACL HTTP authorization boundary', () => {
  it.each([
    ['anonymous', null, 401],
    ['MFA pending', { stage: 'mfa_pending' }, 401],
    ['ordinary user', { role: 'user', canManageHosts: false }, 403],
    ['host manager without ACL admin', { role: 'user', canManageHosts: true }, 403],
    ['foreign tenant admin', { tenantId: 8 }, 404],
  ] as const)('rejects %s without persisting', async (_name, claims, code) => {
    const { app, repo, token } = await fixture()
    try {
      const result = await app.inject({ method: 'PUT', url: '/nodes/27/acl?tenantId=7', headers: claims ? { authorization: `Bearer ${token(claims)}` } : {}, payload: body })
      expect(result.statusCode).toBe(code)
      expect(repo.upsert).not.toHaveBeenCalled()
    } finally { await app.close() }
  })

  it('uses the authenticated tenant and actor, ignoring query impersonation', async () => {
    const { app, repo, token } = await fixture()
    try {
      const result = await app.inject({ method: 'PUT', url: '/nodes/27/acl?tenantId=8&actorId=999', headers: { authorization: `Bearer ${token()}` }, payload: body })
      expect(result.statusCode).toBe(200)
      expect(repo.upsert).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 7, actorId: 10, inventoryNodeId: 27, principalId: 20 }))
    } finally { await app.close() }
  })

  it.each([
    { ...body, principalId: -1 },
    { ...body, principalType: 'EVERYONE' },
    { ...body, permissions: { view: false, connect: false, edit: false, admin: false } },
  ])('rejects invalid grants without changing ACL', async payload => {
    const { app, repo, token } = await fixture()
    try {
      const result = await app.inject({ method: 'PUT', url: '/nodes/27/acl', headers: { authorization: `Bearer ${token()}` }, payload })
      expect([400, 422]).toContain(result.statusCode)
      expect(repo.upsert).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
})


describe('ACL UX HTTP privacy', () => {
  it('searches only the JWT tenant and requires item administration', async () => {
    const { app, repo, token } = await fixture()
    try {
      const allowed = await app.inject({ url: '/nodes/27/acl/users?search=alice&page=2&tenantId=99', headers: { authorization: `Bearer ${token()}` } })
      expect(allowed.statusCode).toBe(200)
      expect(repo.searchUsers).toHaveBeenCalledWith(7, 'alice', 2)
      repo.searchUsers.mockClear()
      const denied = await app.inject({ url: '/nodes/27/acl/users', headers: { authorization: `Bearer ${token({ role: 'user' })}` } })
      expect(denied.statusCode).toBe(403)
      expect(repo.searchUsers).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
  it('my access uses only the authenticated user, even with another userId in the query', async () => {
    const { app, repo, token } = await fixture()
    repo.findEffectiveSources.mockResolvedValue([{ aclEntryId: 1, inventoryNodeId: 27, inventoryNodeName: 'Folder', principalType: 'GROUP', principalId: 8, principalName: 'My group', canView: true, canConnect: false, canEdit: true, canAdmin: false, local: true, inheritToChildren: true }])
    try {
      const result = await app.inject({ url: '/hosts/5/my-access?userId=999', headers: { authorization: `Bearer ${token({ role: 'user', canManageHosts: false })}` } })
      expect(result.statusCode).toBe(200)
      expect(result.json()).toMatchObject({ view: true, edit: true, connect: false })
      expect(repo.findEffectiveSources).toHaveBeenCalledWith(27, 7, 10)
      expect(repo.findApplicableEntries).not.toHaveBeenCalled()
      expect(repo.searchUsers).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
  it.each([{ role: 'user' }, { tenantId: 8 }])('does not disclose a denied or cross-tenant host', async claims => {
    const { app, token } = await fixture()
    try {
      const result = await app.inject({ url: '/hosts/5/my-access', headers: { authorization: `Bearer ${token(claims)}` } })
      expect(result.statusCode).toBe(404)
      expect(result.body).not.toContain('inventoryNodeName')
    } finally { await app.close() }
  })
})


it('my access reflects the global prerequisite for ACL administration', async () => {
  const { app, repo, token } = await fixture()
  repo.findEffectiveSources.mockResolvedValue([{ aclEntryId: 1, inventoryNodeId: 27, inventoryNodeName: 'Folder', principalType: 'USER', principalId: 10, principalName: 'Self', canView: true, canConnect: true, canEdit: true, canAdmin: true, local: true, inheritToChildren: true }])
  try {
    const denied = await app.inject({ url: '/hosts/5/my-access', headers: { authorization: `Bearer ${token({ role: 'user', canManageHosts: false })}` } })
    expect(denied.json()).toMatchObject({ view: true, connect: true, edit: true, admin: false })
    const allowed = await app.inject({ url: '/hosts/5/my-access', headers: { authorization: `Bearer ${token({ role: 'user', canManageHosts: true })}` } })
    expect(allowed.json()).toMatchObject({ admin: true })
  } finally { await app.close() }
})
