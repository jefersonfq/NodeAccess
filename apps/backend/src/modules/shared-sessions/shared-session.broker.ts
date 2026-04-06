import type { WebSocket } from 'ws'
import type { SharedSessionControlLease } from '@nodeaccess/shared'

interface SharedSessionSubscriber {
  ws: WebSocket
}

interface SharedSessionTransport {
  writeInput: (data: Buffer) => void
  auditInput?: (userId: number, data: Buffer) => void
}

interface SharedSessionState {
  sessionId: number
  ownerUserId: number
  activeControlLease: SharedSessionControlLease | null
  expiryTimer: ReturnType<typeof setTimeout> | null
  initialOutputSnapshot: Buffer | null
  pendingControlRequestUserIds: Set<number>
}

interface SharedSessionSnapshotPayload {
  sharedSessionId: number
  hostId: number
  hostName: string
  owner: { userId: number; name: string; email: string | null }
  participants: Array<{
    userId: number
    name: string
    email: string | null
    role: 'owner' | 'viewer'
    joinedAt: Date
    leftAt: Date | null
    lastSeenAt: Date | null
  }>
  role: 'owner' | 'viewer'
  status: 'active' | 'ended' | 'revoked'
  expiresAt: Date
  pendingControlRequestUserIds?: number[]
}

function sendJson(ws: WebSocket, message: object): void {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message))
  }
}

function sendBinary(ws: WebSocket, data: Buffer): void {
  if (ws.readyState === 1) {
    ws.send(data)
  }
}

export class SharedSessionBroker {
  private readonly sessionLinks = new Map<number, Set<number>>()
  private readonly subscribers = new Map<number, Map<WebSocket, SharedSessionSubscriber>>()
  private readonly sharedSessionStates = new Map<number, SharedSessionState>()
  private readonly sessionTransports = new Map<number, SharedSessionTransport>()

  registerSharedSession(
    sharedSessionId: number,
    sessionId: number,
    ownerUserId: number,
    activeControlLease: SharedSessionControlLease | null = null,
    initialOutputSnapshot?: string | null,
  ): void {
    const linked = this.sessionLinks.get(sessionId) ?? new Set<number>()
    linked.add(sharedSessionId)
    this.sessionLinks.set(sessionId, linked)

    const existing = this.sharedSessionStates.get(sharedSessionId)
    if (existing?.expiryTimer) clearTimeout(existing.expiryTimer)
    this.sharedSessionStates.set(sharedSessionId, {
      sessionId,
      ownerUserId,
      activeControlLease,
      expiryTimer: this.scheduleLeaseExpiry(sharedSessionId, activeControlLease),
      initialOutputSnapshot: initialOutputSnapshot
        ? Buffer.from(initialOutputSnapshot, 'utf8')
        : existing?.initialOutputSnapshot ?? null,
      pendingControlRequestUserIds: existing?.pendingControlRequestUserIds ?? new Set<number>(),
    })
  }

  unregisterSharedSession(sharedSessionId: number, sessionId: number): void {
    const linked = this.sessionLinks.get(sessionId)
    if (!linked) return
    linked.delete(sharedSessionId)
    if (linked.size === 0) this.sessionLinks.delete(sessionId)
    const state = this.sharedSessionStates.get(sharedSessionId)
    if (state?.expiryTimer) clearTimeout(state.expiryTimer)
    this.sharedSessionStates.delete(sharedSessionId)
  }

  subscribe(sharedSessionId: number, subscriber: SharedSessionSubscriber): void {
    const group = this.subscribers.get(sharedSessionId) ?? new Map<WebSocket, SharedSessionSubscriber>()
    group.set(subscriber.ws, subscriber)
    this.subscribers.set(sharedSessionId, group)
  }

  sendInitialSnapshot(sharedSessionId: number, ws: WebSocket): void {
    const snapshot = this.sharedSessionStates.get(sharedSessionId)?.initialOutputSnapshot
    if (!snapshot?.length) return
    sendJson(ws, {
      type: 'shared_session_initial_output',
      text: snapshot.toString('utf8'),
    })
  }

  unsubscribe(sharedSessionId: number, ws: WebSocket): void {
    const group = this.subscribers.get(sharedSessionId)
    if (!group) return
    group.delete(ws)
    if (group.size === 0) this.subscribers.delete(sharedSessionId)
  }

  publishSnapshot(sharedSessionId: number, payload: SharedSessionSnapshotPayload): void {
    this.broadcastJson(sharedSessionId, { type: 'shared_session_snapshot', ...payload })
  }

  publishParticipantJoined(sharedSessionId: number, payload: SharedSessionSnapshotPayload['participants'][number]): void {
    this.broadcastJson(sharedSessionId, { type: 'shared_session_participant_joined', participant: payload })
  }

  publishParticipantLeft(sharedSessionId: number, payload: { userId: number }): void {
    this.broadcastJson(sharedSessionId, { type: 'shared_session_participant_left', ...payload })
  }

  publishControlRequested(sharedSessionId: number, payload: { userId: number }): void {
    this.sharedSessionStates.get(sharedSessionId)?.pendingControlRequestUserIds.add(payload.userId)
    this.broadcastJson(sharedSessionId, { type: 'shared_session_control_requested', ...payload })
  }

  publishControlGranted(sharedSessionId: number, lease: SharedSessionControlLease): void {
    const state = this.sharedSessionStates.get(sharedSessionId)
    if (state) {
      if (state.expiryTimer) clearTimeout(state.expiryTimer)
      state.activeControlLease = lease
      state.expiryTimer = this.scheduleLeaseExpiry(sharedSessionId, lease)
      state.pendingControlRequestUserIds.delete(lease.controllerUserId)
    }
    this.broadcastJson(sharedSessionId, { type: 'shared_session_control_granted', lease })
  }

  publishControlDenied(sharedSessionId: number, payload: { userId: number; reason?: string | null }): void {
    this.sharedSessionStates.get(sharedSessionId)?.pendingControlRequestUserIds.delete(payload.userId)
    this.broadcastJson(sharedSessionId, { type: 'shared_session_control_denied', ...payload })
  }

  clearPendingControlRequest(sharedSessionId: number, userId: number): void {
    this.sharedSessionStates.get(sharedSessionId)?.pendingControlRequestUserIds.delete(userId)
  }

  publishControlRevoked(sharedSessionId: number, payload: { userId: number; reason?: string | null }): void {
    const state = this.sharedSessionStates.get(sharedSessionId)
    if (state) {
      if (state.expiryTimer) clearTimeout(state.expiryTimer)
      state.activeControlLease = null
      state.expiryTimer = null
    }
    this.broadcastJson(sharedSessionId, { type: 'shared_session_control_revoked', ...payload })
  }

  publishControlExpired(sharedSessionId: number, payload: { userId: number }): void {
    const state = this.sharedSessionStates.get(sharedSessionId)
    if (state) {
      state.activeControlLease = null
      state.expiryTimer = null
    }
    this.broadcastJson(sharedSessionId, { type: 'shared_session_control_expired', ...payload })
  }

  publishOutput(sessionId: number, data: Buffer): void {
    const linked = this.sessionLinks.get(sessionId)
    if (!linked) return
    for (const sharedSessionId of linked) {
      this.broadcastBinary(sharedSessionId, data)
    }
  }

  publishEnded(sessionId: number): void {
    const linked = this.sessionLinks.get(sessionId)
    if (!linked) return
    for (const sharedSessionId of linked) {
      this.broadcastJson(sharedSessionId, { type: 'shared_session_ended' })
    }
  }

  publishError(sessionId: number, message: string): void {
    const linked = this.sessionLinks.get(sessionId)
    if (!linked) return
    for (const sharedSessionId of linked) {
      this.broadcastJson(sharedSessionId, { type: 'shared_session_error', message })
    }
  }

  registerSessionTransport(sessionId: number, transport: SharedSessionTransport): void {
    this.sessionTransports.set(sessionId, transport)
  }

  unregisterSessionTransport(sessionId: number): void {
    this.sessionTransports.delete(sessionId)
  }

  forceClearControlBySessionId(sessionId: number): void {
    const linked = this.sessionLinks.get(sessionId)
    if (!linked?.size) return

    for (const sharedSessionId of linked) {
      const state = this.sharedSessionStates.get(sharedSessionId)
      if (!state) continue
      if (state.expiryTimer) clearTimeout(state.expiryTimer)
      state.activeControlLease = null
      state.expiryTimer = null
    }
  }

  canOwnerSendInput(sessionId: number, ownerUserId: number): boolean {
    const linked = this.sessionLinks.get(sessionId)
    if (!linked?.size) return true

    for (const sharedSessionId of linked) {
      const hasActiveSubscribers = (this.subscribers.get(sharedSessionId)?.size ?? 0) > 0
      if (!hasActiveSubscribers) continue

      const lease = this.sharedSessionStates.get(sharedSessionId)?.activeControlLease
      if (lease && lease.controllerUserId !== ownerUserId && lease.expiresAt.getTime() > Date.now()) {
        return false
      }
    }

    return true
  }

  forwardViewerInput(sharedSessionId: number, userId: number, data: Buffer): boolean {
    const state = this.sharedSessionStates.get(sharedSessionId)
    if (!state) return false

    const lease = state.activeControlLease
    if (!lease || lease.controllerUserId !== userId || lease.expiresAt.getTime() <= Date.now()) {
      return false
    }

    const transport = this.sessionTransports.get(state.sessionId)
    if (!transport) return false

    transport.writeInput(data)
    transport.auditInput?.(userId, data)
    return true
  }

  getActiveControlLease(sharedSessionId: number): SharedSessionControlLease | null {
    return this.sharedSessionStates.get(sharedSessionId)?.activeControlLease ?? null
  }

  getPendingControlRequestUserIds(sharedSessionId: number): number[] {
    return [...(this.sharedSessionStates.get(sharedSessionId)?.pendingControlRequestUserIds ?? [])]
  }

  private scheduleLeaseExpiry(sharedSessionId: number, lease: SharedSessionControlLease | null): ReturnType<typeof setTimeout> | null {
    if (!lease) return null

    const delay = lease.expiresAt.getTime() - Date.now()
    if (delay <= 0) {
      queueMicrotask(() => {
        this.publishControlExpired(sharedSessionId, { userId: lease.controllerUserId })
      })
      return null
    }

    return setTimeout(() => {
      this.publishControlExpired(sharedSessionId, { userId: lease.controllerUserId })
    }, delay)
  }

  private broadcastJson(sharedSessionId: number, payload: object): void {
    const group = this.subscribers.get(sharedSessionId)
    if (!group) return
    for (const subscriber of group.values()) {
      sendJson(subscriber.ws, payload)
    }
  }

  private broadcastBinary(sharedSessionId: number, data: Buffer): void {
    const group = this.subscribers.get(sharedSessionId)
    if (!group) return
    for (const subscriber of group.values()) {
      sendBinary(subscriber.ws, data)
    }
  }
}
