import { describe, expect, it, vi } from 'vitest'
import { vaultDiagnostics } from './vault-diagnostics'
import type { VaultPortalIdentity, VaultTransport } from './vault-http'
const identity: VaultPortalIdentity = { userId: 1, tenantId: 7, accessToken: 'a', refreshToken: 'r', origin: 'https://example.test' }
const reply = { kind: 'configuration', userId: 2, secretId: 10, user: { exists: true, active: true, deleted: false },
  policy: { reveal: true, copy: false }, grants: { reveal: false, copy: false }, item: { released: true, revoked: false }, acl: true, runtime: 'not-evaluated' }
describe('vault diagnostics client', () => {
  it('uses existing confirmation and abort signal with no retries', async () => {
    const post = vi.fn().mockResolvedValue(reply), signal = new AbortController().signal
    expect(await vaultDiagnostics({ post } as VaultTransport, identity, 'client', 'session', 2, 10, signal)).toEqual(reply)
    expect(post).toHaveBeenCalledExactlyOnceWith('administration/diagnostics', { userId: 2, secretId: 10, sessionId: 'session' }, identity, 'client', signal)
  })
  it.each([{ ...reply, secretId: 11 }, { ...reply, userId: 3 }, { ...reply, encrypted: 'never' }, {}])('rejects unexpected or mismatched reply', async value => {
    const post = vi.fn().mockResolvedValue(value)
    await expect(vaultDiagnostics({ post } as VaultTransport, identity, 'c', 's', 2, 10)).rejects.toMatchObject({ reason: 'unavailable' })
  })
  it('does not request before confirmation or with invalid input', async () => {
    const post = vi.fn()
    await expect(vaultDiagnostics({ post } as VaultTransport, identity, 'c', '', 2, 10)).rejects.toMatchObject({ reason: 'locked' })
    await expect(vaultDiagnostics({ post } as VaultTransport, identity, 'c', 's', 2, 0)).rejects.toThrow()
    expect(post).not.toHaveBeenCalled()
  })
  it('propagates expiry without retrying', async () => {
    const post = vi.fn().mockRejectedValue(new Error('expired'))
    await expect(vaultDiagnostics({ post } as VaultTransport, identity, 'c', 's', 2, 10)).rejects.toThrow('expired')
    expect(post).toHaveBeenCalledTimes(1)
  })
})
