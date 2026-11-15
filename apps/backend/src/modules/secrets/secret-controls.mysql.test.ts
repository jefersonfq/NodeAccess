import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { encrypt } from '../../shared/crypto.js'
import { SecretRepository } from './secret.repository.js'
import { SecretService } from './secret.service.js'

describe.skipIf(process.env.RUN_ACL_MYSQL !== 'true')('Cofre tenant and membership boundaries against disposable MySQL', () => {
  it('isolates tenants and personal/group scope, observes removal, rotation and revocation', async () => {
    const url = process.env.ACL_TEST_DATABASE_URL
    if (!url || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) throw new Error('Explicit local disposable database required')
    const db = new PrismaClient({ datasources: { db: { url } } })
    const prefix = `secret-review-${randomUUID()}`
    const rollback = new Error('FIXTURE_ROLLBACK')
    try {
      await expect(db.$transaction(async tx => {
        const tenant = await tx.tenant.create({ data: { name: prefix, slug: prefix } })
        const other = await tx.tenant.create({ data: { name: `${prefix}-other`, slug: `${prefix}-other` } })
        const member = await tx.user.create({ data: { tenantId: tenant.id, name: 'Member', email: `${prefix}@test.invalid` } })
        const peer = await tx.user.create({ data: { tenantId: tenant.id, name: 'Peer', email: `${prefix}-peer@test.invalid` } })
        const outsider = await tx.user.create({ data: { tenantId: other.id, name: 'Outsider', email: `${prefix}-other@test.invalid` } })
        const group = await tx.group.create({ data: { tenantId: tenant.id, name: 'Review' } })
        await tx.userGroup.create({ data: { userId: member.id, groupId: group.id } })
        const value = encrypt('disposable-mysql-value')
        const common = { tenantId: tenant.id, encryptedValue: value.encrypted, iv: value.iv, createdByUserId: member.id }
        const grouped = await tx.secret.create({ data: { ...common, alias: 'grouped', scope: 'GROUP', groupId: group.id } })
        const personal = await tx.secret.create({ data: { ...common, alias: 'personal', scope: 'PERSONAL', ownerUserId: member.id } })
        const logs = { logAdminEvent: vi.fn().mockResolvedValue(undefined) }
        const service = new SecretService(new SecretRepository(tx as unknown as PrismaClient), logs as never, { requireFeature: vi.fn().mockResolvedValue(undefined) } as never)
        const resolve = (id: number, userId = member.id, tenantId = tenant.id, role: 'admin' | 'user' = 'user') => service.resolveValueById(id, userId, tenantId, role, { resourceType: 'ReviewFixture' })
        await expect(resolve(grouped.id)).resolves.toBe('disposable-mysql-value')
        await expect(resolve(personal.id)).resolves.toBe('disposable-mysql-value')
        await expect(resolve(personal.id, peer.id)).rejects.toMatchObject({ statusCode: 403 })
        await expect(resolve(grouped.id, outsider.id, other.id, 'admin')).rejects.toMatchObject({ statusCode: 403 })
        await tx.userGroup.delete({ where: { userId_groupId: { userId: member.id, groupId: group.id } } })
        await expect(resolve(grouped.id)).rejects.toMatchObject({ statusCode: 403 })
        const rotated = encrypt('disposable-rotated-value')
        await tx.secret.update({ where: { id: personal.id }, data: { encryptedValue: rotated.encrypted, iv: rotated.iv, rotatedAt: new Date() } })
        await expect(resolve(personal.id)).resolves.toBe('disposable-rotated-value')
        await tx.secret.update({ where: { id: personal.id }, data: { revokedAt: new Date() } })
        await expect(resolve(personal.id)).rejects.toMatchObject({ statusCode: 403 })
        expect(JSON.stringify(logs.logAdminEvent.mock.calls)).not.toContain('disposable-mysql-value')
        expect(JSON.stringify(logs.logAdminEvent.mock.calls)).not.toContain('disposable-rotated-value')
        throw rollback
      }, { timeout: 30000 })).rejects.toBe(rollback)
      expect(await db.tenant.count({ where: { slug: { startsWith: prefix } } })).toBe(0)
    } finally { await db.$disconnect() }
  }, 40000)
})
