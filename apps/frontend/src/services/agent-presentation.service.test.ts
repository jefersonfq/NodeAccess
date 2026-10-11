import { describe, expect, it } from 'vitest'
import { agentAttentionReason, agentOperationalState, agentPurpose } from './agent-presentation.service'

describe('agent presentation', () => {
  it('uses product language for every supported agent purpose', () => {
    expect(agentPurpose({ agentType: 'PROXY_AGENT', agentMode: 'USER_BOUND' }).label).toBe('Agente pessoal')
    expect(agentPurpose({ agentType: 'PROXY_AGENT', agentMode: 'SERVICE_BOUND' }).label).toBe('Agente compartilhado')
    expect(agentPurpose({ agentType: 'PRIVATE_ACCESS_CONNECTOR', agentMode: 'SERVICE_BOUND' }).label).toBe('Conector de rede privada')
  })

  it('prioritizes revoked/offline and identifies degraded health', () => {
    expect(agentOperationalState({ online: true, revokedAt: '2026-01-01', tlsMode: 'verified', heartbeatAgeMs: 0, versionStatus: 'current' })).toBe('revoked')
    expect(agentOperationalState({ online: false, revokedAt: null, tlsMode: 'insecure', heartbeatAgeMs: 0, versionStatus: 'current' })).toBe('offline')
    expect(agentOperationalState({ online: true, revokedAt: null, tlsMode: 'insecure', heartbeatAgeMs: 0, versionStatus: 'current' })).toBe('attention')
    expect(agentOperationalState({ online: true, revokedAt: null, tlsMode: 'verified', heartbeatAgeMs: 61_000, versionStatus: 'current' })).toBe('attention')
    expect(agentOperationalState({ online: true, revokedAt: null, tlsMode: 'verified', heartbeatAgeMs: 0, versionStatus: 'outdated' })).toBe('attention')
    expect(agentAttentionReason({ tlsMode: 'insecure', heartbeatAgeMs: 0, versionStatus: 'current', minimumSupportedVersion: '1.0.0' })).toContain('TLS')
  })

  it('shows maintenance as an actionable attention state', () => {
    expect(agentOperationalState({ online: true, revokedAt: null, tlsMode: 'verified', heartbeatAgeMs: 0, versionStatus: 'current', maintenanceMode: true })).toBe('attention')
    expect(agentAttentionReason({ tlsMode: 'verified', heartbeatAgeMs: 0, versionStatus: 'current', minimumSupportedVersion: '1.0.0', maintenanceMode: true })).toContain('manutenção')
  })
})

import { agentConnectionDiagnostic, agentHistoryDiagnostic } from './agent-presentation.service'
it('does not present an old failure as current after recovery', () => {
  const agent = { online: true, revokedAt: null, lastOfflineReason: 'HEARTBEAT_TIMEOUT', lastDisconnectReason: 'AUTH_REVOKED', lastOfflineAt: '2026-09-28T12:00:00Z', lastDisconnectedAt: '2026-09-28T11:00:00Z' }
  expect(agentConnectionDiagnostic(agent)).toBeNull()
  expect(agentConnectionDiagnostic({ ...agent, online: false })?.code).toBe('HEARTBEAT_TIMEOUT')
  expect(agentConnectionDiagnostic({ ...agent, online: false, lastOfflineAt: '2026-09-28T10:00:00Z' })?.code).toBe('AUTH_REVOKED')
  expect(agentConnectionDiagnostic({ ...agent, online: false, lastOfflineReason: null, lastDisconnectReason: null })?.message).toContain('Nenhuma conexão')
})
it('shows reported time separately, safe reference and handles malformed history', () => {
  const diagnostic = agentHistoryDiagnostic({ action: 'agent_diagnostic_reported', details: JSON.stringify({ code: 'DNS_FAILED', source: 'agent', reportedAt: '2026-09-28T12:00:00Z', attemptId: 'test' }) })
  expect(diagnostic.label).toContain('DNS')
  expect(diagnostic).toMatchObject({ reference: 'test', reportedAt: '2026-09-28T12:00:00Z' })
  expect(agentHistoryDiagnostic({ action: 'agent_disconnected', details: '{invalid' }).label).toBe('agent_disconnected')
})
