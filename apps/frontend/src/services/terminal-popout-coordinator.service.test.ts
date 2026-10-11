import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Router } from 'vue-router'
import { useTerminalStore } from '@/stores/terminals'

const mock = vi.hoisted(() => ({ listen: vi.fn(), confirm: vi.fn(), recent: vi.fn(), layout: vi.fn() }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ user: { tenantId: 1 } }) }))
vi.mock('@/services/terminal-popout.service', () => ({ listenTerminalPopoutEvents: mock.listen, confirmTerminalPopoutInserted: mock.confirm }))
vi.mock('@/services/host-quick-access.service', () => ({ markHostAsRecent: mock.recent }))
vi.mock('@/services/terminal-layout.service', () => ({ resetTerminalLayout: mock.layout }))

describe('popout coordination under delayed and repeated events', () => {
 const host = { id: 10, name: 'Disposable' }
 let receive: (event: Record<string, unknown>) => void
 const push = vi.fn()
 let router: Router
 beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers()
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  setActivePinia(createPinia())
  mock.listen.mockImplementation((callback: (event: Record<string, unknown>) => void) => { receive = callback; return vi.fn() })
  router = { currentRoute: { value: { name: 'terminal' } }, push } as unknown as Router
  const { initTerminalPopoutCoordinator } = await import('./terminal-popout-coordinator.service')
  initTerminalPopoutCoordinator(router)
 })
 afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })
 it('does not close source until a connected event arrives', () => {
  const store = useTerminalStore(), id = store.add(host)
  receive({ type: 'terminal-popout-closed', popoutId: 'failed' })
  expect(store.tabs.map(tab => tab.id)).toEqual([id])
  receive({ type: 'terminal-popout-connected', popoutId: 'ok', host, mode: 'move', sourceTabId: id })
  expect(store.tabs).toHaveLength(0)
  expect(store.detached).toHaveLength(1)
 })
 it('deduplicates repeated insertion while falling back when close notification is lost', () => {
  const store = useTerminalStore()
  store.addDetached('popup', host)
  for (let i = 0; i < 3; i++) receive({ type: 'terminal-popout-insert-requested', popoutId: 'popup', requestId: `r${i}`, host })
  vi.advanceTimersByTime(1199)
  expect(store.tabs).toHaveLength(0)
  vi.advanceTimersByTime(2)
  expect(store.tabs).toHaveLength(1)
  expect(store.detached).toHaveLength(0)
  expect(push).toHaveBeenCalledTimes(1)
  receive({ type: 'terminal-popout-closed', popoutId: 'popup' })
  vi.advanceTimersByTime(2000)
  expect(push).toHaveBeenCalledTimes(1)
 })
 it('preserves an existing connection and unread state of unrelated tabs on reinsertion', () => {
  const store = useTerminalStore(), first = store.add(host), other = store.add({ id: 20 })
  store.setSessionId(first, 42); store.markActivity(other)
  const original = store.tabs[0]
  receive({ type: 'terminal-popout-insert-requested', popoutId: 'popup', requestId: 'r', host })
  receive({ type: 'terminal-popout-closed', popoutId: 'popup' })
  vi.advanceTimersByTime(350)
  expect(store.tabs).toHaveLength(2)
  expect(store.tabs[0]).toBe(original)
  expect(store.tabs[0]?.sessionId).toBe(42)
  expect(store.activeId).toBe(first)
  expect(store.tabs[1]?.unreadCount).toBe(1)
 })
 it('ignores its own events in the separate window', () => {
  router.currentRoute.value.name = 'terminal-popout'
  receive({ type: 'terminal-popout-insert-requested', popoutId: 'popup', requestId: 'r', host })
  receive({ type: 'terminal-popout-connected', popoutId: 'popup', host, mode: 'copy' })
  vi.advanceTimersByTime(5000)
  expect(mock.confirm).not.toHaveBeenCalled()
  expect(push).not.toHaveBeenCalled()
  expect(useTerminalStore().tabs).toHaveLength(0)
  expect(useTerminalStore().detached).toHaveLength(0)
 })
})
