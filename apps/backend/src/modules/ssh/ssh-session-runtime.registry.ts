interface RuntimeSessionHandle {
  jitLinkId?: number
  close: (reason: string) => void
}

export class SshSessionRuntimeRegistry {
  private readonly sessions = new Map<number, RuntimeSessionHandle>()
  private readonly sessionsByJitLink = new Map<number, Set<number>>()

  register(sessionId: number, handle: RuntimeSessionHandle): void {
    this.sessions.set(sessionId, handle)
    if (handle.jitLinkId) {
      const linked = this.sessionsByJitLink.get(handle.jitLinkId) ?? new Set<number>()
      linked.add(sessionId)
      this.sessionsByJitLink.set(handle.jitLinkId, linked)
    }
  }

  unregister(sessionId: number): void {
    const handle = this.sessions.get(sessionId)
    this.sessions.delete(sessionId)
    if (!handle?.jitLinkId) return

    const linked = this.sessionsByJitLink.get(handle.jitLinkId)
    linked?.delete(sessionId)
    if (linked?.size === 0) this.sessionsByJitLink.delete(handle.jitLinkId)
  }

  closeByJitLink(jitLinkId: number, reason = 'jit_link_revoked'): number {
    const sessionIds = [...(this.sessionsByJitLink.get(jitLinkId) ?? [])]
    for (const sessionId of sessionIds) {
      this.sessions.get(sessionId)?.close(reason)
    }
    return sessionIds.length
  }

  close(sessionId: number, reason = 'admin_closed'): boolean {
    const handle = this.sessions.get(sessionId)
    if (!handle) return false
    handle.close(reason)
    return true
  }

  has(sessionId: number): boolean {
    return this.sessions.has(sessionId)
  }
}
