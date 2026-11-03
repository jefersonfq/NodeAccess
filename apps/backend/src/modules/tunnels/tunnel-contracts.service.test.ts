import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { TunnelService } from './tunnel.service.js'
import { encrypt } from '../../shared/crypto.js'
import type { LogRepository } from '../logs/log.repository.js'
const io = vi.hoisted(() => ({ servers: [] as unknown[], listenErrors: [] as Array<Error | undefined>, connect: vi.fn(), listener: vi.fn(), release: vi.fn(), denied: vi.fn() }))
const trial = vi.hoisted(() => ({ capability: vi.fn(), host: vi.fn(), user: vi.fn(), destination: vi.fn(), monitor: vi.fn(), stop: vi.fn() }))
const registry = vi.hoisted(() => ({ getActiveById: vi.fn(), getForUser: vi.fn(), registerPublication: vi.fn(), resolvePrivateAccessConnector: vi.fn(),
  resolveForConnectionMode: vi.fn(), describePrivateAccessResolution: vi.fn(), createAuthorizedConnection: vi.fn() }))
vi.mock('../../config/env.js', () => ({ env: { PEM_ENCRYPTION_KEY: '0'.repeat(64) } }))
vi.mock('../../config/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../trials/trial-policy.js', () => ({ assertTrialCapability: trial.capability, assertTrialHostAccess: trial.host, assertTrialUserAccess: trial.user,
  assertTrialTunnelDestination: trial.destination, monitorTrialAccess: trial.monitor }))
vi.mock('../agents/agent.registry.js', () => ({ agentRegistry: registry }))
vi.mock('../agents/agent-access.service.js', () => ({ isAgentAccessDenied: io.denied }))
vi.mock('../agents/agent-local-listener.js', () => ({ openAgentLocalListener: io.listener }))
vi.mock('./tunnel-ssh-connection.js', () => ({ connectTunnelSsh: io.connect }))
vi.mock('node:net', async () => {
  const { EventEmitter } = await import('node:events')
  let nextPort = 29000
  class FakeServer extends EventEmitter {
    port = 0
    close = vi.fn(() => this.emit('close'))
    constructor(readonly accept: (socket: unknown) => void) { super(); io.servers.push(this) }
    listen(port: number, _bind: string, done: () => void) {
      this.port = port || nextPort++
      const failure = io.listenErrors.shift()
      queueMicrotask(() => failure ? this.emit('error', failure) : done())
      return this
    }
    address() { return { port: this.port } }
  }
  return { default: { createServer: (accept: (socket: unknown) => void) => new FakeServer(accept) } }
})
class Ssh extends EventEmitter {
  end = vi.fn(() => this.emit('end'))
  stream = Object.assign(new PassThrough(), { close: vi.fn() })
  forwardOut = vi.fn((_a: string, _b: number, _c: string, _d: number, callback: (error: Error | null, stream: typeof this.stream) => void) => callback(null, this.stream))
}
const services: TunnelService[] = []
function fixture() {
  const host = { id: 42, tenantId: 3, name: 'Fixture', ip: '192.0.2.42', port: 22, sshUser: 'fixture', authType: 'PASSWORD',
    passwordEncrypted: JSON.stringify(encrypt('fixture-password')), pemKey: null as null | { encryptedKey: string; iv: string; encryptedPassphrase?: string; passphraseIv?: string },
    onePasswordRef: null as string | null, connectionMode: 'DIRECT', privateAccessConnectorId: null, trustedHostKeyFingerprint: 'fixture-fingerprint', bastion: null as Record<string, unknown> | null }
  const repo = { findHostWithCredentials: vi.fn().mockResolvedValue(host), hasEffectiveHostPermission: vi.fn().mockResolvedValue(true),
    getAutoStartForwardings: vi.fn().mockResolvedValue([]), startSession: vi.fn().mockResolvedValue(71), endSession: vi.fn().mockResolvedValue(undefined) }
  const secrets = { resolve: vi.fn().mockResolvedValue('resolved-fixture-secret') }
  const logs = { logAdminEvent: vi.fn<LogRepository['logAdminEvent']>().mockResolvedValue(undefined) }
  const events = { record: vi.fn().mockResolvedValue(undefined) }
  const ssh = new Ssh(); io.connect.mockResolvedValue(ssh)
  const service = new TunnelService(repo as never, secrets as never, logs as never, events as never); services.push(service)
  const create = (opts?: Parameters<TunnelService['create']>[7]) => service.create(7, 3, 'user', 42, 0, '127.0.0.1', 8080, opts)
  const testTarget = () => service.testTarget(7, 3, 'user', 42, '127.0.0.1', 8080)
  return { host, repo, secrets, logs, events, ssh, service, create, testTarget }
}
beforeEach(() => {
  vi.clearAllMocks(); io.servers.length = 0; io.listenErrors.length = 0
  trial.capability.mockResolvedValue(null); trial.user.mockResolvedValue(null); trial.host.mockResolvedValue(null); trial.destination.mockResolvedValue(undefined); trial.monitor.mockReturnValue(trial.stop)
  registry.resolveForConnectionMode.mockReturnValue(null); registry.resolvePrivateAccessConnector.mockReturnValue(null)
  registry.describePrivateAccessResolution.mockReturnValue({ message: 'Fixture connector unavailable', errorCode: 'CONNECTOR_UNAVAILABLE' })
  registry.getActiveById.mockReturnValue(null); registry.getForUser.mockReturnValue(null); registry.registerPublication.mockReturnValue(io.release)
  registry.createAuthorizedConnection.mockImplementation(() => Promise.resolve(new PassThrough())); io.denied.mockReturnValue(false)
  io.listener.mockResolvedValue({ close: vi.fn() })
})
afterEach(async () => {
  for (const service of services.splice(0)) for (const tunnel of service.runtimeSnapshot()) await service.close(tunnel.id)
  vi.useRealTimers()
})

describe('tunnel target and connection route contracts', () => {
  it('tests direct destination, closes forwarding stream/SSH and passes trust configuration', async () => {
    const f = fixture()
    expect(await f.testTarget()).toMatchObject({ success: true, connectionMethod: 'direct' })
    expect(f.repo.hasEffectiveHostPermission).toHaveBeenCalledWith(42, 3, 7, 'connect', 'USER')
    expect(io.connect).toHaveBeenCalledWith(expect.objectContaining({ host: hostAddress(), password: 'fixture-password' }), 'fixture-fingerprint', undefined)
    expect(f.ssh.forwardOut).toHaveBeenCalledWith('127.0.0.1', 0, '127.0.0.1', 8080, expect.any(Function))
    expect(f.ssh.stream.close).toHaveBeenCalledOnce(); expect(f.ssh.end).toHaveBeenCalledOnce()
  })
  it.each(['missing', 'acl', 'trial', 'forward', 'timeout'])('reports %s failure and cleans allocated SSH', async reason => {
    const f = fixture()
    if (reason === 'missing') f.repo.findHostWithCredentials.mockResolvedValue(null)
    if (reason === 'acl') f.repo.hasEffectiveHostPermission.mockResolvedValue(false)
    if (reason === 'trial') trial.capability.mockRejectedValue(new Error('trial denied'))
    if (reason === 'forward') f.ssh.forwardOut.mockImplementation((_a, _b, _c, _d, callback) => callback(new Error('forward refused'), f.ssh.stream))
    if (reason === 'timeout') { vi.useFakeTimers(); f.ssh.forwardOut.mockImplementation(() => {}) }
    const operation = f.testTarget()
    if (reason === 'timeout') await vi.advanceTimersByTimeAsync(5000)
    expect(await operation).toMatchObject({ success: false, connectionMethod: 'direct' })
    if (['forward', 'timeout'].includes(reason)) expect(f.ssh.end).toHaveBeenCalledOnce()
    else expect(io.connect).not.toHaveBeenCalled()
  })
  it.each(['USER_AGENT', 'TENANT_AGENT', 'PRIVATE_ACCESS_CONNECTOR'])('refuses missing mandatory route %s', async connectionMode => {
    const f = fixture(); f.host.connectionMode = connectionMode
    expect(await f.testTarget()).toMatchObject({ success: false })
    await expect(f.create()).rejects.toMatchObject({ code: connectionMode === 'PRIVATE_ACCESS_CONNECTOR' ? 'CONNECTOR_UNAVAILABLE' : 'AGENT_REQUIRED' })
    expect(io.connect).not.toHaveBeenCalled()
  })
  it.each([['USER_AGENT', 'user', 'user_agent'], ['TENANT_AGENT', 'tenant', 'tenant_agent'], ['PRIVATE_ACCESS_CONNECTOR', 'tenant', 'private_access_connector']] as const)('routes %s through authorized agent socket and closes it', async (mode, source, connectionMethod) => {
    const f = fixture(); f.host.connectionMode = mode
    const agent = { agentId: 'fixture-agent' }, socket = new PassThrough(), destroy = vi.spyOn(socket, 'destroy')
    registry.resolveForConnectionMode.mockReturnValue({ agent, source }); registry.resolvePrivateAccessConnector.mockReturnValue({ agent, source })
    registry.createAuthorizedConnection.mockResolvedValue(socket)
    expect(await f.testTarget()).toMatchObject({ success: true, connectionMethod })
    expect(registry.createAuthorizedConnection).toHaveBeenCalledWith(agent, expect.any(String), hostAddress(), 22, { userId: 7, tenantId: 3, hostId: 42, purpose: 'connect' })
    expect(io.connect).toHaveBeenCalledWith(expect.objectContaining({ sock: socket }), 'fixture-fingerprint', undefined)
    expect(destroy).toHaveBeenCalled()
    registry.createAuthorizedConnection.mockResolvedValue(new PassThrough())
    expect(await f.create()).toMatchObject({ connectionMethod })
  })
  it.each([false, true])('AUTO fallback respects explicit access denial=%s', async denied => {
    const f = fixture(); f.host.connectionMode = 'AUTO'; io.denied.mockReturnValue(denied)
    registry.resolveForConnectionMode.mockReturnValue({ agent: {}, source: 'user' }); registry.createAuthorizedConnection.mockRejectedValue(new Error('fixture agent unavailable'))
    expect(await f.testTarget()).toMatchObject({ success: !denied, connectionMethod: denied ? 'user_agent' : 'direct' })
    if (denied) { await expect(f.create()).rejects.toThrow('fixture agent unavailable'); expect(io.connect).not.toHaveBeenCalled() }
    else expect(await f.create()).toMatchObject({ connectionMethod: 'direct' })
  })
  it('reports mandatory-agent bridge failure without falling back to direct', async () => {
    const f = fixture(); f.host.connectionMode = 'USER_AGENT'
    registry.resolveForConnectionMode.mockReturnValue({ agent: {}, source: 'user' }); registry.createAuthorizedConnection.mockRejectedValue(new Error('bridge unavailable'))
    expect(await f.testTarget()).toMatchObject({ success: false, connectionMethod: 'user_agent' })
    await expect(f.create()).rejects.toMatchObject({ code: 'AGENT_TUNNEL_CONNECT_FAILED' })
    expect(io.connect).not.toHaveBeenCalled()
  })
  it.each(['PASSWORD', 'PEM', 'PEM_PASSWORD'])('resolves tenant-scoped secret for %s', async authType => {
    const f = fixture(); f.host.authType = authType; f.host.onePasswordRef = 'op://fixture'
    expect((await f.testTarget()).success).toBe(true)
    expect(f.secrets.resolve).toHaveBeenCalledWith(3, 'op://fixture')
    expect(io.connect).toHaveBeenCalledWith(expect.objectContaining({ [authType === 'PEM' ? 'privateKey' : 'password']: 'resolved-fixture-secret' }), 'fixture-fingerprint', undefined)
    await f.create()
  })
  it('decrypts PEM passphrase/bastion config and sanitizes secret provider startup failure', async () => {
    const f = fixture(), pem = encrypt('fixture-key'), pass = encrypt('fixture-passphrase')
    f.host.authType = 'PEM'; f.host.pemKey = { encryptedKey: pem.encrypted, iv: pem.iv, encryptedPassphrase: pass.encrypted, passphraseIv: pass.iv }
    f.host.bastion = { ...f.host, ip: '192.0.2.1' }
    expect((await f.testTarget()).success).toBe(true)
    expect(io.connect).toHaveBeenCalledWith(expect.objectContaining({ privateKey: 'fixture-key', passphrase: 'fixture-passphrase' }), 'fixture-fingerprint', expect.objectContaining({ host: '192.0.2.1' }))
    f.host.onePasswordRef = 'op://fixture'; f.secrets.resolve.mockRejectedValue(new Error('private provider detail'))
    await expect(f.create()).rejects.toMatchObject({ code: 'CREDENTIAL_ERROR', message: 'Falha ao buscar credencial no 1Password' })
  })
})
function hostAddress() { return '192.0.2.42' }

describe('tunnel local publication and lifecycle contracts', () => {
  function personalAgent() { return { id: 10, agentId: 'personal-fixture', userId: 7, tenantId: 3, agentMode: 'USER_BOUND', version: '1.5.0', name: 'Personal fixture' } }
  it('publishes only to the actor personal agent after repeated ACL check and releases on close', async () => {
    const f = fixture(), tunnel = await f.create(), agent = personalAgent(), listener = { close: vi.fn() }
    registry.getActiveById.mockReturnValue(agent); registry.getForUser.mockReturnValue(agent); io.listener.mockResolvedValue(listener)
    const result = await f.service.publishOnPersonalAgent(tunnel.id, 7, 3, 10, 18080)
    expect(result.localAgent).toEqual({ id: 10, name: 'Personal fixture', port: 18080 })
    expect(io.listener).toHaveBeenCalledWith(agent, 18080, tunnel.assignedLocalPort, expect.any(Function))
    expect(f.repo.hasEffectiveHostPermission).toHaveBeenCalledTimes(4)
    const onClose = io.listener.mock.calls[0]![3] as () => void
    onClose(); await Promise.resolve()
    expect(io.release).toHaveBeenCalledOnce()
    expect(f.service.listForUser(7, 3)[0]).not.toHaveProperty('localAgent')
  })
  it.each(['foreign-user', 'foreign-tenant', 'absent-agent', 'old-agent', 'invalid-port', 'duplicate'])('refuses local publication %s before duplicate resource creation', async reason => {
    const f = fixture(), tunnel = await f.create(), agent = personalAgent()
    registry.getActiveById.mockReturnValue(agent); registry.getForUser.mockReturnValue(agent)
    if (reason === 'absent-agent') registry.getActiveById.mockReturnValue(null)
    if (reason === 'old-agent') agent.version = '1.4.9'
    if (reason === 'duplicate') await f.service.publishOnPersonalAgent(tunnel.id, 7, 3, 10, 18080)
    await expect(f.service.publishOnPersonalAgent(tunnel.id, reason === 'foreign-user' ? 8 : 7, reason === 'foreign-tenant' ? 4 : 3, 10, reason === 'invalid-port' ? 80 : 18080)).rejects.toMatchObject({
      code: reason.startsWith('foreign') ? 'TUNNEL_NOT_FOUND' : reason === 'absent-agent' ? 'AGENT_FORBIDDEN' : reason === 'old-agent' ? 'AGENT_UPDATE_REQUIRED' : reason === 'invalid-port' ? 'INVALID_PORT' : 'TUNNEL_ALREADY_PUBLISHED',
    })
    expect(io.listener).toHaveBeenCalledTimes(reason === 'duplicate' ? 1 : 0)
  })
  it.each(['agent-left', 'acl-revoked', 'tunnel-closed'])('closes new local listener when %s during publication', async reason => {
    const f = fixture(), tunnel = await f.create(), agent = personalAgent(), listener = { close: vi.fn() }
    registry.getActiveById.mockReturnValue(agent); registry.getForUser.mockReturnValue(agent)
    io.listener.mockImplementation(async () => {
      if (reason === 'agent-left') registry.getActiveById.mockReturnValue(null)
      if (reason === 'acl-revoked') f.repo.hasEffectiveHostPermission.mockResolvedValue(false)
      if (reason === 'tunnel-closed') await f.service.close(tunnel.id)
      return listener
    })
    await expect(f.service.publishOnPersonalAgent(tunnel.id, 7, 3, 10, 18080)).rejects.toMatchObject({ code: reason === 'acl-revoked' ? 'HOST_FORBIDDEN' : 'TUNNEL_CLOSED' })
    expect(listener.close).toHaveBeenCalledOnce(); expect(io.release).toHaveBeenCalledOnce()
  })
  it('allows retry after publication failure and rejects concurrent publication while pending', async () => {
    const f = fixture(), tunnel = await f.create(), agent = personalAgent()
    registry.getActiveById.mockReturnValue(agent); registry.getForUser.mockReturnValue(agent)
    let reject!: (error: Error) => void
    io.listener.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    const pending = f.service.publishOnPersonalAgent(tunnel.id, 7, 3, 10, 18080)
    await vi.waitFor(() => expect(reject).toBeTypeOf('function'))
    await expect(f.service.publishOnPersonalAgent(tunnel.id, 7, 3, 10, 18081)).rejects.toMatchObject({ code: 'TUNNEL_ALREADY_PUBLISHED' })
    reject(new Error('listener refused'))
    await expect(pending).rejects.toThrow('listener refused')
    io.listener.mockResolvedValue({ close: vi.fn() })
    await expect(f.service.publishOnPersonalAgent(tunnel.id, 7, 3, 10, 18081)).resolves.toMatchObject({ localAgent: { port: 18081 } })
  })
  it('delegates cross-runtime list/close and rolls back new tunnel when presence publication fails', async () => {
    const f = fixture(), runtime = { list: vi.fn().mockResolvedValue([]), close: vi.fn().mockResolvedValue(undefined), publish: vi.fn().mockRejectedValue(new Error('registry down')) }
    f.service.runtimeRegistry = runtime as never
    expect(await f.service.listAcrossRuntimes(7, 3)).toEqual([])
    await f.service.closeAcrossRuntimes('foreign-runtime', 7, 3)
    expect(runtime.list).toHaveBeenCalledWith(7, 3); expect(runtime.close).toHaveBeenCalledWith('foreign-runtime', 7, 3)
    await expect(f.create()).rejects.toMatchObject({ code: 'TUNNEL_RUNTIME_UNAVAILABLE' })
    expect(f.service.runtimeSnapshot()).toEqual([]); expect(f.ssh.end).toHaveBeenCalled()
  })
  it('falls back across-runtimes methods to local actor-scoped state without leaking internals', async () => {
    const f = fixture(), tunnel = await f.create()
    const rows = await f.service.listAcrossRuntimes(7, 3)
    expect(rows).toHaveLength(1)
    for (const field of ['ssh', 'server', 'sessionIds', 'userRole', 'agentSock', 'stopTrial']) expect(rows[0]).not.toHaveProperty(field)
    await f.service.closeAcrossRuntimes(tunnel.id, 7, 3)
    expect(f.service.runtimeSnapshot()).toEqual([])
  })
  it('records forwarding analytics and closes the trial session exactly through lifecycle cleanup', async () => {
    const f = fixture(); trial.capability.mockResolvedValue({ tenantId: 3 })
    const tunnel = await f.create({ sessionId: 'fixture-session', portForwardingId: 4, description: 'Fixture tunnel' })
    expect(f.events.record).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 3, userId: 7, forwardingId: 4, hostId: 42, eventType: 'TUNNEL' }))
    expect(trial.monitor).toHaveBeenCalled()
    await f.service.close(tunnel.id)
    expect(trial.stop).toHaveBeenCalledOnce(); expect(f.repo.endSession).toHaveBeenCalledWith(71)
    expect(f.logs.logAdminEvent.mock.calls.at(-1)![0]).toMatchObject({ action: 'USER_TUNNEL_CLOSED', targetType: 'PortForwarding', targetId: 4 })
  })
  it('refuses invalid binds and trial wildcard before allocating listener, cleaning trial session on later failure', async () => {
    const f = fixture()
    await expect(f.create({ bindAddress: '192.0.2.1' })).rejects.toMatchObject({ code: 'INVALID_BIND_ADDRESS' })
    trial.capability.mockResolvedValue({ tenantId: 3 })
    await expect(f.create({ bindAddress: '0.0.0.0' })).rejects.toMatchObject({ code: 'TRIAL_BIND_DENIED' })
    f.host.onePasswordRef = 'op://fixture'; f.secrets.resolve.mockRejectedValue(new Error('provider unavailable'))
    await expect(f.create()).rejects.toMatchObject({ code: 'CREDENTIAL_ERROR' })
    expect(f.repo.endSession).toHaveBeenCalledWith(71); expect(io.servers).toHaveLength(0)
  })
  it.each(['fallback-success', 'fallback-fails', 'listener-denied'])('handles listener startup %s without ghost tunnels', async scenario => {
    const f = fixture()
    const busy = Object.assign(new Error('occupied'), { code: 'EADDRINUSE' })
    io.listenErrors.push(scenario === 'listener-denied' ? Object.assign(new Error('denied'), { code: 'EACCES' }) : busy)
    if (scenario === 'fallback-fails') io.listenErrors.push(busy)
    const operation = f.service.create(7, 3, 'user', 42, 30001, '127.0.0.1', 8080)
    if (scenario === 'fallback-success') expect(await operation).toMatchObject({ requestedLocalPort: 30001, usedPortFallback: true })
    else { await expect(operation).rejects.toThrow(); expect(f.service.runtimeSnapshot()).toEqual([]); expect(f.ssh.end).toHaveBeenCalledOnce() }
  })
})

describe('tunnel stream cleanup and best-effort boundaries', () => {
  it.each(['forwarded', 'forward-error', 'client-already-closed', 'tunnel-already-closed'])('handles incoming connection %s without retaining sockets', async scenario => {
    const f = fixture(), tunnel = await f.create()
    const server = io.servers[0] as { accept: (socket: PassThrough) => void }
    const socket = new PassThrough(), destroy = vi.spyOn(socket, 'destroy')
    if (scenario === 'forward-error') f.ssh.forwardOut.mockImplementation((_a, _b, _c, _d, callback) => callback(new Error('forward denied'), f.ssh.stream))
    if (scenario === 'client-already-closed') socket.destroy()
    if (scenario === 'tunnel-already-closed') await f.service.close(tunnel.id)
    server.accept(socket)
    if (scenario === 'forwarded') {
      socket.emit('close'); expect(f.ssh.stream.close).toHaveBeenCalled()
      f.ssh.stream.emit('close'); expect(destroy).toHaveBeenCalled()
    } else if (scenario === 'client-already-closed') expect(f.ssh.stream.close).toHaveBeenCalledOnce()
    else expect(destroy).toHaveBeenCalled()
    if (scenario === 'tunnel-already-closed') expect(f.ssh.forwardOut).not.toHaveBeenCalled()
    socket.destroy(); f.ssh.stream.destroy()
  })
  it.each(['trial-expired', 'ssh-error'])('closes runtime and trial session on %s', async reason => {
    const f = fixture(); trial.capability.mockResolvedValue({ tenantId: 3 })
    await f.create()
    if (reason === 'trial-expired') (trial.monitor.mock.calls[0]![2] as () => void)()
    else f.ssh.emit('error', new Error('transport lost'))
    await vi.waitFor(() => expect(f.service.runtimeSnapshot()).toEqual([]))
    expect(f.repo.endSession).toHaveBeenCalledWith(71); expect(trial.stop).toHaveBeenCalled()
  })
  it('does not fail opening/closing a tunnel when audit and analytics storage fail', async () => {
    const f = fixture(); f.logs.logAdminEvent.mockRejectedValue(new Error('audit unavailable')); f.events.record.mockRejectedValue(new Error('analytics unavailable'))
    const tunnel = await f.create({ portForwardingId: 4 })
    expect(tunnel.id).toBeTypeOf('string')
    await expect(f.service.close(tunnel.id)).resolves.toBeUndefined()
    expect(f.service.runtimeSnapshot()).toEqual([])
  })
  it('rechecks permission after network setup and cleans SSH on revoked access', async () => {
    const f = fixture(); f.repo.hasEffectiveHostPermission.mockResolvedValueOnce(true).mockResolvedValue(false)
    await expect(f.create()).rejects.toMatchObject({ code: 'HOST_FORBIDDEN' })
    expect(f.ssh.end).toHaveBeenCalledOnce(); expect(f.service.runtimeSnapshot()).toEqual([])
  })
  it('keeps original startup failure when trial cleanup repository also fails', async () => {
    const f = fixture(); trial.capability.mockResolvedValue({ tenantId: 3 }); f.repo.endSession.mockRejectedValue(new Error('cleanup unavailable'))
    io.connect.mockRejectedValue(new Error('original SSH failure'))
    await expect(f.create()).rejects.toThrow('original SSH failure')
    expect(f.repo.endSession).toHaveBeenCalledWith(71)
  })
})
