<script setup lang="ts">
import { ref, onMounted, h, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import {
  NDataTable, NInput, NSelect, NButton, NSpace, NAlert,
  NTag, NText, NPagination, NTooltip, NModal, NCard, NPopconfirm, useMessage,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { sessionsService, type SessionPublic } from '@/services/sessions.service'
import { useTerminalStore } from '@/stores/terminals'

const { t, te } = useI18n()
const route = useRoute()
const router = useRouter()

const message = useMessage()
const termStore = useTerminalStore()

const sessions       = ref<SessionPublic[]>([])
const total          = ref(0)
const loading        = ref(false)
const error          = ref<string | null>(null)
const search         = ref('')
const initialActive = route.query.active === 'true' ? 'true' : route.query.active === 'false' ? 'false' : ''
const active         = ref<string>(initialActive)
const connectionMethod = ref<string>('')
const accessType = ref<string>('')
const hostState      = ref<string>('')
const page           = ref(1)
const limit          = 20
const cleaningUp     = ref(false)
const showHelp       = ref(false)
const closingSessionIds = ref<Set<number>>(new Set())
const queryHostId = computed(() => {
  const value = Number(route.query.hostId)
  return Number.isFinite(value) && value > 0 ? value : undefined
})
const queryPeriodDays = computed(() => {
  const value = Number(route.query.periodDays)
  return [7, 15, 30, 60].includes(value) ? value : undefined
})
const queryDateFrom = computed(() => typeof route.query.dateFrom === 'string' ? route.query.dateFrom : undefined)
const queryDateTo = computed(() => typeof route.query.dateTo === 'string' ? route.query.dateTo : undefined)
const queryHasError = computed(() => route.query.hasError === 'true' ? true : route.query.hasError === 'false' ? false : undefined)
const queryOriginIp = computed(() => typeof route.query.originIp === 'string' ? route.query.originIp : undefined)
const hasDashboardFilter = computed(() =>
  !!queryHostId.value
  || !!queryPeriodDays.value
  || !!queryDateFrom.value
  || !!queryDateTo.value
  || queryHasError.value !== undefined
  || !!queryOriginIp.value
  || active.value !== '',
)

const statusOptions = computed(() => [
  { label: t('admin.sessions.filterAll'),    value: '' },
  { label: t('admin.sessions.filterActive'), value: 'true' },
  { label: t('admin.sessions.filterClosed'), value: 'false' },
])
const routeOptions = computed(() => [
  { label: t('admin.sessions.routeFilterAll'), value: '' },
  { label: t('admin.sessions.routes.direct'), value: 'direct' },
  { label: t('admin.sessions.routes.user_agent'), value: 'user_agent' },
  { label: t('admin.sessions.routes.tenant_agent'), value: 'tenant_agent' },
  { label: t('admin.sessions.routes.telnet_direct'), value: 'telnet_direct' },
  { label: t('admin.sessions.routes.native_ssh_gateway'), value: 'native_ssh_gateway' },
  { label: t('admin.sessions.routes.rdp_gateway_pending'), value: 'rdp_gateway_pending' },
  { label: t('admin.sessions.routes.vnc_gateway_pending'), value: 'vnc_gateway_pending' },
])
const accessTypeOptions = computed(() => [
  { label: t('admin.sessions.accessFilterAll'), value: '' },
  { label: t('admin.sessions.accessTypes.authenticated'), value: 'authenticated' },
  { label: t('admin.sessions.accessTypes.jit'), value: 'jit_public_link' },
])
const hostStateOptions = computed(() => [
  { label: t('admin.sessions.hostStateFilterAll'), value: '' },
  { label: t('admin.sessions.hostStateFilterActive'), value: 'active' },
  { label: t('admin.sessions.hostStateFilterDeleted'), value: 'deleted' },
])
const helpFields = computed(() => ['user', 'host', 'startEnd', 'duration', 'route', 'origin', 'diagnostic', 'status'])
const helpRoutes = computed(() => ['direct', 'user_agent', 'tenant_agent', 'telnet_direct', 'native_ssh_gateway', 'rdp_gateway_pending', 'vnc_gateway_pending'])
const helpQuickItems = computed(() => ['diagnostic', 'route', 'status'])
const helpDiagnosticGroups = computed(() => [
  { key: 'state', type: 'info' as const, items: ['running', 'normal'] },
  { key: 'agent', type: 'warning' as const, items: ['AGENT_REQUIRED', 'AGENT_REQUIRED_USER', 'AGENT_CONNECT_FAILED'] },
  { key: 'privateAccess', type: 'warning' as const, items: ['PRIVATE_ACCESS_CONNECTOR_REQUIRED', 'PRIVATE_ACCESS_CONNECTOR_OFFLINE', 'PRIVATE_ACCESS_PORT_NOT_ALLOWED', 'PRIVATE_ACCESS_SCOPE_MISMATCH'] },
  { key: 'ssh', type: 'error' as const, items: ['HOST_KEY_VERIFICATION_REQUIRED', 'SSH_BASTION_CONNECT_FAILED', 'SSH_TARGET_CONNECT_FAILED', 'SSH_CONNECT_FAILED', 'CREDENTIAL_ERROR'] },
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
      connectionMethod: connectionMethod.value || undefined,
      accessType: (accessType.value || undefined) as 'authenticated' | 'jit_public_link' | undefined,
      hostState: hostState.value === 'active' || hostState.value === 'deleted' ? hostState.value : undefined,
      hostId: queryHostId.value,
      periodDays: queryPeriodDays.value,
      dateFrom: queryDateFrom.value,
      dateTo: queryDateTo.value,
      hasError: queryHasError.value,
      originIp: queryOriginIp.value,
    })
    sessions.value = data.data
    total.value    = data.total
  } catch {
    error.value = t('admin.sessions.messages.loadError')
  } finally {
    loading.value = false
  }
}

function showActiveJitSessions() {
  active.value = 'true'
  accessType.value = 'jit_public_link'
  page.value = 1
  load()
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

function routeLabel(row: SessionPublic): string {
  return t(`admin.sessions.routes.${row.connectionMethod}`, row.connectionMethod)
}

function routeTagType(value: string) {
  if (value === 'user_agent' || value === 'tenant_agent') return 'success'
  if (value === 'rdp_gateway_pending' || value === 'vnc_gateway_pending') return 'info'
  if (value === 'native_ssh_gateway') return 'warning'
  if (value.startsWith('telnet_')) return 'warning'
  return 'default'
}

function helpDiagnosticTagType(value: string) {
  if (value === 'running') return 'info'
  if (value === 'normal') return 'success'
  if (value.startsWith('AGENT_') || value.startsWith('PRIVATE_ACCESS_')) return 'warning'
  return 'error'
}

function humanizeDiagnosticCode(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function translateDiagnosticCode(namespace: 'errorCodes' | 'endedReasons', value: string): string {
  const key = `admin.sessions.${namespace}.${value}`
  return te(key) ? t(key) : humanizeDiagnosticCode(value)
}

function diagnosticLabel(row: SessionPublic): string {
  if (row.active) return t('admin.sessions.diagnostics.running')
  if (row.errorCode) return translateDiagnosticCode('errorCodes', row.errorCode)
  if (row.endedReason) return translateDiagnosticCode('endedReasons', row.endedReason)
  return t('admin.sessions.diagnostics.normal')
}

function renderAccessType(row: SessionPublic) {
  if (row.accessType !== 'jit_public_link') return null
  return h(NTooltip, { trigger: 'hover' }, {
    trigger: () => h(NTag, { size: 'small', type: 'warning', class: 'mt-1' }, () => t('admin.sessions.accessTypes.jit')),
    default: () => t('admin.sessions.accessTypes.jitDetail', {
      name: row.jitGuestName || '—',
      linkId: row.jitLinkId ?? '—',
    }),
  })
}

function diagnosticTagType(row: SessionPublic) {
  if (row.errorCode) return 'error'
  if (row.active) return 'info'
  if (row.endedReason === 'socket_closed') return 'success'
  return 'default'
}

function renderDiagnostic(row: SessionPublic) {
  const tag = h(NTag, { type: diagnosticTagType(row), size: 'small' }, () => diagnosticLabel(row))
  if (!row.errorMessage) return tag
  return h(NTooltip, { trigger: 'hover' }, {
    trigger: () => tag,
    default: () => row.errorMessage,
  })
}

function isClosingSession(sessionId: number): boolean {
  return closingSessionIds.value.has(sessionId)
}

function setClosingSession(sessionId: number, closing: boolean) {
  const next = new Set(closingSessionIds.value)
  if (closing) next.add(sessionId)
  else next.delete(sessionId)
  closingSessionIds.value = next
}

async function closeSession(row: SessionPublic) {
  if (!row.active || isClosingSession(row.id)) return
  setClosingSession(row.id, true)
  try {
    const { data } = await sessionsService.close(row.id)
    if (data.closed) {
      termStore.removeBySessionId(row.id)
      sessionsService.clearAccessMapCache('admin-session-close')
      message.success(t('admin.sessions.messages.sessionClosed'))
      await load()
      return
    }
    if (data.reason === 'not_active') {
      termStore.removeBySessionId(row.id)
      sessionsService.clearAccessMapCache('admin-session-not-active')
    }
    message.warning(t(`admin.sessions.closeReasons.${data.reason}`, data.reason))
    await load()
  } catch (err: any) {
    const reason = err.response?.data?.reason
    if (reason === 'not_active') {
      termStore.removeBySessionId(row.id)
      sessionsService.clearAccessMapCache('admin-session-not-active')
    }
    if (reason) {
      message.warning(t(`admin.sessions.closeReasons.${reason}`, err.response?.data?.message ?? reason))
    } else {
      message.error(err.response?.data?.message ?? t('admin.sessions.messages.closeSessionError'))
    }
    await load()
  } finally {
    setClosingSession(row.id, false)
  }
}

function renderOrigin(row: SessionPublic) {
  const browserIp = row.clientIp || '—'
  const agentIp = row.agentRemoteIp || '—'
  const content = h('div', [
    h(NText, { class: 'block text-xs font-mono' }, () => `${t('admin.sessions.origin.browser')}: ${browserIp}`),
    row.connectionMethod !== 'direct'
      ? h(NText, { depth: 3, class: 'block text-xs font-mono mt-1' }, () => `${t('admin.sessions.origin.agent')}: ${agentIp}`)
      : null,
  ])

  if (!row.userAgent) return content
  return h(NTooltip, { trigger: 'hover' }, {
    trigger: () => content,
    default: () => row.userAgent,
  })
}

const columns = computed<DataTableColumns<SessionPublic>>(() => [
  {
    title: t('admin.sessions.columns.user'), key: 'user',
    render: (row) => h('div', [
      h(NText, { strong: true, class: 'block text-sm' }, () => row.user.name),
      h(NText, { depth: 3,    class: 'text-xs' },        () => row.user.email),
      renderAccessType(row),
    ]),
  },
  {
    title: t('admin.sessions.columns.host'), key: 'host',
    render: (row) => h('div', [
      h(NText, { strong: true, class: 'block text-sm' }, () => row.host.name),
      row.host.deleted
        ? h(NTag, { size: 'small', type: 'warning', class: 'mt-1' }, () => t('hosts.messages.hostDeleted'))
        : null,
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
    title: t('admin.sessions.columns.route'), key: 'connectionMethod',
    render: (row) => h('div', [
      h(NTag, { type: routeTagType(row.connectionMethod), size: 'small' }, () => routeLabel(row)),
      row.agentNameSnapshot
        ? h(NText, { depth: 3, class: 'block text-xs mt-1' }, () => row.agentNameSnapshot)
        : null,
    ]),
  },
  {
    title: t('admin.sessions.columns.origin'), key: 'origin',
    render: renderOrigin,
  },
  {
    title: t('admin.sessions.columns.diagnostic'), key: 'diagnostic',
    render: renderDiagnostic,
  },
  {
    title: t('admin.sessions.columns.status'), key: 'active',
    render: (row) => h(NTag, { type: row.active ? 'success' : 'default', size: 'small' }, () => row.active ? t('admin.sessions.status.active') : t('admin.sessions.status.closed')),
  },
  {
    title: t('admin.sessions.columns.actions'), key: 'actions',
    width: 120,
    render: (row) => {
      if (!row.active) return h(NText, { depth: 3 }, () => '—')
      return h(NPopconfirm, {
        positiveText: t('admin.sessions.closeSession.confirm'),
        negativeText: t('common.cancel'),
        onPositiveClick: () => closeSession(row),
      }, {
        trigger: () => h(NButton, {
          size: 'small',
          type: 'error',
          secondary: true,
          loading: isClosingSession(row.id),
          disabled: isClosingSession(row.id),
        }, () => t('admin.sessions.closeSession.action')),
        default: () => t('admin.sessions.closeSession.prompt', { host: row.host.name }),
      })
    },
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
    <div class="flex flex-wrap items-start justify-between gap-3 mb-6">
      <div>
        <h1 class="text-xl font-semibold text-white">{{ $t('admin.sessions.title') }}</h1>
        <NText depth="3" class="text-sm">{{ $t('admin.sessions.subtitle') }}</NText>
      </div>
      <NSpace align="center">
        <NTag v-if="hasDashboardFilter" size="small" type="info">
          Filtro do dashboard do host
        </NTag>
        <NText depth="3" class="text-sm">{{ $t('admin.sessions.count', { total }) }}</NText>
        <NButton
          size="small"
          secondary
          type="warning"
          @click="showActiveJitSessions"
        >
          {{ $t('admin.sessions.showActiveJit') }}
        </NButton>
        <NButton
          size="small"
          secondary
          @click="showHelp = true"
        >
          {{ $t('admin.sessions.help.action') }}
        </NButton>
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
      <NSelect
        v-model:value="connectionMethod"
        :options="routeOptions"
        style="width: 190px"
        @update:value="() => { page = 1; load() }"
      />
      <NSelect
        v-model:value="accessType"
        :options="accessTypeOptions"
        style="width: 180px"
        @update:value="() => { page = 1; load() }"
      />
      <NSelect
        v-model:value="hostState"
        :options="hostStateOptions"
        style="width: 180px"
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

    <NModal v-model:show="showHelp">
      <NCard
        style="width: min(900px, calc(100vw - 32px))"
        :title="$t('admin.sessions.help.title')"
        :bordered="false"
        role="dialog"
        aria-modal="true"
      >
        <div class="max-h-[78vh] overflow-y-auto pr-1">
          <div class="mb-5 rounded border border-white/10 p-4">
            <NText depth="3" class="block text-sm">{{ $t('admin.sessions.help.subtitle') }}</NText>
            <div class="mt-4 grid gap-3 md:grid-cols-3">
              <div
                v-for="item in helpQuickItems"
                :key="item"
                class="rounded bg-white/5 p-3"
              >
                <NText strong class="block text-sm">{{ $t(`admin.sessions.help.quick.${item}.title`) }}</NText>
                <NText depth="3" class="block text-xs mt-1">{{ $t(`admin.sessions.help.quick.${item}.description`) }}</NText>
              </div>
            </div>
          </div>

          <div class="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <section>
              <h2 class="text-sm font-semibold text-white mb-3">{{ $t('admin.sessions.help.fieldsTitle') }}</h2>
              <div class="overflow-hidden rounded border border-white/10">
                <div
                  v-for="field in helpFields"
                  :key="field"
                  class="grid gap-2 border-b border-white/10 p-3 last:border-b-0 md:grid-cols-[140px_1fr]"
                >
                  <NText strong class="text-sm">{{ $t(`admin.sessions.help.fields.${field}.title`) }}</NText>
                  <NText depth="3" class="text-sm">{{ $t(`admin.sessions.help.fields.${field}.description`) }}</NText>
                </div>
              </div>
            </section>

            <section>
              <h2 class="text-sm font-semibold text-white mb-3">{{ $t('admin.sessions.help.routesTitle') }}</h2>
              <div class="space-y-3">
                <div
                  v-for="route in helpRoutes"
                  :key="route"
                  class="rounded border border-white/10 p-3"
                >
                  <NTag size="small" :type="routeTagType(route)">{{ $t(`admin.sessions.routes.${route}`) }}</NTag>
                  <NText depth="3" class="block text-sm mt-2">{{ $t(`admin.sessions.help.routes.${route}`) }}</NText>
                </div>
              </div>
            </section>
          </div>

          <section class="mt-5">
            <h2 class="text-sm font-semibold text-white mb-3">{{ $t('admin.sessions.help.diagnosticsTitle') }}</h2>
            <div class="grid gap-4 lg:grid-cols-3">
              <section
                v-for="group in helpDiagnosticGroups"
                :key="group.key"
                class="rounded border border-white/10 p-3"
              >
                <div class="mb-3 flex items-center gap-2">
                  <NTag size="small" :type="group.type">{{ $t(`admin.sessions.help.diagnosticGroups.${group.key}`) }}</NTag>
                </div>
                <div class="space-y-3">
                  <div
                    v-for="item in group.items"
                    :key="item"
                  >
                    <NTag size="small" :type="helpDiagnosticTagType(item)">
                      {{ $t(`admin.sessions.help.diagnostics.${item}.label`) }}
                    </NTag>
                    <NText depth="3" class="block text-xs mt-1">{{ $t(`admin.sessions.help.diagnostics.${item}.description`) }}</NText>
                  </div>
                </div>
              </section>
            </div>
          </section>
        </div>
      </NCard>
    </NModal>
  </div>
</template>
