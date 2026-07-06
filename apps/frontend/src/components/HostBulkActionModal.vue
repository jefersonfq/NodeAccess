<script setup lang="ts">
import { computed, h, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NAlert, NButton, NDataTable, NModal, NSelect, NSpace, NText, useMessage } from 'naive-ui'
import type { DataTableColumns, SelectOption } from 'naive-ui'
import type { BastionPublic, HostBulkAction, HostBulkApplyResponse, HostBulkPreviewResponse, HostBulkSelection, PemKeyPublic, TagPublic } from '@nodeaccess/shared'
import { hostService } from '@/services/host.service'

const props = defineProps<{
  show: boolean
  selection: HostBulkSelection
  selectedCount: number
  bastions: BastionPublic[]
  pemKeys: PemKeyPublic[]
  tags: TagPublic[]
}>()

const emit = defineEmits<{ close: []; applied: [result: HostBulkApplyResponse] }>()

const { t } = useI18n()
const msg = useMessage()

type BulkUiAction = HostBulkAction['type']

const actionType = ref<BulkUiAction>('set_bastion')
const bastionId = ref<number | null>(null)
const pemKeyId = ref<number | null>(null)
const tagIds = ref<number[]>([])
const preview = ref<HostBulkPreviewResponse | null>(null)
const result = ref<HostBulkApplyResponse | null>(null)
const loadingPreview = ref(false)
const applying = ref(false)
const error = ref<string | null>(null)

const selectionKey = computed(() => JSON.stringify(props.selection))

const actionOptions = computed<SelectOption[]>(() => [
  { label: t('hosts.bulk.actions.setBastion'), value: 'set_bastion' },
  { label: t('hosts.bulk.actions.setPemKey'), value: 'set_pem_key' },
  { label: t('hosts.bulk.actions.addTags'), value: 'add_tags' },
  { label: t('hosts.bulk.actions.removeTags'), value: 'remove_tags' },
])

const bastionOptions = computed<SelectOption[]>(() => [
  { label: t('hosts.bulk.values.removeBastion'), value: 0 },
  ...props.bastions.map((item) => ({ label: item.name, value: item.id })),
])

const pemKeyOptions = computed<SelectOption[]>(() => [
  { label: t('hosts.bulk.values.removePemKey'), value: 0 },
  ...props.pemKeys.map((item) => ({ label: item.name, value: item.id })),
])

const tagOptions = computed<SelectOption[]>(() => props.tags.map((item) => ({ label: item.name, value: item.id })))

const previewColumns = computed<DataTableColumns<HostBulkPreviewResponse['sample'][number]>>(() => [
  { key: 'name', title: t('hosts.bulk.columns.host'), ellipsis: { tooltip: true } },
  { key: 'change', title: t('hosts.bulk.columns.change'), minWidth: 240,
    render: (row) => h('div', { class: 'flex min-w-0 items-center gap-2 text-xs' }, [
      h('span', { class: 'min-w-0 truncate text-gray-400' }, currentValueLabel(row)),
      h('span', { class: 'shrink-0 text-gray-600' }, '->'),
      h('span', { class: 'min-w-0 truncate font-medium text-emerald-300' }, nextValueLabel()),
    ]),
  },
  { key: 'status', title: t('hosts.bulk.columns.status'), width: 160,
    render: (row) => {
      if (row.errors.length) return row.errors.join(' • ')
      if (row.warnings.length) return row.warnings.join(' • ')
      return t('hosts.bulk.ready')
    },
  },
])

const resultColumns = computed<DataTableColumns<HostBulkApplyResponse['rows'][number]>>(() => [
  { key: 'name', title: t('hosts.bulk.columns.host'), ellipsis: { tooltip: true } },
  { key: 'status', title: t('hosts.bulk.result.status'), width: 120,
    render: (row) => t(`hosts.bulk.result.statuses.${row.status}`),
  },
  { key: 'message', title: t('hosts.bulk.result.message'), ellipsis: { tooltip: true } },
])

const resultProblemRows = computed(() =>
  result.value?.rows.filter((row) => row.status !== 'updated') ?? [],
)

function currentValueLabel(row: HostBulkPreviewResponse['sample'][number]) {
  if (actionType.value === 'set_bastion') return row.currentBastionName ?? t('hosts.bastion.noneShort')
  if (actionType.value === 'set_pem_key') return row.currentPemKeyName ?? t('hosts.bulk.values.noPemKey')
  return t('hosts.bulk.values.currentTags')
}

function nextValueLabel() {
  if (actionType.value === 'set_bastion') {
    if (bastionId.value === 0) return t('hosts.bulk.values.removeBastion')
    return props.bastions.find((item) => item.id === bastionId.value)?.name ?? t('hosts.bulk.values.chooseValue')
  }
  if (actionType.value === 'set_pem_key') {
    if (pemKeyId.value === 0) return t('hosts.bulk.values.removePemKey')
    return props.pemKeys.find((item) => item.id === pemKeyId.value)?.name ?? t('hosts.bulk.values.chooseValue')
  }
  const names = tagIds.value
    .map((id) => props.tags.find((item) => item.id === id)?.name)
    .filter((name): name is string => !!name)
  if (names.length === 0) return t('hosts.bulk.values.chooseValue')
  return actionType.value === 'add_tags'
    ? t('hosts.bulk.values.addTags', { tags: names.join(', ') })
    : t('hosts.bulk.values.removeTags', { tags: names.join(', ') })
}

function buildAction(): HostBulkAction | null {
  if (actionType.value === 'set_bastion') {
    if (bastionId.value === null) return null
    return { type: 'set_bastion', bastionId: bastionId.value === 0 ? null : bastionId.value }
  }
  if (actionType.value === 'set_pem_key') {
    if (pemKeyId.value === null) return null
    return { type: 'set_pem_key', pemKeyId: pemKeyId.value === 0 ? null : pemKeyId.value }
  }
  if (actionType.value === 'add_tags') {
    if (tagIds.value.length === 0) return null
    return { type: 'add_tags', tagIds: tagIds.value }
  }
  if (tagIds.value.length === 0) return null
  return { type: 'remove_tags', tagIds: tagIds.value }
}

async function loadPreview() {
  preview.value = null
  result.value = null
  error.value = null
  if (!props.show || props.selectedCount === 0) return
  const action = buildAction()
  if (!action) return

  loadingPreview.value = true
  try {
    const { data } = await hostService.previewBulkAction({
      selection: props.selection,
      action,
    })
    preview.value = data
  } catch (err) {
    const e = err as { response?: { data?: { message?: string } }; message?: string }
    error.value = e.response?.data?.message ?? e.message ?? t('hosts.bulk.previewError')
  } finally {
    loadingPreview.value = false
  }
}

async function apply() {
  const action = buildAction()
  if (!action || !preview.value || preview.value.total === 0) return
  applying.value = true
  error.value = null
  try {
    const { data } = await hostService.applyBulkAction({
      selection: props.selection,
      action,
      confirm: true,
    })
    result.value = data
    msg.success(t('hosts.bulk.applySuccess', { count: data.updated }))
    emit('applied', data)
  } catch (err) {
    const e = err as { response?: { data?: { message?: string } }; message?: string }
    error.value = e.response?.data?.message ?? e.message ?? t('hosts.bulk.applyError')
  } finally {
    applying.value = false
  }
}

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return `"${text.replace(/"/g, '""')}"`
}

function downloadResultJson() {
  if (!result.value) return
  downloadText(
    'nodeaccess-host-bulk-action-result.json',
    JSON.stringify(result.value, null, 2),
    'application/json',
  )
}

function downloadResultCsv() {
  if (!result.value) return
  const header = ['hostId', 'name', 'status', 'message']
  const lines = [
    header.join(','),
    ...result.value.rows.map((row) => [
      row.hostId,
      row.name,
      row.status,
      row.message,
    ].map(csvCell).join(',')),
  ]
  downloadText('nodeaccess-host-bulk-action-result.csv', lines.join('\n'), 'text/csv')
}

watch(
  () => [props.show, selectionKey.value, actionType.value, bastionId.value, pemKeyId.value, tagIds.value.join(',')],
  () => { void loadPreview() },
)
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="$t('hosts.bulk.title')"
    style="width:min(760px, calc(100vw - 32px))"
    :mask-closable="false"
    @close="emit('close')"
  >
    <div class="space-y-4">
      <NAlert type="info" :show-icon="false">
        {{ $t('hosts.bulk.selectedSummary', { count: selectedCount }) }}
      </NAlert>

      <div v-if="!result" class="grid gap-3 md:grid-cols-[180px_1fr]">
        <NSelect v-model:value="actionType" :options="actionOptions" />
        <NSelect
          v-if="actionType === 'set_bastion'"
          v-model:value="bastionId"
          :options="bastionOptions"
          :placeholder="$t('hosts.bulk.placeholders.bastion')"
          clearable
        />
        <NSelect
          v-else-if="actionType === 'set_pem_key'"
          v-model:value="pemKeyId"
          :options="pemKeyOptions"
          :placeholder="$t('hosts.bulk.placeholders.pemKey')"
          clearable
        />
        <NSelect
          v-else
          v-model:value="tagIds"
          :options="tagOptions"
          :placeholder="$t('hosts.bulk.placeholders.tags')"
          multiple
          filterable
        />
      </div>

      <NAlert v-if="error" type="error" :title="error" />

      <NAlert v-if="!result && !buildAction()" type="warning" :show-icon="false">
        {{ $t('hosts.bulk.chooseActionValue') }}
      </NAlert>

      <div v-if="!result && preview" class="space-y-3">
        <NAlert :type="preview.blocked > 0 ? 'warning' : preview.warnings > 0 ? 'info' : 'success'" :title="preview.actionLabel">
          <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span>{{ $t('hosts.bulk.previewTotal', { count: preview.total }) }}</span>
            <span v-if="preview.warnings > 0" class="text-amber-300">{{ $t('hosts.bulk.previewWarnings', { count: preview.warnings }) }}</span>
            <span v-if="preview.blocked > 0" class="text-red-300">{{ $t('hosts.bulk.previewBlocked', { count: preview.blocked }) }}</span>
          </div>
          <NText depth="3" class="mt-2 block text-xs">
            {{ $t('hosts.bulk.openSessionsNotice') }}
          </NText>
        </NAlert>

        <NDataTable
          :columns="previewColumns"
          :data="preview.sample"
          :row-key="(row) => row.hostId"
          size="small"
          :max-height="260"
          :loading="loadingPreview"
        />
        <NText v-if="preview.total > preview.sample.length" depth="3" class="block text-xs">
          {{ $t('hosts.bulk.sampleMore', { count: preview.total - preview.sample.length }) }}
        </NText>
      </div>

      <div v-if="result" class="space-y-3">
        <NAlert
          :type="result.failed === 0 && result.skipped === 0 ? 'success' : 'warning'"
          :title="$t('hosts.bulk.result.title')"
        >
          <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span class="text-emerald-300">{{ $t('hosts.bulk.result.updated', { count: result.updated }) }}</span>
            <span v-if="result.skipped > 0" class="text-amber-300">{{ $t('hosts.bulk.result.skipped', { count: result.skipped }) }}</span>
            <span v-if="result.failed > 0" class="text-red-300">{{ $t('hosts.bulk.result.failed', { count: result.failed }) }}</span>
          </div>
        </NAlert>

        <div class="flex flex-wrap justify-end gap-2">
          <NButton size="small" secondary @click="downloadResultCsv">
            {{ $t('hosts.bulk.result.downloadCsv') }}
          </NButton>
          <NButton size="small" secondary @click="downloadResultJson">
            {{ $t('hosts.bulk.result.downloadJson') }}
          </NButton>
        </div>

        <NDataTable
          v-if="resultProblemRows.length"
          :columns="resultColumns"
          :data="resultProblemRows"
          :row-key="(row) => row.hostId"
          size="small"
          :max-height="260"
        />
        <NText v-else depth="3" class="block text-xs">
          {{ $t('hosts.bulk.result.noProblems') }}
        </NText>
      </div>
    </div>

    <template #footer>
      <NSpace justify="end">
        <NButton @click="emit('close')">{{ result ? $t('common.close') : $t('common.cancel') }}</NButton>
        <NButton
          v-if="!result"
          type="primary"
          :loading="applying"
          :disabled="!preview || preview.total === 0 || preview.blocked > 0 || applying || loadingPreview"
          @click="apply"
        >
          {{ $t('hosts.bulk.apply', { count: preview?.total ?? selectedCount }) }}
        </NButton>
      </NSpace>
    </template>
  </NModal>
</template>
