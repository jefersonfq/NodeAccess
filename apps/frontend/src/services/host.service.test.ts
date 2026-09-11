import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  get: vi.fn(),
  delete: vi.fn(),
}))
vi.mock('./api', () => ({ default: api }))

import { hostService } from './host.service'

describe('hostService deletion cache consistency', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.delete.mockReset()
    hostService.clear('test-reset')
  })

  it('invalidates a cached corporate-folder list after deleting a host', async () => {
    const query = { inventoryNodeId: 44, page: 1, limit: 40 }
    api.get
      .mockResolvedValueOnce({ data: { data: [{ id: 10, name: 'DB Produção' }], total: 1, page: 1, limit: 40, totalPages: 1 } })
      .mockResolvedValueOnce({ data: { data: [], total: 0, page: 1, limit: 40, totalPages: 0 } })
    api.delete.mockResolvedValueOnce({ data: undefined })

    await hostService.list(query)
    await hostService.list(query)
    expect(api.get).toHaveBeenCalledTimes(1)

    await hostService.delete(10)
    const refreshed = await hostService.list(query)

    expect(api.delete).toHaveBeenCalledWith('/hosts/10')
    expect(api.get).toHaveBeenCalledTimes(2)
    expect(refreshed.data.data).toEqual([])
  })

  it('preserves cached lists when the server rejects deletion', async () => {
    const query = { inventoryNodeId: 44, page: 1, limit: 40 }
    const cached = { data: { data: [{ id: 10, name: 'DB Produção' }], total: 1, page: 1, limit: 40, totalPages: 1 } }
    api.get.mockResolvedValueOnce(cached)
    api.delete.mockRejectedValueOnce({ response: { status: 409 } })

    await hostService.list(query)
    await expect(hostService.delete(10)).rejects.toBeTruthy()
    await expect(hostService.list(query)).resolves.toBe(cached)
    expect(api.get).toHaveBeenCalledTimes(1)
  })
})
