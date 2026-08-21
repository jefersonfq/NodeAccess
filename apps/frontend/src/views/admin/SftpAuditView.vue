<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NAlert, NButton, NCard, NDataTable, NInput, NModal, NPagination, NSelect, NSpace, NSpin, NTag, NText, useDialog, useMessage,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import type { AdminLogPublic } from '@nodeaccess/shared'
import SkeletonTable from '@/components/SkeletonTable.vue'
import { logsService } from '@/services/logs.service'
import { sftpService, getSftpErrorMessage, type SftpBackupDiffResponse } from '@/services/sftp.service'

type SftpAction = 'download' | 'downloadBackup' | 'viewBackupDiff' | 'upload' | 'delete' | 'rename' | 'mkdir' | 'createFile' | 'readFile' | 'writeFile' | 'restoreBackup'

interface SftpDetails {
  provider?: string
  action?: string
  hostId?: number
  path?: string
  newPath?: string
  success?: boolean
  size?: number
  errorMessage?: string
  backupPath?: string
  preRestoreBackupPath?: string
  tempPath?: string
  changedLines?: number
  addedLines?: number
  removedLines?: number
  diffPreviewMasked?: string
  diffSkippedReason?: string
  uploadFileName?: string
  preservedMode?: boolean
  preservedOwnership?: boolean
  preservedTimestamps?: boolean
  metadataPreservationSkipped?: string[]
  metadataPreservationErrors?: string[]
}

const { t, locale } = useI18n()
const dialog = useDialog()
const message = useMessage()

const rows = ref<AdminLogPublic[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const hostId = ref('')
const operation = ref<SftpAction | ''>('')
const result = ref<'true' | 'false' | ''>('')
const restoringRowId = ref<number | null>(null)
const downloadingRowId = ref<number | null>(null)
const diffRowId = ref<number | null>(null)
const diffVisible = ref(false)
const diffLoading = ref(false)
const diffError = ref<string | null>(null)
const diffData = ref<SftpBackupDiffResponse | null>(null)

const LIMIT = 20

const operationOptions = computed(() => [
  { label: t('admin.sftpAudit.filters.allOperations'), value: '' },
  { label: t('admin.sftpAudit.operations.download'), value: 'download' },
  { label: t('admin.sftpAudit.operations.downloadBackup'), value: 'downloadBackup' },
  { label: t('admin.sftpAudit.operations.viewBackupDiff'), value: 'viewBackupDiff' },
  { label: t('admin.sftpAudit.operations.upload'), value: 'upload' },
  { label: t('admin.sftpAudit.operations.delete'), value: 'delete' },
  { label: t('admin.sftpAudit.operations.rename'), value: 'rename' },
  { label: t('admin.sftpAudit.operations.mkdir'), value: 'mkdir' },
  { label: t('admin.sftpAudit.operations.createFile'), value: 'createFile' },
  { label: t('admin.sftpAudit.operations.readFile'), value: 'readFile' },
  { label: t('admin.sftpAudit.operations.writeFile'), value: 'writeFile' },
  { label: t('admin.sftpAudit.operations.restoreBackup'), value: 'restoreBackup' },
])

const resultOptions = computed(() => [
  { label: t('admin.sftpAudit.filters.allResults'), value: '' },
  { label: t('admin.sftpAudit.results.success'), value: 'true' },
  { label: t('admin.sftpAudit.results.failure'), value: 'false' },
])

function formatDate(d: Date | string) {
  return new Date(d).toLocaleString(locale.value, {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function formatBytes(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function parseDetails(row: AdminLogPublic): SftpDetails {
  if (!row.details) return {}
  try {
    const parsed = JSON.parse(row.details) as SftpDetails
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function operationLabel(action?: string) {
  if (!action) return '—'
  return t(`admin.sftpAudit.operations.${action}`, action)
}

function operationTagType(action?: string) {
  if (action === 'delete') return 'error'
  if (action === 'writeFile' || action === 'upload' || action === 'rename' || action === 'restoreBackup') return 'warning'
  if (action === 'readFile' || action === 'download' || action === 'downloadBackup' || action === 'viewBackupDiff') return 'info'
  return 'default'
}

const detailsContains = computed(() => {
  const filters: string[] = []
  if (operation.value) filters.push(`"action":"${operation.value}"`)
  if (result.value) filters.push(`"success":${result.value}`)
  return filters.join(',')
})

const numericHostId = computed(() => {
  const value = Number(hostId.value.trim())
  return Number.isFinite(value) && value > 0 ? value : undefined
})

async function load() {
  loading.value = true
  error.value = null
  try {
    const { data } = await logsService.listAdmin({
      search: search.value.trim() || undefined,
      actions: 'SFTP_OPERATION',
      targetType: 'Host',
      targetId: numericHostId.value,
      detailsContains: detailsContains.value || undefined,
      page: page.value,
      limit: LIMIT,
    })
    rows.value = data.data
    total.value = data.total
  } catch {
    error.value = t('admin.sftpAudit.messages.loadError')
  } finally {
    loading.value = false
  }
}

function runSearch() {
  page.value = 1
  load()
}

function clearFilters() {
  search.value = ''
  hostId.value = ''
  operation.value = ''
  result.value = ''
  page.value = 1
  load()
}

function canRestore(row: AdminLogPublic) {
  return canUseBackup(row)
}

function canUseBackup(row: AdminLogPublic) {
  const details = parseDetails(row)
  return details.action === 'writeFile'
    && details.success === true
    && typeof details.path === 'string'
    && typeof details.backupPath === 'string'
}

function backupDownloadName(backupPath: string) {
  return backupPath.split('/').filter(Boolean).pop() || 'nodeaccess-sftp-backup.bak'
}

async function downloadBackup(row: AdminLogPublic) {
  const details = parseDetails(row)
  if (!canUseBackup(row) || !details.path || !details.backupPath) return
  downloadingRowId.value = row.id
  try {
    const { data } = await sftpService.downloadBackup(row.targetId, details.path, details.backupPath)
    sftpService.saveBlobAs(data, backupDownloadName(details.backupPath))
    message.success(t('admin.sftpAudit.backupDownload.success'))
  } catch (err) {
    message.error(getSftpErrorMessage(err, t('admin.sftpAudit.backupDownload.error')))
  } finally {
    downloadingRowId.value = null
  }
}

async function viewDiff(row: AdminLogPublic) {
  const details = parseDetails(row)
  if (!canUseBackup(row) || !details.path || !details.backupPath) return
  diffVisible.value = true
  diffLoading.value = true
  diffError.value = null
  diffData.value = null
  diffRowId.value = row.id
  try {
    const { data } = await sftpService.backupDiff(row.targetId, details.path, details.backupPath)
    diffData.value = data
  } catch (err) {
    diffError.value = getSftpErrorMessage(err, t('admin.sftpAudit.diff.error'))
  } finally {
    diffLoading.value = false
    diffRowId.value = null
  }
}

function confirmRestore(row: AdminLogPublic) {
  const details = parseDetails(row)
  if (!canRestore(row) || !details.path || !details.backupPath) return
  dialog.warning({
    title: t('admin.sftpAudit.restore.title'),
    content: () => h('div', { style: { overflowWrap: 'anywhere' } }, t('admin.sftpAudit.restore.confirm', {
      path: details.path,
      backupPath: details.backupPath,
    })),
    style: { width: 'min(440px, calc(100vw - 32px))' },
    positiveText: t('admin.sftpAudit.restore.confirmButton'),
    negativeText: t('admin.sftpAudit.restore.cancelButton'),
    onPositiveClick: () => restoreBackup(row, details.path as string, details.backupPath as string),
  })
}

async function restoreBackup(row: AdminLogPublic, path: string, backupPath: string) {
  restoringRowId.value = row.id
  try {
    await sftpService.restoreBackup(row.targetId, path, backupPath)
    message.success(t('admin.sftpAudit.restore.success'))
    await load()
  } catch (err) {
    message.error(getSftpErrorMessage(err, t('admin.sftpAudit.restore.error')))
  } finally {
    restoringRowId.value = null
  }
}

const columns = computed<DataTableColumns<AdminLogPublic>>(() => [
  {
    title: t('admin.sftpAudit.columns.time'),
    key: 'timestamp',
    width: 160,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px;font-family:monospace' }, () => formatDate(row.timestamp)),
  },
  {
    title: t('admin.sftpAudit.columns.user'),
    key: 'adminName',
    width: 180,
    render: (row) => h('div', [
      h(NText, { strong: true, style: 'display:block;font-size:13px' }, () => row.adminName),
      h(NText, { depth: 3, style: 'display:block;font-size:11px;font-family:monospace' }, () => `#${row.adminId}`),
    ]),
  },
  {
    title: t('admin.sftpAudit.columns.operation'),
    key: 'operation',
    width: 170,
    render: (row) => {
      const details = parseDetails(row)
      return h(NTag, { size: 'small', type: operationTagType(details.action) }, () => operationLabel(details.action))
    },
  },
  {
    title: t('admin.sftpAudit.columns.host'),
    key: 'host',
    width: 110,
    render: (row) => h(NText, { style: 'font-size:12px;font-family:monospace' }, () => `#${parseDetails(row).hostId ?? row.targetId}`),
  },
  {
    title: t('admin.sftpAudit.columns.path'),
    key: 'path',
    minWidth: 260,
    render: (row) => {
      const details = parseDetails(row)
      return h('div', [
        h(NText, { style: 'display:block;font-size:12px;font-family:monospace;word-break:break-all' }, () => details.path ?? '—'),
        details.newPath
          ? h(NText, { depth: 3, style: 'display:block;font-size:11px;font-family:monospace;word-break:break-all;margin-top:2px' }, () => `${t('admin.sftpAudit.fields.newPath')}: ${details.newPath}`)
          : null,
      ])
    },
  },
  {
    title: t('admin.sftpAudit.columns.size'),
    key: 'size',
    width: 110,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px;font-family:monospace' }, () => formatBytes(parseDetails(row).size)),
  },
  {
    title: t('admin.sftpAudit.columns.result'),
    key: 'result',
    width: 120,
    render: (row) => {
      const details = parseDetails(row)
      const ok = details.success === true
      return h(NTag, { size: 'small', type: ok ? 'success' : 'error' }, () => ok ? t('admin.sftpAudit.results.success') : t('admin.sftpAudit.results.failure'))
    },
  },
  {
    title: t('admin.sftpAudit.columns.details'),
    key: 'details',
    minWidth: 220,
    render: (row) => {
      const details = parseDetails(row)
      if (details.errorMessage) return h(NText, { type: 'error', style: 'font-size:12px' }, () => details.errorMessage)

      const parts = [
        details.backupPath ? `${t('admin.sftpAudit.fields.backupPath')}: ${details.backupPath}` : null,
        details.preRestoreBackupPath ? `${t('admin.sftpAudit.fields.preRestoreBackupPath')}: ${details.preRestoreBackupPath}` : null,
        details.tempPath ? `${t('admin.sftpAudit.fields.tempPath')}: ${details.tempPath}` : null,
        details.uploadFileName ? `${t('admin.sftpAudit.fields.uploadFileName')}: ${details.uploadFileName}` : null,
        typeof details.preservedMode === 'boolean'
          ? `${t('admin.sftpAudit.fields.preservedMode')}: ${details.preservedMode ? t('admin.sftpAudit.results.success') : t('admin.sftpAudit.results.failure')}`
          : null,
        typeof details.preservedOwnership === 'boolean'
          ? `${t('admin.sftpAudit.fields.preservedOwnership')}: ${details.preservedOwnership ? t('admin.sftpAudit.results.success') : t('admin.sftpAudit.results.failure')}`
          : null,
        typeof details.preservedTimestamps === 'boolean'
          ? `${t('admin.sftpAudit.fields.preservedTimestamps')}: ${details.preservedTimestamps ? t('admin.sftpAudit.results.success') : t('admin.sftpAudit.results.failure')}`
          : null,
        details.metadataPreservationSkipped?.length
          ? `${t('admin.sftpAudit.fields.metadataPreservationSkipped')}: ${details.metadataPreservationSkipped.join(', ')}`
          : null,
        details.metadataPreservationErrors?.length
          ? `${t('admin.sftpAudit.fields.metadataPreservationErrors')}: ${details.metadataPreservationErrors.join('; ')}`
          : null,
        typeof details.changedLines === 'number'
          ? `${t('admin.sftpAudit.fields.changedLines')}: ${details.changedLines}`
          : null,
        typeof details.addedLines === 'number'
          ? `${t('admin.sftpAudit.fields.addedLines')}: ${details.addedLines}`
          : null,
        typeof details.removedLines === 'number'
          ? `${t('admin.sftpAudit.fields.removedLines')}: ${details.removedLines}`
          : null,
        details.diffPreviewMasked ? `${t('admin.sftpAudit.fields.diffPreviewMasked')}:\n${details.diffPreviewMasked}` : null,
        details.diffSkippedReason ? `${t('admin.sftpAudit.fields.diffSkippedReason')}: ${details.diffSkippedReason}` : null,
      ].filter(Boolean)

      return parts.length
        ? h(NText, { depth: 3, style: 'white-space:pre-wrap;font-size:12px;font-family:monospace' }, () => parts.join('\n'))
        : h(NText, { depth: 3 }, () => '—')
    },
  },
  {
    title: t('admin.sftpAudit.columns.actions'),
    key: 'actions',
    width: 270,
    render: (row) => h(NSpace, { size: 6, wrap: false }, () => [
      h(NButton, {
        size: 'tiny',
        secondary: true,
        disabled: !canUseBackup(row) || diffLoading.value,
        loading: diffRowId.value === row.id,
        onClick: () => viewDiff(row),
      }, () => t('admin.sftpAudit.diff.button')),
      h(NButton, {
        size: 'tiny',
        secondary: true,
        disabled: !canUseBackup(row) || downloadingRowId.value !== null,
        loading: downloadingRowId.value === row.id,
        onClick: () => downloadBackup(row),
      }, () => t('admin.sftpAudit.backupDownload.button')),
      h(NButton, {
        size: 'tiny',
        type: 'warning',
        secondary: true,
        disabled: !canRestore(row) || restoringRowId.value !== null,
        loading: restoringRowId.value === row.id,
        onClick: () => confirmRestore(row),
      }, () => t('admin.sftpAudit.restore.button')),
    ]),
  },
])

onMounted(load)
</script>

<template>
  <div class="p-6 space-y-4">
    <div class="flex flex-col gap-1">
      <h1 class="text-xl font-semibold text-white">{{ $t('admin.sftpAudit.title') }}</h1>
      <NText depth="3" class="text-sm">{{ $t('admin.sftpAudit.subtitle') }}</NText>
    </div>

    <NCard>
      <div class="grid grid-cols-1 md:grid-cols-[minmax(220px,1fr)_170px_170px_130px_auto_auto] gap-3 items-center">
        <NInput
          v-model:value="search"
          clearable
          :placeholder="$t('admin.sftpAudit.filters.searchPlaceholder')"
          @keyup.enter="runSearch"
        />
        <NSelect v-model:value="operation" :options="operationOptions" />
        <NSelect v-model:value="result" :options="resultOptions" />
        <NInput
          v-model:value="hostId"
          clearable
          :placeholder="$t('admin.sftpAudit.filters.hostIdPlaceholder')"
          @keyup.enter="runSearch"
        />
        <NButton type="primary" @click="runSearch">{{ $t('admin.sftpAudit.filters.search') }}</NButton>
        <NButton secondary @click="clearFilters">{{ $t('admin.sftpAudit.filters.clear') }}</NButton>
      </div>
    </NCard>

    <NAlert v-if="error" type="error" :title="error" />

    <NCard>
      <template #header>
        <NSpace align="center" justify="space-between" class="w-full">
          <NText strong>{{ $t('admin.sftpAudit.tableTitle') }}</NText>
          <NTag size="small" type="info">{{ $t('admin.sftpAudit.count', { total }) }}</NTag>
        </NSpace>
      </template>

      <SkeletonTable v-if="loading && rows.length === 0" :rows="8" />
      <NDataTable
        v-else
        :columns="columns"
        :data="rows"
        :loading="loading"
        :row-key="(row: AdminLogPublic) => row.id"
        size="small"
        :bordered="false"
        :single-line="false"
        :scroll-x="1460"
      />

      <div class="flex justify-end mt-4">
        <NPagination
          v-model:page="page"
          :page-size="LIMIT"
          :item-count="total"
          @update:page="load"
        />
      </div>
    </NCard>

    <NModal v-model:show="diffVisible" preset="card" :title="$t('admin.sftpAudit.diff.title')" style="width:min(980px, calc(100vw - 32px))">
      <NSpin :show="diffLoading">
        <NAlert v-if="diffError" type="error" :title="diffError" />
        <div v-else-if="diffData" class="space-y-3">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <NText depth="3" class="font-mono break-all">{{ diffData.path }}</NText>
            <NText depth="3" class="font-mono break-all">{{ diffData.backupPath }}</NText>
          </div>
          <NSpace>
            <NTag size="small" type="info">{{ $t('admin.sftpAudit.fields.changedLines') }}: {{ diffData.changedLines }}</NTag>
            <NTag size="small" type="success">{{ $t('admin.sftpAudit.fields.addedLines') }}: {{ diffData.addedLines }}</NTag>
            <NTag size="small" type="warning">{{ $t('admin.sftpAudit.fields.removedLines') }}: {{ diffData.removedLines }}</NTag>
            <NTag v-if="diffData.truncated" size="small" type="warning">
              {{ $t('admin.sftpAudit.diff.truncated') }}: {{ diffData.skippedReason }}
            </NTag>
          </NSpace>
          <NAlert v-if="diffData.skippedReason && !diffData.diffMasked" type="warning" :title="$t('admin.sftpAudit.diff.skipped')" />
          <pre v-else class="sftp-diff-block">{{ diffData.diffMasked || $t('admin.sftpAudit.diff.empty') }}</pre>
        </div>
      </NSpin>
    </NModal>
  </div>
</template>

<style scoped>
.sftp-diff-block {
  max-height: min(62vh, 680px);
  overflow: auto;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.24);
  color: rgba(255, 255, 255, 0.88);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
