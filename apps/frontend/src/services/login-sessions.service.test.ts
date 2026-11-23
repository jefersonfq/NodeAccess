import { describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ get: vi.fn(), delete: vi.fn(), post: vi.fn() }))
vi.mock('./api', () => ({ default: api }))
import { loginSessionsService } from './login-sessions.service'

describe('NA-0187 login sessions service', () => {
  it('calls the admin endpoints and unwraps the data', async () => {
    api.get.mockResolvedValueOnce({ data: { data: [{ userId: 2, sessions: 1, lastSeenAt: 3 }] } })
    expect(await loginSessionsService.online()).toEqual([{ userId: 2, sessions: 1, lastSeenAt: 3 }])
    expect(api.get).toHaveBeenLastCalledWith('/users/online')
    api.get.mockResolvedValueOnce({ data: { data: [] } })
    expect(await loginSessionsService.list(5)).toEqual([]); expect(api.get).toHaveBeenLastCalledWith('/users/5/login-sessions')
    await loginSessionsService.revoke(5, 'a'.repeat(32)); expect(api.delete).toHaveBeenCalledWith(`/users/5/login-sessions/${'a'.repeat(32)}`)
    await loginSessionsService.revokeAll(5); expect(api.post).toHaveBeenCalledWith('/users/5/login-sessions/revoke-all', {})
  })
})
