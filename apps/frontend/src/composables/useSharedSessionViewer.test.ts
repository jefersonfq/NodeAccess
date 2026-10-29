import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'
import { useSharedSessionViewer } from './useSharedSessionViewer'
import type { SharedSessionResolved } from '@nodeaccess/shared'

const mocks = vi.hoisted(() => ({
  cleanup: [] as Array<() => void>,
  term: { mount: vi.fn(), fit: vi.fn(), setDisableStdin: vi.fn(), onSelectionChange: vi.fn(), onBinary: vi.fn((_callback: (data: string) => void) => ({ dispose: vi.fn() })), onData: vi.fn((_callback: (data: string) => void) => ({ dispose: vi.fn() })), dispose: vi.fn(), focus: vi.fn(), scrollToBottom: vi.fn(), write: vi.fn(), writeln: vi.fn(), setTheme: vi.fn() },
}))
vi.mock('vue', async () => ({ ...await vi.importActual('vue'), onUnmounted: (fn: () => void) => mocks.cleanup.push(fn) }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ user: { id: 1 }, accessToken: `x.${btoa(JSON.stringify({ exp: 4102444800 }))}.x` }) }))
vi.mock('@/services/auth-session.service', () => ({ handleExpiredSession: vi.fn() }))
vi.mock('@/terminal/xterm-adapter', () => ({ createXtermAdapter: () => mocks.term }))
vi.mock('@/composables/useTerminal', () => ({ termSettings: { fontSize: 14, fontFamily: 'monospace', theme: 'dark' }, currentTerminalTheme: () => ({}) }))

class Observer {
  static instances: Observer[] = []
  disconnected = false
  observe = vi.fn()
  constructor(readonly callback: () => void) { Observer.instances.push(this) }
  disconnect() { this.disconnected = true }
  resize() { if (!this.disconnected) this.callback() }
}
class Socket {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 1
  binaryType = ''
  onmessage?: (event: { data: unknown }) => void
  onclose?: () => void
  onerror?: () => void
  send = vi.fn<(data: Uint8Array | string) => void>()
  close = vi.fn(() => { this.readyState = 3 })
  constructor() { Socket.instances.push(this) }
  receive(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }) }
}
let scope: ReturnType<typeof effectScope>
beforeEach(() => {
  vi.clearAllMocks(); mocks.cleanup.length = 0; Observer.instances = []; Socket.instances = []
  scope = effectScope()
  vi.stubGlobal('ResizeObserver', Observer)
  vi.stubGlobal('WebSocket', Socket)
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' })
  vi.stubGlobal('window', { clearInterval: vi.fn() })
})
afterEach(() => { mocks.cleanup.forEach(fn => fn()); scope.stop(); vi.unstubAllGlobals() })

describe('shared viewer layout lifecycle', () => {
  it('continues fitting after connect, disconnect and reconnect, and releases observation only on unmount', async () => {
    const viewer = scope.run(() => useSharedSessionViewer())!
    viewer.mount({} as HTMLElement)
    const observer = Observer.instances[0]
    const data = { sharedSessionId: 1, role: 'viewer', expiresAt: new Date() } as SharedSessionResolved
    await viewer.connect(data)
    let calls = mocks.term.fit.mock.calls.length
    observer.resize()
    expect(mocks.term.fit).toHaveBeenCalledTimes(calls + 1)
    viewer.disconnect()
    await viewer.connect(data)
    calls = mocks.term.fit.mock.calls.length
    observer.resize()
    expect(mocks.term.fit).toHaveBeenCalledTimes(calls + 1)
    expect(Observer.instances).toHaveLength(1)
    mocks.cleanup.forEach(fn => fn()); mocks.cleanup.length = 0
    calls = mocks.term.fit.mock.calls.length
    observer.resize()
    expect(mocks.term.fit).toHaveBeenCalledTimes(calls)
    expect(observer.disconnected).toBe(true)
    expect(mocks.term.dispose).toHaveBeenCalledOnce()
  })
})

async function connectedViewer(role: 'owner' | 'viewer' = 'viewer') {
  const viewer = scope.run(() => useSharedSessionViewer())!
  viewer.mount({} as HTMLElement)
  await viewer.connect({ sharedSessionId: 1, role, expiresAt: new Date() } as SharedSessionResolved)
  const socket = Socket.instances.at(-1)!
  socket.receive({ type: 'shared_session_snapshot', role, status: 'active', participants: [], expiresAt: new Date(Date.now() + 60000).toISOString() })
  await nextTick()
  return { viewer, socket, input: mocks.term.onData.mock.calls.at(-1)![0] }
}
const lease = { controllerUserId: 1, expiresAt: '2099-01-01T00:00:00Z' }

describe('shared viewer failure and normal operation invariants', () => {
  it('gates binary mouse input by control permission, preserves bytes and disposes listeners', async () => {
    const { viewer, socket } = await connectedViewer()
    const binary = mocks.term.onBinary.mock.calls.at(-1)![0]
    const packet = '\x1b[M \x84%'
    binary(packet)
    expect(socket.send).not.toHaveBeenCalled()
    socket.receive({ type: 'shared_session_control_granted', lease })
    await nextTick()
    binary(packet)
    expect(socket.send).toHaveBeenLastCalledWith(new Uint8Array([27, 91, 77, 32, 132, 37]))
    socket.send.mockClear()
    socket.receive({ type: 'shared_session_control_revoked' })
    await nextTick()
    binary(packet)
    expect(socket.send).not.toHaveBeenCalled()
    await viewer.connect({ sharedSessionId: 1, role: 'viewer', expiresAt: new Date() } as SharedSessionResolved)
    expect((mocks.term.onBinary.mock.results[0].value as { dispose: ReturnType<typeof vi.fn> }).dispose).toHaveBeenCalled()
    viewer.disconnect()
    expect((mocks.term.onBinary.mock.results.at(-1)!.value as { dispose: ReturnType<typeof vi.fn> }).dispose).toHaveBeenCalled()
  })

  it('does not transmit while viewing or requesting; grants input only after permission arrives', async () => {
    const { viewer, socket, input } = await connectedViewer()
    input('blocked')
    socket.receive({ type: 'shared_session_control_requested', userId: 1 })
    socket.receive({ type: 'shared_session_control_requested', userId: 1 })
    expect(viewer.pendingControlRequests.value).toEqual([1])
    input('still blocked')
    expect(socket.send).not.toHaveBeenCalled()
    socket.receive({ type: 'shared_session_control_granted', lease })
    await nextTick()
    input('echo permitido\r')
    expect(new TextDecoder().decode(socket.send.mock.calls[0][0] as Uint8Array)).toBe('echo permitido\r')
    expect(viewer.pendingControlRequests.value).toEqual([])
    expect(mocks.term.setDisableStdin).toHaveBeenLastCalledWith(false)
  })

  it.each(['shared_session_control_revoked', 'shared_session_control_expired', 'shared_session_ended'])(
    '%s blocks subsequent input and still fits the termination message', async type => {
      const { viewer, socket, input } = await connectedViewer()
      socket.receive({ type: 'shared_session_control_granted', lease }); await nextTick()
      input('before'); expect(socket.send).toHaveBeenCalledOnce()
      socket.receive({ type, userId: 1 }); await nextTick()
      input('after')
      mocks.term.onBinary.mock.calls.at(-1)![0]('\x1b[M \x84%')
      expect(socket.send).toHaveBeenCalledOnce()
      expect(viewer.canInput.value).toBe(false)
      const calls = mocks.term.fit.mock.calls.length
      Observer.instances[0].resize()
      expect(mocks.term.fit).toHaveBeenCalledTimes(calls + 1)
    },
  )

  it('denial permits a new request without enabling input', async () => {
    const { viewer, socket, input } = await connectedViewer()
    socket.receive({ type: 'shared_session_control_requested', userId: 1 })
    socket.receive({ type: 'shared_session_control_denied', userId: 1, reason: 'Tente depois' })
    expect(viewer.pendingControlRequests.value).toEqual([])
    expect(viewer.canInput.value).toBe(false)
    input('blocked'); expect(socket.send).not.toHaveBeenCalled()
    socket.receive({ type: 'shared_session_control_requested', userId: 1 })
    expect(viewer.pendingControlRequests.value).toEqual([1])
  })

  it('ignores malformed and unknown messages without changing the current permission', async () => {
    const { viewer, socket } = await connectedViewer()
    socket.onmessage?.({ data: '{invalid' })
    socket.receive({ type: 'future_event' })
    expect(viewer.status.value).toBe('connected')
    expect(viewer.canInput.value).toBe(false)
    expect(mocks.term.write).not.toHaveBeenCalled()
  })

  it.each(['error', 'close'])('keeps geometry observation after WebSocket %s and does not send to a closed socket', async kind => {
    const { viewer, socket, input } = await connectedViewer()
    socket.receive({ type: 'shared_session_control_granted', lease }); await nextTick()
    socket.readyState = 3
    if (kind === 'error') socket.onerror?.()
    else socket.onclose?.()
    expect(viewer.status.value).toBe(kind === 'error' ? 'error' : 'closed')
    input('offline'); expect(socket.send).not.toHaveBeenCalled()
    const before = mocks.term.fit.mock.calls.length
    Observer.instances[0].resize()
    expect(mocks.term.fit).toHaveBeenCalledTimes(before + 1)
    expect(mocks.term.writeln).toHaveBeenCalled()
  })

  it('local fitting does not send resize messages or steal focus while the viewer reads history', async () => {
    const { socket } = await connectedViewer()
    mocks.term.focus.mockClear(); mocks.term.scrollToBottom.mockClear()
    for (let i = 0; i < 100; i++) Observer.instances[0].resize()
    expect(socket.send).not.toHaveBeenCalled()
    expect(mocks.term.focus).not.toHaveBeenCalled()
    expect(mocks.term.scrollToBottom).not.toHaveBeenCalled()
  })

  it('releases previous input listeners during repeated reconnects without allocating more observers', async () => {
    const { viewer } = await connectedViewer()
    for (let i = 0; i < 12; i++) await viewer.connect({ sharedSessionId: 1, role: 'viewer', expiresAt: new Date() } as SharedSessionResolved)
    expect(Observer.instances).toHaveLength(1)
    const listeners = mocks.term.onData.mock.results.map(r => r.value as { dispose: ReturnType<typeof vi.fn> })
    for (const listener of listeners.slice(0, -1)) expect(listener.dispose).toHaveBeenCalledOnce()
    expect(listeners.at(-1)!.dispose).not.toHaveBeenCalled()
    for (const socket of Socket.instances.slice(0, -1)) expect(socket.close).toHaveBeenCalledOnce()
  })
})
