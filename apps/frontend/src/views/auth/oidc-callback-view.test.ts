import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, createSSRApp, defineComponent, h, ssrContextKey, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import OidcCallbackView from './OidcCallbackView.vue'

const mocks = vi.hoisted(() => ({
  query: {}, replace: vi.fn(), oidcComplete: vi.fn(), route: vi.fn(),
  completeLogin: vi.fn(), setPendingMfa: vi.fn(), close: vi.fn(),
}))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: mocks.query }), useRouter: () => ({ replace: mocks.replace }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/services/auth.service', () => ({ authService: { oidcComplete: mocks.oidcComplete } }))
vi.mock('@/services/auth-redirect.service', () => ({ getSafeRedirectTarget: () => '/dashboard' }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ completeLogin: mocks.completeLogin, setPendingMfa: mocks.setPendingMfa }) }))
vi.mock('@/services/vault-provider-confirm', () => ({ routeVaultStepUpReturn: mocks.route }))
vi.mock('naive-ui', () => Object.fromEntries(['NAlert', 'NButton', 'NSpin'].map(name => [name,
  defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => h(name, attrs, slots.default?.()) })])))

interface HostNode { parent: HostNode | null; children: HostNode[] }
const node = (): HostNode => ({ parent: null, children: [] })
interface View { loading: boolean; error: string | null; stepUpDone: boolean }
async function mount(): Promise<{ view: View; html: () => Promise<string> }> {
  const renderer = createRenderer<HostNode, HostNode>({ createElement: node, createText: node, createComment: node, setText: () => {}, setElementText: () => {},
    patchProp: () => {}, parentNode: n => n.parent, nextSibling: () => null,
    insert: (n, p) => { n.parent = p; p.children.push(n) }, remove: n => { if (n.parent) n.parent.children = n.parent.children.filter(c => c !== n) } })
  const app = renderer.createApp({ ...OidcCallbackView as Component, render: () => null })
  app.provide(ssrContextKey, { modules: new Set() })
  const vm = app.mount(node()), view = (vm.$ as unknown as { setupState: View }).setupState
  for (let i = 0; i < 5; i++) await Promise.resolve()
  const html = (): Promise<string> => {
    const ssr = createSSRApp({ ...OidcCallbackView as Component, setup: () => view })
    ssr.config.globalProperties.$t = (key: string) => key
    return renderToString(ssr)
  }
  return { view, html }
}

beforeEach(() => {
  for (const m of [mocks.replace, mocks.oidcComplete, mocks.route, mocks.completeLogin, mocks.setPendingMfa, mocks.close]) m.mockReset()
  mocks.query = { state: 'login-state', code: 'code' }
  mocks.route.mockReturnValue('not-step-up')
  vi.stubGlobal('window', { close: mocks.close })
  vi.stubGlobal('sessionStorage', { getItem: () => null, removeItem: () => {} })
})

describe('OIDC callback page', () => {
  it('forwards a vault step-up return without completing a login and closes the window (NA-0184)', async () => {
    mocks.route.mockReturnValue('forwarded')
    const { view, html } = await mount()
    expect(mocks.oidcComplete).not.toHaveBeenCalled(); expect(mocks.close).toHaveBeenCalled()
    expect(view.stepUpDone).toBe(true); expect(await html()).toContain('vaultDelivery.providerReturnDone')
  })
  it('shows an error for a failed step-up return and never logs in', async () => {
    mocks.route.mockReturnValue('failed')
    const { view } = await mount()
    expect(view.error).toBe('vaultDelivery.providerReturnError'); expect(mocks.oidcComplete).not.toHaveBeenCalled(); expect(mocks.close).not.toHaveBeenCalled()
  })
  it('completes a normal login with tokens', async () => {
    mocks.oidcComplete.mockResolvedValue({ data: { accessToken: 'a', refreshToken: 'r' } })
    await mount()
    expect(mocks.oidcComplete).toHaveBeenCalledWith('login-state', 'code'); expect(mocks.completeLogin).toHaveBeenCalledWith('a', 'r')
    expect(mocks.replace).toHaveBeenCalledWith('/dashboard')
  })
  it('routes a login that still needs MFA', async () => {
    mocks.oidcComplete.mockResolvedValue({ data: { tempToken: 't', requiresMfaSetup: false } })
    await mount()
    expect(mocks.setPendingMfa).toHaveBeenCalledWith('t', false)
    expect(mocks.replace).toHaveBeenCalledWith({ name: 'verify-totp', query: { redirect: '/dashboard' } })
  })
  it('reports provider errors, missing code and backend failures', async () => {
    mocks.query = { state: 'login-state', error: 'access_denied' }
    expect((await mount()).view.error).toBe('auth.login.oidcError')
    mocks.query = { state: 'login-state', code: 'code' }
    mocks.oidcComplete.mockRejectedValue({ response: { data: { message: 'rejected' } } })
    const failed = await mount()
    expect(failed.view.error).toBe('rejected'); expect(await failed.html()).toContain('auth.login.oidcBack')
  })
})
