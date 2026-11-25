import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, createSSRApp, defineComponent, h, nextTick, reactive, ssrContextKey, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import VaultAdministration from './VaultAdministration.vue'
import type { VaultTransport } from '@/services/vault-http'
import type { VaultAdministrationOverview } from '@nodeaccess/shared'

const auth = reactive({ isAdmin: true, isManagingTenant: false, accessToken: 'portal-fixture', refreshToken: 'origin-fixture', user: { id: 1, tenantId: 7, actingTenantId: undefined as number | undefined } })
vi.mock('@/stores/auth', () => ({ useAuthStore: () => auth }))
vi.mock('vue-router', () => ({ RouterLink: defineComponent({ inheritAttrs: false, setup: (_, { slots }) => () => h('a', { 'data-router-link': '' }, slots.default?.()) }) }))
vi.mock('@/services/vault-provider-confirm', () => ({ openVaultProviderWindow: vi.fn(), requestGoogleIdToken: vi.fn() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale: 'pt', t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key) }) }))
vi.mock('naive-ui', () => ({ ...Object.fromEntries(['NAlert', 'NButton', 'NCheckbox', 'NFormItem', 'NInput', 'NInputNumber', 'NSelect', 'NSpace', 'NText'].map(name => [name,
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
const overview: VaultAdministrationOverview = {
  serverNow: Date.now(),
  policy: { confirmationSeconds: 60, proposalSeconds: 120, reveal: false, copy: false, tenantQuota: 30 },
  items: [{ id: 7, alias: 'db-prod' }],
  users: [
    { id: 1, name: 'Ana', email: 'ana@example.test', manager: true, grants: { reveal: true, copy: false, extension: false, 'shared-write': false, fill: false } },
    { id: 2, name: 'Bruno', email: 'bruno@example.test', manager: false, grants: { reveal: false, copy: false, extension: true, 'shared-write': false, fill: false } },
    { id: 3, name: 'Carla', email: 'carla@example.test', manager: true, grants: { reveal: false, copy: false, extension: false, 'shared-write': false, fill: false } },
  ],
  proposals: [
    { reference, change: { kind: 'grant' as const, userId: 2, action: 'extension' as const, enabled: false }, proposedBy: { id: 3, name: 'Carla' }, mine: false, expiresAt: Date.now() + 90_000,
      beneficiary: { id: 2, name: 'Bruno', email: 'bruno@example.test' }, item: null },
    { reference: other, change: { kind: 'policy' as const, reveal: true, copy: true, tenantQuota: 10 }, proposedBy: { id: 1, name: 'Ana' }, mine: true, expiresAt: Date.now() + 30_000, beneficiary: null, item: null },
    { reference: 'c'.repeat(64), change: { kind: 'item' as const, secretId: 4, enabled: true }, proposedBy: { id: 3, name: 'Carla' }, mine: false, expiresAt: Date.now() + 30_000, beneficiary: null,
      item: { id: 4, alias: 'web-root' } },
    { reference: 'd'.repeat(64), change: { kind: 'grant' as const, userId: 1, action: 'copy' as const, enabled: true }, proposedBy: { id: 3, name: 'Carla' }, mine: false, expiresAt: Date.now() + 30_000,
      beneficiary: { id: 1, name: 'Ana', email: 'ana@example.test' }, item: null },
  ],
}
const state = reactive({ phase: 'locked', error: null as string | null, stepUp: 'password_totp', value: '', copied: false, providerPending: false, webauthn: false })
function fakeDelivery() {
  return {
    state,
    prepare: vi.fn(() => Promise.resolve()),
    unlock: vi.fn(() => { state.phase = 'unlocked'; return Promise.resolve() }),
    unlockWithProvider: vi.fn(() => { state.phase = 'unlocked'; return Promise.resolve() }),
    unlockWithWebauthn: vi.fn(() => { state.phase = 'unlocked'; return Promise.resolve() }),
    administrationOverview: vi.fn(() => Promise.resolve(overview)),
    diagnosticsContext: vi.fn(() => state.phase === 'unlocked' ? { clientId: 'c'.repeat(43), sessionId: 's'.repeat(43),
      identity: { userId: auth.user.id, tenantId: auth.user.tenantId, accessToken: auth.accessToken,
        refreshToken: auth.refreshToken, origin: 'https://vault.example' } } : null),
    proposeChange: vi.fn(() => Promise.resolve(true)),
    approveProposal: vi.fn(() => { state.phase = 'locked'; return Promise.resolve(true) }),
    lock: vi.fn(() => { state.phase = 'locked' }), tick: vi.fn(), dispose: vi.fn(),
  }
}
interface Admin { diagnosticContext: { identity: { tenantId: number }; clientId: string; sessionId: string } | null; refreshDiagnosticContext(): void; manager: boolean; opened: boolean; open(): Promise<void>; password: string; token: string; notice: string; overview: unknown
  confirm(): Promise<void>; confirmWithProvider(): Promise<void>; propose(userId: number, action: string, enabled: boolean): Promise<void>
  approve(reference: string): Promise<void>; lock(): void; load(): Promise<void>; remaining(at: number): string; detect(): Promise<void>
  describe(change: unknown): string; minutes: number | null; proposeConfirmation(): Promise<void>
  proposeManager(userId: number, enabled: boolean): Promise<void>; proposeWindow(): Promise<void>; windowSeconds: number | null
  canPropose(target?: number): boolean; pendingCount: number }
// The mock is kept apart from the transport object so assertions never detach a method.
const transport = (manager: boolean | Error) => {
  const post = vi.fn(() => (manager instanceof Error ? Promise.reject(manager) : Promise.resolve({ manager, pending: 0, managers: manager ? [1, 3] : [] })))
  return Object.assign({ post } as VaultTransport, { calls: post })
}
beforeEach(() => {
  auth.isAdmin = true
  auth.user.tenantId = 7
  Object.assign(state, { phase: 'locked', error: null, stepUp: 'password_totp', webauthn: false })
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { protocol: 'https:', origin: 'https://vault.example' } }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('NA-0183 vault administration screen', () => {
  it('stays hidden for non-managers, on insecure pages and when the server lacks the feature', async () => {
    for (const reply of [false, new Error('404')]) {
      const d = fakeDelivery(), f = mount<Admin>(VaultAdministration, { transport: transport(reply), delivery: d }); await flush()
      expect(f.state.manager).toBe(false); expect(await f.html()).not.toContain('data-testid="vault-administration"'); expect(d.prepare).not.toHaveBeenCalled(); f.unmount()
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
    expect(html).toContain('vault-administration-user-2'); expect(html).toContain('vault-administration-propose-2-reveal')
    // NA-0196: the same change already waiting replaces the button (no duplicate proposals).
    expect(html).not.toContain('vault-administration-propose-2-extension'); expect(html).toContain('vault-administration-waiting-2-extension')
    expect(html).not.toContain('vault-administration-propose-1-')
    expect(html).toContain(`vault-administration-approve-${reference}`); expect(html).not.toContain(`vault-administration-approve-${other}`)
    // NA-0196: item and policy proposals are approved here, with their content on screen.
    expect(html).toContain(`vault-administration-approve-${'c'.repeat(64)}`)
    expect(html).toContain('vaultAdministration.yours'); expect(html).toContain('vaultAdministration.proposalPolicy')
    expect(f.state.describe(overview.proposals[2])).toBe('vaultAdministration.proposalItemRelease:{"item":"web-root"}')
    // NA-0199: an administrator finds the tenant settings in /admin/settings; the vault page links there.
    expect(html).not.toContain('vault-administration-policy'); expect(html).toContain('vault-administration-settings-link'); expect(html).toContain('vault-administration-released-7')
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
    await f.state.propose(2, 'extension', false); expect(d.proposeChange).not.toHaveBeenCalled()
    await f.state.propose(2, 'copy', true)
    expect(d.proposeChange).toHaveBeenCalledWith({ kind: 'grant', userId: 2, action: 'copy', enabled: true })
    expect(f.state.notice).toBe('proposed'); expect(d.administrationOverview).toHaveBeenCalledTimes(2)
    await f.state.approve(reference)
    expect(d.approveProposal).toHaveBeenCalledWith(reference); expect(f.state.notice).toBe('applied'); expect(f.state.overview).toBeNull()
    expect(await f.html()).toContain('vaultAdministration.applied')
    f.unmount()
  })
  it('uses the provider confirmation for OIDC/Google managers, locks on request and counts down with server time', async () => {
    vi.useFakeTimers()
    // Expiry belongs to the server clock; deliberately keep the client one minute ahead.
    vi.setSystemTime(overview.serverNow + 60_000)
    const expiresAt = overview.serverNow + 30_500
    state.stepUp = 'provider'
    const d = fakeDelivery(), f = mount<Admin>(VaultAdministration, { transport: transport(true), delivery: d })
    try {
      await flush(); await f.state.open()
      expect(await f.html()).toContain('vault-administration-provider')
      await f.state.confirmWithProvider()
      expect(d.unlockWithProvider).toHaveBeenCalled(); expect(f.state.overview).toEqual(overview)
      expect(f.state.remaining(expiresAt)).toBe('31 vaultAdministration.unitSeconds')
      vi.advanceTimersByTime(1000)
      expect(f.state.remaining(expiresAt)).toBe('30 vaultAdministration.unitSeconds')
      expect(f.state.remaining(0)).toBe('0 vaultAdministration.unitSeconds')
      f.state.lock(); expect(d.lock).toHaveBeenCalled(); expect(f.state.overview).toBeNull()
    } finally { f.unmount(); vi.useRealTimers() }
    expect(d.dispose).not.toHaveBeenCalled()
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

interface Delivery { proposePolicy(): Promise<void>; proposeItem(id: number, enabled: boolean): Promise<void>; policyReveal: boolean; policyCopy: boolean
  policyQuota: number | null; policyChanged: boolean; itemReleased: boolean; proposals: Array<{ reference: string }> }
describe('NA-0196 tenant delivery policy and released items', () => {
  it('proposes the tenant policy only when it changes, and releases or withdraws items', async () => {
    const d = fakeDelivery(), f = mount<Admin & Delivery>(VaultAdministration, { transport: transport(true), delivery: d }); await flush()
    await f.state.open(); f.state.password = 'pw'; f.state.token = '123456'; await f.state.confirm()
    expect(f.state.policyChanged).toBe(false)
    await f.state.proposePolicy(); expect(d.proposeChange).not.toHaveBeenCalled()
    f.state.policyReveal = true; f.state.policyQuota = 40
    await f.state.proposePolicy()
    expect(d.proposeChange).toHaveBeenLastCalledWith({ kind: 'policy', reveal: true, copy: false, tenantQuota: 40 })
    await f.state.proposeItem(7, false)
    expect(d.proposeChange).toHaveBeenLastCalledWith({ kind: 'item', secretId: 7, enabled: false })
    f.unmount()
  })
  it('focused on one item: shows its state, proposes the release and lists only its proposals', async () => {
    const d = fakeDelivery(), f = mount<Admin & Delivery>(VaultAdministration, { transport: transport(true), delivery: d, item: { id: 4, name: 'web-root' } }); await flush()
    expect(d.prepare).toHaveBeenCalledTimes(1)
    f.state.password = 'pw'; f.state.token = '123456'; await f.state.confirm()
    const html = await f.html()
    expect(html).toContain('vault-administration-item'); expect(html).toContain('vaultAdministration.itemNotReleased')
    expect(html).not.toContain('vault-administration-user-2'); expect(html).not.toContain('vault-administration-policy')
    expect(f.state.proposals.map(p => p.reference)).toEqual(['c'.repeat(64)])
    // Its release is already waiting: no second proposal, the window says so.
    expect(html).toContain('vault-administration-item-waiting'); expect(html).not.toContain('vault-administration-item-propose')
    await f.state.proposeItem(4, true); expect(d.proposeChange).not.toHaveBeenCalled()
    await f.state.proposeItem(4, false)
    expect(d.proposeChange).toHaveBeenLastCalledWith({ kind: 'item', secretId: 4, enabled: false })
    f.unmount()
  })
  it('tells the page after an approval so it refreshes what users may reveal or copy', async () => {
    const d = fakeDelivery(), changed = vi.fn()
    const f = mount<Admin>(VaultAdministration, { transport: transport(true), delivery: d, onChanged: changed }); await flush()
    await f.state.open(); f.state.password = 'pw'; f.state.token = '123456'; await f.state.confirm()
    await f.state.approve('c'.repeat(64)); expect(changed).toHaveBeenCalledTimes(1)
    f.unmount()
  })
})

describe('NA-0198 Windows Hello in the managers confirmation', () => {
  it('offers Windows Hello when registered and loads the overview after it', async () => {
    const d = fakeDelivery(), f = mount<Admin & { confirmWithWebauthn(): Promise<void> }>(VaultAdministration, { transport: transport(true), delivery: d }); await flush()
    await f.state.open(); expect(await f.html()).not.toContain('vault-administration-webauthn')
    state.webauthn = true; expect(await f.html()).toContain('vault-administration-webauthn')
    await f.state.confirmWithWebauthn()
    expect(d.unlockWithWebauthn).toHaveBeenCalledTimes(1); expect(d.administrationOverview).toHaveBeenCalled()
    f.unmount()
  })
})

describe('NA-0199 tenant settings mode (/admin/settings)', () => {
  it('shows only the tenant settings and their proposals, without the users table or items', async () => {
    const d = fakeDelivery(), f = mount<Admin & { proposals: Array<{ reference: string }> }>(VaultAdministration, { transport: transport(true), delivery: d, settings: true }); await flush()
    await f.state.open(); f.state.password = 'pw'; f.state.token = '123456'; await f.state.confirm()
    const html = await f.html()
    for (const id of ['vault-administration-policy', 'vault-administration-confirmation', 'vault-administration-window']) expect(html).toContain(id)
    for (const id of ['vault-administration-user-2', 'vault-administration-items', 'vault-administration-settings-link']) expect(html).not.toContain(id)
    expect(html).toContain('vaultAdministration.settingsIntro')
    // Only the policy proposal of the fixture is a tenant setting.
    expect(f.state.proposals.map(p => p.reference)).toEqual([other])
    f.unmount()
  })
  it('keeps the tenant settings on the vault page for a manager who is not an administrator', async () => {
    auth.isAdmin = false
    const d = fakeDelivery(), f = mount<Admin>(VaultAdministration, { transport: transport(true), delivery: d }); await flush()
    await f.state.open(); f.state.password = 'pw'; f.state.token = '123456'; await f.state.confirm()
    const html = await f.html()
    expect(html).toContain('vault-administration-policy'); expect(html).not.toContain('vault-administration-settings-link')
    f.unmount()
  })
})

const confirmationProposal = { reference: 'e'.repeat(64), change: { kind: 'confirmation' as const, seconds: 300 }, proposedBy: { id: 3, name: 'Carla' }, mine: false,
  expiresAt: Date.now() + 30_000, beneficiary: null, item: null }
async function unlocked(props: Record<string, unknown>) {
  const d = fakeDelivery(), f = mount<Admin>(VaultAdministration, { transport: transport(true), delivery: d, ...props }); await flush()
  return { d, f }
}
describe('NA-0186 Users tab and confirmation time', () => {
  it('focused on one user, opens by itself and shows only that user and the proposals for them', async () => {
    const { d, f } = await unlocked({ userId: 2 })
    expect(d.prepare).toHaveBeenCalledTimes(1)
    f.state.password = 'pw'; f.state.token = '123456'; await f.state.confirm()
    const html = await f.html()
    expect(html).toContain('vault-administration-user-2'); expect(html).not.toContain('vault-administration-user-1')
    expect(html).toContain(`vault-administration-approve-${reference}`)
    expect(html).not.toContain(`vault-administration-proposal-${other}`); expect(html).not.toContain(`vault-administration-proposal-${'d'.repeat(64)}`)
    expect(html).not.toContain('vault-administration-confirmation'); expect(html).not.toContain('vaultAdministration.title')
    f.unmount()
  })
  it('a focused section with no proposals for that user says so', async () => {
    const { d, f } = await unlocked({ userId: 2 })
    d.administrationOverview.mockResolvedValue({ ...overview, proposals: overview.proposals.filter(p => p.reference !== reference) })
    f.state.password = 'pw'; f.state.token = '123456'; await f.state.confirm()
    expect(await f.html()).toContain('vaultAdministration.noPending')
    f.unmount()
  })
  it('shows the current time and proposes a new one in whole minutes from 1 to 15', async () => {
    auth.isAdmin = false // a manager who is not an administrator keeps the tenant settings on the vault page (NA-0199)
    const { d, f } = await unlocked({})
    await f.state.open(); f.state.password = 'pw'; f.state.token = '123456'; await f.state.confirm()
    expect(await f.html()).toContain('vault-administration-confirmation-propose')
    expect(f.state.minutes).toBe(1)
    for (const value of [1, 0, 16, 2.5, null]) { f.state.minutes = value; await f.state.proposeConfirmation() }
    expect(d.proposeChange).not.toHaveBeenCalled()
    f.state.minutes = 5; await f.state.proposeConfirmation()
    expect(d.proposeChange).toHaveBeenCalledWith({ kind: 'confirmation', seconds: 300 }); expect(f.state.notice).toBe('proposed')
    f.unmount()
  })
  it('lets another manager approve a confirmation-time proposal with its value on screen, never the proposer', async () => {
    const { d, f } = await unlocked({})
    d.administrationOverview.mockResolvedValue({ ...overview, proposals: [confirmationProposal, { ...confirmationProposal, reference: 'f'.repeat(64), mine: true }] })
    await f.state.open(); f.state.password = 'pw'; f.state.token = '123456'; await f.state.confirm()
    const html = await f.html()
    expect(html).toContain(`vault-administration-approve-${'e'.repeat(64)}`); expect(html).not.toContain(`vault-administration-approve-${'f'.repeat(64)}`)
    expect(f.state.describe(confirmationProposal)).toBe('vaultAdministration.proposalConfirmation:{"minutes":5}')
    f.unmount()
  })
})

const statusTransport = (reply: object) => {
  const post = vi.fn(() => Promise.resolve(reply))
  return Object.assign({ post } as VaultTransport, { calls: post })
}
const q = (text: string): string => text.replaceAll('"', '&quot;')
const twoManagers = { ...overview, users: overview.users.filter(u => u.id !== 3).map(u => ({ ...u, manager: true })) }
const threeManagers = { ...overview, users: overview.users.map(u => ({ ...u, manager: true })) }
async function confirmed(props: Record<string, unknown>, view: object = overview) {
  const d = fakeDelivery(); d.administrationOverview.mockResolvedValue(view as typeof overview)
  const f = mount<Admin>(VaultAdministration, { transport: transport(true), delivery: d, ...props }); await flush()
  if (!props.userId && !props.review) await f.state.open()
  f.state.password = 'pw'; f.state.token = '123456'; await f.state.confirm()
  return { d, f }
}
describe('NA-0188 vault managers, proposal validity and pending notices', () => {
  it('proposes adding or removing a manager for someone else, never for oneself', async () => {
    const { d, f } = await confirmed({})
    const html = await f.html()
    expect(html).toContain('vaultAdministration.manager'); expect(html).toContain('vault-administration-manager-2'); expect(html).not.toContain('vault-administration-manager-1')
    await f.state.proposeManager(1, false); expect(d.proposeChange).not.toHaveBeenCalled()
    await f.state.proposeManager(2, true)
    expect(d.proposeChange).toHaveBeenCalledWith({ kind: 'manager', userId: 2, enabled: true })
    // Carla is the only other manager: removing her would leave nobody to approve.
    await f.state.proposeManager(3, false); expect(d.proposeChange).toHaveBeenCalledTimes(1)
    f.unmount()
    const more = await confirmed({}, threeManagers)
    await more.f.state.proposeManager(3, false)
    expect(more.d.proposeChange).toHaveBeenCalledWith({ kind: 'manager', userId: 3, enabled: false }); more.f.unmount()
  })
  it('with only two managers, changes for the other one are disabled with the reason', async () => {
    const { d, f } = await confirmed({}, twoManagers)
    expect(f.state.canPropose(2)).toBe(false); expect(f.state.canPropose()).toBe(true)
    await f.state.propose(2, 'reveal', true); await f.state.proposeManager(2, false)
    expect(d.proposeChange).not.toHaveBeenCalled()
    const html = await f.html()
    expect(html).toContain('vault-administration-blocked'); expect(html).toContain('vaultAdministration.blockedHint')
    expect(html).toContain('aria-describedby="vault-administration-blocked"')
    f.unmount()
    const three = await confirmed({}, threeManagers)
    expect(await three.f.html()).not.toContain('vault-administration-blocked'); three.f.unmount()
  })
  it('shows the proposal validity and proposes a new one only when it changes', async () => {
    auth.isAdmin = false
    const { d, f } = await confirmed({})
    const html = await f.html()
    expect(html).toContain('vault-administration-window'); expect(html).toContain(q('vaultAdministration.windowHint:{"time":"2 vaultAdministration.unitMinutes"}'))
    expect(f.state.windowSeconds).toBe(120)
    await f.state.proposeWindow(); f.state.windowSeconds = null; await f.state.proposeWindow()
    expect(d.proposeChange).not.toHaveBeenCalled()
    f.state.windowSeconds = 86_400; await f.state.proposeWindow()
    expect(d.proposeChange).toHaveBeenCalledWith({ kind: 'proposalWindow', seconds: 86_400 }); expect(f.state.notice).toBe('proposed')
    f.unmount()
  })
  it('describes and lets another manager approve manager and validity proposals; the person affected only sees a note', async () => {
    const base = { proposedBy: { id: 3, name: 'Carla' }, mine: false, expiresAt: Date.now() + 7_200_000 }
    const proposals = [
      { ...base, reference: '1'.repeat(64), change: { kind: 'manager', userId: 2, enabled: true }, beneficiary: { id: 2, name: 'Bruno', email: 'bruno@example.test' } },
      { ...base, reference: '2'.repeat(64), change: { kind: 'manager', userId: 1, enabled: false }, beneficiary: { id: 1, name: 'Ana', email: 'ana@example.test' } },
      { ...base, reference: '3'.repeat(64), change: { kind: 'proposalWindow', seconds: 3600 }, beneficiary: null },
    ]
    const { f } = await confirmed({}, { ...overview, proposals })
    const html = await f.html()
    expect(html).toContain(`vault-administration-approve-${'1'.repeat(64)}`); expect(html).toContain(`vault-administration-approve-${'3'.repeat(64)}`)
    expect(html).not.toContain(`vault-administration-approve-${'2'.repeat(64)}`); expect(html).toContain(`vault-administration-beneficiary-${'2'.repeat(64)}`)
    expect(html).toContain(q('"time":"2 vaultAdministration.unitHours'))
    expect(f.state.describe(proposals[0])).toBe('vaultAdministration.proposalManagerAdd:{"user":"Bruno <bruno@example.test>"}')
    expect(f.state.describe(proposals[1])).toBe('vaultAdministration.proposalManagerRemove:{"user":"Ana <ana@example.test>"}')
    expect(f.state.describe(proposals[2])).toBe('vaultAdministration.proposalWindow:{"time":"1 vaultAdministration.unitHours"}')
    f.unmount()
    const focused = await confirmed({ userId: 2 }, { ...overview, proposals })
    const only = await focused.f.html()
    expect(only).toContain(`vault-administration-proposal-${'1'.repeat(64)}`); expect(only).not.toContain(`vault-administration-proposal-${'3'.repeat(64)}`)
    focused.f.unmount()
  })
  it('tells a manager how many changes await them before unlocking, and refreshes after an approval', async () => {
    const t = statusTransport({ manager: true, pending: 2, managers: [1, 3] }), d = fakeDelivery()
    const f = mount<Admin>(VaultAdministration, { transport: t, delivery: d }); await flush()
    expect(f.state.pendingCount).toBe(2)
    const html = await f.html()
    expect(html).toContain('vault-administration-pending-count'); expect(html).toContain(q('vaultAdministration.pendingCount:{"count":2}'))
    await f.state.open(); f.state.password = 'pw'; f.state.token = '123456'; await f.state.confirm()
    expect(await f.html()).not.toContain('vault-administration-pending-count')
    await f.state.approve(reference); await flush()
    expect(t.calls).toHaveBeenCalledTimes(2)
    f.unmount()
  })
  it('explains to a NodeAccess admin who is not a manager; says nothing to other users or inside the Users tab', async () => {
    const f = mount<Admin>(VaultAdministration, { transport: transport(false), delivery: fakeDelivery() }); await flush()
    expect(await f.html()).toContain('vault-administration-not-manager'); f.unmount()
    const focused = mount<Admin>(VaultAdministration, { transport: transport(false), delivery: fakeDelivery(), userId: 2 }); await flush()
    expect(await focused.html()).not.toContain('vault-administration-not-manager'); focused.unmount()
    auth.isAdmin = false
    const user = mount<Admin>(VaultAdministration, { transport: transport(false), delivery: fakeDelivery() }); await flush()
    expect(await user.html()).not.toContain('vault-administration-not-manager'); user.unmount()
    auth.isAdmin = true
  auth.user.tenantId = 7
  })
  it('an unknown status shows nothing at first and later keeps what was last known', async () => {
    const post = vi.fn().mockRejectedValueOnce(new Error('429')).mockResolvedValueOnce({ manager: true, pending: 1, managers: [1, 3] }).mockRejectedValueOnce(new Error('down'))
    const f = mount<Admin>(VaultAdministration, { transport: { post }, delivery: fakeDelivery() }); await flush()
    expect(f.state.manager).toBe(false); expect(await f.html()).not.toContain('vault-administration-not-manager')
    await f.state.detect(); expect(f.state.manager).toBe(true); expect(f.state.pendingCount).toBe(1)
    await f.state.detect(); expect(f.state.manager).toBe(true); expect(f.state.pendingCount).toBe(1)
    f.unmount()
  })
  it('the Users-tab review opens by itself and shows only the proposals', async () => {
    const { d, f } = await confirmed({ review: true })
    expect(d.prepare).toHaveBeenCalledTimes(1)
    const html = await f.html()
    expect(html).toContain(`vault-administration-approve-${reference}`)
    for (const hidden of ['vault-administration-user-', 'vault-administration-confirmation', 'vault-administration-window', 'vault-administration-blocked', 'vaultAdministration.title'])
      expect(html).not.toContain(hidden)
    f.unmount()
  })
})


describe('integrated diagnostics in the administration parent', () => {
  it('shows configuration only after overview and reuses the current unlock', async () => {
    const d = fakeDelivery(), f = mount<Admin>(VaultAdministration, { transport: transport(true), delivery: d, item: { id: 7, name: 'db' } })
    await flush()
    expect(f.state.diagnosticContext).toBeNull()
    expect(await f.html()).not.toContain('Configuração de acesso')
    f.state.password = 'pw'; f.state.token = '123456'; await f.state.confirm()
    expect(d.unlock).toHaveBeenCalledTimes(1)
    expect(f.state.diagnosticContext).toMatchObject({ clientId: 'c'.repeat(43), sessionId: 's'.repeat(43) })
    expect(await f.html()).toContain('Configuração de acesso')
    const before = f.state.diagnosticContext
    f.state.refreshDiagnosticContext()
    expect(f.state.diagnosticContext).toBe(before)
    f.state.lock()
    expect(f.state.diagnosticContext).toBeNull()
    expect(await f.html()).not.toContain('Configuração de acesso')
    f.unmount()
  })
  it('drops retained context synchronously on tenant switch', async () => {
    const d = fakeDelivery(), f = mount<Admin>(VaultAdministration, { transport: transport(true), delivery: d })
    await flush(); state.phase = 'unlocked'; await f.state.load()
    expect(f.state.diagnosticContext?.identity.tenantId).toBe(7)
    auth.user.tenantId = 9
    expect(f.state.diagnosticContext).toBeNull()
    expect(await f.html()).not.toContain('Configuração de acesso')
    f.unmount()
  })
  it('removes expired context on the parent tick without another unlock', async () => {
    vi.useFakeTimers()
    const d = fakeDelivery(), f = mount<Admin>(VaultAdministration, { transport: transport(true), delivery: d })
    await flush(); state.phase = 'unlocked'; await f.state.load()
    d.diagnosticsContext.mockImplementation(() => { state.phase = 'locked'; return null })
    await vi.advanceTimersByTimeAsync(1000)
    expect(f.state.diagnosticContext).toBeNull()
    expect(await f.html()).not.toContain('Configuração de acesso')
    expect(d.unlock).not.toHaveBeenCalled(); f.unmount()
  })
  it.each(['review', 'settings'])('does not expose diagnostics in %s-only mode', async mode => {
    const d = fakeDelivery(), f = mount<Admin>(VaultAdministration, { transport: transport(true), delivery: d, [mode]: true })
    await flush(); state.phase = 'unlocked'; await f.state.load()
    expect(d.diagnosticsContext).not.toHaveBeenCalled()
    expect(await f.html()).not.toContain('Configuração de acesso'); f.unmount()
  })
})
