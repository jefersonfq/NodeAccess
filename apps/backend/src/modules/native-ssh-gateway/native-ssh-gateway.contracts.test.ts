import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { NativeSshGatewayService } from './native-ssh-gateway.service.js'
import bcrypt from 'bcrypt'
import type { ManagedSshSessionService } from '../ssh/managed-ssh-session.service.js'
import type { LogRepository } from '../logs/log.repository.js'
import { assertTrialCapability } from '../trials/trial-policy.js'

vi.mock('../../config/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../trials/trial-policy.js', () => ({ assertTrialCapability: vi.fn().mockResolvedValue(undefined) }))
vi.mock('bcrypt', () => ({ default: { compare: vi.fn().mockResolvedValue(true) } }))

const info = { ip: '192.0.2.10' }
const config = { enabled: false, port: 2222, host: '127.0.0.1' }
const makeUser = () => ({ id: 7, tenantId: 2, role: 'USER', active: true, email: 'fixture@example.invalid',
  passwordHash: 'fixture-hash', lockedUntil: null, mfaEnabled: false, mfaSecret: null })
function invoke<T = unknown>(service: NativeSshGatewayService, method: string, ...args: unknown[]): T {
  const callable = Reflect.get(service, method) as (...values: unknown[]) => T
  return callable.apply(service, args)
}
function fixture(provider?: () => Promise<typeof config | null>) {
  const user = makeUser()
  const repo = { findNativeSshUserByLogin: vi.fn().mockResolvedValue(user), listAccessibleHosts: vi.fn().mockResolvedValue([]), resolveAccessibleHost: vi.fn().mockResolvedValue(null) }
  const redis = { set: vi.fn<(key: string, value: string, ...options: unknown[]) => Promise<string>>().mockResolvedValue('OK'), get: vi.fn().mockResolvedValue(null), del: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1), exists: vi.fn().mockResolvedValue(0), ttl: vi.fn().mockResolvedValue(-2) }
  const totp = { verify: vi.fn().mockReturnValue(false) }
  const emailConfig = { getTransportConfig: vi.fn().mockResolvedValue(null) }
  const email = { send: vi.fn().mockResolvedValue(undefined) }
  const session = { write: vi.fn(), close: vi.fn().mockResolvedValue(undefined) }
  const managed = { open: vi.fn<(options: Parameters<ManagedSshSessionService['open']>[0]) => Promise<typeof session>>().mockResolvedValue(session) }
  const logs = { logAuthEvent: vi.fn<LogRepository['logAuthEvent']>().mockResolvedValue(undefined), logAdminEvent: vi.fn<LogRepository['logAdminEvent']>().mockResolvedValue(undefined) }
  type Args = ConstructorParameters<typeof NativeSshGatewayService>
  const service = new NativeSshGatewayService(config, repo as unknown as Args[1], totp as unknown as Args[2],
    redis as unknown as Args[3], emailConfig as unknown as Args[4], email as unknown as Args[5], managed as unknown as Args[6], logs as unknown as Args[7], provider)
  return { service, user, repo, redis, totp, emailConfig, email, managed, logs, session }
}
class Channel extends EventEmitter {
  write = vi.fn()
  end = vi.fn()
  exit = vi.fn()
  stderr = { write: vi.fn() }
}
const authenticated = (user = makeUser()) => ({ user, parsedLogin: { nodeAccessLogin: user.email }, mfaVerified: !user.mfaEnabled })
const passwordContext = () => ({ method: 'password', username: 'fixture', password: 'fixture-password' })
async function settleDelay<T>(pending: Promise<T>): Promise<T> { await vi.advanceTimersByTimeAsync(700); return pending }

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); vi.mocked(bcrypt.compare).mockResolvedValue(true as never); vi.mocked(assertTrialCapability).mockResolvedValue(undefined) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('native gateway lifecycle and operational heartbeat', () => {
  it('publishes disabled state periodically and stopped state on shutdown without listening', async () => {
    const f = fixture()
    await f.service.start()
    expect(JSON.parse(f.redis.set.mock.calls[0]![1])).toMatchObject({ state: 'disabled', host: '127.0.0.1', port: 2222 })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(f.redis.set).toHaveBeenCalledTimes(2)
    await f.service.stop()
    expect((JSON.parse(f.redis.set.mock.calls.at(-1)![1]) as { state: string }).state).toBe('stopped')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('uses saved configuration and reports missing host key instead of opening a listener', async () => {
    const f = fixture(() => Promise.resolve({ ...config, enabled: true }))
    await f.service.start()
    expect(JSON.parse(f.redis.set.mock.calls[0]![1])).toMatchObject({ state: 'error', enabled: true, hostKeyState: 'missing' })
    await f.service.stop()
  })
  it('falls back to config when provider fails and tolerates heartbeat storage failure', async () => {
    const f = fixture(() => Promise.reject(new Error('fixture unavailable')))
    f.redis.set.mockRejectedValue(new Error('Redis unavailable'))
    await expect(f.service.start()).resolves.toBeUndefined()
    await expect(f.service.stop()).resolves.toBeUndefined()
  })
  it('handles absent saved configuration, empty stop and preserves prior failure during recovery', async () => {
    const f = fixture(() => Promise.resolve(null))
    await f.service.stop()
    invoke(f.service, 'updateRuntimeHeartbeat', 'online')
    await f.service.start()
    invoke(f.service, 'updateRuntimeHeartbeat', 'error', 'fixture failure')
    invoke(f.service, 'updateRuntimeHeartbeat', 'online')
    expect(JSON.parse(f.redis.set.mock.calls.at(-1)![1])).toMatchObject({ state: 'online', lastFailureMessage: 'fixture failure' })
    await f.service.stop()
  })
})

describe('native gateway authentication contracts', () => {
  it('accepts valid password, clears counters and records tenant capability and audit', async () => {
    const f = fixture()
    const result = await invoke<Promise<unknown>>(f.service, 'authenticate', passwordContext(), null, info)
    expect(result).toMatchObject({ client: { user: f.user, mfaVerified: true }, requiresMfa: false })
    expect(assertTrialCapability).toHaveBeenCalledWith(2, 'nativeSsh')
    expect(f.redis.del).toHaveBeenCalledWith(expect.stringContaining(':ip:192.0.2.10:count'), expect.stringContaining(':login:'))
    expect(f.logs.logAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, eventType: 'LOGIN', success: true }))
  })
  it('keeps password acceptance separate from completed MFA', async () => {
    const f = fixture(); f.user.mfaEnabled = true
    const result = await invoke<Promise<unknown>>(f.service, 'authenticate', passwordContext(), null, info)
    expect(result).toMatchObject({ client: { mfaVerified: false }, requiresMfa: true })
    expect(f.logs.logAuthEvent).not.toHaveBeenCalledWith(expect.objectContaining({ eventType: 'LOGIN', success: true }))
  })
  it.each(['publickey', 'none', 'hostbased'])('rejects unsupported authentication method %s', async method => {
    const f = fixture()
    expect(await invoke(f.service, 'authenticate', { ...passwordContext(), method }, null, info)).toBeNull()
    expect(f.repo.findNativeSshUserByLogin).not.toHaveBeenCalled()
  })
  it.each(['unknown', 'inactive', 'no-password', 'locked', 'wrong-password', 'trial', 'rate-limit'])('rejects %s with delay and without successful login audit', async reason => {
    const f = fixture()
    if (reason === 'unknown') f.repo.findNativeSshUserByLogin.mockResolvedValue(null)
    if (reason === 'inactive') f.user.active = false
    if (reason === 'no-password') f.user.passwordHash = ''
    if (reason === 'locked') Object.assign(f.user, { lockedUntil: new Date(Date.now() + 60_000) })
    if (reason === 'wrong-password') vi.mocked(bcrypt.compare).mockResolvedValue(false as never)
    if (reason === 'trial') vi.mocked(assertTrialCapability).mockRejectedValue(new Error('capability denied'))
    if (reason === 'rate-limit') f.redis.exists.mockResolvedValue(1)
    expect(await settleDelay(invoke<Promise<unknown>>(f.service, 'authenticate', passwordContext(), null, info))).toBeNull()
    expect(f.logs.logAuthEvent).not.toHaveBeenCalledWith(expect.objectContaining({ eventType: 'LOGIN', success: true }))
    if (reason === 'rate-limit') expect(f.repo.findNativeSshUserByLogin).not.toHaveBeenCalled()
  })
  it('resolves ambiguous login candidates in parser order, stopping at first repository match', async () => {
    const f = fixture(); f.repo.findNativeSshUserByLogin.mockResolvedValueOnce(null)
    const result = await invoke<Promise<unknown>>(f.service, 'resolveLogin', 'user@example.invalid@host')
    expect(result).toMatchObject({ parsedLogin: { nodeAccessLogin: 'user@example.invalid', target: 'host' } })
    expect(f.repo.findNativeSshUserByLogin).toHaveBeenCalledTimes(2)
  })
})

describe('native gateway MFA and OTP contracts', () => {
  it('issues tenant-scoped email OTP with bounded expiry and no second send during cooldown', async () => {
    const f = fixture(); f.emailConfig.getTransportConfig.mockResolvedValue({ host: 'fixture.invalid' })
    expect(await invoke(f.service, 'issueEmailOtpIfAvailable', f.user)).toBe(true)
    const stored = JSON.parse(f.redis.set.mock.calls[0]![1]) as { code: string; attempts: number }
    expect(stored.code).toMatch(/^\d{6}$/); expect(stored.attempts).toBe(3)
    expect(f.redis.set.mock.calls[0]!.slice(2)).toEqual(['EX', 600])
    expect(f.email.send).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ to: f.user.email }))
    expect(f.email.send.mock.calls[0]![1] as unknown).toMatchObject({ text: expect.stringContaining(stored.code) as unknown })
    f.redis.ttl.mockResolvedValue(590)
    expect(await invoke(f.service, 'issueEmailOtpIfAvailable', f.user)).toBe(true)
    expect(f.email.send).toHaveBeenCalledTimes(1)
  })
  it('does not send without transport or after rate limit', async () => {
    const f = fixture()
    expect(await invoke(f.service, 'issueEmailOtpIfAvailable', f.user)).toBe(false)
    f.emailConfig.getTransportConfig.mockResolvedValue({}); f.redis.incr.mockResolvedValue(6)
    expect(await invoke(f.service, 'issueEmailOtpIfAvailable', f.user)).toBe(false)
    expect(f.email.send).not.toHaveBeenCalled()
  })
  it.each([['123456', 3, true], ['bad-long-value', 3, false], ['000000', 1, false]])('consumes OTP match or attempts safely (%s)', async (code, attempts, expected) => {
    const f = fixture(); f.redis.get.mockResolvedValue(JSON.stringify({ code: '123456', attempts }))
    expect(await invoke(f.service, 'verifyEmailOtp', 7, code)).toBe(expected)
    if (expected || attempts === 1) expect(f.redis.del).toHaveBeenCalledWith('native-ssh-gateway:otp:email:7')
    else expect((JSON.parse(f.redis.set.mock.calls[0]![1]) as { attempts: number }).attempts).toBe(2)
  })
  it('rejects missing OTP and refuses malformed stored data', async () => {
    const f = fixture()
    expect(await invoke(f.service, 'verifyEmailOtp', 7, '123456')).toBe(false)
    f.redis.get.mockResolvedValue('invalid-json')
    await expect(invoke(f.service, 'verifyEmailOtp', 7, '123456')).rejects.toThrow()
  })
  it.each([true, false])('authenticator MFA success=%s remains distinct from password', async valid => {
    const f = fixture(); Object.assign(f.user, { mfaEnabled: true, mfaSecret: 'fixture-secret' }); f.totp.verify.mockReturnValue(valid)
    const pending = authenticated(f.user)
    const context = { method: 'keyboard-interactive', username: 'fixture', prompt: vi.fn((_p: unknown, _n: string, _i: string, callback: (answers: string[]) => void) => callback(['123456'])) }
    const result = await invoke(f.service, 'authenticateMfa', context, pending, info)
    if (valid) expect(result).toMatchObject({ requiresMfa: false, client: { mfaVerified: true } })
    else expect(result).toBeNull()
    expect(context.prompt.mock.calls[0]![0]).toEqual({ prompt: 'MFA code: ', echo: false })
  })
  it.each(['enter', 'cancel', 'close'])('secret input never echoes typed characters and removes data listener on %s', async ending => {
    const f = fixture(), channel = new Channel()
    const pending = invoke<Promise<string>>(f.service, 'readSecretLine', channel, 'MFA: ')
    channel.emit('data', Buffer.from('123x\x7f456'))
    if (ending === 'close') channel.emit('close')
    else channel.emit('data', Buffer.from(ending === 'enter' ? '\r' : '\x03'))
    expect(await pending).toBe(ending === 'enter' ? '123456' : '')
    expect(channel.write.mock.calls.flat().join('')).not.toContain('123456')
    expect(channel.listenerCount('data')).toBe(0)
  })
})

describe('native gateway abuse controls', () => {
  it.each([[0, 0, null], [1, 0, 'ip'], [0, 1, 'login'], [1, 1, 'ip_login']])('separates IP/login limits (%s,%s)', async (ip, login, scope) => {
    const f = fixture(); f.redis.exists.mockResolvedValueOnce(ip).mockResolvedValueOnce(login)
    expect(await invoke(f.service, 'checkAuthRateLimit', ' Fixture ', info)).toEqual({ limited: scope !== null, scope })
  })
  it('sets counter expiry once and blocks both scopes only beyond configured thresholds', async () => {
    const f = fixture()
    await invoke(f.service, 'recordAuthFailure', ' Fixture ', info, 7)
    expect(f.redis.expire).toHaveBeenCalledTimes(2)
    expect(f.redis.set).not.toHaveBeenCalled()
    f.redis.incr.mockResolvedValue(11)
    await invoke(f.service, 'recordAuthFailure', 'fixture', info, 7)
    expect(f.redis.set).toHaveBeenCalledTimes(2)
    expect(f.redis.set.mock.calls[0]!.slice(1)).toEqual(['1', 'EX', 900])
    expect(f.logs.logAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'LOGIN_BLOCKED' }))
    expect(f.logs.logAdminEvent.mock.calls.at(-1)![0].details).toContain('ip_login')
  })
  it('preserves documented fail-open rate behavior on Redis failures without accepting invalid credentials', async () => {
    const f = fixture(); f.redis.exists.mockRejectedValue(new Error('unavailable')); f.redis.incr.mockRejectedValue(new Error('unavailable'))
    f.redis.set.mockRejectedValue(new Error('unavailable')); f.redis.del.mockRejectedValue(new Error('unavailable'))
    expect(await invoke(f.service, 'checkAuthRateLimit', 'fixture', info)).toEqual({ limited: false, scope: null })
    expect(await invoke(f.service, 'incrementRateCounter', 'fixture')).toBe(0)
    await expect(invoke(f.service, 'setRateBlock', 'fixture')).resolves.toBeUndefined()
    await expect(invoke(f.service, 'clearAuthFailures', 'fixture', info)).resolves.toBeUndefined()
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never)
    expect(await settleDelay(invoke<Promise<unknown>>(f.service, 'authenticate', passwordContext(), null, info))).toBeNull()
  })
})

const host = () => ({ id: 19, name: 'Fixture host', ip: '192.0.2.19', port: 22, sshUser: 'default', scope: 'GROUP',
  groupName: 'Fixture group', folderName: 'Fixture folder', tags: ['fixture'] })
const size = { cols: 120, rows: 35 }
describe('native gateway command and managed-session orchestration', () => {
  it.each(['', 'help', 'unknown', 'exit', 'quit', 'connect '])('handles local command %j without opening a host', async command => {
    const f = fixture(), channel = new Channel()
    await invoke(f.service, 'handleCommand', channel, authenticated(), info, size, command)
    expect(f.managed.open).not.toHaveBeenCalled()
    expect(channel.write).toHaveBeenCalled()
    expect(channel.end).toHaveBeenCalledTimes(['exit', 'quit'].includes(command) ? 1 : 0)
  })
  it('lists only repository-authorized hosts with tenant and role scope and meaningful metadata', async () => {
    const f = fixture(), channel = new Channel()
    f.repo.listAccessibleHosts.mockResolvedValue([host()])
    await invoke(f.service, 'handleCommand', channel, authenticated(), info, size, 'hosts fixture')
    expect(f.repo.listAccessibleHosts).toHaveBeenCalledWith(7, 2, 'USER', 'fixture')
    const output = channel.write.mock.calls.flat().join('')
    for (const value of ['Fixture host', '192.0.2.19:22', 'Fixture group', 'Fixture folder', 'tags=fixture']) expect(output).toContain(value)
    f.repo.listAccessibleHosts.mockResolvedValue([])
    await invoke(f.service, 'handleCommand', channel, authenticated(), info, size, 'hosts')
    expect(channel.write).toHaveBeenCalledWith('Nenhum host acessível encontrado.\r\n')
  })
  it('opens shell command loop, applies editing/cancel and exits without exposing a host session', async () => {
    const f = fixture(), channel = new Channel()
    await invoke(f.service, 'handleShell', channel, authenticated(), info, size)
    channel.emit('data', Buffer.from('bad\x03exix\x7ft\r'))
    await Promise.resolve()
    expect(channel.write).toHaveBeenCalledWith('^C\r\nnodeaccess> ')
    expect(channel.end).toHaveBeenCalledOnce()
    expect(f.managed.open).not.toHaveBeenCalled()
  })
  it.each([true, false])('denies missing/unauthorized target and honors closeOnFailure=%s', async closeOnFailure => {
    const f = fixture(), channel = new Channel()
    await invoke(f.service, 'connectToTarget', channel, authenticated(), info, size, undefined, { closeOnFailure })
    expect(channel.write).toHaveBeenCalledWith('Destino não informado.\r\n')
    const auth = { ...authenticated(), parsedLogin: { nodeAccessLogin: 'fixture', target: 'hidden' } }
    await invoke(f.service, 'connectToTarget', channel, auth, info, size, undefined, { closeOnFailure })
    expect(f.repo.resolveAccessibleHost).toHaveBeenCalledWith('hidden', 7, 2, 'USER')
    expect(f.managed.open).not.toHaveBeenCalled()
    expect(channel.end).toHaveBeenCalledTimes(closeOnFailure ? 2 : 0)
  })
  it('opens authorized host with username override, forwards bytes and audits close exactly once', async () => {
    const f = fixture(), channel = new Channel(); f.repo.resolveAccessibleHost.mockResolvedValue(host())
    const auth = { ...authenticated(), parsedLogin: { nodeAccessLogin: 'fixture', target: '#19', targetUser: 'override' } }
    await invoke(f.service, 'connectToTarget', channel, auth, info, size, 'whoami')
    const options = f.managed.open.mock.calls[0]![0]
    expect(options).toMatchObject({ user: { id: 7, tenantId: 2 }, host: { id: 19, sshUser: 'override' }, cols: 120, rows: 35,
      clientIp: info.ip, source: 'native_ssh_gateway', connectionMethod: 'native_ssh_gateway' })
    expect(f.session.write).toHaveBeenCalledWith(Buffer.from('whoami\n'))
    options.transport.send('remote output'); expect(channel.write).toHaveBeenCalledWith('remote output')
    options.onInputRejected('denied'); expect(channel.write).toHaveBeenCalledWith('\r\ndenied\r\n')
    channel.emit('data', Buffer.from('input')); expect(f.session.write).toHaveBeenCalledWith(Buffer.from('input'))
    channel.emit('close'); options.onClose(); options.onClose()
    expect(f.session.close).toHaveBeenCalledOnce()
    expect(f.logs.logAdminEvent.mock.calls.filter(call => call[0].action === 'NATIVE_SSH_GATEWAY_CONNECTION_CLOSED')).toHaveLength(1)
    expect(channel.end).not.toHaveBeenCalled()
  })
  it.each([true, false])('remote session close returns to shell=%s or closes channel', async returnToShell => {
    const f = fixture(), channel = new Channel(); f.repo.resolveAccessibleHost.mockResolvedValue(host())
    const auth = { ...authenticated(), parsedLogin: { nodeAccessLogin: 'fixture', target: '#19' } }
    await invoke(f.service, 'connectToTarget', channel, auth, info, size, undefined, { returnToShell })
    f.managed.open.mock.calls[0]![0].onClose()
    if (returnToShell) {
      expect(channel.end).not.toHaveBeenCalled(); expect(channel.write.mock.calls.flat().join('')).toContain('Sessao SSH final encerrada')
      channel.emit('data', Buffer.from('exit\r')); await Promise.resolve(); expect(channel.end).toHaveBeenCalledOnce()
    } else expect(channel.end).toHaveBeenCalledOnce()
  })
  it.each(['authentication failed', 'connection timeout', 'host key invalid', 'unexpected'])('classifies target error %s without leaking technical reason to channel', async message => {
    const f = fixture(), channel = new Channel(); f.repo.resolveAccessibleHost.mockResolvedValue(host())
    f.managed.open.mockRejectedValue(new Error(message))
    await invoke(f.service, 'handleCommand', channel, authenticated(), info, size, 'connect override@fixture')
    expect(channel.end).not.toHaveBeenCalled()
    expect(channel.write.mock.calls.flat().join('')).not.toContain(message)
    expect(f.logs.logAdminEvent.mock.calls.at(-1)![0]).toMatchObject({ action: 'NATIVE_SSH_GATEWAY_CONNECTION_FAILED' })
  })
})

describe('native gateway client event contracts', () => {
  it('rejects sessions before authentication and handles unsupported methods without accepting the client', async () => {
    const f = fixture(), client = new EventEmitter(), reject = vi.fn()
    invoke(f.service, 'handleClient', client, info)
    client.emit('ready'); client.emit('session', vi.fn(), reject)
    expect(reject).toHaveBeenCalledOnce()
    const context = { ...passwordContext(), method: 'publickey', accept: vi.fn(), reject: vi.fn() }
    client.emit('authentication', context); await vi.advanceTimersByTimeAsync(0)
    expect(context.accept).not.toHaveBeenCalled()
    expect(context.reject).toHaveBeenCalledWith(['password', 'keyboard-interactive'], false)
    client.emit('error', new Error('fixture transport error'))
  })
  it('accepts authenticated shell, acknowledges PTY/window events and rejects exec without target/subsystem', async () => {
    const f = fixture(), client = new EventEmitter(), session = new EventEmitter(), channel = new Channel()
    invoke(f.service, 'handleClient', client, info)
    const context = { ...passwordContext(), accept: vi.fn(), reject: vi.fn() }
    client.emit('authentication', context); await vi.advanceTimersByTimeAsync(0)
    expect(context.accept).toHaveBeenCalledOnce()
    client.emit('ready'); client.emit('session', () => session, vi.fn())
    const acceptPty = vi.fn(), acceptWindow = vi.fn(), rejectExec = vi.fn(), rejectSubsystem = vi.fn()
    session.emit('pty', acceptPty, vi.fn(), { cols: 0, rows: 0 })
    session.emit('window-change', acceptWindow, vi.fn(), { cols: 100, rows: 0 })
    session.emit('window-change', undefined, vi.fn(), { cols: 0, rows: 30 })
    session.emit('shell', () => channel, vi.fn()); await vi.advanceTimersByTimeAsync(0)
    expect(acceptPty).toHaveBeenCalledOnce(); expect(acceptWindow).toHaveBeenCalledOnce()
    expect(channel.write.mock.calls.flat().join('')).toContain('NodeAccess SSH Gateway')
    session.emit('exec', vi.fn(), rejectExec, { command: 'whoami' })
    session.emit('subsystem', vi.fn(), rejectSubsystem, { name: 'sftp' })
    expect(rejectExec).toHaveBeenCalledOnce(); expect(rejectSubsystem).toHaveBeenCalledOnce()
  })
  it.each(['shell', 'exec'])('keeps unexpected %s setup failures contained in its channel', async kind => {
    const f = fixture(), client = new EventEmitter(), session = new EventEmitter(), channel = new Channel()
    f.repo.findNativeSshUserByLogin.mockImplementation(login => Promise.resolve(login === 'fixture' ? f.user : null))
    f.repo.resolveAccessibleHost.mockRejectedValue(new Error('fixture database unavailable'))
    invoke(f.service, 'handleClient', client, info)
    client.emit('authentication', { ...passwordContext(), username: 'fixture@#19', accept: vi.fn(), reject: vi.fn() })
    await vi.advanceTimersByTimeAsync(0)
    client.emit('ready'); client.emit('session', () => session, vi.fn())
    session.emit(kind, () => channel, vi.fn(), { command: 'whoami' }); await vi.advanceTimersByTimeAsync(0)
    expect(channel.end).toHaveBeenCalledOnce()
    if (kind === 'exec') { expect(channel.exit).toHaveBeenCalledWith(1); expect(channel.stderr.write).toHaveBeenCalled() }
    else expect(channel.write.mock.calls.flat().join('')).toContain('Erro interno')
  })
  it('contains repository rejection during authentication', async () => {
    const f = fixture(), client = new EventEmitter(), reject = vi.fn()
    f.repo.findNativeSshUserByLogin.mockRejectedValue(new Error('unavailable'))
    invoke(f.service, 'handleClient', client, info)
    client.emit('authentication', { ...passwordContext(), accept: vi.fn(), reject })
    await vi.advanceTimersByTimeAsync(0)
    expect(reject).toHaveBeenCalledWith(['password', 'keyboard-interactive'], false)
  })
  it('password acceptance requiring MFA does not authorize target open before channel challenge', async () => {
    const f = fixture(), client = new EventEmitter(), accept = vi.fn(); f.user.mfaEnabled = true
    invoke(f.service, 'handleClient', client, info)
    client.emit('authentication', { ...passwordContext(), accept, reject: vi.fn() }); await vi.advanceTimersByTimeAsync(0)
    expect(accept).toHaveBeenCalledOnce()
    expect(f.managed.open).not.toHaveBeenCalled()
    expect(f.logs.logAuthEvent).not.toHaveBeenCalledWith(expect.objectContaining({ eventType: 'LOGIN', success: true }))
  })
})

describe('native gateway channel MFA timing and failure contracts', () => {
  it.each([true, false])('channel challenge succeeds=%s and never echoes secret', async valid => {
    const f = fixture(), channel = new Channel(); Object.assign(f.user, { mfaEnabled: true, mfaSecret: 'fixture-secret' })
    f.totp.verify.mockReturnValue(valid)
    const auth = authenticated(f.user)
    const pending = invoke<Promise<boolean>>(f.service, 'ensureChannelMfa', channel, auth, info)
    for (let i = 0; i < (valid ? 1 : 3); i++) {
      await vi.advanceTimersByTimeAsync(0)
      channel.emit('data', Buffer.from('123456\r'))
    }
    expect(await pending).toBe(valid)
    expect(auth.mfaVerified).toBe(valid)
    expect(channel.write.mock.calls.flat().join('')).not.toContain('123456')
    expect(channel.end).toHaveBeenCalledTimes(valid ? 0 : 1)
    expect(f.managed.open).not.toHaveBeenCalled()
  })
  it('prompt timeout prevents email service from indefinitely blocking the MFA challenge', async () => {
    const f = fixture()
    let complete: ((value: null) => void) | undefined
    f.emailConfig.getTransportConfig.mockImplementation(() => new Promise(resolve => { complete = resolve }))
    const pending = invoke<Promise<boolean>>(f.service, 'issueEmailOtpWithPromptTimeout', f.user)
    await vi.advanceTimersByTimeAsync(2500)
    expect(await pending).toBe(false)
    complete?.(null); await vi.advanceTimersByTimeAsync(0)
  })
  it('email issuance and verification failures fail MFA rather than accepting a user', async () => {
    const f = fixture(); Object.assign(f.user, { mfaEnabled: true, mfaSecret: null })
    f.emailConfig.getTransportConfig.mockRejectedValue(new Error('smtp unavailable'))
    expect(await invoke(f.service, 'issueEmailOtpWithPromptTimeout', f.user)).toBe(false)
    f.redis.get.mockRejectedValue(new Error('redis unavailable'))
    const context = { method: 'keyboard-interactive', username: 'fixture', prompt: vi.fn((_p: unknown, _n: string, _i: string, callback: (answers: string[]) => void) => callback([])) }
    expect(await invoke(f.service, 'authenticateMfa', context, authenticated(f.user), info)).toBeNull()
    expect(f.logs.logAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'MFA_FAILED', success: false }))
  })
  it('rejects keyboard-interactive without a pending MFA user', async () => {
    const f = fixture()
    expect(await invoke(f.service, 'authenticate', { method: 'keyboard-interactive' }, null, info)).toBeNull()
    expect(await invoke(f.service, 'authenticateMfa', { method: 'password' }, authenticated(), info)).toBeNull()
  })
})

describe('native gateway interactive host selector', () => {
  it('paginates bounded authorized results with keyboard and cancels back to command prompt', async () => {
    const f = fixture(), channel = new Channel()
    f.repo.listAccessibleHosts.mockResolvedValue(Array.from({ length: 100 }, (_, index) => ({ ...host(), id: index + 1, name: `Fixture ${index + 1}` })))
    await invoke(f.service, 'handleCommand', channel, authenticated(), info, size, 'sshs fixture')
    expect(f.repo.listAccessibleHosts).toHaveBeenCalledWith(7, 2, 'USER', 'fixture', 100)
    expect(channel.write.mock.calls.flat().join('')).toContain('Refine a busca')
    for (const keys of ['\x1b[C', '\x1b[6~', '\x1b[5~', '\x1b[D', '\x1b[B'.repeat(10), '\x1b[A'.repeat(10)]) channel.emit('data', Buffer.from(keys))
    expect(channel.write.mock.calls.flat().join('')).toContain('Pagina 3/10')
    channel.emit('data', Buffer.from('\x1b'))
    expect(channel.write.mock.calls.at(-1)![0]).toBe('nodeaccess> ')
    channel.emit('data', Buffer.from('exit\r')); await vi.advanceTimersByTimeAsync(0)
    expect(channel.end).toHaveBeenCalledOnce(); expect(f.managed.open).not.toHaveBeenCalled()
  })
  it('connects selected authorized host through managed session, preserving repository access check', async () => {
    const f = fixture(), channel = new Channel()
    f.repo.listAccessibleHosts.mockResolvedValue([host(), { ...host(), id: 20, ip: '192.0.2.20' }])
    f.repo.resolveAccessibleHost.mockResolvedValue({ ...host(), id: 20, ip: '192.0.2.20' })
    await invoke(f.service, 'openHostSelector', channel, authenticated(), info, size)
    channel.emit('data', Buffer.from('\x1b[B\r')); await vi.advanceTimersByTimeAsync(0)
    expect(f.repo.resolveAccessibleHost).toHaveBeenCalledWith('192.0.2.20', 7, 2, 'USER')
    expect(f.managed.open).toHaveBeenCalledOnce()
    f.managed.open.mock.calls[0]![0].onClose()
    expect(channel.write.mock.calls.flat().join('')).toContain('Sessao SSH final encerrada')
  })
  it('ignores stale query results and results arriving after cancellation', async () => {
    const f = fixture(), channel = new Channel()
    await invoke(f.service, 'openHostSelector', channel, authenticated(), info, size)
    const results: Array<(value: ReturnType<typeof host>[]) => void> = []
    f.repo.listAccessibleHosts.mockImplementation(() => new Promise(resolve => { results.push(resolve) }))
    channel.emit('data', Buffer.from('ab'))
    results[1]!([{ ...host(), name: 'Latest fixture' }]); await vi.advanceTimersByTimeAsync(0)
    const count = channel.write.mock.calls.length
    results[0]!([{ ...host(), name: 'Stale fixture' }]); await vi.advanceTimersByTimeAsync(0)
    expect(channel.write.mock.calls.length).toBe(count)
    channel.emit('data', Buffer.from('\x7f\x12'))
    expect(f.repo.listAccessibleHosts.mock.calls.at(-1)![3]).toBe('a')
    channel.emit('data', Buffer.from('\x03'))
    const afterClose = channel.write.mock.calls.length
    results[2]!([host()]); results[3]!([host()]); await vi.advanceTimersByTimeAsync(0)
    expect(channel.write.mock.calls.length).toBe(afterClose)
    expect(f.managed.open).not.toHaveBeenCalled()
  })
})
