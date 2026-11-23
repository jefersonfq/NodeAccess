import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, createSSRApp, defineComponent, h, nextTick, reactive, ssrContextKey, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ExtensionInstall from './ExtensionInstall.vue'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))
const auth = reactive({ isAdmin: true })
vi.mock('@/services/api', () => ({ default: { get: mocks.get } }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => auth }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key) }) }))
vi.mock('naive-ui', () => ({ ...Object.fromEntries(['NButton', 'NText'].map(name => [name,
  defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => h(name, attrs, slots.default?.()) })])) }))
interface HostNode { parent: HostNode | null; children: HostNode[] }
const node = (): HostNode => ({ parent: null, children: [] })
function mount<S>(component: Component) {
  const renderer = createRenderer<HostNode, HostNode>({ createElement: node, createText: node, createComment: node, setText: () => {}, setElementText: () => {}, patchProp: () => {},
    parentNode: n => n.parent, nextSibling: () => null, insert: (n, p) => { n.parent = p; p.children.push(n) }, remove: n => { if (n.parent) n.parent.children = n.parent.children.filter(c => c !== n) } })
  const app = renderer.createApp({ ...component, render: () => null }); app.provide(ssrContextKey, { modules: new Set() })
  const vm = app.mount(node()), state = (vm.$ as unknown as { setupState: S }).setupState
  return { state, unmount: () => app.unmount(), html: () => renderToString(createSSRApp({ ...component, setup: () => state })) }
}
const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) { await Promise.resolve(); await nextTick() } }
const ID = 'abcdefghijklmnopabcdefghijklmnop'
const published = { available: true, version: '0.2.0', extensionId: ID, zip: { sha256: 'a'.repeat(64), size: 88_000 },
  zipUrl: '/api/v1/vault-security/extension/package.zip', crxUrl: '/api/v1/vault-security/extension/package.crx', updateUrl: '/api/v1/vault-security/extension/update.xml' }
interface Install { copy(kind: string, value: string): Promise<void>; copied: string; load(): Promise<void> }
beforeEach(() => {
  vi.clearAllMocks(); auth.isAdmin = true
  vi.stubGlobal('window', { location: { origin: 'https://portal.test' }, isSecureContext: true })
})

describe('NA-0194 extension install card', () => {
  it('shows version, id, SHA-256, download and steps; administrators also get the policy value', async () => {
    mocks.get.mockResolvedValue({ data: published })
    const f = mount<Install>(ExtensionInstall); await flush()
    expect(mocks.get).toHaveBeenCalledWith('/vault-security/extension/package')
    const html = await f.html()
    for (const text of ['vault-extension-install', '0.2.0', ID, 'a'.repeat(64), 'vaultExtension.installStep4', 'vault-extension-install-policy', `${ID};https://portal.test/api/v1/vault-security/extension/update.xml`])
      expect(html).toContain(text)
    expect(html).toContain('href="/api/v1/vault-security/extension/package.zip"')
    expect(html).toContain('{&quot;size&quot;:86}')
    const write = vi.fn().mockResolvedValue(undefined); vi.stubGlobal('navigator', { clipboard: { writeText: write } })
    await f.state.copy('sha256', 'a'.repeat(64)); expect(write).toHaveBeenCalledWith('a'.repeat(64)); expect(f.state.copied).toBe('sha256')
    write.mockRejectedValueOnce(new Error('denied')); await f.state.copy('policy', 'x'); expect(f.state.copied).toBe('')
    f.unmount()
  })
  it('hides the policy from non-administrators', async () => {
    auth.isAdmin = false; mocks.get.mockResolvedValue({ data: published })
    const f = mount<Install>(ExtensionInstall); await flush()
    const html = await f.html()
    expect(html).toContain('vault-extension-install'); expect(html).not.toContain('vault-extension-install-policy')
    f.unmount()
  })
  it.each([
    ['nothing published', { available: false }],
    ['a malformed answer', { ...published, extensionId: 'x' }],
    ['a foreign download URL', { ...published, zipUrl: 'https://evil.test/x.zip' }],
  ])('shows nothing with %s', async (_name, data) => {
    mocks.get.mockResolvedValue({ data })
    const f = mount<Install>(ExtensionInstall); await flush()
    expect(await f.html()).not.toContain('vault-extension-install'); f.unmount()
  })
  it('shows nothing when the request fails', async () => {
    mocks.get.mockRejectedValue(new Error('404'))
    const f = mount<Install>(ExtensionInstall); await flush()
    expect(await f.html()).not.toContain('vault-extension-install'); f.unmount()
  })
  it('makes no Vault API request outside HTTPS (HTTP boundary)', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://portal.test' }, isSecureContext: false })
    mocks.get.mockResolvedValue({ data: published })
    const f = mount<Install>(ExtensionInstall); await flush()
    expect(mocks.get).not.toHaveBeenCalled(); expect(await f.html()).not.toContain('vault-extension-install'); f.unmount()
  })
})
