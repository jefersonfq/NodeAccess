<script setup lang="ts">
import { ref, onMounted, h, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NCard, NDataTable, NTag, NText, NInput, NSelect, NButton, NSpace,
  NPagination, NSpin, NAlert, NTabs, NTabPane, NModal, NTooltip,
  useDialog,
  useMessage,
} from 'naive-ui'
import SkeletonTable from '@/components/SkeletonTable.vue'
import type { DataTableColumns } from 'naive-ui'
import type { AuthLogPublic, AdminLogPublic } from '@nodeaccess/shared'
import { logsService, type McpInteractiveSshSessionPublic } from '@/services/logs.service'

const { t } = useI18n()
const route = useRoute()
const message = useMessage()
const dialog = useDialog()

// ── Utilitários ──────────────────────────────────────────────────────────────

function formatDate(d: Date | string) {
  return new Date(d).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

const eventLabels = computed<Record<string, string>>(() => ({
  LOGIN:            t('admin.logs.events.LOGIN'),
  LOGOUT:           t('admin.logs.events.LOGOUT'),
  LOGIN_FAILED:     t('admin.logs.events.LOGIN_FAILED'),
  LOGIN_BLOCKED:    t('admin.logs.events.LOGIN_BLOCKED'),
  MFA_VERIFIED:     t('admin.logs.events.MFA_VERIFIED'),
  MFA_FAILED:       t('admin.logs.events.MFA_FAILED'),
  SSO_LOGIN:        t('admin.logs.events.SSO_LOGIN'),
  PASSWORD_RESET:   t('admin.logs.events.PASSWORD_RESET'),
  PASSWORD_CHANGED: t('admin.logs.events.PASSWORD_CHANGED'),
}))

const eventTagType: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  LOGIN:            'success',
  LOGOUT:           'default',
  LOGIN_FAILED:     'error',
  LOGIN_BLOCKED:    'error',
  MFA_VERIFIED:     'success',
  MFA_FAILED:       'warning',
  SSO_LOGIN:        'info',
  PASSWORD_RESET:   'warning',
  PASSWORD_CHANGED: 'info',
}

const adminActionLabels = computed<Record<string, string>>(() => ({
  CREATE_USER:     t('admin.logs.adminActions.CREATE_USER'),
  UPDATE_USER:     t('admin.logs.adminActions.UPDATE_USER'),
  ACTIVATE_USER:   t('admin.logs.adminActions.ACTIVATE_USER'),
  DEACTIVATE_USER: t('admin.logs.adminActions.DEACTIVATE_USER'),
  RESET_PASSWORD:  t('admin.logs.adminActions.RESET_PASSWORD'),
  CREATE_HOST:     t('admin.logs.adminActions.CREATE_HOST'),
  UPDATE_HOST:     t('admin.logs.adminActions.UPDATE_HOST'),
  DELETE_HOST:     t('admin.logs.adminActions.DELETE_HOST'),
  CREATE_GROUP:    t('admin.logs.adminActions.CREATE_GROUP'),
  UPDATE_GROUP:    t('admin.logs.adminActions.UPDATE_GROUP'),
  DELETE_GROUP:    t('admin.logs.adminActions.DELETE_GROUP'),
  CREATE_FOLDER:   t('admin.logs.adminActions.CREATE_FOLDER'),
  UPDATE_FOLDER:   t('admin.logs.adminActions.UPDATE_FOLDER'),
  DELETE_FOLDER:   t('admin.logs.adminActions.DELETE_FOLDER'),
  CREATE_BASTION:  t('admin.logs.adminActions.CREATE_BASTION'),
  UPDATE_BASTION:  t('admin.logs.adminActions.UPDATE_BASTION'),
  DELETE_BASTION:  t('admin.logs.adminActions.DELETE_BASTION'),
  CREATE_PEM_KEY:  t('admin.logs.adminActions.CREATE_PEM_KEY'),
  DELETE_PEM_KEY:  t('admin.logs.adminActions.DELETE_PEM_KEY'),
  HOST_KEY_TRUSTED: t('admin.logs.adminActions.HOST_KEY_TRUSTED'),
  HOST_KEY_UPDATED: t('admin.logs.adminActions.HOST_KEY_UPDATED'),
  CLIENT_UX_SESSION_EXPIRED:          t('admin.logs.adminActions.CLIENT_UX_SESSION_EXPIRED'),
  CLIENT_UX_SESSION_EXPIRED_TERMINAL: t('admin.logs.adminActions.CLIENT_UX_SESSION_EXPIRED_TERMINAL'),
  CLIENT_UX_STALE_RELOAD_RECOVERED:   t('admin.logs.adminActions.CLIENT_UX_STALE_RELOAD_RECOVERED'),
  CLIENT_UX_STALE_RELOAD_FAILED:      t('admin.logs.adminActions.CLIENT_UX_STALE_RELOAD_FAILED'),
}))

function adminTagType(action: string): 'success' | 'warning' | 'error' | 'info' {
  if (action.startsWith('CLIENT_UX_')) return 'info'
  if (action.startsWith('CREATE_')) return 'success'
  if (action.startsWith('UPDATE_') || action.startsWith('ACTIVATE_') || action.startsWith('RESET_')) return 'warning'
  if (action.startsWith('DELETE_') || action.startsWith('DEACTIVATE_')) return 'error'
  return 'info'
}

function adminTargetTagType(targetType: string): 'default' | 'success' | 'warning' | 'error' | 'info' {
  const map: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
    User:    'info',
    Host:    'default',
    Group:   'success',
    Folder:  'default',
    Bastion: 'warning',
    PemKey:  'default',
    MCP:     'info',
    MCP_INTERACTIVE_SSH: 'warning',
    McpToken: 'warning',
    ClientUx: 'info',
  }
  return map[targetType] ?? 'default'
}

function prettifyAdminAction(action: string) {
  return action
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ')
}

function summarizeMcpDetails(row: AdminLogPublic) {
  if (!row.details) return '—'
  try {
    const details = JSON.parse(row.details) as Record<string, unknown>
    const capability = typeof details.capability === 'string' ? details.capability : null
    const query = typeof details.query === 'string' ? details.query : null
    const resultCount = typeof details.resultCount === 'number' ? details.resultCount : null
    const hostId = typeof details.hostId === 'number' ? details.hostId : null
    const runId = typeof details.runId === 'number' ? details.runId : null
    const tokenId = typeof details.tokenId === 'number' ? details.tokenId : null
    const status = typeof details.status === 'string' ? details.status : null
    const mode = typeof details.mode === 'string' ? details.mode : null
    const channel = typeof details.channel === 'string' ? details.channel : null
    const authMode = typeof details.authMode === 'string' ? details.authMode : null
    const promptKey = typeof details.promptKey === 'string' ? details.promptKey : null
    const sessionId = typeof details.sessionId === 'string' ? details.sessionId : null
    const inputBytes = typeof details.inputBytes === 'number' ? details.inputBytes : null
    const outputBytes = typeof details.outputBytes === 'number' ? details.outputBytes : null
    const nextCursor = typeof details.nextCursor === 'number' ? details.nextCursor : null
    const expiresAt = typeof details.expiresAt === 'string' ? details.expiresAt : null
    const reason = typeof details.reason === 'string' ? details.reason : null
    const parts = [
      capability ? `capability=${capability}` : null,
      promptKey ? `prompt=${promptKey}` : null,
      query ? `query="${query}"` : null,
      authMode ? `auth=${authMode}` : null,
      tokenId !== null ? `token=#${tokenId}` : null,
      hostId !== null ? `host=#${hostId}` : null,
      runId !== null ? `run=#${runId}` : null,
      sessionId ? `session=${sessionId.slice(0, 8)}` : null,
      status ? `status=${status}` : null,
      mode ? `mode=${mode}` : null,
      channel ? `channel=${channel}` : null,
      inputBytes !== null ? `in=${inputBytes}B` : null,
      outputBytes !== null ? `out=${outputBytes}B` : null,
      nextCursor !== null ? `cursor=${nextCursor}` : null,
      expiresAt ? `expira=${formatDate(expiresAt)}` : null,
      reason ? `motivo="${reason}"` : null,
      resultCount !== null ? `resultados=${resultCount}` : null,
    ].filter(Boolean)
    return parts.length ? parts.join(' • ') : row.details
  } catch {
    return row.details
  }
}

function summarizeAdminDetails(row: AdminLogPublic) {
  if (!row.details) return '—'
  if (row.targetType === 'MCP' || row.targetType === 'MCP_INTERACTIVE_SSH' || row.targetType === 'McpToken' || row.action.startsWith('MCP_')) {
    return summarizeMcpDetails(row)
  }
  if (!row.action.startsWith('HOST_KEY_')) return '—'
  try {
    const details = JSON.parse(row.details) as { previousFingerprint?: string | null; nextFingerprint?: string | null }
    const previous = details.previousFingerprint ?? '—'
    const next = details.nextFingerprint ?? '—'
    return t('admin.logs.adminLogs.hostKeyDetails', { previous, next })
  } catch {
    return '—'
  }
}

// ── Help ──────────────────────────────────────────────────────────────────────

const showHelp = ref(false)

const adminHelpCategories = [
  { key: 'creation', type: 'success' as const },
  { key: 'update',   type: 'warning' as const },
  { key: 'deletion', type: 'error'   as const },
  { key: 'ux',       type: 'info'    as const },
]

const authEventGroups = [
  { key: 'access',     type: 'success' as const, events: ['LOGIN', 'SSO_LOGIN', 'MFA_VERIFIED', 'LOGOUT'] },
  { key: 'failure',    type: 'error'   as const, events: ['LOGIN_FAILED', 'LOGIN_BLOCKED', 'MFA_FAILED'] },
  { key: 'credential', type: 'warning' as const, events: ['PASSWORD_RESET', 'PASSWORD_CHANGED'] },
]

const authHelpFields  = ['time', 'user', 'event', 'ip', 'status']
const adminHelpFields = ['time', 'admin', 'action', 'target', 'details']

// ── Auth Logs ─────────────────────────────────────────────────────────────────

const authLogs    = ref<AuthLogPublic[]>([])
const authTotal   = ref(0)
const authPage    = ref(1)
const authLoading = ref(false)
const authError   = ref<string | null>(null)

const authSearch    = ref('')
const authEventType = ref<string | undefined>(undefined)
const authSuccess   = ref<string | undefined>(undefined)

const LIMIT = 30

const eventTypeOptions = computed(() => [
  { label: t('admin.logs.auth.filterAll'),          value: '' },
  { label: t('admin.logs.events.LOGIN'),             value: 'LOGIN' },
  { label: t('admin.logs.events.LOGOUT'),            value: 'LOGOUT' },
  { label: t('admin.logs.events.LOGIN_FAILED'),      value: 'LOGIN_FAILED' },
  { label: t('admin.logs.events.LOGIN_BLOCKED'),     value: 'LOGIN_BLOCKED' },
  { label: t('admin.logs.events.MFA_VERIFIED'),      value: 'MFA_VERIFIED' },
  { label: t('admin.logs.events.MFA_FAILED'),        value: 'MFA_FAILED' },
  { label: t('admin.logs.events.SSO_LOGIN'),         value: 'SSO_LOGIN' },
  { label: t('admin.logs.events.PASSWORD_RESET'),    value: 'PASSWORD_RESET' },
  { label: t('admin.logs.events.PASSWORD_CHANGED'),  value: 'PASSWORD_CHANGED' },
])

const successOptions = computed(() => [
  { label: t('admin.logs.auth.resultAll'),     value: '' },
  { label: t('admin.logs.auth.resultSuccess'), value: 'true' },
  { label: t('admin.logs.auth.resultFailure'), value: 'false' },
])

async function loadAuth() {
  authLoading.value = true
  authError.value   = null
  try {
    const { data } = await logsService.listAuth({
      search:    authSearch.value    || undefined,
      eventType: authEventType.value || undefined,
      success:   authSuccess.value !== undefined && authSuccess.value !== ''
        ? authSuccess.value === 'true'
        : undefined,
      page:  authPage.value,
      limit: LIMIT,
    })
    authLogs.value  = data.data
    authTotal.value = data.total
  } catch {
    authError.value = t('admin.logs.auth.loadError')
  } finally {
    authLoading.value = false
  }
}

function searchAuth() { authPage.value = 1; loadAuth() }

const authColumns = computed<DataTableColumns<AuthLogPublic>>(() => [
  {
    title: t('admin.logs.auth.columns.time'),
    key: 'timestamp',
    width: 160,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px;font-family:monospace' }, () => formatDate(row.timestamp)),
  },
  {
    title: t('admin.logs.auth.columns.user'),
    key: 'user',
    render: (row) => {
      const cell = row.userName
        ? h('div', [
            h(NText, { strong: true, style: 'font-size:13px;display:block' }, () => row.userName!),
            h(NText, { depth: 3, style: 'font-size:11px' }, () => row.userEmail ?? ''),
          ])
        : h(NText, { depth: 3, style: 'font-size:12px;font-style:italic' }, () => t('common.anonymous'))
      if (!row.userAgent) return cell
      return h(NTooltip, { trigger: 'hover' }, {
        trigger: () => cell,
        default: () => row.userAgent,
      })
    },
  },
  {
    title: t('admin.logs.auth.columns.event'),
    key: 'eventType',
    width: 160,
    render: (row) => h(NTag, { type: eventTagType[row.eventType] ?? 'default', size: 'small' },
      () => eventLabels.value[row.eventType] ?? row.eventType,
    ),
  },
  {
    title: t('admin.logs.auth.columns.ip'),
    key: 'ip',
    width: 140,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px;font-family:monospace' }, () => row.ip ?? '—'),
  },
  {
    title: t('admin.logs.auth.columns.status'),
    key: 'success',
    width: 90,
    render: (row) => h(NTag, { type: row.success ? 'success' : 'error', size: 'small' },
      () => row.success ? t('admin.logs.auth.status.success') : t('admin.logs.auth.status.failure'),
    ),
  },
])

// ── Admin Logs ────────────────────────────────────────────────────────────────

const adminLogs    = ref<AdminLogPublic[]>([])
const adminTotal   = ref(0)
const adminPage    = ref(1)
const adminLoading = ref(false)
const adminError   = ref<string | null>(null)
const adminSearch  = ref('')
const adminAction  = ref<string | undefined>(undefined)
const adminTargetType = ref<string | undefined>(undefined)
const adminTargetId = ref<string>('')
const adminMcpTokenId = ref<string>('')
const adminMcpAuthMode = ref<'jwt' | 'persisted_token' | 'static_token' | undefined>(undefined)

const adminTargetTypeOptions = computed(() => [
  { label: t('admin.logs.adminLogs.targets.all'),     value: '' },
  { label: t('admin.logs.adminLogs.targets.clientUx'), value: 'ClientUx' },
  { label: 'MCP', value: 'MCP' },
  { label: 'MCP shell', value: 'MCP_INTERACTIVE_SSH' },
  { label: 'Tokens MCP', value: 'McpToken' },
])

const activeTab    = ref<'auth' | 'admin'>('auth')
const currentTotal = computed(() => activeTab.value === 'auth' ? authTotal.value : adminTotal.value)

const adminQuickFilters = [
  { key: 'mcp_tools', label: 'MCP tools' },
  { key: 'mcp_resources', label: 'MCP resources' },
  { key: 'mcp_approvals', label: 'MCP approvals' },
  { key: 'mcp_shell', label: 'MCP shell' },
  { key: 'mcp_denied', label: 'MCP denied' },
  { key: 'mcp_rate_limited', label: 'MCP rate limit' },
  { key: 'mcp_tokens', label: 'MCP tokens' },
] as const

const adminAuthModeFilters = [
  { key: 'jwt', label: 'JWT' },
  { key: 'persisted_token', label: 'Token MCP' },
  { key: 'static_token', label: 'Token estático' },
] as const

const showMcpInteractiveSessions = ref(false)
const mcpInteractiveSessions = ref<McpInteractiveSshSessionPublic[]>([])
const mcpInteractiveSessionsTotal = ref(0)
const mcpInteractiveSessionsPage = ref(1)
const mcpInteractiveSessionsLoading = ref(false)
const mcpInteractiveSessionsError = ref<string | null>(null)
const mcpInteractiveSessionsSearch = ref('')
const mcpInteractiveSessionsStatus = ref<string | undefined>(undefined)
const mcpInteractiveSessionsHostId = ref('')
const mcpInteractiveSessionsTokenId = ref('')

const mcpInteractiveSessionStatusOptions = [
  { label: 'Todos', value: '' },
  { label: 'Open', value: 'open' },
  { label: 'Closed', value: 'closed' },
]

async function loadAdmin() {
  adminLoading.value = true
  adminError.value   = null
  try {
    const { data } = await logsService.listAdmin({
      search:     adminSearch.value     || undefined,
      action:     adminAction.value     || undefined,
      targetType: adminTargetType.value || undefined,
      targetId: adminTargetId.value.trim() ? Number(adminTargetId.value) : undefined,
      mcpTokenId: adminMcpTokenId.value.trim() ? Number(adminMcpTokenId.value) : undefined,
      mcpAuthMode: adminMcpAuthMode.value,
      page:       adminPage.value,
      limit:      LIMIT,
    })
    adminLogs.value  = data.data
    adminTotal.value = data.total
  } catch {
    adminError.value = t('admin.logs.adminLogs.loadError')
  } finally {
    adminLoading.value = false
  }
}

function searchAdmin() { adminPage.value = 1; loadAdmin() }

function applyAdminQuickFilter(key: typeof adminQuickFilters[number]['key']) {
  adminTargetId.value = ''
  adminMcpTokenId.value = ''
  if (key === 'mcp_tools') {
    adminTargetType.value = 'MCP'
    adminAction.value = 'MCP_TOOL_CALLED'
    adminSearch.value = ''
  } else if (key === 'mcp_resources') {
    adminTargetType.value = 'MCP'
    adminAction.value = 'MCP_RESOURCE_READ'
    adminSearch.value = ''
  } else if (key === 'mcp_approvals') {
    adminTargetType.value = 'MCP'
    adminAction.value = 'MCP_TOOL_CALLED'
    adminSearch.value = 'approve_action_run'
  } else if (key === 'mcp_shell') {
    adminTargetType.value = 'MCP_INTERACTIVE_SSH'
    adminAction.value = undefined
    adminSearch.value = ''
  } else if (key === 'mcp_denied') {
    adminTargetType.value = 'MCP'
    adminAction.value = 'MCP_DENIED'
    adminSearch.value = ''
  } else if (key === 'mcp_rate_limited') {
    adminTargetType.value = 'MCP'
    adminAction.value = 'MCP_RATE_LIMITED'
    adminSearch.value = ''
  } else if (key === 'mcp_tokens') {
    adminTargetType.value = 'McpToken'
    adminAction.value = undefined
    adminSearch.value = ''
  }
  searchAdmin()
}

function isAdminQuickFilterActive(key: typeof adminQuickFilters[number]['key']) {
  if (key === 'mcp_tools') return adminTargetType.value === 'MCP' && adminAction.value === 'MCP_TOOL_CALLED' && !adminSearch.value
  if (key === 'mcp_resources') return adminTargetType.value === 'MCP' && adminAction.value === 'MCP_RESOURCE_READ' && !adminSearch.value
  if (key === 'mcp_approvals') return adminTargetType.value === 'MCP' && adminAction.value === 'MCP_TOOL_CALLED' && adminSearch.value === 'approve_action_run'
  if (key === 'mcp_shell') return adminTargetType.value === 'MCP_INTERACTIVE_SSH' && !adminAction.value && !adminSearch.value
  if (key === 'mcp_denied') return adminTargetType.value === 'MCP' && adminAction.value === 'MCP_DENIED' && !adminSearch.value
  if (key === 'mcp_rate_limited') return adminTargetType.value === 'MCP' && adminAction.value === 'MCP_RATE_LIMITED' && !adminSearch.value
  if (key === 'mcp_tokens') return adminTargetType.value === 'McpToken' && !adminAction.value && !adminSearch.value
  return false
}

function applyAdminAuthModeFilter(mode: typeof adminAuthModeFilters[number]['key']) {
  adminMcpAuthMode.value = adminMcpAuthMode.value === mode ? undefined : mode
  searchAdmin()
}

function isAdminAuthModeFilterActive(mode: typeof adminAuthModeFilters[number]['key']) {
  return adminMcpAuthMode.value === mode
}

async function loadMcpInteractiveSessions() {
  mcpInteractiveSessionsLoading.value = true
  mcpInteractiveSessionsError.value = null
  try {
    const { data } = await logsService.listMcpInteractiveSessions({
      search: mcpInteractiveSessionsSearch.value || undefined,
      status: mcpInteractiveSessionsStatus.value || undefined,
      hostId: mcpInteractiveSessionsHostId.value.trim() ? Number(mcpInteractiveSessionsHostId.value) : undefined,
      tokenId: mcpInteractiveSessionsTokenId.value.trim() ? Number(mcpInteractiveSessionsTokenId.value) : undefined,
      page: mcpInteractiveSessionsPage.value,
      limit: LIMIT,
    })
    mcpInteractiveSessions.value = data.data
    mcpInteractiveSessionsTotal.value = data.total
  } catch {
    mcpInteractiveSessionsError.value = 'Falha ao carregar sessões MCP shell'
  } finally {
    mcpInteractiveSessionsLoading.value = false
  }
}

function confirmCloseMcpInteractiveSession(row: McpInteractiveSshSessionPublic) {
  dialog.warning({
    title: 'Encerrar sessão MCP shell',
    content: `Deseja encerrar administrativamente a sessão ${row.sessionId.slice(0, 8)} em ${row.hostName}?`,
    positiveText: 'Encerrar',
    negativeText: 'Cancelar',
    onPositiveClick: async () => {
      try {
        await logsService.closeMcpInteractiveSession(row.sessionId)
        message.success('Sessão MCP shell encerrada.')
        await loadMcpInteractiveSessions()
        await loadAdmin()
      } catch {
        message.error('Não foi possível encerrar a sessão MCP shell.')
      }
    },
  })
}

function openMcpInteractiveSessions() {
  showMcpInteractiveSessions.value = true
  mcpInteractiveSessionsPage.value = 1
  loadMcpInteractiveSessions()
}

function searchMcpInteractiveSessions() {
  mcpInteractiveSessionsPage.value = 1
  loadMcpInteractiveSessions()
}

const mcpInteractiveSessionColumns: DataTableColumns<McpInteractiveSshSessionPublic> = [
  {
    title: 'Abertura',
    key: 'openedAt',
    width: 160,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px;font-family:monospace' }, () => formatDate(row.openedAt)),
  },
  {
    title: 'Sessão',
    key: 'sessionId',
    width: 150,
    render: (row) => h('div', [
      h(NText, { strong: true, style: 'font-size:12px;font-family:monospace' }, () => row.sessionId.slice(0, 8)),
      h(NText, { depth: 3, style: 'font-size:11px;display:block' }, () => row.status),
    ]),
  },
  {
    title: 'Host',
    key: 'host',
    width: 180,
    render: (row) => h('div', [
      h(NText, { strong: true }, () => row.hostName),
      h(NText, { depth: 3, style: 'font-size:11px;display:block;font-family:monospace' }, () => `#${row.hostId}`),
    ]),
  },
  {
    title: 'Usuário',
    key: 'user',
    width: 180,
    render: (row) => h('div', [
      h(NText, { strong: true }, () => row.userName),
      h(NText, { depth: 3, style: 'font-size:11px;display:block' }, () => row.userEmail),
    ]),
  },
  {
    title: 'Uso',
    key: 'usage',
    width: 150,
    render: (row) => h(NText, { depth: 3, style: 'font-size:11px;white-space:pre-wrap' }, () => [
      `token=${row.tokenId !== null ? `#${row.tokenId}` : '—'}`,
      `in=${row.inputBytes}B`,
      `out=${row.outputBytesRead}B`,
    ].join(' • ')),
  },
  {
    title: 'Fechamento',
    key: 'closing',
    render: (row) => h(NText, { depth: 3, style: 'font-size:11px;white-space:pre-wrap;word-break:break-word' }, () => [
      row.closedAt ? `fechada ${formatDate(row.closedAt)}` : `expira ${formatDate(row.expiresAt)}`,
      row.closeReason ? `motivo=${row.closeReason}` : null,
      `atividade ${formatDate(row.lastActivityAt)}`,
      `motivo abertura="${row.reason}"`,
    ].filter(Boolean).join(' • ')),
  },
  {
    title: 'Ações',
    key: 'actions',
    width: 110,
    render: (row) => row.status === 'open'
      ? h(NButton, {
        size: 'small',
        type: 'error',
        tertiary: true,
        onClick: () => confirmCloseMcpInteractiveSession(row),
      }, () => 'Encerrar')
      : h(NText, { depth: 3 }, () => '—'),
  },
]

const adminColumns = computed<DataTableColumns<AdminLogPublic>>(() => [
  {
    title: t('admin.logs.adminLogs.columns.time'),
    key: 'timestamp',
    width: 160,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px;font-family:monospace' }, () => formatDate(row.timestamp)),
  },
  {
    title: t('admin.logs.adminLogs.columns.admin'),
    key: 'adminName',
    width: 180,
    render: (row) => h(NText, { strong: true }, () => row.adminName),
  },
  {
    title: t('admin.logs.adminLogs.columns.action'),
    key: 'action',
    width: 200,
    render: (row) => h(NTag, { type: adminTagType(row.action), size: 'small' },
      () => adminActionLabels.value[row.action] ?? prettifyAdminAction(row.action),
    ),
  },
  {
    title: t('admin.logs.adminLogs.columns.target'),
    key: 'target',
    width: 130,
    render: (row) => {
      if (row.targetType === 'ClientUx') {
        return h(NTag, { type: 'info', size: 'small' }, () => t('admin.logs.adminLogs.targets.clientUx'))
      }
      if (row.targetType === 'MCP') {
        return h('div', [
          h(NTag, { type: 'info', size: 'small' }, () => 'MCP'),
          h(NText, { depth: 3, style: 'font-size:11px;display:block;margin-top:2px;font-family:monospace' }, () => row.targetId ? `#${row.targetId}` : 'discovery/tool/resource'),
        ])
      }
      if (row.targetType === 'MCP_INTERACTIVE_SSH') {
        return h('div', [
          h(NTag, { type: 'warning', size: 'small' }, () => 'MCP shell'),
          h(NText, { depth: 3, style: 'font-size:11px;display:block;margin-top:2px;font-family:monospace' }, () => row.targetId ? `host #${row.targetId}` : 'shell'),
        ])
      }
      if (row.targetType === 'McpToken') {
        return h('div', [
          h(NTag, { type: 'warning', size: 'small' }, () => 'Token MCP'),
          h(NText, { depth: 3, style: 'font-size:11px;display:block;margin-top:2px;font-family:monospace' }, () => `#${row.targetId}`),
        ])
      }
      return h('div', [
        h(NTag, { type: adminTargetTagType(row.targetType), size: 'small' }, () => row.targetType),
        h(NText, { depth: 3, style: 'font-size:11px;display:block;margin-top:2px;font-family:monospace' }, () => `#${row.targetId}`),
      ])
    },
  },
  {
    title: t('admin.logs.adminLogs.columns.details'),
    key: 'details',
    render: (row) => h(NText, { depth: 3, style: 'font-size:11px;white-space:pre-wrap;word-break:break-word' },
      () => summarizeAdminDetails(row),
    ),
  },
])

// ── Tabs ──────────────────────────────────────────────────────────────────────

function onTabChange(tab: string) {
  activeTab.value = tab === 'admin' ? 'admin' : 'auth'
  if (tab === 'auth'  && authLogs.value.length  === 0) loadAuth()
  if (tab === 'admin' && adminLogs.value.length === 0) loadAdmin()
}

function applyRouteFilters() {
  activeTab.value = route.query.tab === 'admin' ? 'admin' : 'auth'
  if (activeTab.value === 'admin') {
    adminTargetType.value = typeof route.query.targetType === 'string' ? route.query.targetType : undefined
    adminTargetId.value = typeof route.query.targetId === 'string' ? route.query.targetId : ''
    adminMcpTokenId.value = typeof route.query.mcpTokenId === 'string' ? route.query.mcpTokenId : ''
    adminMcpAuthMode.value = typeof route.query.mcpAuthMode === 'string'
      && ['jwt', 'persisted_token', 'static_token'].includes(route.query.mcpAuthMode)
      ? route.query.mcpAuthMode as 'jwt' | 'persisted_token' | 'static_token'
      : undefined
    adminAction.value = typeof route.query.action === 'string' ? route.query.action : undefined
    adminSearch.value = typeof route.query.search === 'string' ? route.query.search : ''
    adminPage.value = 1
    if (route.query.mcpInteractiveSessions === '1') {
      showMcpInteractiveSessions.value = true
      mcpInteractiveSessionsSearch.value = typeof route.query.mcpInteractiveSearch === 'string' ? route.query.mcpInteractiveSearch : ''
      mcpInteractiveSessionsStatus.value = typeof route.query.mcpInteractiveStatus === 'string' ? route.query.mcpInteractiveStatus : undefined
      mcpInteractiveSessionsHostId.value = typeof route.query.mcpInteractiveHostId === 'string' ? route.query.mcpInteractiveHostId : ''
      mcpInteractiveSessionsTokenId.value = typeof route.query.mcpInteractiveTokenId === 'string' ? route.query.mcpInteractiveTokenId : ''
      mcpInteractiveSessionsPage.value = 1
      loadMcpInteractiveSessions()
    } else {
      showMcpInteractiveSessions.value = false
    }
    loadAdmin()
    return
  }
  loadAuth()
}

watch(() => route.query, applyRouteFilters)

onMounted(applyRouteFilters)
</script>

<template>
  <div class="p-8 max-w-6xl">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-semibold text-white">{{ $t('admin.logs.title') }}</h1>
        <NText depth="3" class="text-sm">{{ $t('admin.logs.subtitle') }}</NText>
      </div>
      <NSpace align="center">
        <NText v-if="currentTotal > 0" depth="3" class="text-sm">
          {{ $t('admin.logs.count', { total: currentTotal }) }}
        </NText>
        <NButton size="small" secondary @click="showHelp = true">
          {{ $t('admin.logs.help.action') }}
        </NButton>
      </NSpace>
    </div>

    <NTabs v-model:value="activeTab" type="line" animated @update:value="onTabChange">

      <!-- ── Autenticação ───────────────────────────────────────────────────── -->
      <NTabPane name="auth" :tab="$t('admin.logs.tabs.auth')">
        <NAlert v-if="authError" type="error" :title="authError" class="mb-4" />

        <NSpace class="mb-4" wrap>
          <NInput
            v-model:value="authSearch"
            :placeholder="$t('admin.logs.auth.searchPlaceholder')"
            clearable
            style="width: 220px"
            @keyup.enter="searchAuth"
          />
          <NSelect
            v-model:value="authEventType"
            :options="eventTypeOptions"
            style="width: 180px"
            @update:value="searchAuth"
          />
          <NSelect
            v-model:value="authSuccess"
            :options="successOptions"
            style="width: 130px"
            @update:value="searchAuth"
          />
          <NButton @click="searchAuth">{{ $t('admin.logs.auth.search') }}</NButton>
        </NSpace>

        <SkeletonTable v-if="authLoading && authLogs.length === 0" :rows="8" :columns="5" />
        <NSpin v-else :show="authLoading">
          <NDataTable
            :columns="authColumns"
            :data="authLogs"
            :row-key="(r: AuthLogPublic) => r.id"
            :bordered="false"
            size="small"
          />
        </NSpin>

        <div v-if="authTotal > LIMIT" class="flex justify-end mt-4">
          <NPagination
            v-model:page="authPage"
            :page-count="Math.ceil(authTotal / LIMIT)"
            :page-slot="5"
            @update:page="loadAuth"
          />
        </div>
      </NTabPane>

      <!-- ── Ações administrativas ─────────────────────────────────────────── -->
      <NTabPane name="admin" :tab="$t('admin.logs.tabs.admin')">
        <NAlert v-if="adminError" type="error" :title="adminError" class="mb-4" />

        <NSpace class="mb-4">
          <NInput
            v-model:value="adminSearch"
            :placeholder="$t('admin.logs.adminLogs.searchPlaceholder')"
            clearable
            style="width: 260px"
            @keyup.enter="searchAdmin"
          />
          <NSelect
            v-model:value="adminTargetType"
            :options="adminTargetTypeOptions"
            style="width: 180px"
            @update:value="searchAdmin"
          />
          <NInput
            v-model:value="adminTargetId"
            placeholder="Target ID"
            clearable
            style="width: 120px"
            @keyup.enter="searchAdmin"
          />
          <NInput
            v-model:value="adminMcpTokenId"
            placeholder="Token MCP"
            clearable
            style="width: 120px"
            @keyup.enter="searchAdmin"
          />
          <NButton @click="searchAdmin">{{ $t('admin.logs.adminLogs.search') }}</NButton>
        </NSpace>

        <NSpace class="mb-4" wrap>
          <NButton
            v-for="item in adminQuickFilters"
            :key="item.key"
            size="tiny"
            :type="isAdminQuickFilterActive(item.key) ? 'primary' : 'default'"
            @click="applyAdminQuickFilter(item.key)"
          >
            {{ item.label }}
          </NButton>
        </NSpace>

        <NSpace class="mb-4" wrap>
          <NText depth="3" class="text-xs self-center">Auth MCP</NText>
          <NButton
            v-for="item in adminAuthModeFilters"
            :key="item.key"
            size="tiny"
            :type="isAdminAuthModeFilterActive(item.key) ? 'primary' : 'default'"
            @click="applyAdminAuthModeFilter(item.key)"
          >
            {{ item.label }}
          </NButton>
        </NSpace>

        <NSpace class="mb-4" wrap>
          <NButton size="tiny" secondary @click="openMcpInteractiveSessions">
            Sessões MCP shell
          </NButton>
        </NSpace>

        <SkeletonTable v-if="adminLoading && adminLogs.length === 0" :rows="8" :columns="5" />
        <NSpin v-else :show="adminLoading">
          <NDataTable
            :columns="adminColumns"
            :data="adminLogs"
            :row-key="(r: AdminLogPublic) => r.id"
            :bordered="false"
            size="small"
          />
        </NSpin>

        <div v-if="adminTotal > LIMIT" class="flex justify-end mt-4">
          <NPagination
            v-model:page="adminPage"
            :page-count="Math.ceil(adminTotal / LIMIT)"
            :page-slot="5"
            @update:page="loadAdmin"
          />
        </div>
      </NTabPane>

    </NTabs>

    <!-- ── Modal de ajuda ──────────────────────────────────────────────────── -->
    <NModal v-model:show="showMcpInteractiveSessions">
      <NCard
        style="width: min(1100px, calc(100vw - 32px))"
        title="Sessões MCP shell"
        :bordered="false"
        role="dialog"
        aria-modal="true"
      >
        <NAlert v-if="mcpInteractiveSessionsError" type="error" :title="mcpInteractiveSessionsError" class="mb-4" />

        <NSpace class="mb-4" wrap>
          <NInput
            v-model:value="mcpInteractiveSessionsSearch"
            placeholder="Buscar sessão, host, usuário ou motivo"
            clearable
            style="width: 280px"
            @keyup.enter="searchMcpInteractiveSessions"
          />
          <NSelect
            v-model:value="mcpInteractiveSessionsStatus"
            :options="mcpInteractiveSessionStatusOptions"
            style="width: 120px"
            @update:value="searchMcpInteractiveSessions"
          />
          <NInput
            v-model:value="mcpInteractiveSessionsHostId"
            placeholder="Host ID"
            clearable
            style="width: 120px"
            @keyup.enter="searchMcpInteractiveSessions"
          />
          <NInput
            v-model:value="mcpInteractiveSessionsTokenId"
            placeholder="Token MCP"
            clearable
            style="width: 120px"
            @keyup.enter="searchMcpInteractiveSessions"
          />
          <NButton @click="searchMcpInteractiveSessions">Buscar</NButton>
        </NSpace>

        <SkeletonTable v-if="mcpInteractiveSessionsLoading && mcpInteractiveSessions.length === 0" :rows="6" :columns="6" />
        <NSpin v-else :show="mcpInteractiveSessionsLoading">
          <NDataTable
            :columns="mcpInteractiveSessionColumns"
            :data="mcpInteractiveSessions"
            :row-key="(r: McpInteractiveSshSessionPublic) => r.id"
            :bordered="false"
            size="small"
          />
        </NSpin>

        <div v-if="mcpInteractiveSessionsTotal > LIMIT" class="flex justify-end mt-4">
          <NPagination
            v-model:page="mcpInteractiveSessionsPage"
            :page-count="Math.ceil(mcpInteractiveSessionsTotal / LIMIT)"
            :page-slot="5"
            @update:page="loadMcpInteractiveSessions"
          />
        </div>
      </NCard>
    </NModal>

    <!-- ── Modal de ajuda ──────────────────────────────────────────────────── -->
    <NModal v-model:show="showHelp">
      <NCard
        style="width: min(900px, calc(100vw - 32px))"
        :title="activeTab === 'auth' ? $t('admin.logs.help.authSection.title') : $t('admin.logs.help.adminSection.title')"
        :bordered="false"
        role="dialog"
        aria-modal="true"
      >
        <div class="max-h-[78vh] overflow-y-auto pr-1">

          <!-- Ajuda: Autenticação -->
          <template v-if="activeTab === 'auth'">
            <div class="mb-5 rounded border border-white/10 p-4">
              <NText depth="3" class="block text-sm">{{ $t('admin.logs.help.authSection.subtitle') }}</NText>
              <div class="mt-4 grid gap-3 md:grid-cols-3">
                <div v-for="item in ['event', 'status', 'ip']" :key="item" class="rounded bg-white/5 p-3">
                  <NText strong class="block text-sm">{{ $t(`admin.logs.help.authSection.quick.${item}.title`) }}</NText>
                  <NText depth="3" class="block text-xs mt-1">{{ $t(`admin.logs.help.authSection.quick.${item}.description`) }}</NText>
                </div>
              </div>
            </div>

            <div class="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
              <section>
                <h2 class="text-sm font-semibold text-white mb-3">{{ $t('admin.logs.help.authSection.fieldsTitle') }}</h2>
                <div class="overflow-hidden rounded border border-white/10">
                  <div
                    v-for="field in authHelpFields"
                    :key="field"
                    class="grid gap-2 border-b border-white/10 p-3 last:border-b-0 md:grid-cols-[130px_1fr]"
                  >
                    <NText strong class="text-sm">{{ $t(`admin.logs.help.authSection.fields.${field}.title`) }}</NText>
                    <NText depth="3" class="text-sm">{{ $t(`admin.logs.help.authSection.fields.${field}.description`) }}</NText>
                  </div>
                </div>
              </section>

              <section>
                <h2 class="text-sm font-semibold text-white mb-3">{{ $t('admin.logs.help.authSection.eventsTitle') }}</h2>
                <div class="space-y-3">
                  <div
                    v-for="group in authEventGroups"
                    :key="group.key"
                    class="rounded border border-white/10 p-3"
                  >
                    <NTag size="small" :type="group.type">
                      {{ $t(`admin.logs.help.authSection.eventGroups.${group.key}`) }}
                    </NTag>
                    <div class="space-y-2 mt-3">
                      <div v-for="ev in group.events" :key="ev">
                        <NTag size="small" :type="eventTagType[ev] ?? 'default'">{{ eventLabels[ev] }}</NTag>
                        <NText depth="3" class="block text-xs mt-1">
                          {{ $t(`admin.logs.help.authSection.events.${ev}.description`) }}
                        </NText>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </template>

          <!-- Ajuda: Ações administrativas -->
          <template v-else>
            <div class="mb-5 rounded border border-white/10 p-4">
              <NText depth="3" class="block text-sm">{{ $t('admin.logs.help.adminSection.subtitle') }}</NText>
              <div class="mt-4 grid gap-3 md:grid-cols-3">
                <div v-for="item in ['action', 'target', 'details']" :key="item" class="rounded bg-white/5 p-3">
                  <NText strong class="block text-sm">{{ $t(`admin.logs.help.adminSection.quick.${item}.title`) }}</NText>
                  <NText depth="3" class="block text-xs mt-1">{{ $t(`admin.logs.help.adminSection.quick.${item}.description`) }}</NText>
                </div>
              </div>
            </div>

            <div class="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
              <section>
                <h2 class="text-sm font-semibold text-white mb-3">{{ $t('admin.logs.help.adminSection.fieldsTitle') }}</h2>
                <div class="overflow-hidden rounded border border-white/10">
                  <div
                    v-for="field in adminHelpFields"
                    :key="field"
                    class="grid gap-2 border-b border-white/10 p-3 last:border-b-0 md:grid-cols-[130px_1fr]"
                  >
                    <NText strong class="text-sm">{{ $t(`admin.logs.help.adminSection.fields.${field}.title`) }}</NText>
                    <NText depth="3" class="text-sm">{{ $t(`admin.logs.help.adminSection.fields.${field}.description`) }}</NText>
                  </div>
                </div>
              </section>

              <section>
                <h2 class="text-sm font-semibold text-white mb-3">{{ $t('admin.logs.help.adminSection.categoriesTitle') }}</h2>
                <div class="space-y-3">
                  <div
                    v-for="cat in adminHelpCategories"
                    :key="cat.key"
                    class="rounded border border-white/10 p-3"
                  >
                    <NTag size="small" :type="cat.type">
                      {{ $t(`admin.logs.help.adminSection.categories.${cat.key}.label`) }}
                    </NTag>
                    <NText depth="3" class="block text-sm mt-2">
                      {{ $t(`admin.logs.help.adminSection.categories.${cat.key}.description`) }}
                    </NText>
                  </div>
                </div>
              </section>
            </div>
          </template>

        </div>
      </NCard>
    </NModal>
  </div>
</template>
