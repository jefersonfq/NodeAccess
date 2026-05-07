<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
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
import { mcpService } from '@/services/mcp.service'
import { hostService } from '@/services/host.service'

const message = useMessage()
const dialog = useDialog()
const router = useRouter()

const loading = ref(false)
const modalLoading = ref(false)
const error = ref<string | null>(null)
const showCreateModal = ref(false)
const showEditModal = ref(false)
const showHelp = ref(false)
const showUsageModal = ref(false)
const createdTokenValue = ref<string | null>(null)
const editingTokenId = ref<number | null>(null)
const usageToken = ref<McpTokenPublicRecord | null>(null)
const tokens = ref<McpTokenPublicRecord[]>([])
const capabilities = ref<McpCapabilityDefinition[]>([])
const search = ref('')
const onlyActive = ref(false)
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
    description: 'Policy + ActionRun seguro para coleta e análise previsível.',
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
const usageTokenValue = computed(() => createdTokenValue.value ?? '<TOKEN_MCP>')

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
    label: typeof option?.label === 'string' ? option.label : `Host #${id}`,
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
  await Promise.all([loadTokens(), loadCapabilities(), loadHostOptions()])
})

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
      label: `${host.name} (${host.ip}:${host.port})`,
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
  mergeHostOptions(missing.map((id) => ({ label: `Host #${id}`, value: id })))
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
  fullOperationalAccessConfirmed.value = token.allowedActionModes.includes('full_operational_access')
  selectedPreset.value = null
  showEditModal.value = true
}

function openUsageModal(token: McpTokenPublicRecord) {
  usageToken.value = token
  showUsageModal.value = true
}

async function submitCreate() {
  if (!canSave.value) return
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
    tokens.value = [data.record, ...tokens.value]
    usageToken.value = data.record
    message.success('Token MCP criado.')
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
    ;['search_hosts', 'get_host_dashboard', 'list_host_diagnostic_runs', 'get_diagnostic_run', 'evaluate_action_command_policy', 'request_action_run', 'list_host_action_runs', 'get_action_run']
      .forEach((item) => capabilitySet.add(item))
    actionModes = ['read_only', 'diagnostic_only']
  } else if (preset === 'approval') {
    ;['evaluate_action_command_policy', 'request_action_run', 'approve_action_run', 'reject_action_run', 'list_host_action_runs', 'get_action_run']
      .forEach((item) => capabilitySet.add(item))
    actionModes = ['approval_required']
  } else if (preset === 'full') {
    ;['evaluate_action_command_policy', 'request_action_run', 'list_host_action_runs', 'get_action_run']
      .forEach((item) => capabilitySet.add(item))
    actionModes = ['full_operational_access']
  } else {
    ;['open_interactive_ssh_session', 'write_interactive_ssh_session', 'read_interactive_ssh_session', 'resize_interactive_ssh_session', 'close_interactive_ssh_session']
      .forEach((item) => capabilitySet.add(item))
    actionModes = ['full_operational_access']
  }

  form.value.allowedCapabilities = capabilities.value
    .filter((item) => capabilitySet.has(item.key))
    .map((item) => item.key)
  form.value.allowedActionModes = actionModes
  fullOperationalAccessConfirmed.value = actionModes.includes('full_operational_access')
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
</script>

<template>
  <div class="mcp-tokens-view">
    <div class="page-header">
      <div>
        <h1>Tokens MCP</h1>
        <p>Governança de acesso técnico para clientes MCP do tenant.</p>
      </div>
      <NSpace>
        <NButton tertiary @click="openMcpLogsQuickFilter('tools')">Tools</NButton>
        <NButton tertiary @click="openMcpLogsQuickFilter('resources')">Resources</NButton>
        <NButton tertiary @click="openMcpLogsQuickFilter('approvals')">Approvals</NButton>
        <NButton tertiary @click="openMcpLogsQuickFilter('tokens')">Tokens</NButton>
        <NButton tertiary @click="openMcpLogs()">Logs MCP</NButton>
        <NButton tertiary @click="showHelp = true">Ajuda</NButton>
        <NButton type="primary" @click="openCreateModal">Novo token</NButton>
      </NSpace>
    </div>

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
          <p>Escolha um perfil, limite o escopo e acompanhe o uso pelos logs e pelas sessões MCP shell.</p>
        </div>
        <NButton tertiary @click="showHelp = true">Guia rápido</NButton>
      </div>
      <div class="overview-flow">
        <span class="flow-node flow-node-client">Cliente MCP</span>
        <span class="flow-arrow">→</span>
        <span class="flow-node">Token</span>
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
        <NAlert v-if="createdTokenValue" type="warning" style="margin-bottom: 16px;">
          <div class="token-created-alert">
            <div>
              <strong>Copie o token agora.</strong>
              <div>Ele não será exibido novamente depois que você fechar esta janela.</div>
            </div>
            <NButton size="small" secondary @click="copyCreatedToken">Copiar token</NButton>
          </div>
          <pre class="token-preview">{{ createdTokenValue }}</pre>
        </NAlert>

        <NAlert v-if="formErrors.length" type="error" style="margin-bottom: 16px;">
          <ul class="form-errors">
            <li v-for="item in formErrors" :key="item">{{ item }}</li>
          </ul>
        </NAlert>

        <NFormItem label="Nome">
          <NInput v-model:value="form.name" placeholder="Ex.: Claude - Operação" />
        </NFormItem>

        <NFormItem label="Perfil inicial">
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
          <div class="form-hint">Use um perfil como ponto de partida e depois refine capabilities, modos e hosts.</div>
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
          <div class="form-hint">Se nenhuma capability for marcada, o token herda a allowlist do ambiente.</div>
        </NFormItem>

        <NFormItem label="Modos de ActionRun permitidos">
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
              <label class="full-access-confirmation">
                <NCheckbox v-model:checked="fullOperationalAccessConfirmed" />
                <span>Confirmo que este token deve poder solicitar full_operational_access.</span>
              </label>
            </div>
          </NAlert>
          <div class="form-hint">Aplica-se à capability `request_action_run`. Para shell livre, mantenha hosts permitidos preenchidos.</div>
        </NFormItem>

        <NFormItem label="Hosts permitidos">
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
          <div class="form-hint">Opcional. Se vazio, o token mantém todos os hosts dentro do escopo do usuário efetivo. Para shell livre, prefira sempre restringir.</div>
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
        </NFormItem>

        <div class="modal-actions">
          <NButton @click="showCreateModal = false">Fechar</NButton>
          <NButton type="primary" :loading="modalLoading" :disabled="!canSave" @click="submitCreate">Criar token</NButton>
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

        <NFormItem label="Perfil">
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
          <div class="form-hint">Aplicar um perfil sobrescreve a seleção atual de capabilities e modos.</div>
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
          <div class="form-hint">Se nenhuma capability for marcada, o token herda a allowlist do ambiente.</div>
        </NFormItem>

        <NFormItem label="Modos de ActionRun permitidos">
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
              <label class="full-access-confirmation">
                <NCheckbox v-model:checked="fullOperationalAccessConfirmed" />
                <span>Confirmo que este token deve poder solicitar full_operational_access.</span>
              </label>
            </div>
          </NAlert>
          <div class="form-hint">Se nenhum modo for marcado, o token não adiciona restrição por modo ao `ActionRun`.</div>
        </NFormItem>

        <NFormItem label="Hosts permitidos">
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
          <div class="form-hint">Opcional. Se vazio, o token mantém todos os hosts dentro do escopo do usuário efetivo. Para shell livre, prefira sempre restringir.</div>
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
          <p>Tokens técnicos para clientes MCP autenticarem no NodeAccess fora da sessão web comum.</p>
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
          <p>Crie um token, restrinja capabilities, limite hosts quando fizer sentido e use o valor retornado em `Authorization: Bearer ...` ou `x-mcp-token`.</p>
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
}
</style>
