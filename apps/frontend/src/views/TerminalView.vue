<script setup lang="ts">
defineOptions({ name: 'TerminalView' })

import { ref, computed, watch, onMounted, onUnmounted, onActivated, onDeactivated, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import {
  NButton, NTag, NSpace, NText, NTooltip, NDropdown, NAlert, useMessage,
  NModal, NInput, NCard, NGrid, NGridItem, NSpin, NEmpty, NSelect,
} from 'naive-ui'
import type { DropdownOption } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import TerminalPane    from '@/components/TerminalPane.vue'
import FileManager     from '@/components/FileManager.vue'
import SnippetsPanel   from '@/components/SnippetsPanel.vue'
import TunnelManager   from '@/components/TunnelManager.vue'
import { useTerminalStore } from '@/stores/terminals'
import { useAuthStore } from '@/stores/auth'
import { broadcastEnabled } from '@/composables/useTerminalBroadcast'
import type { HostKeyVerificationChallenge, TunnelState } from '@/composables/useTerminal'
import { applyTerminalPreset, termSettings } from '@/composables/useTerminal'
import {
  snippetService,
  deserializeSnippetCommand,
  getSnippetExecutionSecretAliases,
  getSnippetSecretAliases,
  maskSecretPlaceholders,
  type Snippet,
  type SnippetExecution,
} from '@/services/snippet.service'
import { featuresService } from '@/services/features.service'
import { hostService }     from '@/services/host.service'
import { hostLinkService } from '@/services/host-link.service'
import { sharedSessionService } from '@/services/shared-session.service'
import { recordUserProductivityEvent } from '@/services/user-productivity-telemetry.service'
import { SESSION_EXPIRED_EVENT } from '@/services/auth-session.service'
import { TERMINAL_LAYOUT_RESET_EVENT } from '@/services/terminal-layout.service'
import { consumePendingTerminalHost } from '@/services/terminal-launch.service'
import { usePlatform } from '@/composables/usePlatform'
import type { HostPublic, SharedSessionPublic } from '@nodeaccess/shared'
import { favoriteHostIds, markHostAsRecent, recentHostIds } from '@/services/host-quick-access.service'

const { t } = useI18n()
const router    = useRouter()
const auth = useAuthStore()
const termStore = useTerminalStore()
const message = useMessage()
const isTerminalActive = ref(true)
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1440)
const terminalViewportEl = ref<HTMLElement | null>(null)
const isBrowserFullscreen = ref(false)
const autoFullscreenAttempted = ref(false)

// ── Platform detection ────────────────────────────────────────────────────

const { platform, isMac, shortcuts, isSnippetShortcutEvent, isHostSwitcherShortcutEvent } = usePlatform()

const TERMINAL_ONBOARDING_KEY = 'na_terminal_onboarding_dismissed'
const showPlatformOnboarding = ref(localStorage.getItem(TERMINAL_ONBOARDING_KEY) !== '1')
const showDiagnostics = ref(false)

// Features
const multiConnect = ref(false)
const feedbackLicensed = ref(false)
const OPEN_FEEDBACK_MODAL_EVENT = 'nodeaccess:open-feedback-modal'
onMounted(async () => {
  const pendingHost = consumePendingTerminalHost()
  if (pendingHost) {
    const existingTab = termStore.tabs.find((tab) => tab.hostId === pendingHost.id)
    if (existingTab) {
      termStore.activate(existingTab.id)
    } else {
      termStore.add({
        id: pendingHost.id,
        name: pendingHost.name,
        ip: pendingHost.ip,
        port: pendingHost.port,
        authType: pendingHost.authType,
      })
    }
  }

  const f = await featuresService.get()
  multiConnect.value = f.multiConnect
  feedbackLicensed.value = f.feedbackLicensed
})

function openFeedbackFromTerminal() {
  if (!feedbackLicensed.value) return
  window.dispatchEvent(new Event(OPEN_FEEDBACK_MODAL_EVENT))
}

// Status e latência por aba
const tabStatus  = ref<Record<string, string>>({})
const tabErrors = ref<Record<string, string | null>>({})
const tabLatency = ref<Record<string, number>>({})
const tabTunnels = ref<Record<string, TunnelState>>({})
const tabSessionIds = ref<Record<string, number | null>>({})
const tabSharedSessionIds = ref<Record<string, number | null>>({})
const showSharedSessionManager = ref(false)
const sharedSessionManagerLoading = ref(false)
const sharedSessionManagerBusy = ref(false)
const currentSharedSession = ref<SharedSessionPublic | null>(null)
const selectedTerminalLeaseMinutes = ref<2 | 5 | 10 | 30>(2)
let sharedSessionPollTimer: ReturnType<typeof setInterval> | null = null
const trustingHostKey = ref(false)
const hostKeyPolicyLoading = ref(false)
const hostKeyModal = ref<{
  tabId: string
  hostId: number
  hostName: string
  hostScope: HostPublic['scope'] | null
  canTrust: boolean
  challenge: HostKeyVerificationChallenge
} | null>(null)

function onConnected(tabId: string, hostName: string) {
  termStore.setName(tabId, hostName)
  termStore.setConnectedAt(tabId)
}
function onStatusChange(tabId: string, status: string) {
  tabStatus.value = { ...tabStatus.value, [tabId]: status }
}
function onErrorChange(tabId: string, value: string | null) {
  tabErrors.value = { ...tabErrors.value, [tabId]: value }
}
function onLatencyChange(tabId: string, ms: number) {
  tabLatency.value = { ...tabLatency.value, [tabId]: ms }
}
function onTunnelsChange(tabId: string, state: TunnelState) {
  tabTunnels.value = { ...tabTunnels.value, [tabId]: state }
}
function onPanelTunnelsChange(state: TunnelState) {
  const activeId = termStore.activeId
  if (!activeId) return
  onTunnelsChange(activeId, state)
}
function onSessionChange(tabId: string, sessionId: number | null) {
  tabSessionIds.value = { ...tabSessionIds.value, [tabId]: sessionId }
}

function canCurrentUserTrustHostKey(scope: HostPublic['scope'] | null) {
  if (auth.isAdmin) return true
  if (scope === 'personal') return true
  if (scope === 'team') return !!auth.user?.canManageHosts
  if (scope === 'global') return false
  return false
}

function hostKeyPermissionMessage(scope: HostPublic['scope'] | null) {
  if (scope === 'team') return t('terminal.hostKey.permissionTeam')
  if (scope === 'global') return t('terminal.hostKey.permissionGlobal')
  return t('terminal.hostKey.permissionUnknown')
}

async function onHostKeyVerificationRequired(tabId: string, challenge: HostKeyVerificationChallenge) {
  const tab = termStore.tabs.find((item) => item.id === tabId)
  if (!tab) return

  hostKeyModal.value = {
    tabId,
    hostId: tab.hostId,
    hostName: tab.hostName,
    hostScope: null,
    canTrust: false,
    challenge,
  }

  hostKeyPolicyLoading.value = true
  try {
    const { data } = await hostService.get(tab.hostId)
    hostKeyModal.value = {
      tabId,
      hostId: tab.hostId,
      hostName: tab.hostName,
      hostScope: data.scope,
      canTrust: canCurrentUserTrustHostKey(data.scope),
      challenge,
    }
  } catch {
    if (hostKeyModal.value?.tabId === tabId) {
      hostKeyModal.value = {
        ...hostKeyModal.value,
        canTrust: auth.isAdmin,
      }
    }
  } finally {
    hostKeyPolicyLoading.value = false
  }
}

function onTerminalOutput(tabId: string, chunk = '') {
  processExpectSendOutput(tabId, chunk)
  if (!isTerminalActive.value || termStore.activeId !== tabId) {
    termStore.markActivity(tabId)
    return
  }
  termStore.clearUnread(tabId)
}

function onSplitOutput(tabId: string, chunk = '') {
  processExpectSendOutput(tabId, chunk)
  if (!isTerminalActive.value) {
    termStore.markActivity(tabId)
    return
  }
  termStore.clearUnread(tabId)
}

function closeTab(id: string) {
  cancelExpectSendMacro(id, false)
  termStore.remove(id)
  delete tabLatency.value[id]
  delete tabTunnels.value[id]
  delete tabSessionIds.value[id]
  delete tabSharedSessionIds.value[id]
  delete tabStatus.value[id]
  delete tabErrors.value[id]
  delete splitPaneStatus.value[id]
  delete paneRefs[id]
  if (termStore.tabs.length <= 1) {
    splitEnabled.value = false
    broadcastEnabled.value = false
  }
  if (termStore.tabs.length === 0) router.push({ name: 'hosts' })
}

function closeOtherTabs(id: string) {
  const idsToClose = termStore.tabs.filter((tab) => tab.id !== id).map((tab) => tab.id)
  idsToClose.forEach((tabId) => closeTab(tabId))
}

function closeTabsToRight(id: string) {
  const currentIndex = termStore.tabs.findIndex((tab) => tab.id === id)
  if (currentIndex === -1) return
  const idsToClose = termStore.tabs.slice(currentIndex + 1).map((tab) => tab.id)
  idsToClose.forEach((tabId) => closeTab(tabId))
}

function closeAllTabs() {
  const idsToClose = termStore.tabs.map((tab) => tab.id)
  idsToClose.forEach((tabId) => closeTab(tabId))
}

const tabCtxVisible = ref(false)
const tabCtxX = ref(0)
const tabCtxY = ref(0)
const tabCtxTabId = ref<string | null>(null)

function tabMenuOptions(tabId: string): DropdownOption[] {
  const currentIndex = termStore.tabs.findIndex((tab) => tab.id === tabId)
  const hasTabsToRight = currentIndex >= 0 && currentIndex < termStore.tabs.length - 1
  return [
    { key: `activate:${tabId}`, label: 'Ativar aba' },
    { key: `close:${tabId}`, label: 'Fechar aba' },
    { key: `close-others:${tabId}`, label: 'Fechar outras' },
    ...(hasTabsToRight ? [{ key: `close-right:${tabId}`, label: 'Fechar à direita' }] : []),
    { key: 'close-all', label: 'Fechar todas' },
  ]
}

const activeTabMenuOptions = computed(() =>
  tabCtxTabId.value ? tabMenuOptions(tabCtxTabId.value) : [],
)

function openTabContextMenu(event: MouseEvent, tabId: string) {
  event.preventDefault()
  tabCtxTabId.value = tabId
  tabCtxVisible.value = false
  setTimeout(() => {
    tabCtxX.value = event.clientX
    tabCtxY.value = event.clientY
    tabCtxVisible.value = true
  }, 0)
}

function onTabMenuSelect(key: string | number) {
  tabCtxVisible.value = false
  const value = String(key)
  if (value === 'close-all') {
    closeAllTabs()
    return
  }
  const [action, tabId] = value.split(':')
  if (!tabId) return
  if (action === 'activate') termStore.activate(tabId)
  if (action === 'close') closeTab(tabId)
  if (action === 'close-others') {
    termStore.activate(tabId)
    closeOtherTabs(tabId)
  }
  if (action === 'close-right') closeTabsToRight(tabId)
}

// ── Tempo de sessão nas abas ──────────────────────────────────────────────

const now = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | null = null

onMounted(()   => { clockTimer = setInterval(() => { now.value = Date.now() }, 30_000) })
onUnmounted(() => { if (clockTimer) clearInterval(clockTimer) })

function formatElapsed(from: Date | undefined): string {
  if (!from) return ''
  const secs = Math.floor((now.value - from.getTime()) / 1000)
  if (secs < 60) return ''
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const rem   = mins % 60
  return rem > 0 ? `${hours}h${rem}m` : `${hours}h`
}

// ── Host picker ───────────────────────────────────────────────────────────

const showPicker    = ref(false)
const pickerSearch  = ref('')
const pickerHosts   = ref<HostPublic[]>([])
const pickerLoading = ref(false)
const pickerSearchEl = ref<{ focus: () => void } | null>(null)

async function openPicker() {
  showPicker.value    = true
  pickerSearch.value = ''
  pickerLoading.value = true
  try {
    const { data } = await hostService.list({ limit: 100 })
    pickerHosts.value = data.data
  } finally {
    pickerLoading.value = false
  }
  nextTick(() => pickerSearchEl.value?.focus())
}

const favoritePickerHosts = computed(() =>
  favoriteHostIds.value
    .map((id) => pickerHosts.value.find((host) => host.id === id))
    .filter((host): host is HostPublic => !!host),
)

const recentPickerHosts = computed(() =>
  recentHostIds.value
    .map((id) => pickerHosts.value.find((host) => host.id === id))
    .filter((host): host is HostPublic => !!host && !favoriteHostIds.value.includes(host.id)),
)

const filteredHosts = computed(() => {
  const query = pickerSearch.value.trim().toLowerCase()
  const matches = pickerHosts.value.filter((host) =>
    !query
    || host.name.toLowerCase().includes(query)
    || host.ip.includes(query),
  )
  const orderedIds = [
    ...favoritePickerHosts.value.map((host) => host.id),
    ...recentPickerHosts.value.map((host) => host.id),
  ]
  return [...matches].sort((a, b) => {
    const aIndex = orderedIds.indexOf(a.id)
    const bIndex = orderedIds.indexOf(b.id)
    if (aIndex === -1 && bIndex === -1) return a.name.localeCompare(b.name)
    if (aIndex === -1) return 1
    if (bIndex === -1) return -1
    return aIndex - bIndex
  })
})

function pickHost(host: HostPublic) {
  showPicker.value   = false
  pickerSearch.value = ''
  markHostAsRecent(host.id)
  termStore.add({ id: host.id, name: host.name, ip: host.ip, port: host.port, authType: host.authType })
  autoFullscreenAttempted.value = false
  void nextTick(() => tryAutoBrowserFullscreen())
}

function onHostPickerKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    showPicker.value = false
    pickerSearch.value = ''
    if (termStore.activeId) paneRefs[termStore.activeId]?.focus?.()
    return
  }
  if (event.key !== 'Enter') return
  const first = filteredHosts.value[0]
  if (!first) return
  event.preventDefault()
  pickHost(first)
}

// ── Side panels ───────────────────────────────────────────────────────────

const showFiles    = ref(false)
const filePanelWidth = ref(400)
const showSnippets = ref(false)
const showTunnels  = ref(false)
const showSnippetQuickPicker = ref(false)
const snippetQuickSearch = ref('')
const snippetQuickLoading = ref(false)
const snippetQuickItems = ref<Snippet[]>([])
const snippetQuickSearchEl = ref<{ focus: () => void } | null>(null)
const creatingHostLink = ref(false)
const creatingSharedSession = ref(false)

// Ref map to access TerminalPane instances for sendText
const paneRefs: Record<string, InstanceType<typeof TerminalPane> | null> = {}
const EXPECT_SEND_TIMEOUT_MS = 15_000
const activeExpectMacros = ref<Record<string, {
  steps: Array<{ expect: string; send: string }>
  index: number
  buffer: string
  name: string
  snippetId?: number
  timer: number | null
  status: 'running' | 'paused'
  history: Array<{ expect: string; send: string; matchedAt: number; result: 'matched' | 'skipped' }>
}>>({})

function normalizeTerminalCommand(command: string) {
  return command.endsWith('\n') ? command : `${command}\n`
}

function snippetPreview(snippet: Snippet) {
  const parsed = deserializeSnippetCommand(snippet.command)
  if (parsed.kind === 'SEQUENCE') return maskSecretPlaceholders(parsed.steps.join(' · '))
  if (parsed.kind === 'EXPECT_SEND') return maskSecretPlaceholders(parsed.expectSteps.map((step) => `${step.expect} => ${step.send}`).join(' · '))
  return maskSecretPlaceholders(parsed.command)
}

function snippetSecretAliases(snippet: Snippet) {
  return getSnippetSecretAliases(snippet)
}

const filteredSnippetQuickItems = computed(() => {
  const query = snippetQuickSearch.value.trim().toLowerCase()
  if (!query) return snippetQuickItems.value
  return snippetQuickItems.value.filter((snippet) =>
    snippet.name.toLowerCase().includes(query)
    || snippetPreview(snippet).toLowerCase().includes(query)
    || (snippet.description ?? '').toLowerCase().includes(query),
  )
})

async function ensureSnippetQuickItems() {
  if (snippetQuickItems.value.length > 0 || snippetQuickLoading.value) return
  snippetQuickLoading.value = true
  try {
    const { data } = await snippetService.list()
    snippetQuickItems.value = data
  } finally {
    snippetQuickLoading.value = false
  }
}

async function openSnippetQuickPicker() {
  if (termStore.tabs.length === 0) return
  showSnippetQuickPicker.value = true
  await ensureSnippetQuickItems()
  nextTick(() => snippetQuickSearchEl.value?.focus())
}

function closeSnippetQuickPicker() {
  showSnippetQuickPicker.value = false
  snippetQuickSearch.value = ''
}

async function sendQuickSnippet(snippet: Snippet) {
  await sendSnippetToActiveTerminal({ ...deserializeSnippetCommand(snippet.command), name: snippet.name }, snippet.id)
  closeSnippetQuickPicker()
  if (termStore.activeId) paneRefs[termStore.activeId]?.focus?.()
}

function onSnippetQuickSearchKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    closeSnippetQuickPicker()
    if (termStore.activeId) paneRefs[termStore.activeId]?.focus?.()
    return
  }
  if (event.key !== 'Enter') return
  const first = filteredSnippetQuickItems.value[0]
  if (!first) return
  event.preventDefault()
  void sendQuickSnippet(first)
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function clearExpectSendMacroTimer(tabId: string) {
  const timer = activeExpectMacros.value[tabId]?.timer
  if (timer) window.clearTimeout(timer)
}

function cancelExpectSendMacro(tabId: string, notify = true) {
  const macro = activeExpectMacros.value[tabId]
  if (!macro) return
  clearExpectSendMacroTimer(tabId)
  delete activeExpectMacros.value[tabId]
  if (notify) message.warning(t('snippets.expectSendCancelled', { name: macro.name }))
}

function scheduleExpectSendMacroTimeout(tabId: string) {
  const macro = activeExpectMacros.value[tabId]
  if (!macro) return
  clearExpectSendMacroTimer(tabId)
  macro.timer = window.setTimeout(() => {
    const currentMacro = activeExpectMacros.value[tabId]
    if (!currentMacro) return
    clearExpectSendMacroTimer(tabId)
    currentMacro.status = 'paused'
    message.warning(t('snippets.expectSendTimedOut', { name: currentMacro.name, expect: currentMacro.steps[currentMacro.index]?.expect ?? '' }))
  }, EXPECT_SEND_TIMEOUT_MS)
}

function finishExpectSendMacro(tabId: string, name: string) {
  clearExpectSendMacroTimer(tabId)
  delete activeExpectMacros.value[tabId]
  message.success(t('snippets.expectSendCompleted', { name }))
}

function processExpectSendOutput(tabId: string, chunk = '') {
  const macro = activeExpectMacros.value[tabId]
  if (!macro) return

  macro.buffer = `${macro.buffer}${chunk}`.slice(-4000)
  if (macro.status !== 'running') return

  while (macro.index < macro.steps.length) {
    const step = macro.steps[macro.index]
    if (!macro.buffer.toLowerCase().includes(step.expect.toLowerCase())) return

    sendTextRespectingSecrets(
      paneRefs[tabId],
      normalizeTerminalCommand(step.send),
      {
        snippetId: macro.snippetId,
        snippetName: macro.name,
      },
    )
    macro.history = [
      ...macro.history,
      { expect: step.expect, send: step.send, matchedAt: Date.now(), result: 'matched' as const },
    ].slice(-4)
    macro.buffer = ''
    macro.index += 1
    if (macro.index < macro.steps.length) {
      scheduleExpectSendMacroTimeout(tabId)
    }
  }

  finishExpectSendMacro(tabId, macro.name)
}

async function sendSnippetToActiveTerminal(payload: SnippetExecution, snippetId?: number) {
  const activeId = termStore.activeId
  if (!activeId) return
  const pane = paneRefs[activeId]
  if (!pane) return
  const secretAliases = getSnippetExecutionSecretAliases(payload)

  if (secretAliases.length > 0 && !confirmSnippetSecretUsage(secretAliases)) {
    return
  }

  if (payload.kind === 'SEQUENCE') {
    for (const step of payload.steps) {
      sendTextRespectingSecrets(pane, normalizeTerminalCommand(step), { snippetId, snippetName: payload.name })
      await sleep(120)
    }
    if (snippetId) recordUserProductivityEvent('USER_SNIPPET_EXECUTED', snippetId)
    return
  }

  if (payload.kind === 'EXPECT_SEND') {
    cancelExpectSendMacro(activeId, false)
    activeExpectMacros.value[activeId] = {
      steps: payload.expectSteps,
      index: 0,
      buffer: '',
      name: payload.name?.trim() || termStore.tabs.find((tab) => tab.id === activeId)?.hostName || 'macro',
      ...(snippetId !== undefined && { snippetId }),
      timer: null,
      status: 'running',
      history: [],
    }
    scheduleExpectSendMacroTimeout(activeId)
    message.info(t('snippets.expectSendStarted', { name: activeExpectMacros.value[activeId].name }))
    if (snippetId) recordUserProductivityEvent('USER_SNIPPET_EXECUTED', snippetId)
    return
  }

  sendTextRespectingSecrets(pane, normalizeTerminalCommand(payload.command), { snippetId, snippetName: payload.name })
  if (snippetId) recordUserProductivityEvent('USER_SNIPPET_EXECUTED', snippetId)
}

function confirmSnippetSecretUsage(secretAliases: string[]) {
  return window.confirm(t('snippets.secretUseConfirm', { aliases: secretAliases.join(', ') }))
}

function sendTextRespectingSecrets(
  pane: InstanceType<typeof TerminalPane> | null | undefined,
  text: string,
  context: { snippetId?: number | undefined; snippetName?: string | undefined },
) {
  if (!pane) return
  if (getSnippetExecutionSecretAliases({
    kind: 'COMMAND',
    command: text,
    steps: [],
    expectSteps: [],
  }).length === 0) {
    pane.sendText(text)
    return
  }
  pane.sendSecretText(text, context)
}

function focusTab(tabId: string) {
  if (!splitTabIds.value.includes(tabId)) {
    termStore.activate(tabId)
  } else {
    termStore.clearUnread(tabId)
  }
  paneRefs[tabId]?.focus?.()
}

const currentExpectMacro = computed(() => {
  const activeId = termStore.activeId
  return activeId ? activeExpectMacros.value[activeId] ?? null : null
})

const currentExpectMacroStep = computed(() => {
  const macro = currentExpectMacro.value
  if (!macro) return null
  return macro.steps[macro.index] ?? null
})

const currentExpectMacroHistory = computed(() => currentExpectMacro.value?.history ?? [])
const isCurrentExpectMacroPaused = computed(() => currentExpectMacro.value?.status === 'paused')
const currentExpectMacroTimeline = computed(() => {
  const macro = currentExpectMacro.value
  if (!macro) return []

  return macro.steps.map((step, idx) => ({
    key: `${idx}-${step.expect}-${step.send}`,
    expect: step.expect,
    send: step.send,
    status: idx < macro.index ? 'done' : idx === macro.index ? (macro.status === 'paused' ? 'paused' : 'waiting') : 'pending',
  }))
})

function continueExpectSendMacro(tabId: string) {
  const macro = activeExpectMacros.value[tabId]
  if (!macro) return
  macro.status = 'running'
  scheduleExpectSendMacroTimeout(tabId)
  processExpectSendOutput(tabId)
}

function skipExpectSendMacroStep(tabId: string) {
  const macro = activeExpectMacros.value[tabId]
  if (!macro) return
  const step = macro.steps[macro.index]
  if (!step) return
  macro.history = [
    ...macro.history,
    { expect: step.expect, send: step.send, matchedAt: Date.now(), result: 'skipped' as const },
  ].slice(-4)
  macro.buffer = ''
  macro.index += 1
  macro.status = 'running'
  if (macro.index >= macro.steps.length) {
    finishExpectSendMacro(tabId, macro.name)
    return
  }
  scheduleExpectSendMacroTimeout(tabId)
  processExpectSendOutput(tabId)
}

const activeHostId = computed(() => {
  const tab = termStore.tabs.find(t => t.id === termStore.activeId)
  return tab?.hostId ?? null
})

const activeHostName = computed(() => {
  const tab = termStore.tabs.find((t) => t.id === termStore.activeId)
  return tab?.hostName ?? ''
})

const activeSessionId = computed(() => {
  const activeId = termStore.activeId
  if (!activeId) return null
  return tabSessionIds.value[activeId] ?? null
})

const activeSharedSessionId = computed(() => {
  const activeId = termStore.activeId
  if (!activeId) return null
  return tabSharedSessionIds.value[activeId] ?? null
})

const pendingSharedControlParticipants = computed(() => {
  const shared = currentSharedSession.value
  if (!shared) return []
  const pendingIds = new Set(shared.pendingControlRequestUserIds ?? [])
  return shared.participants.filter((participant) => pendingIds.has(participant.userId) && !participant.leftAt)
})
const isCurrentSharedSessionOwner = computed(() =>
  !!currentSharedSession.value && currentSharedSession.value.owner.userId === auth.user?.id,
)
const currentSharedSessionController = computed(() => {
  const shared = currentSharedSession.value
  const controllerUserId = shared?.activeControlLease?.controllerUserId
  if (!shared || !controllerUserId) return null
  return shared.participants.find((participant) => participant.userId === controllerUserId) ?? null
})
const isSharedSessionControlledByOtherUser = computed(() =>
  isCurrentSharedSessionOwner.value
  && !!currentSharedSessionController.value
  && currentSharedSessionController.value.userId !== auth.user?.id,
)

const canCreateOwnSessionLink = computed(() => activeHostId.value !== null)
const canCreateLiveSessionLink = computed(() => activeSessionId.value !== null)
const shareActionBusy = computed(() => creatingHostLink.value || creatingSharedSession.value)
const activeTunnelSummary = computed(() => {
  const activeId = termStore.activeId
  if (!activeId) return null
  const state = tabTunnels.value[activeId]
  const firstTunnel = state?.tunnels[0]
  if (!firstTunnel) return null

  return {
    count: state?.tunnels.length ?? 0,
    assignedLocalPort: firstTunnel.assignedLocalPort,
    requestedLocalPort: firstTunnel.requestedLocalPort,
    usedPortFallback: firstTunnel.usedPortFallback,
  }
})
const activeTunnelCount = computed(() => activeTunnelSummary.value?.count ?? 0)
const shareMenuOptions = computed<DropdownOption[]>(() => [
  {
    key: 'own-session',
    label: t('hostLinks.title'),
  },
  {
    key: 'live-session',
    label: t('sharedSessions.title'),
    disabled: !canCreateLiveSessionLink.value,
  },
])

async function generateQuickHostLink() {
  if (activeHostId.value === null || creatingHostLink.value) return

  creatingHostLink.value = true
  try {
    const { data } = await hostLinkService.create({
      hostId: activeHostId.value,
      expiresInMinutes: 10,
    })
    await navigator.clipboard.writeText(data.url)
    message.success(t('hostLinks.createdAndCopied'))
  } catch (err: unknown) {
    const apiMessage = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    message.error(apiMessage ?? t('hostLinks.createError'))
  } finally {
    creatingHostLink.value = false
  }
}

async function generateQuickSharedSession() {
  if (activeSessionId.value === null || creatingSharedSession.value) return

  creatingSharedSession.value = true
  try {
    const activeId = termStore.activeId
    const initialOutputSnapshot = activeId
      ? paneRefs[activeId]?.getBufferText?.().slice(-120000) ?? ''
      : ''
    const { data } = await sharedSessionService.create({
      sessionId: activeSessionId.value,
      expiresInMinutes: 10,
      initialOutputSnapshot,
    })
    if (activeId) {
      tabSharedSessionIds.value = {
        ...tabSharedSessionIds.value,
        [activeId]: data.id,
      }
    }
    await navigator.clipboard.writeText(data.joinUrl)
    message.success(t('sharedSessions.createdAndCopied'))
  } catch (err: unknown) {
    const apiMessage = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    message.error(apiMessage ?? t('sharedSessions.createError'))
  } finally {
    creatingSharedSession.value = false
  }
}

function openSharedSessionManager() {
  if (!activeSharedSessionId.value) return
  showSharedSessionManager.value = true
  void loadCurrentSharedSession()
}

async function loadCurrentSharedSession() {
  if (!activeSharedSessionId.value) {
    currentSharedSession.value = null
    return
  }
  sharedSessionManagerLoading.value = true
  try {
    const { data } = await sharedSessionService.getById(activeSharedSessionId.value)
    currentSharedSession.value = data
  } finally {
    sharedSessionManagerLoading.value = false
  }
}

async function grantSharedSessionControlFromTerminal(userId: number, leaseMinutes: 2 | 5 | 10 | 30 = 2) {
  if (!activeSharedSessionId.value || sharedSessionManagerBusy.value) return
  sharedSessionManagerBusy.value = true
  try {
    await sharedSessionService.grantControl(activeSharedSessionId.value, userId, { leaseMinutes })
    await loadCurrentSharedSession()
  } finally {
    sharedSessionManagerBusy.value = false
  }
}

async function denySharedSessionControlFromTerminal(userId: number) {
  if (!activeSharedSessionId.value || sharedSessionManagerBusy.value) return
  sharedSessionManagerBusy.value = true
  try {
    await sharedSessionService.denyControl(activeSharedSessionId.value, userId)
    await loadCurrentSharedSession()
  } finally {
    sharedSessionManagerBusy.value = false
  }
}

async function reclaimSharedSessionControlFromTerminal() {
  if (!activeSharedSessionId.value || sharedSessionManagerBusy.value) return
  sharedSessionManagerBusy.value = true
  try {
    await sharedSessionService.revokeControl(activeSharedSessionId.value, {
      reason: 'owner_reclaimed_control',
    })
    await loadCurrentSharedSession()
  } finally {
    sharedSessionManagerBusy.value = false
  }
}

function onShareModeSelect(key: string | number) {
  const value = String(key)
  if (value === 'own-session') {
    void generateQuickHostLink()
    return
  }
  if (value === 'live-session') {
    void generateQuickSharedSession()
  }
}

watch(activeSharedSessionId, (value) => {
  if (sharedSessionPollTimer) {
    clearInterval(sharedSessionPollTimer)
    sharedSessionPollTimer = null
  }
  if (!value) {
    currentSharedSession.value = null
    showSharedSessionManager.value = false
    return
  }
  void loadCurrentSharedSession()
  sharedSessionPollTimer = setInterval(() => {
    void loadCurrentSharedSession()
  }, 3000)
}, { immediate: true })

let lastSharedControlControllerId: number | null = null
watch(
  () => currentSharedSession.value?.activeControlLease?.controllerUserId ?? null,
  (controllerUserId, previousControllerUserId) => {
    if (!isCurrentSharedSessionOwner.value) {
      lastSharedControlControllerId = controllerUserId
      return
    }
    if (controllerUserId === previousControllerUserId || controllerUserId === lastSharedControlControllerId) return

    if (controllerUserId && controllerUserId !== auth.user?.id) {
      const controllerName = currentSharedSessionController.value?.name ?? t('sharedSessions.someoneElse')
      message.warning(t('sharedSessions.ownerControlTaken', { name: controllerName }))
    } else if (previousControllerUserId && previousControllerUserId !== auth.user?.id && controllerUserId === null) {
      message.success(t('sharedSessions.ownerControlReturned'))
    }

    lastSharedControlControllerId = controllerUserId
  },
)

function startFilePanelResize(e: MouseEvent) {
  const startX     = e.clientX
  const startWidth = filePanelWidth.value

  function onMove(ev: MouseEvent) {
    // dragging LEFT increases panel width, dragging RIGHT decreases it
    filePanelWidth.value = Math.max(280, Math.min(900, startWidth - (ev.clientX - startX)))
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup',   onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup',   onUp)
}

function openDedicatedFiles() {
  if (activeHostId.value === null) return
  router.push({ name: 'files', params: { hostId: activeHostId.value } })
}

// ── Split panes (layout view over open tabs, up to 4 total) ─────────────

const splitEnabled      = ref(false)
const splitPaneStatus   = ref<Record<string, string>>({})  // tabId → status

const maxPanes       = 4
const splitGridTabs  = computed(() => splitEnabled.value ? termStore.tabs.slice(0, maxPanes) : [])
const splitTabIds    = computed(() => splitGridTabs.value.map((tab) => tab.id))
const hasAnySplit    = computed(() => splitEnabled.value && splitGridTabs.value.length > 1)
const singleVisibleTabId = computed(() => termStore.activeId ?? termStore.tabs[0]?.id ?? null)
const singleVisibleTabs  = computed(() =>
  singleVisibleTabId.value
    ? termStore.tabs.filter((tab) => tab.id === singleVisibleTabId.value)
    : [],
)
const terminalLayoutKey = computed(() =>
  `${hasAnySplit.value ? 'split' : 'single'}:${(hasAnySplit.value ? splitGridTabs.value : singleVisibleTabs.value).map((tab) => tab.id).join(',')}`,
)
const splitGridStyle = computed(() => {
  const count = splitGridTabs.value.length
  const isNarrow = viewportWidth.value < 960
  const isMedium = viewportWidth.value < 1280
  if (count <= 1) return {}
  if (isNarrow) {
    return { display: 'grid', gridTemplateColumns: '1fr', gridTemplateRows: `repeat(${count}, minmax(0, 1fr))` }
  }
  if (count === 2) {
    return { display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' }
  }
  if (isMedium) {
    return { display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: `repeat(${Math.ceil(count / 2)}, minmax(0, 1fr))` }
  }
  if (count === 3) {
    return { display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gridTemplateRows: '1fr 1fr' }
  }
  return { display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' }
})

watch(() => termStore.tabs.map(t => t.id), (ids) => {
  Object.keys(splitPaneStatus.value).forEach((tabId) => {
    if (!ids.includes(tabId)) {
      delete splitPaneStatus.value[tabId]
      delete tabLatency.value[tabId]
      delete tabSessionIds.value[tabId]
      delete paneRefs[tabId]
    }
  })
  if (ids.length <= 1) {
    splitEnabled.value = false
  }
  if (!hasAnySplit.value) {
    broadcastEnabled.value = false
  }
})

function splitDotClass(status?: string): string {
  if (status === 'connected')  return 'bg-green-400'
  if (status === 'connecting') return 'bg-yellow-400 animate-pulse'
  if (status === 'error' || status === 'closed') return 'bg-red-400'
  return 'bg-gray-500'
}

async function openSplitPicker() {
  if (!canUseSplitPanes.value || termStore.tabs.length === 0) return
  if (termStore.tabs.length < 2) {
    message.info(t('terminal.splitNeedsMoreTabs'))
    return
  }
  splitEnabled.value = true
}

function closeAllSplits() {
  splitEnabled.value = false
  broadcastEnabled.value = false
}

function resetTerminalViewState() {
  splitEnabled.value = false
  broadcastEnabled.value = false
  showFiles.value = false
  showSnippets.value = false
  showTunnels.value = false
  showPicker.value = false
  showDiagnostics.value = false
  hostKeyModal.value = null
  tabCtxVisible.value = false
}

function closeHostKeyModal() {
  if (trustingHostKey.value) return
  hostKeyModal.value = null
}

async function trustHostKeyAndReconnect() {
  if (!hostKeyModal.value || trustingHostKey.value) return
  if (!hostKeyModal.value.canTrust) {
    message.warning(hostKeyPermissionMessage(hostKeyModal.value.hostScope))
    return
  }

  const modal = hostKeyModal.value
  trustingHostKey.value = true
  try {
    await hostService.trustHostKey(modal.hostId, {
      fingerprint: modal.challenge.presentedFingerprint,
    })
    message.success(t('terminal.hostKey.trustedSuccess'))
    hostKeyModal.value = null
    await paneRefs[modal.tabId]?.reconnect?.(modal.hostId)
  } catch (err) {
    const apiMessage = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    message.error(apiMessage ?? t('terminal.hostKey.trustedError'))
  } finally {
    trustingHostKey.value = false
  }
}

function isSessionExpiredError(value?: string | null) {
  if (!value) return false
  const normalized = value.toLowerCase()
  return normalized.includes('sessão expirada')
    || normalized.includes('sessao expirada')
    || normalized.includes('session expired')
    || normalized.includes('unauthorized')
}

function resetTerminalLayoutState() {
  splitEnabled.value = false
  broadcastEnabled.value = false
  tabCtxVisible.value = false
}

function onSplitConnected(tabId: string, name: string) {
  termStore.setName(tabId, name)
  termStore.setConnectedAt(tabId)
}
function onSplitStatusChange(tabId: string, status: string) {
  splitPaneStatus.value = { ...splitPaneStatus.value, [tabId]: status }
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────

function onKeydown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement).tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  const mod = isMac ? e.metaKey : e.ctrlKey
  if (mod && e.key === 'b' && termStore.tabs.length > 0) {
    e.preventDefault()
    showFiles.value = !showFiles.value
  }
  if (isSnippetShortcutEvent(e) && termStore.tabs.length > 0) {
    e.preventDefault()
    void openSnippetQuickPicker()
  }
  if (isHostSwitcherShortcutEvent(e)) {
    e.preventDefault()
    void openPicker()
  }
}

function onWindowResize() {
  viewportWidth.value = window.innerWidth
}

function syncBrowserFullscreenState() {
  isBrowserFullscreen.value = document.fullscreenElement === terminalViewportEl.value
  if (!isBrowserFullscreen.value) {
    autoFullscreenAttempted.value = false
  }
}

async function toggleBrowserFullscreen() {
  if (!document.fullscreenEnabled || !terminalViewportEl.value) {
    message.warning(t('terminal.fullscreenUnsupported'))
    return
  }

  try {
    if (document.fullscreenElement === terminalViewportEl.value) {
      await document.exitFullscreen()
    } else {
      await terminalViewportEl.value.requestFullscreen()
    }
  } catch {
    message.error(t('terminal.fullscreenError'))
  }
}

async function tryAutoBrowserFullscreen() {
  if (autoFullscreenAttempted.value) return
  if (!termSettings.autoFullscreenOnConnect) return
  if (!document.fullscreenEnabled || !terminalViewportEl.value) return
  if (document.fullscreenElement === terminalViewportEl.value) return

  autoFullscreenAttempted.value = true
  try {
    await terminalViewportEl.value.requestFullscreen()
  } catch {
    // Browsers may block fullscreen without a direct user gesture.
  }
}

onMounted(()   => window.addEventListener('keydown', onKeydown))
onMounted(()   => window.addEventListener(SESSION_EXPIRED_EVENT, resetTerminalViewState))
onMounted(()   => window.addEventListener(TERMINAL_LAYOUT_RESET_EVENT, resetTerminalLayoutState))
onMounted(()   => window.addEventListener('resize', onWindowResize))
onMounted(()   => document.addEventListener('fullscreenchange', syncBrowserFullscreenState))
onMounted(()   => nextTick(() => { void tryAutoBrowserFullscreen() }))
onUnmounted(() => {
  if (sharedSessionPollTimer) clearInterval(sharedSessionPollTimer)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener(SESSION_EXPIRED_EVENT, resetTerminalViewState)
  window.removeEventListener(TERMINAL_LAYOUT_RESET_EVENT, resetTerminalLayoutState)
  window.removeEventListener('resize', onWindowResize)
  document.removeEventListener('fullscreenchange', syncBrowserFullscreenState)
  Object.keys(activeExpectMacros.value).forEach((tabId) => cancelExpectSendMacro(tabId, false))
})
onActivated(() => {
  isTerminalActive.value = true
  if (termStore.activeId) termStore.clearUnread(termStore.activeId)
  splitTabIds.value.forEach((tabId) => termStore.clearUnread(tabId))
  autoFullscreenAttempted.value = false
  void nextTick(() => tryAutoBrowserFullscreen())
})
onDeactivated(() => {
  isTerminalActive.value = false
  resetTerminalLayoutState()
})

watch(() => termStore.activeId, (id) => {
  if (id) {
    termStore.clearUnread(id)
    paneRefs[id]?.focus?.()
    autoFullscreenAttempted.value = false
    void nextTick(() => tryAutoBrowserFullscreen())
  }
})

watch(splitTabIds, (ids) => {
  if (!isTerminalActive.value) return
  ids.forEach((tabId) => termStore.clearUnread(tabId))
}, { immediate: true })

// ── Helpers ───────────────────────────────────────────────────────────────

const canAddTab = computed(
  () => multiConnect.value || termStore.tabs.length === 0,
)
const canUseSplitPanes = computed(
  () => import.meta.env.DEV || multiConnect.value,
)
const canAddSplitPane = computed(
  () => canUseSplitPanes.value && termStore.tabs.length > 1,
)

function sessionDotClass(status?: string): string {
  if (status === 'connected') return 'bg-green-400'
  if (status === 'connecting') return 'bg-yellow-400 animate-pulse'
  if (status === 'error' || status === 'closed') return 'bg-red-400'
  return 'bg-gray-500'
}

function splitPaneClass(tabId: string): string {
  return tabId === termStore.activeId
    ? 'ring-1 ring-blue-500/70 border-blue-500/40'
    : 'border-gray-800'
}

const platformPresetLabel = computed(() => {
  if (platform === 'macos') return 'macOS'
  if (platform === 'windows') return 'Windows'
  return 'Linux'
})

function applyRecommendedPlatformPreset() {
  applyTerminalPreset(platform)
}

function dismissPlatformOnboarding() {
  showPlatformOnboarding.value = false
  localStorage.setItem(TERMINAL_ONBOARDING_KEY, '1')
}

const terminalDiagnostics = computed(() => [
  {
    key: 'platform',
    label: t('terminal.diagnostics.platform'),
    value: platformPresetLabel.value,
    status: 'ok',
  },
  {
    key: 'clipboard',
    label: t('terminal.diagnostics.clipboard'),
    value: 'clipboard' in navigator ? t('terminal.diagnostics.available') : t('terminal.diagnostics.unavailable'),
    status: 'clipboard' in navigator ? 'ok' : 'warn',
  },
  {
    key: 'websocket',
    label: t('terminal.diagnostics.websocket'),
    value: 'WebSocket' in window ? t('terminal.diagnostics.available') : t('terminal.diagnostics.unavailable'),
    status: 'WebSocket' in window ? 'ok' : 'error',
  },
  {
    key: 'resizeObserver',
    label: t('terminal.diagnostics.resizeObserver'),
    value: 'ResizeObserver' in window ? t('terminal.diagnostics.available') : t('terminal.diagnostics.unavailable'),
    status: 'ResizeObserver' in window ? 'ok' : 'warn',
  },
  {
    key: 'focus',
    label: t('terminal.diagnostics.focus'),
    value: document.hasFocus() ? t('terminal.diagnostics.active') : t('terminal.diagnostics.inactive'),
    status: document.hasFocus() ? 'ok' : 'warn',
  },
  {
    key: 'language',
    label: t('terminal.diagnostics.language'),
    value: navigator.language,
    status: 'ok',
  },
  {
    key: 'shortcuts',
    label: t('terminal.diagnostics.shortcuts'),
    value: `${shortcuts.find} · ${shortcuts.files} · ${shortcuts.snippets}`,
    status: 'ok',
  },
])
</script>

<template>
  <div
    ref="terminalViewportEl"
    class="flex flex-col h-screen bg-[#1a1b1e] relative"
    :class="isBrowserFullscreen ? 'bg-[#101014]' : ''"
  >

    <div v-if="showPlatformOnboarding" class="px-3 pt-3 shrink-0">
      <NAlert
        type="info"
        :show-icon="false"
        closable
        style="background:#172033;border:1px solid rgba(96,165,250,0.18);"
        @close="dismissPlatformOnboarding"
      >
        <template #header>
          {{ $t('terminal.onboarding.title', { platform: platformPresetLabel }) }}
        </template>
        <div class="text-sm text-gray-300">
          {{ $t('terminal.onboarding.description', { platform: platformPresetLabel }) }}
        </div>
        <div class="mt-2 text-xs text-gray-400">
          {{ $t('terminal.onboarding.shortcuts', { find: shortcuts.find, files: shortcuts.files, snippets: shortcuts.snippets }) }}
        </div>
        <div class="mt-3 flex items-center gap-2">
          <NButton size="small" type="primary" @click="applyRecommendedPlatformPreset">
            {{ $t('terminal.onboarding.applyPreset', { platform: platformPresetLabel }) }}
          </NButton>
          <NButton size="small" quaternary @click="dismissPlatformOnboarding">
            {{ $t('terminal.onboarding.dismiss') }}
          </NButton>
        </div>
      </NAlert>
    </div>

    <div v-if="currentExpectMacro && currentExpectMacroStep" class="px-3 pt-3 shrink-0">
      <NAlert
        :type="isCurrentExpectMacroPaused ? 'error' : 'warning'"
        :show-icon="false"
        :style="isCurrentExpectMacroPaused
          ? 'background:#2b1717;border:1px solid rgba(248,113,113,0.24);'
          : 'background:#2a2114;border:1px solid rgba(251,191,36,0.22);'"
      >
        <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div class="min-w-0">
            <div class="text-sm font-semibold text-white">
              {{
                isCurrentExpectMacroPaused
                  ? $t('snippets.expectSendPaused', {
                    name: currentExpectMacro.name,
                    current: currentExpectMacro.index + 1,
                    total: currentExpectMacro.steps.length,
                  })
                  : $t('snippets.expectSendWaiting', {
                    name: currentExpectMacro.name,
                    current: currentExpectMacro.index + 1,
                    total: currentExpectMacro.steps.length,
                  })
              }}
            </div>
            <div class="text-xs text-amber-200/90 font-mono break-all">
              {{ currentExpectMacroStep.expect }}
            </div>
            <div v-if="isCurrentExpectMacroPaused" class="mt-2 text-xs text-red-200">
              {{ $t('snippets.expectSendPausedHint') }}
            </div>
            <div class="mt-2 space-y-1.5">
              <div
                v-for="item in currentExpectMacroTimeline"
                :key="item.key"
                class="flex items-start gap-2 text-[11px]"
              >
                <span
                  class="mt-0.5 inline-flex items-center rounded-full px-1.5 py-0.5 font-semibold uppercase tracking-wide"
                  :class="item.status === 'done'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : item.status === 'paused'
                      ? 'bg-red-500/15 text-red-300'
                    : item.status === 'waiting'
                      ? 'bg-amber-500/15 text-amber-200'
                      : 'bg-gray-700/60 text-gray-400'"
                >
                  {{
                    item.status === 'done'
                      ? $t('snippets.expectSendStatusDone')
                      : item.status === 'paused'
                        ? $t('snippets.expectSendStatusPaused')
                      : item.status === 'waiting'
                        ? $t('snippets.expectSendStatusWaiting')
                        : $t('snippets.expectSendStatusPending')
                  }}
                </span>
                <div class="min-w-0 font-mono break-all text-gray-300">
                  {{ $t('snippets.expectSendTimelineItem', { expect: item.expect, send: item.send }) }}
                </div>
              </div>
            </div>
            <div v-if="currentExpectMacroHistory.length > 0" class="mt-2 space-y-1">
              <div class="text-[11px] uppercase tracking-wide text-amber-300/70">
                {{ $t('snippets.expectSendRecent') }}
              </div>
              <div
                v-for="(item, idx) in currentExpectMacroHistory"
                :key="`${item.matchedAt}-${idx}`"
                class="text-[11px] text-gray-300 font-mono break-all"
              >
                {{
                  item.result === 'skipped'
                    ? $t('snippets.expectSendRecentSkippedItem', { expect: item.expect, send: item.send })
                    : $t('snippets.expectSendRecentItem', { expect: item.expect, send: item.send })
                }}
              </div>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <NButton
              v-if="isCurrentExpectMacroPaused"
              size="small"
              tertiary
              type="primary"
              @click="termStore.activeId && continueExpectSendMacro(termStore.activeId)"
            >
              {{ $t('snippets.expectSendContinue') }}
            </NButton>
            <NButton
              v-if="isCurrentExpectMacroPaused"
              size="small"
              tertiary
              type="warning"
              @click="termStore.activeId && skipExpectSendMacroStep(termStore.activeId)"
            >
              {{ $t('snippets.expectSendSkip') }}
            </NButton>
            <NButton
              size="small"
              tertiary
              :type="isCurrentExpectMacroPaused ? 'error' : 'warning'"
              @click="termStore.activeId && cancelExpectSendMacro(termStore.activeId)"
            >
              {{ $t('snippets.expectSendCancel') }}
            </NButton>
          </div>
        </div>
      </NAlert>
    </div>

    <!-- ── Barra de abas ───────────────────────────────────────────────── -->
    <div class="flex items-center bg-[#18181c] border-b border-gray-800 shrink-0 overflow-x-auto">
      <NDropdown
        placement="bottom-start"
        trigger="manual"
        :x="tabCtxX"
        :y="tabCtxY"
        :options="activeTabMenuOptions"
        :show="tabCtxVisible"
        @clickoutside="tabCtxVisible = false"
        @select="onTabMenuSelect"
      />

      <NButton text size="small" class="px-3 shrink-0" @click="router.push({ name: 'hosts' })">
        {{ $t('terminal.back') }}
      </NButton>

      <NButton text size="small" class="px-2 shrink-0 text-gray-400 hover:text-white" @click="showDiagnostics = true">
        {{ $t('terminal.diagnostics.button') }}
      </NButton>

      <div class="w-px h-5 bg-gray-700 shrink-0 mx-1" />

      <div class="flex items-center gap-0.5 flex-1 overflow-x-auto py-1 px-1 min-w-0">
        <NTooltip
          v-for="tab in termStore.tabs"
          :key="tab.id"
          trigger="hover"
          placement="bottom"
          :delay="400"
        >
          <!-- Conteúdo do tooltip -->
          <template #trigger>
            <button
              class="flex items-center gap-1.5 px-3 py-1 rounded text-sm whitespace-nowrap transition-colors"
              :class="tab.id === termStore.activeId
                ? 'bg-[#1a1b1e] text-white'
                : 'text-gray-400 hover:text-white hover:bg-[#1e1e22]'"
              @click="focusTab(tab.id)"
              @contextmenu="openTabContextMenu($event, tab.id)"
            >
              <!-- Status badge -->
              <span
                v-if="tabStatus[tab.id] === 'connecting'"
                class="inline-flex items-center gap-0.5 text-[10px] font-medium px-1 py-px rounded"
                style="background: rgba(250,204,21,0.12); color: #fbbf24;"
              >
                <span class="w-1 h-1 rounded-full bg-yellow-400 animate-pulse" />
                {{ $t('terminal.connecting') }}
              </span>
              <span
                v-else-if="tabStatus[tab.id] === 'error' || tabStatus[tab.id] === 'closed'"
                class="inline-flex items-center gap-0.5 text-[10px] font-medium px-1 py-px rounded"
                :style="isSessionExpiredError(tabErrors[tab.id])
                  ? 'background: rgba(245,158,11,0.14); color: #fbbf24;'
                  : 'background: rgba(239,68,68,0.12); color: #f87171;'"
              >
                <span
                  class="w-1 h-1 rounded-full"
                  :class="isSessionExpiredError(tabErrors[tab.id]) ? 'bg-yellow-400' : 'bg-red-400'"
                />
                {{ isSessionExpiredError(tabErrors[tab.id]) ? $t('terminal.sessionExpiredBadge') : $t('terminal.disconnected') }}
              </span>
              <span
                v-else
                class="w-1.5 h-1.5 rounded-full shrink-0"
                :class="tabStatus[tab.id] === 'connected' ? 'bg-green-400' : 'bg-gray-500'"
              />
              <span
                v-if="splitTabIds.includes(tab.id)"
                class="inline-flex items-center gap-0.5 text-[10px] font-medium px-1 py-px rounded"
                style="background: rgba(34,197,94,0.12); color: #86efac;"
              >
                Split {{ splitTabIds.indexOf(tab.id) + 1 }}
              </span>
              <span class="max-w-[140px] truncate">{{ tab.hostName }}</span>
              <span
                v-if="tab.unreadCount > 0"
                class="inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full text-[10px] font-semibold px-1"
                style="background: rgba(251,146,60,0.16); color: #fdba74;"
              >
                {{ tab.unreadCount > 99 ? '99+' : tab.unreadCount }}
              </span>
              <!-- Tempo de sessão -->
              <span v-if="formatElapsed(tab.connectedAt)" class="text-xs text-gray-500 ml-0.5">
                {{ formatElapsed(tab.connectedAt) }}
              </span>
              <!-- Latência -->
              <span
                v-if="tabLatency[tab.id]"
                class="text-[10px] font-mono ml-0.5"
                :class="tabLatency[tab.id] < 80 ? 'text-green-500' : tabLatency[tab.id] < 200 ? 'text-yellow-500' : 'text-red-500'"
              >{{ tabLatency[tab.id] }}ms</span>
              <!-- Tunnel badge -->
              <span
                v-if="tabTunnels[tab.id]?.tunnels.length || tabTunnels[tab.id]?.errors.length"
                class="text-[10px] ml-0.5 font-mono"
                :class="tabTunnels[tab.id]?.errors.length ? 'text-red-400' : 'text-cyan-400'"
              >
                {{ tabTunnels[tab.id]?.errors.length ? '⚠' : '⇌' }}{{ (tabTunnels[tab.id]?.tunnels.length ?? 0) }}
              </span>
              <span
                class="ml-1 text-gray-600 hover:text-white leading-none px-0.5"
                title="Menu da aba"
                @click.stop="openTabContextMenu($event, tab.id)"
                @contextmenu.stop="openTabContextMenu($event, tab.id)"
              >▾</span>
              <span class="ml-1 text-gray-500 hover:text-white leading-none" @click.stop="closeTab(tab.id)">✕</span>
            </button>
          </template>

          <!-- Tooltip: detalhes da conexão -->
          <div class="text-xs space-y-1" style="min-width:160px;">
            <div class="font-semibold text-white">{{ tab.hostName }}</div>
            <div v-if="tab.hostIp" class="text-gray-400 font-mono">{{ tab.hostIp }}:{{ tab.hostPort }}</div>
            <div v-if="tab.hostAuthType" class="text-gray-400">
              Auth: {{ tab.hostAuthType === 'pem' ? '🔑 PEM' : tab.hostAuthType === 'pem_password' ? '🔑+🔒 PEM + Senha' : '🔒 Senha' }}
            </div>
            <div v-if="tab.connectedAt" class="text-gray-400">
              {{ $t('terminal.connectedFor', { time: formatElapsed(tab.connectedAt) || $t('terminal.now') }) }}
            </div>
            <div v-if="tabLatency[tab.id]" class="flex items-center gap-1">
              <span
                class="w-1.5 h-1.5 rounded-full"
                :class="tabLatency[tab.id] < 80 ? 'bg-green-400' : tabLatency[tab.id] < 200 ? 'bg-yellow-400' : 'bg-red-400'"
              />
              <span class="text-gray-400">{{ $t('terminal.latency') }}: {{ tabLatency[tab.id] }}ms</span>
            </div>
            <div v-if="isSessionExpiredError(tabErrors[tab.id])" class="text-yellow-400">
              {{ $t('terminal.sessionExpiredHint') }}
            </div>
            <div v-if="!tab.connectedAt" class="text-yellow-400">{{ $t('terminal.connecting') }}...</div>
          </div>
        </NTooltip>

        <!-- Botão nova aba -->
        <NTooltip v-if="!canAddTab" trigger="hover">
          <template #trigger>
            <NButton size="small" text disabled class="px-2 text-gray-600">+</NButton>
          </template>
          {{ $t('terminal.noMultiConnect') }}
        </NTooltip>
        <NButton v-else size="small" text class="px-2 text-gray-400 hover:text-white" @click="openPicker">
          +
        </NButton>
      </div>

      <!-- Files + Split toggles -->
      <div v-if="termStore.tabs.length > 0" class="shrink-0 flex items-center gap-0.5 pr-2">
        <NTooltip trigger="hover" placement="bottom" :delay="400">
          <template #trigger>
            <NButton
              size="small" text class="px-2 font-mono"
              :class="isBrowserFullscreen ? 'text-emerald-400' : 'text-gray-400 hover:text-white'"
              @click="toggleBrowserFullscreen"
            >{{ isBrowserFullscreen ? '⤢' : '⛶' }}</NButton>
          </template>
          <div class="text-xs">
            {{ isBrowserFullscreen ? $t('terminal.exitFullscreen') : $t('terminal.enterFullscreen') }}
          </div>
        </NTooltip>

        <NTooltip v-if="canCreateOwnSessionLink" trigger="hover" placement="bottom" :delay="400">
          <template #trigger>
            <div class="flex items-center">
              <NButton
                size="small"
                text
                class="px-2"
                :loading="creatingHostLink"
                :disabled="shareActionBusy"
                @click="generateQuickHostLink"
              >
                {{ $t('hostLinks.quickAction') }}
              </NButton>
              <NDropdown
                trigger="click"
                :options="shareMenuOptions"
                @select="onShareModeSelect"
              >
                <NButton
                  size="small"
                  text
                  class="px-1 text-gray-500 hover:text-white"
                  :disabled="shareActionBusy"
                >
                  ▾
                </NButton>
              </NDropdown>
            </div>
          </template>
          <div class="text-xs space-y-1">
            <div>{{ $t('hostLinks.quickHint', { host: activeHostName }) }}</div>
            <div class="text-gray-400">{{ $t('sharedSessions.menuHint') }}</div>
          </div>
        </NTooltip>

        <NTooltip v-if="activeSharedSessionId" trigger="hover" placement="bottom" :delay="400">
          <template #trigger>
            <div class="flex items-center gap-1">
              <NButton
                size="small"
                text
                class="px-2 text-amber-300 hover:text-amber-200"
                @click="openSharedSessionManager"
              >
                {{ $t('sharedSessions.manageAction') }}
              </NButton>
              <NTag
                v-if="pendingSharedControlParticipants.length"
                size="small"
                type="warning"
                round
              >
                {{ $t('sharedSessions.pendingRequestsBadge', { count: pendingSharedControlParticipants.length }) }}
              </NTag>
            </div>
          </template>
          <div class="text-xs">
            {{ $t('sharedSessions.manageHint') }}
          </div>
        </NTooltip>

        <NTag
          v-if="isSharedSessionControlledByOtherUser && currentSharedSessionController"
          size="small"
          type="warning"
          round
        >
          {{ $t('sharedSessions.ownerControlIndicator', { name: currentSharedSessionController.name }) }}
        </NTag>

        <div class="w-px h-4 bg-gray-700 shrink-0 mx-1" />

        <!-- Files toggle -->
        <NTooltip trigger="hover" placement="bottom" :delay="600">
          <template #trigger>
            <NButton
              size="small" text class="px-2 text-gray-400 hover:text-white"
              @click="openPicker"
            >{{ $t('terminal.hostSwitcherAction') }}</NButton>
          </template>
          <div class="text-xs">
            {{ $t('terminal.hostSwitcherHint') }}
            <span class="ml-1 text-gray-400 font-mono">{{ shortcuts.hostSwitcher }}</span>
          </div>
        </NTooltip>

        <NTooltip trigger="hover" placement="bottom" :delay="600">
          <template #trigger>
            <NButton
              size="small" text class="px-2"
              :class="showFiles ? 'text-blue-400' : 'text-gray-400 hover:text-white'"
              @click="showFiles = !showFiles"
            >{{ showFiles ? $t('terminal.hideFiles') : $t('terminal.files') }}</NButton>
          </template>
          <div class="text-xs">
            {{ showFiles ? $t('terminal.hideFiles') : $t('terminal.files') }}
            <span class="ml-1 text-gray-400 font-mono">{{ shortcuts.files }}</span>
          </div>
        </NTooltip>

        <!-- Snippets toggle -->
        <NTooltip trigger="hover" placement="bottom" :delay="400">
          <template #trigger>
            <NButton
              size="small" text class="px-2"
              :class="showSnippets ? 'text-purple-400' : 'text-gray-400 hover:text-white'"
              @click="showSnippets = !showSnippets"
            >{{ $t('snippets.title') }}</NButton>
          </template>
          <div class="text-xs">
            {{ $t('snippets.panelHint') }}
            <span class="ml-1 text-gray-400 font-mono">{{ shortcuts.snippets }}</span>
          </div>
        </NTooltip>

        <NTooltip v-if="feedbackLicensed" trigger="hover" placement="bottom" :delay="400">
          <template #trigger>
            <NButton
              size="small" text class="px-2 text-gray-400 hover:text-white"
              @click="openFeedbackFromTerminal"
            >{{ $t('feedback.create.fab') }}</NButton>
          </template>
          <div class="text-xs">
            {{ $t('feedback.create.fabHint') }}
          </div>
        </NTooltip>

        <!-- Tunnels toggle -->
        <NTooltip trigger="hover" placement="bottom" :delay="400">
          <template #trigger>
            <div class="flex items-center gap-1">
              <NButton
                size="small" text class="px-2"
                :class="activeTunnelCount > 0
                  ? 'text-cyan-300 hover:text-cyan-200'
                  : showTunnels
                    ? 'text-cyan-400'
                    : 'text-gray-400 hover:text-white'"
                @click="showTunnels = !showTunnels"
              >{{ $t('tunnels.title') }}</NButton>
              <NTag
                v-if="activeTunnelCount > 0"
                size="small"
                type="info"
                round
              >
                {{ $t('tunnels.activeCountBadge', { count: activeTunnelCount }) }}
              </NTag>
            </div>
          </template>
          <div class="text-xs space-y-1">
            <div>{{ $t('tunnels.panelHint') }}</div>
            <div v-if="activeTunnelSummary" class="text-cyan-300">
              {{ activeTunnelSummary.usedPortFallback
                ? $t('tunnels.activePortHintWithFallback', {
                  assigned: activeTunnelSummary.assignedLocalPort,
                  requested: activeTunnelSummary.requestedLocalPort,
                })
                : $t('tunnels.activePortHint', { port: activeTunnelSummary.assignedLocalPort }) }}
            </div>
          </div>
        </NTooltip>

        <NTooltip v-if="showFiles && activeHostId !== null" trigger="hover" placement="bottom" :delay="400">
          <template #trigger>
            <NButton size="small" text class="px-1.5 text-gray-500 hover:text-blue-400 transition-colors" @click="openDedicatedFiles">⛶</NButton>
          </template>
          {{ $t('terminal.openFilesFullscreen') }}
        </NTooltip>

        <div class="w-px h-4 bg-gray-700 shrink-0 mx-1" />

        <!-- Add split pane -->
        <NTooltip trigger="hover" placement="bottom" :delay="400">
          <template #trigger>
            <NButton
              size="small" text class="px-2 font-mono"
              :class="hasAnySplit ? 'text-green-400' : 'text-gray-400 hover:text-white'"
              :disabled="!canAddSplitPane"
              @click="openSplitPicker"
            >⊞</NButton>
          </template>
          <div class="text-xs">
            <div>{{ $t('terminal.splitPane') }}
              <span class="text-gray-400 ml-1">({{ Math.min(termStore.tabs.length, maxPanes) }}/{{ maxPanes }})</span>
            </div>
            <div v-if="!canUseSplitPanes" class="text-gray-500 mt-0.5">{{ $t('terminal.noMultiConnect') }}</div>
            <div v-if="termStore.tabs.length >= maxPanes" class="text-gray-500 mt-0.5">{{ $t('terminal.splitMax') }}</div>
          </div>
        </NTooltip>

        <NButton
          v-if="hasAnySplit"
          size="tiny" text
          class="px-1 text-gray-600 hover:text-red-400 transition-colors"
          :title="$t('terminal.closeSplit')"
          @click="closeAllSplits"
        >✕</NButton>

        <!-- Mirror Input (Espelhar Entrada) -->
        <template v-if="hasAnySplit">
          <div class="w-px h-4 bg-gray-700 shrink-0 mx-1" />
          <NTooltip trigger="hover" placement="bottom" :delay="400">
            <template #trigger>
              <NButton
                size="small" text class="px-2 relative"
                :class="broadcastEnabled ? 'text-orange-400' : 'text-gray-400 hover:text-white'"
                @click="broadcastEnabled = !broadcastEnabled"
              >
                <span class="text-sm">⟳</span>
                <span
                  v-if="broadcastEnabled"
                  class="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse"
                />
              </NButton>
            </template>
            <div class="text-xs max-w-[200px]">
              <div class="font-medium">{{ broadcastEnabled ? $t('terminal.mirrorOff') : $t('terminal.mirrorOn') }}</div>
              <div v-if="!broadcastEnabled" class="text-gray-400 mt-0.5">{{ $t('terminal.mirrorDesc') }}</div>
              <div v-if="broadcastEnabled" class="text-orange-300 mt-0.5">{{ $t('terminal.mirrorActive') }}</div>
            </div>
          </NTooltip>
        </template>
      </div>
    </div>

    <!-- ── Terminais + File Manager ──────────────────────────────────── -->
    <div class="flex-1 overflow-hidden relative flex">

    <!-- Terminals area (up to 4 split panes) -->
    <div
      :key="terminalLayoutKey"
      class="split-area flex-1 overflow-hidden min-w-0"
      :class="hasAnySplit ? 'grid gap-px bg-gray-800 p-px' : 'flex'"
      :style="hasAnySplit ? splitGridStyle : undefined"
    >
      <template v-if="hasAnySplit">
        <div
          v-for="tab in splitGridTabs"
          :key="tab.id"
          class="flex min-h-0 min-w-0 flex-col overflow-hidden border bg-[#1a1b1e] transition-colors"
          :class="splitPaneClass(tab.id)"
          :style="splitGridTabs.length === 3 && viewportWidth >= 1280 && splitGridTabs[0]?.id === tab.id ? { gridRow: '1 / span 2' } : undefined"
          @mousedown="focusTab(tab.id)"
        >
          <div
            class="flex items-center border-b px-3 py-1 shrink-0 transition-colors"
            :class="tab.id === termStore.activeId ? 'bg-[#172554] border-blue-500/40' : 'bg-[#18181c] border-gray-800'"
          >
            <span class="w-2 h-2 rounded-full shrink-0 mr-2" :class="splitDotClass(splitPaneStatus[tab.id] ?? tabStatus[tab.id])" />
            <span
              class="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold mr-2 shrink-0"
              :class="tab.id === termStore.activeId ? 'bg-blue-500/20 text-blue-200' : 'bg-gray-700/70 text-gray-300'"
            >
              P{{ splitGridTabs.findIndex((item) => item.id === tab.id) + 1 }}
            </span>
            <span class="text-xs text-gray-300 truncate flex-1">{{ tab.hostName }}</span>
            <span
              v-if="tab.unreadCount"
              class="inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full text-[10px] font-semibold px-1 mr-2"
              style="background: rgba(251,146,60,0.18); color: #fdba74;"
            >
              {{ tab.unreadCount > 99 ? '99+' : tab.unreadCount }}
            </span>
          </div>
          <div class="flex-1 overflow-hidden relative min-h-0">
            <TerminalPane
              :ref="(el: unknown) => { paneRefs[tab.id] = el as InstanceType<typeof TerminalPane> | null }"
              :tab-id="tab.id"
              :host-id="tab.hostId"
              :visible="true"
              class="absolute inset-0"
              @connected="(name) => onSplitConnected(tab.id, name)"
              @session-change="(value) => onSessionChange(tab.id, value)"
              @status-change="(s) => onSplitStatusChange(tab.id, s)"
              @error-change="(value) => onErrorChange(tab.id, value)"
              @latency-change="(ms) => onLatencyChange(tab.id, ms)"
              @tunnels-change="(state) => onTunnelsChange(tab.id, state)"
              @host-key-verification-required="(challenge) => onHostKeyVerificationRequired(tab.id, challenge)"
              @output="(chunk) => onSplitOutput(tab.id, chunk)"
              @host-switcher-requested="openPicker"
            />
          </div>
        </div>
      </template>

      <template v-else>
        <div class="flex-1 overflow-hidden relative min-h-0 min-w-0">
          <TerminalPane
            v-for="tab in singleVisibleTabs"
            :key="tab.id"
            :ref="(el: unknown) => { paneRefs[tab.id] = el as InstanceType<typeof TerminalPane> | null }"
            :tab-id="tab.id"
            :host-id="tab.hostId"
            :visible="tab.id === singleVisibleTabId"
            class="absolute inset-0"
            @connected="(name) => onConnected(tab.id, name)"
            @session-change="(value) => onSessionChange(tab.id, value)"
            @status-change="(s) => onStatusChange(tab.id, s)"
            @error-change="(value) => onErrorChange(tab.id, value)"
            @latency-change="(ms) => onLatencyChange(tab.id, ms)"
            @tunnels-change="(state) => onTunnelsChange(tab.id, state)"
            @host-key-verification-required="(challenge) => onHostKeyVerificationRequired(tab.id, challenge)"
            @output="(chunk) => onTerminalOutput(tab.id, chunk)"
            @host-switcher-requested="openPicker"
          />
          <NEmpty
            v-if="singleVisibleTabs.length === 0"
            description="Nenhuma conexão aberta"
            class="absolute inset-0 flex flex-col items-center justify-center"
          >
            <template #extra>
              <NButton type="primary" @click="openPicker">Conectar a um host</NButton>
            </template>
          </NEmpty>
        </div>
      </template>

    </div><!-- end split-area -->

    <!-- ── File Manager panel ──────────────────────────────────────────── -->
    <transition name="slide">
      <div
        v-if="showFiles && activeHostId !== null"
        :style="{ width: filePanelWidth + 'px' }"
        class="shrink-0 border-l border-gray-800 overflow-hidden flex flex-col relative"
      >
        <div
          class="absolute left-0 top-0 bottom-0 w-1 z-10 cursor-col-resize hover:bg-blue-500/60 transition-colors"
          @mousedown.prevent="startFilePanelResize"
        />
        <FileManager :host-id="activeHostId" class="flex-1" />
      </div>
    </transition>

    <!-- ── Snippets panel ─────────────────────────────────────────────── -->
    <transition name="slide">
      <div
        v-if="showSnippets"
        style="width:320px"
        class="shrink-0 overflow-hidden flex flex-col"
      >
        <SnippetsPanel @send="(payload) => sendSnippetToActiveTerminal(payload.execution, payload.snippetId)" />
      </div>
    </transition>

    <!-- ── Tunnels panel ──────────────────────────────────────────────── -->
    <transition name="slide">
      <div
        v-if="showTunnels"
        style="width:320px"
        class="shrink-0 overflow-hidden flex flex-col"
      >
        <TunnelManager
          :host-id="activeHostId"
          :host-name="termStore.tabs.find(t => t.id === termStore.activeId)?.hostName"
          :active-tunnels="tabTunnels[termStore.activeId ?? '']"
          @active-tunnels-change="onPanelTunnelsChange"
        />
      </div>
    </transition>

    </div><!-- end flex terminals+files -->

    <div v-if="isBrowserFullscreen" class="fixed top-4 right-4 z-[120] flex items-center gap-2">
      <NTooltip v-if="activeTunnelSummary" trigger="hover" placement="bottom">
        <template #trigger>
          <div
            class="rounded-full px-3 py-2 text-xs font-semibold shadow-lg"
            style="background:#082f49; color:#bae6fd; border:1px solid rgba(56,189,248,0.25);"
          >
            {{ $t('tunnels.fullscreenBadge', { count: activeTunnelCount }) }}
          </div>
        </template>
        <div class="text-xs space-y-1">
          <div v-if="activeTunnelSummary.usedPortFallback">
            {{ $t('tunnels.activePortHintWithFallback', {
              assigned: activeTunnelSummary.assignedLocalPort,
              requested: activeTunnelSummary.requestedLocalPort,
            }) }}
          </div>
          <div v-else>
            {{ $t('tunnels.activePortHint', { port: activeTunnelSummary.assignedLocalPort }) }}
          </div>
        </div>
      </NTooltip>

      <button
        class="rounded-full px-3 py-2 text-xs font-semibold shadow-lg transition-colors hover:bg-[#1f2937]"
        style="background:#111827; color:#e5e7eb; border:1px solid rgba(255,255,255,0.14);"
        @click="toggleBrowserFullscreen"
      >
        {{ $t('terminal.exitFullscreenFloating') }}
      </button>
    </div>

    <!-- ── Modal: seleção de host ──────────────────────────────────────── -->
    <NModal
      v-model:show="showPicker"
      preset="card"
      :title="$t('terminal.hostSwitcherTitle')"
      :to="terminalViewportEl ?? 'body'"
      style="width:560px"
      @after-leave="pickerSearch = ''"
    >
      <NInput
        ref="pickerSearchEl"
        v-model:value="pickerSearch"
        :placeholder="$t('terminal.hostSwitcherSearch')"
        clearable
        class="mb-4"
        @keydown="onHostPickerKey"
      />
      <div class="mb-3 text-xs text-gray-400">
        {{ $t('terminal.hostSwitcherHint') }}
        <span class="ml-1 font-mono">{{ shortcuts.hostSwitcher }}</span>
      </div>
      <NSpin :show="pickerLoading">
        <NEmpty v-if="!pickerLoading && !filteredHosts.length" :description="$t('terminal.hostSwitcherEmpty')" />
        <NGrid v-else :cols="2" :x-gap="12" :y-gap="12">
          <NGridItem v-for="host in filteredHosts" :key="host.id">
            <NCard hoverable :bordered="false" style="background:#1e1e22;cursor:pointer;" @click="pickHost(host)">
              <div class="flex items-center gap-2">
                <NText strong class="block truncate">{{ host.name }}</NText>
                <NTag v-if="favoriteHostIds.includes(host.id)" size="small" type="warning" round>
                  {{ $t('terminal.hostSwitcherFavorite') }}
                </NTag>
                <NTag v-else-if="recentHostIds.includes(host.id)" size="small" type="info" round>
                  {{ $t('terminal.hostSwitcherRecent') }}
                </NTag>
              </div>
              <NText depth="3" class="text-xs font-mono">{{ host.ip }}:{{ host.port }}</NText>
              <NSpace class="mt-2" size="small">
                <NTag :type="host.scope === 'personal' ? 'info' : host.scope === 'team' ? 'success' : 'warning'" size="small">
                  {{ host.scope }}
                </NTag>
                <NTag size="small">{{ host.authType === 'pem' ? '🔑 PEM' : host.authType === 'pem_password' ? '🔑+🔒 PEM + Senha' : '🔒 Senha' }}</NTag>
              </NSpace>
            </NCard>
          </NGridItem>
        </NGrid>
      </NSpin>
    </NModal>

    <NModal
      v-model:show="showSnippetQuickPicker"
      preset="card"
      :title="$t('snippets.quickPicker.title')"
      :to="terminalViewportEl ?? 'body'"
      style="width:min(720px, 92vw)"
      @after-leave="snippetQuickSearch = ''"
    >
      <div class="space-y-3">
        <NInput
          ref="snippetQuickSearchEl"
          v-model:value="snippetQuickSearch"
          :placeholder="$t('snippets.quickPicker.search')"
          clearable
          @keydown="onSnippetQuickSearchKey"
        />

        <div class="text-xs text-gray-400">
          {{ $t('snippets.quickPicker.hint', { shortcut: shortcuts.snippets }) }}
        </div>

        <div v-if="snippetQuickLoading" class="py-8 flex justify-center">
          <NSpin />
        </div>

        <NEmpty
          v-else-if="filteredSnippetQuickItems.length === 0"
          class="py-6"
          :description="snippetQuickSearch ? $t('snippets.noResults') : $t('snippets.quickPicker.empty')"
        />

        <div
          v-else
          class="max-h-[420px] overflow-y-auto divide-y divide-gray-800 rounded border border-gray-800"
        >
          <button
            v-for="snippet in filteredSnippetQuickItems"
            :key="snippet.id"
            type="button"
            class="w-full px-4 py-3 text-left transition-colors hover:bg-[#1e1e22]"
            @click="sendQuickSnippet(snippet)"
          >
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-white truncate">{{ snippet.name }}</span>
              <NTag
                size="small"
                round
                :type="snippet.scope === 'TEAM' ? 'primary' : 'default'"
              >
                {{ snippet.scope === 'TEAM' ? $t('snippets.scopeTeam') : $t('snippets.scopePersonal') }}
              </NTag>
              <NTooltip v-if="snippetSecretAliases(snippet).length > 0" trigger="hover">
                <template #trigger>
                  <NTag size="small" round type="warning">{{ $t('snippets.usesSecret') }}</NTag>
                </template>
                {{ $t('snippets.usesSecretAliases', { aliases: snippetSecretAliases(snippet).join(', ') }) }}
              </NTooltip>
            </div>
            <div class="mt-1 text-xs font-mono text-green-400 truncate">
              {{ snippetPreview(snippet) }}
            </div>
            <div v-if="snippet.description" class="mt-1 text-xs text-gray-500 truncate">
              {{ snippet.description }}
            </div>
          </button>
        </div>
      </div>
    </NModal>

    <NModal
      v-model:show="showDiagnostics"
      preset="card"
      :title="$t('terminal.diagnostics.title')"
      style="width:620px"
    >
      <div class="space-y-3">
        <NCard
          v-for="item in terminalDiagnostics"
          :key="item.key"
          size="small"
          :bordered="false"
          style="background:#17171b;"
        >
          <div class="flex items-center gap-3">
            <span
              class="w-2.5 h-2.5 rounded-full shrink-0"
              :class="item.status === 'ok' ? 'bg-green-400' : item.status === 'warn' ? 'bg-yellow-400' : 'bg-red-400'"
            />
            <div class="min-w-0 flex-1">
              <div class="text-sm text-white">{{ item.label }}</div>
              <div class="text-xs text-gray-400 break-all">{{ item.value }}</div>
            </div>
          </div>
        </NCard>
      </div>
    </NModal>

    <NModal
      v-model:show="showSharedSessionManager"
      preset="card"
      style="width:min(720px, 92vw)"
      :title="$t('sharedSessions.managerTitle')"
      :bordered="false"
    >
      <div class="space-y-4">
        <NAlert type="info" :show-icon="false">
          {{ $t('sharedSessions.manageHint') }}
        </NAlert>

        <NSpin :show="sharedSessionManagerLoading">
          <div v-if="currentSharedSession" class="space-y-4">
            <div class="flex flex-wrap items-center gap-2">
              <NTag size="small" type="success">{{ currentSharedSession.hostName }}</NTag>
              <NTag size="small" :type="currentSharedSession.status === 'active' ? 'success' : 'warning'">
                {{ $t(`sharedSessions.status.${currentSharedSession.status}`) }}
              </NTag>
              <NTag size="small" type="default">
                {{ $t('sharedSessions.participantsBadge', { count: currentSharedSession.participants.length }) }}
              </NTag>
            </div>

            <NAlert
              v-if="isSharedSessionControlledByOtherUser && currentSharedSessionController"
              type="warning"
              :show-icon="false"
            >
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  {{
                    $t('sharedSessions.ownerControlActiveNotice', {
                      name: currentSharedSessionController.name,
                      date: currentSharedSession.activeControlLease?.expiresAt ? $d(currentSharedSession.activeControlLease.expiresAt, 'short') : '—',
                    })
                  }}
                </div>
                <NButton
                  size="small"
                  tertiary
                  type="warning"
                  :loading="sharedSessionManagerBusy"
                  @click="reclaimSharedSessionControlFromTerminal"
                >
                  {{ $t('sharedSessions.reclaimControl') }}
                </NButton>
              </div>
            </NAlert>

            <div>
              <div class="mb-2 flex items-center justify-between gap-2">
                <div class="text-xs uppercase tracking-[0.18em] text-gray-500">
                  {{ $t('sharedSessions.pendingRequests') }}
                </div>
                <NSelect
                  v-model:value="selectedTerminalLeaseMinutes"
                  size="small"
                  style="width: 110px"
                  :options="[
                    { label: '2 min', value: 2 },
                    { label: '5 min', value: 5 },
                    { label: '10 min', value: 10 },
                    { label: '30 min', value: 30 },
                  ]"
                />
              </div>
              <div v-if="pendingSharedControlParticipants.length" class="space-y-2">
                <div
                  v-for="participant in pendingSharedControlParticipants"
                  :key="`terminal-pending-${participant.userId}`"
                  class="rounded-xl border border-amber-900/50 bg-amber-950/20 px-3 py-3"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <div class="text-sm text-white">{{ participant.name }}</div>
                      <div class="text-xs text-gray-400">{{ participant.email || '—' }}</div>
                    </div>
                    <div class="flex gap-2">
                      <NButton
                        size="small"
                        tertiary
                        type="success"
                        :loading="sharedSessionManagerBusy"
                        @click="grantSharedSessionControlFromTerminal(participant.userId, selectedTerminalLeaseMinutes)"
                      >
                        {{ $t('sharedSessions.grantSelected') }}
                      </NButton>
                      <NButton
                        size="small"
                        tertiary
                        :loading="sharedSessionManagerBusy"
                        @click="denySharedSessionControlFromTerminal(participant.userId)"
                      >
                        {{ $t('sharedSessions.deny') }}
                      </NButton>
                    </div>
                  </div>
                </div>
              </div>
              <NEmpty v-else size="small" :description="$t('sharedSessions.noPendingRequests')" />
            </div>
          </div>
        </NSpin>
      </div>
    </NModal>

    <NModal
      :show="!!hostKeyModal"
      preset="card"
      :title="hostKeyModal?.challenge.reason === 'changed' ? $t('terminal.hostKey.titleChanged') : $t('terminal.hostKey.titleUnknown')"
      style="width:640px"
      @update:show="(value) => { if (!value) closeHostKeyModal() }"
    >
      <div v-if="hostKeyModal" class="space-y-4">
        <NAlert type="warning" :show-icon="true">
          {{ hostKeyModal.challenge.reason === 'changed'
            ? $t('terminal.hostKey.descriptionChanged', { host: hostKeyModal.hostName })
            : $t('terminal.hostKey.descriptionUnknown', { host: hostKeyModal.hostName }) }}
        </NAlert>

        <NAlert v-if="!hostKeyPolicyLoading && !hostKeyModal.canTrust" type="error" :show-icon="true">
          {{ hostKeyPermissionMessage(hostKeyModal.hostScope) }}
        </NAlert>

        <NCard size="small" :bordered="false" style="background:#17171b;">
          <div class="text-xs text-gray-400 mb-1">{{ $t('terminal.hostKey.host') }}</div>
          <div class="text-sm text-white font-medium break-all">{{ hostKeyModal.hostName }}</div>
        </NCard>

        <NCard
          v-if="hostKeyModal.challenge.trustedFingerprint"
          size="small"
          :bordered="false"
          style="background:#17171b;"
        >
          <div class="text-xs text-gray-400 mb-1">{{ $t('terminal.hostKey.trustedFingerprint') }}</div>
          <div class="text-sm text-white font-mono break-all">{{ hostKeyModal.challenge.trustedFingerprint }}</div>
        </NCard>

        <NCard size="small" :bordered="false" style="background:#17171b;">
          <div class="text-xs text-gray-400 mb-1">{{ $t('terminal.hostKey.presentedFingerprint') }}</div>
          <div class="text-sm text-white font-mono break-all">{{ hostKeyModal.challenge.presentedFingerprint }}</div>
        </NCard>

        <div class="flex justify-end gap-2">
          <NButton :disabled="trustingHostKey" @click="closeHostKeyModal">
            {{ $t('terminal.hostKey.cancel') }}
          </NButton>
          <NButton type="warning" :loading="trustingHostKey || hostKeyPolicyLoading" :disabled="hostKeyPolicyLoading || !hostKeyModal.canTrust" @click="trustHostKeyAndReconnect">
            {{ $t('terminal.hostKey.trust') }}
          </NButton>
        </div>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: width 0.2s ease, opacity 0.2s ease;
  overflow: hidden;
}
.slide-enter-from,
.slide-leave-to {
  width: 0 !important;
  opacity: 0;
}
</style>
