import { computed, ref, watch, onUnmounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { handleExpiredSession } from '@/services/auth-session.service'
import { createXtermAdapter } from '@/terminal/xterm-adapter'
import type {
  SharedSessionControlLease,
  SharedSessionParticipant,
  SharedSessionPublic,
  SharedSessionResolved,
  SharedSessionStatus,
} from '@nodeaccess/shared'
import type { TerminalAdapter } from '@/terminal/types'
import { termSettings, currentTerminalTheme } from '@/composables/useTerminal'

const PING_INTERVAL_MS = 30_000
const TOKEN_REFRESH_TTL = 60

type ViewerStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'closed'

type SharedSessionControlMessage =
  | {
      type: 'shared_session_snapshot'
      participants: SharedSessionParticipant[]
      status: SharedSessionStatus
      role: 'owner' | 'viewer'
      expiresAt: string | Date
      activeControlLease?: SharedSessionControlLease | null
      pendingControlRequestUserIds?: number[]
    }
  | { type: 'shared_session_initial_output'; text: string }
  | { type: 'shared_session_participant_joined'; participant: SharedSessionParticipant }
  | { type: 'shared_session_participant_left'; userId: number }
  | { type: 'shared_session_control_requested'; userId: number }
  | { type: 'shared_session_control_granted'; lease: SharedSessionControlLease }
  | { type: 'shared_session_control_denied'; userId: number; reason?: string | null }
  | { type: 'shared_session_control_revoked'; userId: number; reason?: string | null }
  | { type: 'shared_session_control_expired'; userId: number }
  | { type: 'shared_session_input_blocked' }
  | { type: 'shared_session_ended' }
  | { type: 'shared_session_error'; message: string }
  | { type: 'pong' }
  | { type: 'error'; message: string }

export function useSharedSessionViewer() {
  const auth = useAuthStore()

  const status = ref<ViewerStatus>('idle')
  const error = ref<string | null>(null)
  const participants = ref<SharedSessionParticipant[]>([])
  const role = ref<'owner' | 'viewer'>('viewer')
  const sharedStatus = ref<SharedSessionStatus>('active')
  const expiresAt = ref<Date | null>(null)
  const activeControlLease = ref<SharedSessionControlLease | null>(null)
  const pendingControlRequests = ref<number[]>([])

  let term: TerminalAdapter | null = null
  let ws: WebSocket | null = null
  let resizeObserver: ResizeObserver | null = null
  let pingTimer: number | null = null
  let onDataDisposable: { dispose(): void } | null = null

  const currentUserId = computed(() => auth.user?.id ?? null)

  const canInput = computed(() => {
    if (sharedStatus.value !== 'active') return false
    if (role.value === 'owner') {
      return !activeControlLease.value || activeControlLease.value.controllerUserId === currentUserId.value
    }
    return activeControlLease.value?.controllerUserId === currentUserId.value
  })

  watch(() => termSettings.fontSize, (size) => {
    if (term) { term.setFontSize(size); term.fit() }
  })

  watch(() => termSettings.fontFamily, (fontFamily) => {
    if (term) { term.setFontFamily(fontFamily); term.fit() }
  })

  watch(() => termSettings.theme, () => {
    if (term) term.setTheme(currentTerminalTheme())
  })

  watch(canInput, (value, previousValue) => {
    term?.setDisableStdin(!value)
    if (value && !previousValue) {
      term?.fit()
      term?.scrollToBottom()
      term?.focus()
    }
  }, { immediate: true })

  function mount(el: HTMLElement) {
    term = createXtermAdapter({
      fontSize: termSettings.fontSize,
      fontFamily: termSettings.fontFamily,
      scrollback: 5000,
      theme: currentTerminalTheme(),
    })
    term.mount(el)
    term.fit()
    term.setDisableStdin(!canInput.value)

    term.onSelectionChange(() => {
      const selection = term?.getSelection() ?? ''
      if (selection) navigator.clipboard.writeText(selection).catch(() => {})
    })

    resizeObserver = new ResizeObserver(() => term?.fit())
    resizeObserver.observe(el)
  }

  function getTokenExp(token: string): number | null {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]!))
      return typeof payload.exp === 'number' ? payload.exp : null
    } catch {
      return null
    }
  }

  function isExpiringSoon(token: string): boolean {
    const exp = getTokenExp(token)
    if (exp === null) return true
    return (exp - Date.now() / 1000) < TOKEN_REFRESH_TTL
  }

  async function refreshTokenIfNeeded(): Promise<boolean> {
    if (!auth.accessToken || !isExpiringSoon(auth.accessToken)) return true
    const ok = await auth.refresh()
    if (!ok) {
      status.value = 'error'
      error.value = 'Sessão expirada'
      term?.writeln('\r\n\x1b[31m[Sessão expirada — faça login novamente]\x1b[0m')
      window.setTimeout(() => { void handleExpiredSession() }, 300)
    }
    return ok
  }

  async function connect(resolved: SharedSessionResolved) {
    const ok = await refreshTokenIfNeeded()
    if (!ok) return
    if (!auth.accessToken || !term) return

    disconnect()
    status.value = 'connecting'
    error.value = null
    role.value = resolved.role
    expiresAt.value = resolved.expiresAt
    activeControlLease.value = resolved.activeControlLease ?? null

    const wsBase = import.meta.env.VITE_WS_URL ?? `ws://${location.host}`
    const url = `${wsBase}/ws/shared-sessions/${resolved.sharedSessionId}?token=${encodeURIComponent(auth.accessToken)}`

    ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => startPing()

    onDataDisposable?.dispose()
    onDataDisposable = term.onData((data) => {
      if (!canInput.value) return
      const encoded = new TextEncoder().encode(data)
      if (ws?.readyState === WebSocket.OPEN) ws.send(encoded)
    })

    ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        term?.write(new Uint8Array(event.data))
        if (canInput.value) {
          term?.scrollToBottom()
        }
        return
      }
      try {
        handleControl(JSON.parse(event.data as string) as SharedSessionControlMessage)
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = () => {
      stopPing()
      if (status.value === 'connected') {
        status.value = 'closed'
        term?.writeln('\r\n\x1b[33m[Sessão compartilhada encerrada]\x1b[0m')
      }
    }

    ws.onerror = () => {
      stopPing()
      status.value = 'error'
      error.value = 'Erro na conexão WebSocket'
      term?.writeln('\r\n\x1b[31m[Erro de conexão]\x1b[0m')
    }
  }

  function handleControl(message: SharedSessionControlMessage) {
    switch (message.type) {
      case 'shared_session_snapshot':
        participants.value = message.participants
        role.value = message.role
        sharedStatus.value = message.status
        expiresAt.value = new Date(message.expiresAt)
        activeControlLease.value = message.activeControlLease ?? null
        pendingControlRequests.value = message.pendingControlRequestUserIds ?? []
        status.value = 'connected'
        term?.setTheme(currentTerminalTheme())
        break
      case 'shared_session_initial_output':
        if (message.text) {
          term?.write(new TextEncoder().encode(message.text))
        }
        break
      case 'shared_session_participant_joined':
        participants.value = [
          ...participants.value.filter((item) => item.userId !== message.participant.userId),
          message.participant,
        ]
        break
      case 'shared_session_participant_left':
        participants.value = participants.value.map((item) =>
          item.userId === message.userId
            ? { ...item, leftAt: new Date(), lastSeenAt: new Date() }
            : item,
        )
        break
      case 'shared_session_control_requested':
        if (!pendingControlRequests.value.includes(message.userId)) {
          pendingControlRequests.value = [...pendingControlRequests.value, message.userId]
        }
        break
      case 'shared_session_control_granted':
        activeControlLease.value = message.lease
        pendingControlRequests.value = pendingControlRequests.value.filter((userId) => userId !== message.lease.controllerUserId)
        break
      case 'shared_session_control_denied':
        pendingControlRequests.value = pendingControlRequests.value.filter((userId) => userId !== message.userId)
        if (message.userId === currentUserId.value) {
          term?.writeln(`\r\n\x1b[33m[Pedido de controle negado${message.reason ? `: ${message.reason}` : ''}]\x1b[0m`)
        }
        break
      case 'shared_session_control_revoked':
        activeControlLease.value = null
        if (message.userId === currentUserId.value) {
          term?.writeln(`\r\n\x1b[33m[Seu controle foi revogado${message.reason ? `: ${message.reason}` : ''}]\x1b[0m`)
        }
        break
      case 'shared_session_control_expired':
        activeControlLease.value = null
        if (message.userId === currentUserId.value) {
          term?.writeln('\r\n\x1b[33m[Seu controle expirou]\x1b[0m')
        }
        break
      case 'shared_session_input_blocked':
        term?.writeln('\r\n\x1b[33m[Input bloqueado: sem controle ativo]\x1b[0m')
        break
      case 'shared_session_ended':
        sharedStatus.value = 'ended'
        status.value = 'closed'
        term?.writeln('\r\n\x1b[33m[Sessão compartilhada encerrada pelo owner]\x1b[0m')
        break
      case 'shared_session_error':
      case 'error':
        status.value = 'error'
        error.value = message.message
        term?.writeln(`\r\n\x1b[31m[${message.message}]\x1b[0m`)
        break
      case 'pong':
        break
    }
  }

  function startPing() {
    stopPing()
    pingTimer = window.setInterval(async () => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
      await refreshTokenIfNeeded()
    }, PING_INTERVAL_MS)
  }

  function stopPing() {
    if (pingTimer !== null) {
      window.clearInterval(pingTimer)
      pingTimer = null
    }
  }

  function disconnect() {
    stopPing()
    resizeObserver?.disconnect()
    resizeObserver = null
    onDataDisposable?.dispose()
    onDataDisposable = null
    ws?.close()
    ws = null
  }

  function focus() {
    term?.focus()
  }

  function syncState(data: Pick<SharedSessionPublic, 'participants' | 'status' | 'expiresAt' | 'activeControlLease' | 'pendingControlRequestUserIds'>) {
    participants.value = data.participants
    sharedStatus.value = data.status
    expiresAt.value = data.expiresAt
    activeControlLease.value = data.activeControlLease ?? null
    pendingControlRequests.value = data.pendingControlRequestUserIds ?? []
  }

  onUnmounted(() => {
    disconnect()
    term?.dispose()
  })

  return {
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
    disconnect,
    focus,
    syncState,
  }
}
