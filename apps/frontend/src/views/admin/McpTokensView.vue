<script setup lang="ts">
import { computed, h, nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NCard,
  NCheckbox,
  NDataTable,
  NEmpty,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NSelect,
  NSpace,
  NTag,
  NText,
  NTooltip,
  useDialog,
  useMessage,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import type { SelectOption } from 'naive-ui'
import type { McpCapabilityDefinition, McpTokenPublicRecord } from '@/services/mcp.service'
import { buildMcpAgentSetup, mcpService, runMcpReadOnlyProbe } from '@/services/mcp.service'
import type { McpProbeStep } from '@/services/mcp.service'
import { hostService } from '@/services/host.service'
import { featuresService } from '@/services/features.service'

const message = useMessage()
const dialog = useDialog()
const router = useRouter()

const loading = ref(false)
const modalLoading = ref(false)
const error = ref<string | null>(null)
const showCreateModal = ref(false)
const showEditModal = ref(false)
const showHelp = ref(false)
const showConnectGuide = ref(false)
const showUsageModal = ref(false)
const createdTokenValue = ref<string | null>(null)
const createdTokenId = ref<number | null>(null)
const createdTokenResult = ref<HTMLElement | null>(null)
const editingTokenId = ref<number | null>(null)
const usageToken = ref<McpTokenPublicRecord | null>(null)
const tokens = ref<McpTokenPublicRecord[]>([])
const capabilities = ref<McpCapabilityDefinition[]>([])
const search = ref('')
const onlyActive = ref(true)
const usageFilter = ref<'all' | 'used' | 'unused'>('all')
const selectedPreset = ref<'read' | 'diagnostic' | 'approval' | 'full' | 'shell' | null>(null)
const hostOptions = ref<SelectOption[]>([])
const hostSearchLoading = ref(false)
const form = ref({
  name: '',
  allowedCapabilities: [] as string[],
  allowedActionModes: [] as string[],
  allowedHostIds: [] as number[],
  expiresAt: '',
})
const fullOperationalAccessConfirmed = ref(false)
const probeLoading = ref(false)
const probeSteps = ref<McpProbeStep[]>([])
const runtimeStatus = ref({
  loading: true,
  licensed: false,
  environmentEnabled: false,
  operational: false,
  detail: 'Verificando disponibilidade do MCP…',
})

const actionModeOptions = [
  { label: 'Somente leitura', value: 'read_only' },
  { label: 'Diagnóstico', value: 'diagnostic_only' },
  { label: 'Exige aprovação', value: 'approval_required' },
  { label: 'Acesso operacional completo', value: 'full_operational_access' },
]
const actionModeHelp: Record<string, string> = {
  read_only: 'Uso voltado a leitura e contexto. Não deve ser usado para mudanças operacionais.',
  diagnostic_only: 'Permite runs de diagnóstico e coleta segura quando a policy classificar o comando como baixo risco.',
  approval_required: 'Permite propor operação que continua exigindo aprovação administrativa antes da execução.',
  full_operational_access: 'Permite ActionRun com full access quando o token e a policy autorizarem. Exige cuidado operacional e auditoria.',
}

const helpProfiles = [
  {
    key: 'read',
    title: 'Consulta',
    description: 'Discovery e leitura de recursos sem acionar mudanças operacionais.',
  },
  {
    key: 'diagnostic',
    title: 'Diagnóstico',
    description: 'Objetivos de diagnóstico por nome do host, com policy, evidências e execução previsível.',
  },
  {
    key: 'approval',
    title: 'Operação assistida',
    description: 'Cria runs operacionais que continuam exigindo aprovação humana.',
  },
  {
    key: 'full',
    title: 'Full governado',
    description: 'Permite full_operational_access com policy, host e auditoria.',
  },
  {
    key: 'shell',
    title: 'Shell livre',
    description: 'Expõe sessão SSH interativa MCP para clientes que assumem esse risco.',
  },
] as const

const normalizedSearch = computed(() => search.value.trim().toLowerCase())
const highlightedCapabilities = computed(() => capabilities.value
  .filter((item) => item.kind !== 'prompt')
  .sort((a, b) => {
    const riskOrder = { high: 0, medium: 1, low: 2 }
    return riskOrder[a.risk] - riskOrder[b.risk] || a.title.localeCompare(b.title)
  }))

const filteredTokens = computed(() => tokens.value.filter((token) => {
  const matchesSearch = !normalizedSearch.value
    || token.name.toLowerCase().includes(normalizedSearch.value)
    || token.createdByName.toLowerCase().includes(normalizedSearch.value)
    || token.allowedCapabilities.some((item) => item.toLowerCase().includes(normalizedSearch.value))
    || token.allowedActionModes.some((item) => item.toLowerCase().includes(normalizedSearch.value))
    || token.allowedHostIds.some((item) => String(item).includes(normalizedSearch.value))
  const matchesActive = !onlyActive.value || token.active
  const matchesUsage =
    usageFilter.value === 'all'
    || (usageFilter.value === 'used' && token.lastUsage)
    || (usageFilter.value === 'unused' && !token.lastUsage)
  return matchesSearch && matchesActive && matchesUsage
}))

const tokenSummary = computed(() => ({
  total: tokens.value.length,
  active: tokens.value.filter((token) => token.active).length,
  used: tokens.value.filter((token) => token.lastUsage).length,
  unused: tokens.value.filter((token) => !token.lastUsage).length,
  fullAccess: tokens.value.filter((token) => token.allowedActionModes.includes('full_operational_access')).length,
  shellEnabled: tokens.value.filter((token) => token.allowedCapabilities.includes('open_interactive_ssh_session')).length,
}))

const formErrors = computed(() => {
  const errors: string[] = []
  if (!form.value.name.trim()) errors.push('Informe um nome para o token MCP.')
  if (requiresFullOperationalAccessConfirmation.value && !fullOperationalAccessConfirmed.value) {
    errors.push('Confirme explicitamente o acesso operacional completo.')
  }
  if (form.value.expiresAt.trim()) {
    const date = new Date(form.value.expiresAt)
    if (Number.isNaN(date.getTime())) errors.push('Informe uma data de expiração válida.')
  }
  return errors
})

const requiresFullOperationalAccessConfirmation = computed(() => form.value.allowedActionModes.includes('full_operational_access'))
const canSave = computed(() => formErrors.value.length === 0)
const formRiskSummary = computed(() => {
  const hasShell = form.value.allowedCapabilities.includes('open_interactive_ssh_session')
  const hasFull = form.value.allowedActionModes.includes('full_operational_access')
  const hasApproval = form.value.allowedActionModes.includes('approval_required')
  const hasRequestAction = form.value.allowedCapabilities.includes('request_action_run')
  const hasHostRestriction = form.value.allowedHostIds.length > 0

  if (hasShell) {
    return {
      label: 'Shell livre',
      type: 'error' as const,
      summary: hasHostRestriction
        ? 'Sessão SSH interativa liberada com escopo de host restrito.'
        : 'Sessão SSH interativa liberada sem restrição explícita de host.',
      warnings: [
        'Exige token persistido, admin efetivo e full access explícito.',
        hasHostRestriction ? null : 'Preencha hosts permitidos para reduzir o escopo operacional.',
      ].filter(Boolean) as string[],
    }
  }

  if (hasFull && hasRequestAction) {
    return {
      label: 'Full governado',
      type: 'warning' as const,
      summary: hasHostRestriction
        ? 'ActionRun em full_operational_access com governança e host restrito.'
        : 'ActionRun em full_operational_access sem restrição explícita de host.',
      warnings: [
        'A policy continua bloqueando comandos classificados como blocked.',
        hasHostRestriction ? null : 'Considere restringir hosts para limitar blast radius.',
      ].filter(Boolean) as string[],
    }
  }

  if (hasApproval && hasRequestAction) {
    return {
      label: 'Operação assistida',
      type: 'info' as const,
      summary: 'Operações podem ser propostas, mas continuam exigindo aprovação administrativa.',
      warnings: ['Bom perfil para automação com supervisão humana.'],
    }
  }

  if (hasRequestAction) {
    return {
      label: 'Diagnóstico',
      type: 'success' as const,
      summary: 'Permite avaliação de policy e runs de diagnóstico previsíveis.',
      warnings: ['Evite ampliar capabilities sem necessidade operacional clara.'],
    }
  }

  return {
    label: 'Consulta',
    type: 'default' as const,
    summary: 'Token focado em discovery e leitura de recursos.',
    warnings: ['Perfil recomendado para integrações de baixo risco.'],
  }
})
const apiBaseUrl = computed(() => {
  if (typeof window === 'undefined') return 'http://localhost:3000/api/v1'
  return `${window.location.origin}/api/v1`
})
const agentSetup = computed(() => buildMcpAgentSetup(apiBaseUrl.value))
const activeUsageTokenValue = computed(() => (
  usageToken.value?.id === createdTokenId.value ? createdTokenValue.value : null
))
const usageTokenValue = computed(() => activeUsageTokenValue.value ?? '<TOKEN_MCP>')

const usageExamples = computed(() => {
  const base = apiBaseUrl.value
  const token = usageTokenValue.value
  const allowed = usageToken.value?.allowedCapabilities ?? []
  const capability = allowed[0] ?? 'search_hosts'
  const hostId = usageToken.value?.allowedHostIds[0] ?? 12
  const searchBody = capability === 'search_hosts'
    ? `-H "Content-Type: application/json" -d '{"query":"prod","limit":5}'`
    : capability === 'search_snippets'
      ? `-H "Content-Type: application/json" -d '{"query":"mysql","limit":5}'`
      : ''

  return {
    endpoint: `${base}/mcp/jsonrpc`,
    clientConfig: JSON.stringify({
      transport: 'http',
      url: `${base}/mcp/jsonrpc`,
      headers: { Authorization: `Bearer ${token}` },
    }, null, 2),
    capabilities: `curl -H "Authorization: Bearer ${token}" "${base}/mcp/capabilities"`,
    discovery: `curl -H "Authorization: Bearer ${token}" "${base}/mcp/tools"`,
    tool: searchBody
      ? `curl -X POST -H "Authorization: Bearer ${token}" ${searchBody} "${base}/mcp/tools/${capability.replaceAll('_', '-')}"`.trim()
      : `curl -H "Authorization: Bearer ${token}" "${base}/mcp/resources"`,
    evaluateAction: `curl -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '{"mode":"diagnostic_only","steps":[{"id":"step-1","label":"Carga atual","command":"uptime"}]}' "${base}/mcp/tools/evaluate-action-command-policy"`,
    requestAction: `curl -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '{"hostId":${hostId},"mode":"approval_required","channel":"mcp","summary":"Reiniciar nginx","steps":[{"id":"step-1","label":"Restart nginx","command":"systemctl restart nginx","timeoutSeconds":60}]}' "${base}/mcp/tools/request-action-run"`,
    openShell: `curl -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '{"hostId":${hostId},"reason":"Sessão MCP shell","ttlSeconds":900,"cols":120,"rows":32}' "${base}/mcp/tools/open-interactive-ssh-session"`,
  }
})
const selectedHostSummaries = computed(() => form.value.allowedHostIds.map((id) => {
  const option = hostOptions.value.find((item) => item.value === id)
  return {
    id,
    label: typeof option?.label === 'string' ? option.label : `#${id} · Host`,
  }
}))

const columns: DataTableColumns<McpTokenPublicRecord> = [
  { title: 'Nome', key: 'name', minWidth: 180 },
  {
    title: 'Perfil',
    key: 'profile',
    width: 150,
    render: (row) => h(NTag, { size: 'small', type: tokenProfileType(row) }, () => tokenProfileLabel(row)),
  },
  {
    title: 'Status',
    key: 'active',
    width: 120,
    render: (row) => h(NTag, { size: 'small', type: row.active ? 'success' : 'warning' }, () => row.active ? 'Ativo' : 'Revogado'),
  },
  {
    title: 'Capabilities',
    key: 'allowedCapabilities',
    minWidth: 240,
    render: (row) => row.allowedCapabilities.length
      ? h(NSpace, { size: 4, wrap: true }, () => row.allowedCapabilities.map((item) => {
        const meta = capabilityMeta(item)
        return h(NTag, { size: 'small', type: meta ? riskTagType(meta.risk) : 'default' }, () => meta?.title ?? item)
      }))
      : h(NText, { depth: 3 }, () => 'Todas permitidas pelo ambiente'),
  },
  {
    title: 'Modos ActionRun',
    key: 'allowedActionModes',
    minWidth: 220,
    render: (row) => row.allowedActionModes.length
      ? h(NSpace, { size: 4, wrap: true }, () => row.allowedActionModes.map((item) => h(NTag, { size: 'small', type: item === 'full_operational_access' ? 'error' : 'default' }, () => formatActionMode(item))))
      : h(NText, { depth: 3 }, () => 'Sem restrição por token'),
  },
  {
    title: 'Hosts',
    key: 'allowedHostIds',
    minWidth: 160,
    render: (row) => row.allowedHostIds.length
      ? h(NSpace, { size: 4, wrap: true }, () => row.allowedHostIds.map((item) => h(NTag, { size: 'small', type: 'default' }, () => `#${item}`)))
      : h(NText, { depth: 3 }, () => 'Todos no escopo'),
  },
  {
    title: 'Último uso',
    key: 'lastUsedAt',
    width: 170,
    render: (row) => formatDate(row.lastUsedAt),
  },
  {
    title: 'Última chamada',
    key: 'lastUsage',
    minWidth: 220,
    render: (row) => {
      const usage = row.lastUsage
      if (!usage) return h(NText, { depth: 3 }, () => 'Sem uso auditado')
      return h('div', [
        h(NText, { strong: true, style: 'font-size:12px;display:block' }, () => usage.capability ?? prettifyMcpAction(usage.action)),
        h(NText, { depth: 3, style: 'font-size:11px;display:block' }, () => formatUsageDetails(row)),
      ])
    },
  },
  {
    title: 'Ações',
    key: 'actions',
    width: 360,
    render: (row) => h(NSpace, { size: 8 }, () => [
      h(NButton, { size: 'small', tertiary: true, onClick: () => openTokenLogs(row) }, () => 'Logs'),
      h(NButton, { size: 'small', tertiary: true, onClick: () => openTokenUsageLogs(row, 'MCP_TOOL_CALLED') }, () => 'Tools'),
      h(NButton, { size: 'small', tertiary: true, onClick: () => openTokenUsageLogs(row, 'MCP_RESOURCE_READ') }, () => 'Resources'),
      h(NButton, { size: 'small', tertiary: true, onClick: () => openTokenUsageLogs(row, 'MCP_TOOL_CALLED', 'approve_action_run') }, () => 'Approvals'),
      h(NButton, { size: 'small', tertiary: true, onClick: () => openTokenInteractiveShellSessions(row) }, () => 'Shell'),
      h(NButton, { size: 'small', tertiary: true, onClick: () => openUsageModal(row) }, () => 'Uso'),
      h(NButton, { size: 'small', tertiary: true, onClick: () => openEditModal(row) }, () => 'Editar'),
      h(NButton, { size: 'small', type: 'error', tertiary: true, disabled: !row.active, onClick: () => confirmRevoke(row) }, () => 'Revogar'),
    ]),
  },
]

onMounted(async () => {
  await Promise.all([loadTokens(), loadCapabilities(), loadHostOptions(), loadRuntimeStatus()])
})

async function loadRuntimeStatus() {
  runtimeStatus.value.loading = true
  try {
    const features = await featuresService.get()
    const licensed = features.mcpLicensed === true
    const environmentEnabled = features.mcpEnvironmentEnabled === true
    runtimeStatus.value = {
      loading: true,
      licensed,
      environmentEnabled,
      operational: false,
      detail: !licensed
        ? 'Módulo não incluído na licença deste tenant.'
        : !environmentEnabled
          ? 'O backend iniciou com FEATURE_MCP desativado.'
          : 'Executando handshake autenticado…',
    }
    if (!licensed || !environmentEnabled) return

    const { data } = await mcpService.probeRuntime()
    const operational = !data.error && data.result?.protocolVersion === '2025-06-18'
    runtimeStatus.value = {
      loading: false,
      licensed,
      environmentEnabled,
      operational,
      detail: operational
        ? `Handshake ativo · ${data.result?.serverInfo?.name ?? 'nodeaccess-mcp'} ${data.result?.serverInfo?.version ?? ''}`.trim()
        : 'O endpoint respondeu, mas o handshake MCP não foi aceito.',
    }
  } catch {
    runtimeStatus.value = {
      ...runtimeStatus.value,
      loading: false,
      operational: false,
      detail: 'Não foi possível concluir o handshake. Verifique o backend e os logs MCP.',
    }
  } finally {
    runtimeStatus.value.loading = false
  }
}

async function loadTokens() {
  loading.value = true
  error.value = null
  try {
    const { data } = await mcpService.listTokens()
    tokens.value = data
  } catch (err) {
    error.value = resolveErrorMessage(err, 'Não foi possível carregar os tokens MCP.')
  } finally {
    loading.value = false
  }
}

async function loadCapabilities() {
  try {
    const { data } = await mcpService.listAdminCapabilities()
    capabilities.value = data
  } catch {
    capabilities.value = []
  }
}

async function loadHostOptions(searchValue = '') {
  hostSearchLoading.value = true
  try {
    const { data } = await hostService.list({
      page: 1,
      limit: 50,
      ...(searchValue.trim() ? { search: searchValue.trim() } : {}),
    })
    mergeHostOptions(data.data.map((host) => ({
      label: `#${host.id} · ${host.name} (${host.ip}:${host.port})`,
      value: host.id,
    })))
  } catch {
    // best effort
  } finally {
    hostSearchLoading.value = false
  }
}

function mergeHostOptions(options: SelectOption[]) {
  const map = new Map<number, SelectOption>()
  for (const item of hostOptions.value) {
    if (typeof item.value === 'number') map.set(item.value, item)
  }
  for (const item of options) {
    if (typeof item.value === 'number') map.set(item.value, item)
  }
  hostOptions.value = Array.from(map.values()).sort((a, b) => String(a.label ?? '').localeCompare(String(b.label ?? '')))
}

function ensureHostOptionsForIds(ids: number[]) {
  const missing = ids.filter((id) => !hostOptions.value.some((item) => item.value === id))
  if (!missing.length) return
  mergeHostOptions(missing.map((id) => ({ label: `#${id} · Host`, value: id })))
}

function resetForm() {
  form.value = {
    name: '',
    allowedCapabilities: [],
    allowedActionModes: ['read_only', 'diagnostic_only'],
    allowedHostIds: [],
    expiresAt: '',
  }
  createdTokenValue.value = null
  createdTokenId.value = null
  fullOperationalAccessConfirmed.value = false
  selectedPreset.value = null
}

function openCreateModal() {
  editingTokenId.value = null
  resetForm()
  showCreateModal.value = true
}

function openEditModal(token: McpTokenPublicRecord) {
  editingTokenId.value = token.id
  form.value = {
    name: token.name,
    allowedCapabilities: [...token.allowedCapabilities],
    allowedActionModes: [...token.allowedActionModes],
    allowedHostIds: [...token.allowedHostIds],
    expiresAt: token.expiresAt ? token.expiresAt.slice(0, 16) : '',
  }
  ensureHostOptionsForIds(token.allowedHostIds)
  createdTokenValue.value = null
  createdTokenId.value = null
  fullOperationalAccessConfirmed.value = token.allowedActionModes.includes('full_operational_access')
  selectedPreset.value = null
  showEditModal.value = true
}

function openUsageModal(token: McpTokenPublicRecord) {
  usageToken.value = token
  probeSteps.value = []
  showUsageModal.value = true
}

async function runSafeProbe() {
  if (!activeUsageTokenValue.value || !usageToken.value) return
  probeLoading.value = true
  probeSteps.value = []
  try {
    probeSteps.value = await runMcpReadOnlyProbe(activeUsageTokenValue.value, apiBaseUrl.value, usageToken.value.allowedCapabilities)
  } finally {
    probeLoading.value = false
  }
}

function probeTagType(status: McpProbeStep['status']) {
  if (status === 'passed') return 'success'
  if (status === 'failed') return 'error'
  return 'default'
}

function probeStatusLabel(status: McpProbeStep['status']) {
  if (status === 'passed') return 'Aprovado'
  if (status === 'failed') return 'Falhou'
  return 'Ignorado'
}

async function submitCreate() {
  if (!canSave.value || createdTokenValue.value) return
  modalLoading.value = true
  try {
    const { data } = await mcpService.createToken({
      name: form.value.name.trim(),
      ...(form.value.allowedCapabilities.length ? { allowedCapabilities: form.value.allowedCapabilities } : {}),
      ...(form.value.allowedActionModes.length ? { allowedActionModes: form.value.allowedActionModes } : {}),
      ...(form.value.allowedHostIds.length ? { allowedHostIds: form.value.allowedHostIds } : {}),
      ...(form.value.expiresAt.trim() ? { expiresAt: new Date(form.value.expiresAt).toISOString() } : {}),
    })
    createdTokenValue.value = data.token
    createdTokenId.value = data.record.id
    tokens.value = [data.record, ...tokens.value]
    usageToken.value = data.record
    message.success('Token MCP criado.')
    await nextTick()
    createdTokenResult.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    createdTokenResult.value?.querySelector<HTMLButtonElement>('button')?.focus()
  } catch (err) {
    message.error(resolveErrorMessage(err, 'Não foi possível criar o token MCP.'))
  } finally {
    modalLoading.value = false
  }
}

async function submitEdit() {
  if (!canSave.value || editingTokenId.value === null) return
  modalLoading.value = true
  try {
    const { data } = await mcpService.updateToken(editingTokenId.value, {
      name: form.value.name.trim(),
      ...(form.value.allowedCapabilities.length ? { allowedCapabilities: form.value.allowedCapabilities } : {}),
      ...(form.value.allowedActionModes.length ? { allowedActionModes: form.value.allowedActionModes } : {}),
      ...(form.value.allowedHostIds.length ? { allowedHostIds: form.value.allowedHostIds } : {}),
      expiresAt: form.value.expiresAt.trim() ? new Date(form.value.expiresAt).toISOString() : null,
    })
    tokens.value = tokens.value.map((item) => item.id === data.id ? data : item)
    showEditModal.value = false
    editingTokenId.value = null
    message.success('Token MCP atualizado.')
  } catch (err) {
    message.error(resolveErrorMessage(err, 'Não foi possível atualizar o token MCP.'))
  } finally {
    modalLoading.value = false
  }
}

function confirmRevoke(token: McpTokenPublicRecord) {
  dialog.warning({
    title: 'Revogar token MCP',
    content: `Deseja revogar o token "${token.name}"?`,
    positiveText: 'Revogar',
    negativeText: 'Cancelar',
    onPositiveClick: async () => {
      try {
        const { data } = await mcpService.revokeToken(token.id)
        tokens.value = tokens.value.map((item) => item.id === data.id ? data : item)
        message.success('Token MCP revogado.')
      } catch (err) {
        message.error(resolveErrorMessage(err, 'Não foi possível revogar o token MCP.'))
      }
    },
  })
}

async function copyCreatedToken() {
  if (!createdTokenValue.value) return
  try {
    await navigator.clipboard.writeText(createdTokenValue.value)
    message.success('Token copiado.')
  } catch {
    message.warning('Não foi possível copiar automaticamente. Copie manualmente.')
  }
}

async function copyUsageExample(value: string) {
  try {
    await navigator.clipboard.writeText(value)
    message.success('Comando copiado.')
  } catch {
    message.warning('Não foi possível copiar automaticamente. Copie manualmente.')
  }
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function formatActionMode(mode: string) {
  const option = actionModeOptions.find((item) => item.value === mode)
  return option?.label ?? mode
}

function toggleActionMode(value: string, checked: boolean) {
  form.value.allowedActionModes = checked
    ? [...new Set([...form.value.allowedActionModes, value])]
    : form.value.allowedActionModes.filter((item) => item !== value)
  if (value === 'full_operational_access' && !checked) fullOperationalAccessConfirmed.value = false
}

function actionModeTooltip(mode: string) {
  return actionModeHelp[mode] ?? mode
}

function removeAllowedHost(hostId: number) {
  form.value.allowedHostIds = form.value.allowedHostIds.filter((id) => id !== hostId)
}

function capabilityMeta(key: string) {
  return capabilities.value.find((item) => item.key === key) ?? null
}

function riskTagType(risk: McpCapabilityDefinition['risk']) {
  if (risk === 'high') return 'error'
  if (risk === 'medium') return 'warning'
  return 'success'
}

function tokenHasCapability(token: McpTokenPublicRecord, capability: string) {
  return token.allowedCapabilities.includes(capability)
}

function tokenProfileLabel(token: McpTokenPublicRecord) {
  if (tokenHasCapability(token, 'open_interactive_ssh_session')) return 'Shell livre'
  if (token.allowedActionModes.includes('full_operational_access')) return 'Full governado'
  if (token.allowedActionModes.includes('approval_required')) return 'Operação assistida'
  if (token.allowedActionModes.includes('diagnostic_only')) return 'Diagnóstico'
  return 'Consulta'
}

function tokenProfileType(token: McpTokenPublicRecord) {
  if (tokenHasCapability(token, 'open_interactive_ssh_session')) return 'error'
  if (token.allowedActionModes.includes('full_operational_access')) return 'warning'
  if (token.allowedActionModes.includes('approval_required')) return 'info'
  return 'default'
}

function applyPreset(preset: 'read' | 'diagnostic' | 'approval' | 'full' | 'shell') {
  selectedPreset.value = preset
  const capabilitySet = new Set<string>()
  let actionModes: string[] = []

  if (preset === 'read') {
    ;['search_hosts', 'search_snippets', 'get_host_dashboard', 'list_host_diagnostic_runs', 'get_diagnostic_run'].forEach((item) => capabilitySet.add(item))
    actionModes = ['read_only']
  } else if (preset === 'diagnostic') {
    ;['search_hosts', 'get_host_dashboard', 'list_host_diagnostic_runs', 'get_diagnostic_run', 'evaluate_action_command_policy', 'run_host_operation', 'request_action_run', 'list_host_action_runs', 'get_action_run']
      .forEach((item) => capabilitySet.add(item))
    actionModes = ['read_only', 'diagnostic_only']
  } else if (preset === 'approval') {
    ;['search_hosts', 'evaluate_action_command_policy', 'run_host_operation', 'request_action_run', 'approve_action_run', 'reject_action_run', 'list_host_action_runs', 'get_action_run']
      .forEach((item) => capabilitySet.add(item))
    actionModes = ['approval_required']
  } else if (preset === 'full') {
    ;['search_hosts', 'evaluate_action_command_policy', 'run_host_operation', 'request_action_run', 'list_host_action_runs', 'get_action_run']
      .forEach((item) => capabilitySet.add(item))
    actionModes = ['full_operational_access']
  } else {
    ;['search_hosts', 'run_host_operation', 'list_host_action_runs', 'get_action_run', 'open_interactive_ssh_session', 'write_interactive_ssh_session', 'read_interactive_ssh_session', 'resize_interactive_ssh_session', 'close_interactive_ssh_session']
      .forEach((item) => capabilitySet.add(item))
    actionModes = ['full_operational_access']
  }

  form.value.allowedCapabilities = capabilities.value
    .filter((item) => capabilitySet.has(item.key))
    .map((item) => item.key)
  form.value.allowedActionModes = actionModes
  fullOperationalAccessConfirmed.value = false
}

function prettifyMcpAction(action: string) {
  return action
    .replace(/^MCP_/, '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ')
}

function formatUsageDetails(token: McpTokenPublicRecord) {
  const usage = token.lastUsage
  if (!usage) return '—'
  const parts = [
    formatDate(usage.timestamp),
    usage.authMode ? `auth=${usage.authMode}` : null,
    usage.hostId !== null ? `host=#${usage.hostId}` : null,
    usage.runId !== null ? `run=#${usage.runId}` : null,
  ].filter(Boolean)
  return parts.join(' • ')
}

function resolveErrorMessage(errorLike: unknown, fallback: string) {
  const responseMessage = (errorLike as { response?: { data?: { message?: string } } })?.response?.data?.message
  return typeof responseMessage === 'string' && responseMessage.trim() ? responseMessage : fallback
}

function openMcpLogs(targetType?: 'MCP' | 'McpToken') {
  void router.push({
    name: 'admin-logs',
    query: {
      tab: 'admin',
      ...(targetType ? { targetType } : { targetType: 'MCP' }),
    },
  })
}

function openMcpLogsQuickFilter(kind: 'tools' | 'resources' | 'approvals' | 'tokens') {
  if (kind === 'tokens') {
    void router.push({ name: 'admin-logs', query: { tab: 'admin', targetType: 'McpToken' } })
    return
  }

  const action = kind === 'tools'
    ? 'MCP_TOOL_CALLED'
    : kind === 'resources'
      ? 'MCP_RESOURCE_READ'
      : 'MCP_TOOL_CALLED'

  void router.push({
    name: 'admin-logs',
    query: {
      tab: 'admin',
      targetType: 'MCP',
      action,
      ...(kind === 'approvals' ? { search: 'approve_action_run' } : {}),
    },
  })
}

function openTokenLogs(token: McpTokenPublicRecord) {
  void router.push({ name: 'admin-logs', query: { tab: 'admin', targetType: 'McpToken', targetId: String(token.id) } })
}

function openTokenUsageLogs(token: McpTokenPublicRecord, action: 'MCP_TOOL_CALLED' | 'MCP_RESOURCE_READ', searchValue?: string) {
  void router.push({
    name: 'admin-logs',
    query: {
      tab: 'admin',
      targetType: 'MCP',
      action,
      mcpTokenId: String(token.id),
      mcpAuthMode: 'persisted_token',
      ...(searchValue ? { search: searchValue } : {}),
    },
  })
}

function openTokenDeniedLogs(token: McpTokenPublicRecord, action: 'MCP_DENIED' | 'MCP_RATE_LIMITED') {
  void router.push({
    name: 'admin-logs',
    query: {
      tab: 'admin',
      targetType: 'MCP',
      action,
      mcpTokenId: String(token.id),
      mcpAuthMode: 'persisted_token',
    },
  })
}

function openTokenInteractiveShellSessions(token: McpTokenPublicRecord) {
  void router.push({
    name: 'admin-logs',
    query: {
      tab: 'admin',
      mcpInteractiveSessions: '1',
      mcpInteractiveTokenId: String(token.id),
    },
  })
}

function setUsageFilter(value: typeof usageFilter.value) {
  usageFilter.value = value
}

function createTokenFromGuide() {
  showConnectGuide.value = false
  openCreateModal()
  applyPreset('read')
}
</script>

<template>
  <div class="mcp-tokens-view">
    <div class="page-header">
      <div>
        <h1>Tokens MCP</h1>
        <p>Governança de acesso para Agentes, Modelos e Serviços de Inteligência Artificial (AI) via protocolo MCP do servidor NodeAccess deste tenant.</p>
      </div>
      <NSpace>
        <NButton tertiary @click="openMcpLogsQuickFilter('tools')">Tools</NButton>
        <NButton tertiary @click="openMcpLogsQuickFilter('resources')">Resources</NButton>
        <NButton tertiary @click="openMcpLogsQuickFilter('approvals')">Approvals</NButton>
        <NButton tertiary @click="openMcpLogsQuickFilter('tokens')">Tokens</NButton>
        <NButton tertiary @click="openMcpLogs()">Logs MCP</NButton>
        <NButton tertiary @click="showHelp = true">Ajuda</NButton>
        <NButton secondary type="primary" :disabled="!runtimeStatus.operational" @click="showConnectGuide = true">Conectar agente</NButton>
        <NButton type="primary" @click="openCreateModal">Novo token</NButton>
      </NSpace>
    </div>

    <NCard size="small" class="runtime-status-card" data-testid="mcp-runtime-status">
      <div class="runtime-status-header">
        <div>
          <h3>Disponibilidade do MCP</h3>
          <p>{{ runtimeStatus.detail }}</p>
        </div>
        <NButton size="small" tertiary :loading="runtimeStatus.loading" @click="loadRuntimeStatus">Verificar novamente</NButton>
      </div>
      <div class="runtime-status-grid" aria-live="polite">
        <div class="runtime-status-item">
          <span>Licença do tenant</span>
          <NTag size="small" :type="runtimeStatus.licensed ? 'success' : 'error'">
            {{ runtimeStatus.licensed ? 'Licenciado' : 'Não licenciado' }}
          </NTag>
        </div>
        <div class="runtime-status-item">
          <span>Ambiente do backend</span>
          <NTag size="small" :type="runtimeStatus.environmentEnabled ? 'success' : 'error'">
            {{ runtimeStatus.environmentEnabled ? 'FEATURE_MCP ativo' : 'FEATURE_MCP inativo' }}
          </NTag>
        </div>
        <div class="runtime-status-item">
          <span>Handshake autenticado</span>
          <NTag size="small" :type="runtimeStatus.operational ? 'success' : runtimeStatus.loading ? 'warning' : 'error'">
            {{ runtimeStatus.loading ? 'Verificando' : runtimeStatus.operational ? 'Operacional' : 'Indisponível' }}
          </NTag>
        </div>
      </div>
    </NCard>

    <div class="summary-grid">
      <NCard size="small" class="summary-card">
        <div class="summary-label">Tokens ativos</div>
        <div class="summary-value">{{ tokenSummary.active }}</div>
        <div class="summary-hint">{{ tokenSummary.total }} cadastrados</div>
      </NCard>
      <NCard size="small" class="summary-card">
        <div class="summary-label">Com uso auditado</div>
        <div class="summary-value">{{ tokenSummary.used }}</div>
        <div class="summary-hint">{{ tokenSummary.unused }} ainda sem uso</div>
      </NCard>
      <NCard size="small" class="summary-card">
        <div class="summary-label">Full governado</div>
        <div class="summary-value">{{ tokenSummary.fullAccess }}</div>
        <div class="summary-hint">Com `full_operational_access`</div>
      </NCard>
      <NCard size="small" class="summary-card summary-card-risk">
        <div class="summary-label">Shell livre</div>
        <div class="summary-value">{{ tokenSummary.shellEnabled }}</div>
        <div class="summary-hint">Com sessão MCP shell</div>
      </NCard>
    </div>

    <NCard size="small" class="overview-card">
      <div class="overview-header">
        <div>
          <h3>Fluxo rápido</h3>
          <p>Autorize integrações de IA com o menor escopo necessário, limite hosts quando fizer sentido e acompanhe todo uso por logs e auditoria.</p>
        </div>
        <NButton tertiary @click="showHelp = true">Guia rápido</NButton>
      </div>
      <div class="overview-flow">
        <span class="flow-node flow-node-client">Agente / Modelo AI</span>
        <span class="flow-arrow">→</span>
        <span class="flow-node">Token MCP</span>
        <span class="flow-arrow">→</span>
        <span class="flow-node">Capabilities + modos</span>
        <span class="flow-arrow">→</span>
        <span class="flow-node flow-node-audit">Logs e auditoria</span>
      </div>
      <div class="preset-grid">
        <button
          v-for="item in helpProfiles"
          :key="item.key"
          type="button"
          class="preset-card"
          @click="openCreateModal(); applyPreset(item.key)"
        >
          <strong>{{ item.title }}</strong>
          <span>{{ item.description }}</span>
        </button>
      </div>
    </NCard>

    <NAlert v-if="error" type="error">
      {{ error }}
    </NAlert>

    <div class="toolbar">
      <NInput v-model:value="search" placeholder="Buscar por nome, criador, capability ou host" clearable />
      <NCheckbox v-model:checked="onlyActive">Somente ativos</NCheckbox>
      <NSpace size="small" wrap>
        <NButton size="small" :type="usageFilter === 'all' ? 'primary' : 'default'" tertiary @click="setUsageFilter('all')">Todos {{ tokenSummary.total }}</NButton>
        <NButton size="small" :type="usageFilter === 'used' ? 'primary' : 'default'" tertiary @click="setUsageFilter('used')">Com uso {{ tokenSummary.used }}</NButton>
        <NButton size="small" :type="usageFilter === 'unused' ? 'primary' : 'default'" tertiary @click="setUsageFilter('unused')">Sem uso {{ tokenSummary.unused }}</NButton>
      </NSpace>
      <NButton tertiary @click="openMcpLogs('McpToken')">Ver logs de tokens</NButton>
    </div>

    <NDataTable
      :columns="columns"
      :data="filteredTokens"
      :loading="loading"
      :bordered="false"
      size="small"
      :row-key="(row: McpTokenPublicRecord) => row.id"
    />

    <div v-if="!loading && !filteredTokens.length" class="empty-state">
      <NEmpty description="Nenhum token MCP encontrado.">
        <template #extra>
          <NButton type="primary" @click="openCreateModal">Criar primeiro token</NButton>
        </template>
      </NEmpty>
    </div>

    <NModal v-model:show="showCreateModal" preset="card" :style="{ width: '920px', maxWidth: 'calc(100vw - 24px)' }" title="Novo token MCP">
      <NForm label-placement="top">
        <NAlert v-if="formErrors.length" type="error" style="margin-bottom: 16px;">
          <ul class="form-errors">
            <li v-for="item in formErrors" :key="item">{{ item }}</li>
          </ul>
        </NAlert>

        <NFormItem label="Nome">
          <NInput v-model:value="form.name" placeholder="Ex.: Claude - Operação" />
        </NFormItem>

        <NFormItem label="Perfil inicial" class="stacked-form-item">
          <div class="form-section">
            <div class="form-hint form-hint-inline">Use um perfil como ponto de partida e depois refine capabilities, modos e hosts.</div>
            <div class="preset-grid preset-grid-compact">
              <button
                v-for="item in helpProfiles"
                :key="item.key"
                type="button"
                class="preset-card"
                :class="{ 'preset-card-active': selectedPreset === item.key }"
                @click="applyPreset(item.key)"
              >
                <strong>{{ item.title }}</strong>
                <span>{{ item.description }}</span>
              </button>
            </div>
          </div>
        </NFormItem>

        <NAlert :type="formRiskSummary.type" class="risk-summary-alert">
          <div class="risk-summary-content">
            <div class="risk-summary-header">
              <strong>{{ formRiskSummary.label }}</strong>
              <NTag size="small" :type="formRiskSummary.type">{{ formRiskSummary.label }}</NTag>
            </div>
            <div>{{ formRiskSummary.summary }}</div>
            <ul class="risk-summary-list">
              <li v-for="item in formRiskSummary.warnings" :key="item">{{ item }}</li>
            </ul>
          </div>
        </NAlert>

        <NFormItem label="Expira em">
          <input v-model="form.expiresAt" class="native-datetime-input" type="datetime-local">
        </NFormItem>

        <NFormItem label="Capabilities permitidas">
          <div class="form-section">
            <div class="form-hint form-hint-inline">Se nenhuma capability for marcada, o token herda a allowlist do ambiente.</div>
            <div class="capability-list capability-list-rich">
              <label v-for="capability in highlightedCapabilities" :key="capability.key" class="capability-option capability-option-rich">
                <NCheckbox
                  :checked="form.allowedCapabilities.includes(capability.key)"
                  @update:checked="(checked) => {
                    const value = capability.key
                    form.allowedCapabilities = checked
                      ? [...form.allowedCapabilities, value]
                      : form.allowedCapabilities.filter((item) => item !== value)
                  }"
                />
                <div class="capability-copy">
                  <div class="capability-copy-header">
                    <div class="capability-title-row">
                      <strong>{{ capability.title }}</strong>
                      <NTooltip trigger="hover" placement="top" :delay="250">
                        <template #trigger>
                          <button type="button" class="inline-help-button" tabindex="-1" aria-label="Explicação da capability">
                            i
                          </button>
                        </template>
                        <div class="tooltip-copy">
                          <strong>{{ capability.title }}</strong>
                          <div>{{ capability.description }}</div>
                          <div>Risco: {{ capability.risk }} · Módulo: {{ capability.module }}</div>
                        </div>
                      </NTooltip>
                    </div>
                    <NSpace size="small">
                      <NTag size="small" :type="riskTagType(capability.risk)">{{ capability.risk }}</NTag>
                      <NTag size="small">{{ capability.kind }}</NTag>
                    </NSpace>
                  </div>
                  <span class="capability-key">{{ capability.key }}</span>
                  <span>{{ capability.description }}</span>
                </div>
              </label>
            </div>
          </div>
        </NFormItem>

        <NFormItem label="Modos de ActionRun permitidos">
          <div class="form-section">
            <div class="form-hint form-hint-inline">Aplica-se à capability `request_action_run`.</div>
            <div class="mode-grid">
              <label v-for="option in actionModeOptions" :key="option.value" class="mode-option">
                <NCheckbox
                  :checked="form.allowedActionModes.includes(option.value)"
                  @update:checked="(checked) => toggleActionMode(option.value, checked)"
                />
                <div class="mode-copy">
                  <span>{{ option.label }}</span>
                  <NTooltip trigger="hover" placement="top" :delay="250">
                    <template #trigger>
                      <button type="button" class="inline-help-button" tabindex="-1" aria-label="Explicação do modo">
                        i
                      </button>
                    </template>
                    <div class="tooltip-copy">{{ actionModeTooltip(option.value) }}</div>
                  </NTooltip>
                </div>
              </label>
            </div>
            <NAlert v-if="requiresFullOperationalAccessConfirmation" type="error" class="full-access-warning">
              <div class="full-access-warning-content">
                <div>Acesso operacional completo permite executar ações aprovadas automaticamente quando a policy não bloquear o comando.</div>
                <NCheckbox v-model:checked="fullOperationalAccessConfirmed" class="full-access-confirmation">
                  Confirmo que este token deve poder solicitar full_operational_access.
                </NCheckbox>
              </div>
            </NAlert>
          </div>
        </NFormItem>

        <NFormItem label="Hosts permitidos" class="stacked-form-item">
          <div class="form-section">
            <div class="form-hint form-hint-inline">Opcional. Se vazio, o token mantém todos os hosts dentro do escopo do usuário efetivo. Para shell livre, prefira sempre restringir.</div>
            <NSelect
              v-model:value="form.allowedHostIds"
              multiple
              filterable
              remote
              clearable
              :options="hostOptions"
              :loading="hostSearchLoading"
              placeholder="Buscar e vincular hosts por nome ou IP"
              @search="loadHostOptions"
              @focus="loadHostOptions()"
            />
            <div v-if="selectedHostSummaries.length" class="selected-hosts-panel">
              <div class="selected-hosts-label">Hosts vinculados</div>
              <div class="selected-hosts-list">
                <button
                  v-for="host in selectedHostSummaries"
                  :key="host.id"
                  type="button"
                  class="selected-host-chip"
                  @click="removeAllowedHost(host.id)"
                >
                  <span>{{ host.label }}</span>
                  <span class="selected-host-remove">×</span>
                </button>
              </div>
            </div>
          </div>
        </NFormItem>

        <div v-if="createdTokenValue" ref="createdTokenResult" data-testid="created-token-result">
        <NAlert type="warning" class="created-token-result">
          <div class="token-created-alert">
            <div>
              <strong>Token criado. Copie-o agora.</strong>
              <div>Ele não será exibido novamente depois que você fechar esta janela.</div>
            </div>
            <NButton size="small" type="primary" @click="copyCreatedToken">Copiar token</NButton>
          </div>
          <pre class="token-preview">{{ createdTokenValue }}</pre>
        </NAlert>
        </div>

        <div class="modal-actions">
          <NButton @click="showCreateModal = false">{{ createdTokenValue ? 'Concluir' : 'Cancelar' }}</NButton>
          <NButton v-if="!createdTokenValue" type="primary" :loading="modalLoading" :disabled="!canSave" @click="submitCreate">Criar token</NButton>
        </div>
      </NForm>
    </NModal>

    <NModal v-model:show="showEditModal" preset="card" :style="{ width: '920px', maxWidth: 'calc(100vw - 24px)' }" title="Editar token MCP">
      <NForm label-placement="top">
        <NAlert v-if="formErrors.length" type="error" style="margin-bottom: 16px;">
          <ul class="form-errors">
            <li v-for="item in formErrors" :key="item">{{ item }}</li>
          </ul>
        </NAlert>

        <NFormItem label="Nome">
          <NInput v-model:value="form.name" placeholder="Ex.: Claude - Operação" />
        </NFormItem>

        <NFormItem label="Perfil" class="stacked-form-item">
          <div class="form-section">
            <div class="form-hint form-hint-inline">Aplicar um perfil sobrescreve a seleção atual de capabilities e modos.</div>
            <div class="preset-grid preset-grid-compact">
              <button
                v-for="item in helpProfiles"
                :key="item.key"
                type="button"
                class="preset-card"
                :class="{ 'preset-card-active': selectedPreset === item.key }"
                @click="applyPreset(item.key)"
              >
                <strong>{{ item.title }}</strong>
                <span>{{ item.description }}</span>
              </button>
            </div>
          </div>
        </NFormItem>

        <NAlert :type="formRiskSummary.type" class="risk-summary-alert">
          <div class="risk-summary-content">
            <div class="risk-summary-header">
              <strong>{{ formRiskSummary.label }}</strong>
              <NTag size="small" :type="formRiskSummary.type">{{ formRiskSummary.label }}</NTag>
            </div>
            <div>{{ formRiskSummary.summary }}</div>
            <ul class="risk-summary-list">
              <li v-for="item in formRiskSummary.warnings" :key="item">{{ item }}</li>
            </ul>
          </div>
        </NAlert>

        <NFormItem label="Expira em">
          <input v-model="form.expiresAt" class="native-datetime-input" type="datetime-local">
        </NFormItem>

        <NFormItem label="Capabilities permitidas">
          <div class="form-section">
            <div class="form-hint form-hint-inline">Se nenhuma capability for marcada, o token herda a allowlist do ambiente.</div>
            <div class="capability-list capability-list-rich">
              <label v-for="capability in highlightedCapabilities" :key="capability.key" class="capability-option capability-option-rich">
                <NCheckbox
                  :checked="form.allowedCapabilities.includes(capability.key)"
                  @update:checked="(checked) => {
                    const value = capability.key
                    form.allowedCapabilities = checked
                      ? [...form.allowedCapabilities, value]
                      : form.allowedCapabilities.filter((item) => item !== value)
                  }"
                />
                <div class="capability-copy">
                  <div class="capability-copy-header">
                    <div class="capability-title-row">
                      <strong>{{ capability.title }}</strong>
                      <NTooltip trigger="hover" placement="top" :delay="250">
                        <template #trigger>
                          <button type="button" class="inline-help-button" tabindex="-1" aria-label="Explicação da capability">
                            i
                          </button>
                        </template>
                        <div class="tooltip-copy">
                          <strong>{{ capability.title }}</strong>
                          <div>{{ capability.description }}</div>
                          <div>Risco: {{ capability.risk }} · Módulo: {{ capability.module }}</div>
                        </div>
                      </NTooltip>
                    </div>
                    <NSpace size="small">
                      <NTag size="small" :type="riskTagType(capability.risk)">{{ capability.risk }}</NTag>
                      <NTag size="small">{{ capability.kind }}</NTag>
                    </NSpace>
                  </div>
                  <span class="capability-key">{{ capability.key }}</span>
                  <span>{{ capability.description }}</span>
                </div>
              </label>
            </div>
          </div>
        </NFormItem>

        <NFormItem label="Modos de ActionRun permitidos">
          <div class="form-section">
            <div class="form-hint form-hint-inline">Se nenhum modo for marcado, o token não adiciona restrição por modo ao `ActionRun`.</div>
            <div class="mode-grid">
              <label v-for="option in actionModeOptions" :key="option.value" class="mode-option">
                <NCheckbox
                  :checked="form.allowedActionModes.includes(option.value)"
                  @update:checked="(checked) => toggleActionMode(option.value, checked)"
                />
                <div class="mode-copy">
                  <span>{{ option.label }}</span>
                  <NTooltip trigger="hover" placement="top" :delay="250">
                    <template #trigger>
                      <button type="button" class="inline-help-button" tabindex="-1" aria-label="Explicação do modo">
                        i
                      </button>
                    </template>
                    <div class="tooltip-copy">{{ actionModeTooltip(option.value) }}</div>
                  </NTooltip>
                </div>
              </label>
            </div>
            <NAlert v-if="requiresFullOperationalAccessConfirmation" type="error" class="full-access-warning">
              <div class="full-access-warning-content">
                <div>Acesso operacional completo permite executar ações aprovadas automaticamente quando a policy não bloquear o comando.</div>
                <NCheckbox v-model:checked="fullOperationalAccessConfirmed" class="full-access-confirmation">
                  Confirmo que este token deve poder solicitar full_operational_access.
                </NCheckbox>
              </div>
            </NAlert>
          </div>
        </NFormItem>

        <NFormItem label="Hosts permitidos" class="stacked-form-item">
          <div class="form-section">
            <div class="form-hint form-hint-inline">Opcional. Se vazio, o token mantém todos os hosts dentro do escopo do usuário efetivo. Para shell livre, prefira sempre restringir.</div>
            <NSelect
              v-model:value="form.allowedHostIds"
              multiple
              filterable
              remote
              clearable
              :options="hostOptions"
              :loading="hostSearchLoading"
              placeholder="Buscar e vincular hosts por nome ou IP"
              @search="loadHostOptions"
              @focus="loadHostOptions()"
            />
            <div v-if="selectedHostSummaries.length" class="selected-hosts-panel">
              <div class="selected-hosts-label">Hosts vinculados</div>
              <div class="selected-hosts-list">
                <button
                  v-for="host in selectedHostSummaries"
                  :key="host.id"
                  type="button"
                  class="selected-host-chip"
                  @click="removeAllowedHost(host.id)"
                >
                  <span>{{ host.label }}</span>
                  <span class="selected-host-remove">×</span>
                </button>
              </div>
            </div>
          </div>
        </NFormItem>

        <div class="modal-actions">
          <NButton @click="showEditModal = false">Fechar</NButton>
          <NButton type="primary" :loading="modalLoading" :disabled="!canSave" @click="submitEdit">Salvar</NButton>
        </div>
      </NForm>
    </NModal>

    <NModal v-model:show="showHelp" preset="card" :style="{ width: '760px', maxWidth: 'calc(100vw - 24px)' }" title="Ajuda">
      <div class="help-content">
        <section>
          <h3>O que é</h3>
          <p>Tokens MCP permitem que Agentes, Modelos ou Serviços de Inteligência Artificial se autentiquem no NodeAccess fora da sessão web comum, usando o protocolo MCP para consultar contexto, executar ferramentas autorizadas e interagir com recursos do tenant.</p>
          <p>Na prática, esta tela define quais integrações de IA podem acessar o servidor MCP do NodeAccess, com quais permissões, em quais hosts e sob quais limites de auditoria.</p>
        </section>
        <section>
          <h3>Perfis recomendados</h3>
          <div class="help-profile-grid">
            <div v-for="item in helpProfiles" :key="item.key" class="help-profile-card">
              <strong>{{ item.title }}</strong>
              <p>{{ item.description }}</p>
            </div>
          </div>
        </section>
        <section>
          <h3>Como usar</h3>
          <p>Crie um token para a integração de IA, restrinja capabilities, limite hosts quando fizer sentido e use o valor retornado em `Authorization: Bearer ...` ou `x-mcp-token` no cliente MCP.</p>
        </section>
        <section>
          <h3>Quando restringir</h3>
          <p>Se o cliente precisar só de consulta ou diagnóstico, não habilite full access e não exponha shell livre.</p>
        </section>
        <section>
          <h3>Exemplos rápidos</h3>
          <pre class="token-preview">{{ usageExamples.capabilities }}</pre>
          <pre class="token-preview">{{ usageExamples.discovery }}</pre>
        </section>
        <section>
          <h3>Cuidados</h3>
          <p>O token é mostrado uma única vez. Trate-o como credencial sensível, use allowlist de hosts para shell e revogue quando não for mais necessário.</p>
        </section>
      </div>
    </NModal>

    <NModal v-model:show="showConnectGuide" preset="card" :style="{ width: '860px', maxWidth: 'calc(100vw - 24px)' }" title="Conectar seu agente ao NodeAccess" aria-label="Conectar seu agente ao NodeAccess">
      <div class="agent-guide">
        <NAlert type="info">
          Comece com o perfil Consulta. O agente descobrirá somente as ferramentas autorizadas pelo token e todas as chamadas serão auditadas.
        </NAlert>

        <ol class="agent-guide-steps">
          <li>
            <div class="agent-guide-step-heading">
              <span class="agent-guide-step-number" aria-hidden="true">1</span>
              <div>
                <h3>Crie uma credencial mínima</h3>
                <p>Use um token exclusivo por agente. Selecione apenas as capabilities necessárias e defina expiração.</p>
              </div>
            </div>
            <NButton size="small" type="primary" secondary @click="createTokenFromGuide">Criar token de consulta</NButton>
          </li>

          <li>
            <div class="agent-guide-step-heading">
              <span class="agent-guide-step-number" aria-hidden="true">2</span>
              <div>
                <h3>Escolha o agente e cadastre o endpoint</h3>
                <p>Codex, Claude e Gemini usam o mesmo endpoint MCP. O formato da tela ou arquivo muda, mas o token continua no header Bearer.</p>
              </div>
            </div>
            <div class="agent-client-grid">
              <section>
                <strong>Codex</strong>
                <p>Execute uma vez. O comando registra somente o nome da variável, nunca o segredo.</p>
                <pre class="token-preview">{{ agentSetup.codexRegister }}</pre>
                <NButton size="small" secondary @click="copyUsageExample(agentSetup.codexRegister)">Copiar comando Codex</NButton>
              </section>
              <section>
                <strong>Claude</strong>
                <p>Adicione um servidor MCP remoto/HTTP e informe estes dados no cliente.</p>
                <pre class="token-preview">{{ agentSetup.genericHttpConfig }}</pre>
                <NButton size="small" secondary @click="copyUsageExample(agentSetup.genericHttpConfig)">Copiar configuração Claude</NButton>
              </section>
              <section>
                <strong>Gemini</strong>
                <p>Adicione um servidor MCP Streamable HTTP e preserve o token em variável de ambiente.</p>
                <pre class="token-preview">{{ agentSetup.genericHttpConfig }}</pre>
                <NButton size="small" secondary @click="copyUsageExample(agentSetup.genericHttpConfig)">Copiar configuração Gemini</NButton>
              </section>
            </div>
          </li>

          <li>
            <div class="agent-guide-step-heading">
              <span class="agent-guide-step-number" aria-hidden="true">3</span>
              <div>
                <h3>Inicie o agente com o segredo</h3>
                <p>O prompt mostra “Token MCP:” e oculta a digitação. O valor permanece apenas naquela sessão do terminal.</p>
              </div>
            </div>
            <div class="agent-guide-platforms">
              <section>
                <strong>Linux, macOS ou WSL</strong>
                <pre class="token-preview">{{ agentSetup.codexStartBash }}</pre>
                <NButton size="small" secondary @click="copyUsageExample(agentSetup.codexStartBash)">Copiar Bash</NButton>
              </section>
              <section>
                <strong>PowerShell 7+</strong>
                <pre class="token-preview">{{ agentSetup.codexStartPowerShell }}</pre>
                <NButton size="small" secondary @click="copyUsageExample(agentSetup.codexStartPowerShell)">Copiar PowerShell</NButton>
              </section>
            </div>
          </li>

          <li>
            <div class="agent-guide-step-heading">
              <span class="agent-guide-step-number" aria-hidden="true">4</span>
              <div>
                <h3>Valide e peça pelo objetivo</h3>
                <p>No Codex, abra <code>/mcp</code>. Nos demais clientes, confira se o servidor está conectado. Depois descreva o resultado esperado; o agente escolhe as ferramentas permitidas.</p>
              </div>
            </div>
            <div class="agent-prompt-examples" aria-label="Exemplos de solicitações ao agente">
              <code>Diagnostique por que o host API Produção está com load alto sem processos com CPU alta.</code>
              <code>Descubra por que o espaço do host Banco 01 não foi liberado após apagar arquivos e proponha uma mitigação.</code>
              <code>Valide o CSV e proponha a importação no banco X; execute somente se o token permitir e a aprovação for concedida.</code>
            </div>
            <NAlert type="warning">
              Mudanças operacionais podem ficar pendentes de aprovação. Comandos bloqueados pela policy não são executados, mesmo quando solicitados pelo agente.
            </NAlert>
          </li>
        </ol>

        <section class="agent-guide-generic">
          <h3>Outro agente com Streamable HTTP</h3>
          <p>Use esta referência quando o cliente não for o Codex. Adapte o mecanismo de segredo conforme a documentação do agente.</p>
          <pre class="token-preview">{{ agentSetup.genericHttpConfig }}</pre>
          <NButton size="small" secondary @click="copyUsageExample(agentSetup.genericHttpConfig)">Copiar configuração</NButton>
        </section>
      </div>
    </NModal>

    <NModal v-model:show="showUsageModal" preset="card" :style="{ width: '820px', maxWidth: 'calc(100vw - 24px)' }" title="Uso rápido do token MCP">
      <div v-if="usageToken" class="help-content">
        <section>
          <h3>{{ usageToken.name }}</h3>
          <p>Use o token em `Authorization: Bearer ...` ou `x-mcp-token`. O valor real só é mostrado novamente se o token acabou de ser criado nesta sessão.</p>
          <NTag size="small" :type="tokenProfileType(usageToken)">{{ tokenProfileLabel(usageToken) }}</NTag>
        </section>

        <section>
          <h3>Contexto</h3>
          <p>Capabilities: {{ usageToken.allowedCapabilities.length ? usageToken.allowedCapabilities.join(', ') : 'todas as permitidas pelo ambiente' }}.</p>
          <p>Modos de ActionRun: {{ usageToken.allowedActionModes.length ? usageToken.allowedActionModes.map(formatActionMode).join(', ') : 'sem restrição adicional por token' }}.</p>
          <p>Hosts permitidos: {{ usageToken.allowedHostIds.length ? usageToken.allowedHostIds.map((item) => `#${item}`).join(', ') : 'todos os hosts dentro do escopo do usuário efetivo' }}.</p>
          <NSpace size="small" class="usage-log-actions" wrap>
            <NButton size="small" secondary @click="openTokenLogs(usageToken)">Logs do token</NButton>
            <NButton size="small" secondary @click="openTokenDeniedLogs(usageToken, 'MCP_DENIED')">Negados</NButton>
            <NButton size="small" secondary @click="openTokenDeniedLogs(usageToken, 'MCP_RATE_LIMITED')">Rate limit</NButton>
          </NSpace>
        </section>

        <section class="probe-section">
          <h3>Teste seguro da integração</h3>
          <p>Valida autenticação, handshake MCP, catálogos de tools/resources/prompts e uma consulta de até um host. Não abre shell, não cria ActionRun e não altera dados.</p>
          <NAlert v-if="!activeUsageTokenValue" type="info">
            O teste pela interface está disponível apenas logo após a criação, enquanto o valor do token ainda está em memória. Tokens existentes podem ser validados pelos comandos abaixo.
          </NAlert>
          <NButton v-else type="primary" secondary :loading="probeLoading" :disabled="probeLoading" @click="runSafeProbe">
            Executar teste somente leitura
          </NButton>
          <div v-if="probeSteps.length" class="probe-results" aria-live="polite">
            <div v-for="step in probeSteps" :key="step.key" class="probe-result">
              <div>
                <strong>{{ step.label }}</strong>
                <span>{{ step.detail }}</span>
              </div>
              <NSpace size="small" align="center">
                <NText depth="3">{{ step.durationMs }} ms</NText>
                <NTag size="small" :type="probeTagType(step.status)">{{ probeStatusLabel(step.status) }}</NTag>
              </NSpace>
            </div>
          </div>
        </section>

        <section data-testid="mcp-http-client-config">
          <h3>Configuração de cliente MCP via HTTP</h3>
          <p>Use o endpoint abaixo em clientes que aceitam transporte HTTP e headers personalizados. Mantenha o token em variável secreta quando o cliente oferecer essa opção.</p>
          <pre class="token-preview">{{ usageExamples.clientConfig }}</pre>
          <NButton size="small" secondary @click="copyUsageExample(usageExamples.clientConfig)">Copiar configuração</NButton>
        </section>

        <section>
          <h3>Capabilities</h3>
          <pre class="token-preview">{{ usageExamples.capabilities }}</pre>
          <NButton size="small" secondary @click="copyUsageExample(usageExamples.capabilities)">Copiar comando</NButton>
        </section>

        <section>
          <h3>Discovery</h3>
          <pre class="token-preview">{{ usageExamples.discovery }}</pre>
          <NButton size="small" secondary @click="copyUsageExample(usageExamples.discovery)">Copiar comando</NButton>
        </section>

        <section>
          <h3>Exemplo operacional</h3>
          <pre class="token-preview">{{ usageExamples.tool }}</pre>
          <NButton size="small" secondary @click="copyUsageExample(usageExamples.tool)">Copiar comando</NButton>
        </section>

        <section v-if="usageToken.allowedCapabilities.includes('evaluate_action_command_policy')">
          <h3>Avaliar policy</h3>
          <pre class="token-preview">{{ usageExamples.evaluateAction }}</pre>
          <NButton size="small" secondary @click="copyUsageExample(usageExamples.evaluateAction)">Copiar comando</NButton>
        </section>

        <section v-if="usageToken.allowedCapabilities.includes('request_action_run')">
          <h3>Solicitar ActionRun</h3>
          <pre class="token-preview">{{ usageExamples.requestAction }}</pre>
          <NButton size="small" secondary @click="copyUsageExample(usageExamples.requestAction)">Copiar comando</NButton>
        </section>

        <section v-if="usageToken.allowedCapabilities.includes('open_interactive_ssh_session')">
          <h3>Abrir sessão shell</h3>
          <pre class="token-preview">{{ usageExamples.openShell }}</pre>
          <NButton size="small" secondary @click="copyUsageExample(usageExamples.openShell)">Copiar comando</NButton>
        </section>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.mcp-tokens-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.page-header h1 {
  margin: 0;
  font-size: 24px;
}

.page-header p {
  margin: 6px 0 0;
  color: #8b8f98;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.runtime-status-card {
  border-radius: 8px;
}

.runtime-status-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.runtime-status-header h3 {
  margin: 0;
  font-size: 16px;
}

.runtime-status-header p {
  margin: 4px 0 0;
  color: #8b8f98;
}

.runtime-status-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.runtime-status-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
}

.probe-results {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

.probe-result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
}

.probe-result > div:first-child {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.probe-result span {
  color: #8b8f98;
  font-size: 12px;
}

.summary-card {
  border-radius: 8px;
}

.summary-card-risk {
  border: 1px solid rgba(208, 48, 80, 0.35);
}

.summary-label {
  color: #8b8f98;
  font-size: 12px;
}

.summary-value {
  font-size: 28px;
  line-height: 1.1;
  font-weight: 700;
  margin-top: 6px;
}

.summary-hint {
  color: #8b8f98;
  font-size: 12px;
  margin-top: 6px;
}

.overview-card {
  border-radius: 8px;
}

.overview-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.overview-header h3 {
  margin: 0;
  font-size: 16px;
}

.overview-header p {
  margin: 6px 0 0;
  color: #8b8f98;
}

.overview-flow {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 16px;
}

.flow-node {
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 13px;
}

.flow-node-client {
  border-color: rgba(24, 160, 88, 0.25);
}

.flow-node-audit {
  border-color: rgba(240, 160, 32, 0.28);
}

.flow-arrow {
  color: #8b8f98;
}

.preset-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
  margin-top: 16px;
}

.preset-grid-compact {
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  margin-top: 0;
}

.preset-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.preset-card strong {
  font-size: 13px;
}

.preset-card span {
  font-size: 12px;
  color: #8b8f98;
  line-height: 1.45;
}

.preset-card-active {
  border-color: rgba(24, 160, 88, 0.45);
  background: rgba(24, 160, 88, 0.08);
}

.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.empty-state {
  padding: 24px 0;
}

.capability-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px 14px;
  width: 100%;
}

.capability-list-rich {
  grid-template-columns: 1fr;
}

.capability-option {
  display: flex;
  align-items: center;
  gap: 8px;
}

.capability-option-rich {
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
}

.capability-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.capability-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.capability-copy-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.capability-key {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  color: #8b8f98;
}

.mode-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px 14px;
}

.mode-option {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mode-copy {
  display: flex;
  align-items: center;
  gap: 8px;
}

.inline-help-button {
  width: 18px;
  height: 18px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: #8b8f98;
  font-size: 11px;
  line-height: 1;
  cursor: help;
}

.inline-help-button:focus {
  outline: none;
  border-color: #18a058;
}

.tooltip-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 280px;
  font-size: 12px;
  line-height: 1.45;
}

.form-hint {
  margin-top: 8px;
  font-size: 12px;
  color: #8b8f98;
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}

.stacked-form-item :deep(.n-form-item-blank) {
  display: block;
}

.form-hint-inline {
  margin-top: 0;
}

.risk-summary-alert {
  margin-bottom: 4px;
}

.risk-summary-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.risk-summary-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.risk-summary-list {
  margin: 0;
  padding-left: 18px;
}

.selected-hosts-panel {
  margin-top: 12px;
}

.selected-hosts-label {
  font-size: 12px;
  color: #8b8f98;
  margin-bottom: 8px;
}

.selected-hosts-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.selected-host-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}

.selected-host-remove {
  color: #8b8f98;
  font-size: 14px;
  line-height: 1;
}

.full-access-warning {
  margin-top: 12px;
}

.full-access-warning-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.full-access-confirmation {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-weight: 600;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.created-token-result {
  margin-top: 16px;
  margin-bottom: 12px;
}

.form-errors {
  margin: 0;
  padding-left: 18px;
}

.token-created-alert {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.token-preview {
  margin: 12px 0 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.18);
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.5;
}

.help-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.help-content h3 {
  margin: 0 0 6px;
  font-size: 15px;
}

.help-content p {
  margin: 0;
  color: #8b8f98;
}

.help-profile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.help-profile-card {
  padding: 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
}

.help-profile-card p {
  margin-top: 6px;
}

.agent-guide {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.agent-guide-steps {
  display: grid;
  gap: 14px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.agent-guide-steps > li,
.agent-guide-generic {
  padding: 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
}

.agent-guide-step-heading {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 10px;
}

.agent-guide-step-number {
  display: inline-flex;
  flex: 0 0 28px;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(24, 160, 88, 0.16);
  color: #63e2a3;
  font-weight: 700;
}

.agent-guide h3 {
  margin: 0 0 4px;
  font-size: 15px;
}

.agent-guide p {
  margin: 0;
  color: #8b8f98;
}

.agent-guide-platforms {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.agent-guide-platforms section {
  min-width: 0;
}

.agent-client-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.agent-client-grid section {
  min-width: 0;
  padding: 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.025);
}

.agent-client-grid p {
  min-height: 54px;
  margin-top: 6px;
}

.agent-prompt-examples {
  display: grid;
  gap: 8px;
  margin: 0 0 12px 40px;
}

.agent-prompt-examples code {
  display: block;
  padding: 9px 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.16);
  white-space: normal;
}

.agent-guide-generic .token-preview {
  margin-bottom: 10px;
}

.usage-log-actions {
  margin-top: 10px;
}

.native-datetime-input {
  width: 100%;
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid #3f3f46;
  border-radius: 6px;
  background: #1f1f23;
  color: #f5f5f5;
}

.native-datetime-input:focus {
  outline: none;
  border-color: #18a058;
}

@media (max-width: 900px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .preset-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .page-header,
  .overview-header {
    flex-direction: column;
  }

  .token-created-alert {
    flex-direction: column;
    align-items: flex-start;
  }

  .summary-grid {
    grid-template-columns: 1fr;
  }

  .agent-guide-platforms {
    grid-template-columns: 1fr;
  }

  .agent-client-grid {
    grid-template-columns: 1fr;
  }

  .agent-client-grid p {
    min-height: auto;
  }

  .agent-prompt-examples {
    margin-left: 0;
  }

  .runtime-status-header {
    flex-direction: column;
  }

  .runtime-status-grid {
    grid-template-columns: 1fr;
  }
}
</style>
