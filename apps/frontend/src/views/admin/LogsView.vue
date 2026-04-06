<script setup lang="ts">
import { ref, onMounted, h, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  NCard, NDataTable, NTag, NText, NInput, NSelect, NButton, NSpace,
  NPagination, NSpin, NAlert, NTabs, NTabPane,
} from 'naive-ui'
import SkeletonTable from '@/components/SkeletonTable.vue'
import type { DataTableColumns } from 'naive-ui'
import type { AuthLogPublic, AdminLogPublic } from '@nodeaccess/shared'
import { logsService } from '@/services/logs.service'

const { t } = useI18n()
const route = useRoute()

// ── Utilitários ──────────────────────────────────────────────────────────────

function formatDate(d: Date | string) {
  return new Date(d).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

const eventLabels = computed<Record<string, string>>(() => ({
  LOGIN:            t('admin.logs.events.LOGIN'),
  LOGOUT:           t('admin.logs.events.LOGOUT'),
  LOGIN_FAILED:     t('admin.logs.events.LOGIN_FAILED'),
  LOGIN_BLOCKED:    t('admin.logs.events.LOGIN_BLOCKED'),
  MFA_VERIFIED:     t('admin.logs.events.MFA_VERIFIED'),
  MFA_FAILED:       t('admin.logs.events.MFA_FAILED'),
  SSO_LOGIN:        t('admin.logs.events.SSO_LOGIN'),
  PASSWORD_RESET:   t('admin.logs.events.PASSWORD_RESET'),
  PASSWORD_CHANGED: t('admin.logs.events.PASSWORD_CHANGED'),
}))

const eventTagType: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  LOGIN:            'success',
  LOGOUT:           'default',
  LOGIN_FAILED:     'error',
  LOGIN_BLOCKED:    'error',
  MFA_VERIFIED:     'success',
  MFA_FAILED:       'warning',
  SSO_LOGIN:        'info',
  PASSWORD_RESET:   'warning',
  PASSWORD_CHANGED: 'info',
}

const adminActionLabels = computed<Record<string, string>>(() => ({
  // Usuários
  CREATE_USER:     t('admin.logs.adminActions.CREATE_USER'),
  UPDATE_USER:     t('admin.logs.adminActions.UPDATE_USER'),
  ACTIVATE_USER:   t('admin.logs.adminActions.ACTIVATE_USER'),
  DEACTIVATE_USER: t('admin.logs.adminActions.DEACTIVATE_USER'),
  RESET_PASSWORD:  t('admin.logs.adminActions.RESET_PASSWORD'),
  // Hosts
  CREATE_HOST:     t('admin.logs.adminActions.CREATE_HOST'),
  UPDATE_HOST:     t('admin.logs.adminActions.UPDATE_HOST'),
  DELETE_HOST:     t('admin.logs.adminActions.DELETE_HOST'),
  // Grupos
  CREATE_GROUP:    t('admin.logs.adminActions.CREATE_GROUP'),
  UPDATE_GROUP:    t('admin.logs.adminActions.UPDATE_GROUP'),
  DELETE_GROUP:    t('admin.logs.adminActions.DELETE_GROUP'),
  // Pastas
  CREATE_FOLDER:   t('admin.logs.adminActions.CREATE_FOLDER'),
  UPDATE_FOLDER:   t('admin.logs.adminActions.UPDATE_FOLDER'),
  DELETE_FOLDER:   t('admin.logs.adminActions.DELETE_FOLDER'),
  // Bastions
  CREATE_BASTION:  t('admin.logs.adminActions.CREATE_BASTION'),
  UPDATE_BASTION:  t('admin.logs.adminActions.UPDATE_BASTION'),
  DELETE_BASTION:  t('admin.logs.adminActions.DELETE_BASTION'),
  // Chaves PEM
  CREATE_PEM_KEY:  t('admin.logs.adminActions.CREATE_PEM_KEY'),
  DELETE_PEM_KEY:  t('admin.logs.adminActions.DELETE_PEM_KEY'),
  HOST_KEY_TRUSTED: t('admin.logs.adminActions.HOST_KEY_TRUSTED'),
  HOST_KEY_UPDATED: t('admin.logs.adminActions.HOST_KEY_UPDATED'),
  // Client UX
  CLIENT_UX_SESSION_EXPIRED: t('admin.logs.adminActions.CLIENT_UX_SESSION_EXPIRED'),
  CLIENT_UX_SESSION_EXPIRED_TERMINAL: t('admin.logs.adminActions.CLIENT_UX_SESSION_EXPIRED_TERMINAL'),
  CLIENT_UX_STALE_RELOAD_RECOVERED: t('admin.logs.adminActions.CLIENT_UX_STALE_RELOAD_RECOVERED'),
  CLIENT_UX_STALE_RELOAD_FAILED: t('admin.logs.adminActions.CLIENT_UX_STALE_RELOAD_FAILED'),
}))

function adminTagType(action: string): 'success' | 'warning' | 'error' | 'info' {
  if (action.startsWith('CLIENT_UX_')) return 'info'
  if (action.startsWith('CREATE_')) return 'success'
  if (action.startsWith('UPDATE_') || action.startsWith('ACTIVATE_') || action.startsWith('RESET_')) return 'warning'
  if (action.startsWith('DELETE_') || action.startsWith('DEACTIVATE_')) return 'error'
  return 'info'
}

function adminTargetLabel(row: AdminLogPublic) {
  if (row.targetType === 'ClientUx') {
    return t('admin.logs.adminLogs.targets.clientUx')
  }
  return `${row.targetType} #${row.targetId}`
}

function summarizeAdminDetails(row: AdminLogPublic) {
  if (!row.details || !row.action.startsWith('HOST_KEY_')) return '—'
  try {
    const details = JSON.parse(row.details) as { previousFingerprint?: string | null; nextFingerprint?: string | null }
    const previous = details.previousFingerprint ?? '—'
    const next = details.nextFingerprint ?? '—'
    return t('admin.logs.adminLogs.hostKeyDetails', { previous, next })
  } catch {
    return '—'
  }
}

// ── Auth Logs ─────────────────────────────────────────────────────────────────

const authLogs    = ref<AuthLogPublic[]>([])
const authTotal   = ref(0)
const authPage    = ref(1)
const authLoading = ref(false)
const authError   = ref<string | null>(null)

const authSearch    = ref('')
const authEventType = ref<string | undefined>(undefined)
const authSuccess   = ref<string | undefined>(undefined)

const LIMIT = 30

const eventTypeOptions = computed(() => [
  { label: t('admin.logs.auth.filterAll'),          value: '' },
  { label: t('admin.logs.events.LOGIN'),             value: 'LOGIN' },
  { label: t('admin.logs.events.LOGOUT'),            value: 'LOGOUT' },
  { label: t('admin.logs.events.LOGIN_FAILED'),      value: 'LOGIN_FAILED' },
  { label: t('admin.logs.events.LOGIN_BLOCKED'),     value: 'LOGIN_BLOCKED' },
  { label: t('admin.logs.events.MFA_VERIFIED'),      value: 'MFA_VERIFIED' },
  { label: t('admin.logs.events.MFA_FAILED'),        value: 'MFA_FAILED' },
  { label: t('admin.logs.events.SSO_LOGIN'),         value: 'SSO_LOGIN' },
  { label: t('admin.logs.events.PASSWORD_RESET'),    value: 'PASSWORD_RESET' },
  { label: t('admin.logs.events.PASSWORD_CHANGED'),  value: 'PASSWORD_CHANGED' },
])

const successOptions = computed(() => [
  { label: t('admin.logs.auth.resultAll'),     value: '' },
  { label: t('admin.logs.auth.resultSuccess'), value: 'true' },
  { label: t('admin.logs.auth.resultFailure'), value: 'false' },
])

async function loadAuth() {
  authLoading.value = true
  authError.value   = null
  try {
    const { data } = await logsService.listAuth({
      search:    authSearch.value    || undefined,
      eventType: authEventType.value || undefined,
      success:   authSuccess.value !== undefined && authSuccess.value !== ''
        ? authSuccess.value === 'true'
        : undefined,
      page:  authPage.value,
      limit: LIMIT,
    })
    authLogs.value  = data.data
    authTotal.value = data.total
  } catch {
    authError.value = t('admin.logs.auth.loadError')
  } finally {
    authLoading.value = false
  }
}

function searchAuth() { authPage.value = 1; loadAuth() }

const authColumns = computed<DataTableColumns<AuthLogPublic>>(() => [
  {
    title: t('admin.logs.auth.columns.time'),
    key: 'timestamp',
    width: 160,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px;font-family:monospace' }, () => formatDate(row.timestamp)),
  },
  {
    title: t('admin.logs.auth.columns.user'),
    key: 'user',
    render: (row) => row.userName
      ? h('div', [
          h(NText, { strong: true, style: 'font-size:13px;display:block' }, () => row.userName!),
          h(NText, { depth: 3, style: 'font-size:11px' }, () => row.userEmail ?? ''),
        ])
      : h(NText, { depth: 3, style: 'font-size:12px;font-style:italic' }, () => t('common.anonymous')),
  },
  {
    title: t('admin.logs.auth.columns.event'),
    key: 'eventType',
    width: 160,
    render: (row) => h(NTag, { type: eventTagType[row.eventType] ?? 'default', size: 'small' },
      () => eventLabels.value[row.eventType] ?? row.eventType,
    ),
  },
  {
    title: t('admin.logs.auth.columns.ip'),
    key: 'ip',
    width: 140,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px;font-family:monospace' }, () => row.ip ?? '—'),
  },
  {
    title: t('admin.logs.auth.columns.status'),
    key: 'success',
    width: 90,
    render: (row) => h(NTag, { type: row.success ? 'success' : 'error', size: 'small' },
      () => row.success ? t('admin.logs.auth.status.success') : t('admin.logs.auth.status.failure'),
    ),
  },
])

// ── Admin Logs ────────────────────────────────────────────────────────────────

const adminLogs    = ref<AdminLogPublic[]>([])
const adminTotal   = ref(0)
const adminPage    = ref(1)
const adminLoading = ref(false)
const adminError   = ref<string | null>(null)
const adminSearch  = ref('')
const adminTargetType = ref<string | undefined>(undefined)

const adminTargetTypeOptions = computed(() => [
  { label: t('admin.logs.adminLogs.targets.all'), value: '' },
  { label: t('admin.logs.adminLogs.targets.clientUx'), value: 'ClientUx' },
])

const activeTab = ref<'auth' | 'admin'>('auth')

async function loadAdmin() {
  adminLoading.value = true
  adminError.value   = null
  try {
    const { data } = await logsService.listAdmin({
      search: adminSearch.value || undefined,
      targetType: adminTargetType.value || undefined,
      page:   adminPage.value,
      limit:  LIMIT,
    })
    adminLogs.value  = data.data
    adminTotal.value = data.total
  } catch {
    adminError.value = t('admin.logs.adminLogs.loadError')
  } finally {
    adminLoading.value = false
  }
}

function searchAdmin() { adminPage.value = 1; loadAdmin() }

const adminColumns = computed<DataTableColumns<AdminLogPublic>>(() => [
  {
    title: t('admin.logs.adminLogs.columns.time'),
    key: 'timestamp',
    width: 160,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px;font-family:monospace' }, () => formatDate(row.timestamp)),
  },
  {
    title: t('admin.logs.adminLogs.columns.admin'),
    key: 'adminName',
    width: 180,
    render: (row) => h(NText, { strong: true }, () => row.adminName),
  },
  {
    title: t('admin.logs.adminLogs.columns.action'),
    key: 'action',
    width: 180,
    render: (row) => h(NTag, { type: adminTagType(row.action), size: 'small' },
      () => adminActionLabels.value[row.action] ?? row.action,
    ),
  },
  {
    title: t('admin.logs.adminLogs.columns.target'),
    key: 'target',
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px' },
      () => adminTargetLabel(row),
    ),
  },
  {
    title: t('admin.logs.adminLogs.columns.details'),
    key: 'details',
    render: (row) => h(NText, { depth: 3, style: 'font-size:11px;white-space:pre-wrap;word-break:break-word;' },
      () => summarizeAdminDetails(row),
    ),
  },
])

// ── Tabs ──────────────────────────────────────────────────────────────────────

function onTabChange(tab: string) {
  activeTab.value = tab === 'admin' ? 'admin' : 'auth'
  if (tab === 'auth'  && authLogs.value.length  === 0) loadAuth()
  if (tab === 'admin' && adminLogs.value.length === 0) loadAdmin()
}

function applyRouteFilters() {
  activeTab.value = route.query.tab === 'admin' ? 'admin' : 'auth'
  if (activeTab.value === 'admin') {
    adminTargetType.value = typeof route.query.targetType === 'string' ? route.query.targetType : undefined
    adminSearch.value = typeof route.query.action === 'string' ? route.query.action : ''
    adminPage.value = 1
    loadAdmin()
    return
  }

  loadAuth()
}

watch(() => route.query, applyRouteFilters)

onMounted(applyRouteFilters)
</script>

<template>
  <div class="p-8 max-w-6xl">
    <div class="mb-6">
      <h1 class="text-2xl font-semibold text-white">{{ $t('admin.logs.title') }}</h1>
      <NText depth="3" class="text-sm">{{ $t('admin.logs.subtitle') }}</NText>
    </div>

    <NTabs v-model:value="activeTab" type="line" animated @update:value="onTabChange">

      <!-- ── Autenticação ───────────────────────────────────────────────────── -->
      <NTabPane name="auth" :tab="$t('admin.logs.tabs.auth')">
        <NAlert v-if="authError" type="error" :title="authError" class="mb-4" />

        <NSpace class="mb-4" wrap>
          <NInput
            v-model:value="authSearch"
            :placeholder="$t('admin.logs.auth.searchPlaceholder')"
            clearable
            style="width: 220px"
            @keyup.enter="searchAuth"
          />
          <NSelect
            v-model:value="authEventType"
            :options="eventTypeOptions"
            style="width: 180px"
            @update:value="searchAuth"
          />
          <NSelect
            v-model:value="authSuccess"
            :options="successOptions"
            style="width: 130px"
            @update:value="searchAuth"
          />
          <NButton @click="searchAuth">{{ $t('admin.logs.auth.search') }}</NButton>
        </NSpace>

        <SkeletonTable v-if="authLoading && authLogs.length === 0" :rows="8" :columns="5" />
        <NSpin v-else :show="authLoading">
          <NDataTable
            :columns="authColumns"
            :data="authLogs"
            :row-key="(r: AuthLogPublic) => r.id"
            :bordered="false"
            size="small"
          />
        </NSpin>

        <div v-if="authTotal > LIMIT" class="flex justify-end mt-4">
          <NPagination
            v-model:page="authPage"
            :page-count="Math.ceil(authTotal / LIMIT)"
            :page-slot="5"
            @update:page="loadAuth"
          />
        </div>
      </NTabPane>

      <!-- ── Ações administrativas ─────────────────────────────────────────── -->
      <NTabPane name="admin" :tab="$t('admin.logs.tabs.admin')">
        <NAlert v-if="adminError" type="error" :title="adminError" class="mb-4" />

        <NSpace class="mb-4">
          <NInput
            v-model:value="adminSearch"
            :placeholder="$t('admin.logs.adminLogs.searchPlaceholder')"
            clearable
            style="width: 260px"
            @keyup.enter="searchAdmin"
          />
          <NSelect
            v-model:value="adminTargetType"
            :options="adminTargetTypeOptions"
            style="width: 180px"
            @update:value="searchAdmin"
          />
          <NButton @click="searchAdmin">{{ $t('admin.logs.adminLogs.search') }}</NButton>
        </NSpace>

        <SkeletonTable v-if="adminLoading && adminLogs.length === 0" :rows="8" :columns="4" />
        <NSpin v-else :show="adminLoading">
          <NDataTable
            :columns="adminColumns"
            :data="adminLogs"
            :row-key="(r: AdminLogPublic) => r.id"
            :bordered="false"
            size="small"
          />
        </NSpin>

        <div v-if="adminTotal > LIMIT" class="flex justify-end mt-4">
          <NPagination
            v-model:page="adminPage"
            :page-count="Math.ceil(adminTotal / LIMIT)"
            :page-slot="5"
            @update:page="loadAdmin"
          />
        </div>
      </NTabPane>

    </NTabs>
  </div>
</template>
