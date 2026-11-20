import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { createRenderer, createSSRApp, defineComponent, h, nextTick, reactive, ssrContextKey, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ExtensionConnectView from '@/views/ExtensionConnectView.vue'
import ExtensionDevices from './ExtensionDevices.vue'
import type { VaultTransport } from '@/services/vault-http'

const EXT = 'abcdefghijklmnopabcdefghijklmnop'
const mocks = vi.hoisted(() => ({ create: vi.fn(), unlock: vi.fn(), prepare: vi.fn(), tick: vi.fn(), lock: vi.fn(), dispose: vi.fn(), authorize: vi.fn(), provider: vi.fn() }))
const state = reactive({ phase: 'locked', value: '', error: null as string | null, copied: false, stepUp: null as string | null, providerPending: false })
const auth = reactive({ isManagingTenant: false, accessToken: 'portal-fixture', refreshToken: 'origin-fixture', user: { id: 41, tenantId: 7, email: 'u@example.test', actingTenantId: undefined as number | undefined } })
const route = reactive({ query: {} })
vi.mock('@/services/vault-delivery', () => ({ createVaultDelivery: mocks.create }))
vi.mock('@/services/vault-provider-confirm', () => ({ openVaultProviderWindow: vi.fn(), requestGoogleIdToken: vi.fn() }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => auth }))
vi.mock('vue-router', () => ({ useRoute: () => route }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key, d: () => 'date' }) }))
vi.mock('naive-ui', () => ({ ...Object.fromEntries(['NAlert', 'NButton', 'NCard', 'NFormItem', 'NInput', 'NSpace', 'NText'].map(name => [name,
  defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => h(name, attrs, slots.default?.()) })])) }))
interface HostNode { parent: HostNode | null; children: HostNode[] }
const node = (): HostNode => ({ parent: null, children: [] })
function mount<S>(component: Component, props: Record<string, unknown> = {}) {
  const renderer = createRenderer<HostNode, HostNode>({ createElement: node, createText: node, createComment: node, setText: () => {}, setElementText: () => {}, patchProp: () => {},
    parentNode: n => n.parent, nextSibling: () => null, insert: (n, p) => { n.parent = p; p.children.push(n) }, remove: n => { if (n.parent) n.parent.children = n.parent.children.filter(c => c !== n) } })
  const app = renderer.createApp({ ...component, render: () => null }, props); app.provide(ssrContextKey, { modules: new Set() })
  const vm = app.mount(node()), setupState = (vm.$ as unknown as { setupState: S }).setupState
  return { state: setupState, unmount: () => app.unmount(), html: () => renderToString(createSSRApp({ ...component, setup: () => setupState })) }
}
const flush = async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); await nextTick() } }
const valid = { extensionId: EXT, redirectUri: `https://${EXT}.chromiumapp.org/`, state: 's'.repeat(32), codeChallenge: 'c'.repeat(43), codeChallengeMethod: 'S256', deviceJkt: 'd'.repeat(43) }
let replaced: string[] = []
beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset()
  Object.assign(state, { phase: 'locked', error: null, stepUp: 'password_totp' })
  route.query = { ...valid }; replaced = []
  mocks.create.mockReturnValue({ state, unlock: mocks.unlock, prepare: mocks.prepare, tick: mocks.tick, lock: mocks.lock, dispose: mocks.dispose, authorizeExtension: mocks.authorize, unlockWithProvider: mocks.provider })
  mocks.unlock.mockImplementation(() => { state.phase = 'unlocked'; return Promise.resolve() })
  mocks.provider.mockImplementation(() => { state.phase = 'unlocked'; return Promise.resolve() })
  mocks.authorize.mockResolvedValue('k'.repeat(43))
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { protocol: 'https:', origin: 'https://vault.example', replace: (url: string) => { replaced.push(url) } } }))
})
afterEach(() => vi.unstubAllGlobals())

interface Connect { request: unknown; password: string; token: string; done: boolean; allow(): Promise<void>; allowWithProvider(): Promise<void>; deny(): void }
describe('NA-0183 extension consent page', () => {
  it('confirms identity, sends the consent once and returns the code only to the extension redirect', async () => {
    const f = mount<Connect>(ExtensionConnectView); await flush()
    expect(mocks.prepare).toHaveBeenCalled()
    expect(await f.html()).toContain(EXT)
    f.state.password = 'pw'; f.state.token = '123456'
    await f.state.allow()
    expect(mocks.unlock).toHaveBeenCalledWith('pw', '123456')
    expect(f.state.password).toBe(''); expect(f.state.token).toBe('')
    expect(mocks.authorize).toHaveBeenCalledWith({ extensionId: EXT, redirectUri: valid.redirectUri, state: valid.state, codeChallenge: valid.codeChallenge, deviceJkt: valid.deviceJkt })
    expect(replaced).toEqual([`${valid.redirectUri}?code=${'k'.repeat(43)}&state=${valid.state}`])
    f.unmount(); expect(mocks.dispose).toHaveBeenCalled()
  })
  it('uses the provider step-up for OIDC/Google sessions', async () => {
    state.stepUp = 'provider'
    const f = mount<Connect>(ExtensionConnectView); await flush()
    await f.state.allowWithProvider()
    expect(mocks.provider).toHaveBeenCalled(); expect(replaced).toHaveLength(1)
    f.unmount()
  })
  it('returns access_denied on deny and stays on the page when the server refuses', async () => {
    const f = mount<Connect>(ExtensionConnectView); await flush()
    mocks.authorize.mockResolvedValueOnce(null)
    f.state.password = 'pw'; f.state.token = '123456'; await f.state.allow()
    expect(replaced).toEqual([])
    f.state.deny()
    expect(mocks.lock).toHaveBeenCalled()
    expect(replaced).toEqual([`${valid.redirectUri}?error=access_denied&state=${valid.state}`])
    f.unmount()
  })
  it('refuses a malformed request without contacting the vault', async () => {
    route.query = { ...valid, redirectUri: 'https://evil.example/' }
    const f = mount<Connect>(ExtensionConnectView); await flush()
    expect(f.state.request).toBeNull(); expect(mocks.prepare).not.toHaveBeenCalled()
    await f.state.allow(); f.state.deny()
    expect(mocks.unlock).not.toHaveBeenCalled(); expect(replaced).toEqual([])
    expect(await f.html()).toContain('vaultExtension.invalidRequest')
    f.unmount()
  })
  it('derives the vault identity only from a secure, non-delegated portal session', async () => {
    const f = mount<Connect>(ExtensionConnectView); await flush()
    const options = (n: number) => mocks.create.mock.calls[n]?.[0] as { identity: () => unknown }
    const identity = options(0).identity
    expect(identity()).toEqual({ userId: 41, tenantId: 7, accessToken: 'portal-fixture', refreshToken: 'origin-fixture', origin: 'https://vault.example' })
    auth.user.actingTenantId = 9; expect(identity()).toBeNull(); auth.user.actingTenantId = undefined
    auth.isManagingTenant = true; expect(identity()).toBeNull(); auth.isManagingTenant = false
    f.unmount()
    vi.stubGlobal('isSecureContext', false)
    const insecure = mount<Connect>(ExtensionConnectView); await flush()
    expect(options(1).identity()).toBeNull()
    expect(await insecure.html()).toContain('vaultDelivery.https')
    insecure.unmount()
  })
  it('renders the refusal, server errors and the returning state', async () => {
    const f = mount<Connect>(ExtensionConnectView); await flush()
    state.error = 'denied'; expect(await f.html()).toContain('vaultExtension.denied')
    state.error = 'unavailable'; expect(await f.html()).toContain('vaultDelivery.errors.unavailable')
    state.error = null; f.state.password = 'pw'; f.state.token = '123456'; await f.state.allow()
    expect(await f.html()).toContain('vaultExtension.returning')
    await f.state.allow(); expect(mocks.unlock).toHaveBeenCalledTimes(2)
    f.unmount()
  })
  it('drives the provider step-up callbacks: redirect, Google target, TOTP prompt and cancel', async () => {
    const { openVaultProviderWindow } = await import('@/services/vault-provider-confirm')
    state.stepUp = 'provider'
    type Steps = { redirect(url: string, signal: AbortSignal): unknown; google(clientId: string, nonce: string, signal: AbortSignal): Promise<string>; totp(signal: AbortSignal): Promise<string> }
    let steps: Steps | undefined
    mocks.provider.mockImplementation((options: Steps) => { steps = options; return Promise.resolve() })
    const f = mount<Connect & { totpPending: boolean; googlePending: boolean; submitTotp(): void; cancelProvider(): void }>(ExtensionConnectView); await flush()
    expect(await f.html()).toContain('vault-extension-provider')
    await f.state.allowWithProvider()
    const abort = new AbortController()
    steps!.redirect('https://idp.example/start', abort.signal)
    expect(openVaultProviderWindow).toHaveBeenCalledWith('https://idp.example/start', abort.signal)
    await expect(steps!.google('client', 'nonce', abort.signal)).rejects.toMatchObject({ reason: 'unavailable' })
    expect(f.state.googlePending).toBe(false)
    const code = steps!.totp(abort.signal)
    expect(f.state.totpPending).toBe(true)
    expect(await f.html()).toContain('vaultDelivery.unlock')
    f.state.token = '654321'; f.state.submitTotp()
    await expect(code).resolves.toBe('654321')
    expect(f.state.token).toBe(''); expect(f.state.totpPending).toBe(false)
    const cancelled = steps!.totp(abort.signal)
    abort.abort()
    await expect(cancelled).rejects.toMatchObject({ reason: 'locked' })
    f.state.submitTotp()
    f.unmount()
  })
})

interface Devices { available: boolean; devices: unknown[]; error: string; revoke(jkt: string): Promise<void>; load(): Promise<void> }
describe('NA-0183 extension devices', () => {
  const device = { jkt: 'd'.repeat(43), extensionId: EXT, state: 'ACTIVE', createdAt: 1, lastUsedAt: null }
  it('lists active devices and revokes one', async () => {
    const post = vi.fn((path: string) => Promise.resolve(path === 'extension/devices' ? { devices: [device, { ...device, jkt: 'e'.repeat(43), state: 'REVOKED' }] } : { state: 'REVOKED' }))
    const f = mount<Devices>(ExtensionDevices, { transport: { post } as unknown as VaultTransport }); await flush()
    expect(f.state.available).toBe(true)
    expect(await f.html()).toContain('vault-extension-revoke-' + device.jkt)
    await f.state.revoke(device.jkt)
    expect(post).toHaveBeenCalledWith('extension/devices/revoke', { jkt: device.jkt }, expect.objectContaining({ userId: 41 }))
    f.unmount()
  })
  it('sends nothing from an insecure page', async () => {
    vi.stubGlobal('isSecureContext', false)
    const post = vi.fn()
    const f = mount<Devices>(ExtensionDevices, { transport: { post } as unknown as VaultTransport }); await flush()
    expect(post).not.toHaveBeenCalled(); expect(f.state.available).toBe(false)
    f.unmount()
  })
  it('stays hidden when the server has the extension disabled, and reports other failures', async () => {
    const { VaultClientError } = await import('@/services/vault-http')
    const post = vi.fn().mockRejectedValueOnce(new VaultClientError('unsupported')).mockRejectedValueOnce(new VaultClientError('unavailable'))
    const f = mount<Devices>(ExtensionDevices, { transport: { post } as unknown as VaultTransport }); await flush()
    expect(f.state.available).toBe(false); expect(f.state.error).toBe('')
    await f.state.load(); expect(f.state.error).toBe('unavailable')
    auth.accessToken = ''; await f.state.load(); expect(post).toHaveBeenCalledTimes(2); auth.accessToken = 'portal-fixture'
    f.unmount()
  })
})
