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
    expect(socket.sent.some(value => (JSON.parse(value) as { type?: string }).type === 'ping')).toBe(true)
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

it('preserves heartbeat cause in audit and immediately rejects pending bridges', async () => {
  vi.useFakeTimers()
  const agentService = service(), socket = new FakeSocket(), registry = new AgentRegistry()
  await new AgentGateway(agentService as never, registry, 1000, 1500).handleConnection(socket, 'secret')
  const pending = registry.createConnection(registry.getActiveById(8)!, '11111111-1111-4111-8111-111111111111', 'host', 22)
  const rejected = expect(pending).rejects.toThrow('deixou de responder')
  await vi.advanceTimersByTimeAsync(2000)
  await rejected
  expect(agentService.logDisconnected).toHaveBeenCalledWith(8, 'Filial', 'PROXY_AGENT', 'SERVICE_BOUND', 2, 'HEARTBEAT_TIMEOUT', expect.objectContaining({ closeCode: 4000, connectionId: expect.any(String) as unknown }))
  expect(agentService.markDisconnected).toHaveBeenCalledWith(8, 'HEARTBEAT_TIMEOUT', expect.any(Date))
})

it('ignores late close/error from a replaced socket and retains the replacement', async () => {
  vi.useFakeTimers()
  const agentService = service(), old = new FakeSocket(), current = new FakeSocket(), registry = new AgentRegistry()
  const gateway = new AgentGateway(agentService as never, registry)
  await gateway.handleConnection(old, 'same-token')
  await gateway.handleConnection(current, 'same-token')
  agentService.markDisconnected.mockClear()
  old.emit('error', new Error('late network error'))
  old.emit('close', 1006)
  await Promise.resolve()
  expect(registry.getActiveById(8)?.ws).toBe(current)
  expect(agentService.markDisconnected).not.toHaveBeenCalled()
  current.close(1000)
})

it('keeps the authorization cause after the WebSocket close event', async () => {
  vi.useFakeTimers()
  const agentService = service(), socket = new FakeSocket()
  await new AgentGateway(agentService as never, new AgentRegistry()).handleConnection(socket, 'secret')
  agentService.authenticate.mockResolvedValue(null)
  await vi.advanceTimersByTimeAsync(5000)
  expect(agentService.logDisconnected.mock.calls[0]?.[5]).toBe('AUTH_REVOKED')
})

it('accepts bounded agent telemetry, strips extra fields and only ACKs durable writes', async () => {
  vi.useFakeTimers()
  const logReportedEvents = vi.fn().mockRejectedValueOnce(new Error('database offline')).mockImplementation((_id: number, _owner: number, events: Array<{ id: string }>) => Promise.resolve(events.map(e => e.id)))
  const agentService = { ...service(), logReportedEvents }, socket = new FakeSocket()
  await new AgentGateway(agentService as never, new AgentRegistry()).handleConnection(socket, 'never-log-me')
  const event = { id: '11111111-1111-4111-8111-111111111111', attemptId: '22222222-2222-4222-8222-222222222222', code: 'DNS_FAILED', at: new Date().toISOString(), token: 'secret', tenantId: 999 }
  const send = (events: unknown[]) => socket.emit('message', Buffer.from(JSON.stringify({ type: 'diagnostic-report', events })), false)
  send([event]); await vi.advanceTimersByTimeAsync(0)
  expect(socket.sent.some(s => (JSON.parse(s) as { type?: string }).type === 'diagnostic-ack')).toBe(false)
  expect(logReportedEvents).toHaveBeenCalledWith(8, 2, [expect.not.objectContaining({ token: 'secret' }) as unknown])
  send([event]); expect(logReportedEvents).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(10000)
  send([event]); await vi.advanceTimersByTimeAsync(0)
  expect(socket.sent.map(s => JSON.parse(s) as { type?: string; ids?: string[] }).find(e => e.type === 'diagnostic-ack')?.ids).toEqual([event.id])
  await vi.advanceTimersByTimeAsync(10000)
  send(Array(21).fill(event)); send([{ ...event, code: 'arbitrary-private-error' }])
  expect(logReportedEvents).toHaveBeenCalledTimes(2)
  socket.close(1000)
  send([event]); expect(logReportedEvents).toHaveBeenCalledTimes(2)
})

it('records bookkeeping failure rather than reporting a successful connection', async () => {
  vi.useFakeTimers()
  const agentService = service(), socket = new FakeSocket()
  socket.close = (code, reason) => { socket.readyState = 3; socket.emit('close', code, Buffer.from(reason ?? '')) }
  agentService.markConnected.mockRejectedValue(new Error('database unavailable'))
  await new AgentGateway(agentService as never, new AgentRegistry()).handleConnection(socket, 'secret')
  expect(agentService.logConnected).not.toHaveBeenCalled()
  expect(agentService.logDisconnected.mock.calls[0]?.[5]).toBe('BOOKKEEPING_UNAVAILABLE')
})

it('allows the agent TCP deadline to report before the gateway outer timeout', async () => {
  vi.useFakeTimers()
  const agentService = service(), socket = new FakeSocket(), registry = new AgentRegistry()
  await new AgentGateway(agentService as never, registry).handleConnection(socket, 'secret')
  const id = '11111111-1111-4111-8111-111111111111'
  let settled = false
  const pending = registry.createConnection(registry.getActiveById(8)!, id, 'host', 22).finally(() => { settled = true })
  const rejected = expect(pending).rejects.toThrow('destino não confirmou')
  await vi.advanceTimersByTimeAsync(20_000)
  expect(settled).toBe(false)
  socket.emit('message', Buffer.from(JSON.stringify({ type: 'error', connectionId: id, code: 'TCP_TIMEOUT', message: 'raw error' })), false)
  await rejected
  socket.close(1000)
})
