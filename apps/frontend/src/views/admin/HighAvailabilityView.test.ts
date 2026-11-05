import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, type ComponentOptions, type ComponentPublicInstance, type SetupContext } from 'vue'
import { renderToString } from 'vue/server-renderer'
import HighAvailability from './HighAvailabilityView.vue'
import type { HaNode, HaOperation } from '@/services/ha.service'

const mocks = vi.hoisted(() => ({
  listNodes: vi.fn(), listOperations: vi.fn(), setEntitlement: vi.fn(), reconcileObservedRoles: vi.fn(), runPreflight: vi.fn(),
  startPlannedSwitchover: vi.fn(), runRejoinPreflight: vi.fn(), createProvisioningPlan: vi.fn(), queueInventoryRefresh: vi.fn(),
  installRelease: vi.fn(), applySharedSecrets: vi.fn(), rollbackSharedSecrets: vi.fn(), prepareStorageDirectories: vi.fn(),
  rollbackStorageDirectories: vi.fn(), validateStorageWriteAccess: vi.fn(), createEnrollment: vi.fn(), removeNode: vi.fn(),
  success: vi.fn(), warning: vi.fn(), error: vi.fn(), writeText: vi.fn(), slotMode: 'ssr',
}))
vi.mock('@/services/ha.service', () => ({ haService: mocks }))
vi.mock('naive-ui', async () => {
  const { defineComponent, h } = await import('vue')
  const { ssrRenderSlot, ssrRenderAttrs, ssrRenderVNode } = await import('vue/server-renderer')
  const shell = (name: string): ReturnType<typeof defineComponent> => defineComponent({ name, inheritAttrs: false,
    ssrRender(context: ComponentPublicInstance, push: Parameters<typeof ssrRenderSlot>[4], parent: Parameters<typeof ssrRenderSlot>[5]) {
      const attrs = context.$attrs, slots = context.$slots
      if (name === 'NModal' && !attrs.show) return
      const chunks: string[] = [], tag = name === 'NButton' ? 'button' : 'section'
      if (mocks.slotMode === 'vnode') {
        // Naive render components call slots without the SSR push argument (resolveSlot).
        const children = Object.values(slots).flatMap(slot => slot?.() ?? [])
        controls.push({ name, attrs: { ...attrs }, text: content(children) })
        ssrRenderVNode(push, h(tag, attrs, children), parent)
        return
      }
      push(`<${tag}${ssrRenderAttrs(attrs, tag)}>`)
      for (const key of Object.keys(slots)) ssrRenderSlot(slots, key, {}, null, value => { if (typeof value === 'string') chunks.push(value); push(value) }, parent)
      push(`</${tag}>`)
      controls.push({ name, attrs: { ...attrs }, text: chunks.join('') })
    },
  })
  return { useMessage: () => ({ success: mocks.success, warning: mocks.warning, error: mocks.error }),
    ...Object.fromEntries(['NAlert', 'NButton', 'NCard', 'NDescriptions', 'NDescriptionsItem', 'NEmpty', 'NForm', 'NFormItem', 'NInput', 'NModal', 'NPopconfirm', 'NProgress', 'NSelect', 'NSpace', 'NSpin', 'NTag'].map(name => [name, shell(name)])) }
})
// Child presentation and library portals are boundaries; their browser implementation is covered separately.
vi.mock('@/components/ha/HaHelpTooltip.vue', () => ({ default: { props: ['label'], template: '<span>{{ label }}</span>' } }))
vi.mock('@/components/ha/HaTopologyMap.vue', () => ({ default: { template: '<aside>Mapa de topologia</aside>' } }))
vi.mock('@/components/ha/HaFailurePolicyGuide.vue', () => ({ default: { template: '<aside>Política de falhas</aside>' } }))
vi.mock('@/components/ha/HaIncidentGuide.vue', () => ({ default: { template: '<aside>Guia de incidente</aside>' } }))
vi.mock('@/components/ha/HaSetupWizard.vue', () => ({ default: { template: '<aside>Assistente de implantação</aside>' } }))
vi.mock('@/components/CollapsibleSection.vue', () => ({ default: { template: '<section><slot /></section>' } }))

type Control = { name: string; attrs: Record<string, unknown>; text: string }
const controls: Control[] = []
function content(value: unknown): string {
  if (Array.isArray(value)) return value.map(content).join(' ')
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'children' in value) return content(value.children)
  return ''
}
let state: { load: (spinner?: boolean) => Promise<void> } | undefined
let pendingLoad: Promise<void> | undefined
function node(role: 'PRIMARY' | 'STANDBY', overrides: Partial<HaNode> = {}): HaNode {
  return { id: role.toLowerCase(), name: `${role} sintético`, endpoint: role === 'PRIMARY' ? '192.0.2.10' : '192.0.2.11',
    desiredRole: role, observedRole: role, ownsVip: role === 'PRIMARY', virtualIp: '192.0.2.100', status: 'HEALTHY',
    promotionReady: true, blockers: [], notices: [], heartbeatAgeSeconds: 5, heartbeatState: 'CURRENT',
    components: { mysql: { status: 'ok', lagSeconds: 0 }, redis: { status: 'ok' }, files: { status: 'ok' } },
    inventory: { hostname: role.toLowerCase(), operatingSystem: 'Linux', architecture: 'x64', cpuCores: 4, memoryTotalMb: 8192, diskFreeMb: 40960, dockerInstalled: true, dockerVersion: 'test', composeInstalled: true },
    secureProvisioningReady: true, enrolledAt: '2026-11-01T00:00:00Z', lastSeenAt: '2026-11-04T10:00:00Z', createdAt: '2026-11-01T00:00:00Z', ...overrides }
}
function operation(overrides: Partial<HaOperation> = {}): HaOperation {
  return { id: 'operation-fixture', nodeId: 'standby', nodeName: 'STANDBY sintético', type: 'PREFLIGHT', status: 'READY', currentStage: 'finished',
    steps: [{ key: 'replication', label: 'Replicação', status: 'ok' }], errorLayer: null, errorMessage: null, initiatedById: 1,
    startedAt: '2026-11-04T10:00:00Z', finishedAt: '2026-11-04T10:00:01Z', ...overrides }
}
function control(name: string, predicate: (value: Control) => boolean): Control {
  const found = controls.find(value => value.name === name && predicate(value))
  if (!found) throw new Error(`Rendered control missing: ${name}`)
  return found
}
const button = (text: string): Control => control('NButton', value => value.text.includes(text))
async function invoke(item: Control, event = 'onClick', value: unknown = { preventDefault() {}, stopPropagation() {} }): Promise<void> {
  const handler = item.attrs[event]
  expect(typeof handler).toBe('function')
  await (handler as (value: unknown) => unknown)(value)
}
async function update(placeholder: string, value: string): Promise<void> {
  await invoke(control('NInput', item => item.attrs.placeholder === placeholder), 'onUpdate:value', value)
}
async function render(fresh = false, wait = true): Promise<string> {
  controls.length = 0
  const original = HighAvailability as ComponentOptions
  const wrapper = defineComponent({ ...original, async setup(props, context: SetupContext) {
    if (fresh || !state) {
      if (typeof original.setup !== 'function') throw new Error('Original SFC setup missing')
      state = original.setup(props, context) as typeof state
      if (!state) throw new Error('Original SFC setup has no state')
      pendingLoad = state.load()
      if (wait) await pendingLoad
    }
    return state
  } })
  return renderToString(createSSRApp(wrapper))
}
function apiFailure(message?: string): { response: { status: number; data: { message?: string } } } { return { response: { status: 500, data: { message } } } }
beforeEach(() => {
  state = undefined; pendingLoad = undefined; vi.resetAllMocks()
  vi.stubGlobal('window', { location: { host: 'nodeaccess.example.invalid', origin: 'https://nodeaccess.example.invalid', protocol: 'https:' } })
  vi.stubGlobal('navigator', { clipboard: { writeText: mocks.writeText } })
  mocks.listNodes.mockResolvedValue({ data: [node('PRIMARY'), node('STANDBY')] })
  mocks.listOperations.mockResolvedValue({ data: [] })
  mocks.runPreflight.mockResolvedValue({ data: operation() })
  mocks.runRejoinPreflight.mockResolvedValue({ data: operation() })
  mocks.createProvisioningPlan.mockResolvedValue({ data: operation({ type: 'PROVISION_PLAN' }) })
  mocks.createEnrollment.mockResolvedValue({ data: { id: 'enrolled-fixture', token: 'synthetic-enrollment-placeholder' } })
})
afterEach(() => { vi.unstubAllGlobals() })

describe.each(['ssr', 'vnode'] as const)('HA original SSR contracts with %s slot provider', mode => {
  beforeEach(() => { mocks.slotMode = mode })
  it('renders healthy roles, inventory and fencing guidance without calling any mutation', async () => {
    const html = await render(true)
    expect(html).toContain('Standby pronto para failover'); expect(html).toContain('STANDBY sintético'); expect(html).toContain('Linux')
    expect(mocks.startPlannedSwitchover).not.toHaveBeenCalled(); expect(mocks.createEnrollment).not.toHaveBeenCalled()
    expect(button('Executar preflight').attrs.disabled).not.toBe(true)
  })
  it('renders empty topology and allows enrollment only after name and VIP are provided', async () => {
    mocks.listNodes.mockResolvedValue({ data: [] }); expect(await render(true)).toContain('Nenhum nó HA anexado')
    await invoke(button('Anexar nó')); await render()
    const form = control('NForm', item => typeof item.attrs.onSubmit === 'function')
    await invoke(form, 'onSubmit'); expect(mocks.createEnrollment).not.toHaveBeenCalled()
    await update('Ex.: nodeaccess-b', '  standby novo  '); await invoke(form, 'onSubmit'); expect(mocks.createEnrollment).not.toHaveBeenCalled()
    await update('Ex.: 192.168.1.105', '192.0.2.100'); await update('Ex.: 192.168.1.101', '192.0.2.11'); await render()
    await invoke(control('NForm', item => typeof item.attrs.onSubmit === 'function'), 'onSubmit')
    expect(mocks.createEnrollment).toHaveBeenCalledWith({ name: 'standby novo', endpoint: '192.0.2.11', desiredRole: 'STANDBY' })
    const html = await render(); expect(html).toContain('enrolled-fixture'); expect(html).toContain('192.0.2.100'); expect(mocks.success).toHaveBeenCalledWith(expect.stringContaining('Matrícula criada'))
  })
  it('keeps loading observable until both read requests settle', async () => {
    let release: ((value: { data: HaNode[] }) => void) | undefined
    mocks.listNodes.mockImplementation(() => new Promise(resolve => { release = resolve }))
    await render(true, false); expect(control('NSpin', () => true).attrs.show).toBe(true)
    release?.({ data: [] }); await pendingLoad; await render(); expect(control('NSpin', () => true).attrs.show).toBe(false)
  })
  it('renders unlicensed state, then enables and reloads topology through the public action', async () => {
    mocks.listNodes.mockRejectedValueOnce({ response: { status: 403 } })
    expect(await render(true)).toContain('Recurso não habilitado na licença')
    expect(controls.some(item => item.name === 'NButton' && item.text.includes('Anexar nó'))).toBe(false)
    await invoke(button('Habilitar alta disponibilidade')); expect(mocks.setEntitlement).toHaveBeenCalledWith(true)
    expect(await render()).toContain('Standby pronto para failover')
  })
  it('shows service error and restores topology on reload without an implicit operation', async () => {
    mocks.listNodes.mockRejectedValueOnce(apiFailure('Falha sintética de consulta'))
    expect(await render(true)).toContain('Falha sintética de consulta')
    await state?.load(); expect(await render()).toContain('Standby pronto para failover'); expect(mocks.startPlannedSwitchover).not.toHaveBeenCalled()
  })
  it.each([
    ['split brain', [node('PRIMARY'), node('STANDBY', { ownsVip: true })], 'Mais de um nó confirmou a VIP'],
    ['degraded standby', [node('PRIMARY'), node('STANDBY', { promotionReady: false, blockers: ['Redis indisponível'], status: 'DEGRADED' })], 'Há nós que não podem ser promovidos'],
    ['role mismatch', [node('PRIMARY', { desiredRole: 'STANDBY' }), node('STANDBY', { desiredRole: 'PRIMARY' })], 'Papéis configurados divergem'],
  ] as const)('renders %s as a distinct safety state', async (_name, nodes, expected) => {
    mocks.listNodes.mockResolvedValue({ data: nodes }); expect(await render(true)).toContain(expected)
    expect(mocks.startPlannedSwitchover).not.toHaveBeenCalled()
  })
  it('keeps role reconciliation disabled while a heartbeat is stale', async () => {
    mocks.listNodes.mockResolvedValue({ data: [node('PRIMARY', { desiredRole: 'STANDBY' }), node('STANDBY', { heartbeatState: 'STALE', desiredRole: 'PRIMARY' })] })
    await render(true); expect(button('Confirmar papéis observados').attrs.disabled).toBe(true); expect(mocks.reconcileObservedRoles).not.toHaveBeenCalled()
  })
  it.each(['READY', 'BLOCKED', 'error'] as const)('reports preflight %s and clears loading after the attempt', async outcome => {
    if (outcome === 'error') mocks.runPreflight.mockRejectedValueOnce(apiFailure('Preflight indisponível'))
    else mocks.runPreflight.mockResolvedValueOnce({ data: operation({ status: outcome, errorMessage: outcome === 'BLOCKED' ? 'Réplica atrasada' : null }) })
    await render(true); await invoke(button('Executar preflight')); expect(mocks.runPreflight).toHaveBeenCalledWith('standby')
    await render(); expect(button('Executar preflight').attrs.loading).toBe(false)
    if (outcome === 'READY') expect(mocks.success).toHaveBeenCalledWith(expect.stringContaining('Preflight aprovado'))
    else if (outcome === 'BLOCKED') expect(mocks.warning).toHaveBeenCalledWith('Réplica atrasada')
    else expect(mocks.error).toHaveBeenCalledWith('Preflight indisponível')
    expect(mocks.startPlannedSwitchover).not.toHaveBeenCalled()
  })
  it('blocks planned switchover until confirmation and safe witness names, then sends only reviewed filenames', async () => {
    await render(true); await invoke(button('Promover este nó')); let html = await render()
    expect(html).toContain('O que é o witness?'); expect(html).toContain('192.0.2.11')
    expect(button('Iniciar troca planejada').attrs.disabled).toBe(true)
    const submit = (): Control => control('NForm', item => item.attrs.class === 'switchover-form')
    await invoke(submit(), 'onSubmit'); expect(mocks.startPlannedSwitchover).not.toHaveBeenCalled()
    await update('TROCAR', 'TROCAR'); await update('switchover-...txt', '../escape.txt'); await render()
    expect(button('Iniciar troca planejada').attrs.disabled).toBe(true)
    await invoke(submit(), 'onSubmit'); expect(mocks.startPlannedSwitchover).not.toHaveBeenCalled()
    await update('switchover-...txt', 'reviewed.txt'); await update('switchover-...sig', 'reviewed.sig'); await render()
    expect(button('Iniciar troca planejada').attrs.disabled).toBe(false)
    await invoke(submit(), 'onSubmit')
    expect(mocks.startPlannedSwitchover).toHaveBeenCalledExactlyOnceWith('standby', { witnessEvidenceFile: 'reviewed.txt', witnessSignatureFile: 'reviewed.sig' })
    html = await render(); expect(html).not.toContain('O que é o witness?'); expect(mocks.success).toHaveBeenCalledWith(expect.stringContaining('Troca planejada iniciada'))
  })
  it('keeps the reviewed switchover form recoverable and clears spinner when service rejects', async () => {
    mocks.startPlannedSwitchover.mockRejectedValueOnce(apiFailure('Witness expirado'))
    await render(true); await invoke(button('Promover este nó')); await render(); await update('TROCAR', 'TROCAR'); await render()
    await invoke(control('NForm', item => item.attrs.class === 'switchover-form'), 'onSubmit')
    const html = await render(); expect(html).toContain('O que é o witness?'); expect(mocks.error).toHaveBeenCalledWith('Witness expirado')
    expect(button('Iniciar troca planejada').attrs.loading).toBe(false)
  })
  it('shows ongoing work, exact progress and failed stages while promotion stays disabled', async () => {
    mocks.listOperations.mockResolvedValue({ data: [operation({ status: 'RUNNING', currentStage: 'SYNC', steps: [
      { key: 'copy', label: 'Copiar dados', status: 'ok' }, { key: 'replica', label: 'Conferir réplica', status: 'required' },
    ] }), operation({ id: 'failed', status: 'FAILED', errorLayer: 'storage', errorMessage: 'Sem espaço', steps: [{ key: 'disk', label: 'Disco', status: 'failed', message: 'Capacidade insuficiente' }] })] })
    const html = await render(true)
    expect(html).toContain('Alteração da topologia em andamento'); expect(html).toContain('SYNC'); expect(html).toContain('Capacidade insuficiente'); expect(html).toContain('Camada storage: Sem espaço')
    expect(control('NProgress', value => value.attrs['aria-label'] === 'Progresso da operação HA').attrs.percentage).toBe(50)
    expect(button('Promover este nó').attrs.disabled).toBe(true); expect(mocks.startPlannedSwitchover).not.toHaveBeenCalled()
  })
  it('renders rejoin instructions for the former primary without exposing planned promotion submission', async () => {
    mocks.listNodes.mockResolvedValue({ data: [node('PRIMARY'), node('STANDBY', { desiredRole: 'PRIMARY' })] })
    await render(true); await invoke(button('Retornar como standby')); const html = await render()
    expect(html).toContain('Manter o nó antigo sem VIP'); expect(html).toContain('GTIDs divergentes')
    expect(controls.some(item => item.name === 'NButton' && item.text.includes('Iniciar troca planejada'))).toBe(false)
    expect(mocks.startPlannedSwitchover).not.toHaveBeenCalled()
  })
  it('requires a valid release URL and SHA256, normalizes the approved payload and preserves state on failure', async () => {
    mocks.listOperations.mockResolvedValue({ data: [operation({ type: 'PROVISION_PLAN' })] })
    await render(true); expect(button('Instalar release').attrs.disabled).toBe(false); await invoke(button('Instalar release')); await render()
    const submit = (): Control => control('NForm', item => item.attrs.class === 'release-form')
    await invoke(submit(), 'onSubmit'); expect(mocks.installRelease).not.toHaveBeenCalled()
    await update('https://releases.exemplo/nodeaccess-release-2.0.28.tar.gz', ' https://releases.example.invalid/release.tar.gz ')
    await update('fdb3ef...', 'ABC'); await render(); expect(button('Autorizar instalação').attrs.disabled).toBe(true)
    await invoke(submit(), 'onSubmit'); expect(mocks.installRelease).not.toHaveBeenCalled()
    await update('fdb3ef...', 'A'.repeat(64)); await render(); mocks.installRelease.mockRejectedValueOnce(apiFailure('Checksum recusado'))
    await invoke(submit(), 'onSubmit'); await render(); expect(mocks.error).toHaveBeenCalledWith('Checksum recusado'); expect(button('Autorizar instalação').attrs.loading).toBe(false)
    await invoke(submit(), 'onSubmit'); expect(mocks.installRelease).toHaveBeenLastCalledWith('standby', { releaseUrl: 'https://releases.example.invalid/release.tar.gz', sha256: 'a'.repeat(64) })
    expect(await render()).not.toContain('Instalação controlada'); expect(mocks.success).toHaveBeenCalledWith(expect.stringContaining('Instalação enfileirada'))
  })
  it('renders missing inventory and stale telemetry explicitly without inventing readiness', async () => {
    mocks.listNodes.mockResolvedValue({ data: [node('STANDBY', { inventory: null, endpoint: null, heartbeatState: 'STALE', heartbeatAgeSeconds: null, lastSeenAt: null, observedRole: null, promotionReady: false, status: 'OFFLINE', notices: ['Aguardando inventário'], blockers: ['Heartbeat expirou'], components: { mysql: { status: 'unknown', message: 'Sem telemetria' } } })] })
    const html = await render(true)
    expect(html).toContain('Aguardando inventário'); expect(html).toContain('Heartbeat expirou'); expect(html).toContain('Nunca recebido')
    expect(mocks.startPlannedSwitchover).not.toHaveBeenCalled()
  })

  it.each([
    ['rejoin', 'Validar retorno', 'runRejoinPreflight', 'standby'],
    ['provisioning plan', 'Avaliar provisionamento', 'createProvisioningPlan', 'primary'],
  ] as const)('keeps %s failure visible and retry available', async (_kind, label, method, selectedNode) => {
    mocks[method].mockRejectedValueOnce(apiFailure('Falha operacional simulada'))
    await render(true); await invoke(button(label)); await render()
    expect(mocks[method]).toHaveBeenCalledWith(selectedNode); expect(mocks.error).toHaveBeenCalledWith('Falha operacional simulada')
    expect(button(label).attrs.loading).toBe(false)
    await invoke(button(label)); expect(mocks[method]).toHaveBeenCalledTimes(2); expect(mocks.success).toHaveBeenCalled()
  })
  it('preserves attached nodes when disabling the entitlement is rejected', async () => {
    mocks.setEntitlement.mockRejectedValueOnce(apiFailure('Remova os nós antes de desabilitar'))
    await render(true); await invoke(control('NPopconfirm', item => item.text.includes('Desabilitar alta disponibilidade?')), 'onPositiveClick')
    const html = await render(); expect(mocks.setEntitlement).toHaveBeenCalledWith(false); expect(html).toContain('STANDBY sintético')
    expect(mocks.error).toHaveBeenCalledWith('Remova os nós antes de desabilitar'); expect(button('Desabilitar HA').attrs.loading).toBe(false)
  })
  it('reconciles observed roles only after confirmation and reports backend rejection without changing displayed roles', async () => {
    mocks.listNodes.mockResolvedValue({ data: [node('PRIMARY', { desiredRole: 'STANDBY' }), node('STANDBY', { desiredRole: 'PRIMARY' })] })
    mocks.reconcileObservedRoles.mockRejectedValueOnce(apiFailure('Topologia mudou durante confirmação'))
    await render(true); expect(button('Confirmar papéis observados').attrs.disabled).toBe(false)
    await invoke(control('NPopconfirm', item => item.text.includes('Registrar os papéis observados')), 'onPositiveClick')
    expect(mocks.reconcileObservedRoles).toHaveBeenCalledOnce(); expect(mocks.error).toHaveBeenCalledWith('Topologia mudou durante confirmação')
    expect(await render()).toContain('Papéis configurados divergem'); expect(button('Confirmar papéis observados').attrs.loading).toBe(false)
  })

})
