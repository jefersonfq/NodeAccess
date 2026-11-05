import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import bcrypt from 'bcrypt'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { UserService } from './user.service.js'
import { env } from '../../config/env.js'
import type { UserRepository } from './user.repository.js'
import type { WebhookService } from '../webhooks/webhook.service.js'
import type { AppEventBus } from '../app-events/app-event.bus.js'

const createDefaults = { canManageHosts: false, canViewLiveSessions: false, groupIds: [] as number[] }
const baseUser = () => ({ id: 7, tenantId: 2, name: 'Synthetic User', email: 'user@example.test', role: 'USER',
  passwordHash: 'private', mfaSecret: 'private', active: true, deletedAt: null, mfaEnabled: true,
  canManageHosts: false, isPlatformAdmin: false, forcePasswordChange: false,
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01') })
function fixture() {
  const user = baseUser()
  const repo = {
    findByIdInTenant: vi.fn((id: number, tenant: number) => Promise.resolve(id === user.id && tenant === user.tenantId ? user : null)),
    findByIdInTenantIncludingDeleted: vi.fn((id: number, tenant: number) => Promise.resolve(id === user.id && tenant === user.tenantId ? user : null)),
    findAll: vi.fn().mockResolvedValue({ users: [user], total: 1 }),
    findGroupIdsByUsers: vi.fn().mockResolvedValue(new Map()),
    findLiveSessionsPermissionsByUsers: vi.fn().mockResolvedValue(new Map()),
    findAvatarMetadataByUsers: vi.fn().mockResolvedValue(new Map()),
    findGroupIdsByUser: vi.fn().mockResolvedValue([10, 20]),
    canViewLiveSessions: vi.fn().mockResolvedValue(true),
    findAvatarMetadata: vi.fn().mockResolvedValue(null),
    findLicenseByTenant: vi.fn().mockResolvedValue(null),
    countActiveByTenant: vi.fn().mockResolvedValue(1),
    findByEmail: vi.fn().mockResolvedValue(null),
    create: vi.fn((data: Parameters<UserRepository['create']>[0]) => Promise.resolve({ ...user, ...data })),
    update: vi.fn((_id: number, data: Parameters<UserRepository['update']>[1]) => Promise.resolve({ ...user, ...data })),
    logAdminEvent: vi.fn().mockResolvedValue(undefined),
    softDelete: vi.fn().mockResolvedValue(undefined), restore: vi.fn().mockResolvedValue(undefined),
    setActive: vi.fn().mockResolvedValue(undefined), updatePassword: vi.fn<UserRepository['updatePassword']>().mockResolvedValue(undefined),
    setForcePasswordChange: vi.fn().mockResolvedValue(undefined), resetMfa: vi.fn().mockResolvedValue(undefined),
    findPreferencesByIdInTenant: vi.fn().mockResolvedValue(null), updatePreferences: vi.fn().mockResolvedValue(undefined),
    updateAvatarMetadata: vi.fn<UserRepository['updateAvatarMetadata']>().mockResolvedValue(undefined), clearAvatarMetadata: vi.fn().mockResolvedValue(undefined),
    findInventoryAccessSources: vi.fn().mockResolvedValue([]),
  }
  const webhook = { publishEvent: vi.fn().mockResolvedValue(undefined) }
  const events = { publish: vi.fn().mockResolvedValue(undefined) }
  return { user, repo, webhook, events, service: new UserService(repo as unknown as UserRepository,
    webhook as unknown as WebhookService, events as unknown as AppEventBus) }
}

describe('UserService tenant and credential behavior', () => {
  const policy = env.PASSWORD_POLICY_REGEX
  beforeEach(() => { env.PASSWORD_POLICY_REGEX = '^(?=.*[A-Z])(?=.*[0-9]).{8,}$' })
  afterEach(() => { env.PASSWORD_POLICY_REGEX = policy })
  it('returns public fields, pagination and permission maps without credential material', async () => {
    const { service, repo } = fixture()
    repo.findGroupIdsByUsers.mockResolvedValue(new Map([[7, [12]]]))
    repo.findLiveSessionsPermissionsByUsers.mockResolvedValue(new Map([[7, true]]))
    const result = await service.list(2, {})
    expect(result).toMatchObject({ total: 1, page: 1, limit: 20, data: [{ groupIds: [12], canViewLiveSessions: true, role: 'user' }] })
    expect(result.data[0]).not.toHaveProperty('passwordHash')
    expect(result.data[0]).not.toHaveProperty('mfaSecret')
    expect(repo.findAll).toHaveBeenCalledWith(2, {})
    expect(await service.list(2, { page: 3, limit: 5 })).toMatchObject({ page: 3, limit: 5 })
    expect(await service.getById(7, 2)).toMatchObject({ groupIds: [10, 20], canViewLiveSessions: true })
  })
  it.each(['getById', 'softDelete', 'restore', 'resetPassword', 'resetMfa', 'getPreferences', 'listInventoryAccess'] as const)('%s refuses a user from another tenant', async method => {
    const { service, repo } = fixture()
    await expect(service[method](7, 99)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(repo.softDelete).not.toHaveBeenCalled(); expect(repo.updatePassword).not.toHaveBeenCalled()
    expect(repo.findInventoryAccessSources).not.toHaveBeenCalled()
  })
  it('tenant mismatch blocks edits before writing', async () => {
    const { service, repo } = fixture()
    await expect(service.update(7, { name: 'Changed' }, 99)).rejects.toThrow()
    await expect(service.setActive(7, true, 99)).rejects.toThrow()
    await expect(service.updatePreferences(7, 99, {})).rejects.toThrow()
    await expect(service.changePassword(7, 99, undefined, 'NewPass123')).rejects.toThrow()
    expect(repo.update).not.toHaveBeenCalled(); expect(repo.setActive).not.toHaveBeenCalled()
  })
  it('enforces license before creation/restoration/reactivation', async () => {
    const { service, repo, user } = fixture()
    repo.findLicenseByTenant.mockResolvedValue({ maxUsers: 1 })
    Object.assign(user, { deletedAt: new Date() })
    await expect(service.create({ ...createDefaults, name: 'New', email: 'new@example.test', role: 'user' } as never, 2)).rejects.toMatchObject({ code: 'LICENSE_LIMIT_REACHED' })
    await expect(service.restore(7, 2)).rejects.toMatchObject({ code: 'LICENSE_LIMIT_REACHED' })
    await expect(service.setActive(7, true, 2)).rejects.toMatchObject({ code: 'LICENSE_LIMIT_REACHED' })
    expect(repo.create).not.toHaveBeenCalled(); expect(repo.restore).not.toHaveBeenCalled(); expect(repo.setActive).not.toHaveBeenCalled()
    await service.setActive(7, false, 2)
    expect(repo.setActive).toHaveBeenCalledWith(7, false)
  })
  it('rejects duplicate emails and weak supplied passwords before hashing/writing', async () => {
    const { service, repo } = fixture()
    const dto = { ...createDefaults, name: 'New', email: 'new@example.test', role: 'user', password: 'weak' } as const
    repo.findByEmail.mockResolvedValueOnce(baseUser())
    await expect(service.create(dto, 2)).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(service.create(dto, 2)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(repo.create).not.toHaveBeenCalled()
  })
  it('hashes supplied passwords with real bcrypt and emits scoped event without plaintext', async () => {
    const { service, repo, webhook } = fixture()
    repo.logAdminEvent.mockRejectedValue(new Error('audit unavailable'))
    webhook.publishEvent.mockRejectedValue(new Error('provider unavailable'))
    const result = await service.create({ ...createDefaults, name: 'New', email: 'new@example.test', role: 'admin', password: 'NewPass123' }, 2, 8)
    const data = repo.create.mock.calls[0]![0]
    expect(data).toMatchObject({ tenantId: 2, role: 'ADMIN' })
    expect(await bcrypt.compare('NewPass123', data.passwordHash)).toBe(true)
    expect(bcrypt.getRounds(data.passwordHash)).toBe(12)
    expect(result).not.toHaveProperty('temporaryPassword'); expect(result).not.toHaveProperty('passwordHash')
    expect(webhook.publishEvent).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 2, eventType: 'user.created' }))
    expect(JSON.stringify(webhook.publishEvent.mock.calls)).not.toContain('NewPass123')
  })
  it('generates a temporary password and resets credentials with force-change enabled', async () => {
    const { service, repo } = fixture()
    const created = await service.create({ ...createDefaults, name: 'New', email: 'new@example.test', role: 'user' }, 2)
    expect(await bcrypt.compare(created.temporaryPassword!, repo.create.mock.calls[0]![0].passwordHash)).toBe(true)
    const reset = await service.resetPassword(7, 2, 8)
    expect(reset.temporaryPassword).not.toEqual(created.temporaryPassword)
    expect(await bcrypt.compare(reset.temporaryPassword, repo.updatePassword.mock.calls[0]![1])).toBe(true)
    expect(repo.setForcePasswordChange).toHaveBeenCalledWith(7, true)
  })
  it('requires current password except explicit forced-change and validates replacement policy', async () => {
    const { service, repo, user } = fixture()
    user.passwordHash = await bcrypt.hash('OldPass123', 4)
    await expect(service.changePassword(7, 2, undefined, 'NewPass123')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(service.changePassword(7, 2, 'wrong', 'NewPass123')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(service.changePassword(7, 2, 'OldPass123', 'weak')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(repo.updatePassword).not.toHaveBeenCalled()
    await service.changePassword(7, 2, 'OldPass123', 'NewPass123')
    expect(await bcrypt.compare('NewPass123', repo.updatePassword.mock.calls[0]![1])).toBe(true)
    user.forcePasswordChange = true
    await service.changePassword(7, 2, undefined, 'Forced123')
    expect(await bcrypt.compare('Forced123', repo.updatePassword.mock.calls[1]![1])).toBe(true)
  })
  it('publishes ACL membership change once for actual group changes, not order', async () => {
    const { service, repo, events } = fixture()
    await service.update(7, { groupIds: [20, 10], name: 'Changed', role: 'admin', canManageHosts: true, canViewLiveSessions: false }, 2, 8)
    expect(events.publish).not.toHaveBeenCalled()
    expect(repo.update).toHaveBeenCalledWith(7, expect.objectContaining({ role: 'ADMIN', canViewLiveSessions: false }))
    await service.update(7, { groupIds: [30] }, 2, 8)
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'user_acl_membership_changed', tenantId: 2, userId: 7, actorId: 8, previousGroupIds: [10, 20], nextGroupIds: [30] }))
    events.publish.mockRejectedValue(new Error('bus down'))
    expect(await service.update(7, { groupIds: [] }, 2)).toMatchObject({ groupIds: [] })
    expect(await service.update(7, {}, 2)).toMatchObject({ groupIds: [10, 20] })
  })
  it('soft deletes, restores deleted users and resets MFA without exposing secrets', async () => {
    const { service, repo, user } = fixture()
    await service.softDelete(7, 2, 8)
    expect(repo.softDelete).toHaveBeenCalledWith(7)
    await expect(service.restore(7, 2)).rejects.toThrow()
    Object.assign(user, { deletedAt: new Date() })
    expect(await service.restore(7, 2, 8)).toMatchObject({ active: true })
    expect(repo.restore).toHaveBeenCalledWith(7)
    expect(await service.resetMfa(7, 2, 8)).toMatchObject({ mfaEnabled: false })
    expect(repo.resetMfa).toHaveBeenCalledWith(7)
    expect(await service.setActive(7, true, 2, 8)).toMatchObject({ active: true })
  })
  it('merges preference patches with defaults and validates schema before storage', async () => {
    const { service, repo } = fixture()
    expect(await service.getPreferences(7, 2)).toBeNull()
    repo.findPreferencesByIdInTenant.mockResolvedValue({ ui: { themeMode: 'dark' } })
    const result = await service.updatePreferences(7, 2, { ui: { themeMode: 'light' } })
    expect(result.ui.themeMode).toBe('light'); expect(result.terminal).toHaveProperty('fontSize')
    expect(repo.updatePreferences).toHaveBeenCalledWith(7, result)
    expect((await service.getPreferences(7, 2))?.ui.themeMode).toBe('dark')
    repo.updatePreferences.mockClear()
    await expect(service.updatePreferences(7, 2, { ui: { themeMode: 'invalid' } } as never)).rejects.toThrow()
    expect(repo.updatePreferences).not.toHaveBeenCalled()
  })
})

describe('UserService real private avatar storage', () => {
  let root: string
  const original = env.USER_AVATAR_STORAGE_DIR
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'na0090-avatar-')); env.USER_AVATAR_STORAGE_DIR = root })
  afterEach(async () => { env.USER_AVATAR_STORAGE_DIR = original; await rm(root, { recursive: true, force: true }) })
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  it.each([['png', png, 'image/png'], ['jpg', Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg'], ['webp', Buffer.from('RIFF0000WEBP'), 'image/webp']] as const)('stores %s by detected content, reads exact bytes, removes metadata/file', async (_name, buffer, mimeType) => {
    const { service, repo } = fixture()
    const result = await service.updateOwnAvatar(7, 2, { buffer, filename: '../../ignored', mimetype: 'text/plain' }, 8)
    expect(result.avatarUrl).toBeTruthy()
    const updatedAt = repo.updateAvatarMetadata.mock.calls[0]![2]
    repo.findAvatarMetadata.mockResolvedValue({ mimeType, avatarUpdatedAt: updatedAt })
    const file = join(root, createHash('sha256').update('2').digest('hex').slice(0, 16), '7.avatar')
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(await service.getAvatar(7, 2)).toEqual({ buffer, mimeType, updatedAt })
    await service.removeOwnAvatar(7, 2, 8)
    expect(repo.clearAvatarMetadata).toHaveBeenCalledWith(7)
    await expect(stat(file)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(service.getAvatar(7, 2)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await service.removeOwnAvatar(7, 2)
  })
  it('rejects empty, oversized, unsupported and foreign-tenant uploads before storage', async () => {
    const { service, repo } = fixture()
    for (const buffer of [Buffer.alloc(0), Buffer.alloc(512 * 1024 + 1), Buffer.from('<svg/>')]) {
      await expect(service.updateOwnAvatar(7, 2, { buffer })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    }
    await expect(service.updateOwnAvatar(7, 99, { buffer: png })).rejects.toThrow()
    await expect(service.removeOwnAvatar(7, 99)).rejects.toThrow()
    await expect(service.getAvatar(7, 99)).rejects.toThrow()
    expect(repo.updateAvatarMetadata).not.toHaveBeenCalled()
  })
})
