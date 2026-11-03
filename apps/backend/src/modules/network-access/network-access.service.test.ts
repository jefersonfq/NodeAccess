import { describe, it, expect, vi } from 'vitest'
import { Prisma, type PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import { encrypt, decrypt } from '../../shared/crypto.js'
import { NetworkAccessService, DeviceSchema, CredentialSchema } from './network-access.service.js'

const device = { id: 3, tenantId: 7, hostId: 11, secret: 'synthetic-device-secret-32-characters' }
function fixture() {
  const db = {
    $queryRaw: vi.fn().mockResolvedValue([]), $executeRaw: vi.fn().mockResolvedValue(1),
    host: { findFirst: vi.fn().mockResolvedValue({ accessProtocol: 'SSH' }) },
    user: { findFirst: vi.fn().mockResolvedValue({ id: 5 }) },
    adminLog: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(),
  }
  db.$transaction.mockImplementation((fn: (tx: typeof db) => unknown) => fn(db))
  const ssh = { hasEffectiveHostPermission: vi.fn().mockResolvedValue(true) }
  const health = { read: vi.fn().mockResolvedValue({ status: 'healthy', instances: ['fixture'] }) }
  const service = new NetworkAccessService(db as unknown as PrismaClient, ssh as never, health)
  return { db, ssh, health, service }
}
function sql(call: unknown[]) { return call[0] as Prisma.Sql }

describe('network access settings and health', () => {
  it('uses safe defaults and does not poll disabled health', async () => {
    const s = fixture()
    expect(await s.service.settings(7)).toEqual({ defaultProfile: 'server_ssh', tacacsEnabled: false })
    expect(sql(s.db.$queryRaw.mock.calls[0]!).values).toEqual([7])
    expect(await s.service.health(7)).toEqual({ status: 'disabled', instances: [] })
    expect(s.health.read).not.toHaveBeenCalled()
  })
  it('reports observed, unavailable and missing health independently', async () => {
    const s = fixture(); s.db.$queryRaw.mockResolvedValue([{ defaultProfile: 'network_generic', tacacsEnabled: 1 }])
    expect(await s.service.health(7)).toEqual({ status: 'healthy', instances: ['fixture'] })
    expect(s.health.read).toHaveBeenCalledWith(7)
    s.health.read.mockRejectedValue(new Error('store unavailable'))
    expect(await s.service.health(7)).toEqual({ status: 'unavailable', instances: [] })
    const noStore = new NetworkAccessService(s.db as unknown as PrismaClient, s.ssh as never)
    expect(await noStore.health(7)).toEqual({ status: 'unobserved', instances: [] })
  })
  it('maps scoped overview without exposing secret/hash columns', async () => {
    const s = fixture()
    s.db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([{ userId: 5 }]).mockResolvedValueOnce([{ userId: 5, hostId: 11, commands: '[["show","version"]]' }]).mockResolvedValueOnce([{ id: '9' }])
    expect(await s.service.overview(7)).toMatchObject({ devices: [{ id: 1 }], credentials: [{ userId: 5 }], grants: [{ commands: [['show', 'version']] }], events: [{ id: '9' }] })
    for (const call of s.db.$queryRaw.mock.calls) {
      expect(sql(call).values).toEqual([7]); expect(sql(call).sql).not.toMatch(/secret_cipher|password_hash/)
    }
  })
  it('validates before transaction and audits settings before returning', async () => {
    const s = fixture()
    await expect(s.service.saveSettings(7, 2, { defaultProfile: 'invalid', tacacsEnabled: true })).rejects.toThrow()
    expect(s.db.$transaction).not.toHaveBeenCalled()
    const dto = { defaultProfile: 'network_generic', tacacsEnabled: true }
    expect(await s.service.saveSettings(7, 2, dto)).toEqual(dto)
    expect(sql(s.db.$queryRaw.mock.calls[0]!).sql).toContain('FOR UPDATE')
    expect(s.db.adminLog.create).toHaveBeenCalledWith({ data: { adminId: 2, action: 'NETWORK_SETTINGS_UPDATED', targetType: 'network_access', targetId: 7, details: JSON.stringify({ tenantId: 7, before: [], after: dto }) } })
    s.db.adminLog.create.mockRejectedValue(new Error('audit unavailable'))
    await expect(s.service.saveSettings(7, 2, dto)).rejects.toThrow('audit unavailable')
  })
})

describe('network access provision contracts', () => {
  it('normalizes IPv6 and rejects mapped addresses and oversize UTF8 passwords', () => {
    const dto = { hostId: 11, sourceIp: '2001:db8:0:0::1', secret: device.secret, enabled: true }
    expect(DeviceSchema.parse(dto).sourceIp).toBe('2001:db8::1')
    for (const sourceIp of ['::ffff:192.0.2.1', 'fe80::1%eth0', 'host.test']) expect(DeviceSchema.safeParse({ ...dto, sourceIp }).success).toBe(false)
    expect(CredentialSchema.safeParse({ userId: 5, username: 'alice', password: 'é'.repeat(40), enabled: true }).success).toBe(false)
  })
  it('encrypts device secrets and scopes host and ownership checks', async () => {
    const s = fixture(); s.db.$queryRaw.mockResolvedValue([{ id: 3 }])
    await s.service.saveDevice(7, 2, { hostId: 11, sourceIp: '192.0.2.1', secret: device.secret, enabled: true })
    expect(s.db.host.findFirst).toHaveBeenCalledWith({ where: { id: 11, tenantId: 7, deletedAt: null } })
    const values = sql(s.db.$executeRaw.mock.calls[0]!).values
    expect(decrypt(JSON.parse(values[3] as string) as Parameters<typeof decrypt>[0])).toBe(device.secret)
    expect(JSON.stringify(s.db.adminLog.create.mock.calls)).not.toContain(device.secret)
    expect(sql(s.db.$queryRaw.mock.calls[0]!).values).toEqual([7, 11, '192.0.2.1'])
  })
  it.each([null, { accessProtocol: 'RDP' }])('rejects absent/non-SSH host %s before write', async host => {
    const s = fixture(); s.db.host.findFirst.mockResolvedValue(host)
    await expect(s.service.saveDevice(7, 2, { hostId: 11, sourceIp: '192.0.2.1', secret: device.secret, enabled: true })).rejects.toThrow('host SSH')
    expect(s.db.$executeRaw).not.toHaveBeenCalled()
  })
  it('rejects an IP collision without a success audit', async () => {
    const s = fixture()
    await expect(s.service.saveDevice(7, 2, { hostId: 11, sourceIp: '192.0.2.1', secret: device.secret, enabled: true })).rejects.toThrow('já reservado')
    expect(s.db.adminLog.create).not.toHaveBeenCalled()
  })
  it.each([false, true])('hashes credentials for insert/update existing=%s', async existing => {
    const s = fixture(), password = 'synthetic-password-123'
    s.db.$queryRaw.mockResolvedValueOnce([{ userId: 5 }]).mockResolvedValueOnce(existing ? [{ userId: 5 }] : [])
    await s.service.saveCredential(7, 2, { userId: 5, username: 'alice', password, enabled: true })
    const query = sql(s.db.$executeRaw.mock.calls[0]!)
    expect(query.sql).toContain(existing ? 'UPDATE network_tacacs_credentials' : 'INSERT INTO network_tacacs_credentials')
    const hash = query.values.find(v => typeof v === 'string' && v.startsWith('$2')) as string
    expect(await bcrypt.compare(password, hash)).toBe(true)
    expect(query.values).not.toContain(password)
    expect(JSON.stringify(s.db.adminLog.create.mock.calls)).not.toContain(password)
    expect(s.db.user.findFirst).toHaveBeenCalledWith({ where: { id: 5, tenantId: 7, active: true, deletedAt: null } })
  })
  it.each(['missing', 'collision'])('rejects credential identity %s', async mode => {
    const s = fixture()
    if (mode === 'missing') s.db.user.findFirst.mockResolvedValue(null)
    else s.db.$queryRaw.mockResolvedValue([{ userId: 99 }])
    await expect(s.service.saveCredential(7, 2, { userId: 5, username: 'alice', password: 'synthetic-password-123', enabled: true })).rejects.toThrow()
    expect(s.db.$executeRaw).not.toHaveBeenCalled(); expect(s.db.adminLog.create).not.toHaveBeenCalled()
  })
  it('stores exact policy and hashes it in audit without raw commands', async () => {
    const s = fixture(), commands = [['show', 'version']]
    await s.service.saveGrant(7, 2, { userId: 5, hostId: 11, commands })
    expect(sql(s.db.$executeRaw.mock.calls[0]!).values).toEqual([7, 5, 11, JSON.stringify(commands)])
    const logged = s.db.adminLog.create.mock.calls[0]![0] as { data: { details: string } }
    const details = JSON.parse(logged.data.details) as Record<string, unknown>
    expect(details).toMatchObject({ tenantId: 7, userId: 5, commandCount: 1 })
    expect(details.policyHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(details)).not.toContain('version')
  })
  it.each(['host', 'user'] as const)('rejects grant outside scope: %s', async kind => {
    const s = fixture(); s.db[kind].findFirst.mockResolvedValue(null)
    await expect(s.service.saveGrant(7, 2, { userId: 5, hostId: 11, commands: [] })).rejects.toThrow('pertencer')
    expect(s.db.$executeRaw).not.toHaveBeenCalled()
  })
  it.each(['devices', 'credentials', 'grants'] as const)('removes %s with tenant and identity', async kind => {
    const s = fixture(); await s.service.remove(7, 2, kind, 11, 5)
    expect(sql(s.db.$executeRaw.mock.calls[0]!).values).toEqual(kind === 'grants' ? [7, 11, 5] : [7, 11])
    const logged = s.db.adminLog.create.mock.calls[0]![0] as { data: { action: string } }
    expect(logged.data.action).toBe('NETWORK_REMOVED')
  })
  it('requires user for removing grants before starting transaction', async () => {
    const s = fixture(); await expect(s.service.remove(7, 2, 'grants', 11)).rejects.toThrow('usuário')
    expect(s.db.$transaction).not.toHaveBeenCalled()
  })
})

describe('network access identity and event contracts', () => {
  it('resolves active device secret and handles missing devices', async () => {
    const s = fixture(); expect(await s.service.device('192.0.2.1')).toBeNull()
    s.db.$queryRaw.mockResolvedValue([{ ...device, secretCipher: JSON.stringify(encrypt(device.secret)) }])
    expect(await s.service.device('192.0.2.1')).toEqual(device)
    const query = sql(s.db.$queryRaw.mock.calls[1]!); expect(query.values).toEqual(['192.0.2.1'])
    expect(query.sql).toContain('h.tenant_id=d.tenant_id'); expect(query.sql).toContain('t.active=TRUE')
  })
  it('authenticates with real bcrypt and records permit/deny', async () => {
    const s = fixture(), hash = await bcrypt.hash('synthetic-password-123', 4)
    s.db.$queryRaw.mockResolvedValue([{ userId: 5, role: 'USER', hash }])
    expect(await s.service.authenticate(device, 'alice', 'synthetic-password-123')).toBe(true)
    expect(await s.service.authenticate(device, 'alice', 'wrong')).toBe(false)
    expect(s.ssh.hasEffectiveHostPermission).toHaveBeenCalledWith(11, 7, 5, 'connect', 'USER')
    expect(sql(s.db.$executeRaw.mock.calls[0]!).values).toContain('permit')
    expect(sql(s.db.$executeRaw.mock.calls[1]!).values).toContain('deny')
  })
  it.each([false, true])('denies missing or unauthorized identity hasIdentity=%s', async hasIdentity => {
    const s = fixture(); s.db.$queryRaw.mockResolvedValue(hasIdentity ? [{ userId: 5, role: 'USER', hash: 'invalid' }] : []); s.ssh.hasEffectiveHostPermission.mockResolvedValue(false)
    expect(await s.service.authenticate(device, 'alice', 'wrong')).toBe(false)
    expect(await s.service.authorize(device, 'alice', ['service=shell', 'cmd=show'])).toBe(false)
    expect(s.db.$queryRaw).toHaveBeenCalledTimes(2)
  })
  it.each([true, false])('authorizes exact grants and denies absent policy present=%s', async present => {
    const s = fixture(); s.db.$queryRaw.mockResolvedValueOnce([{ userId: 5, role: 'USER' }]).mockResolvedValueOnce(present ? [{ commands: '[["show","version"]]' }] : [])
    expect(await s.service.authorize(device, 'alice', ['service=shell', 'cmd=show', 'cmd-arg=version'])).toBe(present)
    expect(sql(s.db.$queryRaw.mock.calls[1]!).values).toEqual([7, 5, 11])
  })
  it('redacts credential commands, bounds usernames and propagates event failure', async () => {
    const s = fixture(); await s.service.event(device, 'a'.repeat(100), 'accounting', 'start', ['cmd=password', 'cmd-arg=synthetic'])
    const values = sql(s.db.$executeRaw.mock.calls[0]!).values
    expect(values[2]).toBe('a'.repeat(64)); expect(JSON.parse(values[5] as string)).toEqual({ hostId: 11, arguments: ['[comando com credencial omitido]'] })
    s.db.$executeRaw.mockRejectedValue(new Error('event unavailable'))
    await expect(s.service.authenticate(device, 'alice', 'wrong')).rejects.toThrow('event unavailable')
  })
})
