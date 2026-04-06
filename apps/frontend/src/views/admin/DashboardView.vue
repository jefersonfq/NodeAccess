<script setup lang="ts">
import { ref, computed, onMounted, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  NCard, NSpin, NAlert, NText, NDataTable, NTag, NButton, NModal,
} from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import type { DashboardStats, AuthLogPublic } from '@nodeaccess/shared'
import { dashboardService } from '@/services/dashboard.service'

const { t } = useI18n()

const router  = useRouter()
const loading = ref(true)
const error   = ref<string | null>(null)
const stats   = ref<DashboardStats | null>(null)
const selectedUserDrilldownId = ref<number | null>(null)

async function load() {
  loading.value = true
  error.value   = null
  try {
    const { data } = await dashboardService.getStats()
    stats.value = data
  } catch {
    error.value = 'Erro ao carregar estatísticas'
  } finally {
    loading.value = false
  }
}

onMounted(load)

const selectedUserDrilldown = computed(() =>
  stats.value?.adoption.userDrilldowns.find((item) => item.userId === selectedUserDrilldownId.value) ?? null,
)

// ── Tabela de eventos recentes ──────────────────────────────────────────────

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

function formatDate(d: Date | string) {
  return new Date(d).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

const authColumns = computed<DataTableColumns<AuthLogPublic>>(() => [
  {
    title: t('admin.dashboard.columns.time'),
    key: 'timestamp',
    width: 160,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px;font-family:monospace' }, () => formatDate(row.timestamp)),
  },
  {
    title: t('admin.dashboard.columns.user'),
    key: 'user',
    render: (row) => row.userName
      ? h('div', [
          h(NText, { strong: true, style: 'font-size:13px;display:block' }, () => row.userName),
          h(NText, { depth: 3, style: 'font-size:11px' }, () => row.userEmail ?? ''),
        ])
      : h(NText, { depth: 3, style: 'font-size:12px;font-style:italic' }, () => t('admin.dashboard.anonymous')),
  },
  {
    title: t('admin.dashboard.columns.event'),
    key: 'eventType',
    width: 160,
    render: (row) => h(NTag, { type: eventTagType[row.eventType] ?? 'default', size: 'small' },
      () => eventLabels.value[row.eventType] ?? row.eventType,
    ),
  },
  {
    title: t('admin.dashboard.columns.ip'),
    key: 'ip',
    width: 140,
    render: (row) => h(NText, { depth: 3, style: 'font-size:12px;font-family:monospace' }, () => row.ip ?? '—'),
  },
])

// ── Licença ───────────────────────────────────────────────────────────────────

function licensePercent(active: number, max: number | null) {
  if (!max) return null
  return Math.round((active / max) * 100)
}

function licenseColor(pct: number | null) {
  if (pct === null) return '#6b7280'
  if (pct >= 100) return '#ef4444'
  if (pct >= 80)  return '#f59e0b'
  return '#22c55e'
}

function uxDelta(current: number, previous: number) {
  return current - previous
}

function uxDeltaLabel(current: number, previous: number) {
  const delta = uxDelta(current, previous)
  if (delta === 0) return t('admin.dashboard.clientUx.noChange')
  return delta > 0
    ? t('admin.dashboard.clientUx.deltaUp', { value: delta })
    : t('admin.dashboard.clientUx.deltaDown', { value: Math.abs(delta) })
}

function uxDeltaColor(current: number, previous: number, invert = false) {
  const delta = uxDelta(current, previous)
  if (delta === 0) return '#6b7280'
  if (invert) return delta > 0 ? '#22c55e' : '#ef4444'
  return delta > 0 ? '#ef4444' : '#22c55e'
}

function openClientUxLogs(action?: string) {
  router.push({
    name: 'admin-logs',
    query: {
      tab: 'admin',
      targetType: 'ClientUx',
      ...(action ? { action } : {}),
    },
  })
}

function openHostKeyLogs(action?: string) {
  router.push({
    name: 'admin-logs',
    query: {
      tab: 'admin',
      ...(action ? { action } : { action: 'HOST_KEY_' }),
    },
  })
}

function openUserDrilldown(userId: number) {
  selectedUserDrilldownId.value = userId
}

function closeUserDrilldown() {
  selectedUserDrilldownId.value = null
}

function openUserDetailPage(userId: number) {
  router.push({ name: 'admin-dashboard-user', params: { userId } })
}
</script>

<template>
  <div class="p-8 max-w-6xl">

    <!-- Header -->
    <div class="flex items-center justify-between mb-7">
      <div>
        <h1 class="text-2xl font-semibold text-white">{{ $t('admin.dashboard.title') }}</h1>
        <NText depth="3" class="text-sm">{{ $t('admin.dashboard.subtitle') }}</NText>
      </div>
      <NButton size="small" ghost @click="load">
        <template #icon>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
        </template>
        {{ $t('admin.dashboard.refresh') }}
      </NButton>
    </div>

    <NAlert v-if="error" type="error" :title="error" class="mb-6" />

    <NSpin :show="loading">

      <!-- ── Stat cards ──────────────────────────────────────────────────────── -->
      <div class="grid grid-cols-2 gap-4 mb-6 lg:grid-cols-4">

        <!-- Usuários -->
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(59,130,246,0.12); color: #3b82f6;">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <div class="text-xs text-gray-500 uppercase tracking-wider mb-1">{{ $t('admin.dashboard.activeUsers') }}</div>
          <div class="flex items-end gap-1">
            <span class="text-3xl font-bold text-white">{{ stats?.activeUsers ?? '—' }}</span>
            <span v-if="stats?.maxUsers" class="text-sm text-gray-500 mb-1">/ {{ stats.maxUsers }}</span>
          </div>
          <div
            v-if="stats"
            class="text-xs mt-1"
            :style="{ color: licenseColor(licensePercent(stats.activeUsers, stats.maxUsers)) }"
          >
            <template v-if="stats.maxUsers">
              {{ licensePercent(stats.activeUsers, stats.maxUsers) }}{{ $t('admin.dashboard.licenseUsage') }}
            </template>
            <template v-else>{{ $t('admin.dashboard.noLimit') }}</template>
          </div>
        </div>

        <!-- Hosts -->
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(99,102,241,0.12); color: #6366f1;">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="2" width="20" height="8" rx="2"/>
              <rect x="2" y="14" width="20" height="8" rx="2"/>
              <line x1="6" y1="6" x2="6.01" y2="6"/>
              <line x1="6" y1="18" x2="6.01" y2="18"/>
            </svg>
          </div>
          <div class="text-xs text-gray-500 uppercase tracking-wider mb-1">{{ $t('admin.dashboard.registeredHosts') }}</div>
          <span class="text-3xl font-bold text-white">{{ stats?.totalHosts ?? '—' }}</span>
          <NButton
            text size="tiny" class="mt-2 self-start"
            style="color:#6b7280; font-size:12px;"
            @click="router.push({ name: 'hosts' })"
          >
            {{ $t('admin.dashboard.viewHosts') }}
          </NButton>
        </div>

        <!-- Sessões ativas -->
        <div class="stat-card">
          <div
            class="stat-icon"
            :style="{
              background: stats?.activeSessions ? 'rgba(34,197,94,0.12)' : 'rgba(107,114,128,0.12)',
              color:       stats?.activeSessions ? '#22c55e' : '#6b7280',
            }"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>
            </svg>
          </div>
          <div class="text-xs text-gray-500 uppercase tracking-wider mb-1">{{ $t('admin.dashboard.activeSessions') }}</div>
          <span
            class="text-3xl font-bold"
            :style="{ color: stats?.activeSessions ? '#22c55e' : '#6b7280' }"
          >{{ stats?.activeSessions ?? '—' }}</span>
          <NButton
            text size="tiny" class="mt-2 self-start"
            style="color:#6b7280; font-size:12px;"
            @click="router.push({ name: 'admin-sessions' })"
          >
            {{ $t('admin.dashboard.viewSessions') }}
          </NButton>
        </div>

        <!-- Sessões hoje -->
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(245,158,11,0.12); color: #f59e0b;">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"/>
              <line x1="12" y1="20" x2="12" y2="4"/>
              <line x1="6" y1="20" x2="6" y2="14"/>
            </svg>
          </div>
          <div class="text-xs text-gray-500 uppercase tracking-wider mb-1">{{ $t('admin.dashboard.todaySessions') }}</div>
          <span class="text-3xl font-bold text-white">{{ stats?.sessionsToday ?? '—' }}</span>
          <NText depth="3" class="text-xs mt-1">{{ $t('admin.dashboard.sinceMidnight') }}</NText>
        </div>

        <!-- Client UX -->
        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(14,165,233,0.12); color: #38bdf8;">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 5h16v10H4z"/><path d="M8 21h8"/><path d="M12 15v6"/><path d="M9 9h.01"/><path d="M15 9h.01"/>
            </svg>
          </div>
          <div class="text-xs text-gray-500 uppercase tracking-wider mb-1">{{ $t('admin.dashboard.clientUx.title') }}</div>
          <span class="text-3xl font-bold text-white">
            {{ (stats?.clientUx.current.sessionExpired ?? 0) + (stats?.clientUx.current.sessionExpiredTerminal ?? 0) }}
          </span>
          <NText depth="3" class="text-xs mt-1">{{ $t('admin.dashboard.clientUx.last24h') }}</NText>
          <div class="grid grid-cols-2 gap-x-3 gap-y-1 mt-3 text-xs">
            <button class="text-left text-gray-400 hover:text-white transition-colors" @click="openClientUxLogs('CLIENT_UX_SESSION_EXPIRED')">
              {{ $t('admin.dashboard.clientUx.sessionExpired') }}
            </button>
            <div class="text-right text-white font-medium">{{ stats?.clientUx.current.sessionExpired ?? 0 }}</div>
            <div class="col-span-2 text-right" :style="{ color: uxDeltaColor(stats?.clientUx.current.sessionExpired ?? 0, stats?.clientUx.previous.sessionExpired ?? 0) }">
              {{ uxDeltaLabel(stats?.clientUx.current.sessionExpired ?? 0, stats?.clientUx.previous.sessionExpired ?? 0) }}
            </div>
            <button class="text-left text-gray-400 hover:text-white transition-colors" @click="openClientUxLogs('CLIENT_UX_SESSION_EXPIRED_TERMINAL')">
              {{ $t('admin.dashboard.clientUx.sessionExpiredTerminal') }}
            </button>
            <div class="text-right text-white font-medium">{{ stats?.clientUx.current.sessionExpiredTerminal ?? 0 }}</div>
            <div class="col-span-2 text-right" :style="{ color: uxDeltaColor(stats?.clientUx.current.sessionExpiredTerminal ?? 0, stats?.clientUx.previous.sessionExpiredTerminal ?? 0) }">
              {{ uxDeltaLabel(stats?.clientUx.current.sessionExpiredTerminal ?? 0, stats?.clientUx.previous.sessionExpiredTerminal ?? 0) }}
            </div>
            <button class="text-left text-gray-400 hover:text-white transition-colors" @click="openClientUxLogs('CLIENT_UX_STALE_RELOAD_RECOVERED')">
              {{ $t('admin.dashboard.clientUx.reloadRecovered') }}
            </button>
            <div class="text-right text-emerald-400 font-medium">{{ stats?.clientUx.current.staleReloadRecovered ?? 0 }}</div>
            <div class="col-span-2 text-right" :style="{ color: uxDeltaColor(stats?.clientUx.current.staleReloadRecovered ?? 0, stats?.clientUx.previous.staleReloadRecovered ?? 0, true) }">
              {{ uxDeltaLabel(stats?.clientUx.current.staleReloadRecovered ?? 0, stats?.clientUx.previous.staleReloadRecovered ?? 0) }}
            </div>
            <button class="text-left text-gray-400 hover:text-white transition-colors" @click="openClientUxLogs('CLIENT_UX_STALE_RELOAD_FAILED')">
              {{ $t('admin.dashboard.clientUx.reloadFailed') }}
            </button>
            <div class="text-right text-amber-400 font-medium">{{ stats?.clientUx.current.staleReloadFailed ?? 0 }}</div>
            <div class="col-span-2 text-right" :style="{ color: uxDeltaColor(stats?.clientUx.current.staleReloadFailed ?? 0, stats?.clientUx.previous.staleReloadFailed ?? 0) }">
              {{ uxDeltaLabel(stats?.clientUx.current.staleReloadFailed ?? 0, stats?.clientUx.previous.staleReloadFailed ?? 0) }}
            </div>
          </div>
          <NButton
            text size="tiny" class="mt-2 self-start"
            style="color:#6b7280; font-size:12px;"
            @click="openClientUxLogs()"
          >
            {{ $t('admin.dashboard.viewLogs') }}
          </NButton>
        </div>

        <div class="stat-card">
          <div class="stat-icon" style="background: rgba(245,158,11,0.12); color: #f59e0b;">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d="M7 14a5 5 0 1 1 9.9-1"/><path d="M12 17h.01"/><path d="M20 21H4"/><path d="M6 21v-2a6 6 0 1 1 12 0v2"/>
            </svg>
          </div>
          <div class="text-xs text-gray-500 uppercase tracking-wider mb-1">{{ $t('admin.dashboard.hostKey.title') }}</div>
          <span class="text-3xl font-bold text-white">
            {{ (stats?.hostKey.current.trusted ?? 0) + (stats?.hostKey.current.updated ?? 0) }}
          </span>
          <NText depth="3" class="text-xs mt-1">{{ $t('admin.dashboard.hostKey.last24h') }}</NText>
          <div class="grid grid-cols-2 gap-x-3 gap-y-1 mt-3 text-xs">
            <button class="text-left text-gray-400 hover:text-white transition-colors" @click="openHostKeyLogs('HOST_KEY_TRUSTED')">
              {{ $t('admin.dashboard.hostKey.trusted') }}
            </button>
            <div class="text-right text-white font-medium">{{ stats?.hostKey.current.trusted ?? 0 }}</div>
            <div class="col-span-2 text-right" :style="{ color: uxDeltaColor(stats?.hostKey.current.trusted ?? 0, stats?.hostKey.previous.trusted ?? 0, true) }">
              {{ uxDeltaLabel(stats?.hostKey.current.trusted ?? 0, stats?.hostKey.previous.trusted ?? 0) }}
            </div>
            <button class="text-left text-gray-400 hover:text-white transition-colors" @click="openHostKeyLogs('HOST_KEY_UPDATED')">
              {{ $t('admin.dashboard.hostKey.updated') }}
            </button>
            <div class="text-right text-amber-400 font-medium">{{ stats?.hostKey.current.updated ?? 0 }}</div>
            <div class="col-span-2 text-right" :style="{ color: uxDeltaColor(stats?.hostKey.current.updated ?? 0, stats?.hostKey.previous.updated ?? 0) }">
              {{ uxDeltaLabel(stats?.hostKey.current.updated ?? 0, stats?.hostKey.previous.updated ?? 0) }}
            </div>
          </div>
          <NButton
            text size="tiny" class="mt-2 self-start"
            style="color:#6b7280; font-size:12px;"
            @click="openHostKeyLogs()"
          >
            {{ $t('admin.dashboard.viewLogs') }}
          </NButton>
        </div>

      </div>

      <!-- ── Hosts por tag ────────────────────────────────────────────────── -->
      <NCard v-if="stats?.tagStats.length" :bordered="false" style="background:#1a1a1e; border: 1px solid #222228;" class="mb-4">
        <NText strong class="block mb-4">{{ $t('admin.dashboard.hostsByTag') }}</NText>
        <div class="space-y-2.5">
          <div
            v-for="item in stats!.tagStats"
            :key="item.tag.id"
            class="flex items-center gap-3"
          >
            <span
              class="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold shrink-0"
              :style="{
                background: item.tag.color + '1a',
                color:      item.tag.color,
                border:     `1px solid ${item.tag.color}33`,
                minWidth:   '88px',
              }"
            >
              {{ item.tag.name }}
            </span>
            <div class="flex-1 rounded-full h-1.5 overflow-hidden" style="background:#222228;">
              <div
                class="h-1.5 rounded-full transition-all duration-500"
                :style="{
                  width:      `${Math.round((item.hostCount / (stats!.totalHosts || 1)) * 100)}%`,
                  background: item.tag.color,
                }"
              />
            </div>
            <span class="text-xs text-gray-500 shrink-0 w-6 text-right">{{ item.hostCount }}</span>
          </div>
        </div>
      </NCard>

      <div class="grid grid-cols-1 gap-4 mb-4 xl:grid-cols-2">
        <NCard :bordered="false" style="background:#1a1a1e; border: 1px solid #222228;">
          <div class="flex items-center justify-between mb-4">
            <NText strong>{{ $t('admin.dashboard.adoption.topActiveUsers') }}</NText>
            <NText depth="3" class="text-xs">{{ $t('admin.dashboard.adoption.last30d') }}</NText>
          </div>
          <div v-if="stats?.adoption.topActiveUsers.length" class="space-y-3">
            <div
              v-for="user in stats?.adoption.topActiveUsers"
              :key="`active-user-${user.userId}`"
              class="rounded-lg border border-gray-800 bg-[#111113] px-4 py-3"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium text-white">{{ user.userName }}</div>
                  <div class="truncate text-xs text-gray-500">{{ user.userEmail || '—' }}</div>
                </div>
                <NTag size="small" type="info">{{ $t('admin.dashboard.adoption.sessionsCount', { count: user.sessionCount }) }}</NTag>
              </div>
              <div class="mt-2 text-xs text-gray-500">
                {{ $t('admin.dashboard.adoption.primaryHost', { host: user.primaryHostName || '—' }) }}
              </div>
              <div class="mt-1 text-xs text-gray-500">
                {{ $t('admin.dashboard.adoption.lastAccessed', { date: formatDate(user.lastAccessedAt) }) }}
              </div>
              <NButton
                text size="tiny" class="mt-2"
                style="color:#93c5fd; font-size:12px;"
                @click="openUserDrilldown(user.userId)"
              >
                {{ $t('admin.dashboard.adoption.viewUserDetail') }}
              </NButton>
              <NButton
                text size="tiny" class="mt-1"
                style="color:#6b7280; font-size:12px;"
                @click="openUserDetailPage(user.userId)"
              >
                {{ $t('admin.dashboard.adoption.openUserPage') }}
              </NButton>
            </div>
          </div>
          <NText v-else depth="3" class="text-sm">{{ $t('admin.dashboard.adoption.emptyUsers') }}</NText>
        </NCard>

        <NCard :bordered="false" style="background:#1a1a1e; border: 1px solid #222228;">
          <div class="flex items-center justify-between mb-4">
            <NText strong>{{ $t('admin.dashboard.adoption.topHosts') }}</NText>
            <NText depth="3" class="text-xs">{{ $t('admin.dashboard.adoption.last30d') }}</NText>
          </div>
          <div v-if="stats?.adoption.topHosts.length" class="space-y-3">
            <div
              v-for="host in stats?.adoption.topHosts"
              :key="`adoption-host-${host.hostId}`"
              class="rounded-lg border border-gray-800 bg-[#111113] px-4 py-3"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium text-white">{{ host.hostName }}</div>
                  <div class="truncate text-xs font-mono text-gray-500">{{ host.hostIp }}</div>
                </div>
                <NTag size="small" type="success">{{ $t('admin.dashboard.adoption.sessionsCount', { count: host.accessCount }) }}</NTag>
              </div>
              <div class="mt-2 text-xs text-gray-500">
                {{ $t('admin.dashboard.adoption.uniqueUsers', { count: host.uniqueUsers }) }}
              </div>
            </div>
          </div>
          <NText v-else depth="3" class="text-sm">{{ $t('admin.dashboard.adoption.emptyHosts') }}</NText>
        </NCard>
      </div>

      <div class="grid grid-cols-1 gap-4 mb-4 xl:grid-cols-2">
        <NCard :bordered="false" style="background:#1a1a1e; border: 1px solid #222228;">
          <div class="flex items-center justify-between mb-4">
            <NText strong>{{ $t('admin.dashboard.adoption.topScreens') }}</NText>
            <NText depth="3" class="text-xs">{{ $t('admin.dashboard.adoption.last30d') }}</NText>
          </div>
          <div v-if="stats?.adoption.topScreens.length" class="space-y-3">
            <div
              v-for="screen in stats?.adoption.topScreens"
              :key="`screen-${screen.screenId}`"
              class="flex items-center justify-between rounded-lg border border-gray-800 bg-[#111113] px-4 py-3"
            >
              <div class="text-sm text-white">{{ screen.screenLabel }}</div>
              <NTag size="small">{{ $t('admin.dashboard.adoption.viewsCount', { count: screen.viewCount }) }}</NTag>
            </div>
          </div>
          <NText v-else depth="3" class="text-sm">{{ $t('admin.dashboard.adoption.emptyScreens') }}</NText>
        </NCard>

        <NCard :bordered="false" style="background:#1a1a1e; border: 1px solid #222228;">
          <div class="flex items-center justify-between mb-4">
            <NText strong>{{ $t('admin.dashboard.adoption.topResources') }}</NText>
            <NText depth="3" class="text-xs">{{ $t('admin.dashboard.adoption.last30d') }}</NText>
          </div>
          <div v-if="stats?.adoption.topResources.length" class="space-y-3">
            <div
              v-for="resource in stats?.adoption.topResources"
              :key="`resource-${resource.resourceType}`"
              class="flex items-center justify-between rounded-lg border border-gray-800 bg-[#111113] px-4 py-3"
            >
              <div class="text-sm text-white">{{ resource.label }}</div>
              <NTag size="small" type="warning">{{ $t('admin.dashboard.adoption.usageCount', { count: resource.usageCount }) }}</NTag>
            </div>
          </div>
          <NText v-else depth="3" class="text-sm">{{ $t('admin.dashboard.adoption.emptyResources') }}</NText>
        </NCard>
      </div>

      <NCard :bordered="false" style="background:#1a1a1e; border: 1px solid #222228;" class="mb-4">
        <div class="flex items-center justify-between mb-4">
          <NText strong>{{ $t('admin.dashboard.adoption.userVsResources') }}</NText>
          <NText depth="3" class="text-xs">{{ $t('admin.dashboard.adoption.last30d') }}</NText>
        </div>
        <div v-if="stats?.adoption.userResourceUsage.length" class="space-y-3">
          <div
            v-for="user in stats?.adoption.userResourceUsage"
            :key="`usage-${user.userId}`"
            class="rounded-lg border border-gray-800 bg-[#111113] px-4 py-3"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="truncate text-sm font-medium text-white">{{ user.userName }}</div>
                <div class="truncate text-xs text-gray-500">{{ user.userEmail || '—' }}</div>
              </div>
            </div>
            <div class="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
              <div class="rounded-md bg-[#17171b] px-3 py-2 text-gray-300">
                <span class="block text-gray-500">{{ $t('admin.dashboard.adoption.resourceSessions') }}</span>
                <span class="text-sm font-semibold text-white">{{ user.sessions }}</span>
              </div>
              <div class="rounded-md bg-[#17171b] px-3 py-2 text-gray-300">
                <span class="block text-gray-500">{{ $t('admin.dashboard.adoption.resourceSnippets') }}</span>
                <span class="text-sm font-semibold text-white">{{ user.snippets }}</span>
              </div>
              <div class="rounded-md bg-[#17171b] px-3 py-2 text-gray-300">
                <span class="block text-gray-500">{{ $t('admin.dashboard.adoption.resourceLocalAccess') }}</span>
                <span class="text-sm font-semibold text-white">{{ user.localAccess }}</span>
              </div>
              <div class="rounded-md bg-[#17171b] px-3 py-2 text-gray-300">
                <span class="block text-gray-500">{{ $t('admin.dashboard.adoption.resourceLiveSessions') }}</span>
                <span class="text-sm font-semibold text-white">{{ user.liveSessions }}</span>
              </div>
            </div>
          </div>
        </div>
        <NText v-else depth="3" class="text-sm">{{ $t('admin.dashboard.adoption.emptyMatrix') }}</NText>
      </NCard>

      <!-- ── Eventos recentes ─────────────────────────────────────────────── -->
      <NCard :bordered="false" style="background:#1a1a1e; border: 1px solid #222228;">
        <div class="flex items-center justify-between mb-4">
          <NText strong>{{ $t('admin.dashboard.recentAuth') }}</NText>
          <NButton
            text size="small"
            style="color:#6b7280;"
            @click="router.push({ name: 'admin-logs' })"
          >
            {{ $t('admin.dashboard.viewAll') }}
          </NButton>
        </div>
        <NDataTable
          :columns="authColumns"
          :data="stats?.recentAuthLogs ?? []"
          :row-key="(r: AuthLogPublic) => r.id"
          :bordered="false"
          size="small"
          :loading="loading"
        />
      </NCard>

    </NSpin>

    <NModal
      :show="!!selectedUserDrilldown"
      preset="card"
      style="width:min(960px, calc(100vw - 32px)); background:#17171b;"
      :title="selectedUserDrilldown ? $t('admin.dashboard.adoption.userDetailTitle', { user: selectedUserDrilldown.userName }) : ''"
      @update:show="(value) => { if (!value) closeUserDrilldown() }"
    >
      <template v-if="selectedUserDrilldown">
        <div class="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
          <NCard :bordered="false" style="background:#111113;">
            <template #header>
              <div>
                <div class="text-sm font-semibold text-white">{{ $t('admin.dashboard.adoption.userTopHosts') }}</div>
                <div class="text-xs text-gray-400">{{ selectedUserDrilldown.userEmail || '—' }}</div>
              </div>
            </template>

            <div v-if="selectedUserDrilldown.topHosts.length" class="space-y-3">
              <div
                v-for="host in selectedUserDrilldown.topHosts"
                :key="`drill-host-${host.hostId}`"
                class="rounded-lg border border-gray-800 bg-[#17171b] px-4 py-3"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="truncate text-sm font-medium text-white">{{ host.hostName }}</div>
                    <div class="truncate text-xs font-mono text-gray-500">{{ host.hostIp }}</div>
                  </div>
                  <NTag size="small">{{ $t('admin.dashboard.adoption.sessionsCount', { count: host.accessCount }) }}</NTag>
                </div>
              </div>
            </div>
            <NText v-else depth="3" class="text-sm">{{ $t('admin.dashboard.adoption.emptyUserTopHosts') }}</NText>
          </NCard>

          <NCard :bordered="false" style="background:#111113;">
            <template #header>
              <div>
                <div class="text-sm font-semibold text-white">{{ $t('admin.dashboard.adoption.userRecentAccesses') }}</div>
                <div class="text-xs text-gray-400">{{ $t('admin.dashboard.adoption.userRecentAccessesHint') }}</div>
              </div>
            </template>

            <div v-if="selectedUserDrilldown.recentAccesses.length" class="max-h-[520px] space-y-2 overflow-y-auto pr-1">
              <div
                v-for="access in selectedUserDrilldown.recentAccesses"
                :key="`recent-access-${access.sessionId}`"
                class="rounded-lg border border-gray-800 bg-[#17171b] px-4 py-3"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="truncate text-sm font-medium text-white">{{ access.hostName }}</div>
                    <div class="truncate text-xs font-mono text-gray-500">{{ access.hostIp }}</div>
                  </div>
                  <div class="text-right text-xs text-gray-400">{{ formatDate(access.startedAt) }}</div>
                </div>
              </div>
            </div>
            <NText v-else depth="3" class="text-sm">{{ $t('admin.dashboard.adoption.emptyUserRecentAccesses') }}</NText>
          </NCard>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.stat-card {
  display: flex;
  flex-direction: column;
  padding: 20px;
  border-radius: 12px;
  background: #1a1a1e;
  border: 1px solid #222228;
  transition: border-color .15s;
}

.stat-card:hover {
  border-color: #2e2e38;
}

.stat-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  margin-bottom: 12px;
  flex-shrink: 0;
}
</style>
