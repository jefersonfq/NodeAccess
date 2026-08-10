import { describe, expect, it } from 'vitest'
import type { AccessMapHost } from './sessions.service'
import { removeEndedSessionFromPresence } from './session-presence-projection'

function hostWithSessions(ids: number[]): AccessMapHost {
  const sessions = ids.map((id, index) => ({
    id,
    user: { id: index + 1, name: `User ${index + 1}`, email: `u${index + 1}@test`, avatarUrl: null, avatarVersion: null },
    startedAt: `2026-08-09T20:0${index}:00Z`, lastSeenAt: `2026-08-09T20:1${index}:00Z`, durationSeconds: 10,
    connectionMethod: 'direct', accessType: 'authenticated', clientIp: null, agentRemoteIp: null, agentNameSnapshot: null,
  }))
  return {
    host: { id: 7, tenantId: 1, name: 'server', ip: '10.0.0.7', port: 22, accessProtocol: 'SSH', scope: 'GLOBAL', groupName: null },
    activeSessions: sessions.length, uniqueUsers: sessions.length,
    oldestStartedAt: sessions[0]?.startedAt ?? '', lastStartedAt: sessions.at(-1)?.startedAt ?? '', lastSeenAt: sessions.at(-1)?.lastSeenAt ?? '', sessions,
  }
}

describe('removeEndedSessionFromPresence', () => {
  it('remove somente a sessão encerrada e recalcula os totais', () => {
    const result = removeEndedSessionFromPresence([hostWithSessions([10, 11, 12])], 7, 11)
    expect(result[0]?.sessions.map((session) => session.id)).toEqual([10, 12])
    expect(result[0]).toMatchObject({ activeSessions: 2, uniqueUsers: 2 })
  })

  it('remove o host da presença quando a última sessão termina', () => {
    expect(removeEndedSessionFromPresence([hostWithSessions([10])], 7, 10)).toEqual([])
  })

  it('preserva outras sessões quando o evento não corresponde ao estado local', () => {
    const hosts = [hostWithSessions([10])]
    expect(removeEndedSessionFromPresence(hosts, 7, 99)).toEqual(hosts)
  })
})
