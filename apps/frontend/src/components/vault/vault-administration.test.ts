import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, createSSRApp, defineComponent, h, nextTick, reactive, ssrContextKey, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import VaultAdministration from './VaultAdministration.vue'
import type { VaultTransport } from '@/services/vault-http'

const auth = reactive({ isManagingTenant: false, accessToken: 'portal-fixture', refreshToken: 'origin-fixture', user: { id: 1, tenantId: 7, actingTenantId: undefined as number | undefined } })
vi.mock('@/stores/auth', () => ({ useAuthStore: () => auth }))
vi.mock('@/services/vault-provider-confirm', () => ({ openVaultProviderWindow: vi.fn(), requestGoogleIdToken: vi.fn() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key) }) }))
vi.mock('naive-ui', () => ({ ...Object.fromEntries(['NAlert', 'NButton', 'NFormItem', 'NInput', 'NSpace', 'NText'].map(name => [name,
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
const reference = 'a'.repeat(64), other = 'b'.repeat(64)
const overview = {
  serverNow: Date.now(),
  users: [
    { id: 1, name: 'Ana', email: 'ana@example.test', grants: { reveal: true, copy: false, extension: false } },
    { id: 2, name: 'Bruno', email: 'bruno@example.test', grants: { reveal: false, copy: false, extension: true } },
  ],
  proposals: [
    { reference, change: { kind: 'grant' as const, userId: 2, action: 'extension' as const, enabled: false }, proposedBy: { id: 3, name: 'Carla' }, mine: false, expiresAt: Date.now() + 90_000,
      beneficiary: { id: 2, name: 'Bruno', email: 'bruno@example.test' } },
    { reference: other, change: { kind: 'policy' as const, reveal: true, copy: true, tenantQuota: 10 }, proposedBy: { id: 1, name: 'Ana' }, mine: true, expiresAt: Date.now() + 30_000, beneficiary: null },
    { reference: 'c'.repeat(64), change: { kind: 'item' as const, secretId: 4, enabled: true }, proposedBy: { id: 3, name: 'Carla' }, mine: false, expiresAt: Date.now() + 30_000, beneficiary: null },
    { reference: 'd'.repeat(64), change: { kind: 'grant' as const, userId: 1, action: 'copy' as const, enabled: true }, proposedBy: { id: 3, name: 'Carla' }, mine: false, expiresAt: Date.now() + 30_000,
      beneficiary: { id: 1, name: 'Ana', email: 'ana@example.test' } },
  ],
}
const state = reactive({ phase: 'locked', error: null as string | null, stepUp: 'password_totp', value: '', copied: false, providerPending: false })
function fakeDelivery() {
  return {
    state,
    prepare: vi.fn(() => Promise.resolve()),
    unlock: vi.fn(() => { state.phase = 'unlocked'; return Promise.resolve() }),
    unlockWithProvider: vi.fn(() => { state.phase = 'unlocked'; return Promise.resolve() }),
    administrationOverview: vi.fn(() => Promise.resolve(overview)),
    proposeChange: vi.fn(() => Promise.resolve(true)),
    approveProposal: vi.fn(() => { state.phase = 'locked'; return Promise.resolve(true) }),
    lock: vi.fn(() => { state.phase = 'locked' }), tick: vi.fn(), dispose: vi.fn(),
  }
}
interface Admin { manager: boolean; opened: boolean; open(): Promise<void>; password: string; token: string; notice: string; overview: unknown
  confirm(): Promise<void>; confirmWithProvider(): Promise<void>; propose(userId: number, action: string, enabled: boolean): Promise<void>
  approve(reference: string): Promise<void>; lock(): void; load(): Promise<void>; remaining(at: number): number; detect(): Promise<void>
  describe(change: unknown): string }
// The mock is kept apart from the transport object so assertions never detach a method.
const transport = (manager: boolean | Error) => {
  const post = vi.fn(() => (manager instanceof Error ? Promise.reject(manager) : Promise.resolve({ manager })))
  return Object.assign({ post } as VaultTransport, { calls: post })
}
beforeEach(() => {
  Object.assign(state, { phase: 'locked', error: null, stepUp: 'password_totp' })
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { protocol: 'https:', origin: 'https://vault.example' } }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('NA-0183 vault administration screen', () => {
  it('stays hidden for non-managers, on insecure pages and when the server lacks the feature', async () => {
    for (const reply of [false, new Error('404')]) {
      const d = fakeDelivery(), f = mount<Admin>(VaultAdministration, { transport: transport(reply), delivery: d }); await flush()
      expect(f.state.manager).toBe(false); expect(await f.html()).not.toContain('vault-administration'); expect(d.prepare).not.toHaveBeenCalled(); f.unmount()
    }
    vi.stubGlobal('isSecureContext', false)
    const t = transport(true), f = mount<Admin>(VaultAdministration, { transport: t, delivery: fakeDelivery() }); await flush()
    expect(t.calls).not.toHaveBeenCalled(); expect(f.state.manager).toBe(false); f.unmount()
  })
  it('asks a manager to confirm, then lists users, grants and pending proposals', async () => {
    const d = fakeDelivery(), t = transport(true), f = mount<Admin>(VaultAdministration, { transport: t, delivery: d }); await flush()
    expect(t.calls).toHaveBeenCalledWith('administration/status', {}, expect.objectContaining({ userId: 1, origin: 'https://vault.example' }))
    // No vault client is registered until the manager opens the section (shared hourly quota).
    expect(d.prepare).not.toHaveBeenCalled(); expect(await f.html()).toContain('vault-administration-open')
    await f.state.open(); expect(d.prepare).toHaveBeenCalledTimes(1)
    expect(await f.html()).toContain('vaultAdministration.confirmHint')
    f.state.password = 'pw'; f.state.token = '123456'; await f.state.confirm()
    expect(d.unlock).toHaveBeenCalledWith('pw', '123456'); expect(f.state.password).toBe(''); expect(f.state.token).toBe('')
    const html = await f.html()
    expect(html).toContain('vault-administration-user-2'); expect(html).toContain('vault-administration-propose-2-extension')
    expect(html).not.toContain('vault-administration-propose-1-')
    expect(html).toContain(`vault-administration-approve-${reference}`); expect(html).not.toContain(`vault-administration-approve-${other}`)
    // Policy/item proposals are listed but never approved blind from this screen.
    expect(html).not.toContain(`vault-administration-approve-${'c'.repeat(64)}`)
    expect(html).toContain('vaultAdministration.yours'); expect(html).toContain('vaultAdministration.proposalOther')
    // The two-manager rule is spelled out, and a manager who receives the permission is told someone else must approve.
    for (const step of ['intro', 'step1', 'step2', 'step3']) expect(html).toContain(`vaultAdministration.${step}`)
    expect(html).toContain(`vault-administration-beneficiary-${'d'.repeat(64)}`); expect(html).not.toContain(`vault-administration-approve-${'d'.repeat(64)}`)
    expect(html).not.toContain(`vault-administration-beneficiary-${reference}`)
    expect(f.state.describe(overview.proposals[0])).toContain('"user":"Bruno <bruno@example.test>"')
    expect(f.state.describe({ ...overview.proposals[1], change: { kind: 'grant', userId: 2, action: 'copy', enabled: true } })).toContain('"user":"Bruno"')
    expect(f.state.describe({ ...overview.proposals[1], change: { kind: 'grant', userId: 9, action: 'copy', enabled: true } })).toContain('vaultAdministration.unknownUser')
    f.unmount()
  })
  it('proposes a change, refuses a self-change and approves another manager’s proposal', async () => {
    const d = fakeDelivery(), f = mount<Admin>(VaultAdministration, { transport: transport(true), delivery: d }); await flush(); await f.state.open()
    f.state.password = 'pw'; f.state.token = '123456'; await f.state.confirm()
    await f.state.propose(1, 'copy', true); expect(d.proposeChange).not.toHaveBeenCalled()
    await f.state.propose(2, 'extension', false)
    expect(d.proposeChange).toHaveBeenCalledWith({ kind: 'grant', userId: 2, action: 'extension', enabled: false })
    expect(f.state.notice).toBe('proposed'); expect(d.administrationOverview).toHaveBeenCalledTimes(2)
    await f.state.approve(reference)
    expect(d.approveProposal).toHaveBeenCalledWith(reference); expect(f.state.notice).toBe('applied'); expect(f.state.overview).toBeNull()
    expect(await f.html()).toContain('vaultAdministration.applied')
    f.unmount()
  })
  it('uses the provider confirmation for OIDC/Google managers, locks on request and counts down with server time', async () => {
    state.stepUp = 'provider'
    const d = fakeDelivery(), f = mount<Admin>(VaultAdministration, { transport: transport(true), delivery: d }); await flush(); await f.state.open()
    expect(await f.html()).toContain('vault-administration-provider')
    await f.state.confirmWithProvider()
    expect(d.unlockWithProvider).toHaveBeenCalled(); expect(f.state.overview).toEqual(overview)
    expect(f.state.remaining(Date.now() + 30_500)).toBeGreaterThanOrEqual(30)
    expect(f.state.remaining(0)).toBe(0)
    f.state.lock(); expect(d.lock).toHaveBeenCalled(); expect(f.state.overview).toBeNull()
    f.unmount(); expect(d.dispose).not.toHaveBeenCalled()
  })
  it('keeps the list closed when the confirmation fails and drops it when the session locks', async () => {
    vi.useFakeTimers()
    const d = fakeDelivery(); d.unlock.mockImplementation(() => { state.phase = 'locked'; state.error = 'denied'; return Promise.resolve() })
    const f = mount<Admin>(VaultAdministration, { transport: transport(true), delivery: d }); await flush(); await f.state.open()
    f.state.password = 'pw'; f.state.token = '123456'; await f.state.confirm()
    expect(d.administrationOverview).not.toHaveBeenCalled()
    expect(await f.html()).toContain('vaultDelivery.errors.denied')
    d.unlock.mockImplementation(() => { state.phase = 'unlocked'; state.error = null; return Promise.resolve() })
    await f.state.confirm(); expect(f.state.overview).toEqual(overview)
    state.phase = 'locked'; vi.advanceTimersByTime(1000)
    expect(d.tick).toHaveBeenCalled(); expect(f.state.overview).toBeNull()
    f.unmount()
  })
})
