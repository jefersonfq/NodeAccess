import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, type ComponentOptions, type ComponentPublicInstance, type SetupContext } from 'vue'
import { renderToString } from 'vue/server-renderer'
import Diagnostic from './DiagnosticRunDetailView.vue'
import fixture from './diagnostic-contracts.fixture.json'

const mocks = vi.hoisted(() => ({
  getRun: vi.fn(), getReport: vi.fn(), getSettings: vi.fn(), updateTraceability: vi.fn(), publishReportToJira: vi.fn(),
  listRunsForHost: vi.fn(), compareRuns: vi.fn(), regenerateSummary: vi.fn(), download: vi.fn(), saveBlobAs: vi.fn(),
  slotMode: 'vnode', push: vi.fn(), success: vi.fn(), writeText: vi.fn(), params: { runId: '41' }, setTimeout: vi.fn(), clearTimeout: vi.fn(),
}))
vi.mock('@/services/diagnostic-playbook.service', () => ({ diagnosticPlaybookService: mocks }))
vi.mock('@/services/settings.service', () => ({ settingsService: { get: mocks.getSettings } }))
vi.mock('vue-router', () => ({ useRoute: () => ({ params: mocks.params }), useRouter: () => ({ push: mocks.push, resolve: () => ({ href: '/diagnostic-runs/41' }) }) }))
vi.mock('naive-ui', async () => {
  const { defineComponent, h } = await import('vue')
  const { ssrRenderSlot, ssrRenderVNode, ssrRenderAttrs } = await import('vue/server-renderer')
  const shell = (name: string) => defineComponent({ name, inheritAttrs: false,
    ssrRender(context: ComponentPublicInstance, push: Parameters<typeof ssrRenderSlot>[4], parent: Parameters<typeof ssrRenderSlot>[5]) {
      const attrs = context.$attrs, slots = context.$slots
      if (name === 'NModal' && !attrs.show) return
      const tag = name === 'NButton' ? 'button' : name
      if (mocks.slotMode === 'ssr') {
        push(`<${tag}${ssrRenderAttrs(attrs, tag)}>`)
        for (const slotName of Object.keys(slots)) ssrRenderSlot(slots, slotName, {}, null, push, parent)
        push(`</${tag}>`)
      } else {
        const children = Object.values(slots).flatMap(slot => slot?.() ?? [])
        controls.push({ name, attrs: { ...attrs }, text: content(children).replace(/\s+/g, ' ').trim() })
        ssrRenderVNode(push, h(tag, attrs, children), parent)
      }
    },
  })
  return { useMessage: () => ({ success: mocks.success }), ...Object.fromEntries(['NAlert', 'NButton', 'NCard', 'NCheckbox', 'NEmpty', 'NInput', 'NModal', 'NSelect', 'NSpin', 'NTag', 'NText'].map(name => [name, shell(name)])) }
})

type Control = { name: string; attrs: Record<string, unknown>; text: string }
type State = { load: () => Promise<void> }
const controls: Control[] = []
let state: State | undefined, loadPromise: Promise<void> | undefined
function content(value: unknown): string {
  if (Array.isArray(value)) return value.map(content).join(' ')
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'children' in value) return content(value.children)
  return ''
}
async function render({ fresh = false, waitForLoad = true } = {}): Promise<string> {
  controls.length = 0
  const original = Diagnostic as ComponentOptions
  const component = defineComponent({ ...original, async setup(props, context: SetupContext) {
    if (fresh || !state) {
      if (typeof original.setup !== 'function') throw new Error('Compiled SFC setup missing')
      state = original.setup(props, context) as State
      loadPromise = state.load()
      if (waitForLoad) await loadPromise
    }
    return state
  } })
  return renderToString(createSSRApp(component))
}
function control(name: string, select: string | ((attrs: Record<string, unknown>) => boolean)): Control {
  const found = controls.find(item => item.name === name && (typeof select === 'string' ? item.text === select : select(item.attrs)))
  if (!found) throw new Error(`Rendered ${name} missing: ${String(select)}; available: ${controls.filter(item => item.name === name).map(item => item.text).join(' | ')}`)
  return found
}
function button(text: string): Control { return control('NButton', text) }
function input(id: string): Control {
  return control('NInput', attrs => ((attrs['input-props'] ?? attrs.inputProps) as { id?: string } | undefined)?.id === id)
}
async function invoke(item: Control, event = 'onClick', value?: unknown): Promise<void> {
  expect(item.attrs.disabled).not.toBe(true)
  const handlers = Array.isArray(item.attrs[event]) ? item.attrs[event] : [item.attrs[event]]
  for (const handler of handlers as unknown[]) {
    expect(typeof handler).toBe('function')
    await (handler as (value: unknown) => unknown)(value)
  }
}
async function type(id: string, value: string): Promise<void> { await invoke(input(id), 'onUpdate:value', value) }
async function openOrigin(): Promise<void> { await invoke(button('Vincular origem')); await render() }
beforeEach(() => {
  state = undefined; loadPromise = undefined; vi.clearAllMocks(); mocks.params.runId = '41'; mocks.slotMode = 'vnode'
  mocks.getRun.mockResolvedValue({ data: structuredClone(fixture.run) })
  mocks.getReport.mockResolvedValue({ data: structuredClone(fixture.report) })
  mocks.getSettings.mockResolvedValue({ data: structuredClone(fixture.settings) })
  mocks.updateTraceability.mockResolvedValue({ data: structuredClone(fixture.run) })
  mocks.publishReportToJira.mockResolvedValue({ data: structuredClone(fixture.jiraResult) })
  mocks.listRunsForHost.mockResolvedValue({ data: [{ ...fixture.run, id: 41 }, { ...fixture.run, id: 40 }] })
  mocks.compareRuns.mockResolvedValue({ data: structuredClone(fixture.comparison) })
  mocks.regenerateSummary.mockResolvedValue({ data: { ...fixture.run, aiSummaryStatus: 'PROCESSING' } })
  mocks.download.mockResolvedValue({ data: new Blob(['synthetic-json']) }); mocks.writeText.mockResolvedValue(undefined)
  mocks.push.mockResolvedValue(undefined); mocks.setTimeout.mockReturnValue(1)
  vi.stubGlobal('window', { location: { origin: 'https://nodeaccess.example.test' }, setTimeout: mocks.setTimeout, clearTimeout: mocks.clearTimeout })
  vi.stubGlobal('navigator', { clipboard: { writeText: mocks.writeText } })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('DiagnosticRunDetail compiled SSR contracts', () => {
  it('renders sanitized evidence, command outcomes, dates, checksum and disabled automatic summary', async () => {
    const html = await render({ fresh: true })
    expect(mocks.getRun).toHaveBeenCalledWith(41); expect(mocks.getReport).toHaveBeenCalledWith(41)
    for (const text of ['Host de laboratório', 'uptime', 'df -h', 'Saída sintética 0', 'LAB-42', fixture.report.integrity.checksum]) expect(html).toContain(text)
    expect(control('NSpin', () => true).attrs.show).toBe(false)
    expect(mocks.setTimeout).not.toHaveBeenCalled()
    await invoke(button('Ajuda'))
    expect(await render()).toContain('Valide os achados principais diretamente na saida dos comandos.')
  })
  it('shows loading until real load promise settles', async () => {
    let complete!: (result: { data: typeof fixture.run }) => void
    mocks.getRun.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    await render({ fresh: true, waitForLoad: false })
    expect(control('NSpin', () => true).attrs.show).toBe(true)
    complete({ data: fixture.run }); await loadPromise
    expect(await render()).toContain('Diagnóstico de laboratório')
    expect(control('NSpin', () => true).attrs.show).toBe(false)
  })
  it('shows load failure and recovers using the rendered refresh control', async () => {
    mocks.getRun.mockRejectedValueOnce(new Error('offline'))
    expect(await render({ fresh: true })).toContain('Nao foi possivel carregar')
    await invoke(button('Atualizar'))
    expect(await render()).toContain('Saída sintética 0'); expect(mocks.getRun).toHaveBeenCalledTimes(2)
  })
  it('retains command evidence when optional settings/report requests fail', async () => {
    mocks.getSettings.mockRejectedValueOnce(new Error('settings unavailable')); mocks.getReport.mockRejectedValueOnce(new Error('report unavailable'))
    const html = await render({ fresh: true })
    expect(html).toContain('Saída sintética 0'); expect(html).not.toContain(fixture.report.integrity.checksum)
    expect(controls.some(item => item.text === 'Vincular origem')).toBe(false)
  })
  it('refuses invalid route IDs without API traffic', async () => {
    mocks.params.runId = 'not-an-id'; await render({ fresh: true })
    expect(mocks.getRun).not.toHaveBeenCalled(); expect(mocks.getReport).not.toHaveBeenCalled()
  })
  it.each(['pending', 'running'])('polls active %s runs and stops scheduling when completed', async status => {
    mocks.getRun.mockResolvedValueOnce({ data: { ...fixture.run, status } })
    await render({ fresh: true }); expect(mocks.setTimeout).toHaveBeenCalledWith(expect.any(Function), 5000)
    await invoke(button('Atualizar'))
    expect(mocks.clearTimeout).toHaveBeenCalledWith(1); expect(mocks.setTimeout).toHaveBeenCalledTimes(1)
  })
  it('copies checksum and exposes clipboard failure without losing evidence', async () => {
    await render({ fresh: true }); await invoke(button('Copiar checksum'))
    expect(mocks.writeText).toHaveBeenCalledWith(fixture.report.integrity.checksum)
    mocks.writeText.mockRejectedValueOnce(new Error('clipboard denied')); await invoke(button('Copiar checksum'))
    expect(await render()).toContain('Não foi possível copiar o checksum automaticamente.')
  })
  it.each(['-1', '1.5', 'wrong'])('validates origin ID %s before updating tenant-scoped data', async value => {
    await render({ fresh: true }); await openOrigin(); await type('diagnostic-origin-session', value); await invoke(button('Validar e salvar'))
    expect(await render()).toContain('IDs numéricos positivos'); expect(mocks.updateTraceability).not.toHaveBeenCalled()
  })
  it('submits normalized origin fields, refreshes report and closes dialog', async () => {
    await render({ fresh: true }); await openOrigin()
    await type('diagnostic-origin-session', ' 25 '); await type('diagnostic-origin-ticket', ' OPS-42 '); await type('diagnostic-origin-action', '')
    await invoke(button('Validar e salvar'))
    expect(mocks.updateTraceability).toHaveBeenCalledWith(41, { sessionId: 25, ticketKey: 'OPS-42', actionRunId: null })
    await render(); expect(controls.some(item => item.name === 'NInput')).toBe(false); expect(mocks.getReport).toHaveBeenCalledTimes(2)
  })
  it.each([undefined, 'Origem não pertence ao tenant'])('keeps origin form visible on save failure (%s)', async message => {
    mocks.updateTraceability.mockRejectedValueOnce(message ? { response: { data: { message } } } : new Error('offline'))
    await render({ fresh: true }); await openOrigin(); await invoke(button('Validar e salvar'))
    expect(await render()).toContain(message ?? 'Não foi possível atualizar a rastreabilidade.')
    expect(input('diagnostic-origin-ticket')).toBeDefined()
    await invoke(button('Cancelar')); await render(); expect(controls.some(item => item.name === 'NInput')).toBe(false)
  })
  it('requires explicit confirmation before sending a report attachment and uses canonical report URL', async () => {
    await render({ fresh: true }); await invoke(button('Publicar no Jira')); await render()
    await invoke(control('NCheckbox', 'Anexar também o relatório JSON verificável'), 'onUpdate:checked', true)
    await render(); expect(button('Enfileirar publicação').attrs.disabled).toBe(true); expect(mocks.publishReportToJira).not.toHaveBeenCalled()
    await invoke(control('NCheckbox', 'Confirmo o envio das evidências operacionais para o Jira.'), 'onUpdate:checked', true)
    await render(); await invoke(button('Enfileirar publicação'))
    expect(mocks.publishReportToJira).toHaveBeenCalledWith(41, { reportUrl: 'https://nodeaccess.example.test/diagnostic-runs/41', includeAttachment: true })
    expect(mocks.success).toHaveBeenCalledWith('1 publicação(ões) enfileirada(s) para LAB-42.')
  })
  it('shows queue failure and can cancel publication without retry side effects', async () => {
    mocks.publishReportToJira.mockRejectedValueOnce(new Error('queue down'))
    await render({ fresh: true }); await invoke(button('Publicar no Jira')); await render(); await invoke(button('Enfileirar publicação'))
    expect(await render()).toContain('Não foi possível enfileirar o relatório no Jira.')
    await invoke(button('Cancelar')); await render(); expect(mocks.publishReportToJira).toHaveBeenCalledTimes(1)
  })
  it('compares a distinct accessible run and renders changes, warnings and findings', async () => {
    await render({ fresh: true }); await invoke(button('Comparar antes/depois')); await render()
    const select = control('NSelect', () => true)
    const options = select.attrs.options as Array<{ value: number; label: string }>
    expect(options).toHaveLength(1); expect(options[0]?.value).toBe(40); expect(options[0]?.label).toContain('#40')
    await invoke(button('Comparar')); expect(mocks.compareRuns).toHaveBeenCalledWith(41, 40)
    const html = await render()
    for (const text of ['Novo no laboratório', 'Resolvido no laboratório', 'Persistente no laboratório', 'show fixture-0', 'Comparação sintética']) expect(html).toContain(text)
  })
  it.each(['history', 'comparison'])('renders %s failure as an actionable comparison state', async failure => {
    if (failure === 'history') mocks.listRunsForHost.mockRejectedValueOnce(new Error('unavailable'))
    else mocks.compareRuns.mockRejectedValueOnce({ response: { data: { message: 'Execuções de hosts distintos' } } })
    await render({ fresh: true }); await invoke(button('Comparar antes/depois')); await render()
    if (failure === 'comparison') { await invoke(button('Comparar')); await render() }
    const alert = control('NAlert', attrs => attrs.type === 'error' && typeof attrs.title === 'string')
    expect(alert.attrs.title).toBe(failure === 'history' ? 'Não foi possível carregar o histórico deste host.' : 'Execuções de hosts distintos')
  })
  it('renders an empty comparison history without requesting an invalid comparison', async () => {
    mocks.listRunsForHost.mockResolvedValueOnce({ data: [fixture.run] })
    await render({ fresh: true }); await invoke(button('Comparar antes/depois')); await render()
    expect(control('NEmpty', () => true).attrs.description).toContain('Ainda não há outra execução')
    expect(mocks.compareRuns).not.toHaveBeenCalled()
  })
  it('regenerates only the summary and polls persisted processing state', async () => {
    await render({ fresh: true }); await invoke(button('Regerar resumo'))
    expect(mocks.regenerateSummary).toHaveBeenCalledWith(41); expect(mocks.getRun).toHaveBeenCalledOnce()
    expect(await render()).toContain('O resumo ainda esta sendo processado.'); expect(mocks.setTimeout).toHaveBeenCalledWith(expect.any(Function), 5000)
  })
  it('reports summary failure and renders export recovery with a safe filename', async () => {
    mocks.regenerateSummary.mockRejectedValueOnce(new Error('provider unavailable')); mocks.download.mockRejectedValueOnce(new Error('offline'))
    await render({ fresh: true }); await invoke(button('Regerar resumo')); expect(await render()).toContain('Nao foi possivel solicitar a regeneracao')
    await invoke(button('Exportar JSON')); expect(await render()).toContain('Nao foi possivel exportar')
    await invoke(button('Exportar JSON')); expect(mocks.saveBlobAs).toHaveBeenCalledWith(expect.any(Blob), 'diagn-stico-de-laborat-rio-41.json')
  })
  it.each(['low', 'medium', 'high'])('renders %s structured summary with operational next actions', async riskLevel => {
    mocks.getRun.mockResolvedValueOnce({ data: { ...fixture.run, status: 'failed', errorMessage: 'Comando falhou', aiSummaryStatus: 'DONE', aiSummaryText: 'Resumo sintético', aiSummaryStructured: { riskLevel, confidence: 'high', keyFindings: ['Disco cheio'], nextActions: ['Revisar retenção'] } } })
    const html = await render({ fresh: true })
    for (const text of ['Comando falhou', 'Resumo sintético', 'Disco cheio', 'Revisar retenção']) expect(html).toContain(text)
    expect(control('NTag', attrs => attrs.type === (riskLevel === 'high' ? 'error' : riskLevel === 'medium' ? 'warning' : 'success'))).toBeDefined()
  })
  it('navigates back to the host dashboard with a string host identifier', async () => {
    await render({ fresh: true }); await invoke(button('Voltar'))
    expect(mocks.push).toHaveBeenCalledWith({ name: 'host-dashboard', params: { hostId: '11' } })
  })
  it('renders evidence and structured summary through native SSR slots without a client transform', async () => {
    mocks.slotMode = 'ssr'
    mocks.getRun.mockResolvedValueOnce({ data: { ...fixture.run, status: 'canceled', aiSummaryStatus: 'DONE', aiSummaryText: 'Resumo verificável', aiSummaryStructured: { riskLevel: 'high', confidence: 'medium', keyFindings: ['Carga alta'], nextActions: ['Validar processo'] }, commands: [...fixture.run.commands, { ...fixture.run.commands[0], commandId: 'empty', outputBody: null }] } })
    const html = await render({ fresh: true })
    for (const text of ['Resumo verificável', 'Carga alta', 'Validar processo', 'Saída sintética 0', 'LAB-42', fixture.report.integrity.checksum]) expect(html).toContain(text)
    expect(mocks.getRun).toHaveBeenCalledWith(41)
  })
  it.each(['Ajuda', 'Vincular origem', 'Publicar no Jira', 'Comparar antes/depois'])('renders opened %s dialog through SSR slot callbacks', async label => {
    await render({ fresh: true }); await invoke(button(label))
    if (label === 'Comparar antes/depois') { await render(); await invoke(button('Comparar')) }
    mocks.slotMode = 'ssr'
    const html = await render()
    if (label === 'Ajuda') expect(html).toContain('Valide os achados principais diretamente na saida dos comandos.')
    if (label === 'Vincular origem') { expect(html).toContain('diagnostic-origin-session'); expect(html).toContain('Validar e salvar') }
    if (label === 'Publicar no Jira') expect(html).toContain('Enfileirar publicação')
    if (label === 'Comparar antes/depois') for (const text of ['show fixture-0', 'Resolvido no laboratório', 'Novo no laboratório', 'Persistente no laboratório']) expect(html).toContain(text)
  })
  it('renders SSR validation feedback for confirmed attachment and empty comparison findings', async () => {
    await render({ fresh: true }); await invoke(button('Publicar no Jira')); await render()
    await invoke(control('NCheckbox', 'Anexar também o relatório JSON verificável'), 'onUpdate:checked', true)
    mocks.slotMode = 'ssr'; expect(await render()).toContain('Confirmo o envio das evidências operacionais')
    mocks.slotMode = 'vnode'; await render(); await invoke(button('Cancelar')); await render()
    mocks.compareRuns.mockResolvedValueOnce({ data: { ...fixture.comparison, findings: { resolved: [], new: [], persistent: [] }, warnings: [] } })
    await invoke(button('Comparar antes/depois')); await render(); await invoke(button('Comparar'))
    mocks.slotMode = 'ssr'; const html = await render(); expect(html).toContain('Resolvidos'); expect(html).not.toContain('Resolvido no laboratório')
  })

  it('clears attachment confirmation whenever the inclusion option changes', async () => {
    await render({ fresh: true }); await invoke(button('Publicar no Jira')); await render()
    const attachment = () => control('NCheckbox', 'Anexar também o relatório JSON verificável')
    await invoke(attachment(), 'onUpdate:checked', true); await render()
    await invoke(control('NCheckbox', 'Confirmo o envio das evidências operacionais para o Jira.'), 'onUpdate:checked', true)
    await render(); expect(button('Enfileirar publicação').attrs.disabled).toBe(false)
    await invoke(attachment(), 'onUpdate:checked', false); await render()
    await invoke(attachment(), 'onUpdate:checked', true); await render()
    expect(button('Enfileirar publicação').attrs.disabled).toBe(true); expect(mocks.publishReportToJira).not.toHaveBeenCalled()
  })
  it('prefills existing origin references and sends null for cleared optional fields', async () => {
    mocks.getReport.mockResolvedValue({ data: { ...fixture.report, traceability: { sessionId: 25, ticketKey: 'LAB-42', actionRunId: 89 } } })
    await render({ fresh: true }); await openOrigin()
    expect(input('diagnostic-origin-session').attrs.value).toBe('25'); expect(input('diagnostic-origin-action').attrs.value).toBe('89')
    for (const id of ['diagnostic-origin-session', 'diagnostic-origin-ticket', 'diagnostic-origin-action']) await type(id, ' ')
    await invoke(button('Validar e salvar'))
    expect(mocks.updateTraceability).toHaveBeenCalledWith(41, { sessionId: null, ticketKey: null, actionRunId: null })
  })
  it('invalidates an old comparison when choosing another accessible baseline', async () => {
    mocks.listRunsForHost.mockResolvedValueOnce({ data: [{ ...fixture.run, id: 40 }, { ...fixture.run, id: 39 }] })
    await render({ fresh: true }); await invoke(button('Comparar antes/depois')); await render(); await invoke(button('Comparar'))
    expect(await render()).toContain('Resolvido no laboratório')
    await invoke(control('NSelect', () => true), 'onUpdate:value', 39)
    expect(await render()).not.toContain('Resolvido no laboratório')
    await invoke(button('Comparar')); expect(mocks.compareRuns).toHaveBeenLastCalledWith(41, 39)
  })
  it('poll callback refreshes the run and stops after completion', async () => {
    mocks.getRun.mockResolvedValueOnce({ data: { ...fixture.run, status: 'running' } })
    await render({ fresh: true })
    const poll = mocks.setTimeout.mock.calls[0]?.[0] as () => void
    poll(); await new Promise(resolve => setImmediate(resolve))
    expect(mocks.getRun).toHaveBeenCalledTimes(2); expect(mocks.clearTimeout).toHaveBeenCalledWith(1)
    expect(mocks.setTimeout).toHaveBeenCalledTimes(1); expect(await render()).toContain('completed')
  })
  it('renders missing timestamps, empty command output and safe non-Latin export fallback', async () => {
    mocks.getRun.mockResolvedValueOnce({ data: { ...fixture.run, playbookName: '診断', startedAt: null, finishedAt: null, commands: [{ ...fixture.run.commands[0], startedAt: null, finishedAt: null, outputBody: null }] } })
    const html = await render({ fresh: true }); expect(html).toContain('Sem registro')
    await invoke(button('Exportar JSON')); expect(mocks.saveBlobAs).toHaveBeenCalledWith(expect.any(Blob), 'diagnostic-run-41.json')
  })
  it('renders load failure via SSR slots and returns to hosts without assuming a loaded host', async () => {
    mocks.getRun.mockRejectedValueOnce(new Error('not found'))
    await render({ fresh: true }); await invoke(button('Voltar')); expect(mocks.push).toHaveBeenCalledWith({ name: 'hosts' })
    mocks.slotMode = 'ssr'; expect(await render()).toContain('Nao foi possivel carregar esta execucao')
  })
  it('renders optional report failure and no comparison candidates via SSR slots', async () => {
    mocks.getReport.mockRejectedValueOnce(new Error('optional report'))
    mocks.slotMode = 'ssr'; expect(await render({ fresh: true })).toContain('Saída sintética 0')
    mocks.slotMode = 'vnode'; await render(); await invoke(button('Atualizar')); await render()
    mocks.listRunsForHost.mockResolvedValueOnce({ data: [] })
    await invoke(button('Comparar antes/depois')); mocks.slotMode = 'ssr'
    expect(await render()).toContain('Ainda não há outra execução acessível')
  })

})
