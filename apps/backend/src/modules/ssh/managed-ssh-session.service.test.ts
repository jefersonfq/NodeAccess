import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ManagedSshSessionService } from './managed-ssh-session.service.js'
import { encrypt, decrypt } from '../../shared/crypto.js'
import type { SshCredentials } from './ssh.session.js'
import type { SshInputPolicy, SshInputPolicyContext, SshInputPolicyDecision } from './ssh-input-policy.js'
import type { HostCredentials } from './ssh.repository.js'

type Hooks = { onStdout?: (data: Buffer) => Buffer | void; onClose?: () => void }
const io = vi.hoisted(() => ({
  capability: vi.fn(), hostAccess: vi.fn(), userAccess: vi.fn(), monitor: vi.fn(), stop: vi.fn(),
  connect: vi.fn<(cols: number, rows: number) => Promise<void>>(), write: vi.fn<(data: Buffer) => void>(),
  resize: vi.fn<(cols: number, rows: number) => void>(), dispose: vi.fn<() => void>(),
  files: vi.fn(), warm: vi.fn(), home: vi.fn(), list: vi.fn(),
  instances: [] as Array<{ target: SshCredentials; bastion: SshCredentials | null; hooks: Hooks; options: unknown }>,
}))
vi.mock('../trials/trial-policy.js', () => ({ assertTrialCapability: io.capability, assertTrialHostAccess: io.hostAccess,
  assertTrialUserAccess: io.userAccess, monitorTrialAccess: io.monitor }))
vi.mock('./ssh.session.js', () => ({ SshSession: class {
  constructor(_transport: unknown, target: SshCredentials, bastion: SshCredentials | null, hooks: Hooks, options: unknown) {
    io.instances.push({ target, bastion, hooks, options })
  }
  connect = io.connect; write = io.write; resize = io.resize; dispose = io.dispose
  sessionFiles = io.files; warmSftp = io.warm; sftpHome = io.home; listDirectory = io.list
} }))
function setup(audited = true) {
  const repo = { startSession: vi.fn().mockResolvedValue(41), endSession: vi.fn().mockResolvedValue(undefined), getUserGroupIds: vi.fn().mockResolvedValue([5]) }
  const vault = { resolve: vi.fn().mockResolvedValue('synthetic-vault-secret') }
  const audit = { publish: vi.fn<(type: string, context: Record<string, unknown>, payload: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined) }
  const policy = { shouldAuditSession: vi.fn().mockResolvedValue(audited) }
  const host = { id: 12, tenantId: 2, name: 'Fixture host', ip: '192.0.2.12', port: 22, sshUser: 'fixture', authType: 'PASSWORD',
    passwordEncrypted: JSON.stringify(encrypt('synthetic-host-secret')), pemKey: null, bastion: null, onePasswordRef: null,
    connectionMode: 'DIRECT', trustedHostKeyFingerprint: 'SHA256:fixture' } as unknown as HostCredentials
  const input = { user: { id: 7, tenantId: 2, name: 'Fixture', email: 'fixture@example.test' }, host,
    transport: {} as never, cols: 80, rows: 24, onClose: vi.fn(), onInputRejected: vi.fn() }
  return { repo, vault, audit, policy, host, input, service: new ManagedSshSessionService(repo as never, vault as never, audit as never, policy as never) }
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
beforeEach(() => {
  vi.resetAllMocks(); io.instances.length = 0
  io.capability.mockResolvedValue(null); io.hostAccess.mockResolvedValue(null); io.userAccess.mockResolvedValue(undefined)
  io.monitor.mockReturnValue(io.stop); io.connect.mockResolvedValue(undefined)
  io.files.mockResolvedValue({ marker: 'files' }); io.warm.mockResolvedValue(undefined); io.home.mockResolvedValue('/home/fixture'); io.list.mockResolvedValue([{ name: 'fixture.txt' }])
})

describe('managed SSH session lifecycle and audit', () => {
  it('checks trial scopes before persistence, connects with pin/bastion and audits binary I/O plus resize', async () => {
    const s = setup(); s.host.bastion = { ...s.host, id: 13, ip: '192.0.2.13' }
    const handle = await s.service.open({ ...s.input, clientIp: '192.0.2.1', userAgent: 'fixture', connectionMethod: 'direct', source: 'websocket_gateway' })
    expect(io.capability).toHaveBeenCalledWith(2, 'nativeSsh'); expect(io.userAccess).toHaveBeenCalledWith(2, 7); expect(io.hostAccess).toHaveBeenCalledWith(2, s.host)
    expect(s.repo.startSession).toHaveBeenCalledWith(7, 12, { clientIp: '192.0.2.1', userAgent: 'fixture', connectionMethod: 'direct' })
    expect(s.policy.shouldAuditSession).toHaveBeenCalledWith(2, 7, [5])
    expect(handle.sessionId).toBe(41); expect(io.connect).toHaveBeenCalledWith(80, 24)
    expect(io.instances[0]!.target).toMatchObject({ host: '192.0.2.12', username: 'fixture', trustedHostKeyFingerprint: 'SHA256:fixture' })
    expect(io.instances[0]!.bastion?.host).toBe('192.0.2.13'); expect(io.instances[0]!.options).toEqual({ sendClosedControl: false })
    const bytes = Buffer.from([0, 255, 65]); expect(io.instances[0]!.hooks.onStdout!(bytes)).toBe(bytes)
    handle.write(bytes); handle.resize(100, 40); await flush()
    expect(io.write).toHaveBeenCalledWith(bytes); expect(io.resize).toHaveBeenCalledWith(100, 40)
    expect(s.audit.publish).toHaveBeenCalledWith('stdin', { sessionId: 41, tenantId: 2, userId: 7, hostId: 12 }, { encoding: 'base64', data: bytes.toString('base64'), bytes: 3 })
    expect(s.audit.publish).toHaveBeenCalledWith('stdout', expect.any(Object), { encoding: 'base64', data: bytes.toString('base64'), bytes: 3 })
    await handle.close(); await handle.close(); io.instances[0]!.hooks.onClose!(); await flush()
    expect(s.repo.endSession).toHaveBeenCalledTimes(1); expect(s.repo.endSession).toHaveBeenCalledWith(41, { endedReason: 'socket_closed' })
    expect(s.audit.publish.mock.calls.filter(([type]) => type === 'session_ended')).toHaveLength(1)
    expect(s.input.onClose).toHaveBeenCalledOnce(); expect(io.stop).toHaveBeenCalled()
  })
  it('keeps access available when auditing is disabled and does not emit audit events', async () => {
    const s = setup(false), handle = await s.service.open(s.input)
    handle.write(Buffer.from('pwd\n')); handle.resize(90, 30); io.instances[0]!.hooks.onStdout!(Buffer.from('out')); await flush(); await handle.close()
    expect(s.audit.publish).not.toHaveBeenCalled(); expect(io.write).toHaveBeenCalled()
  })
  it('tolerates audit/end persistence failures without leaking an open session', async () => {
    const s = setup(); s.audit.publish.mockRejectedValue(new Error('audit unavailable')); s.repo.endSession.mockRejectedValue(new Error('db unavailable'))
    const handle = await s.service.open(s.input); io.instances[0]!.hooks.onStdout!(Buffer.from('output')); handle.write(Buffer.from('input')); handle.resize(100, 30); await flush()
    await expect(handle.close()).resolves.toBeUndefined(); expect(io.dispose).toHaveBeenCalled(); expect(io.stop).toHaveBeenCalled()
  })
  it.each(['capability', 'userAccess', 'hostAccess'] as const)('denial at %s does not start a session or transport', async boundary => {
    const s = setup(); io[boundary].mockRejectedValueOnce(new Error('scope denied'))
    await expect(s.service.open(s.input)).rejects.toThrow('scope denied')
    expect(s.repo.startSession).not.toHaveBeenCalled(); expect(io.connect).not.toHaveBeenCalled()
  })
  it('scopes trial session persistence and stops access on watchdog revocation', async () => {
    const s = setup(); io.capability.mockResolvedValue({ id: 'synthetic-trial' })
    const handle = await s.service.open(s.input)
    expect(s.repo.startSession).toHaveBeenCalledWith(7, 12, expect.any(Object), 2)
    expect(io.userAccess).toHaveBeenCalledTimes(2)
    const revoke = io.monitor.mock.calls[0]![2] as () => void
    revoke(); await flush(); await handle.close()
    expect(io.dispose).toHaveBeenCalled(); expect(s.repo.endSession).toHaveBeenCalledTimes(1)
  })
  it.each([new Error('connect failed'), 'untyped failure'])('cleans transport and records connection failure', async failure => {
    const s = setup(); io.connect.mockRejectedValue(failure)
    await expect(s.service.open(s.input)).rejects.toBe(failure)
    expect(io.stop).toHaveBeenCalled(); expect(io.dispose).toHaveBeenCalled()
    expect(s.repo.endSession).toHaveBeenCalledWith(41, expect.objectContaining({ endedReason: 'ssh_connect_failed', errorCode: 'SSH_CONNECT_FAILED' }))
    expect(s.audit.publish).toHaveBeenCalledWith('session_error', expect.any(Object), expect.objectContaining({ code: 'SSH_CONNECT_FAILED' }))
  })
  it('ends a session if vault resolution fails before a transport is constructed', async () => {
    const s = setup(); s.host.onePasswordRef = 'fixture-item'; s.vault.resolve.mockRejectedValue(new Error('vault unavailable'))
    await expect(s.service.open(s.input)).rejects.toThrow('vault unavailable')
    expect(io.instances).toHaveLength(0); expect(s.repo.endSession).toHaveBeenCalledOnce()
  })
  it.each(['PASSWORD', 'PEM_PASSWORD', 'PEM'] as const)('encrypts vault material for %s without auditing plaintext', async authType => {
    const s = setup(); s.host.authType = authType; s.host.onePasswordRef = 'fixture-item'
    await s.service.open(s.input)
    expect(s.vault.resolve).toHaveBeenCalledWith(2, 'fixture-item')
    const target = io.instances[0]!.target
    const encrypted = authType === 'PEM' ? { encrypted: target.pemKey!.encryptedKey, iv: target.pemKey!.iv } : JSON.parse(target.passwordEncrypted!) as { encrypted: string; iv: string }
    expect(decrypt(encrypted)).toBe('synthetic-vault-secret')
    expect(JSON.stringify(s.audit.publish.mock.calls)).not.toContain('synthetic-vault-secret')
  })
})

describe('managed SSH input policy and resolved sessions', () => {
  it.each([false, true])('applies rejection, replacement and policy failure with resolved=%s', async resolved => {
    const s = setup(), evaluate = vi.fn<(data: Buffer, context: SshInputPolicyContext) => Promise<SshInputPolicyDecision>>()
    const policy: SshInputPolicy = { evaluate }, accepted = vi.fn()
    const input = { ...s.input, inputPolicy: policy, source: 'websocket_gateway' as const, sessionId: 41,
      target: {} as SshCredentials, bastion: null, onInputAccepted: accepted }
    const handle = resolved ? await s.service.openResolved(input) : await s.service.open(input)
    evaluate.mockResolvedValueOnce({ allow: false }).mockResolvedValueOnce({ allow: false, data: Buffer.from('safe reset'), message: 'Denied' })
      .mockResolvedValueOnce({ allow: true, data: Buffer.from('replacement') }).mockRejectedValueOnce(new Error('policy unavailable'))
    handle.write(Buffer.from('blocked')); await flush()
    expect(io.write).not.toHaveBeenCalled(); expect(s.input.onInputRejected).toHaveBeenCalledWith('Entrada bloqueada por política')
    handle.write(Buffer.from('blocked2')); await flush(); expect(io.write).toHaveBeenLastCalledWith(Buffer.from('safe reset'))
    handle.write(Buffer.from('allowed')); await flush(); expect(io.write).toHaveBeenLastCalledWith(Buffer.from('replacement'))
    handle.write(Buffer.from('error')); await flush(); expect(s.input.onInputRejected).toHaveBeenLastCalledWith('Entrada bloqueada por falha na política')
    expect(evaluate).toHaveBeenCalledWith(Buffer.from('blocked'), { sessionId: 41, tenantId: 2, userId: 7, hostId: 12, source: 'websocket_gateway' })
    if (resolved) expect(accepted).toHaveBeenCalledWith(Buffer.from('replacement'))
    await handle.close()
  })
  it('resolved websocket path preserves passthrough hooks and file operations without creating database session', async () => {
    const s = setup(), onStdout = vi.fn<(data: Buffer) => Buffer>(data => data), accepted = vi.fn()
    const input = { ...s.input, source: 'websocket_gateway' as const, target: {} as SshCredentials, bastion: null, onStdout, onInputAccepted: accepted }
    const handle = await s.service.openResolved(input)
    expect(io.capability).not.toHaveBeenCalled(); expect(io.hostAccess).toHaveBeenCalledWith(2, s.host, true)
    expect(s.repo.startSession).not.toHaveBeenCalled(); expect(io.instances[0]!.hooks.onStdout).toBe(onStdout)
    handle.write(Buffer.from('pwd')); await flush(); expect(accepted).toHaveBeenCalledWith(Buffer.from('pwd'))
    handle.resize(90, 30); expect(io.resize).toHaveBeenCalledWith(90, 30)
    expect(await handle.sessionFiles()).toEqual({ marker: 'files' }); await handle.warmSftp(); expect(io.warm).toHaveBeenCalledOnce()
    expect(await handle.sftpHome()).toBe('/home/fixture'); expect(await handle.listDirectory('/tmp')).toEqual([{ name: 'fixture.txt' }]); expect(io.list).toHaveBeenCalledWith('/tmp')
    io.instances[0]!.hooks.onClose!(); handle.close(); expect(s.input.onClose).toHaveBeenCalledOnce(); expect(io.stop).toHaveBeenCalled()
  })
  it('resolved native sessions recheck trial access and clean up failed connections', async () => {
    const s = setup(); io.hostAccess.mockResolvedValue({ id: 'fixture-trial' })
    const input = { ...s.input, source: 'native_ssh_gateway' as const, target: {} as SshCredentials, bastion: null }
    await s.service.openResolved(input)
    expect(io.capability).toHaveBeenCalledWith(2, 'nativeSsh'); expect(io.userAccess).toHaveBeenCalledTimes(2)
    const revoke = io.monitor.mock.calls[0]![2] as () => void; revoke(); expect(io.dispose).toHaveBeenCalled()
    io.connect.mockRejectedValueOnce(new Error('connection refused'))
    await expect(s.service.openResolved(input)).rejects.toThrow('connection refused'); expect(io.stop).toHaveBeenCalled()
  })
})
