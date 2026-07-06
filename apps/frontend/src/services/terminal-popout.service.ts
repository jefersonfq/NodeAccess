import type { HostPublic } from '@nodeaccess/shared'

const CHANNEL_NAME = 'nodeaccess:terminal-popout'
export const TERMINAL_POPOUT_DRAG_MIME = 'application/x-nodeaccess-terminal-popout'

export interface TerminalPopoutHost {
  id: number
  name: string
  ip?: string
  port?: number
  authType?: HostPublic['authType'] | string
  accessProtocol?: HostPublic['accessProtocol']
}

export interface TerminalPopoutOpenOptions {
  host: TerminalPopoutHost
  sourceTabId: string
  mode: 'copy' | 'move'
}

export interface TerminalPopoutDragPayload {
  requestId: string
  popoutId: string
  host: TerminalPopoutHost
}

interface PopoutConnectedEvent {
  type: 'terminal-popout-connected'
  popoutId: string
  sourceTabId: string
  mode: 'copy' | 'move'
  host: TerminalPopoutHost
}

interface PopoutClosedEvent {
  type: 'terminal-popout-closed'
  popoutId: string
}

interface PopoutInsertRequestedEvent {
  type: 'terminal-popout-insert-requested'
  requestId: string
  popoutId: string
  host: TerminalPopoutHost
}

interface PopoutInsertedEvent {
  type: 'terminal-popout-inserted'
  requestId: string
}

export type TerminalPopoutEvent =
  | PopoutConnectedEvent
  | PopoutClosedEvent
  | PopoutInsertRequestedEvent
  | PopoutInsertedEvent

type TerminalPopoutListener = (event: TerminalPopoutEvent) => void

function createChannel() {
  if (typeof BroadcastChannel === 'undefined') return null
  return new BroadcastChannel(CHANNEL_NAME)
}

function post(event: TerminalPopoutEvent) {
  const channel = createChannel()
  if (!channel) {
    window.localStorage.setItem(CHANNEL_NAME, JSON.stringify({ ...event, sentAt: Date.now() }))
    window.localStorage.removeItem(CHANNEL_NAME)
    return
  }
  channel.postMessage(event)
  channel.close()
}

export function listenTerminalPopoutEvents(listener: TerminalPopoutListener) {
  const channel = createChannel()
  const onStorage = (event: StorageEvent) => {
    if (event.key !== CHANNEL_NAME || !event.newValue) return
    try {
      listener(JSON.parse(event.newValue) as TerminalPopoutEvent)
    } catch {
      // ignore malformed cross-window events
    }
  }

  if (channel) {
    channel.onmessage = (event: MessageEvent<TerminalPopoutEvent>) => listener(event.data)
  } else {
    window.addEventListener('storage', onStorage)
  }

  return () => {
    channel?.close()
    window.removeEventListener('storage', onStorage)
  }
}

export function notifyTerminalPopoutConnected(payload: Omit<PopoutConnectedEvent, 'type'>) {
  post({ type: 'terminal-popout-connected', ...payload })
}

export function notifyTerminalPopoutClosed(popoutId: string) {
  post({ type: 'terminal-popout-closed', popoutId })
}

export function requestTerminalPopoutInsert(host: TerminalPopoutHost, popoutId: string, requestId: string = crypto.randomUUID()) {
  post({ type: 'terminal-popout-insert-requested', requestId, popoutId, host })
  return requestId
}

export function confirmTerminalPopoutInserted(requestId: string) {
  post({ type: 'terminal-popout-inserted', requestId })
}

export function buildTerminalPopoutQuery(options: TerminalPopoutOpenOptions) {
  return {
    hostId: String(options.host.id),
    hostName: options.host.name,
    ...(options.host.ip ? { hostIp: options.host.ip } : {}),
    ...(options.host.port ? { hostPort: String(options.host.port) } : {}),
    ...(options.host.authType ? { authType: String(options.host.authType) } : {}),
    ...(options.host.accessProtocol ? { accessProtocol: options.host.accessProtocol } : {}),
    sourceTabId: options.sourceTabId,
    mode: options.mode,
  }
}

export function serializeTerminalPopoutHost(host: TerminalPopoutHost, popoutId: string, requestId: string = crypto.randomUUID()) {
  return JSON.stringify({ requestId, popoutId, host })
}

export function parseTerminalPopoutHost(value: string): TerminalPopoutHost | null {
  return parseTerminalPopoutDragPayload(value)?.host ?? null
}

export function parseTerminalPopoutDragPayload(value: string): TerminalPopoutDragPayload | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    const host = isRecord(parsed.host) ? parsed.host : parsed
    if (!host || typeof host.id !== 'number' || host.id <= 0 || typeof host.name !== 'string' || !host.name) {
      return null
    }
    return {
      requestId: 'requestId' in parsed && typeof parsed.requestId === 'string' ? parsed.requestId : crypto.randomUUID(),
      popoutId: 'popoutId' in parsed && typeof parsed.popoutId === 'string' ? parsed.popoutId : '',
      host: {
        id: host.id,
        name: host.name,
        ip: typeof host.ip === 'string' ? host.ip : undefined,
        port: typeof host.port === 'number' ? host.port : undefined,
        authType: typeof host.authType === 'string' ? host.authType : undefined,
        accessProtocol: isHostAccessProtocol(host.accessProtocol) ? host.accessProtocol : 'ssh',
      },
    }
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isHostAccessProtocol(value: unknown): value is HostPublic['accessProtocol'] {
  return value === 'ssh' || value === 'rdp' || value === 'telnet' || value === 'vnc' || value === 'serial'
}
