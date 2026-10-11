import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() }))
vi.mock('./api', () => ({ default: api }))
let dispatch: ReturnType<typeof vi.fn>
let broadcast: ReturnType<typeof vi.fn>
let receive: () => void

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  dispatch = vi.fn(); broadcast = vi.fn(); receive = () => {}
  vi.stubGlobal('window', { dispatchEvent: dispatch, localStorage: { getItem: () => null } })
  vi.stubGlobal('CustomEvent', class extends Event { constructor(name: string) { super(name) } })
  vi.stubGlobal('BroadcastChannel', class {
    constructor(private readonly name: string) {}
    postMessage(message: unknown) { if (this.name === 'nodeaccess-terminal-highlights-v1') broadcast(message) }
    addEventListener(_name: string, callback: () => void) { if (this.name === 'nodeaccess-terminal-highlights-v1') receive = callback }
  })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
const service = async () => (await import('./terminal-highlight.service')).terminalHighlightService
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}

describe('highlight configuration requests without extra terminal traffic', () => {
  it('coalesces simultaneous terminal loads and reuses the resolved configuration', async () => {
    const pending = deferred<unknown>(); api.get.mockReturnValue(pending.promise)
    const highlights = await service()
    const first = highlights.effective(), second = highlights.effective()
    expect(api.get).toHaveBeenCalledTimes(1)
    const result = { data: { version: '1' } }; pending.resolve(result)
    expect(await first).toBe(result); expect(await second).toBe(result)
    expect(await highlights.effective()).toBe(result)
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('expires on demand without polling, scheduling or HTTP while idle', async () => {
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    api.get.mockResolvedValue({ data: { version: '1' } })
    const highlights = await service()
    await highlights.effective(); now = 29_999; await highlights.effective()
    expect(api.get).toHaveBeenCalledTimes(1)
    now = 30_001
    expect(api.get).toHaveBeenCalledTimes(1)
    await highlights.effective()
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('retries a failed request instead of retaining a rejected cache entry', async () => {
    api.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ data: { version: 'recovered' } })
    const highlights = await service()
    await expect(highlights.effective()).rejects.toThrow('offline')
    await expect(highlights.effective()).resolves.toEqual({ data: { version: 'recovered' } })
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('does not let an old pending response replace a fresh cache entry', async () => {
    const old = deferred<unknown>()
    api.get.mockReturnValueOnce(old.promise).mockResolvedValue({ data: { version: 'new' } })
    const highlights = await service()
    const previous = highlights.effective()
    await highlights.effective({ fresh: true })
    old.resolve({ data: { version: 'old' } }); await previous
    expect(await highlights.effective()).toEqual({ data: { version: 'new' } })
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('preserves the last successful cache and sends no refresh events when saving fails', async () => {
    api.get.mockResolvedValue({ data: { version: 'saved' } }); api.put.mockRejectedValue(new Error('503'))
    const highlights = await service(); await highlights.effective()
    await expect(highlights.savePreference({ enabled: false, rules: [] })).rejects.toThrow('503')
    expect(await highlights.effective()).toEqual({ data: { version: 'saved' } })
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(dispatch).not.toHaveBeenCalled(); expect(broadcast).not.toHaveBeenCalled()
  })

  it('refreshes other tabs only after a successful save', async () => {
    api.get.mockResolvedValue({ data: {} }); api.put.mockResolvedValue({ data: {} })
    const highlights = await service(); await highlights.effective()
    await highlights.savePreference({ enabled: true, rules: [] })
    expect(broadcast).toHaveBeenCalledOnce()
    expect(dispatch.mock.calls[0][0].type).toBe('nodeaccess:terminal-highlights-invalidated')
    await highlights.effective(); expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('receives cross-tab invalidation without rebroadcast loops', async () => {
    api.get.mockResolvedValue({ data: {} })
    const highlights = await service(); await highlights.effective()
    receive()
    expect(broadcast).not.toHaveBeenCalled()
    expect(dispatch).toHaveBeenCalledOnce()
    await highlights.effective(); expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('supports silent realtime invalidation without recursive events', async () => {
    api.get.mockResolvedValue({ data: {} })
    const highlights = await service(); await highlights.effective()
    highlights.invalidate('realtime', false, false)
    expect(dispatch).not.toHaveBeenCalled(); expect(broadcast).not.toHaveBeenCalled()
    await highlights.effective(); expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('does not mix administrative previews with the terminal user cache', async () => {
    api.get.mockImplementation((url: string) => Promise.resolve({ data: { url } }))
    const highlights = await service()
    const own = await highlights.effective()
    await highlights.effectiveForUser(2); await highlights.effectiveForUser(3)
    expect(await highlights.effective()).toBe(own)
    expect(api.get.mock.calls.map(([url]) => url)).toEqual(['/terminal-highlights/effective', '/terminal-highlights/admin/users/2/effective', '/terminal-highlights/admin/users/3/effective'])
  })
})
