import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useTerminal } from './useTerminal'

const mocks = vi.hoisted(() => ({
  cleanup: [] as Array<() => void>,
  sample: null as null | ((sample: unknown) => void),
  effective: vi.fn(), telemetry: vi.fn(), invalidate: vi.fn(), setRules: vi.fn(),
  term: { mount: vi.fn(), fit: vi.fn(() => ({ cols: 80, rows: 24 })), onSelectionChange: vi.fn(), attachShortcuts: vi.fn(), onScroll: vi.fn(), onBinary: vi.fn((_callback: (data: string) => void) => ({ dispose: vi.fn() })), onData: vi.fn(() => ({ dispose: vi.fn() })), dispose: vi.fn(), cols: 80, rows: 24 },
}))
vi.mock('vue', async () => ({ ...await vi.importActual('vue'), onUnmounted: (fn: () => void) => mocks.cleanup.push(fn) }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ accessToken: `x.${btoa(JSON.stringify({ exp: 4102444800 }))}.x` }) }))
vi.mock('@/services/auth-session.service', () => ({ handleExpiredSession: vi.fn() }))
vi.mock('@/services/app-events.service', () => ({ TERMINAL_HIGHLIGHTS_CHANGED_EVENT: 'nodeaccess:terminal-highlights-changed' }))
vi.mock('./terminal-preferences', () => ({ termSettings: { fontSize: 14, fontFamily: 'monospace', theme: 'dark' } }))
vi.mock('@/terminal/xterm-adapter', () => ({ createXtermAdapter: () => mocks.term }))
vi.mock('@/services/terminal-highlight.service', () => ({ terminalHighlightService: mocks }))
vi.mock('@/terminal/terminal-highlighter', () => ({ TerminalHighlighter: class {
  constructor(_term: unknown, sample: (sample: unknown) => void) { mocks.sample = sample }
  setRules = mocks.setRules
  dispose = vi.fn()
} }))

class Socket {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 1
  onmessage?: (event: { data: unknown }) => void
  send = vi.fn()
  close = vi.fn()
  constructor() { Socket.instances.push(this) }
}
const events = ['nodeaccess:terminal-highlights-changed', 'nodeaccess:terminal-highlights-invalidated']
const data = { enabled: true, rules: [{ id: 'private-rule' }], version: '1' }
let scope: ReturnType<typeof effectScope>
beforeEach(() => {
  vi.clearAllMocks(); mocks.cleanup.length = 0
  mocks.effective.mockResolvedValue({ data }); mocks.telemetry.mockResolvedValue({})
  scope = effectScope()
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { hostname: 'localhost' }, clearInterval }))
  vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('WebSocket', Socket)
})
afterEach(() => { mocks.cleanup.splice(0).forEach(fn => fn()); scope.stop(); vi.unstubAllGlobals() })
function mounted() {
  const terminal = scope.run(() => useTerminal())!
  terminal.mount({ getBoundingClientRect: () => ({ width: 800, height: 600 }) } as HTMLElement)
  return terminal
}
function invalidate() { events.forEach(event => window.dispatchEvent(new Event(event))) }
async function settle() { await Promise.resolve(); await Promise.resolve() }

describe('terminal private highlight context', () => {
  it('does not fetch or send telemetry before a connection context is known', () => {
    mounted(); invalidate(); mocks.sample?.({})
    expect(mocks.effective).not.toHaveBeenCalled()
    expect(mocks.invalidate).not.toHaveBeenCalled()
    expect(mocks.telemetry).not.toHaveBeenCalled()
  })
  it('denies private requests for JIT even when the browser has an authenticated user', async () => {
    const terminal = mounted()
    await terminal.connect(42, 'jit-scoped-token')
    invalidate(); mocks.sample?.({}); await settle()
    expect(mocks.effective).not.toHaveBeenCalled()
    expect(mocks.invalidate).not.toHaveBeenCalled()
    expect(mocks.telemetry).not.toHaveBeenCalled()
    expect(terminal.activeHighlightRules.value).toEqual([])
  })
  it('preserves fetching, refresh and telemetry for an authenticated terminal', async () => {
    const terminal = mounted()
    await terminal.connect(42); await settle()
    expect(terminal.activeHighlightRules.value).toEqual(data.rules)
    expect(mocks.setRules).toHaveBeenLastCalledWith(data.rules)
    invalidate(); await settle(); mocks.sample?.({ elapsedMs: 1 })
    expect(mocks.effective).toHaveBeenCalledTimes(3)
    expect(mocks.effective).toHaveBeenLastCalledWith({ fresh: true })
    expect(mocks.invalidate).toHaveBeenCalledTimes(2)
    expect(mocks.telemetry).toHaveBeenCalledOnce()
  })
  it('discards a private response arriving after switching to JIT', async () => {
    let resolve!: (value: unknown) => void
    mocks.effective.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const terminal = mounted()
    await terminal.connect(42)
    await terminal.connect(42, 'jit-scoped-token')
    resolve({ data }); await settle()
    expect(terminal.activeHighlightRules.value).toEqual([])
    expect(mocks.setRules).not.toHaveBeenCalledWith(data.rules)
  })
  it.each(['resolve', 'reject'])('ignores an obsolete %s after a newer private connection', async outcome => {
    let resolve!: (value: unknown) => void
    let reject!: (reason: unknown) => void
    mocks.effective.mockReturnValueOnce(new Promise((done, fail) => { resolve = done; reject = fail }))
    const terminal = mounted()
    await terminal.connect(42)
    await terminal.connect(43); await settle()
    if (outcome === 'resolve') resolve({ data: { ...data, rules: [{ id: 'obsolete' }] } })
    else reject(new Error('obsolete failure'))
    await settle()
    expect(terminal.activeHighlightRules.value).toEqual(data.rules)
    expect(mocks.setRules).toHaveBeenLastCalledWith(data.rules)
  })
  it('ignores pending responses and removes refresh listeners on unmount', async () => {
    let resolve!: (value: unknown) => void
    mocks.effective.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const terminal = mounted()
    await terminal.connect(42)
    mocks.cleanup.splice(0).forEach(fn => fn())
    resolve({ data }); invalidate(); mocks.sample?.({}); await settle()
    expect(terminal.activeHighlightRules.value).toEqual([])
    expect(mocks.effective).toHaveBeenCalledOnce()
    expect(mocks.telemetry).not.toHaveBeenCalled()
    expect(mocks.setRules).not.toHaveBeenCalledWith(data.rules)
  })
})

describe('terminal binary mouse input', () => {
  it('preserves bytes, ignores disconnected input and replaces listeners on reconnect', async () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const terminal = mounted()
    await terminal.connect(42, 'jit-scoped-token')
    const socket = Socket.instances.at(-1)!
    const binary = mocks.term.onBinary.mock.calls.at(-1)![0]
    const packet = '\x1b[M \x84%'
    binary(packet)
    expect(socket.send).not.toHaveBeenCalled()
    socket.onmessage?.({ data: JSON.stringify({ type: 'connected', sessionId: 1 }) })
    binary(packet)
    expect(socket.send).toHaveBeenLastCalledWith(new Uint8Array([27, 91, 77, 32, 132, 37]))
    socket.send.mockClear()
    socket.readyState = 3
    binary(packet)
    expect(socket.send).not.toHaveBeenCalled()
    await terminal.connect(42, 'jit-scoped-token')
    expect((mocks.term.onBinary.mock.results[0].value as { dispose: ReturnType<typeof vi.fn> }).dispose).toHaveBeenCalledOnce()
    terminal.disconnect()
    mocks.term.onBinary.mock.calls.at(-1)![0](packet)
    expect(Socket.instances.at(-1)!.send).not.toHaveBeenCalled()
    mocks.cleanup.splice(0).forEach(fn => fn())
    expect((mocks.term.onBinary.mock.results.at(-1)!.value as { dispose: ReturnType<typeof vi.fn> }).dispose).toHaveBeenCalledOnce()
  })
})
