import { describe, expect, it, vi } from 'vitest'
import type { AdminLogRow, LogRepository } from './log.repository.js'
import { LogService } from './log.service.js'

describe('LogService inventory ACL audit', () => {
  it('lista apenas eventos relevantes para auditoria de ACL', async () => {
    const timestamp = new Date('2026-07-10T12:00:00.000Z')
    const row = {
      id: 1,
      adminId: 7,
      admin: { name: 'Admin' },
      action: 'UPSERT_INVENTORY_ACL',
      targetType: 'InventoryNode',
      targetId: 5,
      details: '{"principalType":"USER"}',
      timestamp,
    } as AdminLogRow
    const logRepo = {
      findAdminLogs: vi.fn().mockResolvedValue({ logs: [row], total: 1 }),
    }
    const service = new LogService(logRepo as unknown as LogRepository)

    const result = await service.listInventoryAclAudit(1, { search: 'jeferson', targetId: 5, page: 2, limit: 10 })

    expect(logRepo.findAdminLogs).toHaveBeenCalledWith(1, {
      search: 'jeferson',
      targetId: 5,
      page: 2,
      limit: 10,
      actions: [
        'UPSERT_INVENTORY_ACL',
        'DELETE_INVENTORY_ACL',
        'INVENTORY_ACL_SESSION_REVOKED',
        'INVENTORY_ACL_HOSTS_MOVED',
      ],
    })
    expect(result).toEqual({
      data: [{
        id: 1,
        adminId: 7,
        adminName: 'Admin',
        action: 'UPSERT_INVENTORY_ACL',
        targetType: 'InventoryNode',
        targetId: 5,
        details: '{"principalType":"USER"}',
        timestamp,
      }],
      total: 1,
      page: 2,
      limit: 10,
    })
  })
})
