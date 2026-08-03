export type GraphicalRuntimeCloseReason = 'user_closed' | 'admin_closed' | 'acl_revoked'

interface RuntimeGraphicalSessionHandle {
  close: (reason: GraphicalRuntimeCloseReason) => void
}

export class GraphicalSessionRuntimeRegistry {
  private readonly sessions = new Map<number, RuntimeGraphicalSessionHandle>()

  register(sessionId: number, handle: RuntimeGraphicalSessionHandle): void {
    this.sessions.set(sessionId, handle)
  }

  unregister(sessionId: number): void {
    this.sessions.delete(sessionId)
  }

  close(sessionId: number, reason: GraphicalRuntimeCloseReason = 'admin_closed'): boolean {
    const handle = this.sessions.get(sessionId)
    if (!handle) return false
    handle.close(reason)
    return true
  }

  has(sessionId: number): boolean {
    return this.sessions.has(sessionId)
  }

  size(): number {
    return this.sessions.size
  }
}
