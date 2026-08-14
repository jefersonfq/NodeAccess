import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'mysql://user:pass@127.0.0.1:3306/nodeaccess_test'
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379'
  process.env.JWT_SECRET ||= 'test-jwt-secret-with-at-least-32-chars'
  process.env.PEM_ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  process.env.NODE_ENV ||= 'test'
})

import { GroupService } from '../groups/group.service.js'
import { HostService } from '../hosts/host.service.js'

describe('host-backed bastion cycle guards', () => {
  it('rejects a Host using its own bastion profile', async () => {
    const repository = {
      bastionExists: vi.fn().mockResolvedValue(true),
      findBastionSourceHostId: vi.fn().mockResolvedValue(21),
      findBastionProfileIdBySourceHost: vi.fn().mockResolvedValue(31),
    }
    const service = new HostService(repository as never, {} as never, {} as never, {} as never, {} as never, {} as never)
    const guard = service as unknown as { assertTenantBastion: (bastionId: number, tenantId: number, hostId: number) => Promise<void> }
    await expect(guard.assertTenantBastion(31, 7, 21)).rejects.toThrow('si mesmo')
  })

  it('rejects a source Host depending on any other bastion', async () => {
    const repository = {
      bastionExists: vi.fn().mockResolvedValue(true),
      findBastionSourceHostId: vi.fn().mockResolvedValue(99),
      findBastionProfileIdBySourceHost: vi.fn().mockResolvedValue(31),
    }
    const service = new HostService(repository as never, {} as never, {} as never, {} as never, {} as never, {} as never)
    const guard = service as unknown as { assertTenantBastion: (bastionId: number, tenantId: number, hostId: number) => Promise<void> }
    await expect(guard.assertTenantBastion(44, 7, 21)).rejects.toThrow('atua como bastion')
  })

  it('rejects inherited multi-hop when a group contains a source Host', async () => {
    const repository = {
      bastionExists: vi.fn().mockResolvedValue(true),
      groupContainsBastionSourceHost: vi.fn().mockResolvedValue(true),
    }
    const service = new GroupService(repository as never, {} as never)
    const guard = service as unknown as { assertTenantBastion: (bastionId: number, tenantId: number, groupId: number) => Promise<void> }
    await expect(guard.assertTenantBastion(44, 7, 8)).rejects.toThrow('contém um host bastion')
  })
})
