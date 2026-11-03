import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, type ComponentOptions, type ComponentPublicInstance, type Ref, type SetupContext } from 'vue'
import { renderToString } from 'vue/server-renderer'
import TunnelManager from './TunnelManager.vue'
import type { PortForwarding, CreatePortForwardingDto } from '@/services/portForwarding.service'
import type { ActiveTunnel } from '@/composables/useTerminal'
const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), active: vi.fn(), open: vi.fn(), close: vi.fn(), test: vi.fn(), web: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), emit: vi.fn(), slotMode: 'vnode' }))
vi.mock('@/services/portForwarding.service', () => ({ portForwardingService: { list: mocks.list, create: mocks.create, update: mocks.update, remove: mocks.remove } }))
vi.mock('@/services/tunnel.service', () => ({ tunnelService: { list: mocks.active, create: mocks.open, close: mocks.close, testTarget: mocks.test } }))
vi.mock('@/services/features.service', () => ({ featuresService: { get: vi.fn() } }))
vi.mock('@/services/webAccess.service', () => ({ webAccessService: { createLink: mocks.web } }))
vi.mock('@/composables/useTunnelPresence', async importOriginal => {
  const original = await importOriginal<typeof import('@/composables/useTunnelPresence')>()
  const { ref } = await import('vue')
  return { ...original, useTunnelPresence: () => ({ tunnels: ref(null), unavailable: ref(false), refresh: vi.fn() }) }
})
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string, values?: unknown) => values ? `${key}:${JSON.stringify(values)}` : key }) }))
vi.mock('naive-ui', async () => {
  const { defineComponent, h } = await import('vue')
  const { ssrRenderSlot, ssrRenderVNode, ssrRenderAttrs } = await import('vue/server-renderer')
  return { ...Object.fromEntries(['NAlert', 'NButton', 'NEmpty', 'NSpin', 'NTooltip', 'NSwitch', 'NInput', 'NInputNumber'].map(name => [name, defineComponent({ name, inheritAttrs: false,
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
  })])), useMessage: () => ({ success: mocks.success, error: mocks.error, warning: mocks.warning, info: mocks.info }) }
})
const template: PortForwarding = { id: 3, hostId: 11, bindAddress: '127.0.0.1', localPort: 8080, remoteHost: '127.0.0.1', remotePort: 80, autoStart: false, webEnabled: true, webProtocol: 'http', description: ' Web console ', createdAt: '2026-11-03T12:00:00Z' }
const tunnel = { id: 'tunnel-1', hostId: 11, portForwardingId: 3, bindAddress: '127.0.0.1', assignedLocalPort: 8081, requestedLocalPort: 8080, remoteHost: '127.0.0.1', remotePort: 80, usedPortFallback: true, connectionMethod: 'direct', description: 'Web console' } as ActiveTunnel
interface State {
  form: Ref<CreatePortForwardingDto & { description: string }>
  showForm: Ref<boolean>
  loadTemplates: () => Promise<void>
  refreshActiveTunnels: () => Promise<void>
  saveTemplate: () => Promise<void>
  openEditTemplate: (row: PortForwarding) => void
  closeTemplateForm: () => void
  testTarget: () => Promise<void>
  toggleAutoStart: (row: PortForwarding, value: boolean) => Promise<void>
  removeTemplate: (row: PortForwarding) => Promise<void>
  openTunnelFromTemplate: (row: PortForwarding) => Promise<void>
  closeTunnel: (id: string) => Promise<void>
  openWebAccess: (id: number) => Promise<void>
  copyTunnelEndpoint: (row: ActiveTunnel) => Promise<void>
}
let state: State | undefined
async function render(fresh = false, hostId: number | null = 11): Promise<string> {
  const original = TunnelManager as ComponentOptions
  const component = defineComponent({ ...original, async setup(props, context: SetupContext) {
    if (fresh || !state) {
      if (typeof original.setup !== 'function') throw new Error('Missing SFC setup')
      state = original.setup(props, context) as State
      // The component's real immediate host watcher starts both requests.
      await new Promise(resolve => setImmediate(resolve))
    }
    return state
  } })
  const app = createSSRApp(component, { hostId, hostName: 'Host de laboratório', onActiveTunnelsChange: mocks.emit })
  app.config.globalProperties.$t = (key: string) => key
  return renderToString(app)
}
function current(): State { if (!state) throw new Error('Missing setup state'); return state }
beforeEach(() => {
  vi.clearAllMocks(); state = undefined; mocks.slotMode = 'vnode'
  mocks.list.mockResolvedValue({ data: [structuredClone(template)] }); mocks.active.mockResolvedValue({ data: [] })
  mocks.create.mockResolvedValue({ data: template }); mocks.update.mockResolvedValue({ data: { ...template, autoStart: true } })
  mocks.remove.mockResolvedValue({}); mocks.open.mockResolvedValue({ data: tunnel }); mocks.close.mockResolvedValue({})
})
afterEach(() => vi.unstubAllGlobals())
describe('TunnelManager compiled SSR contracts', () => {
  it('loads templates for selected host and avoids any API without a selected host', async () => {
    expect(await render(true)).toContain('Web console')
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(11); expect(mocks.active).toHaveBeenCalledOnce()
    mocks.list.mockClear(); mocks.active.mockClear()
    await render(true, null)
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.active).not.toHaveBeenCalled()
  })
  it('shows template loading failure and recovers through real reload', async () => {
    mocks.list.mockRejectedValueOnce(new Error('offline'))
    expect(await render(true)).toContain('tunnels.refreshError')
    await current().loadTemplates(); expect(await render()).not.toContain('tunnels.refreshError')
  })
  it('rejects incomplete template locally and saves a complete template with scoped payload', async () => {
    await render(true); await current().saveTemplate(); expect(mocks.create).not.toHaveBeenCalled()
    current().form.value = { bindAddress: '127.0.0.1', localPort: 9090, remoteHost: 'db.internal', remotePort: 5432, autoStart: false, webEnabled: false, webProtocol: 'http', description: 'Database' }
    await current().saveTemplate()
    expect(mocks.create).toHaveBeenCalledWith(11, expect.objectContaining({ localPort: 9090, remoteHost: 'db.internal', remotePort: 5432, description: 'Database' }))
    expect(current().form.value.localPort).toBe(0); expect(current().showForm.value).toBe(false)
    expect(mocks.success).toHaveBeenCalledWith('tunnels.templateSaved')
  })
  it('edits existing template and preserves form on API failure, then retries successfully', async () => {
    await render(true); current().openEditTemplate(template)
    expect(await render()).toContain('common.edit')
    mocks.update.mockRejectedValueOnce({ response: { data: { message: 'Denied by tenant policy' } } })
    await current().saveTemplate(); expect(mocks.error).toHaveBeenCalledWith('Denied by tenant policy'); expect(current().showForm.value).toBe(true)
    await current().saveTemplate(); expect(mocks.update).toHaveBeenLastCalledWith(11, 3, expect.objectContaining({ localPort: 8080 })); expect(current().showForm.value).toBe(false)
  })
  it('tests remote target only with complete destination and distinguishes reachable/unreachable/error', async () => {
    await render(true); await current().testTarget(); expect(mocks.test).not.toHaveBeenCalled()
    current().openEditTemplate(template)
    mocks.test.mockResolvedValueOnce({ data: { success: true, message: 'Reachable' } }); await current().testTarget()
    expect(mocks.test).toHaveBeenCalledWith({ hostId: 11, remoteHost: '127.0.0.1', remotePort: 80 }); expect(mocks.success).toHaveBeenCalledWith('Reachable')
    mocks.test.mockResolvedValueOnce({ data: { success: false, message: 'Refused' } }); await current().testTarget(); expect(mocks.warning).toHaveBeenCalledWith('Refused')
    mocks.test.mockRejectedValueOnce(new Error('offline')); await current().testTarget(); expect(mocks.error).toHaveBeenCalledWith('tunnels.testError')
  })
  it('opens once, publishes fallback endpoint and closes using tunnel identity', async () => {
    await render(true); await current().openTunnelFromTemplate(template); await current().openTunnelFromTemplate(template)
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith({ hostId: 11, bindAddress: '127.0.0.1', localPort: 8080, remoteHost: '127.0.0.1', remotePort: 80, description: 'Web console' })
    expect(await render()).toContain('localhost:8081')
    expect(mocks.emit).toHaveBeenCalledWith(expect.objectContaining({ tunnels: [tunnel] }))
    await current().closeTunnel('tunnel-1'); expect(mocks.close).toHaveBeenCalledWith('tunnel-1')
    expect(mocks.emit).toHaveBeenLastCalledWith({ tunnels: [], errors: [] })
  })
  it('updates auto-start and removes template only after successful API responses', async () => {
    await render(true); const row = structuredClone(template)
    mocks.update.mockRejectedValueOnce(new Error('offline')); await current().toggleAutoStart(row, true); expect(row.autoStart).toBe(false)
    await current().toggleAutoStart(row, true); expect(row.autoStart).toBe(true)
    mocks.remove.mockRejectedValueOnce(new Error('offline')); await current().removeTemplate(row); expect(await render()).toContain('Web console')
    await current().removeTemplate(row); expect(await render()).not.toContain('Web console')
    expect(mocks.remove).toHaveBeenLastCalledWith(11, 3)
  })
  it('copies actual assigned endpoint and opens web link with opener isolation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined), open = vi.fn()
    vi.stubGlobal('navigator', { clipboard: { writeText } }); vi.stubGlobal('window', { location: { hostname: 'gateway.example.invalid' }, open })
    await render(true); await current().copyTunnelEndpoint(tunnel)
    expect(writeText).toHaveBeenCalledWith('localhost:8081')
    mocks.web.mockResolvedValue({ data: { url: 'https://gateway.example.invalid/w/fixture', assignedLocalPort: 8081, requestedLocalPort: 8080, usedPortFallback: true } })
    await current().openWebAccess(3)
    expect(mocks.web).toHaveBeenCalledWith(3); expect(open).toHaveBeenCalledWith('https://gateway.example.invalid/w/fixture', '_blank', 'noopener,noreferrer')
    writeText.mockRejectedValueOnce(new Error('denied')); await current().copyTunnelEndpoint(tunnel); expect(mocks.error).toHaveBeenCalledWith('tunnels.endpointCopyError')
  })
  it('renders edit destination and assigned active endpoint through official SSR slots', async () => {
    mocks.slotMode = 'ssr'
    await render(true); current().openEditTemplate(template)
    let html = await render()
    expect(html).toContain('common.edit'); expect(html).toContain('value="8080"'); expect(html).toContain('value="80"')
    current().closeTemplateForm(); await current().openTunnelFromTemplate(template)
    html = await render()
    expect(html).toContain('Web console'); expect(html).toContain('localhost:8081')
    expect(html).toContain('tunnels.templateActiveWithFallbackEndpoint')
    await current().closeTunnel('tunnel-1')
    expect(await render()).not.toContain('localhost:8081')
  })

  it('renders SSR error feedback then a confirmed empty template state after recovery', async () => {
    mocks.slotMode = 'ssr'; mocks.list.mockRejectedValueOnce(new Error('offline'))
    const failed = await render(true)
    expect(failed).toContain('tunnels.refreshError'); expect(failed).toContain('tunnels.retry')
    mocks.list.mockResolvedValue({ data: [] }); await current().loadTemplates()
    const empty = await render()
    expect(empty).not.toContain('tunnels.refreshError'); expect(empty).toContain('tunnels.emptyTemplates')
    expect(empty).toContain('tunnels.emptyTemplatesHint'); expect(empty).not.toContain('Web console')
  })

})
