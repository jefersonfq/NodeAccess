import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, type ComponentOptions, type SetupContext } from 'vue'
import { renderToString } from 'vue/server-renderer'
import Editor from './TenantLicenseEditor.vue'
import type { SettingsData, UpdateLicenseSettingsPayload } from '@/services/settings.service'

type License = SettingsData['license']
const mocks = vi.hoisted(() => ({
  get: vi.fn<(id: number) => Promise<{ data: License }>>(),
  update: vi.fn<(id: number, payload: UpdateLicenseSettingsPayload) => Promise<{ data: License }>>(),
  notify: vi.fn(), info: vi.fn(), success: vi.fn(), saved: vi.fn(), close: vi.fn(),
}))
vi.mock('@/services/settings.service', () => ({ settingsService: { getTenantLicense: mocks.get, updateTenantLicense: mocks.update } }))
vi.mock('@/services/features.service', () => ({ featuresService: { notifyUpdated: mocks.notify } }))
vi.mock('naive-ui', async () => {
  const { defineComponent, h } = await import('vue')
  const tags = ['NAlert', 'NButton', 'NCard', 'NCheckbox', 'NDescriptions', 'NDescriptionsItem', 'NDrawer', 'NDrawerContent', 'NInputNumber', 'NModal', 'NPopconfirm', 'NSelect', 'NSpin', 'NTag', 'NTooltip']
  return { ...Object.fromEntries(tags.map(tag => [tag, defineComponent({ name: tag, inheritAttrs: false, setup(_, { attrs, slots }) {
    return () => { const children = Object.values(slots).flatMap(slot => slot?.() ?? []); controls.push({ tag, attrs: { ...attrs }, text: text(children) }); return h(tag, attrs, children) }
  } })])), useMessage: () => ({ info: mocks.info, success: mocks.success }) }
})
type Control = { tag: string; attrs: Record<string, unknown>; text: string }
type State = { load: (id: number) => Promise<void>; save: () => Promise<void> }
const controls: Control[] = []
let state: State | undefined
let props: { show: boolean; tenantId: number | null; tenantName: string }
function license(): License { return { maxUsers: 10, maxHosts: 5, activeUsers: 4, registeredHosts: 3, hasKey: true,
  multiConnect: false, sessionAuditEnabled: false, sessionAuditAiEnabled: false, sessionAuditAiProvider: 'automatic', sessionAuditAiAutoSummaryEnabled: false,
  featureEntitlements: {}, integrationEntitlements: {} } }
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join(' ')
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'children' in value) return text(value.children)
  return ''
}
async function render(fresh = false): Promise<string> {
  controls.length = 0
  const original = Editor as ComponentOptions
  const component = defineComponent({ ...original, async setup(actualProps, context: SetupContext) {
    if (fresh || !state) {
      if (typeof original.setup !== 'function') throw new Error('SFC setup unavailable')
      state = original.setup(actualProps, context) as State
      // The immediate watcher starts the actual async load; resolve the mocked API microtask.
      await Promise.resolve()
    }
    return state
  } })
  return renderToString(createSSRApp(component, { ...props, onSaved: mocks.saved, onClose: mocks.close }))
}
function control(tag: string, predicate: (item: Control) => boolean = () => true): Control {
  const item = controls.find(value => value.tag === tag && predicate(value))
  if (!item) throw new Error(`Rendered control unavailable: ${tag}`)
  return item
}
function testId(id: string): Control { return control('NInputNumber', item => item.attrs['data-testid'] === id) }
function moduleControl(label: string): Control { return control('NCheckbox', item => item.attrs['aria-label'] === label) }
async function invoke(item: Control, event: string, value?: unknown): Promise<void> {
  const handler = item.attrs[event]
  expect(typeof handler).toBe('function')
  await (handler as (value?: unknown) => unknown)(value)
}
async function change(item: Control, value: unknown, event = 'onUpdate:value'): Promise<string> { await invoke(item, event, value); return render() }
function saveButton(): Control { return control('NButton', item => item.attrs['data-testid'] === 'save-tenant-license') }
async function confirm(): Promise<void> { await invoke(control('NPopconfirm'), 'onPositiveClick') }
beforeEach(() => {
  state = undefined; props = { show: true, tenantId: 7, tenantName: 'Tenant sintético' }; vi.clearAllMocks()
  mocks.get.mockResolvedValue({ data: license() })
  mocks.update.mockImplementation((_id, payload) => Promise.resolve({ data: { ...license(), ...payload } }))
})
describe('TenantLicenseEditor original setup and compiled SSR contracts', () => {
  it('loads the selected tenant once, renders consumption and keeps unchanged saves disabled', async () => {
    const html = await render(true)
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith(7)
    expect(html).toContain('Contrato e licença · Tenant sintético'); expect(html).toContain('Contrato sem alterações')
    expect(testId('license-max-users').attrs.min).toBe(4); expect(testId('license-max-hosts').attrs.min).toBe(3)
    expect(saveButton().attrs.disabled).toBe(true); expect(control('NSpin').attrs.show).toBe(false)
    await confirm(); expect(mocks.update).not.toHaveBeenCalled()
  })
  it.each([{ show: false, tenantId: 7 }, { show: true, tenantId: null }])('does not load or save without visible tenant context %j', async options => {
    props = { ...props, ...options }; await render(true)
    expect(mocks.get).not.toHaveBeenCalled(); expect(saveButton().attrs.disabled).toBe(true)
    await confirm(); expect(mocks.update).not.toHaveBeenCalled()
  })
  it('renders load failure and recovers using the original load operation', async () => {
    mocks.get.mockRejectedValueOnce(new Error('offline'))
    expect(await render(true)).toContain('Não foi possível carregar a licença deste tenant.')
    await state!.load(7); expect(await render()).toContain('Contrato sem alterações')
    expect(control('NSpin').attrs.show).toBe(false)
  })
  it.each([[3, true], [4, false], [12, false]] as const)('users limit %i respects active consumption and reports pending change', async (value, disabled) => {
    await render(true); const html = await change(testId('license-max-users'), value)
    expect(saveButton().attrs.disabled).toBe(disabled); expect(html).toContain(`Usuários: 10 → ${value}`)
    await confirm(); expect(mocks.update).toHaveBeenCalledTimes(disabled ? 0 : 1)
    if (!disabled) expect(mocks.update.mock.calls[0]?.[1].maxUsers).toBe(value)
  })
  it.each([[null, true], [2, true], [3, false], [8, false]] as const)('bounded hosts limit %s respects registered hosts', async (value, disabled) => {
    await render(true); await change(testId('license-max-hosts'), value)
    expect(saveButton().attrs.disabled).toBe(disabled)
    await confirm(); expect(mocks.update).toHaveBeenCalledTimes(disabled ? 0 : 1)
  })
  it('switches hosts to unlimited and persists null instead of stale numeric input', async () => {
    await render(true)
    const html = await change(control('NCheckbox', item => item.text.includes('Definir limite de hosts')), false, 'onUpdate:checked')
    expect(html).toContain('Hosts: 5 → ∞'); expect(html).toContain('Sem limite contratual de hosts.')
    expect(controls.some(item => item.attrs['data-testid'] === 'license-max-hosts')).toBe(false)
    await confirm(); expect(mocks.update.mock.calls[0]?.[1].maxHosts).toBeNull()
    expect(await render()).toContain('Contrato sem alterações')
  })
  it('enables bounded hosts only after choosing a valid value from an unlimited license', async () => {
    mocks.get.mockResolvedValue({ data: { ...license(), maxHosts: null } }); await render(true)
    await change(control('NCheckbox', item => item.text.includes('Definir limite de hosts')), true, 'onUpdate:checked')
    expect(saveButton().attrs.disabled).toBe(true)
    const html = await change(testId('license-max-hosts'), 3)
    expect(html).toContain('Hosts: ∞ → 3'); expect(saveButton().attrs.disabled).toBe(false)
  })
  it('enables audit dependencies and removes transitive dependents exactly once when audit is disabled', async () => {
    await render(true)
    let html = await change(moduleControl('Resumo automático de sessões'), true, 'onUpdate:checked')
    expect(moduleControl('Auditoria de sessões').attrs.checked).toBe(true)
    expect(moduleControl('Análise de sessões por IA').attrs.checked).toBe(true)
    expect(html).toContain('Resumo automático de sessões: habilitar')
    expect(mocks.info).toHaveBeenLastCalledWith('Dependências habilitadas: Auditoria de sessões, Análise de sessões por IA.')
    html = await change(moduleControl('Auditoria de sessões'), false, 'onUpdate:checked')
    expect(moduleControl('Análise de sessões por IA').attrs.checked).toBe(false)
    expect(moduleControl('Resumo automático de sessões').attrs.checked).toBe(false)
    expect(html).toContain('Contrato sem alterações'); expect(saveButton().attrs.disabled).toBe(true)
    expect(mocks.info).toHaveBeenLastCalledWith('Recursos dependentes desabilitados: Análise de sessões por IA, Resumo automático de sessões.')
  })
  it('enables local AI for terminal/actions and clears both dependents when disabled', async () => {
    await render(true); await change(moduleControl('IA no terminal'), true, 'onUpdate:checked')
    expect(moduleControl('Assistente de IA').attrs.checked).toBe(true)
    await change(moduleControl('Ações SSH assistidas por IA'), true, 'onUpdate:checked')
    await change(moduleControl('Assistente de IA'), false, 'onUpdate:checked')
    expect(moduleControl('IA no terminal').attrs.checked).toBe(false); expect(moduleControl('Ações SSH assistidas por IA').attrs.checked).toBe(false)
  })
  it('enables a standalone module and a provider, then disables connectors with their parent module', async () => {
    await render(true)
    expect(moduleControl('Jira').attrs.disabled).toBe(true)
    await change(moduleControl('Conexões simultâneas'), true, 'onUpdate:checked')
    await change(moduleControl('Integrações externas'), true, 'onUpdate:checked')
    let html = await change(moduleControl('Jira'), true, 'onUpdate:checked')
    expect(html).toContain('Jira: habilitar'); expect(moduleControl('Jira').attrs.disabled).toBe(false)
    html = await change(moduleControl('Integrações externas'), false, 'onUpdate:checked')
    expect(moduleControl('Jira').attrs.checked).toBe(false); expect(html).toContain('Habilite')
    await confirm(); expect(mocks.update.mock.calls[0]?.[1]).toMatchObject({ multiConnect: true, integrationEntitlements: { jira: false, google: false, ldap: false, onepassword: false, oidc: false, scim: false } })
  })
  it('saves scoped normalized payload only after confirmation and publishes success once', async () => {
    await render(true); await change(moduleControl('Resumo automático de sessões'), true, 'onUpdate:checked')
    await change(control('NSelect'), 'local_ai')
    expect(mocks.update).not.toHaveBeenCalled()
    await confirm()
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(7, expect.objectContaining({ maxUsers: 10, maxHosts: 5, sessionAuditEnabled: true, sessionAuditAiEnabled: true, sessionAuditAiAutoSummaryEnabled: true, sessionAuditAiProvider: 'local_ai' }))
    expect(mocks.notify).toHaveBeenCalledOnce(); expect(mocks.saved).toHaveBeenCalledOnce(); expect(mocks.success).toHaveBeenCalledOnce()
    expect(await render()).toContain('Contrato sem alterações'); expect(saveButton().attrs.disabled).toBe(true)
  })
  it.each([true, false])('keeps unsaved changes on update error, API message available=%s', async detailed => {
    await render(true); await change(testId('license-max-users'), 11)
    mocks.update.mockRejectedValueOnce(detailed ? { response: { data: { message: 'Quota excedida no tenant sintético' } } } : new Error('offline'))
    await confirm(); const html = await render()
    expect(html).toContain(detailed ? 'Quota excedida no tenant sintético' : 'Não foi possível atualizar a licença.')
    expect(saveButton().attrs.loading).toBe(false); expect(saveButton().attrs.disabled).toBe(false)
    expect(mocks.saved).not.toHaveBeenCalled(); expect(mocks.notify).not.toHaveBeenCalled()
    await confirm(); expect(mocks.saved).toHaveBeenCalledOnce()
  })
  it('shows saving until the backend resolves and does not emit early success', async () => {
    await render(true); await change(testId('license-max-users'), 11)
    let resolveSave: (value: { data: License }) => void = () => { throw new Error('Save not started') }
    mocks.update.mockReturnValueOnce(new Promise(resolve => { resolveSave = resolve }))
    const pending = confirm(); await render()
    expect(saveButton().attrs.loading).toBe(true); expect(mocks.saved).not.toHaveBeenCalled()
    resolveSave({ data: { ...license(), maxUsers: 11 } }); await pending; await render()
    expect(saveButton().attrs.loading).toBe(false); expect(mocks.saved).toHaveBeenCalledOnce()
  })
  it('renders module/provider practical help and closes drawer without losing edits', async () => {
    await render(true); await change(testId('license-max-users'), 11)
    await invoke(control('NButton', item => item.attrs['data-license-cases'] === 'terminalAi'), 'onClick')
    let html = await render(); expect(control('NDrawer').attrs.show).toBe(true)
    expect(html).toContain('Este recurso também habilita: Assistente de IA.'); expect(html).toContain('Explicar a saída de um comando.')
    await invoke(control('NDrawer'), 'onUpdate:show', true); await render(); expect(control('NDrawer').attrs.show).toBe(true)
    await invoke(control('NDrawer'), 'onUpdate:show', false); await render(); expect(control('NDrawer').attrs.show).toBe(false)
    await invoke(control('NButton', item => item.attrs['data-license-cases'] === 'jira'), 'onClick')
    html = await render(); expect(html).toContain('Abrir um chamado relacionado ao host.'); expect(html).toContain('Integração')
    expect(testId('license-max-users').attrs.value).toBe(11)
  })
  it('shows loading until tenant data resolves without rendering stale editable limits', async () => {
    let resolveLoad: (value: { data: License }) => void = () => { throw new Error('Load not started') }
    mocks.get.mockReturnValueOnce(new Promise(resolve => { resolveLoad = resolve }))
    await render(true)
    expect(control('NSpin').attrs.show).toBe(true)
    expect(controls.some(item => item.attrs['data-testid'] === 'license-max-users')).toBe(false)
    expect(saveButton().attrs.disabled).toBe(true)
    resolveLoad({ data: license() }); await Promise.resolve(); await render()
    expect(control('NSpin').attrs.show).toBe(false); expect(testId('license-max-users').attrs.value).toBe(10)
  })
  it('persists enabled connectors without mutating the license response before confirmation', async () => {
    const supplied = license(); supplied.featureEntitlements.integrations = true
    mocks.get.mockResolvedValue({ data: supplied }); await render(true)
    const html = await change(moduleControl('Jira'), true, 'onUpdate:checked')
    expect(html).toContain('Jira: habilitar'); expect(supplied.integrationEntitlements.jira).toBeUndefined()
    expect(mocks.update).not.toHaveBeenCalled(); await confirm()
    expect(mocks.update.mock.calls[0]?.[1]).toMatchObject({ featureEntitlements: { integrations: true }, integrationEntitlements: { jira: true, google: false } })
    expect(mocks.saved).toHaveBeenCalledOnce()
  })
  it('emits close from cancellation, card close and modal dismissal but not modal opening', async () => {
    await render(true)
    await invoke(control('NModal'), 'onUpdate:show', true); expect(mocks.close).not.toHaveBeenCalled()
    await invoke(control('NModal'), 'onUpdate:show', false)
    await invoke(control('NCard'), 'onClose')
    await invoke(control('NButton', item => item.text.includes('Cancelar')), 'onClick')
    expect(mocks.close).toHaveBeenCalledTimes(3)
  })
})
