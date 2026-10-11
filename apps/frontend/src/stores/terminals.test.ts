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

it('reorders existing tab objects without changing active session, credentials, unread state or tenant', () => {
  setActivePinia(createPinia())
  const store = useTerminalStore()
  const first = store.add({ id: 1, tenantId: 7 })
  const second = store.add({ id: 2, tenantId: 8 })
  const third = store.add({ id: 3, tenantId: 7 })
  store.setSessionId(first, 42)
  store.setJiraAuthorization(first, { ticketKey: 'OPS-1', interactionId: 'test', sessionGrant: 'scoped' })
  store.markActivity(first)
  const original = store.tabs[0]
  store.move(first, 2)
  expect(store.tabs.map(tab => tab.id)).toEqual([second, third, first])
  expect(store.tabs[2]).toBe(original)
  expect(store.tabs[2]).toMatchObject({ sessionId: 42, tenantId: 7, unreadCount: 1, jiraSessionGrant: 'scoped' })
  expect(store.activeId).toBe(third)
  store.move(first, 0)
  expect(store.tabs[0]).toBe(original)
  for (const index of [-1, 3, NaN, 1.5]) store.move(first, index)
  store.move('missing', 1)
  expect(store.tabs.map(tab => tab.id)).toEqual([first, second, third])
})


it('preserves identity and connection metadata through 200 deterministic reorder/close operations', () => {
 setActivePinia(createPinia())
 const store = useTerminalStore()
 const ids = Array.from({ length: 8 }, (_, i) => store.add({ id: i + 1, tenantId: i % 2 + 1 }))
 ids.forEach((id, i) => { store.setSessionId(id, 100 + i); store.setCustomName(id, `tab-${i}`) })
 const originals = new Map(store.tabs.map(tab => [tab.id, tab]))
 const expected = [...ids]
 for (let i = 0; i < 200; i++) {
  const from = (i * 7 + 3) % expected.length, to = (i * 11 + 1) % expected.length
  const id = expected[from]!
  expected.splice(from, 1); expected.splice(to, 0, id)
  store.move(id, to)
  expect(store.tabs.map(tab => tab.id)).toEqual(expected)
  expect(store.activeId).toBe(ids[7])
  store.tabs.forEach(tab => expect(tab).toBe(originals.get(tab.id)))
 }
 store.activate(expected[3]!)
 store.remove(expected[3]!)
 expect(store.activeId).toBe(expected[2])
 expect(store.tabs).toHaveLength(7)
})

it('ignores duplicate and delayed termination of an old connection after reconnect', () => {
 setActivePinia(createPinia())
 const store = useTerminalStore()
 const a = store.add({ id: 10, tenantId: 1 }), b = store.add({ id: 20, tenantId: 2 })
 store.setSessionId(a, 90); store.setSessionId(b, 91)
 store.setSessionId(a, 92)
 store.removeBySessionId(90); store.removeBySessionId(90)
 expect(store.tabs.map(tab => tab.sessionId)).toEqual([92, 91])
 expect(store.activeId).toBe(b)
 store.removeBySessionId(92)
 expect(store.tabs.map(tab => tab.id)).toEqual([b])
})

it('counts unseen output independently of the number of tabs and resets only the viewed tab', () => {
  setActivePinia(createPinia())
  const store = useTerminalStore()
  const first = store.add({ id: 10 })
  store.markActivity(first)
  expect(store.tabs[0]?.unreadCount).toBe(1)
  const second = store.add({ id: 11 })
  expect(store.tabs.map(tab => tab.unreadCount)).toEqual([1, 0])
  store.markActivity(first); store.markActivity(first)
  store.markActivity(second)
  expect(store.tabs.map(tab => tab.unreadCount)).toEqual([3, 1])
  store.activate(first)
  expect(store.tabs.map(tab => tab.unreadCount)).toEqual([0, 1])
  store.markActivity('closed-tab')
  expect(store.tabs.map(tab => tab.unreadCount)).toEqual([0, 1])
})
