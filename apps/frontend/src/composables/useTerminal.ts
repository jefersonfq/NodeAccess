import { ref, watch, reactive, onUnmounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { handleExpiredSession } from '@/services/auth-session.service'
import { TerminalOscDirectoryTracker } from '@/services/terminal-osc-directory.service'
import { handleTerminalSftpResult, registerTerminalSftpChannel } from '@/services/terminal-sftp-channel.service'
import { registerBroadcastSender, unregisterBroadcastSender, broadcastInput } from './useTerminalBroadcast'
import { getPlatformPresetDefaults, usePlatform, type PlatformPreset } from './usePlatform'
import { createXtermAdapter } from '@/terminal/xterm-adapter'
import type { TerminalAdapter, TerminalTheme } from '@/terminal/types'
import { TerminalAiPrefixInterceptor } from '@/services/terminal-ai-prefix.service'
import { TerminalInputModel } from '@/services/terminal-input-model.service'
import type {
  HostSwitcherShortcutMode,
  MultilinePasteMode as PersistedMultilinePasteMode,
  RightClickMode as PersistedRightClickMode,
  SnippetShortcutMode,
  TerminalPreset as PersistedTerminalPreset,
  TerminalThemeName,
  UserTerminalPreferences,
} from '@nodeaccess/shared'

type Status    = 'idle' | 'connecting' | 'connected' | 'error' | 'closed'

type TerminalHarnessEventName =
  | 'terminal-mounted'
  | 'terminal-connecting'
  | 'terminal-ready'
  | 'terminal-input-ready'
  | 'terminal-input-sent'
  | 'terminal-command-sent'
  | 'terminal-output-received'
  | 'terminal-disconnected'
  | 'terminal-error'
  | 'terminal-ai-prefix-intercepted'

declare global {
  interface Window {
    __NODEACCESS_TERMINAL_HARNESS__?: {
      events: Array<Record<string, unknown>>
      lastEvent?: Record<string, unknown>
      flags: {
        mounted?: boolean
        connecting?: boolean
        ready?: boolean
        inputReady?: boolean
        outputReceived?: boolean
        disconnected?: boolean
        error?: boolean
      }
      counts: {
        inputSent: number
        commandSent: number
        outputReceived: number
      }
    }
  }
}
type ClosedReason = 'remote' | 'socket' | null
export type ThemeName = TerminalThemeName
export type RightClickMode = PersistedRightClickMode
export type MultilinePasteMode = PersistedMultilinePasteMode
export type TerminalSidebarPosition = UserTerminalPreferences['sidebarRailPosition']
export type GraphicalOpenMode = UserTerminalPreferences['graphicalOpenMode']
export type TerminalPreferenceSnapshot = UserTerminalPreferences

// ---------------------------------------------------------------------------
// Temas
// ---------------------------------------------------------------------------

const themes: Record<ThemeName, TerminalTheme> = {
  dark: {
    background:          '#1a1b1e',
    foreground:          '#d4d4d4',
    cursor:              '#ffffffcc',
    selectionBackground: '#264f78',
    selectionForeground: '#ffffff',
    black:               '#1e1e1e',
    red:                 '#f44747',
    green:               '#6a9955',
    yellow:              '#dcdcaa',
    blue:                '#569cd6',
    magenta:             '#c586c0',
    cyan:                '#4ec9b0',
    white:               '#d4d4d4',
  },
  dracula: {
    background:          '#282a36',
    foreground:          '#f8f8f2',
    cursor:              '#f8f8f0',
    selectionBackground: '#44475a',
    selectionForeground: '#ffffff',
    black:               '#21222c',
    red:                 '#ff5555',
    green:               '#50fa7b',
    yellow:              '#f1fa8c',
    blue:                '#bd93f9',
    magenta:             '#ff79c6',
    cyan:                '#8be9fd',
    white:               '#f8f8f2',
  },
  solarized: {
    background:          '#002b36',
    foreground:          '#839496',
    cursor:              '#93a1a1',
    selectionBackground: '#1a5276',
    selectionForeground: '#eee8d5',
    black:               '#073642',
    red:                 '#dc322f',
    green:               '#859900',
    yellow:              '#b58900',
    blue:                '#268bd2',
    magenta:             '#d33682',
    cyan:                '#2aa198',
    white:               '#eee8d5',
  },
  'one-dark': {
    background:          '#282c34',
    foreground:          '#abb2bf',
    cursor:              '#528bff',
    selectionBackground: '#3e4452',
    selectionForeground: '#ffffff',
    black:               '#282c34',
    red:                 '#e06c75',
    green:               '#98c379',
    yellow:              '#e5c07b',
    blue:                '#61afef',
    magenta:             '#c678dd',
    cyan:                '#56b6c2',
    white:               '#abb2bf',
  },
  nord: {
    background:          '#2e3440',
    foreground:          '#d8dee9',
    cursor:              '#d8dee9',
    selectionBackground: '#4c566a',
    selectionForeground: '#eceff4',
    black:               '#3b4252',
    red:                 '#bf616a',
    green:               '#a3be8c',
    yellow:              '#ebcb8b',
    blue:                '#81a1c1',
    magenta:             '#b48ead',
    cyan:                '#88c0d0',
    white:               '#e5e9f0',
  },
  'tokyo-night': {
    background:          '#1a1b26',
    foreground:          '#c0caf5',
    cursor:              '#c0caf5',
    selectionBackground: '#283457',
    selectionForeground: '#c0caf5',
    black:               '#15161e',
    red:                 '#f7768e',
    green:               '#9ece6a',
    yellow:              '#e0af68',
    blue:                '#7aa2f7',
    magenta:             '#bb9af7',
    cyan:                '#7dcfff',
    white:               '#a9b1d6',
  },
}

// ---------------------------------------------------------------------------
// Settings globais compartilhados entre todas as abas — persistidos em localStorage
// ---------------------------------------------------------------------------

const FONT_KEY  = 'na_term_fontSize'
const THEME_KEY = 'na_term_theme'
const FONT_FAMILY_KEY = 'na_term_fontFamily'
const PRESET_KEY = 'na_term_preset'
const RIGHT_CLICK_KEY = 'na_term_rightClickMode'
const MULTILINE_PASTE_KEY = 'na_term_multilinePasteMode'
const MIDDLE_CLICK_PASTE_KEY = 'na_term_middleClickPasteEnabled'
const AUTO_FULLSCREEN_KEY  = 'na_term_autoFullscreenOnConnect'
const SHOW_TOOLBAR_KEY     = 'na_term_showToolbar'
const SIDEBAR_RAIL_POSITION_KEY = 'na_term_sidebarRailPosition'
const GRAPHICAL_OPEN_MODE_KEY = 'na_term_graphicalOpenMode'
const AUTOCOMPLETE_ENABLED_KEY = 'na_term_autocompleteEnabled'
const AI_ASSISTANT_ENABLED_KEY = 'na_term_aiAssistantEnabled'
const MIN_FONT  = 10
const MAX_FONT  = 24
let terminalLayoutResizeBlockedUntil = 0

export function deferTerminalLayoutResize(durationMs = 220) {
  terminalLayoutResizeBlockedUntil = Math.max(terminalLayoutResizeBlockedUntil, Date.now() + Math.max(0, durationMs))
}

function getPresetDefaults(preset: PlatformPreset, detectedPlatform: ReturnType<typeof usePlatform>['platform']) {
  return getPlatformPresetDefaults(preset === 'auto' || preset === 'custom' ? detectedPlatform : preset)
}

const detectedPlatform = usePlatform().platform
const savedPreset = (localStorage.getItem(PRESET_KEY) as PlatformPreset | null) ?? 'auto'
const initialPreset: PlatformPreset = ['auto', 'windows', 'linux', 'macos', 'custom'].includes(savedPreset) ? savedPreset : 'auto'
const initialDefaults = getPresetDefaults(initialPreset, detectedPlatform)

export const termSettings = reactive({
  preset: initialPreset,
  fontSize: Number(localStorage.getItem(FONT_KEY) ?? String(initialDefaults.fontSize)),
  fontFamily: localStorage.getItem(FONT_FAMILY_KEY) ?? initialDefaults.fontFamily,
  theme: (localStorage.getItem(THEME_KEY) ?? initialDefaults.theme) as ThemeName,
  rightClickMode: ((localStorage.getItem(RIGHT_CLICK_KEY) as RightClickMode | null) ?? 'paste') as RightClickMode,
  multilinePasteMode: ((localStorage.getItem(MULTILINE_PASTE_KEY) as MultilinePasteMode | null) ?? 'always') as MultilinePasteMode,
  middleClickPasteEnabled: localStorage.getItem(MIDDLE_CLICK_PASTE_KEY) !== '0',
  autoFullscreenOnConnect: localStorage.getItem(AUTO_FULLSCREEN_KEY) === '1',
  graphicalOpenMode: ((localStorage.getItem(GRAPHICAL_OPEN_MODE_KEY) as GraphicalOpenMode | null) ?? 'dedicated') as GraphicalOpenMode,
  showTerminalToolbar: localStorage.getItem(SHOW_TOOLBAR_KEY) !== '0',
  sidebarRailPosition: ((localStorage.getItem(SIDEBAR_RAIL_POSITION_KEY) as TerminalSidebarPosition | null) ?? 'right') as TerminalSidebarPosition,
  autocompleteEnabled: localStorage.getItem(AUTOCOMPLETE_ENABLED_KEY) !== '0',
  aiAssistantEnabled: localStorage.getItem(AI_ASSISTANT_ENABLED_KEY) !== '0',
})

export function setFontSize(size: number) {
  termSettings.preset = 'custom'
  termSettings.fontSize = Math.max(MIN_FONT, Math.min(MAX_FONT, size))
  localStorage.setItem(PRESET_KEY, termSettings.preset)
  localStorage.setItem(FONT_KEY, String(termSettings.fontSize))
}

export function setTheme(name: ThemeName) {
  termSettings.preset = 'custom'
  termSettings.theme = name
  localStorage.setItem(PRESET_KEY, termSettings.preset)
  localStorage.setItem(THEME_KEY, name)
}

export function setRightClickMode(mode: RightClickMode) {
  termSettings.rightClickMode = mode
  localStorage.setItem(RIGHT_CLICK_KEY, mode)
}

export function setMultilinePasteMode(mode: MultilinePasteMode) {
  termSettings.multilinePasteMode = mode
  localStorage.setItem(MULTILINE_PASTE_KEY, mode)
}

export function setMiddleClickPasteEnabled(value: boolean) {
  termSettings.middleClickPasteEnabled = value
  localStorage.setItem(MIDDLE_CLICK_PASTE_KEY, value ? '1' : '0')
}

export function setAutoFullscreenOnConnect(value: boolean) {
  termSettings.autoFullscreenOnConnect = value
  localStorage.setItem(AUTO_FULLSCREEN_KEY, value ? '1' : '0')
}

export function setGraphicalOpenMode(value: GraphicalOpenMode) {
  termSettings.graphicalOpenMode = value
  localStorage.setItem(GRAPHICAL_OPEN_MODE_KEY, value)
}

export function applyTerminalPreset(preset: PlatformPreset) {
  const defaults = getPresetDefaults(preset, detectedPlatform)
  termSettings.preset = preset
  termSettings.fontSize = defaults.fontSize
  termSettings.fontFamily = defaults.fontFamily
  termSettings.theme = defaults.theme
  localStorage.setItem(PRESET_KEY, preset)
  localStorage.setItem(FONT_KEY, String(termSettings.fontSize))
  localStorage.setItem(FONT_FAMILY_KEY, termSettings.fontFamily)
  localStorage.setItem(THEME_KEY, termSettings.theme)
}

export function setShowTerminalToolbar(value: boolean) {
  termSettings.showTerminalToolbar = value
  localStorage.setItem(SHOW_TOOLBAR_KEY, value ? '1' : '0')
}

export function setTerminalSidebarRailPosition(value: TerminalSidebarPosition) {
  termSettings.sidebarRailPosition = value
  localStorage.setItem(SIDEBAR_RAIL_POSITION_KEY, value)
}

export function setTerminalAutocompleteEnabled(value: boolean) {
  termSettings.autocompleteEnabled = value
  localStorage.setItem(AUTOCOMPLETE_ENABLED_KEY, value ? '1' : '0')
}

export function setTerminalAiAssistantEnabled(value: boolean) {
  termSettings.aiAssistantEnabled = value
  localStorage.setItem(AI_ASSISTANT_ENABLED_KEY, value ? '1' : '0')
}

export function resetTerminalPreferences() {
  applyTerminalPreset('auto')
  setRightClickMode('paste')
  setMultilinePasteMode('always')
  setMiddleClickPasteEnabled(true)
  setAutoFullscreenOnConnect(false)
  setGraphicalOpenMode('dedicated')
  setShowTerminalToolbar(true)
  setTerminalSidebarRailPosition('right')
  setTerminalAutocompleteEnabled(true)
  setTerminalAiAssistantEnabled(true)
}

export function applyTerminalPreferenceSnapshot(snapshot: TerminalPreferenceSnapshot) {
  termSettings.preset = snapshot.preset
  termSettings.fontSize = snapshot.fontSize
  termSettings.fontFamily = snapshot.fontFamily
  termSettings.theme = snapshot.theme
  termSettings.rightClickMode = snapshot.rightClickMode
  termSettings.multilinePasteMode = snapshot.multilinePasteMode
  termSettings.middleClickPasteEnabled = snapshot.middleClickPasteEnabled ?? true
  termSettings.autoFullscreenOnConnect = snapshot.autoFullscreenOnConnect
  termSettings.graphicalOpenMode = snapshot.graphicalOpenMode ?? 'dedicated'
  termSettings.sidebarRailPosition = snapshot.sidebarRailPosition ?? 'right'
  termSettings.autocompleteEnabled = snapshot.autocompleteEnabled ?? true
  termSettings.aiAssistantEnabled = snapshot.aiAssistantEnabled ?? true

  localStorage.setItem(PRESET_KEY, snapshot.preset)
  localStorage.setItem(FONT_KEY, String(snapshot.fontSize))
  localStorage.setItem(FONT_FAMILY_KEY, snapshot.fontFamily)
  localStorage.setItem(THEME_KEY, snapshot.theme)
  localStorage.setItem(RIGHT_CLICK_KEY, snapshot.rightClickMode)
  localStorage.setItem(MULTILINE_PASTE_KEY, snapshot.multilinePasteMode)
  localStorage.setItem(MIDDLE_CLICK_PASTE_KEY, termSettings.middleClickPasteEnabled ? '1' : '0')
  localStorage.setItem(AUTO_FULLSCREEN_KEY, snapshot.autoFullscreenOnConnect ? '1' : '0')
  localStorage.setItem(GRAPHICAL_OPEN_MODE_KEY, termSettings.graphicalOpenMode)
  localStorage.setItem(SIDEBAR_RAIL_POSITION_KEY, termSettings.sidebarRailPosition)
  localStorage.setItem(AUTOCOMPLETE_ENABLED_KEY, termSettings.autocompleteEnabled ? '1' : '0')
  localStorage.setItem(AI_ASSISTANT_ENABLED_KEY, termSettings.aiAssistantEnabled ? '1' : '0')
  setShowTerminalToolbar(snapshot.showTerminalToolbar ?? true)
}

export function getTerminalPreferenceSnapshot(
  snippetShortcutMode: SnippetShortcutMode,
  hostSwitcherShortcutMode: HostSwitcherShortcutMode,
): TerminalPreferenceSnapshot {
  return {
    preset: termSettings.preset as PersistedTerminalPreset,
    fontSize: termSettings.fontSize,
    fontFamily: termSettings.fontFamily,
    theme: termSettings.theme,
    rightClickMode: termSettings.rightClickMode,
    multilinePasteMode: termSettings.multilinePasteMode,
    middleClickPasteEnabled: termSettings.middleClickPasteEnabled,
    autoFullscreenOnConnect: termSettings.autoFullscreenOnConnect,
    graphicalOpenMode: termSettings.graphicalOpenMode,
    snippetShortcutMode,
    hostSwitcherShortcutMode,
    showTerminalToolbar: termSettings.showTerminalToolbar,
    sidebarRailPosition: termSettings.sidebarRailPosition,
    autocompleteEnabled: termSettings.autocompleteEnabled,
    aiAssistantEnabled: termSettings.aiAssistantEnabled,
  }
}

// ---------------------------------------------------------------------------
// Composable por instância de terminal
// ---------------------------------------------------------------------------

export type ConnectionMethod = 'direct' | 'user_agent' | 'tenant_agent' | 'telnet_direct' | 'telnet_user_agent' | 'telnet_tenant_agent'

interface ControlMessage {
  type:              'connected' | 'error' | 'closed' | 'pong' | 'info'
  message?:          string
  code?:             string
  sessionId?:        number
  hostName?:         string
  connectionMethod?: ConnectionMethod
  agentName?:        string | null
}

export interface HostKeyVerificationChallenge {
  reason: 'unknown' | 'changed'
  presentedFingerprint: string
  trustedFingerprint: string | null
}

export interface CredentialsChallenge {
  hostName:     string
  needsUsername: boolean
  needsPassword: boolean
}

export interface SavePasswordOffer {
  hostId:        number
  hostName:      string
  secretName:    string
  scope:         'PERSONAL' | 'TEAM'
  savedUsername: string | null
}

export interface ActiveTunnel {
  id:                string
  connectionMethod:  'direct' | 'user_agent' | 'tenant_agent' | 'private_access_connector'
  bindAddress:       '127.0.0.1' | '0.0.0.0'
  localPort:         number
  requestedLocalPort: number
  assignedLocalPort: number
  usedPortFallback: boolean
  remoteHost:        string
  remotePort:        number
  description?:      string
  portForwardingId?: number
  hostId:            number
  createdAt:         string
}

export interface TunnelState {
  tunnels: ActiveTunnel[]
  errors:  Array<{ portForwardingId: number; bindAddress?: '127.0.0.1' | '0.0.0.0'; localPort: number; code: string; message: string }>
}

interface TunnelsMessage {
  type:    'tunnels'
  tunnels: ActiveTunnel[]
  errors:  Array<{ portForwardingId: number; bindAddress?: '127.0.0.1' | '0.0.0.0'; localPort: number; code: string; message: string }>
}

interface HostKeyVerificationMessage extends HostKeyVerificationChallenge {
  type: 'host_key_verification_required'
}

interface CredentialsRequiredMessage extends CredentialsChallenge {
  type: 'credentials_required'
}

interface SavePasswordOfferMessage extends SavePasswordOffer {
  type: 'save_password_offer'
}

type AnyControlMessage = ControlMessage | TunnelsMessage | HostKeyVerificationMessage | CredentialsRequiredMessage | SavePasswordOfferMessage

const PING_INTERVAL_MS  = 30_000
const TOKEN_REFRESH_TTL = 60

export function hintForErrorCode(code: string | null): string | null {
  switch (code) {
    case 'AGENT_REQUIRED':
      return 'Acesse a página de Agentes e verifique se há um agente online para este tenant.'
    case 'AGENT_REQUIRED_USER':
      return 'Inicie seu agente pessoal (USER_BOUND) para usar este host.'
    case 'AGENT_CONNECT_FAILED':
      return 'O agente não conseguiu alcançar o host. Verifique se ele está acessível a partir da máquina do agente.'
    case 'HOST_PORT_REFUSED':
      return 'Porta recusada. Verifique se o serviço remoto está ativo e se a porta correta está configurada.'
    case 'HOST_UNREACHABLE':
      return 'Host inalcançável. Verifique o IP, roteamento de rede e regras de firewall.'
    case 'DNS_FAILED':
      return 'Hostname não resolvido. Use o IP diretamente ou verifique o DNS.'
    case 'AUTH_FAILED':
      return 'Autenticação rejeitada. Verifique usuário, senha ou chave PEM configurada no host.'
    case 'SSH_HANDSHAKE_TIMEOUT':
      return 'Servidor SSH não respondeu. Pode estar sobrecarregado ou bloqueado por firewall na camada SSH.'
    case 'BASTION_PORT_REFUSED':
    case 'BASTION_UNREACHABLE':
    case 'BASTION_DNS_FAILED':
    case 'BASTION_CONNECT_FAILED':
      return 'Falha no bastion intermediário. Verifique se o bastion está acessível e com sshd ativo.'
    case 'BASTION_AUTH_FAILED':
      return 'Autenticação no bastion rejeitada. Verifique as credenciais configuradas para o bastion.'
    case 'CREDENTIAL_ERROR':
      return 'Falha ao buscar credencial do cofre. Verifique a integração com o provedor (1Password).'
    default:
      return null
  }
}

export function useTerminal(tabId?: string) {
  const status           = ref<Status>('idle')
  const error            = ref<string | null>(null)
  const errorCode        = ref<string | null>(null)
  const sessionId        = ref<number | null>(null)
  const hostName         = ref<string>('')
  const outputVersion    = ref(0)
  const latestOutputChunk = ref('')
  const isScrolledUp     = ref(false)
  const latency          = ref<number | null>(null)
  const currentDirectory = ref<string | null>(null)
  const closedReason     = ref<ClosedReason>(null)
  const tunnelState          = ref<TunnelState>({ tunnels: [], errors: [] })
  const hostKeyChallenge     = ref<HostKeyVerificationChallenge | null>(null)
  const credentialsChallenge = ref<CredentialsChallenge | null>(null)
  const savePasswordOffer    = ref<SavePasswordOffer | null>(null)
  const connectionMethod   = ref<ConnectionMethod | null>(null)
  const agentName          = ref<string | null>(null)

  let term:           TerminalAdapter | null = null
  let ws:             WebSocket | null      = null
  let resizeObserver: ResizeObserver | null = null
  let resizeTarget: HTMLElement | null = null
  let resizeFrame: number | null = null
  let layoutResizeSettleTimer: ReturnType<typeof setTimeout> | null = null
  let pingTimer:      ReturnType<typeof setInterval> | null = null
  let onDataDisposable: { dispose(): void } | null = null
  let pingAt: number | null = null
  const oscDirectoryTracker = new TerminalOscDirectoryTracker()
  let lastSentResize: { cols: number; rows: number } | null = null
  let intentionalDisconnect = false
  let usingExternalAccessToken = false
  let confirmMultilinePasteHandler: ((text: string) => boolean | Promise<boolean>) | null = null
  let aiPrefixHandler: (() => void) | null = null
  let inputChangeHandler: ((value: string, cursor: number, reliable: boolean) => void) | null = null
  let commandSubmittedHandler: ((command: string) => void) | null = null
  const inputModel = new TerminalInputModel()
  const aiPrefixInterceptor = new TerminalAiPrefixInterceptor()
  let commandLineLength = 0
  let harnessInputHandler: ((event: Event) => void) | null = null
  let outputNotifyFrame: number | null = null
  let pendingOutputChunk = ''
  let unregisterTerminalSftp: (() => void) | null = null
  const decoder = new TextDecoder()
  const terminalMetrics = ref({
    cols: 0,
    rows: 0,
    width: 0,
    height: 0,
    lastResizeSentAt: null as string | null,
  })

  function emitTerminalHarnessEvent(name: TerminalHarnessEventName, detail: Record<string, unknown> = {}) {
    if (typeof window === 'undefined') return
    const store = window.__NODEACCESS_TERMINAL_HARNESS__ ?? {
      events: [],
      flags: {},
      counts: { inputSent: 0, commandSent: 0, outputReceived: 0 },
    }
    const event = {
      name,
      tabId: tabId ?? null,
      at: Date.now(),
      status: status.value,
      sessionId: sessionId.value,
      hostName: hostName.value,
      ...detail,
    }

    if (name === 'terminal-mounted') store.flags.mounted = true
    if (name === 'terminal-connecting') {
      store.flags = { mounted: store.flags.mounted, connecting: true }
      store.counts = { inputSent: 0, commandSent: 0, outputReceived: 0 }
    }
    if (name === 'terminal-ready') store.flags.ready = true
    if (name === 'terminal-input-ready') store.flags.inputReady = true
    if (name === 'terminal-output-received') {
      store.flags.outputReceived = true
      store.counts.outputReceived += 1
    }
    if (name === 'terminal-input-sent') store.counts.inputSent += 1
    if (name === 'terminal-command-sent') store.counts.commandSent += 1
    if (name === 'terminal-disconnected') store.flags.disconnected = true
    if (name === 'terminal-error') store.flags.error = true

    store.lastEvent = event
    store.events.push(event)
    if (store.events.length > 200) store.events.splice(0, store.events.length - 200)
    window.__NODEACCESS_TERMINAL_HARNESS__ = store
    window.dispatchEvent(new CustomEvent('nodeaccess:terminal', { detail: event }))
  }

  function isTerminalHarnessInputAllowed() {
    return import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(window.location.hostname)
  }

  function sendHarnessInput(text: string) {
    if (!isTerminalHarnessInputAllowed()) return
    const encoded = new TextEncoder().encode(text)
    if (ws?.readyState !== WebSocket.OPEN) return
    ws.send(encoded)
    emitTerminalHarnessEvent('terminal-input-sent', {
      source: 'harness',
      byteLength: encoded.byteLength,
      hasEnter: text.includes('\r') || text.includes('\n'),
    })
    if (text.includes('\r') || text.includes('\n')) {
      emitTerminalHarnessEvent('terminal-command-sent', { source: 'harness', byteLength: encoded.byteLength })
    }
  }

  // ── Reage a mudanças globais de settings ──────────────────────────────────

  watch(() => termSettings.fontSize, (size) => {
    if (term) { term.setFontSize(size); scheduleFitAndResize(true) }
  })

  watch(() => termSettings.fontFamily, (fontFamily) => {
    if (term) { term.setFontFamily(fontFamily); scheduleFitAndResize(true) }
  })

  watch(() => termSettings.theme, (name) => {
    if (term) term.setTheme(themes[name])
  })

  // ── Token ─────────────────────────────────────────────────────────────────

  function getTokenExp(token: string): number | null {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]!))
      return typeof payload.exp === 'number' ? payload.exp : null
    } catch { return null }
  }

  function isExpiringSoon(token: string): boolean {
    const exp = getTokenExp(token)
    if (exp === null) return true
    return (exp - Date.now() / 1000) < TOKEN_REFRESH_TTL
  }

  async function refreshTokenIfNeeded(): Promise<boolean> {
    const auth = useAuthStore()
    if (!auth.accessToken || !isExpiringSoon(auth.accessToken)) return true
    const ok = await auth.refresh()
    if (!ok) {
      term?.writeln('\r\n\x1b[31m[Sessão expirada — faça login novamente]\x1b[0m')
      status.value = 'error'
      error.value  = 'Sessão expirada'
      window.setTimeout(() => { void handleExpiredSession() }, 300)
    }
    return ok
  }

  // ── Mount ─────────────────────────────────────────────────────────────────

  function mount(
    el: HTMLElement,
    handlers?: {
      onOpenSearch?: () => void
      onShortcutKey?: (event: KeyboardEvent) => boolean
      onConfirmMultilinePaste?: (text: string) => boolean | Promise<boolean>
      onInputChange?: (value: string, cursor: number, reliable: boolean) => void
      onCommandSubmitted?: (command: string) => void
    },
  ) {
    confirmMultilinePasteHandler = handlers?.onConfirmMultilinePaste ?? null
    inputChangeHandler = handlers?.onInputChange ?? null
    commandSubmittedHandler = handlers?.onCommandSubmitted ?? null
    term = createXtermAdapter({
      fontSize: termSettings.fontSize,
      fontFamily: termSettings.fontFamily,
      scrollback: 5000,
      theme: themes[termSettings.theme],
    })

    term.mount(el)
    emitTerminalHarnessEvent('terminal-mounted')
    harnessInputHandler = (event: Event) => {
      const text = (event as CustomEvent<{ text?: unknown }>).detail?.text
      if (typeof text === 'string') sendHarnessInput(text)
    }
    window.addEventListener('nodeaccess:terminal-send-input', harnessInputHandler)
    resizeTarget = el.parentElement ?? el
    fitTerminal()

    // Copy-on-select (comportamento PuTTY): copia automaticamente ao selecionar texto.
    // xterm v5 removeu a opção copyOnSelect do construtor; usamos onSelectionChange.
    term.onSelectionChange(() => {
      const sel = term?.getSelection() ?? ''
      if (sel) navigator.clipboard.writeText(sel).catch(() => {})
    })

    // Intercepta atalhos antes de enviar ao shell.
    term.attachShortcuts({
      onFind: handlers?.onOpenSearch,
      onShortcutKey: handlers?.onShortcutKey,
    })

    resizeObserver = new ResizeObserver(() => scheduleFitAndResize())
    resizeObserver.observe(resizeTarget)
    if (resizeTarget !== el) resizeObserver.observe(el)

    term.onScroll((viewportY) => {
      if (!term) return
      const max = term.bufferLength - term.rows
      isScrolledUp.value = viewportY < max - 1
    })
  }

  // ── Connect ───────────────────────────────────────────────────────────────

  async function connect(hostId: number, accessTokenOverride?: string, jiraSessionGrant?: string) {
    usingExternalAccessToken = !!accessTokenOverride
    if (!accessTokenOverride) {
      const ok = await refreshTokenIfNeeded()
      if (!ok) return
    }

    const auth  = useAuthStore()
    const token = accessTokenOverride ?? auth.accessToken
    if (!token || !term) return

    intentionalDisconnect = false
    stopPing()
    ws?.close()
    ws = null

    status.value = 'connecting'
    emitTerminalHarnessEvent('terminal-connecting', { hostId })
    closedReason.value = null
    error.value  = null
    errorCode.value = null
    sessionId.value = null
    currentDirectory.value = null
    oscDirectoryTracker.reset()
    hostName.value = ''
    tunnelState.value = { tunnels: [], errors: [] }
    hostKeyChallenge.value = null

    // Descarta listener anterior para evitar envio duplicado em reconexões
    onDataDisposable?.dispose()
      const sendInput = (data: string) => {
      const beforeInput = inputModel.snapshot()
      const encoded = new TextEncoder().encode(data)
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(encoded)
        emitTerminalHarnessEvent('terminal-input-sent', {
          byteLength: encoded.byteLength,
          hasEnter: data.includes('\r') || data.includes('\n'),
        })
        if (data.includes('\r') || data.includes('\n')) {
          emitTerminalHarnessEvent('terminal-command-sent', { byteLength: encoded.byteLength })
        }
      }
      if (tabId) broadcastInput(encoded, tabId)
      if ((data.includes('\r') || data.includes('\n')) && beforeInput.reliable && beforeInput.value.trim()) commandSubmittedHandler?.(beforeInput.value.trim())
      for (const char of data) {
        if (char === '\r' || char === '\n') commandLineLength = 0
        else if (char === '\u0015') commandLineLength = 0
        else if (char === '\u0017') commandLineLength = Math.max(0, commandLineLength - 1)
        else if (char === '\u007f') commandLineLength = Math.max(0, commandLineLength - 1)
        else if (char >= ' ') commandLineLength += 1
      }
      inputModel.consume(data)
      const snapshot = inputModel.snapshot()
      inputChangeHandler?.(snapshot.value, snapshot.cursor, snapshot.reliable)
    }
    const writeLocalErase = (chars: number) => term?.write(new TextEncoder().encode('\b \b'.repeat(chars)))
    onDataDisposable = term!.onData(async (data) => {
      const normalized = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      const trimmed = normalized.replace(/\n+$/g, '')
      const looksLikeMultilinePaste = trimmed.includes('\n')
      if (looksLikeMultilinePaste && confirmMultilinePasteHandler) {
        const allowed = await confirmMultilinePasteHandler(data)
        if (!allowed) return
      }

      const canInterceptAiPrefix = !!aiPrefixHandler && !looksLikeMultilinePaste && commandLineLength === 0 && !term?.isAlternateBuffer
      const action = aiPrefixInterceptor.consume(data, canInterceptAiPrefix)
      if (action.type === 'hold') term?.write(new TextEncoder().encode(action.display))
      if (action.type === 'erase') writeLocalErase(action.chars)
      if (action.type === 'trigger') {
        writeLocalErase(action.eraseChars)
        aiPrefixHandler?.()
        emitTerminalHarnessEvent('terminal-ai-prefix-intercepted')
      }
      if (action.type === 'send') {
        writeLocalErase(action.eraseChars)
        sendInput(action.data)
      }
    })

    // Register this terminal as a broadcast target
    if (tabId) {
      registerBroadcastSender(tabId, (data) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(data)
      })
    }

    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsBase = import.meta.env.VITE_WS_URL ?? `${wsProtocol}//${location.host}`
    // Re-fit antes de ler as dimensões: garante que cols/rows reflitam o tamanho
    // real do container no momento do connect, evitando wrap no output inicial.
    fitTerminal()
    const cols   = term?.cols ?? 80
    const rows   = term?.rows ?? 24
    const jiraGrantQuery = jiraSessionGrant ? `&jiraGrant=${encodeURIComponent(jiraSessionGrant)}` : ''
    const url    = `${wsBase}/ws/ssh/${hostId}?token=${encodeURIComponent(token)}&cols=${cols}&rows=${rows}${jiraGrantQuery}`

    ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'

    // Captura a referência exata deste WebSocket para que handlers descartem
    // eventos de conexões anteriores que ainda estejam drenando (race condition
    // entre o close do ws antigo e o inicio da nova conexão em reconnect()).
    const thisWs = ws

    ws.onopen = () => {
      if (ws !== thisWs) return
      startPing()
    }
    ws.onmessage = (event: MessageEvent) => {
      if (ws !== thisWs) return
      if (event.data instanceof ArrayBuffer) {
        const chunkBytes = new Uint8Array(event.data)
        term?.write(chunkBytes)
        const decodedChunk = decoder.decode(chunkBytes, { stream: true })
        const detectedDirectory = oscDirectoryTracker.consume(decodedChunk)
        if (detectedDirectory) currentDirectory.value = detectedDirectory
        pendingOutputChunk = `${pendingOutputChunk}${decodedChunk}`.slice(-4000)
        if (outputNotifyFrame === null) {
          outputNotifyFrame = requestAnimationFrame(() => {
            outputNotifyFrame = null
            latestOutputChunk.value = pendingOutputChunk
            pendingOutputChunk = ''
            outputVersion.value += 1
          })
        }
        emitTerminalHarnessEvent('terminal-output-received', {
          byteLength: chunkBytes.byteLength,
          outputVersion: outputVersion.value,
        })
        return
      }
      try {
        const message = JSON.parse(event.data as string) as AnyControlMessage
        if (!handleTerminalSftpResult(sessionId.value, message)) handleControl(message)
      } catch { /* ignore */ }
    }
    ws.onclose = () => {
      if (ws !== thisWs) return
      stopPing()
      unregisterTerminalSftp?.(); unregisterTerminalSftp = null
      tunnelState.value = { tunnels: [], errors: [] }
      if (intentionalDisconnect) {
        status.value = 'idle'
        emitTerminalHarnessEvent('terminal-disconnected', { reason: 'intentional' })
        return
      }
      if (status.value === 'connected') {
        closedReason.value = closedReason.value ?? 'socket'
        status.value = 'closed'
        emitTerminalHarnessEvent('terminal-disconnected', { reason: closedReason.value })
        term?.writeln('\r\n\x1b[33m[Conexão encerrada]\x1b[0m')
        return
      }
      if (status.value === 'connecting') {
        closedReason.value = 'socket'
        status.value = 'closed'
        error.value = error.value ?? 'Conexão encerrada antes da sessão iniciar'
        emitTerminalHarnessEvent('terminal-disconnected', { reason: closedReason.value })
        term?.writeln('\r\n\x1b[33m[Conexão encerrada antes da sessão iniciar]\x1b[0m')
      }
    }
    ws.onerror = () => {
      if (ws !== thisWs) return
      stopPing()
      status.value = 'error'
      error.value  = 'Erro na conexão WebSocket'
      emitTerminalHarnessEvent('terminal-error', { message: error.value })
      term?.writeln('\r\n\x1b[31m[Erro de conexão]\x1b[0m')
    }
  }

  // ── Ping ──────────────────────────────────────────────────────────────────

  function startPing() {
    stopPing()
    pingTimer = setInterval(async () => {
      if (ws?.readyState === WebSocket.OPEN) {
        pingAt = Date.now()
        ws.send(JSON.stringify({ type: 'ping' }))
      }
      if (!usingExternalAccessToken) {
        await refreshTokenIfNeeded()
      }
    }, PING_INTERVAL_MS)
  }

  function stopPing() {
    if (pingTimer !== null) { clearInterval(pingTimer); pingTimer = null }
  }

  // ── Busca ─────────────────────────────────────────────────────────────────

  function searchNext(query: string) {
    if (!query) return
    term?.searchNext(query)
  }

  function searchPrev(query: string) {
    if (!query) return
    term?.searchPrev(query)
  }

  // ── Ações do terminal ────────────────────────────────────────────────────

  function clear() { term?.clear() }

  function scrollToBottom() { term?.scrollToBottom() }

  function setDisableStdin(disabled: boolean) {
    term?.setDisableStdin(disabled)
  }

  function isMouseTrackingEnabled() {
    return term?.isMouseTrackingEnabled() ?? false
  }

  function getBufferText(): string {
    if (!term) return ''
    const lines: string[] = []
    for (let i = 0; i < term.bufferLength; i++) {
      const line = term.getBufferLine(i)
      if (line) lines.push(line)
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
    return lines.join('\n')
  }

  function getSelectionText(): string {
    return term?.getSelection() ?? ''
  }

  /** Envia texto ao shell como se o usuário tivesse digitado (ex: snippet) */
  function sendText(text: string) {
    const encoded = new TextEncoder().encode(text)
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(encoded)
      emitTerminalHarnessEvent('terminal-input-sent', {
        source: 'sendText',
        byteLength: encoded.byteLength,
        hasEnter: text.includes('\r') || text.includes('\n'),
      })
      if (text.includes('\r') || text.includes('\n')) {
        emitTerminalHarnessEvent('terminal-command-sent', { source: 'sendText', byteLength: encoded.byteLength })
      }
    }
    inputModel.consume(text)
    const snapshot = inputModel.snapshot()
    inputChangeHandler?.(snapshot.value, snapshot.cursor, snapshot.reliable)
    for (const char of text) {
      if (char === '\r' || char === '\n' || char === '\u0015') commandLineLength = 0
      else if (char === '\u007f') commandLineLength = Math.max(0, commandLineLength - 1)
      else if (char >= ' ') commandLineLength += 1
    }
  }

  function getCursorAnchor() { return term?.getCursorAnchor() ?? null }

  /** Envia texto com placeholders de secrets para resolução server-side. */
  function sendCredentialsResponse(username: string, password: string) {
    if (ws?.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'credentials_response', username, password }))
    credentialsChallenge.value = null
  }

  function dismissSavePasswordOffer() {
    savePasswordOffer.value = null
  }

  function sendSnippetText(text: string, context: { snippetId: number; snippetName?: string; executionId: string }) {
    if (ws?.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({
      type: 'snippet_input',
      text,
      snippetId: context.snippetId,
      executionId: context.executionId,
      ...(context.snippetName !== undefined && { snippetName: context.snippetName }),
    }))
    emitTerminalHarnessEvent('terminal-command-sent', {
      source: 'snippet',
      snippetId: context.snippetId,
      byteLength: new TextEncoder().encode(text).byteLength,
    })
  }

  function sendSecretText(text: string, context?: { snippetId?: number; snippetName?: string; executionId?: string }) {
    if (ws?.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({
      type: 'secret_input',
      text,
      ...(context?.snippetId !== undefined && { snippetId: context.snippetId }),
      ...(context?.snippetName !== undefined && { snippetName: context.snippetName }),
      ...(context?.executionId !== undefined && { executionId: context.executionId }),
    }))
    emitTerminalHarnessEvent('terminal-input-sent', {
      source: 'secret',
      byteLength: new TextEncoder().encode(text).byteLength,
      hasEnter: text.includes('\r') || text.includes('\n'),
    })
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function handleControl(msg: AnyControlMessage) {
    switch (msg.type) {
      case 'connected':
        status.value           = 'connected'
        sessionId.value        = (msg as ControlMessage).sessionId ?? null
        unregisterTerminalSftp?.()
        unregisterTerminalSftp = sessionId.value && ws
          ? registerTerminalSftpChannel(sessionId.value, (message) => { if (ws?.readyState === WebSocket.OPEN) ws.send(message) })
          : null
        hostName.value         = (msg as ControlMessage).hostName ?? ''
        connectionMethod.value = (msg as ControlMessage).connectionMethod ?? null
        agentName.value        = (msg as ControlMessage).agentName ?? null
        emitTerminalHarnessEvent('terminal-ready', {
          connectionMethod: connectionMethod.value,
          agentName: agentName.value,
        })
        emitTerminalHarnessEvent('terminal-input-ready')
        // Sincroniza PTY com dimensões reais (o ResizeObserver pode ter disparado
        // antes do handler remoto estar pronto no backend)
        scheduleFitAndResize(true)
        break
      case 'info':
        if ((msg as ControlMessage).message) {
          term?.writeln(`\r\n\x1b[36m[NodeAccess] ${(msg as ControlMessage).message}\x1b[0m`)
        }
        break
      case 'error': {
        status.value    = 'error'
        error.value     = (msg as ControlMessage).message ?? 'Erro desconhecido'
        errorCode.value = (msg as ControlMessage).code ?? null
        emitTerminalHarnessEvent('terminal-error', {
          message: error.value,
          code: errorCode.value,
        })
        const hint = hintForErrorCode(errorCode.value)
        term?.writeln(`\r\n\x1b[31m✖ ${error.value}\x1b[0m`)
        if (hint) term?.writeln(`\x1b[33m  → ${hint}\x1b[0m`)
        if (
          error.value.toLowerCase().includes('expirada')
          || error.value.toLowerCase().includes('expired')
          || error.value.toLowerCase().includes('unauthorized')
        ) {
          void handleExpiredSession()
        }
        break
      }
      case 'closed':
        closedReason.value = 'remote'
        status.value = 'closed'
        emitTerminalHarnessEvent('terminal-disconnected', { reason: closedReason.value })
        term?.writeln('\r\n\x1b[33m[Sessão encerrada]\x1b[0m')
        break
      case 'pong':
        if (pingAt !== null) {
          latency.value = Date.now() - pingAt
          pingAt = null
        }
        break
      case 'tunnels':
        tunnelState.value = { tunnels: (msg as TunnelsMessage).tunnels, errors: (msg as TunnelsMessage).errors }
        break
      case 'host_key_verification_required':
        status.value = 'error'
        error.value = 'Host key verification required'
        hostKeyChallenge.value = {
          reason: (msg as HostKeyVerificationMessage).reason,
          presentedFingerprint: (msg as HostKeyVerificationMessage).presentedFingerprint,
          trustedFingerprint: (msg as HostKeyVerificationMessage).trustedFingerprint,
        }
        term?.writeln('\r\n\x1b[33m[Host key verification required]\x1b[0m')
        break
      case 'credentials_required': {
        const cm = msg as CredentialsRequiredMessage
        credentialsChallenge.value = { hostName: cm.hostName, needsUsername: cm.needsUsername, needsPassword: cm.needsPassword }
        break
      }
      case 'save_password_offer': {
        const offerMsg = msg as SavePasswordOfferMessage
        savePasswordOffer.value = {
          hostId:        offerMsg.hostId,
          hostName:      offerMsg.hostName,
          secretName:    offerMsg.secretName,
          scope:         offerMsg.scope,
          savedUsername: offerMsg.savedUsername,
        }
        break
      }
    }
  }

  function fitTerminal() {
    if (!term) return null
    const rect = resizeTarget?.getBoundingClientRect()
    if (rect && (rect.width < 40 || rect.height < 40)) {
      terminalMetrics.value = {
        ...terminalMetrics.value,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }
      return null
    }
    const dims = term.fit()
    terminalMetrics.value = {
      cols: dims.cols,
      rows: dims.rows,
      width: Math.round(rect?.width ?? 0),
      height: Math.round(rect?.height ?? 0),
      lastResizeSentAt: terminalMetrics.value.lastResizeSentAt,
    }
    return dims
  }

  function scheduleFitAndResize(force = false) {
    const remainingTransitionMs = terminalLayoutResizeBlockedUntil - Date.now()
    if (remainingTransitionMs > 0) {
      fitTerminal()
      if (layoutResizeSettleTimer) clearTimeout(layoutResizeSettleTimer)
      layoutResizeSettleTimer = setTimeout(() => {
        layoutResizeSettleTimer = null
        scheduleFitAndResize(force)
      }, remainingTransitionMs + 16)
      return
    }
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null
        fitTerminal()
        sendResize(force)
      })
    })
  }

  function sendResize(force = false) {
    if (ws?.readyState !== WebSocket.OPEN || !term) return
    const dims = term.rows && term.cols ? { cols: term.cols, rows: term.rows } : null
    if (!dims) return
    if (terminalMetrics.value.width < 40 || terminalMetrics.value.height < 40) return
    if (dims.cols < 40 || dims.rows < 10) return
    if (!force && lastSentResize?.cols === dims.cols && lastSentResize.rows === dims.rows) return
    lastSentResize = dims
    terminalMetrics.value = {
      ...terminalMetrics.value,
      cols: dims.cols,
      rows: dims.rows,
      lastResizeSentAt: new Date().toISOString(),
    }
    ws.send(JSON.stringify({ type: 'resize', ...dims }))
  }

  async function reconnect(hostId: number, accessTokenOverride?: string, jiraSessionGrant?: string) {
    disconnect()
    term?.clear()
    await connect(hostId, accessTokenOverride, jiraSessionGrant)
  }

  function disconnect() {
    intentionalDisconnect = true
    stopPing()
    unregisterTerminalSftp?.(); unregisterTerminalSftp = null
    ws?.close()
    ws = null
  }

  function fit() {
    fitTerminal()
    if (terminalLayoutResizeBlockedUntil > Date.now()) scheduleFitAndResize()
    else sendResize()
  }
  function focus() { term?.focus() }
  function setAiPrefixHandler(handler: (() => void) | null) {
    aiPrefixHandler = handler
    aiPrefixInterceptor.reset()
  }


  onUnmounted(() => {
    if (tabId) unregisterBroadcastSender(tabId)
    if (resizeFrame !== null) {
      cancelAnimationFrame(resizeFrame)
      resizeFrame = null
    }
    if (layoutResizeSettleTimer) {
      clearTimeout(layoutResizeSettleTimer)
      layoutResizeSettleTimer = null
    }
    if (outputNotifyFrame !== null) {
      cancelAnimationFrame(outputNotifyFrame)
      outputNotifyFrame = null
    }
    resizeObserver?.disconnect()
    if (harnessInputHandler) {
      window.removeEventListener('nodeaccess:terminal-send-input', harnessInputHandler)
      harnessInputHandler = null
    }
    onDataDisposable?.dispose()
    commandSubmittedHandler = null
    disconnect()
    term?.dispose()
  })

  return {
    status, error, errorCode, sessionId, hostName, isScrolledUp, latency, currentDirectory, closedReason, tunnelState, hostKeyChallenge, outputVersion, latestOutputChunk,
    connectionMethod, agentName, credentialsChallenge, savePasswordOffer,
    terminalMetrics,
    mount, connect, reconnect, disconnect, fit, focus,
    searchNext, searchPrev,
    clear, scrollToBottom, sendText, sendSnippetText, sendSecretText, sendCredentialsResponse, dismissSavePasswordOffer, getBufferText, getSelectionText, getCursorAnchor, setDisableStdin, isMouseTrackingEnabled, setAiPrefixHandler,
  }
}

export function currentThemeColors(): { background: string; foreground: string } {
  const t = themes[termSettings.theme]
  return { background: t.background, foreground: t.foreground }
}

export function currentTerminalTheme(): TerminalTheme {
  return themes[termSettings.theme]
}

export const themeOptions = [
  { label: 'Dark (padrão)', value: 'dark'         },
  { label: 'Dracula',       value: 'dracula'       },
  { label: 'Solarized',     value: 'solarized'     },
  { label: 'One Dark',      value: 'one-dark'      },
  { label: 'Nord',          value: 'nord'          },
  { label: 'Tokyo Night',   value: 'tokyo-night'   },
]

export const presetOptions = [
  { label: 'Auto', value: 'auto' },
  { label: 'Windows', value: 'windows' },
  { label: 'Linux', value: 'linux' },
  { label: 'macOS', value: 'macos' },
  { label: 'Custom', value: 'custom' },
]

export const rightClickModeOptions = [
  { label: 'Paste', value: 'paste' },
  { label: 'Browser menu', value: 'browser-menu' },
  { label: 'Host switcher', value: 'host-switcher' },
  { label: 'Default', value: 'default' },
]

export const multilinePasteModeOptions = [
  { label: 'Always confirm', value: 'always' },
  { label: 'Confirm after 5 lines', value: 'more-than-5' },
  { label: 'Never confirm', value: 'never' },
]
