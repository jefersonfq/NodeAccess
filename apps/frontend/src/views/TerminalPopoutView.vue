<script setup lang="ts">
defineOptions({ name: 'TerminalPopoutView' })

import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NAlert, NButton, NInput, NModal, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import TerminalPane from '@/components/TerminalPane.vue'
import type { CredentialsChallenge, HostKeyVerificationChallenge, SavePasswordOffer, TunnelState } from '@/composables/useTerminal'
import {
  listenTerminalPopoutEvents,
  notifyTerminalPopoutClosed,
  notifyTerminalPopoutConnected,
  requestTerminalPopoutInsert,
  serializeTerminalPopoutHost,
  TERMINAL_POPOUT_DRAG_MIME,
  type TerminalPopoutHost,
} from '@/services/terminal-popout.service'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const { t } = useI18n()

const paneRef = ref<InstanceType<typeof TerminalPane> | null>(null)
const tabId = `popout-${crypto.randomUUID()}`
const sourceTabId = computed(() => String(route.query.sourceTabId ?? ''))
const mode = computed(() => route.query.mode === 'move' ? 'move' : 'copy')
const status = ref('idle')
const error = ref<string | null>(null)
const latency = ref<number | null>(null)
const sessionId = ref<number | null>(null)
const connectedOnce = ref(false)
const insertPending = ref(false)
const pendingInsertRequestId = ref<string | null>(null)
let insertTimeout: ReturnType<typeof setTimeout> | null = null
let closedNotified = false

const credentialsModal = ref<{ challenge: CredentialsChallenge } | null>(null)
const credUsernameInput = ref('')
const credPasswordInput = ref('')
const hostKeyModal = ref<HostKeyVerificationChallenge | null>(null)

const host = computed<TerminalPopoutHost | null>(() => {
  const id = Number(route.query.hostId)
  const name = String(route.query.hostName ?? '')
  if (!Number.isFinite(id) || id <= 0 || !name) return null

  const port = Number(route.query.hostPort)
  return {
    id,
    name,
    ip: route.query.hostIp ? String(route.query.hostIp) : undefined,
    port: Number.isFinite(port) && port > 0 ? port : undefined,
    authType: route.query.authType ? String(route.query.authType) : undefined,
  }
})

const endpoint = computed(() => {
  if (!host.value?.ip) return ''
  return `${host.value.ip}:${host.value.port ?? 22}`
})

function onConnected(name: string) {
  connectedOnce.value = true
  if (host.value) {
    notifyTerminalPopoutConnected({
      popoutId: tabId,
      sourceTabId: sourceTabId.value,
      mode: mode.value,
      host: { ...host.value, name },
    })
  }
  document.title = `${name} - NodeAccess`
}

function onStatusChange(value: string) {
  status.value = value
}

function onErrorChange(value: string | null) {
  error.value = value
}

function onSessionChange(value: number | null) {
  sessionId.value = value
}

function onLatencyChange(value: number) {
  latency.value = value
}

function onTunnelsChange(_state: TunnelState) {
  // Pop-out keeps tunnel details inside the terminal pane for now.
}

function onHostKeyVerificationRequired(challenge: HostKeyVerificationChallenge) {
  hostKeyModal.value = challenge
}

function onCredentialsRequired(challenge: CredentialsChallenge) {
  credUsernameInput.value = ''
  credPasswordInput.value = ''
  credentialsModal.value = { challenge }
  void nextTick(() => {
    const inputId = challenge.needsUsername ? 'popout-cred-username' : 'popout-cred-password'
    document.getElementById(inputId)?.focus()
  })
}

function submitCredentialsChallenge() {
  if (!credentialsModal.value) return
  const challenge = credentialsModal.value.challenge
  if (challenge.needsUsername && !credUsernameInput.value) return
  if (challenge.needsPassword && !credPasswordInput.value) return
  paneRef.value?.sendCredentialsResponse?.(credUsernameInput.value, credPasswordInput.value)
  credentialsModal.value = null
  credUsernameInput.value = ''
  credPasswordInput.value = ''
}

function cancelCredentialsChallenge() {
  credentialsModal.value = null
}

function onSavePasswordOffer(_offer: SavePasswordOffer) {
  paneRef.value?.dismissSavePasswordOffer?.()
}

function clearInsertTimeout() {
  if (!insertTimeout) return
  clearTimeout(insertTimeout)
  insertTimeout = null
}

function insertBackIntoMainWindow() {
  if (!host.value || insertPending.value) return
  insertPending.value = true
  pendingInsertRequestId.value = requestTerminalPopoutInsert(host.value, tabId)
  clearInsertTimeout()
  insertTimeout = setTimeout(() => {
    insertPending.value = false
    pendingInsertRequestId.value = null
    message.warning(t('terminal.popout.insertNoMainWindow'))
  }, 1500)
}

function onPopoutDragStart(event: DragEvent) {
  if (!host.value) return
  const requestId = crypto.randomUUID()
  pendingInsertRequestId.value = requestId
  event.dataTransfer?.setData(TERMINAL_POPOUT_DRAG_MIME, serializeTerminalPopoutHost(host.value, tabId, requestId))
  event.dataTransfer?.setData('text/plain', host.value.name)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function closePopout() {
  window.close()
  if (!window.closed) void router.push({ name: 'terminal' })
}

function notifyClosedOnce() {
  if (closedNotified) return
  closedNotified = true
  notifyTerminalPopoutClosed(tabId)
}

const stopPopoutEvents = listenTerminalPopoutEvents((event) => {
  if (event.type !== 'terminal-popout-inserted') return
  if (event.requestId !== pendingInsertRequestId.value) return
  clearInsertTimeout()
  closePopout()
})

onMounted(() => {
  if (host.value) document.title = `${host.value.name} - NodeAccess`
  window.addEventListener('pagehide', notifyClosedOnce)
})

onUnmounted(() => {
  clearInsertTimeout()
  window.removeEventListener('pagehide', notifyClosedOnce)
  notifyClosedOnce()
  stopPopoutEvents()
})
</script>

<template>
  <main class="h-screen min-h-0 bg-[#111113] text-gray-100 flex flex-col overflow-hidden">
    <header
      class="h-12 shrink-0 border-b border-gray-800 bg-[#18181c] px-4 flex items-center gap-3 min-w-0"
      draggable="true"
      @dragstart="onPopoutDragStart"
    >
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 min-w-0">
          <span
            class="w-2 h-2 rounded-full shrink-0"
            :class="status === 'connected' ? 'bg-green-400' : status === 'connecting' ? 'bg-yellow-400 animate-pulse' : status === 'error' || status === 'closed' ? 'bg-red-400' : 'bg-gray-500'"
          />
          <h1 class="text-sm font-semibold truncate">{{ host?.name ?? $t('terminal.popout.invalidHost') }}</h1>
          <span v-if="endpoint" class="text-xs text-gray-500 font-mono truncate">{{ endpoint }}</span>
        </div>
        <div class="text-[11px] text-gray-500 truncate">
          <span>{{ $t('terminal.popout.independentSession') }}</span>
          <span> · {{ $t('terminal.popout.dragHint') }}</span>
          <span v-if="sessionId"> · #{{ sessionId }}</span>
          <span v-if="latency !== null"> · {{ latency }}ms</span>
        </div>
      </div>

      <NButton size="small" secondary :loading="insertPending" :disabled="!host" @click="insertBackIntoMainWindow">
        {{ $t('terminal.popout.insertBack') }}
      </NButton>
      <NButton size="small" quaternary @click="closePopout">
        {{ $t('terminal.popout.closeWindow') }}
      </NButton>
    </header>

    <NAlert v-if="error" type="error" :show-icon="false" class="m-3 shrink-0">
      {{ error }}
    </NAlert>
    <NAlert v-if="mode === 'move' && !connectedOnce" type="info" :show-icon="false" class="m-3 shrink-0">
      {{ $t('terminal.popout.moveNotice') }}
    </NAlert>

    <section class="relative flex-1 min-h-0 m-2 overflow-hidden rounded-md border border-gray-800 bg-[#1a1b1e]">
      <TerminalPane
        v-if="host"
        ref="paneRef"
        :tab-id="tabId"
        :host-id="host.id"
        :visible="true"
        class="absolute inset-0"
        @connected="onConnected"
        @session-change="onSessionChange"
        @status-change="onStatusChange"
        @error-change="onErrorChange"
        @latency-change="onLatencyChange"
        @tunnels-change="onTunnelsChange"
        @host-key-verification-required="onHostKeyVerificationRequired"
        @credentials-required="onCredentialsRequired"
        @save-password-offer="onSavePasswordOffer"
      />
      <div v-else class="absolute inset-0 flex items-center justify-center text-sm text-gray-400">
        {{ $t('terminal.popout.invalidHost') }}
      </div>
    </section>

    <NModal
      :show="!!credentialsModal"
      preset="dialog"
      :title="$t('terminal.credentialsChallenge.title')"
      :positive-text="$t('terminal.credentialsChallenge.connect')"
      :negative-text="$t('terminal.hostKey.cancel')"
      @positive-click="submitCredentialsChallenge"
      @negative-click="cancelCredentialsChallenge"
      @close="cancelCredentialsChallenge"
    >
      <div class="space-y-3">
        <p class="text-sm text-gray-400">
          {{ $t('terminal.credentialsChallenge.description', { host: credentialsModal?.challenge.hostName ?? host?.name ?? '' }) }}
        </p>
        <NInput
          v-if="credentialsModal?.challenge.needsUsername"
          id="popout-cred-username"
          v-model:value="credUsernameInput"
          :placeholder="$t('terminal.credentialsChallenge.usernamePlaceholder')"
          @keydown.enter="submitCredentialsChallenge"
        />
        <NInput
          v-if="credentialsModal?.challenge.needsPassword"
          id="popout-cred-password"
          v-model:value="credPasswordInput"
          type="password"
          show-password-on="click"
          :placeholder="$t('terminal.credentialsChallenge.passwordPlaceholder')"
          @keydown.enter="submitCredentialsChallenge"
        />
      </div>
    </NModal>

    <NModal
      :show="!!hostKeyModal"
      preset="dialog"
      :title="$t('terminal.hostKey.titleUnknown')"
      :positive-text="$t('terminal.hostKey.cancel')"
      @positive-click="hostKeyModal = null"
      @close="hostKeyModal = null"
    >
      <div class="space-y-3 text-sm">
        <NAlert type="warning" :show-icon="false">
          {{ $t('terminal.popout.hostKeyMainWindow') }}
        </NAlert>
        <div class="font-mono text-xs break-all text-gray-300">
          {{ hostKeyModal?.presentedFingerprint }}
        </div>
      </div>
    </NModal>
  </main>
</template>
