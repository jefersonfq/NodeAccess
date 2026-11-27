import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, createSSRApp, defineComponent, h, nextTick, reactive, ref, ssrContextKey, type Component } from 'vue'
import VaultSites from './VaultSites.vue'
import { renderToString } from 'vue/server-renderer'
import type { SitesClient, SiteWriteAccess } from '../../../../extension/src/core/sites-port'
import type { VaultPortalIdentity } from '@/services/vault-http'
const mocks = vi.hoisted(() => ({ post: vi.fn(), push: vi.fn(), open: vi.fn() }))
const locale = ref('en')
const auth = reactive({ accessToken: 'initial', user: { id: 1, tenantId: 2 }, secure: true })
vi.mock('@/stores/auth', () => ({ useAuthStore: () => auth }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale }) }))
vi.mock('@/services/vault-manager', () => ({ vaultPortalIdentity: (a: typeof auth): VaultPortalIdentity | null => a.secure ? { userId: a.user.id, tenantId: a.user.tenantId, accessToken: a.accessToken, refreshToken: 'refresh', origin: 'https://portal.test' } : null }))
vi.mock('../../../../extension/src/popup/SitePanel.vue', () => ({ default: defineComponent({
  props: ['client', 'hostOptions', 'writeAccess', 'fillEnabled'],
  setup: props => () => h('div', { 'data-testid': 'site-panel-boundary', 'data-fill': String(props.fillEnabled), 'data-groups': JSON.stringify((props.writeAccess as SiteWriteAccess).groups) }, 'Personal CRUD available'),
}) }))
interface Node { parent: Node | null; children: Node[] }
const node = (): Node => ({ parent: null, children: [] })
interface State { client: SitesClient | null; hosts: unknown[]; hostsFailed: boolean; writeAccess: { groups: { id: number; name: string }[]; tenant: boolean }; revision: number; loadHosts(q: string): Promise<void>; connect(id: number): void; open(url: string): void }
function mount() {
  const renderer = createRenderer<Node, Node>({ createElement: node, createText: node, createComment: node, setText: () => {}, setElementText: () => {}, patchProp: () => {}, parentNode: n => n.parent, nextSibling: () => null, insert: (n, p) => { n.parent = p; p.children.push(n) }, remove: () => {} })
  const app = renderer.createApp({ ...(VaultSites as Component), render: () => null }, { transport: { post: mocks.post } })
  app.provide(ssrContextKey, { modules: new Set() })
  const vm = app.mount(node())
  const state = (vm.$ as unknown as { setupState: State }).setupState
  return { state, unmount: () => app.unmount(), html: () => renderToString(createSSRApp({ ...(VaultSites as Component), setup: () => state })) }
}
async function flush() { for (let n = 0; n < 6; n++) { await Promise.resolve(); await nextTick() } }
beforeEach(() => {
  vi.clearAllMocks(); locale.value = 'en'; auth.secure = true; auth.accessToken = 'initial'; auth.user.tenantId = 2
  mocks.post.mockImplementation((path: string) => Promise.resolve(path === 'sites/write-access' ? { groups: [{ id: 9, name: 'Team' }], tenant: true } : path === 'sites/hosts' ? { hosts: [{ id: 7, name: 'Server' }] } : path === 'sites/list' ? { items: [], next: null } : { id: 1, version: 1 }))
  vi.stubGlobal('window', { open: mocks.open })
})
afterEach(() => vi.unstubAllGlobals())
describe('portal sites wrapper', () => {
  it('loads ACL host choices and uses authenticated schema-validated CRUD without unlock', async () => {
    const h = mount(); await flush(); expect(h.state.hosts).toEqual([{ id: 7, name: 'Server' }]); expect(h.state.writeAccess).toEqual({ groups: [{ id: 9, name: 'Team' }], tenant: true })
    await h.state.client!.list({ after: 0, limit: 50 })
    await h.state.client!.create({ kind: 'url', label: 'Docs', url: 'https://example.com', scope: 'PERSONAL' })
    await h.state.client!.update({ id: 1, version: 1, label: 'Updated' })
    expect(mocks.post.mock.calls.map(call => call[0] as unknown)).toEqual(['sites/write-access', 'sites/hosts', 'sites/list', 'sites/create', 'sites/update'])
    expect(mocks.post.mock.calls[3]?.[2]).toMatchObject({ userId: 1, tenantId: 2, accessToken: 'initial' })
    await expect(h.state.client!.create({ kind: 'url', label: 'Bad', url: 'http://example.com', scope: 'PERSONAL' })).rejects.toThrow()
    expect(mocks.post).toHaveBeenCalledTimes(5); h.unmount()
  })
  it('invalidates old clients and in-flight replies on tenant or token changes', async () => {
    const h = mount(); await flush(); const old = h.state.client!; const revision = h.state.revision
    let resolve!: (value: unknown) => void
    mocks.post.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const pending = old.list({ after: 0, limit: 50 })
    const rejected = expect(pending).rejects.toMatchObject({ reason: 'login' })
    auth.user.tenantId = 3; expect(h.state.revision).toBeGreaterThan(revision)
    resolve({ items: [], next: null }); await rejected
    await expect(old.update({ id: 1, version: 1, label: 'Old' })).rejects.toMatchObject({ reason: 'login' })
    const current = h.state.client; auth.accessToken = 'changed'; expect(h.state.client).not.toBe(current)
    h.unmount()
  })
  it('has no client or requests without secure identity and clears access on logout', async () => {
    auth.secure = false; const h = mount(); expect(h.state.client).toBeNull(); expect(mocks.post).not.toHaveBeenCalled()
    auth.secure = true; await flush(); expect(h.state.hosts).toHaveLength(1)
    auth.secure = false; expect(h.state.client).toBeNull(); expect(h.state.hosts).toEqual([]); expect(h.state.writeAccess).toEqual({ groups: [], tenant: false }); h.unmount()
  })
  it('opens only valid HTTPS links after action and navigates to the host connection route', () => {
    const h = mount(); h.state.open('https://example.com/login')
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith('https://example.com/login', '_blank', 'noopener,noreferrer')
    for (const url of ['http://example.com', 'https://user:pass@example.com', 'javascript:alert(1)']) h.state.open(url)
    expect(mocks.open).toHaveBeenCalledOnce()
    h.state.connect(7); expect(mocks.push).toHaveBeenCalledExactlyOnceWith({ path: '/hosts', query: { hostId: '7', connect: '1' } })
    h.state.connect(-1); expect(mocks.push).toHaveBeenCalledOnce(); h.unmount()
  })
  it('searches ACL hosts beyond the first page, ignores stale replies and preserves choices on failure', async () => {
    const h = mount(); await flush()
    let resolve!: (value: unknown) => void
    mocks.post.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const old = h.state.loadHosts('old')
    mocks.post.mockResolvedValueOnce({ hosts: [{ id: 88, name: 'Remote host' }] })
    await h.state.loadHosts('remote')
    expect(mocks.post.mock.calls.at(-1)?.slice(0, 2)).toEqual(['sites/hosts', { q: 'remote' }])
    resolve({ hosts: [{ id: 9, name: 'Stale host' }] }); await old
    expect(h.state.hosts).toEqual([{ id: 88, name: 'Remote host' }])
    mocks.post.mockRejectedValueOnce(new Error('private')); await h.state.loadHosts('failed')
    expect(h.state.hostsFailed).toBe(true); expect(h.state.hosts).toEqual([{ id: 88, name: 'Remote host' }]); h.unmount()
  })
  it('keeps CRUD usable if host choices fail and rejects malformed server metadata', async () => {
    mocks.post.mockRejectedValueOnce(new Error('private')).mockRejectedValueOnce(new Error('private')); const h = mount(); await flush()
    expect(h.state.hostsFailed).toBe(true); expect(h.state.client).not.toBeNull()
    mocks.post.mockResolvedValueOnce({ items: [{ password: 'unexpected' }], next: null })
    await expect(h.state.client!.list({ after: 0, limit: 50 })).rejects.toThrow(); h.unmount()
  })
})


describe('portal sites failure presentation and permission boundaries', () => {
  it.each(['pt-BR', 'en'])('keeps personal CRUD visible with a localized host failure and clears the notice on retry (%s)', async language => {
    locale.value = language
    mocks.post.mockRejectedValueOnce(new Error('hidden access detail')).mockRejectedValueOnce(new Error('hidden host detail'))
    const f = mount(); await flush()
    const html = await f.html()
    expect(html).toContain('role="status"')
    expect(html).toContain(language === 'en' ? 'Hosts unavailable. You can save the site without linking a host.' : 'Hosts indisponíveis. Você pode salvar o site sem vincular um host.')
    expect(html).toContain('Personal CRUD available')
    expect(html).toContain('data-fill="false"')
    expect(html).not.toContain('hidden host detail')
    expect(f.state.writeAccess).toEqual({ groups: [], tenant: false })
    await f.state.client!.create({ kind: 'url', label: 'Docs', url: 'https://example.test', scope: 'PERSONAL' })
    await f.state.loadHosts('  Server  ')
    expect(mocks.post.mock.calls.at(-1)?.slice(0, 2)).toEqual(['sites/hosts', { q: 'Server' }])
    expect(await f.html()).not.toContain('role="status"'); f.unmount()
  })
  it('rejects invalid shared rights and oversized host queries without granting access', async () => {
    mocks.post.mockResolvedValueOnce({ groups: [{ id: -1, name: 'Unauthorized team' }], tenant: true })
    const f = mount(); await flush()
    expect(f.state.writeAccess).toEqual({ groups: [], tenant: false })
    expect(await f.html()).not.toContain('Unauthorized team')
    const calls = mocks.post.mock.calls.length
    await f.state.loadHosts('x'.repeat(201)); expect(mocks.post).toHaveBeenCalledTimes(calls)
    auth.secure = false
    await f.state.loadHosts('Server'); f.state.open('https://example.test'); f.state.connect(7)
    expect(mocks.post).toHaveBeenCalledTimes(calls)
    expect(mocks.open).not.toHaveBeenCalled(); expect(mocks.push).not.toHaveBeenCalled()
    expect(await f.html()).not.toContain('site-panel-boundary'); f.unmount()
  })
  it('does not display late host errors or permit writes after unmount', async () => {
    const f = mount(); await flush(); const client = f.state.client!
    let reject!: (error: Error) => void
    mocks.post.mockImplementationOnce(() => new Promise((_, no) => { reject = no }))
    const pending = f.state.loadHosts('Pending'); const call = mocks.post.mock.calls.at(-1)!
    f.unmount(); expect((call[4] as AbortSignal).aborted).toBe(true)
    reject(new Error('old identity detail')); await pending
    expect(f.state.hostsFailed).toBe(false); expect(f.state.hosts).toEqual([])
    const calls = mocks.post.mock.calls.length
    await expect(client.update({ id: 1, version: 1, label: 'Late edit' })).rejects.toMatchObject({ reason: 'login' })
    expect(mocks.post).toHaveBeenCalledTimes(calls)
  })
})
