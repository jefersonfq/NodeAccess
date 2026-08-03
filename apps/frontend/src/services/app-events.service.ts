import { useAuthStore } from '@/stores/auth'
import { hostService } from './host.service'
import { inventoryService } from './inventory.service'
import { sessionsService } from './sessions.service'

export const INVENTORY_ACL_CHANGED_EVENT = 'nodeaccess:inventory-acl-changed'
export const USER_ACL_MEMBERSHIP_CHANGED_EVENT = 'nodeaccess:user-acl-membership-changed'
export const SESSION_PRESENCE_CHANGED_EVENT = 'nodeaccess:session-presence-changed'

export interface InventoryAclChangedEventDetail {
  tenantId: number
  inventoryNodeId: number
  hostId: number | null
  actorId: number
  principalType: 'USER' | 'GROUP' | 'ROLE'
  principalId: number
  action: 'upsert' | 'delete' | 'move' | 'repair'
  changedAt: string
}

export interface UserAclMembershipChangedEventDetail {
  tenantId: number
  userId: number
  actorId: number
  previousGroupIds: number[]
  nextGroupIds: number[]
  changedAt: string
}

export interface SessionPresenceChangedEventDetail {
  tenantId: number
  hostId: number
  sessionId: number | null
  userId: number | null
  action: 'started' | 'ended' | 'timeout' | 'cleanup' | 'reconnected'
  changedAt: string
}

type AppEventMessage =
  | { type: 'connected' }
  | ({ type: 'inventory_acl_changed' } & InventoryAclChangedEventDetail)
  | ({ type: 'user_acl_membership_changed' } & UserAclMembershipChangedEventDetail)
  | ({ type: 'session_presence_changed' } & SessionPresenceChangedEventDetail)
  | { type: 'error'; message?: string }

let ws: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let stopped = true
let reconnectAttempt = 0

function wsBaseUrl() {
  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return import.meta.env.VITE_WS_URL ?? `${wsProtocol}//${location.host}`
}

function clearReconnectTimer() {
  if (reconnectTimer === null) return
  clearTimeout(reconnectTimer)
  reconnectTimer = null
}

function scheduleReconnect() {
  if (stopped || reconnectTimer !== null) return
  const delay = Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempt, 5))
  reconnectAttempt += 1
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, delay)
}

function handleInventoryAclChanged(message: Extract<AppEventMessage, { type: 'inventory_acl_changed' }>) {
  hostService.clear('inventory-acl:realtime')
  inventoryService.clear('inventory-acl:realtime')
  window.dispatchEvent(new CustomEvent<InventoryAclChangedEventDetail>(INVENTORY_ACL_CHANGED_EVENT, {
    detail: {
      tenantId: message.tenantId,
      inventoryNodeId: message.inventoryNodeId,
      hostId: message.hostId,
      actorId: message.actorId,
      principalType: message.principalType,
      principalId: message.principalId,
      action: message.action,
      changedAt: message.changedAt,
    },
  }))
}

function handleUserAclMembershipChanged(message: Extract<AppEventMessage, { type: 'user_acl_membership_changed' }>) {
  const auth = useAuthStore()
  if (auth.user?.id !== message.userId) return
  auth.user = {
    ...auth.user,
    groupIds: message.nextGroupIds,
  }
  hostService.clear('user-acl-membership:realtime')
  inventoryService.clear('user-acl-membership:realtime')
  window.dispatchEvent(new CustomEvent<UserAclMembershipChangedEventDetail>(USER_ACL_MEMBERSHIP_CHANGED_EVENT, {
    detail: {
      tenantId: message.tenantId,
      userId: message.userId,
      actorId: message.actorId,
      previousGroupIds: message.previousGroupIds,
      nextGroupIds: message.nextGroupIds,
      changedAt: message.changedAt,
    },
  }))
}

function handleSessionPresenceChanged(message: Extract<AppEventMessage, { type: 'session_presence_changed' }>) {
  sessionsService.clearAccessMapCache(`session-presence:${message.action}`)
  window.dispatchEvent(new CustomEvent<SessionPresenceChangedEventDetail>(SESSION_PRESENCE_CHANGED_EVENT, {
    detail: {
      tenantId: message.tenantId,
      hostId: message.hostId,
      sessionId: message.sessionId,
      userId: message.userId,
      action: message.action,
      changedAt: message.changedAt,
    },
  }))
}

function connect() {
  const auth = useAuthStore()
  if (stopped || !auth.accessToken || ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return

  const url = `${wsBaseUrl()}/ws/events?token=${encodeURIComponent(auth.accessToken)}`
  ws = new WebSocket(url)
  const current = ws

  current.onopen = () => {
    reconnectAttempt = 0
  }
  current.onmessage = (event) => {
    try {
      const message = JSON.parse(String(event.data)) as AppEventMessage
      if (message.type === 'inventory_acl_changed') handleInventoryAclChanged(message)
      if (message.type === 'user_acl_membership_changed') handleUserAclMembershipChanged(message)
      if (message.type === 'session_presence_changed') handleSessionPresenceChanged(message)
    } catch {
      // Ignore invalid event frames.
    }
  }
  current.onclose = () => {
    if (ws === current) ws = null
    scheduleReconnect()
  }
  current.onerror = () => {
    current.close()
  }
}

function stopConnection() {
  stopped = true
  clearReconnectTimer()
  reconnectAttempt = 0
  ws?.close()
  ws = null
}

export const appEventsService = {
  start() {
    stopped = false
    connect()
  },
  restart() {
    stopConnection()
    stopped = false
    connect()
  },
  stop() {
    stopConnection()
  },
}
