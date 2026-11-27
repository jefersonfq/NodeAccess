import { describe, expect, it, vi } from 'vitest'
import { createRenderer, createSSRApp, nextTick, ssrContextKey, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import App from './App.vue'
import { ExtensionError, type ExtensionClient, type PortalProofResult } from '../core/client'
import { message } from './messages'
import type { VaultSiteMetadata } from '@nodeaccess/shared'
import type { CapturedSiteDraft, PendingFillIntent } from '../core/portal-fill-intent'

interface HostNode { parent: HostNode | null; children: HostNode[] }
const node = (): HostNode => ({ parent: null, children: [] })
interface Popup {
  showSites: boolean; siteOrigin: string; siteBusy: boolean; siteNeedsProof: boolean
  fillLogin(item: VaultSiteMetadata): Promise<void>; siteProof(): Promise<void>; openWebsite(url: string): Promise<void>
  checkEditorProof(): Promise<void>; editorProofState: string; siteMessage: string
  searchSiteHosts(query: string): Promise<void>; siteHosts: Array<{ id: number; name: string }>

  pendingSiteFill: PendingFillIntent | null; fillReady: boolean; capturedDraft: CapturedSiteDraft | null; captureOptIn: boolean
  restoreSiteContinuity(): Promise<boolean>; checkSiteFill(): Promise<void>; confirmSiteFill(): Promise<void>; cancelSiteFill(): Promise<void>
  enableSiteAssist(): Promise<void>; stageEditorProof(draft: CapturedSiteDraft): Promise<void>; consumedDraft(id: string): void
  favoriteHost(id: number): Promise<void>; hostPreferenceState: { favorites: number[]; recents: { id: number; at: number }[] }; loadFeatures(): Promise<void>
  edit(mode: string, item?: unknown): void; closeEditor(): void; editor: unknown; writeAccess: unknown; phase: string; items: unknown[]; error: string; query: string; next: string | null; recents: string[]
  openSites(): Promise<void>; currentHosts: Array<{ id: number; name: string }>
  loadHosts(item: unknown, more?: boolean): Promise<void>; closeHosts(): void; openHost(id: number): Promise<void>; related: unknown
  search(more?: boolean): Promise<void>; connect(): Promise<void>; disconnect(): Promise<void>; openItem(item: unknown): Promise<void>; setKind(value: string): void; applyUpdate(): void
  onKey(event: unknown): void; focusItem(index: number): void; active: number; otp: string; submitCode(): Promise<void>; renew(code: string | null): Promise<boolean>
  act(item: unknown, action: 'reveal' | 'copy'): Promise<void>; confirmProof(): Promise<void>; cancelProof(): void; confirmCopy(): Promise<void>
  confirmInPortal(): Promise<void>; checkPortal(): Promise<boolean>; stopPortal(): void; portal: string
  proofOtp: string; pending: unknown; revealed: { value: string } | null; copiedKey: string; features: { reveal: boolean; copy: boolean } }
function mount(props: Record<string, unknown>) {
  const renderer = createRenderer<HostNode, HostNode>({ createElement: node, createText: node, createComment: node, setText: () => {}, setElementText: () => {}, patchProp: () => {},
    parentNode: n => n.parent, nextSibling: () => null, insert: (n, p) => { n.parent = p; p.children.push(n) }, remove: n => { if (n.parent) n.parent.children = n.parent.children.filter(c => c !== n) } })
  const app = renderer.createApp({ ...(App as Component), render: () => null }, props); app.provide(ssrContextKey, { modules: new Set() })
  const vm = app.mount(node()), state = (vm.$ as unknown as { setupState: Popup }).setupState
  return { state, unmount: () => app.unmount(), html: () => renderToString(createSSRApp({ ...(App as Component), setup: () => state }, props)) }
}
const flush = async (): Promise<void> => { for (let i = 0; i < 12; i++) { await Promise.resolve(); await nextTick() } }
const item = { kind: 'secret' as const, sourceId: 3, label: 'db', description: null, scope: 'shared' as const, portalPath: '/vault?kind=secret&id=3' }
function fakeClient(connected: boolean) {
  return {
    hosts: vi.fn().mockResolvedValue({ hosts: [{ id: 10, name: 'Visible host' }], nextCursor: null }),
    write: vi.fn().mockResolvedValue({ id: 3 }),
    connect: vi.fn(), connected: vi.fn().mockResolvedValue(connected), disconnect: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue({ items: [item], nextCursor: '50' }), remember: vi.fn().mockResolvedValue(undefined),
    recents: vi.fn().mockResolvedValue(['secret:3']), locale: vi.fn().mockResolvedValue(null),
    cancelPortalProof: vi.fn().mockResolvedValue(undefined),
    requestPortalProof: vi.fn().mockResolvedValue('https://vault.example.test/vault/extension/confirm?request=' + 'q'.repeat(43)),
    claimPortalProof: vi.fn<() => Promise<PortalProofResult>>().mockResolvedValue({ state: 'none' }), renew: vi.fn().mockRejectedValue(new ExtensionError('expired')), unlock: vi.fn().mockResolvedValue(Date.now() + 60_000), deliver: vi.fn().mockResolvedValue('s3cret'),
    capabilities: vi.fn().mockResolvedValue({ features: { reveal: true, copy: true, create: false }, serverNow: 0 }), fingerprint: vi.fn().mockResolvedValue('abcd-efgh-ijkl-mnop'), portalUrl: vi.fn((p: string) => `https://vault.example.test${p}`),
  }
}
const asClient = (c: ReturnType<typeof fakeClient>): ExtensionClient => c

describe('NA-0183 extension popup', () => {
  it('clears current-site hosts synchronously before lookup and on disconnect, discarding late matches', async () => {
    const client = { ...fakeClient(true), siteHosts: vi.fn().mockResolvedValue([]), siteCurrentHosts: vi.fn().mockResolvedValue([{ id: 1, name: 'Previous identity host' }]) }
    const currentSite = vi.fn().mockResolvedValue('https://example.test')
    const f = mount({ client, currentSite, requestConnection: vi.fn(), open: vi.fn() }); await flush()
    await f.state.openSites(); expect(f.state.currentHosts).toHaveLength(1)
    let resolveOrigin!: (origin: string) => void
    currentSite.mockImplementationOnce(() => new Promise<string>(resolve => { resolveOrigin = resolve }))
    const reload = f.state.openSites()
    expect(f.state.currentHosts).toEqual([])
    resolveOrigin('https://example.test'); await reload; expect(f.state.currentHosts).toHaveLength(1)
    let resolveHosts!: (hosts: Array<{ id: number; name: string }>) => void
    client.siteCurrentHosts.mockImplementationOnce(() => new Promise(resolve => { resolveHosts = resolve }))
    const pending = f.state.openSites(); await flush()
    f.state.currentHosts = [{ id: 1, name: 'Previous identity host' }]
    f.state.phase = 'disconnected'; expect(f.state.currentHosts).toEqual([])
    resolveHosts([{ id: 1, name: 'Late previous identity host' }]); await pending
    expect(f.state.currentHosts).toEqual([]); f.unmount()
  })
  it('E4 uses server capabilities for shared edit controls and passes allowed groups to the editor', async () => {
    const client = fakeClient(true)
    client.capabilities.mockResolvedValue({ features: { reveal: false, copy: false, create: true }, serverNow: 0, writeAccess: { groups: [{ id: 12, name: 'Ops' }], tenant: false } })
    const writable = { ...item, writable: true, writeScope: 'GROUP', groupId: 12 }
    client.search.mockResolvedValue({ items: [writable], nextCursor: null })
    const f = mount({ client: asClient(client), requestConnection: vi.fn(), open: vi.fn() }); await flush()
    expect(f.state.writeAccess).toEqual({ groups: [{ id: 12, name: 'Ops' }], tenant: false })
    expect(await f.html()).toContain('Editar dados')
    f.state.edit('update-secret', { ...writable, writable: false }); expect(f.state.editor).toBeNull()
    f.state.edit('update-secret', writable); expect(f.state.editor).toMatchObject({ mode: 'update-secret', item: writable })
    f.state.closeEditor()
    f.state.items = [{ ...writable, writable: false }]
    expect(await f.html()).not.toContain('Editar dados')
    f.unmount()
  })
  it('loads associated hosts on demand and discards responses after the context closes', async () => {
    const client = fakeClient(true), open = vi.fn()
    const f = mount({ client: asClient(client), requestConnection: vi.fn(), open }); await flush()
    expect(client.hosts).not.toHaveBeenCalled()
    await f.state.loadHosts(item)
    expect(client.hosts).toHaveBeenCalledWith('secret', 3, undefined)
    expect(await f.html()).toContain('Visible host')
    await f.state.openHost(10); expect(open).toHaveBeenCalledWith('https://vault.example.test/hosts?hostId=10&connect=1')
    let finish!: (value: unknown) => void
    client.hosts.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const waiting = f.state.loadHosts(item); f.state.closeHosts()
    finish({ hosts: [{ id: 11, name: 'late' }], nextCursor: null }); await waiting
    expect(f.state.related).toBeNull(); f.unmount()
  })
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
    // NA-0195: the footer names this device as the portal lists it, so the user knows which one to revoke.
    let html = await f.html()
    expect(html).toContain('vaultnaccess-device'); expect(html).toContain('abcd-efgh-ijkl-mnop')
    client.search.mockRejectedValueOnce(new ExtensionError('denied'))
    await f.state.search()
    expect(f.state.phase).toBe('disconnected'); expect(f.state.error).toBe('denied')
    html = await f.html(); expect(html).not.toContain('vaultnaccess-device')
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
  it('NA-0200: confirming in the portal opens the page and, while the popup stays open, continues with the action once approved', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      const client = fakeClient(true), open = vi.fn().mockResolvedValue(undefined)
      const f = mount({ client: asClient(client), requestConnection: vi.fn(), open }); await flush()
      await f.state.act(item, 'reveal')
      expect(await f.html()).toContain('vaultnaccess-proof-portal')
      client.claimPortalProof.mockResolvedValueOnce({ state: 'pending' }).mockResolvedValueOnce({ state: 'approved', proofUntil: Date.now() + 60_000 })
      await f.state.confirmInPortal()
      expect(open).toHaveBeenCalledWith('https://vault.example.test/vault/extension/confirm?request=' + 'q'.repeat(43))
      expect(f.state.portal).toBe('waiting'); expect(await f.html()).toContain('vaultnaccess-portal-waiting')
      await vi.advanceTimersByTimeAsync(2_000); expect(client.deliver).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(2_000)
      expect(client.deliver).toHaveBeenCalledWith(3, 'reveal'); expect(f.state.pending).toBeNull(); expect(f.state.portal).toBe('idle')
      expect(client.unlock).not.toHaveBeenCalled()
      f.unmount()
    } finally { vi.useRealTimers() }
  })
  it('NA-0200: a failed request explains itself, and an unanswered confirmation stops after two minutes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      const client = fakeClient(true), open = vi.fn().mockResolvedValue(undefined)
      const f = mount({ client: asClient(client), requestConnection: vi.fn(), open }); await flush()
      await f.state.act(item, 'reveal')
      client.requestPortalProof.mockRejectedValueOnce(new ExtensionError('quota'))
      await f.state.confirmInPortal(); expect(f.state.error).toBe('quota'); expect(open).not.toHaveBeenCalled()
      await f.state.act(item, 'reveal')
      client.claimPortalProof.mockResolvedValue({ state: 'pending' })
      await f.state.confirmInPortal(); expect(f.state.portal).toBe('waiting')
      await vi.advanceTimersByTimeAsync(124_000)
      expect(f.state.portal).toBe('idle'); expect(f.state.error).toBe('portalProofExpired'); expect(client.deliver).not.toHaveBeenCalled()
      f.unmount()
    } finally { vi.useRealTimers() }
  })
  it('NA-0200: reopened after the portal approved, the popup restores the proof but runs nothing by itself; waiting can be cancelled', async () => {
    const client = fakeClient(true)
    client.claimPortalProof.mockResolvedValue({ state: 'approved', proofUntil: Date.now() + 60_000 })
    const f = mount({ client: asClient(client), requestConnection: vi.fn(), open: vi.fn() }); await flush()
    expect(f.state.portal).toBe('ready'); expect(await f.html()).toContain('vaultnaccess-portal-ready')
    expect(client.deliver).not.toHaveBeenCalled()
    await f.state.act(item, 'reveal'); expect(client.deliver).toHaveBeenCalledWith(3, 'reveal')
    const g = fakeClient(true); g.claimPortalProof.mockResolvedValue({ state: 'pending' })
    const h = mount({ client: asClient(g), requestConnection: vi.fn(), open: vi.fn() }); await flush()
    expect(h.state.portal).toBe('waiting'); h.state.stopPortal(); expect(h.state.portal).toBe('idle')
    const e = fakeClient(true); e.claimPortalProof.mockRejectedValue(new ExtensionError('portalProofExpired'))
    const k = mount({ client: asClient(e), requestConnection: vi.fn(), open: vi.fn() }); await flush()
    expect(k.state.error).toBe('portalProofExpired')
    f.unmount(); h.unmount(); k.unmount()
  })
  it('restores the freshly authorized item without delivering until an explicit click', async () => {
    const client = fakeClient(true)
    client.search.mockResolvedValue({ items: [], nextCursor: null })
    client.claimPortalProof.mockResolvedValue({ state: 'approved', proofUntil: Date.now() + 60_000, resume: { item, action: 'copy' } })
    const f = mount({ client: asClient(client), requestConnection: vi.fn(), open: vi.fn() }); await flush()
    expect(f.state.items).toEqual([item]); expect(await f.html()).toContain('vaultnaccess-resume')
    expect(client.deliver).not.toHaveBeenCalled()
    await f.state.act(item, 'copy'); expect(client.deliver).toHaveBeenCalledWith(3, 'copy')
    expect(await f.html()).not.toContain('vaultnaccess-resume')
    f.state.cancelProof(); expect(client.cancelPortalProof).toHaveBeenCalledOnce(); f.unmount()
  })
  it('does not open a late portal request after cancellation', async () => {
    const client = fakeClient(true), open = vi.fn()
    let finish!: (url: string) => void
    client.requestPortalProof.mockImplementation(() => new Promise<string>(resolve => { finish = resolve }))
    const f = mount({ client: asClient(client), requestConnection: vi.fn(), open }); await flush()
    await f.state.act(item, 'reveal')
    const waiting = f.state.confirmInPortal(); f.state.cancelProof()
    finish('https://vault.example.test/vault/extension/confirm'); await waiting
    expect(open).not.toHaveBeenCalled(); expect(client.deliver).not.toHaveBeenCalled()
    expect(client.cancelPortalProof).toHaveBeenCalledTimes(2); f.unmount()
  })
  it('keeps Verify available after a transient poll failure and stops polling after manual approval', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      const client = fakeClient(true)
      const f = mount({ client: asClient(client), requestConnection: vi.fn(), open: vi.fn() }); await flush()
      await f.state.act(item, 'reveal'); await f.state.confirmInPortal()
      client.claimPortalProof.mockRejectedValueOnce(new ExtensionError('unavailable'))
      await vi.advanceTimersByTimeAsync(2000)
      expect(f.state.portal).toBe('waiting'); expect(f.state.error).toBe('unavailable')
      await f.state.confirmInPortal()
      client.claimPortalProof.mockResolvedValueOnce({ state: 'approved', proofUntil: Date.now() + 60_000, resume: { item, action: 'reveal' } })
      await f.state.checkPortal()
      const calls = client.claimPortalProof.mock.calls.length
      await vi.advanceTimersByTimeAsync(4000)
      expect(client.claimPortalProof).toHaveBeenCalledTimes(calls)
      expect(f.state.portal).toBe('ready'); expect(client.deliver).not.toHaveBeenCalled(); f.unmount()
    } finally { vi.useRealTimers() }
  })
  it('NA-0195: reveal asks for the code once, shows the value and hides it; copy needs a second gesture', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      const client = fakeClient(true)
      const f = mount({ client: asClient(client), requestConnection: vi.fn(), open: vi.fn() }); await flush()
      expect(f.state.features).toEqual({ reveal: true, copy: true, create: false })
      expect(await f.html()).toContain('vaultnaccess-reveal-3')
      await f.state.act(item, 'reveal')
      expect(client.deliver).not.toHaveBeenCalled(); expect(await f.html()).toContain('vaultnaccess-proof')
      f.state.proofOtp = '123'; await f.state.confirmProof(); expect(client.unlock).not.toHaveBeenCalled()
      f.state.proofOtp = '123456'; await f.state.confirmProof()
      expect(client.unlock).toHaveBeenCalledWith('123456'); expect(client.deliver).toHaveBeenCalledWith(3, 'reveal')
      expect(f.state.revealed?.value).toBe('s3cret'); expect(await f.html()).toContain('s3cret')
      await vi.advanceTimersByTimeAsync(15_000)
      expect(f.state.revealed).toBeNull()
      // A copy prepared but not confirmed also expires.
      await f.state.act(item, 'copy'); expect(await f.html()).toContain('vaultnaccess-copy-confirm')
      await vi.advanceTimersByTimeAsync(15_000); expect(await f.html()).not.toContain('vaultnaccess-copy-confirm')
      await f.state.act(item, 'copy')
      expect(client.unlock).toHaveBeenCalledTimes(1)
      const write = vi.fn().mockResolvedValue(undefined); vi.stubGlobal('navigator', { clipboard: { writeText: write } })
      expect(await f.html()).toContain('vaultnaccess-copy-confirm')
      await f.state.confirmCopy()
      expect(write).toHaveBeenCalledWith('s3cret'); expect(f.state.copiedKey).toBe('secret:3')
      f.unmount()
    } finally { vi.useRealTimers(); vi.unstubAllGlobals() }
  })
  it('NA-0195: a refused item explains itself; an expired proof asks again; features off hide the buttons', async () => {
    const client = fakeClient(true)
    const f = mount({ client: asClient(client), requestConnection: vi.fn(), open: vi.fn() }); await flush()
    await f.state.act(item, 'copy'); f.state.proofOtp = '123456'; await f.state.confirmProof()
    client.deliver.mockRejectedValueOnce(new ExtensionError('itemDenied'))
    await f.state.act(item, 'reveal')
    expect(f.state.error).toBe('itemDenied'); expect(await f.html()).toContain('não está liberado')
    client.deliver.mockRejectedValueOnce(new ExtensionError('proofRequired'))
    await f.state.act(item, 'reveal')
    expect(f.state.pending).toBeTruthy(); f.state.cancelProof(); expect(f.state.pending).toBeNull()
    client.unlock.mockRejectedValueOnce(new ExtensionError('otpInvalid'))
    await f.state.act(item, 'reveal'); f.state.proofOtp = '000000'; await f.state.confirmProof()
    expect(f.state.error).toBe('otpInvalid')
    f.unmount()
    const off = fakeClient(true); off.capabilities.mockResolvedValue({ features: { reveal: false, copy: false, create: false }, serverNow: 0 })
    const g = mount({ client: asClient(off), requestConnection: vi.fn(), open: vi.fn() }); await flush()
    expect(await g.html()).not.toContain('vaultnaccess-reveal-3'); g.unmount()
    const broken = fakeClient(true); broken.capabilities.mockRejectedValue(new Error('x'))
    const b = mount({ client: asClient(broken), requestConnection: vi.fn(), open: vi.fn() }); await flush()
    expect(b.state.features).toEqual({ reveal: false, copy: false, create: false }); b.unmount()
  })
})

function pendingFillFixture() {
  const pending: PendingFillIntent = { reference: 'r'.repeat(24), siteId: 7, version: 2, origin: 'https://site.example', expiresAt: Date.now() + 120_000, action: 'fill' }
  return { pending, port: { get: vi.fn().mockResolvedValue(pending), check: vi.fn().mockResolvedValue({ state: 'ready', pending }), beginProof: vi.fn().mockResolvedValue({ url: 'https://vault.example.test/vault/extension/confirm' }), consume: vi.fn().mockResolvedValue({ ok: true }), cancel: vi.fn().mockResolvedValue(undefined) } }
}
describe('NA-0203 popup fill continuity', () => {
  it('restores ready metadata without delivering and consumes only on the final gesture', async () => {
    const { pending, port } = pendingFillFixture(), client = fakeClient(true)
    const f = mount({ client, pendingFill: port, requestConnection: vi.fn(), open: vi.fn() }); await flush()
    await f.state.restoreSiteContinuity()
    expect(f.state.pendingSiteFill).toEqual(pending); expect(f.state.fillReady).toBe(true)
    expect(port.consume).not.toHaveBeenCalled(); expect(client.deliver).not.toHaveBeenCalled(); expect(client.claimPortalProof).not.toHaveBeenCalled()
    await f.state.confirmSiteFill(); expect(port.consume).toHaveBeenCalledExactlyOnceWith(pending.reference)
    await f.state.confirmSiteFill(); expect(port.consume).toHaveBeenCalledTimes(1); f.unmount()
  })
  it('does not restore expired intents or act on a context invalidated by the worker', async () => {
    const { port } = pendingFillFixture()
    port.get.mockResolvedValue({ ...(await port.get()), expiresAt: Date.now() - 1 })
    const f = mount({ client: fakeClient(true), pendingFill: port, requestConnection: vi.fn(), open: vi.fn() }); await flush()
    await f.state.restoreSiteContinuity(); expect(f.state.pendingSiteFill).toBeNull(); expect(port.check).not.toHaveBeenCalled()
    await f.state.confirmSiteFill(); expect(port.consume).not.toHaveBeenCalled(); f.unmount()
  })
  it('drops a late approval after explicit cancellation', async () => {
    const { pending, port } = pendingFillFixture()
    port.get.mockResolvedValue(null)
    const f = mount({ client: fakeClient(true), pendingFill: port, requestConnection: vi.fn(), open: vi.fn() }); await flush()
    let resolve!: (reply: unknown) => void
    port.check.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    f.state.pendingSiteFill = pending
    const request = f.state.checkSiteFill(); await flush(); await f.state.cancelSiteFill()
    resolve({ state: 'ready', pending }); await request
    expect(f.state.pendingSiteFill).toBeNull(); expect(f.state.fillReady).toBe(false); expect(port.consume).not.toHaveBeenCalled(); f.unmount()
  })
  it('discards late restored draft and fill metadata after logout', async () => {
    const { pending, port } = pendingFillFixture(); port.get.mockResolvedValue(null)
    const drafts = { take: vi.fn().mockResolvedValue(null), stage: vi.fn(), clear: vi.fn().mockResolvedValue(undefined) }
    const f = mount({ client: fakeClient(true), pendingFill: port, capturedDraftPort: drafts, requestConnection: vi.fn(), open: vi.fn() }); await flush()
    let resolve!: (value: unknown) => void
    drafts.take.mockImplementationOnce(() => new Promise(done => { resolve = done })); port.get.mockResolvedValue(pending)
    const request = f.state.restoreSiteContinuity(); await flush(); await f.state.disconnect()
    resolve({ id: 'draft', origin: pending.origin, username: 'u', password: 'private' }); await request
    expect(f.state.capturedDraft).toBeNull(); expect(f.state.pendingSiteFill).toBeNull(); expect(drafts.clear).toHaveBeenCalled(); f.unmount()
  })
  it('requests suggestions without capture unless the user opts in separately', async () => {
    const assist = { enable: vi.fn().mockResolvedValue({ ok: true }), cancel: vi.fn().mockResolvedValue(undefined) }
    const f = mount({ client: fakeClient(true), siteAssist: assist, requestConnection: vi.fn(), open: vi.fn() }); await flush()
    await f.state.enableSiteAssist(); expect(assist.enable).toHaveBeenLastCalledWith({ capture: false })
    f.state.captureOptIn = true; await f.state.enableSiteAssist(); expect(assist.enable).toHaveBeenLastCalledWith({ capture: true }); f.unmount()
  })
  it('stages an editor only in the memory port and requires another Save after approval', async () => {
    const client = fakeClient(true), open = vi.fn(), drafts = { take: vi.fn().mockResolvedValue(null), stage: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined) }
    client.claimPortalProof.mockResolvedValue({ state: 'approved', proofUntil: Date.now() + 60_000 })
    const f = mount({ client, capturedDraftPort: drafts, requestConnection: vi.fn(), open }); await flush()
    const draft = { id: 'draft', origin: 'https://site.example', username: 'u', password: 'private' }
    await f.state.stageEditorProof(draft)
    expect(drafts.stage).toHaveBeenCalledExactlyOnceWith(draft); expect(open).toHaveBeenCalled(); expect(client.write).not.toHaveBeenCalled(); expect(client.deliver).not.toHaveBeenCalled()
    f.state.consumedDraft('different'); expect(drafts.clear).not.toHaveBeenCalled()
    f.state.consumedDraft('draft'); expect(drafts.clear).toHaveBeenCalledTimes(1); f.unmount()
  })
  it('shows preferences only for freshly loaded host IDs and rejects favorites for unknown IDs', async () => {
    const hosts = { load: vi.fn().mockResolvedValue({ favorites: [1, 999], recents: [{ id: 999, at: Date.now() }] }), favorite: vi.fn().mockResolvedValue({ favorites: [1], recents: [] }), used: vi.fn().mockResolvedValue({ favorites: [1], recents: [{ id: 1, at: Date.now() }] }) }
    const client = { ...fakeClient(true), capabilities: vi.fn().mockResolvedValue({ preferenceScope: 's'.repeat(32), features: { sites: true, fill: true }, serverNow: 0 }), siteHosts: vi.fn().mockResolvedValue([]), siteCurrentHosts: vi.fn().mockResolvedValue([{ id: 1, name: 'Allowed host' }]) }
    const f = mount({ client, preferenceFactory: () => hosts, currentSite: () => Promise.resolve('https://site.example'), requestConnection: vi.fn(), open: vi.fn() }); await flush()
    await f.state.loadFeatures(); await f.state.openSites(); await f.state.favoriteHost(999); expect(hosts.favorite).not.toHaveBeenCalled()
    await f.state.favoriteHost(1); expect(hosts.favorite).toHaveBeenCalledWith(1, false)
    expect(f.state.currentHosts).toEqual([{ id: 1, name: 'Allowed host' }]); f.unmount()
  })
})

describe('NA-0203 popup identity cleanup', () => {
  it('drops pending fill and preferences when capabilities are revoked', async () => {
    const client = fakeClient(true), { pending, port } = pendingFillFixture()
    const f = mount({ client, pendingFill: port, requestConnection: vi.fn(), open: vi.fn() }); await flush(); await f.state.restoreSiteContinuity()
    expect(f.state.pendingSiteFill).toEqual(pending)
    f.state.hostPreferenceState = { favorites: [1], recents: [] }
    client.capabilities.mockRejectedValueOnce(new ExtensionError('denied'))
    await f.state.loadFeatures()
    expect(f.state.pendingSiteFill).toBeNull(); expect(f.state.hostPreferenceState.favorites).toEqual([]); expect(f.state.phase).toBe('disconnected'); expect(port.consume).not.toHaveBeenCalled(); f.unmount()
  })
  it('rejects confirmation after the deadline even if readiness was displayed earlier', async () => {
    const { pending, port } = pendingFillFixture()
    const f = mount({ client: fakeClient(true), pendingFill: port, requestConnection: vi.fn(), open: vi.fn() }); await flush(); await f.state.restoreSiteContinuity()
    f.state.pendingSiteFill = { ...pending, expiresAt: Date.now() - 1 }
    await f.state.confirmSiteFill(); expect(port.consume).not.toHaveBeenCalled()
    await f.state.checkSiteFill(); expect(f.state.pendingSiteFill).toBeNull(); expect(port.cancel).toHaveBeenCalled(); f.unmount()
  })
})

describe('NA-0203 Hello recovery and identity boundaries', () => {
  const draft = { id: 'editor-recovery', origin: 'https://site.example', username: 'alice', password: 'memory-only' }
  const draftPort = () => ({ take: vi.fn().mockResolvedValue(null), stage: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined) })

  it('preserves the editor when Hello cannot open and allows an explicit retry without saving', async () => {
    const client = fakeClient(true), drafts = draftPort(), open = vi.fn().mockRejectedValueOnce(new Error('private server detail'))
    const f = mount({ client, capturedDraftPort: drafts, requestConnection: vi.fn(), open }); await flush()
    f.state.capturedDraft = draft
    await f.state.stageEditorProof(draft)
    expect(f.state.capturedDraft).toEqual(draft)
    expect(f.state.siteMessage).toBe(message('pt-BR').errors.unavailable)
    expect(f.state.siteMessage).not.toContain('private server detail')
    expect(client.write).not.toHaveBeenCalled(); expect(client.deliver).not.toHaveBeenCalled()
    client.claimPortalProof.mockResolvedValueOnce({ state: 'approved', proofUntil: Date.now() + 60_000 })
    await f.state.stageEditorProof(draft)
    expect(f.state.editorProofState).toBe('ready'); expect(open).toHaveBeenCalledTimes(2)
    expect(f.state.capturedDraft).toEqual(draft); expect(client.write).not.toHaveBeenCalled(); f.unmount()
  })

  it('cancelling the staged editor discards a late Hello URL and never opens the portal', async () => {
    const client = fakeClient(true), drafts = draftPort(), open = vi.fn()
    const f = mount({ client, capturedDraftPort: drafts, requestConnection: vi.fn(), open }); await flush()
    let finish!: (url: string) => void
    client.requestPortalProof.mockImplementationOnce(() => new Promise(done => { finish = done }))
    const pending = f.state.stageEditorProof(draft); await flush()
    f.state.consumedDraft(draft.id)
    finish('https://vault.example.test/vault/extension/confirm'); await pending
    expect(drafts.clear).toHaveBeenCalledOnce(); expect(open).not.toHaveBeenCalled()
    expect(f.state.editorProofState).toBe('idle'); expect(client.write).not.toHaveBeenCalled(); f.unmount()
  })

  it('ignores Hello approval after disconnect and clears the memory draft', async () => {
    const client = fakeClient(true), drafts = draftPort()
    const f = mount({ client, capturedDraftPort: drafts, requestConnection: vi.fn(), open: vi.fn() }); await flush()
    let finish!: (result: PortalProofResult) => void
    client.claimPortalProof.mockImplementationOnce(() => new Promise(done => { finish = done }))
    const pending = f.state.stageEditorProof(draft); await flush()
    await f.state.disconnect()
    finish({ state: 'approved', proofUntil: Date.now() + 60_000 }); await pending
    expect(f.state.phase).toBe('disconnected'); expect(f.state.editorProofState).toBe('idle')
    expect(drafts.clear).toHaveBeenCalled(); expect(client.write).not.toHaveBeenCalled(); expect(client.deliver).not.toHaveBeenCalled(); f.unmount()
  })

  it('allows verification after an unavailable Hello response, and a cancelled request never saves', async () => {
    const client = fakeClient(true), drafts = draftPort()
    const f = mount({ client, capturedDraftPort: drafts, requestConnection: vi.fn(), open: vi.fn() }); await flush()
    client.claimPortalProof.mockRejectedValueOnce(new Error('upstream unavailable'))
    await f.state.stageEditorProof(draft)
    expect(f.state.editorProofState).toBe('waiting'); expect(f.state.siteMessage).toBe(message('pt-BR').errors.unavailable)
    client.claimPortalProof.mockResolvedValueOnce({ state: 'none' })
    await f.state.checkEditorProof()
    expect(f.state.editorProofState).toBe('idle'); expect(client.write).not.toHaveBeenCalled(); expect(client.deliver).not.toHaveBeenCalled(); f.unmount()
  })

  it('expires a pending editor proof at two minutes without saving or extending the wait', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      const client = fakeClient(true), drafts = draftPort()
      const f = mount({ client, capturedDraftPort: drafts, requestConnection: vi.fn(), open: vi.fn() }); await flush()
      client.claimPortalProof.mockResolvedValue({ state: 'pending' })
      await f.state.stageEditorProof(draft)
      await vi.advanceTimersByTimeAsync(120_000)
      expect(f.state.editorProofState).toBe('idle'); expect(drafts.clear).toHaveBeenCalledOnce()
      const calls = client.claimPortalProof.mock.calls.length
      await vi.advanceTimersByTimeAsync(10_000)
      expect(client.claimPortalProof).toHaveBeenCalledTimes(calls); expect(client.write).not.toHaveBeenCalled(); f.unmount()
    } finally { vi.useRealTimers() }
  })

  it('keeps only the latest authorized host search and drops results after logout', async () => {
    const client = { ...fakeClient(true), siteHosts: vi.fn().mockResolvedValue([]) }
    const f = mount({ client, requestConnection: vi.fn(), open: vi.fn() }); await flush()
    let first!: (hosts: Array<{ id: number; name: string }>) => void
    client.siteHosts.mockImplementationOnce(() => new Promise(done => { first = done }))
    const stale = f.state.searchSiteHosts('old')
    client.siteHosts.mockResolvedValueOnce([{ id: 2, name: 'Current match' }])
    await f.state.searchSiteHosts('current')
    first([{ id: 1, name: 'Old match' }]); await stale
    expect(f.state.siteHosts).toEqual([{ id: 2, name: 'Current match' }])
    let late!: (hosts: Array<{ id: number; name: string }>) => void
    client.siteHosts.mockImplementationOnce(() => new Promise(done => { late = done }))
    const pending = f.state.searchSiteHosts('next'); await f.state.disconnect()
    late([{ id: 3, name: 'Previous identity' }]); await pending
    expect(f.state.siteHosts).toEqual([]); f.unmount()
  })

  it('keeps final confirmation explicit after a transient consume error', async () => {
    const { pending, port } = pendingFillFixture()
    const f = mount({ client: fakeClient(true), pendingFill: port, requestConnection: vi.fn(), open: vi.fn() }); await flush()
    await f.state.restoreSiteContinuity()
    port.consume.mockRejectedValueOnce(new Error('transport failed'))
    await f.state.confirmSiteFill()
    expect(f.state.pendingSiteFill).toEqual(pending); expect(f.state.siteMessage).toBe(message('pt-BR').errors.unavailable)
    expect(port.consume).toHaveBeenCalledOnce()
    await f.state.confirmSiteFill()
    expect(port.consume).toHaveBeenCalledTimes(2); expect(f.state.pendingSiteFill).toBeNull(); f.unmount()
  })
})


describe('NA-0203 site actions, recovery and scoped preferences', () => {
  const settle = async (): Promise<void> => { await flush(); await flush() }
  const origin = 'https://site.example'
  const login: VaultSiteMetadata = { id: 7, version: 2, kind: 'login', label: 'Work login', username: 'alice',
    scope: 'PERSONAL', groupId: null, origins: [origin], url: null, host: null, canManage: true, allowFill: true }
  function sitePopup(language = 'en', extra: Record<string, unknown> = {}) {
    const client = { ...fakeClient(true),
      capabilities: vi.fn().mockResolvedValue({ features: { reveal: false, copy: false, create: true, sites: true, fill: true }, serverNow: Date.now() }),
      sites: { list: vi.fn().mockResolvedValue({ items: [], next: null }), create: vi.fn(), update: vi.fn() },
      siteHosts: vi.fn().mockResolvedValue([]), siteCurrentHosts: vi.fn().mockResolvedValue([]) }
    const requestSiteFill = vi.fn().mockResolvedValue({ ok: true }), open = vi.fn().mockResolvedValue(undefined)
    const f = mount({ client, browserLanguage: language, requestSiteFill, open,
      currentSite: () => Promise.resolve(origin), requestConnection: vi.fn(), ...extra })
    return { ...f, client, requestSiteFill, open }
  }
  it.each(['pt-BR', 'en'])('opens the current site automatically and reports a successful explicit fill (%s)', async language => {
    const f = sitePopup(language); await settle()
    expect(f.state.showSites).toBe(true); expect(f.state.siteOrigin).toBe(origin)
    expect(f.requestSiteFill).not.toHaveBeenCalled()
    expect(await f.html()).toContain('data-site-sections')
    await f.state.fillLogin(login)
    expect(f.requestSiteFill).toHaveBeenCalledExactlyOnceWith(7, 2, origin)
    expect(await f.html()).toContain(language === 'en' ? 'Login filled. Review and sign in.' : 'Login preenchido. Confira e entre no site.')
    expect(f.client.deliver).not.toHaveBeenCalled(); f.unmount()
  })
  it('rejects a foreign origin or disabled pilot and blocks duplicate fills while showing progress', async () => {
    const f = sitePopup(); await settle()
    await f.state.fillLogin({ ...login, origins: ['https://other.example'] })
    expect(f.requestSiteFill).not.toHaveBeenCalled()
    let finish!: (value: { ok: boolean }) => void
    f.requestSiteFill.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = f.state.fillLogin(login)
    expect(await f.html()).toContain('Filling…')
    await f.state.fillLogin(login); expect(f.requestSiteFill).toHaveBeenCalledOnce()
    finish({ ok: true }); await pending
    f.client.capabilities.mockResolvedValueOnce({ features: { sites: true, fill: false }, serverNow: 0 })
    await f.state.loadFeatures(); await f.state.fillLogin(login)
    expect(f.requestSiteFill).toHaveBeenCalledOnce(); f.unmount()
  })
  it.each(['denied', undefined] as const)('explains refused fill without falling back to secret delivery (%s)', async reason => {
    const f = sitePopup(); await settle()
    f.requestSiteFill.mockResolvedValueOnce({ ok: false, ...(reason ? { reason } : {}) })
    await f.state.fillLogin(login)
    expect(f.state.siteMessage).toBe(message('en').errors[reason ?? 'unavailable'])
    expect(f.client.deliver).not.toHaveBeenCalled(); expect(f.state.siteBusy).toBe(false); f.unmount()
  })
  it('routes proof through the pending reference and requires final confirmation after approval', async () => {
    const { pending, port } = pendingFillFixture(); port.get.mockResolvedValue(null)
    const f = sitePopup('en', { pendingFill: port }); await settle()
    port.get.mockResolvedValue(pending)
    f.requestSiteFill.mockResolvedValueOnce({ ok: false, reason: 'proofRequired' })
    await f.state.fillLogin(login)
    expect(f.state.siteNeedsProof).toBe(true); expect(f.state.fillReady).toBe(false)
    expect(await f.html()).toContain('Confirm identity in the portal')
    await f.state.siteProof()
    expect(port.beginProof).toHaveBeenCalledOnce(); expect(f.client.requestPortalProof).not.toHaveBeenCalled()
    expect(f.open).toHaveBeenCalledWith('https://vault.example.test/vault/extension/confirm')
    expect(f.state.fillReady).toBe(true); expect(port.consume).not.toHaveBeenCalled()
    expect(await f.html()).toContain('Confirm filling')
    await f.state.confirmSiteFill()
    expect(port.consume).toHaveBeenCalledExactlyOnceWith(pending.reference)
    expect(f.state.pendingSiteFill).toBeNull(); f.unmount()
  })
  it('supports portal confirmation without a saved reference and reports a cancelled portal request', async () => {
    const f = sitePopup(); await settle()
    await f.state.siteProof(); expect(f.client.requestPortalProof).toHaveBeenCalledOnce(); expect(f.open).toHaveBeenCalledOnce()
    f.client.requestPortalProof.mockRejectedValueOnce(new ExtensionError('cancelled'))
    await f.state.siteProof(); expect(f.state.error).toBe('cancelled'); expect(f.open).toHaveBeenCalledOnce(); f.unmount()
  })
  it('ignores a late fill response and late pending metadata after logout', async () => {
    const { port, pending } = pendingFillFixture(); port.get.mockResolvedValue(null)
    const f = sitePopup('en', { pendingFill: port }); await settle()
    let finish!: (reply: unknown) => void
    f.requestSiteFill.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const first = f.state.fillLogin(login); await f.state.disconnect()
    finish({ ok: true }); await first
    expect(f.state.siteMessage).toBe(''); expect(f.state.pendingSiteFill).toBeNull(); f.unmount()
    const g = sitePopup('en', { pendingFill: port }); await settle()
    let restore!: (value: unknown) => void
    port.get.mockImplementationOnce(() => new Promise(resolve => { restore = resolve }))
    g.requestSiteFill.mockResolvedValueOnce({ ok: false, reason: 'proofRequired' })
    const second = g.state.fillLogin(login); await settle(); await g.state.disconnect()
    restore(pending); await second
    expect(g.state.pendingSiteFill).toBeNull(); expect(g.state.siteNeedsProof).toBe(false); g.unmount()
  })
  it('shows a sanitized fill transport failure and permits a later explicit retry', async () => {
    const f = sitePopup(); await settle()
    f.requestSiteFill.mockRejectedValueOnce(new Error('private transport detail'))
    await f.state.fillLogin(login)
    expect(await f.html()).toContain(message('en').errors.unavailable)
    expect(await f.html()).not.toContain('private transport detail')
    expect(f.state.siteBusy).toBe(false); await f.state.fillLogin(login)
    expect(f.requestSiteFill).toHaveBeenCalledTimes(2); f.unmount()
  })
  it('opens only safe HTTPS website URLs after a gesture', async () => {
    const f = sitePopup(); await settle()
    await f.state.openWebsite('https://site.example/login?source=vault')
    expect(f.open).toHaveBeenCalledExactlyOnceWith('https://site.example/login?source=vault')
    for (const url of ['http://site.example', 'https://user:pass@site.example', 'javascript:alert(1)']) await f.state.openWebsite(url)
    expect(f.open).toHaveBeenCalledOnce(); expect(f.state.siteMessage).toBe(message('en').errors.invalid); f.unmount()
  })
  it.each(['pt-BR', 'en'])('shows assistance opt-in and recovers from refusal or transport failure (%s)', async language => {
    const assist = { enable: vi.fn().mockResolvedValue({ ok: false }), cancel: vi.fn().mockResolvedValue(undefined) }
    const f = sitePopup(language, { siteAssist: assist }); await settle()
    expect(await f.html()).toContain(language === 'en' ? 'Also offer to save the login from this form' : 'Também oferecer salvar o login deste formulário')
    await f.state.enableSiteAssist(); expect(assist.enable).toHaveBeenLastCalledWith({ capture: false })
    expect(f.state.siteMessage).toBe(message(language).errors.unavailable)
    assist.enable.mockRejectedValueOnce(new Error('private failure')); await f.state.enableSiteAssist()
    expect(f.state.siteMessage).toBe(message(language).errors.unavailable)
    assist.enable.mockResolvedValueOnce({ ok: true }); f.state.captureOptIn = true; await f.state.enableSiteAssist()
    expect(assist.enable).toHaveBeenLastCalledWith({ capture: true })
    expect(await f.html()).toContain(language === 'en' ? 'Assistance enabled on this site.' : 'Assistência ativada neste site.')
    await f.state.disconnect(); expect(assist.cancel).toHaveBeenCalled(); expect(f.state.captureOptIn).toBe(false); f.unmount()
  })
  it('does not duplicate assistance activation or apply its response after logout', async () => {
    let finish!: (value: { ok: boolean }) => void
    const assist = { enable: vi.fn(() => new Promise<{ ok: boolean }>(resolve => { finish = resolve })), cancel: vi.fn().mockResolvedValue(undefined) }
    const f = sitePopup('en', { siteAssist: assist }); await settle()
    const pending = f.state.enableSiteAssist(); await f.state.enableSiteAssist()
    expect(assist.enable).toHaveBeenCalledOnce()
    await f.state.disconnect(); finish({ ok: true }); await pending
    expect(f.state.siteMessage).toBe(''); expect(await f.html()).not.toContain('site-assist'); f.unmount()
  })
  it.each(['pt-BR', 'en'])('explains invalidation by the worker without consuming a stale reference (%s)', async language => {
    const { port } = pendingFillFixture()
    const f = sitePopup(language, { pendingFill: port }); await settle()
    port.check.mockResolvedValueOnce({ state: 'none' })
    await f.state.checkSiteFill()
    expect(f.state.pendingSiteFill).toBeNull(); expect(f.state.fillReady).toBe(false)
    expect(f.state.siteMessage).toBe(language === 'en' ? 'The context changed. Choose the login again.' : 'O contexto mudou. Escolha o login novamente.')
    expect(port.consume).not.toHaveBeenCalled(); f.unmount()
  })
  it('keeps the pending reference after a transient check failure and discards it on cancel', async () => {
    const { pending, port } = pendingFillFixture()
    const f = sitePopup('en', { pendingFill: port }); await settle()
    port.check.mockRejectedValueOnce(new Error('private backend failure'))
    await f.state.checkSiteFill()
    expect(f.state.pendingSiteFill).toEqual(pending); expect(f.state.siteMessage).toBe(message('en').errors.unavailable)
    await f.state.cancelSiteFill(); expect(f.state.pendingSiteFill).toBeNull(); expect(f.state.fillReady).toBe(false)
    expect(port.consume).not.toHaveBeenCalled(); f.unmount()
  })
  it('renders pending and ready editor confirmation without saving the draft', async () => {
    const drafts = { take: vi.fn().mockResolvedValue(null), stage: vi.fn().mockResolvedValue(undefined), clear: vi.fn().mockResolvedValue(undefined) }
    const f = sitePopup('en', { capturedDraftPort: drafts }); await settle()
    f.client.claimPortalProof.mockResolvedValueOnce({ state: 'pending' })
    await f.state.stageEditorProof({ id: 'editor', origin, username: 'alice', password: 'synthetic' })
    expect(await f.html()).toContain('Waiting for portal confirmation. Your form was preserved.')
    f.client.claimPortalProof.mockResolvedValueOnce({ state: 'approved', proofUntil: Date.now() + 60_000 })
    await f.state.checkEditorProof()
    expect(await f.html()).toContain('Identity confirmed. Review the form and select Save.')
    expect(f.client.sites.create).not.toHaveBeenCalled(); expect(f.client.sites.update).not.toHaveBeenCalled(); f.unmount()
  })
  it('cancels an outstanding fill before staging the editor, and deduplicates a concurrent Hello request', async () => {
    const { port } = pendingFillFixture()
    let staged!: () => void
    const drafts = { take: vi.fn().mockResolvedValue(null), stage: vi.fn(() => new Promise<void>(resolve => { staged = resolve })), clear: vi.fn().mockResolvedValue(undefined) }
    const f = sitePopup('en', { capturedDraftPort: drafts, pendingFill: port }); await settle()
    const draft = { id: 'editor', origin, username: 'alice', password: 'synthetic' }
    const first = f.state.stageEditorProof(draft); await settle(); await f.state.stageEditorProof(draft)
    expect(port.cancel).toHaveBeenCalled(); expect(f.state.pendingSiteFill).toBeNull(); expect(drafts.stage).toHaveBeenCalledOnce()
    await f.state.disconnect(); staged(); await first
    expect(drafts.clear).toHaveBeenCalled(); expect(f.client.requestPortalProof).not.toHaveBeenCalled(); expect(f.open).not.toHaveBeenCalled(); f.unmount()
  })

  it.each(['pt-BR', 'en'])('orders only visible hosts by favorites and recents and records explicit connection (%s)', async language => {
    const now = Date.now()
    const prefs = { load: vi.fn().mockResolvedValue({ favorites: [3, 999], recents: [{ id: 2, at: now }] }),
      favorite: vi.fn().mockResolvedValue({ favorites: [], recents: [{ id: 2, at: now }] }),
      used: vi.fn().mockResolvedValue({ favorites: [3], recents: [{ id: 1, at: now }, { id: 2, at: now }] }) }
    const factory = vi.fn(() => prefs)
    const f = sitePopup(language, { preferenceFactory: factory })
    f.client.capabilities.mockResolvedValue({ preferenceScope: 'a'.repeat(32), features: { sites: true, fill: true }, serverNow: 0 })
    f.client.siteCurrentHosts.mockResolvedValue([{ id: 1, name: 'Ordinary host' }, { id: 2, name: 'Recent host' }, { id: 3, name: 'Favorite host' }])
    await settle()
    expect(factory.mock.calls.map(call => call)).toEqual([['a'.repeat(32), 'sites'], ['a'.repeat(32), 'hosts']])
    const html = await f.html()
    expect(html.indexOf('Favorite host')).toBeLessThan(html.indexOf('Recent host'))
    expect(html.indexOf('Recent host')).toBeLessThan(html.indexOf('Ordinary host'))
    expect(html).toContain(language === 'en' ? 'Hosts for this site' : 'Hosts deste site')
    expect(html).not.toContain('999'); expect(prefs.used).not.toHaveBeenCalled()
    await f.state.favoriteHost(999); expect(prefs.favorite).not.toHaveBeenCalled()
    await f.state.openHost(1)
    expect(f.open).toHaveBeenCalledWith('https://vault.example.test/hosts?hostId=1&connect=1')
    expect(prefs.used).toHaveBeenCalledExactlyOnceWith(1)
    await f.state.favoriteHost(3); expect(prefs.favorite).toHaveBeenCalledExactlyOnceWith(3, false)
    expect(f.state.currentHosts).toHaveLength(3); f.unmount()
  })
  it('ignores a late favorite result when the preference identity changes and clears it when scope disappears', async () => {
    const prefs = { load: vi.fn().mockResolvedValue({ favorites: [1], recents: [] }), favorite: vi.fn(), used: vi.fn() }
    const f = sitePopup('en', { preferenceFactory: () => prefs })
    f.client.capabilities.mockResolvedValue({ preferenceScope: 'a'.repeat(32), features: { sites: true, fill: true }, serverNow: 0 })
    f.client.siteCurrentHosts.mockResolvedValue([{ id: 1, name: 'Old tenant host' }]); await settle()
    let finish!: (value: unknown) => void
    prefs.favorite.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = f.state.favoriteHost(1)
    prefs.load.mockResolvedValueOnce({ favorites: [2], recents: [] })
    f.client.capabilities.mockResolvedValueOnce({ preferenceScope: 'b'.repeat(32), features: { sites: true, fill: true }, serverNow: 0 })
    await f.state.loadFeatures(); finish({ favorites: [1], recents: [] }); await pending
    expect(f.state.hostPreferenceState.favorites).toEqual([2]); expect(f.state.currentHosts).toEqual([])
    expect(await f.html()).not.toContain('Old tenant host')
    f.client.capabilities.mockResolvedValueOnce({ features: { sites: true, fill: true }, serverNow: 0 })
    await f.state.loadFeatures()
    expect(f.state.hostPreferenceState).toEqual({ favorites: [], recents: [] })
    await f.state.favoriteHost(2); expect(prefs.favorite).toHaveBeenCalledOnce(); f.unmount()
  })
  it('keeps hosts usable when reading or writing preferences fails', async () => {
    const prefs = { load: vi.fn().mockRejectedValue(new Error('private storage detail')), favorite: vi.fn().mockRejectedValue(new Error('private storage detail')), used: vi.fn().mockRejectedValue(new Error('private storage detail')) }
    const f = sitePopup('en', { preferenceFactory: () => prefs })
    f.client.capabilities.mockResolvedValue({ preferenceScope: 'a'.repeat(32), features: { sites: true, fill: true }, serverNow: 0 })
    f.client.siteCurrentHosts.mockResolvedValue([{ id: 1, name: 'Available host' }]); await settle()
    expect(f.state.hostPreferenceState).toEqual({ favorites: [], recents: [] })
    await f.state.favoriteHost(1); await f.state.openHost(1)
    expect(f.open).toHaveBeenCalledOnce(); expect(f.state.currentHosts).toHaveLength(1)
    expect(await f.html()).not.toContain('private storage detail'); f.unmount()
  })
  it('restores an editor with its original deadline and never automatically writes it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      const draft: CapturedSiteDraft = { id: 'restored-editor', origin, username: 'alice', password: 'synthetic', expiresAt: Date.now() + 5000,
        editor: { mode: 'update', siteId: 7, version: 2, kind: 'login', label: 'Work login', origins: [origin], scope: 'PERSONAL', allowFill: true } }
      const drafts = { take: vi.fn().mockResolvedValueOnce(draft).mockResolvedValue(null), stage: vi.fn(), clear: vi.fn().mockResolvedValue(undefined) }
      const f = sitePopup('en', { capturedDraftPort: drafts })
      f.client.claimPortalProof.mockResolvedValue({ state: 'pending' }); await settle()
      expect(f.state.capturedDraft).toEqual(draft); expect(f.state.editorProofState).toBe('waiting')
      f.state.consumedDraft('unrelated'); expect(f.state.capturedDraft).toEqual(draft)
      f.state.consumedDraft(draft.id); expect(f.state.capturedDraft).toBeNull()
      await vi.advanceTimersByTimeAsync(6000)
      expect(f.state.editorProofState).toBe('idle'); expect(drafts.clear).toHaveBeenCalledOnce()
      expect(f.client.sites.update).not.toHaveBeenCalled(); expect(f.client.sites.create).not.toHaveBeenCalled(); f.unmount()
    } finally { vi.useRealTimers() }
  })
  it('shows a captured proposal without starting Hello when no editor restoration is requested', async () => {
    const draft = { id: 'captured-login', origin, username: 'alice', password: 'synthetic' }
    const drafts = { take: vi.fn().mockResolvedValueOnce(draft).mockResolvedValue(null), stage: vi.fn(), clear: vi.fn().mockResolvedValue(undefined) }
    const f = sitePopup('en', { capturedDraftPort: drafts }); await settle()
    expect(f.state.capturedDraft).toEqual(draft); expect(f.state.showSites).toBe(true)
    expect(f.state.editorProofState).toBe('idle'); expect(f.client.requestPortalProof).not.toHaveBeenCalled()
    expect(f.client.sites.create).not.toHaveBeenCalled(); expect(f.client.sites.update).not.toHaveBeenCalled(); f.unmount()
  })
})
