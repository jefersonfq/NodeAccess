import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { describe, expect, it } from 'vitest'
import { InventoryAclRepository } from './inventory-acl.repository.js'
import { InventoryAclService } from './inventory-acl.service.js'

// Real recursive SQL, real memberships, no committed fixtures. Explicit local opt-in.
describe.skipIf(process.env.RUN_ACL_MYSQL !== 'true')('ACL isolation against MySQL', () => {
  it('isolates tenants and siblings, combines sources, revokes membership and follows host moves', async () => {
    const contents = process.env.ACL_TEST_DATABASE_URL ? '' : readFileSync('apps/backend/.env', 'utf8')
    const url = process.env.ACL_TEST_DATABASE_URL ?? contents.match(/^DATABASE_URL=(.+)$/m)?.[1].trim().replace(/^['"]|['"]$/g, '')
    if (!url || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) throw new Error('ACL integration requires an explicit local database')
    const db = new PrismaClient({ datasources: { db: { url } } })
    const rollback = new Error('ACL_FIXTURE_ROLLBACK')
    const prefix = `acl-test-${randomUUID()}`
    try {
      await expect(db.$transaction(async tx => {
        const tenant = await tx.tenant.create({ data: { name: prefix, slug: prefix } })
        const other = await tx.tenant.create({ data: { name: `${prefix}-other`, slug: `${prefix}-other` } })
        const alice = await tx.user.create({ data: { tenantId: tenant.id, name: 'Alice', email: `${prefix}-alice@test.invalid` } })
        const bob = await tx.user.create({ data: { tenantId: tenant.id, name: 'Bob', email: `${prefix}-bob@test.invalid` } })
        const outsider = await tx.user.create({ data: { tenantId: other.id, name: 'Other tenant', email: `${prefix}-other@test.invalid` } })
        const ops = await tx.group.create({ data: { tenantId: tenant.id, name: 'Ops' } })
        const editors = await tx.group.create({ data: { tenantId: tenant.id, name: 'Editors' } })
        const foreignGroup = await tx.group.create({ data: { tenantId: other.id, name: 'Foreign' } })
        const root = await tx.inventoryNode.create({ data: { tenantId: tenant.id, type: 'ROOT', name: 'Root', path: '/root' } })
        const folder = await tx.inventoryNode.create({ data: { tenantId: tenant.id, type: 'FOLDER', parentId: root.id, name: 'Ops', path: '/root/ops', depth: 1 } })
        const sibling = await tx.inventoryNode.create({ data: { tenantId: tenant.id, type: 'FOLDER', parentId: root.id, name: 'Private', path: '/root/private', depth: 1 } })
        const host = await tx.host.create({ data: { tenantId: tenant.id, name: 'ACL fixture', ip: '127.0.0.1', sshUser: 'unused', authType: 'PASSWORD', scope: 'GLOBAL' } })
        const personal = await tx.folder.create({ data: { tenantId: tenant.id, userId: alice.id, name: 'Personal shortcut' } })
        await tx.hostPersonalFolder.create({ data: { tenantId: tenant.id, userId: alice.id, hostId: host.id, folderId: personal.id } })
        const node = await tx.inventoryNode.create({ data: { tenantId: tenant.id, type: 'HOST', parentId: folder.id, hostId: host.id, name: host.name, path: '/root/ops/host', depth: 2 } })
        const repo = new InventoryAclRepository(tx as unknown as PrismaClient)
        const service = new InventoryAclService(repo)
        const grant = (id: number, type: 'USER' | 'GROUP' | 'ROLE', principalId: number, permissions: { view: boolean; connect: boolean; edit: boolean; admin: boolean }) => service.upsertEntry(id, { principalType: type, principalId, permissions }, tenant.id, alice.id, 'ADMIN')
        const denied = { view: false, connect: false, edit: false, admin: false }
        const view = { ...denied, view: true }
        const connect = { ...view, connect: true }
        expect(await service.resolveEffectivePermissions(node.id, tenant.id, alice.id)).toMatchObject(denied)
        await tx.userGroup.createMany({ data: [{ userId: alice.id, groupId: ops.id }, { userId: alice.id, groupId: editors.id }] })
        await grant(folder.id, 'GROUP', ops.id, connect)
        await grant(folder.id, 'GROUP', editors.id, { ...view, edit: true })
        const newChild = await tx.inventoryNode.create({ data: { tenantId: tenant.id, type: 'FOLDER', parentId: folder.id, name: 'Created after ACL', path: '/root/ops/new', depth: 2 } })
        expect(await service.resolveEffectivePermissions(newChild.id, tenant.id, alice.id)).toMatchObject({ ...connect, edit: true })
        await grant(node.id, 'USER', alice.id, view)
        const remaining = await service.previewImpact(node.id, { action: 'delete', principalType: 'USER', principalId: alice.id }, tenant.id, alice.id, 'ADMIN')
        expect(remaining.remainingAccess).toMatchObject({ usersEvaluated: 1, retainConnect: 1, loseConnect: 0 })
        expect(remaining.remainingAccess?.examples[0]?.after).toEqual({ ...connect, edit: true })
        expect(await service.resolveEffectivePermissions(node.id, tenant.id, alice.id)).toMatchObject({ ...connect, edit: true })
        expect(await service.resolveEffectivePermissions(node.id, tenant.id, bob.id)).toMatchObject(denied)
        expect(await service.resolveEffectivePermissions(sibling.id, tenant.id, alice.id)).toMatchObject(denied)
        expect(await service.resolveEffectivePermissions(root.id, tenant.id, alice.id)).toMatchObject(denied)
        expect(await service.resolveEffectivePermissions(node.id, other.id, outsider.id)).toMatchObject(denied)
        expect(await service.resolveEffectivePermissions(node.id, tenant.id, outsider.id)).toMatchObject(denied)
        await expect(grant(folder.id, 'USER', outsider.id, connect)).rejects.toMatchObject({ statusCode: 404 })
        await expect(grant(folder.id, 'GROUP', foreignGroup.id, connect)).rejects.toMatchObject({ statusCode: 404 })
        await expect(service.listEntries(folder.id, other.id, outsider.id, 'ADMIN')).rejects.toMatchObject({ statusCode: 404 })
        const batch = await repo.findEffectiveHostPermissions([host.id], tenant.id, alice.id)
        expect(Boolean(batch[0]?.canConnect)).toBe(true)
        expect(await repo.findEffectiveHostPermissions([host.id], other.id, outsider.id)).toEqual([])
        await tx.userGroup.delete({ where: { userId_groupId: { userId: alice.id, groupId: ops.id } } })
        expect(await service.resolveEffectivePermissions(node.id, tenant.id, alice.id)).toMatchObject({ ...view, edit: true, connect: false })
        await tx.userGroup.deleteMany({ where: { userId: alice.id } })
        expect(await service.resolveEffectivePermissions(node.id, tenant.id, alice.id)).toMatchObject(view)
        await service.deleteEntry(node.id, 'USER', alice.id, tenant.id, alice.id, 'ADMIN')
        expect(await service.resolveEffectivePermissions(node.id, tenant.id, alice.id)).toMatchObject(denied)
        await tx.userGroup.create({ data: { userId: alice.id, groupId: ops.id } })
        await tx.inventoryNode.update({ where: { id: node.id }, data: { parentId: sibling.id, path: '/root/private/host' } })
        expect(await service.resolveEffectivePermissions(node.id, tenant.id, alice.id)).toMatchObject(denied)
        await grant(sibling.id, 'ROLE', 1, view)
        expect(await service.resolveEffectivePermissions(node.id, tenant.id, bob.id)).toMatchObject(view)
        expect(await service.resolveEffectivePermissions(node.id, tenant.id, outsider.id)).toMatchObject(denied)
        await tx.user.update({ where: { id: bob.id }, data: { deletedAt: new Date() } })
        expect(await service.resolveEffectivePermissions(node.id, tenant.id, bob.id)).toMatchObject(denied)
        await tx.user.createMany({ data: Array.from({ length: 105 }, (_, index) => ({ tenantId: tenant.id, name: `Search person ${String(index).padStart(3, '0')}`, email: `${prefix}-search-${index}@test.invalid` })) })
        await tx.user.create({ data: { tenantId: tenant.id, name: 'Search person inactive', email: `${prefix}-inactive@test.invalid`, active: false } })
        const secondPage = await service.searchUsers(folder.id, tenant.id, alice.id, 'ADMIN', 'Search person', 2)
        expect(secondPage).toMatchObject({ total: 105, page: 2, limit: 30 })
        expect(secondPage.data).toHaveLength(30)
        expect(secondPage.data[0]?.name).toBe('Search person 030')
        const byEmail = await service.searchUsers(folder.id, tenant.id, alice.id, 'ADMIN', `${prefix}-search-104@`, 1)
        expect(byEmail.data).toHaveLength(1)
        expect(byEmail.data[0]?.name).toBe('Search person 104')
        const foreign = await repo.searchUsers(tenant.id, outsider.email, 1)
        expect(foreign.total).toBe(0)
        throw rollback
      }, { timeout: 30000 })).rejects.toBe(rollback)
      expect(await db.tenant.count({ where: { slug: { startsWith: prefix } } })).toBe(0)
    } finally { await db.$disconnect() }
  }, 40000)
})
