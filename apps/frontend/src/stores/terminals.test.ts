import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useTerminalStore } from './terminals'

vi.mock('./auth', () => ({
  useAuthStore: () => ({ user: { id: 4, tenantId: 7, role: 'user' } }),
}))

describe('terminal session store invariants', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('scopes new local and detached sessions to the current tenant', () => {
    const store = useTerminalStore()
    const tabId = store.add({ id: 10, name: 'db-01' })
    store.addDetached('popout-1', { id: 11, name: 'proxy-01' })
    expect(store.tabs.find((tab) => tab.id === tabId)?.tenantId).toBe(7)
    expect(store.detached[0]?.tenantId).toBe(7)
  })

  it('updates a detached session instead of duplicating out-of-order popout events', () => {
    const store = useTerminalStore()
    store.addDetached('popout-1', { id: 10, name: 'old' })
    store.addDetached('popout-1', { id: 11, name: 'new' })
    expect(store.detached).toHaveLength(1)
    expect(store.detached[0]).toMatchObject({ hostId: 11, hostName: 'new' })
  })

  it('removes a remote-ended session from local and detached projections', () => {
    const store = useTerminalStore()
    const tabId = store.add({ id: 10 })
    store.setSessionId(tabId, 91)
    store.addDetached('popout-1', { id: 11 })
    store.setSessionId('popout-1', 92)
    store.removeBySessionId(91)
    expect(store.tabs).toHaveLength(0)
    expect(store.detached).toHaveLength(1)
    store.removeBySessionId(92)
    expect(store.detached).toHaveLength(0)
  })

  it('preserves other tabs and selects a deterministic neighbor when closing the active tab', () => {
    const store = useTerminalStore()
    const first = store.add({ id: 10 })
    const second = store.add({ id: 11 })
    const third = store.add({ id: 12 })
    store.activate(second)
    store.remove(second)
    expect(store.tabs.map((tab) => tab.id)).toEqual([first, third])
    expect(store.activeId).toBe(first)
  })
})
