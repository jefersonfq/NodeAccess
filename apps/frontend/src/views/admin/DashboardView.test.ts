import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, type ComponentOptions, type SetupContext } from 'vue'
import { renderToString } from 'vue/server-renderer'
import Dashboard from './DashboardView.vue'
import fixture from './dashboard-contracts.fixture.json'

const mocks = vi.hoisted(() => ({ getStats: vi.fn(), getSettings: vi.fn(), caches: vi.fn(), push: vi.fn() }))
vi.mock('@/services/dashboard.service', () => ({ dashboardService: { getStats: mocks.getStats } }))
vi.mock('@/services/settings.service', () => ({ settingsService: { get: mocks.getSettings } }))
vi.mock('@/services/service-cache', () => ({ listCacheRegistry: mocks.caches }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push }) }))
const translate = (key: string, params?: Record<string, unknown>): string => params ? `${key}:${JSON.stringify(params)}` : key
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => translate(key, params) }) }))
vi.mock('naive-ui', async () => {
  const { defineComponent, h } = await import('vue')
  const shell = (name: string) => defineComponent({ name, inheritAttrs: false, setup(_, { attrs, slots }) {
    return () => { const children = Object.values(slots).flatMap(slot => slot?.() ?? []); controls.push({ tag: name, attrs: { ...attrs }, content: content(children) }); return h(name, attrs, children) }
  } })
  return Object.fromEntries(['NCard', 'NSpin', 'NAlert', 'NText', 'NTag', 'NButton', 'NModal', 'NDataTable'].map(name => [name, name === 'NDataTable'
    ? defineComponent({ name, setup(_, { attrs }) { return () => h(name, attrs,
      (attrs.data as Record<string, unknown>[]).flatMap(row => (attrs.columns as { render: (row: Record<string, unknown>) => ReturnType<typeof h> }[]).map(column => column.render(row)))) } })
    : shell(name)]))
})

type State = { load: () => Promise<void>; handleCardKeydown: (event: { key: string; preventDefault: () => void }, action: () => void) => void; openActiveUsers: () => void; openRegisteredHosts: () => void; openActiveSessions: () => void; openTodaySessionsReport: () => void; openClientUxReport: () => void; openHostKeyLogs: (action?: string) => void; openClientUxLogs: (action?: string) => void }
type Control = { tag: string; attrs: Record<string, unknown>; content: string }
function content(value: unknown): string {
  if (Array.isArray(value)) return value.map(content).join(' ')
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'children' in value) return content(value.children)
  return ''
}
function button(label: string): Control {
  const found = controls.find(item => item.tag === 'NButton' && item.content.includes(label))
  if (!found) throw new Error(`Missing rendered button: ${label}`)
  return found
}
const controls: Control[] = []
let state: State | undefined
async function render(fresh = false, waitForLoad = true): Promise<string> {
  controls.length = 0
  const original = Dashboard as ComponentOptions
  const component = defineComponent({ ...original, async setup(props, context: SetupContext) {
    if (fresh || !state) {
      if (typeof original.setup !== 'function') throw new Error('SFC setup missing')
      state = original.setup(props, context) as State
      const loading = state.load()
      if (waitForLoad) await loading
    }
    return state
  } })
  const app = createSSRApp(component)
  app.config.globalProperties.$t = translate
  return renderToString(app)
}
function control(tag: string, predicate: (attrs: Record<string, unknown>) => boolean): Control {
  const found = controls.find(item => item.tag === tag && predicate(item.attrs))
  if (!found) throw new Error(`Missing rendered ${tag}`)
  return found
}
async function invoke(item: Control, event = 'onClick', payload: unknown = { stopPropagation() {} }): Promise<void> {
  const handler = item.attrs[event]
  expect(typeof handler).toBe('function')
  await (handler as (event: unknown) => unknown)(payload)
}
beforeEach(() => {
  state = undefined
  vi.clearAllMocks()
  mocks.getStats.mockResolvedValue({ data: structuredClone(fixture.stats) })
  mocks.getSettings.mockResolvedValue({ data: structuredClone(fixture.settings) })
  mocks.caches.mockReturnValue([]); mocks.push.mockResolvedValue(undefined)
})
describe('admin Dashboard compiled SSR contracts', () => {
  it('renders aggregates, authentication fallbacks, license states and provider names', async () => {
    const html = await render(true)
    expect(mocks.getStats).toHaveBeenCalledOnce(); expect(mocks.getSettings).toHaveBeenCalledOnce()
    expect(html).toContain('Operador de teste'); expect(html).toContain('admin.dashboard.anonymous')
    expect(html).toContain('admin.logs.events.LOGIN_FAILED'); expect(html).toContain('192.0.2.9')
    expect(html).toContain('JIRA'); expect(html).toContain('Google'); expect(html).toContain('1Password')
    expect(html).toContain('Agentes'); expect(html).toContain('No limite'); expect(html).toContain('Próximo do limite')
    expect(control('NSpin', () => true).attrs.show).toBe(false)
  })
  it.each(['dashboard', 'settings'])('shows %s failure and recovers via rendered refresh handler', async service => {
    const api = service === 'dashboard' ? mocks.getStats : mocks.getSettings
    api.mockRejectedValueOnce(new Error('offline'))
    expect(await render(true)).toContain('Erro ao carregar estatísticas')
    await invoke(control('NButton', attrs => attrs.size === 'small' && attrs.ghost === ''))
    const html = await render()
    expect(html).not.toContain('Erro ao carregar estatísticas'); expect(html).toContain('Operador de teste')
    expect(mocks.getStats).toHaveBeenCalledTimes(2)
  })
  it('expands weighted cache summary and orders only the three most-read degraded caches', async () => {
    mocks.caches.mockReturnValue([1, 2, 3, 4].map(n => ({ name: `Cache${n}`, entryCount: n, canRefresh: n === 1, stats: { hits: 1, misses: n * 10 }, hitRate: 1 / (1 + n * 10), totalReads: 1 + n * 10 })))
    const initial = await render(true)
    expect(initial).toContain('4 alertas'); expect(initial).toContain('Hit rate 4%')
    await invoke(button('Expandir'))
    const expanded = await render()
    expect(expanded).toContain('4 com entradas em memória'); expect(expanded).toContain('1 com renovação manual')
    expect(expanded).toContain('Cache4'); expect(expanded).toContain('Cache3'); expect(expanded).toContain('Cache2'); expect(expanded).not.toContain('Cache1')
    expect(expanded.indexOf('Cache4')).toBeLessThan(expanded.indexOf('Cache3'))
    await invoke(button('Recolher'))
    expect(await render()).not.toContain('Cache4')
  })
  it('routes six cards using Enter or Space, ignores unrelated keys and preserves report filters', async () => {
    const html = await render(true)
    expect(html.match(/role="link"/g)).toHaveLength(6)
    if (!state) throw new Error('Missing setup state')
    const current = state
    const actions = [current.openActiveUsers, current.openRegisteredHosts, current.openActiveSessions, current.openTodaySessionsReport, current.openClientUxReport, current.openHostKeyLogs]
    const destinations = [
      { name: 'admin-users' }, { name: 'hosts' },
      { name: 'admin-reports-sessions', query: { active: 'true' } },
      { name: 'admin-reports-sessions', query: { periodDays: '1' } },
      { name: 'admin-reports-client-ux' }, { name: 'admin-reports-host-keys', query: {} },
    ]
    for (const [index, action] of actions.entries()) {
      const preventDefault = vi.fn()
      current.handleCardKeydown({ key: index % 2 ? ' ' : 'Enter', preventDefault }, action)
      expect(preventDefault).toHaveBeenCalledOnce(); expect(mocks.push).toHaveBeenLastCalledWith(destinations[index])
      const calls = mocks.push.mock.calls.length
      current.handleCardKeydown({ key: 'Escape', preventDefault }, action)
      expect(mocks.push).toHaveBeenCalledTimes(calls)
      action(); expect(mocks.push).toHaveBeenLastCalledWith(destinations[index])
    }
  })
  it('opens and dismisses user detail, and navigates to the dedicated user report', async () => {
    await render(true)
    await invoke(button('admin.dashboard.adoption.viewUserDetail'))
    await render()
    expect(control('NModal', () => true).attrs.show).toBe(true)
    expect(control('NModal', () => true).attrs.title).toContain('Operador de teste')
    await invoke(control('NModal', () => true), 'onUpdate:show', true)
    await render(); expect(control('NModal', () => true).attrs.show).toBe(true)
    await invoke(control('NModal', () => true), 'onUpdate:show', false)
    await render(); expect(control('NModal', () => true).attrs.show).toBe(false)
    await invoke(button('admin.dashboard.adoption.openUserPage'))
    expect(mocks.push).toHaveBeenLastCalledWith({ name: 'admin-dashboard-user', params: { userId: 9 } })
  })
  it('renders unlimited licenses, no entitlements and zero-read caches without ratios or false alerts', async () => {
    const settings = structuredClone(fixture.settings)
    mocks.getSettings.mockResolvedValue({ data: { ...settings, license: { ...settings.license, maxUsers: null, maxHosts: null,
      featureEntitlements: {}, integrationEntitlements: {} }, sessionLimits: { activeSessions: 0, maxPerTenant: null } } })
    const stats = structuredClone(fixture.stats)
    mocks.getStats.mockResolvedValue({ data: { ...stats, maxUsers: null, tagStats: [], recentAuthLogs: [], adoption: {
      topActiveUsers: [], topHosts: [], topScreens: [], topResources: [], userResourceUsage: [], userDrilldowns: [],
    } } })
    const html = await render(true)
    expect(html).toContain('Sem limite'); expect(html).toContain('common.none'); expect(html).toContain('Sem alertas')
    expect(html).toContain('Hit rate —'); expect(html).not.toContain('NaN'); expect(html).not.toContain('Infinity')
    await invoke(button('Expandir'))
    expect(await render()).toContain('Nenhum cache com leitura suficiente e hit rate degradado.')
  })

  it('keeps the spinner active while services are pending and settles after both complete', async () => {
    let resolveStats: (value: unknown) => void = () => { throw new Error('Deferred response not initialized') }
    mocks.getStats.mockReturnValue(new Promise(resolve => { resolveStats = resolve }))
    const initial = await render(true, false)
    expect(control('NSpin', () => true).attrs.show).toBe(true)
    expect(initial).not.toContain('Operador de teste')
    resolveStats({ data: fixture.stats }); await Promise.resolve(); await Promise.resolve()
    expect(await render()).toContain('Operador de teste')
    expect(control('NSpin', () => true).attrs.show).toBe(false)
  })
  it.each([0, 7, 8, 9, 10])('renders license boundary at %i of ten without invalid ratios', async activeUsers => {
    const settings = structuredClone(fixture.settings)
    settings.license.activeUsers = activeUsers
    settings.license.registeredHosts = 0
    settings.sessionLimits.activeSessions = 0
    mocks.getSettings.mockResolvedValue({ data: settings })
    const html = await render(true)
    const expected = activeUsers >= 9 ? 'No limite' : activeUsers >= 7 ? 'Próximo do limite' : 'Dentro do limite'
    expect(html).toContain(expected)
    const tags = controls.filter(item => item.tag === 'NTag' && item.content.includes(expected))
    expect(tags.some(item => item.attrs.type === (activeUsers >= 9 ? 'error' : activeUsers >= 7 ? 'warning' : 'success'))).toBe(true)
    expect(html).not.toContain('NaN')
  })
  it('preserves ClientUx and host-key report action filters and settings navigation', async () => {
    await render(true)
    if (!state) throw new Error('Missing setup state')
    state.openClientUxLogs('CLIENT_UX_SESSION_EXPIRED')
    expect(mocks.push).toHaveBeenLastCalledWith({ name: 'admin-logs', query: { tab: 'admin', targetType: 'ClientUx', action: 'CLIENT_UX_SESSION_EXPIRED' } })
    state.openClientUxLogs()
    expect(mocks.push).toHaveBeenLastCalledWith({ name: 'admin-logs', query: { tab: 'admin', targetType: 'ClientUx' } })
    state.openHostKeyLogs('HOST_KEY_UPDATED')
    expect(mocks.push).toHaveBeenLastCalledWith({ name: 'admin-reports-host-keys', query: { status: 'HOST_KEY_UPDATED' } })
    await invoke(button('Gerenciar licença'))
    expect(mocks.push).toHaveBeenLastCalledWith({ name: 'admin-settings' })
    await invoke(button('Abrir detalhes'))
    expect(mocks.push).toHaveBeenLastCalledWith({ name: 'admin-settings' })
  })
  it('shows fallback provider/event names and missing email/IP without hiding audit rows', async () => {
    const stats = structuredClone(fixture.stats)
    mocks.getStats.mockResolvedValue({ data: { ...stats, recentAuthLogs: [{ ...stats.recentAuthLogs[0], eventType: 'FUTURE_EVENT', userEmail: null, ip: null }] } })
    const settings = structuredClone(fixture.settings)
    mocks.getSettings.mockResolvedValue({ data: { ...settings, license: { ...settings.license, integrationEntitlements: { futureProvider: true } } } })
    const html = await render(true)
    expect(html).toContain('FUTURE_EVENT'); expect(html).toContain('futureProvider'); expect(html).toContain('—')
    expect(controls.some(item => item.tag === 'NTag' && item.attrs.type === 'default' && item.content === 'FUTURE_EVENT')).toBe(true)
  })

})
