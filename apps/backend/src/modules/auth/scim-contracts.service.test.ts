import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { ScimService } from './scim.service.js'
import { LicenseLimitError } from '../../shared/errors.js'
const deps = vi.hoisted(() => ({ trial: vi.fn(), trialSlot: vi.fn(), slot: vi.fn() }))
vi.mock('../trials/trial-outbound.js', () => ({ assertTrialIntegration: deps.trial }))
vi.mock('../trials/trial-user-quota.js', () => ({ assertTrialUserSlot: deps.trialSlot }))
vi.mock('../../shared/user-quota.js', () => ({ withUserSlot: deps.slot }))
function setup() {
  const user = { id: 12, email: 'fixture@example.test', name: 'Fixture', active: true }
  const identity = { id: 'u1', tenantId: 7, userId: 12, externalId: null, createdAt: new Date(0), updatedAt: new Date(0), user }
  const group = { id: 'g1', tenantId: 7, groupId: 18, externalId: null, createdAt: new Date(0), updatedAt: new Date(0), group: { name: 'Fixture', users: [{ user: { scimIdentity: { id: 'u1' } } }, { user: { scimIdentity: null } }] } }
  const db = {
    scimConfig: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({ enabled: false, tokenHash: null, tokenPrefix: null, rotatedAt: null }) },
    scimUser: { findFirst: vi.fn().mockResolvedValue(identity), findMany: vi.fn().mockResolvedValue([identity]), create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...identity, ...data })), update: vi.fn().mockResolvedValue(identity) },
    user: { findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(1), create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...user, ...data })), update: vi.fn().mockResolvedValue(user) },
    license: { findUnique: vi.fn().mockResolvedValue({ maxUsers: 3 }) },
    scimGroup: { findFirst: vi.fn().mockResolvedValue(group), findMany: vi.fn().mockResolvedValue([group]), create: vi.fn().mockResolvedValue(group), update: vi.fn().mockResolvedValue(group) },
    group: { create: vi.fn().mockResolvedValue({ id: 18, name: 'Fixture' }), update: vi.fn().mockResolvedValue({}) },
    userGroup: { deleteMany: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({}) },
    scimAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(),
  }
  db.$transaction.mockImplementation((callback: (tx: typeof db) => unknown) => Promise.resolve(callback(db)))
  deps.slot.mockImplementation((_db: unknown, _tenant: number, callback: (tx: typeof db) => unknown) => Promise.resolve(callback(db)))
  const entitlements = { requireIntegrationProvider: vi.fn().mockResolvedValue(undefined) }
  return { db, user, identity, group, entitlements, service: new ScimService(db as never, entitlements as never) }
}
beforeEach(() => { vi.clearAllMocks(); deps.trial.mockResolvedValue(null); deps.trialSlot.mockResolvedValue(undefined) })
describe('SCIM configuration and credential contracts', () => {
  it('returns absent defaults without credential material', async () => {
    const s = setup(); expect(await s.service.getAdminConfig(7)).toEqual({ enabled: false, tokenConfigured: false, tokenPrefix: null, rotatedAt: null })
    s.db.scimConfig.findUnique.mockResolvedValue({ enabled: true, tokenHash: 'private-hash', tokenPrefix: 'prefix', rotatedAt: new Date(0) })
    expect(await s.service.getAdminConfig(7)).toEqual({ enabled: true, tokenConfigured: true, tokenPrefix: 'prefix', rotatedAt: new Date(0) })
  })
  it('rotates unpredictable credentials, stores only SHA256 and disables access', async () => {
    const s = setup(), one = await s.service.rotateToken(7), two = await s.service.rotateToken(7)
    expect(one.token).toMatch(/^na_scim_[A-Za-z0-9_-]{43}$/); expect(one.token).not.toBe(two.token)
    const call = s.db.scimConfig.upsert.mock.calls[0]![0] as { where: unknown; create: unknown; update: unknown }
    expect(call.where).toEqual({ tenantId: 7 }); expect(call.create).toMatchObject({ enabled: false, tokenHash: createHash('sha256').update(one.token).digest('hex'), tokenPrefix: one.token.slice(0, 14) })
    expect(JSON.stringify(call)).not.toContain(one.token); expect(call.update).not.toHaveProperty('token')
  })
  it('requires token to enable but permits disabling unconfigured tenant', async () => {
    const s = setup(); await expect(s.service.setEnabled(7, true)).rejects.toMatchObject({ status: 409 }); expect(s.db.scimConfig.upsert).not.toHaveBeenCalled()
    await expect(s.service.setEnabled(7, false)).resolves.toMatchObject({ enabled: false })
    s.db.scimConfig.findUnique.mockResolvedValue({ tokenHash: 'hash' }); s.db.scimConfig.upsert.mockResolvedValue({ enabled: true, tokenHash: 'hash', tokenPrefix: 'prefix', rotatedAt: null })
    expect(await s.service.setEnabled(7, true)).toMatchObject({ enabled: true, tokenConfigured: true })
  })
  it('authenticates exact hash before license and trial validation', async () => {
    const s = setup(), token = 'fixture-token', hash = createHash('sha256').update(token).digest('hex')
    s.db.scimConfig.findFirst.mockResolvedValue({ tenantId: 7, tokenHash: hash })
    expect(await s.service.authenticate('Bearer ' + token)).toBe(7); expect(deps.trial).toHaveBeenCalledWith(7, 'scim'); expect(s.entitlements.requireIntegrationProvider).toHaveBeenCalledWith(7, 'scim', expect.any(String))
    deps.trial.mockRejectedValueOnce(new Error('trial denied')); await expect(s.service.authenticate('Bearer ' + token)).rejects.toThrow('trial denied')
    s.entitlements.requireIntegrationProvider.mockRejectedValueOnce(new Error('license denied')); await expect(s.service.authenticate('Bearer ' + token)).rejects.toThrow('license denied')
  })
  it.each(['wrong', '0'.repeat(64), null])('rejects inconsistent stored hash %s', async tokenHash => { const s = setup(); s.db.scimConfig.findFirst.mockResolvedValue({ tenantId: 7, tokenHash }); await expect(s.service.authenticate('Bearer fixture')).rejects.toMatchObject({ status: 401 }); expect(deps.trial).not.toHaveBeenCalled() })
})
describe('SCIM user lifecycle contracts', () => {
  it('lists scoped normalized filter and serializes resources without internal identity', async () => {
    const s = setup(), result = await s.service.listUsers(7, 'userName eq "FIXTURE@EXAMPLE.TEST"')
    expect(s.db.scimUser.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 7, user: { email: 'fixture@example.test' } }, take: 200 }))
    expect(result).toMatchObject({ totalResults: 1, startIndex: 1, itemsPerPage: 1, Resources: [{ id: 'u1', userName: s.user.email, emails: [{ value: s.user.email, primary: true }] }] }); expect(result.Resources[0]).not.toHaveProperty('userId')
    await s.service.listUsers(7); expect((s.db.scimUser.findMany.mock.calls.at(-1)![0] as { where: unknown }).where).toEqual({ tenantId: 7 })
  })
  it.each(['getUser', 'replaceUser', 'patchUser'] as const)('fails scoped %s on missing mapping', async method => {
    const s = setup(); s.db.scimUser.findFirst.mockResolvedValue(null)
    const promise = method === 'getUser' ? s.service.getUser(7, 'foreign') : method === 'replaceUser' ? s.service.replaceUser(7, 'foreign', { userName: s.user.email }) : s.service.patchUser(7, 'foreign', [])
    await expect(promise).rejects.toMatchObject({ status: 404 }); expect(s.db.scimUser.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'foreign', tenantId: 7 } })); expect(s.db.user.update).not.toHaveBeenCalled()
  })
  it.each([
    [{ userName: ' FIXTURE@EXAMPLE.TEST ', displayName: ' Explicit ', password: 'must-ignore' }, 'Explicit'],
    [{ emails: [{ value: 'first@example.test' }, { value: 'fixture@example.test', primary: true }], name: { formatted: ' Formatted ' } }, 'Formatted'],
    [{ emails: [{ value: 'fixture@example.test' }], name: { givenName: 'Given', familyName: 'Family' }, active: false }, 'Given Family'],
    [{ userName: 'fixture@example.test' }, 'fixture@example.test'],
  ] as const)('creates least privilege identity with name fallback %j', async (input, name) => {
    const s = setup(); deps.trial.mockResolvedValue({ id: 1 })
    const result = await s.service.createUser(7, { ...input, emails: 'emails' in input ? [...input.emails] : undefined })
    expect(result.displayName).toBe(name); expect(result.userName).toBe('fixture@example.test'); expect(result.id).toMatch(/^[\da-f-]{36}$/)
    expect(deps.trialSlot).toHaveBeenCalledWith(s.db, 7); expect(s.db.$queryRaw.mock.calls[0]!.slice(1)).toEqual([7])
    const data = (s.db.user.create.mock.calls[0]![0] as { data: Record<string, unknown> }).data
    expect(data).toMatchObject({ tenantId: 7, role: 'USER', canManageHosts: false, canViewLiveSessions: false }); expect(data).not.toHaveProperty('password'); expect(data.licenseConsumed).toBe(!('active' in input) || input.active !== false)
    expect(s.db.scimAuditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: 7, action: 'CREATE', resourceType: 'User' }) as unknown }))
  })
  it.each(['manual', 'scim', 'no-license', 'full', 'trial'])('rejects provisioning %s without creating a user', async reason => {
    const s = setup()
    if (reason === 'manual') s.db.user.findFirst.mockResolvedValue({ scimIdentity: null })
    if (reason === 'scim') s.db.user.findFirst.mockResolvedValue({ scimIdentity: { id: 'u1' } })
    if (reason === 'no-license') s.db.license.findUnique.mockResolvedValue(null)
    if (reason === 'full') s.db.user.count.mockResolvedValue(3)
    if (reason === 'trial') { deps.trial.mockResolvedValue({ id: 1 }); deps.trialSlot.mockRejectedValue(new Error('trial quota')) }
    await expect(s.service.createUser(7, { userName: s.user.email })).rejects.toThrow(); expect(s.db.user.create).not.toHaveBeenCalled(); expect(s.db.scimAuditEvent.create).not.toHaveBeenCalled()
  })
  it('replaces inactive identity through quota callback and increments session version', async () => {
    const s = setup(); s.user.active = false
    await s.service.replaceUser(7, 'u1', { userName: s.user.email, active: true, externalId: 'external' })
    expect(deps.slot).toHaveBeenCalledWith(s.db, 7, expect.any(Function), 12); expect(s.db.user.update).toHaveBeenCalledWith({ where: { id: 12 }, data: expect.objectContaining({ active: true, sessionVersion: { increment: 1 } }) as unknown }); expect(s.db.scimUser.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { externalId: 'external' } })
  })
  it('preserves version for unchanged active state and maps quota errors only', async () => {
    const s = setup(); await s.service.replaceUser(7, 'u1', { userName: s.user.email }); expect((s.db.user.update.mock.calls[0]![0] as { data: unknown }).data).not.toHaveProperty('sessionVersion')
    deps.slot.mockRejectedValueOnce(new LicenseLimitError()); await expect(s.service.replaceUser(7, 'u1', { userName: s.user.email })).rejects.toMatchObject({ status: 409 })
    deps.slot.mockRejectedValueOnce(new Error('db offline')); await expect(s.service.replaceUser(7, 'u1', { userName: s.user.email })).rejects.toThrow('db offline')
  })
  it('patches object active, ignores unsupported operations and does not write unchanged state', async () => {
    const s = setup(); await s.service.patchUser(7, 'u1', [{ op: 'replace', value: { active: false } }]); expect(s.db.user.update).toHaveBeenCalledWith({ where: { id: 12 }, data: { active: false, licenseConsumed: false, sessionVersion: { increment: 1 } } })
    s.db.user.update.mockClear(); await s.service.patchUser(7, 'u1', [{ op: 'add', path: 'name', value: 'ignored' }, {}]); expect(s.db.user.update).not.toHaveBeenCalled()
  })
})
describe('SCIM group membership contracts', () => {
  it('lists tenant-only SCIM memberships and omits users without mapping', async () => {
    const s = setup(); const result = await s.service.listGroups(7); expect(result.Resources).toMatchObject([{ members: [{ value: 'u1' }] }]); expect(s.db.scimGroup.findMany.mock.calls[0]![0]).toMatchObject({ where: { tenantId: 7 }, take: 200, include: { group: { include: { users: { where: { source: 'SCIM' } } } } } })
  })
  it.each(['getGroup', 'replaceGroup', 'patchGroup'] as const)('rejects missing scoped %s', async method => { const s = setup(); s.db.scimGroup.findFirst.mockResolvedValue(null); const promise = method === 'getGroup' ? s.service.getGroup(7, 'foreign') : method === 'replaceGroup' ? s.service.replaceGroup(7, 'foreign', { displayName: 'Name' }) : s.service.patchGroup(7, 'foreign', []); await expect(promise).rejects.toMatchObject({ status: 404 }); expect(s.db.group.update).not.toHaveBeenCalled() })
  it('creates group and scoped membership without overwriting manually managed links', async () => {
    const s = setup(); s.db.userGroup.findUnique.mockResolvedValue({ source: 'MANUAL' })
    await s.service.createGroup(7, { displayName: ' Fixture ', members: [{ value: 'u1' }, { value: 'u1' }, {}] })
    expect(s.db.group.create).toHaveBeenCalledWith({ data: { tenantId: 7, name: 'Fixture', description: 'Gerenciado via SCIM' } }); expect(s.db.scimUser.findMany).toHaveBeenCalledWith({ where: { tenantId: 7, id: { in: ['u1'] } }, select: { userId: true } })
    expect(s.db.userGroup.deleteMany).toHaveBeenCalledWith({ where: { groupId: 18, source: 'SCIM' } }); expect(s.db.userGroup.create).not.toHaveBeenCalled()
  })
  it('replaces only SCIM memberships and creates missing links', async () => {
    const s = setup(); await s.service.replaceGroup(7, 'g1', { displayName: 'New', externalId: 'ext', members: [{ value: 'u1' }] }); expect(s.db.userGroup.create).toHaveBeenCalledWith({ data: { userId: 12, groupId: 18, source: 'SCIM' } }); expect(s.db.group.update).toHaveBeenCalledWith({ where: { id: 18 }, data: { name: 'New' } })
    s.db.scimUser.findMany.mockClear(); await s.service.replaceGroup(7, 'g1', { displayName: 'Empty' }); expect(s.db.scimUser.findMany).not.toHaveBeenCalled()
  })
  it('rejects foreign member before deleting any memberships', async () => {
    const s = setup(); s.db.scimUser.findMany.mockResolvedValue([]); await expect(s.service.replaceGroup(7, 'g1', { displayName: 'Name', members: [{ value: 'foreign' }] })).rejects.toMatchObject({ status: 400, scimType: 'invalidValue' }); expect(s.db.userGroup.deleteMany).not.toHaveBeenCalled()
  })
  it.each(['createGroup', 'replaceGroup'] as const)('requires group name for %s', async method => { const s = setup(); await expect(method === 'createGroup' ? s.service.createGroup(7, { displayName: ' ' }) : s.service.replaceGroup(7, 'g1', {})).rejects.toMatchObject({ status: 400 }); expect(s.db.group.create).not.toHaveBeenCalled(); expect(s.db.group.update).not.toHaveBeenCalled() })
  it('patches display name, deduplicates add and honors filtered remove', async () => {
    const s = setup(); await s.service.patchGroup(7, 'g1', [{ op: 'replace', path: 'displayName', value: ' Renamed ' }, { op: 'add', path: 'members', value: [{ value: 'u1' }, { value: 'u2' }, null, {}] }, { op: 'remove', path: 'members[value eq "u1"]' }]); expect(s.db.scimUser.findMany).toHaveBeenCalledWith({ where: { tenantId: 7, id: { in: ['u2'] } }, select: { userId: true } }); expect(s.db.group.update).toHaveBeenCalledWith({ where: { id: 18 }, data: { name: 'Renamed' } })
  })
  it('supports replacing and clearing members without widening tenant scope', async () => {
    const s = setup(); await s.service.patchGroup(7, 'g1', [{ op: 'replace', value: [{ value: 'u2' }] }]); expect((s.db.scimUser.findMany.mock.calls[0]![0] as { where: unknown }).where).toEqual({ tenantId: 7, id: { in: ['u2'] } }); s.db.scimUser.findMany.mockClear()
    await s.service.patchGroup(7, 'g1', [{ op: 'remove', path: 'members' }, { op: 'add', path: 'members', value: 'invalid' }]); expect(s.db.scimUser.findMany).not.toHaveBeenCalled()
  })
})
