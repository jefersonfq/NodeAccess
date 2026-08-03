import { describe, expect, it, vi } from 'vitest'
import type { HostBulkActionRepository, HostBulkRow } from './host-bulk-action.repository.js'
import { HostBulkActionService } from './host-bulk-action.service.js'

function makeHost(): HostBulkRow {
  return {
    id: 10,
    name: 'db-01',
    ip: '10.0.0.10',
    port: 22,
    authType: 'PASSWORD',
    bastionId: null,
    pemKeyId: null,
    bastion: null,
    pemKey: null,
    tags: [],
    group: null,
    inventoryNode: {
      parentId: 2,
      parent: { name: 'Legado', type: 'FOLDER' },
    },
  } as unknown as HostBulkRow
}

describe('HostBulkActionService inventory move', () => {
  it('mantém ações em massa exclusivas de administradores', async () => {
    const repo = {
      inventoryFolder: vi.fn().mockResolvedValue({ name: 'Produção', aclEntries: 2 }),
      countSelection: vi.fn().mockResolvedValue(1),
      resolveSelection: vi.fn().mockResolvedValue([makeHost()]),
      applyAction: vi.fn().mockResolvedValue(undefined),
      createHistory: vi.fn().mockResolvedValue(undefined),
    }
    const service = new HostBulkActionService(
      repo as unknown as HostBulkActionRepository,
      { logAdminEvent: vi.fn().mockResolvedValue(undefined) } as never,
    )
    const dto = {
      selection: { mode: 'ids' as const, hostIds: [10] },
      action: { type: 'move_inventory' as const, inventoryParentId: 5 },
    }

    await expect(service.preview(dto, 1, 7, 'USER')).rejects.toThrow('exigem administrador')
    await expect(service.apply({ ...dto, confirm: true }, 1, 7, 'USER')).rejects.toThrow('exigem administrador')

    expect(repo.inventoryFolder).not.toHaveBeenCalled()
    expect(repo.countSelection).not.toHaveBeenCalled()
    expect(repo.resolveSelection).not.toHaveBeenCalled()
    expect(repo.applyAction).not.toHaveBeenCalled()
  })

  it('move o lote e preserva a pasta anterior para rollback', async () => {
    const repo = {
      inventoryFolder: vi.fn().mockResolvedValue({ name: 'Produção', aclEntries: 2 }),
      countSelection: vi.fn().mockResolvedValue(1),
      resolveSelection: vi.fn().mockResolvedValue([makeHost()]),
      applyAction: vi.fn().mockResolvedValue(undefined),
      createHistory: vi.fn().mockResolvedValue(undefined),
    }
    const appEventBus = {
      publish: vi.fn().mockResolvedValue(undefined),
    }
    const logRepo = {
      logAdminEvent: vi.fn().mockResolvedValue(undefined),
    }
    const service = new HostBulkActionService(
      repo as unknown as HostBulkActionRepository,
      logRepo as never,
      appEventBus as never,
    )

    const result = await service.apply({
      selection: { mode: 'ids', hostIds: [10] },
      action: { type: 'move_inventory', inventoryParentId: 5 },
      confirm: true,
    }, 1, 7, 'ADMIN')

    expect(repo.applyAction).toHaveBeenCalledWith([10], 1, {
      type: 'move_inventory',
      inventoryParentId: 5,
    }, 7)
    expect(result.rows[0]?.before).toMatchObject({ inventoryParentId: 2 })
    expect(result.rows[0]?.after).toMatchObject({ inventoryParentId: 5 })
    expect(appEventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'inventory_acl_changed',
      tenantId: 1,
      inventoryNodeId: 5,
      hostId: null,
      actorId: 7,
      action: 'move',
    }))
    expect(logRepo.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({
      adminId: 7,
      action: 'INVENTORY_ACL_HOSTS_MOVED',
      targetType: 'InventoryNode',
      targetId: 5,
    }))
  })

  it('bloqueia destino sem ACL aplicável', async () => {
    const repo = {
      inventoryFolder: vi.fn().mockResolvedValue({ name: 'Sem acesso', aclEntries: 0 }),
    }
    const service = new HostBulkActionService(
      repo as unknown as HostBulkActionRepository,
      {} as never,
    )

    await expect(service.preview({
      selection: { mode: 'ids', hostIds: [10] },
      action: { type: 'move_inventory', inventoryParentId: 5 },
    }, 1, 7, 'ADMIN')).rejects.toThrow('não possui ACL aplicável')
  })

  it('bloqueia host sem pasta corporativa vinculada antes de mover em massa', async () => {
    const hostWithoutInventory = {
      ...makeHost(),
      inventoryNode: null,
    } as HostBulkRow
    const repo = {
      inventoryFolder: vi.fn().mockResolvedValue({ name: 'Produção', aclEntries: 2 }),
      countSelection: vi.fn().mockResolvedValue(1),
      resolveSelection: vi.fn().mockResolvedValue([hostWithoutInventory]),
      applyAction: vi.fn().mockResolvedValue(undefined),
      createHistory: vi.fn().mockResolvedValue(undefined),
    }
    const logRepo = {
      logAdminEvent: vi.fn().mockResolvedValue(undefined),
    }
    const service = new HostBulkActionService(
      repo as unknown as HostBulkActionRepository,
      logRepo as never,
    )

    const preview = await service.preview({
      selection: { mode: 'ids', hostIds: [10] },
      action: { type: 'move_inventory', inventoryParentId: 5 },
    }, 1, 7, 'ADMIN')

    expect(preview.blocked).toBe(1)
    expect(preview.sample[0]?.errors).toContain('Host sem pasta corporativa/ACL vinculada')

    const result = await service.apply({
      selection: { mode: 'ids', hostIds: [10] },
      action: { type: 'move_inventory', inventoryParentId: 5 },
      confirm: true,
    }, 1, 7, 'ADMIN')

    expect(repo.applyAction).not.toHaveBeenCalled()
    expect(result.updated).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.rows[0]).toMatchObject({
      hostId: 10,
      status: 'skipped',
      message: 'Host sem pasta corporativa/ACL vinculada',
    })
  })

  it('ignora hosts que ja estao na pasta de destino', async () => {
    const repo = {
      inventoryFolder: vi.fn().mockResolvedValue({ name: 'Produção', aclEntries: 2 }),
      countSelection: vi.fn().mockResolvedValue(1),
      resolveSelection: vi.fn().mockResolvedValue([makeHost()]),
      applyAction: vi.fn().mockResolvedValue(undefined),
      createHistory: vi.fn().mockResolvedValue(undefined),
    }
    const appEventBus = {
      publish: vi.fn().mockResolvedValue(undefined),
    }
    const logRepo = {
      logAdminEvent: vi.fn().mockResolvedValue(undefined),
    }
    const service = new HostBulkActionService(
      repo as unknown as HostBulkActionRepository,
      logRepo as never,
      appEventBus as never,
    )

    const result = await service.apply({
      selection: { mode: 'ids', hostIds: [10] },
      action: { type: 'move_inventory', inventoryParentId: 2 },
      confirm: true,
    }, 1, 7, 'ADMIN')

    expect(repo.applyAction).not.toHaveBeenCalled()
    expect(appEventBus.publish).not.toHaveBeenCalled()
    expect(logRepo.logAdminEvent).not.toHaveBeenCalledWith(expect.objectContaining({
      action: 'INVENTORY_ACL_HOSTS_MOVED',
    }))
    expect(result.updated).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.rows[0]).toMatchObject({
      hostId: 10,
      status: 'skipped',
      message: 'Host já está na pasta de destino',
    })
  })

  it('move hosts acionaveis mesmo quando parte do lote ja esta na pasta de destino', async () => {
    const hostInDestination = makeHost()
    const hostToMove = {
      ...makeHost(),
      id: 11,
      name: 'app-01',
      inventoryNode: {
        parentId: 3,
        parent: { name: 'Legado', type: 'FOLDER' },
      },
    } as HostBulkRow
    const repo = {
      inventoryFolder: vi.fn().mockResolvedValue({ name: 'Produção', aclEntries: 2 }),
      countSelection: vi.fn().mockResolvedValue(2),
      resolveSelection: vi.fn().mockResolvedValue([hostInDestination, hostToMove]),
      applyAction: vi.fn().mockResolvedValue(undefined),
      createHistory: vi.fn().mockResolvedValue(undefined),
    }
    const appEventBus = {
      publish: vi.fn().mockResolvedValue(undefined),
    }
    const logRepo = {
      logAdminEvent: vi.fn().mockResolvedValue(undefined),
    }
    const service = new HostBulkActionService(
      repo as unknown as HostBulkActionRepository,
      logRepo as never,
      appEventBus as never,
    )

    const result = await service.apply({
      selection: { mode: 'ids', hostIds: [10, 11] },
      action: { type: 'move_inventory', inventoryParentId: 2 },
      confirm: true,
    }, 1, 7, 'ADMIN')

    expect(repo.applyAction).toHaveBeenCalledWith([11], 1, {
      type: 'move_inventory',
      inventoryParentId: 2,
    }, 7)
    expect(appEventBus.publish).toHaveBeenCalledTimes(1)
    expect(appEventBus.publish).toHaveBeenCalledWith(expect.objectContaining({
      inventoryNodeId: 2,
      hostId: null,
      action: 'move',
    }))
    expect(logRepo.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'INVENTORY_ACL_HOSTS_MOVED',
      targetType: 'InventoryNode',
      targetId: 2,
    }))
    expect(result.updated).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ hostId: 10, status: 'skipped', message: 'Host já está na pasta de destino' }),
      expect.objectContaining({ hostId: 11, status: 'updated' }),
    ]))
  })

  it('pula rollback de move_inventory quando a pasta anterior nao tem ACL aplicavel', async () => {
    const repo = {
      inventoryFolder: vi.fn().mockImplementation((id: number) => Promise.resolve(
        id === 2 ? { name: 'Legado', aclEntries: 1 } : { name: 'Sem ACL', aclEntries: 0 },
      )),
      getHistoryById: vi.fn().mockResolvedValue({
        id: 99,
        actorName: 'Admin',
        actorEmail: 'admin@example.com',
        actionType: 'move_inventory',
        actionLabel: 'Mover para pasta do inventário: Produção',
        selection: { mode: 'ids', hostIds: [10, 11] },
        action: { type: 'move_inventory', inventoryParentId: 5 },
        requested: 2,
        updated: 2,
        skipped: 0,
        failed: 0,
        rows: [
          {
            hostId: 10,
            name: 'db-01',
            status: 'updated',
            message: 'Atualizado',
            before: { inventoryParentId: 2 },
            after: { inventoryParentId: 5 },
          },
          {
            hostId: 11,
            name: 'app-01',
            status: 'updated',
            message: 'Atualizado',
            before: { inventoryParentId: 3 },
            after: { inventoryParentId: 5 },
          },
        ],
        createdAt: new Date(),
        reversible: true,
      }),
      restoreSnapshots: vi.fn().mockResolvedValue(new Set([10])),
      createHistory: vi.fn().mockResolvedValue(undefined),
    }
    const logRepo = {
      logAdminEvent: vi.fn().mockResolvedValue(undefined),
    }
    const service = new HostBulkActionService(
      repo as unknown as HostBulkActionRepository,
      logRepo as never,
    )

    const result = await service.rollback(99, 1, 7, 'ADMIN')

    expect(repo.restoreSnapshots).toHaveBeenCalledWith(
      1,
      [expect.objectContaining({ hostId: 10, inventoryParentId: 2 })],
      ['inventoryParentId'],
      7,
    )
    expect(result.updated).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ hostId: 10, status: 'updated', message: 'Rollback aplicado' }),
      expect.objectContaining({ hostId: 11, status: 'skipped', message: 'Pasta anterior do inventário não possui ACL aplicável' }),
    ]))
  })
})
