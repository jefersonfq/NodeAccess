import { describe, expect, it } from 'vitest'
import { createSitePreferences, sanitizePreferences } from './site-preferences'

describe('authorized resource preferences', () => {
  it('retains only bounded resource ids and timestamps, never arbitrary metadata', () => {
    expect(sanitizePreferences({ favorites: [1, 1, -1, '2'], recents: [{ id: 2, at: 100, password: 'not persisted' }, { id: 3, at: 201 }] }, 200))
      .toEqual({ favorites: [1], recents: [{ id: 2, at: 100 }] })
    expect(sanitizePreferences({ favorites: Array.from({ length: 150 }, (_, i) => i + 1) }, 200).favorites).toHaveLength(100)
  })
  it('isolates users, tenants and resource kinds and does not treat stored ids as authorization', async () => {
    const data = new Map<string, unknown>()
    const storage = { get: (key: string): Promise<unknown> => Promise.resolve(data.get(key)), set: (key: string, value: unknown): Promise<void> => { data.set(key, value); return Promise.resolve() }, lock: async <T>(_key: string, run: () => Promise<T>): Promise<T> => run() }
    const base = { origin: 'https://vault.test', scope: 'a'.repeat(64), kind: 'sites' as const, storage, current: (): Promise<boolean> => Promise.resolve(true), now: (): number => 200 }
    const sites = createSitePreferences(base)
    await sites.favorite(12, true); await sites.used(12)
    expect(await sites.load()).toEqual({ favorites: [12], recents: [{ id: 12, at: 200 }] })
    expect(await createSitePreferences({ ...base, scope: 'b'.repeat(64) }).load()).toEqual({ favorites: [], recents: [] })
    expect(await createSitePreferences({ ...base, kind: 'hosts' }).load()).toEqual({ favorites: [], recents: [] })
    await sites.favorite(12, false)
    expect((await sites.load()).favorites).toEqual([])
  })
  it('drops results and denies changes when identity is invalidated during a read', async () => {
    let valid = true, writes = 0
    const preferences = createSitePreferences({ origin: 'https://vault.test', scope: 'a'.repeat(64), kind: 'sites', current: (): Promise<boolean> => Promise.resolve(valid),
      storage: { get: (): Promise<unknown> => { valid = false; return Promise.resolve({ favorites: [1] }) }, set: (): Promise<void> => { writes++; return Promise.resolve() }, lock: async <T>(_key: string, run: () => Promise<T>): Promise<T> => run() } })
    await expect(preferences.favorite(1, true)).rejects.toThrow('expired')
    expect(writes).toBe(0)
  })
})
