import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chromiumSitePreferences } from './site-preferences'
import { chromiumSession } from './chromium'
import type { ExtensionClient } from '../core/client'
import type { Authorization } from '../core/ports'

const scope = 'a'.repeat(64)
const origin = 'https://vault.test'
const original: Authorization = { accessToken: 'synthetic-session', portalOrigin: origin, expiresAt: 20_000 }
let auth: Authorization | null
const data = new Map<string, unknown>()
const capabilities = vi.fn()
const accessLevel = vi.fn()
const get = vi.fn()
const set = vi.fn()
const lock = vi.fn()
const client = { capabilities } as unknown as ExtensionClient

beforeEach(() => {
  vi.resetAllMocks()
  auth = { ...original }; data.clear()
  vi.spyOn(Date, 'now').mockReturnValue(1000)
  vi.spyOn(chromiumSession, 'get').mockImplementation(() => Promise.resolve(auth && { ...auth }))
  capabilities.mockResolvedValue({ preferenceScope: scope })
  accessLevel.mockResolvedValue(undefined)
  get.mockImplementation((key: string) => Promise.resolve({ [key]: data.get(key) }))
  set.mockImplementation((values: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(values)) data.set(key, value)
    return Promise.resolve()
  })
  lock.mockImplementation(async (_key: string, run: () => Promise<unknown>): Promise<unknown> => run())
  vi.stubGlobal('__PORTAL_ORIGIN__', origin)
  vi.stubGlobal('chrome', { storage: { local: { get, set, setAccessLevel: accessLevel } } })
  vi.stubGlobal('navigator', { locks: { request: lock } })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Chromium resource preferences authorization boundary', () => {
  it('persists only resource ids and times in trusted local storage under a lock', async () => {
    const preferences = chromiumSitePreferences(client, scope, 'sites')
    await preferences.favorite(7, true)
    await preferences.used(7)
    expect(await preferences.load()).toEqual({ favorites: [7], recents: [{ id: 7, at: 1000 }] })
    expect([...data.values()]).toEqual([{ favorites: [7], recents: [{ id: 7, at: 1000 }] }])
    expect(JSON.stringify([...data])).not.toContain(original.accessToken)
    expect(lock).toHaveBeenCalledTimes(2)
    expect(accessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' })
    expect(accessLevel.mock.invocationCallOrder[0]).toBeLessThan(get.mock.invocationCallOrder[0]!)
    expect(await chromiumSitePreferences(client, scope, 'hosts').load()).toEqual({ favorites: [], recents: [] })
  })

  it.each([null, { ...original, expiresAt: 1000 }])('rejects absent or expired authorization before reading preferences', async authorization => {
    auth = authorization
    await expect(chromiumSitePreferences(client, scope, 'sites').load()).rejects.toThrow('expired')
    expect(capabilities).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })

  it('refuses the former tenant/user scope after fresh capabilities change', async () => {
    capabilities.mockResolvedValue({ preferenceScope: 'b'.repeat(64) })
    await expect(chromiumSitePreferences(client, scope, 'sites').favorite(7, true)).rejects.toThrow('expired')
    expect(get).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled()
  })

  it.each(['replace', 'expire', 'logout'])('rejects a late capabilities response after session %s', async change => {
    capabilities.mockImplementation(() => {
      auth = change === 'logout' ? null : { ...original, ...(change === 'replace' ? { accessToken: 'other-session' } : { expiresAt: 1000 }) }
      return Promise.resolve({ preferenceScope: scope })
    })
    await expect(chromiumSitePreferences(client, scope, 'sites').load()).rejects.toThrow('expired')
    expect(get).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled()
  })

  it('does not return a storage reply received after logout', async () => {
    get.mockImplementation((key: string) => { auth = null; return Promise.resolve({ [key]: { favorites: [99], recents: [] } }) })
    await expect(chromiumSitePreferences(client, scope, 'sites').load()).rejects.toThrow('expired')
    expect(set).not.toHaveBeenCalled()
  })

  it('does not access local data if restricting storage to trusted contexts fails', async () => {
    accessLevel.mockRejectedValue(new Error('storage unavailable'))
    await expect(chromiumSitePreferences(client, scope, 'sites').favorite(7, true)).rejects.toThrow('storage unavailable')
    expect(get).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled()
  })
})
