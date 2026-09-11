import { describe, expect, it } from 'vitest'
import type { AccessMapHost } from './sessions.service'
import { removeEndedSessionFromPresence, summarizeSessionPresence } from './session-presence-projection'

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
  it('tolera eventos duplicados e fora de ordem sem remover a sessão sobrevivente', () => {
    const initial = [hostWithSessions([10, 11, 12])]
    let current = initial
    for (const id of [12, 12, 99, 10, 12, 10]) current = removeEndedSessionFromPresence(current, 7, id)
    expect(current[0]?.sessions.map(session => session.id)).toEqual([11])
    expect(current[0]).toMatchObject({ activeSessions: 1, uniqueUsers: 1 })
    expect(initial[0]?.sessions).toHaveLength(3)
  })

  it('ignora eventos de outro host ou sem identificador de sessão', () => {
    const initial = [hostWithSessions([10, 11])]
    expect(removeEndedSessionFromPresence(initial, 8, 10)).toEqual(initial)
    expect(removeEndedSessionFromPresence(initial, 7, null)).toEqual(initial)
  })

  it('conta uma pessoa com várias abas como um usuário e recalcula os horários', () => {
    const host = hostWithSessions([10, 11, 12])
    host.sessions[2].user = host.sessions[0].user
    const result = removeEndedSessionFromPresence([host], 7, 11)[0]
    expect(result).toMatchObject({ activeSessions: 2, uniqueUsers: 1,
      oldestStartedAt: host.sessions[0].startedAt,
      lastStartedAt: host.sessions[2].startedAt,
      lastSeenAt: host.sessions[2].lastSeenAt })
  })

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

describe('presence across hosts', () => {
  it('counts two people with four sessions across two hosts only once each', () => {
    const first = hostWithSessions([10, 11])
    const second = hostWithSessions([12, 13])
    second.host.id = 8
    expect(summarizeSessionPresence([first, second])).toEqual({ activeHosts: 2, activeSessions: 4, uniqueUsers: 2 })
  })
  it('removing an old connection never removes the replacement session', () => {
    const host = hostWithSessions([10, 20])
    host.sessions[1].user = host.sessions[0].user
    let state = [host]
    for (const id of [10, 10, 99]) state = removeEndedSessionFromPresence(state, 7, id)
    expect(state[0].sessions.map(session => session.id)).toEqual([20])
    expect(summarizeSessionPresence(state)).toEqual({ activeHosts: 1, activeSessions: 1, uniqueUsers: 1 })
    expect(summarizeSessionPresence(removeEndedSessionFromPresence(state, 7, 20))).toEqual({ activeHosts: 0, activeSessions: 0, uniqueUsers: 0 })
  })
})
