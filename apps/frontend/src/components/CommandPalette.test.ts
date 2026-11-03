import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, type ComponentOptions, type ComputedRef, type Ref, type SetupContext } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { HostPublic } from '@nodeaccess/shared'
import Palette from './CommandPalette.vue'
const mocks = vi.hoisted(() => ({ list: vi.fn(), getFeatures: vi.fn(), clearFeatures: vi.fn(), clearHosts: vi.fn(), push: vi.fn(), close: vi.fn(), add: vi.fn(), reset: vi.fn(), warning: vi.fn(), auth: { isAdmin: true, isPlatformAdmin: true }, settings: { graphicalOpenMode: 'dedicated' } }))
vi.mock('@/services/app-events.service', () => ({ INVENTORY_ACL_CHANGED_EVENT: 'nodeaccess:inventory-acl-changed', USER_ACL_MEMBERSHIP_CHANGED_EVENT: 'nodeaccess:user-acl-membership-changed' }))
vi.mock('@/services/host.service', () => ({ hostService: { list: mocks.list, clear: mocks.clearHosts } }))
vi.mock('@/services/features.service', () => ({ featuresService: { get: mocks.getFeatures, clear: mocks.clearFeatures } }))
vi.mock('@/services/terminal-layout.service', () => ({ resetTerminalLayout: mocks.reset }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => mocks.auth }))
vi.mock('@/stores/terminals', () => ({ useTerminalStore: () => ({ add: mocks.add }) }))
vi.mock('@/composables/useTerminal', () => ({ termSettings: mocks.settings }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('naive-ui', () => ({ useMessage: () => ({ warning: mocks.warning }) }))
type Item = { label: string; action: () => void }
type State = { loadInitialData: () => Promise<void>; reloadHosts: () => Promise<void>; reloadFeatures: () => Promise<void>; navLinks: ComputedRef<Item[]>; hostItems: ComputedRef<Item[]>; query: Ref<string>; connectHost: (host: HostPublic) => void; onKey: (event: { key: string; preventDefault: () => void }) => void }
let state: State | undefined
async function render(fresh = false): Promise<string> {
  const original = Palette as ComponentOptions
  const component = defineComponent({ ...original, async setup(props, context: SetupContext) {
    if (fresh || !state) {
      if (typeof original.setup !== 'function') throw new Error('Missing SFC setup')
      state = original.setup(props, context) as State; await state.loadInitialData()
    }
    return state
  } })
  const app = createSSRApp(component, { onClose: mocks.close }); app.config.globalProperties.$t = (key: string) => key
  const context: { teleports?: Record<string, string> } = {}
  await renderToString(app, context)
  return context.teleports?.body ?? ''
}
function current(): State { if (!state) throw new Error('Missing setup state'); return state }
const host = { id: 11, name: 'Host sintético', ip: '192.0.2.11', port: 22, authType: 'password', accessProtocol: 'ssh', accessPermissions: { view: true, connect: true, edit: false, admin: false } } as HostPublic
beforeEach(() => {
  vi.clearAllMocks(); state = undefined; mocks.auth.isAdmin = true; mocks.auth.isPlatformAdmin = true
  mocks.list.mockResolvedValue({ data: { data: [host] } }); mocks.getFeatures.mockResolvedValue({ mcpLicensed: true }); mocks.push.mockResolvedValue(undefined)
  vi.stubGlobal('document', { querySelector: () => null })
})
afterEach(() => vi.unstubAllGlobals())
describe('CommandPalette original SSR navigation contracts', () => {
  it('renders host search and routes every permitted navigation command to its explicit destination', async () => {
    const html = await render(true)
    expect(html).toContain('Host sintético'); expect(html).toContain('commandPalette.placeholder')
    const routes: Record<string, string> = { dashboard: 'admin-dashboard', users: 'admin-users', groups: 'admin-groups', diagnosticPlaybooks: 'admin-diagnostic-playbooks', mcpTokens: 'admin-mcp-tokens', sessions: 'admin-reports-sessions', reportsOverview: 'admin-reports', logs: 'admin-logs', sessionAudit: 'admin-session-audit', sftpAudit: 'admin-sftp-audit', nativeSshGateway: 'admin-native-ssh-gateway', sessionCommandPolicies: 'admin-session-command-policies', integrations: 'admin-integrations', settings: 'admin-settings', observability: 'admin-observability', platformSettings: 'platform-settings', profile: 'profile', pemKeys: 'pem-keys' }
    expect(current().navLinks.value).toHaveLength(Object.keys(routes).length)
    for (const [label, route] of Object.entries(routes)) {
      const item = current().navLinks.value.find(entry => entry.label === `nav.${label}`)
      expect(item).toBeDefined(); if (!item) throw new Error(`Missing command ${label}`)
      item.action(); expect(mocks.push).toHaveBeenLastCalledWith({ name: route })
    }
    expect(mocks.close).toHaveBeenCalledTimes(Object.keys(routes).length)
    current().query.value = '192.0.2.11'; expect(await render()).toContain('Host sintético')
    current().query.value = 'missing'; expect(await render()).not.toContain('Host sintético')
  })
  it('hides admin/platform links for ordinary users and removes MCP when the license refresh disables it', async () => {
    mocks.auth.isAdmin = false; mocks.auth.isPlatformAdmin = false; await render(true)
    expect(current().navLinks.value.map(item => item.label)).toEqual(['nav.profile', 'nav.pemKeys'])
    mocks.auth.isAdmin = true; mocks.auth.isPlatformAdmin = true; await render(true)
    mocks.getFeatures.mockResolvedValue({ mcpLicensed: false }); await current().reloadFeatures()
    expect(mocks.clearFeatures).toHaveBeenCalledOnce(); expect(current().navLinks.value.some(item => item.label === 'nav.mcpTokens')).toBe(false)
  })
  it('enforces connect permission in the frontend and distinguishes SSH terminal from dedicated graphical route', async () => {
    mocks.auth.isAdmin = false; await render(true)
    current().connectHost({ ...host, accessPermissions: { view: true, connect: false, edit: false, admin: false } })
    expect(mocks.warning).toHaveBeenCalledWith('hosts.inventoryAcl.connectRequired'); expect(mocks.add).not.toHaveBeenCalled(); expect(mocks.close).not.toHaveBeenCalled()
    current().hostItems.value[0]?.action()
    expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ id: 11, accessProtocol: 'ssh' })); expect(mocks.reset).toHaveBeenCalledOnce(); expect(mocks.push).toHaveBeenLastCalledWith({ name: 'terminal' })
    current().connectHost({ ...host, accessProtocol: 'rdp' })
    expect(mocks.push).toHaveBeenLastCalledWith({ name: 'graphical-session', params: { hostId: 11 } }); expect(mocks.add).toHaveBeenCalledTimes(1)
  })
  it('keeps host results on transient ACL reload failure and activates selected command on Enter', async () => {
    await render(true); mocks.list.mockRejectedValueOnce(new Error('offline')); await current().reloadHosts()
    expect(mocks.clearHosts).toHaveBeenCalledWith('acl-realtime:command-palette'); expect(await render()).toContain('Host sintético')
    const preventDefault = vi.fn()
    current().onKey({ key: 'ArrowDown', preventDefault }); current().onKey({ key: 'Enter', preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce(); expect(mocks.push).toHaveBeenLastCalledWith({ name: 'admin-dashboard' })
    current().onKey({ key: 'ArrowUp', preventDefault }); current().onKey({ key: 'Escape', preventDefault })
    expect(mocks.close).toHaveBeenCalledTimes(2)
  })
})
