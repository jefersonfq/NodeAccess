import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureCurrentSessionReader } from './current-session.js'
import { UserSessionRevocationService } from './user-session-revocation.service.js'

const event = { type: 'user_sessions_revoked' as const, tenantId: 1, userId: 7, sessionVersion: 2, reason: 'logout_all' as const, changedAt: new Date().toISOString() }
function fixture() {
  configureCurrentSessionReader( () => Promise.resolve(({ tenantId: 1, active: false, deletedAt: new Date(), tenantActive: true, targetTenantActive: true, sessionVersion: 2, role: 'USER', isPlatformAdmin: false, canManageHosts: false, canViewLiveSessions: false })))
  const bus = { onEvent: vi.fn() }
  const repo = { findActiveAuthenticatedByPrincipal: vi.fn().mockResolvedValue([{ id: 10 }, { id: 11 }]) }
  const runtime = { closeSession: vi.fn().mockResolvedValue({ closed: true, handledByRuntime: true }) }
  const resources = { closeRevokedByUser: vi.fn().mockResolvedValue(1) }
  const service = new UserSessionRevocationService(bus as never, repo as never, runtime as never, resources)
  return { service, repo, runtime, resources, bus }
}
afterEach(() => configureCurrentSessionReader(undefined))
describe('UserSessionRevocationService', () => {
  it('closes all persisted principal sessions including delegated targets and disabled identities', async () => {
    const f = fixture()
    await f.service.revoke(event)
    expect(f.repo.findActiveAuthenticatedByPrincipal).toHaveBeenCalledWith(1, 7)
    expect(f.runtime.closeSession).toHaveBeenCalledWith(10, undefined, 'session_revoked')
    expect(f.runtime.closeSession).toHaveBeenCalledWith(11, undefined, 'session_revoked')
    expect(f.resources.closeRevokedByUser).toHaveBeenCalledWith(1, 7)
  })
  it('rejects a forged origin or unpersisted future version', async () => {
    const f = fixture()
    await f.service.revoke({ ...event, tenantId: 3 })
    await f.service.revoke({ ...event, sessionVersion: 3 })
    expect(f.repo.findActiveAuthenticatedByPrincipal).not.toHaveBeenCalled()
    expect(f.resources.closeRevokedByUser).not.toHaveBeenCalled()
  })
  it('attempts every runtime and remaining resources even if one runtime fails', async () => {
    const f = fixture()
    f.runtime.closeSession.mockRejectedValueOnce(new Error('runtime unavailable'))
    await f.service.revoke(event)
    expect(f.runtime.closeSession).toHaveBeenCalledTimes(2)
    expect(f.resources.closeRevokedByUser).toHaveBeenCalledOnce()
  })
  it('fails closed when persisted identity cannot be read', async () => {
    const f = fixture()
    configureCurrentSessionReader(() => Promise.reject(new Error('storage unavailable')))
    await expect(f.service.revoke(event)).rejects.toMatchObject({ statusCode: 503 })
    expect(f.runtime.closeSession).not.toHaveBeenCalled()
  })
})
