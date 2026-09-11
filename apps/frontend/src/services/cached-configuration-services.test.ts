import { beforeEach, describe, expect, it, vi } from 'vitest'

const { get, put, post } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }))
vi.mock('./api', () => ({ default: { get, put, post, delete: vi.fn() } }))

import { emailConfigService } from './email-config.service'
import { scimService } from './scim.service'

describe('cached configuration services', () => {
  beforeEach(() => {
    get.mockReset()
    put.mockReset()
    post.mockReset()
  })

  it('coalesces email configuration reads and updates the cached snapshot after save', async () => {
    const initial = { id: 1, provider: 'smtp', host: 'smtp.old', port: 587, secure: true, user: 'ops', fromName: 'NodeAccess' }
    const updated = { ...initial, host: 'smtp.new' }
    get.mockResolvedValue({ data: initial })
    put.mockResolvedValue({ data: updated })

    const [first, second] = await Promise.all([emailConfigService.get(), emailConfigService.get()])
    expect(first).toBe(second)
    expect(get).toHaveBeenCalledTimes(1)

    await emailConfigService.upsert({ provider: 'smtp', host: 'smtp.new', port: 587, secure: true, user: 'ops', password: 'secret', fromName: 'NodeAccess' })
    await expect(emailConfigService.get()).resolves.toMatchObject({ data: { host: 'smtp.new' } })
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('invalidates SCIM metadata after rotating its token', async () => {
    get.mockResolvedValueOnce({ data: { enabled: true, tokenConfigured: true, tokenPrefix: 'old', rotatedAt: null } })
      .mockResolvedValueOnce({ data: { enabled: false, tokenConfigured: true, tokenPrefix: 'new', rotatedAt: '2026-09-03T12:00:00Z' } })
    post.mockResolvedValue({ data: { token: 'one-time-token', enabled: false, tokenPrefix: 'new', rotatedAt: '2026-09-03T12:00:00Z' } })

    await scimService.getConfig()
    await scimService.rotateToken()
    await scimService.getConfig()

    expect(get).toHaveBeenCalledTimes(2)
  })
})
