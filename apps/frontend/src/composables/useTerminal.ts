import { ref, watch, reactive, onUnmounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { handleExpiredSession } from '@/services/auth-session.service'
import { registerBroadcastSender, unregisterBroadcastSender, broadcastInput } from './useTerminalBroadcast'
import { getPlatformPresetDefaults, usePlatform, type PlatformPreset } from './usePlatform'
import { createXtermAdapter } from '@/terminal/xterm-adapter'
import type { TerminalAdapter, TerminalTheme } from '@/terminal/types'
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
export type ThemeName = TerminalThemeName
export type RightClickMode = PersistedRightClickMode
export type MultilinePasteMode = PersistedMultilinePasteMode
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
const AUTO_FULLSCREEN_KEY = 'na_term_autoFullscreenOnConnect'
const MIN_FONT  = 10
const MAX_FONT  = 24

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
  autoFullscreenOnConnect: localStorage.getItem(AUTO_FULLSCREEN_KEY) === '1',
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

export function setAutoFullscreenOnConnect(value: boolean) {
  termSettings.autoFullscreenOnConnect = value
  localStorage.setItem(AUTO_FULLSCREEN_KEY, value ? '1' : '0')
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

export function resetTerminalPreferences() {
  applyTerminalPreset('auto')
  setRightClickMode('paste')
  setMultilinePasteMode('always')
  setAutoFullscreenOnConnect(false)
}

export function applyTerminalPreferenceSnapshot(snapshot: TerminalPreferenceSnapshot) {
  termSettings.preset = snapshot.preset
  termSettings.fontSize = snapshot.fontSize
  termSettings.fontFamily = snapshot.fontFamily
  termSettings.theme = snapshot.theme
  termSettings.rightClickMode = snapshot.rightClickMode
  termSettings.multilinePasteMode = snapshot.multilinePasteMode
  termSettings.autoFullscreenOnConnect = snapshot.autoFullscreenOnConnect

  localStorage.setItem(PRESET_KEY, snapshot.preset)
  localStorage.setItem(FONT_KEY, String(snapshot.fontSize))
  localStorage.setItem(FONT_FAMILY_KEY, snapshot.fontFamily)
  localStorage.setItem(THEME_KEY, snapshot.theme)
  localStorage.setItem(RIGHT_CLICK_KEY, snapshot.rightClickMode)
  localStorage.setItem(MULTILINE_PASTE_KEY, snapshot.multilinePasteMode)
  localStorage.setItem(AUTO_FULLSCREEN_KEY, snapshot.autoFullscreenOnConnect ? '1' : '0')
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
    autoFullscreenOnConnect: termSettings.autoFullscreenOnConnect,
    snippetShortcutMode,
    hostSwitcherShortcutMode,
  }
}

// ---------------------------------------------------------------------------
// Composable por instância de terminal
// ---------------------------------------------------------------------------

interface ControlMessage {
  type:       'connected' | 'error' | 'closed' | 'pong'
  message?:   string
  sessionId?: number
  hostName?:  string
}

export interface HostKeyVerificationChallenge {
  reason: 'unknown' | 'changed'
  presentedFingerprint: string
  trustedFingerprint: string | null
}

export interface ActiveTunnel {
  id:                string
  connectionMethod:  'direct' | 'agent'
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
  errors:  Array<{ portForwardingId: number; localPort: number; code: string; message: string }>
}

interface TunnelsMessage {
  type:    'tunnels'
  tunnels: ActiveTunnel[]
  errors:  Array<{ portForwardingId: number; localPort: number; code: string; message: string }>
}

interface HostKeyVerificationMessage extends HostKeyVerificationChallenge {
  type: 'host_key_verification_required'
}

type AnyControlMessage = ControlMessage | TunnelsMessage | HostKeyVerificationMessage

const PING_INTERVAL_MS  = 30_000
const TOKEN_REFRESH_TTL = 60

export function useTerminal(tabId?: string) {
  const status      = ref<Status>('idle')
  const error       = ref<string | null>(null)
  const sessionId   = ref<number | null>(null)
  const hostName    = ref<string>('')
  const outputVersion = ref(0)
  const latestOutputChunk = ref('')
  const isScrolledUp = ref(false)
  const latency     = ref<number | null>(null)
  const tunnelState = ref<TunnelState>({ tunnels: [], errors: [] })
  const hostKeyChallenge = ref<HostKeyVerificationChallenge | null>(null)

  let term:           TerminalAdapter | null = null
  let ws:             WebSocket | null      = null
  let resizeObserver: ResizeObserver | null = null
  let pingTimer:      ReturnType<typeof setInterval> | null = null
  let onDataDisposable: { dispose(): void } | null = null
  let pingAt: number | null = null
  let intentionalDisconnect = false
  let confirmMultilinePasteHandler: ((text: string) => boolean | Promise<boolean>) | null = null
  const decoder = new TextDecoder()

  // ── Reage a mudanças globais de settings ──────────────────────────────────

  watch(() => termSettings.fontSize, (size) => {
    if (term) { term.setFontSize(size); term.fit() }
  })

  watch(() => termSettings.fontFamily, (fontFamily) => {
    if (term) { term.setFontFamily(fontFamily); term.fit() }
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
      onConfirmMultilinePaste?: (text: string) => boolean | Promise<boolean>
    },
  ) {
    confirmMultilinePasteHandler = handlers?.onConfirmMultilinePaste ?? null
    term = createXtermAdapter({
      fontSize: termSettings.fontSize,
      fontFamily: termSettings.fontFamily,
      scrollback: 5000,
      theme: themes[termSettings.theme],
    })

    term.mount(el)
    term.fit()

    // Copy-on-select (comportamento PuTTY): copia automaticamente ao selecionar texto.
    // xterm v5 removeu a opção copyOnSelect do construtor; usamos onSelectionChange.
    term.onSelectionChange(() => {
      const sel = term?.getSelection() ?? ''
      if (sel) navigator.clipboard.writeText(sel).catch(() => {})
    })

    // Intercepta atalhos antes de enviar ao shell.
    term.attachShortcuts({
      onFind: handlers?.onOpenSearch,
    })

    resizeObserver = new ResizeObserver(() => { term?.fit(); sendResize() })
    resizeObserver.observe(el)

    term.onScroll((viewportY) => {
      if (!term) return
      const max = term.bufferLength - term.rows
      isScrolledUp.value = viewportY < max - 1
    })
  }

  // ── Connect ───────────────────────────────────────────────────────────────

  async function connect(hostId: number) {
    const ok = await refreshTokenIfNeeded()
    if (!ok) return

    const auth  = useAuthStore()
    const token = auth.accessToken
    if (!token || !term) return

    intentionalDisconnect = false
    stopPing()
    ws?.close()
    ws = null

    status.value = 'connecting'
    error.value  = null
    sessionId.value = null
    hostName.value = ''
    tunnelState.value = { tunnels: [], errors: [] }
    hostKeyChallenge.value = null

    // Descarta listener anterior para evitar envio duplicado em reconexões
    onDataDisposable?.dispose()
    onDataDisposable = term!.onData(async (data) => {
      const normalized = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      const trimmed = normalized.replace(/\n+$/g, '')
      const looksLikeMultilinePaste = trimmed.includes('\n')
      if (looksLikeMultilinePaste && confirmMultilinePasteHandler) {
        const allowed = await confirmMultilinePasteHandler(data)
        if (!allowed) return
      }
      const encoded = new TextEncoder().encode(data)
      if (ws?.readyState === WebSocket.OPEN) ws.send(encoded)
      if (tabId) broadcastInput(encoded, tabId)
    })

    // Register this terminal as a broadcast target
    if (tabId) {
      registerBroadcastSender(tabId, (data) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(data)
      })
    }

    const wsBase = import.meta.env.VITE_WS_URL ?? `ws://${location.host}`
    // Re-fit antes de ler as dimensões: garante que cols/rows reflitam o tamanho
    // real do container no momento do connect, evitando wrap no output inicial.
    term?.fit()
    const cols   = term?.cols ?? 80
    const rows   = term?.rows ?? 24
    const url    = `${wsBase}/ws/ssh/${hostId}?token=${encodeURIComponent(token)}&cols=${cols}&rows=${rows}`

    ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'

    ws.onopen    = () => startPing()
    ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        const chunkBytes = new Uint8Array(event.data)
        term?.write(chunkBytes)
        latestOutputChunk.value = decoder.decode(chunkBytes, { stream: true })
        outputVersion.value += 1
        return
      }
      try { handleControl(JSON.parse(event.data as string) as AnyControlMessage) } catch { /* ignore */ }
    }
    ws.onclose = () => {
      stopPing()
      tunnelState.value = { tunnels: [], errors: [] }
      if (intentionalDisconnect) {
        status.value = 'idle'
        return
      }
      if (status.value === 'connected') {
        status.value = 'closed'
        term?.writeln('\r\n\x1b[33m[Conexão encerrada]\x1b[0m')
        return
      }
      if (status.value === 'connecting') {
        status.value = 'closed'
        error.value = error.value ?? 'Conexão encerrada antes da sessão SSH iniciar'
        term?.writeln('\r\n\x1b[33m[Conexão encerrada antes da sessão iniciar]\x1b[0m')
      }
    }
    ws.onerror = () => {
      stopPing()
      status.value = 'error'
      error.value  = 'Erro na conexão WebSocket'
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
      await refreshTokenIfNeeded()
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

  /** Envia texto ao shell como se o usuário tivesse digitado (ex: snippet) */
  function sendText(text: string) {
    const encoded = new TextEncoder().encode(text)
    if (ws?.readyState === WebSocket.OPEN) ws.send(encoded)
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function handleControl(msg: AnyControlMessage) {
    switch (msg.type) {
      case 'connected':
        status.value    = 'connected'
        sessionId.value = (msg as ControlMessage).sessionId ?? null
        hostName.value  = (msg as ControlMessage).hostName ?? ''
        // Sincroniza PTY com dimensões reais (o ResizeObserver pode ter disparado
        // antes do handler SSH estar pronto no backend)
        sendResize()
        break
      case 'error':
        status.value = 'error'
        error.value  = (msg as ControlMessage).message ?? 'Erro desconhecido'
        term?.writeln(`\r\n\x1b[31m[${error.value}]\x1b[0m`)
        if (
          error.value.toLowerCase().includes('expirada')
          || error.value.toLowerCase().includes('expired')
          || error.value.toLowerCase().includes('unauthorized')
        ) {
          void handleExpiredSession()
        }
        break
      case 'closed':
        status.value = 'closed'
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
    }
  }

  function sendResize() {
    if (ws?.readyState !== WebSocket.OPEN || !term) return
    const dims = term.rows && term.cols ? { cols: term.cols, rows: term.rows } : null
    if (dims) ws.send(JSON.stringify({ type: 'resize', ...dims }))
  }

  async function reconnect(hostId: number) {
    disconnect()
    term?.clear()
    await connect(hostId)
  }

  function disconnect() {
    intentionalDisconnect = true
    stopPing()
    ws?.close()
    ws = null
  }

  function fit() { term?.fit() }
  function focus() { term?.focus() }


  onUnmounted(() => {
    if (tabId) unregisterBroadcastSender(tabId)
    resizeObserver?.disconnect()
    onDataDisposable?.dispose()
    disconnect()
    term?.dispose()
  })

  return {
    status, error, sessionId, hostName, isScrolledUp, latency, tunnelState, hostKeyChallenge, outputVersion, latestOutputChunk,
    mount, connect, reconnect, disconnect, fit, focus,
    searchNext, searchPrev,
    clear, scrollToBottom, sendText, getBufferText, setDisableStdin,
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
