import { describe, expect, it, vi } from 'vitest'
import { VaultExtensionWriteSchema } from '@nodeaccess/shared'
import { personalItemWriter, writePersonalInTransaction } from './vault-extension-write.js'
import { generateKeyPairSync } from 'node:crypto'
vi.mock('../../config/env.js', () => ({ env: { PEM_ENCRYPTION_KEY: '0'.repeat(64) } }))

describe('E3 personal writer', () => {
  it('executes real portal services and repositories against the supplied transaction, with mandatory audit', async () => {
    const row = { id: 4, tenantId: 11, alias: 'mine', description: null, scope: 'PERSONAL', ownerUserId: 7, owner: 7, groupId: null, createdByUserId: 7,
      createdByUsername: null, source: 'MANUAL', encryptedValue: 'cipher', iv: 'iv', createdAt: new Date(), updatedAt: new Date(), rotatedAt: null, revokedAt: null }
    const db = { $queryRaw: vi.fn().mockResolvedValue([row]), $executeRaw: vi.fn().mockResolvedValue(1),
      pemKey: { create: vi.fn().mockResolvedValue({ id: 8, name: 'pem', createdById: 7, createdAt: new Date() }) }, adminLog: { create: vi.fn().mockResolvedValue({}) } }
    const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
    for (const input of [
      { operation: 'create-secret', alias: 'mine', value: 'transaction-value' },
      { operation: 'update-secret', id: 4, alias: 'mine' },
      { operation: 'rotate-secret', id: 4, value: 'transaction-value' },
      { operation: 'import-pem', name: 'pem', key },
    ] as const) await writePersonalInTransaction(db as never, { userId: 7, tenantId: 11, sessionVersion: 2 }, input)
    expect(db.$executeRaw).toHaveBeenCalledTimes(3)
    expect(db.pemKey.create).toHaveBeenCalledOnce()
    expect(db.adminLog.create).toHaveBeenCalledTimes(4)
    expect(JSON.stringify(db.adminLog.create.mock.calls)).not.toMatch(/transaction-value|PRIVATE KEY/)
    db.adminLog.create.mockRejectedValueOnce(new Error('audit unavailable'))
    await expect(writePersonalInTransaction(db as never, { userId: 7, tenantId: 11, sessionVersion: 2 },
      { operation: 'create-secret', alias: 'mine', value: 'value' })).rejects.toThrow('audit unavailable')
  })
  function setup() {
    const secrets = { create: vi.fn().mockResolvedValue({ id: 4, value: 'must-not-return' }), update: vi.fn().mockResolvedValue({ id: 4 }), rotate: vi.fn().mockResolvedValue({ id: 4 }) }
    const pems = { create: vi.fn().mockResolvedValue({ id: 8, key: 'must-not-return' }) }
    return { secrets, pems, write: personalItemWriter(secrets as never, pems as never) }
  }
  const identity = { userId: 7, tenantId: 11, sessionVersion: 2 }
  it('derives personal ownership, uses portal services and returns only an id', async () => {
    const h = setup()
    await expect(h.write(identity, { operation: 'create-secret', alias: 'test', value: 'new', description: 'desc' })).resolves.toEqual({ id: 4 })
    expect(h.secrets.create).toHaveBeenCalledWith(7, 11, 'user', { alias: 'test', value: 'new', description: 'desc', scope: 'PERSONAL', source: 'MANUAL' })
    await h.write(identity, { operation: 'create-secret', alias: 'test', value: 'new' })
    await h.write(identity, { operation: 'update-secret', id: 4, description: null })
    expect(h.secrets.update).toHaveBeenLastCalledWith(4, 7, 11, 'user', { description: null }, true)
    await h.write(identity, { operation: 'update-secret', id: 4, alias: 'renamed' })
    expect(h.secrets.update).toHaveBeenLastCalledWith(4, 7, 11, 'user', { alias: 'renamed' }, true)
    await h.write(identity, { operation: 'rotate-secret', id: 4, value: 'replacement' })
    expect(h.secrets.rotate).toHaveBeenCalledWith(4, 7, 11, 'user', { value: 'replacement' }, true)
    for (const passphrase of [undefined, 'key-pass']) {
      const input = { operation: 'import-pem' as const, name: 'key', key: 'private-material', ...(passphrase ? { passphrase } : {}) }
      await expect(h.write(identity, input)).resolves.toEqual({ id: 8 })
      expect(h.pems.create).toHaveBeenLastCalledWith({ name: 'key', key: 'private-material', ...(passphrase ? { passphrase } : {}) }, 7)
    }
  })
  it('rejects scope and ownership injection, wrong ids and oversized input before calling a service', async () => {
    const h = setup()
    for (const extra of [{ scope: 'TENANT' }, { ownerUserId: 9 }, { tenantId: 10 }, { groupId: 1 }, { source: 'HOST_CONNECTION' }]) {
      await expect(h.write(identity, { operation: 'create-secret', alias: 'test', value: 'new', ...extra } as never)).rejects.toThrow()
    }
    for (const input of [
      { operation: 'update-secret', id: 0 }, { operation: 'rotate-secret', id: 4, value: '' },
      { operation: 'update-secret', id: 4, value: 'unexpected' },
      { operation: 'import-pem', name: 'key', key: 'x'.repeat(65536) },
      { operation: 'create-secret', alias: 'bad alias', value: 'new' },
    ]) expect(VaultExtensionWriteSchema.safeParse(input).success).toBe(false)
    expect(h.secrets.create).not.toHaveBeenCalled()
  })
  it('propagates validation/ACL failures from portal services without attempting a second operation', async () => {
    const h = setup()
    h.pems.create.mockRejectedValueOnce(new Error('invalid PEM'))
    await expect(h.write(identity, { operation: 'import-pem', name: 'key', key: 'bad' })).rejects.toThrow('invalid PEM')
    h.secrets.update.mockRejectedValueOnce(new Error('denied'))
    await expect(h.write(identity, { operation: 'update-secret', id: 8, alias: 'name' })).rejects.toThrow('denied')
    expect(h.secrets.rotate).not.toHaveBeenCalled()
  })
})


describe('E4 shared write uses the portal ACL inside the supplied transaction', () => {
  const identity = { userId: 7, tenantId: 11, sessionVersion: 2 }
  function fixture() {
    const row = { id: 4, tenantId: 11, alias: 'shared', description: null, scope: 'GROUP', owner: null, ownerUserId: null, groupId: 12, createdByUserId: 7,
      createdByUsername: null, source: 'MANUAL', encryptedValue: 'cipher', iv: 'iv', createdAt: new Date(), updatedAt: new Date(), rotatedAt: null, revokedAt: null }
    const state = { row, member: true, group: true, grant: { enabled: true, grantedBy: 8, approvedBy: 9 } }
    const db = { $queryRaw: vi.fn((query: { strings?: string[] } | TemplateStringsArray) => Promise.resolve().then(() => {
      const sql = (Array.isArray(query) ? query : (query as { strings: string[] }).strings).join('?')
      if (sql.includes('vault_entitlements')) return [state.grant]
      if (sql.includes('user_groups')) return state.member ? [{ groupId: 12 }] : []
      if (sql.includes('FROM `groups`')) return state.group ? [{ id: 12 }] : []
      return [row]
    })), $executeRaw: vi.fn().mockResolvedValue(1), adminLog: { create: vi.fn().mockResolvedValue({}) } }
    const write = (input: unknown, role: 'admin' | 'user' = 'user') => writePersonalInTransaction(db as never, identity, input as never, role)
    return { state, db, write }
  }
  it('allows a member to create in their group and the creator to edit/rotate, auditing each operation', async () => {
    const h = fixture()
    await h.write({ operation: 'create-secret', scope: 'GROUP', groupId: 12, alias: 'shared', value: 'new-value' })
    await h.write({ operation: 'update-secret', scope: 'GROUP', groupId: 12, id: 4, description: 'edited' })
    await h.write({ operation: 'rotate-secret', scope: 'GROUP', groupId: 12, id: 4, value: 'new-value' })
    expect(h.db.adminLog.create).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(h.db.adminLog.create.mock.calls)).not.toContain('new-value')
    h.db.adminLog.create.mockRejectedValueOnce(new Error('mandatory audit'))
    await expect(h.write({ operation: 'rotate-secret', scope: 'GROUP', groupId: 12, id: 4, value: 'new-value' })).rejects.toThrow('mandatory audit')
  })
  it.each(['disabled', 'self', 'same-manager', 'nonmember', 'other-tenant', 'tenant-user', 'missing-group', 'pem-scope'])('rejects %s before mutation', async mode => {
    const h = fixture()
    if (mode === 'disabled') h.state.grant.enabled = false
    if (mode === 'self') h.state.grant.approvedBy = 7
    if (mode === 'same-manager') h.state.grant.approvedBy = 8
    if (mode === 'nonmember') h.state.member = false
    if (mode === 'other-tenant') h.state.group = false
    const input = mode === 'pem-scope' ? { operation: 'import-pem', name: 'key', key: 'pem', scope: 'GROUP' } :
      { operation: 'create-secret', alias: 'shared', value: 'new', scope: mode === 'tenant-user' ? 'TENANT' : 'GROUP', ...(mode === 'tenant-user' || mode === 'missing-group' ? {} : { groupId: 12 }) }
    await expect(h.write(input)).rejects.toThrow()
    expect(h.db.$executeRaw).not.toHaveBeenCalled(); expect(h.db.adminLog.create).not.toHaveBeenCalled()
  })
  it('denies a group reader edit and implicit scope, but permits tenant admin with the grant', async () => {
    const h = fixture(); h.state.row.createdByUserId = 20
    await expect(h.write({ operation: 'update-secret', id: 4, scope: 'GROUP', groupId: 12, alias: 'edited' })).rejects.toThrow()
    await expect(h.write({ operation: 'rotate-secret', id: 4, value: 'new' })).rejects.toThrow()
    await expect(h.write({ operation: 'rotate-secret', id: 4, scope: 'PERSONAL', value: 'new' })).rejects.toThrow()
    await h.write({ operation: 'update-secret', id: 4, scope: 'GROUP', groupId: 12, alias: 'edited' }, 'admin')
    await h.write({ operation: 'create-secret', scope: 'TENANT', alias: 'tenant', value: 'new' }, 'admin')
    h.state.grant.enabled = false
    await expect(h.write({ operation: 'create-secret', scope: 'TENANT', alias: 'tenant', value: 'new' }, 'admin')).rejects.toThrow()
  })
})
