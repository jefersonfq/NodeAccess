<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { NInput, NButton, NSelect, NText, NTooltip } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useTerminal, termSettings, setFontSize, setTheme, applyTerminalPreset, setShowTerminalToolbar, themeOptions, presetOptions, currentThemeColors, type HostKeyVerificationChallenge, type CredentialsChallenge, type SavePasswordOffer, type TunnelState, type ConnectionMethod } from '@/composables/useTerminal'
import { usePlatform } from '@/composables/usePlatform'
import { useTerminalStore } from '@/stores/terminals'

const props = defineProps<{
  hostId:  number
  tabId:   string
  visible: boolean
}>()

const emit = defineEmits<{
  connected:              [hostName: string]
  sessionChange:          [sessionId: number | null]
  statusChange:           [status: string]
  errorChange:            [error: string | null]
  latencyChange:          [ms: number]
  tunnelsChange:          [state: TunnelState]
  hostKeyVerificationRequired: [challenge: HostKeyVerificationChallenge]
  credentialsRequired:    [challenge: CredentialsChallenge]
  savePasswordOffer:      [offer: SavePasswordOffer]
  output:                 [chunk: string]
  hostSwitcherRequested:  []
  snippetQuickPickerRequested: []
  connectionRouteChange:  [connectionMethod: ConnectionMethod | null, agentName: string | null]
}>()

const { t } = useI18n()
const termStore   = useTerminalStore()
const terminalEl  = ref<HTMLElement | null>(null)
const terminalContainerEl = ref<HTMLElement | null>(null)
const searchInputEl = ref<{ focus: () => void } | null>(null)
const copyModeEl  = ref<HTMLElement | null>(null)
const showSearch  = ref(false)
const showInfo    = ref(false)
const showCopyMode = ref(false)
const copyModeText = ref('')
const searchQuery = ref('')

const { platform, shortcuts, isSnippetShortcutEvent, isHostSwitcherShortcutEvent } = usePlatform()

const { status, error, sessionId, hostName, isScrolledUp, latency, tunnelState, hostKeyChallenge, credentialsChallenge, savePasswordOffer, outputVersion, latestOutputChunk, connectionMethod, agentName, mount, connect, reconnect, disconnect, fit, focus,
        searchNext, searchPrev, clear, scrollToBottom, sendText, sendSecretText, sendCredentialsResponse, dismissSavePasswordOffer, getBufferText, getSelectionText, setDisableStdin } = useTerminal(props.tabId)

// Metadados da aba (IP, porta, auth, connectedAt)
const tabInfo = computed(() => termStore.tabs.find((tab) => tab.id === props.tabId))
const detectedPlatformLabel = computed(() => {
  if (platform === 'macos') return 'macOS'
  if (platform === 'windows') return 'Windows'
  return 'Linux'
})
const copyShortcutHint = computed(() => (platform === 'macos' ? '⌘C' : 'Ctrl+Shift+C'))
const pasteShortcutHint = computed(() => (platform === 'macos' ? '⌘V' : 'Ctrl+Shift+V / Shift+Insert'))
const shouldShowRecommendedPreset = computed(() => termSettings.preset !== platform)

// Tempo de sessão formatado
const elapsed = ref('')
let elapsedTimer: ReturnType<typeof setInterval> | null = null
let pendingRefitTimers: ReturnType<typeof setTimeout>[] = []
let containerResizeObserver: ResizeObserver | null = null

function formatElapsed(from: Date | undefined): string {
  if (!from) return '—'
  const secs = Math.floor((Date.now() - from.getTime()) / 1000)
  if (secs < 60) return 'agora'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const rem   = mins % 60
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`
}

function updateElapsed() {
  elapsed.value = formatElapsed(tabInfo.value?.connectedAt)
}

function clearPendingRefits() {
  pendingRefitTimers.forEach((timer) => clearTimeout(timer))
  pendingRefitTimers = []
}

function scheduleRefit() {
  clearPendingRefits()
  const delays = [0, 80, 220]
  delays.forEach((delay) => {
    const timer = setTimeout(() => fit(), delay)
    pendingRefitTimers.push(timer)
  })
}

watch(hostName,    (name)  => { if (name) emit('connected', name) })
watch(sessionId,   (value) => emit('sessionChange', value))
watch(status,      (s)     => emit('statusChange', s))
watch(error,       (value) => emit('errorChange', value))
watch(latency,     (ms)    => { if (ms !== null) emit('latencyChange', ms) })
watch(tunnelState, (state) => emit('tunnelsChange', state), { deep: true })
watch(connectionMethod, (method) => emit('connectionRouteChange', method, agentName.value))
watch(hostKeyChallenge, (challenge) => {
  if (challenge) emit('hostKeyVerificationRequired', challenge)
})
watch(credentialsChallenge, (challenge) => {
  if (challenge) emit('credentialsRequired', challenge)
})
watch(savePasswordOffer, (offer) => {
  if (offer) emit('savePasswordOffer', offer)
})
watch(outputVersion, () => emit('output', latestOutputChunk.value))

// Quando o painel se torna visível pela primeira vez, garante dimensões corretas
// antes de conectar — v-show mantém o elemento no DOM mas com display:none,
// então o fit retorna 0 colunas se chamado enquanto o painel está oculto.
let connected = false
watch(() => props.visible, (visible) => {
  if (visible) {
    nextTick(() => {
      scheduleRefit()
      if (!connected) {
        connected = true
        connect(props.hostId)
      }
    })
  }
})

// Inicia timer de elapsed quando conecta
watch(status, (s) => {
  if (s === 'connected') {
    nextTick(() => scheduleRefit())
    updateElapsed()
    elapsedTimer = setInterval(updateElapsed, 30_000)
  } else {
    if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null }
  }
})

onMounted(() => {
  if (terminalContainerEl.value) {
    containerResizeObserver = new ResizeObserver(() => scheduleRefit())
    containerResizeObserver.observe(terminalContainerEl.value)
  }
  if (terminalEl.value) {
    mount(terminalEl.value, {
      onOpenSearch: () => {
        if (props.visible) toggleSearch()
      },
      onShortcutKey: (event) => {
        if (!props.visible) return false
        if (isSnippetShortcutEvent(event)) {
          emit('snippetQuickPickerRequested')
          return true
        }
        if (isHostSwitcherShortcutEvent(event)) {
          emit('hostSwitcherRequested')
          return true
        }
        return false
      },
      onConfirmMultilinePaste: (text) => confirmMultilinePaste(text),
    })
    // Só conecta imediatamente se o painel já estiver visível
    if (props.visible) {
      nextTick(() => {
        requestAnimationFrame(() => {
          scheduleRefit()
          connected = true
          connect(props.hostId)
        })
      })
    }
  }
})

onUnmounted(() => {
  clearPendingRefits()
  containerResizeObserver?.disconnect()
  containerResizeObserver = null
  disconnect()
  if (elapsedTimer) clearInterval(elapsedTimer)
})

// ── Modo cópia (seleção nativa do browser) ─────────────────────────────────

function openCopyMode() {
  copyModeText.value = getBufferText()
  setDisableStdin(true)
  showCopyMode.value = true
  nextTick(() => {
    if (copyModeEl.value) {
      copyModeEl.value.scrollTop = copyModeEl.value.scrollHeight
      copyModeEl.value.focus()
    }
  })
}

function closeCopyMode() {
  showCopyMode.value = false
  setDisableStdin(false)
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT'
    || target.tagName === 'TEXTAREA'
    || target.isContentEditable
    || !!target.closest('input, textarea, [contenteditable="true"]')
}

function countMeaningfulLines(text: string) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/g, '')
  if (!normalized) return 0
  return normalized.split('\n').length
}

function confirmMultilinePaste(text: string) {
  const lines = countMeaningfulLines(text)
  if (lines <= 1) return true
  if (termSettings.multilinePasteMode === 'never') return true
  if (termSettings.multilinePasteMode === 'more-than-5' && lines <= 5) return true
  return window.confirm(t('terminal.multilinePaste.confirm', { lines }))
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    if (!text) return
    if (!confirmMultilinePaste(text)) return
    sendText(text)
    focus()
  } catch {
    // Silently ignore denied clipboard reads.
  }
}

function onTerminalContextMenu(event: MouseEvent) {
  if (!props.visible || showCopyMode.value) return
  if (termSettings.rightClickMode === 'browser-menu') return
  if (termSettings.rightClickMode === 'default') return
  if (termSettings.rightClickMode === 'host-switcher') {
    event.preventDefault()
    emit('hostSwitcherRequested')
    return
  }
  event.preventDefault()
  void pasteFromClipboard()
}

// ── Busca ──────────────────────────────────────────────────────────────────

function toggleSearch() {
  showSearch.value = !showSearch.value
  if (!showSearch.value) {
    searchQuery.value = ''
  } else {
    nextTick(() => searchInputEl.value?.focus())
  }
}

function onSearchKey(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.shiftKey ? searchPrev(searchQuery.value) : searchNext(searchQuery.value)
  } else if (e.key === 'Escape') {
    toggleSearch()
  }
}

// ── Atalhos globais ────────────────────────────────────────────────────────
// Ctrl+F / Cmd+F são interceptados pelo customKeyEventHandler do xterm (não chegam aqui).
// Este listener cobre atalhos fora do foco do terminal e o Ctrl+Shift+F legado.

function onGlobalKey(e: KeyboardEvent) {
  if (!props.visible) return
  if (isEditableTarget(e.target)) return
  if (showCopyMode.value && e.key === 'Escape') { closeCopyMode(); return }
  // Busca: Ctrl+F (Win/Linux fora do xterm), Cmd+F (Mac fora do xterm), Ctrl+Shift+F (legado)
  const isFind = (e.ctrlKey && !e.metaKey && e.key === 'f' && !e.shiftKey) ||
                 (e.metaKey && !e.ctrlKey && e.key === 'f' && !e.shiftKey) ||
                 (e.ctrlKey && e.shiftKey && e.key === 'F')
  if (isFind) { e.preventDefault(); toggleSearch(); return }
  if (e.ctrlKey && e.shiftKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); setFontSize(termSettings.fontSize + 1) }
  if (e.ctrlKey && e.shiftKey && e.key === '-') { e.preventDefault(); setFontSize(termSettings.fontSize - 1) }
}

onMounted(()   => window.addEventListener('keydown', onGlobalKey))
onUnmounted(() => window.removeEventListener('keydown', onGlobalKey))

defineExpose({
  reconnect,
  status,
  error,
  sendText,
  sendSecretText,
  sendCredentialsResponse,
  dismissSavePasswordOffer,
  focus,
  getSessionId: () => sessionId.value,
  getBufferText: () => getBufferText(),
  getSelectionText: () => getSelectionText(),
})
</script>

<template>
    <div
      v-show="visible"
      class="flex flex-col h-full"
      @contextmenu.capture="onTerminalContextMenu"
    >

    <!-- ── Toolbar ─────────────────────────────────────────────────────── -->
    <div v-if="termSettings.showTerminalToolbar" class="flex items-center gap-2 px-3 shrink-0 border-b border-gray-800" style="background:#18181c; height:36px;">

      <NSelect
        :value="termSettings.preset"
        :options="presetOptions"
        size="small"
        style="width:112px;"
        @update:value="(v) => applyTerminalPreset(v)"
      />

      <NSelect
        :value="termSettings.theme"
        :options="themeOptions"
        size="small"
        style="width:140px;"
        @update:value="(v) => setTheme(v)"
      />

      <div class="w-px h-4 bg-gray-700 shrink-0" />

      <!-- Fonte -->
      <div class="flex items-center gap-1">
        <NTooltip trigger="hover" placement="bottom">
          <template #trigger>
            <NButton size="small" text style="color:#9ca3af;font-size:11px;font-weight:600;padding:0 4px;" @click="setFontSize(termSettings.fontSize - 1)">A-</NButton>
          </template>
          Diminuir fonte ({{ shortcuts.fontDecrease }})
        </NTooltip>
        <NText style="font-size:11px;color:#6b7280;width:32px;text-align:center;">{{ termSettings.fontSize }}px</NText>
        <NTooltip trigger="hover" placement="bottom">
          <template #trigger>
            <NButton size="small" text style="color:#9ca3af;font-size:13px;font-weight:600;padding:0 4px;" @click="setFontSize(termSettings.fontSize + 1)">A+</NButton>
          </template>
          Aumentar fonte ({{ shortcuts.fontIncrease }})
        </NTooltip>
      </div>

      <div class="w-px h-4 bg-gray-700 shrink-0" />

      <NTooltip trigger="hover" placement="bottom">
        <template #trigger>
          <NButton size="small" text style="color:#9ca3af;" @click="clear">{{ $t('terminal.clear') }}</NButton>
        </template>
        Limpa o buffer do terminal sem encerrar a sessão
      </NTooltip>

      <NTooltip trigger="hover" placement="bottom">
        <template #trigger>
          <NButton size="small" text style="color:#9ca3af;" @click="toggleSearch">{{ $t('terminal.find') }}</NButton>
        </template>
        Buscar no terminal ({{ shortcuts.find }})
      </NTooltip>

      <NTooltip trigger="hover" placement="bottom">
        <template #trigger>
          <NButton size="small" text style="color:#9ca3af;" @click="openCopyMode">Texto</NButton>
        </template>
        Abrir buffer como texto — seleção nativa do browser
      </NTooltip>

      <NTooltip trigger="hover" placement="bottom">
        <template #trigger>
          <NButton size="small" text style="color:#9ca3af;" @click="pasteFromClipboard">Colar</NButton>
        </template>
        Colar do clipboard no terminal ({{ shortcuts.paste }})
      </NTooltip>

      <NTooltip trigger="hover" placement="bottom">
        <template #trigger>
          <NText class="hidden xl:block" style="font-size:11px;color:#6b7280;">
            {{ $t('terminal.shortcutsHint', { copy: copyShortcutHint, paste: pasteShortcutHint, find: shortcuts.find }) }}
          </NText>
        </template>
        {{ $t('terminal.shortcutsHintTooltip') }}
      </NTooltip>

      <!-- Info da conexão -->
      <NTooltip trigger="hover" placement="bottom">
        <template #trigger>
          <NButton
            size="small" text
            :style="showInfo ? 'color:#60a5fa;' : 'color:#9ca3af;'"
            @click="showInfo = !showInfo"
          >Info</NButton>
        </template>
        Detalhes da conexão
      </NTooltip>

      <NTooltip trigger="hover" placement="bottom">
        <template #trigger>
          <NButton size="small" text style="color:#4b5563;font-size:13px;padding:0 2px;" @click="setShowTerminalToolbar(false)">⊟</NButton>
        </template>
        {{ $t('terminal.toolbar.hide') }}
      </NTooltip>

      <div class="flex-1" />

      <NTooltip v-if="shouldShowRecommendedPreset" trigger="hover" placement="bottom">
        <template #trigger>
          <NButton
            size="small"
            text
            style="color:#60a5fa;"
            @click="applyTerminalPreset(platform)"
          >
            {{ $t('terminal.recommendedPresetShort', { platform: detectedPlatformLabel }) }}
          </NButton>
        </template>
        {{ $t('terminal.recommendedPresetTooltip', { platform: detectedPlatformLabel }) }}
      </NTooltip>

      <NTooltip v-if="status !== 'connected' && status !== 'connecting'" trigger="hover" placement="bottom">
        <template #trigger>
          <NButton size="small" type="warning" @click="reconnect(hostId)">↺ Reconectar</NButton>
        </template>
        Reconectar ao host (sessão: {{ status }})
      </NTooltip>

      <div
        class="w-2 h-2 rounded-full shrink-0"
        :class="{
          'bg-green-400':  status === 'connected',
          'bg-yellow-400': status === 'connecting',
          'bg-red-400':    status === 'error' || status === 'closed',
          'bg-gray-500':   status === 'idle',
        }"
      />
    </div>

    <!-- ── Info overlay ─────────────────────────────────────────────────── -->
    <div
      v-if="showInfo && tabInfo"
      class="flex items-center gap-6 px-4 py-2 border-b border-gray-800 text-xs shrink-0"
      style="background:#111113; color:#9ca3af;"
    >
      <span><span style="color:#6b7280;">Host:</span> {{ tabInfo.hostName }}</span>
      <span><span style="color:#6b7280;">IP:</span> {{ tabInfo.hostIp ?? '—' }}:{{ tabInfo.hostPort ?? '—' }}</span>
      <span><span style="color:#6b7280;">Auth:</span> {{ tabInfo.hostAuthType === 'pem' ? '🔑 PEM' : tabInfo.hostAuthType === 'pem_password' ? '🔑+🔒 PEM + Senha' : '🔒 Senha' }}</span>
      <span><span style="color:#6b7280;">Sessão:</span> {{ elapsed || '—' }}</span>
      <button class="ml-auto text-gray-600 hover:text-white" @click="showInfo = false">✕</button>
    </div>

    <!-- ── Barra de busca ──────────────────────────────────────────────── -->
    <div
      v-if="showSearch"
      class="flex items-center gap-2 px-4 py-2 border-b border-gray-700 shrink-0"
      style="background:#18181c;"
    >
      <NInput
        ref="searchInputEl"
        v-model:value="searchQuery"
        :placeholder="$t('terminal.searchPlaceholder')"
        size="small" clearable style="max-width:480px"
        @keydown="onSearchKey"
      />
      <NButton size="small" @click="searchPrev(searchQuery)">↑</NButton>
      <NButton size="small" @click="searchNext(searchQuery)">↓</NButton>
      <NButton size="small" text @click="toggleSearch">✕</NButton>
    </div>

    <!-- ── Terminal ────────────────────────────────────────────────────── -->
    <div ref="terminalContainerEl" class="flex-1 overflow-hidden relative select-none">
      <div ref="terminalEl" class="absolute inset-0" :style="showCopyMode ? { pointerEvents: 'none' } : {}" />

      <!-- Floating controls when toolbar is hidden -->
      <Transition name="fade">
        <div
          v-if="!termSettings.showTerminalToolbar && !showCopyMode"
          class="absolute top-2 right-2 flex items-center gap-1 rounded px-1.5 py-0.5"
          style="background:rgba(24,24,28,0.75);backdrop-filter:blur(4px);z-index:10;border:1px solid rgba(255,255,255,0.06);"
        >
          <NTooltip v-if="status !== 'connected' && status !== 'connecting'" trigger="hover" placement="bottom">
            <template #trigger>
              <NButton size="small" type="warning" style="height:20px;font-size:11px;padding:0 6px;" @click="reconnect(hostId)">↺</NButton>
            </template>
            Reconectar ao host (sessão: {{ status }})
          </NTooltip>
          <div
            class="w-1.5 h-1.5 rounded-full shrink-0"
            :class="{
              'bg-green-400':  status === 'connected',
              'bg-yellow-400': status === 'connecting',
              'bg-red-400':    status === 'error' || status === 'closed',
              'bg-gray-500':   status === 'idle',
            }"
          />
          <NTooltip trigger="hover" placement="bottom">
            <template #trigger>
              <NButton size="small" text style="color:#6b7280;font-size:12px;padding:0 2px;height:20px;" @click="setShowTerminalToolbar(true)">⊞</NButton>
            </template>
            {{ $t('terminal.toolbar.show') }}
          </NTooltip>
        </div>
      </Transition>

      <!-- Scroll to bottom -->
      <Transition name="fade">
        <button
          v-if="isScrolledUp && !showCopyMode"
          class="absolute bottom-4 right-4 w-8 h-8 rounded-full flex items-center justify-center text-sm shadow-lg transition-opacity"
          style="background:#3b82f6;color:#fff;border:none;cursor:pointer;"
          :title="$t('terminal.scrollToBottom')"
          @click="scrollToBottom"
        >↓</button>
      </Transition>

      <!-- Modo cópia: buffer como texto nativo selecionável -->
      <Transition name="fade">
        <div
          v-if="showCopyMode"
          class="absolute inset-0 flex flex-col"
          :style="{ background: currentThemeColors().background, userSelect: 'text', cursor: 'text', zIndex: 1001 }"
        >
          <div
            class="flex items-center gap-2 px-3 py-1 shrink-0 border-b"
            style="border-color:#ffffff18; background:#ffffff08;"
          >
            <span style="font-size:11px; color:#6b7280;">Modo texto — selecione e copie normalmente</span>
            <button
              class="ml-auto text-xs px-2 py-0.5 rounded"
              style="background:#3b82f6;color:#fff;border:none;cursor:pointer;"
              @click="closeCopyMode"
            >✕ Fechar</button>
          </div>
          <pre
            ref="copyModeEl"
            tabindex="0"
            class="flex-1 overflow-auto p-3 m-0 select-text"
            :style="{
              fontFamily: 'Menlo, Monaco, Courier New, monospace',
              fontSize: termSettings.fontSize + 'px',
              color: currentThemeColors().foreground,
              background: 'transparent',
              whiteSpace: 'pre',
              cursor: 'text',
              border: 'none',
              outline: 'none',
            }"
          >{{ copyModeText }}</pre>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* O terminal normal deve usar a seleção do próprio xterm, não a seleção nativa do browser. */
:deep(.xterm),
:deep(.xterm *),
:deep(.xterm-rows),
:deep(.xterm-screen),
:deep(.xterm-screen canvas) {
  user-select: none !important;
  -webkit-user-select: none !important;
}

/* Cursor I-beam dentro do terminal, igual ao PuTTY/MobaXterm */
:deep(.xterm-viewport),
:deep(.xterm-screen) {
  cursor: text !important;
}

/* Mantém o helper textarea focável, mas fora da área visível para evitar caret/seleção nativos. */
:deep(.xterm-helper-textarea) {
  position: absolute !important;
  left: -9999px !important;
  top: 0 !important;
  width: 1px !important;
  height: 1px !important;
  opacity: 0 !important;
  pointer-events: none !important;
  z-index: -1 !important;
  caret-color: transparent !important;
}

/* Garante que o overlay de seleção não bloqueie eventos de mouse */
:deep(.xterm-selection),
:deep(.xterm-selection div) {
  user-select: none !important;
  -webkit-user-select: none !important;
  pointer-events: none !important;
}
</style>
