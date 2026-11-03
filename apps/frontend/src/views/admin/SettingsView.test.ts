import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, type ComponentOptions, type ComponentPublicInstance, type Ref, type SetupContext } from 'vue'
import { renderToString } from 'vue/server-renderer'
import Settings from './SettingsView.vue'
import fixture from './settings-contracts.fixture.json'
const mocks = vi.hoisted(() => ({ get: vi.fn(), platform: vi.fn(), policy: vi.fn(), users: vi.fn(), groups: vi.fn(), limits: vi.fn(), clear: vi.fn(), commandGet: vi.fn(), commandSave: vi.fn(), evaluate: vi.fn(), success: vi.fn(), error: vi.fn(), slotMode: 'vnode', route: { name: 'admin-settings', query: {} } }))
vi.mock('@/services/settings.service', () => ({ settingsService: { get: mocks.get, getPlatform: mocks.platform, updateSessionLimits: mocks.limits, clear: mocks.clear } }))
vi.mock('@/services/sessionAuditPolicy.service', () => ({ sessionAuditPolicyService: { get: mocks.policy } }))
vi.mock('@/services/user.service', () => ({ userService: { list: mocks.users } }))
vi.mock('@/services/group.service', () => ({ groupService: { list: mocks.groups } }))
vi.mock('@/services/features.service', () => ({ featuresService: { notifyUpdated: vi.fn() } }))
vi.mock('@/services/ai-ssh-action-command-policy.service', () => ({ aiSshActionCommandPolicyService: { get: mocks.commandGet, update: mocks.commandSave, evaluate: mocks.evaluate } }))
vi.mock('@/services/service-cache', () => ({ listCacheRegistry: () => [], subscribeCacheRegistry: () => () => {}, clearAllRegisteredCaches: vi.fn(), clearRegisteredCache: vi.fn(), refreshAllRegisteredCaches: vi.fn(), refreshRegisteredCache: vi.fn(), resetRegisteredCacheTtl: vi.fn(), setRegisteredCacheTtl: vi.fn() }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ user: { role: 'admin', isPlatformAdmin: true } }) }))
vi.mock('vue-router', () => ({ useRoute: () => mocks.route, useRouter: () => ({ push: vi.fn() }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/manual/ManualSettings.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/integrations/TenantAuthPolicyCard.vue', () => ({ default: { render: () => null } }))
vi.mock('./EmailConfigView.vue', () => ({ default: { render: () => null } }))
vi.mock('naive-ui', async () => {
  const { defineComponent, h } = await import('vue')
  const { ssrRenderSlot, ssrRenderVNode, ssrRenderAttrs } = await import('vue/server-renderer')
  const names = ['NAlert', 'NButton', 'NCard', 'NDescriptions', 'NDescriptionsItem', 'NProgress', 'NSelect', 'NSpace', 'NSpin', 'NTag', 'NText', 'NTransfer', 'NCheckbox', 'NInputNumber', 'NInput', 'NTooltip', 'NCollapse', 'NCollapseItem']
  return { ...Object.fromEntries(names.map(name => [name, defineComponent({ name, inheritAttrs: false,
    ssrRender(context: ComponentPublicInstance, push: Parameters<typeof ssrRenderSlot>[4], parent: Parameters<typeof ssrRenderSlot>[5]) {
      const attrs = context.$attrs, slots = context.$slots
      if (mocks.slotMode === 'ssr') {
        push(`<${name}${ssrRenderAttrs(attrs, name)}>`)
        for (const slot of Object.keys(slots)) ssrRenderSlot(slots, slot, {}, null, push, parent)
        push(`</${name}>`)
      } else {
        ssrRenderVNode(push, h(name, attrs, Object.values(slots).flatMap(slot => slot?.() ?? [])), parent)
      }
    },
  })])), useMessage: () => ({ success: mocks.success, error: mocks.error }) }
})
type State = { load: () => Promise<void>; sessionLimitsForm: Ref<{ maxPerUser: number | null; maxPerTenant: number | null }>; sessionLimitsSaving: Ref<boolean>; saveSessionLimits: () => Promise<void>; commandPolicyForm: Ref<{ safePatterns: string; approvalPatterns: string; blockedPatterns: string }>; saveCommandPolicy: () => Promise<void>; commandPolicyTest: Ref<{ command: string; loading: boolean; result: unknown }>; evaluateCommandPolicy: () => Promise<void> }
let state: State | undefined
async function render(fresh = false): Promise<string> {
  const original = Settings as ComponentOptions
  const component = defineComponent({ ...original, async setup(props, context: SetupContext) {
    if (fresh || !state) {
      if (typeof original.setup !== 'function') throw new Error('Missing SFC setup')
      state = original.setup(props, context) as State
      await state.load()
    }
    return state
  } })
  const app = createSSRApp(component); app.config.globalProperties.$t = (key: string) => key
  return renderToString(app)
}
function current(): State { if (!state) throw new Error('Missing state'); return state }
beforeEach(() => {
  vi.clearAllMocks(); state = undefined; mocks.route.name = 'admin-settings'; mocks.slotMode = 'vnode'
  mocks.get.mockResolvedValue({ data: structuredClone(fixture) }); mocks.platform.mockResolvedValue({ data: fixture.environment })
  mocks.policy.mockResolvedValue({ data: null }); mocks.users.mockResolvedValue({ data: { data: [] } }); mocks.groups.mockResolvedValue({ data: [] })
  mocks.commandGet.mockResolvedValue({ data: { safePatterns: ['^pwd$'], approvalPatterns: [], blockedPatterns: ['rm'] } })
  mocks.limits.mockResolvedValue({ data: structuredClone(fixture) })
})
describe('Settings compiled SSR contracts', () => {
  it('loads tenant settings and tolerates an unavailable optional audit policy', async () => {
    mocks.policy.mockRejectedValueOnce(new Error('unavailable'))
    const html = await render(true)
    expect(html).not.toContain('Erro ao carregar configurações')
    expect(html).toContain('admin.settings.license'); expect(mocks.users).toHaveBeenCalledWith({ limit: 200 })
    expect(mocks.commandGet).toHaveBeenCalledOnce(); expect(mocks.platform).not.toHaveBeenCalled()
  })
  it('isolates platform environment loading from all tenant APIs', async () => {
    mocks.route.name = 'platform-settings'
    const html = await render(true)
    expect(html).toContain('FEATURE_NATIVE_SSH_GATEWAY'); expect(html).toContain('FEATURE_MCP')
    expect(mocks.platform).toHaveBeenCalledOnce(); expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.users).not.toHaveBeenCalled(); expect(mocks.policy).not.toHaveBeenCalled()
  })
  it('shows critical load failure and recovers on a subsequent load', async () => {
    mocks.get.mockRejectedValueOnce(new Error('offline'))
    expect(await render(true)).toContain('Erro ao carregar configurações')
    await current().load()
    expect(await render()).not.toContain('Erro ao carregar configurações')
  })
  it('saves session limits, updates returned values and clears cache only after success', async () => {
    await render(true)
    current().sessionLimitsForm.value = { maxPerUser: null, maxPerTenant: 20 }
    mocks.limits.mockResolvedValue({ data: { ...fixture, sessionLimits: { activeSessions: 1, maxPerUser: null, maxPerTenant: 20 } } })
    await current().saveSessionLimits()
    expect(mocks.limits).toHaveBeenCalledWith({ maxPerUser: null, maxPerTenant: 20 }); expect(mocks.clear).toHaveBeenCalledOnce()
    expect(current().sessionLimitsForm.value.maxPerTenant).toBe(20); expect(current().sessionLimitsSaving.value).toBe(false)
    mocks.limits.mockRejectedValueOnce(new Error('denied')); await current().saveSessionLimits()
    expect(mocks.clear).toHaveBeenCalledOnce(); expect(mocks.error).toHaveBeenCalledWith('admin.settings.sessionLimits.messages.saveError'); expect(current().sessionLimitsSaving.value).toBe(false)
  })
  it('normalizes command patterns and handles save failure without success feedback', async () => {
    await render(true)
    current().commandPolicyForm.value = { safePatterns: '  pwd  \n\n uptime ', approvalPatterns: '\n systemctl ', blockedPatterns: ' rm ' }
    mocks.commandSave.mockResolvedValue({ data: { safePatterns: ['pwd', 'uptime'], approvalPatterns: ['systemctl'], blockedPatterns: ['rm'] } })
    await current().saveCommandPolicy()
    expect(mocks.commandSave).toHaveBeenCalledWith({ safePatterns: ['pwd', 'uptime'], approvalPatterns: ['systemctl'], blockedPatterns: ['rm'] })
    expect(current().commandPolicyForm.value.safePatterns).toBe('pwd\nuptime')
    mocks.commandSave.mockRejectedValueOnce(new Error('denied')); await current().saveCommandPolicy()
    expect(mocks.success).toHaveBeenCalledTimes(1); expect(mocks.error).toHaveBeenCalledWith('Não foi possível salvar a policy de comandos SSH por IA.')
  })
  it('does not evaluate empty command and renders a returned blocked decision, then clears pending on failure', async () => {
    await render(true); await current().evaluateCommandPolicy(); expect(mocks.evaluate).not.toHaveBeenCalled()
    current().commandPolicyTest.value.command = 'rm /tmp/file'
    mocks.evaluate.mockResolvedValue({ data: { command: 'rm /tmp/file', risk: 'blocked' } })
    await current().evaluateCommandPolicy(); expect(await render()).toContain('blocked')
    mocks.evaluate.mockRejectedValueOnce(new Error('offline')); await current().evaluateCommandPolicy()
    expect(current().commandPolicyTest.value.loading).toBe(false); expect(current().commandPolicyTest.value.result).toBeNull()
    expect(mocks.error).toHaveBeenCalledWith('Não foi possível avaliar o comando contra a policy.')
  })
  it('renders effective platform flags and cache activity through official SSR slot callbacks', async () => {
    mocks.slotMode = 'ssr'; mocks.route.name = 'platform-settings'
    mocks.platform.mockResolvedValue({ data: { ...fixture.environment, cache: { ...fixture.environment.cache,
      runtime: [{ domain: 'host_dashboard', hits: 8, misses: 2, hitRate: 0.8, writes: 4, invalidations: 2, errors: 1, disabled: 0, averageDurationMs: 1.25 }] } } })
    const html = await render(true)
    expect(html).toContain('FEATURE_NATIVE_SSH_GATEWAY'); expect(html).toContain('FEATURE_MCP')
    expect(html.match(/>common.enabled</g)).toHaveLength(4)
    expect(html.match(/>common.disabled</g)).toHaveLength(2)
    expect(html).toContain('Hits / misses: 8 / 2'); expect(html).toContain('Hit rate: 80%')
    expect(html).toContain('Erros: 1'); expect(html).toContain('Latência média: 1.3ms')
    expect(html).toContain('Invalidações: 2'); expect(html).toContain('0 caches')
    expect(mocks.get).not.toHaveBeenCalled()
  })
  it('renders tenant license, policy controls and saved session limits through official SSR slots', async () => {
    mocks.slotMode = 'ssr'
    let html = await render(true)
    expect(html).toContain('admin.settings.license.sessionAudit'); expect(html).toContain('admin.settings.sessionLimits')
    expect(html).toContain('^pwd$'); expect(html).not.toContain('backend-cache-settings')
    current().sessionLimitsForm.value = { maxPerUser: 2, maxPerTenant: 19 }
    mocks.limits.mockResolvedValue({ data: { ...fixture, sessionLimits: { activeSessions: 1, maxPerUser: 2, maxPerTenant: 19 } } })
    await current().saveSessionLimits(); html = await render()
    expect(html).toContain('value="19"'); expect(mocks.limits).toHaveBeenCalledWith({ maxPerUser: 2, maxPerTenant: 19 })
    expect(mocks.clear).toHaveBeenCalledOnce()
  })
  it('renders platform load error and recovers to null cache measurements without misleading percentages', async () => {
    mocks.slotMode = 'ssr'; mocks.route.name = 'platform-settings'
    mocks.platform.mockRejectedValueOnce(new Error('offline'))
    const failed = await render(true)
    expect(failed).toContain('Erro ao carregar configurações'); expect(failed).not.toContain('backend-cache-runtime')
    mocks.platform.mockResolvedValue({ data: { ...fixture.environment, cache: { ...fixture.environment.cache,
      runtime: [{ domain: 'user_dashboard', hits: 0, misses: 0, hitRate: null, writes: 0, invalidations: 0, errors: 0, disabled: 2, averageDurationMs: null }] } } })
    await current().load(); const recovered = await render()
    expect(recovered).not.toContain('Erro ao carregar configurações')
    expect(recovered).toContain('Hit rate: —'); expect(recovered).toContain('Latência média: —')
    expect(recovered).toContain('Desabilitado: 2'); expect(recovered).not.toContain('NaN')
  })

})
