<script setup lang="ts">
defineOptions({ name: 'SharedSessionView' })

import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NCard, NEmpty, NSelect, NSpin, NTag } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useSharedSessionViewer } from '@/composables/useSharedSessionViewer'
import { consumePendingSharedSession } from '@/services/shared-session-launch.service'
import { sharedSessionService } from '@/services/shared-session.service'
import { useAuthStore } from '@/stores/auth'
import type { SharedSessionControlLeaseMinutes, SharedSessionResolved, SharedSessionParticipant } from '@nodeaccess/shared'

const route = useRoute()
const router = useRouter()
const { t, d } = useI18n()
const auth = useAuthStore()
const terminalEl = ref<HTMLElement | null>(null)
const loading = ref(true)
const resolved = ref<SharedSessionResolved | null>(null)
const controlBusy = ref(false)
const showDetails = ref(false)
const selectedLeaseMinutes = ref<SharedSessionControlLeaseMinutes>(2)
let sharedSessionPollTimer: ReturnType<typeof setInterval> | null = null

const {
  status,
  error,
  role,
  participants,
  activeControlLease,
  pendingControlRequests,
  canInput,
  sharedStatus,
  expiresAt,
  mount,
  connect,
  focus,
  syncState,
} = useSharedSessionViewer()

const leaseOptions = computed(() => ([
  { label: '2 min', value: 2 },
  { label: '5 min', value: 5 },
  { label: '10 min', value: 10 },
  { label: '30 min', value: 30 },
]))

const activeParticipants = computed(() =>
  participants.value.filter((item) => !item.leftAt),
)

const currentUserId = computed(() => auth.user?.id ?? null)
const currentController = computed(() =>
  activeParticipants.value.find((item) => item.userId === activeControlLease.value?.controllerUserId) ?? null,
)
const pendingRequestParticipants = computed(() =>
  activeParticipants.value.filter((item) => pendingControlRequests.value.includes(item.userId)),
)
const hasPendingRequestForCurrentUser = computed(() =>
  pendingControlRequests.value.includes(currentUserId.value ?? -1),
)
const canRequestControl = computed(() =>
  role.value === 'viewer'
  && sharedStatus.value === 'active'
  && !activeControlLease.value
  && !hasPendingRequestForCurrentUser.value,
)
const canManageControl = computed(() =>
  role.value === 'owner' && sharedStatus.value === 'active',
)

function participantLabel(participant: SharedSessionParticipant) {
  return participant.role === 'owner'
    ? t('sharedSessions.ownerBadge')
    : t('sharedSessions.viewerBadge')
}

async function requestControl() {
  if (!resolved.value || controlBusy.value) return
  controlBusy.value = true
  try {
    await sharedSessionService.requestControl(resolved.value.sharedSessionId)
  } finally {
    controlBusy.value = false
  }
}

async function grantControl(userId: number, leaseMinutes: SharedSessionControlLeaseMinutes = 2) {
  if (!resolved.value || controlBusy.value) return
  controlBusy.value = true
  try {
    await sharedSessionService.grantControl(resolved.value.sharedSessionId, userId, { leaseMinutes })
  } finally {
    controlBusy.value = false
  }
}

async function denyControl(userId: number) {
  if (!resolved.value || controlBusy.value) return
  controlBusy.value = true
  try {
    await sharedSessionService.denyControl(resolved.value.sharedSessionId, userId)
  } finally {
    controlBusy.value = false
  }
}

async function revokeControl() {
  if (!resolved.value || controlBusy.value) return
  controlBusy.value = true
  try {
    await sharedSessionService.revokeControl(resolved.value.sharedSessionId)
  } finally {
    controlBusy.value = false
  }
}

async function loadSharedSession() {
  const id = Number(route.params.id)
  const pending = consumePendingSharedSession()

  if (pending && pending.sharedSessionId === id) {
    resolved.value = pending
  } else {
    const { data } = await sharedSessionService.getById(id)
      resolved.value = {
        sharedSessionId: data.id,
        role: data.owner.userId === currentUserId.value ? 'owner' : 'viewer',
        host: {
        id: data.hostId,
        tenantId: data.tenantId,
        name: data.hostName,
        ip: '',
        port: 22,
        sshUser: '',
        authType: 'password',
        connectionMode: 'direct',
        scope: 'global',
        groupId: null,
        folderId: null,
        bastionId: null,
        effectiveBastionId: null,
        effectiveBastionName: null,
        effectiveBastionSource: 'none',
        onePasswordRef: null,
        trustedHostKeyFingerprint: null,
        trustedHostKeyVerifiedAt: null,
          tags: [],
          createdAt: data.createdAt,
        },
        hostDeleted: data.hostDeleted ?? false,
        owner: data.owner,
        expiresAt: data.expiresAt,
        wsChannel: `shared-session:${data.id}`,
      activeControlLease: data.activeControlLease ?? null,
      pendingControlRequestUserIds: data.pendingControlRequestUserIds ?? [],
    }
  }

  loading.value = false
  await nextTick()
  if (terminalEl.value && resolved.value) {
    mount(terminalEl.value)
    await connect(resolved.value)
    focus()
  }
}

async function refreshSharedSessionState() {
  if (!resolved.value) return
  const { data } = await sharedSessionService.getById(resolved.value.sharedSessionId)
  syncState({
    participants: data.participants,
    status: data.status,
    expiresAt: data.expiresAt,
    activeControlLease: data.activeControlLease ?? null,
    pendingControlRequestUserIds: data.pendingControlRequestUserIds ?? [],
  })
}

onMounted(() => {
  void loadSharedSession()
  sharedSessionPollTimer = setInterval(() => {
    void refreshSharedSessionState()
  }, 3000)
})

onUnmounted(() => {
  if (sharedSessionPollTimer) clearInterval(sharedSessionPollTimer)
})
</script>

<template>
  <div class="h-screen overflow-hidden bg-[#101014] text-gray-100">
    <div class="mx-auto flex h-full w-full max-w-none flex-col gap-4 px-4 py-4">
      <div class="flex items-center justify-between gap-3">
        <div>
          <div class="text-xs uppercase tracking-[0.24em] text-cyan-300/80">{{ $t('sharedSessions.title') }}</div>
          <h1 class="text-xl font-semibold">{{ resolved?.host.name ?? $t('sharedSessions.loadingTitle') }}</h1>
          <p class="text-sm text-gray-400">
            {{ $t('sharedSessions.viewerHint', { owner: resolved?.owner.name ?? '...' }) }}
          </p>
          <div v-if="resolved?.hostDeleted" class="mt-2">
            <NTag size="small" type="warning">{{ $t('hosts.messages.hostDeleted') }}</NTag>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <NButton tertiary @click="showDetails = !showDetails">
            {{ showDetails ? $t('sharedSessions.hideDetails') : $t('sharedSessions.showDetails') }}
          </NButton>
          <NButton tertiary @click="router.push({ name: 'terminal' })">{{ $t('sharedSessions.backToTerminal') }}</NButton>
        </div>
      </div>

      <div v-if="loading" class="flex flex-1 items-center justify-center">
        <div class="flex flex-col items-center gap-3 text-center">
          <NSpin size="large" />
          <div class="text-sm text-gray-300">{{ $t('sharedSessions.loading') }}</div>
        </div>
      </div>

      <template v-else-if="resolved">
        <div class="rounded-2xl border border-gray-800 bg-[#16161a] px-4 py-3">
          <div class="flex flex-wrap items-center gap-2">
            <NTag size="small" type="info">{{ role === 'owner' ? $t('sharedSessions.ownerBadge') : $t('sharedSessions.viewerBadge') }}</NTag>
            <NTag size="small" :type="sharedStatus === 'active' ? 'success' : 'warning'">{{ $t(`sharedSessions.status.${sharedStatus}`) }}</NTag>
            <NTag size="small" :type="canInput ? 'success' : 'warning'">
              {{
                currentController
                  ? $t('sharedSessions.controllerNow', { name: currentController.name })
                  : $t('sharedSessions.controllerOwner', { name: resolved.owner.name })
              }}
            </NTag>
            <NTag size="small" type="default">
              {{ $t('sharedSessions.participantsBadge', { count: activeParticipants.length }) }}
            </NTag>
            <NTag v-if="resolved.hostDeleted" size="small" type="warning">
              {{ $t('hosts.messages.hostDeleted') }}
            </NTag>
            <div class="ml-auto flex flex-wrap gap-2">
              <NButton
                v-if="canRequestControl"
                tertiary
                type="warning"
                :loading="controlBusy"
                @click="requestControl"
              >
                {{ $t('sharedSessions.requestControl') }}
              </NButton>
              <NButton
                v-else-if="hasPendingRequestForCurrentUser"
                tertiary
                disabled
              >
                {{ $t('sharedSessions.requestedControl') }}
              </NButton>
              <NButton
                v-if="canManageControl && activeControlLease"
                tertiary
                type="warning"
                :loading="controlBusy"
                @click="revokeControl"
              >
                {{ $t('sharedSessions.reclaimControl') }}
              </NButton>
            </div>
          </div>
          <div v-if="activeControlLease?.expiresAt" class="mt-2 text-xs text-gray-400">
            {{ $t('sharedSessions.controlExpiresAt', { date: d(activeControlLease.expiresAt, 'short') }) }}
          </div>
          <div v-if="resolved.hostDeleted" class="mt-2 text-xs text-amber-300/80">
            {{ $t('sharedSessions.deletedHostHint') }}
          </div>
        </div>

        <div class="grid min-h-0 flex-1 gap-4" :class="showDetails ? 'xl:grid-cols-[280px,minmax(0,1fr)]' : 'grid-cols-1'">
          <NCard v-if="showDetails" embedded :bordered="false" class="min-h-0 overflow-auto bg-[#16161a]">
            <div class="space-y-4">
              <div>
                <div class="text-xs uppercase tracking-[0.18em] text-gray-500">{{ $t('sharedSessions.owner') }}</div>
                <div class="mt-1 text-sm font-medium text-gray-100">{{ resolved.owner.name }}</div>
                <div class="text-xs text-gray-400">{{ resolved.owner.email || '—' }}</div>
              </div>

              <div class="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div class="text-xs uppercase tracking-[0.18em] text-gray-500">{{ $t('sharedSessions.role') }}</div>
                  <div class="mt-1">
                    <NTag size="small" type="info">{{ role === 'owner' ? $t('sharedSessions.ownerBadge') : $t('sharedSessions.viewerBadge') }}</NTag>
                  </div>
                </div>
                <div>
                  <div class="text-xs uppercase tracking-[0.18em] text-gray-500">{{ $t('common.status') }}</div>
                  <div class="mt-1">
                    <NTag size="small" :type="sharedStatus === 'active' ? 'success' : 'warning'">{{ $t(`sharedSessions.status.${sharedStatus}`) }}</NTag>
                  </div>
                </div>
              </div>

              <div>
                <div class="text-xs uppercase tracking-[0.18em] text-gray-500">{{ $t('sharedSessions.expiresAt') }}</div>
                <div class="mt-1 text-sm text-gray-200">{{ expiresAt ? d(expiresAt, 'short') : '—' }}</div>
              </div>

              <div>
                <div class="text-xs uppercase tracking-[0.18em] text-gray-500">{{ $t('sharedSessions.control') }}</div>
                <div class="mt-1">
                  <NTag size="small" :type="canInput ? 'success' : 'warning'">
                    {{
                      currentController
                        ? $t('sharedSessions.controllerNow', { name: currentController.name })
                        : $t('sharedSessions.controllerOwner', { name: resolved.owner.name })
                    }}
                  </NTag>
                </div>
                <div v-if="activeControlLease?.expiresAt" class="mt-1 text-xs text-gray-400">
                  {{ $t('sharedSessions.controlExpiresAt', { date: d(activeControlLease.expiresAt, 'short') }) }}
                </div>
              </div>

              <div>
                <div class="mb-2 text-xs uppercase tracking-[0.18em] text-gray-500">{{ $t('sharedSessions.participants') }}</div>
                <div v-if="activeParticipants.length" class="space-y-2">
                  <div
                    v-for="participant in activeParticipants"
                    :key="participant.userId"
                    class="rounded-xl border border-gray-800 bg-[#111113] px-3 py-2"
                  >
                    <div class="flex items-center justify-between gap-2">
                      <div>
                        <div class="text-sm text-gray-100">{{ participant.name }}</div>
                        <div class="text-xs text-gray-400">{{ participant.email || '—' }}</div>
                      </div>
                      <NTag size="small" :type="participant.role === 'owner' ? 'warning' : 'default'">
                        {{ participantLabel(participant) }}
                      </NTag>
                    </div>
                  </div>
                </div>
                <NEmpty v-else size="small" :description="$t('sharedSessions.noParticipants')" />
              </div>

              <div v-if="canManageControl && pendingRequestParticipants.length">
                <div class="mb-2 flex items-center justify-between gap-2">
                  <div class="text-xs uppercase tracking-[0.18em] text-gray-500">{{ $t('sharedSessions.pendingRequests') }}</div>
                  <NSelect
                    v-model:value="selectedLeaseMinutes"
                    size="small"
                    style="width: 110px"
                    :options="leaseOptions"
                  />
                </div>
                <div class="space-y-2">
                  <div
                    v-for="participant in pendingRequestParticipants"
                    :key="`pending-${participant.userId}`"
                    class="rounded-xl border border-amber-900/50 bg-amber-950/20 px-3 py-2"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div>
                        <div class="text-sm text-gray-100">{{ participant.name }}</div>
                        <div class="text-xs text-gray-400">{{ participant.email || '—' }}</div>
                      </div>
                      <div class="flex gap-2">
                        <NButton size="tiny" tertiary type="success" :loading="controlBusy" @click="grantControl(participant.userId, selectedLeaseMinutes)">
                          {{ $t('sharedSessions.grantSelected') }}
                        </NButton>
                        <NButton size="tiny" tertiary :loading="controlBusy" @click="denyControl(participant.userId)">
                          {{ $t('sharedSessions.deny') }}
                        </NButton>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <NAlert :type="canInput ? 'success' : 'info'" :show-icon="false">
                {{ canInput ? $t('sharedSessions.controlEnabledNotice') : $t('sharedSessions.readOnlyNotice') }}
              </NAlert>
            </div>
          </NCard>

          <div class="flex min-h-0 flex-col overflow-hidden rounded-t-2xl border border-gray-800 border-b-0 bg-[#16161a]">
            <div class="flex items-center justify-between border-b border-gray-800 px-4 py-2 text-sm text-gray-300">
              <span>{{ $t('sharedSessions.liveOutput') }}</span>
              <NTag size="small" :type="status === 'connected' ? 'success' : status === 'connecting' ? 'warning' : 'default'">
                {{ $t(`sharedSessions.connection.${status}`) }}
              </NTag>
            </div>
            <NAlert v-if="error" type="error" :show-icon="false" class="m-3">
              {{ error }}
            </NAlert>
            <div ref="terminalEl" class="min-h-0 flex-1 w-full border-b border-gray-800 bg-[#1a1b1e]" />
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
