import { describe, expect, it, vi } from 'vitest'
import { createRenderer, createSSRApp, nextTick, ssrContextKey, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import App from './App.vue'
import { ExtensionError, type ExtensionClient } from '../core/client'
import { message } from './messages'

interface HostNode { parent: HostNode | null; children: HostNode[] }
const node = (): HostNode => ({ parent: null, children: [] })
interface Popup { phase: string; items: unknown[]; error: string; query: string; next: string | null; recents: string[]
  search(more?: boolean): Promise<void>; connect(): Promise<void>; disconnect(): Promise<void>; openItem(item: unknown): Promise<void>; setKind(value: string): void; applyUpdate(): void
  onKey(event: unknown): void; focusItem(index: number): void; active: number; otp: string; submitCode(): Promise<void>; renew(code: string | null): Promise<boolean> }
function mount(props: Record<string, unknown>) {
  const renderer = createRenderer<HostNode, HostNode>({ createElement: node, createText: node, createComment: node, setText: () => {}, setElementText: () => {}, patchProp: () => {},
    parentNode: n => n.parent, nextSibling: () => null, insert: (n, p) => { n.parent = p; p.children.push(n) }, remove: n => { if (n.parent) n.parent.children = n.parent.children.filter(c => c !== n) } })
  const app = renderer.createApp({ ...(App as Component), render: () => null }, props); app.provide(ssrContextKey, { modules: new Set() })
  const vm = app.mount(node()), state = (vm.$ as unknown as { setupState: Popup }).setupState
  return { state, unmount: () => app.unmount(), html: () => renderToString(createSSRApp({ ...(App as Component), setup: () => state }, props)) }
}
const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) { await Promise.resolve(); await nextTick() } }
const item = { kind: 'secret' as const, sourceId: 3, label: 'db', description: null, scope: 'shared' as const, portalPath: '/vault?kind=secret&id=3' }
function fakeClient(connected: boolean) {
  return {
    connect: vi.fn(), connected: vi.fn().mockResolvedValue(connected), disconnect: vi.fn().mockResolvedValue(undefined), capabilities: vi.fn(),
    search: vi.fn().mockResolvedValue({ items: [item], nextCursor: '50' }), remember: vi.fn().mockResolvedValue(undefined),
    recents: vi.fn().mockResolvedValue(['secret:3']), locale: vi.fn().mockResolvedValue(null), renew: vi.fn().mockRejectedValue(new ExtensionError('expired')), fingerprint: vi.fn().mockResolvedValue('abcd-efgh-ijkl-mnop'), portalUrl: vi.fn((p: string) => `https://vault.example.test${p}`),
  }
}
const asClient = (c: ReturnType<typeof fakeClient>): ExtensionClient => c

describe('NA-0183 extension popup', () => {
  it('offers to connect and lists metadata once the service worker connects', async () => {
    const client = fakeClient(false), requestConnection = vi.fn().mockResolvedValue({ ok: true }), open = vi.fn().mockResolvedValue(undefined)
    const f = mount({ client: asClient(client), requestConnection, open }); await flush()
    expect(f.state.phase).toBe('disconnected')
    expect(await f.html()).toContain('vaultnaccess-connect')
    await f.state.connect()
    expect(requestConnection).toHaveBeenCalled(); expect(f.state.phase).toBe('connected'); expect(f.state.items).toEqual([item])
    const html = await f.html()
    expect(html).toContain('db'); expect(html).not.toMatch(/accessToken|DPoP/)
    await f.state.search(true)
    expect(client.search).toHaveBeenLastCalledWith('', undefined, '50')
    await f.state.openItem(item)
    expect(client.remember).toHaveBeenCalledWith('secret:3'); expect(open).toHaveBeenCalledWith('https://vault.example.test/vault?kind=secret&id=3')
    await f.state.disconnect()
    expect(f.state.phase).toBe('disconnected'); expect(f.state.items).toEqual([])
    f.unmount()
  })
  it('resumes a live session and drops back to connect when the server refuses', async () => {
    const client = fakeClient(true)
    const f = mount({ client: asClient(client), requestConnection: vi.fn(), open: vi.fn() }); await flush()
    expect(f.state.phase).toBe('connected'); expect(f.state.recents).toEqual(['secret:3'])
    client.search.mockRejectedValueOnce(new ExtensionError('denied'))
    await f.state.search()
    expect(f.state.phase).toBe('disconnected'); expect(f.state.error).toBe('denied')
    f.unmount()
  })
  it('reports a failed or cancelled connection', async () => {
    const f = mount({ client: asClient(fakeClient(false)), requestConnection: vi.fn().mockResolvedValue({ ok: false, reason: 'cancelled' }), open: vi.fn() }); await flush()
    await f.state.connect()
    expect(f.state.phase).toBe('disconnected'); expect(f.state.error).toBe('cancelled')
    const g = mount({ client: asClient(fakeClient(false)), requestConnection: vi.fn().mockRejectedValue(new Error('gone')), open: vi.fn() }); await flush()
    await g.state.connect(); expect(g.state.error).toBe('unavailable')
    f.unmount(); g.unmount()
  })
  it('NA-0192: uses the browser language until a connection tells the portal language', async () => {
    const en = mount({ client: asClient(fakeClient(false)), requestConnection: vi.fn(), open: vi.fn(), browserLanguage: 'en-US' }); await flush()
    expect(await en.html()).toContain(message('en-US').connect); en.unmount()
    const plain = mount({ client: asClient(fakeClient(false)), requestConnection: vi.fn(), open: vi.fn() }); await flush()
    expect(await plain.html()).toContain(message('pt-BR').connect); plain.unmount()
    const client = fakeClient(true); client.locale.mockResolvedValue('pt-BR')
    const pt = mount({ client: asClient(client), requestConnection: vi.fn(), open: vi.fn(), browserLanguage: 'en-US' }); await flush()
    expect(await pt.html()).toContain('Conectado'); pt.unmount()
    const later = fakeClient(false); later.locale.mockResolvedValue('en')
    const g = mount({ client: asClient(later), requestConnection: vi.fn().mockResolvedValue({ ok: true }), open: vi.fn() }); await flush()
    await g.state.connect(); expect(await g.html()).toContain('Connected'); g.unmount()
  })
  it('has every message in both languages', () => {
    const pt = message('pt-BR'), en = message('en-US')
    expect(Object.keys(pt.errors)).toEqual(Object.keys(en.errors))
    expect(pt.connect).not.toBe(en.connect)
  })
  it('NA-0189: type filter as buttons, item details and the connected state', async () => {
    const client = fakeClient(true)
    client.search.mockResolvedValue({ items: [item, { ...item, kind: 'pem' as const, sourceId: 4, label: 'gateway', description: 'Bastion key', scope: 'personal' as const, portalPath: '/vault?kind=pem&id=4' }], nextCursor: null })
    const f = mount({ client: asClient(client), requestConnection: vi.fn(), open: vi.fn() }); await flush()
    const html = await f.html()
    expect(html).toContain('Conectado'); expect(html).toContain('aria-pressed="true"'); expect(html).toContain('Bastion key')
    expect(html).toContain('Chave PEM'); expect(html).toContain('Pessoal'); expect(html).toContain('Recentes')
    f.state.setKind('pem'); await flush()
    expect(client.search).toHaveBeenLastCalledWith('', 'pem', undefined)
    const calls = client.search.mock.calls.length
    f.state.setKind('pem'); await flush()
    expect(client.search).toHaveBeenCalledTimes(calls)
    f.state.setKind(''); await flush()
    expect(client.search).toHaveBeenLastCalledWith('', undefined, undefined)
    f.unmount()
  })
  it('NA-0189: shows the device code while waiting and a placeholder while loading', async () => {
    const client = fakeClient(false)
    let finish!: (v: { ok: boolean }) => void
    const f = mount({ client: asClient(client), requestConnection: vi.fn(() => new Promise(done => { finish = done })), open: vi.fn() })
    expect(await f.html()).toContain('skeleton')
    await flush()
    const pending = f.state.connect(); await flush()
    const html = await f.html()
    expect(html).toContain('vaultnaccess-fingerprint'); expect(html).toContain('abcd-efgh-ijkl-mnop'); expect(html).toContain('spinner')
    finish({ ok: true }); await pending
    f.unmount()
  })
  it('NA-0190: offers to reload a newer local build and stays quiet otherwise', async () => {
    const apply = vi.fn()
    const f = mount({ client: asClient(fakeClient(false)), requestConnection: vi.fn(), open: vi.fn(), update: { check: { available: vi.fn().mockResolvedValue(true) }, apply } }); await flush()
    const html = await f.html()
    expect(html).toContain('vaultnaccess-update'); expect(html).toContain('Nova versão da extensão disponível.')
    f.state.applyUpdate(); expect(apply).toHaveBeenCalledTimes(1)
    f.unmount()
    for (const update of [undefined, { check: { available: vi.fn().mockResolvedValue(false) }, apply }]) {
      const quiet = mount({ client: asClient(fakeClient(false)), requestConnection: vi.fn(), open: vi.fn(), update }); await flush()
      expect(await quiet.html()).not.toContain('vaultnaccess-update'); quiet.state.applyUpdate(); quiet.unmount()
    }
    expect(apply).toHaveBeenCalledTimes(2)
  })
  it('NA-0190: shows why a connection attempt failed after the popup had closed', async () => {
    const lastFailure = vi.fn().mockResolvedValue('offline')
    const f = mount({ client: asClient(fakeClient(false)), requestConnection: vi.fn(), open: vi.fn(), lastFailure }); await flush()
    expect(f.state.error).toBe('offline')
    expect(await f.html()).toContain('Não foi possível conectar ao NodeAccess.')
    f.unmount()
    const quiet = mount({ client: asClient(fakeClient(false)), requestConnection: vi.fn(), open: vi.fn(), lastFailure: vi.fn().mockRejectedValue(new Error('x')) }); await flush()
    expect(quiet.state.error).toBe(''); quiet.unmount()
    const live = mount({ client: asClient(fakeClient(false)), requestConnection: vi.fn().mockResolvedValue({ ok: false, reason: 'offline' }), open: vi.fn() }); await flush()
    await live.state.connect(); expect(live.state.error).toBe('offline'); expect(live.state.phase).toBe('disconnected'); live.unmount()
  })
  it('NA-0192: searches while typing, once, after a short pause', async () => {
    vi.useFakeTimers()
    try {
      const client = fakeClient(true)
      const f = mount({ client: asClient(client), requestConnection: vi.fn(), open: vi.fn() }); await flush()
      const before = client.search.mock.calls.length
      f.state.query = 'd'; await nextTick(); f.state.query = 'db'; await nextTick()
      await vi.advanceTimersByTimeAsync(299); expect(client.search.mock.calls.length).toBe(before)
      await vi.advanceTimersByTimeAsync(1); expect(client.search).toHaveBeenLastCalledWith('db', undefined, undefined)
      expect(client.search.mock.calls.length).toBe(before + 1)
      f.unmount()
    } finally { vi.useRealTimers() }
  })
  it('NA-0192: keyboard — slash focuses the search, arrows move through results, Esc clears', async () => {
    const client = fakeClient(true)
    client.search.mockResolvedValue({ items: [item, { ...item, sourceId: 4, label: 'web', portalPath: '/vault?kind=secret&id=4' }], nextCursor: null })
    const f = mount({ client: asClient(client), requestConnection: vi.fn(), open: vi.fn() }); await flush()
    const key = (k: string, target: unknown = {}) => { const prevent = vi.fn(); f.state.onKey({ key: k, target, preventDefault: prevent }); return prevent }
    expect(key('/')).toHaveBeenCalled()
    key('ArrowDown'); expect(f.state.active).toBe(0)
    key('ArrowDown'); key('ArrowDown'); expect(f.state.active).toBe(1)
    key('ArrowUp'); expect(f.state.active).toBe(0)
    key('ArrowUp'); expect(f.state.active).toBe(-1)
    f.state.query = 'db'; expect(key('Escape')).toHaveBeenCalled(); expect(f.state.query).toBe('')
    expect(key('Escape')).not.toHaveBeenCalled()
    expect(key('x')).not.toHaveBeenCalled()
    f.unmount()
    const off = mount({ client: asClient(fakeClient(false)), requestConnection: vi.fn(), open: vi.fn() }); await flush()
    const prevent = vi.fn(); off.state.onKey({ key: '/', target: {}, preventDefault: prevent }); expect(prevent).not.toHaveBeenCalled()
    off.state.focusItem(0); off.unmount()
  })
  it('NA-0193: a trusted device reconnects by itself when the popup opens', async () => {
    const client = fakeClient(false); client.renew.mockResolvedValue(undefined)
    const f = mount({ client: asClient(client), requestConnection: vi.fn(), open: vi.fn() }); await flush()
    expect(client.renew).toHaveBeenCalledWith(undefined); expect(f.state.phase).toBe('connected'); expect(f.state.items).toEqual([item])
    f.unmount()
    const failed = fakeClient(false)
    const g = mount({ client: asClient(failed), requestConnection: vi.fn(), open: vi.fn(), lastFailure: vi.fn().mockResolvedValue('offline') }); await flush()
    expect(failed.renew).not.toHaveBeenCalled(); expect(g.state.error).toBe('offline'); g.unmount()
  })
  it('NA-0193: asks only for the authenticator code when the portal login ended', async () => {
    const client = fakeClient(false); client.renew.mockRejectedValueOnce(new ExtensionError('reauthRequired'))
    const f = mount({ client: asClient(client), requestConnection: vi.fn(), open: vi.fn() }); await flush()
    expect(f.state.phase).toBe('code')
    const html = await f.html()
    expect(html).toContain('vaultnaccess-otp'); expect(html).toContain('Código do autenticador (6 dígitos)'); expect(html).toContain('vaultnaccess-use-portal'); expect(html).toContain('vaultnaccess-code-disconnect')
    f.state.otp = '12'; await f.state.submitCode(); expect(client.renew).toHaveBeenCalledTimes(1)
    client.renew.mockRejectedValueOnce(new ExtensionError('otpInvalid'))
    f.state.otp = '000000'; await f.state.submitCode()
    expect(f.state.phase).toBe('code'); expect(f.state.error).toBe('otpInvalid'); expect(f.state.otp).toBe('')
    expect(await f.html()).toContain('Código incorreto.')
    client.renew.mockResolvedValueOnce(undefined)
    f.state.otp = '123456'; await f.state.submitCode()
    expect(client.renew).toHaveBeenLastCalledWith('123456'); expect(f.state.phase).toBe('connected'); expect(f.state.error).toBe('')
    f.unmount()
  })
  it('NA-0193: after too many codes or a revoked device it sends the user back to the portal', async () => {
    const client = fakeClient(false); client.renew.mockRejectedValueOnce(new ExtensionError('reauthRequired')).mockRejectedValueOnce(new ExtensionError('expired'))
    const f = mount({ client: asClient(client), requestConnection: vi.fn(), open: vi.fn() }); await flush()
    f.state.otp = '000000'; await f.state.submitCode()
    expect(f.state.phase).toBe('disconnected'); expect(f.state.error).toBe('trustEnded')
    expect(await f.html()).toContain('precisa ser autorizado de novo')
    client.renew.mockRejectedValueOnce(new ExtensionError('offline'))
    expect(await f.state.renew('123456')).toBe(false); expect(f.state.error).toBe('offline')
    f.unmount()
  })
})
