<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NAlert, NButton, NCard, NDataTable, NEmpty, NInput, NPagination, NSelect, NSpin, NTag, NText, type DataTableColumns } from 'naive-ui'
import { reportsService, type ClientUxEvent, type ClientUxReport } from '@/services/reports.service'

const LIMIT = 30

const router = useRouter()
const loading = ref(true)
const error = ref<string | null>(null)
const report = ref<ClientUxReport | null>(null)
const periodDays = ref(30)
const search = ref('')
const action = ref<string | undefined>(undefined)
const userId = ref('')
const page = ref(1)

const periodOptions = [
  { label: '7 dias', value: 7 },
  { label: '15 dias', value: 15 },
  { label: '30 dias', value: 30 },
  { label: '60 dias', value: 60 },
  { label: '90 dias', value: 90 },
]

const actionOptions = [
  { label: 'Todos os eventos', value: '' },
  { label: 'Sessão expirada', value: 'CLIENT_UX_SESSION_EXPIRED' },
  { label: 'Sessão expirada no terminal', value: 'CLIENT_UX_SESSION_EXPIRED_TERMINAL' },
  { label: 'Reload recuperado', value: 'CLIENT_UX_STALE_RELOAD_RECOVERED' },
  { label: 'Reload falhou', value: 'CLIENT_UX_STALE_RELOAD_FAILED' },
]

const summaryCards = computed(() => {
  const summary = report.value?.summary
  return [
    { label: 'Eventos', value: summary?.totalEvents ?? 0 },
    { label: 'Sessões expiradas', value: summary?.sessionExpired ?? 0 },
    { label: 'Expiradas no terminal', value: summary?.sessionExpiredTerminal ?? 0 },
    { label: 'Reloads recuperados', value: summary?.staleReloadRecovered ?? 0 },
    { label: 'Reloads falhos', value: summary?.staleReloadFailed ?? 0 },
    { label: 'Usuários impactados', value: summary?.uniqueUsers ?? 0 },
  ]
})

const dailyTotals = computed(() => {
  const map = new Map<string, number>()
  for (const row of report.value?.daily ?? []) {
    const date = normalizeDayKey(row.date)
    map.set(date, (map.get(date) ?? 0) + row.count)
  }
  return [...map.entries()].map(([date, count]) => ({ date, count }))
})

const maxDailyTotal = computed(() => Math.max(1, ...dailyTotals.value.map((row) => row.count)))

function formatDate(value: string | Date) {
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function normalizeDayKey(value: string | Date) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function formatDay(value: string | Date) {
  const dateKey = normalizeDayKey(value)
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  })
}

function actionLabel(value: string) {
  const found = actionOptions.find((item) => item.value === value)
  return found?.label ?? value
}

function actionTagType(value: string): 'default' | 'success' | 'warning' | 'error' | 'info' {
  if (value === 'CLIENT_UX_STALE_RELOAD_FAILED') return 'error'
  if (value === 'CLIENT_UX_STALE_RELOAD_RECOVERED') return 'success'
  if (value === 'CLIENT_UX_SESSION_EXPIRED_TERMINAL') return 'warning'
  if (value === 'CLIENT_UX_SESSION_EXPIRED') return 'info'
  return 'default'
}

function detailsText(value: string | null) {
  if (!value) return '—'
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    return Object.entries(parsed)
      .map(([key, val]) => `${key}: ${String(val)}`)
      .join(' • ')
  } catch {
    return value
  }
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const { data } = await reportsService.getClientUx({
      periodDays: periodDays.value,
      search: search.value.trim() || undefined,
      status: action.value || undefined,
      userId: userId.value.trim() ? Number(userId.value) : undefined,
      page: page.value,
      limit: LIMIT,
    })
    report.value = data
  } catch {
    error.value = 'Não foi possível carregar o relatório de UX do cliente.'
  } finally {
    loading.value = false
  }
}

function searchReport() {
  page.value = 1
  load()
}

const eventColumns: DataTableColumns<ClientUxEvent> = [
  {
    title: 'Quando',
    key: 'timestamp',
    width: 150,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px;font-family:monospace' }, () => formatDate(row.timestamp)),
  },
  {
    title: 'Usuário',
    key: 'user',
    width: 220,
    render: (row) => h('div', [
      h(NText, { strong: true }, () => row.userName),
      h(NText, { depth: 3, style: 'display:block;font-size:11px' }, () => row.userEmail),
    ]),
  },
  {
    title: 'Evento',
    key: 'action',
    width: 230,
    render: (row) => h(NTag, { type: actionTagType(row.action), size: 'small' }, () => actionLabel(row.action)),
  },
  {
    title: 'Detalhes',
    key: 'details',
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px' }, () => detailsText(row.details)),
  },
]

onMounted(load)
</script>

<template>
  <div class="p-6">
    <div class="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <NButton text size="small" style="color:#9ca3af;margin-bottom:10px" @click="router.push({ name: 'admin-reports' })">
          Voltar para relatórios
        </NButton>
        <h1 class="text-xl font-semibold text-white">Relatório de UX do cliente</h1>
        <NText depth="3" class="text-sm">Sessões expiradas, reloads e falhas percebidas pelo usuário.</NText>
      </div>
      <NButton size="small" ghost @click="load">Atualizar</NButton>
    </div>

    <NAlert v-if="error" type="error" :title="error" class="mb-4" />

    <NCard :bordered="false" class="na-card mb-4">
      <div class="flex flex-wrap gap-3">
        <NSelect v-model:value="periodDays" :options="periodOptions" style="width: 130px" @update:value="searchReport" />
        <NInput v-model:value="search" placeholder="Buscar usuário, evento ou detalhe" clearable style="width: 300px" @keyup.enter="searchReport" />
        <NSelect v-model:value="action" :options="actionOptions" style="width: 230px" @update:value="searchReport" />
        <NInput v-model:value="userId" placeholder="Usuário ID" clearable style="width: 120px" @keyup.enter="searchReport" />
        <NButton type="primary" @click="searchReport">Buscar</NButton>
      </div>
    </NCard>

    <NSpin :show="loading">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div v-for="card in summaryCards" :key="card.label" class="na-item rounded-lg border px-4 py-3">
          <div class="text-xs uppercase tracking-[0.18em] text-gray-500">{{ card.label }}</div>
          <div class="mt-1 text-3xl font-semibold text-white">{{ card.value }}</div>
        </div>
      </div>

      <div class="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <NCard :bordered="false" class="na-card" title="Eventos por tipo">
          <NEmpty v-if="!report?.byAction.length" description="Sem eventos no período." class="py-6" />
          <div v-else class="space-y-3">
            <div v-for="item in report.byAction" :key="item.action" class="na-item rounded-lg border px-4 py-3">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0 truncate text-sm font-medium text-white">{{ actionLabel(item.action) }}</div>
                <NTag size="small" :type="actionTagType(item.action)">{{ item.count }} eventos</NTag>
              </div>
            </div>
          </div>
        </NCard>

        <NCard :bordered="false" class="na-card" title="Usuários mais impactados">
          <NEmpty v-if="!report?.topUsers.length" description="Sem usuários no período." class="py-6" />
          <div v-else class="space-y-3">
            <div v-for="item in report.topUsers" :key="item.userId" class="na-item rounded-lg border px-4 py-3">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium text-white">{{ item.userName }}</div>
                  <div class="truncate text-xs text-gray-500">{{ item.userEmail }} • último evento {{ formatDate(item.lastEventAt) }}</div>
                </div>
                <NTag size="small" type="info">{{ item.count }} eventos</NTag>
              </div>
            </div>
          </div>
        </NCard>
      </div>

      <NCard :bordered="false" class="na-card mt-4" title="Linha do tempo">
        <NEmpty v-if="!dailyTotals.length" description="Sem eventos no período." class="py-6" />
        <div v-else class="flex h-40 items-end gap-2">
          <div v-for="day in dailyTotals" :key="day.date" class="flex min-w-8 flex-1 flex-col items-center gap-2">
            <div class="text-[11px] text-gray-500">{{ day.count }}</div>
            <div class="w-full rounded-t bg-blue-500/80" :style="{ height: `${Math.max(8, (day.count / maxDailyTotal) * 112)}px` }" />
            <div class="text-[11px] text-gray-500">{{ formatDay(day.date) }}</div>
          </div>
        </div>
      </NCard>

      <NCard :bordered="false" class="na-card mt-4" title="Eventos">
        <NDataTable :columns="eventColumns" :data="report?.events.data ?? []" :row-key="(row: ClientUxEvent) => row.id" :bordered="false" size="small" />
        <div v-if="(report?.events.total ?? 0) > LIMIT" class="mt-4 flex justify-end">
          <NPagination
            v-model:page="page"
            :page-count="Math.ceil((report?.events.total ?? 0) / LIMIT)"
            :page-slot="5"
            @update:page="load"
          />
        </div>
      </NCard>
    </NSpin>
  </div>
</template>
