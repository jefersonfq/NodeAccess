<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NAlert, NButton, NCard, NDataTable, NInput, NPagination, NSelect, NSpin, NTag, NText, type DataTableColumns } from 'naive-ui'
import { reportsService, type UserAdoptionReport, type UserAdoptionRow } from '@/services/reports.service'

const LIMIT = 30

const router = useRouter()
const loading = ref(true)
const error = ref<string | null>(null)
const report = ref<UserAdoptionReport | null>(null)
const periodDays = ref(30)
const search = ref('')
const page = ref(1)

const periodOptions = [
  { label: '7 dias', value: 7 },
  { label: '15 dias', value: 15 },
  { label: '30 dias', value: 30 },
  { label: '60 dias', value: 60 },
  { label: '90 dias', value: 90 },
]

const summaryCards = computed(() => {
  const summary = report.value?.summary
  return [
    { label: 'Usuários ativos', value: summary?.activeUsers ?? 0 },
    { label: 'Sessões SSH', value: summary?.totalSessions ?? 0 },
    { label: 'Snippets', value: summary?.totalSnippets ?? 0 },
    { label: 'Túneis SSH', value: summary?.totalSshTunnels ?? 0 },
    { label: 'Sessões ao vivo', value: summary?.totalLiveSessions ?? 0 },
  ]
})

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function totalUsage(row: UserAdoptionRow) {
  return row.sessions + row.snippets + row.sshTunnels + row.liveSessions
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const { data } = await reportsService.getUserAdoption({
      periodDays: periodDays.value,
      search: search.value.trim() || undefined,
      page: page.value,
      limit: LIMIT,
    })
    report.value = data
  } catch {
    error.value = 'Não foi possível carregar o relatório de adoção.'
  } finally {
    loading.value = false
  }
}

function searchReport() {
  page.value = 1
  load()
}

const userColumns: DataTableColumns<UserAdoptionRow> = [
  {
    title: 'Usuário',
    key: 'user',
    width: 240,
    render: (row) => h('div', [
      h(NText, { strong: true }, () => row.userName),
      h(NText, { depth: 3, style: 'display:block;font-size:11px' }, () => row.userEmail),
    ]),
  },
  {
    title: 'Total',
    key: 'total',
    width: 100,
    render: (row) => h(NTag, { type: 'info', size: 'small' }, () => `${totalUsage(row)} ações`),
  },
  {
    title: 'Sessões',
    key: 'sessions',
    width: 100,
    render: (row) => h(NText, { strong: row.sessions > 0 }, () => row.sessions),
  },
  {
    title: 'Snippets',
    key: 'snippets',
    width: 100,
    render: (row) => h(NText, { strong: row.snippets > 0 }, () => row.snippets),
  },
  {
    title: 'Acessos locais',
    key: 'sshTunnels',
    width: 130,
    render: (row) => h(NText, { strong: row.sshTunnels > 0 }, () => row.sshTunnels),
  },
  {
    title: 'Ao vivo',
    key: 'liveSessions',
    width: 100,
    render: (row) => h(NText, { strong: row.liveSessions > 0 }, () => row.liveSessions),
  },
  {
    title: 'Última atividade',
    key: 'lastActivityAt',
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px;font-family:monospace' }, () => formatDate(row.lastActivityAt)),
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
        <h1 class="text-xl font-semibold text-white">Relatório de adoção por usuário</h1>
        <NText depth="3" class="text-sm">Compare uso de sessões, snippets, acessos locais e sessões ao vivo por usuário.</NText>
      </div>
      <NButton size="small" ghost @click="load">Atualizar</NButton>
    </div>

    <NAlert v-if="error" type="error" :title="error" class="mb-4" />

    <NCard :bordered="false" class="na-card mb-4">
      <div class="flex flex-wrap gap-3">
        <NSelect v-model:value="periodDays" :options="periodOptions" style="width: 130px" @update:value="searchReport" />
        <NInput v-model:value="search" placeholder="Buscar usuário ou e-mail" clearable style="width: 300px" @keyup.enter="searchReport" />
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

      <NCard :bordered="false" class="na-card mt-4" title="Usuários">
        <NDataTable :columns="userColumns" :data="report?.users.data ?? []" :row-key="(row: UserAdoptionRow) => row.userId" :bordered="false" size="small" />
        <div v-if="(report?.users.total ?? 0) > LIMIT" class="mt-4 flex justify-end">
          <NPagination
            v-model:page="page"
            :page-count="Math.ceil((report?.users.total ?? 0) / LIMIT)"
            :page-slot="5"
            @update:page="load"
          />
        </div>
      </NCard>
    </NSpin>
  </div>
</template>
