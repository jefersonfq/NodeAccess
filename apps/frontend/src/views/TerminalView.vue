<script setup lang="ts">
import { selectTerminalAiContext, type TerminalAiContextMode } from '@/services/terminal-ai-context'
import { terminalAiFailure, canRetryTerminalAi, type TerminalAiFailure } from '@/services/terminal-ai-errors'
import ManualLink from '@/components/manual/ManualLink.vue'
import { useSnippetLibrary } from '@/composables/useSnippetLibrary'
import { MacroRunner, type MacroProgress } from '@/services/macro-runner'
import { createMacroMatcher } from '@/services/macro-regex.service'
import { executionActions } from '@/services/snippet.service'
import type { MacroStep } from '@nodeaccess/shared'
import { useManualStore } from '@/stores/manual'
const manual = useManualStore()

import { deviceCapabilities } from '@nodeaccess/shared'
import NTooltip from '@/components/ActionTooltip'
defineOptions({ name: 'TerminalView' })

import { useTunnelPresence, uniqueTunnels } from '@/composables/useTunnelPresence'
import { h, ref, computed, watch, onMounted, onBeforeUnmount, onUnmounted, onActivated, onDeactivated, nextTick } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NButton, NTag, NDropdown, NAlert, useMessage, useDialog,
  NModal, NInput, NInputNumber, NCard, NSpin, NEmpty, NSelect, NPopover, NForm, NFormItem,
} from 'naive-ui'
import type { DropdownOption } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import TerminalCommandSuggestion from '@/components/TerminalCommandSuggestion.vue'
import { canInsertTerminalAiCommand } from '@/services/terminal-ai-command.service'
import TerminalPane    from '@/components/TerminalPane.vue'
import TerminalRailIcon from '@/components/TerminalRailIcon.vue'
import type { TerminalPaneHandle } from '@/components/terminal-pane-handle'
import TerminalFilesPanel from '@/components/TerminalFilesPanel.vue'
import SnippetsPanel   from '@/components/SnippetsPanel.vue'
import TunnelManager   from '@/components/TunnelManager.vue'
import TerminalSessionsNavigator from '@/components/TerminalSessionsNavigator.vue'
import GraphicalSessionView from '@/views/GraphicalSessionView.vue'
import { useTerminalStore } from '@/stores/terminals'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import { broadcastEnabled } from '@/composables/useTerminalBroadcast'
import type { HostKeyVerificationChallenge, CredentialsChallenge, SavePasswordOffer, TunnelState } from '@/composables/useTerminal'
import { applyTerminalPreset, deferTerminalLayoutResize, termSettings, setShowTerminalToolbar, hintForErrorCode } from '@/composables/useTerminal'
import { pemKeyService } from '@/services/pem-key.service'
import { isEncryptedPrivateKey } from '@/services/pem-key-encryption'
import type { PemKeyPublic, SecretPublic } from '@nodeaccess/shared'
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
import { hostService, type HostSidebarSummary } from '@/services/host.service'
import { inventoryService } from '@/services/inventory.service'
import type { FolderPublic } from '@/services/folder.service'
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
import { canOpenInWebTerminal, getHostAccessProtocolCapabilities, resolveHostLinkTemplate, type AiScriptArtifactDetail, type HostAssociatedLink, type HostPublic, type InventoryNodePublic, type LocalAiChatResponse, type LocalAiTerminalAssist, type SharedSessionPublic } from '@nodeaccess/shared'
import { favoriteHostIds, markHostAsRecent, recentHostIds } from '@/services/host-quick-access.service'
import { isTerminalAiShortcut } from '@/services/terminal-ai-shortcut.service'
import {
  assignSplitPaneSlot,
  clampSplitRatio,
  compactSplitPaneSlots,
  createSplitPaneSlots,
  moveSplitPane,
  reconcileSplitPaneSlots,
  sanitizeTerminalSplitGroups,
  splitGridLayout,
  splitRatioFromPointer,
  shiftSplitPane,
  terminalTabDisplayName,
  type SplitPaneSlot,
  type SplitResizeAxis,
  type TerminalSplitGroup,
} from '@/services/terminal-split-layout.service'

const { t } = useI18n()
const route = useRoute()
const router    = useRouter()
const auth = useAuthStore()
const termStore = useTerminalStore()
const ui = useUiStore()
const message = useMessage()
const dialog = useDialog()
const isTerminalActive = ref(true)
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1440)
const terminalViewportEl = ref<HTMLElement | null>(null)
const isBrowserFullscreen = ref(false)
const autoFullscreenAttempted = ref(false)
const showTabSearch = ref(false)
const tabSearchQuery = ref('')
const isTerminalFocusMode = computed(() => ui.terminalDisplayMode === 'focus')
const isTerminalSessionsMode = computed(() => ui.terminalDisplayMode === 'sessions')
function displayModeOption(key: 'standard' | 'workspace' | 'sessions' | 'focus'): DropdownOption {
  return {
    key: `display-${key}`,
    label: `${t(`terminal.displayMode.${key}`)} — ${t(`terminal.displayMode.${key}Short`)}`,
  }
}
const terminalDisplayModeOptions = computed<DropdownOption[]>(() => [
  displayModeOption('standard'),
  displayModeOption('workspace'),
  displayModeOption('sessions'),
  displayModeOption('focus'),
  { type: 'divider', key: 'display-divider' },
  { key: 'browser-fullscreen', label: isBrowserFullscreen.value ? t('terminal.exitFullscreen') : t('terminal.enterFullscreen') },
])

async function setTerminalDisplayMode(mode: 'standard' | 'workspace' | 'sessions' | 'focus'): Promise<void> {
  const transitionDuration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220
  deferTerminalLayoutResize(transitionDuration)
  ui.setTerminalDisplayMode(mode)
  if (mode === 'sessions') void loadSessionsNavigator()
  await nextTick()
  window.setTimeout(() => {
    if (!termStore.activeId) return
    paneRefs[termStore.activeId]?.fit?.()
    paneRefs[termStore.activeId]?.focus?.()
  }, transitionDuration)
}

function onTerminalDisplayModeSelect(key: string): void {
  if (key === 'browser-fullscreen') {
    void toggleBrowserFullscreen()
    return
  }
  const mode = key.replace('display-', '')
  if (mode === 'standard' || mode === 'workspace' || mode === 'sessions' || mode === 'focus') {
    void setTerminalDisplayMode(mode)
  }
}

// ── Platform detection ────────────────────────────────────────────────────

const { platform, isMac, shortcuts, isSnippetShortcutEvent, isHostSwitcherShortcutEvent } = usePlatform()

const TERMINAL_ONBOARDING_KEY = 'na_terminal_onboarding_dismissed'
const showPlatformOnboarding = ref(localStorage.getItem(TERMINAL_ONBOARDING_KEY) !== '1')
const showDiagnostics = ref(false)
const activeHostDetails = ref<HostPublic | null>(null)
const activeHostDetailsLoading = ref(false)
const trialResources = ref<string[] | null>(null)
const activeSupportsSftp = computed(() => (trialResources.value === null || trialResources.value.includes('sftp')) && !activeHostDetailsLoading.value && deviceCapabilities(activeHostDetails.value?.deviceProfile).sftp)
const editHostModal = ref(false)
const editHostLoading = ref(false)
const editHostForm = ref({ name: '', ip: '', port: 22, sshUser: '' })



// Features
const multiConnect = ref(false)
const feedbackLicensed = ref(false)
const localAiLicensed = ref(false)
const terminalAutocompleteLicensed = ref(false)
const terminalAiLicensed = ref(false)
const terminalAiOperational = ref(false)
const terminalAiAvailable = computed(() => terminalAiLicensed.value && terminalAiOperational.value && termSettings.aiAssistantEnabled)
const jitAccessEnabled = ref(false)
const terminalCapabilitiesLoaded = ref(false)
let terminalCapabilitiesPromise: Promise<void> | null = null
const OPEN_FEEDBACK_MODAL_EVENT = 'nodeaccess:open-feedback-modal'
const FEATURES_UPDATED_EVENT = 'nodeaccess:features-updated'

async function loadTerminalFeatures(): Promise<void> {
  try {
    const f = await featuresService.get()
    trialResources.value = f.trial?.resources ?? null
    multiConnect.value = f.multiConnect
    feedbackLicensed.value = !f.trial && f.feedbackLicensed
    localAiLicensed.value = !f.trial && f.localAiLicensed
    terminalAutocompleteLicensed.value = !f.trial && f.terminalAutocompleteLicensed
    terminalAiLicensed.value = !f.trial && f.terminalAiLicensed
    terminalAiOperational.value = !f.trial && f.terminalAiLicensed
      ? await localAiService.status().then(({ data }) => data.available === true).catch(() => false)
      : false
  } catch {
    multiConnect.value = false
    terminalAiOperational.value = false
  }
}

async function loadTerminalLinkOptions(): Promise<void> {
  try {
    if ((await featuresService.get()).trial) { jitAccessEnabled.value = false; return }
    const { data } = await hostLinkService.options()
    jitAccessEnabled.value = data.jitAccess.enabled
  } catch {
    jitAccessEnabled.value = false
  }
}

async function loadTerminalCapabilities(): Promise<void> {
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

function ensureTerminalCapabilitiesLoaded(): Promise<void> {
  if (terminalCapabilitiesLoaded.value) return Promise.resolve()
  return terminalCapabilitiesPromise ?? loadTerminalCapabilities()
}

onMounted(async () => {
  void ensureTerminalCapabilitiesLoaded()

  const pendingHost = consumePendingTerminalHost()
  if (pendingHost) {
    if (getHostAccessProtocolCapabilities(pendingHost.accessProtocol).graphicalGatewayPlanned && termSettings.graphicalOpenMode === 'dedicated') {
      markHostAsRecent(pendingHost.id)
      void router.replace({ name: 'graphical-session', params: { hostId: pendingHost.id } }).catch(reportTerminalUiError)
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
        deviceProfile: pendingHost.deviceProfile,
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
        deviceProfile: pendingHost.deviceProfile,
        })
        return
      }
      message.warning(t('terminal.noMultiConnect'))
    }
  }
})

function openFeedbackFromTerminal(): void {
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
const tabSharedSessionUrls = ref<Record<string, string>>({})
const tabSharedSessionExpiresAt = ref<Record<string, number>>({})
const showSharedSessionManager = ref(false)
const sharedSessionManagerLoading = ref(false)
const sharedSessionManagerError = ref(false)
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
const credentialSource = ref<'password' | 'secret'>('password')
const credentialSecretId = ref<number | null>(null)
const credentialSecrets = ref<SecretPublic[]>([])
const credentialSecretsLoading = ref(false)
const credentialSecretsError = ref(false)
const credentialSecretOptions = computed(() => credentialSecrets.value.map((secret) => ({ label: secret.alias, value: secret.id })))

async function loadCredentialSecrets(): Promise<void> {
  if (credentialSecretsLoading.value || credentialSecrets.value.length) return
  credentialSecretsLoading.value = true
  credentialSecretsError.value = false
  try {
    const { data } = await secretService.list()
    credentialSecrets.value = data.filter((secret) => !secret.revokedAt)
  } catch {
    credentialSecretsError.value = true
  } finally {
    credentialSecretsLoading.value = false
  }
}

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

function onConnected(tabId: string, hostName: string): void {
  termStore.setName(tabId, hostName)
  termStore.setConnectedAt(tabId)
  void prepareStartupSnippet(tabId)
}
function onStatusChange(tabId: string, status: string): void {
  if (status !== 'connected') macroRunners.get(tabId)?.cancel()
  tabStatus.value = { ...tabStatus.value, [tabId]: status }
  if (status === 'closed' || status === 'error' || status === 'idle') {
    delete tabSharedSessionIds.value[tabId]
    delete tabSharedSessionUrls.value[tabId]
    delete tabSharedSessionExpiresAt.value[tabId]
  }
}
function onPaneStatusChange(tabId: string, status: string): void {
  onStatusChange(tabId, status)
  splitPaneStatus.value = { ...splitPaneStatus.value, [tabId]: status }
}
function onErrorChange(tabId: string, value: string | null): void {
  tabErrors.value = { ...tabErrors.value, [tabId]: value }
}
function onErrorCodeChange(tabId: string, code: string | null): void {
  tabErrorCodes.value = { ...tabErrorCodes.value, [tabId]: code }
  if (code === 'SESSION_ADMIN_CLOSED') {
    if (adminClosedTimers[tabId]) window.clearTimeout(adminClosedTimers[tabId])
    adminClosedTimers[tabId] = window.setTimeout(() => {
      if (termStore.tabs.some((tab) => tab.id === tabId)) closeTab(tabId)
    }, 6_000)
  }
}
function onLatencyChange(tabId: string, ms: number): void {
  tabLatency.value = { ...tabLatency.value, [tabId]: ms }
}
const tunnelPresence = useTunnelPresence()
function onTunnelsChange(tabId: string, state: TunnelState): void {
  const hostId = termStore.tabs.find(tab => tab.id === tabId)?.hostId
  tabTunnels.value = { ...tabTunnels.value, [tabId]: {
    ...state, tunnels: uniqueTunnels(tunnelPresence.tunnels.value ?? state.tunnels, hostId),
  } }
  void tunnelPresence.refresh()
}
watch(tunnelPresence.tunnels, rows => {
  if (!rows) return
  const next = { ...tabTunnels.value }
  for (const tab of termStore.tabs) {
    next[tab.id] = { tunnels: uniqueTunnels([...rows], tab.hostId), errors: next[tab.id]?.errors ?? [] }
  }
  tabTunnels.value = next
})
function onPanelTunnelsChange(state: TunnelState): void {
  const activeId = termStore.activeId
  if (!activeId) return
  const hostId = termStore.tabs.find(tab => tab.id === activeId)?.hostId
  const next = { ...tabTunnels.value }
  for (const tab of termStore.tabs.filter(tab => tab.hostId === hostId)) {
    next[tab.id] = { ...state, tunnels: uniqueTunnels(state.tunnels, hostId) }
  }
  tabTunnels.value = next
}
function onSessionChange(tabId: string, sessionId: number | null): void {
  tabSessionIds.value = { ...tabSessionIds.value, [tabId]: sessionId }
  termStore.setSessionId(tabId, sessionId)
}

function isAdminClosedTab(tabId: string): boolean {
  return tabErrorCodes.value[tabId] === 'SESSION_ADMIN_CLOSED'
}
function onConnectionRouteChange(tabId: string, method: string | null, agentName: string | null): void {
  const normalizedMethod = method?.startsWith('telnet_')
    ? method.replace('telnet_', '')
    : method
  tabConnectionRoute.value = { ...tabConnectionRoute.value, [tabId]: { method: normalizedMethod, agentName } }
}

function canCurrentUserTrustHostKey(scope: HostPublic['scope'] | null): boolean {
  if (auth.isAdmin) return true
  if (scope === 'personal') return true
  if (scope === 'team') return !!auth.user?.canManageHosts
  if (scope === 'global') return false
  return false
}

function hostKeyPermissionMessage(scope: HostPublic['scope'] | null): string {
  if (scope === 'team') return t('terminal.hostKey.permissionTeam')
  if (scope === 'global') return t('terminal.hostKey.permissionGlobal')
  return t('terminal.hostKey.permissionUnknown')
}

function onCredentialsRequired(tabId: string, challenge: CredentialsChallenge): void {
  // Se já temos credenciais de uma tentativa anterior (ex: reconnect após host key),
  // responde automaticamente sem abrir o modal de novo.
  const existing = pendingAdHocCredentials.value
  if (existing?.tabId === tabId && (!challenge.needsUsername || existing.username) && (!challenge.needsPassword || existing.password)) {
    paneRefs[tabId]?.sendCredentialsResponse?.(existing.username ?? '', existing.password ?? '')
    return
  }
  credUsernameInput.value = ''
  credPasswordInput.value = ''
  credentialSource.value = 'password'
  credentialSecretId.value = null
  credentialsModal.value = { tabId, challenge }
  if (challenge.needsPassword) void loadCredentialSecrets()
  void nextTick(() => {
    const el = document.getElementById(challenge.needsUsername ? 'cred-username-input' : 'cred-password-input')
    if (el) (el as HTMLInputElement).focus()
  }).catch(reportTerminalUiError)
}

function submitCredentialsChallenge(): void {
  if (!credentialsModal.value) return
  const { tabId, challenge } = credentialsModal.value
  if (challenge.needsUsername && !credUsernameInput.value) return
  if (challenge.needsPassword && credentialSource.value === 'password' && !credPasswordInput.value) return
  if (challenge.needsPassword && credentialSource.value === 'secret' && !credentialSecretId.value) return
  paneRefs[tabId]?.sendCredentialsResponse?.(
    credUsernameInput.value,
    credentialSource.value === 'password' ? credPasswordInput.value : '',
    credentialSource.value === 'secret' ? credentialSecretId.value ?? undefined : undefined,
  )
  pendingAdHocCredentials.value = credentialSource.value === 'password'
    ? { tabId, username: credUsernameInput.value, password: credPasswordInput.value }
    : null
  credUsernameInput.value = ''
  credPasswordInput.value = ''
  credentialsModal.value = null
}

function cancelCredentialsChallenge(): void {
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
const pemFixNewPassphrase = ref('')
const pemFixKeyNeedsPassphrase = computed(() => isEncryptedPrivateKey(pemFixNewKey.value))
const pemFixFileInput = ref<HTMLInputElement | null>(null)

const canManageHosts = computed(() => auth.isAdmin || !!auth.user?.canManageHosts)

const pemKeyOptions = computed(() =>
  pemKeys.value.map((k) => ({ label: k.name, value: k.id })),
)

function openPemFixModal(tabId: string): void {
  const tab = termStore.tabs.find((t) => t.id === tabId)
  if (!tab) return
  pemFixModal.value = { tabId, hostId: tab.hostId, hostName: tab.hostName }
  pemFixMode.value  = 'select'
  pemFixKeyId.value = null
  pemFixNewName.value = ''
  pemFixNewKey.value  = ''
  pemFixNewPassphrase.value = ''
  void loadPemKeys()
}

async function loadPemKeys(): Promise<void> {
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

async function onPemFixFileSelected(event: Event): Promise<void> {
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

async function submitPemFix(): Promise<void> {
  if (!pemFixModal.value) return
  pemFixLoading.value = true
  try {
    let pemKeyId: number
    if (pemFixMode.value === 'new') {
      if (!pemFixNewName.value.trim() || !pemFixNewKey.value.trim()) {
        message.warning(t('terminal.pemFix.fillRequired'))
        return
      }
      if (pemFixKeyNeedsPassphrase.value && !pemFixNewPassphrase.value) {
        message.warning(t('pemKeys.messages.passphraseRequired'))
        return
      }
      const { data } = await pemKeyService.create({
        name: pemFixNewName.value.trim(),
        key: pemFixNewKey.value.trim(),
        passphrase: pemFixNewPassphrase.value || undefined,
      })
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

function onSavePasswordOffer(tabId: string, offer: SavePasswordOffer): void {
  const creds = pendingAdHocCredentials.value
  if (creds?.tabId !== tabId) return
  savePasswordOfferModal.value = { tabId, offer, username: creds.username ?? offer.savedUsername ?? '', password: creds.password ?? '' }
  selectedSaveScope.value = offer.scope === 'TEAM' ? 'TEAM' : 'PERSONAL'
  pendingAdHocCredentials.value = null
}

async function acceptSavePassword(): Promise<void> {
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
    await hostService.update(modal.offer.hostId, updatePayload)
    message.success(t('terminal.savePassword.savedSuccess'))
  } catch {
    message.error(t('terminal.savePassword.savedError'))
  } finally {
    savingPassword.value = false
    savePasswordOfferModal.value = null
    paneRefs[modal.tabId]?.dismissSavePasswordOffer?.()
  }
}

function dismissSavePassword(): void {
  if (!savePasswordOfferModal.value) return
  paneRefs[savePasswordOfferModal.value.tabId]?.dismissSavePasswordOffer?.()
  savePasswordOfferModal.value = null
  pendingAdHocCredentials.value = null
}

// Credenciais digitadas aguardando a oferta de salvar
const pendingAdHocCredentials = ref<{ tabId: string; username?: string; password?: string } | null>(null)

async function onHostKeyVerificationRequired(tabId: string, challenge: HostKeyVerificationChallenge): Promise<void> {
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

function onTerminalOutput(tabId: string, chunk = ''): void {
  processExpectSendOutput(tabId, chunk)
  if (!isTerminalActive.value || termStore.activeId !== tabId) {
    termStore.markActivity(tabId)
    return
  }
  termStore.clearUnread(tabId)
}

function closeTab(id: string): void {
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
  delete tabSharedSessionUrls.value[id]
  delete tabSharedSessionExpiresAt.value[id]
  delete activeExpectMacros.value[id]
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

function goBackFromTerminal(): void {
  void router.push(route.query.returnTo === 'dashboard' ? { name: 'dashboard' } : { name: 'hosts' }).catch(reportTerminalUiError)
}

function closeOtherTabs(id: string): void {
  const idsToClose = termStore.tabs.filter((tab) => tab.id !== id).map((tab) => tab.id)
  idsToClose.forEach((tabId) => closeTab(tabId))
}

function closeTabsToRight(id: string): void {
  const currentIndex = termStore.tabs.findIndex((tab) => tab.id === id)
  if (currentIndex === -1) return
  const idsToClose = termStore.tabs.slice(currentIndex + 1).map((tab) => tab.id)
  idsToClose.forEach((tabId) => closeTab(tabId))
}

function closeAllTabs(): void {
  const idsToClose = termStore.tabs.map((tab) => tab.id)
  idsToClose.forEach((tabId) => closeTab(tabId))
}

function duplicateTab(tabId: string): void {
  const tab = termStore.tabs.find((item) => item.id === tabId)
  if (!tab) return
  if (!canAddTab.value) {
    message.warning(t('terminal.noMultiConnect'))
    return
  }
  markHostAsRecent(tab.hostId)
  const duplicatedId = addTerminalTab({
    id: tab.hostId,
    name: tab.hostName,
    ip: tab.hostIp,
    port: tab.hostPort,
    authType: tab.hostAuthType,
    accessProtocol: tab.hostAccessProtocol,
  })
  const source = termStore.tabs.find((item) => item.id === tabId)
  if (source?.jiraSessionGrant && source.jiraInteractionId) {
    termStore.setJiraAuthorization(duplicatedId, {
      ticketKey: source.jiraTicketKey ?? null,
      interactionId: source.jiraInteractionId,
      sessionGrant: source.jiraSessionGrant,
      ticketSummary: source.jiraTicketSummary,
      ticketStatus: source.jiraTicketStatus,
      ticketUrl: source.jiraTicketUrl,
    })
  }
  autoFullscreenAttempted.value = false
  void nextTick(() => tryAutoBrowserFullscreen())
}

const tabCtxVisible = ref(false)
const tabCtxX = ref(0)
const tabCtxY = ref(0)
const tabCtxTabId = ref<string | null>(null)
const isPopoutDropActive = ref(false)
const renameTabId = ref<string | null>(null)
const renameTabValue = ref('')
const renameTabInput = ref<{ focus: () => void } | null>(null)
const renamingTab = computed(() => termStore.tabs.find((tab) => tab.id === renameTabId.value) ?? null)

function terminalTabLabel(tab: { hostName: string; customName?: string }): string {
  return terminalTabDisplayName(tab)
}

function openRenameTab(tabId: string): void {
  const tab = termStore.tabs.find((item) => item.id === tabId)
  if (!tab) return
  renameTabId.value = tabId
  renameTabValue.value = tab.customName ?? ''
  void nextTick(() => renameTabInput.value?.focus())
}

function saveRenamedTab(): void {
  if (!renameTabId.value) return
  termStore.setCustomName(renameTabId.value, renameTabValue.value)
  renameTabId.value = null
  renameTabValue.value = ''
}

function closeRenameTab(): void {
  renameTabId.value = null
  renameTabValue.value = ''
}

function tabMenuOptions(tabId: string): DropdownOption[] {
  const currentIndex = termStore.tabs.findIndex((tab) => tab.id === tabId)
  const hasTabsToRight = currentIndex >= 0 && currentIndex < termStore.tabs.length - 1
  return [
    { key: `activate:${tabId}`, label: t('terminal.tabMenu.activate') },
    { key: `rename:${tabId}`, label: t('terminal.tabMenu.rename') },
    { key: `move-left:${tabId}`, label: t('terminal.tabMenu.moveLeft'), disabled: currentIndex <= 0 },
    { key: `move-right:${tabId}`, label: t('terminal.tabMenu.moveRight'), disabled: !hasTabsToRight },
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

function openTabContextMenu(event: MouseEvent, tabId: string): void {
  event.preventDefault()
  tabCtxTabId.value = tabId
  tabCtxVisible.value = false
  setTimeout(() => {
    tabCtxX.value = event.clientX
    tabCtxY.value = event.clientY
    tabCtxVisible.value = true
  }, 0)
}

function onTabMenuSelect(key: string | number): void {
  tabCtxVisible.value = false
  const value = String(key)
  if (value === 'close-all') {
    closeAllTabs()
    return
  }
  const [action, tabId] = value.split(':')
  if (!tabId) return
  if (action === 'activate') termStore.activate(tabId)
  if (action === 'rename') openRenameTab(tabId)
  if (action === 'move-left' || action === 'move-right') {
    termStore.move(tabId, termStore.tabs.findIndex(tab => tab.id === tabId) + (action === 'move-left' ? -1 : 1))
  }
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

function openTabInPopout(tabId: string, mode: 'copy' | 'move'): void {
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

const draggedTabId = ref<string | null>(null)
const tabDropTarget = ref<{ id: string; side: 'before' | 'after'; index: number } | null>(null)
function onTabDragOver(event: DragEvent, targetId: string): void {
  const sourceIndex = termStore.tabs.findIndex(tab => tab.id === draggedTabId.value)
  const targetIndex = termStore.tabs.findIndex(tab => tab.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0) return
  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const side = event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after'
  const insertion = targetIndex + (side === 'after' ? 1 : 0)
  const index = insertion - (sourceIndex < insertion ? 1 : 0)
  tabDropTarget.value = index === sourceIndex ? null : { id: targetId, side, index }
}
function onTabDragLeave(event: DragEvent): void {
  if (event.relatedTarget instanceof Node && (event.currentTarget as HTMLElement).contains(event.relatedTarget)) return
  tabDropTarget.value = null
}
function onTabDrop(event: DragEvent, targetId: string): void {
  if (!draggedTabId.value) return
  onTabDragOver(event, targetId)
  if (tabDropTarget.value) termStore.move(draggedTabId.value, tabDropTarget.value.index)
  tabDropTarget.value = null
  draggedTabId.value = null
}

function onTabDragStart(event: DragEvent, tabId: string): void {
  tabDropTarget.value = null
  draggedTabId.value = tabId
  const host = tabToPopoutHost(tabId)
  if (!host) return
  event.dataTransfer?.setData('text/plain', host.name)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onTabDragEnd(event: DragEvent, tabId: string): void {
  tabDropTarget.value = null
  if (!draggedTabId.value) return
  draggedTabId.value = null
  const outsideViewport =
    event.clientX < 0
    || event.clientY < 0
    || event.clientX > window.innerWidth
    || event.clientY > window.innerHeight

  if (outsideViewport) openTabInPopout(tabId, 'move')
}

function canAcceptPopoutDrop(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes(TERMINAL_POPOUT_DRAG_MIME)
}

function onTerminalDragOver(event: DragEvent): void {
  if (!canAcceptPopoutDrop(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  isPopoutDropActive.value = true
}

function onTerminalDragLeave(event: DragEvent): void {
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  if (event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return
  isPopoutDropActive.value = false
}

function onTerminalDrop(event: DragEvent): void {
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
const sessionsNavigatorFolders = ref<FolderPublic[]>([])
const sessionsNavigatorInventory = ref<InventoryNodePublic[]>([])
const sessionsNavigatorSummary = ref<HostSidebarSummary | null>(null)
const sessionsNavigatorLoading = ref(false)
const sessionsNavigatorError = ref<string | null>(null)
const sessionsNavigatorRevision = ref(0)
let pickerSearchTimer: ReturnType<typeof setTimeout> | null = null
let pickerRequestSeq = 0
let lastPickedHost: { id: number; at: number } | null = null

const pickerListboxId = 'terminal-host-switcher-listbox'

async function loadSessionsNavigator(): Promise<void> {
  if (sessionsNavigatorLoading.value) return
  sessionsNavigatorLoading.value = true
  sessionsNavigatorError.value = null
  try {
    const [bootstrap, inventory] = await Promise.all([
      hostService.getSidebarBootstrap(),
      inventoryService.list(),
    ])
    sessionsNavigatorFolders.value = bootstrap.data.folders
    sessionsNavigatorInventory.value = inventory.data
    sessionsNavigatorSummary.value = bootstrap.data.summary
  } catch {
    sessionsNavigatorError.value = t('terminal.sessionsNavigator.loadError')
  } finally {
    sessionsNavigatorLoading.value = false
  }
}

async function refreshSessionsNavigator(): Promise<void> {
  hostService.clear('terminal-sessions-refresh')
  inventoryService.clear('terminal-sessions-refresh')
  sessionsNavigatorRevision.value += 1
  await loadSessionsNavigator()
}

const activePickerOptionId = computed(() => {
  const host = filteredHosts.value[pickerSelectedIndex.value]
  return host ? `terminal-host-switcher-option-${host.id}` : undefined
})

function setPickerOptionRef(el: Element | ComponentPublicInstance | null, index: number): void {
  pickerOptionRefs.value[index] = el instanceof HTMLButtonElement ? el : null
}

function scrollSelectedPickerOptionIntoView(): void {
  pickerOptionRefs.value[pickerSelectedIndex.value]?.scrollIntoView({ block: 'nearest' })
}

function hostConnectionModeLabel(host: HostPublic): string {
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

function translateOr(key: string, fallback: string): string {
  const translated = t(key)
  return translated === key ? fallback : translated
}

function protocolLabel(protocol: HostPublic['accessProtocol'] | undefined): string {
  const normalized = protocol ?? 'ssh'
  return translateOr(`hosts.protocols.${normalized}`, protocolFallbackLabels[normalized] ?? 'SSH')
}

function hostProtocolLabel(host: HostPublic): string {
  return protocolLabel(host.accessProtocol)
}

function isTerminalProtocolSupported(host: HostPublic): boolean {
  return canOpenInWebTerminal(host.accessProtocol)
}

function isGraphicalProtocolSupported(host: HostPublic): boolean {
  return getHostAccessProtocolCapabilities(host.accessProtocol).graphicalGatewayPlanned
}

function canOpenHostInConsole(host: HostPublic): boolean {
  return isTerminalProtocolSupported(host) || isGraphicalProtocolSupported(host)
}

function canConnectHost(host: HostPublic): boolean {
  return auth.isAdmin || host.accessPermissions?.connect === true
}

async function loadPickerQuickAccessHosts(): Promise<void> {
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

async function loadPickerHosts(search = pickerSearch.value): Promise<void> {
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

async function openPicker(): Promise<void> {
  showPicker.value = true
  pickerSearch.value = ''
  pickerSelectedIndex.value = 0
  if (pickerSearchTimer) clearTimeout(pickerSearchTimer)
  await loadPickerQuickAccessHosts()
  await loadPickerHosts('')
  void nextTick(() => pickerSearchEl.value?.focus()).catch(reportTerminalUiError)
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

function pickHost(host: HostPublic): void {
  if (!canConnectHost(host)) {
    message.warning(t('hosts.inventoryAcl.connectRequired'))
    return
  }
  if (!canOpenHostInConsole(host)) {
    message.info(t('hosts.protocols.connectionPending', { protocol: hostProtocolLabel(host) }))
    return
  }
  const pickedAt = Date.now()
  if (lastPickedHost?.id === host.id && pickedAt - lastPickedHost.at < 500) return
  lastPickedHost = { id: host.id, at: pickedAt }
  if (isGraphicalProtocolSupported(host) && termSettings.graphicalOpenMode === 'dedicated') {
    showPicker.value = false
    pickerSearch.value = ''
    pickerSelectedIndex.value = 0
    markHostAsRecent(host.id)
    void router.push({ name: 'graphical-session', params: { hostId: host.id } }).catch(reportTerminalUiError)
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

function onHostPickerKey(event: KeyboardEvent): void {
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
const snippetQuickError = ref(false)
const snippetQuickItems = ref<Snippet[]>([])
const snippetQuickSearchEl = ref<{ focus: () => void } | null>(null)
const snippetQuickSelectedIndex = ref(0)
const snippetQuickOptionRefs = ref<Array<HTMLButtonElement | null>>([])
let snippetQuickLoadPromise: Promise<void> | null = null
const creatingHostLink = ref(false)
const creatingSharedSession = ref(false)
type ShareResultMode = 'authenticated' | 'public_once' | 'live'
interface ShareResult {
  mode: ShareResultMode
  url: string
  expiresAt: Date
  pin?: string
}
const shareResult = ref<ShareResult | null>(null)
const shareCopyStatus = ref<'idle' | 'link' | 'pin'>('idle')

async function copyShareValue(value: string, kind: 'link' | 'pin'): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    shareCopyStatus.value = kind
    message.success(t(kind === 'pin' ? 'sharing.pinCopied' : 'sharing.linkCopied'))
  } catch {
    message.warning(t('sharing.copyError'))
  }
}

function showShareResult(result: ShareResult): void {
  shareCopyStatus.value = 'idle'
  shareResult.value = result
  void copyShareValue(result.url, 'link')
}
const terminalAiContextMode = ref<TerminalAiContextMode>('recent')
const terminalAiFailureState = ref<TerminalAiFailure | null>(null)
let terminalAiAbort: AbortController | null = null
function cancelTerminalAiRequest(): void {
  terminalAiRequestVersion++
  terminalAiAbort?.abort()
  terminalAiAbort = null
  terminalAiLoading.value = false
}
const showTerminalAiModal = ref(false)
const terminalAiPrompt = ref('')
const terminalAiPromptInput = ref<{focus: () => void} | null>(null)
const quickAiDraft = ref('')
const terminalAiLoading = ref(false)
const terminalAiIntent = ref<'explain' | 'command' | 'script'>('explain')
type TerminalAiHistoryItem = { role: 'user' | 'assistant'; text: string; provider?: LocalAiChatResponse['provider']; citations?: LocalAiChatResponse['citations']; assist?: LocalAiTerminalAssist; tabId?: string; sessionId?: number | null; artifact?: AiScriptArtifactDetail; actionRunId?: number; artifactLoading?: boolean }
const terminalAiHistory = ref<TerminalAiHistoryItem[]>([])

// Ref map to access TerminalPane instances for sendText
const paneRefs: Record<string, TerminalPaneHandle | null> = {}

type AiCommandTarget = { tabId: string; sessionId: number | null; hostId: number; hostName: string }
const quickAiTarget = ref<AiCommandTarget | null>(null)
let terminalAiRequestVersion = 0
function closeQuickAi(focus = true): void {
  const target = quickAiTarget.value
  quickAiTarget.value = null
  if (focus && target?.tabId === termStore.activeId) void nextTick(() => paneRefs[target.tabId]?.focus())
}
function insertQuickAi(assist: LocalAiTerminalAssist): void {
  const target = quickAiTarget.value
  const pane = target ? paneRefs[target.tabId] : null
  if (!target || target.tabId !== termStore.activeId || pane?.getSessionId() !== target.sessionId
    || tabStatus.value[target.tabId] !== 'connected' || !terminalAiAvailable.value
    || !canInsertTerminalAiCommand(assist) || !pane?.canInsertAiCommand()) {
    message.warning(t('terminal.ai.quick.changed'))
    closeQuickAi()
    return
  }
  // Consume the suggestion once, insert no control character; next Enter belongs to the user.
  quickAiDraft.value = ''
  quickAiTarget.value = null
  pane.sendText(assist.content)
  void nextTick(() => pane.focus())
}
function openContextFromQuick(question: string): void {
  closeQuickAi(false)
  terminalAiPrompt.value = question
  terminalAiIntent.value = 'explain'
  openTerminalAiModal()
}
watch(() => [
  termStore.activeId, tabSessionIds.value[termStore.activeId ?? ''],
  tabStatus.value[termStore.activeId ?? ''], terminalAiAvailable.value, isTerminalActive.value,
], () => {
  closeQuickAi(false)
  quickAiDraft.value = ''
  cancelTerminalAiRequest()
  terminalAiFailureState.value = null
  showTerminalAiModal.value = false
  terminalAiHistory.value = []
})
watch(showTerminalAiModal, open => {
  if (!open) cancelTerminalAiRequest()
})

watch(terminalAiPrompt, () => { if (terminalAiLoading.value) cancelTerminalAiRequest(); terminalAiFailureState.value = null }, {flush:'sync'})
watch(terminalAiContextMode, () => { if (terminalAiLoading.value) cancelTerminalAiRequest(); terminalAiFailureState.value = null })
onBeforeUnmount(cancelTerminalAiRequest)

const snippetQuickListboxId = 'terminal-snippet-quick-picker-listbox'

const activeSnippetQuickOptionId = computed(() => {
  const snippet = filteredSnippetQuickItems.value[snippetQuickSelectedIndex.value]
  return snippet ? `terminal-snippet-quick-picker-option-${snippet.id}` : undefined
})

function setSnippetQuickOptionRef(el: Element | ComponentPublicInstance | null, index: number): void {
  snippetQuickOptionRefs.value[index] = el instanceof HTMLButtonElement ? el : null
}

function scrollSelectedSnippetQuickOptionIntoView(): void {
  snippetQuickOptionRefs.value[snippetQuickSelectedIndex.value]?.scrollIntoView({ block: 'nearest' })
}
type StartupSnippetState = 'pending' | 'suggested' | 'running' | 'done' | 'skipped' | 'error'
const snippetLibrary = useSnippetLibrary()
const macroRunners = new Map<string, MacroRunner>()
const macroQueue = ref<Record<string, Array<{payload: SnippetExecution; snippetId: number}>>>({})
const activeExpectMacros = ref<Record<string, MacroProgress & { name: string; steps: MacroStep[] }>>({})
const startupSnippetStateByTabId = ref<Record<string, StartupSnippetState>>({})
const startupSnippetErrorByTabId = ref<Record<string, string | null>>({})

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

function selectSearchedTab(tabId: string): void {
  focusTab(tabId)
  showTabSearch.value = false
  tabSearchQuery.value = ''
}

function getActiveTerminalContext(): { sessionId: number | null; hostId: number; hostName: string | null; hostIp: string | null; connectionStatus: string | null; selection: string | null; recentOutput: string | null; bufferTail: string | null } | null {
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

function openTerminalAiModal(): void {
  if (!canAnalyzeActiveTerminal.value) return
  closeQuickAi(false)
  showTerminalAiModal.value = true
  void nextTick(() => terminalAiPromptInput.value?.focus())
  if (!terminalAiPrompt.value.trim()) {
    terminalAiPrompt.value = t('terminal.ai.defaultPrompt')
  }
}

function openTerminalAiFromPrefix(tabId: string, mode: 'command' | 'context' = 'command'): void {
  if (!terminalAiAvailable.value || tabId !== termStore.activeId) return
  const tab = termStore.tabs.find(item => item.id === tabId)
  const pane = paneRefs[tabId]
  if (!tab?.hostId || !pane?.canInsertAiCommand()) return
  if (mode === 'context') { openTerminalAiModal(); return }
  showTerminalAiModal.value = false
  quickAiTarget.value = { tabId, hostId: tab.hostId, hostName: tab.hostName ?? '', sessionId: pane.getSessionId() }
}


async function submitTerminalAiPrompt(): Promise<void> {
  if (terminalAiLoading.value || !terminalAiAvailable.value || (terminalAiFailureState.value && !canRetryTerminalAi(terminalAiFailureState.value))) return
  const version = ++terminalAiRequestVersion
  const tabId = termStore.activeId
  const text = terminalAiPrompt.value.trim()
  const rawContext = getActiveTerminalContext()
  const terminalContext = rawContext ? selectTerminalAiContext(rawContext, terminalAiContextMode.value) : null
  if (text.length < 3 || !terminalContext || !tabId) return

  if (terminalAiHistory.value.at(-1)?.text !== text || terminalAiHistory.value.at(-1)?.role !== 'user') terminalAiHistory.value.push({ role: 'user', text })
  terminalAiFailureState.value = null
  const controller = new AbortController()
  terminalAiAbort = controller
  const timeout = setTimeout(() => controller.abort(), 21000)
  terminalAiLoading.value = true
  try {
    if (!terminalContext.hostId) throw new Error('Host ativo indisponível')
    const { data } = await localAiService.terminalAssist({
      hostId: terminalContext.hostId,
      instruction: text,
      intent: terminalAiIntent.value,
      terminalContext,
    }, controller.signal)
    if (version !== terminalAiRequestVersion || tabId !== termStore.activeId) return
    terminalAiLoading.value = false
    if (terminalAiPrompt.value.trim() === text) terminalAiPrompt.value = ''
    terminalAiHistory.value.push({
      tabId, sessionId: terminalContext.sessionId,
      role: 'assistant',
      text: data.explanation,
      provider: data.provider,
      assist: data,
    })
  } catch (err: unknown) {
    if (version !== terminalAiRequestVersion) return
    if (!terminalAiPrompt.value) terminalAiPrompt.value = text
    terminalAiFailureState.value = controller.signal.aborted ? 'timeout' : terminalAiFailure(err)
  } finally {
    clearTimeout(timeout)
    if (version === terminalAiRequestVersion) {
      terminalAiLoading.value = false
      terminalAiAbort = null
    }
  }
}

function applyTerminalAiSuggestion(kind: 'selection' | 'buffer' | 'error'): void {
  terminalAiIntent.value = 'explain'
  if (kind === 'selection') {
    terminalAiContextMode.value = 'selection'
    terminalAiPrompt.value = t('terminal.ai.prompts.selection')
    return
  }
  if (kind === 'error') {
    terminalAiPrompt.value = t('terminal.ai.prompts.error')
    return
  }
  terminalAiContextMode.value = 'recent'
  terminalAiPrompt.value = t('terminal.ai.prompts.buffer')
}

function requestTerminalCommand(): void {
  terminalAiIntent.value = 'command'
  terminalAiPrompt.value = 'Sugira um único comando seguro para validar o problema observado, sem executá-lo.'
}

function requestTerminalScript(): void {
  terminalAiIntent.value = 'script'
  terminalAiPrompt.value = 'Crie um script de diagnóstico para revisão, sem executá-lo e sem alterar o sistema.'
}

async function copyTerminalAssistContent(content: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(content)
    message.success('Sugestão copiada para revisão.')
  } catch {
    message.error('Não foi possível copiar a sugestão.')
  }
}

function insertTerminalAssistCommand(assist: LocalAiTerminalAssist, tabId?: string, sessionId?: number | null): void {
  if (!canInsertTerminalAiCommand(assist) || !tabId) return
  dialog.warning({
    title: 'Inserir comando no terminal?',
    content: 'O comando será apenas digitado no terminal ativo. O NodeAccess não enviará Enter, mas você deve revisar a linha antes de executar.',
    positiveText: 'Inserir sem executar',
    negativeText: 'Cancelar',
    onPositiveClick: () => {
      const pane = paneRefs[tabId]
      if (termStore.activeId !== tabId || pane?.getSessionId() !== sessionId || !terminalAiAvailable.value || !pane?.canInsertAiCommand()) {
        message.warning(t('terminal.ai.quick.changed'))
        return
      }
      pane.sendText(assist.content)
      pane.focus()
      showTerminalAiModal.value = false
    },
  })
}

async function createGovernedScript(item: TerminalAiHistoryItem): Promise<void> {
  const context = getActiveTerminalContext()
  if (!item.assist || item.assist.kind !== 'script' || !item.assist.content || !context?.hostId) return
  item.artifactLoading = true
  try {
    item.artifact = (await localAiService.createScriptArtifact({
      hostId: context.hostId,
      title: item.assist.title,
      objective: item.assist.explanation,
      content: item.assist.content,
      interactionCorrelationId: item.assist.correlationId,
    })).data
    message.success(t('terminal.ai.artifactCreated'))
  } catch (error: unknown) {
    message.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('terminal.ai.artifactError'))
  } finally {
    item.artifactLoading = false
  }
}

function requestGovernedScriptExecution(item: TerminalAiHistoryItem): void {
  if (!item.artifact) return
  dialog.warning({
    title: t('terminal.ai.executionTitle'), content: t('terminal.ai.executionConfirm'),
    positiveText: t('terminal.ai.requestApproval'), negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      item.artifactLoading = true
      try {
        const run = (await localAiService.requestScriptExecution(item.artifact!.id)).data
        item.actionRunId = run.id
        item.artifact = (await localAiService.getScriptArtifact(item.artifact!.id)).data
        message.success(t('terminal.ai.executionRequested'))
      } catch (error: unknown) {
        message.error((error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('terminal.ai.artifactError'))
      } finally { item.artifactLoading = false }
    },
  })
}

function snippetPreview(snippet: Snippet): string {
  const parsed = deserializeSnippetCommand(snippet.command)
  if (parsed.kind === 'SEQUENCE') return maskSecretPlaceholders(parsed.steps.join(' · '))
  if (parsed.kind === 'EXPECT_SEND') return maskSecretPlaceholders(parsed.expectSteps.map((step) => `${step.expect} => ${step.send}`).join(' · '))
  return maskSecretPlaceholders(parsed.command)
}

function snippetSecretAliases(snippet: Snippet): string[] {
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

async function loadSnippetQuickItems(options: { fresh?: boolean } = {}): Promise<void> {
  if (snippetQuickLoadPromise) return snippetQuickLoadPromise
  snippetQuickLoading.value = true
  snippetQuickError.value = false
  snippetQuickLoadPromise = snippetService.list(options)
    .then(({ data }) => { snippetQuickItems.value = data })
    .catch(() => { snippetQuickError.value = true })
    .finally(() => {
      snippetQuickLoading.value = false
      snippetQuickLoadPromise = null
    })
  return snippetQuickLoadPromise
}

async function openSnippetQuickPicker(): Promise<void> {
  if (termStore.tabs.length === 0) return
  showSnippetQuickPicker.value = true
  snippetQuickSelectedIndex.value = 0
  await loadSnippetQuickItems({ fresh: true })
  void nextTick(() => snippetQuickSearchEl.value?.focus()).catch(reportTerminalUiError)
}

function closeSnippetQuickPicker(): void {
  showSnippetQuickPicker.value = false
  snippetQuickSearch.value = ''
  snippetQuickSelectedIndex.value = 0
}

async function sendQuickSnippet(snippet: Snippet): Promise<void> {
  closeSnippetQuickPicker()
  await sendSnippetToActiveTerminal({ ...deserializeSnippetCommand(snippet.command), name: snippet.name }, snippet.id)
  if (termStore.activeId) paneRefs[termStore.activeId]?.focus?.()
}

function onSnippetQuickSearchKey(event: KeyboardEvent): void {
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

let macroNotice: ReturnType<typeof message.success> | undefined
function notifyMacro(text: string, failed = false): void {
  macroNotice?.destroy()
  macroNotice = failed
    ? message.warning(text, { duration: 3000 })
    : message.success(text, { duration: 2200 })
}

function cancelExpectSendMacro(tabId: string, _notify = true): void {
  macroQueue.value[tabId] = []
  macroRunners.get(tabId)?.cancel()
}
function processExpectSendOutput(tabId: string, chunk = ''): void { macroRunners.get(tabId)?.push(chunk) }
function enqueueSnippetToActiveTerminal(payload: SnippetExecution, snippetId: number): void {
  const tabId = termStore.activeId
  if (!tabId || tabStatus.value[tabId] !== 'connected') { message.warning(t('snippets.macro.disconnected')); return }
  if (!macroRunners.has(tabId)) { void sendSnippetToActiveTerminal(payload, snippetId); return }
  const queue = macroQueue.value[tabId] ?? []
  if (queue.length >= 20 || payload.invalid) { message.warning(t('snippets.macro.queueLimit')); return }
  macroQueue.value[tabId] = [...queue, {payload: JSON.parse(JSON.stringify(payload)) as SnippetExecution, snippetId}]
}
async function sendSnippetToActiveTerminal(payload: SnippetExecution, snippetId?: number): Promise<void> {
  const activeId = termStore.activeId
  if (!activeId) return
  try { await sendSnippetToTerminal(activeId, payload, snippetId) }
  catch (error) { notifyMacro(error instanceof Error ? error.message : t('snippets.macro.invalidSteps'), true) }
}
async function sendSnippetToTerminal(tabId: string, payload: SnippetExecution, snippetId?: number): Promise<void> {
  if (macroRunners.has(tabId)) throw new Error(t('snippets.macro.busy'))
  const pane = paneRefs[tabId]
  if (!pane || tabStatus.value[tabId] !== 'connected') throw new Error(t('snippets.macro.disconnected'))
  const steps = executionActions(payload)
  if (payload.invalid || !steps.length) throw new Error(t('snippets.macro.invalidSteps'))
  const executionId = snippetId ? createSnippetExecutionId() : undefined
  const matcher = createMacroMatcher()
  const name = payload.name || t('snippets.macro.title')
  const runner = new MacroRunner(steps, text => {
    if (!termStore.tabs.some(tab => tab.id === tabId) || tabStatus.value[tabId] !== 'connected') throw new Error('disconnected')
    sendTextRespectingSecrets(pane, text, { snippetId, snippetName: payload.name, executionId })
  }, matcher.match, state => {
    if (termStore.tabs.some(tab => tab.id === tabId)) activeExpectMacros.value[tabId] = { ...state, name, steps }
  })
  macroRunners.set(tabId, runner)
  if (snippetId) snippetLibrary.record(snippetId)
  runner.push((pane.getBufferText?.() ?? '').split(/\r?\n/).at(-1) ?? '')
  let completed = false
  try {
    const result = await runner.run()
    completed = result.status === 'completed'
    if (completed && !(macroQueue.value[tabId]?.length)) notifyMacro(name + ': ' + t('snippets.macro.completed'))
    if (snippetId && executionId) {
      const reason = result.error as 'cancelled' | 'timeout' | 'regexBudget' | 'invalidRegex' | 'invalidSteps' | 'disconnected' | undefined
      void snippetService.recordOutcome(snippetId, { executionId, status: result.status as 'completed' | 'cancelled' | 'failed', step: Math.min(result.index, result.total), total: result.total, ...(reason ? {reason} : {}) }).catch(() => { /* Best effort: never interrupt the terminal. */ })
    }
    if (result.status !== 'completed') throw new Error(t('snippets.macro.' + (result.error ?? result.status)))
  } finally {
    matcher.dispose()
    if (macroRunners.get(tabId) === runner) {
      macroRunners.delete(tabId)
      delete activeExpectMacros.value[tabId]
    }
    if (!completed) macroQueue.value[tabId] = []
    const next = completed ? macroQueue.value[tabId]?.shift() : undefined
    if (next && termStore.tabs.some(tab => tab.id === tabId)) {
      void sendSnippetToTerminal(tabId, next.payload, next.snippetId).catch(error => { macroQueue.value[tabId] = []; notifyMacro(error instanceof Error ? error.message : t('snippets.macro.invalidSteps'), true) })
    }
  }
}

async function findStartupSnippet(tabId: string): Promise<Snippet | null> {
  const tab = termStore.tabs.find((item) => item.id === tabId)
  const snippetId = tab?.startupSnippetId ?? null
  if (!tab || !snippetId || (tab.startupSnippetMode ?? 'disabled') === 'disabled') return null
  await loadSnippetQuickItems({ fresh: true })
  return snippetQuickItems.value.find((snippet) => snippet.id === snippetId) ?? null
}

async function prepareStartupSnippet(tabId: string): Promise<void> {
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

async function runStartupSnippet(tabId: string): Promise<void> {
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

function skipStartupSnippet(tabId: string): void {
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
  pane: TerminalPaneHandle | null | undefined,
  text: string,
  context: { snippetId?: number | undefined; snippetName?: string | undefined; executionId?: string | undefined },
): void {
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

function createSnippetExecutionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

function focusTab(tabId: string): void {
  termStore.activate(tabId)
  paneRefs[tabId]?.focus?.()
}

function focusSplitPaneAfterPointer(tabId: string, event: MouseEvent): void {
  const target = event.target
  if (target instanceof Element && target.closest('button, input, [role="button"]')) return
  focusTab(tabId)
}

const currentExpectMacro = computed(() => termStore.activeId ? activeExpectMacros.value[termStore.activeId] ?? null : null)

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
  return shared.participants.filter((participant) => participant.role === 'viewer' && !participant.leftAt && participant.lastSeenAt && Date.now() - new Date(participant.lastSeenAt).getTime() < 45_000)
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
const showSharedSessionManagerAction = computed(() => !!activeSharedSessionId.value)

const canCreateOwnSessionLink = computed(() => activeHostId.value !== null && (trialResources.value === null || trialResources.value.includes('sharing')))
const canCreateLiveSessionLink = computed(() => activeSessionId.value !== null)
const shareActionBusy = computed(() => creatingHostLink.value || creatingSharedSession.value)
function renderDropdownIcon(icon: 'share' | 'ownSession' | 'jit'): () => import('vue').VNode {
  return (): import('vue').VNode => h(TerminalRailIcon, { name: icon, class: 'h-4 w-4' })
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
      label: t(activeSharedSessionId.value ? 'sharedSessions.manageAction' : 'sharedSessions.title'),
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

  return trialResources.value === null ? options : options.filter(option => option.key === 'live-session')
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
    for (const tab of termStore.tabs.filter(tab => tab.hostId === data.id)) termStore.updateHostInfo(tab.id, { id: data.id, deviceProfile: data.deviceProfile })
  } catch {
    activeHostDetails.value = null
  } finally {
    activeHostDetailsLoading.value = false
  }
}, { immediate: true })

const canEditActiveHost = computed(() => {
  const host = activeHostDetails.value
  if (!host) return false
  if (host.accessPermissions) return host.accessPermissions.edit
  return canManageHosts.value
})

const editHostChangesConnection = computed(() => {
  const host = activeHostDetails.value
  if (!host) return false
  return editHostForm.value.ip.trim() !== host.ip
    || Number(editHostForm.value.port) !== host.port
    || editHostForm.value.sshUser.trim() !== host.sshUser
})

function openEditHostModal(): void {
  const host = activeHostDetails.value
  if (!host || !canEditActiveHost.value) return
  editHostForm.value = {
    name: host.name,
    ip: host.ip,
    port: host.port,
    sshUser: host.sshUser,
  }
  editHostModal.value = true
}

async function saveHostFromTerminal(): Promise<void> {
  const host = activeHostDetails.value
  const tabId = termStore.activeId
  if (!host || !tabId || !canEditActiveHost.value) return
  const name = editHostForm.value.name.trim()
  const ip = editHostForm.value.ip.trim()
  const port = Number(editHostForm.value.port)
  const sshUser = editHostForm.value.sshUser.trim()
  if (!name || !ip || !sshUser || !Number.isInteger(port) || port < 1 || port > 65535) {
    message.warning(t('terminal.editHost.validation'))
    return
  }

  const shouldReconnect = editHostChangesConnection.value
  editHostLoading.value = true
  try {
    const { data } = await hostService.update(host.id, { name, ip, port, sshUser })
    activeHostDetails.value = data
    for (const tab of termStore.tabs.filter(tab => tab.hostId === data.id)) termStore.updateHostInfo(tab.id, { id: data.id, deviceProfile: data.deviceProfile })
    termStore.updateHostInfo(tabId, {
      id: data.id,
      name: data.name,
      ip: data.ip,
      port: data.port,
      authType: data.authType,
      accessProtocol: data.accessProtocol,
      deviceProfile: data.deviceProfile,
    })
    editHostModal.value = false
    if (shouldReconnect) {
      message.success(t('terminal.editHost.savedReconnecting'))
      await paneRefs[tabId]?.reconnect?.(data.id)
    } else {
      message.success(t('terminal.editHost.saved'))
    }
  } catch (error: unknown) {
    const requestError = error as { response?: { status?: number; data?: { message?: string } } }
    message.error(requestError.response?.status === 403
      ? t('terminal.editHost.permissionDenied')
      : requestError.response?.data?.message ?? t('terminal.editHost.saveError'))
  } finally {
    editHostLoading.value = false
  }
}

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

function openAssociatedLink(link: HostAssociatedLink): void {
  const url = resolveAssociatedLink(link)
  if (!url) return
  const target = link.openMode === 'same_tab' ? '_self' : '_blank'
  window.open(url, target, target === '_blank' ? 'noopener,noreferrer' : undefined)
}

function onAssociatedLinkSelect(key: string | number): void {
  const raw = String(key)
  if (!raw.startsWith('associated-link:')) return
  const index = Number(raw.replace('associated-link:', ''))
  const link = activeAssociatedLinks.value[index]
  if (!link) return
  openAssociatedLink(link)
}

async function generateQuickHostLink(): Promise<void> {
  if (activeHostId.value === null || creatingHostLink.value) return

  creatingHostLink.value = true
  try {
    const { data } = await hostLinkService.create({
      hostId: activeHostId.value,
      expiresInMinutes: 10,
    })
    showShareResult({ mode: 'authenticated', url: data.url, expiresAt: new Date(data.expiresAt) })
  } catch (err: unknown) {
    const apiMessage = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    message.error(apiMessage ?? t('hostLinks.createError'))
  } finally {
    creatingHostLink.value = false
  }
}

async function generateQuickJitLink(): Promise<void> {
  if (activeHostId.value === null || creatingHostLink.value) return

  creatingHostLink.value = true
  try {
    const { data } = await hostLinkService.create({
      hostId: activeHostId.value,
      expiresInMinutes: 10,
      type: 'public_once',
    })
    showShareResult({
      mode: 'public_once',
      url: data.url,
      expiresAt: new Date(data.expiresAt),
      ...(data.pin ? { pin: data.pin } : {}),
    })
  } catch (err: unknown) {
    const apiMessage = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    message.error(apiMessage ?? t('hostLinks.createError'))
  } finally {
    creatingHostLink.value = false
  }
}

async function generateQuickSharedSession(): Promise<void> {
  if (activeSharedSessionId.value) { openSharedSessionManager(); return }
  if (activeSessionId.value === null || creatingSharedSession.value) return
  const sessionId = activeSessionId.value

  creatingSharedSession.value = true
  try {
    const activeId = termStore.activeId
    const initialOutputSnapshot = activeId
      ? paneRefs[activeId]?.getBufferText?.().slice(-120000) ?? ''
      : ''
    const sharedSettings = await featuresService.get().then((features) => features.sharedSessions).catch(() => null)
    const expiresInMinutes = sharedSettings?.expiryMinutes?.length
      ? [...sharedSettings.expiryMinutes].sort((a, b) => a - b)[0]
      : 10
    const { data } = await sharedSessionService.create({
      sessionId,
      expiresInMinutes,
      initialOutputSnapshot,
    })
    if (!activeId || tabSessionIds.value[activeId] !== sessionId) return
    if (termStore.tabs.some(tab => tab.id === activeId)) {
      tabSharedSessionUrls.value[activeId] = data.joinUrl
      tabSharedSessionExpiresAt.value[activeId] = new Date(data.expiresAt).getTime()
      tabSharedSessionIds.value = {
        ...tabSharedSessionIds.value,
        [activeId]: data.id,
      }
    }
    if (termStore.activeId === activeId) showShareResult({ mode: 'live', url: data.joinUrl, expiresAt: new Date(data.expiresAt) })
  } catch (err: unknown) {
    const apiMessage = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    message.error(apiMessage ?? t('sharedSessions.createError'))
  } finally {
    creatingSharedSession.value = false
  }
}

function openSharedSessionManager(): void {
  if (!activeSharedSessionId.value) return
  showSharedSessionManager.value = true
  void loadCurrentSharedSession()
}

async function loadCurrentSharedSession(): Promise<void> {
  if (!activeSharedSessionId.value) {
    currentSharedSession.value = null
    return
  }
  const tabId = termStore.activeId!
  const shareId = activeSharedSessionId.value
  if ((tabSharedSessionExpiresAt.value[tabId] ?? Infinity) <= Date.now()) {
    delete tabSharedSessionIds.value[tabId]
    currentSharedSession.value = null
    return
  }
  sharedSessionManagerLoading.value = true
  try {
    const { data } = await sharedSessionService.getById(shareId)
    if (termStore.activeId === tabId) sharedSessionManagerError.value = false
    if (tabSharedSessionIds.value[tabId] !== shareId) return
    if (data.status !== 'active' || new Date(data.expiresAt).getTime() <= Date.now()) {
      delete tabSharedSessionIds.value[tabId]
      if (termStore.activeId === tabId) currentSharedSession.value = null
    } else if (termStore.activeId === tabId) currentSharedSession.value = data
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } }).response?.status
    if ([403, 404, 410].includes(status ?? 0) && tabSharedSessionIds.value[tabId] === shareId) {
      delete tabSharedSessionIds.value[tabId]
    }
    if (termStore.activeId === tabId) sharedSessionManagerError.value = true
    // A transient polling failure must not dismiss an active share or become an unhandled rejection.
  } finally {
    sharedSessionManagerLoading.value = false
  }
}

function stopCurrentSharing(): void {
  const tabId = termStore.activeId
  const shareId = activeSharedSessionId.value
  if (!tabId || !shareId) return
  dialog.warning({
    title: t('sharedSessions.stopSharing'),
    content: t('sharedSessions.stopSharingConfirm'),
    positiveText: t('sharedSessions.stopSharing'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      sharedSessionManagerBusy.value = true
      try {
        await sharedSessionService.revoke(shareId)
        if (tabSharedSessionIds.value[tabId] === shareId) delete tabSharedSessionIds.value[tabId]
      } catch {
        message.error(t('sharedSessions.stopSharingError'))
        return false
      } finally { sharedSessionManagerBusy.value = false }
    },
  })
}

async function grantSharedSessionControlFromTerminal(userId: number, leaseMinutes: 2 | 5 | 10 | 30 = 2): Promise<void> {
  if (!activeSharedSessionId.value || sharedSessionManagerBusy.value) return
  sharedSessionManagerBusy.value = true
  try {
    await sharedSessionService.grantControl(activeSharedSessionId.value, userId, { leaseMinutes })
    await loadCurrentSharedSession()
  } finally {
    sharedSessionManagerBusy.value = false
  }
}

async function denySharedSessionControlFromTerminal(userId: number): Promise<void> {
  if (!activeSharedSessionId.value || sharedSessionManagerBusy.value) return
  sharedSessionManagerBusy.value = true
  try {
    await sharedSessionService.denyControl(activeSharedSessionId.value, userId)
    await loadCurrentSharedSession()
  } finally {
    sharedSessionManagerBusy.value = false
  }
}

async function reclaimSharedSessionControlFromTerminal(): Promise<void> {
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

function onShareModeSelect(key: string | number): void {
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
  sharedSessionManagerError.value = false
  currentSharedSession.value = null
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

function startFilePanelResize(e: MouseEvent): void {
  const startX     = e.clientX
  const startWidth = sidebarPanelWidth.value

  function onMove(ev: MouseEvent): void {
    const delta = ev.clientX - startX
    sidebarPanelWidth.value = Math.max(
      280,
      Math.min(900, termSettings.sidebarRailPosition === 'right' ? startWidth - delta : startWidth + delta),
    )
  }
  function onUp(): void {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup',   onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup',   onUp)
}

function openDedicatedFiles(): void {
  if (activeHostId.value === null) return
  void router.push({ name: 'files', params: { hostId: activeHostId.value } }).catch(reportTerminalUiError)
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

function setActiveSidebarPanel(panel: TerminalSidebarPanel | null): void {
  showFiles.value = panel === 'files'
  showSnippets.value = panel === 'snippets'
  showTunnels.value = panel === 'tunnels'
}

function toggleSidebarPanel(panel: TerminalSidebarPanel): void {
  if (panel === 'tunnels' && trialResources.value !== null) return
  if (panel === 'files' && !activeSupportsSftp.value) return
  if (panel === 'snippets' && !deviceCapabilities(activeHostDetails.value?.deviceProfile).serverAutomation) { message.info('Snippets de servidor não são compatíveis com este perfil de rede.'); return }
  if ((panel === 'files' || panel === 'tunnels') && activeHostId.value === null) return
  setActiveSidebarPanel(activeSidebarPanel.value === panel ? null : panel)
}

// ── Split panes (layout view over open tabs, up to 4 total) ─────────────

const splitEnabled      = ref(false)
const splitPaneStatus   = ref<Record<string, string>>({})  // tabId → status
const splitPaneOrder    = ref<SplitPaneSlot[]>([])
const splitColumnRatio  = ref(0.5)
const splitRowRatio     = ref(0.5)
const splitAreaEl       = ref<HTMLElement | null>(null)
const splitResizeAxis   = ref<SplitResizeAxis | null>(null)
const draggedSplitTabId = ref<string | null>(null)
const showSplitComposer = ref(false)
const splitComposerSelection = ref<string[]>([])
const splitTargetSlot = ref<number | null>(null)
const splitReplacementTabId = ref<string | null>(null)
const splitGroupName = ref('')
const splitGroups = ref<TerminalSplitGroup[]>([])

const maxPanes       = 4
const splitGridTabs  = computed(() => {
  if (!splitEnabled.value) return []
  const byId = new Map(termStore.tabs.map((tab) => [tab.id, tab]))
  return splitPaneOrder.value.map((id) => id ? byId.get(id) : undefined).filter((tab): tab is NonNullable<typeof tab> => Boolean(tab)).slice(0, maxPanes)
})
const splitTabIds    = computed(() => splitGridTabs.value.map((tab) => tab.id))
const splitSlotCount = computed(() => splitPaneOrder.value.length)
const hasAnySplit    = computed(() => splitEnabled.value && splitSlotCount.value > 1)
const canApplySplitComposition = computed(() => splitComposerSelection.value.length >= 2 && splitComposerSelection.value.length <= maxPanes)
const splitGroupStorageKey = computed(() => `na_terminal_split_groups:${auth.user?.tenantId ?? 0}:${auth.user?.id ?? 0}`)
const singleVisibleTabId = computed(() => termStore.activeId ?? termStore.tabs[0]?.id ?? null)
const splitGridStyle = computed(() => {
  const count = splitSlotCount.value
  const isNarrow = viewportWidth.value < 960
  const isMedium = viewportWidth.value < 1280
  if (count <= 1) return {}
  if (isNarrow) {
    return { display: 'grid', gridTemplateColumns: '1fr', gridTemplateRows: `repeat(${count}, minmax(0, 1fr))` }
  }
  if (isMedium && count > 2) return { display: 'grid', ...splitGridLayout(count, splitColumnRatio.value, splitRowRatio.value) }
  return { display: 'grid', ...splitGridLayout(count, splitColumnRatio.value, splitRowRatio.value) }
})

const canResizeSplitGrid = computed(() => hasAnySplit.value && viewportWidth.value >= 960)
const splitColumnHandleStyle = computed(() => ({ left: `${splitColumnRatio.value * 100}%` }))
const splitRowHandleStyle = computed(() => ({
  top: `${splitRowRatio.value * 100}%`,
  left: splitSlotCount.value === 3 ? `${splitColumnRatio.value * 100}%` : '0',
}))

function loadSplitGroups(): void {
  try {
    splitGroups.value = sanitizeTerminalSplitGroups(JSON.parse(localStorage.getItem(splitGroupStorageKey.value) || '[]'))
  } catch {
    splitGroups.value = []
  }
}

function persistSplitGroups(): void {
  localStorage.setItem(splitGroupStorageKey.value, JSON.stringify(splitGroups.value))
}

function reconcileSplitSlots(ids = termStore.tabs.map((tab): string => tab.id)): void {
  splitPaneOrder.value = reconcileSplitPaneSlots(splitPaneOrder.value, ids)
}

function updateSplitRatioFromPointer(event: PointerEvent): void {
  if (!splitResizeAxis.value || !splitAreaEl.value) return
  const ratio = splitRatioFromPointer(splitResizeAxis.value, event.clientX, event.clientY, splitAreaEl.value.getBoundingClientRect())
  if (splitResizeAxis.value === 'column') splitColumnRatio.value = ratio
  else splitRowRatio.value = ratio
}

function stopSplitResize(): void {
  splitResizeAxis.value = null
  document.body.style.removeProperty('user-select')
  document.body.style.removeProperty('cursor')
  window.removeEventListener('pointermove', updateSplitRatioFromPointer)
  window.removeEventListener('pointerup', stopSplitResize)
  window.removeEventListener('pointercancel', stopSplitResize)
}

function startSplitResize(axis: SplitResizeAxis, event: PointerEvent): void {
  if (!canResizeSplitGrid.value) return
  event.preventDefault()
  event.stopPropagation()
  splitResizeAxis.value = axis
  document.body.style.userSelect = 'none'
  document.body.style.cursor = axis === 'column' ? 'col-resize' : 'row-resize'
  window.addEventListener('pointermove', updateSplitRatioFromPointer)
  window.addEventListener('pointerup', stopSplitResize)
  window.addEventListener('pointercancel', stopSplitResize)
}

function adjustSplitRatio(axis: SplitResizeAxis, delta: number): void {
  if (axis === 'column') splitColumnRatio.value = clampSplitRatio(splitColumnRatio.value + delta)
  else splitRowRatio.value = clampSplitRatio(splitRowRatio.value + delta)
}

function onSplitSeparatorKey(axis: SplitResizeAxis, event: KeyboardEvent): void {
  const decrease = axis === 'column' ? event.key === 'ArrowLeft' : event.key === 'ArrowUp'
  const increase = axis === 'column' ? event.key === 'ArrowRight' : event.key === 'ArrowDown'
  if (!decrease && !increase) return
  event.preventDefault()
  adjustSplitRatio(axis, decrease ? -0.05 : 0.05)
}

function onSplitPaneDragStart(event: DragEvent, tabId: string): void {
  draggedSplitTabId.value = tabId
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-nodeaccess-split-pane', tabId)
  }
}

function onSplitPaneDrop(event: DragEvent, targetId: string): void {
  event.preventDefault()
  event.stopPropagation()
  const sourceId = draggedSplitTabId.value ?? event.dataTransfer?.getData('application/x-nodeaccess-split-pane')
  if (sourceId) splitPaneOrder.value = moveSplitPane(splitPaneOrder.value, sourceId, targetId)
  draggedSplitTabId.value = null
}

function shiftVisibleSplitPane(tabId: string, delta: -1 | 1): void {
  splitPaneOrder.value = shiftSplitPane(splitPaneOrder.value, tabId, delta)
}

watch(() => termStore.tabs.map(t => t.id), (ids) => {
  reconcileSplitSlots(ids)
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

function openSplitPicker(): void {
  if (!canUseSplitPanes.value || termStore.tabs.length === 0) return
  if (termStore.tabs.length < 2) {
    message.info(t('terminal.splitNeedsMoreTabs'))
    return
  }
  splitTargetSlot.value = null
  splitReplacementTabId.value = null
  splitComposerSelection.value = splitTabIds.value.length >= 2
    ? [...splitTabIds.value]
    : termStore.activeId ? [termStore.activeId] : []
  showSplitComposer.value = true
}

function toggleSplitComposerTab(tabId: string): void {
  const selected = splitComposerSelection.value.includes(tabId)
  if (selected) splitComposerSelection.value = splitComposerSelection.value.filter((id) => id !== tabId)
  else if (splitComposerSelection.value.length < maxPanes) splitComposerSelection.value = [...splitComposerSelection.value, tabId]
}

function applySplitComposition(): void {
  if (!canApplySplitComposition.value) return
  splitPaneOrder.value = createSplitPaneSlots(splitComposerSelection.value, maxPanes)
  splitEnabled.value = true
  showSplitComposer.value = false
}

function openSplitSlotPicker(index: number): void {
  splitTargetSlot.value = index
  splitReplacementTabId.value = null
  showSplitComposer.value = true
}

function closeSplitComposer(): void {
  showSplitComposer.value = false
  splitTargetSlot.value = null
  splitReplacementTabId.value = null
  splitGroupName.value = ''
}

function applySplitSlotReplacement(): void {
  if (splitTargetSlot.value === null || !splitReplacementTabId.value) return
  splitPaneOrder.value = assignSplitPaneSlot(splitPaneOrder.value, splitTargetSlot.value, splitReplacementTabId.value)
  splitTargetSlot.value = null
  splitReplacementTabId.value = null
  showSplitComposer.value = false
}

function compactSplitLayout(): void {
  splitPaneOrder.value = compactSplitPaneSlots(splitPaneOrder.value)
}

function saveCurrentSplitGroup(): void {
  const name = splitGroupName.value.trim()
  const hostIds = splitComposerSelection.value
    .map((id) => termStore.tabs.find((tab) => tab.id === id)?.hostId)
    .filter((id): id is number => Number.isInteger(id))
  if (!name || hostIds.length < 2) return
  const group: TerminalSplitGroup = { id: crypto.randomUUID(), name, hostIds: [...new Set(hostIds)].slice(0, maxPanes) }
  splitGroups.value = [...splitGroups.value, group].slice(-20)
  splitGroupName.value = ''
  persistSplitGroups()
}

function selectSplitGroup(group: TerminalSplitGroup): void {
  const selected = group.hostIds.flatMap((hostId) => {
    const tab = termStore.tabs.find((candidate) => candidate.hostId === hostId)
    return tab ? [tab.id] : []
  })
  splitComposerSelection.value = createSplitPaneSlots(selected, maxPanes).filter((id): id is string => Boolean(id))
}

function deleteSplitGroup(groupId: string): void {
  splitGroups.value = splitGroups.value.filter((group) => group.id !== groupId)
  persistSplitGroups()
}

function closeAllSplits(): void {
  splitEnabled.value = false
  broadcastEnabled.value = false
}

function resetTerminalViewState(): void {
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

function closeHostKeyModal(): void {
  if (trustingHostKey.value) return
  hostKeyModal.value = null
}

async function trustHostKeyAndReconnect(): Promise<void> {
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

function isSessionExpiredError(value?: string | null): boolean {
  if (!value) return false
  const normalized = value.toLowerCase()
  return normalized.includes('sessão expirada')
    || normalized.includes('sessao expirada')
    || normalized.includes('session expired')
    || normalized.includes('unauthorized')
}

function resetTerminalLayoutState(): void {
  splitEnabled.value = false
  splitColumnRatio.value = 0.5
  splitRowRatio.value = 0.5
  splitPaneOrder.value = []
  broadcastEnabled.value = false
  tabCtxVisible.value = false
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────

function onKeydown(e: KeyboardEvent): void {
  if (isTerminalAiShortcut(e, isMac) && terminalAiAvailable.value && canAnalyzeActiveTerminal.value) {
    e.preventDefault()
    e.stopPropagation()
    openTerminalAiModal()
    return
  }
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

function onWindowResize(): void {
  viewportWidth.value = window.innerWidth
}

function syncBrowserFullscreenState(): void {
  isBrowserFullscreen.value = document.fullscreenElement === terminalViewportEl.value
  if (!isBrowserFullscreen.value) {
    autoFullscreenAttempted.value = false
  }
}

async function toggleBrowserFullscreen(): Promise<void> {
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

async function tryAutoBrowserFullscreen(): Promise<void> {
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

function onTerminalFeaturesUpdated(): void {
  void loadTerminalCapabilities().catch(reportTerminalUiError)
}

onMounted(()   => window.addEventListener('keydown', onKeydown))
onMounted(loadSplitGroups)
onMounted(()   => window.addEventListener(SESSION_EXPIRED_EVENT, resetTerminalViewState))
onMounted(()   => window.addEventListener(TERMINAL_LAYOUT_RESET_EVENT, resetTerminalLayoutState))
onMounted(()   => window.addEventListener(FEATURES_UPDATED_EVENT, onTerminalFeaturesUpdated))
onMounted(()   => window.addEventListener('resize', onWindowResize))
onMounted(()   => document.addEventListener('fullscreenchange', syncBrowserFullscreenState))
onMounted(()   => nextTick(() => { void tryAutoBrowserFullscreen() }))
onMounted(()   => { if (isTerminalSessionsMode.value) void loadSessionsNavigator() })
onUnmounted(() => {
  if (sharedSessionPollTimer) clearInterval(sharedSessionPollTimer)
  stopSplitResize()
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener(SESSION_EXPIRED_EVENT, resetTerminalViewState)
  window.removeEventListener(TERMINAL_LAYOUT_RESET_EVENT, resetTerminalLayoutState)
  window.removeEventListener(FEATURES_UPDATED_EVENT, onTerminalFeaturesUpdated)
  window.removeEventListener('resize', onWindowResize)
  document.removeEventListener('fullscreenchange', syncBrowserFullscreenState)
  macroNotice?.destroy()
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

function addTerminalTab(host: { id: number; name?: string; ip?: string; port?: number; authType?: string; accessProtocol?: HostPublic['accessProtocol']; deviceProfile?: HostPublic['deviceProfile'] }): string {
  return termStore.add(host)
}

function isGraphicalTab(tab: { hostAccessProtocol?: HostPublic['accessProtocol'] }): boolean {
  const protocol = tab.hostAccessProtocol ?? 'ssh'
  return !canOpenInWebTerminal(protocol) && getHostAccessProtocolCapabilities(protocol).graphicalGatewayPlanned
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

function terminalPaneShellStyle(tabId: string): { gridRow?: string | undefined; order: number; } {
  const order = splitPaneOrder.value.indexOf(tabId)
  return {
    order: order >= 0 ? order : maxPanes,
    ...(splitSlotCount.value === 3 && viewportWidth.value >= 1280 && splitPaneOrder.value[0] === tabId
      ? { gridRow: '1 / span 2' }
      : {}),
  }
}

const platformPresetLabel = computed(() => {
  if (platform === 'macos') return 'macOS'
  if (platform === 'windows') return 'Windows'
  return 'Linux'
})

function applyRecommendedPlatformPreset(): void {
  applyTerminalPreset(platform)
  dismissPlatformOnboarding()
}

function dismissPlatformOnboarding(): void {
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

function reportTerminalUiError(error: unknown): void {
  console.error('Falha ao atualizar a interface do terminal.', error)
}
</script>

<template>
  <div
    ref="terminalViewportEl"
    class="flex flex-col h-screen bg-[#1a1b1e] relative"
    :class="isBrowserFullscreen ? 'bg-[#101014]' : ''"
    :data-terminal-display-state="ui.terminalDisplayMode"
  >
    <div
      v-if="showPlatformOnboarding"
      class="px-3 pt-3 shrink-0"
    >
      <NAlert
        type="info"
        :show-icon="false"
        closable
        data-terminal-onboarding="true"
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
          <NButton
            size="small"
            type="primary"
            @click="applyRecommendedPlatformPreset"
          >
            {{ $t('terminal.onboarding.applyPreset', { platform: platformPresetLabel }) }}
          </NButton>
          <NButton
            size="small"
            quaternary
            @click="dismissPlatformOnboarding"
          >
            {{ $t('terminal.onboarding.dismiss') }}
          </NButton>
        </div>
      </NAlert>
    </div>

    <div
      v-if="currentExpectMacro?.status === 'running'"
      class="fixed right-16 top-16 z-40 flex max-w-[calc(100vw-5rem)] flex-wrap items-center gap-2 rounded border border-gray-600 bg-[#18181c] px-2 py-1 text-xs text-gray-200 shadow"
      data-macro-progress
    >
      <span
        role="status"
        class="max-w-48 truncate"
      >
        {{ t('snippets.macro.running', {name:currentExpectMacro.name,current:currentExpectMacro.index+1,total:currentExpectMacro.total}) }}
      </span>
      <NButton
        size="tiny"
        @click="termStore.activeId && cancelExpectSendMacro(termStore.activeId)"
      >
        {{ t('common.cancel') }}
      </NButton>
      <template v-if="termStore.activeId && macroQueue[termStore.activeId]?.length">
        <span data-macro-queue>{{ t('snippets.macro.queued', {count:macroQueue[termStore.activeId]?.length}) }}</span>
        <NButton
          size="tiny"
          @click="macroQueue[termStore.activeId] = []"
        >
          {{ t('snippets.macro.clearQueue') }}
        </NButton>
      </template>
    </div>

    <!-- ── Barra de abas ───────────────────────────────────────────────── -->
    <div
      v-show="!isTerminalFocusMode"
      class="h-14 bg-[#18181c] border-b border-gray-800 shrink-0 overflow-hidden"
      data-terminal-session-bar="true"
    >
      <div class="flex h-full items-center px-6 overflow-hidden">
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

        <NButton
          text
          size="small"
          class="shrink-0 px-0"
          @click="goBackFromTerminal"
        >
          {{ $t('terminal.back') }}
        </NButton>

        <div class="w-px h-5 bg-gray-700 shrink-0 mx-4" />

        <div class="terminal-tab-strip flex items-center gap-0.5 flex-1 overflow-hidden py-1 min-w-0">
          <NTooltip
            v-for="tab in termStore.tabs"
            :key="tab.id"
            trigger="hover"
            placement="bottom"
            :delay="400"
            :disabled="tabCtxVisible || !!draggedTabId"
          >
            <!-- Conteúdo do tooltip -->
            <template #trigger>
              <button
                class="terminal-tab flex min-w-0 items-center gap-1.5 rounded px-2 py-1 text-sm whitespace-nowrap transition-colors"
                :class="tab.id === termStore.activeId
                  ? 'terminal-tab-active na-selection-active'
                  : 'text-gray-400 hover:text-white hover:bg-[#1e1e22]'"
                :aria-label="terminalTabLabel(tab)"
                :title="terminalTabLabel(tab)"
                :data-terminal-tab-host="tab.hostId"
                :data-terminal-tab-id="tab.id"
                :data-dragging="draggedTabId === tab.id || undefined"
                :data-drop-side="tabDropTarget?.id === tab.id ? tabDropTarget.side : undefined"
                draggable="true"
                @click="focusTab(tab.id)"
                @contextmenu="openTabContextMenu($event, tab.id)"
                @dragstart="onTabDragStart($event, tab.id)"
                @dragend="onTabDragEnd($event, tab.id)"
                @dragover="onTabDragOver($event, tab.id)"
                @dragleave="onTabDragLeave"
                @drop="onTabDrop($event, tab.id)"
              >
                <span
                  v-if="tabDropTarget?.id === tab.id"
                  class="terminal-tab-drop-marker"
                  aria-hidden="true"
                  data-testid="terminal-tab-drop-marker"
                />
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
                <span class="terminal-tab-label min-w-0 flex-1 truncate">{{ terminalTabLabel(tab) }}</span>
                <span
                  v-if="tab.unreadCount > 0"
                  class="inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full text-[10px] font-semibold px-1"
                  style="background: rgba(251,146,60,0.16); color: #fdba74;"
                >
                  {{ tab.unreadCount > 99 ? '99+' : tab.unreadCount }}
                </span>
                <!-- Tempo de sessão -->
                <span
                  v-if="formatElapsed(tab.connectedAt)"
                  class="terminal-tab-secondary text-xs text-gray-500 ml-0.5"
                >
                  {{ formatElapsed(tab.connectedAt) }}
                </span>
                <!-- Latência -->
                <span
                  v-if="tabLatency[tab.id]"
                  class="terminal-tab-secondary text-[10px] font-mono ml-0.5"
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
                <span
                  class="ml-1 text-gray-500 hover:text-white leading-none"
                  role="button"
                  tabindex="0"
                  :aria-label="$t('terminal.tabMenu.close')"
                  :data-terminal-close-tab="tab.hostId"
                  @click.stop="closeTab(tab.id)"
                  @keydown.enter.stop.prevent="closeTab(tab.id)"
                  @keydown.space.stop.prevent="closeTab(tab.id)"
                >✕</span>
              </button>
            </template>

            <!-- Tooltip: detalhes da conexão -->
            <div
              class="text-xs space-y-1"
              style="min-width:160px;"
            >
              <div class="font-semibold text-white">
                {{ terminalTabLabel(tab) }}
              </div>
              <div class="text-gray-400">
                {{ protocolLabel(tab.hostAccessProtocol) }}
              </div>
              <div
                v-if="tab.hostIp"
                class="text-gray-400 font-mono"
              >
                {{ tab.hostIp }}:{{ tab.hostPort }}
              </div>
              <div
                v-if="tab.hostAccessProtocol === 'ssh' && tab.hostAuthType"
                class="text-gray-400"
              >
                Auth: {{ tab.hostAuthType === 'pem' ? '🔑 PEM' : tab.hostAuthType === 'pem_password' ? '🔑+🔒 PEM + Senha' : '🔒 Senha' }}
              </div>
              <div
                v-if="tab.connectedAt"
                class="text-gray-400"
              >
                {{ $t('terminal.connectedFor', { time: formatElapsed(tab.connectedAt) || $t('terminal.now') }) }}
              </div>
              <div
                v-if="tabLatency[tab.id]"
                class="flex items-center gap-1"
              >
                <span
                  class="w-1.5 h-1.5 rounded-full"
                  :class="tabLatency[tab.id] < 80 ? 'bg-green-400' : tabLatency[tab.id] < 200 ? 'bg-yellow-400' : 'bg-red-400'"
                />
                <span class="text-gray-400">{{ $t('terminal.latency') }}: {{ tabLatency[tab.id] }}ms</span>
              </div>
              <div
                v-if="tabConnectionRoute[tab.id]?.method"
                class="flex items-center gap-1"
              >
                <span
                  class="w-1.5 h-1.5 rounded-full shrink-0"
                  :class="tabConnectionRoute[tab.id]?.method === 'direct' ? 'bg-gray-400' : 'bg-purple-400'"
                />
                <span class="text-gray-400">
                  <template v-if="tabConnectionRoute[tab.id]?.method === 'direct'">{{ $t('terminal.routeDirect') }}</template>
                  <template v-else-if="tabConnectionRoute[tab.id]?.agentName">{{ $t('terminal.routeAgent') }}: <span class="text-purple-300">{{ tabConnectionRoute[tab.id]?.agentName }}</span></template>
                  <template v-else>{{ $t('terminal.routeAgent') }}</template>
                </span>
              </div>
              <div
                v-if="isSessionExpiredError(tabErrors[tab.id])"
                class="text-yellow-400"
              >
                {{ $t('terminal.sessionExpiredHint') }}
              </div>
              <div
                v-else-if="(tabStatus[tab.id] === 'error' || tabStatus[tab.id] === 'closed') && hintForErrorCode(tabErrorCodes[tab.id])"
                class="text-red-300 text-xs leading-snug"
              >
                {{ hintForErrorCode(tabErrorCodes[tab.id]) }}
              </div>
              <div
                v-if="!tab.connectedAt"
                class="text-yellow-400"
              >
                {{ $t('terminal.connecting') }}...
              </div>
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
          <NTooltip
            v-if="!canAddTab"
            trigger="hover"
          >
            <template #trigger>
              <NButton
                size="small"
                text
                disabled
                class="px-2 text-gray-600"
              >
                +
              </NButton>
            </template>
            {{ $t('terminal.noMultiConnect') }}
          </NTooltip>
          <NButton
            v-else
            size="small"
            text
            class="px-2 text-gray-400 hover:text-white"
            data-terminal-action="new-tab"
            @click="openPicker"
          >
            +
          </NButton>
        </div>

        <!-- Top terminal controls -->
        <div
          v-if="termStore.tabs.length > 0"
          class="shrink-0 flex items-center gap-0.5 pl-3"
        >
          <NDropdown
            :options="terminalDisplayModeOptions"
            trigger="click"
            @select="onTerminalDisplayModeSelect"
          >
            <button
              type="button"
              class="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-transparent px-2 text-gray-400 transition-colors hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white"
              :aria-label="$t('terminal.displayMode.action')"
              :title="$t(`terminal.displayMode.${ui.terminalDisplayMode}Description`)"
              data-terminal-display-mode="true"
            >
              <span aria-hidden="true">▣</span>
              <span class="hidden xl:inline text-xs">{{ $t(`terminal.displayMode.${ui.terminalDisplayMode}`) }}</span>
            </button>
          </NDropdown>
          <ManualLink chapter="terminal" />
          <button
            v-if="!manual.enabled"
            type="button"
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs text-gray-500 hover:bg-white/5 hover:text-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
            :aria-label="$t(`terminal.displayMode.${ui.terminalDisplayMode}Description`)"
            :title="$t(`terminal.displayMode.${ui.terminalDisplayMode}Description`)"
            data-terminal-display-help="true"
          >
            ?
          </button>
          <NTooltip
            v-if="showSharedSessionManagerAction"
            trigger="hover"
            placement="bottom"
            :delay="400"
          >
            <template #trigger>
              <div class="flex items-center gap-1">
                <NButton
                  size="small"
                  text
                  class="px-2"
                  data-testid="shared-session-manage"
                  :theme-overrides="{ textColorText: '#fcd34d', textColorTextHover: '#fcd34d', textColorTextPressed: '#fcd34d', textColorTextFocus: '#fcd34d' }"
                  @click="openSharedSessionManager"
                >
                  {{ $t('sharedSessions.manageAction') }}
                </NButton>
                <ManualLink chapter="sharing" />
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
          <NTooltip
            trigger="hover"
            placement="bottom"
            :delay="400"
          >
            <template #trigger>
              <NButton
                size="small"
                text
                class="px-2 font-mono"
                :class="hasAnySplit ? 'text-green-400' : 'text-gray-400 hover:text-white'"
                :disabled="!canAddSplitPane"
                data-terminal-action="split-pane"
                @click="openSplitPicker"
              >
                ⊞
              </NButton>
            </template>
            <div class="text-xs">
              <div>
                {{ $t('terminal.splitPane') }}
                <span class="text-gray-400 ml-1">({{ Math.min(termStore.tabs.length, maxPanes) }}/{{ maxPanes }})</span>
              </div>
              <div
                v-if="!canUseSplitPanes"
                class="text-gray-500 mt-0.5"
              >
                {{ $t('terminal.noMultiConnect') }}
              </div>
              <div
                v-if="termStore.tabs.length >= maxPanes"
                class="text-gray-500 mt-0.5"
              >
                {{ $t('terminal.splitMax') }}
              </div>
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
                <TerminalRailIcon
                  viewBox="0 0 24 24"
                  class="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  name="searchTabs"
                />
              </button>
            </template>

            <div class="w-[340px]">
              <div class="mb-3">
                <div class="text-sm font-semibold text-white">
                  {{ $t('terminal.tabSearch.title') }}
                </div>
                <div class="mt-1 text-xs text-gray-400">
                  {{ $t('terminal.tabSearch.subtitle') }}
                </div>
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
                      <div class="truncate text-sm font-medium">
                        {{ terminalTabLabel(tab) }}
                      </div>
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
            size="small"
            text
            class="px-2 text-gray-400 hover:text-white transition-colors"
            :title="$t('terminal.closeSplit')"
            @click="closeAllSplits"
          >
            {{ $t('terminal.closeSplit') }}
          </NButton>
          <NButton
            v-if="hasAnySplit"
            size="small"
            text
            class="px-2 text-gray-400 hover:text-white transition-colors"
            data-terminal-action="edit-split"
            @click="openSplitPicker"
          >
            {{ $t('terminal.splitEdit') }}
          </NButton>
          <NButton
            v-if="hasAnySplit && splitPaneOrder.includes(null)"
            size="small"
            text
            class="px-2 text-gray-400 hover:text-white transition-colors"
            data-terminal-action="compact-split"
            @click="compactSplitLayout"
          >
            {{ $t('terminal.splitCompact') }}
          </NButton>

          <!-- Mirror Input (Espelhar Entrada) -->
          <template v-if="hasAnySplit">
            <div class="w-px h-4 bg-gray-700 shrink-0 mx-1" />
            <NTooltip
              trigger="hover"
              placement="bottom"
              :delay="400"
            >
              <template #trigger>
                <NButton
                  size="small"
                  text
                  class="px-2 relative"
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
                <div class="font-medium">
                  {{ broadcastEnabled ? $t('terminal.mirrorOff') : $t('terminal.mirrorOn') }}
                </div>
                <div
                  v-if="!broadcastEnabled"
                  class="text-gray-400 mt-0.5"
                >
                  {{ $t('terminal.mirrorDesc') }}
                </div>
                <div
                  v-if="broadcastEnabled"
                  class="text-orange-300 mt-0.5"
                >
                  {{ $t('terminal.mirrorActive') }}
                </div>
              </div>
            </NTooltip>
          </template>
        </div>
      </div>
    </div>

    <!-- ── Terminais + File Manager ──────────────────────────────────── -->
    <div class="terminal-workspace flex-1 overflow-hidden relative flex min-h-0 bg-[#141518]">
      <Transition name="sessions-navigator">
        <TerminalSessionsNavigator
          v-if="isTerminalSessionsMode"
          :key="sessionsNavigatorRevision"
          :folders="sessionsNavigatorFolders"
          :inventory="sessionsNavigatorInventory"
          :summary="sessionsNavigatorSummary"
          :loading="sessionsNavigatorLoading"
          :error="sessionsNavigatorError"
          :active-host-ids="termStore.tabs.map((tab) => tab.hostId)"
          :style="{ order: 10 }"
          @refresh="refreshSessionsNavigator"
          @select-host="pickHost"
        />
      </Transition>

      <div
        v-if="termStore.tabs.length > 0"
        v-show="!isTerminalFocusMode"
        class="na-panel shrink-0 w-[58px] flex flex-col items-center justify-between py-3"
        data-terminal-tool-rail="true"
        :class="isSidebarRailOnRight ? 'border-l border-gray-800' : 'border-r border-gray-800'"
        :style="{ order: isSidebarRailOnRight ? 40 : 20 }"
      >
        <div class="flex flex-col items-center gap-2">
          <NTooltip
            trigger="hover"
            placement="right"
            :delay="300"
          >
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
          <NTooltip
            trigger="hover"
            placement="right"
            :delay="300"
          >
            <template #trigger>
              <button
                class="flex h-10 w-10 items-center justify-center rounded-xl border transition-colors"
                style="order: 2"
                :class="isBrowserFullscreen
                  ? 'border-emerald-500/30 bg-emerald-500/12 text-emerald-300'
                  : 'border-transparent text-gray-400 hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white'"
                @click="toggleBrowserFullscreen"
              >
                <TerminalRailIcon
                  viewBox="0 0 24 24"
                  class="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  name="fullscreen"
                />
              </button>
            </template>
            <div class="text-xs">
              {{ isBrowserFullscreen ? $t('terminal.exitFullscreen') : $t('terminal.enterFullscreen') }}
            </div>
          </NTooltip>

          <NTooltip
            v-if="canCreateOwnSessionLink"
            trigger="hover"
            placement="right"
            :delay="300"
          >
            <template #trigger>
              <span
                class="inline-flex"
                style="order: 5"
              >
                <NDropdown
                  trigger="click"
                  :options="shareMenuOptions"
                  @select="onShareModeSelect"
                >
                  <button
                    data-testid="terminal-share-menu"
                    class="relative flex h-10 w-10 items-center justify-center rounded-xl border border-transparent text-gray-400 transition-colors hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white"
                    :class="activeSharedSessionId ? 'text-amber-300 border-amber-500/20 bg-amber-500/10' : ''"
                    :disabled="shareActionBusy"
                    :aria-label="$t('sharedSessions.title')"
                  >
                    <TerminalRailIcon
                      viewBox="0 0 24 24"
                      class="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      name="share"
                    />
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
              <div class="text-gray-400">
                {{ $t('sharedSessions.menuHint') }}
              </div>
            </div>
          </NTooltip>

          <NTooltip
            v-if="canEditActiveHost"
            trigger="hover"
            placement="right"
            :delay="300"
          >
            <template #trigger>
              <button
                class="flex h-10 w-10 items-center justify-center rounded-xl border border-transparent text-gray-400 transition-colors hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white"
                style="order: 7"
                :disabled="activeHostDetailsLoading"
                :aria-label="$t('terminal.editHost.button')"
                @click="openEditHostModal"
              >
                <TerminalRailIcon
                  viewBox="0 0 24 24"
                  class="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  name="editHost"
                />
              </button>
            </template>
            <div class="text-xs space-y-1">
              <div>{{ $t('terminal.editHost.button') }}</div>
              <div class="text-gray-400">
                {{ $t('terminal.editHost.hint') }}
              </div>
            </div>
          </NTooltip>

          <NTooltip
            v-if="activeAssociatedLinks.length"
            trigger="hover"
            placement="right"
            :delay="300"
          >
            <template #trigger>
              <span
                class="inline-flex"
                style="order: 8"
              >
                <NDropdown
                  trigger="click"
                  :options="associatedLinkMenuOptions"
                  @select="onAssociatedLinkSelect"
                >
                  <button
                    class="flex h-10 w-10 items-center justify-center rounded-xl border border-transparent text-gray-400 transition-colors hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white"
                    :disabled="activeHostDetailsLoading"
                    :aria-label="$t('terminal.associatedLinks.button')"
                  >
                    <TerminalRailIcon
                      viewBox="0 0 24 24"
                      class="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      name="links"
                    />
                  </button>
                </NDropdown>
              </span>
            </template>
            <div class="text-xs space-y-1">
              <div>{{ $t('terminal.associatedLinks.hint') }}</div>
              <div class="text-gray-400">
                {{ $t('terminal.associatedLinks.count', { count: activeAssociatedLinks.length }) }}
              </div>
            </div>
          </NTooltip>

          <NTooltip
            v-if="activeSupportsSftp"
            trigger="hover"
            placement="right"
            :delay="300"
          >
            <template #trigger>
              <button
                data-terminal-rail-action="files"
                class="flex h-10 w-10 items-center justify-center rounded-xl border transition-colors"
                style="order: 3"
                :class="showFiles
                  ? 'border-blue-500/30 bg-blue-500/12 text-blue-300'
                  : 'border-transparent text-gray-400 hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white'"
                :disabled="activeHostId === null"
                @click="toggleSidebarPanel('files')"
              >
                <TerminalRailIcon
                  viewBox="0 0 24 24"
                  class="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  name="files"
                />
              </button>
            </template>
            <div class="text-xs">
              {{ showFiles ? $t('terminal.hideFiles') : $t('terminal.files') }}
              <span class="ml-1 text-gray-400 font-mono">{{ shortcuts.files }}</span>
            </div>
          </NTooltip>

          <NTooltip
            trigger="hover"
            placement="right"
            :delay="300"
          >
            <template #trigger>
              <button
                data-terminal-rail-action="snippets"
                class="flex h-10 w-10 items-center justify-center rounded-xl border transition-colors"
                style="order: 4"
                :class="showSnippets
                  ? 'border-purple-500/30 bg-purple-500/12 text-purple-300'
                  : 'border-transparent text-gray-400 hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white'"
                @click="toggleSidebarPanel('snippets')"
              >
                <TerminalRailIcon
                  viewBox="0 0 24 24"
                  class="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  name="snippets"
                />
              </button>
            </template>
            <div class="text-xs">
              {{ $t('snippets.panelHint') }}
              <span class="ml-1 text-gray-400 font-mono">{{ shortcuts.snippets }}</span>
            </div>
          </NTooltip>

          <NTooltip
            v-if="terminalAiAvailable"
            trigger="hover"
            placement="right"
            :delay="300"
          >
            <template #trigger>
              <button
                data-testid="terminal-ai-open"
                :aria-label="$t('terminal.ai.hint')"
                class="flex h-10 w-10 items-center justify-center rounded-xl border transition-colors"
                style="order: 7"
                :class="showTerminalAiModal
                  ? 'border-emerald-500/30 bg-emerald-500/12 text-emerald-300'
                  : 'border-transparent text-gray-400 hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white'"
                :disabled="!canAnalyzeActiveTerminal"
                @click="openTerminalAiModal"
              >
                <TerminalRailIcon
                  viewBox="0 0 24 24"
                  class="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  name="localAi"
                />
              </button>
            </template>
            <div class="text-xs">
              {{ $t('terminal.ai.hint') }}
            </div>
          </NTooltip>

          <NTooltip
            v-if="trialResources === null"
            trigger="hover"
            placement="right"
            :delay="300"
          >
            <template #trigger>
              <button
                class="relative flex h-10 w-10 items-center justify-center rounded-xl border transition-colors"
                style="order: 6"
                :class="showTunnels || activeTunnelCount > 0
                  ? 'border-cyan-500/30 bg-cyan-500/12 text-cyan-300'
                  : 'border-transparent text-gray-400 hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white'"
                :disabled="activeHostId === null"
                data-testid="terminal-tunnel-button"
                @click="toggleSidebarPanel('tunnels')"
              >
                <TerminalRailIcon
                  viewBox="0 0 24 24"
                  class="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  name="forwardings"
                />
                <span
                  v-if="activeTunnelCount > 0"
                  data-testid="terminal-tunnel-count"
                  class="absolute -right-1 -top-1 flex min-w-[16px] items-center justify-center rounded-full bg-cyan-400 px-1 text-[10px] font-semibold text-slate-950"
                >
                  {{ activeTunnelCount > 9 ? '9+' : activeTunnelCount }}
                </span>
              </button>
            </template>
            <div class="text-xs space-y-1">
              <div>{{ $t('tunnels.panelHint') }}</div>
              <div
                v-if="activeTunnelSummary"
                class="text-cyan-300"
              >
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
          <NTooltip
            v-if="feedbackLicensed"
            trigger="hover"
            placement="right"
            :delay="300"
          >
            <template #trigger>
              <button
                class="flex h-10 w-10 items-center justify-center rounded-xl border border-transparent text-gray-400 transition-colors hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white"
                @click="openFeedbackFromTerminal"
              >
                <TerminalRailIcon
                  viewBox="0 0 24 24"
                  class="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  name="feedback"
                />
              </button>
            </template>
            <div class="text-xs">
              {{ $t('feedback.create.fabHint') }}
            </div>
          </NTooltip>

          <NTooltip
            trigger="hover"
            placement="right"
            :delay="300"
          >
            <template #trigger>
              <button
                class="flex h-10 w-10 items-center justify-center rounded-xl border border-transparent text-gray-400 transition-colors hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white"
                @click="openPicker"
              >
                <TerminalRailIcon
                  viewBox="0 0 24 24"
                  class="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  name="hosts"
                />
              </button>
            </template>
            <div class="text-xs">
              {{ $t('terminal.hostSwitcherHint') }}
              <span class="ml-1 text-gray-400 font-mono">{{ shortcuts.hostSwitcher }}</span>
            </div>
          </NTooltip>

          <NTooltip
            trigger="hover"
            placement="right"
            :delay="300"
          >
            <template #trigger>
              <button
                class="flex h-10 w-10 items-center justify-center rounded-xl border border-transparent text-gray-500 transition-colors hover:border-gray-700 hover:bg-[#1c1d21] hover:text-white"
                @click="showDiagnostics = true"
              >
                <TerminalRailIcon
                  viewBox="0 0 24 24"
                  class="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  name="diagnostics"
                />
              </button>
            </template>
            <div class="text-xs">
              {{ $t('terminal.diagnostics.button') }}
            </div>
          </NTooltip>
        </div>
      </div>

      <transition name="slide">
        <div
          v-if="activeSidebarPanel"
          v-show="!isTerminalFocusMode"
          :style="{ width: resolvedSidebarPanelWidth + 'px', order: 30 }"
          class="na-card shrink-0 overflow-hidden flex flex-col relative"
          :class="isSidebarRailOnRight ? 'border-l border-gray-800' : 'border-r border-gray-800'"
        >
          <div
            class="absolute top-0 bottom-0 w-1 z-10 cursor-col-resize hover:bg-blue-500/60 transition-colors"
            :class="isSidebarRailOnRight ? 'left-0' : 'right-0'"
            @mousedown.prevent="startFilePanelResize"
          />
          <div
            class="na-card flex items-center justify-between gap-2 border-b border-gray-800 px-4 py-3 shrink-0"
            data-terminal-sidebar-header="true"
          >
            <div class="min-w-0">
              <div class="text-sm font-semibold text-white">
                {{ activeSidebarPanelTitle }}
              </div>
              <div class="text-[11px] text-gray-400">
                <template v-if="activeSidebarPanel === 'files'">
                  {{ activeHostName }}
                </template>
                <template v-else-if="activeSidebarPanel === 'snippets'">
                  {{ $t('snippets.panelHint') }}
                </template>
                <template v-else>
                  {{ $t('tunnels.panelHint') }}
                </template>
              </div>
            </div>
            <div class="flex items-center gap-1">
              <NTooltip
                v-if="activeSidebarPanel === 'files' && activeHostId !== null && activeSupportsSftp"
                trigger="hover"
                placement="bottom"
                :delay="300"
              >
                <template #trigger>
                  <NButton
                    size="small"
                    text
                    class="px-1.5 text-gray-500 hover:text-blue-400 transition-colors"
                    @click="openDedicatedFiles"
                  >
                    ⛶
                  </NButton>
                </template>
                {{ $t('terminal.openFilesFullscreen') }}
              </NTooltip>
              <NButton
                size="small"
                text
                class="px-1.5 text-gray-500 hover:text-white transition-colors"
                @click="setActiveSidebarPanel(null)"
              >
                ✕
              </NButton>
            </div>
          </div>

          <TerminalFilesPanel
            v-if="activeSidebarPanel === 'files' && activeHostId !== null && activeSupportsSftp"
            :host-id="activeHostId"
            :session-id="activeSessionId"
            class="flex-1 min-h-0"
          />

          <SnippetsPanel
            v-else-if="activeSidebarPanel === 'snippets'"
            :read-only="trialResources !== null"
            class="flex-1 min-h-0"
            @send="(payload) => sendSnippetToActiveTerminal(payload.execution, payload.snippetId)"
            @queue="(payload) => enqueueSnippetToActiveTerminal(payload.execution, payload.snippetId)"
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
        ref="splitAreaEl"
        class="split-area relative m-2 flex-1 overflow-hidden min-w-0 rounded-md border border-gray-800/80"
        :class="hasAnySplit ? 'grid gap-px bg-gray-800 p-px' : 'relative flex bg-[#1a1b1e]'"
        :style="[hasAnySplit ? splitGridStyle : undefined, { order: isSidebarRailOnRight ? 20 : 40 }]"
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

        <template
          v-for="(tabId, slotIndex) in splitPaneOrder"
          :key="`empty-split-${slotIndex}`"
        >
          <div
            v-if="hasAnySplit && tabId === null"
            class="flex min-h-0 min-w-0 flex-col items-center justify-center gap-3 overflow-hidden border border-dashed border-gray-700 bg-[#16171a] p-4 text-center"
            :style="{ order: slotIndex }"
            data-terminal-split-empty="true"
            :data-terminal-split-slot="slotIndex"
          >
            <div class="text-sm font-medium text-gray-300">
              {{ $t('terminal.splitEmptyTitle') }}
            </div>
            <div class="max-w-xs text-xs text-gray-500">
              {{ $t('terminal.splitEmptyDescription') }}
            </div>
            <NButton
              size="small"
              type="primary"
              @click="openSplitSlotPicker(slotIndex)"
            >
              {{ $t('terminal.splitChooseSession') }}
            </NButton>
          </div>
        </template>

        <div
          v-for="tab in termStore.tabs"
          v-show="isTerminalPaneVisible(tab.id)"
          :key="tab.id"
          :class="terminalPaneShellClass(tab.id)"
          :style="hasAnySplit ? terminalPaneShellStyle(tab.id) : undefined"
          @mousedown="focusTab(tab.id)"
        >
          <template v-if="hasAnySplit && splitTabIds.includes(tab.id)">
            <div
              class="flex items-center border-b px-3 py-1 shrink-0 transition-colors"
              :class="tab.id === termStore.activeId ? 'na-selection-active' : 'bg-[#18181c] border-gray-800'"
              :data-terminal-split-pane="tab.id"
              :data-terminal-host-id="tab.hostId"
              :data-terminal-active="tab.id === termStore.activeId ? 'true' : 'false'"
              draggable="true"
              :title="$t('terminal.splitReorderHint')"
              @dragstart.stop="onSplitPaneDragStart($event, tab.id)"
              @dragend.stop="draggedSplitTabId = null"
              @dragover.prevent.stop
              @drop="onSplitPaneDrop($event, tab.id)"
              @click="focusSplitPaneAfterPointer(tab.id, $event)"
              @dblclick.stop="openRenameTab(tab.id)"
            >
              <span
                class="mr-2 cursor-grab select-none text-xs text-gray-500"
                aria-hidden="true"
              >⠿</span>
              <span
                class="w-2 h-2 rounded-full shrink-0 mr-2"
                :class="isGraphicalTab(tab) ? 'bg-blue-400' : splitDotClass(splitPaneStatus[tab.id] ?? tabStatus[tab.id])"
              />
              <span
                class="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold mr-2 shrink-0"
                :class="tab.id === termStore.activeId ? 'bg-blue-500/20 text-blue-200' : 'bg-gray-700/70 text-gray-300'"
              >
                P{{ splitPaneOrder.indexOf(tab.id) + 1 }}
              </span>
              <span class="text-xs text-gray-300 truncate flex-1">{{ terminalTabLabel(tab) }}</span>
              <NButton
                size="tiny"
                text
                class="mr-1 text-gray-500 hover:text-white"
                :aria-label="$t('terminal.renameTab')"
                :title="$t('terminal.renameTab')"
                @click.stop="openRenameTab(tab.id)"
              >
                ✎
              </NButton>
              <NTooltip
                v-if="tab.unreadCount"
                trigger="hover"
                placement="top"
              >
                <template #trigger>
                  <span
                    class="inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full text-[10px] font-semibold px-1 mr-2"
                    style="background: rgba(251,146,60,0.18); color: #fdba74;"
                    role="status"
                    :aria-label="$t(tab.unreadCount === 1 ? 'terminal.unreadActivityOne' : 'terminal.unreadActivityOther', { count: tab.unreadCount })"
                  >
                    {{ tab.unreadCount > 99 ? '99+' : tab.unreadCount }}
                  </span>
                </template>
                {{ $t(tab.unreadCount === 1 ? 'terminal.unreadActivityOne' : 'terminal.unreadActivityOther', { count: tab.unreadCount }) }}
              </NTooltip>
              <NButton
                v-if="splitGridTabs.findIndex((item) => item.id === tab.id) > 0"
                size="tiny"
                text
                class="text-gray-500 hover:text-white"
                :aria-label="$t('terminal.movePaneEarlier')"
                :title="$t('terminal.movePaneEarlier')"
                @click.stop="shiftVisibleSplitPane(tab.id, -1)"
              >
                ←
              </NButton>
              <NButton
                v-if="splitGridTabs.findIndex((item) => item.id === tab.id) < splitGridTabs.length - 1"
                size="tiny"
                text
                class="text-gray-500 hover:text-white"
                :aria-label="$t('terminal.movePaneLater')"
                :title="$t('terminal.movePaneLater')"
                @click.stop="shiftVisibleSplitPane(tab.id, 1)"
              >
                →
              </NButton>
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
                  <NTag
                    v-else-if="activeStartupSnippetBanner.state === 'running'"
                    size="small"
                    type="info"
                  >
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
                  <div class="text-sm font-semibold text-blue-100">
                    {{ $t('terminal.adminClosedTitle') }}
                  </div>
                  <div class="mt-1 text-xs leading-relaxed text-blue-100/80">
                    {{ $t('terminal.adminClosedDescription') }}
                  </div>
                </div>
                <div class="flex shrink-0 flex-wrap items-center gap-2">
                  <NButton
                    size="small"
                    secondary
                    @click.stop="goBackFromTerminal"
                  >
                    {{ $t('terminal.adminClosedBack') }}
                  </NButton>
                  <NButton
                    size="small"
                    type="primary"
                    @click.stop="closeTab(tab.id)"
                  >
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
              />
            </div>
            <TerminalPane
              v-else
              :ref="(el: unknown) => { paneRefs[tab.id] = el as TerminalPaneHandle | null }"
              :tab-id="tab.id"
              :ended-actions="true"
              :host-id="tab.hostId"
              :connect-in-background="tab.connectInBackground"
              :visible="isTerminalPaneVisible(tab.id)"
              :compact="hasAnySplit"
              :minimal="isTerminalFocusMode"
              :ai-prefix-enabled="deviceCapabilities(tab.deviceProfile).serverAutomation && terminalAiAvailable"
              :autocomplete-enabled="deviceCapabilities(tab.deviceProfile).serverAutomation && terminalAutocompleteLicensed && termSettings.autocompleteEnabled"
              class="absolute inset-0"
              @close-ended="closeTab(tab.id); router.push({ name: 'dashboard' })"
              @connected="(name) => onConnected(tab.id, name)"
              @session-change="(value) => onSessionChange(tab.id, value)"
              @status-change="(s) => onPaneStatusChange(tab.id, s)"
              @error-change="(value) => onErrorChange(tab.id, value)"
              @error-code-change="(code) => onErrorCodeChange(tab.id, code)"
              @latency-change="(ms) => onLatencyChange(tab.id, ms)"
              @tunnels-change="(state) => onTunnelsChange(tab.id, state)"
              @host-key-verification-required="(challenge) => onHostKeyVerificationRequired(tab.id, challenge)"
              @credentials-required="(challenge) => onCredentialsRequired(tab.id, challenge)"
              @save-password-offer="(offer) => onSavePasswordOffer(tab.id, offer)"
              @output="(chunk) => onTerminalOutput(tab.id, chunk)"
              @host-switcher-requested="openPicker"
              @ai-prefix-requested="mode => openTerminalAiFromPrefix(tab.id, mode)"
              @snippet-quick-picker-requested="openSnippetQuickPicker"
              @connection-route-change="(method, agentName) => onConnectionRouteChange(tab.id, method, agentName)"
            />
          </div>
        </div>

        <div
          v-if="canResizeSplitGrid"
          class="group absolute bottom-0 top-0 z-40 w-3 -translate-x-1/2 cursor-col-resize touch-none pointer-events-auto"
          :style="splitColumnHandleStyle"
          role="separator"
          aria-orientation="vertical"
          :aria-label="$t('terminal.resizeSplitColumns')"
          :aria-valuenow="Math.round(splitColumnRatio * 100)"
          aria-valuemin="20"
          aria-valuemax="80"
          tabindex="0"
          data-terminal-split-resizer="column"
          @pointerdown="startSplitResize('column', $event)"
          @keydown="onSplitSeparatorKey('column', $event)"
        >
          <span class="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-blue-400 group-focus:bg-blue-400" />
        </div>
        <div
          v-if="canResizeSplitGrid && splitSlotCount > 2"
          class="group absolute right-0 z-40 h-3 -translate-y-1/2 cursor-row-resize touch-none pointer-events-auto"
          :style="splitRowHandleStyle"
          role="separator"
          aria-orientation="horizontal"
          :aria-label="$t('terminal.resizeSplitRows')"
          :aria-valuenow="Math.round(splitRowRatio * 100)"
          aria-valuemin="20"
          aria-valuemax="80"
          tabindex="0"
          data-terminal-split-resizer="row"
          @pointerdown="startSplitResize('row', $event)"
          @keydown="onSplitSeparatorKey('row', $event)"
        >
          <span class="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-transparent transition-colors group-hover:bg-blue-400 group-focus:bg-blue-400" />
        </div>

        <NEmpty
          v-if="termStore.tabs.length === 0 && termStore.detached.length === 0"
          :description="$t('terminal.empty')"
          class="absolute inset-0 flex flex-col items-center justify-center"
        >
          <template #extra>
            <NButton
              type="primary"
              @click="openPicker"
            >
              {{ $t('terminal.connectHost') }}
            </NButton>
          </template>
        </NEmpty>

        <div
          v-else-if="termStore.tabs.length === 0 && termStore.detached.length > 0"
          class="absolute inset-0 flex items-center justify-center p-6"
        >
          <div class="w-full max-w-xl rounded-md border border-gray-800 bg-[#18181c] p-4">
            <div class="text-sm font-semibold text-white">
              {{ $t('terminal.popout.detachedTitle') }}
            </div>
            <div class="mt-1 text-xs text-gray-400">
              {{ $t('terminal.popout.detachedDescription') }}
            </div>

            <div class="mt-4 space-y-2">
              <div
                v-for="session in termStore.detached"
                :key="session.id"
                class="flex items-center gap-3 rounded border border-gray-800 bg-[#141417] px-3 py-2"
              >
                <span class="h-2 w-2 shrink-0 rounded-full bg-blue-400" />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-sm font-medium text-white">
                    {{ session.hostName }}
                  </div>
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
              <NButton
                type="primary"
                @click="openPicker"
              >
                {{ $t('terminal.connectHost') }}
              </NButton>
            </div>
          </div>
        </div>
      </div><!-- end split-area -->
    </div><!-- end flex terminals+sidebar -->

    <button
      v-if="isTerminalFocusMode"
      type="button"
      class="fixed right-3 top-3 z-[130] rounded-lg border border-white/15 bg-black/70 px-3 py-2 text-xs font-medium text-gray-200 shadow-lg backdrop-blur transition-colors hover:bg-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
      :aria-label="$t('terminal.displayMode.exitFocus')"
      data-terminal-exit-focus="true"
      @click="setTerminalDisplayMode('workspace')"
    >
      {{ $t('terminal.displayMode.exitFocus') }}
    </button>

    <div
      v-if="isBrowserFullscreen"
      class="fixed top-4 right-4 z-[120] flex items-center gap-2"
    >
      <NTooltip
        v-if="activeTunnelSummary"
        trigger="hover"
        placement="bottom"
      >
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

    <NModal
      :show="showSplitComposer"
      preset="card"
      :title="$t(splitTargetSlot === null ? 'terminal.splitComposerTitle' : 'terminal.splitReplaceTitle', { slot: (splitTargetSlot ?? 0) + 1 })"
      :to="terminalViewportEl ?? 'body'"
      style="width:min(620px, 94vw)"
      data-terminal-split-composer="true"
      @update:show="(show) => { if (!show) closeSplitComposer() }"
    >
      <template v-if="splitTargetSlot === null">
        <div class="text-sm text-gray-400">
          {{ $t('terminal.splitComposerDescription') }}
        </div>
        <div class="mt-3 grid max-h-[320px] grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
          <button
            v-for="tab in termStore.tabs"
            :key="tab.id"
            type="button"
            class="flex min-w-0 items-center gap-3 rounded border px-3 py-2 text-left transition-colors"
            :class="splitComposerSelection.includes(tab.id) ? 'border-blue-500/60 bg-blue-500/10' : splitComposerSelection.length >= maxPanes ? 'cursor-not-allowed border-gray-800 opacity-45' : 'border-gray-700 hover:border-gray-500'"
            :disabled="!splitComposerSelection.includes(tab.id) && splitComposerSelection.length >= maxPanes"
            :aria-pressed="splitComposerSelection.includes(tab.id)"
            :data-terminal-split-option="tab.hostId"
            @click="toggleSplitComposerTab(tab.id)"
          >
            <span
              class="h-2 w-2 shrink-0 rounded-full"
              :class="tabStatus[tab.id] === 'connected' ? 'bg-green-400' : 'bg-gray-500'"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm text-white">{{ terminalTabLabel(tab) }}</span>
              <span class="block truncate text-[11px] text-gray-500">{{ tab.hostIp ?? $t('terminal.tabSearch.noEndpoint') }}</span>
            </span>
            <span
              v-if="splitComposerSelection.includes(tab.id)"
              class="text-xs font-semibold text-blue-300"
            >
              {{ splitComposerSelection.indexOf(tab.id) + 1 }}
            </span>
          </button>
        </div>
        <div
          class="mt-2 text-xs"
          :class="canApplySplitComposition ? 'text-gray-400' : 'text-amber-400'"
        >
          {{ $t('terminal.splitSelectionCount', { count: splitComposerSelection.length, max: maxPanes }) }}
        </div>

        <div class="mt-5 border-t border-gray-800 pt-4">
          <div class="text-sm font-medium text-white">
            {{ $t('terminal.splitGroupsTitle') }}
          </div>
          <div class="mt-2 flex gap-2">
            <NInput
              v-model:value="splitGroupName"
              size="small"
              maxlength="60"
              :placeholder="$t('terminal.splitGroupNamePlaceholder')"
              @keyup.enter="saveCurrentSplitGroup"
            />
            <NButton
              size="small"
              :disabled="!splitGroupName.trim() || splitComposerSelection.length < 2"
              @click="saveCurrentSplitGroup"
            >
              {{ $t('terminal.splitGroupSave') }}
            </NButton>
          </div>
          <div
            v-if="splitGroups.length"
            class="mt-3 space-y-2"
          >
            <div
              v-for="group in splitGroups"
              :key="group.id"
              class="flex items-center gap-2 rounded border border-gray-800 px-3 py-2"
            >
              <button
                type="button"
                class="min-w-0 flex-1 text-left"
                @click="selectSplitGroup(group)"
              >
                <span class="block truncate text-sm text-gray-200">{{ group.name }}</span>
                <span class="block text-[11px] text-gray-500">{{ $t('terminal.splitGroupHosts', { count: group.hostIds.length }) }}</span>
              </button>
              <NButton
                size="tiny"
                text
                type="error"
                :aria-label="$t('terminal.splitGroupDelete', { name: group.name })"
                @click="deleteSplitGroup(group.id)"
              >
                ✕
              </NButton>
            </div>
          </div>
          <div
            v-else
            class="mt-2 text-xs text-gray-500"
          >
            {{ $t('terminal.splitGroupsEmpty') }}
          </div>
        </div>
      </template>

      <template v-else>
        <div class="text-sm text-gray-400">
          {{ $t('terminal.splitReplaceDescription') }}
        </div>
        <div class="mt-3 max-h-[360px] space-y-2 overflow-y-auto">
          <button
            v-for="tab in termStore.tabs.filter((candidate) => !splitTabIds.includes(candidate.id))"
            :key="tab.id"
            type="button"
            class="flex w-full min-w-0 items-center gap-3 rounded border px-3 py-2 text-left transition-colors"
            :class="splitReplacementTabId === tab.id ? 'border-blue-500/60 bg-blue-500/10' : 'border-gray-700 hover:border-gray-500'"
            :aria-pressed="splitReplacementTabId === tab.id"
            :data-terminal-split-replacement="tab.hostId"
            @click="splitReplacementTabId = tab.id"
          >
            <span
              class="h-2 w-2 shrink-0 rounded-full"
              :class="tabStatus[tab.id] === 'connected' ? 'bg-green-400' : 'bg-gray-500'"
            />
            <span class="min-w-0 flex-1 truncate text-sm text-white">{{ terminalTabLabel(tab) }}</span>
          </button>
          <NEmpty
            v-if="termStore.tabs.every((candidate) => splitTabIds.includes(candidate.id))"
            :description="$t('terminal.splitNoAvailableSessions')"
          />
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton @click="closeSplitComposer">
            {{ $t('common.cancel') }}
          </NButton>
          <NButton
            v-if="splitTargetSlot === null"
            type="primary"
            :disabled="!canApplySplitComposition"
            data-terminal-action="apply-split"
            @click="applySplitComposition"
          >
            {{ $t('terminal.splitApply') }}
          </NButton>
          <NButton
            v-else
            type="primary"
            :disabled="!splitReplacementTabId"
            data-terminal-action="replace-split-slot"
            @click="applySplitSlotReplacement"
          >
            {{ $t('terminal.splitChooseSession') }}
          </NButton>
        </div>
      </template>
    </NModal>

    <NModal
      :show="renameTabId !== null"
      preset="card"
      :title="$t('terminal.renameTab')"
      :to="terminalViewportEl ?? 'body'"
      style="width:min(460px, 92vw)"
      data-terminal-rename-modal="true"
      @update:show="(show) => { if (!show) closeRenameTab() }"
    >
      <NInput
        ref="renameTabInput"
        v-model:value="renameTabValue"
        :placeholder="renamingTab?.hostName ?? $t('terminal.renameTabPlaceholder')"
        maxlength="80"
        clearable
        @keyup.enter="saveRenamedTab"
        @keyup.esc="closeRenameTab"
      />
      <div class="mt-2 text-xs text-gray-400">
        {{ $t('terminal.renameTabHint', { host: renamingTab?.hostName ?? '—' }) }}
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <NButton @click="closeRenameTab">
            {{ $t('common.cancel') }}
          </NButton>
          <NButton
            type="primary"
            @click="saveRenamedTab"
          >
            {{ $t('common.save') }}
          </NButton>
        </div>
      </template>
    </NModal>

    <!-- ── Modal: seleção de host ──────────────────────────────────────── -->
    <NModal
      v-model:show="showPicker"
      data-terminal-host-switcher="true"
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
      <NAlert
        v-if="pickerLoadError"
        type="error"
        class="mb-3"
        :bordered="false"
      >
        {{ pickerLoadError }}
      </NAlert>
      <NSpin :show="pickerLoading">
        <NEmpty
          v-if="!pickerLoading && !filteredHosts.length"
          :description="$t('terminal.hostSwitcherEmpty')"
        />
        <div
          v-else
          :id="pickerListboxId"
          role="listbox"
          class="max-h-[420px] overflow-y-auto rounded border border-gray-800 bg-[#111113] p-1"
        >
          <button
            v-for="(host, index) in filteredHosts"
            :id="`terminal-host-switcher-option-${host.id}`"
            :key="host.id"
            :ref="(el) => setPickerOptionRef(el, index)"
            type="button"
            role="option"
            :aria-selected="index === pickerSelectedIndex"
            :aria-disabled="!canOpenHostInConsole(host)"
            :title="!canOpenHostInConsole(host) ? $t('terminal.hostSwitcherProtocolPending', { protocol: hostProtocolLabel(host) }) : undefined"
            class="w-full rounded px-3 py-2 text-left transition-colors focus:outline-hidden"
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
                  <NTag
                    size="small"
                    round
                    :type="hostConnectionModeTagType(host)"
                  >
                    {{ hostConnectionModeLabel(host) }}
                  </NTag>
                  <NTag
                    size="small"
                    round
                    :type="isTerminalProtocolSupported(host) ? (host.accessProtocol === 'telnet' ? 'warning' : 'success') : isGraphicalProtocolSupported(host) ? 'info' : 'default'"
                  >
                    {{ hostProtocolLabel(host) }}
                  </NTag>
                  <NTag
                    v-if="!canOpenHostInConsole(host)"
                    size="small"
                    round
                    type="default"
                  >
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
                  <NTag
                    v-if="favoriteHostIds.includes(host.id)"
                    size="small"
                    type="warning"
                    round
                  >
                    {{ $t('terminal.hostSwitcherFavorite') }}
                  </NTag>
                  <NTag
                    v-else-if="recentHostIds.includes(host.id)"
                    size="small"
                    type="info"
                    round
                  >
                    {{ $t('terminal.hostSwitcherRecent') }}
                  </NTag>
                </div>
                <div class="mt-0.5 truncate font-mono text-xs text-gray-400">
                  {{ host.ip }}:{{ host.port }}
                </div>
                <div
                  v-if="host.accessProtocol === 'telnet'"
                  class="mt-1 text-xs text-yellow-300"
                >
                  {{ $t('terminal.telnetSecurityWarning') }}
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <NTag
                  v-if="host.accessProtocol === 'ssh'"
                  size="small"
                >
                  {{ host.authType === 'pem' ? '🔑 PEM' : host.authType === 'pem_password' ? '🔑+🔒 PEM + Senha' : '🔒 Senha' }}
                </NTag>
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

        <div
          v-if="snippetQuickLoading"
          class="py-8 flex justify-center"
        >
          <NSpin />
        </div>

        <div
          v-else-if="snippetQuickError"
          class="space-y-2"
        >
          <NAlert
            type="error"
            :title="$t('snippets.quickPicker.loadError')"
          />
          <NButton
            size="small"
            @click="loadSnippetQuickItems({ fresh: true })"
          >
            {{ $t('snippets.quickPicker.retry') }}
          </NButton>
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
            :id="`terminal-snippet-quick-picker-option-${snippet.id}`"
            :key="snippet.id"
            :ref="(el) => setSnippetQuickOptionRef(el, index)"
            type="button"
            role="option"
            :aria-selected="index === snippetQuickSelectedIndex"
            class="w-full px-4 py-3 text-left transition-colors focus:outline-hidden"
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
              <NTooltip
                v-if="snippetSecretAliases(snippet).length > 0"
                trigger="hover"
              >
                <template #trigger>
                  <NTag
                    size="small"
                    round
                    type="warning"
                  >
                    {{ $t('snippets.usesSecret') }}
                  </NTag>
                </template>
                {{ $t('snippets.usesSecretAliases', { aliases: snippetSecretAliases(snippet).join(', ') }) }}
              </NTooltip>
            </div>
            <div class="mt-1 text-xs font-mono text-green-400 truncate">
              {{ snippetPreview(snippet) }}
            </div>
            <div
              v-if="snippet.description"
              class="mt-1 text-xs text-gray-500 truncate"
            >
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
              <div class="text-sm text-white">
                {{ item.label }}
              </div>
              <div class="text-xs text-gray-400 break-all">
                {{ item.value }}
              </div>
            </div>
          </div>
        </NCard>
      </div>
    </NModal>

    <TerminalCommandSuggestion
      v-if="quickAiTarget"
      :key="quickAiTarget.tabId + ':' + quickAiTarget.sessionId"
      :host-id="quickAiTarget.hostId"
      :host-name="quickAiTarget.hostName"
      :initial-question="quickAiDraft"
      :get-anchor="paneRefs[quickAiTarget.tabId]?.getAiAnchor"
      @draft="quickAiDraft = $event"
      @close="closeQuickAi()"
      @insert="insertQuickAi"
      @context="openContextFromQuick"
    />

    <section
      v-if="showTerminalAiModal"
      data-testid="terminal-inline-ai"
      class="fixed bottom-3 right-3 z-[80] max-h-[min(78vh,760px)] w-[min(840px,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-blue-400/25 bg-[var(--na-surface)] p-4 shadow-2xl backdrop-blur"
      role="dialog"
      aria-modal="false"
      :aria-label="$t('terminal.ai.modalTitle')"
      @keydown.esc.stop.prevent="showTerminalAiModal = false"
    >
      <div class="mb-3 flex items-center justify-between gap-3">
        <div>
          <div class="text-sm font-semibold text-white">
            {{ $t('terminal.ai.modalTitle') }}
          </div><div class="text-xs text-zinc-500">
            Ctrl/Cmd+Shift+I
          </div>
        </div>
        <NButton
          quaternary
          circle
          size="small"
          aria-label="Fechar assistente"
          @click="showTerminalAiModal = false"
        >
          ✕
        </NButton>
      </div>
      <div class="space-y-4">
        <NAlert
          type="info"
          :show-icon="false"
        >
          {{ $t('terminal.ai.modalInfo', { prefix: '@ai' }) }}
        </NAlert>

        <NCard
          size="small"
          :bordered="false"
          style="background:var(--na-surface-soft);"
        >
          <div class="grid gap-3 md:grid-cols-3 text-xs">
            <div>
              <div class="text-gray-500 mb-1">
                {{ $t('terminal.ai.activeHost') }}
              </div>
              <div class="text-gray-200 break-all">
                {{ activeTerminalTab?.hostName ?? '—' }}
              </div>
            </div>
            <div>
              <div class="text-gray-500 mb-1">
                {{ $t('terminal.ai.activeSession') }}
              </div>
              <div class="text-gray-200">
                {{ activeSessionId ?? '—' }}
              </div>
            </div>
            <div>
              <div class="text-gray-500 mb-1">
                {{ $t('terminal.ai.selectionState') }}
              </div>
              <div class="text-gray-200">
                {{ getActiveTerminalContext()?.selection ? $t('terminal.ai.selectionAvailable') : $t('terminal.ai.selectionEmpty') }}
              </div>
            </div>
          </div>
        </NCard>

        <label class="block text-sm">
          {{ $t('terminal.ai.context.label') }}
          <select
            v-model="terminalAiContextMode"
            data-testid="terminal-ai-context-mode"
            class="ml-2 rounded border bg-[var(--na-surface-soft)] p-2 text-white"
          >
            <option
              v-for="mode in ['none','selection','recent','both']"
              :key="mode"
              :value="mode"
            >{{ $t('terminal.ai.context.' + mode) }}</option>
          </select>
        </label>
        <p class="text-xs text-gray-400">
          {{ $t('terminal.ai.context.limit') }}
        </p>
        <NAlert
          v-if="terminalAiFailureState"
          type="error"
          data-testid="terminal-ai-error"
        >
          {{ $t('terminal.ai.failures.' + terminalAiFailureState) }}
        </NAlert>

        <div class="flex flex-wrap gap-2">
          <NButton
            size="small"
            tertiary
            @click="applyTerminalAiSuggestion('selection')"
          >
            {{ $t('terminal.ai.suggestionSelection') }}
          </NButton>
          <NButton
            size="small"
            tertiary
            @click="applyTerminalAiSuggestion('buffer')"
          >
            {{ $t('terminal.ai.suggestionBuffer') }}
          </NButton>
          <NButton
            size="small"
            tertiary
            @click="applyTerminalAiSuggestion('error')"
          >
            {{ $t('terminal.ai.suggestionError') }}
          </NButton>
          <NButton
            size="small"
            tertiary
            type="success"
            @click="requestTerminalCommand"
          >
            {{ $t('terminal.ai.suggestionCommand') }}
          </NButton>
          <NButton
            size="small"
            tertiary
            type="warning"
            @click="requestTerminalScript"
          >
            {{ $t('terminal.ai.suggestionScript') }}
          </NButton>
        </div>

        <div class="flex items-center gap-2 text-xs text-gray-400">
          <span>{{ $t('terminal.ai.responseMode') }}</span>
          <NTag
            size="small"
            :type="terminalAiIntent === 'explain' ? 'info' : terminalAiIntent === 'command' ? 'success' : 'warning'"
          >
            {{ $t(`terminal.ai.intent.${terminalAiIntent}`) }}
          </NTag>
        </div>

        <NInput
          ref="terminalAiPromptInput"
          v-model:value="terminalAiPrompt"
          data-testid="terminal-ai-prompt"
          :maxlength="1000"
          type="textarea"
          :rows="4"
          :placeholder="$t('terminal.ai.placeholder')"
          @keydown.ctrl.enter.prevent="submitTerminalAiPrompt"
        />

        <div class="flex justify-end gap-2">
          <NButton
            v-if="terminalAiLoading"
            data-testid="terminal-ai-cancel"
            @click="cancelTerminalAiRequest"
          >
            {{ $t('terminal.ai.cancel') }}
          </NButton>
          <NButton
            data-testid="terminal-ai-send"
            type="primary"
            :disabled="!terminalAiAvailable || terminalAiLoading || !canAnalyzeActiveTerminal || terminalAiPrompt.trim().length < 3 || (!!terminalAiFailureState && !canRetryTerminalAi(terminalAiFailureState))"
            :loading="terminalAiLoading"
            @click="submitTerminalAiPrompt"
          >
            {{ $t(terminalAiFailureState && canRetryTerminalAi(terminalAiFailureState) ? 'terminal.ai.retry' : 'terminal.ai.send') }}
          </NButton>
        </div>

        <div class="max-h-[360px] overflow-y-auto space-y-3">
          <NEmpty
            v-if="terminalAiHistory.length === 0"
            :description="$t('terminal.ai.empty')"
          />
          <NCard
            v-for="(item, index) in terminalAiHistory"
            :key="`${item.role}-${index}`"
            size="small"
            :bordered="false"
            style="background:var(--na-surface-soft);"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="text-xs uppercase tracking-[0.16em] text-gray-500">
                {{ item.role === 'assistant' ? $t('terminal.ai.roleAssistant') : $t('terminal.ai.roleUser') }}
              </div>
              <div
                v-if="item.provider"
                class="text-xs text-gray-500"
              >
                {{ item.provider }}
              </div>
            </div>
            <div class="mt-2 whitespace-pre-wrap break-words text-sm text-gray-200">
              {{ item.text }}
            </div>
            <template v-if="item.assist">
              <div class="mt-3 flex flex-wrap items-center gap-2">
                <NTag
                  size="small"
                  :type="item.assist.risk === 'safe' ? 'success' : item.assist.risk === 'blocked' ? 'error' : item.assist.risk === 'approval_required' ? 'warning' : 'default'"
                >
                  {{ $t(`terminal.ai.risk.${item.assist.risk}`) }}
                </NTag>
                <NTag size="small">
                  {{ $t(`terminal.ai.kind.${item.assist.kind}`) }}
                </NTag>
              </div>
              <NAlert
                v-for="warning in item.assist.warnings"
                :key="warning"
                class="mt-2"
                :type="item.assist.risk === 'blocked' ? 'error' : 'warning'"
                :show-icon="false"
              >
                {{ warning }}
              </NAlert>
              <pre
                v-if="item.assist.content"
                class="mt-3 max-h-56 overflow-auto rounded-lg border border-white/10 bg-[var(--na-surface-soft)] p-3 text-xs text-gray-200 whitespace-pre-wrap break-words"
              >{{ item.assist.content }}</pre>
              <div
                v-if="item.assist.content"
                class="mt-3 flex flex-wrap justify-end gap-2"
              >
                <NButton
                  size="small"
                  secondary
                  @click="copyTerminalAssistContent(item.assist.content)"
                >
                  {{ $t('terminal.ai.copy') }}
                </NButton>
                <NButton
                  v-if="canInsertTerminalAiCommand(item.assist)"
                  size="small"
                  type="primary"
                  @click="insertTerminalAssistCommand(item.assist, item.tabId, item.sessionId)"
                >
                  {{ $t('terminal.ai.insertWithoutExecute') }}
                </NButton>
                <NButton
                  v-if="item.assist.kind === 'script' && !item.artifact"
                  size="small"
                  type="warning"
                  :loading="item.artifactLoading"
                  @click="createGovernedScript(item)"
                >
                  {{ $t('terminal.ai.createArtifact') }}
                </NButton>
                <NButton
                  v-if="item.artifact && !item.actionRunId"
                  size="small"
                  type="primary"
                  :loading="item.artifactLoading"
                  @click="requestGovernedScriptExecution(item)"
                >
                  {{ $t('terminal.ai.requestApproval') }}
                </NButton>
              </div>
              <NAlert
                v-if="item.artifact"
                class="mt-3"
                type="success"
                :show-icon="false"
              >
                {{ $t('terminal.ai.artifactReady', { destination: item.artifact.destination, checksum: item.artifact.checksum.slice(0, 12), run: item.actionRunId ?? '—' }) }}
              </NAlert>
            </template>
            <div
              v-if="item.citations?.length"
              class="mt-3 space-y-1"
            >
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
    </section>

    <NModal
      :show="!!shareResult"
      preset="card"
      style="width:min(620px, 94vw)"
      :title="shareResult ? $t(`sharing.${shareResult.mode}.title`) : ''"
      :bordered="false"
      data-testid="share-result-dialog"
      @update:show="(value) => { if (!value) shareResult = null }"
    >
      <div
        v-if="shareResult"
        class="space-y-4"
      >
        <NAlert
          :type="shareResult.mode === 'public_once' ? 'warning' : 'info'"
          :show-icon="true"
        >
          {{ $t(`sharing.${shareResult.mode}.description`) }}
        </NAlert>

        <div>
          <label
            for="terminal-share-link"
            class="mb-1.5 block text-xs font-medium uppercase tracking-[0.14em] text-gray-400"
          >
            {{ $t('sharing.linkLabel') }}
          </label>
          <div class="flex flex-col gap-2 sm:flex-row">
            <NInput
              id="terminal-share-link"
              :value="shareResult.url"
              readonly
              data-testid="share-result-link"
            />
            <NButton
              type="primary"
              data-testid="share-copy-link"
              @click="copyShareValue(shareResult.url, 'link')"
            >
              {{ shareCopyStatus === 'link' ? $t('sharing.copied') : $t('sharing.copyLink') }}
            </NButton>
          </div>
        </div>

        <div
          v-if="shareResult.mode === 'public_once' && shareResult.pin"
          class="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4"
          data-testid="share-result-pin-panel"
        >
          <div class="text-xs font-medium uppercase tracking-[0.14em] text-amber-300">
            {{ $t('sharing.pinLabel') }}
          </div>
          <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
            <code
              class="text-2xl font-semibold tracking-[0.28em] text-white"
              data-testid="share-result-pin"
            >{{ shareResult.pin }}</code>
            <NButton
              secondary
              type="warning"
              data-testid="share-copy-pin"
              @click="copyShareValue(shareResult.pin!, 'pin')"
            >
              {{ shareCopyStatus === 'pin' ? $t('sharing.copied') : $t('sharing.copyPin') }}
            </NButton>
          </div>
          <p class="mt-2 text-xs text-amber-100/80">
            {{ $t('sharing.pinSeparateChannel') }}
          </p>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3 text-sm">
          <span class="text-gray-400">{{ $t('sharing.expiresAt', { date: $d(shareResult.expiresAt, 'short') }) }}</span>
          <NButton
            tertiary
            @click="shareResult = null"
          >
            {{ $t('common.close') }}
          </NButton>
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
        <NAlert
          type="info"
          :show-icon="false"
        >
          {{ $t('sharedSessions.manageHint') }}
        </NAlert>

        <NAlert
          v-if="sharedSessionManagerError"
          type="warning"
          :show-icon="false"
        >
          {{ $t('sharedSessions.refreshError') }}
          <NButton
            size="small"
            @click="loadCurrentSharedSession"
          >
            {{ $t('fileManager.retry') }}
          </NButton>
        </NAlert>
        <NSpin :show="sharedSessionManagerLoading">
          <div
            v-if="currentSharedSession"
            class="space-y-4"
          >
            <div class="flex flex-wrap items-center gap-2">
              <NTag
                size="small"
                type="success"
              >
                {{ currentSharedSession.hostName }}
              </NTag>
              <NTag
                v-if="currentSharedSession.hostDeleted"
                size="small"
                type="warning"
              >
                {{ $t('hosts.messages.hostDeleted') }}
              </NTag>
              <NTag
                size="small"
                :type="currentSharedSession.status === 'active' ? 'success' : 'warning'"
              >
                {{ $t(`sharedSessions.status.${currentSharedSession.status}`) }}
              </NTag>
              <NTag
                size="small"
                type="default"
              >
                {{ $t('sharedSessions.participantsBadge', { count: activeSharedSessionViewers.length }) }}
              </NTag>
            </div>

            <div
              class="space-y-2"
              data-testid="shared-session-viewers"
            >
              <p class="text-sm font-medium">
                {{ $t('sharedSessions.connectedViewers') }}
              </p>
              <p
                v-for="participant in activeSharedSessionViewers"
                :key="participant.userId"
                class="text-sm"
              >
                {{ participant.name }} <span class="text-gray-400">{{ participant.email }}</span>
              </p>
              <NEmpty
                v-if="!activeSharedSessionViewers.length"
                size="small"
                :description="$t('sharedSessions.noViewers')"
              />
              <NButton
                v-if="termStore.activeId && tabSharedSessionUrls[termStore.activeId]"
                secondary
                @click="showShareResult({ mode: 'live', url: tabSharedSessionUrls[termStore.activeId!]!, expiresAt: new Date(currentSharedSession.expiresAt) })"
              >
                {{ $t('sharedSessions.showLink') }}
              </NButton>
              <NButton
                v-if="isCurrentSharedSessionOwner"
                type="error"
                secondary
                :loading="sharedSessionManagerBusy"
                @click="stopCurrentSharing"
              >
                {{ $t('sharedSessions.stopSharing') }}
              </NButton>
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
              <div
                v-if="pendingSharedControlParticipants.length"
                class="space-y-2"
              >
                <div
                  v-for="participant in pendingSharedControlParticipants"
                  :key="`terminal-pending-${participant.userId}`"
                  class="rounded-xl border border-amber-900/50 bg-amber-950/20 px-3 py-3"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div>
                      <div class="text-sm text-white">
                        {{ participant.name }}
                      </div>
                      <div class="text-xs text-gray-400">
                        {{ participant.email || '—' }}
                      </div>
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
              <NEmpty
                v-else
                size="small"
                :description="$t('sharedSessions.noPendingRequests')"
              />
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
      <div
        v-if="hostKeyModal"
        class="space-y-4"
      >
        <NAlert
          type="warning"
          :show-icon="true"
        >
          {{ hostKeyModal.challenge.reason === 'changed'
            ? $t('terminal.hostKey.descriptionChanged', { host: hostKeyConnectionLabel })
            : $t('terminal.hostKey.descriptionUnknown', { host: hostKeyConnectionLabel }) }}
        </NAlert>

        <NAlert
          v-if="!hostKeyPolicyLoading && !hostKeyModal.canTrust"
          type="error"
          :show-icon="true"
        >
          {{ hostKeyPermissionMessage(hostKeyModal.hostScope) }}
        </NAlert>

        <NCard
          size="small"
          :bordered="false"
          style="background:#17171b;"
        >
          <div class="text-xs text-gray-400 mb-1">
            {{ $t('terminal.hostKey.host') }}
          </div>
          <div class="text-sm text-white font-medium break-all">
            {{ hostKeyModal.hostName }}
          </div>
          <div
            v-if="hostKeyModal.hostIp"
            class="mt-1 text-xs text-gray-400 font-mono break-all"
          >
            {{ hostKeyModal.hostIp }}:{{ hostKeyModal.hostPort ?? 22 }}
          </div>
        </NCard>

        <NCard
          v-if="hostKeyModal.challenge.trustedFingerprint"
          size="small"
          :bordered="false"
          style="background:#17171b;"
        >
          <div class="text-xs text-gray-400 mb-1">
            {{ $t('terminal.hostKey.trustedFingerprint') }}
          </div>
          <div class="text-sm text-white font-mono break-all">
            {{ hostKeyModal.challenge.trustedFingerprint }}
          </div>
        </NCard>

        <NCard
          size="small"
          :bordered="false"
          style="background:#17171b;"
        >
          <div class="mb-1 flex items-center gap-2">
            <div class="text-xs text-gray-400">
              {{ $t('terminal.hostKey.presentedFingerprint') }}
            </div>
            <NTooltip trigger="hover">
              <template #trigger>
                <button
                  type="button"
                  class="text-xs text-gray-500 hover:text-gray-300"
                >
                  ?
                </button>
              </template>
              {{ $t('terminal.hostKey.help') }}
            </NTooltip>
          </div>
          <div class="text-sm text-white font-mono break-all">
            {{ hostKeyModal.challenge.presentedFingerprint }}
          </div>
        </NCard>

        <div class="flex justify-end gap-2">
          <NButton
            :disabled="trustingHostKey"
            @click="closeHostKeyModal"
          >
            {{ $t('terminal.hostKey.cancel') }}
          </NButton>
          <NButton
            type="warning"
            :loading="trustingHostKey || hostKeyPolicyLoading"
            :disabled="hostKeyPolicyLoading || !hostKeyModal.canTrust"
            @click="trustHostKeyAndReconnect"
          >
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
      <div
        v-if="credentialsModal"
        class="space-y-4"
      >
        <NAlert
          type="info"
          :show-icon="true"
        >
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
        <template v-if="credentialsModal.challenge.needsPassword">
          <NSelect
            v-model:value="credentialSource"
            data-terminal-credential-source="true"
            :options="[
              { label: $t('terminal.credentialsChallenge.enterPassword'), value: 'password' },
              { label: $t('terminal.credentialsChallenge.useSecret'), value: 'secret' },
            ]"
            :aria-label="$t('terminal.credentialsChallenge.credentialSource')"
          />
          <NInput
            v-if="credentialSource === 'password'"
            id="cred-password-input"
            v-model:value="credPasswordInput"
            type="password"
            show-password-on="click"
            :placeholder="$t('terminal.credentialsChallenge.passwordPlaceholder')"
            :input-props="{ autocomplete: 'new-password' }"
            @keydown.enter="submitCredentialsChallenge"
          />
          <NSelect
            v-if="credentialSource === 'secret'"
            v-model:value="credentialSecretId"
            data-terminal-secret-select="true"
            :options="credentialSecretOptions"
            :loading="credentialSecretsLoading"
            filterable
            :placeholder="$t('terminal.credentialsChallenge.secretPlaceholder')"
            :aria-label="$t('terminal.credentialsChallenge.secretPlaceholder')"
          >
            <template #empty>
              {{ credentialSecretsError ? $t('terminal.credentialsChallenge.secretLoadError') : $t('terminal.credentialsChallenge.secretEmpty') }}
            </template>
          </NSelect>
        </template>
        <div class="flex justify-end gap-2">
          <NButton @click="cancelCredentialsChallenge">
            {{ $t('common.cancel') }}
          </NButton>
          <NButton
            type="primary"
            :disabled="(credentialsModal.challenge.needsUsername && !credUsernameInput) || (credentialsModal.challenge.needsPassword && (credentialSource === 'password' ? !credPasswordInput : !credentialSecretId))"
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
      <div
        v-if="savePasswordOfferModal"
        class="space-y-4"
      >
        <NAlert
          type="success"
          :show-icon="true"
        >
          {{ $t('terminal.savePassword.description', { host: savePasswordOfferModal.offer.hostName }) }}
        </NAlert>
        <NCard
          size="small"
          :bordered="false"
          style="background:#17171b;"
        >
          <div class="text-xs text-gray-400 mb-1">
            {{ $t('terminal.savePassword.secretName') }}
          </div>
          <div class="text-sm text-white font-mono">
            {{ savePasswordOfferModal.offer.secretName }}
          </div>
        </NCard>
        <div>
          <div class="text-xs text-gray-400 mb-1">
            {{ $t('terminal.savePassword.scope') }}
          </div>
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
          <NButton
            :disabled="savingPassword"
            @click="dismissSavePassword"
          >
            {{ $t('terminal.savePassword.skip') }}
          </NButton>
          <NButton
            type="primary"
            :loading="savingPassword"
            @click="acceptSavePassword"
          >
            {{ $t('terminal.savePassword.save') }}
          </NButton>
        </div>
      </div>
    </NModal>

    <NModal
      v-model:show="editHostModal"
      preset="card"
      :title="$t('terminal.editHost.title')"
      style="width:min(520px, calc(100vw - 32px))"
    >
      <NForm @submit.prevent="saveHostFromTerminal">
        <NFormItem :label="$t('terminal.editHost.name')">
          <NInput
            v-model:value="editHostForm.name"
            :disabled="editHostLoading"
            :input-props="{ 'aria-label': $t('terminal.editHost.name') }"
            autofocus
          />
        </NFormItem>
        <NFormItem :label="$t('terminal.editHost.address')">
          <NInput
            v-model:value="editHostForm.ip"
            :disabled="editHostLoading"
            :input-props="{ 'aria-label': $t('terminal.editHost.address') }"
          />
        </NFormItem>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NFormItem :label="$t('terminal.editHost.port')">
            <NInputNumber
              v-model:value="editHostForm.port"
              :min="1"
              :max="65535"
              :precision="0"
              :disabled="editHostLoading"
              :input-props="{ 'aria-label': $t('terminal.editHost.port') }"
              class="w-full"
            />
          </NFormItem>
          <NFormItem :label="$t('terminal.editHost.sshUser')">
            <NInput
              v-model:value="editHostForm.sshUser"
              :disabled="editHostLoading"
              :input-props="{ 'aria-label': $t('terminal.editHost.sshUser') }"
              autocomplete="username"
            />
          </NFormItem>
        </div>
        <NAlert
          v-if="editHostChangesConnection"
          type="warning"
          class="mb-4"
          :show-icon="true"
        >
          {{ $t('terminal.editHost.reconnectWarning') }}
        </NAlert>
        <div class="flex justify-end gap-2">
          <NButton
            :disabled="editHostLoading"
            @click="editHostModal = false"
          >
            {{ $t('common.cancel') }}
          </NButton>
          <NButton
            type="primary"
            attr-type="submit"
            :loading="editHostLoading"
          >
            {{ editHostChangesConnection ? $t('terminal.editHost.saveAndReconnect') : $t('terminal.editHost.save') }}
          </NButton>
        </div>
      </NForm>
    </NModal>

    <!-- Modal: configurar chave PEM -->
    <NModal
      :show="!!pemFixModal"
      preset="card"
      :title="pemFixModal ? $t('terminal.pemFix.title', { host: pemFixModal.hostName }) : ''"
      style="width: 520px"
      @update:show="(v) => { if (!v) pemFixModal = null }"
    >
      <div
        v-if="pemFixModal"
        class="space-y-4"
      >
        <template v-if="!canManageHosts">
          <NAlert
            type="warning"
            :title="$t('terminal.pemFix.noPermissionTitle')"
          >
            {{ $t('terminal.pemFix.noPermission') }}
          </NAlert>
          <div class="flex justify-end">
            <NButton @click="pemFixModal = null">
              {{ $t('common.close') }}
            </NButton>
          </div>
        </template>

        <template v-else>
          <p class="text-sm text-gray-400">
            {{ $t('terminal.pemFix.description') }}
          </p>

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
            <div
              v-if="pemFixMode === 'select'"
              class="space-y-2"
            >
              <NSelect
                v-model:value="pemFixKeyId"
                :options="pemKeyOptions"
                :placeholder="$t('terminal.pemFix.selectPlaceholder')"
                clearable
              />
            </div>

            <div
              v-else
              class="space-y-3"
            >
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
              <NInput
                v-model:value="pemFixNewPassphrase"
                type="password"
                show-password-on="click"
                autocomplete="new-password"
                :placeholder="$t('pemKeys.modal.passphrasePlaceholder')"
              />
              <NAlert
                v-if="pemFixKeyNeedsPassphrase"
                type="warning"
                :show-icon="true"
              >
                {{ $t('pemKeys.modal.encryptedDetected') }}
              </NAlert>
              <div class="flex items-center gap-2">
                <NButton
                  size="small"
                  @click="pemFixFileInput?.click()"
                >
                  {{ $t('terminal.pemFix.uploadFile') }}
                </NButton>
                <span class="text-xs text-gray-500">{{ $t('terminal.pemFix.uploadHint') }}</span>
                <input
                  ref="pemFixFileInput"
                  type="file"
                  accept=".pem,.key,.ppk,.txt"
                  class="hidden"
                  @change="onPemFixFileSelected"
                >
              </div>
            </div>
          </NSpin>

          <div class="flex justify-end gap-2 pt-1">
            <NButton @click="pemFixModal = null">
              {{ $t('common.cancel') }}
            </NButton>
            <NButton
              type="primary"
              :loading="pemFixLoading"
              @click="submitPemFix"
            >
              {{ $t('terminal.pemFix.saveAndReconnect') }}
            </NButton>
          </div>
        </template>
      </div>
    </NModal>
  </div>
</template>

<style scoped>
.terminal-tab {
  position: relative;
  flex: 1 1 150px;
  max-width: 220px;
}
.terminal-tab[data-dragging] {
  opacity: 0.45;
}
.terminal-tab-drop-marker {
  position: absolute;
  pointer-events: none;
  top: 1px;
  bottom: 1px;
  width: 4px;
  border-radius: 3px;
  background: #60a5fa;
  box-shadow: 0 0 0 1px #172554, 0 0 6px #60a5fa;
  animation: tab-drop-appear 120ms ease-out;
}
.terminal-tab[data-drop-side='before'] .terminal-tab-drop-marker { left: 0; }
.terminal-tab[data-drop-side='after'] .terminal-tab-drop-marker { right: 0; }
@keyframes tab-drop-appear {
  from { opacity: 0; transform: scaleY(0.6); }
  to { opacity: 1; transform: scaleY(1); }
}
@media (prefers-reduced-motion: reduce) {
  .terminal-tab-drop-marker { animation: none; }
}
.terminal-tab-active {
  flex-grow: 1.35;
  min-width: 112px;
}
@media (max-width: 1280px) {
  .terminal-tab-secondary {
    display: none;
  }
}
@media (max-width: 760px) {
  .terminal-tab {
    padding-inline: 0.35rem;
  }
  .terminal-tab:not(.terminal-tab-active) .terminal-tab-label {
    max-width: 3.5rem;
  }
}
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
.terminal-sessions-navigator {
  transition: width 0.2s ease, opacity 0.16s ease, transform 0.2s ease;
}
.sessions-navigator-enter-from,
.sessions-navigator-leave-to {
  width: 0 !important;
  opacity: 0;
  transform: translateX(-12px);
}
.sessions-navigator-enter-active,
.sessions-navigator-leave-active {
  overflow: hidden;
  transition: width 0.2s ease, opacity 0.16s ease, transform 0.2s ease;
}
.sessions-sidebar-item,
.sessions-section-toggle {
  display: flex;
  width: 100%;
  min-height: 30px;
  align-items: center;
  gap: 0.4rem;
  border-radius: 0.25rem;
  padding: 0.35rem 0.5rem;
  text-align: left;
  font-size: 0.75rem;
  transition: background-color 0.15s ease, color 0.15s ease;
}
.sessions-section-toggle {
  margin-top: 0.5rem;
  border-top: 1px solid rgb(31 41 55);
  border-radius: 0;
  color: rgb(156 163 175);
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.sessions-section-toggle:hover { color: rgb(229 231 235); }
.sessions-sidebar-badge {
  flex: none;
  min-width: 1.25rem;
  border-radius: 9999px;
  background: rgb(55 65 81 / 0.75);
  padding: 0.05rem 0.35rem;
  text-align: center;
  font-size: 0.625rem;
  color: rgb(209 213 219);
}
@media (prefers-reduced-motion: reduce) {
  .terminal-sessions-navigator,
  .sessions-navigator-enter-active,
  .sessions-navigator-leave-active { transition: none; }
}
</style>
