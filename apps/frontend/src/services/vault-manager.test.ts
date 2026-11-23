import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deliveryBlock, deliveryFor, formatDuration, hasApprover, isVaultManager, vaultAdministrationStatus, vaultAvailability, vaultPortalIdentity } from './vault-manager'
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
    const t = transport({ manager: true, pending: 2, managers: [4, 5] })
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
    for (const reply of [new Error('down'), { manager: 'yes' }, { manager: true, extra: 1 }, { manager: false }, { manager: true, pending: 2 },
      { manager: true, pending: -1, managers: [] }, { manager: true, pending: 1, managers: [0] }]) expect(await isVaultManager(transport(reply), auth())).toBe(false)
  })
  it('NA-0188: returns the pending count and manager ids, and null (unknown) on any doubt', async () => {
    expect(await vaultAdministrationStatus(transport({ manager: true, pending: 3, managers: [4, 5, 6] }), auth())).toEqual({ manager: true, pending: 3, managers: [4, 5, 6] })
    expect(await vaultAdministrationStatus(transport(new Error('down')), auth())).toBeNull()
    expect(await vaultAdministrationStatus(transport({ manager: true }), auth({ user: null }))).toBeNull()
  })
})

describe('NA-0188 helpers', () => {
  it('finds an approver other than the proposer and the person affected', () => {
    expect(hasApprover([1, 2], 1, 2)).toBe(false)
    expect(hasApprover([1, 2, 3], 1, 2)).toBe(true)
    expect(hasApprover([1, 2], 1)).toBe(true)
    expect(hasApprover([1], 1)).toBe(false)
    expect(hasApprover([], undefined)).toBe(false)
  })
  it('formats durations for proposal windows and countdowns', () => {
    const u = { s: 's', min: 'min', h: 'h' }
    expect([0, 45, 60, 61, 300, 3599, 3600, 5400, 86400, -5].map(v => formatDuration(v, u)))
      .toEqual(['0 s', '45 s', '1 min', '2 min', '5 min', '1 h', '1 h', '1 h 30 min', '24 h', '0 s'])
  })
})

describe('NA-0196 delivery guidance', () => {
  const on = { policy: { reveal: true, copy: true }, grants: { reveal: true, copy: true }, items: [4] }
  it('reads the availability and returns null (unknown) on any doubt', async () => {
    expect(await vaultAvailability(transport(on), auth())).toEqual(on)
    expect(await vaultAvailability(transport({ ...on, extra: 1 }), auth())).toBeNull()
    expect(await vaultAvailability(transport(new Error('down')), auth())).toBeNull()
    expect(await vaultAvailability(transport(on), auth({ user: null }))).toBeNull()
  })
  it('explains once what holds for every item, and per item what does not', () => {
    expect(deliveryBlock(null)).toBeNull()
    expect(deliveryBlock({ ...on, policy: { reveal: false, copy: false } })).toBe('policy')
    expect(deliveryBlock({ ...on, grants: { reveal: false, copy: false } })).toBe('grant')
    // Copy allowed by the policy but granted only for reveal (which the policy turns off): nothing to do.
    expect(deliveryBlock({ ...on, policy: { reveal: false, copy: true }, grants: { reveal: true, copy: false } })).toBe('grant')
    expect(deliveryFor(null, 4)).toEqual({ actions: ['reveal', 'copy'], reason: null })
    expect(deliveryFor(on, 4)).toEqual({ actions: ['reveal', 'copy'], reason: null })
    expect(deliveryFor(on, 5)).toEqual({ actions: [], reason: 'item' })
    expect(deliveryFor({ ...on, policy: { reveal: true, copy: false } }, 4)).toEqual({ actions: ['reveal'], reason: null })
    expect(deliveryFor({ ...on, grants: { reveal: false, copy: true } }, 4)).toEqual({ actions: ['copy'], reason: null })
    expect(deliveryFor({ ...on, policy: { reveal: false, copy: false } }, 4)).toEqual({ actions: [], reason: 'policy' })
    const full = { ...on, items: Array.from({ length: 1000 }, (_, i) => i + 10) }
    expect(deliveryFor(full, 4)).toEqual({ actions: ['reveal', 'copy'], reason: null })
  })
})
