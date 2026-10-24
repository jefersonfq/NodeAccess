import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const lifecycle = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(), mounted: [] as Array<() => void>, unmounted: [] as Array<() => void> }))
vi.mock('vue', async () => ({ ...await vi.importActual('vue'), onMounted: (fn: () => void) => lifecycle.mounted.push(fn), onUnmounted: (fn: () => void) => lifecycle.unmounted.push(fn) }))
vi.mock('./features.service', () => ({ featuresService: { get: lifecycle.get } }))
vi.mock('./tunnel.service', () => ({ tunnelService: { list: lifecycle.list } }))
import { useTunnelPresence, uniqueTunnels } from '../composables/useTunnelPresence'
const rows = [{ id: 'a', hostId: 7 }, { id: 'b', hostId: 7 }] as never[]
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(lifecycle.get).mockResolvedValue({ trial: null })
})
afterEach(() => {
  lifecycle.unmounted.splice(0).forEach(fn => fn())
  lifecycle.mounted.splice(0)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()
})
function mount() {
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }))
  vi.mocked(lifecycle.list).mockResolvedValue({ data: rows })
  const state = useTunnelPresence()
  lifecycle.mounted.splice(0).forEach(fn => fn())
  return state
}
describe('shared tunnel presence', () => {
  it('does not query unsupported tunnels for a trial tenant', async () => {
    vi.mocked(lifecycle.get).mockResolvedValue({ trial: { resources: ['ssh'] } })
    const state = mount(); await state.refresh()
    expect(lifecycle.list).not.toHaveBeenCalled()
    expect(state.tunnels.value).toEqual([])
    expect(state.unavailable.value).toBe(false)
  })
  it('reports capability lookup failure without attempting an unsupported request', async () => {
    vi.mocked(lifecycle.get).mockRejectedValueOnce(new Error('offline'))
    const state = mount(); await state.refresh()
    expect(lifecycle.list).not.toHaveBeenCalled()
    expect(state.unavailable.value).toBe(true)
  })
  it('counts two unique host tunnels even if the event repeats one ID or includes another host', () => {
    expect(uniqueTunnels([{ id: 'a', hostId: 7 }, { id: 'b', hostId: 7 }, { id: 'a', hostId: 7 }, { id: 'c', hostId: 8 }], 7)).toHaveLength(2)
  })
  it('preserves last known tunnels during outage and removes closed tunnels on recovery', async () => {
    const state = mount(); await state.refresh()
    expect(state.tunnels.value).toHaveLength(2)
    vi.mocked(lifecycle.list).mockRejectedValueOnce(new Error('offline'))
    await state.refresh()
    expect(state.unavailable.value).toBe(true)
    expect(state.tunnels.value).toHaveLength(2)
    vi.mocked(lifecycle.list).mockResolvedValueOnce({ data: [] })
    await state.refresh()
    expect(state.unavailable.value).toBe(false)
    expect(state.tunnels.value).toEqual([])
  })
  it('ignores an old snapshot overtaken by a confirmed mutation', async () => {
    const state = mount(); await state.refresh()
    let finish!: (value: never) => void
    vi.mocked(lifecycle.list).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }) as never)
    const pending = state.refresh()
    await Promise.resolve() // Feature capability lookup precedes the tunnel request.
    vi.mocked(lifecycle.list).mockResolvedValue({ data: [] })
    window.dispatchEvent(new Event('nodeaccess:tunnels-changed'))
    finish({ data: [{ id: 'stale', hostId: 7 }] } as never)
    await pending; await state.refresh()
    expect(state.tunnels.value).toEqual([])
  })
})
