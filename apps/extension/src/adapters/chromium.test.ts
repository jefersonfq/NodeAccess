import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceKey } from '../core/ports'

// Minimal chrome.* and IndexedDB doubles: enough to pin the adapter contract (session-only storage,
// trusted-context access level, structured-clone key store) without a browser.
function fakeChrome() {
  const session = new Map<string, unknown>()
  const api = {
    runtime: { id: 'a'.repeat(32), getManifest: () => ({ version: '0.1.0' }) },
    identity: { getRedirectURL: () => `https://${'a'.repeat(32)}.chromiumapp.org/`, launchWebAuthFlow: vi.fn() },
    storage: { session: {
      get: vi.fn(async (key: string) => (session.has(key) ? { [key]: session.get(key) } : {})),
      set: vi.fn(async (value: Record<string, unknown>) => { for (const [k, v] of Object.entries(value)) session.set(k, v) }),
      remove: vi.fn(async (keys: string[]) => { for (const k of keys) session.delete(k) }),
      setAccessLevel: vi.fn(async () => undefined),
    } },
    tabs: { create: vi.fn(async (value: unknown) => value) },
  }
  return { api, session }
}
function fakeIndexedDb(fail = false) {
  const stores = new Map<string, Map<string, unknown>>()
  let upgraded = 0, closed = 0
  const request = <T>(run: () => T) => {
    const r: { result?: T; error: Error | null; onsuccess?: () => void; onerror?: () => void } = { error: null }
    queueMicrotask(() => { if (fail) { r.error = new Error('denied'); r.onerror?.() } else { r.result = run(); r.onsuccess?.() } })
    return r
  }
  const db = {
    createObjectStore: (name: string) => { upgraded++; stores.set(name, new Map()) },
    close: () => { closed++ },
    transaction: (name: string) => {
      const tx: { error: Error | null; oncomplete?: () => void; onerror?: () => void; objectStore: () => unknown } = { error: null, objectStore: () => ({
        get: (key: string) => request(() => stores.get(name)?.get(key)),
        put: (value: unknown, key: string) => { queueMicrotask(() => { if (fail) { tx.error = new Error('denied'); tx.onerror?.() } else { stores.get(name)?.set(key, value); tx.oncomplete?.() } }) },
      }) }
      return tx
    },
  }
  const open = () => {
    const r: { result: typeof db; error: Error | null; onupgradeneeded?: () => void; onsuccess?: () => void; onerror?: () => void } = { result: db, error: null }
    queueMicrotask(() => { if (!stores.size) r.onupgradeneeded?.(); r.onsuccess?.() })
    return r
  }
  return { api: { open }, stats: () => ({ upgraded, closed }), stores }
}
let chromeDouble: ReturnType<typeof fakeChrome>
beforeEach(() => {
  chromeDouble = fakeChrome()
  vi.stubGlobal('chrome', chromeDouble.api)
  vi.stubGlobal('__PORTAL_ORIGIN__', 'https://portal.example.test')
})
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('Chromium adapter', () => {
  it('exposes the extension identity and the build-time portal origin', async () => {
    const { extensionInfo } = await import('./chromium')
    expect(extensionInfo()).toEqual({ id: 'a'.repeat(32), version: '0.1.0', portalOrigin: 'https://portal.example.test' })
  })
  it('launches an interactive auth flow and maps a closed window to cancelled', async () => {
    const { chromiumAuthFlow } = await import('./chromium')
    expect(chromiumAuthFlow.redirectUri()).toBe(`https://${'a'.repeat(32)}.chromiumapp.org/`)
    chromeDouble.api.identity.launchWebAuthFlow.mockResolvedValueOnce('https://x.chromiumapp.org/?code=c')
    await expect(chromiumAuthFlow.launch('https://portal/consent')).resolves.toBe('https://x.chromiumapp.org/?code=c')
    expect(chromeDouble.api.identity.launchWebAuthFlow).toHaveBeenCalledWith({ url: 'https://portal/consent', interactive: true })
    chromeDouble.api.identity.launchWebAuthFlow.mockResolvedValueOnce(undefined)
    await expect(chromiumAuthFlow.launch('https://portal/consent')).rejects.toThrow('cancelled')
  })
  it('keeps authorization and recents only in session storage and validates what it reads back', async () => {
    const { chromiumSession, restrictSession } = await import('./chromium')
    expect(await chromiumSession.get()).toBeNull()
    await chromiumSession.set({ accessToken: 't', portalOrigin: 'https://p', expiresAt: 5 })
    expect(await chromiumSession.get()).toEqual({ accessToken: 't', portalOrigin: 'https://p', expiresAt: 5 })
    chromeDouble.session.set('authorization', { accessToken: 't', portalOrigin: 'https://p', expiresAt: '5' })
    expect(await chromiumSession.get()).toBeNull()
    expect(await chromiumSession.recents()).toEqual([])
    await chromiumSession.setRecents(['secret:1'])
    chromeDouble.session.set('recents', ['secret:1', 7])
    expect(await chromiumSession.recents()).toEqual(['secret:1'])
    await chromiumSession.clear()
    expect([...chromeDouble.session.keys()]).toEqual([])
    await restrictSession()
    expect(chromeDouble.api.storage.session.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' })
    const { setAccessLevel: _omit, ...withoutLevel } = chromeDouble.api.storage.session
    vi.stubGlobal('chrome', { ...chromeDouble.api, storage: { session: withoutLevel } })
    await expect(restrictSession()).resolves.toBeUndefined()
  })
  it('stores the device key by structured clone and closes the database every time', async () => {
    const idb = fakeIndexedDb()
    vi.stubGlobal('indexedDB', idb.api)
    const { indexedDbKeys } = await import('./chromium')
    expect(await indexedDbKeys.load()).toBeNull()
    const key = { jkt: 'j', publicJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' }, privateKey: {} } as unknown as DeviceKey
    await indexedDbKeys.save(key)
    expect(await indexedDbKeys.load()).toBe(key)
    expect(idb.stats()).toEqual({ upgraded: 1, closed: 3 })
  })
  it('rejects when IndexedDB fails', async () => {
    const idb = fakeIndexedDb(true)
    vi.stubGlobal('indexedDB', idb.api)
    const { indexedDbKeys } = await import('./chromium')
    await expect(indexedDbKeys.load()).rejects.toThrow('denied')
    await expect(indexedDbKeys.save({} as DeviceKey)).rejects.toThrow('denied')
    vi.stubGlobal('indexedDB', { open: () => { const r: { error: null; onerror?: () => void } = { error: null }; queueMicrotask(() => r.onerror?.()); return r } })
    await expect(indexedDbKeys.load()).rejects.toThrow('indexeddb')
  })
  it('opens portal links in a new tab', async () => {
    const { openTab } = await import('./chromium')
    await openTab('https://portal/vault?kind=secret&id=3')
    expect(chromeDouble.api.tabs.create).toHaveBeenCalledWith({ url: 'https://portal/vault?kind=secret&id=3' })
  })
})

describe('service worker', () => {
  async function load(connect: () => Promise<void>) {
    const listeners: Array<(message: unknown, sender: { id?: string }, respond: (value: unknown) => void) => unknown> = []
    vi.stubGlobal('chrome', { ...chromeDouble.api, runtime: { ...chromeDouble.api.runtime, onMessage: { addListener: (fn: typeof listeners[number]) => listeners.push(fn) } } })
    vi.doMock('../core/client', async original => ({ ...(await original<typeof import('../core/client')>()), createExtensionClient: () => ({ connect }) }))
    await import('../background')
    return listeners[0]!
  }
  afterEach(() => { vi.doUnmock('../core/client') })
  it('accepts connect only from this extension and answers once the flow ends', async () => {
    const connect = vi.fn(async () => undefined)
    const listener = await load(connect)
    expect(chromeDouble.api.storage.session.setAccessLevel).toHaveBeenCalled()
    expect(listener({ type: 'connect' }, { id: 'b'.repeat(32) }, vi.fn())).toBeUndefined()
    expect(listener(null, { id: 'a'.repeat(32) }, vi.fn())).toBeUndefined()
    expect(listener({ type: 'other' }, { id: 'a'.repeat(32) }, vi.fn())).toBeUndefined()
    const respond = vi.fn()
    expect(listener({ type: 'connect' }, { id: 'a'.repeat(32) }, respond)).toBe(true)
    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ ok: true }))
    expect(connect).toHaveBeenCalledTimes(1)
  })
  it('shares one pending flow and reports the failure reason', async () => {
    const { ExtensionError } = await import('../core/client')
    let fail: (error: unknown) => void = () => undefined
    const connect = vi.fn(() => new Promise<void>((_, reject) => { fail = reject }))
    const listener = await load(connect)
    const first = vi.fn(), second = vi.fn()
    listener({ type: 'connect' }, { id: 'a'.repeat(32) }, first)
    listener({ type: 'connect' }, { id: 'a'.repeat(32) }, second)
    expect(connect).toHaveBeenCalledTimes(1)
    fail(new ExtensionError('denied'))
    await vi.waitFor(() => expect(second).toHaveBeenCalledWith({ ok: false, reason: 'denied' }))
    expect(first).toHaveBeenCalledWith({ ok: false, reason: 'denied' })
    const third = vi.fn()
    listener({ type: 'connect' }, { id: 'a'.repeat(32) }, third)
    fail(new Error('boom'))
    await vi.waitFor(() => expect(third).toHaveBeenCalledWith({ ok: false, reason: 'unavailable' }))
    expect(connect).toHaveBeenCalledTimes(2)
  })
})
