import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, createSSRApp, defineComponent, h, nextTick, reactive, ssrContextKey, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import VaultSettings from './VaultSettings.vue'
import { VaultClientError, type VaultTransport } from '@/services/vault-http'

// NA-0199 — the "Vault" section of /admin/settings: values without unlocking; changes only for vault managers.
const auth = reactive({ isAdmin: true, isManagingTenant: false, accessToken: 'a', refreshToken: 'r', user: { id: 1, tenantId: 7, actingTenantId: undefined as number | undefined } })
vi.mock('@/stores/auth', () => ({ useAuthStore: () => auth }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key) }) }))
vi.mock('@/components/vault/VaultAdministration.vue', () => ({ default: defineComponent({ props: ['settings'], setup: props => () => h('div', { 'data-admin-settings': String(props.settings) }) }) }))
vi.mock('naive-ui', () => ({ ...Object.fromEntries(['NAlert', 'NText'].map(name => [name,
  defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => h(name, attrs, slots.default?.()) })])) }))
interface HostNode { parent: HostNode | null; children: HostNode[] }
const node = (): HostNode => ({ parent: null, children: [] })
function mount(props: Record<string, unknown>) {
  const renderer = createRenderer<HostNode, HostNode>({ createElement: node, createText: node, createComment: node, setText: () => {}, setElementText: () => {}, patchProp: () => {},
    parentNode: n => n.parent, nextSibling: () => null, insert: (n, p) => { n.parent = p; p.children.push(n) }, remove: n => { if (n.parent) n.parent.children = n.parent.children.filter(c => c !== n) } })
  const app = renderer.createApp({ ...(VaultSettings as Component), render: () => null }, props); app.provide(ssrContextKey, { modules: new Set() })
  const vm = app.mount(node()), setupState = (vm.$ as unknown as { setupState: Record<string, unknown> }).setupState
  return { unmount: () => app.unmount(), html: () => renderToString(createSSRApp({ ...(VaultSettings as Component), setup: () => setupState }, props)) }
}
const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) { await Promise.resolve(); await nextTick() } }
const values = { manager: true, reveal: true, copy: false, tenantQuota: 30, confirmationSeconds: 300, proposalSeconds: 86400, origin: 'https://localhost:5173', webauthn: true }
// The mock is kept apart from the transport object so assertions never detach a method.
const transport = (reply: unknown) => {
  const post = vi.fn(() => (reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply)))
  return Object.assign({ post } as unknown as VaultTransport, { calls: post })
}
beforeEach(() => {
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('window', { location: { protocol: 'https:', origin: 'https://localhost:5173' } })
})

describe('NA-0199 vault settings section', () => {
  it('shows the current values and, for a manager, the settings mode of the vault administration', async () => {
    const t = transport(values), f = mount({ transport: t }); await flush()
    expect(t.calls).toHaveBeenCalledWith('administration/settings', {}, expect.objectContaining({ userId: 1, origin: 'https://localhost:5173' }))
    const html = (await f.html()).replaceAll('&quot;', '"')
    expect(html).toContain('vault-settings-values'); expect(html).toContain('https://localhost:5173')
    expect(html).toContain('"reveal":"vaultAdministration.on"'); expect(html).toContain('"copy":"vaultAdministration.off"')
    expect(html).toContain('5 vaultAdministration.unitMinutes'); expect(html).toContain('24 vaultAdministration.unitHours')
    expect(html).not.toContain('vault-settings-bootstrap-help'); expect(html).toContain('vaultSettings.webauthnOn'); expect(html).toContain('data-admin-settings')
    f.unmount()
  })
  it('is read only for an administrator who is not a manager', async () => {
    const f = mount({ transport: transport({ ...values, manager: false, webauthn: false }) }); await flush()
    const html = await f.html()
    expect(html).toContain('vault-settings-bootstrap-help'); expect(html).toContain('vaultSettings.bootstrapHelp'); expect(html).toContain('vault-settings-read-only'); expect(html).not.toContain('data-admin-settings'); expect(html).toContain('vaultSettings.webauthnOff')
    f.unmount()
  })
  it('explains a refusal, a vault that is not enabled and an unknown failure', async () => {
    for (const [reply, text] of [[new VaultClientError('denied'), 'vaultSettings.denied'], [new VaultClientError('unsupported'), 'vault-settings-unconfigured'],
      [new VaultClientError('expired'), 'vaultSettings.unavailable'], [new VaultClientError('unavailable'), 'vaultSettings.unavailable'], [{ manager: 'yes' }, 'vaultSettings.unavailable']] as const) {
      const f = mount({ transport: transport(reply) }); await flush()
      expect(await f.html()).toContain(text); f.unmount()
    }
  })
})
