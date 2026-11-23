import { describe, expect, it, vi } from 'vitest'
import { createRenderer, createSSRApp, nextTick, ssrContextKey, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import App from './App.vue'
import { ExtensionError, type ExtensionClient } from '../core/client'
import { message } from './messages'

interface HostNode { parent: HostNode | null; children: HostNode[] }
const node = (): HostNode => ({ parent: null, children: [] })
interface Popup { phase: string; items: unknown[]; error: string; query: string; next: string | null; recents: string[]
  search(more?: boolean): Promise<void>; connect(): Promise<void>; disconnect(): Promise<void>; openItem(item: unknown): Promise<void>; setKind(value: string): void }
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
    recents: vi.fn().mockResolvedValue(['secret:3']), fingerprint: vi.fn().mockResolvedValue('abcd-efgh-ijkl-mnop'), portalUrl: vi.fn((p: string) => `https://vault.example.test${p}`),
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
  it('always renders in pt-BR, even in an English browser', async () => {
    vi.stubGlobal('navigator', { language: 'en-US' })
    try {
      const f = mount({ client: asClient(fakeClient(false)), requestConnection: vi.fn(), open: vi.fn() }); await flush()
      const html = await f.html()
      f.unmount()
      expect(html).toContain(message('pt-BR').connect)
      expect(html).not.toContain(message('en-US').connect)
    } finally { vi.unstubAllGlobals() }
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
})
