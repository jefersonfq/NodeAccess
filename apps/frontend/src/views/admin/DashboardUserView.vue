<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NCard, NEmpty, NSelect, NSpin, NTag, NText } from 'naive-ui'
import type { DashboardStats } from '@nodeaccess/shared'
import { useI18n } from 'vue-i18n'
import { dashboardService } from '@/services/dashboard.service'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const periodDays = ref<number>(30)
const loading = ref(true)
const error = ref<string | null>(null)
const stats = ref<DashboardStats | null>(null)

const periodOptions = [
  { label: '7 dias', value: 7 },
  { label: '30 dias', value: 30 },
  { label: '90 dias', value: 90 },
]

const selectedUserId = computed(() => Number(route.params.userId))
const userDetail = computed(() =>
  stats.value?.adoption.userDrilldowns.find((item) => item.userId === selectedUserId.value) ?? null,
)
const userUsage = computed(() =>
  stats.value?.adoption.userResourceUsage.find((item) => item.userId === selectedUserId.value) ?? null,
)

function formatDate(d: Date | string) {
  return new Date(d).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const { data } = await dashboardService.getStats(periodDays.value)
    stats.value = data
    if (!userDetail.value) {
      error.value = t('admin.dashboard.adoption.userNotFound')
    }
  } catch {
    error.value = t('admin.dashboard.adoption.userDetailLoadError')
  } finally {
    loading.value = false
  }
}

watch(periodDays, load)
watch(() => route.params.userId, load)
onMounted(load)
</script>

<template>
  <div class="p-8 max-w-6xl">
    <div class="mb-7 flex items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold text-white">
          {{ userDetail ? $t('admin.dashboard.adoption.userDetailTitle', { user: userDetail.userName }) : $t('admin.dashboard.adoption.userDetailFallback') }}
        </h1>
        <NText depth="3" class="text-sm">
          {{ $t('admin.dashboard.adoption.userDetailPageSubtitle') }}
        </NText>
      </div>
      <div class="flex items-center gap-2">
        <NSelect v-model:value="periodDays" :options="periodOptions" size="small" style="width:120px" />
        <NButton ghost size="small" @click="router.push({ name: 'admin-dashboard' })">
          {{ $t('admin.dashboard.adoption.backToDashboard') }}
        </NButton>
      </div>
    </div>

    <NAlert v-if="error" type="error" :title="error" class="mb-6" />

    <NSpin :show="loading">
      <template v-if="userDetail">
        <div class="grid grid-cols-1 gap-4 xl:grid-cols-[0.85fr_1.15fr]">
          <NCard :bordered="false" style="background:#17171b;">
            <template #header>
              <div>
                <div class="text-sm font-semibold text-white">{{ userDetail.userName }}</div>
                <div class="text-xs text-gray-400">{{ userDetail.userEmail || '—' }}</div>
              </div>
            </template>

            <div v-if="userUsage" class="grid grid-cols-2 gap-3">
              <div class="rounded-lg border border-gray-800 bg-[#111113] px-4 py-3">
                <div class="text-xs uppercase tracking-[0.18em] text-gray-500">{{ $t('admin.dashboard.adoption.resourceSessions') }}</div>
                <div class="mt-1 text-2xl font-semibold text-white">{{ userUsage.sessions }}</div>
              </div>
              <div class="rounded-lg border border-gray-800 bg-[#111113] px-4 py-3">
                <div class="text-xs uppercase tracking-[0.18em] text-gray-500">{{ $t('admin.dashboard.adoption.resourceSnippets') }}</div>
                <div class="mt-1 text-2xl font-semibold text-white">{{ userUsage.snippets }}</div>
              </div>
              <div class="rounded-lg border border-gray-800 bg-[#111113] px-4 py-3">
                <div class="text-xs uppercase tracking-[0.18em] text-gray-500">{{ $t('admin.dashboard.adoption.resourceLocalAccess') }}</div>
                <div class="mt-1 text-2xl font-semibold text-white">{{ userUsage.localAccess }}</div>
              </div>
              <div class="rounded-lg border border-gray-800 bg-[#111113] px-4 py-3">
                <div class="text-xs uppercase tracking-[0.18em] text-gray-500">{{ $t('admin.dashboard.adoption.resourceLiveSessions') }}</div>
                <div class="mt-1 text-2xl font-semibold text-white">{{ userUsage.liveSessions }}</div>
              </div>
            </div>

            <div class="mt-4">
              <div class="mb-3 text-sm font-semibold text-white">{{ $t('admin.dashboard.adoption.userTopHosts') }}</div>
              <div v-if="userDetail.topHosts.length" class="space-y-3">
                <div
                  v-for="host in userDetail.topHosts"
                  :key="`detail-host-${host.hostId}`"
                  class="rounded-lg border border-gray-800 bg-[#111113] px-4 py-3"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <div class="truncate text-sm font-medium text-white">{{ host.hostName }}</div>
                      <div class="truncate text-xs font-mono text-gray-500">{{ host.hostIp }}</div>
                    </div>
                    <NTag size="small" type="info">{{ $t('admin.dashboard.adoption.sessionsCount', { count: host.accessCount }) }}</NTag>
                  </div>
                </div>
              </div>
              <NEmpty v-else :description="$t('admin.dashboard.adoption.emptyUserTopHosts')" class="py-6" />
            </div>
          </NCard>

          <NCard :bordered="false" style="background:#17171b;">
            <template #header>
              <div>
                <div class="text-sm font-semibold text-white">{{ $t('admin.dashboard.adoption.userRecentAccesses') }}</div>
                <div class="text-xs text-gray-400">{{ $t('admin.dashboard.adoption.userRecentAccessesHint') }}</div>
              </div>
            </template>

            <div v-if="userDetail.recentAccesses.length" class="space-y-3">
              <div
                v-for="access in userDetail.recentAccesses"
                :key="`detail-access-${access.sessionId}`"
                class="rounded-lg border border-gray-800 bg-[#111113] px-4 py-3"
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
            <NEmpty v-else :description="$t('admin.dashboard.adoption.emptyUserRecentAccesses')" class="py-6" />
          </NCard>
        </div>
      </template>
    </NSpin>
  </div>
</template>
