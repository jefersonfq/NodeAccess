import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertNotTrial, assertTrialAccess, assertTrialHostAccess, assertTrialHttpAccess, configureTrialPolicy, configureTrialProtectedAddresses, configureTrialUserReader, assertTrialUserAccess, assertTrialResource, ipv4InCidr, monitorTrialAccess, type TrialAccess } from './trial-policy.js'
import { requireAuth } from '../../shared/guards.js'

const now = new Date('2026-10-24T12:00:00Z')
const active = (seconds = 60): TrialAccess => ({ status: 'ACTIVE', expiresAt: new Date(now.getTime() + seconds * 1000), profileJson: { resources: ['ssh', 'sftp', 'sharing', 'audit'], networkCidr: '10.90.0.0/24', hostAddresses: ['10.90.0.5'] } })
const host = { ip: '10.90.0.5', accessProtocol: 'SSH', connectionMode: 'DIRECT', bastion: null }

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); configureTrialPolicy(() => Promise.resolve(null)) })
afterEach(() => { configureTrialProtectedAddresses([]); configureTrialPolicy(() => Promise.resolve(null)); configureTrialUserReader(() => Promise.resolve(true)); vi.useRealTimers() })

describe('trial tenant access', () => {
  it('leaves ordinary tenants unaffected by trial restrictions and timers', async () => {
    expect(await assertTrialAccess(1)).toBeNull()
    await expect(assertTrialHttpAccess(1, 'POST', '/api/v1/hosts/test-connection')).resolves.toBeUndefined()
    expect(await assertTrialHostAccess(1, { ...host, ip: 'production.internal', connectionMode: 'AGENT' })).toBeNull()
    const close = vi.fn(); monitorTrialAccess(1, null, close)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(120_000); expect(close).not.toHaveBeenCalled()
  })
  it.each(['PENDING', 'PROVISIONING', 'EXPIRED', 'REMOVING', 'REMOVED', 'FAILED'])('denies status %s', async status => {
    configureTrialPolicy(() => Promise.resolve(({ ...active(), status })))
    await expect(assertTrialAccess(2)).rejects.toMatchObject({ code: 'TRIAL_EXPIRED' })
  })
  it.each([null, new Date('invalid'), now])('denies missing, invalid or elapsed deadline %s', async expiresAt => {
    configureTrialPolicy(() => Promise.resolve(({ ...active(), expiresAt })))
    await expect(assertTrialAccess(2)).rejects.toMatchObject({ code: 'TRIAL_EXPIRED' })
  })
  it('does not treat a policy database failure as a normal tenant', async () => {
    configureTrialPolicy(() => { return Promise.reject(new Error('database unavailable')) })
    await expect(assertTrialAccess(2)).rejects.toThrow('database unavailable')
  })
  it('blocks alternative ingress even before activation', async () => {
    configureTrialPolicy(() => Promise.resolve(({ ...active(), status: 'PENDING' })))
    await expect(assertNotTrial(2)).rejects.toMatchObject({ code: 'TRIAL_FEATURE_DISABLED' })
  })
  it('checks HTTP tenant expiry after JWT verification', async () => {
    configureTrialPolicy(() => Promise.resolve(active(0)))
    const req = { jwtVerify: () => Promise.resolve(({ stage: 'authenticated', tenantId: 2 })), method: 'GET', url: '/api/v1/hosts' }
    await expect(requireAuth(req as never, {} as never)).rejects.toMatchObject({ code: 'TRIAL_EXPIRED', statusCode: 403 })
  })
})

describe('trial HTTP surface', () => {
  beforeEach(() => configureTrialPolicy(() => Promise.resolve(active())))
  it.each([['GET','/api/v1/hosts?ids=1'],['GET','/api/v1/settings'],['POST','/api/v1/sftp/12/upload'],['POST','/api/v1/shared-sessions/4/control/request'],['PATCH','/api/v1/users/me/preferences'],['POST','/api/v1/users/me/change-password'],['PUT','/api/v1/sftp/12/write'],['DELETE','/api/v1/sftp/12/file'],['GET','/api/v1/hosts/associated-links/catalog'],['GET','/api/v1/agents/status'],['GET','/api/v1/forwardings'],['GET','/api/v1/sessions/access-map']])('permits %s %s', async (method, path) => {
    await expect(assertTrialHttpAccess(2, method, path)).resolves.toBeUndefined()
  })
  it.each([['POST','/api/v1/hosts'],['PATCH','/api/v1/hosts/12'],['POST','/api/v1/hosts/test-connection'],['POST','/api/v1/agents'],['GET','/api/v1/secrets'],['GET','/api/v1/settings/platform'],['POST','/api/v1/platform/tenants'],['GET','/api/v1/mcp'],['POST','/api/v1/tunnels'],['POST','/api/v1/forwardings'],['POST','/api/v1/local-ai/chat'],['POST','/api/v1/hosts?path=/sftp/12/upload'],['DELETE','/api/v1/sftp/12/write'],['POST','/api/v1/sftp/12/unknown'],['GET','/api/v1/agents/1/install-script']])('denies %s %s', async (method, path) => {
    await expect(assertTrialHttpAccess(2, method, path)).rejects.toMatchObject({ code: 'TRIAL_FEATURE_DISABLED' })
  })
})

describe('trial destinations', () => {
  beforeEach(() => configureTrialPolicy(() => Promise.resolve(active())))
  it('allows only immutable IP owned by trial within lab CIDR', async () => {
    await expect(assertTrialHostAccess(2, host)).resolves.toMatchObject({ status: 'ACTIVE' })
    await expect(assertTrialHostAccess(2, { ...host, ip: '10.90.0.6' })).rejects.toMatchObject({ code: 'TRIAL_DESTINATION_DENIED' })
  })
  it.each([{ ip: '169.254.169.254' }, { ip: 'localhost' }, { ip: '::ffff:10.90.0.5' }, { connectionMode: 'USER_AGENT' }, { bastion: { ip: '10.90.0.5' } }, { accessProtocol: 'TELNET' }, { onePasswordRef: 'op://ref' }, { passwordSecretId: 1 }, { privateAccessConnectorId: 1 }])('rejects bypass %j', async patch => {
    await expect(assertTrialHostAccess(2, { ...host, ...patch })).rejects.toMatchObject({ code: 'TRIAL_DESTINATION_DENIED' })
  })
  it('fails closed on missing host ownership list', async () => {
    configureTrialPolicy(() => Promise.resolve(({ ...active(), profileJson: { resources: ['ssh', 'sftp', 'sharing', 'audit'], networkCidr: '10.90.0.0/24' } })))
    await expect(assertTrialHostAccess(2, host)).rejects.toMatchObject({ code: 'TRIAL_DESTINATION_DENIED' })
  })
  it('validates literal IPv4 and rejects ambiguous networks', () => {
    expect(ipv4InCidr('10.90.0.5','10.90.0.0/24')).toBe(true)
    for (const cidr of ['0.0.0.0/0','10.90.0.0/33','10.90.0.0/24/1','10.90.0.0/NaN']) expect(ipv4InCidr('10.90.0.5',cidr)).toBe(false)
  })
})

describe('live trial sessions', () => {
  it('closes at local deadline while cleanup worker is absent and policy lookup hangs', async () => {
    configureTrialPolicy(() => Promise.resolve(new Promise(() => {})))
    const close = vi.fn(); monitorTrialAccess(2, active(6), close)
    await vi.advanceTimersByTimeAsync(5999); expect(close).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1); expect(close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('closes cancellation without waiting for original deadline', async () => {
    configureTrialPolicy(() => Promise.resolve(({ ...active(), status: 'EXPIRED' })))
    const close = vi.fn(); monitorTrialAccess(2, active(), close)
    await vi.advanceTimersByTimeAsync(5000); expect(close).toHaveBeenCalledOnce()
  })
  it('fails closed if trial disappears or its policy store errors', async () => {
    const close = vi.fn(); monitorTrialAccess(2, active(), close)
    await vi.advanceTimersByTimeAsync(5000); expect(close).toHaveBeenCalledOnce()
    configureTrialPolicy(() => { return Promise.reject(new Error('offline')) })
    monitorTrialAccess(2, active(), close)
    await vi.advanceTimersByTimeAsync(5000); expect(close).toHaveBeenCalledTimes(2)
  })
  it('releases timers on normal connection cleanup and honors newer extension', async () => {
    configureTrialPolicy(() => Promise.resolve(active(90)))
    const close = vi.fn(); const stop = monitorTrialAccess(2, active(10), close)
    await vi.advanceTimersByTimeAsync(10_000); expect(close).not.toHaveBeenCalled()
    stop(); await vi.advanceTimersByTimeAsync(100_000)
    expect(close).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
})


describe('trial participant revocation and optional resources', () => {
  it('rejects inactive or stale-version participants but preserves standard users', async () => {
    const reader = vi.fn().mockResolvedValue(false)
    configureTrialUserReader(reader)
    await expect(assertTrialUserAccess(1, 10, 2)).resolves.toBeNull()
    expect(reader).not.toHaveBeenCalled()
    configureTrialPolicy(() => Promise.resolve(active()))
    await expect(assertTrialUserAccess(2, 10, 2)).rejects.toMatchObject({ code: 'TRIAL_USER_REVOKED' })
    expect(reader).toHaveBeenCalledWith(2, 10, 2)
  })
  it('ends only the revoked participant stream on the next trial poll', async () => {
    configureTrialPolicy(() => Promise.resolve(active()))
    configureTrialUserReader((_tenant, userId) => Promise.resolve(userId !== 10))
    const revoked = vi.fn(), colleague = vi.fn()
    monitorTrialAccess(2, active(), revoked, { id: 10 })
    const stop = monitorTrialAccess(2, active(), colleague, { id: 11 })
    await vi.advanceTimersByTimeAsync(5000)
    expect(revoked).toHaveBeenCalledOnce(); expect(colleague).not.toHaveBeenCalled()
    stop()
  })
  it.each([['sftp','/api/v1/sftp/1/list'],['sharing','/api/v1/shared-sessions'],['audit','/api/v1/session-audit']])('denies optional %s when absent from snapshot', async (resource, path) => {
    configureTrialPolicy(() => Promise.resolve(({ ...active(), profileJson: { resources: ['ssh'] } })))
    await expect(assertTrialResource(2, resource)).rejects.toMatchObject({ code: 'TRIAL_FEATURE_DISABLED' })
    await expect(assertTrialHttpAccess(2, 'GET', path)).rejects.toMatchObject({ code: 'TRIAL_FEATURE_DISABLED' })
  })
})


describe('trial authentication cleanup', () => {
  it('permits logout after trial expiry and admin exit without bypassing resource authorization', async () => {
    configureTrialPolicy(() => Promise.resolve(active(0)))
    const req = { jwtVerify: () => Promise.resolve({ stage: 'authenticated', tenantId: 2, sub: '1', isPlatformAdmin: true }), method: 'POST', url: '/api/v1/auth/platform/exit-tenant' }
    await expect(requireAuth(req as never, {} as never)).resolves.toBeUndefined()
    req.url = '/api/v1/auth/logout'
    await expect(requireAuth(req as never, {} as never)).resolves.toBeUndefined()
    req.url = '/api/v1/hosts'
    await expect(requireAuth(req as never, {} as never)).rejects.toMatchObject({ code: 'TRIAL_EXPIRED' })
  })
})


describe('configured customer host execution', () => {
  beforeEach(() => {
    configureTrialPolicy(() => Promise.resolve({ ...active(), profileJson: { ...(active().profileJson as object), allowCustomHosts: true } }))
    configureTrialProtectedAddresses(['177.153.202.21'])
  })
  it('permits a literal public destination only with the custom capability and protected-address configuration', async () => {
    await expect(assertTrialHostAccess(2, { ...host, ip: '9.9.9.9' })).resolves.toMatchObject({ status: 'ACTIVE' })
    configureTrialProtectedAddresses([])
    await expect(assertTrialHostAccess(2, { ...host, ip: '9.9.9.9' })).rejects.toMatchObject({ code: 'TRIAL_DESTINATION_DENIED' })
    configureTrialProtectedAddresses(['invalid'])
    await expect(assertTrialHostAccess(2, { ...host, ip: '9.9.9.9' })).rejects.toMatchObject({ code: 'TRIAL_DESTINATION_DENIED' })
  })
  it.each(['177.153.202.21', '127.0.0.1', '169.254.169.254', '10.90.0.6', 'example.com', '::ffff:127.0.0.1'])('denies control-plane, metadata, other lab or nonliteral target %s', async ip => {
    await expect(assertTrialHostAccess(2, { ...host, ip })).rejects.toMatchObject({ code: 'TRIAL_DESTINATION_DENIED' })
  })
  it('does not treat truthy malformed metadata as permission', async () => {
    configureTrialPolicy(() => Promise.resolve({ ...active(), profileJson: { ...(active().profileJson as object), allowCustomHosts: 'true' } }))
    await expect(assertTrialHostAccess(2, { ...host, ip: '9.9.9.9' })).rejects.toMatchObject({ code: 'TRIAL_DESTINATION_DENIED' })
  })
  it('permits only the dedicated host mutations and existing owner-checked trust flow', async () => {
    for (const [method,path] of [['POST','/api/v1/trials/me/hosts'],['PUT','/api/v1/trials/me/hosts/12'],['DELETE','/api/v1/trials/me/hosts/12'],['POST','/api/v1/hosts/12/trust-host-key']]) {
      await expect(assertTrialHttpAccess(2, method!, path!)).resolves.toBeUndefined()
    }
    await expect(assertTrialHttpAccess(2, 'POST', '/api/v1/hosts/test-connection')).rejects.toMatchObject({ code: 'TRIAL_FEATURE_DISABLED' })
  })
})
