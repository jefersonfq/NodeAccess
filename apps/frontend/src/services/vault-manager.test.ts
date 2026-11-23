import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isVaultManager, vaultPortalIdentity } from './vault-manager'
import type { VaultTransport } from './vault-http'

type Auth = Parameters<typeof vaultPortalIdentity>[0]
const auth = (patch: Record<string, unknown> = {}): Auth => ({ isManagingTenant: false, accessToken: 'a', refreshToken: 'r',
  user: { id: 4, tenantId: 7, actingTenantId: undefined }, ...patch }) as unknown as Auth
// The mock is kept apart from the transport object so assertions never detach a method.
const transport = (reply: unknown) => {
  const post = vi.fn(() => (reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply)))
  return Object.assign({ post } as unknown as VaultTransport, { calls: post })
}
beforeEach(() => {
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('window', { location: { protocol: 'https:', origin: 'https://vault.example' } })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('NA-0186 vault manager check', () => {
  it('asks the server only from a secure page of the own tenant with both tokens', async () => {
    const t = transport({ manager: true })
    expect(await isVaultManager(t, auth())).toBe(true)
    expect(t.calls).toHaveBeenCalledWith('administration/status', {}, { userId: 4, tenantId: 7, accessToken: 'a', refreshToken: 'r', origin: 'https://vault.example' })
    for (const a of [auth({ isManagingTenant: true }), auth({ refreshToken: null }), auth({ user: { id: 4, tenantId: 7, actingTenantId: 9 } }), auth({ user: null })]) {
      expect(await isVaultManager(t, a)).toBe(false)
    }
    vi.stubGlobal('isSecureContext', false)
    expect(await isVaultManager(t, auth())).toBe(false)
    expect(t.calls).toHaveBeenCalledTimes(1)
  })
  it('fails closed on errors and malformed replies', async () => {
    for (const reply of [new Error('down'), { manager: 'yes' }, { manager: true, extra: 1 }, { manager: false }]) expect(await isVaultManager(transport(reply), auth())).toBe(false)
  })
})
