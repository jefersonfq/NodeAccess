<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NCard,
  NCollapse,
  NCollapseItem,
  NDynamicInput,
  NEmpty,
  NForm,
  NFormItem,
  NModal,
  NSelect,
  NSpin,
  NTag,
  NText,
  NTimeline,
  NTimelineItem,
  NInput,
} from 'naive-ui'
import type { AiSshActionRunPublic, CreateAiSshActionRunDto, DiagnosticPlaybookPublic, DiagnosticRunPublic, HostDashboard, HostDashboardPeriodDays } from '@nodeaccess/shared'
import { hostDashboardService } from '@/services/host-dashboard.service'
import { diagnosticPlaybookService } from '@/services/diagnostic-playbook.service'
import { featuresService } from '@/services/features.service'
import { settingsService } from '@/services/settings.service'
import { aiSshActionService } from '@/services/ai-ssh-action.service'
import { aiSshActionCommandPolicyService, type AiSshActionCommandPolicyEvaluation } from '@/services/ai-ssh-action-command-policy.service'

const route = useRoute()
const router = useRouter()

const periodDays = ref<HostDashboardPeriodDays>(30)
const loading = ref(true)
const error = ref<string | null>(null)
const accessNotice = ref<string | null>(null)
const dashboard = ref<HostDashboard | null>(null)
const diagnosticPlaybooks = ref<DiagnosticPlaybookPublic[]>([])
const diagnosticRuns = ref<DiagnosticRunPublic[]>([])
const actionRuns = ref<AiSshActionRunPublic[]>([])
const timelineFilter = ref<'all' | 'session' | 'audit' | 'sharing' | 'error'>('all')
const diagnosticRunFilter = ref<'all' | 'failed' | 'ai_ready' | 'risk_attention'>('all')
const showDiagnosticHelp = ref(false)
const showActionModal = ref(false)
const actionSubmitting = ref(false)
const actionRiskPreviewLoading = ref(false)
const actionApprovalLoadingId = ref<number | null>(null)
const autoSummaryEnabled = ref<boolean | null>(null)
const localAiLicensed = ref(true)
const mcpLicensed = ref(true)
const aiSshActionsLicensed = ref(true)
const actionForm = ref<Omit<CreateAiSshActionRunDto, 'hostId'>>({
  mode: 'diagnostic_only',
  channel: 'local_ai',
  summary: '',
  approvalReason: null,
  steps: [
    { id: 'step-1', label: 'Coleta inicial', command: 'uptime', timeoutSeconds: 15 },
  ],
})
const actionRiskPreview = ref<Array<AiSshActionCommandPolicyEvaluation & { index: number; stepId: string; label: string }>>([])

const periodOptions = [
  { label: '7 dias', value: 7 },
  { label: '15 dias', value: 15 },
  { label: '30 dias', value: 30 },
  { label: '60 dias', value: 60 },
]
const diagnosticHelpQuickItems = [
  {
    title: 'O que e',
    description: 'Playbooks aprovados para coletar diagnosticos tecnicos do host com trilha auditavel.',
  },
  {
    title: 'Como usar',
    description: 'Escolha um playbook, solicite a execucao e acompanhe status, saida e resumo por IA.',
  },
  {
    title: 'Quando usar',
    description: 'Incidentes, lentidao, falha de rede, validacao de MySQL, disco, CPU e memoria.',
  },
]
const diagnosticHelpFields = [
  {
    title: 'Diagnosticos disponiveis',
    description: 'Catalogo de playbooks seguros e aprovados para este host.',
  },
  {
    title: 'Solicitar execucao',
    description: 'Cria uma execucao isolada em background e registra os comandos previstos.',
  },
  {
    title: 'Solicitacoes recentes',
    description: 'Lista os ultimos diagnosticos, com status, resumo por IA e risco quando houver.',
  },
  {
    title: 'Resumo por IA',
    description: 'Sintetiza o resultado coletado, destacando risco, achados principais e proximos passos. Pode ser automatico ou manual, conforme a configuracao do tenant.',
  },
]
const diagnosticHelpSteps = [
  'Abra o dashboard do host e revise os playbooks disponiveis.',
  'Escolha o playbook mais aderente ao problema e solicite a execucao.',
  'Acompanhe a lista de solicitacoes recentes para ver execucao, IA e risco. Se o resumo automatico estiver desligado, a lista indicara que a analise precisa ser solicitada manualmente.',
  'Abra o detalhe da execucao para analisar comandos, saida, achados e proximos passos.',
]
const diagnosticHelpScenarios = [
  {
    title: 'Rede e conectividade',
    description: 'Quando o host perde acesso, responde com latencia alta ou ha duvida sobre DNS, rota e portas.',
  },
  {
    title: 'CPU, memoria e processos',
    description: 'Quando ha lentidao, carga anormal, consumo excessivo ou suspeita de processo preso.',
  },
  {
    title: 'Disco e filesystem',
    description: 'Quando faltam espaco, inode, montagem correta ou ha degradacao em volumes.',
  },
  {
    title: 'MySQL basico',
    description: 'Quando o banco parece indisponivel, lento ou com sinais operacionais fora do normal.',
  },
]

const hostId = computed(() => Number(route.params.hostId))
const maxDailySessions = computed(() => Math.max(1, ...(dashboard.value?.daily.map((point) => point.sessions) ?? [1])))
const maxRouteCount = computed(() => Math.max(1, ...(dashboard.value?.routes.map((point) => point.count) ?? [1])))
const maxOriginCount = computed(() => Math.max(1, ...(dashboard.value?.origins.map((point) => point.count) ?? [1])))
const totalAuditPosture = computed(() => {
  const posture = dashboard.value?.auditPosture
  if (!posture) return 0
  return posture.running + posture.completed + posture.failed + posture.purged
})
const cacheStatusLabel = computed(() => {
  if (!dashboard.value) return 'Cache indisponivel'
  const generatedAt = formatDate(dashboard.value.cache.generatedAt)
  return dashboard.value.cache.hit
    ? `Cache usado - gerado em ${generatedAt}`
    : `Atualizado em ${generatedAt}`
})
const filteredTimeline = computed(() => {
  const items = dashboard.value?.timeline ?? []
  if (timelineFilter.value === 'all') return items
  if (timelineFilter.value === 'error') return items.filter((item) => item.severity === 'error')
  return items.filter((item) => item.type === timelineFilter.value)
})
const filteredDiagnosticRuns = computed(() => {
  const items = diagnosticRuns.value
  if (diagnosticRunFilter.value === 'all') return items
  if (diagnosticRunFilter.value === 'failed') {
    return items.filter((item) => item.status === 'failed' || item.aiSummaryStatus === 'FAILED')
  }
  if (diagnosticRunFilter.value === 'ai_ready') {
    return items.filter((item) => item.aiSummaryStatus === 'READY')
  }
  return items.filter((item) => {
    const risk = item.aiSummaryStructured?.riskLevel
    return risk === 'high' || risk === 'medium'
  })
})
const filteredActionRuns = computed(() => actionRuns.value.slice(0, 8))
const actionModeOptions = [
  { label: 'Read only', value: 'read_only' },
  { label: 'Diagnostic only', value: 'diagnostic_only' },
  { label: 'Approval required', value: 'approval_required' },
]
const actionChannelOptions = computed(() => ([
  ...(localAiLicensed.value ? [{ label: 'Assistente local', value: 'local_ai' as const }] : []),
  ...(mcpLicensed.value ? [{ label: 'MCP', value: 'mcp' as const }] : []),
  { label: 'Integração', value: 'integration' as const },
  { label: 'Interno', value: 'internal' as const },
]))
const actionFormErrors = computed(() => {
  const errors: string[] = []
  if (!actionForm.value.summary.trim()) errors.push('Informe um resumo da ação por IA.')
  if (actionForm.value.mode === 'full_operational_access') {
    errors.push('Full operational access ainda não está liberado nesta fase.')
  }
  if (!actionChannelOptions.value.some((option) => option.value === actionForm.value.channel)) {
    errors.push('Canal indisponível para este tenant.')
  }
  if (!actionForm.value.steps.length) errors.push('Adicione pelo menos um step.')
  actionForm.value.steps.forEach((step, index) => {
    const label = `Step ${index + 1}`
    if (!step.id.trim()) errors.push(`${label}: informe um ID.`)
    if (!step.label.trim()) errors.push(`${label}: informe um rótulo.`)
    if (!step.command.trim()) errors.push(`${label}: informe o comando previsto.`)
    if (!step.timeoutSeconds || step.timeoutSeconds < 1 || step.timeoutSeconds > 900) {
      errors.push(`${label}: timeout deve ficar entre 1s e 900s.`)
    }
  })
  return errors
})
const currentActionRiskPreview = computed(() => actionRiskPreview.value.filter((item) => {
  const step = actionForm.value.steps[item.index]
  return step?.command.trim() === item.command
}))
const actionRiskBlockingErrors = computed(() => {
  const errors: string[] = []
  for (const item of currentActionRiskPreview.value) {
    if (item.risk === 'blocked') {
      errors.push(`${item.label}: comando bloqueado pela policy.`)
    }
    if (item.risk === 'approval_required' && actionForm.value.mode !== 'approval_required') {
      errors.push(`${item.label}: exige modo approval_required.`)
    }
  }
  return errors
})
const canSubmitActionRun = computed(() => actionFormErrors.value.length === 0 && actionRiskBlockingErrors.value.length === 0)
const hasRunsWithoutAutoSummary = computed(() => (
  autoSummaryEnabled.value === false
  && diagnosticRuns.value.some((item) => (
    item.status !== 'pending'
    && item.status !== 'running'
    && !item.aiSummaryStatus
    && !item.aiSummaryText
  ))
))

async function load(forceRefresh = false) {
  if (!Number.isFinite(hostId.value)) return
  loading.value = true
  error.value = null
  try {
    const [dashboardRes, playbooksRes, runsRes, actionRunsRes, settingsRes, featuresRes] = await Promise.allSettled([
      hostDashboardService.get(hostId.value, periodDays.value, forceRefresh),
      diagnosticPlaybookService.listForHost(hostId.value).catch(() => ({ data: [] as DiagnosticPlaybookPublic[] })),
      diagnosticPlaybookService.listRunsForHost(hostId.value).catch(() => ({ data: [] as DiagnosticRunPublic[] })),
      aiSshActionService.listForHost(hostId.value).catch(() => ({ data: [] as AiSshActionRunPublic[] })),
      settingsService.get(),
      featuresService.get(),
    ])

    if (dashboardRes.status === 'rejected') {
      throw dashboardRes.reason
    }

    dashboard.value = dashboardRes.value.data
    diagnosticPlaybooks.value = playbooksRes.status === 'fulfilled' ? playbooksRes.value.data : []
    diagnosticRuns.value = runsRes.status === 'fulfilled' ? runsRes.value.data : []
    localAiLicensed.value = featuresRes.status === 'fulfilled' ? featuresRes.value.localAiLicensed : true
    mcpLicensed.value = featuresRes.status === 'fulfilled' ? featuresRes.value.mcpLicensed : true
    aiSshActionsLicensed.value = featuresRes.status === 'fulfilled' ? featuresRes.value.aiSshActionsLicensed : true
    actionRuns.value = aiSshActionsLicensed.value && actionRunsRes.status === 'fulfilled' ? actionRunsRes.value.data : []
    autoSummaryEnabled.value = settingsRes.status === 'fulfilled'
      ? settingsRes.value.data.license.sessionAuditAiAutoSummaryEnabled === true
      : null
  } catch {
    error.value = 'Nao foi possivel carregar o dashboard deste host.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(periodDays, () => load())
watch(hostId, () => load())

function refreshIgnoringCache() {
  load(true)
}

function formatDate(value: string | Date | null) {
  if (!value) return 'Sem fim registrado'
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatShortDate(value: string) {
  const [, month, day] = value.split('-')
  return `${day}/${month}`
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function routeLabel(routeName: string) {
  const labels: Record<string, string> = {
    direct: 'Direto',
    user_agent: 'Agente do usuario',
    tenant_agent: 'Agente do tenant',
  }
  return labels[routeName] ?? routeName
}

function scopeLabel(scope: string) {
  const labels: Record<string, string> = {
    personal: 'Pessoal',
    team: 'Equipe',
    global: 'Global',
  }
  return labels[scope] ?? scope
}

function openTerminal() {
  if (!dashboard.value) return
  router.push({ name: 'terminal', query: { hostId: String(dashboard.value.host.id) } })
}

function openFiles() {
  if (!dashboard.value) return
  router.push({ name: 'files', params: { hostId: dashboard.value.host.id } })
}

function openSessions() {
  if (!dashboard.value) return
  if (dashboard.value.viewer.role !== 'admin') {
    accessNotice.value = 'Sem acesso a lista administrativa de sessoes. Esta visao mostra apenas os seus dados neste host.'
    return
  }
  router.push({
    name: 'admin-sessions',
    query: { hostId: String(dashboard.value.host.id), periodDays: String(periodDays.value) },
  })
}

function openSessionsDrilldown(query: Record<string, string>) {
  if (!dashboard.value || dashboard.value.viewer.role !== 'admin') return
  router.push({
    name: 'admin-sessions',
    query: {
      hostId: String(dashboard.value.host.id),
      periodDays: String(periodDays.value),
      ...query,
    },
  })
}

function openSessionsForDay(date: string, hasError?: boolean) {
  const from = new Date(`${date}T00:00:00`)
  const to = new Date(from)
  to.setDate(from.getDate() + 1)
  openSessionsDrilldown({
    dateFrom: from.toISOString(),
    dateTo: to.toISOString(),
    ...(hasError !== undefined ? { hasError: String(hasError) } : {}),
  })
}

function openSessionsByRoute(connectionMethod: string) {
  openSessionsDrilldown({ connectionMethod })
}

function openSessionsByOrigin(originIp: string) {
  openSessionsDrilldown({ originIp })
}

function openAudits() {
  if (!dashboard.value) return
  if (dashboard.value.viewer.role !== 'admin') {
    accessNotice.value = 'Sem acesso a auditoria administrativa. Esta visao mostra apenas os seus dados consolidados neste host.'
    return
  }
  router.push({
    name: 'admin-session-audit',
    query: { hostId: String(dashboard.value.host.id), periodDays: String(periodDays.value) },
  })
}

function openAuditsDrilldown(query: Record<string, string>) {
  if (!dashboard.value || dashboard.value.viewer.role !== 'admin') return
  router.push({
    name: 'admin-session-audit',
    query: {
      hostId: String(dashboard.value.host.id),
      periodDays: String(periodDays.value),
      ...query,
    },
  })
}

function openForwardings() {
  if (!dashboard.value) return
  router.push({ name: 'forwardings', query: { hostId: String(dashboard.value.host.id) } })
}

function openTimelineItem(sessionId: number | null) {
  if (!sessionId || dashboard.value?.viewer.role !== 'admin') return
  router.push({ name: 'admin-session-audit-detail', params: { sessionId } })
}

function timelineTagType(severity: string) {
  if (severity === 'success') return 'success'
  if (severity === 'warning') return 'warning'
  if (severity === 'error') return 'error'
  return 'info'
}

function healthTagType(status: string) {
  if (status === 'healthy') return 'success'
  if (status === 'attention') return 'warning'
  return 'error'
}

function timelineTypeLabel(type: string) {
  const labels: Record<string, string> = {
    session: 'Sessao',
    audit: 'Auditoria',
    sharing: 'Compartilhamento',
  }
  return labels[type] ?? type
}

function timelineSeverityLabel(severity: string) {
  const labels: Record<string, string> = {
    info: 'Informativo',
    success: 'Concluido',
    warning: 'Atencao',
    error: 'Falha',
  }
  return labels[severity] ?? severity
}

function timelineDay(value: string | Date) {
  return new Date(value).toISOString().slice(0, 10)
}

function playbookCategoryLabel(category: DiagnosticPlaybookPublic['category']) {
  const labels: Record<DiagnosticPlaybookPublic['category'], string> = {
    network: 'Rede',
    compute: 'CPU e memoria',
    storage: 'Disco',
    kernel: 'Kernel',
    mysql: 'MySQL',
    agent: 'Agent',
  }
  return labels[category]
}

function playbookRiskType(riskLevel: DiagnosticPlaybookPublic['riskLevel']) {
  if (riskLevel === 'high') return 'error'
  if (riskLevel === 'medium') return 'warning'
  return 'success'
}

function diagnosticRunTagType(status: DiagnosticRunPublic['status']) {
  if (status === 'completed') return 'success'
  if (status === 'failed' || status === 'canceled') return 'error'
  if (status === 'running') return 'warning'
  return 'default'
}

function diagnosticAiSummaryTagType(status: string | null | undefined) {
  if (status === 'READY') return 'success'
  if (status === 'FAILED') return 'error'
  if (status === 'PROCESSING') return 'warning'
  return 'default'
}

function diagnosticAiRiskTagType(riskLevel: 'low' | 'medium' | 'high') {
  if (riskLevel === 'high') return 'error'
  if (riskLevel === 'medium') return 'warning'
  return 'success'
}

async function requestDiagnosticRun(playbookId: number) {
  if (!dashboard.value) return
  try {
    const runResponse = await diagnosticPlaybookService.requestRun(dashboard.value.host.id, { playbookId })
    accessNotice.value = 'Solicitacao registrada. A execucao tecnica foi iniciada em background.'
    const runsResponse = await diagnosticPlaybookService.listRunsForHost(dashboard.value.host.id)
    diagnosticRuns.value = runsResponse.data
    void router.push({ name: 'diagnostic-run-detail', params: { runId: String(runResponse.data.id) } })
  } catch {
    accessNotice.value = 'Nao foi possivel registrar a solicitacao de diagnostico.'
  }
}

function openDiagnosticRun(runId: number) {
  router.push({ name: 'diagnostic-run-detail', params: { runId: String(runId) } })
}

function actionRunTagType(status: AiSshActionRunPublic['status']) {
  if (status === 'completed' || status === 'approved') return 'success'
  if (status === 'failed' || status === 'canceled' || status === 'rejected') return 'error'
  if (status === 'running' || status === 'pending_approval') return 'warning'
  return 'default'
}

function openActionRun(runId: number) {
  router.push({ name: 'ai-ssh-action-run-detail', params: { runId: String(runId) } })
}

function openActionModal() {
  const firstChannel = actionChannelOptions.value[0]?.value ?? 'integration'
  actionForm.value = {
    mode: 'diagnostic_only',
    channel: firstChannel,
    summary: '',
    approvalReason: null,
    steps: [
      { id: 'step-1', label: 'Coleta inicial', command: 'uptime', timeoutSeconds: 15 },
    ],
  }
  actionRiskPreview.value = []
  showActionModal.value = true
}

async function submitActionRun() {
  if (!dashboard.value || !aiSshActionsLicensed.value || !canSubmitActionRun.value) return
  actionSubmitting.value = true
  try {
    await aiSshActionService.createForHost(dashboard.value.host.id, {
      ...actionForm.value,
      approvalReason: actionForm.value.approvalReason?.trim() || null,
      summary: actionForm.value.summary.trim(),
      steps: actionForm.value.steps.map((step) => ({
        ...step,
        id: step.id.trim(),
        label: step.label.trim(),
        command: step.command.trim(),
      })),
    })
    const response = await aiSshActionService.listForHost(dashboard.value.host.id)
    actionRuns.value = response.data
    accessNotice.value = 'Solicitação de ação por IA registrada.'
    showActionModal.value = false
  } catch {
    accessNotice.value = 'Não foi possível registrar a ação por IA.'
  } finally {
    actionSubmitting.value = false
  }
}

async function evaluateActionRisks() {
  actionRiskPreviewLoading.value = true
  try {
    const steps = actionForm.value.steps
      .map((step, index) => ({
        index,
        stepId: step.id.trim() || `step-${index + 1}`,
        label: step.label.trim() || `Step ${index + 1}`,
        command: step.command.trim(),
      }))
      .filter((step) => step.command.length > 0)

    const results = await Promise.all(steps.map(async (step) => {
      const { data } = await aiSshActionCommandPolicyService.evaluate(step.command)
      return { ...data, index: step.index, stepId: step.stepId, label: step.label }
    }))

    actionRiskPreview.value = results
  } catch {
    accessNotice.value = 'Não foi possível avaliar os riscos dos comandos.'
  } finally {
    actionRiskPreviewLoading.value = false
  }
}

function actionRiskTagType(risk: AiSshActionCommandPolicyEvaluation['risk']) {
  if (risk === 'safe') return 'success'
  if (risk === 'approval_required') return 'warning'
  return 'error'
}

async function approveActionRun(runId: number) {
  actionApprovalLoadingId.value = runId
  try {
    const { data } = await aiSshActionService.approve(runId)
    actionRuns.value = actionRuns.value.map((item) => item.id === data.id ? data : item)
    accessNotice.value = 'Action run aprovado.'
  } catch {
    accessNotice.value = 'Não foi possível aprovar o action run.'
  } finally {
    actionApprovalLoadingId.value = null
  }
}

async function rejectActionRun(runId: number) {
  actionApprovalLoadingId.value = runId
  try {
    const { data } = await aiSshActionService.reject(runId)
    actionRuns.value = actionRuns.value.map((item) => item.id === data.id ? data : item)
    accessNotice.value = 'Action run rejeitado.'
  } catch {
    accessNotice.value = 'Não foi possível rejeitar o action run.'
  } finally {
    actionApprovalLoadingId.value = null
  }
}

async function cancelActionRun(runId: number) {
  actionApprovalLoadingId.value = runId
  try {
    const { data } = await aiSshActionService.cancel(runId)
    actionRuns.value = actionRuns.value.map((item) => item.id === data.id ? data : item)
    accessNotice.value = 'Action run cancelado.'
  } catch {
    accessNotice.value = 'Nao foi possivel cancelar o action run.'
  } finally {
    actionApprovalLoadingId.value = null
  }
}

function openTimelineSessions(item: HostDashboard['timeline'][number]) {
  openSessionsForDay(timelineDay(item.occurredAt), item.severity === 'error' ? true : undefined)
}
</script>

<template>
  <div class="host-dashboard-page">
    <div class="host-dashboard-header">
      <div class="min-w-0">
        <NButton text size="small" style="color:#9ca3af;margin-bottom:10px" @click="router.push({ name: 'hosts' })">
          Voltar para hosts
        </NButton>
        <h1>{{ dashboard?.host.name ?? 'Dashboard do host' }}</h1>
        <NText depth="3" class="text-sm">
          Historico, auditoria e decisao operacional em uma visao por host.
        </NText>
      </div>

      <div class="host-dashboard-actions">
        <NSelect
          v-model:value="periodDays"
          :options="periodOptions"
          size="small"
          style="width:120px"
          aria-label="Periodo do dashboard"
        />
        <NButton size="small" ghost @click="load()">Atualizar</NButton>
        <NButton size="small" secondary @click="refreshIgnoringCache">Ignorar cache</NButton>
      </div>
    </div>

    <NAlert v-if="error" type="error" :title="error" class="mb-4" />
    <NAlert
      v-if="accessNotice"
      type="info"
      :title="accessNotice"
      closable
      class="mb-4"
      @close="accessNotice = null"
    />

    <NSpin :show="loading">
      <template v-if="dashboard">
        <section class="host-identity-panel">
          <div class="host-identity-main">
            <div class="host-address">{{ dashboard.host.ip }}:{{ dashboard.host.port }}</div>
            <div class="host-meta">
              <span>SSH: {{ dashboard.host.sshUser }}</span>
              <span>Escopo: {{ scopeLabel(dashboard.host.scope) }}</span>
              <span>Rota: {{ routeLabel(dashboard.host.connectionMode) }}</span>
              <span>Bastion: {{ dashboard.host.effectiveBastionName ?? 'Sem bastion' }}</span>
            </div>
            <div class="host-tags">
              <NTag v-if="dashboard.host.deleted" size="small" type="warning">
                Host excluido
              </NTag>
              <NTag v-for="tag in dashboard.host.tags" :key="tag.id" size="small">
                {{ tag.name }}
              </NTag>
              <NTag v-if="dashboard.viewer.restrictedToOwnActivity" size="small" type="warning">
                Visao limitada as suas atividades
              </NTag>
              <NTag size="small" :type="dashboard.cache.hit ? 'success' : 'default'">
                Cache {{ dashboard.cache.hit ? 'usado' : 'atualizado' }} - {{ dashboard.cache.ttlSeconds }}s
              </NTag>
              <NText depth="3" class="text-xs">{{ cacheStatusLabel }}</NText>
            </div>
          </div>

          <div class="host-quick-actions">
            <NButton type="primary" :disabled="dashboard.host.deleted" @click="openTerminal">Abrir terminal</NButton>
            <NButton ghost :disabled="dashboard.host.deleted" @click="openFiles">Arquivos</NButton>
            <NButton ghost :disabled="dashboard.host.deleted" @click="openForwardings">Forwardings</NButton>
          </div>
        </section>
        <NAlert
          v-if="dashboard.host.deleted"
          type="warning"
          title="Este host foi excluido logicamente. O dashboard permanece disponivel apenas para consulta historica."
          class="mb-4"
        />

        <section class="host-kpi-grid">
          <div class="metric-tile">
            <span>Sessoes</span>
            <strong>{{ dashboard.summary.sessions }}</strong>
            <small>{{ dashboard.summary.activeSessions }} ativas agora</small>
          </div>
          <div class="metric-tile">
            <span>Falhas</span>
            <strong :class="{ danger: dashboard.summary.failedSessions > 0 }">{{ dashboard.summary.failedSessions }}</strong>
            <small>no periodo selecionado</small>
          </div>
          <div class="metric-tile">
            <span>Auditorias</span>
            <strong>{{ dashboard.summary.audits }}</strong>
            <small>{{ dashboard.summary.auditEvents }} eventos capturados</small>
          </div>
          <div class="metric-tile">
            <span>Usuarios</span>
            <strong>{{ dashboard.summary.uniqueUsers ?? 'Voce' }}</strong>
            <small>{{ dashboard.viewer.role === 'admin' ? 'usuarios unicos' : 'atividade pessoal' }}</small>
          </div>
          <div class="metric-tile">
            <span>Trafego auditado</span>
            <strong>{{ formatBytes(dashboard.summary.bytesIn + dashboard.summary.bytesOut) }}</strong>
            <small>entrada e saida</small>
          </div>
          <div class="metric-tile">
            <span>Compartilhamentos</span>
            <strong>{{ dashboard.summary.sharedSessions }}</strong>
            <small>{{ dashboard.summary.activeSharedSessions }} ativos</small>
          </div>
        </section>

        <section class="health-panel" :class="`health-${dashboard.health.status}`">
          <div class="health-score">
            <span>Saude operacional</span>
            <strong>{{ dashboard.health.score }}</strong>
            <NTag size="small" :type="healthTagType(dashboard.health.status)">
              {{ dashboard.health.title }}
            </NTag>
          </div>
          <div class="health-reasons">
            <div class="health-reasons-title">Motivos principais</div>
            <ul>
              <li v-for="reason in dashboard.health.reasons" :key="reason">{{ reason }}</li>
            </ul>
          </div>
          <div class="health-actions">
            <NButton size="small" secondary @click="openSessions">Ver sessoes</NButton>
            <NButton size="small" secondary @click="openAudits">Ver auditoria</NButton>
          </div>
        </section>

        <section class="decision-grid">
          <div class="dashboard-panel wide">
            <div class="panel-title">
              <div>
                <h2>Tendencia de acesso</h2>
                <p>Sessoes e falhas por dia ajudam a identificar pico, recorrencia e instabilidade.</p>
              </div>
              <NButton text size="small" style="color:#93c5fd" @click="openSessions">Ver sessoes</NButton>
            </div>
            <div class="daily-chart" aria-label="Grafico diario de sessoes">
              <div v-for="point in dashboard.daily" :key="point.date" class="daily-column">
                <div class="daily-stack">
                  <button
                    class="daily-bar sessions"
                    :disabled="dashboard.viewer.role !== 'admin' || point.sessions === 0"
                    :style="{ height: `${Math.max(6, (point.sessions / maxDailySessions) * 128)}px` }"
                    :title="`Ver sessoes de ${formatShortDate(point.date)}`"
                    @click="openSessionsForDay(point.date)"
                  />
                  <button
                    v-if="point.failedSessions"
                    class="daily-bar failures"
                    :disabled="dashboard.viewer.role !== 'admin'"
                    :style="{ height: `${Math.max(4, (point.failedSessions / maxDailySessions) * 128)}px` }"
                    :title="`Ver falhas de ${formatShortDate(point.date)}`"
                    @click="openSessionsForDay(point.date, true)"
                  />
                </div>
                <small>{{ formatShortDate(point.date) }}</small>
              </div>
            </div>
            <div class="chart-legend">
              <span><i class="legend sessions" /> Sessoes</span>
              <span><i class="legend failures" /> Falhas</span>
            </div>
          </div>

          <div class="dashboard-panel">
            <div class="panel-title">
              <div>
                <h2>Diagnosticos disponiveis</h2>
                <p>Catalogo inicial de playbooks aprovados para este host.</p>
              </div>
              <NButton text size="small" style="color:#93c5fd" @click="showDiagnosticHelp = true">Ajuda</NButton>
            </div>
            <div v-if="diagnosticPlaybooks.length" class="diagnostic-playbook-list">
              <div v-for="playbook in diagnosticPlaybooks" :key="playbook.id" class="diagnostic-playbook-item">
                <div class="diagnostic-playbook-header">
                  <div>
                    <strong>{{ playbook.name }}</strong>
                    <p>{{ playbook.description }}</p>
                  </div>
                  <div class="diagnostic-playbook-tags">
                    <NTag size="small">{{ playbookCategoryLabel(playbook.category) }}</NTag>
                    <NTag size="small" :type="playbookRiskType(playbook.riskLevel)">{{ playbook.riskLevel }}</NTag>
                    <NTag v-if="playbook.requiresApproval" size="small" type="warning">Confirmacao</NTag>
                  </div>
                </div>
                <ul class="diagnostic-command-preview">
                  <li v-for="command in playbook.commands.slice(0, 3)" :key="command.id">
                    <code>{{ command.command }}</code>
                  </li>
                </ul>
                <NText depth="3" class="text-xs">
                  {{ playbook.commands.length }} comando(s) aprovados. A execucao roda em background e fica registrada no host.
                </NText>
                <div class="diagnostic-playbook-actions">
                  <NButton size="small" secondary @click="requestDiagnosticRun(playbook.id)">
                    Solicitar execucao
                  </NButton>
                </div>
              </div>
            </div>
            <NEmpty v-else description="Nenhum playbook disponivel para este host." class="py-5" />
          </div>

          <div class="dashboard-panel">
            <div class="panel-title">
              <div>
                <h2>Solicitacoes recentes</h2>
                <p>Historico inicial de pedidos de diagnostico vinculados a este host.</p>
              </div>
            </div>
            <NAlert
              v-if="hasRunsWithoutAutoSummary"
              type="info"
              class="mb-4"
              title="Resumo automático desabilitado neste tenant"
            >
              Diagnosticos concluidos podem ficar sem resumo por IA ate que alguem solicite a analise manual em <strong>Regerar resumo</strong>.
            </NAlert>
            <div v-if="diagnosticRuns.length" class="timeline-tools">
              <NButton size="tiny" :type="diagnosticRunFilter === 'all' ? 'primary' : 'default'" @click="diagnosticRunFilter = 'all'">
                Todos
              </NButton>
              <NButton size="tiny" :type="diagnosticRunFilter === 'failed' ? 'primary' : 'default'" @click="diagnosticRunFilter = 'failed'">
                Com falha
              </NButton>
              <NButton size="tiny" :type="diagnosticRunFilter === 'ai_ready' ? 'primary' : 'default'" @click="diagnosticRunFilter = 'ai_ready'">
                IA pronta
              </NButton>
              <NButton size="tiny" :type="diagnosticRunFilter === 'risk_attention' ? 'primary' : 'default'" @click="diagnosticRunFilter = 'risk_attention'">
                Risco medio+
              </NButton>
            </div>
            <div v-if="filteredDiagnosticRuns.length" class="diagnostic-run-list">
              <button
                v-for="run in filteredDiagnosticRuns"
                :key="run.id"
                class="diagnostic-run-item diagnostic-run-button"
                @click="openDiagnosticRun(run.id)"
              >
                <div>
                  <strong>{{ run.playbookName }}</strong>
                  <p>Solicitado em {{ formatDate(run.createdAt) }}</p>
                  <p v-if="run.aiSummaryStructured?.riskLevel || run.aiSummaryStatus" class="diagnostic-run-subline">
                    <span v-if="run.aiSummaryStatus === 'READY' && run.aiSummaryStructured?.riskLevel">
                      Resumo pronto com risco {{ run.aiSummaryStructured.riskLevel }}.
                    </span>
                    <span v-else-if="run.aiSummaryStatus === 'PROCESSING'">
                      Resumo por IA em processamento.
                    </span>
                    <span v-else-if="run.aiSummaryStatus === 'FAILED'">
                      Falha ao gerar resumo por IA.
                    </span>
                  </p>
                  <p
                    v-else-if="autoSummaryEnabled === false && run.status !== 'pending' && run.status !== 'running'"
                    class="diagnostic-run-subline"
                  >
                    Resumo automatico desligado. Gere manualmente se precisar.
                  </p>
                </div>
                <div class="diagnostic-run-meta">
                  <NTag size="small" :type="diagnosticRunTagType(run.status)">{{ run.status }}</NTag>
                  <NTag v-if="run.aiSummaryStatus" size="small" :type="diagnosticAiSummaryTagType(run.aiSummaryStatus)">
                    IA {{ run.aiSummaryStatus }}
                  </NTag>
                  <NTag
                    v-if="run.aiSummaryStructured?.riskLevel"
                    size="small"
                    :type="diagnosticAiRiskTagType(run.aiSummaryStructured.riskLevel)"
                  >
                    Risco {{ run.aiSummaryStructured.riskLevel }}
                  </NTag>
                  <NTag
                    v-else-if="autoSummaryEnabled === false && run.status !== 'pending' && run.status !== 'running'"
                    size="small"
                    type="default"
                  >
                    IA manual
                  </NTag>
                  <NText depth="3" class="text-xs">Abrir</NText>
                </div>
              </button>
            </div>
            <NEmpty
              v-else
              :description="diagnosticRuns.length ? 'Nenhuma solicitacao corresponde ao filtro atual.' : 'Nenhuma solicitacao registrada ainda.'"
              class="py-5"
            />
          </div>

          <div v-if="aiSshActionsLicensed" class="dashboard-panel">
            <div class="panel-title">
              <div>
                <h2>Ações por IA</h2>
                <p>Solicitações controladas de operação por IA para este host.</p>
              </div>
              <NButton size="small" secondary @click="openActionModal">Solicitar ação</NButton>
            </div>
            <div v-if="filteredActionRuns.length" class="diagnostic-run-list">
              <button
                v-for="run in filteredActionRuns"
                :key="run.id"
                class="diagnostic-run-item diagnostic-run-button"
                @click="openActionRun(run.id)"
              >
                <div>
                  <strong>{{ run.summary }}</strong>
                  <p>{{ run.channel }} • {{ run.mode }} • {{ formatDate(run.createdAt) }}</p>
                  <p v-if="run.approvalReason" class="diagnostic-run-subline">
                    Motivo: {{ run.approvalReason }}
                  </p>
                  <p
                    v-else-if="run.status === 'failed' && run.errorMessage"
                    class="diagnostic-run-subline"
                  >
                    Falhou: {{ run.errorMessage }}
                  </p>
                  <p
                    v-else-if="run.status === 'canceled' && run.errorMessage"
                    class="diagnostic-run-subline"
                  >
                    Cancelado: {{ run.errorMessage }}
                  </p>
                </div>
                <div class="diagnostic-run-meta">
                  <NTag size="small" :type="actionRunTagType(run.status)">{{ run.status }}</NTag>
                  <NButton
                    v-if="run.status === 'pending_approval' || run.status === 'approved' || run.status === 'running'"
                    size="tiny"
                    type="warning"
                    tertiary
                    :loading="actionApprovalLoadingId === run.id"
                    @click.stop="cancelActionRun(run.id)"
                  >
                    Cancelar
                  </NButton>
                  <template v-if="dashboard.viewer.role === 'admin' && run.status === 'pending_approval'">
                    <NButton
                      size="tiny"
                      type="success"
                      tertiary
                      :loading="actionApprovalLoadingId === run.id"
                      @click.stop="approveActionRun(run.id)"
                    >
                      Aprovar
                    </NButton>
                    <NButton
                      size="tiny"
                      type="error"
                      tertiary
                      :loading="actionApprovalLoadingId === run.id"
                      @click.stop="rejectActionRun(run.id)"
                    >
                      Rejeitar
                    </NButton>
                  </template>
                  <NText depth="3" class="text-xs">Abrir</NText>
                </div>
              </button>
            </div>
            <NEmpty v-else description="Nenhuma ação por IA registrada ainda." class="py-5" />
          </div>

          <div class="dashboard-panel">
            <div class="panel-title">
              <div>
                <h2>Rotas usadas</h2>
                <p>Mostra se o host depende mais de acesso direto ou agentes.</p>
              </div>
            </div>
            <div v-if="dashboard.routes.length" class="bar-list">
              <button
                v-for="item in dashboard.routes"
                :key="item.route"
                class="bar-row drilldown-row"
                :disabled="dashboard.viewer.role !== 'admin'"
                @click="openSessionsByRoute(item.route)"
              >
                <div class="bar-label">
                  <span>{{ routeLabel(item.route) }}</span>
                  <strong>{{ item.count }}</strong>
                </div>
                <div class="bar-track"><span :style="{ width: `${(item.count / maxRouteCount) * 100}%` }" /></div>
              </button>
            </div>
            <NEmpty v-else description="Sem sessoes no periodo." class="py-5" />
          </div>

          <div class="dashboard-panel">
            <div class="panel-title">
              <div>
                <h2>Origem WAN</h2>
                <p>Ajuda a validar origem do navegador ou agente.</p>
              </div>
            </div>
            <div v-if="dashboard.origins.length" class="bar-list">
              <button
                v-for="item in dashboard.origins"
                :key="item.ip"
                class="bar-row drilldown-row"
                :disabled="dashboard.viewer.role !== 'admin'"
                @click="openSessionsByOrigin(item.ip)"
              >
                <div class="bar-label monospace">
                  <span>{{ item.ip }}</span>
                  <strong>{{ item.count }}</strong>
                </div>
                <div class="bar-track origin"><span :style="{ width: `${(item.count / maxOriginCount) * 100}%` }" /></div>
                <small>Ultimo uso: {{ formatDate(item.lastSeenAt) }}</small>
              </button>
            </div>
            <NEmpty v-else description="Sem IP de origem registrado no periodo." class="py-5" />
          </div>

          <div class="dashboard-panel">
            <div class="panel-title">
              <div>
                <h2>Postura de auditoria</h2>
                <p>Status e risco dos registros auditados deste host.</p>
              </div>
              <NButton text size="small" style="color:#93c5fd" @click="openAudits">Ver auditoria</NButton>
            </div>
            <div class="audit-posture">
              <button class="audit-posture-item" :disabled="dashboard.viewer.role !== 'admin'" @click="openAuditsDrilldown({ status: 'COMPLETED' })">
                <span>Concluidas</span>
                <strong>{{ dashboard.auditPosture.completed }}</strong>
              </button>
              <button class="audit-posture-item" :disabled="dashboard.viewer.role !== 'admin'" @click="openAuditsDrilldown({ status: 'RUNNING' })">
                <span>Em execucao</span>
                <strong>{{ dashboard.auditPosture.running }}</strong>
              </button>
              <button class="audit-posture-item" :disabled="dashboard.viewer.role !== 'admin'" @click="openAuditsDrilldown({ status: 'FAILED' })">
                <span>Falhas</span>
                <strong class="danger">{{ dashboard.auditPosture.failed }}</strong>
              </button>
              <button class="audit-posture-item" :disabled="dashboard.viewer.role !== 'admin'" @click="openAuditsDrilldown({ aiRiskLevel: 'high' })">
                <span>Risco alto</span>
                <strong class="danger">{{ dashboard.auditPosture.riskHigh }}</strong>
              </button>
            </div>
            <div class="risk-meter" :aria-label="`Total de auditorias no periodo: ${totalAuditPosture}`">
              <span class="ok" :style="{ width: `${totalAuditPosture ? (dashboard.auditPosture.completed / totalAuditPosture) * 100 : 0}%` }" />
              <span class="warn" :style="{ width: `${totalAuditPosture ? (dashboard.auditPosture.running / totalAuditPosture) * 100 : 0}%` }" />
              <span class="bad" :style="{ width: `${totalAuditPosture ? (dashboard.auditPosture.failed / totalAuditPosture) * 100 : 0}%` }" />
            </div>
          </div>

          <div class="dashboard-panel wide">
            <div class="panel-title">
              <div>
                <h2>Sessoes recentes</h2>
                <p>Ultimos acessos do periodo com origem, rota e erro quando existir.</p>
              </div>
            </div>
            <div v-if="dashboard.recentSessions.length" class="recent-session-list">
              <div v-for="session in dashboard.recentSessions" :key="session.id" class="recent-session-row">
                <div>
                  <strong>{{ session.userName ?? 'Sua sessao' }}</strong>
                  <span>{{ formatDate(session.startedAt) }} - {{ formatDate(session.endedAt) }}</span>
                </div>
                <div class="recent-session-meta">
                  <NTag size="small" :type="session.active ? 'success' : 'default'">
                    {{ session.active ? 'Ativa' : 'Encerrada' }}
                  </NTag>
                  <NTag size="small">{{ routeLabel(session.connectionMethod) }}</NTag>
                  <NTag v-if="session.clientIp || session.agentRemoteIp" size="small">
                    {{ session.agentRemoteIp ?? session.clientIp }}
                  </NTag>
                  <NTag v-if="session.errorCode" size="small" type="error">
                    {{ session.errorCode }}
                  </NTag>
                </div>
              </div>
            </div>
            <NEmpty v-else description="Sem sessoes recentes neste periodo." class="py-6" />
          </div>

          <div class="dashboard-panel wide">
            <div class="panel-title">
              <div>
                <h2>Timeline do host</h2>
                <p>Eventos recentes de sessoes, auditoria e compartilhamento no periodo selecionado.</p>
              </div>
            </div>
            <div v-if="dashboard.timeline.length" class="timeline-tools">
              <NButton size="tiny" :type="timelineFilter === 'all' ? 'primary' : 'default'" @click="timelineFilter = 'all'">Todos</NButton>
              <NButton size="tiny" :type="timelineFilter === 'session' ? 'primary' : 'default'" @click="timelineFilter = 'session'">Sessoes</NButton>
              <NButton size="tiny" :type="timelineFilter === 'audit' ? 'primary' : 'default'" @click="timelineFilter = 'audit'">Auditoria</NButton>
              <NButton size="tiny" :type="timelineFilter === 'sharing' ? 'primary' : 'default'" @click="timelineFilter = 'sharing'">Compart.</NButton>
              <NButton size="tiny" :type="timelineFilter === 'error' ? 'primary' : 'default'" @click="timelineFilter = 'error'">Falhas</NButton>
            </div>
            <div v-if="filteredTimeline.length" class="timeline-list">
              <NTimeline>
                <NTimelineItem
                  v-for="item in filteredTimeline"
                  :key="item.id"
                  :type="timelineTagType(item.severity)"
                  :time="formatDate(item.occurredAt)"
                >
                  <div class="timeline-action">
                    <div class="timeline-title">
                      <strong>{{ item.title }}</strong>
                      <NTag size="small" :type="timelineTagType(item.severity)">
                        {{ timelineTypeLabel(item.type) }}
                      </NTag>
                    </div>
                    <NText depth="3" class="text-xs">{{ item.description }}</NText>

                    <NCollapse class="timeline-details" arrow-placement="right">
                      <NCollapseItem title="Ver detalhes" :name="item.id">
                        <div class="timeline-detail-grid">
                          <div>
                            <span>Tipo</span>
                            <strong>{{ timelineTypeLabel(item.type) }}</strong>
                          </div>
                          <div>
                            <span>Severidade</span>
                            <strong>{{ timelineSeverityLabel(item.severity) }}</strong>
                          </div>
                          <div>
                            <span>Data</span>
                            <strong>{{ formatDate(item.occurredAt) }}</strong>
                          </div>
                          <div>
                            <span>Sessao</span>
                            <strong>{{ item.sessionId ? `#${item.sessionId}` : 'Sem sessao' }}</strong>
                          </div>
                        </div>
                        <div class="timeline-detail-actions">
                          <NButton
                            v-if="dashboard.viewer.role === 'admin'"
                            size="tiny"
                            secondary
                            @click="openTimelineSessions(item)"
                          >
                            Ver sessoes do dia
                          </NButton>
                          <NButton
                            v-if="item.sessionId && dashboard.viewer.role === 'admin'"
                            size="tiny"
                            type="primary"
                            secondary
                            @click="openTimelineItem(item.sessionId)"
                          >
                            Abrir auditoria
                          </NButton>
                        </div>
                      </NCollapseItem>
                    </NCollapse>
                  </div>
                </NTimelineItem>
              </NTimeline>
            </div>
            <NEmpty v-else description="Sem eventos para este filtro." class="py-6" />
          </div>
        </section>
      </template>

      <NEmpty v-else-if="!loading" description="Dashboard indisponivel para este host." class="py-10" />
    </NSpin>
  </div>

  <NModal v-model:show="showActionModal">
    <NCard
      style="width: min(860px, calc(100vw - 32px))"
      title="Solicitar ação por IA"
      :bordered="false"
      role="dialog"
      aria-modal="true"
    >
      <NForm label-placement="top">
        <NAlert v-if="actionFormErrors.length" type="error" class="mb-4">
          <ul class="diagnostic-help-steps">
            <li v-for="item in actionFormErrors" :key="item">{{ item }}</li>
          </ul>
        </NAlert>
        <NAlert v-if="actionRiskBlockingErrors.length" type="warning" class="mb-4">
          <ul class="diagnostic-help-steps">
            <li v-for="item in actionRiskBlockingErrors" :key="item">{{ item }}</li>
          </ul>
        </NAlert>

        <NFormItem label="Resumo">
          <NInput
            v-model:value="actionForm.summary"
            placeholder="Ex.: coletar evidências de CPU alta e validar processos dominantes"
          />
        </NFormItem>

        <div class="action-grid">
          <NFormItem label="Modo">
            <NSelect v-model:value="actionForm.mode" :options="actionModeOptions" />
          </NFormItem>
          <NFormItem label="Canal">
            <NSelect v-model:value="actionForm.channel" :options="actionChannelOptions" />
          </NFormItem>
        </div>

        <NFormItem label="Motivo de aprovação">
          <NInput
            v-model:value="actionForm.approvalReason"
            type="textarea"
            placeholder="Opcional. Use quando a solicitação exigir contexto adicional."
          />
        </NFormItem>

        <NFormItem label="Steps previstos">
          <NDynamicInput v-model:value="actionForm.steps" #="{ value }">
            <div class="action-step-card">
              <NInput v-model:value="value.id" placeholder="ID" />
              <NInput v-model:value="value.label" placeholder="Rótulo" />
              <NInput v-model:value="value.command" type="textarea" placeholder="Comando previsto" />
              <NInput
                :value="String(value.timeoutSeconds ?? '')"
                placeholder="Timeout (s)"
                @update:value="(next) => { value.timeoutSeconds = Number(next || 0) }"
              />
            </div>
          </NDynamicInput>
        </NFormItem>

        <div class="mb-4 rounded border border-white/10 bg-black/10 p-3">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <NText strong class="block text-sm">Preview de risco</NText>
              <NText depth="3" class="block text-xs mt-1">
                Avalia os comandos contra a policy persistida do tenant antes de registrar a ação.
              </NText>
            </div>
            <NButton
              secondary
              size="small"
              :loading="actionRiskPreviewLoading"
              :disabled="actionForm.steps.every((step) => !step.command.trim())"
              @click="evaluateActionRisks"
            >
              Avaliar riscos
            </NButton>
          </div>

          <div v-if="currentActionRiskPreview.length" class="mt-3 space-y-2">
            <div
              v-for="item in currentActionRiskPreview"
              :key="`${item.index}-${item.command}`"
              class="grid gap-2 rounded bg-white/5 p-2 md:grid-cols-[160px_auto_1fr]"
            >
              <NText class="text-sm">{{ item.label }}</NText>
              <NTag size="small" :type="actionRiskTagType(item.risk)">
                {{ item.risk }}
              </NTag>
              <NText depth="3" class="font-mono text-xs break-all">{{ item.command }}</NText>
            </div>
          </div>
          <NText v-else depth="3" class="block text-xs mt-3">
            Nenhum preview calculado ainda.
          </NText>
        </div>

        <div class="modal-actions">
          <NButton @click="showActionModal = false">Cancelar</NButton>
          <NButton type="primary" :disabled="!canSubmitActionRun" :loading="actionSubmitting" @click="submitActionRun">
            Registrar ação
          </NButton>
        </div>
      </NForm>
    </NCard>
  </NModal>

  <NModal v-model:show="showDiagnosticHelp">
    <NCard
      style="width: min(920px, calc(100vw - 32px))"
      title="Ajuda dos diagnosticos"
      :bordered="false"
      role="dialog"
      aria-modal="true"
    >
      <div class="max-h-[78vh] overflow-y-auto pr-1">
        <div class="mb-5 rounded border border-white/10 p-4">
          <NText depth="3" class="block text-sm">
            Esta area concentra os playbooks tecnicos do host, suas execucoes e o resumo operacional gerado a partir dos resultados coletados.
          </NText>
          <div class="mt-4 grid gap-3 md:grid-cols-3">
            <div
              v-for="item in diagnosticHelpQuickItems"
              :key="item.title"
              class="rounded bg-white/5 p-3"
            >
              <NText strong class="block text-sm">{{ item.title }}</NText>
              <NText depth="3" class="block text-xs mt-1">{{ item.description }}</NText>
            </div>
          </div>
        </div>

        <div class="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <section>
            <h2 class="text-sm font-semibold text-white mb-3">O que voce encontra aqui</h2>
            <div class="overflow-hidden rounded border border-white/10">
              <div
                v-for="field in diagnosticHelpFields"
                :key="field.title"
                class="grid gap-2 border-b border-white/10 p-3 last:border-b-0 md:grid-cols-[170px_1fr]"
              >
                <NText strong class="text-sm">{{ field.title }}</NText>
                <NText depth="3" class="text-sm">{{ field.description }}</NText>
              </div>
            </div>

            <h2 class="text-sm font-semibold text-white mt-5 mb-3">Como usar</h2>
            <div class="rounded border border-white/10 p-3">
              <ol class="diagnostic-help-steps">
                <li v-for="step in diagnosticHelpSteps" :key="step">{{ step }}</li>
              </ol>
            </div>
          </section>

          <section class="space-y-5">
            <div>
              <h2 class="text-sm font-semibold text-white mb-3">Cenarios atendidos</h2>
              <div class="space-y-3">
                <div
                  v-for="scenario in diagnosticHelpScenarios"
                  :key="scenario.title"
                  class="rounded border border-white/10 p-3"
                >
                  <NText strong class="block text-sm">{{ scenario.title }}</NText>
                  <NText depth="3" class="block text-sm mt-2">{{ scenario.description }}</NText>
                </div>
              </div>
            </div>

            <div class="rounded border border-blue-500/30 bg-blue-500/10 p-3">
              <NText strong class="block text-sm text-white">Leitura operacional recomendada</NText>
              <NText depth="3" class="block text-sm mt-2">
                Use o dashboard para triagem rapida. Abra o detalhe da execucao quando precisar confirmar evidencia, revisar cada comando e decidir proximo passo com base na saida coletada.
              </NText>
            </div>
          </section>
        </div>
      </div>
    </NCard>
  </NModal>
</template>

<style scoped>
.host-dashboard-page {
  max-width: 1280px;
  padding: 32px;
}

.host-dashboard-header,
.host-identity-panel {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 24px;
}

.host-dashboard-header h1 {
  margin: 0 0 4px;
  color: #fff;
  font-size: 28px;
  font-weight: 650;
}

.host-dashboard-actions,
.host-quick-actions,
.host-tags,
.host-meta,
.chart-legend,
.recent-session-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.host-identity-panel,
.dashboard-panel,
.metric-tile {
  border: 1px solid #25252b;
  border-radius: 8px;
  background: #17171b;
}

.host-identity-panel {
  padding: 18px;
}

.host-address {
  color: #fff;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 20px;
  font-weight: 700;
}

.host-meta {
  margin-top: 8px;
  color: #9ca3af;
  font-size: 13px;
}

.host-tags {
  margin-top: 12px;
}

.host-kpi-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.metric-tile {
  min-height: 118px;
  padding: 14px;
}

.metric-tile span,
.metric-tile small {
  display: block;
  color: #8b8b95;
  font-size: 12px;
}

.metric-tile strong {
  display: block;
  margin: 8px 0 4px;
  color: #fff;
  font-size: 30px;
}

.health-panel {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr) auto;
  gap: 16px;
  align-items: center;
  margin-bottom: 16px;
  padding: 16px;
  border: 1px solid #25252b;
  border-left-width: 4px;
  border-radius: 8px;
  background: #17171b;
}

.health-healthy {
  border-left-color: #22c55e;
}

.health-attention {
  border-left-color: #f59e0b;
}

.health-critical {
  border-left-color: #ef4444;
}

.health-score span,
.health-reasons-title {
  display: block;
  margin-bottom: 5px;
  color: #8b8b95;
  font-size: 12px;
}

.health-score strong {
  display: block;
  margin-bottom: 8px;
  color: #fff;
  font-size: 32px;
  line-height: 1;
}

.health-reasons ul {
  display: grid;
  gap: 4px;
  margin: 0;
  padding-left: 18px;
  color: #d1d5db;
  font-size: 13px;
}

.health-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.danger {
  color: #f87171 !important;
}

.decision-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.dashboard-panel {
  padding: 18px;
}

.dashboard-panel.wide {
  grid-column: 1 / -1;
}

.panel-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.panel-title h2 {
  margin: 0 0 4px;
  color: #fff;
  font-size: 16px;
  font-weight: 650;
}

.panel-title p {
  margin: 0;
  color: #8b8b95;
  font-size: 12px;
  line-height: 1.45;
}

.daily-chart {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(22px, 1fr));
  align-items: end;
  gap: 8px;
  min-height: 172px;
}

.daily-column {
  display: grid;
  align-items: end;
  gap: 8px;
  min-width: 0;
  text-align: center;
}

.daily-stack {
  display: flex;
  align-items: end;
  justify-content: center;
  gap: 3px;
  height: 136px;
}

.daily-bar {
  display: block;
  width: 8px;
  border-radius: 4px 4px 0 0;
  border: 0;
  padding: 0;
}

.daily-bar.sessions,
.legend.sessions {
  background: #38bdf8;
}

.daily-bar.failures,
.legend.failures {
  background: #f87171;
}

.daily-bar:not(:disabled) {
  cursor: pointer;
}

.daily-bar:not(:disabled):hover {
  filter: brightness(1.25);
}

.daily-column small,
.bar-row small {
  color: #777783;
  font-size: 11px;
}

.chart-legend {
  margin-top: 14px;
  color: #a1a1aa;
  font-size: 12px;
}

.legend {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  margin-right: 5px;
}

.bar-list {
  display: grid;
  gap: 14px;
}

.diagnostic-playbook-list {
  display: grid;
  gap: 12px;
}

.diagnostic-playbook-item {
  padding: 12px;
  border: 1px solid #25252b;
  border-radius: 8px;
  background: #111114;
}

.diagnostic-playbook-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.diagnostic-playbook-header strong {
  color: #fff;
  font-size: 13px;
}

.diagnostic-playbook-header p {
  margin: 4px 0 0;
  color: #8b8b95;
  font-size: 12px;
  line-height: 1.45;
}

.diagnostic-playbook-tags {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.diagnostic-command-preview {
  margin: 10px 0 8px;
  padding-left: 18px;
  color: #d1d5db;
  font-size: 12px;
}

.diagnostic-command-preview code {
  white-space: pre-wrap;
  word-break: break-word;
}

.diagnostic-playbook-actions {
  margin-top: 10px;
}

.diagnostic-run-list {
  display: grid;
  gap: 10px;
}

.diagnostic-run-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid #25252b;
  border-radius: 8px;
  background: #111114;
}

.diagnostic-run-button {
  width: 100%;
  color: inherit;
  text-align: left;
}

.diagnostic-run-button:hover {
  border-color: #3b82f6;
}

.diagnostic-run-item strong {
  color: #fff;
  font-size: 13px;
}

.diagnostic-run-item p {
  margin: 4px 0 0;
  color: #8b8b95;
  font-size: 12px;
}

.diagnostic-run-subline {
  max-width: 420px;
  line-height: 1.4;
}

.diagnostic-help-steps {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 18px;
  color: #d1d5db;
  font-size: 13px;
  line-height: 1.5;
}

.diagnostic-run-meta {
  display: flex;
  gap: 8px;
  align-items: center;
}

.action-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.action-step-card {
  display: grid;
  gap: 10px;
  width: 100%;
  padding: 12px;
  border: 1px solid #25252b;
  border-radius: 8px;
  background: #111114;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.drilldown-row {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
}

.drilldown-row:not(:disabled) {
  cursor: pointer;
}

.drilldown-row:not(:disabled):hover .bar-label span {
  color: #fff;
}

.drilldown-row:not(:disabled):hover .bar-track span {
  filter: brightness(1.2);
}

.bar-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
  color: #d1d5db;
  font-size: 13px;
}

.bar-label strong {
  color: #fff;
}

.monospace {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.bar-track {
  height: 8px;
  overflow: hidden;
  border-radius: 8px;
  background: #25252b;
}

.bar-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #22c55e;
}

.bar-track.origin span {
  background: #f59e0b;
}

.audit-posture {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.audit-posture-item {
  min-height: 76px;
  padding: 10px;
  border: 1px solid #25252b;
  border-radius: 8px;
  background: #111114;
  text-align: left;
}

.audit-posture-item:not(:disabled) {
  cursor: pointer;
}

.audit-posture-item:not(:disabled):hover {
  border-color: #334155;
  background: #15151a;
}

.audit-posture span {
  display: block;
  color: #8b8b95;
  font-size: 12px;
}

.audit-posture strong {
  display: block;
  margin-top: 8px;
  color: #fff;
  font-size: 24px;
}

.risk-meter {
  display: flex;
  height: 10px;
  overflow: hidden;
  margin-top: 16px;
  border-radius: 8px;
  background: #25252b;
}

.risk-meter .ok {
  background: #22c55e;
}

.risk-meter .warn {
  background: #f59e0b;
}

.risk-meter .bad {
  background: #ef4444;
}

.recent-session-list {
  display: grid;
  gap: 10px;
}

.recent-session-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px;
  border: 1px solid #25252b;
  border-radius: 8px;
  background: #111114;
}

.timeline-list {
  padding: 4px 2px 0;
}

.timeline-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.timeline-action {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #25252b;
  border-radius: 8px;
  background: #111114;
  color: inherit;
  text-align: left;
}

.timeline-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.timeline-details {
  margin-top: 6px;
}

.timeline-detail-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.timeline-detail-grid div {
  min-height: 62px;
  padding: 9px;
  border: 1px solid #25252b;
  border-radius: 8px;
  background: #17171b;
}

.timeline-detail-grid span {
  display: block;
  color: #8b8b95;
  font-size: 11px;
}

.timeline-detail-grid strong {
  display: block;
  margin-top: 5px;
  color: #fff;
  font-size: 12px;
}

.timeline-detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.recent-session-row strong,
.recent-session-row span {
  display: block;
}

.recent-session-row strong {
  color: #fff;
  font-size: 13px;
}

.recent-session-row span {
  margin-top: 3px;
  color: #8b8b95;
  font-size: 12px;
}

@media (max-width: 1100px) {
  .host-kpi-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .host-dashboard-page {
    padding: 20px;
  }

  .host-dashboard-header,
  .host-identity-panel,
  .recent-session-row {
    display: grid;
  }

  .host-kpi-grid,
  .decision-grid,
  .audit-posture,
  .timeline-detail-grid,
  .health-panel,
  .action-grid {
    grid-template-columns: 1fr;
  }

  .health-actions {
    justify-content: flex-start;
  }

  .host-dashboard-actions,
  .host-quick-actions {
    width: 100%;
  }
}
</style>
