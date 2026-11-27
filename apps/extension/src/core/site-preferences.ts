/** Only references to resources: callers must intersect every result with a fresh authorized list. */
export interface SitePreferences { favorites: number[]; recents: Array<{ id: number; at: number }> }
export interface SitePreferencesPort {
  load(): Promise<SitePreferences>
  favorite(id: number, value: boolean): Promise<SitePreferences>
  used(id: number): Promise<SitePreferences>
}
export interface PreferenceStorage {
  get(key: string): Promise<unknown>
  set(key: string, value: SitePreferences): Promise<void>
  lock<T>(key: string, run: () => Promise<T>): Promise<T>
}
const idValid = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
export function sanitizePreferences(value: unknown, now: number): SitePreferences {
  const source = value && typeof value === 'object' ? value as Partial<SitePreferences> : {}
  const favorites = Array.isArray(source.favorites) ? [...new Set(source.favorites.filter(idValid))].slice(0, 100) : []
  const recents = Array.isArray(source.recents) ? source.recents.filter(entry => entry && idValid(entry.id) &&
    Number.isSafeInteger(entry.at) && entry.at <= now && entry.at > now - 90 * 86400_000)
    .sort((a, b) => b.at - a.at).filter((entry, i, all) => all.findIndex(other => other.id === entry.id) === i)
    .slice(0, 30).map(({ id, at }) => ({ id, at })) : []
  return { favorites, recents }
}
/** The opaque server scope includes tenant, user and device. It is not an authorization capability. */
export function createSitePreferences(options: {
  origin: string; scope: string; kind: 'sites' | 'hosts'; storage: PreferenceStorage;
  current(): Promise<boolean>; now?: () => number;
}): SitePreferencesPort {
  const url = new URL(options.origin)
  if (url.protocol !== 'https:' || url.origin !== options.origin || !/^[A-Za-z0-9_-]{32,128}$/.test(options.scope)) throw new Error('invalid preference scope')
  const key = `vault-preferences:${encodeURIComponent(url.origin)}:${options.scope}:${options.kind}`
  const now = options.now ?? Date.now
  const read = async (): Promise<SitePreferences> => {
    if (!await options.current()) throw new Error('expired preference scope')
    const value = sanitizePreferences(await options.storage.get(key), now())
    if (!await options.current()) throw new Error('expired preference scope')
    return value
  }
  const update = (change: (value: SitePreferences) => void): Promise<SitePreferences> => options.storage.lock(key, async () => {
    const value = await read(); change(value)
    const result = sanitizePreferences(value, now())
    if (!await options.current()) throw new Error('expired preference scope')
    await options.storage.set(key, result)
    if (!await options.current()) throw new Error('expired preference scope')
    return result
  })
  return {
    load: read,
    favorite(id, enabled): Promise<SitePreferences> {
      if (!idValid(id)) return Promise.reject(new Error('invalid resource'))
      return update(value => { value.favorites = value.favorites.filter(item => item !== id); if (enabled) value.favorites.unshift(id) })
    },
    used(id): Promise<SitePreferences> {
      if (!idValid(id)) return Promise.reject(new Error('invalid resource'))
      return update(value => { value.recents = [{ id, at: now() }, ...value.recents.filter(item => item.id !== id)] })
    },
  }
}
