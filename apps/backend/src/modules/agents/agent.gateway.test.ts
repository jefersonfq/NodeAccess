import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentGateway } from './agent.gateway.js'
import { AgentRegistry } from './agent.registry.js'

class FakeSocket extends EventEmitter {
  OPEN = 1
  readyState = 1
  sent: string[] = []
  closed: Array<{ code: number; reason?: string }> = []
  send(value: string) { this.sent.push(value) }
  close(code: number, reason?: string) {
    this.closed.push({ code, reason })
    this.readyState = 3
    this.emit('close', code)
  }
}

function service() {
  return {
    authenticate: vi.fn().mockResolvedValue({ id: 8, createdById: 2, tenantId: 7, name: 'Filial', agentType: 'PROXY_AGENT', agentMode: 'SERVICE_BOUND', isDefault: true, privateAccess: null }),
    markConnected: vi.fn().mockResolvedValue(undefined),
    logConnected: vi.fn().mockResolvedValue(undefined),
    touch: vi.fn().mockResolvedValue(undefined),
    markDisconnected: vi.fn().mockResolvedValue(undefined),
    logDisconnected: vi.fn().mockResolvedValue(undefined),
  }
}

afterEach(() => vi.useRealTimers())

describe('AgentGateway heartbeat', () => {
  it('only refreshes health after pong and closes a half-open socket', async () => {
    vi.useFakeTimers()
    const agentService = service()
    const socket = new FakeSocket()
    const gateway = new AgentGateway(agentService as never, new AgentRegistry(), 1_000, 2_500)
    await gateway.handleConnection(socket, 'token', { tlsMode: 'verified' })

    await vi.advanceTimersByTimeAsync(1_000)
    expect(socket.sent.some(value => JSON.parse(value).type === 'ping')).toBe(true)
    expect(agentService.touch).not.toHaveBeenCalled()

    socket.emit('message', Buffer.from(JSON.stringify({ type: 'pong' })), false)
    expect(agentService.touch).toHaveBeenCalledWith(8)

    await vi.advanceTimersByTimeAsync(3_000)
    expect(socket.closed).toContainEqual({ code: 4000, reason: 'heartbeat timeout' })
    expect(agentService.markDisconnected).toHaveBeenCalled()
  })

  it('rejects an invalid token without registering the socket', async () => {
    const agentService = service()
    agentService.authenticate.mockResolvedValue(null)
    const socket = new FakeSocket()
    await new AgentGateway(agentService as never, new AgentRegistry()).handleConnection(socket, 'bad')
    expect(socket.closed[0]?.code).toBe(1008)
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({ type: 'error' })
  })
})

it.each(['revoked', 'unavailable', 'stalled'])('closes authenticated connections when authorization is %s', async mode => {
  vi.useFakeTimers()
  const agentService = service(), socket = new FakeSocket(), registry = new AgentRegistry()
  await new AgentGateway(agentService as never, registry).handleConnection(socket, 'original-token')
  if (mode === 'revoked') agentService.authenticate.mockResolvedValue(null)
  if (mode === 'unavailable') agentService.authenticate.mockRejectedValue(new Error('database unavailable'))
  if (mode === 'stalled') agentService.authenticate.mockImplementation(() => new Promise(() => {}))
  await vi.advanceTimersByTimeAsync(mode === 'stalled' ? 8000 : 5000)
  expect(socket.closed[0]?.code).toBe(1008)
  expect(registry.getForTenant(7)).toBeUndefined()
  const calls = agentService.authenticate.mock.calls.length
  await vi.advanceTimersByTimeAsync(10000)
  expect(agentService.authenticate.mock.calls).toHaveLength(calls)
})

it('does not register a socket that closed during authentication', async () => {
  const agentService = service(), socket = new FakeSocket(), registry = new AgentRegistry()
  socket.readyState = 3
  await new AgentGateway(agentService as never, registry).handleConnection(socket, 'token')
  expect(registry.getForTenant(7)).toBeUndefined()
  expect(agentService.markConnected).not.toHaveBeenCalled()
})
