import { describe, expect, it, vi } from 'vitest'
import { createRenderer, createSSRApp, nextTick, ssrContextKey, type Component } from 'vue'
import { renderToString } from '@vue/server-renderer'
import SitePanel from './SitePanel.vue'
import type { CapturedSiteDraft } from '../core/portal-fill-intent'
import type { SitePreferences } from '../core/site-preferences'
import type { VaultSiteMetadata } from '../core/sites-port'

interface Node { parent: Node | null; children: Node[] }
const node = (): Node => ({ parent: null, children: [] })
const item = (extra: Partial<VaultSiteMetadata> = {}): VaultSiteMetadata => ({
  id: 1, version: 2, kind: 'login', label: 'Example', scope: 'PERSONAL', groupId: null,
  username: 'alice', origins: ['https://example.com'], url: null, host: { id: 7, name: 'Server' }, canManage: true, allowFill: true, ...extra,
})
interface State {
  preferenceData: SitePreferences; preferenceFilter: 'all' | 'favorites' | 'recent'; preferenceBusy: boolean; preferenceError: string;
  captureOrigin: string; captureTarget: number | null; captureCandidates: VaultSiteMetadata[]; captureUsernameEdited: boolean;
  generator: { length: number; uppercase: boolean; lowercase: boolean; digits: boolean; symbols: boolean };
  toggleFavorite(item: VaultSiteMetadata): void; useCapture(): void; discardCapture(): void; selectCaptureTarget(): void;
  normalizedOrigins: string[] | null; password: string; label: string; username: string; origins: string; url: string; kind: 'login' | 'url';
  hostSearch: string; chosenHost: { id: number; name: string } | null; scope: string; groupId: number; hostId: number | null; allowFill: boolean; error: string; loadError: string;
  retryPage: boolean; busy: boolean; editing: boolean; items: VaultSiteMetadata[]; visible: VaultSiteMetadata[]; tab: 'current' | 'all'; search: string;
  start(item?: VaultSiteMetadata): void; save(): Promise<void>; cancel(): void; generate(): void;
  load(more?: boolean): Promise<void>; canFill(item: VaultSiteMetadata): boolean; fill(item: VaultSiteMetadata): void;
  connect(item: VaultSiteMetadata): void; open(item: VaultSiteMetadata): void;
}
function mount(extra: Record<string, unknown> = {}) {
  const client = { list: vi.fn().mockResolvedValue({ items: [item()], next: null }), create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) }
  const consumed = vi.fn(), proofRequired = vi.fn(), searchHosts = vi.fn(), fill = vi.fn(), connect = vi.fn(), open = vi.fn(), saved = vi.fn()
  const renderer = createRenderer<Node, Node>({ createElement: node, createText: node, createComment: node,
    setText: () => {}, setElementText: () => {}, patchProp: () => {}, parentNode: n => n.parent, nextSibling: () => null,
    insert: (n, p) => { n.parent = p; p.children.push(n) }, remove: () => {} })
  const props = { client, currentOrigin: 'https://example.com', locale: 'en', onConsumed: consumed, 'onProof-required': proofRequired, 'onSearch-hosts': searchHosts, onFill: fill, onConnect: connect, onOpen: open, onSaved: saved, ...extra }
  const app = renderer.createApp({ ...(SitePanel as Component), render: () => null }, props)
  app.provide(ssrContextKey, { modules: new Set() })
  const vm = app.mount(node())
  const setupState = (vm.$ as unknown as { setupState: State }).setupState
  return { state: setupState, html: () => renderToString(createSSRApp({ ...(SitePanel as Component), setup: () => setupState }, props)), client, fill, connect, open, saved, searchHosts, consumed, proofRequired, props, setProps: (input: Record<string, unknown>) => { Object.assign(vm.$.props, input) }, unmount: () => app.unmount() }
}
describe('reusable site panel', () => {
  it('recomputes an absent captured username when switching A to B or a new login', async () => {
    const h = mount({ capturedDraft: { id: 'change-targets', origin: 'https://example.com', username: '', password: 'new-value' } })
    await nextTick(); h.state.items = [item(), item({ id: 2, username: 'bob' })]
    h.state.captureTarget = 1; h.state.selectCaptureTarget(); expect(h.state.username).toBe('alice')
    h.state.captureTarget = 2; h.state.selectCaptureTarget(); expect(h.state.username).toBe('bob')
    h.state.captureTarget = null; h.state.selectCaptureTarget(); expect(h.state.username).toBe('')
    h.state.captureTarget = 2; h.state.selectCaptureTarget(); await h.state.save()
    expect(h.client.update).toHaveBeenCalledWith(expect.objectContaining({ id: 2, username: 'bob', password: 'new-value' }))
    h.unmount()
  })
  it.each(['chosen-user', ''])('preserves an explicitly edited username %j across target changes', async value => {
    const h = mount({ capturedDraft: { id: 'manual-user', origin: 'https://example.com', username: '', password: 'new-value' } })
    await nextTick(); h.state.items = [item(), item({ id: 2, username: 'bob' })]
    h.state.captureTarget = 1; h.state.selectCaptureTarget()
    h.state.username = value; h.state.captureUsernameEdited = true
    h.state.captureTarget = 2; h.state.selectCaptureTarget(); expect(h.state.username).toBe(value)
    h.state.captureTarget = null; h.state.selectCaptureTarget(); expect(h.state.username).toBe(value)
    h.unmount()
  })
  it('preserves a nonempty captured username across target changes', async () => {
    const h = mount({ capturedDraft: { id: 'captured-user', origin: 'https://example.com', username: 'captured', password: 'new-value' } })
    await nextTick(); h.state.items = [item(), item({ id: 2, username: 'bob' })]
    h.state.captureTarget = 1; h.state.selectCaptureTarget(); h.state.captureTarget = 2; h.state.selectCaptureTarget()
    expect(h.state.username).toBe('captured')
    h.state.captureTarget = null; h.state.selectCaptureTarget(); expect(h.state.username).toBe('captured')
    h.unmount()
  })
  it('preserves an existing username when a password-change capture contains none', async () => {
    const h = mount({ capturedDraft: { id: 'password-change', origin: 'https://example.com', username: '', password: 'new-value' } })
    await nextTick(); h.state.captureTarget = 1; h.state.selectCaptureTarget()
    expect(h.state.username).toBe('alice')
    await h.state.save()
    expect(h.client.update).toHaveBeenCalledWith(expect.objectContaining({ id: 1, version: 2, username: 'alice', password: 'new-value' }))
    h.unmount()
  })
  it('retains the complete editor on proofRequired, stages only in memory and never auto-retries', async () => {
    const h = mount({ writeAccess: { groups: [{ id: 9, name: 'Team' }], tenant: false }, hostOptions: [{ id: 7, name: 'Host' }] })
    h.state.start(); h.state.label = 'Draft'; h.state.password = 'preserved'; h.state.username = 'u'; h.state.scope = 'GROUP'; h.state.groupId = 9; h.state.hostId = 7
    h.client.create.mockRejectedValueOnce(Object.assign(new Error('proofRequired'), { reason: 'proofRequired' }))
    await h.state.save()
    expect(h.state.password).toBe('preserved'); expect(h.state.busy).toBe(false); expect(h.client.create).toHaveBeenCalledOnce()
    expect(h.proofRequired).toHaveBeenCalledOnce()
    const draft = h.proofRequired.mock.calls[0]![0] as CapturedSiteDraft
    expect(draft).toMatchObject({ origin: 'https://example.com', username: 'u', password: 'preserved', editor: { mode: 'create', label: 'Draft', scope: 'GROUP', groupId: 9, hostId: 7 } })
    h.unmount(); expect(h.state.password).toBe('')
    const resumed = mount({ capturedDraft: draft, writeAccess: { groups: [{ id: 9, name: 'Team' }], tenant: false } }); await nextTick()
    expect(resumed.state.password).toBe('preserved'); expect(resumed.state.scope).toBe('GROUP'); expect(resumed.state.hostId).toBe(7)
    expect(resumed.client.create).not.toHaveBeenCalled(); await resumed.state.save()
    expect(resumed.client.create).toHaveBeenCalledWith(expect.objectContaining({ password: 'preserved', scope: 'GROUP', groupId: 9, hostId: 7 })); resumed.unmount()
  })
  it('restores metadata-only update with original version and omitted hidden host, including URL items', async () => {
    for (const kind of ['login', 'url'] as const) {
      const draft: CapturedSiteDraft = { id: `restore-${kind}`, origin: 'https://example.com', username: 'u', password: '',
        editor: { mode: 'update', siteId: 82, version: 7, kind, label: 'Restored', scope: 'PERSONAL', origins: kind === 'login' ? ['https://example.com'] : [], allowFill: false, ...(kind === 'url' ? { url: 'https://example.com/page' } : {}) } }
      const h = mount({ capturedDraft: draft }); await nextTick()
      expect(h.client.update).not.toHaveBeenCalled(); expect(h.state.password).toBe(''); await h.state.save()
      expect(h.client.update).toHaveBeenCalledWith(expect.objectContaining({ id: 82, version: 7, label: 'Restored' }))
      expect(h.client.update.mock.calls[0]![0]).not.toHaveProperty('hostId'); expect(h.client.update.mock.calls[0]![0]).not.toHaveProperty('password')
      expect(h.client.create).not.toHaveBeenCalled(); h.unmount()
    }
  })
  it('expires local captured material at the original deadline and cancels staged drafts explicitly', async () => {
    vi.useFakeTimers()
    const h = mount({ capturedDraft: { id: 'short-lived', origin: 'https://example.com', username: 'u', password: 'p', expiresAt: Date.now() + 1000 } })
    try {
      expect(h.state.password).toBe('p'); await vi.advanceTimersByTimeAsync(1001)
      expect(h.state.password).toBe(''); expect(h.state.username).toBe(''); expect(h.state.editing).toBe(false)
      await h.state.save(); expect(h.client.create).not.toHaveBeenCalled()
      h.state.start(); h.state.label = 'manual'; h.state.password = 'private'
      h.client.create.mockRejectedValueOnce(Object.assign(new Error('proofRequired'), { reason: 'proofRequired' })); await h.state.save()
      const draft = h.proofRequired.mock.calls[0]![0] as CapturedSiteDraft
      h.state.cancel(); expect(h.consumed).toHaveBeenCalledWith(draft.id); expect(h.state.password).toBe('')
    } finally { h.unmount(); vi.useRealTimers() }
  })
  it('renders generator controls, accessible capture choice and ACL-only favorite states', async () => {
    const preferences = { load: vi.fn().mockResolvedValue({ favorites: [1, 999], recents: [] }), favorite: vi.fn(), used: vi.fn() }
    const h = mount({ preferences, hostOptions: [{ id: 7, name: 'Host' }], writeAccess: { groups: [{ id: 9, name: 'Team' }], tenant: true } }); await nextTick(); await nextTick()
    let html = await h.html(); expect(html).toContain('Favorite: Example'); expect(html).not.toContain('999')
    h.state.start(); html = await h.html(); expect(html).toContain('Password options'); expect(html).toContain('min="8"'); expect(html).toContain('max="128"')
    expect(html).toContain('Uppercase'); expect(html).toContain('Symbols')
    h.state.scope = 'GROUP'; h.state.groupId = 9; html = await h.html(); expect(html).toContain('Team')
    h.setProps({ capturedDraft: { id: 'render-capture', origin: 'https://example.com', username: 'u', password: 'p' } }); await nextTick()
    html = await h.html(); expect(html).toContain('Using it discards the current form')
    h.state.useCapture(); html = await h.html(); expect(html).toContain('Captured login. Review'); expect(html).toContain('Save as')
    h.state.captureTarget = 1; h.state.selectCaptureTarget(); html = await h.html(); expect(html).toContain('Leave blank to keep')
    h.state.cancel(); h.state.start(); h.state.kind = 'url'; await nextTick(); html = await h.html(); expect(html).toContain('HTTPS URL'); expect(html).not.toContain('Password options')
    h.unmount()
  })
  it('handles preference read/write failure without losing the catalog or retaining stale writes', async () => {
    const port = { load: vi.fn().mockRejectedValue(new Error('private')), favorite: vi.fn().mockRejectedValue(new Error('private')), used: vi.fn() }
    const h = mount({ preferences: port }); for (let i = 0; i < 5; i++) await nextTick()
    expect(h.state.preferenceError).toBe('Could not save preferences.'); expect(h.state.items).toHaveLength(1)
    h.state.toggleFavorite(item()); h.state.toggleFavorite(item()); for (let i = 0; i < 6; i++) await nextTick()
    expect(port.favorite).toHaveBeenCalledOnce(); expect(h.state.preferenceError).not.toContain('private')
    const html = await h.html(); expect(html).toContain('Could not save preferences.')
    h.unmount()
  })
  it('discards pending captures on expiry without modifying an unrelated active form', async () => {
    vi.useFakeTimers()
    const h = mount()
    try {
      h.state.start(); h.state.password = 'manual'
      h.setProps({ capturedDraft: { id: 'pending-expiry', origin: 'https://example.com', username: 'u', password: 'captured', expiresAt: Date.now() + 50 } }); await nextTick()
      await vi.advanceTimersByTimeAsync(51); expect(h.consumed).toHaveBeenCalledWith('pending-expiry'); expect(h.state.password).toBe('manual')
      h.setProps({ capturedDraft: { id: 'expired', origin: 'https://example.com', username: 'u', password: 'p', expiresAt: Date.now() - 1 } }); await nextTick()
      h.state.useCapture(); expect(h.state.password).toBe('manual')
    } finally { h.unmount(); vi.useRealTimers() }
  })
  it('rejects malformed editor snapshots and never changes an unauthorized choice into an update', async () => {
    for (const draft of [
      { id: '', origin: 'https://example.com', username: 'u', password: 'p' },
      { id: 'missing-value', origin: 'https://example.com', username: 'u', password: '' },
      { id: 'bad-edit', origin: 'https://example.com', username: 'u', password: '', editor: { mode: 'update', kind: 'login', label: 'bad', origins: ['https://example.com'], scope: 'PERSONAL', allowFill: false } },
    ]) { const h = mount({ capturedDraft: draft }); expect(h.state.editing).toBe(false); expect(h.client.create).not.toHaveBeenCalled(); h.unmount() }
    const h = mount({ capturedDraft: { id: 'capture-new', origin: 'https://example.com', username: 'u', password: 'p' } }); await nextTick()
    h.state.captureTarget = 999; h.state.selectCaptureTarget(); expect(h.state.captureTarget).toBeNull()
    h.state.captureTarget = 1; h.state.selectCaptureTarget(); h.state.captureTarget = null; h.state.selectCaptureTarget()
    expect(h.state.scope).toBe('PERSONAL'); expect(h.state.label).toBe('example.com'); await h.state.save()
    expect(h.client.create).toHaveBeenCalledOnce(); h.unmount()
  })
  it('loads bounded preferences but filters and acts only on ACL-loaded metadata', async () => {
    const now = Date.now()
    const preferences = { load: vi.fn().mockResolvedValue({ favorites: [999, 1], recents: [{ id: 999, at: now }, { id: 1, at: now }] }),
      favorite: vi.fn().mockResolvedValue({ favorites: [], recents: [] }), used: vi.fn().mockResolvedValue({ favorites: [1], recents: [{ id: 1, at: now }] }) }
    const h = mount({ preferences }); await nextTick(); await nextTick()
    h.state.preferenceFilter = 'favorites'; expect(h.state.visible.map(row => row.id)).toEqual([1])
    h.state.preferenceFilter = 'recent'; expect(h.state.visible.map(row => row.id)).toEqual([1])
    h.state.toggleFavorite(item({ id: 999 })); expect(preferences.favorite).not.toHaveBeenCalled()
    h.state.toggleFavorite(item()); await nextTick(); await nextTick()
    expect(preferences.favorite).toHaveBeenCalledExactlyOnceWith(1, false)
    h.state.open(item()); for (let i = 0; i < 6; i++) await nextTick()
    expect(preferences.used).toHaveBeenCalledExactlyOnceWith(1)
    expect(JSON.stringify(preferences.used.mock.calls)).not.toContain('Example'); h.unmount()
  })
  it('ignores old preference replies after identity port replacement or unmount', async () => {
    let resolve!: (value: SitePreferences) => void
    const old = { load: vi.fn(() => new Promise<SitePreferences>(r => { resolve = r })), favorite: vi.fn(), used: vi.fn() }
    const h = mount({ preferences: old })
    h.setProps({ preferences: { load: () => Promise.resolve({ favorites: [], recents: [] }), favorite: vi.fn(), used: vi.fn() } })
    await nextTick(); resolve({ favorites: [1], recents: [] }); await nextTick(); await nextTick()
    expect(h.state.preferenceData.favorites).toEqual([]); h.unmount()
  })
  it('transfers captured data once, never autosaves, and offers only manageable exact-origin updates', async () => {
    const draft: CapturedSiteDraft = { id: 'draft-1', origin: 'https://example.com', username: 'captured-user', password: 'captured-value' }
    const h = mount({ capturedDraft: draft }); await nextTick()
    expect(h.consumed).toHaveBeenCalledExactlyOnceWith('draft-1'); expect(h.state.password).toBe('captured-value')
    expect(h.client.create).not.toHaveBeenCalled(); expect(h.client.update).not.toHaveBeenCalled()
    h.state.items = [item(), item({ id: 2, canManage: false }), item({ id: 3, origins: ['https://example.com.evil'] }), item({ id: 4, kind: 'url' })]
    expect(h.state.captureCandidates.map(row => row.id)).toEqual([1])
    h.state.captureTarget = 1; h.state.selectCaptureTarget(); await h.state.save()
    expect(h.client.update).toHaveBeenCalledWith(expect.objectContaining({ id: 1, version: 2, username: 'captured-user', password: 'captured-value' }))
    expect(h.client.create).not.toHaveBeenCalled(); expect(h.state.password).toBe(''); h.unmount()
  })
  it('does not overwrite an active form with capture and discards plaintext on unmount', async () => {
    const h = mount(); h.state.start(); h.state.password = 'existing'; h.state.username = 'typed'
    h.setProps({ capturedDraft: { id: 'draft-2', origin: 'https://example.com', username: 'new', password: 'captured' } }); await nextTick()
    expect(h.state.password).toBe('existing'); expect(h.consumed).not.toHaveBeenCalled()
    h.state.useCapture(); expect(h.state.password).toBe('captured'); expect(h.consumed).toHaveBeenCalledWith('draft-2')
    h.unmount(); expect(h.state.password).toBe(''); expect(h.state.username).toBe(''); expect(h.state.origins).toBe('')
  })
  it('rejects unsafe capture, prevents a stale captured update, and preserves local generator drafts', async () => {
    const h = mount({ capturedDraft: { id: 'invalid', origin: 'http://example.com', username: 'u', password: 'p' } })
    expect(h.consumed).toHaveBeenCalledWith('invalid'); expect(h.state.password).toBe(''); h.unmount()
    const f = mount({ capturedDraft: { id: 'draft-3', origin: 'https://example.com', username: 'u', password: 'p' } }); await nextTick()
    f.state.captureTarget = 1; f.state.selectCaptureTarget(); f.state.items = []; await f.state.save()
    expect(f.client.update).not.toHaveBeenCalled(); expect(f.state.password).toBe('p')
    f.state.generator.length = 4; f.state.generate(); expect(f.state.password).toBe('p')
    f.state.generator.length = 32; f.state.generate(); expect(f.state.password).toHaveLength(32); f.unmount()
  })
  it('keeps fill capability visible while busy without showing a disabled-pilot warning', async () => {
    const h = mount({ fillEnabled: true, fillBusy: true }); await nextTick()
    expect(h.state.canFill(item())).toBe(true); h.state.fill(item()); expect(h.fill).not.toHaveBeenCalled()
    const html = await renderToString(createSSRApp({ ...(SitePanel as Component), setup: () => h.state }, h.props))
    expect(html).toContain('primary-action'); expect(html).toContain('disabled')
    expect(html).not.toContain('Filling is unavailable'); h.unmount()
  })
  it('prefills the current origin, defaults to personal and preserves input on preflight failure', async () => {
    const h = mount(); h.state.start(); expect(h.state.origins).toBe('https://example.com'); expect(h.state.scope).toBe('PERSONAL')
    h.state.password = 'test-value'; await h.state.save()
    expect(h.client.create).not.toHaveBeenCalled(); expect(h.state.password).toBe('test-value')
    h.state.label = 'My login'; h.state.origins = 'http://example.com/path'; await h.state.save()
    expect(h.client.create).not.toHaveBeenCalled(); expect(h.state.password).toBe('test-value')
    h.state.origins = 'https://example.com'; await h.state.save()
    expect(h.client.create).toHaveBeenCalledWith({ kind: 'login', label: 'My login', username: '', password: 'test-value', origins: ['https://example.com'], scope: 'PERSONAL', hostId: null, allowFill: false })
    expect(h.state.password).toBe(''); expect(h.saved).toHaveBeenCalledOnce(); h.unmount()
  })
  it('accepts pasted HTTPS pages, previews normalized websites and sends only strict origins', async () => {
    const h = mount(); h.state.start(); h.state.label = 'Login'; h.state.password = 'test-value'
    h.state.origins = ' https://EXAMPLE.com:443/login?return=home#form \nhttps://example.com/account\nhttps://other.test:8443/signin'
    expect(h.state.normalizedOrigins).toEqual(['https://example.com', 'https://other.test:8443'])
    await h.state.save()
    expect(h.client.create).toHaveBeenCalledWith(expect.objectContaining({ origins: ['https://example.com', 'https://other.test:8443'] }))
    h.state.start(item()); h.state.origins = 'https://example.com/settings?tab=login'; await h.state.save()
    expect(h.client.update).toHaveBeenCalledWith(expect.objectContaining({ origins: ['https://example.com'] })); h.unmount()
  })
  it('never upgrades insecure links or accepts credentials, keeping the draft on invalid websites', async () => {
    const h = mount(); h.state.start(); h.state.label = 'Login'; h.state.password = 'test-value'
    for (const value of ['http://example.com/login', 'https://user:pass@example.com/login', 'https://@example.com/', 'example.com/login', 'javascript:alert(1)']) {
      h.state.origins = value; expect(h.state.normalizedOrigins).toBeNull(); await h.state.save()
      expect(h.client.create).not.toHaveBeenCalled(); expect(h.state.password).toBe('test-value'); expect(h.state.origins).toBe(value)
    }
    h.unmount()
  })
  it('preserves the existing password on edit and never loads it', async () => {
    const h = mount(); h.state.start(item()); expect(h.state.password).toBe(''); await h.state.save()
    expect(h.client.update).toHaveBeenCalledWith({ id: 1, version: 2, label: 'Example', username: 'alice', origins: ['https://example.com'], allowFill: true })
    h.state.start(item({ canManage: false })); expect(h.state.editing).toBe(false); h.unmount()
  })
  it('clears secrets on ambiguous remote failure without retrying or exposing server errors', async () => {
    const h = mount(); h.state.start(); h.state.label = 'Login'; h.state.password = 'test-value'
    h.client.create.mockRejectedValueOnce(new Error('private-response')); await h.state.save()
    expect(h.client.create).toHaveBeenCalledOnce(); expect(h.state.password).toBe(''); expect(h.state.label).toBe('Login')
    expect(h.state.error).toContain('Check the list'); expect(h.state.error).not.toContain('private-response'); h.unmount()
  })
  it('deduplicates writes, prevents cancel while saving and ignores late completion after unmount', async () => {
    const h = mount(); h.state.start(); h.state.label = 'Login'; h.state.password = 'test-value'
    let resolve!: (value: unknown) => void
    h.client.create.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const pending = h.state.save(); await h.state.save(); h.state.cancel()
    expect(h.client.create).toHaveBeenCalledOnce(); expect(h.state.editing).toBe(true)
    h.unmount(); expect(h.state.password).toBe(''); resolve({}); await pending; expect(h.saved).not.toHaveBeenCalled()
  })
  it('supports URL items separately, generates passwords and clears on cancel or kind switch', async () => {
    const h = mount({ passwordGenerator: () => 'generated-test' }); h.state.start(); h.state.generate(); expect(h.state.password).toBe('generated-test')
    h.state.kind = 'url'; await nextTick(); expect(h.state.password).toBe('')
    h.state.label = 'Docs'; h.state.url = 'https://example.com/docs'; await h.state.save()
    expect(h.client.create).toHaveBeenCalledWith({ kind: 'url', label: 'Docs', url: 'https://example.com/docs', scope: 'PERSONAL', hostId: null })
    h.state.start(); h.state.password = 'discard'; h.state.cancel(); expect(h.state.password).toBe(''); h.unmount()
  })
  it('only accepts provided group and host choices', async () => {
    const h = mount({ writeAccess: { groups: [{ id: 9, name: 'Team' }], tenant: false }, hostOptions: [{ id: 7, name: 'Server' }] })
    h.state.start(); h.state.label = 'Login'; h.state.password = 'test-value'; h.state.scope = 'TENANT'; await h.state.save()
    expect(h.client.create).not.toHaveBeenCalled(); h.state.scope = 'GROUP'; h.state.groupId = 8; await h.state.save()
    expect(h.client.create).not.toHaveBeenCalled(); h.state.groupId = 9; h.state.hostId = 99; await h.state.save()
    expect(h.client.create).not.toHaveBeenCalled(); expect(h.state.password).toBe('test-value'); h.state.hostId = 7; await h.state.save()
    expect(h.client.create).toHaveBeenCalledWith(expect.objectContaining({ scope: 'GROUP', groupId: 9, hostId: 7 })); h.unmount()
  })
  it('offers filling only for an enabled exact origin login and emits metadata, never plaintext', () => {
    const off = mount(); off.state.fill(item()); expect(off.fill).not.toHaveBeenCalled(); off.unmount()
    const h = mount({ fillEnabled: true });
    for (const denied of [item({ origins: ['https://example.com.attacker.test'] }), item({ allowFill: false }), item({ kind: 'url', url: 'https://example.com' }), item({ origins: ['https://sub.example.com'] })]) h.state.fill(denied)
    expect(h.fill).not.toHaveBeenCalled(); h.state.fill(item()); expect(h.fill).toHaveBeenCalledExactlyOnceWith(item())
    h.state.connect(item()); expect(h.connect).toHaveBeenCalledExactlyOnceWith(7)
    h.state.connect(item({ host: null })); expect(h.connect).toHaveBeenCalledOnce()
    h.state.open(item()); expect(h.open).toHaveBeenCalledExactlyOnceWith('https://example.com/')
    h.state.open(item({ kind: 'url', url: 'javascript:alert(1)' })); expect(h.open).toHaveBeenCalledOnce(); h.unmount()
  })
  it('preserves hidden host associations unless the host field changes explicitly', async () => {
    const h = mount({ hostOptions: [{ id: 8, name: 'Visible' }] })
    h.state.start(item({ host: null })); await h.state.save()
    expect(h.client.update.mock.calls[0]?.[0]).not.toHaveProperty('hostId')
    h.state.start(item({ host: null })); h.state.hostId = 8; await h.state.save()
    expect(h.client.update).toHaveBeenLastCalledWith(expect.objectContaining({ hostId: 8 }))
    h.state.start(item()); h.state.hostId = null; await h.state.save()
    expect(h.client.update).toHaveBeenLastCalledWith(expect.objectContaining({ hostId: null })); h.unmount()
  })
  it('searches the server beyond the first page, debounces, resets cursor and ignores obsolete pages', async () => {
    vi.useFakeTimers()
    const h = mount()
    try {
      await nextTick()
      h.client.list.mockResolvedValueOnce({ items: [item()], next: 50 })
      await h.state.load()
      let resolve!: (value: unknown) => void
      h.client.list.mockImplementationOnce(() => new Promise(r => { resolve = r }))
      const stalePage = h.state.load(true)
      h.state.search = 'al'; h.state.search = 'alice'
      const calls = h.client.list.mock.calls.length
      resolve({ items: [item({ id: 2 })], next: null }); await stalePage
      expect(h.state.items).toEqual([])
      h.client.list.mockResolvedValueOnce({ items: [item({ id: 72, label: 'Remote result' })], next: 72 })
      await vi.advanceTimersByTimeAsync(249); expect(h.client.list).toHaveBeenCalledTimes(calls)
      await vi.advanceTimersByTimeAsync(1)
      expect(h.client.list).toHaveBeenLastCalledWith({ after: 0, limit: 50, origin: 'https://example.com', q: 'alice' })
      expect(h.state.visible.map(i => i.id)).toEqual([72])
      await h.state.load(true)
      expect(h.client.list).toHaveBeenLastCalledWith({ after: 72, limit: 50, origin: 'https://example.com', q: 'alice' })
      h.state.search = 'pending'; h.unmount(); const endCalls = h.client.list.mock.calls.length
      await vi.advanceTimersByTimeAsync(300); expect(h.client.list).toHaveBeenCalledTimes(endCalls)
    } finally { h.unmount(); vi.useRealTimers() }
  })
  it('filters current-site origins defensively and switches to all sites', async () => {
    const h = mount(); await nextTick()
    h.state.items = [item(), item({ id: 2, origins: ['https://elsewhere.test'] })]
    expect(h.state.visible.map(i => i.id)).toEqual([1]); h.state.tab = 'all'
    expect(h.state.visible).toHaveLength(2); h.unmount()
  })
  it('retries the failed page without losing previously loaded rows or cursor', async () => {
    const h = mount(); await nextTick()
    h.client.list.mockResolvedValueOnce({ items: [item()], next: 50 }); await h.state.load()
    h.client.list.mockResolvedValueOnce({ items: [item({ id: 51 })], next: 100 }); await h.state.load(true)
    h.client.list.mockRejectedValueOnce(new Error('page failed')); await h.state.load(true)
    expect(h.state.items.map(row => row.id)).toEqual([1, 51]); expect(h.state.retryPage).toBe(true)
    h.client.list.mockResolvedValueOnce({ items: [item({ id: 101 })], next: null }); await h.state.load(h.state.retryPage)
    expect(h.client.list).toHaveBeenLastCalledWith({ after: 100, limit: 50, origin: 'https://example.com' })
    expect(h.state.items.map(row => row.id)).toEqual([1, 51, 101]); expect(h.state.retryPage).toBe(false); h.unmount()
  })
  it('handles list failure and ignores stale responses', async () => {
    const h = mount(); await nextTick()
    h.client.list.mockRejectedValueOnce(new Error('private')); await h.state.load(); expect(h.state.loadError).toBe('Could not load sites.')
    let resolve!: (value: unknown) => void
    h.client.list.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const slow = h.state.load(); await h.state.load(); resolve({ items: [item({ id: 99 })], next: null }); await slow
    expect(h.state.items[0]?.id).toBe(1); h.unmount()
  })
  it('debounces host searches and retains the selected host outside the latest choices', async () => {
    vi.useFakeTimers()
    const hostOptions = [{ id: 8, name: 'Chosen host' }]
    const h = mount({ hostOptions })
    try {
      h.state.start(); h.state.hostId = 8
      h.state.hostSearch = 'oth'; h.state.hostSearch = 'other'
      await vi.advanceTimersByTimeAsync(199); expect(h.searchHosts).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1); expect(h.searchHosts).toHaveBeenCalledExactlyOnceWith('other')
      hostOptions.splice(0)
      expect(h.state.chosenHost).toEqual({ id: 8, name: 'Chosen host' })
      h.state.label = 'Login'; h.state.password = 'test-value'; await h.state.save()
      expect(h.client.create).toHaveBeenCalledWith(expect.objectContaining({ hostId: 8 }))
      h.state.start(); h.state.hostSearch = 'pending'; h.state.cancel()
      await vi.advanceTimersByTimeAsync(200); expect(h.searchHosts).toHaveBeenCalledTimes(1)
    } finally { h.unmount(); vi.useRealTimers() }
  })
  it('renders accessible localized controls and explains the disabled pilot once', async () => {
    for (const [locale, add, pilot] of [['en', 'New item', 'Filling is unavailable'], ['pt-BR', 'Novo item', 'Preenchimento indisponível']]) {
      const h = mount({ locale }); const html = await renderToString(createSSRApp(SitePanel, h.props))
      expect(html).toContain(add); expect(html).toContain('type="search"'); expect(html).toContain('aria-pressed="true"')
      expect(html.split(pilot!).length - 1).toBe(1); h.unmount()
    }
  })
})
