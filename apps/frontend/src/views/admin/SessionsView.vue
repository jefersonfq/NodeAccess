<script setup lang="ts">
import { ref, onMounted, h, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NDataTable, NInput, NSelect, NButton, NSpace, NAlert,
  NTag, NText, NPagination, useMessage,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { sessionsService, type SessionPublic } from '@/services/sessions.service'

const { t } = useI18n()

const message = useMessage()

const sessions       = ref<SessionPublic[]>([])
const total          = ref(0)
const loading        = ref(false)
const error          = ref<string | null>(null)
const search         = ref('')
const active         = ref<string>('')
const page           = ref(1)
const limit          = 20
const cleaningUp     = ref(false)

const statusOptions = computed(() => [
  { label: t('admin.sessions.filterAll'),    value: '' },
  { label: t('admin.sessions.filterActive'), value: 'true' },
  { label: t('admin.sessions.filterClosed'), value: 'false' },
])

async function load() {
  loading.value = true
  error.value   = null
  try {
    const { data } = await sessionsService.list({
      page:   page.value,
      limit,
      search: search.value || undefined,
      active: active.value === 'true' ? true : active.value === 'false' ? false : undefined,
    })
    sessions.value = data.data
    total.value    = data.total
  } catch {
    error.value = t('admin.sessions.messages.loadError')
  } finally {
    loading.value = false
  }
}

onMounted(load)

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR')
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  if (seconds < 60)  return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

const columns = computed<DataTableColumns<SessionPublic>>(() => [
  {
    title: t('admin.sessions.columns.user'), key: 'user',
    render: (row) => h('div', [
      h(NText, { strong: true, class: 'block text-sm' }, () => row.user.name),
      h(NText, { depth: 3,    class: 'text-xs' },        () => row.user.email),
    ]),
  },
  {
    title: t('admin.sessions.columns.host'), key: 'host',
    render: (row) => h('div', [
      h(NText, { strong: true, class: 'block text-sm' }, () => row.host.name),
      h(NText, { depth: 3,    class: 'text-xs font-mono' }, () => row.host.ip),
    ]),
  },
  {
    title: t('admin.sessions.columns.start'), key: 'startedAt',
    render: (row) => h(NText, { class: 'text-sm' }, () => formatDate(row.startedAt)),
  },
  {
    title: t('admin.sessions.columns.end'), key: 'endedAt',
    render: (row) => row.endedAt
      ? h(NText, { class: 'text-sm' }, () => formatDate(row.endedAt!))
      : h(NText, { depth: 3 }, () => '—'),
  },
  {
    title: t('admin.sessions.columns.duration'), key: 'duration',
    render: (row) => h(NText, { class: 'text-sm font-mono' }, () => formatDuration(row.durationSeconds)),
  },
  {
    title: t('admin.sessions.columns.status'), key: 'active',
    render: (row) => h(NTag, { type: row.active ? 'success' : 'default', size: 'small' }, () => row.active ? t('admin.sessions.status.active') : t('admin.sessions.status.closed')),
  },
])

const pageCount = computed(() => Math.ceil(total.value / limit))

function onPageChange(p: number) {
  page.value = p
  load()
}

async function cleanupGhosts() {
  cleaningUp.value = true
  try {
    const { data } = await sessionsService.cleanup()
    if (data.cleaned > 0) {
      message.success(t('admin.sessions.messages.ghostsCleaned', { count: data.cleaned }))
      load()
    } else {
      message.info(t('admin.sessions.messages.noGhosts'))
    }
  } catch {
    message.error(t('admin.sessions.messages.ghostError'))
  } finally {
    cleaningUp.value = false
  }
}
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-xl font-semibold text-white">{{ $t('admin.sessions.title') }}</h1>
      <NSpace align="center">
        <NText depth="3" class="text-sm">{{ $t('admin.sessions.count', { total }) }}</NText>
        <NButton
          size="small"
          type="warning"
          ghost
          :loading="cleaningUp"
          @click="cleanupGhosts"
        >
          {{ $t('admin.sessions.killGhosts') }}
        </NButton>
      </NSpace>
    </div>

    <NSpace class="mb-4">
      <NInput
        v-model:value="search"
        :placeholder="$t('admin.sessions.searchPlaceholder')"
        clearable
        style="width: 280px"
        @keyup.enter="load"
      />
      <NSelect
        v-model:value="active"
        :options="statusOptions"
        style="width: 160px"
        @update:value="() => { page = 1; load() }"
      />
      <NButton @click="() => { page = 1; load() }">{{ $t('admin.sessions.search') }}</NButton>
    </NSpace>

    <NAlert v-if="error" type="error" class="mb-4" :title="error" />

    <NDataTable
      :columns="columns"
      :data="sessions"
      :loading="loading"
      :row-key="(r) => r.id"
      :bordered="false"
    />

    <div class="flex justify-end mt-4">
      <NPagination
        v-if="pageCount > 1"
        :page="page"
        :page-count="pageCount"
        @update:page="onPageChange"
      />
    </div>
  </div>
</template>
