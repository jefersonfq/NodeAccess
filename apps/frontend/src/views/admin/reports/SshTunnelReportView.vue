<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NAlert, NButton, NCard, NDataTable, NEmpty, NInput, NPagination, NSelect, NSpin, NTag, NText, type DataTableColumns } from 'naive-ui'
import { reportsService, type SshTunnelEvent, type SshTunnelReport } from '@/services/reports.service'

const LIMIT = 30

const router = useRouter()
const loading = ref(true)
const error = ref<string | null>(null)
const report = ref<SshTunnelReport | null>(null)
const periodDays = ref(30)
const search = ref('')
const type = ref<string | undefined>(undefined)
const userId = ref('')
const forwardingId = ref('')
const hostId = ref('')
const page = ref(1)

const periodOptions = [
  { label: '7 dias', value: 7 },
  { label: '15 dias', value: 15 },
  { label: '30 dias', value: 30 },
  { label: '60 dias', value: 60 },
  { label: '90 dias', value: 90 },
]

const typeOptions = [
  { label: 'Todos os tipos', value: '' },
  { label: 'Web', value: 'web' },
  { label: 'Túnel', value: 'tunnel' },
]

const summaryCards = computed(() => {
  const summary = report.value?.summary
  return [
    { label: 'Acessos', value: summary?.totalAccesses ?? 0 },
    { label: 'Web', value: summary?.webAccesses ?? 0 },
    { label: 'Túneis', value: summary?.tunnelAccesses ?? 0 },
    { label: 'Usuários únicos', value: summary?.uniqueUsers ?? 0 },
    { label: 'Acessos únicos', value: summary?.uniqueForwardings ?? 0 },
  ]
})

function formatDate(value: string | Date) {
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function typeTagType(value: string): 'default' | 'success' | 'warning' | 'error' | 'info' {
  if (value === 'web') return 'info'
  if (value === 'tunnel') return 'success'
  return 'default'
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const { data } = await reportsService.getSshTunnelUsage({
      periodDays: periodDays.value,
      search: search.value.trim() || undefined,
      status: type.value || undefined,
      userId: userId.value.trim() ? Number(userId.value) : undefined,
      snippetId: forwardingId.value.trim() ? Number(forwardingId.value) : undefined,
      hostId: hostId.value.trim() ? Number(hostId.value) : undefined,
      page: page.value,
      limit: LIMIT,
    })
    report.value = data
  } catch {
    error.value = 'Não foi possível carregar o relatório de túneis SSH.'
  } finally {
    loading.value = false
  }
}

function searchReport() {
  page.value = 1
  load()
}

const eventColumns: DataTableColumns<SshTunnelEvent> = [
  {
    title: 'Quando',
    key: 'timestamp',
    width: 150,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px;font-family:monospace' }, () => formatDate(row.timestamp)),
  },
  {
    title: 'Túnel',
    key: 'access',
    width: 230,
    render: (row) => h('div', [
      h(NText, { strong: true }, () => row.label),
      h(NText, { depth: 3, style: 'display:block;font-size:11px;font-family:monospace' }, () => `${row.remoteHost}:${row.remotePort} • ${row.forwardingId !== null ? `#${row.forwardingId}` : 'histórico'}`),
    ]),
  },
  {
    title: 'Host',
    key: 'host',
    width: 180,
    render: (row) => h('div', [
      h(NText, { strong: true }, () => row.hostName ?? 'Host removido'),
      h(NText, { depth: 3, style: 'display:block;font-size:11px;font-family:monospace' }, () => row.hostId !== null ? `#${row.hostId}` : 'histórico'),
    ]),
  },
  {
    title: 'Usuário',
    key: 'user',
    width: 210,
    render: (row) => h('div', [
      h(NText, { strong: true }, () => row.userName),
      h(NText, { depth: 3, style: 'display:block;font-size:11px' }, () => row.userEmail),
    ]),
  },
  {
    title: 'Tipo',
    key: 'type',
    width: 110,
    render: (row) => h(NTag, { type: typeTagType(row.type), size: 'small' }, () => row.type === 'web' ? 'Web' : 'Túnel'),
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
        <h1 class="text-xl font-semibold text-white">Relatório de Túneis SSH</h1>
        <NText depth="3" class="text-sm">Uso de túneis e acessos web por usuário, host e período.</NText>
      </div>
      <NButton size="small" ghost @click="load">Atualizar</NButton>
    </div>

    <NAlert v-if="error" type="error" :title="error" class="mb-4" />

    <NCard :bordered="false" class="na-card mb-4">
      <div class="flex flex-wrap gap-3">
        <NSelect v-model:value="periodDays" :options="periodOptions" style="width: 130px" @update:value="searchReport" />
        <NInput v-model:value="search" placeholder="Buscar túnel, usuário, host ou destino" clearable style="width: 300px" @keyup.enter="searchReport" />
        <NSelect v-model:value="type" :options="typeOptions" style="width: 150px" @update:value="searchReport" />
        <NInput v-model:value="userId" placeholder="Usuário ID" clearable style="width: 120px" @keyup.enter="searchReport" />
        <NInput v-model:value="forwardingId" placeholder="Túnel ID" clearable style="width: 120px" @keyup.enter="searchReport" />
        <NInput v-model:value="hostId" placeholder="Host ID" clearable style="width: 120px" @keyup.enter="searchReport" />
        <NButton type="primary" @click="searchReport">Buscar</NButton>
      </div>
    </NCard>

    <NSpin :show="loading">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-5">
        <div v-for="card in summaryCards" :key="card.label" class="na-item rounded-lg border px-4 py-3">
          <div class="text-xs uppercase tracking-[0.18em] text-gray-500">{{ card.label }}</div>
          <div class="mt-1 text-3xl font-semibold text-white">{{ card.value }}</div>
        </div>
      </div>

      <div class="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <NCard :bordered="false" class="na-card" title="Top túneis">
          <NEmpty v-if="!report?.topForwardings.length" description="Sem acessos no período." class="py-6" />
          <div v-else class="space-y-3">
            <div v-for="item in report.topForwardings" :key="item.forwardingId ?? `${item.remoteHost}:${item.remotePort}`" class="na-item rounded-lg border px-4 py-3">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium text-white">{{ item.label }}</div>
                  <div class="truncate text-xs text-gray-500">{{ item.hostName ?? 'Host removido' }} • {{ item.remoteHost }}:{{ item.remotePort }}</div>
                </div>
                <NTag size="small" type="success">{{ item.count }} acessos</NTag>
              </div>
            </div>
          </div>
        </NCard>

        <NCard :bordered="false" class="na-card" title="Top usuários">
          <NEmpty v-if="!report?.topUsers.length" description="Sem usuários no período." class="py-6" />
          <div v-else class="space-y-3">
            <div v-for="item in report.topUsers" :key="item.userId" class="na-item rounded-lg border px-4 py-3">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium text-white">{{ item.userName }}</div>
                  <div class="truncate text-xs text-gray-500">{{ item.userEmail }}</div>
                </div>
                <NTag size="small" type="info">{{ item.count }} acessos</NTag>
              </div>
            </div>
          </div>
        </NCard>
      </div>

      <NCard :bordered="false" class="na-card mt-4" title="Eventos">
        <NDataTable :columns="eventColumns" :data="report?.events.data ?? []" :row-key="(row: SshTunnelEvent) => row.id" :bordered="false" size="small" />
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
