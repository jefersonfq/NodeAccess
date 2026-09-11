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

it('ignores control and binary frames from another agent even with a valid connection ID', async () => {
  const { EventEmitter } = await import('node:events')
  const { randomUUID } = await import('node:crypto')
  class Socket extends EventEmitter { OPEN = 1; readyState = 1; send() {} }
  const registry = new AgentRegistry()
  const owner = active({ ws: new Socket(), agentId: 101 })
  const other = active({ ws: new Socket(), agentId: 102, tenantId: 8 })
  registry.register(owner); registry.register(other)
  const id = randomUUID()
  let settled = false
  const pending = registry.createConnection(owner, id, '127.0.0.1', 22).then(stream => { settled = true; return stream })
  other.ws.emit('message', Buffer.from(JSON.stringify({ type: 'connected', connectionId: id })), false)
  await Promise.resolve(); expect(settled).toBe(false)
  owner.ws.emit('message', Buffer.from(JSON.stringify({ type: 'connected', connectionId: id })), false)
  const stream = await pending
  const received: string[] = []; stream.on('data', data => received.push(data.toString()))
  other.ws.emit('message', Buffer.concat([Buffer.from(id), Buffer.from('foreign')]), true)
  owner.ws.emit('message', Buffer.concat([Buffer.from(id), Buffer.from('owned')]), true)
  await new Promise(resolve => setImmediate(resolve))
  expect(received.join('')).toBe('owned')
  stream.destroy()
})
