<script setup lang="ts">
import { computed, h, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NDataTable, NDrawer, NDrawerContent, NEmpty, NSpace, NSpin, NTag, NText, useDialog, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import type { HostBulkActionHistoryItem } from '@nodeaccess/shared'
import { hostService } from '@/services/host.service'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{ close: []; rolledBack: [] }>()

const { t } = useI18n()
const msg = useMessage()
const dialog = useDialog()

const loading = ref(false)
const rollbackLoadingId = ref<number | null>(null)
const error = ref<string | null>(null)
const rows = ref<HostBulkActionHistoryItem[]>([])

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'short',
  timeStyle: 'short',
})

const columns = computed<DataTableColumns<HostBulkActionHistoryItem>>(() => [
  {
    key: 'createdAt',
    title: t('hosts.bulk.history.columns.date'),
    width: 150,
    render: (row) => dateFormatter.format(new Date(row.createdAt)),
  },
  {
    key: 'action',
    title: t('hosts.bulk.history.columns.action'),
    minWidth: 300,
    render: (row) => h('div', { class: 'min-w-0' }, [
      h('div', {
        class: 'whitespace-normal break-words text-sm font-medium leading-snug text-white',
        title: row.actionLabel,
      }, row.actionLabel),
      h('div', {
        class: 'mt-0.5 whitespace-normal break-words text-xs leading-snug text-gray-400',
        title: t(`hosts.bulk.actions.${actionTranslationKey(row.actionType)}`),
      }, t(`hosts.bulk.actions.${actionTranslationKey(row.actionType)}`)),
    ]),
  },
  {
    key: 'actor',
    title: t('hosts.bulk.history.columns.actor'),
    width: 190,
    ellipsis: { tooltip: true },
    render: (row) => h('div', { class: 'min-w-0' }, [
      h('div', { class: 'truncate text-sm text-white' }, row.actorName),
      h('div', { class: 'truncate text-xs text-gray-400' }, row.actorEmail),
    ]),
  },
  {
    key: 'summary',
    title: t('hosts.bulk.history.columns.summary'),
    width: 220,
    render: (row) => h('div', { class: 'flex flex-wrap gap-1' }, [
      h(NTag, { size: 'small', type: 'success', bordered: false }, { default: () => t('hosts.bulk.result.updated', { count: row.updated }) }),
      row.skipped > 0
        ? h(NTag, { size: 'small', type: 'warning', bordered: false }, { default: () => t('hosts.bulk.result.skipped', { count: row.skipped }) })
        : null,
      row.failed > 0
        ? h(NTag, { size: 'small', type: 'error', bordered: false }, { default: () => t('hosts.bulk.result.failed', { count: row.failed }) })
        : null,
    ]),
  },
  {
    key: 'report',
    title: '',
    width: 170,
    render: (row) => h(NSpace, { size: 6, justify: 'end' }, {
      default: () => [
        h(NButton, {
          size: 'small',
          secondary: true,
          onClick: () => downloadReport(row),
        }, { default: () => t('hosts.bulk.history.download') }),
        row.reversible
          ? h(NButton, {
              size: 'small',
              type: 'warning',
              secondary: true,
              loading: rollbackLoadingId.value === row.id,
              disabled: rollbackLoadingId.value !== null,
              onClick: () => confirmRollback(row),
            }, { default: () => t('hosts.bulk.history.rollback') })
          : null,
      ],
    }),
  },
])

function actionTranslationKey(type: HostBulkActionHistoryItem['actionType']) {
  if (type === 'set_bastion') return 'setBastion'
  if (type === 'set_pem_key') return 'setPemKey'
  if (type === 'add_tags') return 'addTags'
  if (type === 'rollback') return 'rollback'
  return 'removeTags'
}

function downloadReport(row: HostBulkActionHistoryItem) {
  const payload = JSON.stringify(row, null, 2)
  const blob = new Blob([payload], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = Object.assign(document.createElement('a'), {
    href: url,
    download: `nodeaccess-host-bulk-action-${row.id}.json`,
  })
  link.click()
  URL.revokeObjectURL(url)
}

function confirmRollback(row: HostBulkActionHistoryItem) {
  dialog.warning({
    title: t('hosts.bulk.history.rollbackConfirmTitle'),
    content: t('hosts.bulk.history.rollbackConfirmContent', { count: row.updated }),
    positiveText: t('hosts.bulk.history.rollback'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => rollback(row),
  })
}

async function rollback(row: HostBulkActionHistoryItem) {
  rollbackLoadingId.value = row.id
  error.value = null
  try {
    const { data } = await hostService.rollbackBulkAction(row.id)
    msg.success(t('hosts.bulk.history.rollbackSuccess', { count: data.updated }))
    emit('rolledBack')
    await loadHistory()
  } catch (err) {
    const e = err as { response?: { data?: { message?: string } }; message?: string }
    error.value = e.response?.data?.message ?? e.message ?? t('hosts.bulk.history.rollbackError')
    msg.error(error.value)
  } finally {
    rollbackLoadingId.value = null
  }
}

async function loadHistory() {
  if (!props.show) return
  loading.value = true
  error.value = null
  try {
    const { data } = await hostService.listBulkActionHistory()
    rows.value = data.data
  } catch (err) {
    const e = err as { response?: { data?: { message?: string } }; message?: string }
    error.value = e.response?.data?.message ?? e.message ?? t('hosts.bulk.history.loadError')
    msg.error(error.value)
  } finally {
    loading.value = false
  }
}

watch(() => props.show, () => { void loadHistory() }, { immediate: true })
</script>

<template>
  <NDrawer :show="show" width="min(980px, 100vw)" placement="right" @update:show="(value) => { if (!value) emit('close') }">
    <NDrawerContent :title="$t('hosts.bulk.history.title')" closable>
      <div class="space-y-4">
        <NAlert type="info" :show-icon="false">
          {{ $t('hosts.bulk.history.description') }}
        </NAlert>

        <NAlert v-if="error" type="error" :title="error" />

        <NSpin :show="loading">
          <NDataTable
            v-if="rows.length"
            :columns="columns"
            :data="rows"
            :row-key="(row) => row.id"
            size="small"
            :max-height="520"
            :scroll-x="930"
          />
          <NEmpty v-else-if="!loading" :description="$t('hosts.bulk.history.empty')">
            <template #extra>
              <NText depth="3" class="text-xs">
                {{ $t('hosts.bulk.history.emptyHint') }}
              </NText>
            </template>
          </NEmpty>
        </NSpin>
      </div>
    </NDrawerContent>
  </NDrawer>
</template>
