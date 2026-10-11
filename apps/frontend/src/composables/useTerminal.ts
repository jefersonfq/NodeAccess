import { ref, watch, onUnmounted, type Ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { handleExpiredSession } from '@/services/auth-session.service'
import { TerminalOscDirectoryTracker } from '@/services/terminal-osc-directory.service'
import { handleTerminalSftpResult, registerTerminalSftpChannel } from '@/services/terminal-sftp-channel.service'
import { registerBroadcastSender, unregisterBroadcastSender, broadcastInput } from './useTerminalBroadcast'
import { createXtermAdapter } from '@/terminal/xterm-adapter'
import type { TerminalAdapter, TerminalTheme } from '@/terminal/types'
import { TerminalAiPrefixInterceptor } from '@/services/terminal-ai-prefix.service'
import { TerminalInputModel } from '@/services/terminal-input-model.service'
import { TerminalAlternateScreenTracker } from '@/services/terminal-alternate-screen.service'
import { TerminalHighlighter } from '@/terminal/terminal-highlighter'
import { terminalHighlightService, type EffectiveTerminalHighlights } from '@/services/terminal-highlight.service'
import { TERMINAL_HIGHLIGHTS_CHANGED_EVENT } from '@/services/app-events.service'
import { termSettings, type ThemeName } from './terminal-preferences'
export * from './terminal-preferences'

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
  | 'terminal-highlights-loaded'
  | 'terminal-highlights-pass'

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
  'nodeaccess-operations': {
    background: '#111820', foreground: '#d7e2ea', cursor: '#54d6a0',
    selectionBackground: '#224b5c', selectionForeground: '#ffffff',
    black: '#101820', red: '#ff6b6b', green: '#54d6a0', yellow: '#ffd166',
    blue: '#61aefc', magenta: '#c792ea', cyan: '#56d4dd', white: '#e6edf3',
  },
  'low-light': {
    background: '#171512', foreground: '#c9c0ad', cursor: '#d6b36a',
    selectionBackground: '#3d3529', selectionForeground: '#fff8e8',
    black: '#171512', red: '#c96f6f', green: '#8fa873', yellow: '#c9a75d',
    blue: '#7895b2', magenta: '#aa82a8', cyan: '#75a5a5', white: '#d8cfbd',
  },
  'high-contrast': {
    background: '#000000', foreground: '#ffffff', cursor: '#ffff00',
    selectionBackground: '#005fcc', selectionForeground: '#ffffff',
    black: '#000000', red: '#ff5f5f', green: '#5fff87', yellow: '#ffff5f',
    blue: '#5fafff', magenta: '#ff5fff', cyan: '#5fffff', white: '#ffffff',
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

let terminalLayoutResizeBlockedUntil = 0

export function deferTerminalLayoutResize(durationMs = 220): void {
  terminalLayoutResizeBlockedUntil = Math.max(terminalLayoutResizeBlockedUntil, Date.now() + Math.max(0, durationMs))
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

interface TerminalController {
  status: Ref<Status>
  error: Ref<string | null>
  errorCode: Ref<string | null>
  sessionId: Ref<number | null>
  hostName: Ref<string>
  isScrolledUp: Ref<boolean>
  latency: Ref<number | null>
  currentDirectory: Ref<string | null>
  closedReason: Ref<ClosedReason>
  tunnelState: Ref<TunnelState>
  hostKeyChallenge: Ref<HostKeyVerificationChallenge | null>
  outputVersion: Ref<number>
  latestOutputChunk: Ref<string>
  connectionMethod: Ref<ConnectionMethod | null>
  agentName: Ref<string | null>
  credentialsChallenge: Ref<CredentialsChallenge | null>
  savePasswordOffer: Ref<SavePasswordOffer | null>
  terminalMetrics: Ref<{ cols: number; rows: number; width: number; height: number; lastResizeSentAt: string | null }>
  activeHighlightRules: Ref<EffectiveTerminalHighlights['rules']>
  focusedHighlightRuleId: Ref<string | null>
  mount(this: void, el: HTMLElement, handlers?: {
    onOpenSearch?: () => void
    onShortcutKey?: (event: KeyboardEvent) => boolean
    endedActions?: boolean
    onConfirmMultilinePaste?: (text: string) => boolean | Promise<boolean>
    onInputChange?: (value: string, cursor: number, reliable: boolean) => void
    onCommandSubmitted?: (command: string) => void
  }): void
  connect(this: void, hostId: number, accessTokenOverride?: string, jiraSessionGrant?: string): Promise<void>
  reconnect(this: void, hostId: number, accessTokenOverride?: string, jiraSessionGrant?: string): Promise<void>
  disconnect(this: void): void
  fit(this: void): void
  focus(this: void): void
  searchNext(this: void, query: string): void
  searchPrev(this: void, query: string): void
  focusHighlightRule(this: void, ruleId: string | null): void
  clear(this: void): void
  scrollToBottom(this: void): void
  sendText(this: void, text: string): void
  sendSnippetText(this: void, text: string, context: { snippetId: number; snippetName?: string; executionId: string }): void
  sendSecretText(this: void, text: string, context?: { snippetId?: number; snippetName?: string; executionId?: string }): void
  sendCredentialsResponse(this: void, username: string, password: string, secretId?: number): void
  dismissSavePasswordOffer(this: void): void
  getBufferText(this: void): string
  getSelectionText(this: void): string
  getCursorAnchor(this: void): ReturnType<TerminalAdapter['getCursorAnchor']>
  setDisableStdin(this: void, disabled: boolean): void
  isMouseTrackingEnabled(this: void): boolean
  setAiPrefixHandler(this: void, handler: (() => void) | null): void
}

export function useTerminal(tabId?: string): TerminalController {
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
  let endedActionsEnabled = false
  const tunnelState          = ref<TunnelState>({ tunnels: [], errors: [] })
  const hostKeyChallenge     = ref<HostKeyVerificationChallenge | null>(null)
  const credentialsChallenge = ref<CredentialsChallenge | null>(null)
  const savePasswordOffer    = ref<SavePasswordOffer | null>(null)
  const connectionMethod   = ref<ConnectionMethod | null>(null)
  const agentName          = ref<string | null>(null)

  let term:           TerminalAdapter | null = null
  let highlighter: TerminalHighlighter | null = null
  const activeHighlightRules = ref<EffectiveTerminalHighlights['rules']>([])
  const focusedHighlightRuleId = ref<string | null>(null)
  let lastHighlightTelemetryAt = 0
  let ws:             WebSocket | null      = null
  let resizeObserver: ResizeObserver | null = null
  let resizeTarget: HTMLElement | null = null
  let resizeFrame: number | null = null
  let layoutResizeSettleTimer: ReturnType<typeof setTimeout> | null = null
  let pingTimer:      ReturnType<typeof setInterval> | null = null
  let onDataDisposable: { dispose(): void } | null = null
  let pingAt: number | null = null
  const oscDirectoryTracker = new TerminalOscDirectoryTracker()
  const alternateScreenTracker = new TerminalAlternateScreenTracker()
  let lastSentResize: { cols: number; rows: number } | null = null
  let intentionalDisconnect = false
  let usingExternalAccessToken = false
  let privateHighlightsEnabled = false
  let highlightContextGeneration = 0
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
  const loadHighlights = async (fresh = false): Promise<void> => {
    if (!term || !privateHighlightsEnabled) return
    const generation = highlightContextGeneration
    try {
      const { data } = await terminalHighlightService.effective({ fresh })
      if (!privateHighlightsEnabled || generation !== highlightContextGeneration) return
      activeHighlightRules.value = data.enabled ? data.rules : []
      highlighter?.setRules(focusedHighlightRuleId.value ? activeHighlightRules.value.filter((rule) => rule.id === focusedHighlightRuleId.value) : activeHighlightRules.value)
      emitTerminalHarnessEvent('terminal-highlights-loaded', { enabled: data.enabled, ruleCount: data.rules.length, version: data.version })
    } catch (error) {
      if (!privateHighlightsEnabled || generation !== highlightContextGeneration) return
      highlighter?.setRules([])
      activeHighlightRules.value = []
      emitTerminalHarnessEvent('terminal-highlights-loaded', { enabled: false, ruleCount: 0, error: error instanceof Error ? error.message : String(error) })
    }
  }
  const refreshHighlights = (): void => {
    if (!privateHighlightsEnabled) return
    terminalHighlightService.invalidate('realtime', false, false)
    void loadHighlights(true)
  }
  function focusHighlightRule(ruleId: string | null): void {
    focusedHighlightRuleId.value = ruleId
    highlighter?.setRules(ruleId ? activeHighlightRules.value.filter((rule) => rule.id === ruleId) : activeHighlightRules.value)
  }
  const terminalMetrics = ref({
    cols: 0,
    rows: 0,
    width: 0,
    height: 0,
    lastResizeSentAt: null as string | null,
  })

  function emitTerminalHarnessEvent(name: TerminalHarnessEventName, detail: Record<string, unknown> = {}): void {
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

  function isTerminalHarnessInputAllowed(): boolean {
    return import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(window.location.hostname)
  }

  function sendHarnessInput(text: string): void {
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
      const payload: unknown = JSON.parse(atob(token.split('.')[1]))
      return payload !== null && typeof payload === 'object' && 'exp' in payload && typeof payload.exp === 'number' ? payload.exp : null
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
      endedActions?: boolean
      onConfirmMultilinePaste?: (text: string) => boolean | Promise<boolean>
      onInputChange?: (value: string, cursor: number, reliable: boolean) => void
      onCommandSubmitted?: (command: string) => void
    },
  ): void {
    confirmMultilinePasteHandler = handlers?.onConfirmMultilinePaste ?? null
    inputChangeHandler = handlers?.onInputChange ?? null
    commandSubmittedHandler = handlers?.onCommandSubmitted ?? null
    term = createXtermAdapter({
      fontSize: termSettings.fontSize,
      fontFamily: termSettings.fontFamily,
      scrollback: 5000,
      theme: themes[termSettings.theme],
    })
    highlighter = new TerminalHighlighter(term, (sample) => {
      if (!privateHighlightsEnabled) return
      const now = Date.now()
      if (now - lastHighlightTelemetryAt < 30_000) return
      lastHighlightTelemetryAt = now
      void terminalHighlightService.telemetry(sample).catch(() => {})
    })
    // connect determines whether private preferences are allowed before loading.
    window.addEventListener(TERMINAL_HIGHLIGHTS_CHANGED_EVENT, refreshHighlights)
    window.addEventListener('nodeaccess:terminal-highlights-invalidated', refreshHighlights)

    term.mount(el)
    emitTerminalHarnessEvent('terminal-mounted')
    harnessInputHandler = (event: Event): void => {
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
    endedActionsEnabled = handlers?.endedActions ?? false
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

  async function connect(hostId: number, accessTokenOverride?: string, jiraSessionGrant?: string): Promise<void> {
    usingExternalAccessToken = !!accessTokenOverride
    privateHighlightsEnabled = false
    highlightContextGeneration++
    activeHighlightRules.value = []
    focusedHighlightRuleId.value = null
    highlighter?.setRules([])
    if (!accessTokenOverride) {
      const ok = await refreshTokenIfNeeded()
      if (!ok) return
    }

    const auth  = useAuthStore()
    const token = accessTokenOverride ?? auth.accessToken
    if (!token || !term) return

    privateHighlightsEnabled = !usingExternalAccessToken
    if (privateHighlightsEnabled) void loadHighlights()

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
    const sendInput = (data: string): void => {
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
    const writeLocalErase = (chars: number): void => term?.write(new TextEncoder().encode('\b \b'.repeat(chars)))
    const handleInput = async (data: string): Promise<void> => {
      if (status.value !== 'connected') return
      const normalized = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      const trimmed = normalized.replace(/\n+$/g, '')
      const looksLikeMultilinePaste = trimmed.includes('\n')
      if (looksLikeMultilinePaste && confirmMultilinePasteHandler) {
        const allowed = await confirmMultilinePasteHandler(data)
        if (!allowed || status.value !== 'connected') return
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
    }
    onDataDisposable = term.onData((data) => { void handleInput(data) })

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

    ws.onopen = (): void => {
      if (ws !== thisWs) return
      startPing()
    }
    ws.onmessage = (event: MessageEvent): void => {
      if (ws !== thisWs) return
      if (event.data instanceof ArrayBuffer) {
        const chunkBytes = new Uint8Array(event.data)
        term?.write(chunkBytes, () => highlighter?.schedule(chunkBytes.byteLength))
        const decodedChunk = decoder.decode(chunkBytes, { stream: true })
        if (alternateScreenTracker.consume(decodedChunk)) {
          // vim/htop/top entram no alternate buffer e passam a depender do
          // tamanho integral do PTY. Reafirma a dimensão depois dessa transição.
          scheduleFitAndResize(true)
        }
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
    ws.onclose = (): void => {
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
        term?.writeln(error.value ?? 'A conexão com o gateway foi interrompida. O navegador não recebeu o motivo remoto.')
        if (endedActionsEnabled) term?.writeln('Pressione R para reconectar ou outra letra para sair deste terminal.')
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
    ws.onerror = (): void => {
      if (ws !== thisWs) return
      stopPing()
      status.value = 'error'
      error.value  = 'Erro na conexão WebSocket'
      emitTerminalHarnessEvent('terminal-error', { message: error.value })
      term?.writeln('\r\n\x1b[31m[Erro de conexão]\x1b[0m')
    }
  }

  // ── Ping ──────────────────────────────────────────────────────────────────

  function startPing(): void {
    stopPing()
    pingTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        pingAt = Date.now()
        ws.send(JSON.stringify({ type: 'ping' }))
      }
      if (!usingExternalAccessToken) {
        void refreshTokenIfNeeded()
      }
    }, PING_INTERVAL_MS)
  }

  function stopPing(): void {
    if (pingTimer !== null) { clearInterval(pingTimer); pingTimer = null }
  }

  // ── Busca ─────────────────────────────────────────────────────────────────

  function searchNext(query: string): void {
    if (!query) return
    term?.searchNext(query)
  }

  function searchPrev(query: string): void {
    if (!query) return
    term?.searchPrev(query)
  }

  // ── Ações do terminal ────────────────────────────────────────────────────

  function clear(): void { term?.clear() }

  function scrollToBottom(): void { term?.scrollToBottom() }

  function setDisableStdin(disabled: boolean): void {
    term?.setDisableStdin(disabled)
  }

  function isMouseTrackingEnabled(): boolean {
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
  function sendText(text: string): void {
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

  function getCursorAnchor(): ReturnType<TerminalAdapter['getCursorAnchor']> { return term?.getCursorAnchor() ?? null }

  /** Envia texto com placeholders de secrets para resolução server-side. */
  function sendCredentialsResponse(username: string, password: string, secretId?: number): void {
    if (ws?.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'credentials_response', username, password, ...(secretId ? { secretId } : {}) }))
    credentialsChallenge.value = null
  }

  function dismissSavePasswordOffer(): void {
    savePasswordOffer.value = null
  }

  function sendSnippetText(text: string, context: { snippetId: number; snippetName?: string; executionId: string }): void {
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

  function sendSecretText(text: string, context?: { snippetId?: number; snippetName?: string; executionId?: string }): void {
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

  function handleControl(msg: AnyControlMessage): void {
    switch (msg.type) {
      case 'connected':
        status.value           = 'connected'
        sessionId.value        = msg.sessionId ?? null
        unregisterTerminalSftp?.()
        unregisterTerminalSftp = sessionId.value && ws
          ? registerTerminalSftpChannel(sessionId.value, (message) => { if (ws?.readyState === WebSocket.OPEN) ws.send(message) })
          : null
        hostName.value         = msg.hostName ?? ''
        connectionMethod.value = msg.connectionMethod ?? null
        agentName.value        = msg.agentName ?? null
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
        if (msg.message) {
          term?.writeln(`\r\n\x1b[36m[NodeAccess] ${msg.message}\x1b[0m`)
        }
        break
      case 'error': {
        status.value    = 'error'
        error.value     = msg.message ?? 'Erro desconhecido'
        errorCode.value = msg.code ?? null
        emitTerminalHarnessEvent('terminal-error', {
          message: error.value,
          code: errorCode.value,
        })
        const hint = hintForErrorCode(errorCode.value)
        term?.writeln(`\r\n\x1b[31m✖ ${error.value}\x1b[0m`)
        if (hint) term?.writeln(`\x1b[33m  → ${hint}\x1b[0m`)
        if (!usingExternalAccessToken && (
          error.value.toLowerCase().includes('expirada')
          || error.value.toLowerCase().includes('expired')
          || error.value.toLowerCase().includes('unauthorized')
        )) {
          void handleExpiredSession()
        }
        break
      }
      case 'closed':
        closedReason.value = 'remote'
        status.value = 'closed'
        emitTerminalHarnessEvent('terminal-disconnected', { reason: closedReason.value })
        term?.writeln('\r\n\x1b[33m[Sessão encerrada]\x1b[0m')
        term?.writeln(error.value ?? msg.message ?? 'O servidor remoto encerrou a sessão (por exemplo, exit/logout).')
        if (endedActionsEnabled) term?.writeln('Pressione R para reconectar ou outra letra para sair deste terminal.')
        break
      case 'pong':
        if (pingAt !== null) {
          latency.value = Date.now() - pingAt
          pingAt = null
        }
        break
      case 'tunnels':
        tunnelState.value = { tunnels: msg.tunnels, errors: msg.errors }
        break
      case 'host_key_verification_required':
        status.value = 'error'
        error.value = 'Host key verification required'
        hostKeyChallenge.value = {
          reason: msg.reason,
          presentedFingerprint: msg.presentedFingerprint,
          trustedFingerprint: msg.trustedFingerprint,
        }
        term?.writeln('\r\n\x1b[33m[Host key verification required]\x1b[0m')
        break
      case 'credentials_required': {
        const cm = msg
        credentialsChallenge.value = { hostName: cm.hostName, needsUsername: cm.needsUsername, needsPassword: cm.needsPassword }
        break
      }
      case 'save_password_offer': {
        const offerMsg = msg
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

  function fitTerminal(): { cols: number; rows: number } | null {
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

  function scheduleFitAndResize(force = false): void {
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

  function sendResize(force = false): void {
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

  async function reconnect(hostId: number, accessTokenOverride?: string, jiraSessionGrant?: string): Promise<void> {
    disconnect()
    term?.clear()
    await connect(hostId, accessTokenOverride, jiraSessionGrant)
  }

  function disconnect(): void {
    intentionalDisconnect = true
    stopPing()
    unregisterTerminalSftp?.(); unregisterTerminalSftp = null
    ws?.close()
    ws = null
    alternateScreenTracker.reset()
  }

  function fit(): void {
    fitTerminal()
    if (terminalLayoutResizeBlockedUntil > Date.now()) scheduleFitAndResize()
    else sendResize()
  }
  function focus(): void { term?.focus() }
  function setAiPrefixHandler(handler: (() => void) | null): void {
    aiPrefixHandler = handler
    aiPrefixInterceptor.reset()
  }


  onUnmounted(() => {
    privateHighlightsEnabled = false
    highlightContextGeneration++
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
    window.removeEventListener(TERMINAL_HIGHLIGHTS_CHANGED_EVENT, refreshHighlights)
    window.removeEventListener('nodeaccess:terminal-highlights-invalidated', refreshHighlights)
    highlighter?.dispose()
    highlighter = null
    commandSubmittedHandler = null
    disconnect()
    term?.dispose()
  })

  return {
    status, error, errorCode, sessionId, hostName, isScrolledUp, latency, currentDirectory, closedReason, tunnelState, hostKeyChallenge, outputVersion, latestOutputChunk,
    connectionMethod, agentName, credentialsChallenge, savePasswordOffer,
    terminalMetrics, activeHighlightRules, focusedHighlightRuleId,
    mount, connect, reconnect, disconnect, fit, focus,
    searchNext, searchPrev, focusHighlightRule,
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
  { label: 'NodeAccess Operations', value: 'nodeaccess-operations' },
  { label: 'Baixa luminosidade', value: 'low-light' },
  { label: 'Alto contraste', value: 'high-contrast' },
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
