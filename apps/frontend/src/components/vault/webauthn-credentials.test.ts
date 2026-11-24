import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, createSSRApp, defineComponent, h, nextTick, reactive, ssrContextKey, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import WebauthnCredentials from './WebauthnCredentials.vue'

// NA-0198 — the Windows Hello window: register and remove only after a fresh confirmation in the window itself.
const auth = reactive({ isManagingTenant: false, accessToken: 'a', refreshToken: 'r', user: { id: 1, tenantId: 7, actingTenantId: undefined as number | undefined } })
vi.mock('@/stores/auth', () => ({ useAuthStore: () => auth }))
vi.mock('@/services/vault-provider-confirm', () => ({ openVaultProviderWindow: vi.fn(), requestGoogleIdToken: vi.fn() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key), d: () => 'date' }) }))
vi.mock('naive-ui', () => ({ ...Object.fromEntries(['NAlert', 'NButton', 'NFormItem', 'NInput', 'NModal', 'NText'].map(name => [name,
  defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => h(name, attrs, slots.default?.()) })])) }))
interface HostNode { parent: HostNode | null; children: HostNode[] }
const node = (): HostNode => ({ parent: null, children: [] })
function mount<S>(component: Component, props: Record<string, unknown>) {
  const renderer = createRenderer<HostNode, HostNode>({ createElement: node, createText: node, createComment: node, setText: () => {}, setElementText: () => {}, patchProp: () => {},
    parentNode: n => n.parent, nextSibling: () => null, insert: (n, p) => { n.parent = p; p.children.push(n) }, remove: n => { if (n.parent) n.parent.children = n.parent.children.filter(c => c !== n) } })
  const app = renderer.createApp({ ...component, render: () => null }, props); app.provide(ssrContextKey, { modules: new Set() })
  const vm = app.mount(node()), setupState = (vm.$ as unknown as { setupState: S }).setupState
  return { state: setupState, unmount: () => app.unmount(), html: () => renderToString(createSSRApp({ ...component, setup: () => setupState }, props)) }
}
const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) { await Promise.resolve(); await nextTick() } }
const state = reactive({ phase: 'locked', error: null as string | null, stepUp: 'password_totp', webauthn: false, providerPending: false })
function fakeDelivery(list: { supported: boolean; credentials: unknown[] } | null = { supported: true, credentials: [{ id: 'c1', name: 'Notebook', createdAt: 1, lastUsedAt: 2 }] }) {
  return { state,
    listWebauthn: vi.fn(() => Promise.resolve(list)), prepare: vi.fn(() => Promise.resolve()),
    unlock: vi.fn(() => { state.phase = 'unlocked'; return Promise.resolve() }),
    unlockWithWebauthn: vi.fn(() => { state.phase = 'unlocked'; return Promise.resolve() }),
    unlockWithProvider: vi.fn(() => { state.phase = 'unlocked'; return Promise.resolve() }),
    registerWebauthn: vi.fn(() => Promise.resolve(true)), removeWebauthn: vi.fn(() => Promise.resolve(true)),
    lock: vi.fn(() => { state.phase = 'locked' }), tick: vi.fn(), dispose: vi.fn() }
}
const ceremony = (available = true) => ({ available: () => available, assertion: vi.fn(), registration: vi.fn() })
interface W { known: boolean; supported: boolean; open: boolean; name: string; password: string; token: string; pending: unknown; done: string
  show(): void; ask(a: { kind: 'register' } | { kind: 'remove'; id: string }): Promise<void>; confirm(): Promise<void>; confirmWithWebauthn(): Promise<void>
  confirmWithProvider(): Promise<void>; cancel(): void }
beforeEach(() => { Object.assign(state, { phase: 'locked', error: null, stepUp: 'password_totp', webauthn: false }) })

describe('NA-0198 Windows Hello window', () => {
  it('stays hidden when the browser cannot run WebAuthn', async () => {
    const d = fakeDelivery(), f = mount<W>(WebauthnCredentials, { delivery: d, ceremony: ceremony(false) }); await flush()
    expect(f.state.known).toBe(false); expect(d.listWebauthn).not.toHaveBeenCalled(); expect(await f.html()).not.toContain('vault-webauthn-open')
    f.unmount()
  })
  it('explains an unsupported origin (IP) instead of offering registration', async () => {
    const d = fakeDelivery({ supported: false, credentials: [] }), f = mount<W>(WebauthnCredentials, { delivery: d, ceremony: ceremony() }); await flush()
    f.state.show(); await flush()
    const html = await f.html()
    expect(html).toContain('vault-webauthn-unsupported'); expect(html).not.toContain('vault-webauthn-register')
    f.unmount()
  })
  it('asks for a fresh confirmation, then registers this device with the given name', async () => {
    const d = fakeDelivery(), f = mount<W>(WebauthnCredentials, { delivery: d, ceremony: ceremony() }); await flush()
    f.state.show(); await flush(); expect(d.prepare).toHaveBeenCalled(); expect(f.state.name).not.toBe('')
    f.state.name = ' Notebook '; await f.state.ask({ kind: 'register' })
    expect(d.registerWebauthn).not.toHaveBeenCalled(); expect(await f.html()).toContain('vault-webauthn-confirm')
    f.state.password = 'pw'; f.state.token = '123456'; await f.state.confirm()
    expect(d.unlock).toHaveBeenCalledWith('pw', '123456'); expect(f.state.password).toBe('')
    expect(d.registerWebauthn).toHaveBeenCalledWith('Notebook'); expect(f.state.done).toBe('registered')
    f.unmount()
  })
  it('removes with Windows Hello as the confirmation, and runs at once while the session is fresh', async () => {
    const d = fakeDelivery(), f = mount<W>(WebauthnCredentials, { delivery: d, ceremony: ceremony() }); await flush()
    expect(await f.html()).toContain('vault-webauthn-open')
    f.state.show(); await f.state.ask({ kind: 'remove', id: 'c1' })
    state.webauthn = true; expect(await f.html()).toContain('vaultDelivery.webauthnUnlock')
    await f.state.confirmWithWebauthn()
    expect(d.removeWebauthn).toHaveBeenCalledWith('c1'); expect(f.state.done).toBe('removed')
    await f.state.ask({ kind: 'remove', id: 'c1' }); expect(d.removeWebauthn).toHaveBeenCalledTimes(2)
    f.unmount()
  })
  it('confirms through the login provider for OIDC/Google accounts, and cancel drops the pending action', async () => {
    state.stepUp = 'provider'
    const d = fakeDelivery(), f = mount<W>(WebauthnCredentials, { delivery: d, ceremony: ceremony() }); await flush()
    f.state.show(); await f.state.ask({ kind: 'remove', id: 'c1' })
    expect(await f.html()).toContain('vault-webauthn-provider')
    f.state.cancel(); expect(f.state.pending).toBeNull()
    await f.state.ask({ kind: 'remove', id: 'c1' }); await f.state.confirmWithProvider()
    expect(d.unlockWithProvider).toHaveBeenCalled(); expect(d.removeWebauthn).toHaveBeenCalledWith('c1')
    f.unmount()
  })
})
