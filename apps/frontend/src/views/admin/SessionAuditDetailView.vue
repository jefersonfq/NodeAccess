<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NAlert, NButton, NCard, NDescriptions, NDescriptionsItem, NInput, NSelect, NSpace, NSpin,
  NTabPane, NTabs, NTag, NText, useMessage,
} from 'naive-ui'
import type { JiraConfigPublic, JiraTicketPublic, OpenAiConfigPublic, SessionAuditAiArtifactPublic, SessionAuditAiJobPublic, SessionAuditCommand, SessionAuditPreviewEvent, SessionAuditPublic } from '@nodeaccess/shared'
import { integrationService } from '@/services/integration.service'
import { sessionAuditService } from '@/services/sessionAudit.service'
import { settingsService, type SettingsData } from '@/services/settings.service'

type SessionAuditAiPromptTemplate = 'summary-v1' | 'cab-v1' | 'risk-v1'

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
const jobsLoading = ref(false)
const artifactsLoading = ref(false)
const retryingSummary = ref(false)
const jobs = ref<SessionAuditAiJobPublic[]>([])
const artifacts = ref<SessionAuditAiArtifactPublic[]>([])
const settings = ref<SettingsData | null>(null)
const openAiConfig = ref<OpenAiConfigPublic | null>(null)
const jiraConfig = ref<JiraConfigPublic | null>(null)
const jiraTicket = ref<JiraTicketPublic | null>(null)
const jiraTicketLoading = ref(false)
const linkTicketKey = ref('')
const linkingTicket = ref(false)
const commandSearch = ref('')
const previewSearch = ref('')
const selectedTemplate = ref<SessionAuditAiPromptTemplate>('summary-v1')

const sessionId = computed(() => Number(route.params.sessionId))
const sharedContext = computed(() => row.value?.sharedSessionContext ?? null)
const filteredCommands = computed(() => {
  const term = commandSearch.value.trim().toLowerCase()
  if (!term) return commands.value
  return commands.value.filter((command) =>
    command.command.toLowerCase().includes(term)
    || command.output.toLowerCase().includes(term),
  )
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
const hasAiContent = computed(() =>
  !!row.value && (
    !!row.value.aiSummaryStructured
    || !!row.value.aiSummaryText
    || artifacts.value.length > 0
    || jobs.value.length > 0
  ),
)
const aiLicensed = computed(() => settings.value?.license.sessionAuditAiEnabled ?? false)
const aiIntegrationEnabled = computed(() =>
  aiLicensed.value
  && !!openAiConfig.value?.enabled
  && !!openAiConfig.value?.hasApiKey,
)
const aiReadyForActions = computed(() =>
  aiIntegrationEnabled.value && openAiConfig.value?.healthStatus !== 'unhealthy',
)
const showAiSection = computed(() => hasAiContent.value || aiLicensed.value)
const jiraReady = computed(() =>
  !!jiraConfig.value?.enabled
  && !!jiraConfig.value?.hasApiToken
  && jiraConfig.value.healthStatus === 'healthy',
)
const aiUnavailableMessage = computed(() => {
  if (!aiLicensed.value) return t('admin.sessionAudit.ai.visibility.licenseRequired')
  if (!openAiConfig.value?.enabled || !openAiConfig.value?.hasApiKey) {
    return t('admin.sessionAudit.ai.visibility.integrationRequired')
  }
  if (openAiConfig.value.healthStatus === 'unhealthy') {
    return openAiConfig.value.healthMessage || t('admin.sessionAudit.ai.visibility.integrationUnhealthy')
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
    const [{ data: detail }, { data: previewData }, { data: commandData }, { data: jobsData }, { data: artifactsData }, { data: settingsData }] = await Promise.all([
      sessionAuditService.getBySessionId(sessionId.value),
      sessionAuditService.preview(sessionId.value, 200),
      sessionAuditService.commands(sessionId.value, 100),
      sessionAuditService.jobs(sessionId.value),
      sessionAuditService.artifacts(sessionId.value),
      settingsService.get(),
    ])
    row.value = detail
    preview.value = previewData
    commands.value = commandData
    jobs.value = jobsData
    artifacts.value = artifactsData
    settings.value = settingsData

    if (settingsData.license.sessionAuditAiEnabled) {
      try {
        const { data } = await integrationService.getOpenAi()
        openAiConfig.value = data
      } catch {
        openAiConfig.value = null
      }
    } else {
      openAiConfig.value = null
    }

    try {
      const { data } = await integrationService.getJira()
      jiraConfig.value = data
    } catch {
      jiraConfig.value = null
    }

    jiraTicket.value = null
    linkTicketKey.value = detail.ticketKey ?? ''
    if (detail.ticketProvider?.toLowerCase() === 'jira' && detail.ticketKey) {
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
  } catch {
    message.error(t('admin.sessionAudit.messages.retryError'))
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
    const { data } = await sessionAuditService.commands(sessionId.value, 100)
    commands.value = data
  } finally {
    commandsLoading.value = false
  }
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
</script>

<template>
  <div class="p-8 max-w-5xl">
    <NSpace justify="space-between" align="center" class="mb-6">
      <div>
        <h1 class="text-2xl font-semibold text-white">
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
      <NCard v-if="row" embedded :bordered="false" style="background:#17171c;">
        <NDescriptions label-placement="top" :column="3" bordered>
          <NDescriptionsItem :label="$t('admin.sessionAudit.columns.status')">
            <NTag :type="statusTagType(row.status)" size="small">{{ sessionStatusLabel(row.status) }}</NTag>
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('admin.sessionAudit.columns.ticket')">
            {{ row.ticketKey ?? '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('admin.sessionAudit.fields.connectionMethod')">
            {{ row.connectionMethod }}
          </NDescriptionsItem>

          <NDescriptionsItem :label="$t('common.user')">
            <div>{{ row.userNameSnapshot || `#${row.userId}` }}</div>
            <div class="text-xs text-zinc-400">{{ row.userEmailSnapshot ?? `#${row.userId}` }}</div>
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('common.name')">
            {{ row.hostNameSnapshot }}
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
          <NDescriptionsItem v-if="showAiSection" :label="$t('admin.sessionAudit.fields.aiSummaryStatus')">
            {{ aiSummaryStatusLabel(row.aiSummaryStatus) }}
          </NDescriptionsItem>
          <NDescriptionsItem v-else />

          <NDescriptionsItem v-if="showAiSection" :label="$t('admin.sessionAudit.fields.aiRiskLevel')">
            {{ row.aiRiskLevel ? aiRiskLabel(row.aiRiskLevel) : '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem v-else />
          <NDescriptionsItem :label="$t('admin.sessionAudit.fields.ticketProvider')">
            {{ row.ticketProvider ?? '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('admin.sessionAudit.fields.ticketUrl')">
            <a
              v-if="row.ticketUrl"
              :href="row.ticketUrl"
              target="_blank"
              rel="noreferrer"
              class="text-sky-400 hover:text-sky-300"
            >
              {{ row.ticketUrl }}
            </a>
            <span v-else>—</span>
          </NDescriptionsItem>
        </NDescriptions>

        <NCard
          v-if="sharedContext"
          embedded
          class="mt-4"
          style="background:#111115;"
        >
          <NSpace justify="space-between" align="center">
            <NText strong>{{ $t('admin.sessionAudit.shared.title') }}</NText>
            <NTag size="small" :type="sharedSessionStatusTagType(sharedContext.status)">
              {{ $t(`admin.sessionAudit.shared.statuses.${sharedContext.status}`) }}
            </NTag>
          </NSpace>

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
                class="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2"
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
                class="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2"
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
        </NCard>

        <NCard
          v-if="jiraReady"
          embedded
          class="mt-4"
          style="background:#111115;"
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

        <NCard
          v-if="row.ticketProvider?.toLowerCase() === 'jira' && row.ticketKey"
          embedded
          class="mt-4"
          style="background:#111115;"
        >
          <NSpace justify="space-between" align="center">
            <NText strong>{{ $t('admin.sessionAudit.ticketSnapshot.title') }}</NText>
            <NTag size="small" type="info">{{ row.ticketKey }}</NTag>
          </NSpace>

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
            {{ $t('admin.sessionAudit.ticketSnapshot.unavailable') }}
          </div>
        </NCard>

        <NAlert
          v-if="showAiSection && aiUnavailableMessage"
          type="warning"
          class="mt-4"
        >
          {{ aiUnavailableMessage }}
        </NAlert>

        <NCard v-if="hasAiContent && (row.aiSummaryStructured || row.aiSummaryText)" embedded class="mt-4" style="background:#111115;">
          <NSpace justify="space-between" align="center">
            <NText strong>{{ $t('admin.sessionAudit.fields.aiSummaryText') }}</NText>
            <NSpace v-if="row.aiSummaryStructured" align="center" size="small">
              <NTag size="small" :type="aiSummaryTagType(row.aiSummaryStructured.riskLevel)">{{ aiRiskLabel(row.aiSummaryStructured.riskLevel) }}</NTag>
              <NTag size="small">{{ confidenceLabel(row.aiSummaryStructured.confidence) }}</NTag>
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

        <NCard v-if="hasAiContent" embedded class="mt-4" style="background:#111115;">
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
              class="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3"
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
        </NCard>

        <NCard v-if="showAiSection" embedded class="mt-4" style="background:#111115;">
          <NSpace justify="space-between" align="center">
            <NText strong>{{ $t('admin.sessionAudit.aiJobs.title') }}</NText>
            <NSpace>
              <NSelect
                v-model:value="selectedTemplate"
                size="small"
                style="width: 210px"
                :options="templateOptions"
              />
              <NButton size="small" secondary :loading="jobsLoading" @click="refreshJobs">
                {{ $t('admin.sessionAudit.aiJobs.refresh') }}
              </NButton>
              <NButton
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
              class="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3"
            >
              <NSpace align="center" size="small">
                <NTag size="small">{{ triggerSourceLabel(job.triggerSource) }}</NTag>
                <NTag size="small" :type="aiJobStatusTagType(job.status)">{{ aiSummaryStatusLabel(job.status) }}</NTag>
                <span class="font-mono text-xs text-zinc-500">{{ job.provider }}{{ job.model ? ` · ${job.model}` : '' }}</span>
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
        </NCard>

        <NCard embedded class="mt-4" style="background:#111115;">
          <NTabs type="line" animated>
            <NTabPane name="commands" :tab="$t('admin.sessionAudit.tabs.commands')">
              <NSpace justify="space-between" align="center">
                <NText strong>{{ $t('admin.sessionAudit.commands.title') }}</NText>
                <NSpace>
                  <NInput
                    v-model:value="commandSearch"
                    clearable
                    size="small"
                    style="width: 260px"
                    :placeholder="$t('admin.sessionAudit.commands.searchPlaceholder')"
                  />
                  <NButton size="small" secondary :loading="commandsLoading" @click="refreshCommands">
                    {{ $t('admin.sessionAudit.commands.refresh') }}
                  </NButton>
                </NSpace>
              </NSpace>

              <div v-if="filteredCommands.length === 0 && !commandsLoading" class="mt-4 text-sm text-zinc-400">
                {{ $t('admin.sessionAudit.commands.empty') }}
              </div>

              <div v-else class="mt-4 space-y-4">
                <div
                  v-for="group in groupedCommands"
                  :key="group.key"
                  class="rounded-xl border border-zinc-800 bg-zinc-950/50 p-3"
                >
                  <div class="mb-3 flex items-center justify-between gap-3 border-b border-zinc-800 pb-3">
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
                      class="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3"
                    >
                      <NSpace align="center" size="small">
                        <NTag size="small" type="primary">#{{ command.index }}</NTag>
                        <NTag size="small" :type="group.role === 'owner' ? 'warning' : 'info'">
                          {{ group.label }}
                        </NTag>
                        <NTag size="small" :type="commandConfidenceTagType(command.confidence)">{{ confidenceLabel(command.confidence) }}</NTag>
                        <NText depth="3" style="font-size:12px">{{ formatDate(command.submittedAt) }}</NText>
                      </NSpace>

                      <div class="mt-3">
                        <NText depth="3" style="font-size:12px">{{ $t('admin.sessionAudit.commands.command') }}</NText>
                        <pre class="mt-1 overflow-x-auto whitespace-pre rounded bg-zinc-900 p-3 font-mono text-xs text-emerald-300">{{ command.command }}</pre>
                      </div>

                      <div class="mt-3">
                        <NText depth="3" style="font-size:12px">{{ $t('admin.sessionAudit.commands.output') }}</NText>
                        <pre class="mt-1 whitespace-pre-wrap break-words rounded bg-zinc-900 p-3 text-xs text-zinc-300">{{ command.output || '—' }}</pre>
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
                  class="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3"
                >
                  <NSpace align="center" size="small">
                    <NTag size="small" :type="previewTagType(event.type)">{{ previewEventLabel(event.type) }}</NTag>
                    <NText depth="3" style="font-family:monospace;font-size:12px">#{{ event.seq }}</NText>
                    <NText depth="3" style="font-size:12px">{{ formatDate(event.timestamp) }}</NText>
                    <NText v-if="event.bytes !== null" depth="3" style="font-size:12px">{{ formatBytes(event.bytes) }}</NText>
                  </NSpace>
                  <pre class="mt-2 whitespace-pre-wrap break-words text-xs text-zinc-300">{{ previewText(event) }}</pre>
                </div>
              </div>
            </NTabPane>
          </NTabs>
        </NCard>
      </NCard>
    </NSpin>
  </div>
</template>
