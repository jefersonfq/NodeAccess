import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { AgentRegistry, type ActiveAgent } from './agent.registry.js'
import { AgentBridgeStream } from './agent-bridge-stream.js'
import { AgentRevocationBus } from './agent-revocation.bus.js'
class Socket extends EventEmitter {
  OPEN = 1; readyState = 1; bufferedAmount = 0
  send() {}
  close() { this.readyState = 3; this.emit('close', 1008) }
}
function agent(id = 1): ActiveAgent {
  return { agentId: id, userId: 9, tenantId: 7, name: 'Test', agentType: 'PROXY_AGENT', agentMode: 'USER_BOUND', isDefault: false, ws: new Socket(), connectedAt: new Date() }
}
async function bridge(registry: AgentRegistry, owner: ActiveAgent) {
  const id = randomUUID(), pending = registry.createConnection(owner, id, '192.0.2.1', 22)
  owner.ws.emit('message', Buffer.from(JSON.stringify({ type: 'connected', connectionId: id })), false)
  return pending
}
describe('agent security boundaries', () => {
  it.each([1, 2])('replacement closes old bridges and stale callbacks preserve replacement (id %s)', async id => {
    const registry = new AgentRegistry(), old = agent(), next = agent(id)
    registry.register(old)
    const stream = await bridge(registry, old)
    registry.register(next)
    expect(old.ws.readyState).toBe(3)
    expect(stream.destroyed).toBe(true)
    old.ws.emit('close', 1008)
    expect(next.ws.readyState).toBe(1)
    const currentStream = await bridge(registry, next)
    registry.disconnectById(id)
    expect(next.ws.readyState).toBe(3)
    expect(currentStream.destroyed).toBe(true)
    await expect(bridge(registry, old)).rejects.toThrow()
  })
  it('denies a private connector with empty destinations or ports', () => {
    for (const policy of [{ allowedCidrs: [], allowedPorts: [22] }, { allowedCidrs: ['10.0.0.0/8'], allowedPorts: [] }]) {
      const registry = new AgentRegistry()
      registry.register({ ...agent(), agentType: 'PRIVATE_ACCESS_CONNECTOR', agentMode: 'SERVICE_BOUND', privateAccess: policy })
      expect(registry.resolvePrivateAccessConnector(7, '10.0.0.1', 22)).toBeNull()
    }
  })
  it('bounds a slow consumer without terminating a healthy stream', () => {
    const close = vi.fn(), slow = new AgentBridgeStream(() => {}, close), healthy = new AgentBridgeStream(() => {})
    for (let i = 0; i < 33; i++) slow.pushInbound(Buffer.alloc(65536))
    expect(slow.destroyed).toBe(true)
    expect(close).toHaveBeenCalledOnce()
    expect(slow.readableLength).toBeLessThanOrEqual(2 * 1024 * 1024)
    healthy.pushInbound(Buffer.from('healthy'))
    expect(healthy.read()?.toString()).toBe('healthy')
    healthy.destroy()
  })
  it('closes a relay with oversized input frames', () => {
    const registry = new AgentRegistry(), owner = agent()
    registry.register(owner)
    owner.ws.emit('message', Buffer.alloc(262145), true)
    expect(owner.ws.readyState).toBe(3)
  })
  it('propagates revocation between independent registries and tolerates lost delivery', async () => {
    const events = new EventEmitter()
    const redis = { duplicate: () => {
      const sub = new EventEmitter() as any
      sub.connect = async () => {}; sub.subscribe = async () => { events.on('publication', (value: string) => sub.emit('message', 'channel', value)) }; sub.disconnect = () => {}
      return sub
    }, publish: vi.fn(async (_channel: string, value: string) => { events.emit('publication', value); return 1 }) }
    const a = new AgentRegistry(), b = new AgentRegistry(), first = agent(), second = agent()
    a.register(first); b.register(second)
    const busA = new AgentRevocationBus(redis as never, a), busB = new AgentRevocationBus(redis as never, b)
    await busB.start(); await busA.invalidate(1)
    expect(first.ws.readyState).toBe(3); expect(second.ws.readyState).toBe(3)
    redis.publish.mockRejectedValueOnce(new Error('offline'))
    await expect(busA.invalidate(1)).resolves.toBeUndefined()
    busB.stop()
  })
})

it('splits large outbound writes into bounded frames and rejects duplicate bridge IDs', async () => {
  const registry = new AgentRegistry(), owner = agent(), sent: Buffer[] = []
  owner.ws.send = (value: unknown) => { if (Buffer.isBuffer(value)) sent.push(value) }
  registry.register(owner)
  const id = randomUUID(), pending = registry.createConnection(owner, id, '192.0.2.1', 22)
  await expect(registry.createConnection(owner, id, '192.0.2.2', 22)).rejects.toThrow(/duplicate/)
  owner.ws.emit('message', Buffer.from(JSON.stringify({ type: 'connected', connectionId: id })), false)
  const stream = await pending
  await new Promise<void>((resolve, reject) => stream.write(Buffer.alloc(512 * 1024), error => error ? reject(error) : resolve()))
  expect(sent).toHaveLength(8)
  expect(sent.every(frame => frame.length <= 65536 + 36)).toBe(true)
  expect(Buffer.concat(sent.map(frame => frame.subarray(36))).length).toBe(512 * 1024)
  stream.destroy()
})

it('enforces per-agent connection capacity and releases it on teardown', async () => {
  const registry = new AgentRegistry(), owner = agent()
  registry.register(owner)
  const streams = []
  for (let n = 0; n < 128; n++) streams.push(await bridge(registry, owner))
  await expect(bridge(registry, owner)).rejects.toThrow(/limite/)
  streams[0]!.destroy()
  const replacement = await bridge(registry, owner)
  expect(replacement.destroyed).toBe(false)
  registry.disconnectById(owner.agentId)
  expect(streams.every(stream => stream.destroyed)).toBe(true)
  expect(replacement.destroyed).toBe(true)
})
