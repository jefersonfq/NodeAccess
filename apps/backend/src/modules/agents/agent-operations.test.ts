import { describe, expect, it } from 'vitest'
import { AgentRegistry, type ActiveAgent } from './agent.registry.js'

function active(overrides: Partial<ActiveAgent>): ActiveAgent {
  const ws = { OPEN: 1, readyState: 1, on() {}, send() {}, close() {} }
  return { agentId: 1, userId: 1, tenantId: 7, name: 'agent', agentType: 'PROXY_AGENT', agentMode: 'SERVICE_BOUND', isDefault: false, priority: 100, ws, connectedAt: new Date(), ...overrides }
}

describe('agent operational routing', () => {
  it('uses priority and fails over while an agent is draining', () => {
    const registry = new AgentRegistry()
    registry.register(active({ agentId: 2, priority: 200 }))
    registry.register(active({ agentId: 1, priority: 10 }))
    expect(registry.getForTenant(7)?.agentId).toBe(1)
    registry.setMaintenance(1, true)
    expect(registry.getForTenant(7)?.agentId).toBe(2)
    registry.setMaintenance(1, false)
    expect(registry.getForTenant(7)?.agentId).toBe(1)
  })

  it('does not select a private connector in maintenance', () => {
    const registry = new AgentRegistry()
    registry.register(active({ agentId: 4, agentType: 'PRIVATE_ACCESS_CONNECTOR', privateAccess: { allowedCidrs: ['10.0.0.0/8'], allowedPorts: [22] } }))
    expect(registry.resolvePrivateAccessConnector(7, '10.1.1.1', 22)?.agent.agentId).toBe(4)
    registry.setMaintenance(4, true)
    expect(registry.resolvePrivateAccessConnector(7, '10.1.1.1', 22)).toBeNull()
  })
})
