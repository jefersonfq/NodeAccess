<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NAlert, NButton, NCard, NDataTable, NEmpty, NInput, NPagination, NSelect, NSpin, NTag, NText, type DataTableColumns } from 'naive-ui'
import { reportsService, type SnippetUsageExecution, type SnippetUsageReport } from '@/services/reports.service'

const LIMIT = 30

const router = useRouter()
const loading = ref(true)
const error = ref<string | null>(null)
const report = ref<SnippetUsageReport | null>(null)
const periodDays = ref(30)
const search = ref('')
const status = ref<string | undefined>(undefined)
const userId = ref('')
const snippetId = ref('')
const hostId = ref('')
const page = ref(1)

const periodOptions = [
  { label: '7 dias', value: 7 },
  { label: '15 dias', value: 15 },
  { label: '30 dias', value: 30 },
  { label: '60 dias', value: 60 },
  { label: '90 dias', value: 90 },
]

const statusOptions = [
  { label: 'Todos os status', value: '' },
  { label: 'Enviado', value: 'SENT' },
  { label: 'Falha em secret', value: 'FAILED_SECRET_RESOLUTION' },
  { label: 'Bloqueado', value: 'BLOCKED' },
]

const summaryCards = computed(() => {
  const summary = report.value?.summary
  return [
    { label: 'Execuções', value: summary?.totalExecutions ?? 0 },
    { label: 'Usuários únicos', value: summary?.uniqueUsers ?? 0 },
    { label: 'Snippets únicos', value: summary?.uniqueSnippets ?? 0 },
    { label: 'Falhas', value: summary?.failedExecutions ?? 0, danger: (summary?.failedExecutions ?? 0) > 0 },
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

function statusTagType(value: string): 'default' | 'success' | 'warning' | 'error' | 'info' {
  if (value === 'SENT') return 'success'
  if (value === 'FAILED_SECRET_RESOLUTION') return 'error'
  if (value === 'BLOCKED') return 'warning'
  return 'default'
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const { data } = await reportsService.getSnippetUsage({
      periodDays: periodDays.value,
      search: search.value.trim() || undefined,
      status: status.value || undefined,
      userId: userId.value.trim() ? Number(userId.value) : undefined,
      snippetId: snippetId.value.trim() ? Number(snippetId.value) : undefined,
      hostId: hostId.value.trim() ? Number(hostId.value) : undefined,
      page: page.value,
      limit: LIMIT,
    })
    report.value = data
  } catch {
    error.value = 'Não foi possível carregar o relatório de snippets.'
  } finally {
    loading.value = false
  }
}

function searchReport() {
  page.value = 1
  load()
}

const executionColumns: DataTableColumns<SnippetUsageExecution> = [
  {
    title: 'Quando',
    key: 'executedAt',
    width: 150,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px;font-family:monospace' }, () => formatDate(row.executedAt)),
  },
  {
    title: 'Snippet',
    key: 'snippet',
    width: 220,
    render: (row) => h('div', [
      h(NText, { strong: true }, () => row.snippetName ?? 'Snippet removido'),
      h(NText, { depth: 3, style: 'display:block;font-size:11px;font-family:monospace' }, () => row.snippetId !== null ? `#${row.snippetId} • ${row.snippetScope ?? '—'}` : 'histórico'),
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
    title: 'Host / sessão',
    key: 'context',
    width: 210,
    render: (row) => h('div', [
      h(NText, { strong: true }, () => row.hostName ?? 'Sem host'),
      h(NText, { depth: 3, style: 'display:block;font-size:11px;font-family:monospace' }, () => [
        row.hostId !== null ? `host #${row.hostId}` : 'host —',
        row.sessionId !== null ? `sessão #${row.sessionId}` : 'sessão —',
      ].join(' • ')),
    ]),
  },
  {
    title: 'Status',
    key: 'status',
    width: 150,
    render: (row) => h(NTag, { type: statusTagType(row.status), size: 'small' }, () => row.status),
  },
  {
    title: 'Origem',
    key: 'source',
    width: 100,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px;font-family:monospace' }, () => row.source),
  },
]

onMounted(load)
</script>

<template>
  <div class="p-6">
    <div class="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <NButton text size="small" style="color:#9ca3af;margin-bottom:10px" @click="router.push({ name: 'admin-dashboard' })">
          Voltar para dashboard admin
        </NButton>
        <h1 class="text-xl font-semibold text-white">Relatório de snippets</h1>
        <NText depth="3" class="text-sm">Uso, adoção e falhas dos snippets executados no terminal.</NText>
      </div>
      <NButton size="small" ghost @click="load">Atualizar</NButton>
    </div>

    <NAlert v-if="error" type="error" :title="error" class="mb-4" />

    <NCard :bordered="false" class="na-card mb-4">
      <div class="flex flex-wrap gap-3">
        <NSelect v-model:value="periodDays" :options="periodOptions" style="width: 130px" @update:value="searchReport" />
        <NInput v-model:value="search" placeholder="Buscar snippet, usuário ou host" clearable style="width: 280px" @keyup.enter="searchReport" />
        <NSelect v-model:value="status" :options="statusOptions" style="width: 170px" @update:value="searchReport" />
        <NInput v-model:value="userId" placeholder="Usuário ID" clearable style="width: 120px" @keyup.enter="searchReport" />
        <NInput v-model:value="snippetId" placeholder="Snippet ID" clearable style="width: 120px" @keyup.enter="searchReport" />
        <NInput v-model:value="hostId" placeholder="Host ID" clearable style="width: 120px" @keyup.enter="searchReport" />
        <NButton type="primary" @click="searchReport">Buscar</NButton>
      </div>
    </NCard>

    <NSpin :show="loading">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div
          v-for="card in summaryCards"
          :key="card.label"
          class="na-item rounded-lg border px-4 py-3"
        >
          <div class="text-xs uppercase tracking-[0.18em] text-gray-500">{{ card.label }}</div>
          <div class="mt-1 text-3xl font-semibold" :class="card.danger ? 'text-red-300' : 'text-white'">{{ card.value }}</div>
        </div>
      </div>

      <div class="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <NCard :bordered="false" class="na-card" title="Top snippets">
          <NEmpty v-if="!report?.topSnippets.length" description="Sem execuções no período." class="py-6" />
          <div v-else class="space-y-3">
            <div v-for="item in report.topSnippets" :key="item.snippetId ?? `removed-${item.snippetName}`" class="na-item rounded-lg border px-4 py-3">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium text-white">{{ item.snippetName ?? 'Snippet removido' }}</div>
                  <div class="text-xs text-gray-500">{{ item.failedCount }} falhas</div>
                </div>
                <NTag size="small" type="success">{{ item.count }} usos</NTag>
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
                <NTag size="small" type="info">{{ item.count }} usos</NTag>
              </div>
            </div>
          </div>
        </NCard>
      </div>

      <NCard :bordered="false" class="na-card mt-4" title="Execuções">
        <NDataTable
          :columns="executionColumns"
          :data="report?.executions.data ?? []"
          :row-key="(row: SnippetUsageExecution) => row.id"
          :bordered="false"
          size="small"
        />
        <div v-if="(report?.executions.total ?? 0) > LIMIT" class="mt-4 flex justify-end">
          <NPagination
            v-model:page="page"
            :page-count="Math.ceil((report?.executions.total ?? 0) / LIMIT)"
            :page-slot="5"
            @update:page="load"
          />
        </div>
      </NCard>
    </NSpin>
  </div>
</template>
