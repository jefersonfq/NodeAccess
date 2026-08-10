import type { AccessMapHost } from './sessions.service'

export function removeEndedSessionFromPresence(
  hosts: AccessMapHost[],
  hostId: number,
  sessionId: number | null,
): AccessMapHost[] {
  if (sessionId === null) return hosts
  return hosts.flatMap((host) => {
    if (host.host.id !== hostId) return [host]
    const sessions = host.sessions.filter((session) => session.id !== sessionId)
    if (sessions.length === host.sessions.length) return [host]
    if (sessions.length === 0) return []
    return [{
      ...host,
      sessions,
      activeSessions: sessions.length,
      uniqueUsers: new Set(sessions.map((session) => session.user.id)).size,
      oldestStartedAt: sessions.reduce((oldest, session) => session.startedAt < oldest ? session.startedAt : oldest, sessions[0]!.startedAt),
      lastStartedAt: sessions.reduce((latest, session) => session.startedAt > latest ? session.startedAt : latest, sessions[0]!.startedAt),
      lastSeenAt: sessions.reduce((latest, session) => session.lastSeenAt > latest ? session.lastSeenAt : latest, sessions[0]!.lastSeenAt),
    }]
  })
}
