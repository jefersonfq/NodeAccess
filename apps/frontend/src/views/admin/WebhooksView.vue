<script setup lang="ts">
import { ref, onMounted, h, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NDataTable, NButton, NSpace, NAlert, NModal, NForm, NSpin,
  NFormItem, NInput, NInputNumber, NSelect, NTag, NDrawer,
  NDrawerContent, NCheckbox, NCheckboxGroup, useMessage, useDialog,
  NCollapseTransition, NText, NTooltip, NCard, NDropdown,
  NDescriptions, NDescriptionsItem,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import type {
  WebhookSubscriptionPublic,
  WebhookDeliveryPublic,
  WebhookDeliveryStatus,
  WebhookTestResult,
  InboundWebhookEndpointPublic,
  InboundWebhookReceiptPublic,
  InboundWebhookReceiptStatus,
} from '@nodeaccess/shared'
import { WEBHOOK_EVENT_TYPES } from '@nodeaccess/shared'
import { webhookService } from '@/services/webhook.service'
import { inboundWebhookService } from '@/services/inbound-webhook.service'
import SkeletonTable from '@/components/SkeletonTable.vue'

const { t } = useI18n()
const msg    = useMessage()
const dialog = useDialog()

// ── State ─────────────────────────────────────────────────────────────────

const subs    = ref<WebhookSubscriptionPublic[]>([])
const loading = ref(false)
const error   = ref<string | null>(null)
const showHelp = ref(false)

const inboundEndpoints = ref<InboundWebhookEndpointPublic[]>([])
const inboundLoading = ref(false)
const inboundError = ref<string | null>(null)
const showInboundModal = ref(false)
const inboundModalLoading = ref(false)
const inboundCreatedToken = ref<string | null>(null)
const inboundForm = ref({
  provider: 'monitoring',
  name: '',
  description: '',
  secret: '',
  allowedEventTypesText: 'host.unavailable\nhost.recovered',
})

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
const showOutboundFieldHelp = ref(false)
const showInboundFieldHelp = ref(false)

// deliveries drawer
const showDeliveries     = ref(false)
const deliveriesLoading  = ref(false)
const deliveriesError    = ref<string | null>(null)
const deliveries         = ref<WebhookDeliveryPublic[]>([])
const activeSubId        = ref<number | null>(null)
const activeSubName      = ref('')
const deliveryFilter     = ref<WebhookDeliveryStatus | ''>('')

const showInboundReceipts = ref(false)
const inboundReceiptsLoading = ref(false)
const inboundReceiptsError = ref<string | null>(null)
const inboundReceipts = ref<InboundWebhookReceiptPublic[]>([])
const activeInboundEndpointId = ref<number | null>(null)
const activeInboundEndpointName = ref('')
const inboundReceiptFilter = ref<InboundWebhookReceiptStatus | ''>('')
const activeInboundReceipt = ref<InboundWebhookReceiptPublic | null>(null)

// ── Help content ──────────────────────────────────────────────────────────

const webhookTypeCards = computed(() => [
  {
    key: 'outbound',
    tone: 'success',
    title: t('admin.webhooks.types.outbound.title'),
    direction: t('admin.webhooks.types.outbound.direction'),
    description: t('admin.webhooks.types.outbound.description'),
    examples: [
      t('admin.webhooks.types.outbound.examples.siem'),
      t('admin.webhooks.types.outbound.examples.ticket'),
      t('admin.webhooks.types.outbound.examples.chat'),
    ],
    setupSteps: ['target', 'events', 'security', 'deliveries'],
    practices: ['leastEvents', 'https', 'hmac', 'monitorFailures'],
  },
  {
    key: 'inbound',
    tone: 'info',
    title: t('admin.webhooks.types.inbound.title'),
    direction: t('admin.webhooks.types.inbound.direction'),
    description: t('admin.webhooks.types.inbound.description'),
    examples: [
      t('admin.webhooks.types.inbound.examples.monitoring'),
      t('admin.webhooks.types.inbound.examples.cmdb'),
      t('admin.webhooks.types.inbound.examples.approval'),
    ],
    setupSteps: ['endpoint', 'token', 'signature', 'receipts'],
    practices: ['idempotency', 'restrictEvents', 'protectToken', 'noCriticalAutomation'],
  },
])

const outboundFieldHelpKeys = [
  'name',
  'description',
  'targetUrl',
  'events',
  'secret',
  'timeout',
  'retries',
  'payloadMode',
] as const

const inboundFieldHelpKeys = [
  'provider',
  'name',
  'description',
  'secret',
  'allowedEvents',
  'endpointToken',
  'idempotency',
  'receipts',
] as const

const createWebhookOptions = computed(() => [
  { label: t('admin.webhooks.createMenu.outbound'), key: 'outbound' },
  { label: t('admin.webhooks.createMenu.inbound'), key: 'inbound' },
])

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

const inboundReceiptFilterOptions = [
  { label: t('admin.webhooks.inbound.receipts.allStatuses'), value: '' },
  { label: 'Accepted', value: 'ACCEPTED' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'Processed', value: 'PROCESSED' },
  { label: 'Failed', value: 'FAILED' },
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

function inboundStatusTag(status: InboundWebhookEndpointPublic['status']) {
  const map: Record<string, { type: 'success' | 'warning' | 'error'; label: string }> = {
    ACTIVE: { type: 'success', label: t('admin.webhooks.status.active') },
    PAUSED: { type: 'warning', label: t('admin.webhooks.status.paused') },
    REVOKED: { type: 'error', label: t('admin.webhooks.inbound.status.revoked') },
  }
  const v = map[status] ?? { type: 'warning' as const, label: status }
  return h(NTag, { type: v.type, size: 'small' }, () => v.label)
}

function inboundReceiptStatusTag(status: InboundWebhookReceiptStatus) {
  const v = inboundReceiptStatusMeta(status)
  return h(NTag, { type: v.type, size: 'small' }, () => v.label)
}

function inboundReceiptStatusMeta(status: InboundWebhookReceiptStatus) {
  const map: Record<string, { type: 'success' | 'warning' | 'error' | 'info' | 'default'; label: string }> = {
    ACCEPTED: { type: 'success', label: t('admin.webhooks.inbound.receipts.status.accepted') },
    REJECTED: { type: 'error', label: t('admin.webhooks.inbound.receipts.status.rejected') },
    RECEIVED: { type: 'default', label: t('admin.webhooks.inbound.receipts.status.received') },
    PROCESSING: { type: 'info', label: t('admin.webhooks.inbound.receipts.status.processing') },
    PROCESSED: { type: 'success', label: t('admin.webhooks.inbound.receipts.status.processed') },
    FAILED: { type: 'error', label: t('admin.webhooks.inbound.receipts.status.failed') },
    IGNORED: { type: 'warning', label: t('admin.webhooks.inbound.receipts.status.ignored') },
  }
  return map[status] ?? { type: 'default' as const, label: status }
}

function inboundSignatureTag(valid: boolean) {
  return h(
    NTag,
    { type: valid ? 'success' : 'warning', size: 'small', bordered: false },
    () => valid
      ? t('admin.webhooks.inbound.receipts.signatureOk')
      : t('admin.webhooks.inbound.receipts.signatureMissing'),
  )
}

function formatDateTime(value?: string | Date | null) {
  return value ? new Date(value).toLocaleString() : '—'
}

const inboundReceiptStats = computed(() => ({
  total: inboundReceipts.value.length,
  accepted: inboundReceipts.value.filter((r) => r.status === 'ACCEPTED' || r.status === 'PROCESSED').length,
  rejected: inboundReceipts.value.filter((r) => r.status === 'REJECTED' || r.status === 'FAILED').length,
}))

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

const inboundColumns = computed<DataTableColumns<InboundWebhookEndpointPublic>>(() => [
  { title: t('admin.webhooks.columns.name'), key: 'name', width: 180 },
  { title: t('admin.webhooks.inbound.columns.provider'), key: 'provider', width: 130 },
  {
    title: t('admin.webhooks.columns.status'), key: 'status', width: 110,
    render: (r) => inboundStatusTag(r.status),
  },
  {
    title: t('admin.webhooks.inbound.columns.events'), key: 'allowedEventTypes', width: 170,
    render: (r) => r.allowedEventTypes.length > 0 ? `${r.allowedEventTypes[0]}${r.allowedEventTypes.length > 1 ? ` +${r.allowedEventTypes.length - 1}` : ''}` : 'Any',
  },
  {
    title: t('admin.webhooks.inbound.columns.lastReceived'), key: 'lastReceivedAt', width: 150,
    render: (r) => r.lastReceivedAt ? new Date(r.lastReceivedAt).toLocaleString() : '—',
  },
  {
    title: t('admin.webhooks.columns.actions'), key: 'actions', width: 230,
    render: (row) => h(NSpace, { size: 4 }, () => [
      row.status === 'ACTIVE'
        ? h(NButton, { size: 'small', type: 'warning', onClick: () => pauseInbound(row) }, () => t('admin.webhooks.actions.pause'))
        : row.status === 'PAUSED'
          ? h(NButton, { size: 'small', type: 'success', onClick: () => activateInbound(row) }, () => t('admin.webhooks.actions.activate'))
          : null,
      h(NButton, { size: 'small', onClick: () => openInboundReceipts(row) }, () => t('admin.webhooks.inbound.actions.receipts')),
      row.status !== 'REVOKED'
        ? h(NButton, { size: 'small', type: 'error', onClick: () => revokeInbound(row) }, () => t('admin.webhooks.inbound.actions.revoke'))
        : null,
    ]),
  },
])

const inboundReceiptColumns = computed<DataTableColumns<InboundWebhookReceiptPublic>>(() => [
  { title: t('admin.webhooks.inbound.receipts.columns.event'), key: 'eventType', width: 180 },
  {
    title: t('admin.webhooks.inbound.receipts.columns.status'), key: 'status', width: 120,
    render: (r) => inboundReceiptStatusTag(r.status),
  },
  { title: t('admin.webhooks.inbound.receipts.columns.idempotency'), key: 'idempotencyKey', width: 180, render: (r) => r.idempotencyKey ?? '—' },
  { title: t('admin.webhooks.inbound.receipts.columns.signature'), key: 'signatureValid', width: 120, render: (r) => inboundSignatureTag(r.signatureValid) },
  {
    title: t('admin.webhooks.inbound.receipts.columns.error'), key: 'errorCode', width: 170,
    render: (r) => r.errorCode
      ? h(NTag, { type: 'error', size: 'small', bordered: false }, () => r.errorCode)
      : '—',
  },
  { title: t('admin.webhooks.inbound.receipts.columns.receivedAt'), key: 'receivedAt', width: 160, render: (r) => formatDateTime(r.receivedAt) },
  {
    title: '', key: 'actions', width: 95,
    render: (row) => h(NButton, { size: 'small', onClick: () => { activeInboundReceipt.value = row } }, () => t('admin.webhooks.inbound.receipts.details')),
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

async function loadInbound() {
  inboundLoading.value = true
  inboundError.value = null
  try {
    const { data } = await inboundWebhookService.listEndpoints()
    inboundEndpoints.value = data
  } catch {
    inboundError.value = t('admin.webhooks.inbound.loadError')
  } finally {
    inboundLoading.value = false
  }
}

onMounted(() => {
  load()
  loadInbound()
})

// ── Modal ─────────────────────────────────────────────────────────────────

function handleCreateWebhookSelect(key: string | number) {
  if (key === 'inbound') {
    openInboundCreate()
    return
  }
  openCreate()
}

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

function openInboundCreate() {
  inboundCreatedToken.value = null
  Object.assign(inboundForm.value, {
    provider: 'monitoring',
    name: '',
    description: '',
    secret: '',
    allowedEventTypesText: 'host.unavailable\nhost.recovered',
  })
  showInboundModal.value = true
}

function inboundAllowedEvents(): string[] {
  return inboundForm.value.allowedEventTypesText
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
}

async function createInboundEndpoint() {
  if (!inboundForm.value.provider || !inboundForm.value.name) {
    msg.warning(t('admin.webhooks.inbound.messages.requiredFields'))
    return
  }

  inboundModalLoading.value = true
  try {
    const { data } = await inboundWebhookService.createEndpoint({
      provider: inboundForm.value.provider,
      name: inboundForm.value.name,
      description: inboundForm.value.description || undefined,
      secret: inboundForm.value.secret || undefined,
      allowedEventTypes: inboundAllowedEvents(),
      mappingMode: 'GENERIC',
    })
    inboundCreatedToken.value = data.endpointToken
    msg.success(t('admin.webhooks.inbound.messages.created'))
    loadInbound()
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    msg.error(e.response?.data?.message ?? t('admin.webhooks.inbound.messages.saveError'))
  } finally {
    inboundModalLoading.value = false
  }
}

async function pauseInbound(endpoint: InboundWebhookEndpointPublic) {
  await inboundWebhookService.pauseEndpoint(endpoint.id)
  msg.success(t('admin.webhooks.messages.paused'))
  loadInbound()
}

async function activateInbound(endpoint: InboundWebhookEndpointPublic) {
  await inboundWebhookService.activateEndpoint(endpoint.id)
  msg.success(t('admin.webhooks.messages.activated'))
  loadInbound()
}

async function revokeInbound(endpoint: InboundWebhookEndpointPublic) {
  dialog.warning({
    title: t('admin.webhooks.inbound.revokeDialog.title', { name: endpoint.name }),
    content: t('admin.webhooks.inbound.revokeDialog.content'),
    positiveText: t('admin.webhooks.inbound.revokeDialog.confirm'),
    negativeText: t('admin.webhooks.deleteDialog.cancel'),
    onPositiveClick: async () => {
      await inboundWebhookService.revokeEndpoint(endpoint.id)
      msg.success(t('admin.webhooks.inbound.messages.revoked'))
      loadInbound()
    },
  })
}

async function openInboundReceipts(endpoint: InboundWebhookEndpointPublic) {
  activeInboundEndpointId.value = endpoint.id
  activeInboundEndpointName.value = endpoint.name
  inboundReceiptFilter.value = ''
  showInboundReceipts.value = true
  await loadInboundReceipts()
}

async function loadInboundReceipts() {
  if (!activeInboundEndpointId.value) return
  inboundReceiptsLoading.value = true
  inboundReceiptsError.value = null
  try {
    const { data } = await inboundWebhookService.listReceipts(
      activeInboundEndpointId.value,
      inboundReceiptFilter.value || undefined,
    )
    inboundReceipts.value = data
  } catch {
    inboundReceiptsError.value = t('admin.webhooks.inbound.receipts.loadError')
  } finally {
    inboundReceiptsLoading.value = false
  }
}
</script>

<template>
  <div class="p-6">

    <!-- ── Page header ──────────────────────────────────────────────────── -->
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold text-white">{{ $t('admin.webhooks.title') }}</h1>
        <p class="text-gray-400 mt-1 text-sm">{{ $t('admin.webhooks.subtitle') }}</p>
      </div>
      <div class="flex items-center gap-2">
        <NButton secondary @click="showHelp = true">{{ $t('admin.webhooks.help.action') }}</NButton>
        <NDropdown
          trigger="click"
          :options="createWebhookOptions"
          @select="handleCreateWebhookSelect"
        >
          <NButton type="primary">{{ $t('admin.webhooks.newWebhook') }}</NButton>
        </NDropdown>
      </div>
    </div>

    <!-- ── Error ────────────────────────────────────────────────────────── -->
    <NAlert v-if="error" type="error" :title="error" class="mt-4" />

    <!-- ── Outbound subscriptions ───────────────────────────────────────── -->
    <div class="mt-6 rounded-xl border border-gray-800 overflow-hidden">
      <div class="border-b border-gray-800 bg-white/[0.02] px-4 py-3">
        <h2 class="text-base font-semibold text-white">{{ $t('admin.webhooks.outbound.title') }}</h2>
        <p class="mt-1 text-xs text-gray-500">{{ $t('admin.webhooks.outbound.subtitle') }}</p>
      </div>
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

    <!-- ── Inbound endpoints ────────────────────────────────────────────── -->
    <div class="mt-6 rounded-xl border border-gray-800 overflow-hidden">
      <div class="border-b border-gray-800 bg-white/[0.02] px-4 py-3">
        <h2 class="text-base font-semibold text-white">{{ $t('admin.webhooks.inbound.title') }}</h2>
        <p class="mt-1 text-xs text-gray-500">{{ $t('admin.webhooks.inbound.subtitle') }}</p>
      </div>
      <NAlert v-if="inboundError" type="error" :title="inboundError" />
      <SkeletonTable v-if="inboundLoading && inboundEndpoints.length === 0" :rows="3" :columns="5" />
      <NSpin v-else :show="inboundLoading">
        <NDataTable
          :columns="inboundColumns"
          :data="inboundEndpoints"
          :row-key="(r) => r.id"
          :bordered="false"
          :scroll-x="900"
        >
          <template v-if="!inboundLoading && inboundEndpoints.length === 0" #empty>
            <div class="py-10 flex flex-col items-center gap-3">
              <p class="text-sm text-gray-500">{{ $t('admin.webhooks.inbound.emptyDesc') }}</p>
              <NButton secondary size="small" @click="openInboundCreate">{{ $t('admin.webhooks.inbound.createFirst') }}</NButton>
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
        <div class="mb-4">
          <NButton text size="small" @click="showOutboundFieldHelp = !showOutboundFieldHelp">
            {{ showOutboundFieldHelp ? $t('admin.webhooks.fieldHelp.hide') : $t('admin.webhooks.fieldHelp.show') }}
          </NButton>
          <NCollapseTransition :show="showOutboundFieldHelp">
            <div class="mt-2 rounded-lg border border-white/10 bg-white/[0.02] p-4">
              <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {{ $t('admin.webhooks.fieldHelp.outboundTitle') }}
              </p>
              <div class="mt-3 grid gap-3 md:grid-cols-2">
                <div
                  v-for="field in outboundFieldHelpKeys"
                  :key="field"
                  class="rounded-md border border-white/5 bg-black/10 p-3"
                >
                  <NText strong class="block text-xs">{{ $t(`admin.webhooks.fieldHelp.outbound.${field}.title`) }}</NText>
                  <NText depth="3" class="block text-xs leading-relaxed mt-1">
                    {{ $t(`admin.webhooks.fieldHelp.outbound.${field}.description`) }}
                  </NText>
                </div>
              </div>
            </div>
          </NCollapseTransition>
        </div>

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

    <!-- ── Inbound create modal ─────────────────────────────────────────── -->
    <NModal
      v-model:show="showInboundModal"
      preset="card"
      :title="$t('admin.webhooks.inbound.modal.createTitle')"
      style="width: 640px"
    >
      <NForm autocomplete="off" @submit.prevent="createInboundEndpoint">
        <input type="text" name="fake-inbound-webhook-username" autocomplete="username" class="hidden" tabindex="-1">
        <input type="password" name="fake-inbound-webhook-password" autocomplete="current-password" class="hidden" tabindex="-1">
        <div class="mb-4">
          <NButton text size="small" @click="showInboundFieldHelp = !showInboundFieldHelp">
            {{ showInboundFieldHelp ? $t('admin.webhooks.fieldHelp.hide') : $t('admin.webhooks.fieldHelp.show') }}
          </NButton>
          <NCollapseTransition :show="showInboundFieldHelp">
            <div class="mt-2 rounded-lg border border-white/10 bg-white/[0.02] p-4">
              <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {{ $t('admin.webhooks.fieldHelp.inboundTitle') }}
              </p>
              <div class="mt-3 grid gap-3 md:grid-cols-2">
                <div
                  v-for="field in inboundFieldHelpKeys"
                  :key="field"
                  class="rounded-md border border-white/5 bg-black/10 p-3"
                >
                  <NText strong class="block text-xs">{{ $t(`admin.webhooks.fieldHelp.inbound.${field}.title`) }}</NText>
                  <NText depth="3" class="block text-xs leading-relaxed mt-1">
                    {{ $t(`admin.webhooks.fieldHelp.inbound.${field}.description`) }}
                  </NText>
                </div>
              </div>
            </div>
          </NCollapseTransition>
        </div>
        <div class="rounded-lg border border-white/5 bg-white/[0.02] p-4 mb-4 space-y-3">
          <NFormItem :label="$t('admin.webhooks.inbound.modal.providerLabel')" :show-feedback="false">
            <NInput v-model:value="inboundForm.provider" placeholder="monitoring" autocomplete="off" />
          </NFormItem>
          <NFormItem :label="$t('admin.webhooks.modal.nameLabel')" :show-feedback="false">
            <NInput
              v-model:value="inboundForm.name"
              :placeholder="$t('admin.webhooks.inbound.modal.namePlaceholder')"
              autocomplete="off"
            />
          </NFormItem>
          <NFormItem :label="$t('admin.webhooks.modal.descriptionLabel')" :show-feedback="false">
            <NInput v-model:value="inboundForm.description" type="textarea" :rows="2" />
          </NFormItem>
          <NFormItem :label="$t('admin.webhooks.modal.secretLabel')" :show-feedback="false">
            <div class="w-full">
              <NInput
                v-model:value="inboundForm.secret"
                type="password"
                show-password-on="click"
                autocomplete="new-password"
                :placeholder="$t('admin.webhooks.modal.secretPlaceholder')"
              />
              <NText depth="3" style="font-size:11px;display:block;margin-top:4px;line-height:1.4">
                {{ $t('admin.webhooks.inbound.modal.secretHelp') }}
              </NText>
            </div>
          </NFormItem>
          <NFormItem :label="$t('admin.webhooks.inbound.modal.allowedEventsLabel')" :show-feedback="false">
            <div class="w-full">
              <NInput
                v-model:value="inboundForm.allowedEventTypesText"
                type="textarea"
                :rows="4"
                placeholder="host.unavailable&#10;host.recovered"
                style="font-family:monospace;font-size:12px"
              />
              <NText depth="3" style="font-size:11px;display:block;margin-top:4px;line-height:1.4">
                {{ $t('admin.webhooks.inbound.modal.allowedEventsHelp') }}
              </NText>
            </div>
          </NFormItem>
        </div>

        <NAlert v-if="inboundCreatedToken" type="warning" :title="$t('admin.webhooks.inbound.modal.tokenTitle')" class="mb-4">
          <code class="text-xs break-all">/api/v1/inbound-webhooks/{{ inboundForm.provider }}/{{ inboundCreatedToken }}</code>
          <p class="text-xs mt-1 text-gray-400">{{ $t('admin.webhooks.inbound.modal.tokenHint') }}</p>
        </NAlert>

        <div class="flex justify-end gap-2">
          <NButton @click="showInboundModal = false">{{ $t('admin.webhooks.modal.cancel') }}</NButton>
          <NButton type="primary" :loading="inboundModalLoading" @click="createInboundEndpoint">
            {{ $t('admin.webhooks.inbound.modal.create') }}
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

          <!-- Tipos de webhook -->
          <div>
            <p class="text-sm font-semibold text-white mb-1">{{ $t('admin.webhooks.types.title') }}</p>
            <NText depth="3" class="block text-sm mb-3">{{ $t('admin.webhooks.types.summary') }}</NText>
            <div class="grid gap-3 md:grid-cols-2">
              <div
                v-for="card in webhookTypeCards"
                :key="card.key"
                class="rounded-lg border border-white/10 bg-white/[0.02] p-4"
              >
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <NText strong class="block text-sm">{{ card.title }}</NText>
                    <NText depth="3" class="block font-mono text-xs mt-1">{{ card.direction }}</NText>
                  </div>
                  <NTag size="small" :type="card.key === 'outbound' ? 'success' : 'info'" :bordered="false">
                    {{ card.key === 'outbound' ? $t('admin.webhooks.types.available') : $t('admin.webhooks.types.planned') }}
                  </NTag>
                </div>

                <NText depth="3" class="block text-xs leading-relaxed mt-3">{{ card.description }}</NText>

                <div class="mt-4 space-y-4">
                  <div>
                    <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {{ $t('admin.webhooks.help.whenUse') }}
                    </p>
                    <NText class="block text-sm mt-1">{{ $t(`admin.webhooks.help.directions.${card.key}.when`) }}</NText>
                  </div>

                  <div>
                    <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {{ $t('admin.webhooks.help.examplesTitle') }}
                    </p>
                    <ul class="mt-2 space-y-1.5">
                      <li
                        v-for="example in card.examples"
                        :key="example"
                        class="text-xs leading-relaxed text-gray-300"
                      >
                        {{ example }}
                      </li>
                    </ul>
                  </div>

                  <div>
                    <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {{ $t('admin.webhooks.help.setupTitle') }}
                    </p>
                    <ol class="mt-2 space-y-2">
                      <li
                        v-for="(step, index) in card.setupSteps"
                        :key="step"
                        class="grid grid-cols-[22px_1fr] gap-2 text-xs leading-relaxed text-gray-300"
                      >
                        <span class="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[11px] text-gray-200">
                          {{ index + 1 }}
                        </span>
                        <span>{{ $t(`admin.webhooks.help.directions.${card.key}.steps.${step}`) }}</span>
                      </li>
                    </ol>
                  </div>

                  <div>
                    <p class="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {{ $t('admin.webhooks.help.bestPracticesTitle') }}
                    </p>
                    <ul class="mt-2 space-y-1.5">
                      <li
                        v-for="practice in card.practices"
                        :key="practice"
                        class="text-xs leading-relaxed text-gray-300"
                      >
                        {{ $t(`admin.webhooks.help.directions.${card.key}.practices.${practice}`) }}
                      </li>
                    </ul>
                  </div>
                </div>
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

    <!-- ── Inbound receipts drawer ──────────────────────────────────────── -->
    <NDrawer v-model:show="showInboundReceipts" :width="760" placement="right">
      <NDrawerContent :title="`${$t('admin.webhooks.inbound.receipts.title')} — ${activeInboundEndpointName}`" closable>
        <div class="flex flex-wrap items-center gap-3 mb-4">
          <NSelect
            v-model:value="inboundReceiptFilter"
            :options="inboundReceiptFilterOptions"
            style="width:180px"
            @update:value="loadInboundReceipts"
          />
          <NButton size="small" @click="loadInboundReceipts">{{ $t('admin.webhooks.deliveries.refresh') }}</NButton>
        </div>

        <div class="grid gap-3 mb-4 sm:grid-cols-3">
          <div class="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <p class="text-[11px] uppercase tracking-wide text-gray-500">{{ $t('admin.webhooks.inbound.receipts.summary.total') }}</p>
            <p class="mt-1 text-lg font-semibold text-white">{{ inboundReceiptStats.total }}</p>
          </div>
          <div class="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <p class="text-[11px] uppercase tracking-wide text-gray-500">{{ $t('admin.webhooks.inbound.receipts.summary.accepted') }}</p>
            <p class="mt-1 text-lg font-semibold text-emerald-400">{{ inboundReceiptStats.accepted }}</p>
          </div>
          <div class="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
            <p class="text-[11px] uppercase tracking-wide text-gray-500">{{ $t('admin.webhooks.inbound.receipts.summary.rejected') }}</p>
            <p class="mt-1 text-lg font-semibold text-red-400">{{ inboundReceiptStats.rejected }}</p>
          </div>
        </div>

        <NAlert v-if="inboundReceiptsError" type="error" class="mb-4" :title="inboundReceiptsError" />

        <NSpin :show="inboundReceiptsLoading">
          <NDataTable
            :columns="inboundReceiptColumns"
            :data="inboundReceipts"
            :row-key="(r) => r.id"
            :bordered="false"
            size="small"
            :scroll-x="940"
          >
            <template v-if="!inboundReceiptsLoading && inboundReceipts.length === 0" #empty>
              <div class="py-8 text-center text-gray-500 text-sm">
                {{ $t('admin.webhooks.inbound.receipts.empty') }}
              </div>
            </template>
          </NDataTable>
        </NSpin>
      </NDrawerContent>
    </NDrawer>

    <NModal
      :show="!!activeInboundReceipt"
      preset="card"
      :title="$t('admin.webhooks.inbound.receipts.detailTitle')"
      style="width: 720px"
      @update:show="(value) => { if (!value) activeInboundReceipt = null }"
    >
      <div v-if="activeInboundReceipt" class="space-y-4">
        <NDescriptions label-placement="top" :column="2" bordered size="small">
          <NDescriptionsItem :label="$t('admin.webhooks.inbound.receipts.columns.status')">
            <NTag :type="inboundReceiptStatusMeta(activeInboundReceipt.status).type" size="small">
              {{ inboundReceiptStatusMeta(activeInboundReceipt.status).label }}
            </NTag>
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('admin.webhooks.inbound.receipts.columns.event')">
            {{ activeInboundReceipt.eventType }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('admin.webhooks.inbound.receipts.columns.idempotency')">
            {{ activeInboundReceipt.idempotencyKey ?? '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('admin.webhooks.inbound.receipts.externalEventId')">
            {{ activeInboundReceipt.externalEventId ?? '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('admin.webhooks.inbound.receipts.correlationId')">
            {{ activeInboundReceipt.correlationId ?? '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('admin.webhooks.inbound.receipts.sourceIp')">
            {{ activeInboundReceipt.sourceIp ?? '—' }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('admin.webhooks.inbound.receipts.columns.signature')">
            <NTag :type="activeInboundReceipt.signatureValid ? 'success' : 'warning'" size="small" :bordered="false">
              {{ activeInboundReceipt.signatureValid ? $t('admin.webhooks.inbound.receipts.signatureOk') : $t('admin.webhooks.inbound.receipts.signatureMissing') }}
            </NTag>
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('admin.webhooks.inbound.receipts.columns.receivedAt')">
            {{ formatDateTime(activeInboundReceipt.receivedAt) }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('admin.webhooks.inbound.receipts.processedAt')">
            {{ formatDateTime(activeInboundReceipt.processedAt) }}
          </NDescriptionsItem>
          <NDescriptionsItem :label="$t('admin.webhooks.inbound.receipts.payloadHash')">
            <code class="text-xs break-all">{{ activeInboundReceipt.payloadHash }}</code>
          </NDescriptionsItem>
        </NDescriptions>

        <NAlert
          v-if="activeInboundReceipt.errorCode || activeInboundReceipt.errorMessage"
          type="error"
          :title="activeInboundReceipt.errorCode ?? $t('admin.webhooks.inbound.receipts.errorTitle')"
        >
          {{ activeInboundReceipt.errorMessage ?? '—' }}
        </NAlert>

        <div v-if="activeInboundReceipt.normalizedEventJson" class="rounded-lg border border-white/10 bg-black/20 p-3">
          <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {{ $t('admin.webhooks.inbound.receipts.normalizedEvent') }}
          </p>
          <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-gray-300">{{ activeInboundReceipt.normalizedEventJson }}</pre>
        </div>
      </div>
    </NModal>

  </div>
</template>
