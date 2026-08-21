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
