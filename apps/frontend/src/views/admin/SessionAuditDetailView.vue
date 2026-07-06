<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NAlert, NButton, NCard, NCollapse, NCollapseItem, NDescriptions, NDescriptionsItem, NInput, NSelect, NSpace, NSpin,
  NTabPane, NTabs, NTag, NText, useMessage,
} from 'naive-ui'
import type { JiraConfigPublic, JiraTicketPublic, LocalAiConfigPublic, OpenAiConfigPublic, SessionAuditAiArtifactPublic, SessionAuditAiJobPublic, SessionAuditCommand, SessionAuditCommandStats, SessionAuditPreviewEvent, SessionAuditPublic } from '@nodeaccess/shared'
import CollapsibleSection from '@/components/CollapsibleSection.vue'
import { integrationService } from '@/services/integration.service'
import { sessionAuditService } from '@/services/sessionAudit.service'
import { settingsService, type SettingsData } from '@/services/settings.service'

type SessionAuditAiPromptTemplate = 'summary-v1' | 'cab-v1' | 'risk-v1'
type CommandCategory = 'highRisk' | 'service' | 'permission' | 'user' | 'network' | 'interactive' | 'file' | 'inspection' | 'other'
type RouteSnapshotView = {
  requestedConnectionMode: string | null
  connectionMethod: string | null
  agentId: number | null
  agentName: string | null
  agentType: string | null
  agentMode: string | null
  agentSource: string | null
  agentOwnerUserId: number | null
  agentRemoteIp: string | null
  privateAccess: {
    hostConnectorId: number | null
    selectedBy: string | null
    siteName: string | null
    environment: string | null
    allowedCidrs: string[]
    allowedHostnames: string[]
    allowedPorts: number[]
    allowedHostTags: string[]
    allowFallback: boolean | null
  } | null
}

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const message = useMessage()

const loading = ref(false)
const previewLoading = ref(false)
const commandsLoading = ref(false)
const error = ref<string | null>(null)
const row = ref<SessionAuditPublic | null>(null)
const preview = ref<SessionAuditPreviewEvent[]>([])
const commands = ref<SessionAuditCommand[]>([])
const commandStats = ref<SessionAuditCommandStats | null>(null)
const jobsLoading = ref(false)
const artifactsLoading = ref(false)
const retryingSummary = ref(false)
const jobs = ref<SessionAuditAiJobPublic[]>([])
const artifacts = ref<SessionAuditAiArtifactPublic[]>([])
const settings = ref<SettingsData | null>(null)
const openAiConfig = ref<OpenAiConfigPublic | null>(null)
const localAiConfig = ref<LocalAiConfigPublic | null>(null)
const jiraConfig = ref<JiraConfigPublic | null>(null)
const jiraTicket = ref<JiraTicketPublic | null>(null)
const jiraTicketLoading = ref(false)
const linkTicketKey = ref('')
const linkingTicket = ref(false)
const commandSearch = ref('')
const commandLimit = ref(100)
const commandCategoryFilter = ref<CommandCategory | 'all'>('all')
const commandConfidenceFilter = ref<'all' | 'low' | 'medium' | 'high'>('all')
const previewSearch = ref('')
const selectedTemplate = ref<SessionAuditAiPromptTemplate>('summary-v1')

const sessionId = computed(() => Number(route.params.sessionId))
const sharedContext = computed(() => row.value?.sharedSessionContext ?? null)
const filteredCommands = computed(() => {
  const term = commandSearch.value.trim().toLowerCase()
  return commands.value.filter((command) => {
    const matchesTerm = !term
      || command.command.toLowerCase().includes(term)
      || command.output.toLowerCase().includes(term)
    const matchesCategory = commandCategoryFilter.value === 'all'
      || classifyCommand(command.command) === commandCategoryFilter.value
    const matchesConfidence = commandConfidenceFilter.value === 'all'
      || command.confidence === commandConfidenceFilter.value
    return matchesTerm && matchesCategory && matchesConfidence
  })
})
const filteredPreview = computed(() => {
  const term = previewSearch.value.trim().toLowerCase()
  if (!term) return preview.value
  return preview.value.filter((event) => {
    const text = previewText(event).toLowerCase()
    return event.type.toLowerCase().includes(term) || text.includes(term)
  })
})
const groupedCommands = computed(() => {
  const context = sharedContext.value
  if (!context) {
    return [{
      key: 'default',
      label: row.value?.userNameSnapshot || t('admin.sessionAudit.shared.roles.owner'),
      role: 'owner' as const,
      commands: filteredCommands.value,
    }]
  }

  return filteredCommands.value.reduce<Array<{
    key: string
    label: string
    role: 'owner' | 'viewer'
    commands: SessionAuditCommand[]
  }>>((groups, command) => {
    const actor = getCommandActor(command)
    const key = `${actor.role}:${actor.label}`
    const current = groups[groups.length - 1]

    if (current && current.key === key) {
      current.commands.push(command)
      return groups
    }

    groups.push({
      key,
      label: actor.label,
      role: actor.role,
      commands: [command],
    })
    return groups
  }, [])
})
const templateOptions = computed(() => [
  { label: t('admin.sessionAudit.aiJobs.templates.summary'), value: 'summary-v1' },
  { label: t('admin.sessionAudit.aiJobs.templates.cab'), value: 'cab-v1' },
  { label: t('admin.sessionAudit.aiJobs.templates.risk'), value: 'risk-v1' },
])
const commandLimitOptions = computed(() => [
  { label: '100', value: 100 },
  { label: '500', value: 500 },
  { label: t('admin.sessionAudit.commands.limitAll'), value: 5000 },
])
const commandCategoryOptions = computed(() => [
  { label: t('admin.sessionAudit.commands.filters.allCategories'), value: 'all' },
  ...(['highRisk', 'service', 'permission', 'user', 'network', 'interactive', 'inspection', 'file', 'other'] as CommandCategory[])
    .map((value) => ({ label: commandCategoryLabel(value), value })),
])
const commandConfidenceOptions = computed(() => [
  { label: t('admin.sessionAudit.commands.filters.allConfidence'), value: 'all' },
  { label: confidenceLabel('high'), value: 'high' },
  { label: confidenceLabel('medium'), value: 'medium' },
  { label: confidenceLabel('low'), value: 'low' },
])
const commandCategoryCounts = computed(() => {
  const counts = new Map<CommandCategory, number>()
  for (const command of commands.value) {
    const category = classifyCommand(command.command)
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({ category, count }))
})
const commandTotal = computed(() => commandStats.value?.total ?? commands.value.length)
const commandParticipants = computed(() => commandStats.value?.participants ?? [])
const hasAiContent = computed(() =>
  !!row.value && (
    !!row.value.aiSummaryStructured
    || !!row.value.aiSummaryText
    || artifacts.value.length > 0
    || jobs.value.length > 0
  ),
)
const criticalEvents = computed(() => row.value?.criticalEvents ?? [])
const aiLicensed = computed(() => settings.value?.license.sessionAuditAiEnabled ?? false)
const openAiReady = computed(() =>
  !!openAiConfig.value?.enabled
  && !!openAiConfig.value?.hasApiKey,
)
const localAiReady = computed(() =>
  !!localAiConfig.value?.enabled
  && resolveLocalAiProvider(localAiConfig.value) !== null,
)
const aiIntegrationEnabled = computed(() => aiLicensed.value && (openAiReady.value || localAiReady.value))
const aiReadyForActions = computed(() =>
  aiLicensed.value
  && (
    (openAiReady.value && openAiConfig.value?.healthStatus !== 'unhealthy')
    || (localAiReady.value && localAiConfig.value?.healthStatus !== 'unhealthy')
  ),
)
const showAiSection = computed(() => hasAiContent.value || aiIntegrationEnabled.value)
const showAiJobsSection = computed(() => aiIntegrationEnabled.value || jobs.value.length > 0)
const showAiJobActions = computed(() => aiReadyForActions.value)
const latestReadyAiJob = computed(() =>
  jobs.value.find((job) => job.status === 'READY' || job.status === 'PROCESSING' || job.status === 'PENDING') ?? null,
)
const jiraReady = computed(() =>
  !!jiraConfig.value?.enabled
  && !!jiraConfig.value?.hasApiToken
  && jiraConfig.value.healthStatus === 'healthy',
)
const showJiraLinkSection = computed(() => jiraReady.value)
const showTicketSnapshot = computed(() =>
  row.value?.ticketProvider?.toLowerCase() === 'jira' && !!row.value.ticketKey,
)
const generalInfoSummary = computed(() => {
  if (!row.value) return ''
  return [
    sessionStatusLabel(row.value.status),
    row.value.hostNameSnapshot,
    row.value.userNameSnapshot || `#${row.value.userId}`,
  ].filter(Boolean).join(' · ')
})
const routeSnapshotView = computed<RouteSnapshotView | null>(() => {
  const snapshot = row.value?.routeSnapshot
  if (!snapshot) return null
  const privateAccess = objectValue(snapshot.privateAccess)

  return {
    requestedConnectionMode: stringValue(snapshot.requestedConnectionMode),
    connectionMethod: stringValue(snapshot.connectionMethod),
    agentId: numberValue(snapshot.agentId),
    agentName: stringValue(snapshot.agentName),
    agentType: stringValue(snapshot.agentType),
    agentMode: stringValue(snapshot.agentMode),
    agentSource: stringValue(snapshot.agentSource),
    agentOwnerUserId: numberValue(snapshot.agentOwnerUserId),
    agentRemoteIp: stringValue(snapshot.agentRemoteIp),
    privateAccess: privateAccess
      ? {
          hostConnectorId: numberValue(privateAccess.hostConnectorId),
          selectedBy: stringValue(privateAccess.selectedBy),
          siteName: stringValue(privateAccess.siteName),
          environment: stringValue(privateAccess.environment),
          allowedCidrs: stringArrayValue(privateAccess.allowedCidrs),
          allowedHostnames: stringArrayValue(privateAccess.allowedHostnames),
          allowedPorts: numberArrayValue(privateAccess.allowedPorts),
          allowedHostTags: stringArrayValue(privateAccess.allowedHostTags),
          allowFallback: booleanValue(privateAccess.allowFallback),
        }
      : null,
  }
})
const routeSnapshotSummary = computed(() => {
  const snapshot = routeSnapshotView.value
  if (!snapshot) return ''
  return [
    snapshot.connectionMethod ? connectionMethodLabel(snapshot.connectionMethod) : null,
    snapshot.agentName,
    snapshot.privateAccess?.siteName,
  ].filter(Boolean).join(' · ')
})

function connectionMethodLabel(value: string) {
  return t(`admin.sessions.routes.${value}`, value)
}

function agentTypeLabel(value: string | null) {
  if (!value) return '—'
  return t(`admin.sessionAudit.routeSnapshot.agentTypes.${value}`, value)
}

function agentModeLabel(value: string | null) {
  if (!value) return '—'
  return t(`admin.sessionAudit.routeSnapshot.agentModes.${value}`, value)
}

function agentSourceLabel(value: string | null) {
  if (!value) return '—'
  return t(`admin.sessionAudit.routeSnapshot.agentSources.${value}`, value)
}

function selectedByLabel(value: string | null) {
  if (!value) return '—'
  return t(`admin.sessionAudit.routeSnapshot.selectedBy.${value}`, value)
}

function requestedConnectionModeLabel(value: string | null) {
  if (!value) return '—'
  return t(`admin.sessionAudit.routeSnapshot.requestedConnectionModes.${value}`, value)
}
const aiUnavailableMessage = computed(() => {
  if (!aiLicensed.value) return t('admin.sessionAudit.ai.visibility.licenseRequired')
  if (!openAiReady.value && !localAiReady.value) {
    return t('admin.sessionAudit.ai.visibility.integrationRequired')
  }
  if (openAiReady.value && openAiConfig.value?.healthStatus === 'unhealthy') {
    return openAiConfig.value.healthMessage || t('admin.sessionAudit.ai.visibility.integrationUnhealthy')
  }
  if (localAiReady.value && localAiConfig.value?.healthStatus === 'unhealthy') {
    return localAiConfig.value.healthMessage || t('admin.sessionAudit.ai.visibility.integrationUnhealthy')
  }
  return null
})

function sessionStatusLabel(value: string) {
  return t(`admin.sessionAudit.statuses.${value}`, value)
}

function aiSummaryStatusLabel(value: string) {
  return t(`admin.sessionAudit.ai.summaryStatuses.${value}`, value)
}

function aiRiskLabel(value: string) {
  return t(`admin.sessionAudit.ai.riskLevels.${value}`, value)
}

function confidenceLabel(value: string) {
  return t(`admin.sessionAudit.ai.confidence.${value}`, value)
}

function triggerSourceLabel(value: string) {
  return t(`admin.sessionAudit.ai.triggerSources.${value}`, value)
}

function previewEventLabel(value: string) {
  return t(`admin.sessionAudit.preview.eventTypes.${value}`, value)
}

function formatDate(d: Date | string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleString(locale.value, {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : []
}

function numberArrayValue(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number' && Number.isFinite(item)) : []
}

function listValue(values: Array<string | number>) {
  return values.length > 0 ? values.join(', ') : '—'
}

function statusTagType(value: string) {
  if (value === 'COMPLETED') return 'success'
  if (value === 'FAILED') return 'error'
  if (value === 'RUNNING') return 'warning'
  return 'default'
}

function previewTagType(value: string) {
  if (value === 'stdout') return 'info'
  if (value === 'stdin') return 'warning'
  if (value === 'session_error') return 'error'
  if (value === 'session_started' || value === 'session_ended') return 'success'
  return 'default'
}

function commandConfidenceTagType(value: string) {
  if (value === 'high') return 'success'
  if (value === 'medium') return 'warning'
  return 'default'
}

function classifyCommand(command: string): CommandCategory {
  const normalized = command.trim().toLowerCase()
  if (/\b(rm\s+-[^;&|]*r[^;&|]*f|mkfs|dd\s+if=|shutdown|reboot|halt|poweroff|wipefs|parted|fdisk|userdel)\b/.test(normalized)) {
    return 'highRisk'
  }
  if (/\b(systemctl|service|journalctl|supervisorctl|docker\s+(restart|stop|rm|logs)|kubectl\s+(delete|rollout|logs|describe))\b/.test(normalized)) {
    return 'service'
  }
  if (/\b(chmod|chown|chgrp|setfacl|umask)\b/.test(normalized)) {
    return 'permission'
  }
  if (/\b(useradd|usermod|passwd|groupadd|groupmod|sudo|su)\b/.test(normalized)) {
    return 'user'
  }
  if (/\b(iptables|ufw|firewall-cmd|nft|ss|netstat|ip\s+|route|traceroute|ping|curl|wget|nc|nmap)\b/.test(normalized)) {
    return 'network'
  }
  if (/\b(vim|vi|nano|top|htop|less|more|tail\s+-f|watch|tmux|screen)\b/.test(normalized)) {
    return 'interactive'
  }
  if (/\b(cat|tail|head|grep|find|ls|du|df|stat|pwd|whoami|id|ps|free|uptime)\b/.test(normalized)) {
    return 'inspection'
  }
  if (/\b(cp|mv|mkdir|rmdir|touch|tar|gzip|gunzip|zip|unzip|rsync|scp|sftp)\b/.test(normalized)) {
    return 'file'
  }
  return 'other'
}

function commandCategoryTagType(value: CommandCategory) {
  if (value === 'highRisk') return 'error'
  if (value === 'service' || value === 'permission' || value === 'user') return 'warning'
  if (value === 'network' || value === 'interactive') return 'info'
  return 'default'
}

function commandCategoryLabel(value: CommandCategory) {
  return t(`admin.sessionAudit.commands.categories.${value}`)
}

function aiJobStatusTagType(value: string) {
  if (value === 'READY') return 'success'
  if (value === 'FAILED') return 'error'
  if (value === 'PROCESSING') return 'warning'
  return 'default'
}

function aiSummaryTagType(value: string) {
  if (value === 'high') return 'error'
  if (value === 'medium') return 'warning'
  return 'success'
}

function criticalEventTagType(value: string) {
  if (value === 'high') return 'error'
  if (value === 'medium') return 'warning'
  return 'info'
}

function formatAiProviderLabel(provider: string) {
  if (provider === 'openai') return 'OpenAI'
  if (provider === 'ollama') return 'Ollama'
  if (provider === 'openai_compatible') return 'OpenAI-compatible'
  return provider
}

function sharedSessionStatusTagType(value: string) {
  if (value === 'active') return 'success'
  if (value === 'ended') return 'warning'
  return 'default'
}

function controlEpochTagType(value: string | null) {
  if (value === 'revoked' || value === 'owner_disconnected') return 'error'
  if (value === 'expired' || value === 'session_ended') return 'warning'
  return 'default'
}

function getCommandActor(command: SessionAuditCommand) {
  const context = sharedContext.value
  const submittedAt = new Date(command.submittedAt).getTime()

  if (!context || Number.isNaN(submittedAt)) {
    return {
      label: row.value?.userNameSnapshot || '—',
      role: 'owner' as const,
    }
  }

  if (command.actorUserId) {
    const participant = context.participants.find((item) => item.userId === command.actorUserId)
    if (participant) {
      return {
        label: participant.name,
        role: participant.role,
      }
    }
  }

  const epoch = context.controlEpochs.find((item) => {
    const start = new Date(item.startedAt).getTime()
    const end = item.endedAt
      ? new Date(item.endedAt).getTime()
      : new Date(item.expiresAt).getTime()
    return submittedAt >= start && submittedAt <= end
  })

  if (epoch) {
    return {
      label: epoch.controllerName,
      role: context.ownerUserId === epoch.controllerUserId ? 'owner' as const : 'viewer' as const,
    }
  }

  return {
    label: context.ownerName,
    role: 'owner' as const,
  }
}

function previewText(event: SessionAuditPreviewEvent) {
  if (event.text) return event.text
  if (event.type === 'resize') return `${event.cols ?? '?'}x${event.rows ?? '?'}`
  if (event.type === 'session_started') return t('admin.sessionAudit.preview.messages.sessionStarted')
  if (event.type === 'session_ended') return t('admin.sessionAudit.preview.messages.sessionEnded')
  if (event.type === 'session_error') return t('admin.sessionAudit.preview.messages.sessionError')
  return '—'
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const [{ data: detail }, { data: previewData }, { data: commandData }, { data: commandStatsData }, { data: jobsData }, { data: artifactsData }, { data: settingsData }] = await Promise.all([
      sessionAuditService.getBySessionId(sessionId.value),
      sessionAuditService.preview(sessionId.value, 200),
      sessionAuditService.commands(sessionId.value, 100),
      sessionAuditService.commandStats(sessionId.value),
      sessionAuditService.jobs(sessionId.value),
      sessionAuditService.artifacts(sessionId.value),
      settingsService.get(),
    ])
    row.value = detail
    preview.value = previewData
    commands.value = commandData
    commandStats.value = commandStatsData
    jobs.value = jobsData
    artifacts.value = artifactsData
    settings.value = settingsData

    if (settingsData.license.sessionAuditAiEnabled) {
      const [openAiResult, localAiResult] = await Promise.allSettled([
        integrationService.getOpenAi(),
        integrationService.getLocalAi(),
      ])
      openAiConfig.value = openAiResult.status === 'fulfilled' ? openAiResult.value.data : null
      localAiConfig.value = localAiResult.status === 'fulfilled' ? localAiResult.value.data : null
    } else {
      openAiConfig.value = null
      localAiConfig.value = null
    }

    try {
      const { data } = await integrationService.getJira()
      jiraConfig.value = data
    } catch {
      jiraConfig.value = null
    }

    jiraTicket.value = null
    linkTicketKey.value = detail.ticketKey ?? ''
    if (detail.ticketProvider?.toLowerCase() === 'jira' && detail.ticketKey && jiraReady.value) {
      jiraTicketLoading.value = true
      try {
        const { data } = await integrationService.getJiraTicket(detail.ticketKey)
        jiraTicket.value = data
      } catch {
        jiraTicket.value = null
      } finally {
        jiraTicketLoading.value = false
      }
    }
  } catch {
    error.value = t('admin.sessionAudit.messages.detailError')
  } finally {
    loading.value = false
  }
}

async function linkTicket() {
  if (!row.value || !jiraReady.value || !linkTicketKey.value.trim()) return
  linkingTicket.value = true
  try {
    const { data } = await sessionAuditService.linkTicket(row.value.sessionId, {
      ticketKey: linkTicketKey.value.trim(),
    })
    row.value = data
    const { data: ticketData } = await integrationService.getJiraTicket(data.ticketKey!)
    jiraTicket.value = ticketData
    linkTicketKey.value = data.ticketKey ?? ''
    message.success(t('admin.sessionAudit.ticketLink.messages.saved'))
  } catch {
    message.error(t('admin.sessionAudit.ticketLink.messages.saveError'))
  } finally {
    linkingTicket.value = false
  }
}

async function refreshJobs() {
  jobsLoading.value = true
  try {
    const { data } = await sessionAuditService.jobs(sessionId.value)
    jobs.value = data
  } finally {
    jobsLoading.value = false
  }
}

async function refreshArtifacts() {
  artifactsLoading.value = true
  try {
    const { data } = await sessionAuditService.artifacts(sessionId.value)
    artifacts.value = data
  } finally {
    artifactsLoading.value = false
  }
}

async function retrySummary() {
  if (!row.value) return
  if (!aiReadyForActions.value) {
    message.warning(aiUnavailableMessage.value || t('admin.sessionAudit.ai.visibility.integrationRequired'))
    return
  }
  retryingSummary.value = true
  try {
    await sessionAuditService.retrySummary(row.value.sessionId, { template: selectedTemplate.value })
    message.success(t('admin.sessionAudit.messages.retryAccepted'))
    await Promise.all([load(), refreshJobs(), refreshArtifacts()])
  } catch (e: any) {
    message.error(e?.response?.data?.message ?? t('admin.sessionAudit.messages.retryError'))
  } finally {
    retryingSummary.value = false
  }
}

async function refreshPreview() {
  previewLoading.value = true
  try {
    const { data } = await sessionAuditService.preview(sessionId.value, 200)
    preview.value = data
  } finally {
    previewLoading.value = false
  }
}

async function refreshCommands() {
  commandsLoading.value = true
  try {
    const { data } = await sessionAuditService.commands(sessionId.value, commandLimit.value)
    commands.value = data
  } finally {
    commandsLoading.value = false
  }
}

function csvEscape(value: unknown): string {
  const raw = String(value ?? '')
  return `"${raw.replace(/"/g, '""')}"`
}

function commandOutputSummary(output: string): string {
  const normalized = output.replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > 500 ? `${normalized.slice(0, 500)}...` : normalized
}

function exportFilteredCommandsCsv() {
  if (!row.value) return

  const headers = [
    'sessionId',
    'host',
    'actor',
    'index',
    'submittedAt',
    'confidence',
    'category',
    'command',
    'outputSummary',
  ]
  const lines = [
    headers.map(csvEscape).join(','),
    ...filteredCommands.value.map((command) => {
      const actor = getCommandActor(command)
      return [
        row.value?.sessionId,
        row.value?.hostNameSnapshot,
        actor.label,
        command.index,
        command.submittedAt,
        command.confidence,
        commandCategoryLabel(classifyCommand(command.command)),
        command.command,
        commandOutputSummary(command.output),
      ].map(csvEscape).join(',')
    }),
  ]

  const blob = new Blob([`${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8' })
  sessionAuditService.saveBlobAs(blob, `session-audit-${row.value.sessionId}-commands.csv`)
}

async function download() {
  if (!row.value) return
  try {
    const { data } = await sessionAuditService.download(row.value.sessionId)
    sessionAuditService.saveBlobAs(data, `session-audit-${row.value.sessionId}.jsonl`)
  } catch {
    message.error(t('admin.sessionAudit.messages.downloadError'))
  }
}

onMounted(load)

function resolveLocalAiProvider(config: LocalAiConfigPublic | null): 'ollama' | 'openai_compatible' | null {
  if (!config) return null

  const localReady = !!(config.localProvider && config.localBaseUrl && config.localModel)
  const networkReady = !!(config.networkProvider && config.networkBaseUrl && config.networkModel && config.hasNetworkApiKey)

  switch (config.routingPolicy) {
    case 'local_only':
      return localReady ? 'ollama' : null
    case 'network_only':
      return networkReady ? 'openai_compatible' : null
    case 'prefer_local':
      return localReady ? 'ollama' : networkReady ? 'openai_compatible' : null
    case 'prefer_network':
      return networkReady ? 'openai_compatible' : localReady ? 'ollama' : null
    default:
      return null
  }
}
</script>

<template>
  <div class="p-6">
    <NSpace justify="space-between" align="center" class="mb-6">
      <div>
        <h1 class="text-xl font-semibold text-white">
          {{ $t('admin.sessionAudit.detailTitle', { sessionId }) }}
        </h1>
        <NText depth="3" class="text-sm">{{ $t('admin.sessionAudit.subtitle') }}</NText>
      </div>
      <NSpace>
        <NButton secondary @click="router.push({ name: 'admin-session-audit' })">
          {{ $t('admin.sessionAudit.backToList') }}
        </NButton>
        <NButton type="primary" :disabled="!row" @click="download">
          {{ $t('common.download') }}
        </NButton>
      </NSpace>
    </NSpace>

    <NAlert v-if="error" type="error" class="mb-4">{{ error }}</NAlert>

    <NSpin :show="loading">
      <NCard v-if="row" embedded :bordered="false" class="na-card">
        <CollapsibleSection
          :title="$t('admin.sessionAudit.generalInfo.title')"
          :default-open="true"
        >
          <template #header-extra>
            <NText depth="3" class="truncate text-xs">{{ generalInfoSummary }}</NText>
          </template>

          <NDescriptions label-placement="top" :column="3" bordered>
            <NDescriptionsItem :label="$t('admin.sessionAudit.columns.status')">
              <NTag :type="statusTagType(row.status)" size="small">{{ sessionStatusLabel(row.status) }}</NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.sessionAudit.columns.ticket')">
              {{ row.ticketKey ?? '—' }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.sessionAudit.fields.connectionMethod')">
              {{ connectionMethodLabel(row.connectionMethod) }}
            </NDescriptionsItem>

            <NDescriptionsItem :label="$t('admin.sessionAudit.fields.clientIp')">
              <NText class="font-mono text-xs">{{ row.clientIp ?? '—' }}</NText>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.sessionAudit.fields.agentRemoteIp')">
              <NText class="font-mono text-xs">{{ row.agentRemoteIp ?? '—' }}</NText>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.sessionAudit.fields.userAgent')">
              <NText class="text-xs">{{ row.userAgent ?? '—' }}</NText>
            </NDescriptionsItem>

            <NDescriptionsItem :label="$t('common.user')">
              <div>{{ row.userNameSnapshot || `#${row.userId}` }}</div>
              <div class="text-xs text-zinc-400">{{ row.userEmailSnapshot ?? `#${row.userId}` }}</div>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('common.name')">
              <div>{{ row.hostNameSnapshot }}</div>
              <NTag v-if="row.hostDeleted" size="small" type="warning" class="mt-1">
                {{ $t('hosts.messages.hostDeleted') }}
              </NTag>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('common.ip')">
              {{ row.hostIpSnapshot }}
            </NDescriptionsItem>

            <NDescriptionsItem :label="$t('admin.sessionAudit.columns.startedAt')">
              {{ formatDate(row.startedAt) }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.sessionAudit.columns.endedAt')">
              {{ formatDate(row.endedAt) }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.sessionAudit.columns.chunks')">
              {{ row.chunkCount }}
            </NDescriptionsItem>

            <NDescriptionsItem :label="$t('admin.sessionAudit.fields.bytesIn')">
              {{ formatBytes(row.bytesIn) }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.sessionAudit.fields.bytesOut')">
              {{ formatBytes(row.bytesOut) }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.sessionAudit.fields.commandTotal')">
              {{ commandTotal }}
            </NDescriptionsItem>

            <NDescriptionsItem
              v-if="commandParticipants.length"
              :label="$t('admin.sessionAudit.fields.commandParticipants')"
            >
              <NSpace size="small">
                <NTag
                  v-for="participant in commandParticipants"
                  :key="participant.key"
                  size="small"
                  :type="participant.role === 'owner' ? 'warning' : 'info'"
                >
                  {{ participant.name }}: {{ participant.count }}
                </NTag>
              </NSpace>
            </NDescriptionsItem>
            <NDescriptionsItem v-if="showAiSection" :label="$t('admin.sessionAudit.fields.aiSummaryStatus')">
              {{ aiSummaryStatusLabel(row.aiSummaryStatus) }}
            </NDescriptionsItem>
            <NDescriptionsItem v-if="showAiSection" :label="$t('admin.sessionAudit.fields.aiRiskLevel')">
              {{ row.aiRiskLevel ? aiRiskLabel(row.aiRiskLevel) : '—' }}
            </NDescriptionsItem>

            <NDescriptionsItem v-if="row.ticketProvider" :label="$t('admin.sessionAudit.fields.ticketProvider')">
              {{ row.ticketProvider }}
            </NDescriptionsItem>
            <NDescriptionsItem v-if="row.ticketUrl" :label="$t('admin.sessionAudit.fields.ticketUrl')">
              <a
                :href="row.ticketUrl"
                target="_blank"
                rel="noreferrer"
                class="text-sky-400 hover:text-sky-300"
              >
                {{ row.ticketUrl }}
              </a>
            </NDescriptionsItem>
          </NDescriptions>
        </CollapsibleSection>

        <CollapsibleSection
          v-if="routeSnapshotView"
          class="mt-4"
          :title="$t('admin.sessionAudit.routeSnapshot.title')"
        >
          <template #header-extra>
            <NText depth="3" class="truncate text-xs">{{ routeSnapshotSummary }}</NText>
          </template>

          <NDescriptions class="mt-3" label-placement="top" :column="3" bordered>
            <NDescriptionsItem :label="$t('admin.sessionAudit.routeSnapshot.requestedConnectionMode')">
              {{ requestedConnectionModeLabel(routeSnapshotView.requestedConnectionMode) }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.sessionAudit.routeSnapshot.effectiveConnectionMethod')">
              {{ routeSnapshotView.connectionMethod ? connectionMethodLabel(routeSnapshotView.connectionMethod) : '—' }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.sessionAudit.routeSnapshot.agentSource')">
              {{ agentSourceLabel(routeSnapshotView.agentSource) }}
            </NDescriptionsItem>

            <NDescriptionsItem :label="$t('admin.sessionAudit.routeSnapshot.agent')">
              <div>{{ routeSnapshotView.agentName ?? '—' }}</div>
              <div v-if="routeSnapshotView.agentId" class="text-xs text-zinc-400">#{{ routeSnapshotView.agentId }}</div>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.sessionAudit.routeSnapshot.agentType')">
              {{ agentTypeLabel(routeSnapshotView.agentType) }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.sessionAudit.routeSnapshot.agentMode')">
              {{ agentModeLabel(routeSnapshotView.agentMode) }}
            </NDescriptionsItem>

            <NDescriptionsItem :label="$t('admin.sessionAudit.routeSnapshot.agentOwner')">
              {{ routeSnapshotView.agentOwnerUserId ? `#${routeSnapshotView.agentOwnerUserId}` : '—' }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.sessionAudit.routeSnapshot.agentRemoteIp')">
              <NText class="font-mono text-xs">{{ routeSnapshotView.agentRemoteIp ?? row.agentRemoteIp ?? '—' }}</NText>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.sessionAudit.routeSnapshot.privateAccessConnector')">
              <NTag v-if="routeSnapshotView.privateAccess" size="small" type="success">
                {{ $t('admin.sessionAudit.routeSnapshot.privateAccessEnabled') }}
              </NTag>
              <span v-else>—</span>
            </NDescriptionsItem>
          </NDescriptions>

          <NDescriptions
            v-if="routeSnapshotView.privateAccess"
            class="mt-4"
            label-placement="top"
            :column="3"
            bordered
          >
            <NDescriptionsItem :label="$t('admin.sessionAudit.routeSnapshot.hostConnectorId')">
              {{ routeSnapshotView.privateAccess.hostConnectorId ? `#${routeSnapshotView.privateAccess.hostConnectorId}` : '—' }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.sessionAudit.routeSnapshot.selectedByLabel')">
              {{ selectedByLabel(routeSnapshotView.privateAccess.selectedBy) }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.sessionAudit.routeSnapshot.allowFallback')">
              {{ routeSnapshotView.privateAccess.allowFallback === null ? '—' : $t(routeSnapshotView.privateAccess.allowFallback ? 'common.yes' : 'common.no') }}
            </NDescriptionsItem>

            <NDescriptionsItem :label="$t('admin.sessionAudit.routeSnapshot.siteName')">
              {{ routeSnapshotView.privateAccess.siteName ?? '—' }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.sessionAudit.routeSnapshot.environment')">
              {{ routeSnapshotView.privateAccess.environment ?? '—' }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.sessionAudit.routeSnapshot.allowedPorts')">
              <NText class="font-mono text-xs">{{ listValue(routeSnapshotView.privateAccess.allowedPorts) }}</NText>
            </NDescriptionsItem>

            <NDescriptionsItem :label="$t('admin.sessionAudit.routeSnapshot.allowedCidrs')">
              <NText class="font-mono text-xs">{{ listValue(routeSnapshotView.privateAccess.allowedCidrs) }}</NText>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.sessionAudit.routeSnapshot.allowedHostnames')">
              <NText class="font-mono text-xs">{{ listValue(routeSnapshotView.privateAccess.allowedHostnames) }}</NText>
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.sessionAudit.routeSnapshot.allowedHostTags')">
              {{ listValue(routeSnapshotView.privateAccess.allowedHostTags) }}
            </NDescriptionsItem>
          </NDescriptions>
        </CollapsibleSection>

        <CollapsibleSection v-if="sharedContext" class="mt-4" :title="$t('admin.sessionAudit.shared.title')">
          <template #header-extra>
            <NTag size="small" :type="sharedSessionStatusTagType(sharedContext.status)">
              {{ $t(`admin.sessionAudit.shared.statuses.${sharedContext.status}`) }}
            </NTag>
          </template>

          <NDescriptions class="mt-3" label-placement="top" :column="3" bordered>
            <NDescriptionsItem :label="$t('admin.sessionAudit.shared.owner')">
              {{ sharedContext.ownerName }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.sessionAudit.shared.participantsCount')">
              {{ sharedContext.participantsCount }}
            </NDescriptionsItem>
            <NDescriptionsItem :label="$t('admin.sessionAudit.shared.sharedSessionId')">
              #{{ sharedContext.sharedSessionId }}
            </NDescriptionsItem>
          </NDescriptions>

          <div class="mt-4">
            <NText strong>{{ $t('admin.sessionAudit.shared.participants') }}</NText>
            <div class="mt-2 space-y-2">
              <div
                v-for="participant in sharedContext.participants"
                :key="`${participant.userId}-${participant.joinedAt}`"
                class="na-item rounded-xl border px-3 py-2"
              >
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <div class="text-sm text-zinc-100">{{ participant.name }}</div>
                    <div class="text-xs text-zinc-400">{{ participant.email ?? `#${participant.userId}` }}</div>
                  </div>
                  <NTag size="small" :type="participant.role === 'owner' ? 'warning' : 'info'">
                    {{ $t(`admin.sessionAudit.shared.roles.${participant.role}`) }}
                  </NTag>
                </div>
                <div class="mt-2 text-xs text-zinc-400">
                  {{ $t('admin.sessionAudit.shared.joinedAt') }}: {{ formatDate(participant.joinedAt) }}
                  <template v-if="participant.leftAt">
                    · {{ $t('admin.sessionAudit.shared.leftAt') }}: {{ formatDate(participant.leftAt) }}
                  </template>
                </div>
              </div>
            </div>
          </div>

          <div class="mt-4">
            <NText strong>{{ $t('admin.sessionAudit.shared.controlEpochs') }}</NText>
            <div v-if="sharedContext.controlEpochs.length" class="mt-2 space-y-2">
              <div
                v-for="epoch in sharedContext.controlEpochs"
                :key="epoch.leaseId"
                class="na-item rounded-xl border px-3 py-2"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="text-sm text-zinc-100">
                    {{ $t('admin.sessionAudit.shared.controlSummary', { controller: epoch.controllerName, grantor: epoch.grantedByName }) }}
                  </div>
                  <NTag size="small" :type="controlEpochTagType(epoch.endReason)">
                    {{ $t(`admin.sessionAudit.shared.endReasons.${epoch.endReason ?? 'active'}`) }}
                  </NTag>
                </div>
                <div class="mt-2 text-xs text-zinc-400">
                  {{ $t('admin.sessionAudit.shared.startedAt') }}: {{ formatDate(epoch.startedAt) }}
                  · {{ $t('admin.sessionAudit.shared.expiresAt') }}: {{ formatDate(epoch.expiresAt) }}
                  <template v-if="epoch.endedAt">
                    · {{ $t('admin.sessionAudit.shared.endedAt') }}: {{ formatDate(epoch.endedAt) }}
                  </template>
                </div>
                <div v-if="epoch.revokeReason" class="mt-1 text-xs text-zinc-500">
                  {{ $t('admin.sessionAudit.shared.revokeReason') }}: {{ epoch.revokeReason }}
                </div>
              </div>
            </div>
            <NText v-else depth="3" class="mt-2 block text-sm">
              {{ $t('admin.sessionAudit.shared.noControlEpochs') }}
            </NText>
          </div>
        </CollapsibleSection>

        <NCard
          v-if="showJiraLinkSection"
          embedded
          class="na-panel mt-4"
        >
          <NSpace justify="space-between" align="center">
            <NText strong>{{ $t('admin.sessionAudit.ticketLink.title') }}</NText>
            <NTag size="small" type="success">{{ $t('admin.sessionAudit.ticketLink.ready') }}</NTag>
          </NSpace>

          <div class="mt-3">
            <NText depth="3" class="text-xs block mb-2">{{ $t('admin.sessionAudit.ticketLink.description') }}</NText>
            <NSpace>
              <NInput
                v-model:value="linkTicketKey"
                clearable
                style="width: 220px"
                :placeholder="$t('admin.sessionAudit.ticketLink.placeholder')"
                @keyup.enter="linkTicket"
              />
              <NButton
                type="primary"
                :loading="linkingTicket"
                :disabled="!linkTicketKey.trim()"
                @click="linkTicket"
              >
                {{ $t('admin.sessionAudit.ticketLink.action') }}
              </NButton>
            </NSpace>
          </div>
        </NCard>

        <CollapsibleSection
          v-if="showTicketSnapshot"
          class="mt-4"
          :title="$t('admin.sessionAudit.ticketSnapshot.title')"
        >
          <template #header-extra>
            <NTag size="small" type="info">{{ row.ticketKey }}</NTag>
          </template>

          <div v-if="jiraTicketLoading" class="mt-3 text-sm text-zinc-400">
            {{ $t('admin.sessionAudit.ticketSnapshot.loading') }}
          </div>

          <div v-else-if="jiraTicket" class="mt-3">
            <NDescriptions label-placement="top" :column="3" bordered>
              <NDescriptionsItem :label="$t('admin.sessionAudit.ticketSnapshot.summary')">
                {{ jiraTicket.summary }}
              </NDescriptionsItem>
              <NDescriptionsItem :label="$t('admin.sessionAudit.ticketSnapshot.status')">
                {{ jiraTicket.status ?? '—' }}
              </NDescriptionsItem>
              <NDescriptionsItem :label="$t('admin.sessionAudit.ticketSnapshot.issueType')">
                {{ jiraTicket.issueType ?? '—' }}
              </NDescriptionsItem>
              <NDescriptionsItem :label="$t('admin.sessionAudit.ticketSnapshot.project')">
                {{ jiraTicket.projectKey ?? '—' }}<span v-if="jiraTicket.projectName"> · {{ jiraTicket.projectName }}</span>
              </NDescriptionsItem>
              <NDescriptionsItem :label="$t('admin.sessionAudit.ticketSnapshot.assignee')">
                {{ jiraTicket.assigneeDisplayName ?? '—' }}
              </NDescriptionsItem>
              <NDescriptionsItem :label="$t('admin.sessionAudit.ticketSnapshot.updatedAt')">
                {{ formatDate(jiraTicket.updatedAt) }}
              </NDescriptionsItem>
            </NDescriptions>

            <div v-if="jiraTicket.labels.length > 0" class="mt-4">
              <NText strong>{{ $t('admin.sessionAudit.ticketSnapshot.labels') }}</NText>
              <NSpace class="mt-2">
                <NTag v-for="label in jiraTicket.labels" :key="label" size="small">{{ label }}</NTag>
              </NSpace>
            </div>
          </div>

          <div v-else class="mt-3 text-sm text-zinc-400">
            {{ jiraReady ? $t('admin.sessionAudit.ticketSnapshot.unavailable') : $t('admin.sessionAudit.ticketSnapshot.integrationUnavailable') }}
          </div>
        </CollapsibleSection>

        <NAlert
          v-if="aiIntegrationEnabled && aiUnavailableMessage"
          type="warning"
          class="mt-4"
        >
          {{ aiUnavailableMessage }}
        </NAlert>

        <CollapsibleSection v-if="criticalEvents.length > 0" title="Eventos críticos" body-class="mt-2 !bg-transparent">
          <template #header-extra>
            <NTag size="small" type="error">{{ criticalEvents.length }}</NTag>
          </template>
          <div class="space-y-3">
            <div
              v-for="event in criticalEvents"
              :key="`${event.type}-${event.commandIndex}-${event.command}`"
              class="na-item rounded-lg border p-3"
            >
              <NSpace align="center" size="small">
                <NTag size="small" :type="criticalEventTagType(event.severity)">{{ aiRiskLabel(event.severity) }}</NTag>
                <NTag size="small" type="primary">#{{ event.commandIndex }}</NTag>
                <NText strong>{{ event.title }}</NText>
              </NSpace>
              <div class="mt-2 text-sm text-zinc-300">{{ event.summary }}</div>
              <pre class="na-code mt-3 overflow-x-auto whitespace-pre rounded p-3 font-mono text-xs text-amber-200">{{ event.command }}</pre>
              <div v-if="event.evidence.length > 0" class="mt-3 space-y-1 text-xs text-zinc-400">
                <div v-for="(evidence, index) in event.evidence" :key="`${event.commandIndex}-evidence-${index}`">
                  {{ evidence }}
                </div>
              </div>
            </div>
          </div>
        </CollapsibleSection>

        <NCard v-if="hasAiContent && (row.aiSummaryStructured || row.aiSummaryText)" embedded class="na-panel mt-4">
          <NSpace justify="space-between" align="center">
            <NText strong>{{ $t('admin.sessionAudit.fields.aiSummaryText') }}</NText>
            <NSpace align="center" size="small">
              <NTag v-if="latestReadyAiJob" size="small" type="info">
                {{ $t('admin.sessionAudit.fields.aiProvider') }}: {{ formatAiProviderLabel(latestReadyAiJob.provider) }}
              </NTag>
              <NTag v-if="row.aiSummaryStructured" size="small" :type="aiSummaryTagType(row.aiSummaryStructured.riskLevel)">{{ aiRiskLabel(row.aiSummaryStructured.riskLevel) }}</NTag>
              <NTag v-if="row.aiSummaryStructured" size="small">{{ confidenceLabel(row.aiSummaryStructured.confidence) }}</NTag>
            </NSpace>
          </NSpace>

          <template v-if="row.aiSummaryStructured">
            <div class="mt-3 text-sm text-zinc-300 whitespace-pre-wrap">{{ row.aiSummaryStructured.summary }}</div>

            <div v-if="row.aiSummaryStructured.keyFindings.length > 0" class="mt-4">
              <NText strong>{{ $t('admin.sessionAudit.fields.aiKeyFindings') }}</NText>
              <ul class="mt-2 list-disc pl-5 text-sm text-zinc-300 space-y-1">
                <li v-for="(finding, index) in row.aiSummaryStructured.keyFindings" :key="`finding-${index}`">{{ finding }}</li>
              </ul>
            </div>

            <div v-if="row.aiSummaryStructured.nextActions.length > 0" class="mt-4">
              <NText strong>{{ $t('admin.sessionAudit.fields.aiNextActions') }}</NText>
              <ul class="mt-2 list-disc pl-5 text-sm text-zinc-300 space-y-1">
                <li v-for="(action, index) in row.aiSummaryStructured.nextActions" :key="`action-${index}`">{{ action }}</li>
              </ul>
            </div>
          </template>

          <pre v-else class="mt-3 whitespace-pre-wrap text-sm text-zinc-300">{{ row.aiSummaryText }}</pre>
        </NCard>

        <CollapsibleSection v-if="hasAiContent" class="mt-4" :title="$t('admin.sessionAudit.aiArtifacts.title')">
            <NSpace justify="space-between" align="center">
              <NText strong>{{ $t('admin.sessionAudit.aiArtifacts.title') }}</NText>
              <NButton size="small" secondary :loading="artifactsLoading" @click="refreshArtifacts">
                {{ $t('admin.sessionAudit.aiArtifacts.refresh') }}
              </NButton>
            </NSpace>

          <div v-if="artifacts.length === 0 && !artifactsLoading" class="mt-4 text-sm text-zinc-400">
            {{ $t('admin.sessionAudit.aiArtifacts.empty') }}
          </div>

          <div v-else class="mt-4 space-y-4">
            <div
              v-for="artifact in artifacts"
              :key="artifact.id"
              class="na-item rounded-lg border p-3"
            >
              <NSpace align="center" size="small">
                <NTag size="small">{{ artifact.template }}</NTag>
                <NTag size="small">{{ triggerSourceLabel(artifact.triggerSource) }}</NTag>
                <NTag v-if="artifact.riskLevel" size="small" :type="aiSummaryTagType(artifact.riskLevel)">{{ aiRiskLabel(artifact.riskLevel) }}</NTag>
                <NText depth="3" style="font-size:12px">{{ formatDate(artifact.createdAt) }}</NText>
              </NSpace>

              <template v-if="artifact.summaryStructured">
                <div class="mt-3 text-sm text-zinc-300 whitespace-pre-wrap">{{ artifact.summaryStructured.summary }}</div>

                <div v-if="artifact.summaryStructured.keyFindings.length > 0" class="mt-4">
                  <NText strong>{{ $t('admin.sessionAudit.fields.aiKeyFindings') }}</NText>
                  <ul class="mt-2 list-disc pl-5 text-sm text-zinc-300 space-y-1">
                    <li v-for="(finding, index) in artifact.summaryStructured.keyFindings" :key="`artifact-finding-${artifact.id}-${index}`">{{ finding }}</li>
                  </ul>
                </div>

                <div v-if="artifact.summaryStructured.nextActions.length > 0" class="mt-4">
                  <NText strong>{{ $t('admin.sessionAudit.fields.aiNextActions') }}</NText>
                  <ul class="mt-2 list-disc pl-5 text-sm text-zinc-300 space-y-1">
                    <li v-for="(action, index) in artifact.summaryStructured.nextActions" :key="`artifact-action-${artifact.id}-${index}`">{{ action }}</li>
                  </ul>
                </div>
              </template>

              <pre v-else class="mt-3 whitespace-pre-wrap text-sm text-zinc-300">{{ artifact.summaryText }}</pre>
            </div>
          </div>
        </CollapsibleSection>

        <CollapsibleSection v-if="showAiJobsSection" class="mt-4" :title="$t('admin.sessionAudit.aiJobs.title')">
            <NSpace justify="space-between" align="center">
              <NText strong>{{ $t('admin.sessionAudit.aiJobs.title') }}</NText>
              <NSpace>
                <NSelect
                  v-if="showAiJobActions"
                  v-model:value="selectedTemplate"
                  size="small"
                  style="width: 210px"
                  :options="templateOptions"
                />
                <NButton size="small" secondary :loading="jobsLoading" @click="refreshJobs">
                  {{ $t('admin.sessionAudit.aiJobs.refresh') }}
                </NButton>
                <NButton
                  v-if="showAiJobActions"
                  size="small"
                  type="primary"
                  :loading="retryingSummary"
                  :disabled="row.status !== 'COMPLETED' || !aiReadyForActions"
                  @click="retrySummary"
                >
                  {{ $t('admin.sessionAudit.aiJobs.retry') }}
                </NButton>
              </NSpace>
            </NSpace>

          <div v-if="jobs.length === 0 && !jobsLoading" class="mt-4 text-sm text-zinc-400">
            {{ $t('admin.sessionAudit.aiJobs.empty') }}
          </div>

          <div v-else class="mt-4 space-y-3">
            <div
              v-for="job in jobs"
              :key="job.id"
              class="na-item rounded-lg border p-3"
            >
              <NSpace align="center" size="small">
                <NTag size="small">{{ triggerSourceLabel(job.triggerSource) }}</NTag>
                <NTag size="small" :type="aiJobStatusTagType(job.status)">{{ aiSummaryStatusLabel(job.status) }}</NTag>
                <span class="font-mono text-xs text-zinc-500">{{ formatAiProviderLabel(job.provider) }}{{ job.model ? ` · ${job.model}` : '' }}</span>
              </NSpace>
              <div class="mt-2 text-xs text-zinc-400">
                {{ formatDate(job.createdAt) }}
                <span v-if="job.finishedAt"> · {{ formatDate(job.finishedAt) }}</span>
              </div>
              <div v-if="job.errorMessage" class="mt-2 text-sm text-rose-300">
                {{ job.errorMessage }}
              </div>
            </div>
          </div>
        </CollapsibleSection>

        <NCard embedded class="na-panel mt-4">
          <NTabs type="line" animated>
            <NTabPane name="commands" :tab="$t('admin.sessionAudit.tabs.commands')">
              <div class="space-y-3">
                <NAlert type="info" :show-icon="false">
                  {{ $t('admin.sessionAudit.commands.derivedNotice') }}
                </NAlert>

                <NSpace justify="space-between" align="center">
                  <div>
                    <NText strong>{{ $t('admin.sessionAudit.commands.title') }}</NText>
                    <div class="mt-1 text-xs text-zinc-500">
                      {{ $t('admin.sessionAudit.commands.loadedCount', { count: commands.length }) }}
                    </div>
                  </div>
                  <NSpace>
                    <NSelect
                      v-model:value="commandLimit"
                      size="small"
                      style="width: 120px"
                      :options="commandLimitOptions"
                      @update:value="refreshCommands"
                    />
                    <NSelect
                      v-model:value="commandCategoryFilter"
                      size="small"
                      style="width: 150px"
                      :options="commandCategoryOptions"
                    />
                    <NSelect
                      v-model:value="commandConfidenceFilter"
                      size="small"
                      style="width: 150px"
                      :options="commandConfidenceOptions"
                    />
                    <NInput
                      v-model:value="commandSearch"
                      clearable
                      size="small"
                      style="width: 260px"
                      :placeholder="$t('admin.sessionAudit.commands.searchPlaceholder')"
                    />
                    <NButton size="small" secondary :disabled="filteredCommands.length === 0" @click="exportFilteredCommandsCsv">
                      {{ $t('admin.sessionAudit.commands.exportCsv') }}
                    </NButton>
                    <NButton size="small" secondary :loading="commandsLoading" @click="refreshCommands">
                      {{ $t('admin.sessionAudit.commands.refresh') }}
                    </NButton>
                  </NSpace>
                </NSpace>

                <div v-if="commandCategoryCounts.length > 0" class="flex flex-wrap gap-2">
                  <NTag
                    v-for="item in commandCategoryCounts"
                    :key="item.category"
                    size="small"
                    :type="commandCategoryTagType(item.category)"
                    round
                  >
                    {{ commandCategoryLabel(item.category) }}: {{ item.count }}
                  </NTag>
                </div>
              </div>

              <div v-if="filteredCommands.length === 0 && !commandsLoading" class="mt-4 text-sm text-zinc-400">
                {{ $t('admin.sessionAudit.commands.empty') }}
              </div>

              <div v-else class="mt-4 space-y-4">
                <div
                  v-for="group in groupedCommands"
                  :key="group.key"
                  class="na-item rounded-xl border p-3"
                >
                  <div class="mb-3 flex items-center justify-between gap-3 border-b pb-3">
                    <div>
                      <div class="text-sm font-medium text-zinc-100">
                        {{ $t('admin.sessionAudit.commands.executedBy', { name: group.label }) }}
                      </div>
                      <div class="text-xs text-zinc-500">
                        {{ $t('admin.sessionAudit.commands.commandCount', { count: group.commands.length }) }}
                      </div>
                    </div>
                    <NTag size="small" :type="group.role === 'owner' ? 'warning' : 'info'">
                      {{ $t(`admin.sessionAudit.shared.roles.${group.role}`) }}
                    </NTag>
                  </div>

                  <div class="space-y-4">
                    <div
                      v-for="command in group.commands"
                      :key="command.index"
                      class="na-panel rounded-lg border p-3"
                    >
                      <NSpace align="center" size="small">
                        <NTag size="small" type="primary">#{{ command.index }}</NTag>
                        <NTag size="small" :type="group.role === 'owner' ? 'warning' : 'info'">
                          {{ group.label }}
                        </NTag>
                        <NTag size="small" :type="commandCategoryTagType(classifyCommand(command.command))">
                          {{ commandCategoryLabel(classifyCommand(command.command)) }}
                        </NTag>
                        <NTag size="small" :type="commandConfidenceTagType(command.confidence)">{{ confidenceLabel(command.confidence) }}</NTag>
                        <NText depth="3" style="font-size:12px">{{ formatDate(command.submittedAt) }}</NText>
                      </NSpace>

                      <div class="mt-3">
                        <NText depth="3" style="font-size:12px">{{ $t('admin.sessionAudit.commands.command') }}</NText>
                        <pre class="na-code mt-1 overflow-x-auto whitespace-pre rounded p-3 font-mono text-xs text-emerald-300">{{ command.command }}</pre>
                      </div>

                      <NCollapse v-if="command.output" class="mt-3" arrow-placement="right">
                        <NCollapseItem :title="$t('admin.sessionAudit.commands.output')" :name="`output-${command.index}`">
                          <pre class="na-code mt-1 max-h-[360px] overflow-auto whitespace-pre rounded p-3 text-xs text-zinc-300">{{ command.output }}</pre>
                        </NCollapseItem>
                      </NCollapse>
                      <div v-else class="mt-3 text-xs text-zinc-500">
                        {{ $t('admin.sessionAudit.commands.noOutput') }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </NTabPane>

            <NTabPane name="preview" :tab="$t('admin.sessionAudit.tabs.preview')">
              <NSpace justify="space-between" align="center">
                <NText strong>{{ $t('admin.sessionAudit.preview.title') }}</NText>
                <NSpace>
                  <NInput
                    v-model:value="previewSearch"
                    clearable
                    size="small"
                    style="width: 260px"
                    :placeholder="$t('admin.sessionAudit.preview.searchPlaceholder')"
                  />
                  <NButton size="small" secondary :loading="previewLoading" @click="refreshPreview">
                    {{ $t('admin.sessionAudit.preview.refresh') }}
                  </NButton>
                </NSpace>
              </NSpace>

              <div v-if="filteredPreview.length === 0 && !previewLoading" class="mt-4 text-sm text-zinc-400">
                {{ $t('admin.sessionAudit.preview.empty') }}
              </div>

              <div v-else class="mt-4 space-y-3">
                <div
                  v-for="event in filteredPreview"
                  :key="event.seq"
                  class="na-item rounded-lg border p-3"
                >
                  <NSpace align="center" size="small">
                    <NTag size="small" :type="previewTagType(event.type)">{{ previewEventLabel(event.type) }}</NTag>
                    <NText depth="3" style="font-family:monospace;font-size:12px">#{{ event.seq }}</NText>
                    <NText depth="3" style="font-size:12px">{{ formatDate(event.timestamp) }}</NText>
                    <NText v-if="event.bytes !== null" depth="3" style="font-size:12px">{{ formatBytes(event.bytes) }}</NText>
                  </NSpace>
                  <pre class="na-code mt-2 max-h-[260px] overflow-auto whitespace-pre rounded p-3 text-xs text-zinc-300">{{ previewText(event) }}</pre>
                </div>
              </div>
            </NTabPane>
          </NTabs>
        </NCard>
      </NCard>
    </NSpin>
  </div>
</template>
