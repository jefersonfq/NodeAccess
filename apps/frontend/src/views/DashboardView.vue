<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NAlert, NButton, NCard, NEmpty, NSpin, NTag, NText, useMessage } from 'naive-ui'
import type { HostPublic, UserDashboardSummary } from '@nodeaccess/shared'
import { useI18n } from 'vue-i18n'
import { favoriteHostIds, recentHostIds, markHostAsRecent, toggleFavoriteHost } from '@/services/host-quick-access.service'
import { hostService } from '@/services/host.service'
import { INVENTORY_ACL_CHANGED_EVENT, USER_ACL_MEMBERSHIP_CHANGED_EVENT } from '@/services/app-events.service'
import { userDashboardService } from '@/services/user-dashboard.service'
import { resetTerminalLayout } from '@/services/terminal-layout.service'
import { useAuthStore } from '@/stores/auth'
import { useTerminalStore } from '@/stores/terminals'

const router = useRouter()
const auth = useAuthStore()
const termStore = useTerminalStore()
const { t } = useI18n()
const message = useMessage()

const loading = ref(true)
const error = ref<string | null>(null)
const summary = ref<UserDashboardSummary | null>(null)
const quickAccessHosts = ref<HostPublic[]>([])
let refreshTimer: ReturnType<typeof setInterval> | null = null
let aclRefreshTimer: ReturnType<typeof setTimeout> | null = null

type UserDashboardSummaryCompat = UserDashboardSummary & {
  totalLocalAccessLast30Days?: number
  topLocalAccessLast30Days?: UserDashboardSummary['topSshTunnelsLast30Days']
}

function normalizeSummaryDates(input: UserDashboardSummaryCompat): UserDashboardSummary {
  return {
    ...input,
    totalSshTunnelsLast30Days: input.totalSshTunnelsLast30Days ?? input.totalLocalAccessLast30Days ?? 0,
    topSshTunnelsLast30Days: input.topSshTunnelsLast30Days ?? input.topLocalAccessLast30Days ?? [],
    topHostsLast30Days: (input.topHostsLast30Days ?? []).map((host) => ({
      ...host,
      lastAccessedAt: new Date(host.lastAccessedAt),
    })),
    topSnippetsLast30Days: input.topSnippetsLast30Days ?? [],
    weeklyActivityLast4Weeks: (input.weeklyActivityLast4Weeks ?? []).map((item) => ({
      ...item,
      periodStart: new Date(item.periodStart),
      periodEnd: new Date(item.periodEnd),
    })),
  }
}

const hostById = computed(() => {
  const map = new Map<number, HostPublic>()
  for (const host of quickAccessHosts.value) map.set(host.id, host)
  return map
})

const weeklyActivity = computed(() => summary.value?.weeklyActivityLast4Weeks ?? [])
const weeklyActivityMax = computed(() =>
  Math.max(
    1,
    ...weeklyActivity.value.map((item) => Math.max(item.sessions, item.sharedSessions)),
  ),
)
const weeklyActivityTotals = computed(() =>
  weeklyActivity.value.reduce(
    (acc, item) => ({
      sessions: acc.sessions + item.sessions,
      sharedSessions: acc.sharedSessions + item.sharedSessions,
    }),
    { sessions: 0, sharedSessions: 0 },
  ),
)
const activityCards = computed(() => [
  {
    key: 'activeSessions',
    label: t('userDashboard.cards.activeSessions'),
    value: summary.value?.activeSessions ?? 0,
    route: { name: 'terminal', query: { returnTo: 'dashboard' } },
  },
  {
    key: 'totalSessions30d',
    label: t('userDashboard.cards.totalSessions30d'),
    value: summary.value?.totalSessionsLast30Days ?? 0,
    route: { name: 'my-activity' },
  },
  {
    key: 'uniqueHosts30d',
    label: t('userDashboard.cards.uniqueHosts30d'),
    value: summary.value?.uniqueHostsLast30Days ?? 0,
    route: { name: 'hosts' },
  },
  {
    key: 'snippets30d',
    label: t('userDashboard.cards.snippets30d'),
    value: summary.value?.totalSnippetExecutionsLast30Days ?? 0,
    route: auth.isAdmin
      ? { name: 'admin-reports-snippets' }
      : { name: 'snippets' },
  },
  {
    key: 'sshTunnel30d',
    label: t('userDashboard.cards.sshTunnel30d'),
    value: summary.value?.totalSshTunnelsLast30Days ?? 0,
    route: auth.isAdmin
      ? { name: 'admin-reports-ssh-tunnels' }
      : { name: 'forwardings' },
  },
  {
    key: 'sharedOwned30d',
    label: t('userDashboard.cards.sharedOwned30d'),
    value: summary.value?.sharedSessionsOwnedLast30Days ?? 0,
    route: { name: 'my-activity' },
  },
  {
    key: 'sharedParticipated30d',
    label: t('userDashboard.cards.sharedParticipated30d'),
    value: summary.value?.sharedSessionsParticipatedLast30Days ?? 0,
    route: { name: 'my-activity' },
  },
])

function formatTrendPeriodLabel(start: Date, end: Date) {
  const inclusiveEnd = new Date(end.getTime() - 1)
  return `${start.toLocaleDateString()} - ${inclusiveEnd.toLocaleDateString()}`
}

const favoriteHosts = computed(() =>
  favoriteHostIds.value
    .map((id) => hostById.value.get(id))
    .filter((host): host is HostPublic => !!host)
    .slice(0, 6),
)

const recentHosts = computed(() =>
  recentHostIds.value
    .map((id) => hostById.value.get(id))
    .filter((host): host is HostPublic => !!host)
    .slice(0, 6),
)

function canConnectHost(host: HostPublic): boolean {
  return auth.isAdmin || host.accessPermissions?.connect === true
}

function openHost(host: HostPublic) {
  if (!canConnectHost(host)) {
    message.warning(t('hosts.inventoryAcl.connectRequired'))
    return
  }
  markHostAsRecent(host.id)
  termStore.add({
    id: host.id,
    name: host.name,
    ip: host.ip,
    port: host.port,
    authType: host.authType,
    accessProtocol: host.accessProtocol,
  })
  resetTerminalLayout()
  router.push({ name: 'terminal' })
}

async function openTopHost(host: UserDashboardSummary['topHostsLast30Days'][number]) {
  if (host.hostDeleted) {
    message.warning(t('userDashboard.topHosts.deletedHostUnavailable'))
    return
  }

  let loadedHost = hostById.value.get(host.hostId)
  if (!loadedHost) {
    try {
      loadedHost = (await hostService.listVisibleByIds([host.hostId])).data[0]
    } catch {
      loadedHost = undefined
    }
  }
  if (!loadedHost || !canConnectHost(loadedHost)) {
    message.warning(t('hosts.inventoryAcl.connectRequired'))
    return
  }

  markHostAsRecent(host.hostId)
  termStore.add({
    id: host.hostId,
    name: loadedHost.name,
    ip: loadedHost.ip,
    port: loadedHost.port,
    authType: loadedHost.authType,
    accessProtocol: loadedHost.accessProtocol,
  })
  resetTerminalLayout()
  router.push({ name: 'terminal' })
}

async function loadQuickAccessHosts() {
  const ids = [...new Set([...favoriteHostIds.value, ...recentHostIds.value])]
  if (ids.length === 0) {
    quickAccessHosts.value = []
    return
  }

  try {
    const { data } = await hostService.listVisibleByIds(ids)
    quickAccessHosts.value = data
  } catch {
    quickAccessHosts.value = []
  }
}

async function load(options: { silent?: boolean } = {}) {
  if (!options.silent) loading.value = true
  error.value = null
  try {
    const { data: dashboard } = await userDashboardService.getSummary()
    summary.value = normalizeSummaryDates(dashboard)
  } catch {
    error.value = t('userDashboard.loadError')
  } finally {
    if (!options.silent) loading.value = false
  }
  void loadQuickAccessHosts()
}

onMounted(() => {
  load()
  refreshTimer = setInterval(() => load({ silent: true }), 30_000)
  window.addEventListener(INVENTORY_ACL_CHANGED_EVENT, onAccessChanged)
  window.addEventListener(USER_ACL_MEMBERSHIP_CHANGED_EVENT, onAccessChanged)
})

watch([favoriteHostIds, recentHostIds], () => {
  void loadQuickAccessHosts()
}, { deep: true })

onBeforeUnmount(() => {
  if (refreshTimer !== null) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
  if (aclRefreshTimer !== null) {
    clearTimeout(aclRefreshTimer)
    aclRefreshTimer = null
  }
  window.removeEventListener(INVENTORY_ACL_CHANGED_EVENT, onAccessChanged)
  window.removeEventListener(USER_ACL_MEMBERSHIP_CHANGED_EVENT, onAccessChanged)
})

function onAccessChanged() {
  if (aclRefreshTimer !== null) clearTimeout(aclRefreshTimer)
  aclRefreshTimer = setTimeout(() => {
    aclRefreshTimer = null
    hostService.clear('acl-realtime:dashboard')
    void load({ silent: true })
  }, 150)
}
</script>

<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-7">
      <div>
        <h1 class="text-xl font-semibold text-white">{{ $t('userDashboard.title') }}</h1>
        <NText depth="3" class="text-sm">{{ $t('userDashboard.subtitle') }}</NText>
      </div>
      <NButton size="small" ghost @click="() => load()">
        {{ $t('userDashboard.refresh') }}
      </NButton>
    </div>

    <NAlert v-if="error" type="error" :title="error" class="mb-6" />

    <div v-if="loading" class="flex justify-center py-12">
      <NSpin size="large" />
    </div>

    <template v-else>
      <div class="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <NCard :bordered="false" class="na-card">
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="text-sm font-semibold text-white">{{ $t('userDashboard.quickAccess.title') }}</div>
                <div class="text-xs text-gray-400">{{ $t('userDashboard.quickAccess.subtitle') }}</div>
              </div>
              <NButton text size="small" @click="router.push({ name: 'hosts' })">
                {{ $t('userDashboard.viewHosts') }}
              </NButton>
            </div>
          </template>

          <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <div class="mb-2 text-xs uppercase tracking-[0.18em] text-gray-500">{{ $t('userDashboard.quickAccess.favorites') }}</div>
              <div v-if="favoriteHosts.length" class="space-y-2">
                <button
                  v-for="host in favoriteHosts"
                  :key="`fav-${host.id}`"
                  type="button"
                  class="na-item na-item-hover w-full rounded-lg border px-3 py-2 text-left"
                  @click="openHost(host)"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <div class="truncate text-sm font-medium text-white">{{ host.name }}</div>
                      <div class="truncate text-xs font-mono text-gray-500">{{ host.ip }}:{{ host.port }}</div>
                    </div>
                    <NButton text size="tiny" @click.stop="toggleFavoriteHost(host.id)">★</NButton>
                  </div>
                </button>
              </div>
              <NEmpty v-else :description="$t('userDashboard.quickAccess.emptyFavorites')" class="py-4" />
            </div>

            <div>
              <div class="mb-2 text-xs uppercase tracking-[0.18em] text-gray-500">{{ $t('userDashboard.quickAccess.recent') }}</div>
              <div v-if="recentHosts.length" class="space-y-2">
                <button
                  v-for="host in recentHosts"
                  :key="`recent-${host.id}`"
                  type="button"
                  class="na-item na-item-hover w-full rounded-lg border px-3 py-2 text-left"
                  @click="openHost(host)"
                >
                  <div class="truncate text-sm font-medium text-white">{{ host.name }}</div>
                  <div class="truncate text-xs font-mono text-gray-500">{{ host.ip }}:{{ host.port }}</div>
                </button>
              </div>
              <NEmpty v-else :description="$t('userDashboard.quickAccess.emptyRecent')" class="py-4" />
            </div>
          </div>
        </NCard>

        <NCard :bordered="false" class="na-card">
          <template #header>
            <div>
              <div class="text-sm font-semibold text-white">{{ $t('userDashboard.activity.title') }}</div>
              <div class="text-xs text-gray-400">{{ $t('userDashboard.activity.subtitle') }}</div>
            </div>
          </template>

          <div class="grid grid-cols-1 gap-3">
            <button
              v-for="card in activityCards"
              :key="card.key"
              type="button"
              class="na-item na-item-hover group w-full rounded-lg border px-4 py-3 text-left focus:outline-none focus-visible:border-blue-400"
              :aria-label="$t('userDashboard.activity.openCard', { label: card.label })"
              @click="router.push(card.route)"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="text-xs uppercase tracking-[0.18em] text-gray-500">{{ card.label }}</div>
                  <div class="mt-1 text-3xl font-semibold text-white">{{ card.value }}</div>
                </div>
                <span
                  class="mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-700 text-sm font-semibold text-gray-400 transition-colors group-hover:border-blue-500/50 group-hover:text-blue-300"
                  aria-hidden="true"
                >
                  &gt;
                </span>
              </div>
              <div class="mt-2 text-xs text-gray-500 group-hover:text-gray-400">
                {{ $t('userDashboard.activity.openHint') }}
              </div>
            </button>
          </div>
        </NCard>
      </div>

      <NCard :bordered="false" class="na-card mt-4">
        <template #header>
          <div>
            <div class="text-sm font-semibold text-white">{{ $t('userDashboard.trend.title') }}</div>
            <div class="text-xs text-gray-400">{{ $t('userDashboard.trend.subtitle') }}</div>
            <div class="mt-1 text-[11px] text-gray-500">{{ $t('userDashboard.trend.caption') }}</div>
            <div class="mt-2 flex flex-wrap gap-2 text-[11px] text-gray-400">
              <NTag size="small" type="info">
                {{ $t('userDashboard.trend.totalSessions', { count: weeklyActivityTotals.sessions }) }}
              </NTag>
              <NTag size="small" type="success">
                {{ $t('userDashboard.trend.totalSharedSessions', { count: weeklyActivityTotals.sharedSessions }) }}
              </NTag>
            </div>
          </div>
        </template>

        <NEmpty
          v-if="!weeklyActivity.length"
          :description="$t('userDashboard.trend.empty')"
          class="py-8"
        />

        <div v-else class="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div
            v-for="item in weeklyActivity"
            :key="item.periodStart.toISOString()"
            class="na-item rounded-lg border px-4 py-4"
          >
            <div class="text-xs uppercase tracking-[0.14em] text-gray-500">
              {{ $t('userDashboard.trend.periodOf', { date: $d(item.periodStart, 'short') }) }}
            </div>
            <div class="mt-1 text-[11px] text-gray-500">
              {{ formatTrendPeriodLabel(item.periodStart, item.periodEnd) }}
            </div>
            <div class="mt-3 space-y-3">
              <div>
                <div class="mb-1 flex items-center justify-between text-xs text-gray-400">
                  <span>{{ $t('userDashboard.trend.sessions') }}</span>
                  <span>{{ item.sessions }}</span>
                </div>
                <div class="na-code h-2 overflow-hidden rounded-full">
                  <div
                    class="h-full rounded-full bg-blue-500"
                    :style="{ width: `${Math.max(8, (item.sessions / weeklyActivityMax) * 100)}%` }"
                  />
                </div>
                <div class="mt-1 text-[11px] text-gray-500">
                  {{ $t('userDashboard.trend.sessionsHelp') }}
                </div>
              </div>
              <div>
                <div class="mb-1 flex items-center justify-between text-xs text-gray-400">
                  <span>{{ $t('userDashboard.trend.sharedSessions') }}</span>
                  <span>{{ item.sharedSessions }}</span>
                </div>
                <div class="na-code h-2 overflow-hidden rounded-full">
                  <div
                    class="h-full rounded-full bg-emerald-500"
                    :style="{ width: `${Math.max(8, (item.sharedSessions / weeklyActivityMax) * 100)}%` }"
                  />
                </div>
                <div class="mt-1 text-[11px] text-gray-500">
                  {{ $t('userDashboard.trend.sharedSessionsHelp') }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </NCard>

      <NCard :bordered="false" class="na-card mt-4">
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-sm font-semibold text-white">{{ $t('userDashboard.topHosts.title') }}</div>
              <div class="text-xs text-gray-400">{{ $t('userDashboard.topHosts.subtitle') }}</div>
            </div>
            <NButton text size="small" @click="router.push({ name: 'hosts' })">
              {{ $t('userDashboard.viewHosts') }}
            </NButton>
          </div>
        </template>

        <NEmpty
          v-if="!summary?.topHostsLast30Days.length"
          :description="$t('userDashboard.topHosts.empty')"
          class="py-8"
        />

        <div v-else class="space-y-3">
          <button
            v-for="host in summary?.topHostsLast30Days"
            :key="`top-${host.hostId}`"
            type="button"
            :class="[
              'na-item w-full rounded-lg border px-4 py-3 text-left transition-colors',
              host.hostDeleted
                ? 'cursor-not-allowed opacity-80'
                : 'na-item-hover',
            ]"
            :aria-disabled="host.hostDeleted"
            @click="openTopHost(host)"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="truncate text-sm font-medium text-white">{{ host.hostName }}</div>
                <div class="truncate text-xs font-mono text-gray-500">{{ host.hostIp }}</div>
                <NTag v-if="host.hostDeleted" size="small" type="warning" class="mt-1">
                  {{ $t('hosts.messages.hostDeleted') }}
                </NTag>
              </div>
              <NTag size="small" type="info">
                {{ $t('userDashboard.topHosts.accessCount', { count: host.accessCount }) }}
              </NTag>
            </div>
            <div class="na-code mt-2 h-2 overflow-hidden rounded-full">
              <div
                class="h-full rounded-full bg-blue-500"
                :style="{ width: `${Math.max(18, (host.accessCount / Math.max(...(summary?.topHostsLast30Days.map((item) => item.accessCount) ?? [1]))) * 100)}%` }"
              />
            </div>
            <div class="mt-2 text-xs text-gray-500">
              {{ $t('userDashboard.topHosts.lastAccessed', { date: $d(host.lastAccessedAt, 'short') }) }}
            </div>
            <div v-if="host.hostDeleted" class="mt-2 text-xs text-amber-300/80">
              {{ $t('userDashboard.topHosts.deletedHostHint') }}
            </div>
          </button>
        </div>
      </NCard>

      <div class="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <NCard :bordered="false" class="na-card">
          <template #header>
            <div>
              <div class="text-sm font-semibold text-white">{{ $t('userDashboard.snippets.title') }}</div>
              <div class="text-xs text-gray-400">{{ $t('userDashboard.snippets.subtitle') }}</div>
            </div>
          </template>

          <NEmpty
            v-if="!summary?.topSnippetsLast30Days.length"
            :description="$t('userDashboard.snippets.empty')"
            class="py-8"
          />

          <div v-else class="space-y-3">
            <div
              v-for="snippet in summary?.topSnippetsLast30Days"
              :key="`snippet-${snippet.snippetId}`"
              class="na-item rounded-lg border px-4 py-3"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium text-white">{{ snippet.snippetName }}</div>
                </div>
                <NTag size="small" type="success">
                  {{ $t('userDashboard.snippets.usageCount', { count: snippet.usageCount }) }}
                </NTag>
              </div>
            </div>
          </div>
        </NCard>

        <NCard :bordered="false" class="na-card">
          <template #header>
            <div>
              <div class="text-sm font-semibold text-white">{{ $t('userDashboard.sshTunnel.title') }}</div>
              <div class="text-xs text-gray-400">{{ $t('userDashboard.sshTunnel.subtitle') }}</div>
            </div>
          </template>

          <NEmpty
            v-if="!(summary?.topSshTunnelsLast30Days?.length ?? 0)"
            :description="$t('userDashboard.sshTunnel.empty')"
            class="py-8"
          />

          <div v-else class="space-y-3">
            <div
              v-for="forwarding in summary?.topSshTunnelsLast30Days ?? []"
              :key="`web-${forwarding.forwardingId}`"
              class="na-item rounded-lg border px-4 py-3"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium text-white">{{ forwarding.label }}</div>
                  <div class="truncate text-xs text-gray-500">{{ forwarding.hostName }}</div>
                </div>
                <NTag size="small" type="warning">
                  {{ $t('userDashboard.sshTunnel.usageCount', { count: forwarding.usageCount }) }}
                </NTag>
              </div>
            </div>
          </div>
        </NCard>
      </div>
    </template>
  </div>
</template>
