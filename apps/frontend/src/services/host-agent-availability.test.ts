import { describe, expect, it } from 'vitest'
import { hostAgentAvailability } from './host-agent-availability'
import type { AgentStatusInfo } from './agent.service'
const offline: AgentStatusInfo = { userAgent: null, tenantAgent: null, privateAccessConnector: null }
const user = { id: 1, name: 'User proxy' }
const tenant = { id: 2, name: 'Tenant proxy' }
const connector = { id: 3, name: 'Connector' }
describe('host agent availability', () => {
  it.each(['direct', 'auto'] as const)('preserves %s while status is unknown or offline', connectionMode => {
    for (const status of [null, offline]) expect(hostAgentAvailability({ connectionMode }, status).blocksConnection).toBe(false)
  })
  it('does not treat pending required status as online', () => {
    expect(hostAgentAvailability({ connectionMode: 'agent_user' }, null)).toEqual({ state: 'checking', blocksConnection: true })
  })
  it('requires the user agent for user-only routes even if the tenant agent exists', () => {
    expect(hostAgentAvailability({ connectionMode: 'agent_user' }, { ...offline, tenantAgent: tenant }).blocksConnection).toBe(true)
    expect(hostAgentAvailability({ connectionMode: 'agent_user' }, { ...offline, userAgent: user }).blocksConnection).toBe(false)
  })
  it.each(['agent', 'agent_tenant_fallback'] as const)('permits %s only with a user or tenant agent', connectionMode => {
    expect(hostAgentAvailability({ connectionMode }, offline).blocksConnection).toBe(true)
    for (const agent of [{ userAgent: user }, { tenantAgent: tenant }]) expect(hostAgentAvailability({ connectionMode }, { ...offline, ...agent }).blocksConnection).toBe(false)
  })
  it('does not substitute the default connector for a different pinned connector', () => {
    expect(hostAgentAvailability({ connectionMode: 'private_access_connector', privateAccessConnectorId: 4 }, { ...offline, privateAccessConnector: connector }).blocksConnection).toBe(true)
    expect(hostAgentAvailability({ connectionMode: 'private_access_connector', privateAccessConnectorId: 3 }, { ...offline, privateAccessConnector: connector }).blocksConnection).toBe(false)
  })
  it('checks pinned connector health including revocation and drain instead of the edit form', () => {
    const host = { connectionMode: 'private_access_connector' as const, privateAccessConnectorId: 4 }
    const agent = { id: 4, name: 'Pinned', online: true, active: true, revokedAt: null, maintenanceMode: false }
    expect(hostAgentAvailability(host, offline, [agent]).blocksConnection).toBe(false)
    for (const change of [{ online: false }, { active: false }, { revokedAt: '2026-10-27' }, { maintenanceMode: true }]) expect(hostAgentAvailability(host, offline, [{ ...agent, ...change }]).blocksConnection).toBe(true)
  })
  it('recomputes online → offline → online with current inputs', () => {
    const host = { connectionMode: 'agent_user' as const }
    expect([user, null, user].map(userAgent => hostAgentAvailability(host, { ...offline, userAgent }).blocksConnection)).toEqual([false, true, false])
  })
})
