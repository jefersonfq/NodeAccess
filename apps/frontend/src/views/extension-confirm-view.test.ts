import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, createSSRApp, defineComponent, h, nextTick, reactive, ssrContextKey, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ExtensionConfirmView from './ExtensionConfirmView.vue'
import type { VaultTransport } from '@/services/vault-http'

// NA-0200 — portal page that approves the extension's proof request after a fresh identity confirmation.
const mocks = vi.hoisted(() => ({ create: vi.fn() }))
const route = reactive<{ query: Record<string, unknown> }>({ query: {} })
const auth = reactive({ isManagingTenant: false, accessToken: 'a', refreshToken: 'r', user: { id: 1, tenantId: 7, actingTenantId: undefined as number | undefined } })
vi.mock('vue-router', () => ({ useRoute: () => route }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => auth }))
vi.mock('@/services/vault-delivery', () => ({ createVaultDelivery: mocks.create }))
vi.mock('@/services/vault-provider-confirm', () => ({ openVaultProviderWindow: vi.fn(), requestGoogleIdToken: vi.fn() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('naive-ui', () => ({ ...Object.fromEntries(['NAlert', 'NButton', 'NCard', 'NFormItem', 'NInput', 'NSpace', 'NText'].map(name => [name,
  defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => h(name, attrs, slots.default?.()) })])) }))
interface HostNode { parent: HostNode | null; children: HostNode[] }
const node = (): HostNode => ({ parent: null, children: [] })
function mount<S>(props: Record<string, unknown>) {
  const renderer = createRenderer<HostNode, HostNode>({ createElement: node, createText: node, createComment: node, setText: () => {}, setElementText: () => {}, patchProp: () => {},
    parentNode: n => n.parent, nextSibling: () => null, insert: (n, p) => { n.parent = p; p.children.push(n) }, remove: n => { if (n.parent) n.parent.children = n.parent.children.filter(c => c !== n) } })
  const app = renderer.createApp({ ...(ExtensionConfirmView as Component), render: () => null }, props); app.provide(ssrContextKey, { modules: new Set() })
  const vm = app.mount(node()), setupState = (vm.$ as unknown as { setupState: S }).setupState
  return { state: setupState, unmount: () => app.unmount(), html: () => renderToString(createSSRApp({ ...(ExtensionConfirmView as Component), setup: () => setupState }, props)) }
}
const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) { await Promise.resolve(); await nextTick() } }
const state = reactive({ phase: 'locked', error: null as string | null, stepUp: 'password_totp', webauthn: false, providerPending: false })
const delivery = {
  state, prepare: vi.fn(() => Promise.resolve()), tick: vi.fn(), dispose: vi.fn(),
  unlock: vi.fn(() => { state.phase = 'unlocked'; return Promise.resolve() }),
  unlockWithWebauthn: vi.fn(() => { state.phase = 'unlocked'; return Promise.resolve() }),
  unlockWithProvider: vi.fn(() => { state.phase = 'unlocked'; return Promise.resolve() }),
  approveExtensionProof: vi.fn(() => { state.phase = 'locked'; return Promise.resolve(true) }),
}
const request = 'q'.repeat(43), jkt = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'
interface Page { status: string; device: string; password: string; token: string; confirm(): Promise<void>; confirmWithWebauthn(): Promise<void> }
const transport = (reply: unknown) => {
  const post = vi.fn(() => (reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply)))
  return Object.assign({ post } as unknown as VaultTransport, { calls: post })
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.create.mockReturnValue(delivery); Object.assign(state, { phase: 'locked', error: null, webauthn: false })
  route.query = { request }
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('window', { location: { protocol: 'https:', origin: 'https://localhost:5173' } })
})

describe('NA-0200 extension confirmation page', () => {
  it('shows the requesting device, confirms identity and approves the request once', async () => {
    const t = transport({ device: jkt, expiresAt: 1, serverNow: 0 }), f = mount<Page>({ transport: t }); await flush()
    expect(t.calls).toHaveBeenCalledWith('extension/proof-info', { request }, expect.objectContaining({ userId: 1 }))
    expect(f.state.status).toBe('ready'); expect(await f.html()).toContain('abcd-efgh-ijkl-mnop')
    f.state.password = 'pw'; f.state.token = '123456'; await f.state.confirm()
    expect(delivery.unlock).toHaveBeenCalledWith('pw', '123456'); expect(f.state.password).toBe('')
    expect(delivery.approveExtensionProof).toHaveBeenCalledWith(request); expect(f.state.status).toBe('approved')
    expect(await f.html()).toContain('vault-extension-confirm-done')
    f.unmount()
  })
  it('offers Windows Hello when registered', async () => {
    state.webauthn = true
    const f = mount<Page>({ transport: transport({ device: jkt }) }); await flush()
    expect(await f.html()).toContain('vault-extension-confirm-webauthn')
    await f.state.confirmWithWebauthn(); expect(delivery.unlockWithWebauthn).toHaveBeenCalled(); expect(delivery.approveExtensionProof).toHaveBeenCalledWith(request)
    f.unmount()
  })
  it('confirms through the login provider for OIDC/Google accounts', async () => {
    state.stepUp = 'provider'
    const f = mount<Page & { confirmWithProvider(): Promise<void> }>({ transport: transport({ device: jkt }) }); await flush()
    await f.state.confirmWithProvider()
    expect(delivery.unlockWithProvider).toHaveBeenCalled(); expect(delivery.approveExtensionProof).toHaveBeenCalledWith(request)
    state.stepUp = 'password_totp'; f.unmount()
  })
  it('explains an invalid or expired request, a malformed link and an insecure page', async () => {
    const f = mount<Page>({ transport: transport(new Error('409')) }); await flush()
    expect(f.state.status).toBe('invalid'); expect(await f.html()).toContain('vault-extension-confirm-invalid'); f.unmount()
    route.query = { request: 'short' }
    const g = mount<Page>({ transport: transport({ device: jkt }) }); await flush(); expect(g.state.status).toBe('invalid'); g.unmount()
    vi.stubGlobal('window', { location: { protocol: 'http:', origin: 'http://localhost:5173' } })
    const k = mount<Page>({ transport: transport({ device: jkt }) }); await flush(); expect(k.state.status).toBe('insecure'); k.unmount()
  })
})
