<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NAlert, NButton, NCard, NDataTable, NInput, NInputNumber, NPagination, NSelect, NSpace, NSpin, NTag, NText, useMessage,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import type { JiraConfigPublic, LocalAiConfigPublic, OpenAiConfigPublic, SessionAuditPublic } from '@nodeaccess/shared'
import SkeletonTable from '@/components/SkeletonTable.vue'
import { integrationService } from '@/services/integration.service'
import { sessionAuditService } from '@/services/sessionAudit.service'
import { settingsService, type SettingsData } from '@/services/settings.service'

const { t, locale } = useI18n()
const router = useRouter()
const route = useRoute()
const message = useMessage()

const rows = ref<SessionAuditPublic[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const error = ref<string | null>(null)
const settings = ref<SettingsData | null>(null)
const openAiConfig = ref<OpenAiConfigPublic | null>(null)
const localAiConfig = ref<LocalAiConfigPublic | null>(null)
const jiraConfig = ref<JiraConfigPublic | null>(null)

const search = ref('')
const ticketKey = ref('')
const minCommandCount = ref<number | null>(null)
const status = ref<string | undefined>(typeof route.query.status === 'string' ? route.query.status : undefined)
const aiState = ref<string | undefined>(undefined)
const hostState = ref<string | undefined>(undefined)
const queryAiRiskLevel = computed(() => typeof route.query.aiRiskLevel === 'string' ? route.query.aiRiskLevel : undefined)
const queryHostId = computed(() => {
  const value = Number(route.query.hostId)
  return Number.isFinite(value) && value > 0 ? value : undefined
})
const queryPeriodDays = computed(() => {
  const value = Number(route.query.periodDays)
  return [7, 15, 30, 60].includes(value) ? value : undefined
})
const hasDashboardFilter = computed(() => !!queryHostId.value || !!queryPeriodDays.value || !!queryAiRiskLevel.value || !!status.value)

const LIMIT = 20

function sessionStatusLabel(value: string) {
  return t(`admin.sessionAudit.statuses.${value}`, value)
}

function aiStateLabel(row: SessionAuditPublic) {
  return row.aiSummaryText || row.aiSummaryStructured
    ? t('admin.sessionAudit.ai.status.generated')
    : t('admin.sessionAudit.ai.status.none')
}

function formatDate(d: Date | string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleString(locale.value, {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function formatDuration(row: SessionAuditPublic) {
  const started = new Date(row.startedAt).getTime()
  const ended = row.endedAt ? new Date(row.endedAt).getTime() : Date.now()
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) return '—'

  const totalSeconds = Math.max(0, Math.floor((ended - started) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function formatBytes(value: number) {
  const n = value
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const statusOptions = computed(() => [
  { label: t('admin.sessionAudit.filters.allStatuses'), value: '' },
  { label: sessionStatusLabel('RUNNING'), value: 'RUNNING' },
  { label: sessionStatusLabel('COMPLETED'), value: 'COMPLETED' },
  { label: sessionStatusLabel('FAILED'), value: 'FAILED' },
  { label: sessionStatusLabel('PURGED'), value: 'PURGED' },
])
const aiStateOptions = computed(() => [
  { label: t('admin.sessionAudit.filters.allAiStates'), value: '' },
  { label: t('admin.sessionAudit.filters.withAi'), value: 'with-ai' },
  { label: t('admin.sessionAudit.filters.withoutAi'), value: 'without-ai' },
])
const hostStateOptions = computed(() => [
  { label: t('admin.sessionAudit.filters.allHostStates'), value: '' },
  { label: t('admin.sessionAudit.filters.activeHosts'), value: 'active' },
  { label: t('admin.sessionAudit.filters.deletedHosts'), value: 'deleted' },
])

function statusTagType(value: string) {
  if (value === 'COMPLETED') return 'success'
  if (value === 'FAILED') return 'error'
  if (value === 'RUNNING') return 'warning'
  return 'default'
}

function aiStatusTagType(value: SessionAuditPublic) {
  if (value.aiSummaryText || value.aiSummaryStructured) return 'success'
  return 'default'
}

function isAutomationAudit(row: SessionAuditPublic) {
  return row.connectionMethod === 'mcp_action_run' || row.routeSnapshot?.auditKind === 'ai_action_run'
}

const aiLicensed = computed(() => settings.value?.license.sessionAuditAiEnabled ?? false)
const openAiReady = computed(() =>
  !!openAiConfig.value?.enabled
  && !!openAiConfig.value?.hasApiKey
  && openAiConfig.value?.healthStatus !== 'unhealthy',
)
const localAiReady = computed(() =>
  !!localAiConfig.value?.enabled
  && resolveLocalAiProvider(localAiConfig.value) !== null
  && localAiConfig.value?.healthStatus !== 'unhealthy',
)
const aiReady = computed(() =>
  aiLicensed.value
  && (openAiReady.value || localAiReady.value),
)
const showTicketControls = computed(() =>
  !!jiraConfig.value?.enabled
  && !!jiraConfig.value?.hasApiToken
  && jiraConfig.value.healthStatus === 'healthy',
)
const showAiControls = computed(() => aiReady.value || rows.value.some((row) => !!row.aiSummaryText || !!row.aiSummaryStructured))
const aiHeaderTagType = computed(() => {
  if (aiReady.value) return 'success'
  if (aiLicensed.value) return 'warning'
  return 'default'
})
const aiHeaderLabel = computed(() => {
  if (aiReady.value) return t('admin.sessionAudit.ai.status.active')
  if (aiLicensed.value) return t('admin.sessionAudit.ai.status.unavailable')
  return t('admin.sessionAudit.ai.status.hidden')
})
const aiHeaderHint = computed(() => {
  if (aiReady.value) return t('admin.sessionAudit.ai.visibility.active')
  if (aiLicensed.value) return t('admin.sessionAudit.ai.visibility.integrationRequired')
  return t('admin.sessionAudit.ai.visibility.licenseRequired')
})

async function load() {
  loading.value = true
  error.value = null
  try {
    const [settingsResult, jiraResult] = await Promise.all([
      settingsService.get(),
      integrationService.getJira().catch(() => null),
    ])
    const settingsData = settingsResult.data
    jiraConfig.value = jiraResult?.data ?? null
    settings.value = settingsData

    const { data } = await sessionAuditService.list({
        search: search.value || undefined,
        ticketKey: showTicketControls.value ? ticketKey.value || undefined : undefined,
        status: status.value || undefined,
        aiState: (aiState.value as 'with-ai' | 'without-ai' | undefined) || undefined,
        hostState: (hostState.value as 'active' | 'deleted' | undefined) || undefined,
        aiRiskLevel: queryAiRiskLevel.value,
        hostId: queryHostId.value,
        periodDays: queryPeriodDays.value,
        minCommandCount: minCommandCount.value && minCommandCount.value > 0 ? Math.floor(minCommandCount.value) : undefined,
        page: page.value,
        limit: LIMIT,
    })
    rows.value = data.data
    total.value = data.total

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
  } catch {
    error.value = t('admin.sessionAudit.messages.loadError')
  } finally {
    loading.value = false
  }
}

function runSearch() {
  page.value = 1
  load()
}

async function downloadRow(row: SessionAuditPublic) {
  try {
    const { data } = await sessionAuditService.download(row.sessionId)
    sessionAuditService.saveBlobAs(data, `session-audit-${row.sessionId}.jsonl`)
  } catch {
    message.error(t('admin.sessionAudit.messages.downloadError'))
  }
}

function openDetail(row: SessionAuditPublic, tab?: 'playback') {
  router.push({
    name: 'admin-session-audit-detail',
    params: { sessionId: row.sessionId },
    query: tab ? { tab } : undefined,
  })
}

function rowProps(row: SessionAuditPublic) {
  return {
    class: 'cursor-pointer',
    onClick: () => openDetail(row),
  }
}

const columns = computed<DataTableColumns<SessionAuditPublic>>(() => [
  {
    title: 'Origem',
    key: 'source',
    width: 150,
    render: (row) => h(NTag, {
      size: 'small',
      type: isAutomationAudit(row) ? 'info' : 'default',
    }, () => isAutomationAudit(row) ? 'Automação IA/MCP' : 'Sessão interativa'),
  },
  {
    title: t('admin.sessionAudit.columns.session'),
    key: 'sessionId',
    width: 110,
    render: (row) => h(NButton, {
      text: true,
      type: 'primary',
      style: 'font-family:monospace;font-size:12px;padding:0',
      onClick: (event: MouseEvent) => {
        event.stopPropagation()
        openDetail(row)
      },
    }, () => `#${row.sessionId}`),
  },
  {
    title: t('admin.sessionAudit.columns.host'),
    key: 'host',
    minWidth: 190,
    render: (row) => h('div', [
      h(NText, { strong: true, style: 'display:block;font-size:13px' }, () => row.hostNameSnapshot),
      row.hostDeleted
        ? h(NTag, { size: 'small', type: 'warning', style: 'margin-top:4px;' }, () => t('hosts.messages.hostDeleted'))
        : null,
      h(NText, { depth: 3, style: 'display:block;font-size:11px' }, () => row.hostIpSnapshot),
    ]),
  },
  {
    title: t('admin.sessionAudit.columns.user'),
    key: 'user',
    minWidth: 190,
    render: (row) => h('div', [
      h(NText, { depth: 3, style: 'display:block;font-size:11px' }, () => row.userNameSnapshot || `user #${row.userId}`),
      h(NText, { depth: 3, style: 'display:block;font-size:11px' }, () => row.userEmailSnapshot ?? `user #${row.userId}`),
    ]),
  },
  ...(showTicketControls.value ? [{
    title: t('admin.sessionAudit.columns.ticket'),
    key: 'ticket',
    width: 140,
    render: (row: SessionAuditPublic) => h(NText, { depth: 3 }, () => row.ticketKey ?? '—'),
  }] : []),
  {
    title: t('admin.sessionAudit.columns.status'),
    key: 'status',
    width: 120,
    render: (row) => h(NTag, { type: statusTagType(row.status), size: 'small' }, () => sessionStatusLabel(row.status)),
  },
  ...(showAiControls.value ? [{
    title: t('admin.sessionAudit.columns.ai'),
    key: 'ai',
    width: 120,
    render: (row: SessionAuditPublic) => h(NTag, { type: aiStatusTagType(row), size: 'small' }, () => aiStateLabel(row)),
  }] : []),
  {
    title: t('admin.sessionAudit.columns.duration'),
    key: 'duration',
    width: 180,
    render: (row) => h('div', [
      h(NText, { strong: true, style: 'display:block;font-size:12px' }, () => formatDuration(row)),
      h(NText, { depth: 3, style: 'display:block;font-size:11px' }, () => `${t('admin.sessionAudit.fields.startedAt')}: ${formatDate(row.startedAt)}`),
      h(NText, { depth: 3, style: 'display:block;font-size:11px' }, () => `${t('admin.sessionAudit.fields.endedAt')}: ${formatDate(row.endedAt)}`),
    ]),
  },
  {
    title: t('admin.sessionAudit.columns.traffic'),
    key: 'traffic',
    width: 140,
    render: (row) => h('div', [
      h(NText, { depth: 3, style: 'display:block;font-size:11px' }, () => `in: ${formatBytes(row.bytesIn)}`),
      h(NText, { depth: 3, style: 'display:block;font-size:11px' }, () => `out: ${formatBytes(row.bytesOut)}`),
    ]),
  },
  {
    title: t('admin.sessionAudit.columns.commands'),
    key: 'commandCount',
    width: 110,
    render: (row) => h(NTag, { size: 'small', type: row.commandCount > 0 ? 'success' : 'default' }, () => String(row.commandCount)),
  },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 260,
    render: (row) => h(NSpace, { size: 8 }, {
      default: () => [
        !isAutomationAudit(row) ? h(NButton, {
          size: 'small',
          secondary: true,
          onClick: (event: MouseEvent) => {
            event.stopPropagation()
            openDetail(row, 'playback')
          },
        }, () => t('admin.sessionAudit.actions.playback')) : null,
        h(NButton, {
          size: 'small',
          secondary: true,
          onClick: (event: MouseEvent) => {
            event.stopPropagation()
            openDetail(row)
          },
        }, () => t('admin.sessionAudit.actions.view')),
        h(NButton, {
          size: 'small',
          secondary: true,
          onClick: (event: MouseEvent) => {
            event.stopPropagation()
            downloadRow(row)
          },
        }, () => t('common.download')),
      ],
    }),
  },
])

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
    <div class="mb-6">
      <h1 class="text-xl font-semibold text-white">{{ $t('admin.sessionAudit.title') }}</h1>
      <NText depth="3" class="text-sm">{{ $t('admin.sessionAudit.subtitle') }}</NText>
      <NTag v-if="hasDashboardFilter" size="small" type="info" class="mt-3">
        Filtro do dashboard do host
      </NTag>
      <NButton class="mt-3" secondary type="info" @click="router.push({ name: 'admin-ai-investigations' })">Ver investigações IA/MCP</NButton>
      <div v-if="showAiControls" class="mt-3">
        <NSpace align="center" size="small">
          <NTag size="small" :type="aiHeaderTagType">{{ aiHeaderLabel }}</NTag>
          <NText depth="3" class="text-sm">{{ aiHeaderHint }}</NText>
        </NSpace>
      </div>
    </div>

    <NCard embedded :bordered="false" class="na-card">
      <NSpace align="center" wrap class="mb-4">
        <NInput
          v-model:value="search"
          :placeholder="showTicketControls ? $t('admin.sessionAudit.filters.searchPlaceholder') : $t('admin.sessionAudit.filters.searchWithoutTicketPlaceholder')"
          clearable
          style="width: 260px"
          @keyup.enter="runSearch"
        />
        <NInput
          v-if="showTicketControls"
          v-model:value="ticketKey"
          :placeholder="$t('admin.sessionAudit.filters.ticketPlaceholder')"
          clearable
          style="width: 180px"
          @keyup.enter="runSearch"
        />
        <NSelect
          v-model:value="status"
          :options="statusOptions"
          style="width: 180px"
          :placeholder="$t('admin.sessionAudit.filters.allStatuses')"
          clearable
        />
        <NSelect
          v-if="showAiControls"
          v-model:value="aiState"
          :options="aiStateOptions"
          style="width: 180px"
          :placeholder="$t('admin.sessionAudit.filters.allAiStates')"
          clearable
        />
        <NSelect
          v-model:value="hostState"
          :options="hostStateOptions"
          style="width: 180px"
          :placeholder="$t('admin.sessionAudit.filters.allHostStates')"
          clearable
        />
        <NInputNumber
          v-model:value="minCommandCount"
          :min="0"
          :precision="0"
          clearable
          style="width: 190px"
          :placeholder="$t('admin.sessionAudit.filters.minCommandCountPlaceholder')"
          @keyup.enter="runSearch"
        />
        <NButton @click="runSearch">{{ $t('common.search') }}</NButton>
      </NSpace>

      <NAlert v-if="error" type="error" class="mb-4">{{ error }}</NAlert>

      <SkeletonTable v-if="loading && rows.length === 0" :rows="8" :columns="8" />

      <NSpin :show="loading">
        <NDataTable
          :columns="columns"
          :data="rows"
          :row-props="rowProps"
          :pagination="false"
          :bordered="false"
          striped
          scroll-x="1300"
        />
      </NSpin>

      <div class="flex justify-end mt-4">
        <NPagination
          v-model:page="page"
          :page-size="LIMIT"
          :item-count="total"
          @update:page="load"
        />
      </div>
    </NCard>
  </div>
</template>
