import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  get: vi.fn(), capture: vi.fn(), preflight: vi.fn(), fill: vi.fn(), authorize: vi.fn(), consume: vi.fn(), capabilities: vi.fn(),
}))
vi.mock('./core/client', () => ({
  createExtensionClient: () => ({ capabilities: mocks.capabilities, siteFill: { authorize: mocks.authorize, consume: mocks.consume } }),
  ExtensionError: class extends Error { constructor(public readonly reason: string) { super(reason) } },
}))
vi.mock('./adapters/chromium', () => ({
  chromiumSession: { get: mocks.get }, chromiumAuthFlow: {}, indexedDbKeys: {}, extensionInfo: () => ({}),
  restrictSession: () => Promise.resolve(), rememberFailure: () => Promise.resolve(),
}))
vi.mock('./adapters/site-fill', () => ({
  chromiumSiteFill: (_api: unknown, current: () => Promise<boolean>) => ({
    capture: async () => { if (!await current()) throw new Error('changed'); return mocks.capture() as unknown },
    preflight: mocks.preflight,
    fill: async (...args: unknown[]) => { if (!await current()) throw new Error('changed'); await mocks.fill(...args) },
  }),
}))
type Sender = { id?: string; url?: string; tab?: { id?: number } }
let receive: (message: unknown, sender: Sender, respond: (reply: unknown) => void) => boolean | undefined
let changed: (changes: Record<string, unknown>, area: string) => void
let authorization: { accessToken: string; portalOrigin: string; expiresAt: number } | null
const id = 'a'.repeat(32), sender = { id, url: `chrome-extension://${id}/popup.html` }
const request = { type: 'fill-site', siteId: 1, version: 1, origin: 'https://login.example.test' }
const binding = { origin: request.origin, tabId: 1, frameId: 0, documentId: 'document1' }
const credentials = { mode: 'both' as const, username: 'synthetic-user', password: 'synthetic-password' }
async function pending() {
  let release!: (value: typeof credentials) => void
  mocks.consume.mockReturnValue(new Promise(resolve => { release = resolve }))
  const reply = new Promise<unknown>(resolve => { expect(receive(request, sender, resolve)).toBe(true) })
  await vi.waitFor(() => expect(mocks.consume).toHaveBeenCalledOnce())
  return { reply, release: () => release(credentials) }
}
beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks()
  authorization = { accessToken: 'fixture-token', portalOrigin: 'https://portal.example.test', expiresAt: Date.now() + 60000 }
  mocks.get.mockImplementation(() => Promise.resolve(authorization ? { ...authorization } : null))
  mocks.capture.mockResolvedValue(binding); mocks.preflight.mockResolvedValue('both'); mocks.fill.mockResolvedValue(undefined)
  mocks.capabilities.mockResolvedValue({ features: { fill: true } }); mocks.authorize.mockResolvedValue({ operation: 'op' })
  mocks.consume.mockResolvedValue(credentials)
  const order: string[] = []
  vi.stubGlobal('chrome', {
    runtime: { id, onMessage: { addListener: (listener: typeof receive) => { receive = listener; order.push('message') } } },
    storage: { onChanged: { addListener: (listener: typeof changed) => { changed = listener; order.push('storage') } } },
  })
  await import('./background')
  expect(order).toEqual(['storage', 'message'])
})
afterEach(() => { vi.unstubAllGlobals() })
describe('worker rejects stale local authorization during fill', () => {
  it.each(['remove', 'replace', 'remove-and-restore'])('invalidates onChanged %s even without a popup phase change', async mode => {
    const wait = await pending()
    const old = authorization
    if (mode === 'remove') authorization = null
    if (mode === 'replace') authorization = { ...authorization!, accessToken: 'different-token' }
    changed({ authorization: { oldValue: old, newValue: authorization } }, 'session')
    if (mode === 'remove-and-restore') authorization = old
    wait.release()
    expect(await wait.reply).toMatchObject({ ok: false }); expect(mocks.fill).not.toHaveBeenCalled()
    expect(mocks.consume).toHaveBeenCalledOnce()
  })
  it.each(['token', 'origin', 'expiry', 'logout'])('snapshot detects %s change even if storage event is delayed', async field => {
    const wait = await pending()
    if (field === 'token') authorization!.accessToken = 'different-token'
    if (field === 'origin') authorization!.portalOrigin = 'https://other.example.test'
    if (field === 'expiry') authorization!.expiresAt = 0
    if (field === 'logout') authorization = null
    wait.release()
    expect(await wait.reply).toMatchObject({ ok: false }); expect(mocks.fill).not.toHaveBeenCalled()
  })
  it('does not invalidate for display preferences unrelated to identity', async () => {
    const wait = await pending(); changed({ locale: { newValue: 'en' } }, 'session'); wait.release()
    expect(await wait.reply).toEqual({ ok: true }); expect(mocks.fill).toHaveBeenCalledOnce()
  })
  it('rejects an ordinary extension tab and a different sender without touching credentials', () => {
    const reply = vi.fn()
    expect(receive(request, { ...sender, tab: { id: 1 } }, reply)).toBeUndefined()
    expect(receive(request, { ...sender, id: 'b'.repeat(32) }, reply)).toBeUndefined()
    expect(mocks.capabilities).not.toHaveBeenCalled(); expect(reply).not.toHaveBeenCalled()
  })
})
