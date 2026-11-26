import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UserListItemSchema, UserPublicSchema, CreateUserSchema, UpdateUserSchema } from '@nodeaccess/shared'
import { configureCurrentSessionReader } from '../auth/current-session.js'
import { UserController } from './user.controller.js'
import { userRoutes } from './user.routes.js'
import type { UserService } from './user.service.js'

const item = { id: 7, tenantId: 2, name: 'Manager', email: 'fixture@example.test', role: 'user',
  isPlatformAdmin: false, canManageHosts: false, canViewLiveSessions: false, mfaEnabled: false,
  active: true, groupIds: [], createdAt: new Date(), updatedAt: new Date(), isVaultManager: true }
afterEach(() => configureCurrentSessionReader(undefined))
async function fixture(role: 'admin' | 'user' = 'admin') {
  configureCurrentSessionReader(() => Promise.resolve({ tenantId: 2, active: true, deletedAt: null,
    tenantActive: true, targetTenantActive: true, sessionVersion: 1, role: role === 'admin' ? 'ADMIN' : 'USER',
    isPlatformAdmin: false, canManageHosts: false, canViewLiveSessions: false }))
  const service = { updateOwnAvatar: vi.fn().mockResolvedValue(item), list: vi.fn().mockResolvedValue({ data: [{ ...item, passwordHash: 'private' }], total: 1, page: 1, limit: 20 }) }
  const app = Fastify()
  await app.register(multipart)
  await app.register(fastifyJwt, { secret: randomBytes(32).toString('hex') })
  await app.register(async r => userRoutes(r, new UserController(service as unknown as UserService)), { prefix: '/users' })
  const token = app.jwt.sign({ sub: '1', tenantId: 2, role, stage: 'authenticated', sessionVersion: 1,
    isPlatformAdmin: false, canManageHosts: false, canViewLiveSessions: false })
  return { app, service, headers: { authorization: `Bearer ${token}` } }
}
describe('Administrative user list contract', () => {
  it('requires the list boolean without changing public or write schemas', () => {
    expect(UserListItemSchema.parse(item).isVaultManager).toBe(true)
    const publicItem = UserPublicSchema.parse(item)
    expect(UserListItemSchema.safeParse(publicItem).success).toBe(false)
    expect(UserPublicSchema.parse(item)).not.toHaveProperty('isVaultManager')
    expect(CreateUserSchema.parse({ name: 'Fixture', email: item.email, isVaultManager: true })).not.toHaveProperty('isVaultManager')
    expect(UpdateUserSchema.parse({ isVaultManager: true })).not.toHaveProperty('isVaultManager')
  })
  it.each(['true', 'false', undefined])('serializes the indicator and passes filter %s through the controller', async value => {
    const { app, headers, service } = await fixture()
    try {
      const result = await app.inject({ url: `/users/?page=2&limit=1&search=Fixture&role=user${value === undefined ? '' : `&vaultManager=${value}`}`, headers })
      expect(result.statusCode).toBe(200)
      expect(result.json<{ data: unknown[] }>().data[0]).toMatchObject({ isVaultManager: true, role: 'user' })
      expect(result.json<{ data: unknown[] }>().data[0]).not.toHaveProperty('passwordHash')
      expect(service.list).toHaveBeenCalledWith(2, { page: 2, limit: 1, search: 'Fixture', role: 'USER', ...(value === undefined ? {} : { vaultManager: value === 'true' }) })
    } finally { await app.close() }
  })
  it('rejects invalid filters before calling the service', async () => {
    const { app, headers, service } = await fixture()
    try {
      expect((await app.inject({ url: '/users/?vaultManager=yes', headers })).statusCode).toBe(400)
      expect(service.list).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
  it('keeps real admin and authenticated-session guards', async () => {
    const { app, headers, service } = await fixture('user')
    try {
      expect((await app.inject({ url: '/users/?vaultManager=true', headers })).statusCode).toBe(403)
      expect((await app.inject({ url: '/users/' })).statusCode).toBe(401)
      expect(service.list).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
  it('rejects a multipart avatar request without a file', async () => {
    const { app, headers, service } = await fixture('user')
    try {
      const boundary = 'na0204-avatar-boundary'
      const result = await app.inject({ method: 'POST', url: '/users/me/avatar',
        headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload: `--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\nfixture\r\n--${boundary}--\r\n` })
      expect(result.statusCode).toBe(400)
      expect(result.json()).toMatchObject({ code: 'AVATAR_FILE_REQUIRED' })
      expect(service.updateOwnAvatar).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
  it('passes real multipart bytes and metadata with authenticated tenant/user to the avatar service', async () => {
    const { app, headers, service } = await fixture('user')
    try {
      const boundary = 'na0204-avatar-boundary'
      const bytes = Buffer.from([0, 1, 127, 128, 255])
      const payload = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="fixture.png"\r\nContent-Type: image/png\r\n\r\n`),
        bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
      ])
      const result = await app.inject({ method: 'POST', url: '/users/me/avatar', payload,
        headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` } })
      expect(result.statusCode).toBe(200)
      expect(service.updateOwnAvatar).toHaveBeenCalledExactlyOnceWith(1, 2, {
        buffer: bytes, filename: 'fixture.png', mimetype: 'image/png',
      }, 1)
      expect(result.json()).not.toHaveProperty('isVaultManager')
    } finally { await app.close() }
  })

})
