<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NAlert, NButton, NCard, NDataTable, NInput, NPagination, NSelect, NSpace, NSpin, NTag, NText, useMessage,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import type { LocalAiConfigPublic, OpenAiConfigPublic, SessionAuditPublic } from '@nodeaccess/shared'
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

const search = ref('')
const ticketKey = ref('')
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
    const [{ data }, { data: settingsData }] = await Promise.all([
      sessionAuditService.list({
        search: search.value || undefined,
        ticketKey: ticketKey.value || undefined,
        status: status.value || undefined,
        aiState: (aiState.value as 'with-ai' | 'without-ai' | undefined) || undefined,
        hostState: (hostState.value as 'active' | 'deleted' | undefined) || undefined,
        aiRiskLevel: queryAiRiskLevel.value,
        hostId: queryHostId.value,
        periodDays: queryPeriodDays.value,
        page: page.value,
        limit: LIMIT,
      }),
      settingsService.get(),
    ])
    rows.value = data.data
    total.value = data.total
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

function openDetail(row: SessionAuditPublic) {
  router.push({ name: 'admin-session-audit-detail', params: { sessionId: row.sessionId } })
}

const columns = computed<DataTableColumns<SessionAuditPublic>>(() => [
  {
    title: t('admin.sessionAudit.columns.session'),
    key: 'sessionId',
    width: 110,
    render: (row) => h(NButton, {
      text: true,
      type: 'primary',
      style: 'font-family:monospace;font-size:12px;padding:0',
      onClick: () => openDetail(row),
    }, () => `#${row.sessionId}`),
  },
  {
    title: t('admin.sessionAudit.columns.userHost'),
    key: 'userHost',
    minWidth: 240,
    render: (row) => h('div', [
      h(NText, { strong: true, style: 'display:block;font-size:13px' }, () => row.hostNameSnapshot),
      row.hostDeleted
        ? h(NTag, { size: 'small', type: 'warning', style: 'margin-top:4px;' }, () => t('hosts.messages.hostDeleted'))
        : null,
      h(NText, { depth: 3, style: 'display:block;font-size:11px' }, () => row.hostIpSnapshot),
      h(NText, { depth: 3, style: 'display:block;font-size:11px' }, () => row.userNameSnapshot || `user #${row.userId}`),
      h(NText, { depth: 3, style: 'display:block;font-size:11px' }, () => row.userEmailSnapshot ?? `user #${row.userId}`),
    ]),
  },
  {
    title: t('admin.sessionAudit.columns.ticket'),
    key: 'ticket',
    width: 140,
    render: (row) => h(NText, { depth: 3 }, () => row.ticketKey ?? '—'),
  },
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
    title: t('admin.sessionAudit.columns.startedAt'),
    key: 'startedAt',
    width: 160,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px' }, () => formatDate(row.startedAt)),
  },
  {
    title: t('admin.sessionAudit.columns.endedAt'),
    key: 'endedAt',
    width: 160,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px' }, () => formatDate(row.endedAt)),
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
    title: t('admin.sessionAudit.columns.chunks'),
    key: 'chunkCount',
    width: 90,
  },
  {
    title: t('common.actions'),
    key: 'actions',
    width: 180,
    render: (row) => h(NSpace, { size: 8 }, {
      default: () => [
        h(NButton, {
          size: 'small',
          secondary: true,
          onClick: () => openDetail(row),
        }, () => t('admin.sessionAudit.actions.view')),
        h(NButton, {
          size: 'small',
          secondary: true,
          onClick: () => downloadRow(row),
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
  <div class="p-8 max-w-7xl">
    <div class="mb-6">
      <h1 class="text-2xl font-semibold text-white">{{ $t('admin.sessionAudit.title') }}</h1>
      <NText depth="3" class="text-sm">{{ $t('admin.sessionAudit.subtitle') }}</NText>
      <NTag v-if="hasDashboardFilter" size="small" type="info" class="mt-3">
        Filtro do dashboard do host
      </NTag>
      <div v-if="showAiControls" class="mt-3">
        <NSpace align="center" size="small">
          <NTag size="small" :type="aiHeaderTagType">{{ aiHeaderLabel }}</NTag>
          <NText depth="3" class="text-sm">{{ aiHeaderHint }}</NText>
        </NSpace>
      </div>
    </div>

    <NCard embedded :bordered="false" style="background:#17171c;">
      <NSpace align="center" wrap class="mb-4">
        <NInput
          v-model:value="search"
          :placeholder="$t('admin.sessionAudit.filters.searchPlaceholder')"
          clearable
          style="width: 260px"
          @keyup.enter="runSearch"
        />
        <NInput
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
        <NButton @click="runSearch">{{ $t('common.search') }}</NButton>
      </NSpace>

      <NAlert v-if="error" type="error" class="mb-4">{{ error }}</NAlert>

      <SkeletonTable v-if="loading && rows.length === 0" :rows="8" :columns="8" />

      <NSpin :show="loading">
        <NDataTable
          :columns="columns"
          :data="rows"
          :pagination="false"
          :bordered="false"
          striped
          scroll-x="1400"
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
