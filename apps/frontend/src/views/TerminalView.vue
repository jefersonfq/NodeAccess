<script setup lang="ts">
defineOptions({ name: 'TerminalView' })

import { h, ref, computed, watch, onMounted, onUnmounted, onActivated, onDeactivated, nextTick } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NButton, NTag, NTooltip, NDropdown, NAlert, useMessage,
  NModal, NInput, NCard, NSpin, NEmpty, NSelect, NPopover,
} from 'naive-ui'
import type { DropdownOption } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import TerminalPane    from '@/components/TerminalPane.vue'
import FileManager     from '@/components/FileManager.vue'
import SnippetsPanel   from '@/components/SnippetsPanel.vue'
import TunnelManager   from '@/components/TunnelManager.vue'
import GraphicalSessionView from '@/views/GraphicalSessionView.vue'
import { useTerminalStore } from '@/stores/terminals'
import { useAuthStore } from '@/stores/auth'
import { broadcastEnabled } from '@/composables/useTerminalBroadcast'
import type { HostKeyVerificationChallenge, CredentialsChallenge, SavePasswordOffer, TunnelState } from '@/composables/useTerminal'
import { applyTerminalPreset, termSettings, setShowTerminalToolbar, hintForErrorCode } from '@/composables/useTerminal'
import { pemKeyService } from '@/services/pem-key.service'
import type { PemKeyPublic } from '@nodeaccess/shared'
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
import { localAiService } from '@/services/local-ai.service'
import { hostService }     from '@/services/host.service'
import { secretService }   from '@/services/secret.service'
import { hostLinkService } from '@/services/host-link.service'
import { sharedSessionService } from '@/services/shared-session.service'
import { SESSION_EXPIRED_EVENT } from '@/services/auth-session.service'
import { TERMINAL_LAYOUT_RESET_EVENT } from '@/services/terminal-layout.service'
import { consumePendingTerminalHost } from '@/services/terminal-launch.service'
import {
  buildTerminalPopoutQuery,
  parseTerminalPopoutDragPayload,
  requestTerminalPopoutInsert,
  TERMINAL_POPOUT_DRAG_MIME,
  type TerminalPopoutHost,
} from '@/services/terminal-popout.service'
import { usePlatform } from '@/composables/usePlatform'
import { canOpenInWebTerminal, getHostAccessProtocolCapabilities, resolveHostLinkTemplate, type HostAssociatedLink, type HostPublic, type LocalAiChatResponse, type SharedSessionPublic } from '@nodeaccess/shared'
import { favoriteHostIds, markHostAsRecent, recentHostIds } from '@/services/host-quick-access.service'

const { t } = useI18n()
const route = useRoute()
const router    = useRouter()
const auth = useAuthStore()
const termStore = useTerminalStore()
const message = useMessage()
const isTerminalActive = ref(true)
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1440)
const terminalViewportEl = ref<HTMLElement | null>(null)
const isBrowserFullscreen = ref(false)
const autoFullscreenAttempted = ref(false)
const showTabSearch = ref(false)
const tabSearchQuery = ref('')

// ── Platform detection ────────────────────────────────────────────────────

const { platform, isMac, shortcuts, isSnippetShortcutEvent, isHostSwitcherShortcutEvent } = usePlatform()

const TERMINAL_ONBOARDING_KEY = 'na_terminal_onboarding_dismissed'
const showPlatformOnboarding = ref(localStorage.getItem(TERMINAL_ONBOARDING_KEY) !== '1')
const showDiagnostics = ref(false)
const activeHostDetails = ref<HostPublic | null>(null)
const activeHostDetailsLoading = ref(false)

const TERMINAL_RAIL_ICONS = {
  searchTabs: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  fullscreen: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  hosts: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
  snippets: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  links: '<path d="M10 13a5 5 0 0 0 7.54.54l2.92-2.92a5 5 0 0 0-7.07-7.07L11.5 5.43"/><path d="M14 11a5 5 0 0 0-7.54-.54L3.54 13.38a5 5 0 1 0 7.07 7.07l1.88-1.88"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98"/><path d="m15.41 6.51-6.82 3.98"/>',
  ownSession: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  jit: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  files: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l1.5 2h9A1.5 1.5 0 0 1 20.5 9.5v8A1.5 1.5 0 0 1 19 19H5a2 2 0 0 1-2-2z"/>',
  forwardings: '<path d="M19 7H7"/><path d="m10 4-3 3 3 3"/><path d="M5 17h12"/><path d="m14 14 3 3-3 3"/>',
  localAi: '<path d="M9.5 2A2.5 2.5 0 0 0 7 4.5V6H5a2 2 0 0 0-2 2v5"/><path d="M14.5 2A2.5 2.5 0 0 1 17 4.5V6h2a2 2 0 0 1 2 2v5"/><path d="M8 14h8"/><path d="M10 18h4"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/>',
  feedback: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8"/><path d="M8 13h5"/>',
  diagnostics: '<path d="M3 12h4l3 8 4-16 3 8h4" />',
} as const

// Features
const multiConnect = ref(false)
const feedbackLicensed = ref(false)
const localAiLicensed = ref(false)
const jitAccessEnabled = ref(false)
const terminalCapabilitiesLoaded = ref(false)
let terminalCapabilitiesPromise: Promise<void> | null = null
const OPEN_FEEDBACK_MODAL_EVENT = 'nodeaccess:open-feedback-modal'
const FEATURES_UPDATED_EVENT = 'nodeaccess:features-updated'

async function loadTerminalFeatures() {
  try {
    const f = await featuresService.get()
    multiConnect.value = f.multiConnect
    feedbackLicensed.value = f.feedbackLicensed
    localAiLicensed.value = f.localAiLicensed
  } catch {
    multiConnect.value = false
  }
}

async function loadTerminalLinkOptions() {
  try {
    const { data } = await hostLinkService.options()
    jitAccessEnabled.value = data.jitAccess.enabled
  } catch {
    jitAccessEnabled.value = false
  }
}

async function loadTerminalCapabilities() {
  const promise = Promise.all([
    loadTerminalFeatures(),
    loadTerminalLinkOptions(),
  ]).then(() => {
    terminalCapabilitiesLoaded.value = true
  }).finally(() => {
    if (terminalCapabilitiesPromise === promise) terminalCapabilitiesPromise = null
  })
  terminalCapabilitiesPromise = promise
  await promise
}

function ensureTerminalCapabilitiesLoaded() {
  if (terminalCapabilitiesLoaded.value) return Promise.resolve()
  return terminalCapabilitiesPromise ?? loadTerminalCapabilities()
}

onMounted(async () => {
  void ensureTerminalCapabilitiesLoaded()

  const pendingHost = consumePendingTerminalHost()
  if (pendingHost) {
    if (getHostAccessProtocolCapabilities(pendingHost.accessProtocol).graphicalGatewayPlanned && termSettings.graphicalOpenMode === 'dedicated') {
      markHostAsRecent(pendingHost.id)
      router.replace({ name: 'graphical-session', params: { hostId: pendingHost.id } })
      return
    }
    const existingTab = termStore.tabs.find((tab) => tab.hostId === pendingHost.id)
    if (existingTab) {
      termStore.activate(existingTab.id)
    } else if (canAddTab.value) {
      addTerminalTab({
        id: pendingHost.id,
        name: pendingHost.name,
        ip: pendingHost.ip,
        port: pendingHost.port,
        authType: pendingHost.authType,
        accessProtocol: pendingHost.accessProtocol,
      })
    } else {
      await ensureTerminalCapabilitiesLoaded()
      if (canAddTab.value) {
        addTerminalTab({
          id: pendingHost.id,
          name: pendingHost.name,
          ip: pendingHost.ip,
          port: pendingHost.port,
          authType: pendingHost.authType,
          accessProtocol: pendingHost.accessProtocol,
        })
        return
      }
      message.warning(t('terminal.noMultiConnect'))
    }
  }
})

function openFeedbackFromTerminal() {
  if (!feedbackLicensed.value) return
  window.dispatchEvent(new Event(OPEN_FEEDBACK_MODAL_EVENT))
}

// Status e latência por aba
const tabStatus  = ref<Record<string, string>>({})
const tabErrors     = ref<Record<string, string | null>>({})
const tabErrorCodes = ref<Record<string, string | null>>({})
const tabLatency = ref<Record<string, number>>({})
const tabTunnels = ref<Record<string, TunnelState>>({})
const tabConnectionRoute = ref<Record<string, { method: string | null; agentName: string | null }>>({})
const tabSessionIds = ref<Record<string, number | null>>({})
const tabSharedSessionIds = ref<Record<string, number | null>>({})
const adminClosedTimers: Record<string, number | undefined> = {}
const showSharedSessionManager = ref(false)
const sharedSessionManagerLoading = ref(false)
const sharedSessionManagerBusy = ref(false)
const currentSharedSession = ref<SharedSessionPublic | null>(null)
const selectedTerminalLeaseMinutes = ref<2 | 5 | 10 | 30>(2)
let sharedSessionPollTimer: ReturnType<typeof setInterval> | null = null
const trustingHostKey = ref(false)
const hostKeyPolicyLoading = ref(false)

// ── Credentials challenge modal ───────────────────────────────────────────────
const credentialsModal = ref<{ tabId: string; challenge: CredentialsChallenge } | null>(null)
const credUsernameInput = ref('')
const credPasswordInput = ref('')

// ── Save-credentials offer ────────────────────────────────────────────────────
const savePasswordOfferModal = ref<{ tabId: string; offer: SavePasswordOffer; username: string; password: string } | null>(null)
const savingPassword = ref(false)
const selectedSaveScope = ref<'PERSONAL' | 'TEAM'>('PERSONAL')

const hostKeyModal = ref<{
  tabId: string
  hostId: number
  hostName: string
  hostIp: string | null
  hostPort: number | null
  hostScope: HostPublic['scope'] | null
  canTrust: boolean
  challenge: HostKeyVerificationChallenge
} | null>(null)

const hostKeyConnectionLabel = computed(() => {
  if (!hostKeyModal.value) return ''
  const endpoint = hostKeyModal.value.hostIp
    ? `${hostKeyModal.value.hostIp}:${hostKeyModal.value.hostPort ?? 22}`
    : null
  return endpoint
    ? `${hostKeyModal.value.hostName} (${endpoint})`
    : hostKeyModal.value.hostName
})

function onConnected(tabId: string, hostName: string) {
  termStore.setName(tabId, hostName)
  termStore.setConnectedAt(tabId)
  void prepareStartupSnippet(tabId)
}
function onStatusChange(tabId: string, status: string) {
  tabStatus.value = { ...tabStatus.value, [tabId]: status }
}
function onPaneStatusChange(tabId: string, status: string) {
  onStatusChange(tabId, status)
  splitPaneStatus.value = { ...splitPaneStatus.value, [tabId]: status }
}
function onRemoteSessionClosed(tabId: string) {
  if (!termStore.tabs.some((tab) => tab.id === tabId)) return
  closeTab(tabId)
}
function onErrorChange(tabId: string, value: string | null) {
  tabErrors.value = { ...tabErrors.value, [tabId]: value }
}
function onErrorCodeChange(tabId: string, code: string | null) {
  tabErrorCodes.value = { ...tabErrorCodes.value, [tabId]: code }
  if (code === 'SESSION_ADMIN_CLOSED') {
    if (adminClosedTimers[tabId]) window.clearTimeout(adminClosedTimers[tabId])
    adminClosedTimers[tabId] = window.setTimeout(() => {
      if (termStore.tabs.some((tab) => tab.id === tabId)) closeTab(tabId)
    }, 6_000)
  }
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
  termStore.setSessionId(tabId, sessionId)
}

function isAdminClosedTab(tabId: string): boolean {
  return tabErrorCodes.value[tabId] === 'SESSION_ADMIN_CLOSED'
}
function onConnectionRouteChange(tabId: string, method: string | null, agentName: string | null) {
  const normalizedMethod = method?.startsWith('telnet_')
    ? method.replace('telnet_', '')
    : method
  tabConnectionRoute.value = { ...tabConnectionRoute.value, [tabId]: { method: normalizedMethod, agentName } }
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

function onCredentialsRequired(tabId: string, challenge: CredentialsChallenge) {
  // Se já temos credenciais de uma tentativa anterior (ex: reconnect após host key),
  // responde automaticamente sem abrir o modal de novo.
  const existing = pendingAdHocCredentials.value
  if (existing && (!challenge.needsUsername || existing.username) && (!challenge.needsPassword || existing.password)) {
    paneRefs[tabId]?.sendCredentialsResponse?.(existing.username ?? '', existing.password ?? '')
    return
  }
  credUsernameInput.value = ''
  credPasswordInput.value = ''
  credentialsModal.value = { tabId, challenge }
  nextTick(() => {
    const el = document.getElementById(challenge.needsUsername ? 'cred-username-input' : 'cred-password-input')
    if (el) (el as HTMLInputElement).focus()
  })
}

function submitCredentialsChallenge() {
  if (!credentialsModal.value) return
  const { tabId, challenge } = credentialsModal.value
  if (challenge.needsUsername && !credUsernameInput.value) return
  if (challenge.needsPassword && !credPasswordInput.value) return
  paneRefs[tabId]?.sendCredentialsResponse?.(credUsernameInput.value, credPasswordInput.value)
  pendingAdHocCredentials.value = { username: credUsernameInput.value, password: credPasswordInput.value }
  credUsernameInput.value = ''
  credPasswordInput.value = ''
  credentialsModal.value = null
}

function cancelCredentialsChallenge() {
  credentialsModal.value = null
  credUsernameInput.value = ''
  credPasswordInput.value = ''
}

// ── Modal de configuração de chave PEM ────────────────────────────────────────

const pemFixModal    = ref<{ tabId: string; hostId: number; hostName: string } | null>(null)
const pemKeys        = ref<PemKeyPublic[]>([])
const pemKeysLoading = ref(false)
const pemFixLoading  = ref(false)
const pemFixMode     = ref<'select' | 'new'>('select')
const pemFixKeyId    = ref<number | null>(null)
const pemFixNewName  = ref('')
const pemFixNewKey   = ref('')
const pemFixFileInput = ref<HTMLInputElement | null>(null)

const canManageHosts = computed(() => auth.isAdmin || !!auth.user?.canManageHosts)

const pemKeyOptions = computed(() =>
  pemKeys.value.map((k) => ({ label: k.name, value: k.id })),
)

function openPemFixModal(tabId: string) {
  const tab = termStore.tabs.find((t) => t.id === tabId)
  if (!tab) return
  pemFixModal.value = { tabId, hostId: tab.hostId, hostName: tab.hostName }
  pemFixMode.value  = 'select'
  pemFixKeyId.value = null
  pemFixNewName.value = ''
  pemFixNewKey.value  = ''
  void loadPemKeys()
}

async function loadPemKeys() {
  pemKeysLoading.value = true
  try {
    const { data } = await pemKeyService.list()
    pemKeys.value = data
    if (data.length === 0) pemFixMode.value = 'new'
  } catch {
    pemKeys.value = []
    pemFixMode.value = 'new'
  } finally {
    pemKeysLoading.value = false
  }
}

async function onPemFixFileSelected(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    pemFixNewKey.value = await file.text()
    if (!pemFixNewName.value.trim()) {
      pemFixNewName.value = file.name.replace(/\.(pem|key|ppk|txt)$/i, '').trim() || file.name
    }
  } catch {
    message.error(t('terminal.pemFix.fileReadError'))
  }
}

async function submitPemFix() {
  if (!pemFixModal.value) return
  pemFixLoading.value = true
  try {
    let pemKeyId: number
    if (pemFixMode.value === 'new') {
      if (!pemFixNewName.value.trim() || !pemFixNewKey.value.trim()) {
        message.warning(t('terminal.pemFix.fillRequired'))
        return
      }
      const { data } = await pemKeyService.create({ name: pemFixNewName.value.trim(), key: pemFixNewKey.value.trim() })
      pemKeyId = data.id
    } else {
      if (!pemFixKeyId.value) {
        message.warning(t('terminal.pemFix.selectRequired'))
        return
      }
      pemKeyId = pemFixKeyId.value
    }
    const { data: updatedHost } = await hostService.update(pemFixModal.value.hostId, { pemKeyId })
    message.success(t('terminal.pemFix.savedReconnecting'))
    const { tabId, hostId } = pemFixModal.value
    termStore.updateHostInfo(tabId, {
      id: updatedHost.id,
      name: updatedHost.name,
      ip: updatedHost.ip,
      port: updatedHost.port,
      authType: updatedHost.authType,
      accessProtocol: updatedHost.accessProtocol,
    })
    pemFixModal.value = null
    await paneRefs[tabId]?.reconnect?.(hostId)
  } catch (err: unknown) {
    const e = err as { response?: { data?: { message?: string } } }
    message.error(e.response?.data?.message ?? t('terminal.pemFix.saveError'))
  } finally {
    pemFixLoading.value = false
  }
}

function onSavePasswordOffer(tabId: string, offer: SavePasswordOffer) {
  const creds = pendingAdHocCredentials.value
  if (!creds) return
  savePasswordOfferModal.value = { tabId, offer, username: creds.username ?? offer.savedUsername ?? '', password: creds.password ?? '' }
  selectedSaveScope.value = offer.scope === 'TEAM' ? 'TEAM' : 'PERSONAL'
  pendingAdHocCredentials.value = null
}

async function acceptSavePassword() {
  const modal = savePasswordOfferModal.value
  if (!modal) return
  savingPassword.value = true
  try {
    // 1. Criar secret no vault (apenas se há senha)
    if (modal.password) {
      await secretService.create({
        alias: modal.offer.secretName,
        value: modal.password,
        scope: selectedSaveScope.value === 'TEAM' ? 'TENANT' : 'PERSONAL',
        source: 'HOST_CONNECTION',
      })
    }
    // 2. Atualizar credenciais do host
    const updatePayload: Record<string, unknown> = { authType: 'password' }
    if (modal.password) updatePayload.password = modal.password
    if (modal.username) updatePayload.sshUser = modal.username
    await hostService.update(modal.offer.hostId, updatePayload as Parameters<typeof hostService.update>[1])
    message.success(t('terminal.savePassword.savedSuccess'))
  } catch {
    message.error(t('terminal.savePassword.savedError'))
  } finally {
    savingPassword.value = false
    savePasswordOfferModal.value = null
    paneRefs[modal.tabId]?.dismissSavePasswordOffer?.()
  }
}

function dismissSavePassword() {
  if (!savePasswordOfferModal.value) return
  paneRefs[savePasswordOfferModal.value.tabId]?.dismissSavePasswordOffer?.()
  savePasswordOfferModal.value = null
  pendingAdHocCredentials.value = null
}

// Credenciais digitadas aguardando a oferta de salvar
const pendingAdHocCredentials = ref<{ username?: string; password?: string } | null>(null)

async function onHostKeyVerificationRequired(tabId: string, challenge: HostKeyVerificationChallenge) {
  const tab = termStore.tabs.find((item) => item.id === tabId)
  if (!tab) return

  hostKeyModal.value = {
    tabId,
    hostId: tab.hostId,
    hostName: tab.hostName,
    hostIp: tab.hostIp ?? null,
    hostPort: tab.hostPort ?? null,
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
      hostIp: data.ip,
      hostPort: data.port,
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
  if (adminClosedTimers[id]) {
    window.clearTimeout(adminClosedTimers[id])
    delete adminClosedTimers[id]
  }
  cancelExpectSendMacro(id, false)
  termStore.remove(id)
  delete tabLatency.value[id]
  delete tabTunnels.value[id]
  delete tabSessionIds.value[id]
  delete tabSharedSessionIds.value[id]
  delete tabStatus.value[id]
  delete tabErrors.value[id]
  delete tabErrorCodes.value[id]
  delete startupSnippetStateByTabId.value[id]
  delete startupSnippetErrorByTabId.value[id]
  delete splitPaneStatus.value[id]
  delete paneRefs[id]
  if (termStore.tabs.length <= 1) {
    splitEnabled.value = false
    broadcastEnabled.value = false
  }
  if (termStore.tabs.length === 0) goBackFromTerminal()
}

function goBackFromTerminal() {
  router.push(route.query.returnTo === 'dashboard' ? { name: 'dashboard' } : { name: 'hosts' })
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

function duplicateTab(tabId: string) {
  const tab = termStore.tabs.find((item) => item.id === tabId)
  if (!tab) return
  if (!canAddTab.value) {
    message.warning(t('terminal.noMultiConnect'))
    return
  }
  markHostAsRecent(tab.hostId)
  addTerminalTab({
    id: tab.hostId,
    name: tab.hostName,
    ip: tab.hostIp,
    port: tab.hostPort,
    authType: tab.hostAuthType,
    accessProtocol: tab.hostAccessProtocol,
  })
  autoFullscreenAttempted.value = false
  void nextTick(() => tryAutoBrowserFullscreen())
}

const tabCtxVisible = ref(false)
const tabCtxX = ref(0)
const tabCtxY = ref(0)
const tabCtxTabId = ref<string | null>(null)
const isPopoutDropActive = ref(false)

function tabMenuOptions(tabId: string): DropdownOption[] {
  const currentIndex = termStore.tabs.findIndex((tab) => tab.id === tabId)
  const hasTabsToRight = currentIndex >= 0 && currentIndex < termStore.tabs.length - 1
  return [
    { key: `activate:${tabId}`, label: t('terminal.tabMenu.activate') },
    { key: `popout:${tabId}`, label: t('terminal.tabMenu.popout') },
    { key: `move-popout:${tabId}`, label: t('terminal.tabMenu.movePopout') },
    { key: `duplicate:${tabId}`, label: t('terminal.tabMenu.duplicate') },
    { key: `close:${tabId}`, label: t('terminal.tabMenu.close') },
    { key: `close-others:${tabId}`, label: t('terminal.tabMenu.closeOthers') },
    ...(hasTabsToRight ? [{ key: `close-right:${tabId}`, label: t('terminal.tabMenu.closeRight') }] : []),
    { key: 'close-all', label: t('terminal.tabMenu.closeAll') },
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
  if (action === 'popout') openTabInPopout(tabId, 'copy')
  if (action === 'move-popout') openTabInPopout(tabId, 'move')
  if (action === 'duplicate') duplicateTab(tabId)
  if (action === 'close') closeTab(tabId)
  if (action === 'close-others') {
    termStore.activate(tabId)
    closeOtherTabs(tabId)
  }
  if (action === 'close-right') closeTabsToRight(tabId)
}

function tabToPopoutHost(tabId: string): TerminalPopoutHost | null {
  const tab = termStore.tabs.find((item) => item.id === tabId)
  if (!tab) return null
  return {
    id: tab.hostId,
    name: tab.hostName,
    ip: tab.hostIp,
    port: tab.hostPort,
    authType: tab.hostAuthType,
    accessProtocol: tab.hostAccessProtocol,
  }
}

function openTabInPopout(tabId: string, mode: 'copy' | 'move') {
  const host = tabToPopoutHost(tabId)
  if (!host) return

  const href = router.resolve({
    name: 'terminal-popout',
    query: buildTerminalPopoutQuery({ host, sourceTabId: tabId, mode }),
  }).href
  const popup = window.open(href, `nodeaccess-terminal-${tabId}`, 'width=1280,height=820,resizable=yes,scrollbars=no')

  if (!popup) {
    message.error(t('terminal.popout.openBlocked'))
    return
  }

  if (mode === 'move') {
    message.info(t('terminal.popout.movePending'))
  }
}

function onTabDragStart(event: DragEvent, tabId: string) {
  const host = tabToPopoutHost(tabId)
  if (!host) return
  event.dataTransfer?.setData('text/plain', host.name)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onTabDragEnd(event: DragEvent, tabId: string) {
  const outsideViewport =
    event.clientX < 0
    || event.clientY < 0
    || event.clientX > window.innerWidth
    || event.clientY > window.innerHeight

  if (outsideViewport) openTabInPopout(tabId, 'move')
}

function canAcceptPopoutDrop(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes(TERMINAL_POPOUT_DRAG_MIME)
}

function onTerminalDragOver(event: DragEvent) {
  if (!canAcceptPopoutDrop(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  isPopoutDropActive.value = true
}

function onTerminalDragLeave(event: DragEvent) {
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return
  isPopoutDropActive.value = false
}

function onTerminalDrop(event: DragEvent) {
  if (!canAcceptPopoutDrop(event)) return
  event.preventDefault()
  isPopoutDropActive.value = false
  const payload = parseTerminalPopoutDragPayload(event.dataTransfer?.getData(TERMINAL_POPOUT_DRAG_MIME) ?? '')
  if (!payload) return
  requestTerminalPopoutInsert(payload.host, payload.popoutId, payload.requestId)
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
const pickerQuickAccessHosts = ref<HostPublic[]>([])
const pickerLoading = ref(false)
const pickerLoadError = ref<string | null>(null)
const pickerSelectedIndex = ref(0)
const pickerSearchEl = ref<{ focus: () => void } | null>(null)
const pickerOptionRefs = ref<Array<HTMLButtonElement | null>>([])
let pickerSearchTimer: ReturnType<typeof setTimeout> | null = null
let pickerRequestSeq = 0

const pickerListboxId = 'terminal-host-switcher-listbox'

const activePickerOptionId = computed(() => {
  const host = filteredHosts.value[pickerSelectedIndex.value]
  return host ? `terminal-host-switcher-option-${host.id}` : undefined
})

function setPickerOptionRef(el: Element | ComponentPublicInstance | null, index: number) {
  pickerOptionRefs.value[index] = el instanceof HTMLButtonElement ? el : null
}

function scrollSelectedPickerOptionIntoView() {
  pickerOptionRefs.value[pickerSelectedIndex.value]?.scrollIntoView({ block: 'nearest' })
}

function hostConnectionModeLabel(host: HostPublic) {
  if (host.connectionMode === 'direct') return t('hosts.form.connectionShortDirect')
  if (host.connectionMode === 'agent_user') return t('hosts.form.connectionShortUser')
  if (host.connectionMode === 'agent_tenant_fallback' || host.connectionMode === 'agent') return t('hosts.form.connectionShortAgent')
  if (host.connectionMode === 'private_access_connector') return t('hosts.form.connectionShortPrivateAccess')
  return t('hosts.form.connectionShortAuto')
}

function hostConnectionModeTagType(host: HostPublic): 'default' | 'info' | 'success' | 'warning' {
  if (host.connectionMode === 'direct') return 'default'
  if (host.connectionMode === 'auto') return 'warning'
  return 'success'
}

const protocolFallbackLabels: Record<HostPublic['accessProtocol'], string> = {
  ssh: 'SSH',
  rdp: 'RDP',
  telnet: 'Telnet',
  vnc: 'VNC',
  serial: 'Serial',
}

function translateOr(key: string, fallback: string) {
  const translated = t(key)
  return translated === key ? fallback : translated
}

function protocolLabel(protocol: HostPublic['accessProtocol'] | undefined) {
  const normalized = protocol ?? 'ssh'
  return translateOr(`hosts.protocols.${normalized}`, protocolFallbackLabels[normalized] ?? 'SSH')
}

function hostProtocolLabel(host: HostPublic) {
  return protocolLabel(host.accessProtocol)
}

function isTerminalProtocolSupported(host: HostPublic) {
  return canOpenInWebTerminal(host.accessProtocol)
}

function isGraphicalProtocolSupported(host: HostPublic) {
  return getHostAccessProtocolCapabilities(host.accessProtocol).graphicalGatewayPlanned
}

function canOpenHostInConsole(host: HostPublic) {
  return isTerminalProtocolSupported(host) || isGraphicalProtocolSupported(host)
}

function canConnectHost(host: HostPublic): boolean {
  return auth.isAdmin || host.accessPermissions?.connect === true
}

async function loadPickerQuickAccessHosts() {
  const ids = [...new Set([...favoriteHostIds.value, ...recentHostIds.value])]
  if (ids.length === 0) {
    pickerQuickAccessHosts.value = []
    return
  }

  try {
    const { data } = await hostService.listVisibleByIds(ids)
    pickerQuickAccessHosts.value = data
  } catch {
    pickerQuickAccessHosts.value = []
  }
}

async function loadPickerHosts(search = pickerSearch.value) {
  const requestSeq = ++pickerRequestSeq
  pickerLoading.value = true
  pickerLoadError.value = null
  try {
    const normalizedSearch = search.trim()
    const { data } = await hostService.list({
      page: 1,
      limit: normalizedSearch ? 50 : 200,
      search: normalizedSearch || undefined,
    })
    if (requestSeq !== pickerRequestSeq) return
    pickerHosts.value = data.data
    pickerSelectedIndex.value = 0
  } catch {
    if (requestSeq !== pickerRequestSeq) return
    pickerLoadError.value = t('terminal.hostSwitcherLoadError')
    pickerHosts.value = []
  } finally {
    if (requestSeq === pickerRequestSeq) {
      pickerLoading.value = false
    }
  }
}

async function openPicker() {
  showPicker.value = true
  pickerSearch.value = ''
  pickerSelectedIndex.value = 0
  if (pickerSearchTimer) clearTimeout(pickerSearchTimer)
  await loadPickerQuickAccessHosts()
  await loadPickerHosts('')
  nextTick(() => pickerSearchEl.value?.focus())
}

const pickerHostById = computed(() => {
  const map = new Map<number, HostPublic>()
  for (const host of pickerHosts.value) map.set(host.id, host)
  for (const host of pickerQuickAccessHosts.value) map.set(host.id, host)
  return map
})

const favoritePickerHosts = computed(() =>
  favoriteHostIds.value
    .map((id) => pickerHostById.value.get(id))
    .filter((host): host is HostPublic => !!host),
)

const recentPickerHosts = computed(() =>
  recentHostIds.value
    .map((id) => pickerHostById.value.get(id))
    .filter((host): host is HostPublic => !!host && !favoriteHostIds.value.includes(host.id)),
)

const filteredHosts = computed(() => {
  const query = pickerSearch.value.trim().toLowerCase()
  const baseHosts = Array.from(pickerHostById.value.values())
  const matches = baseHosts.filter((host) =>
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

watch(pickerSearch, (value) => {
  if (!showPicker.value) return
  if (pickerSearchTimer) clearTimeout(pickerSearchTimer)
  pickerSearchTimer = setTimeout(() => {
    void loadPickerHosts(value)
  }, 180)
})

watch([favoriteHostIds, recentHostIds], () => {
  if (!showPicker.value) return
  void loadPickerQuickAccessHosts()
}, { deep: true })

watch(filteredHosts, (hosts) => {
  pickerOptionRefs.value = pickerOptionRefs.value.slice(0, hosts.length)
  if (pickerSelectedIndex.value >= hosts.length) {
    pickerSelectedIndex.value = Math.max(0, hosts.length - 1)
  }
  void nextTick(scrollSelectedPickerOptionIntoView)
})

watch(pickerSelectedIndex, () => {
  void nextTick(scrollSelectedPickerOptionIntoView)
})

onUnmounted(() => {
  if (pickerSearchTimer) clearTimeout(pickerSearchTimer)
})

function pickHost(host: HostPublic) {
  if (!canConnectHost(host)) {
    message.warning(t('hosts.inventoryAcl.connectRequired'))
    return
  }
  if (!canOpenHostInConsole(host)) {
    message.info(t('hosts.protocols.connectionPending', { protocol: hostProtocolLabel(host) }))
    return
  }
  if (isGraphicalProtocolSupported(host) && termSettings.graphicalOpenMode === 'dedicated') {
    showPicker.value = false
    pickerSearch.value = ''
    pickerSelectedIndex.value = 0
    markHostAsRecent(host.id)
    router.push({ name: 'graphical-session', params: { hostId: host.id } })
    return
  }
  if (!canAddTab.value) {
    message.warning(t('terminal.noMultiConnect'))
    return
  }
  showPicker.value   = false
  pickerSearch.value = ''
  pickerSelectedIndex.value = 0
  markHostAsRecent(host.id)
  addTerminalTab({ id: host.id, name: host.name, ip: host.ip, port: host.port, authType: host.authType, accessProtocol: host.accessProtocol })
  if (isTerminalProtocolSupported(host)) {
    autoFullscreenAttempted.value = false
    void nextTick(() => tryAutoBrowserFullscreen())
  }
}

function onHostPickerKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    showPicker.value = false
    pickerSearch.value = ''
    if (termStore.activeId) paneRefs[termStore.activeId]?.focus?.()
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    pickerSelectedIndex.value = Math.min(pickerSelectedIndex.value + 1, Math.max(0, filteredHosts.value.length - 1))
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    pickerSelectedIndex.value = Math.max(0, pickerSelectedIndex.value - 1)
    return
  }
  if (event.key !== 'Enter') return
  const selected = filteredHosts.value[pickerSelectedIndex.value] ?? filteredHosts.value[0]
  if (!selected) return
  event.preventDefault()
  if (!canOpenHostInConsole(selected)) {
    message.info(t('hosts.protocols.connectionPending', { protocol: hostProtocolLabel(selected) }))
    return
  }
  pickHost(selected)
}

// ── Side panels ───────────────────────────────────────────────────────────

type TerminalSidebarPanel = 'files' | 'snippets' | 'tunnels'

const showFiles    = ref(false)
const sidebarPanelWidth = ref(360)
const showSnippets = ref(false)
const showTunnels  = ref(false)
const showSnippetQuickPicker = ref(false)
const snippetQuickSearch = ref('')
const snippetQuickLoading = ref(false)
const snippetQuickItems = ref<Snippet[]>([])
const snippetQuickSearchEl = ref<{ focus: () => void } | null>(null)
const snippetQuickSelectedIndex = ref(0)
const snippetQuickOptionRefs = ref<Array<HTMLButtonElement | null>>([])
const creatingHostLink = ref(false)
const creatingSharedSession = ref(false)
const showTerminalAiModal = ref(false)
const terminalAiPrompt = ref('')
const terminalAiLoading = ref(false)
const terminalAiHistory = ref<Array<{ role: 'user' | 'assistant'; text: string; provider?: LocalAiChatResponse['provider']; citations?: LocalAiChatResponse['citations'] }>>([])

// Ref map to access TerminalPane instances for sendText
const paneRefs: Record<string, InstanceType<typeof TerminalPane> | null> = {}

const snippetQuickListboxId = 'terminal-snippet-quick-picker-listbox'

const activeSnippetQuickOptionId = computed(() => {
  const snippet = filteredSnippetQuickItems.value[snippetQuickSelectedIndex.value]
  return snippet ? `terminal-snippet-quick-picker-option-${snippet.id}` : undefined
})

function setSnippetQuickOptionRef(el: Element | ComponentPublicInstance | null, index: number) {
  snippetQuickOptionRefs.value[index] = el instanceof HTMLButtonElement ? el : null
}

function scrollSelectedSnippetQuickOptionIntoView() {
  snippetQuickOptionRefs.value[snippetQuickSelectedIndex.value]?.scrollIntoView({ block: 'nearest' })
}
const EXPECT_SEND_TIMEOUT_MS = 15_000
type StartupSnippetState = 'pending' | 'suggested' | 'running' | 'done' | 'skipped' | 'error'
const activeExpectMacros = ref<Record<string, {
  steps: Array<{ expect: string; send: string }>
  index: number
  buffer: string
  name: string
  snippetId?: number
  executionId?: string
  timer: number | null
  status: 'running' | 'paused'
  history: Array<{ expect: string; send: string; matchedAt: number; result: 'matched' | 'skipped' }>
}>>({})
const startupSnippetStateByTabId = ref<Record<string, StartupSnippetState>>({})
const startupSnippetErrorByTabId = ref<Record<string, string | null>>({})

function normalizeTerminalCommand(command: string) {
  return command.endsWith('\n') ? command : `${command}\n`
}

const activeTerminalTab = computed(() => {
  const activeId = termStore.activeId
  return activeId ? termStore.tabs.find((tab) => tab.id === activeId) ?? null : null
})

const filteredTerminalTabs = computed(() => {
  const query = tabSearchQuery.value.trim().toLowerCase()
  if (!query) return termStore.tabs
  return termStore.tabs.filter((tab) => [
    tab.hostName,
    tab.hostIp,
    tab.hostPort ? String(tab.hostPort) : '',
  ].some((value) => value?.toLowerCase().includes(query)))
})

function selectSearchedTab(tabId: string) {
  focusTab(tabId)
  showTabSearch.value = false
  tabSearchQuery.value = ''
}

function getActiveTerminalContext() {
  const activeId = termStore.activeId
  if (!activeId) return null

  const pane = paneRefs[activeId]
  const tab = termStore.tabs.find((item) => item.id === activeId)
  if (!pane || !tab) return null

  const selection = pane.getSelectionText?.().trim() ?? ''
  const bufferText = pane.getBufferText?.() ?? ''
  const recentOutput = bufferText.slice(-12000)
  const bufferTail = bufferText.slice(-40000)

  return {
    sessionId: tabSessionIds.value[activeId] ?? null,
    hostId: tab.hostId,
    hostName: tab.hostName ?? null,
    hostIp: tab.hostIp ?? null,
    connectionStatus: tabStatus.value[activeId] ?? null,
    selection: selection || null,
    recentOutput: recentOutput || null,
    bufferTail: bufferTail || null,
  }
}

const canAnalyzeActiveTerminal = computed(() => !!termStore.activeId && !!activeTerminalTab.value)

function openTerminalAiModal() {
  if (!canAnalyzeActiveTerminal.value) return
  showTerminalAiModal.value = true
  if (!terminalAiPrompt.value.trim()) {
    terminalAiPrompt.value = t('terminal.ai.defaultPrompt')
  }
}

async function submitTerminalAiPrompt() {
  const text = terminalAiPrompt.value.trim()
  const terminalContext = getActiveTerminalContext()
  if (!text || !terminalContext) return

  terminalAiHistory.value.push({ role: 'user', text })
  terminalAiPrompt.value = ''
  terminalAiLoading.value = true
  try {
    const { data } = await localAiService.chat({
      message: text,
      contextRoute: '/terminal',
      contextScreen: 'terminal',
      terminalContext,
    })
    terminalAiHistory.value.push({
      role: 'assistant',
      text: data.answer,
      provider: data.provider,
      citations: data.citations,
    })
  } catch (err: unknown) {
    const apiMessage = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    message.error(apiMessage ?? t('terminal.ai.error'))
  } finally {
    terminalAiLoading.value = false
  }
}

function applyTerminalAiSuggestion(kind: 'selection' | 'buffer' | 'error') {
  if (kind === 'selection') {
    terminalAiPrompt.value = t('terminal.ai.prompts.selection')
    return
  }
  if (kind === 'error') {
    terminalAiPrompt.value = t('terminal.ai.prompts.error')
    return
  }
  terminalAiPrompt.value = t('terminal.ai.prompts.buffer')
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

watch(snippetQuickSearch, () => {
  snippetQuickSelectedIndex.value = 0
})

watch(filteredSnippetQuickItems, (items) => {
  snippetQuickOptionRefs.value = snippetQuickOptionRefs.value.slice(0, items.length)
  if (snippetQuickSelectedIndex.value >= items.length) {
    snippetQuickSelectedIndex.value = Math.max(0, items.length - 1)
  }
  void nextTick(scrollSelectedSnippetQuickOptionIntoView)
})

watch(snippetQuickSelectedIndex, () => {
  void nextTick(scrollSelectedSnippetQuickOptionIntoView)
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
  snippetQuickSelectedIndex.value = 0
  await ensureSnippetQuickItems()
  nextTick(() => snippetQuickSearchEl.value?.focus())
}

function closeSnippetQuickPicker() {
  showSnippetQuickPicker.value = false
  snippetQuickSearch.value = ''
  snippetQuickSelectedIndex.value = 0
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
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    snippetQuickSelectedIndex.value = Math.min(
      snippetQuickSelectedIndex.value + 1,
      Math.max(0, filteredSnippetQuickItems.value.length - 1),
    )
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    snippetQuickSelectedIndex.value = Math.max(0, snippetQuickSelectedIndex.value - 1)
    return
  }
  if (event.key !== 'Enter') return
  const selected = filteredSnippetQuickItems.value[snippetQuickSelectedIndex.value] ?? filteredSnippetQuickItems.value[0]
  if (!selected) return
  event.preventDefault()
  void sendQuickSnippet(selected)
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
        executionId: macro.executionId,
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
  await sendSnippetToTerminal(activeId, payload, snippetId)
}

async function sendSnippetToTerminal(tabId: string, payload: SnippetExecution, snippetId?: number) {
  const pane = paneRefs[tabId]
  if (!pane) return
  const executionId = snippetId ? createSnippetExecutionId() : undefined

  if (payload.kind === 'SEQUENCE') {
    for (const step of payload.steps) {
      sendTextRespectingSecrets(pane, normalizeTerminalCommand(step), { snippetId, snippetName: payload.name, executionId })
      await sleep(120)
    }
    return
  }

  if (payload.kind === 'EXPECT_SEND') {
    cancelExpectSendMacro(tabId, false)
    activeExpectMacros.value[tabId] = {
      steps: payload.expectSteps,
      index: 0,
      buffer: '',
      name: payload.name?.trim() || termStore.tabs.find((tab) => tab.id === tabId)?.hostName || 'macro',
      ...(snippetId !== undefined && { snippetId }),
      ...(executionId !== undefined && { executionId }),
      timer: null,
      status: 'running',
      history: [],
    }
    scheduleExpectSendMacroTimeout(tabId)
    message.info(t('snippets.expectSendStarted', { name: activeExpectMacros.value[tabId].name }))
    return
  }

  sendTextRespectingSecrets(pane, normalizeTerminalCommand(payload.command), { snippetId, snippetName: payload.name, executionId })
}

async function findStartupSnippet(tabId: string) {
  const tab = termStore.tabs.find((item) => item.id === tabId)
  const snippetId = tab?.startupSnippetId ?? null
  if (!tab || !snippetId || (tab.startupSnippetMode ?? 'disabled') === 'disabled') return null
  await ensureSnippetQuickItems()
  return snippetQuickItems.value.find((snippet) => snippet.id === snippetId) ?? null
}

async function prepareStartupSnippet(tabId: string) {
  const tab = termStore.tabs.find((item) => item.id === tabId)
  if (!tab || !tab.startupSnippetId || (tab.startupSnippetMode ?? 'disabled') === 'disabled') return
  if (startupSnippetStateByTabId.value[tabId]) return
  startupSnippetStateByTabId.value = { ...startupSnippetStateByTabId.value, [tabId]: 'pending' }
  startupSnippetErrorByTabId.value = { ...startupSnippetErrorByTabId.value, [tabId]: null }

  const snippet = await findStartupSnippet(tabId)
  if (!snippet) {
    startupSnippetStateByTabId.value = { ...startupSnippetStateByTabId.value, [tabId]: 'error' }
    startupSnippetErrorByTabId.value = { ...startupSnippetErrorByTabId.value, [tabId]: t('terminal.startupSnippet.notFound') }
    return
  }

  if (tab.startupSnippetMode === 'auto') {
    await runStartupSnippet(tabId)
    return
  }
  startupSnippetStateByTabId.value = { ...startupSnippetStateByTabId.value, [tabId]: 'suggested' }
}

async function runStartupSnippet(tabId: string) {
  const snippet = await findStartupSnippet(tabId)
  if (!snippet) return
  startupSnippetStateByTabId.value = { ...startupSnippetStateByTabId.value, [tabId]: 'running' }
  try {
    await sendSnippetToTerminal(tabId, { ...deserializeSnippetCommand(snippet.command), name: snippet.name }, snippet.id)
    startupSnippetStateByTabId.value = { ...startupSnippetStateByTabId.value, [tabId]: 'done' }
  } catch (error) {
    startupSnippetStateByTabId.value = { ...startupSnippetStateByTabId.value, [tabId]: 'error' }
    startupSnippetErrorByTabId.value = {
      ...startupSnippetErrorByTabId.value,
      [tabId]: error instanceof Error ? error.message : t('terminal.startupSnippet.failed'),
    }
  }
}

function skipStartupSnippet(tabId: string) {
  startupSnippetStateByTabId.value = { ...startupSnippetStateByTabId.value, [tabId]: 'skipped' }
  paneRefs[tabId]?.focus?.()
}

const activeStartupSnippetBanner = computed(() => {
  const tab = activeTerminalTab.value
  if (!tab || !tab.startupSnippetId) return null
  const state = startupSnippetStateByTabId.value[tab.id]
  if (state !== 'suggested' && state !== 'running' && state !== 'error') return null
  const snippet = snippetQuickItems.value.find((item) => item.id === tab.startupSnippetId)
  return {
    tabId: tab.id,
    state,
    name: snippet?.name ?? t('terminal.startupSnippet.unknownSnippet'),
    error: startupSnippetErrorByTabId.value[tab.id] ?? null,
  }
})

function sendTextRespectingSecrets(
  pane: InstanceType<typeof TerminalPane> | null | undefined,
  text: string,
  context: { snippetId?: number | undefined; snippetName?: string | undefined; executionId?: string | undefined },
) {
  if (!pane) return
  if (getSnippetExecutionSecretAliases({
    kind: 'COMMAND',
    command: text,
    steps: [],
    expectSteps: [],
  }).length === 0) {
    if (context.snippetId !== undefined && context.executionId !== undefined) {
      pane.sendSnippetText(text, {
        snippetId: context.snippetId,
        executionId: context.executionId,
        ...(context.snippetName !== undefined && { snippetName: context.snippetName }),
      })
      return
    }
    pane.sendText(text)
    return
  }
  pane.sendSecretText(text, context)
}

function createSnippetExecutionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
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

const activeAssociatedLinks = computed(() =>
  (activeHostDetails.value?.associatedLinks ?? []).filter((link) => link.enabled),
)

const associatedLinkMenuOptions = computed<DropdownOption[]>(() =>
  activeAssociatedLinks.value.map((link, index) => ({
    key: `associated-link:${index}`,
    label: link.label,
  })),
)

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
const activeSharedSessionViewers = computed(() => {
  const shared = currentSharedSession.value
  if (!shared) return []
  return shared.participants.filter((participant) => participant.role === 'viewer' && !participant.leftAt)
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
const showSharedSessionManagerAction = computed(() =>
  !!activeSharedSessionId.value
  && (
    activeSharedSessionViewers.value.length > 0
    || pendingSharedControlParticipants.value.length > 0
    || !!currentSharedSession.value?.activeControlLease
  ),
)

const canCreateOwnSessionLink = computed(() => activeHostId.value !== null)
const canCreateLiveSessionLink = computed(() => activeSessionId.value !== null)
const shareActionBusy = computed(() => creatingHostLink.value || creatingSharedSession.value)
function renderDropdownIcon(icon: keyof typeof TERMINAL_RAIL_ICONS) {
  return () => h('svg', {
    innerHTML: TERMINAL_RAIL_ICONS[icon],
    viewBox: '0 0 24 24',
    class: 'h-4 w-4',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.8',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  })
}

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
const shareMenuOptions = computed<DropdownOption[]>(() => {
  const options: DropdownOption[] = [
    {
      key: 'live-session',
      label: t('sharedSessions.title'),
      icon: renderDropdownIcon('share'),
      disabled: !canCreateLiveSessionLink.value,
    },
    {
      key: 'own-session',
      label: t('hostLinks.title'),
      icon: renderDropdownIcon('ownSession'),
    },
  ]

  if (jitAccessEnabled.value) {
    options.push({
      key: 'jit-link',
      label: t('hostLinks.generateJit'),
      icon: renderDropdownIcon('jit'),
    })
  }

  return options
})

watch(activeHostId, async (hostId) => {
  if (!hostId) {
    activeHostDetails.value = null
    return
  }

  activeHostDetailsLoading.value = true
  try {
    const { data } = await hostService.get(hostId)
    activeHostDetails.value = data
  } catch {
    activeHostDetails.value = null
  } finally {
    activeHostDetailsLoading.value = false
  }
}, { immediate: true })

function resolveAssociatedLink(link: HostAssociatedLink): string | null {
  const host = activeHostDetails.value
  if (!host) return null
  return resolveHostLinkTemplate(link.urlTemplate, {
    id: host.id,
    name: host.name,
    ip: host.ip,
    port: host.port,
    sshUser: host.sshUser,
  })
}

function openAssociatedLink(link: HostAssociatedLink) {
  const url = resolveAssociatedLink(link)
  if (!url) return
  const target = link.openMode === 'same_tab' ? '_self' : '_blank'
  window.open(url, target, target === '_blank' ? 'noopener,noreferrer' : undefined)
}

function onAssociatedLinkSelect(key: string | number) {
  const raw = String(key)
  if (!raw.startsWith('associated-link:')) return
  const index = Number(raw.replace('associated-link:', ''))
  const link = activeAssociatedLinks.value[index]
  if (!link) return
  openAssociatedLink(link)
}

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

async function generateQuickJitLink() {
  if (activeHostId.value === null || creatingHostLink.value) return

  creatingHostLink.value = true
  try {
    const { data } = await hostLinkService.create({
      hostId: activeHostId.value,
      expiresInMinutes: 10,
      type: 'public_once',
    })
    await navigator.clipboard.writeText(data.url)
    message.success(data.pin
      ? t('hostLinks.jitCreatedWithPin', { pin: data.pin })
      : t('hostLinks.jitCreatedAndCopied'))
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
    const sharedSettings = await featuresService.get().then((features) => features.sharedSessions).catch(() => null)
    const expiresInMinutes = sharedSettings?.expiryMinutes?.length
      ? [...sharedSettings.expiryMinutes].sort((a, b) => a - b)[0]!
      : 10
    const { data } = await sharedSessionService.create({
      sessionId: activeSessionId.value,
      expiresInMinutes,
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
  if (value === 'jit-link') {
    void generateQuickJitLink()
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
  const startWidth = sidebarPanelWidth.value

  function onMove(ev: MouseEvent) {
    const delta = ev.clientX - startX
    sidebarPanelWidth.value = Math.max(
      280,
      Math.min(900, termSettings.sidebarRailPosition === 'right' ? startWidth - delta : startWidth + delta),
    )
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

const activeSidebarPanel = computed<TerminalSidebarPanel | null>(() => {
  if (showFiles.value) return 'files'
  if (showSnippets.value) return 'snippets'
  if (showTunnels.value) return 'tunnels'
  return null
})

const activeSidebarPanelTitle = computed(() => {
  if (activeSidebarPanel.value === 'files') return t('terminal.files')
  if (activeSidebarPanel.value === 'snippets') return t('snippets.title')
  if (activeSidebarPanel.value === 'tunnels') return t('tunnels.title')
  return ''
})

const resolvedSidebarPanelWidth = computed(() => {
  const maxAllowed = Math.max(280, viewportWidth.value - 180)
  return Math.max(280, Math.min(sidebarPanelWidth.value, maxAllowed))
})
const isSidebarRailOnRight = computed(() => termSettings.sidebarRailPosition === 'right')

function setActiveSidebarPanel(panel: TerminalSidebarPanel | null) {
  showFiles.value = panel === 'files'
  showSnippets.value = panel === 'snippets'
  showTunnels.value = panel === 'tunnels'
}

function toggleSidebarPanel(panel: TerminalSidebarPanel) {
  if ((panel === 'files' || panel === 'tunnels') && activeHostId.value === null) return
  setActiveSidebarPanel(activeSidebarPanel.value === panel ? null : panel)
}

// ── Split panes (layout view over open tabs, up to 4 total) ─────────────

const splitEnabled      = ref(false)
const splitPaneStatus   = ref<Record<string, string>>({})  // tabId → status

const maxPanes       = 4
const splitGridTabs  = computed(() => splitEnabled.value ? termStore.tabs.slice(0, maxPanes) : [])
const splitTabIds    = computed(() => splitGridTabs.value.map((tab) => tab.id))
const hasAnySplit    = computed(() => splitEnabled.value && splitGridTabs.value.length > 1)
const singleVisibleTabId = computed(() => termStore.activeId ?? termStore.tabs[0]?.id ?? null)
const singleVisibleTabs  = computed(() => termStore.tabs)
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
  void prepareStartupSnippet(tabId)
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
    toggleSidebarPanel('files')
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
onMounted(()   => window.addEventListener(FEATURES_UPDATED_EVENT, loadTerminalCapabilities))
onMounted(()   => window.addEventListener('resize', onWindowResize))
onMounted(()   => document.addEventListener('fullscreenchange', syncBrowserFullscreenState))
onMounted(()   => nextTick(() => { void tryAutoBrowserFullscreen() }))
onUnmounted(() => {
  if (sharedSessionPollTimer) clearInterval(sharedSessionPollTimer)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener(SESSION_EXPIRED_EVENT, resetTerminalViewState)
  window.removeEventListener(TERMINAL_LAYOUT_RESET_EVENT, resetTerminalLayoutState)
  window.removeEventListener(FEATURES_UPDATED_EVENT, loadTerminalCapabilities)
  window.removeEventListener('resize', onWindowResize)
  document.removeEventListener('fullscreenchange', syncBrowserFullscreenState)
  Object.keys(activeExpectMacros.value).forEach((tabId) => cancelExpectSendMacro(tabId, false))
})
onActivated(() => {
  isTerminalActive.value = true
  void loadTerminalFeatures()
  if (termStore.activeId) {
    termStore.clearUnread(termStore.activeId)
    const id = termStore.activeId
    void nextTick(() => paneRefs[id]?.focus?.())
  }
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

watch(activeHostId, (hostId) => {
  if (hostId !== null) return
  if (activeSidebarPanel.value === 'files' || activeSidebarPanel.value === 'tunnels') {
    setActiveSidebarPanel(null)
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

function addTerminalTab(host: { id: number; name?: string; ip?: string; port?: number; authType?: string; accessProtocol?: HostPublic['accessProtocol'] }) {
  return termStore.add(host)
}

function isGraphicalTab(tab: { hostAccessProtocol?: HostPublic['accessProtocol'] }) {
  const protocol = tab.hostAccessProtocol ?? 'ssh'
  return !canOpenInWebTerminal(protocol) && getHostAccessProtocolCapabilities(protocol).graphicalGatewayPlanned
}

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

function isTerminalPaneVisible(tabId: string): boolean {
  return hasAnySplit.value
    ? splitTabIds.value.includes(tabId)
    : tabId === singleVisibleTabId.value
}

function terminalPaneShellClass(tabId: string): string {
  if (!hasAnySplit.value) return 'absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden'
  return [
    'flex min-h-0 min-w-0 flex-col overflow-hidden border bg-[#1a1b1e] transition-colors',
    splitPaneClass(tabId),
  ].join(' ')
}

function terminalPaneShellStyle(tabId: string) {
  return splitGridTabs.value.length === 3 && viewportWidth.value >= 1280 && splitGridTabs.value[0]?.id === tabId
    ? { gridRow: '1 / span 2' }
    : undefined
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
    <div class="h-14 bg-[#18181c] border-b border-gray-800 shrink-0 overflow-hidden">
      <div class="flex h-full items-center px-6 overflow-x-auto">
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

        <NButton text size="small" class="shrink-0 px-0" @click="goBackFromTerminal">
          {{ $t('terminal.back') }}
        </NButton>

        <div class="w-px h-5 bg-gray-700 shrink-0 mx-4" />

        <div class="flex items-center gap-0.5 flex-1 overflow-x-auto py-1 min-w-0">
        <NTooltip
          v-for="tab in termStore.tabs"
          :key="tab.id"
          trigger="hover"
          placement="bottom"
          :delay="400"
          :disabled="tabCtxVisible"
        >
          <!-- Conteúdo do tooltip -->
          <template #trigger>
            <button
              class="flex items-center gap-1.5 px-3 py-1 rounded text-sm whitespace-nowrap transition-colors"
              :class="tab.id === termStore.activeId
                ? 'bg-[#1a1b1e] text-white'
                : 'text-gray-400 hover:text-white hover:bg-[#1e1e22]'"
              draggable="true"
              @click="focusTab(tab.id)"
              @contextmenu="openTabContextMenu($event, tab.id)"
              @dragstart="onTabDragStart($event, tab.id)"
              @dragend="onTabDragEnd($event, tab.id)"
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
                v-else-if="isAdminClosedTab(tab.id)"
                class="inline-flex items-center gap-0.5 text-[10px] font-medium px-1 py-px rounded"
                style="background: rgba(59,130,246,0.14); color: #93c5fd;"
              >
                <span class="w-1 h-1 rounded-full bg-blue-400" />
                {{ $t('terminal.adminClosedBadge') }}
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
                :class="isGraphicalTab(tab) ? 'bg-blue-400' : tabStatus[tab.id] === 'connected' ? 'bg-green-400' : 'bg-gray-500'"
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
              <!-- Agent badge -->
              <span
                v-if="tabConnectionRoute[tab.id]?.method && tabConnectionRoute[tab.id]?.method !== 'direct'"
                class="text-[10px] font-mono ml-0.5 text-purple-400"
                :title="tabConnectionRoute[tab.id]?.agentName ? `via agente: ${tabConnectionRoute[tab.id]?.agentName}` : 'via agente'"
              >⬡</span>
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
            <div class="text-gray-400">{{ protocolLabel(tab.hostAccessProtocol) }}</div>
            <div v-if="tab.hostIp" class="text-gray-400 font-mono">{{ tab.hostIp }}:{{ tab.hostPort }}</div>
            <div v-if="tab.hostAccessProtocol === 'ssh' && tab.hostAuthType" class="text-gray-400">
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
            <div v-if="tabConnectionRoute[tab.id]?.method" class="flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full shrink-0"
                :class="tabConnectionRoute[tab.id]?.method === 'direct' ? 'bg-gray-400' : 'bg-purple-400'"
              />
              <span class="text-gray-400">
                <template v-if="tabConnectionRoute[tab.id]?.method === 'direct'">{{ $t('terminal.routeDirect') }}</template>
                <template v-else-if="tabConnectionRoute[tab.id]?.agentName">{{ $t('terminal.routeAgent') }}: <span class="text-purple-300">{{ tabConnectionRoute[tab.id]?.agentName }}</span></template>
                <template v-else>{{ $t('terminal.routeAgent') }}</template>
              </span>
            </div>
            <div v-if="isSessionExpiredError(tabErrors[tab.id])" class="text-yellow-400">
              {{ $t('terminal.sessionExpiredHint') }}
            </div>
            <div
              v-else-if="(tabStatus[tab.id] === 'error' || tabStatus[tab.id] === 'closed') && hintForErrorCode(tabErrorCodes[tab.id])"
              class="text-red-300 text-xs leading-snug"
            >
              {{ hintForErrorCode(tabErrorCodes[tab.id]) }}
            </div>
            <div v-if="!tab.connectedAt" class="text-yellow-400">{{ $t('terminal.connecting') }}...</div>
            <NButton
              v-if="(tabStatus[tab.id] === 'error' || tabStatus[tab.id] === 'closed')
                && tabErrorCodes[tab.id] === 'AUTH_FAILED'
                && (tab.hostAuthType === 'pem' || tab.hostAuthType === 'pem_password')"
              size="tiny"
              type="warning"
              class="mt-1 w-full"
              @click.stop="openPemFixModal(tab.id)"
            >
              🔑 {{ $t('terminal.pemFix.button') }}
            </NButton>
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

        <!-- Top terminal controls -->
        <div v-if="termStore.tabs.length > 0" class="shrink-0 flex items-center gap-0.5 pl-3">
        <NTooltip v-if="showSharedSessionManagerAction" trigger="hover" placement="bottom" :delay="400">
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

        <!-- Add split pane -->
        <NTooltip trigger="hover" placement="bottom" :delay="400">
          <template #trigger>
            <NButton
              size="small" text class="px-2 font-mono"
              :class="hasAnySplit ? 'text-green-400' : 'text-gray-400 hover:text-white'"
              :disabled="!canAddSplitPane"
              data-terminal-action="split-pane"
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

        <NPopover
          v-if="termStore.tabs.length > 0"
          v-model:show="showTabSearch"
          trigger="click"
          placement="bottom-end"
          :width="360"
        >
          <template #trigger>
            <button
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors"
              :class="showTabSearch
                ? 'border-blue-500/30 bg-blue-500/12 text-blue-300'
                : 'border-transparent text-gray-400 hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white'"
              :aria-label="$t('terminal.tabSearch.action')"
              data-terminal-action="tab-search"
            >
              <svg v-html="TERMINAL_RAIL_ICONS.searchTabs" viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </button>
          </template>

          <div class="w-[340px]">
            <div class="mb-3">
              <div class="text-sm font-semibold text-white">{{ $t('terminal.tabSearch.title') }}</div>
              <div class="mt-1 text-xs text-gray-400">{{ $t('terminal.tabSearch.subtitle') }}</div>
            </div>
            <NInput
              v-model:value="tabSearchQuery"
              clearable
              autofocus
              size="small"
              :placeholder="$t('terminal.tabSearch.placeholder')"
              data-terminal-tab-search-input="true"
            />
            <div class="mt-3 max-h-[360px] overflow-y-auto space-y-1">
              <button
                v-for="tab in filteredTerminalTabs"
                :key="`search-tab-${tab.id}`"
                type="button"
                class="w-full rounded-lg border px-3 py-2 text-left transition-colors"
                :class="tab.id === termStore.activeId
                  ? 'border-blue-500/30 bg-blue-500/10 text-white'
                  : 'border-gray-800 bg-[#17181c] text-gray-300 hover:border-gray-700 hover:bg-[#1d1e23]'"
                data-terminal-tab-search-result="true"
                @click="selectSearchedTab(tab.id)"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="truncate text-sm font-medium">{{ tab.hostName }}</div>
                    <div class="truncate text-xs font-mono text-gray-500">
                      {{ tab.hostIp ? `${tab.hostIp}:${tab.hostPort ?? 22}` : $t('terminal.tabSearch.noEndpoint') }}
                    </div>
                  </div>
                  <NTag
                    v-if="tab.id === termStore.activeId"
                    size="small"
                    type="info"
                  >
                    {{ $t('terminal.tabSearch.active') }}
                  </NTag>
                </div>
              </button>
              <NEmpty
                v-if="filteredTerminalTabs.length === 0"
                :description="$t('terminal.tabSearch.empty')"
                class="py-4"
              />
            </div>
          </div>
        </NPopover>

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
    </div>

    <!-- ── Terminais + File Manager ──────────────────────────────────── -->
    <div class="flex-1 overflow-hidden relative flex min-h-0 bg-[#141518]" :class="isSidebarRailOnRight ? 'flex-row-reverse' : ''">

    <div
      v-if="termStore.tabs.length > 0"
      class="shrink-0 w-[58px] bg-[#141518] flex flex-col items-center justify-between py-3"
      :class="isSidebarRailOnRight ? 'border-l border-gray-800' : 'border-r border-gray-800'"
    >
      <div class="flex flex-col items-center gap-2">
        <NTooltip trigger="hover" placement="right" :delay="300">
          <template #trigger>
            <button
              class="flex h-10 w-10 items-center justify-center rounded-xl border transition-colors"
              style="order: 1"
              :class="termSettings.showTerminalToolbar
                ? 'border-transparent text-gray-500 hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white'
                : 'border-gray-700 bg-[#1c1d21] text-white'"
              @click="setShowTerminalToolbar(!termSettings.showTerminalToolbar)"
            >
              <span class="text-sm leading-none">{{ termSettings.showTerminalToolbar ? '⊟' : '⊞' }}</span>
            </button>
          </template>
          <div class="text-xs">
            {{ termSettings.showTerminalToolbar ? $t('terminal.toolbar.hide') : $t('terminal.toolbar.show') }}
          </div>
        </NTooltip>

        <NTooltip trigger="hover" placement="right" :delay="300">
          <template #trigger>
            <button
              class="flex h-10 w-10 items-center justify-center rounded-xl border transition-colors"
              style="order: 2"
              :class="isBrowserFullscreen
                ? 'border-emerald-500/30 bg-emerald-500/12 text-emerald-300'
                : 'border-transparent text-gray-400 hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white'"
              @click="toggleBrowserFullscreen"
            >
              <svg v-html="TERMINAL_RAIL_ICONS.fullscreen" viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </button>
          </template>
          <div class="text-xs">{{ isBrowserFullscreen ? $t('terminal.exitFullscreen') : $t('terminal.enterFullscreen') }}</div>
        </NTooltip>

        <NTooltip v-if="canCreateOwnSessionLink" trigger="hover" placement="right" :delay="300">
          <template #trigger>
            <span class="inline-flex" style="order: 5">
              <NDropdown trigger="click" :options="shareMenuOptions" @select="onShareModeSelect">
                <button
                  class="relative flex h-10 w-10 items-center justify-center rounded-xl border border-transparent text-gray-400 transition-colors hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white"
                  :class="activeSharedSessionId ? 'text-amber-300 border-amber-500/20 bg-amber-500/10' : ''"
                  :disabled="shareActionBusy"
                  :aria-label="$t('sharedSessions.title')"
                >
                  <svg v-html="TERMINAL_RAIL_ICONS.share" viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                  <span
                    v-if="activeSharedSessionId"
                    class="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-400"
                  />
                </button>
              </NDropdown>
            </span>
          </template>
          <div class="text-xs space-y-1">
            <div>{{ $t('sharedSessions.title') }}</div>
            <div class="text-gray-400">{{ $t('sharedSessions.menuHint') }}</div>
          </div>
        </NTooltip>

        <NTooltip v-if="activeAssociatedLinks.length" trigger="hover" placement="right" :delay="300">
          <template #trigger>
            <span class="inline-flex" style="order: 8">
              <NDropdown trigger="click" :options="associatedLinkMenuOptions" @select="onAssociatedLinkSelect">
                <button
                  class="flex h-10 w-10 items-center justify-center rounded-xl border border-transparent text-gray-400 transition-colors hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white"
                  :disabled="activeHostDetailsLoading"
                  :aria-label="$t('terminal.associatedLinks.button')"
                >
                  <svg v-html="TERMINAL_RAIL_ICONS.links" viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                </button>
              </NDropdown>
            </span>
          </template>
          <div class="text-xs space-y-1">
            <div>{{ $t('terminal.associatedLinks.hint') }}</div>
            <div class="text-gray-400">{{ $t('terminal.associatedLinks.count', { count: activeAssociatedLinks.length }) }}</div>
          </div>
        </NTooltip>

        <NTooltip trigger="hover" placement="right" :delay="300">
          <template #trigger>
            <button
              class="flex h-10 w-10 items-center justify-center rounded-xl border transition-colors"
              style="order: 3"
              :class="showFiles
                ? 'border-blue-500/30 bg-blue-500/12 text-blue-300'
                : 'border-transparent text-gray-400 hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white'"
              :disabled="activeHostId === null"
              @click="toggleSidebarPanel('files')"
            >
              <svg v-html="TERMINAL_RAIL_ICONS.files" viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </button>
          </template>
          <div class="text-xs">
            {{ showFiles ? $t('terminal.hideFiles') : $t('terminal.files') }}
            <span class="ml-1 text-gray-400 font-mono">{{ shortcuts.files }}</span>
          </div>
        </NTooltip>

        <NTooltip trigger="hover" placement="right" :delay="300">
          <template #trigger>
            <button
              class="flex h-10 w-10 items-center justify-center rounded-xl border transition-colors"
              style="order: 4"
              :class="showSnippets
                ? 'border-purple-500/30 bg-purple-500/12 text-purple-300'
                : 'border-transparent text-gray-400 hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white'"
              @click="toggleSidebarPanel('snippets')"
            >
              <svg v-html="TERMINAL_RAIL_ICONS.snippets" viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </button>
          </template>
          <div class="text-xs">
            {{ $t('snippets.panelHint') }}
            <span class="ml-1 text-gray-400 font-mono">{{ shortcuts.snippets }}</span>
          </div>
        </NTooltip>

        <NTooltip v-if="localAiLicensed" trigger="hover" placement="right" :delay="300">
          <template #trigger>
            <button
              class="flex h-10 w-10 items-center justify-center rounded-xl border transition-colors"
              style="order: 7"
              :class="showTerminalAiModal
                ? 'border-emerald-500/30 bg-emerald-500/12 text-emerald-300'
                : 'border-transparent text-gray-400 hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white'"
              :disabled="!canAnalyzeActiveTerminal"
              @click="openTerminalAiModal"
            >
              <svg v-html="TERMINAL_RAIL_ICONS.localAi" viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </button>
          </template>
          <div class="text-xs">{{ $t('terminal.ai.hint') }}</div>
        </NTooltip>

        <NTooltip trigger="hover" placement="right" :delay="300">
          <template #trigger>
            <button
              class="relative flex h-10 w-10 items-center justify-center rounded-xl border transition-colors"
              style="order: 6"
              :class="showTunnels || activeTunnelCount > 0
                ? 'border-cyan-500/30 bg-cyan-500/12 text-cyan-300'
                : 'border-transparent text-gray-400 hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white'"
              :disabled="activeHostId === null"
              @click="toggleSidebarPanel('tunnels')"
            >
              <svg v-html="TERMINAL_RAIL_ICONS.forwardings" viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
              <span
                v-if="activeTunnelCount > 0"
                class="absolute -right-1 -top-1 flex min-w-[16px] items-center justify-center rounded-full bg-cyan-400 px-1 text-[10px] font-semibold text-slate-950"
              >
                {{ activeTunnelCount > 9 ? '9+' : activeTunnelCount }}
              </span>
            </button>
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
      </div>

      <div class="flex flex-col items-center gap-2">
        <NTooltip v-if="feedbackLicensed" trigger="hover" placement="right" :delay="300">
          <template #trigger>
            <button
              class="flex h-10 w-10 items-center justify-center rounded-xl border border-transparent text-gray-400 transition-colors hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white"
              @click="openFeedbackFromTerminal"
            >
              <svg v-html="TERMINAL_RAIL_ICONS.feedback" viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </button>
          </template>
          <div class="text-xs">{{ $t('feedback.create.fabHint') }}</div>
        </NTooltip>

        <NTooltip trigger="hover" placement="right" :delay="300">
          <template #trigger>
            <button
              class="flex h-10 w-10 items-center justify-center rounded-xl border border-transparent text-gray-400 transition-colors hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white"
              @click="openPicker"
            >
              <svg v-html="TERMINAL_RAIL_ICONS.hosts" viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </button>
          </template>
          <div class="text-xs">
            {{ $t('terminal.hostSwitcherHint') }}
            <span class="ml-1 text-gray-400 font-mono">{{ shortcuts.hostSwitcher }}</span>
          </div>
        </NTooltip>

        <NTooltip trigger="hover" placement="right" :delay="300">
          <template #trigger>
            <button
              class="flex h-10 w-10 items-center justify-center rounded-xl border border-transparent text-gray-500 transition-colors hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white"
              @click="showDiagnostics = true"
            >
              <svg v-html="TERMINAL_RAIL_ICONS.diagnostics" viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </button>
          </template>
          <div class="text-xs">{{ $t('terminal.diagnostics.button') }}</div>
        </NTooltip>
      </div>
    </div>

    <transition name="slide">
      <div
        v-if="activeSidebarPanel"
        :style="{ width: resolvedSidebarPanelWidth + 'px' }"
        class="shrink-0 overflow-hidden flex flex-col relative bg-[#18181c]"
        :class="isSidebarRailOnRight ? 'border-l border-gray-800' : 'border-r border-gray-800'"
      >
        <div
          class="absolute top-0 bottom-0 w-1 z-10 cursor-col-resize hover:bg-blue-500/60 transition-colors"
          :class="isSidebarRailOnRight ? 'left-0' : 'right-0'"
          @mousedown.prevent="startFilePanelResize"
        />
        <div class="flex items-center justify-between gap-2 border-b border-gray-800 px-4 py-3 shrink-0 bg-[#16171a]">
          <div class="min-w-0">
            <div class="text-sm font-semibold text-white">{{ activeSidebarPanelTitle }}</div>
            <div class="text-[11px] text-gray-400">
              <template v-if="activeSidebarPanel === 'files'">{{ activeHostName }}</template>
              <template v-else-if="activeSidebarPanel === 'snippets'">{{ $t('snippets.panelHint') }}</template>
              <template v-else>{{ $t('tunnels.panelHint') }}</template>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <NTooltip v-if="activeSidebarPanel === 'files' && activeHostId !== null" trigger="hover" placement="bottom" :delay="300">
              <template #trigger>
                <NButton size="small" text class="px-1.5 text-gray-500 hover:text-blue-400 transition-colors" @click="openDedicatedFiles">⛶</NButton>
              </template>
              {{ $t('terminal.openFilesFullscreen') }}
            </NTooltip>
            <NButton size="small" text class="px-1.5 text-gray-500 hover:text-white transition-colors" @click="setActiveSidebarPanel(null)">✕</NButton>
          </div>
        </div>

        <FileManager
          v-if="activeSidebarPanel === 'files' && activeHostId !== null"
          :host-id="activeHostId"
          :session-id="activeSessionId"
          class="flex-1 min-h-0"
        />

        <SnippetsPanel
          v-else-if="activeSidebarPanel === 'snippets'"
          class="flex-1 min-h-0"
          @send="(payload) => sendSnippetToActiveTerminal(payload.execution, payload.snippetId)"
        />

        <TunnelManager
          v-else-if="activeSidebarPanel === 'tunnels'"
          :host-id="activeHostId"
          :host-name="termStore.tabs.find(t => t.id === termStore.activeId)?.hostName"
          :active-tunnels="tabTunnels[termStore.activeId ?? '']"
          class="flex-1 min-h-0"
          @active-tunnels-change="onPanelTunnelsChange"
        />
      </div>
    </transition>

    <!-- Terminals area (up to 4 split panes) -->
    <div
      class="split-area m-2 flex-1 overflow-hidden min-w-0 rounded-md border border-gray-800/80"
      :class="hasAnySplit ? 'grid gap-px bg-gray-800 p-px' : 'relative flex bg-[#1a1b1e]'"
      :style="hasAnySplit ? splitGridStyle : undefined"
      @dragover="onTerminalDragOver"
      @dragleave="onTerminalDragLeave"
      @drop="onTerminalDrop"
    >
      <div
        v-if="isPopoutDropActive"
        class="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-md border border-blue-400/70 bg-blue-500/10 text-sm font-medium text-blue-100"
      >
        {{ $t('terminal.popout.dropToInsert') }}
      </div>

      <div
        v-for="tab in termStore.tabs"
        :key="tab.id"
        v-show="isTerminalPaneVisible(tab.id)"
        :class="terminalPaneShellClass(tab.id)"
        :style="hasAnySplit ? terminalPaneShellStyle(tab.id) : undefined"
        @mousedown="focusTab(tab.id)"
      >
        <template v-if="hasAnySplit">
          <div
            class="flex items-center border-b px-3 py-1 shrink-0 transition-colors"
            :class="tab.id === termStore.activeId ? 'bg-[#172554] border-blue-500/40' : 'bg-[#18181c] border-gray-800'"
          >
            <span
              class="w-2 h-2 rounded-full shrink-0 mr-2"
              :class="isGraphicalTab(tab) ? 'bg-blue-400' : splitDotClass(splitPaneStatus[tab.id] ?? tabStatus[tab.id])"
            />
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
        </template>
        <div class="flex-1 overflow-hidden relative min-h-0 min-w-0">
          <div
            v-if="activeStartupSnippetBanner && activeStartupSnippetBanner.tabId === tab.id"
            class="absolute left-4 right-4 top-4 z-20 rounded border border-blue-500/30 bg-[#0f172a]/95 px-4 py-3 shadow-xl"
            data-terminal-startup-snippet-banner="true"
            role="status"
            aria-live="polite"
          >
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div class="min-w-0">
                <div class="text-xs font-semibold uppercase tracking-wide text-blue-200">
                  {{ $t('terminal.startupSnippet.title') }}
                </div>
                <div class="mt-1 text-xs leading-relaxed text-blue-100/80">
                  <template v-if="activeStartupSnippetBanner.state === 'error'">
                    {{ activeStartupSnippetBanner.error ?? $t('terminal.startupSnippet.failed') }}
                  </template>
                  <template v-else>
                    {{ $t('terminal.startupSnippet.description', { name: activeStartupSnippetBanner.name }) }}
                  </template>
                </div>
              </div>
              <div class="flex shrink-0 flex-wrap items-center gap-2">
                <NButton
                  v-if="activeStartupSnippetBanner.state === 'suggested'"
                  size="small"
                  secondary
                  @click.stop="skipStartupSnippet(tab.id)"
                >
                  {{ $t('terminal.startupSnippet.skip') }}
                </NButton>
                <NButton
                  v-if="activeStartupSnippetBanner.state === 'suggested'"
                  size="small"
                  type="primary"
                  @click.stop="runStartupSnippet(tab.id)"
                >
                  {{ $t('terminal.startupSnippet.run') }}
                </NButton>
                <NTag v-else-if="activeStartupSnippetBanner.state === 'running'" size="small" type="info">
                  {{ $t('terminal.startupSnippet.running') }}
                </NTag>
                <NButton
                  v-else
                  size="small"
                  secondary
                  @click.stop="skipStartupSnippet(tab.id)"
                >
                  {{ $t('common.close') }}
                </NButton>
              </div>
            </div>
          </div>
          <div
            v-if="isAdminClosedTab(tab.id)"
            class="absolute left-4 right-4 top-4 z-30 rounded border border-blue-500/30 bg-[#0f172a]/95 px-4 py-3 shadow-xl"
            role="status"
            aria-live="polite"
          >
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div class="min-w-0">
                <div class="text-sm font-semibold text-blue-100">{{ $t('terminal.adminClosedTitle') }}</div>
                <div class="mt-1 text-xs leading-relaxed text-blue-100/80">{{ $t('terminal.adminClosedDescription') }}</div>
              </div>
              <div class="flex shrink-0 flex-wrap items-center gap-2">
                <NButton size="small" secondary @click.stop="goBackFromTerminal">
                  {{ $t('terminal.adminClosedBack') }}
                </NButton>
                <NButton size="small" type="primary" @click.stop="closeTab(tab.id)">
                  {{ $t('terminal.adminClosedClose') }}
                </NButton>
              </div>
            </div>
          </div>
	          <div
	            v-if="isGraphicalTab(tab)"
	            class="absolute inset-0 bg-[#111827]"
	          >
	            <GraphicalSessionView
	              :host-id="tab.hostId"
	              :visible="isTerminalPaneVisible(tab.id)"
	              embedded
	              @connected="(name) => onConnected(tab.id, name)"
	              @session-change="(value) => onSessionChange(tab.id, value)"
	              @status-change="(s) => onPaneStatusChange(tab.id, s)"
	              @remote-closed="onRemoteSessionClosed(tab.id)"
	            />
	          </div>
          <TerminalPane
            v-else
            :ref="(el: unknown) => { paneRefs[tab.id] = el as InstanceType<typeof TerminalPane> | null }"
            :tab-id="tab.id"
            :host-id="tab.hostId"
            :visible="isTerminalPaneVisible(tab.id)"
            class="absolute inset-0"
            @connected="(name) => onConnected(tab.id, name)"
            @session-change="(value) => onSessionChange(tab.id, value)"
            @status-change="(s) => onPaneStatusChange(tab.id, s)"
            @remote-closed="onRemoteSessionClosed(tab.id)"
            @error-change="(value) => onErrorChange(tab.id, value)"
            @error-code-change="(code) => onErrorCodeChange(tab.id, code)"
            @latency-change="(ms) => onLatencyChange(tab.id, ms)"
            @tunnels-change="(state) => onTunnelsChange(tab.id, state)"
            @host-key-verification-required="(challenge) => onHostKeyVerificationRequired(tab.id, challenge)"
            @credentials-required="(challenge) => onCredentialsRequired(tab.id, challenge)"
            @save-password-offer="(offer) => onSavePasswordOffer(tab.id, offer)"
            @output="(chunk) => onTerminalOutput(tab.id, chunk)"
            @host-switcher-requested="openPicker"
            @snippet-quick-picker-requested="openSnippetQuickPicker"
            @connection-route-change="(method, agentName) => onConnectionRouteChange(tab.id, method, agentName)"
          />
        </div>
      </div>

      <NEmpty
        v-if="termStore.tabs.length === 0 && termStore.detached.length === 0"
        :description="$t('terminal.empty')"
        class="absolute inset-0 flex flex-col items-center justify-center"
      >
        <template #extra>
          <NButton type="primary" @click="openPicker">{{ $t('terminal.connectHost') }}</NButton>
        </template>
      </NEmpty>

      <div
        v-else-if="termStore.tabs.length === 0 && termStore.detached.length > 0"
        class="absolute inset-0 flex items-center justify-center p-6"
      >
        <div class="w-full max-w-xl rounded-md border border-gray-800 bg-[#18181c] p-4">
          <div class="text-sm font-semibold text-white">{{ $t('terminal.popout.detachedTitle') }}</div>
          <div class="mt-1 text-xs text-gray-400">{{ $t('terminal.popout.detachedDescription') }}</div>

          <div class="mt-4 space-y-2">
            <div
              v-for="session in termStore.detached"
              :key="session.id"
              class="flex items-center gap-3 rounded border border-gray-800 bg-[#141417] px-3 py-2"
            >
              <span class="h-2 w-2 shrink-0 rounded-full bg-blue-400" />
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium text-white">{{ session.hostName }}</div>
                <div class="truncate text-[11px] text-gray-500">
                  {{ session.hostIp ?? $t('terminal.popout.noEndpoint') }}<span v-if="session.hostPort">:{{ session.hostPort }}</span>
                </div>
              </div>
              <span class="shrink-0 rounded bg-blue-500/15 px-2 py-1 text-[11px] font-medium text-blue-200">
                {{ $t('terminal.popout.detachedBadge') }}
              </span>
            </div>
          </div>

          <div class="mt-4 flex justify-end">
            <NButton type="primary" @click="openPicker">{{ $t('terminal.connectHost') }}</NButton>
          </div>
        </div>
      </div>

    </div><!-- end split-area -->

    </div><!-- end flex terminals+sidebar -->

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
        :input-props="{
          role: 'combobox',
          'aria-expanded': showPicker ? 'true' : 'false',
          'aria-controls': pickerListboxId,
          'aria-activedescendant': activePickerOptionId,
          autocomplete: 'off',
        }"
        clearable
        class="mb-4"
        @keydown="onHostPickerKey"
      />
      <div class="mb-3 text-xs text-gray-400">
        {{ $t('terminal.hostSwitcherHint') }}
        <span class="ml-1 font-mono">{{ shortcuts.hostSwitcher }}</span>
      </div>
      <NAlert v-if="pickerLoadError" type="error" class="mb-3" :bordered="false">
        {{ pickerLoadError }}
      </NAlert>
      <NSpin :show="pickerLoading">
        <NEmpty v-if="!pickerLoading && !filteredHosts.length" :description="$t('terminal.hostSwitcherEmpty')" />
        <div
          v-else
          :id="pickerListboxId"
          role="listbox"
          class="max-h-[420px] overflow-y-auto rounded border border-gray-800 bg-[#111113] p-1"
        >
          <button
            v-for="(host, index) in filteredHosts"
            :key="host.id"
            :id="`terminal-host-switcher-option-${host.id}`"
            :ref="(el) => setPickerOptionRef(el, index)"
            type="button"
            role="option"
            :aria-selected="index === pickerSelectedIndex"
            :aria-disabled="!canOpenHostInConsole(host)"
            :title="!canOpenHostInConsole(host) ? $t('terminal.hostSwitcherProtocolPending', { protocol: hostProtocolLabel(host) }) : undefined"
            class="w-full rounded px-3 py-2 text-left transition-colors focus:outline-none"
            :class="[
              index === pickerSelectedIndex ? 'bg-blue-600/20 ring-1 ring-blue-500/70' : 'hover:bg-white/5',
              !canOpenHostInConsole(host) ? 'cursor-not-allowed opacity-60' : '',
            ]"
            @mouseenter="pickerSelectedIndex = index"
            @click="pickHost(host)"
          >
            <div class="flex min-w-0 items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <span class="truncate text-sm font-medium text-gray-100">{{ host.name }}</span>
                  <NTag size="small" round :type="hostConnectionModeTagType(host)">
                    {{ hostConnectionModeLabel(host) }}
                  </NTag>
                  <NTag
                    size="small"
                    round
                    :type="isTerminalProtocolSupported(host) ? (host.accessProtocol === 'telnet' ? 'warning' : 'success') : isGraphicalProtocolSupported(host) ? 'info' : 'default'"
                  >
                    {{ hostProtocolLabel(host) }}
                  </NTag>
                  <NTag v-if="!canOpenHostInConsole(host)" size="small" round type="default">
                    {{ $t('terminal.hostSwitcherProtocolPending', { protocol: hostProtocolLabel(host) }) }}
                  </NTag>
                  <NTag
                    v-if="host.effectiveBastionName"
                    size="small"
                    round
                    type="warning"
                    :title="host.effectiveBastionSource === 'group' ? $t('hosts.bastion.inherited') : $t('hosts.bastion.direct')"
                  >
                    {{ $t('hosts.bastion.badge', { name: host.effectiveBastionName }) }}
                  </NTag>
                  <NTag v-if="favoriteHostIds.includes(host.id)" size="small" type="warning" round>
                    {{ $t('terminal.hostSwitcherFavorite') }}
                  </NTag>
                  <NTag v-else-if="recentHostIds.includes(host.id)" size="small" type="info" round>
                    {{ $t('terminal.hostSwitcherRecent') }}
                  </NTag>
                </div>
                <div class="mt-0.5 truncate font-mono text-xs text-gray-400">{{ host.ip }}:{{ host.port }}</div>
                <div v-if="host.accessProtocol === 'telnet'" class="mt-1 text-xs text-yellow-300">
                  {{ $t('terminal.telnetSecurityWarning') }}
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <NTag :type="host.scope === 'personal' ? 'info' : host.scope === 'team' ? 'success' : 'warning'" size="small">
                  {{ host.scope }}
                </NTag>
                <NTag v-if="host.accessProtocol === 'ssh'" size="small">{{ host.authType === 'pem' ? '🔑 PEM' : host.authType === 'pem_password' ? '🔑+🔒 PEM + Senha' : '🔒 Senha' }}</NTag>
              </div>
            </div>
          </button>
        </div>
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
          :input-props="{
            role: 'combobox',
            'aria-expanded': showSnippetQuickPicker ? 'true' : 'false',
            'aria-controls': snippetQuickListboxId,
            'aria-activedescendant': activeSnippetQuickOptionId,
            autocomplete: 'off',
          }"
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
          :id="snippetQuickListboxId"
          role="listbox"
          class="max-h-[420px] overflow-y-auto divide-y divide-gray-800 rounded border border-gray-800"
        >
          <button
            v-for="(snippet, index) in filteredSnippetQuickItems"
            :key="snippet.id"
            :id="`terminal-snippet-quick-picker-option-${snippet.id}`"
            :ref="(el) => setSnippetQuickOptionRef(el, index)"
            type="button"
            role="option"
            :aria-selected="index === snippetQuickSelectedIndex"
            class="w-full px-4 py-3 text-left transition-colors focus:outline-none"
            :class="index === snippetQuickSelectedIndex ? 'bg-blue-600/20 ring-1 ring-blue-500/70' : 'hover:bg-[#1e1e22]'"
            @mouseenter="snippetQuickSelectedIndex = index"
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
      v-model:show="showTerminalAiModal"
      preset="card"
      :title="$t('terminal.ai.modalTitle')"
      style="width:min(840px, 94vw)"
    >
      <div class="space-y-4">
        <NAlert type="info" :show-icon="false">
          {{ $t('terminal.ai.modalInfo') }}
        </NAlert>

        <NCard size="small" :bordered="false" style="background:#17171b;">
          <div class="grid gap-3 md:grid-cols-3 text-xs">
            <div>
              <div class="text-gray-500 mb-1">{{ $t('terminal.ai.activeHost') }}</div>
              <div class="text-gray-200 break-all">{{ activeTerminalTab?.hostName ?? '—' }}</div>
            </div>
            <div>
              <div class="text-gray-500 mb-1">{{ $t('terminal.ai.activeSession') }}</div>
              <div class="text-gray-200">{{ activeSessionId ?? '—' }}</div>
            </div>
            <div>
              <div class="text-gray-500 mb-1">{{ $t('terminal.ai.selectionState') }}</div>
              <div class="text-gray-200">
                {{ getActiveTerminalContext()?.selection ? $t('terminal.ai.selectionAvailable') : $t('terminal.ai.selectionEmpty') }}
              </div>
            </div>
          </div>
        </NCard>

        <div class="flex flex-wrap gap-2">
          <NButton size="small" tertiary @click="applyTerminalAiSuggestion('selection')">
            {{ $t('terminal.ai.suggestionSelection') }}
          </NButton>
          <NButton size="small" tertiary @click="applyTerminalAiSuggestion('buffer')">
            {{ $t('terminal.ai.suggestionBuffer') }}
          </NButton>
          <NButton size="small" tertiary @click="applyTerminalAiSuggestion('error')">
            {{ $t('terminal.ai.suggestionError') }}
          </NButton>
        </div>

        <NInput
          v-model:value="terminalAiPrompt"
          type="textarea"
          :rows="4"
          :placeholder="$t('terminal.ai.placeholder')"
          @keydown.ctrl.enter.prevent="submitTerminalAiPrompt"
        />

        <div class="flex justify-end">
          <NButton
            type="primary"
            :disabled="!localAiLicensed || terminalAiLoading || !canAnalyzeActiveTerminal"
            :loading="terminalAiLoading"
            @click="submitTerminalAiPrompt"
          >
            {{ $t('terminal.ai.send') }}
          </NButton>
        </div>

        <div class="max-h-[360px] overflow-y-auto space-y-3">
          <NEmpty v-if="terminalAiHistory.length === 0" :description="$t('terminal.ai.empty')" />
          <NCard
            v-for="(item, index) in terminalAiHistory"
            :key="`${item.role}-${index}`"
            size="small"
            :bordered="false"
            style="background:#17171b;"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="text-xs uppercase tracking-[0.16em] text-gray-500">
                {{ item.role === 'assistant' ? $t('terminal.ai.roleAssistant') : $t('terminal.ai.roleUser') }}
              </div>
              <div v-if="item.provider" class="text-xs text-gray-500">
                {{ item.provider }}
              </div>
            </div>
            <div class="mt-2 whitespace-pre-wrap break-words text-sm text-gray-200">{{ item.text }}</div>
            <div v-if="item.citations?.length" class="mt-3 space-y-1">
              <div
                v-for="(citation, citationIndex) in item.citations"
                :key="`${index}-${citationIndex}`"
                class="text-xs text-gray-500"
              >
                {{ citation.label }}
              </div>
            </div>
          </NCard>
        </div>
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
              <NTag v-if="currentSharedSession.hostDeleted" size="small" type="warning">
                {{ $t('hosts.messages.hostDeleted') }}
              </NTag>
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
            ? $t('terminal.hostKey.descriptionChanged', { host: hostKeyConnectionLabel })
            : $t('terminal.hostKey.descriptionUnknown', { host: hostKeyConnectionLabel }) }}
        </NAlert>

        <NAlert v-if="!hostKeyPolicyLoading && !hostKeyModal.canTrust" type="error" :show-icon="true">
          {{ hostKeyPermissionMessage(hostKeyModal.hostScope) }}
        </NAlert>

        <NCard size="small" :bordered="false" style="background:#17171b;">
          <div class="text-xs text-gray-400 mb-1">{{ $t('terminal.hostKey.host') }}</div>
          <div class="text-sm text-white font-medium break-all">{{ hostKeyModal.hostName }}</div>
          <div v-if="hostKeyModal.hostIp" class="mt-1 text-xs text-gray-400 font-mono break-all">
            {{ hostKeyModal.hostIp }}:{{ hostKeyModal.hostPort ?? 22 }}
          </div>
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
          <div class="mb-1 flex items-center gap-2">
            <div class="text-xs text-gray-400">{{ $t('terminal.hostKey.presentedFingerprint') }}</div>
            <NTooltip trigger="hover">
              <template #trigger>
                <button type="button" class="text-xs text-gray-500 hover:text-gray-300">?</button>
              </template>
              {{ $t('terminal.hostKey.help') }}
            </NTooltip>
          </div>
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

    <!-- ── Modal: credenciais interativas ───────────────────────────────── -->
    <NModal
      :show="!!credentialsModal"
      preset="card"
      :title="$t('terminal.credentialsChallenge.title')"
      style="width:420px"
      :mask-closable="false"
      @update:show="(v) => { if (!v) cancelCredentialsChallenge() }"
    >
      <div v-if="credentialsModal" class="space-y-4">
        <NAlert type="info" :show-icon="true">
          {{ $t('terminal.credentialsChallenge.description', { host: credentialsModal.challenge.hostName }) }}
        </NAlert>
        <NInput
          v-if="credentialsModal.challenge.needsUsername"
          id="cred-username-input"
          v-model:value="credUsernameInput"
          :placeholder="$t('terminal.credentialsChallenge.usernamePlaceholder')"
          :input-props="{ autocomplete: 'off' }"
          @keydown.enter="credentialsModal.challenge.needsPassword ? undefined : submitCredentialsChallenge()"
        />
        <NInput
          v-if="credentialsModal.challenge.needsPassword"
          id="cred-password-input"
          v-model:value="credPasswordInput"
          type="password"
          show-password-on="click"
          :placeholder="$t('terminal.credentialsChallenge.passwordPlaceholder')"
          :input-props="{ autocomplete: 'new-password' }"
          @keydown.enter="submitCredentialsChallenge"
        />
        <div class="flex justify-end gap-2">
          <NButton @click="cancelCredentialsChallenge">{{ $t('common.cancel') }}</NButton>
          <NButton
            type="primary"
            :disabled="(credentialsModal.challenge.needsUsername && !credUsernameInput) || (credentialsModal.challenge.needsPassword && !credPasswordInput)"
            @click="submitCredentialsChallenge"
          >
            {{ $t('terminal.credentialsChallenge.connect') }}
          </NButton>
        </div>
      </div>
    </NModal>

    <!-- ── Modal: oferta de salvar senha ────────────────────────────────── -->
    <NModal
      :show="!!savePasswordOfferModal"
      preset="card"
      :title="$t('terminal.savePassword.title')"
      style="width:460px"
      @update:show="(v) => { if (!v) dismissSavePassword() }"
    >
      <div v-if="savePasswordOfferModal" class="space-y-4">
        <NAlert type="success" :show-icon="true">
          {{ $t('terminal.savePassword.description', { host: savePasswordOfferModal.offer.hostName }) }}
        </NAlert>
        <NCard size="small" :bordered="false" style="background:#17171b;">
          <div class="text-xs text-gray-400 mb-1">{{ $t('terminal.savePassword.secretName') }}</div>
          <div class="text-sm text-white font-mono">{{ savePasswordOfferModal.offer.secretName }}</div>
        </NCard>
        <div>
          <div class="text-xs text-gray-400 mb-1">{{ $t('terminal.savePassword.scope') }}</div>
          <NSelect
            v-model:value="selectedSaveScope"
            :options="[
              { label: $t('snippets.scopePersonal'), value: 'PERSONAL' },
              { label: $t('snippets.scopeTeam'), value: 'TEAM' },
            ]"
            size="small"
          />
        </div>
        <div class="flex justify-end gap-2">
          <NButton :disabled="savingPassword" @click="dismissSavePassword">
            {{ $t('terminal.savePassword.skip') }}
          </NButton>
          <NButton type="primary" :loading="savingPassword" @click="acceptSavePassword">
            {{ $t('terminal.savePassword.save') }}
          </NButton>
        </div>
      </div>
    </NModal>

    <!-- Modal: configurar chave PEM -->
    <NModal
      :show="!!pemFixModal"
      preset="card"
      :title="pemFixModal ? $t('terminal.pemFix.title', { host: pemFixModal.hostName }) : ''"
      style="width: 520px"
      @update:show="(v) => { if (!v) pemFixModal = null }"
    >
      <div v-if="pemFixModal" class="space-y-4">
        <template v-if="!canManageHosts">
          <NAlert type="warning" :title="$t('terminal.pemFix.noPermissionTitle')">
            {{ $t('terminal.pemFix.noPermission') }}
          </NAlert>
          <div class="flex justify-end">
            <NButton @click="pemFixModal = null">{{ $t('common.close') }}</NButton>
          </div>
        </template>

        <template v-else>
          <p class="text-sm text-gray-400">{{ $t('terminal.pemFix.description') }}</p>

          <div class="flex gap-2">
            <NButton
              :type="pemFixMode === 'select' ? 'primary' : 'default'"
              size="small"
              :disabled="pemKeys.length === 0"
              @click="pemFixMode = 'select'"
            >
              {{ $t('terminal.pemFix.modeSelect') }}
            </NButton>
            <NButton
              :type="pemFixMode === 'new' ? 'primary' : 'default'"
              size="small"
              @click="pemFixMode = 'new'"
            >
              {{ $t('terminal.pemFix.modeNew') }}
            </NButton>
          </div>

          <NSpin :show="pemKeysLoading">
            <div v-if="pemFixMode === 'select'" class="space-y-2">
              <NSelect
                v-model:value="pemFixKeyId"
                :options="pemKeyOptions"
                :placeholder="$t('terminal.pemFix.selectPlaceholder')"
                clearable
              />
            </div>

            <div v-else class="space-y-3">
              <NInput
                v-model:value="pemFixNewName"
                :placeholder="$t('terminal.pemFix.newNamePlaceholder')"
                clearable
              />
              <NInput
                v-model:value="pemFixNewKey"
                type="textarea"
                :placeholder="$t('terminal.pemFix.newKeyPlaceholder')"
                :autosize="{ minRows: 5, maxRows: 10 }"
                style="font-family: monospace; font-size: 12px;"
              />
              <div class="flex items-center gap-2">
                <NButton size="small" @click="pemFixFileInput?.click()">
                  {{ $t('terminal.pemFix.uploadFile') }}
                </NButton>
                <span class="text-xs text-gray-500">{{ $t('terminal.pemFix.uploadHint') }}</span>
                <input
                  ref="pemFixFileInput"
                  type="file"
                  accept=".pem,.key,.ppk,.txt"
                  class="hidden"
                  @change="onPemFixFileSelected"
                />
              </div>
            </div>
          </NSpin>

          <div class="flex justify-end gap-2 pt-1">
            <NButton @click="pemFixModal = null">{{ $t('common.cancel') }}</NButton>
            <NButton type="primary" :loading="pemFixLoading" @click="submitPemFix">
              {{ $t('terminal.pemFix.saveAndReconnect') }}
            </NButton>
          </div>
        </template>
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
