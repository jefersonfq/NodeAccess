export interface HostSessionCandidate {
  id: string
  hostId: number
  tenantId?: number | null
}

export function filterHostSessionsForTenant<T extends HostSessionCandidate>(
  sessions: T[],
  tenantId: number | null,
  visibleHostIds: ReadonlySet<number>,
): T[] {
  return sessions.filter((session) =>
    tenantId === null
    || session.tenantId === tenantId
    || (session.tenantId == null && visibleHostIds.has(session.hostId)),
  )
}

export function resolveOpenSessionsAction(isAdmin: boolean, sessionCount: number): 'none' | 'terminal' | 'admin-report' {
  if (sessionCount === 0) return 'none'
  return isAdmin ? 'admin-report' : 'terminal'
}
