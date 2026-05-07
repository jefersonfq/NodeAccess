<script setup lang="ts">
import { ref, onMounted, h, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NDataTable, NButton, NSpace, NAlert, NModal, NForm, NSpin,
  NFormItem, NInput, NInputNumber, NSelect, NTag, NDrawer,
  NDrawerContent, NCheckbox, NCheckboxGroup, useMessage, useDialog,
  NCollapseTransition, NText, NTooltip, NCard,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import type {
  WebhookSubscriptionPublic,
  WebhookDeliveryPublic,
  WebhookDeliveryStatus,
  WebhookTestResult,
} from '@nodeaccess/shared'
import { WEBHOOK_EVENT_TYPES } from '@nodeaccess/shared'
import { webhookService } from '@/services/webhook.service'
import SkeletonTable from '@/components/SkeletonTable.vue'

const { t } = useI18n()
const msg    = useMessage()
const dialog = useDialog()

// ── State ─────────────────────────────────────────────────────────────────

const subs    = ref<WebhookSubscriptionPublic[]>([])
const loading = ref(false)
const error   = ref<string | null>(null)
const showHelp = ref(false)

// modal
const showModal    = ref(false)
const modalLoading = ref(false)
const editingId    = ref<number | null>(null)
const form = ref({
  name:             '',
  description:      '',
  targetUrl:        '',
  httpMethod:       'POST' as 'POST' | 'PUT',
  subscribedEvents: [] as string[],
  secret:           '',
  timeoutMs:        5000,
  maxRetries:       5,
  payloadMode:      'AUTOMATIC' as 'AUTOMATIC' | 'CUSTOM',
  payloadTemplateJson: '',
  payloadSchemaJson:   '',
})
const showAdvanced  = ref(false)
const rotatedSecret = ref<string | null>(null)
const testResult    = ref<WebhookTestResult | null>(null)
const testLoading   = ref(false)

// deliveries drawer
const showDeliveries     = ref(false)
const deliveriesLoading  = ref(false)
const deliveriesError    = ref<string | null>(null)
const deliveries         = ref<WebhookDeliveryPublic[]>([])
const activeSubId        = ref<number | null>(null)
const activeSubName      = ref('')
const deliveryFilter     = ref<WebhookDeliveryStatus | ''>('')

// ── Help content ──────────────────────────────────────────────────────────

const helpSteps    = computed(() => ['configure', 'selectEvents', 'verify'])
const helpUseCases = computed(() => ['jira', 'slack', 'siem', 'cicd'])

// ── Options ───────────────────────────────────────────────────────────────

const EVENT_GROUP_DEFS = [
  { key: 'action_run',     labelKey: 'admin.webhooks.eventGroups.actionRun',     events: ['action_run.created', 'action_run.approved', 'action_run.completed', 'action_run.failed'] },
  { key: 'host',           labelKey: 'admin.webhooks.eventGroups.host',           events: ['host.created', 'host.updated', 'host.deleted'] },
  { key: 'user',           labelKey: 'admin.webhooks.eventGroups.user',           events: ['user.created', 'user.activated', 'user.deactivated'] },
  { key: 'mcp',            labelKey: 'admin.webhooks.eventGroups.mcp',            events: ['mcp_token.created', 'mcp_token.revoked', 'mcp_interactive_ssh_session.opened', 'mcp_interactive_ssh_session.closed'] },
  { key: 'diagnostic_run', labelKey: 'admin.webhooks.eventGroups.diagnosticRun', events: ['diagnostic_run.completed', 'diagnostic_run.failed'] },
  { key: 'ssh_session',    labelKey: 'admin.webhooks.eventGroups.sshSession',    events: ['ssh_session.started', 'ssh_session.ended'] },
  { key: 'port_forwarding', labelKey: 'admin.webhooks.eventGroups.portForwarding', events: ['port_forwarding.created', 'port_forwarding.deleted'] },
] as const

const eventGroups = computed(() =>
  EVENT_GROUP_DEFS.map((g) => ({
    key: g.key,
    label: t(g.labelKey),
    events: g.events.map((e) => ({
      value: e,
      description: t(`admin.webhooks.eventDescriptions.${e.replace(/\./g, '_')}`),
    })),
  }))
)

function isGroupAllSelected(group: { events: { value: string }[] }): boolean {
  return group.events.every((e) => form.value.subscribedEvents.includes(e.value))
}

function toggleGroup(group: { events: { value: string }[] }): void {
  const vals = group.events.map((e) => e.value)
  if (isGroupAllSelected(group)) {
    form.value.subscribedEvents = form.value.subscribedEvents.filter((e) => !vals.includes(e))
  } else {
    const toAdd = vals.filter((v) => !form.value.subscribedEvents.includes(v))
    form.value.subscribedEvents = [...form.value.subscribedEvents, ...toAdd]
  }
}

const methodOptions = [
  { label: 'POST', value: 'POST' },
  { label: 'PUT',  value: 'PUT' },
]

const deliveryFilterOptions = [
  { label: t('admin.webhooks.deliveries.allStatuses'), value: '' },
  { label: 'Pendente',   value: 'PENDING' },
  { label: 'Entregue',   value: 'DELIVERED' },
  { label: 'Agendado',   value: 'RETRY_SCHEDULED' },
  { label: 'Morto',      value: 'DEAD' },
]

// ── Columns ───────────────────────────────────────────────────────────────

function statusTag(status: WebhookSubscriptionPublic['status']) {
  const map: Record<string, { type: 'success' | 'warning' | 'error'; label: string }> = {
    ACTIVE: { type: 'success', label: t('admin.webhooks.status.active') },
    PAUSED: { type: 'warning', label: t('admin.webhooks.status.paused') },
    FAILED: { type: 'error',   label: t('admin.webhooks.status.failed') },
  }
  const v = map[status] ?? { type: 'default' as any, label: status }
  return h(NTag, { type: v.type, size: 'small' }, () => v.label)
}

function deliveryStatusTag(status: WebhookDeliveryStatus) {
  const map: Record<string, { type: 'success' | 'warning' | 'error' | 'info' | 'default'; label: string }> = {
    DELIVERED:       { type: 'success', label: 'Entregue' },
    PENDING:         { type: 'default', label: 'Pendente' },
    PROCESSING:      { type: 'info',    label: 'Processando' },
    RETRY_SCHEDULED: { type: 'warning', label: 'Agendado' },
    DEAD:            { type: 'error',   label: 'Morto' },
  }
  const v = map[status] ?? { type: 'default' as any, label: status }
  return h(NTag, { type: v.type, size: 'small' }, () => v.label)
}

const columns = computed<DataTableColumns<WebhookSubscriptionPublic>>(() => [
  { title: t('admin.webhooks.columns.name'), key: 'name', width: 180 },
  {
    title: t('admin.webhooks.columns.status'), key: 'status', width: 100,
    render: (r) => statusTag(r.status),
  },
  {
    title: t('admin.webhooks.columns.url'), key: 'targetUrl',
    render: (r) => h(NTooltip, { trigger: 'hover' }, {
      trigger: () => h(NText, { depth: 3, style: 'font-size:12px;max-width:220px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, () => r.targetUrl),
      default: () => r.targetUrl,
    }),
  },
  {
    title: t('admin.webhooks.columns.events'), key: 'events', width: 130,
    render: (r) => h(NText, { depth: 3, style: 'font-size:12px' }, () =>
      r.subscribedEvents.length === 1
        ? r.subscribedEvents[0]
        : `${r.subscribedEvents[0]} +${r.subscribedEvents.length - 1}`
    ),
  },
  {
    title: t('admin.webhooks.columns.lastSuccess'), key: 'lastSuccessAt', width: 140,
    render: (r) => r.lastSuccessAt ? new Date(r.lastSuccessAt).toLocaleString() : '—',
  },
  {
    title: t('admin.webhooks.columns.lastFailure'), key: 'lastFailureAt', width: 140,
    render: (r) => r.lastFailureAt ? new Date(r.lastFailureAt).toLocaleString() : '—',
  },
  {
    title: t('admin.webhooks.columns.actions'), key: 'actions', width: 220,
    render: (row) => h(NSpace, { size: 4 }, () => [
      h(NButton, { size: 'small', onClick: () => openEdit(row) }, () => t('admin.webhooks.actions.edit')),
      row.status === 'ACTIVE'
        ? h(NButton, { size: 'small', type: 'warning', onClick: () => pause(row) }, () => t('admin.webhooks.actions.pause'))
        : h(NButton, { size: 'small', type: 'success', onClick: () => activate(row) }, () => t('admin.webhooks.actions.activate')),
      h(NButton, { size: 'small', onClick: () => openDeliveries(row) }, () => t('admin.webhooks.actions.deliveries')),
      h(NButton, { size: 'small', type: 'error', onClick: () => remove(row) }, () => t('admin.webhooks.actions.delete')),
    ]),
  },
])

const deliveryColumns = computed<DataTableColumns<WebhookDeliveryPublic>>(() => [
  { title: 'Evento', key: 'eventType', width: 200 },
  {
    title: 'Status', key: 'status', width: 120,
    render: (r) => deliveryStatusTag(r.status),
  },
  { title: 'HTTP', key: 'responseStatus', width: 70, render: (r) => r.responseStatus ?? '—' },
  { title: 'Tentativas', key: 'attemptCount', width: 90 },
  { title: 'Latência', key: 'responseLatencyMs', width: 90, render: (r) => r.responseLatencyMs ? `${r.responseLatencyMs}ms` : '—' },
  {
    title: 'Data', key: 'createdAt', width: 150,
    render: (r) => new Date(r.createdAt).toLocaleString(),
  },
  {
    title: '', key: 'retry', width: 80,
    render: (row) => row.status === 'DEAD'
      ? h(NButton, { size: 'small', onClick: () => retryDelivery(row) }, () => 'Reenviar')
      : null,
  },
])

// ── Load ──────────────────────────────────────────────────────────────────

async function load() {
  loading.value = true
  error.value   = null
  try {
    const { data } = await webhookService.listSubscriptions()
    subs.value = data
  } catch {
    error.value = t('admin.webhooks.loadError')
  } finally {
    loading.value = false
  }
}

onMounted(load)

// ── Modal ─────────────────────────────────────────────────────────────────

function openCreate() {
  editingId.value = null
  rotatedSecret.value = null
  testResult.value    = null
  Object.assign(form.value, {
    name: '', description: '', targetUrl: '', httpMethod: 'POST',
    subscribedEvents: [], secret: '', timeoutMs: 5000, maxRetries: 5,
    payloadMode: 'AUTOMATIC', payloadTemplateJson: '', payloadSchemaJson: '',
  })
  showAdvanced.value = false
  showModal.value    = true
}

function openEdit(sub: WebhookSubscriptionPublic) {
  editingId.value  = sub.id
  rotatedSecret.value = null
  testResult.value    = null
  Object.assign(form.value, {
    name:             sub.name,
    description:      sub.description ?? '',
    targetUrl:        sub.targetUrl,
    httpMethod:       sub.httpMethod as 'POST' | 'PUT',
    subscribedEvents: [...sub.subscribedEvents],
    secret:           '',
    timeoutMs:        sub.timeoutMs,
    maxRetries:       sub.maxRetries,
    payloadMode:      sub.payloadMode,
    payloadTemplateJson: '',
    payloadSchemaJson:   '',
  })
  showAdvanced.value = sub.payloadMode === 'CUSTOM'
  showModal.value    = true
}

async function save() {
  if (!form.value.name || !form.value.targetUrl || form.value.subscribedEvents.length === 0) {
    msg.warning(t('admin.webhooks.messages.requiredFields'))
    return
  }

  modalLoading.value = true
  try {
    const dto = {
      name:             form.value.name,
      description:      form.value.description || undefined,
      targetUrl:        form.value.targetUrl,
      httpMethod:       form.value.httpMethod,
      subscribedEvents: form.value.subscribedEvents as any,
      secret:           form.value.secret || undefined,
      timeoutMs:        form.value.timeoutMs,
      maxRetries:       form.value.maxRetries,
      payloadMode:      form.value.payloadMode,
      payloadTemplateJson: form.value.payloadTemplateJson || undefined,
      payloadSchemaJson:   form.value.payloadSchemaJson || undefined,
    }

    if (editingId.value) {
      await webhookService.updateSubscription(editingId.value, dto)
      msg.success(t('admin.webhooks.messages.updated'))
    } else {
      await webhookService.createSubscription(dto)
      msg.success(t('admin.webhooks.messages.created'))
    }
    showModal.value = false
    load()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.webhooks.messages.saveError'))
  } finally {
    modalLoading.value = false
  }
}

async function rotateSecret() {
  if (!editingId.value) return
  try {
    const { data } = await webhookService.rotateSecret(editingId.value)
    rotatedSecret.value = data.secret
    msg.success(t('admin.webhooks.messages.secretRotated'))
  } catch {
    msg.error(t('admin.webhooks.messages.rotateError'))
  }
}

async function runTest() {
  if (!editingId.value) return
  testResult.value  = null
  testLoading.value = true
  try {
    const { data } = await webhookService.testDelivery(editingId.value)
    testResult.value = data
  } catch {
    testResult.value = { ok: false, status: null, latencyMs: 0, snippet: null, error: t('admin.webhooks.messages.testError') }
  } finally {
    testLoading.value = false
  }
}

// ── Pause / Activate ──────────────────────────────────────────────────────

async function pause(sub: WebhookSubscriptionPublic) {
  try {
    await webhookService.pauseSubscription(sub.id)
    msg.success(t('admin.webhooks.messages.paused'))
    load()
  } catch {
    msg.error(t('admin.webhooks.messages.pauseError'))
  }
}

async function activate(sub: WebhookSubscriptionPublic) {
  try {
    await webhookService.activateSubscription(sub.id)
    msg.success(t('admin.webhooks.messages.activated'))
    load()
  } catch {
    msg.error(t('admin.webhooks.messages.activateError'))
  }
}

// ── Delete ────────────────────────────────────────────────────────────────

async function remove(sub: WebhookSubscriptionPublic) {
  dialog.warning({
    title:        t('admin.webhooks.deleteDialog.title', { name: sub.name }),
    content:      t('admin.webhooks.deleteDialog.content'),
    positiveText: t('admin.webhooks.deleteDialog.confirm'),
    negativeText: t('admin.webhooks.deleteDialog.cancel'),
    onPositiveClick: async () => {
      try {
        await webhookService.deleteSubscription(sub.id)
        msg.success(t('admin.webhooks.messages.deleted'))
        load()
      } catch (err: unknown) {
        const e = err as { response?: { data?: { message?: string } } }
        msg.error(e.response?.data?.message ?? t('admin.webhooks.messages.deleteError'))
      }
    },
  })
}

// ── Deliveries ────────────────────────────────────────────────────────────

async function openDeliveries(sub: WebhookSubscriptionPublic) {
  activeSubId.value   = sub.id
  activeSubName.value = sub.name
  deliveryFilter.value = ''
  showDeliveries.value = true
  await loadDeliveries()
}

async function loadDeliveries() {
  if (!activeSubId.value) return
  deliveriesLoading.value = true
  deliveriesError.value   = null
  try {
    const { data } = await webhookService.listDeliveries(
      activeSubId.value,
      deliveryFilter.value || undefined,
    )
    deliveries.value = data
  } catch {
    deliveriesError.value = t('admin.webhooks.deliveries.loadError')
  } finally {
    deliveriesLoading.value = false
  }
}

async function retryDelivery(delivery: WebhookDeliveryPublic) {
  if (!activeSubId.value) return
  try {
    await webhookService.retryDelivery(activeSubId.value, delivery.id)
    msg.success(t('admin.webhooks.deliveries.retrySuccess'))
    loadDeliveries()
  } catch {
    msg.error(t('admin.webhooks.deliveries.retryError'))
  }
}
</script>

<template>
  <div class="p-6 space-y-6">

    <!-- ── Page header ──────────────────────────────────────────────────── -->
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold text-white">{{ $t('admin.webhooks.title') }}</h1>
        <p class="text-gray-400 mt-1 text-sm">{{ $t('admin.webhooks.subtitle') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <NButton secondary @click="showHelp = true">{{ $t('admin.webhooks.help.action') }}</NButton>
        <NButton type="primary" @click="openCreate">{{ $t('admin.webhooks.newWebhook') }}</NButton>
      </div>
    </div>

    <!-- ── Error ────────────────────────────────────────────────────────── -->
    <NAlert v-if="error" type="error" :title="error" />

    <!-- ── Table ────────────────────────────────────────────────────────── -->
    <div class="rounded-xl border border-gray-800 overflow-hidden">
      <SkeletonTable v-if="loading && subs.length === 0" :rows="4" :columns="6" />
      <NSpin v-else :show="loading">
        <NDataTable
          :columns="columns"
          :data="subs"
          :row-key="(r) => r.id"
          :bordered="false"
          :scroll-x="1100"
        >
          <template v-if="!loading && subs.length === 0" #empty>
            <div class="py-16 flex flex-col items-center gap-3">
              <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#444" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/>
                <path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/>
                <path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>
              </svg>
              <p class="text-sm text-gray-500">{{ $t('admin.webhooks.emptyDesc') }}</p>
              <NButton type="primary" size="small" @click="openCreate">{{ $t('admin.webhooks.createFirst') }}</NButton>
            </div>
          </template>
        </NDataTable>
      </NSpin>
    </div>

    <!-- ── Create / Edit modal ──────────────────────────────────────────── -->
    <NModal
      v-model:show="showModal"
      preset="card"
      :title="editingId ? $t('admin.webhooks.modal.editTitle') : $t('admin.webhooks.modal.createTitle')"
      style="width: 700px"
    >
      <NForm @submit.prevent="save">

        <!-- Destino -->
        <div class="rounded-lg border border-white/5 bg-white/[0.02] p-4 mb-4 space-y-3">
          <p class="text-xs font-semibold uppercase tracking-wide" style="color:#666">{{ $t('admin.webhooks.modal.sectionDestination') }}</p>
          <NFormItem :label="$t('admin.webhooks.modal.nameLabel')" :show-feedback="false">
            <NInput v-model:value="form.name" :placeholder="$t('admin.webhooks.modal.namePlaceholder')" />
          </NFormItem>
          <NFormItem :label="$t('admin.webhooks.modal.descriptionLabel')" :show-feedback="false">
            <NInput v-model:value="form.description" type="textarea" :rows="2" />
          </NFormItem>
          <NFormItem :label="$t('admin.webhooks.modal.urlLabel')" :show-feedback="false">
            <div class="w-full">
              <NInput v-model:value="form.targetUrl" placeholder="https://..." />
              <NText depth="3" style="font-size:11px;display:block;margin-top:4px;line-height:1.4">
                {{ $t('admin.webhooks.modal.urlHelp') }}
              </NText>
            </div>
          </NFormItem>
        </div>

        <!-- Entrega -->
        <div class="rounded-lg border border-white/5 bg-white/[0.02] p-4 mb-4 space-y-3">
          <p class="text-xs font-semibold uppercase tracking-wide" style="color:#666">{{ $t('admin.webhooks.modal.sectionDelivery') }}</p>
          <div class="grid grid-cols-3 gap-3">
            <NFormItem :label="$t('admin.webhooks.modal.methodLabel')" :show-feedback="false">
              <NSelect v-model:value="form.httpMethod" :options="methodOptions" />
            </NFormItem>
            <NFormItem :label="$t('admin.webhooks.modal.timeoutLabel')" :show-feedback="false">
              <div class="w-full">
                <NInputNumber v-model:value="form.timeoutMs" :min="1000" :max="30000" :step="500" style="width:100%" />
                <NText depth="3" style="font-size:11px;display:block;margin-top:4px;line-height:1.4">
                  {{ $t('admin.webhooks.modal.timeoutHelp') }}
                </NText>
              </div>
            </NFormItem>
            <NFormItem :label="$t('admin.webhooks.modal.retriesLabel')" :show-feedback="false">
              <div class="w-full">
                <NInputNumber v-model:value="form.maxRetries" :min="0" :max="10" style="width:100%" />
                <NText depth="3" style="font-size:11px;display:block;margin-top:4px;line-height:1.4">
                  {{ $t('admin.webhooks.modal.retriesHelp') }}
                </NText>
              </div>
            </NFormItem>
          </div>
        </div>

        <!-- Eventos -->
        <div class="rounded-lg border border-white/5 bg-white/[0.02] p-4 mb-4">
          <div class="flex items-center gap-2 mb-3">
            <p class="text-xs font-semibold uppercase tracking-wide" style="color:#666">
              {{ $t('admin.webhooks.modal.eventsLabel') }}
            </p>
            <NText depth="3" style="font-size:11px">
              ({{ form.subscribedEvents.length }} / {{ WEBHOOK_EVENT_TYPES.length }})
            </NText>
          </div>
          <NCheckboxGroup v-model:value="form.subscribedEvents" class="w-full">
            <div class="space-y-4">
              <div v-for="group in eventGroups" :key="group.key">
                <div class="flex items-center gap-2 mb-2">
                  <span class="text-xs font-semibold uppercase tracking-wide" style="color:#666">{{ group.label }}</span>
                  <div class="flex-1 h-px" style="background:#2a2a2a"></div>
                  <NButton text size="tiny" style="font-size:11px" @click="toggleGroup(group)">
                    {{ isGroupAllSelected(group) ? $t('admin.webhooks.modal.deselectGroup') : $t('admin.webhooks.modal.selectGroup') }}
                  </NButton>
                </div>
                <div class="grid grid-cols-2 gap-y-2">
                  <div v-for="e in group.events" :key="e.value" class="flex items-center gap-1.5">
                    <NCheckbox :value="e.value" :label="e.value" />
                    <NTooltip trigger="hover" :delay="150" placement="right" style="max-width:260px">
                      <template #trigger>
                        <span style="cursor:help;color:#555;font-size:11px;line-height:1;user-select:none">ⓘ</span>
                      </template>
                      {{ e.description }}
                    </NTooltip>
                  </div>
                </div>
              </div>
            </div>
          </NCheckboxGroup>
        </div>

        <!-- Segurança -->
        <div class="rounded-lg border border-white/5 bg-white/[0.02] p-4 mb-4 space-y-3">
          <p class="text-xs font-semibold uppercase tracking-wide" style="color:#666">{{ $t('admin.webhooks.modal.sectionSecurity') }}</p>
          <NFormItem :label="$t('admin.webhooks.modal.secretLabel')" :show-feedback="false">
            <div class="w-full">
              <div class="flex gap-2">
                <NInput
                  v-model:value="form.secret"
                  type="password"
                  show-password-on="click"
                  :placeholder="editingId ? $t('admin.webhooks.modal.secretPlaceholderEdit') : $t('admin.webhooks.modal.secretPlaceholder')"
                  style="flex:1"
                />
                <NButton v-if="editingId" @click="rotateSecret">{{ $t('admin.webhooks.modal.rotateSecret') }}</NButton>
              </div>
              <NText depth="3" style="font-size:11px;display:block;margin-top:4px;line-height:1.4">
                {{ $t('admin.webhooks.modal.secretHelp') }}
              </NText>
            </div>
          </NFormItem>
          <NAlert v-if="rotatedSecret" type="warning" :title="$t('admin.webhooks.modal.newSecretTitle')">
            <code class="text-xs break-all">{{ rotatedSecret }}</code>
            <p class="text-xs mt-1 text-gray-400">{{ $t('admin.webhooks.modal.newSecretHint') }}</p>
          </NAlert>
        </div>

        <!-- Avançado -->
        <div class="mb-4">
          <NButton text size="small" @click="showAdvanced = !showAdvanced">
            {{ showAdvanced ? $t('admin.webhooks.modal.hideAdvanced') : $t('admin.webhooks.modal.showAdvanced') }}
          </NButton>
          <NCollapseTransition :show="showAdvanced">
            <div class="rounded-lg border border-white/5 bg-white/[0.02] p-4 mt-2 space-y-3">
              <NFormItem :label="$t('admin.webhooks.modal.payloadModeLabel')" :show-feedback="false">
                <NSelect
                  v-model:value="form.payloadMode"
                  :options="[
                    { label: $t('admin.webhooks.modal.payloadAutomatic'), value: 'AUTOMATIC' },
                    { label: $t('admin.webhooks.modal.payloadCustom'), value: 'CUSTOM' },
                  ]"
                />
              </NFormItem>
              <template v-if="form.payloadMode === 'CUSTOM'">
                <NFormItem :label="$t('admin.webhooks.modal.payloadTemplateLabel')" :show-feedback="false">
                  <NInput v-model:value="form.payloadTemplateJson" type="textarea" :rows="4" placeholder='{"event": "{{event.type}}"}' style="font-family:monospace;font-size:12px" />
                </NFormItem>
                <NFormItem :label="$t('admin.webhooks.modal.payloadSchemaLabel')" :show-feedback="false">
                  <NInput v-model:value="form.payloadSchemaJson" type="textarea" :rows="3" placeholder='{"type": "object"}' style="font-family:monospace;font-size:12px" />
                </NFormItem>
              </template>
            </div>
          </NCollapseTransition>
        </div>

        <!-- Resultado do teste -->
        <NAlert
          v-if="testResult"
          :type="testResult.ok ? 'success' : 'error'"
          class="mb-4"
          :show-icon="true"
        >
          <div class="text-sm">
            <span v-if="testResult.status">HTTP {{ testResult.status }}</span>
            <span v-if="testResult.status"> · {{ testResult.latencyMs }}ms</span>
            <span v-if="!testResult.status && testResult.error">{{ testResult.error }}</span>
            <code v-if="testResult.snippet" class="block text-xs mt-1 opacity-60 break-all">{{ testResult.snippet }}</code>
          </div>
        </NAlert>

        <!-- Ações -->
        <div class="flex justify-end gap-2">
          <NButton @click="showModal = false; testResult = null">{{ $t('admin.webhooks.modal.cancel') }}</NButton>
          <NButton v-if="editingId" :loading="testLoading" @click="runTest">
            {{ $t('admin.webhooks.modal.test') }}
          </NButton>
          <NButton type="primary" :loading="modalLoading" @click="save">
            {{ editingId ? $t('admin.webhooks.modal.save') : $t('admin.webhooks.modal.create') }}
          </NButton>
        </div>

      </NForm>
    </NModal>

    <!-- ── Help modal ────────────────────────────────────────────────────── -->
    <NModal v-model:show="showHelp">
      <NCard
        style="width: min(860px, calc(100vw - 32px))"
        :title="$t('admin.webhooks.help.title')"
        :bordered="false"
        role="dialog"
        aria-modal="true"
      >
        <div class="max-h-[78vh] overflow-y-auto pr-1 space-y-6">

          <!-- Como funciona (3 passos) -->
          <div>
            <p class="text-sm font-semibold text-white mb-1">{{ $t('admin.webhooks.help.howTitle') }}</p>
            <NText depth="3" class="block text-sm mb-3">{{ $t('admin.webhooks.help.howDesc') }}</NText>
            <div class="grid gap-3 md:grid-cols-3">
              <div
                v-for="step in helpSteps"
                :key="step"
                class="rounded-lg border border-white/10 bg-white/[0.02] p-3"
              >
                <NText strong class="block text-sm">{{ $t(`admin.webhooks.help.steps.${step}.title`) }}</NText>
                <NText depth="3" class="block text-xs mt-1">{{ $t(`admin.webhooks.help.steps.${step}.description`) }}</NText>
              </div>
            </div>
          </div>

          <!-- Casos de uso -->
          <div>
            <p class="text-sm font-semibold text-white mb-3">{{ $t('admin.webhooks.help.useCasesTitle') }}</p>
            <div class="grid gap-3 md:grid-cols-2">
              <div
                v-for="uc in helpUseCases"
                :key="uc"
                class="rounded-lg border border-white/10 bg-white/[0.02] p-4"
              >
                <NText strong class="block text-sm mb-1">{{ $t(`admin.webhooks.help.useCases.${uc}.title`) }}</NText>
                <NText depth="3" class="block text-xs leading-relaxed">{{ $t(`admin.webhooks.help.useCases.${uc}.description`) }}</NText>
              </div>
            </div>
          </div>

          <!-- Grupos de eventos -->
          <div>
            <p class="text-sm font-semibold text-white mb-1">{{ $t('admin.webhooks.help.eventGroupsTitle') }}</p>
            <NText depth="3" class="block text-sm mb-3">{{ $t('admin.webhooks.help.eventGroupsDesc') }}</NText>
            <div class="overflow-hidden rounded-lg border border-white/10">
              <div
                v-for="g in eventGroups"
                :key="g.key"
                class="grid border-b border-white/10 p-3 last:border-b-0 md:grid-cols-[160px_1fr]"
              >
                <NText strong class="text-sm">{{ g.label }}</NText>
                <div class="flex flex-wrap gap-1 mt-1 md:mt-0">
                  <NTag v-for="e in g.events" :key="e.value" size="small" :bordered="false" style="font-size:11px;font-family:monospace">
                    {{ e.value }}
                  </NTag>
                </div>
              </div>
            </div>
          </div>

          <div class="flex justify-end pt-1">
            <NButton @click="showHelp = false">{{ $t('admin.webhooks.help.close') }}</NButton>
          </div>
        </div>
      </NCard>
    </NModal>

    <!-- ── Deliveries drawer ─────────────────────────────────────────────── -->
    <NDrawer v-model:show="showDeliveries" :width="740" placement="right">
      <NDrawerContent :title="`${$t('admin.webhooks.deliveries.title')} — ${activeSubName}`" closable>
        <div class="flex items-center gap-3 mb-4">
          <NSelect
            v-model:value="deliveryFilter"
            :options="deliveryFilterOptions"
            style="width:180px"
            @update:value="loadDeliveries"
          />
          <NButton size="small" @click="loadDeliveries">{{ $t('admin.webhooks.deliveries.refresh') }}</NButton>
        </div>

        <NAlert v-if="deliveriesError" type="error" class="mb-4" :title="deliveriesError" />

        <NSpin :show="deliveriesLoading">
          <NDataTable
            :columns="deliveryColumns"
            :data="deliveries"
            :row-key="(r) => r.id"
            :bordered="false"
            size="small"
            :scroll-x="700"
          >
            <template v-if="!deliveriesLoading && deliveries.length === 0" #empty>
              <div class="py-8 text-center text-gray-500 text-sm">
                {{ $t('admin.webhooks.deliveries.empty') }}
              </div>
            </template>
          </NDataTable>
        </NSpin>
      </NDrawerContent>
    </NDrawer>

  </div>
</template>
