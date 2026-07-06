<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NCard, NDataTable, NEmpty, NInput, NPagination, NSelect, NSpin, NTag, NText, type DataTableColumns } from 'naive-ui'
import { reportsService, type HostKeyEvent, type HostKeyReport } from '@/services/reports.service'

const LIMIT = 30

const route = useRoute()
const router = useRouter()
const loading = ref(true)
const error = ref<string | null>(null)
const report = ref<HostKeyReport | null>(null)
const initialPeriodDays = Number(route.query.periodDays)
const initialAction = typeof route.query.status === 'string'
  ? route.query.status
  : typeof route.query.action === 'string'
    ? route.query.action
    : undefined
const periodDays = ref([1, 7, 15, 30, 60, 90].includes(initialPeriodDays) ? initialPeriodDays : 30)
const search = ref(typeof route.query.search === 'string' ? route.query.search : '')
const action = ref<string | undefined>(initialAction)
const userId = ref(typeof route.query.userId === 'string' ? route.query.userId : '')
const hostId = ref(typeof route.query.hostId === 'string' ? route.query.hostId : '')
const page = ref(1)

const periodOptions = [
  { label: 'Hoje', value: 1 },
  { label: '7 dias', value: 7 },
  { label: '15 dias', value: 15 },
  { label: '30 dias', value: 30 },
  { label: '60 dias', value: 60 },
  { label: '90 dias', value: 90 },
]

const actionOptions = [
  { label: 'Todos os eventos', value: '' },
  { label: 'Primeira confiança', value: 'HOST_KEY_TRUSTED' },
  { label: 'Host key atualizada', value: 'HOST_KEY_UPDATED' },
]

const summaryCards = computed(() => {
  const summary = report.value?.summary
  return [
    { label: 'Hosts monitorados', value: summary?.totalHosts ?? 0 },
    { label: 'Com host key confiada', value: summary?.trustedHosts ?? 0 },
    { label: 'Sem host key confiada', value: summary?.missingHosts ?? 0, warning: (summary?.missingHosts ?? 0) > 0 },
    { label: 'Primeiras confianças', value: summary?.trustedEvents ?? 0 },
    { label: 'Atualizações', value: summary?.updatedEvents ?? 0, warning: (summary?.updatedEvents ?? 0) > 0 },
    { label: 'Hosts com eventos', value: summary?.uniqueHostsWithEvents ?? 0 },
  ]
})

function formatDate(value: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function actionLabel(value: string) {
  if (value === 'HOST_KEY_TRUSTED') return 'Primeira confiança'
  if (value === 'HOST_KEY_UPDATED') return 'Host key atualizada'
  return value
}

function actionTagType(value: string): 'default' | 'success' | 'warning' | 'error' | 'info' {
  if (value === 'HOST_KEY_UPDATED') return 'warning'
  if (value === 'HOST_KEY_TRUSTED') return 'info'
  return 'default'
}

function fingerprint(value: string | null) {
  return value || '-'
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const { data } = await reportsService.getHostKeys({
      periodDays: periodDays.value,
      search: search.value.trim() || undefined,
      status: action.value || undefined,
      userId: userId.value.trim() ? Number(userId.value) : undefined,
      hostId: hostId.value.trim() ? Number(hostId.value) : undefined,
      page: page.value,
      limit: LIMIT,
    })
    report.value = data
  } catch {
    error.value = 'Não foi possível carregar o relatório de host keys.'
  } finally {
    loading.value = false
  }
}

function searchReport() {
  page.value = 1
  load()
}

const eventColumns: DataTableColumns<HostKeyEvent> = [
  {
    title: 'Quando',
    key: 'timestamp',
    width: 150,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px;font-family:monospace' }, () => formatDate(row.timestamp)),
  },
  {
    title: 'Evento',
    key: 'action',
    width: 170,
    render: (row) => h(NTag, { type: actionTagType(row.action), size: 'small' }, () => actionLabel(row.action)),
  },
  {
    title: 'Host',
    key: 'host',
    width: 240,
    render: (row) => h('div', [
      h(NText, { strong: true }, () => row.hostName ?? `Host #${row.hostId ?? '-'}`),
      h(NText, { depth: 3, style: 'display:block;font-size:11px;font-family:monospace' }, () => `${row.hostIp ?? '-'}:${row.hostPort ?? '-'}`),
      row.hostDeleted ? h(NTag, { size: 'small', type: 'warning', style: 'margin-top:4px' }, () => 'Host excluído') : null,
    ]),
  },
  {
    title: 'Escopo',
    key: 'scope',
    width: 110,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px' }, () => row.hostScope ?? '-'),
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
    title: 'Fingerprints',
    key: 'fingerprints',
    render: (row) => h('div', { style: 'font-size:11px;font-family:monospace;white-space:normal;line-height:1.55' }, [
      h('div', [h('span', { style: 'color:#9ca3af' }, 'Anterior: '), fingerprint(row.previousFingerprint)]),
      h('div', [h('span', { style: 'color:#9ca3af' }, 'Nova: '), fingerprint(row.nextFingerprint)]),
      h('div', [h('span', { style: 'color:#9ca3af' }, 'Atual: '), fingerprint(row.currentFingerprint)]),
    ]),
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
        <h1 class="text-xl font-semibold text-white">Relatório de host keys</h1>
        <NText depth="3" class="text-sm">Auditoria de confiança e alterações de host key por host, IP, usuário e período.</NText>
      </div>
      <NButton size="small" ghost @click="load">Atualizar</NButton>
    </div>

    <NAlert v-if="error" type="error" :title="error" class="mb-4" />

    <NCard :bordered="false" class="na-card mb-4">
      <div class="flex flex-wrap gap-3">
        <NSelect v-model:value="periodDays" :options="periodOptions" style="width: 130px" @update:value="searchReport" />
        <NInput v-model:value="search" placeholder="Buscar host, IP, usuário ou fingerprint" clearable style="width: 320px" @keyup.enter="searchReport" />
        <NSelect v-model:value="action" :options="actionOptions" style="width: 190px" @update:value="searchReport" />
        <NInput v-model:value="userId" placeholder="Usuário ID" clearable style="width: 120px" @keyup.enter="searchReport" />
        <NInput v-model:value="hostId" placeholder="Host ID" clearable style="width: 120px" @keyup.enter="searchReport" />
        <NButton type="primary" @click="searchReport">Buscar</NButton>
      </div>
    </NCard>

    <NSpin :show="loading">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div v-for="card in summaryCards" :key="card.label" class="na-item rounded-lg border px-4 py-3">
          <div class="text-xs uppercase tracking-[0.18em] text-gray-500">{{ card.label }}</div>
          <div class="mt-1 text-3xl font-semibold" :class="card.warning ? 'text-amber-300' : 'text-white'">{{ card.value }}</div>
        </div>
      </div>

      <NCard :bordered="false" class="na-card mt-4" title="Hosts sem host key confiada">
        <NEmpty v-if="!report?.missingHosts.length" description="Todos os hosts ativos possuem host key confiada." class="py-6" />
        <div v-else class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div v-for="host in report.missingHosts" :key="host.hostId" class="na-item rounded-lg border px-4 py-3">
            <div class="truncate text-sm font-medium text-white">{{ host.hostName }}</div>
            <div class="truncate text-xs font-mono text-gray-500">{{ host.hostIp }}:{{ host.hostPort }}</div>
            <div class="mt-2 flex items-center justify-between gap-2">
              <NTag size="small" type="warning">Pendente</NTag>
              <NText depth="3" class="text-xs">{{ host.hostScope }}</NText>
            </div>
          </div>
        </div>
      </NCard>

      <NCard :bordered="false" class="na-card mt-4" title="Eventos de host key">
        <NDataTable :columns="eventColumns" :data="report?.events.data ?? []" :row-key="(row: HostKeyEvent) => row.id" :bordered="false" size="small" />
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
