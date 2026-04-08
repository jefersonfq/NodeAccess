<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { NAlert, NButton, NCard, NEmpty, NSpin, NTag, NText } from 'naive-ui'
import type { HostPublic, UserDashboardSummary } from '@nodeaccess/shared'
import { useI18n } from 'vue-i18n'
import { favoriteHostIds, recentHostIds, markHostAsRecent, toggleFavoriteHost } from '@/services/host-quick-access.service'
import { hostService } from '@/services/host.service'
import { userDashboardService } from '@/services/user-dashboard.service'
import { resetTerminalLayout } from '@/services/terminal-layout.service'
import { useTerminalStore } from '@/stores/terminals'

const router = useRouter()
const termStore = useTerminalStore()
const { t } = useI18n()

const loading = ref(true)
const error = ref<string | null>(null)
const summary = ref<UserDashboardSummary | null>(null)
const hosts = ref<HostPublic[]>([])
let refreshTimer: ReturnType<typeof setInterval> | null = null

function normalizeSummaryDates(input: UserDashboardSummary): UserDashboardSummary {
  return {
    ...input,
    topHostsLast30Days: input.topHostsLast30Days.map((host) => ({
      ...host,
      lastAccessedAt: new Date(host.lastAccessedAt),
    })),
    weeklyActivityLast4Weeks: input.weeklyActivityLast4Weeks.map((item) => ({
      ...item,
      periodStart: new Date(item.periodStart),
      periodEnd: new Date(item.periodEnd),
    })),
  }
}

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

function formatTrendPeriodLabel(start: Date, end: Date) {
  const inclusiveEnd = new Date(end.getTime() - 1)
  return `${start.toLocaleDateString()} - ${inclusiveEnd.toLocaleDateString()}`
}

const favoriteHosts = computed(() =>
  favoriteHostIds.value
    .map((id) => hosts.value.find((host) => host.id === id))
    .filter((host): host is HostPublic => !!host)
    .slice(0, 6),
)

const recentHosts = computed(() =>
  recentHostIds.value
    .map((id) => hosts.value.find((host) => host.id === id))
    .filter((host): host is HostPublic => !!host)
    .slice(0, 6),
)

function openHost(host: HostPublic) {
  markHostAsRecent(host.id)
  termStore.add({
    id: host.id,
    name: host.name,
    ip: host.ip,
    port: host.port,
    authType: host.authType,
  })
  resetTerminalLayout()
  router.push({ name: 'terminal' })
}

function openTopHost(host: UserDashboardSummary['topHostsLast30Days'][number]) {
  markHostAsRecent(host.hostId)
  const loadedHost = hosts.value.find((item) => item.id === host.hostId)
  termStore.add({
    id: host.hostId,
    name: loadedHost?.name ?? host.hostName,
    ip: loadedHost?.ip ?? host.hostIp,
    port: loadedHost?.port,
    authType: loadedHost?.authType,
  })
  resetTerminalLayout()
  router.push({ name: 'terminal' })
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

  void hostService.list({ limit: 300 })
    .then(({ data: hostResponse }) => {
      hosts.value = hostResponse.data
    })
    .catch(() => {
      hosts.value = []
    })
}

onMounted(() => {
  load()
  refreshTimer = setInterval(() => load({ silent: true }), 30_000)
})

onBeforeUnmount(() => {
  if (refreshTimer !== null) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
})
</script>

<template>
  <div class="p-8 max-w-6xl">
    <div class="flex items-center justify-between mb-7">
      <div>
        <h1 class="text-2xl font-semibold text-white">{{ $t('userDashboard.title') }}</h1>
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
        <NCard :bordered="false" style="background:#17171b;">
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
                  class="w-full rounded-lg border border-gray-800 bg-[#111113] px-3 py-2 text-left transition-colors hover:border-blue-500/40 hover:bg-[#1a1a1f]"
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
                  class="w-full rounded-lg border border-gray-800 bg-[#111113] px-3 py-2 text-left transition-colors hover:border-blue-500/40 hover:bg-[#1a1a1f]"
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

        <NCard :bordered="false" style="background:#17171b;">
          <template #header>
            <div>
              <div class="text-sm font-semibold text-white">{{ $t('userDashboard.activity.title') }}</div>
              <div class="text-xs text-gray-400">{{ $t('userDashboard.activity.subtitle') }}</div>
            </div>
          </template>

          <div class="grid grid-cols-1 gap-3">
            <div class="rounded-lg border border-gray-800 bg-[#111113] px-4 py-3">
              <div class="text-xs uppercase tracking-[0.18em] text-gray-500">{{ $t('userDashboard.cards.activeSessions') }}</div>
              <div class="mt-1 text-3xl font-semibold text-white">{{ summary?.activeSessions ?? 0 }}</div>
            </div>
            <div class="rounded-lg border border-gray-800 bg-[#111113] px-4 py-3">
              <div class="text-xs uppercase tracking-[0.18em] text-gray-500">{{ $t('userDashboard.cards.totalSessions30d') }}</div>
              <div class="mt-1 text-3xl font-semibold text-white">{{ summary?.totalSessionsLast30Days ?? 0 }}</div>
            </div>
            <div class="rounded-lg border border-gray-800 bg-[#111113] px-4 py-3">
              <div class="text-xs uppercase tracking-[0.18em] text-gray-500">{{ $t('userDashboard.cards.uniqueHosts30d') }}</div>
              <div class="mt-1 text-3xl font-semibold text-white">{{ summary?.uniqueHostsLast30Days ?? 0 }}</div>
            </div>
            <div class="rounded-lg border border-gray-800 bg-[#111113] px-4 py-3">
              <div class="text-xs uppercase tracking-[0.18em] text-gray-500">{{ $t('userDashboard.cards.snippets30d') }}</div>
              <div class="mt-1 text-3xl font-semibold text-white">{{ summary?.totalSnippetExecutionsLast30Days ?? 0 }}</div>
            </div>
            <div class="rounded-lg border border-gray-800 bg-[#111113] px-4 py-3">
              <div class="text-xs uppercase tracking-[0.18em] text-gray-500">{{ $t('userDashboard.cards.localAccess30d') }}</div>
              <div class="mt-1 text-3xl font-semibold text-white">{{ summary?.totalLocalAccessLast30Days ?? 0 }}</div>
            </div>
            <div class="rounded-lg border border-gray-800 bg-[#111113] px-4 py-3">
              <div class="text-xs uppercase tracking-[0.18em] text-gray-500">{{ $t('userDashboard.cards.sharedOwned30d') }}</div>
              <div class="mt-1 text-3xl font-semibold text-white">{{ summary?.sharedSessionsOwnedLast30Days ?? 0 }}</div>
            </div>
            <div class="rounded-lg border border-gray-800 bg-[#111113] px-4 py-3">
              <div class="text-xs uppercase tracking-[0.18em] text-gray-500">{{ $t('userDashboard.cards.sharedParticipated30d') }}</div>
              <div class="mt-1 text-3xl font-semibold text-white">{{ summary?.sharedSessionsParticipatedLast30Days ?? 0 }}</div>
            </div>
          </div>
        </NCard>
      </div>

      <NCard :bordered="false" style="background:#17171b;" class="mt-4">
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
            class="rounded-lg border border-gray-800 bg-[#111113] px-4 py-4"
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
                <div class="h-2 overflow-hidden rounded-full bg-[#222228]">
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
                <div class="h-2 overflow-hidden rounded-full bg-[#222228]">
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

      <NCard :bordered="false" style="background:#17171b;" class="mt-4">
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
            class="w-full rounded-lg border border-gray-800 bg-[#111113] px-4 py-3 text-left transition-colors hover:border-blue-500/40 hover:bg-[#1a1a1f]"
            @click="openTopHost(host)"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="truncate text-sm font-medium text-white">{{ host.hostName }}</div>
                <div class="truncate text-xs font-mono text-gray-500">{{ host.hostIp }}</div>
              </div>
              <NTag size="small" type="info">
                {{ $t('userDashboard.topHosts.accessCount', { count: host.accessCount }) }}
              </NTag>
            </div>
            <div class="mt-2 h-2 overflow-hidden rounded-full bg-[#222228]">
              <div
                class="h-full rounded-full bg-blue-500"
                :style="{ width: `${Math.max(18, (host.accessCount / Math.max(...(summary?.topHostsLast30Days.map((item) => item.accessCount) ?? [1]))) * 100)}%` }"
              />
            </div>
            <div class="mt-2 text-xs text-gray-500">
              {{ $t('userDashboard.topHosts.lastAccessed', { date: $d(host.lastAccessedAt, 'short') }) }}
            </div>
          </button>
        </div>
      </NCard>

      <div class="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <NCard :bordered="false" style="background:#17171b;">
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
              class="rounded-lg border border-gray-800 bg-[#111113] px-4 py-3"
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

        <NCard :bordered="false" style="background:#17171b;">
          <template #header>
            <div>
              <div class="text-sm font-semibold text-white">{{ $t('userDashboard.localAccess.title') }}</div>
              <div class="text-xs text-gray-400">{{ $t('userDashboard.localAccess.subtitle') }}</div>
            </div>
          </template>

          <NEmpty
            v-if="!summary?.topLocalAccessLast30Days.length"
            :description="$t('userDashboard.localAccess.empty')"
            class="py-8"
          />

          <div v-else class="space-y-3">
            <div
              v-for="forwarding in summary?.topLocalAccessLast30Days"
              :key="`web-${forwarding.forwardingId}`"
              class="rounded-lg border border-gray-800 bg-[#111113] px-4 py-3"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <div class="truncate text-sm font-medium text-white">{{ forwarding.label }}</div>
                  <div class="truncate text-xs text-gray-500">{{ forwarding.hostName }}</div>
                </div>
                <NTag size="small" type="warning">
                  {{ $t('userDashboard.localAccess.usageCount', { count: forwarding.usageCount }) }}
                </NTag>
              </div>
            </div>
          </div>
        </NCard>
      </div>
    </template>
  </div>
</template>
