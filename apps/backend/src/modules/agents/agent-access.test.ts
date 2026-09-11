import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentAccessService, type AgentAccessRequest } from './agent-access.service.js'
import { AgentRegistry, type ActiveAgent } from './agent.registry.js'
import { AgentBridgeStream } from './agent-bridge-stream.js'
const request: AgentAccessRequest = { userId: 2, tenantId: 7, hostId: 10, purpose: 'connect' }
function owner(overrides: Partial<ActiveAgent> = {}): ActiveAgent {
  return { agentId: 1, userId: 2, tenantId: 7, name: 'agent', agentType: 'PROXY_AGENT', agentMode: 'USER_BOUND', isDefault: false, credentialHash: 'hash', connectedAt: new Date(), ws: Object.assign(new EventEmitter(), { OPEN: 1, readyState: 1, send() {}, close() {} }), ...overrides }
}
function setup() {
  const db = { user: { findFirst: vi.fn().mockResolvedValue({ role: 'USER', canManageHosts: false }) }, agent: { findFirst: vi.fn().mockResolvedValue({ createdById: 2, agentMode: 'USER_BOUND', tokenHash: 'hash' }) }, host: { findFirst: vi.fn().mockResolvedValue({ ip: '192.0.2.1', port: 22 }) }, adminLog: { create: vi.fn().mockResolvedValue({}) } }
  const ssh = { hasEffectiveHostPermission: vi.fn().mockResolvedValue(true) }
  return { db, ssh, service: new AgentAccessService(db as never, ssh as never) }
}
afterEach(() => vi.useRealTimers())
describe('current ACL authorization of agent destinations', () => {
  it('uses current ACL and current database role for each request without changing token', async () => {
    const { service, db, ssh } = setup(), agent = owner()
    expect(await service.authorize(agent, '192.0.2.1', 22, request)).toBe(true)
    ssh.hasEffectiveHostPermission.mockResolvedValue(false)
    expect(await service.authorize(agent, '192.0.2.1', 22, request)).toBe(false)
    ssh.hasEffectiveHostPermission.mockResolvedValue(true)
    expect(await service.authorize(agent, '192.0.2.1', 22, request)).toBe(true)
    expect(ssh.hasEffectiveHostPermission).toHaveBeenLastCalledWith(10, 7, 2, 'connect', 'USER')
    expect(db.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ active: true, deletedAt: null, tenant: { active: true } }) }))
  })
  it.each([{ userId: 3 }, { tenantId: 8 }])('rejects another owner or tenant %j before opening any destination', async change => {
    const { service, db } = setup()
    expect(await service.authorize(owner(), '192.0.2.1', 22, { ...request, ...change })).toBe(false)
    expect(db.host.findFirst).not.toHaveBeenCalled()
  })
  it('shared agents use requesting user ACL, not the creator role', async () => {
    const { service, db, ssh } = setup()
    db.agent.findFirst.mockResolvedValue({ createdById: 9, agentMode: 'SERVICE_BOUND', tokenHash: 'hash' })
    expect(await service.authorize(owner({ userId: 9, agentMode: 'SERVICE_BOUND' }), '192.0.2.1', 22, request)).toBe(true)
    expect(ssh.hasEffectiveHostPermission).toHaveBeenCalledWith(10, 7, 2, 'connect', 'USER')
  })
  it.each(['user', 'agent', 'host'])('rejects inactive/deleted/missing %s', async entity => {
    const { service, db } = setup()
    db[entity as 'user' | 'agent' | 'host'].findFirst.mockResolvedValue(null)
    expect(await service.authorize(owner(), '192.0.2.1', 22, request)).toBe(false)
  })
  it('rejects rotated token and mismatched target even if host ACL allows connect', async () => {
    const { service } = setup()
    expect(await service.authorize(owner({ credentialHash: 'old-hash' }), '192.0.2.1', 22, request)).toBe(false)
    expect(await service.authorize(owner(), '192.0.2.2', 22, request)).toBe(false)
    expect(await service.authorize(owner(), '192.0.2.1', 3389, request)).toBe(false)
  })
  it('unsaved connectivity probes require host management; normal sessions always require a host', async () => {
    const { service, db } = setup()
    const probe: AgentAccessRequest = { userId: 2, tenantId: 7, purpose: 'connectivity_test' }
    expect(await service.authorize(owner(), '192.0.2.1', 22, probe)).toBe(false)
    db.user.findFirst.mockResolvedValue({ role: 'USER', canManageHosts: true })
    expect(await service.authorize(owner(), '192.0.2.1', 22, probe)).toBe(true)
    expect(await service.authorize(owner(), '192.0.2.1', 22, { ...probe, purpose: 'connect' })).toBe(false)
  })
})

describe('agent bridge ACL lifetime', () => {
  function fixture() {
    const registry = new AgentRegistry(), agent = owner()
    registry.register(agent)
    const service = { authorize: vi.fn().mockResolvedValue(true), auditRevocation: vi.fn().mockResolvedValue(undefined) }
    registry.setAccessService(service as never)
    const stream = new AgentBridgeStream(() => {})
    const connect = vi.spyOn(registry, 'createConnection').mockResolvedValue(stream)
    return { registry, agent, service, stream, connect }
  }
  it('fails closed without an authorizer and with initial ACL denial', async () => {
    const { registry, agent, service, connect } = fixture()
    await expect(new AgentRegistry().createAuthorizedConnection(agent, randomUUID(), '192.0.2.1', 22, request)).rejects.toMatchObject({ code: 'AGENT_ACCESS_DENIED' })
    service.authorize.mockResolvedValue(false)
    await expect(registry.createAuthorizedConnection(agent, randomUUID(), '192.0.2.1', 22, request)).rejects.toMatchObject({ code: 'AGENT_ACCESS_DENIED' })
    expect(connect).not.toHaveBeenCalled()
  })
  it('closes a bridge when ACL changes during TCP establishment', async () => {
    const { registry, agent, service, stream } = fixture()
    service.authorize.mockResolvedValueOnce(true).mockResolvedValue(false)
    await expect(registry.createAuthorizedConnection(agent, randomUUID(), '192.0.2.1', 22, request)).rejects.toMatchObject({ code: 'AGENT_ACCESS_DENIED' })
    expect(stream.destroyed).toBe(true)
  })
  it.each(['denied', 'database error', 'database stalled'])('closes existing access after %s and audits without closing the agent', async failure => {
    vi.useFakeTimers()
    const { registry, agent, service, stream } = fixture()
    await registry.createAuthorizedConnection(agent, randomUUID(), '192.0.2.1', 22, request)
    if (failure === 'denied') service.authorize.mockResolvedValue(false)
    if (failure === 'database error') service.authorize.mockRejectedValue(new Error('offline'))
    if (failure === 'database stalled') service.authorize.mockImplementation(() => new Promise(() => {}))
    await vi.advanceTimersByTimeAsync(8000)
    expect(stream.destroyed).toBe(true)
    expect(agent.ws.readyState).toBe(1)
    expect(service.auditRevocation).toHaveBeenCalledOnce()
    const calls = service.authorize.mock.calls.length
    await vi.advanceTimersByTimeAsync(10000)
    expect(service.authorize.mock.calls).toHaveLength(calls)
  })
  it('keeps allowed sessions usable across repeated ACL checks', async () => {
    vi.useFakeTimers()
    const { registry, agent, stream } = fixture()
    await registry.createAuthorizedConnection(agent, randomUUID(), '192.0.2.1', 22, request)
    await vi.advanceTimersByTimeAsync(15000)
    expect(stream.destroyed).toBe(false)
    stream.destroy()
  })
})

it('revoking one user on a shared agent preserves another user bridge', async () => {
  vi.useFakeTimers()
  const registry = new AgentRegistry(), agent = owner({ agentMode: 'SERVICE_BOUND', userId: 9 })
  registry.register(agent)
  let deniedUser: number | undefined
  registry.setAccessService({ authorize: vi.fn(async (_a, _h, _p, r: AgentAccessRequest) => r.userId !== deniedUser), auditRevocation: vi.fn().mockResolvedValue(undefined) } as never)
  vi.spyOn(registry, 'createConnection').mockImplementation(async () => new AgentBridgeStream(() => {}))
  const first = await registry.createAuthorizedConnection(agent, randomUUID(), '192.0.2.1', 22, request)
  const second = await registry.createAuthorizedConnection(agent, randomUUID(), '192.0.2.1', 22, { ...request, userId: 3 })
  deniedUser = 2
  await vi.advanceTimersByTimeAsync(5000)
  expect(first.destroyed).toBe(true)
  expect(second.destroyed).toBe(false)
  expect(agent.ws.readyState).toBe(1)
  second.destroy()
})
