import { describe, it, expect, vi, afterEach } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import { decrypt, type EncryptedPayload } from '../../shared/crypto.js'
import { TrialService, tokenHash } from './trial.service.js'
import type { TrialProfile, TrialLab } from './trial-contract.js'

const profile: TrialProfile = {
  name: 'Laboratório Linux', resources: ['ssh', 'sftp', 'sharing'], durationDays: 7, expiryNoticeHours: 6, maxUsers: 2, maxHosts: 2, machineCount: 1, maxSessions: 2,
  templateId: 'linux-v1', networkCidr: '10.64.0.0/24', maxActiveTrials: 2, retentionDays: 30,
  privacyUrl: 'https://example.com/privacy', termsUrl: 'https://example.com/terms', privacyVersion: '2026-10',
}
const id = 'a1234567-1234-4234-8234-123456789abc'
const control = 'ab'.repeat(32)
const verification = 'cd'.repeat(32)
const host = { name: 'Linux', ip: '10.64.0.10', port: 22, sshUser: 'demo', password: 'exclusive-disposable-password', fingerprint: `SHA256:${'a'.repeat(43)}` }

// Model query conditions rather than returning success for every mutation. This
// exercises status CAS transitions and includes transactional rollback/serialization.
type Row = Record<string, unknown>
type ModelName = 'trialRegistration' | 'trialProfile' | 'trialParticipant' | 'trialConsentEvent' | 'user' | 'tenant' | 'license' | 'host' | 'pemKey' | 'bastionHost'
type Store = Record<ModelName, Row[]>
interface Query { where?: Row; select?: Row; include?: Row; take?: number; orderBy?: Record<string, 'asc' | 'desc'> }
interface Mutation extends Query { data: Row }
function isRow(value: unknown): value is Row {
  return !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
}
function comparable(value: unknown): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  return Number.NaN
}
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === 'OR' || key === 'AND') {
      if (!Array.isArray(condition)) throw new Error('INVALID_QUERY_LOGICAL')
      const parts: unknown[] = condition
      const match = (part: unknown): boolean => isRow(part) && matches(row, part)
      return key === 'OR' ? parts.some(match) : parts.every(match)
    }
    if (key === 'trialId_email') return isRow(condition) && matches(row, condition)
    const actual = row[key]
    if (isRow(condition)) {
      if ('every' in condition || 'none' in condition || 'some' in condition) {
        if (!Array.isArray(actual)) return false
        const values: unknown[] = actual
        for (const relation of ['every', 'none', 'some']) if (relation in condition) {
          const predicate = condition[relation]
          if (!isRow(predicate)) return false
          const check = (value: unknown): boolean => isRow(value) && matches(value, predicate)
          if (relation === 'every' && !values.every(check)) return false
          if (relation === 'none' && values.some(check)) return false
          if (relation === 'some' && !values.some(check)) return false
        }
        return true
      }
      if (Object.keys(condition).some(field => !['in', 'notIn', 'not', 'gt', 'lt', 'lte'].includes(field))) return isRow(actual) && matches(actual, condition)
      if ('in' in condition && (!Array.isArray(condition.in) || !(condition.in as unknown[]).includes(actual))) return false
      if ('notIn' in condition && (!Array.isArray(condition.notIn) || (condition.notIn as unknown[]).includes(actual))) return false
      if ('not' in condition && actual === condition.not) return false
      if ('gt' in condition && !(comparable(actual) > comparable(condition.gt))) return false
      if ('lt' in condition && !(comparable(actual) < comparable(condition.lt))) return false
      if ('lte' in condition && !(comparable(actual) <= comparable(condition.lte))) return false
      return true
    }
    return actual === condition
  })
}
function model(name: ModelName, store: Store) {
  const accepts = (row: Row, where?: Row): boolean => matches(name === 'pemKey' ? {
    ...row,
    createdBy: store.user.find(user => user.id === row.createdById),
    hosts: store.host.filter(host => host.pemKeyId === row.id),
    bastionHosts: store.bastionHost.filter(bastion => bastion.systemPemKeyId === row.id),
  } : row, where)

  const project = (row: Row | undefined, select?: Row): Row | null => row ? structuredClone(select ? Object.fromEntries(Object.keys(select).filter(key => select[key]).map(key => [key, row[key]])) : row) : null
  const update = (row: Row, patch: Row): Row => {
    for (const [key, value] of Object.entries(patch)) {
      row[key] = isRow(value) && typeof value.increment === 'number' ? (typeof row[key] === 'number' ? row[key] : 0) + value.increment : value
    }
    row.updatedAt = new Date()
    return structuredClone(row)
  }
  const create = ({ data: patch }: Mutation): Promise<Row> => {
    const row: Row = { id: store[name].length + 1, createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
      ...(name === 'user' ? { active: true } : {}),
      ...(name === 'trialParticipant' ? { verifiedAt: null, activatedAt: null, cancelledAt: null, managementHash: null, marketingConsent: false, researchConsent: false } : {}),
      ...(name === 'trialRegistration' ? { status: 'PENDING_EMAIL', tenantId: null, verifiedAt: null, activatedAt: null, expiresAt: null, closedAt: null, lastError: null, managementHash: null } : {}), ...patch }
    store[name].push(row)
    return Promise.resolve(structuredClone(row))
  }
  return {
    findUnique: vi.fn(({ where, select, include }: Query) => {
      const row = project(store[name].find(row => accepts(row, where)), select)
      return Promise.resolve(row && include?.trial ? { ...row, trial: structuredClone(store.trialRegistration.find(trial => trial.id === row.trialId)) } : row)
    }),
    findUniqueOrThrow: vi.fn(({ where }: Query) => {
      const row = store[name].find(row => accepts(row, where))
      return row ? Promise.resolve(structuredClone(row)) : Promise.reject(new Error('NOT_FOUND'))
    }),
    findFirst: vi.fn(({ where, select }: Query) => Promise.resolve(project(store[name].find(row => accepts(row, where)), select))),
    findMany: vi.fn(({ where, select, take, orderBy }: Query = {}) => {
      const rows = store[name].filter(row => accepts(row, where))
      if (orderBy) for (const [key, order] of Object.entries(orderBy)) rows.sort((left, right) => (comparable(left[key]) - comparable(right[key])) * (order === 'asc' ? 1 : -1))
      return Promise.resolve(rows.slice(0, take).map(row => project(row, select)))
    }),
    count: vi.fn(({ where }: Query) => Promise.resolve(store[name].filter(row => accepts(row, where)).length)),
    create: vi.fn(create),
    update: vi.fn(({ where, data: patch }: Mutation) => {
      const row = store[name].find(row => accepts(row, where))
      return row ? Promise.resolve(update(row, patch)) : Promise.reject(new Error('NOT_FOUND'))
    }),
    updateMany: vi.fn(({ where, data: patch }: Mutation) => {
      const rows = store[name].filter(row => accepts(row, where))
      rows.forEach(row => update(row, patch))
      return Promise.resolve({ count: rows.length })
    }),
    deleteMany: vi.fn(({ where }: Query) => {
      const previous = store[name].length
      store[name] = store[name].filter(row => !accepts(row, where))
      return Promise.resolve({ count: previous - store[name].length })
    }),
    upsert: vi.fn(({ where, create: initial, update: patch }: Query & { create: Row; update: Row }) => {
      const row = store[name].find(row => accepts(row, where))
      return row ? Promise.resolve(update(row, patch)) : create({ data: initial })
    }),
  }
}
type TestDatabase = Record<ModelName, ReturnType<typeof model>> & {
  $queryRaw: () => Promise<unknown[]>
  $executeRaw: () => Promise<number>
  $transaction: (work: (tx: TestDatabase) => Promise<unknown>) => Promise<unknown>
}
function fixture(seed: Row[] = []) {
  const data: Store = { trialRegistration: structuredClone(seed), trialProfile: [{ id: 1, configJson: profile }], trialConsentEvent: [], trialParticipant: [], user: [], tenant: [], license: [], host: [], pemKey: [], bastionHost: [] }
  let queue = Promise.resolve()
  const db: TestDatabase = {
    trialRegistration: model('trialRegistration', data), trialProfile: model('trialProfile', data),
    trialConsentEvent: model('trialConsentEvent', data), trialParticipant: model('trialParticipant', data),
    user: model('user', data), tenant: model('tenant', data), license: model('license', data), host: model('host', data), pemKey: model('pemKey', data), bastionHost: model('bastionHost', data),
    $queryRaw: vi.fn(() => Promise.resolve([])), $executeRaw: vi.fn(() => Promise.resolve(1)),
    $transaction: vi.fn((work: (tx: TestDatabase) => Promise<unknown>) => {
      const result = queue.then(async () => {
        const snapshot = structuredClone(data)
        try { return await work(db) } catch (error) { Object.assign(data, snapshot); throw error }
      })
      queue = result.then(() => undefined, () => undefined)
      return result
    }),
  }
  const mailer = { send: vi.fn((_to: string, _link: string) => Promise.resolve()) }
  const provisioner = { ensure: vi.fn((trialId: string): Promise<TrialLab> => Promise.resolve({ trialId, state: 'ready', isolated: true, hosts: [host] })), remove: vi.fn(() => Promise.resolve()) }
  const service = new TrialService(db as unknown as PrismaClient, { registrationsEnabled: true, publicUrl: 'https://demo.example.com', mailer, provisioner })
  return { data, db, mailer, provisioner, service }
}
function trial(extra: Row = {}): Row {
  return { id, name: 'Visitante', email: 'visitor@example.com', profileJson: profile, status: 'PENDING_EMAIL',
    verificationHash: tokenHash(verification), verificationExpiresAt: new Date(Date.now() + 60_000), managementHash: tokenHash(control),
    verifiedAt: null, activatedAt: null, tenantId: null, expiresAt: null, createdAt: new Date(), updatedAt: new Date(),
    privacyVersion: profile.privacyVersion, marketingConsent: false, researchConsent: false, ...extra }
}
const signup = { name: 'Visitante Sintético', email: 'VISITOR@example.com', termsAccepted: true, privacyVersion: profile.privacyVersion }
afterEach(() => vi.restoreAllMocks())

describe('public registration and verification', () => {
  it('publishes effective limits and retention before acceptance without infrastructure details', async () => {
    const f = fixture()
    const config = await f.service.publicConfig()
    expect(config.profile).toEqual({ name: profile.name, durationDays: profile.durationDays,
      maxUsers: profile.maxUsers, maxHosts: profile.maxHosts, retentionDays: profile.retentionDays,
      machineCount: 1, maxMachines: 1, allowCustomHosts: false, maxCustomHosts: 0,
      maxSessions: profile.maxSessions, resources: profile.resources })
    expect(JSON.stringify(config)).not.toContain(profile.networkCidr)
    expect(JSON.stringify(config)).not.toContain(profile.templateId)
    expect(config.profile).not.toHaveProperty('maxActiveTrials')
  })

  it('stores only token digests and allows registration without commercial consent', async () => {
    const f = fixture(); await f.service.register(signup)
    const row = f.data.trialRegistration[0]!
    const link = new URL(f.mailer.send.mock.calls[0]![1])
    const raw = new URLSearchParams(link.hash.slice(1)).get('token')!
    expect(link.search).toBe('')
    expect(row.email).toBe('visitor@example.com')
    expect(row.phoneEncrypted).toBeNull()
    expect(row.verificationHash).toBe(tokenHash(raw))
    expect(JSON.stringify(f.data)).not.toContain(raw)
    expect(row.marketingConsent).toBe(false)
    expect(f.data.trialConsentEvent[0]).toMatchObject({ kind: 'REGISTRATION', marketing: false, research: false })
  })
  it('encrypts optional contact and exposes it only through the administrative projection', async () => {
    const f = fixture(); const phone = '+12025550123'
    const response = await f.service.register({ ...signup, phone: '+1 (202) 555-0123' })
    const row = f.data.trialRegistration[0]!
    expect(typeof row.phoneEncrypted).toBe('string')
    expect(decrypt(JSON.parse(String(row.phoneEncrypted)) as EncryptedPayload)).toBe(phone)
    expect(JSON.stringify(f.data)).not.toContain(phone)
    const admin = await f.service.list()
    expect(admin.trials[0]).toMatchObject({ phone })
    expect(admin.trials[0]).not.toHaveProperty('phoneEncrypted')
    expect(row.marketingConsent).toBe(false)
    const link = new URL(f.mailer.send.mock.calls[0]![1])
    const raw = new URLSearchParams(link.hash.slice(1)).get('token')!
    const verified = await f.service.verify(raw)
    await f.service.tick()
    const publicData = [response, verified, await f.service.status(verified.accessToken), await f.service.publicConfig(),
      f.mailer.send.mock.calls, f.provisioner.ensure.mock.calls, f.data.trialConsentEvent]
    expect(JSON.stringify(publicData)).not.toContain(phone)
    expect(JSON.stringify(publicData)).not.toContain('phoneEncrypted')
    // An unauthenticated resend may not replace a previously supplied contact.
    row.updatedAt = new Date(0)
    await f.service.register({ ...signup, phone: '+1 (202) 555-0124' })
    expect(decrypt(JSON.parse(String(row.phoneEncrypted)) as EncryptedPayload)).toBe(phone)
  })
  it('does not persist a whitespace-only phone or add phone consent', async () => {
    const f = fixture(); await f.service.register({ ...signup, phone: '   ' })
    expect(f.data.trialRegistration[0]).toMatchObject({ phoneEncrypted: null, marketingConsent: false, researchConsent: false })
    expect((await f.service.list()).trials[0]).toMatchObject({ phone: null })
  })
  it('does not mutate normal identities or reveal their existence', async () => {
    const f = fixture(); f.data.user.push({ id: 5, email: 'visitor@example.com', deletedAt: null, tenantId: 99 })
    const response = await f.service.register(signup)
    expect(response.message).toMatch(/Se o cadastro puder/)
    expect(f.data.trialRegistration).toHaveLength(0)
    expect(f.mailer.send).not.toHaveBeenCalled()
    expect(f.data.user).toEqual([{ id: 5, email: 'visitor@example.com', deletedAt: null, tenantId: 99 }])
  })
  it('serializes simultaneous duplicate requests and sends one initial verification', async () => {
    const f = fixture(); const responses = await Promise.all([f.service.register(signup), f.service.register(signup)])
    expect(responses[0]).toEqual(responses[1]); expect(f.data.trialRegistration).toHaveLength(1)
    expect(f.mailer.send).toHaveBeenCalledTimes(1)
  })
  it('expired pending links can be rotated after resend interval without duplicating the trial', async () => {
    const f = fixture([trial({ updatedAt: new Date(Date.now() - 120_000), verificationExpiresAt: new Date(0) })])
    await f.service.register(signup)
    expect(f.data.trialRegistration).toHaveLength(1)
    expect(f.data.trialRegistration[0]!.verificationHash).not.toBe(tokenHash(verification))
    await expect(f.service.verify(verification)).rejects.toThrow(/Link inválido/)
  })
  it('does not reveal SMTP failures or persist their secret-bearing error', async () => {
    const f = fixture(); f.mailer.send.mockRejectedValue(new Error('smtp password=DO_NOT_STORE'))
    await expect(f.service.register(signup)).resolves.toHaveProperty('message')
    expect(JSON.stringify(f.data)).not.toContain('DO_NOT_STORE')
  })
  it('blocks stale notices and invalid terms before writing registration', async () => {
    const f = fixture()
    await expect(f.service.register({ ...signup, privacyVersion: 'old' })).rejects.toThrow(/privacidade mudou/)
    await expect(f.service.register({ ...signup, termsAccepted: false })).rejects.toThrow()
    expect(f.data.trialRegistration).toHaveLength(0)
  })
  it('bounds pending email storage without revealing capacity in response', async () => {
    const f = fixture(Array.from({ length: profile.maxActiveTrials * 20 }, (_, i) => trial({ id: `pending-${i}`, email: `p${i}@example.com` })))
    await expect(f.service.register(signup)).resolves.toHaveProperty('message')
    expect(f.mailer.send).not.toHaveBeenCalled()
    expect(f.data.trialRegistration).toHaveLength(profile.maxActiveTrials * 20)
  })
  it('verification is one-use under competing submissions', async () => {
    const f = fixture([trial()])
    const outcomes = await Promise.allSettled([f.service.verify(verification), f.service.verify(verification)])
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1)
    const success = outcomes.find(o => o.status === 'fulfilled') as PromiseFulfilledResult<{ accessToken: string }>
    expect(f.data.trialRegistration[0]).toMatchObject({ status: 'QUEUED', verificationHash: null, managementHash: tokenHash(success.value.accessToken) })
    expect(JSON.stringify(f.data)).not.toContain(success.value.accessToken)
  })
  it('expired verification cannot queue or provision', async () => {
    const f = fixture([trial({ verificationExpiresAt: new Date(0) })])
    await expect(f.service.verify(verification)).rejects.toThrow(/expirado/)
    expect(f.data.trialRegistration[0]!.status).toBe('PENDING_EMAIL')
  })
})

describe('reconciliation, privacy and activation', () => {
  it('reserves quota, provisions once and never changes existing normal accounts', async () => {
    const f = fixture([trial({ status: 'QUEUED', verifiedAt: new Date() })])
    f.data.tenant.push({ id: 99, slug: 'normal', active: true })
    await f.service.tick(); await f.service.tick()
    expect(f.provisioner.ensure).toHaveBeenCalledTimes(1)
    expect(f.data.trialRegistration[0]!.status).toBe('ACTIVE')
    expect(f.data.license[0]).toMatchObject({ maxUsers: 2, maxHosts: 2, maxActiveSessionsTenant: 2 })
    expect(f.data.user[0]).toMatchObject({ active: false, role: 'USER', canManageHosts: false })
    expect(f.data.host[0]!.passwordEncrypted).not.toContain(host.password)
    expect(f.data.tenant[0]).toEqual({ id: 99, slug: 'normal', active: true })
  })
  it('does not attach a provider address already assigned to a normal tenant', async () => {
    const f = fixture([trial({ status: 'QUEUED', verifiedAt: new Date() })])
    const normalHost = { id: 99, tenantId: 99, ip: host.ip, name: 'Existing production host', deletedAt: null }
    f.data.tenant.push({ id: 99, slug: 'normal', active: true })
    f.data.host.push(normalHost)
    await f.service.tick()
    expect(f.data.trialRegistration[0]).toMatchObject({ status: 'PROVISIONING', tenantId: null, lastError: 'RECONCILIATION_RETRY' })
    expect(f.data.tenant).toEqual([{ id: 99, slug: 'normal', active: true }])
    expect(f.data.host).toEqual([normalHost])
    expect(f.data.user).toHaveLength(0)
  })
  it('processes expired cleanup even when more than twenty older signups are queued', async () => {
    const waiting = Array.from({ length: 25 }, (_, index) => trial({ id: `queued-${index}`, status: 'QUEUED', verifiedAt: new Date(), createdAt: new Date(0) }))
    const f = fixture([...waiting, trial({ status: 'EXPIRED', verifiedAt: new Date(), createdAt: new Date() })])
    f.provisioner.ensure.mockResolvedValue({ trialId: id, state: 'preparing', isolated: true, hosts: [] })
    await f.service.tick()
    expect(f.provisioner.remove).toHaveBeenCalledWith(id)
    expect(f.data.trialRegistration.find(row => row.id === id)).toMatchObject({ status: 'REMOVED' })
  })
  it('rotates preparing jobs so ten slow labs cannot starve a later ready lab', async () => {
    const pending = Array.from({ length: 11 }, (_, index) => trial({ id: `provisioning-${index}`, status: 'PROVISIONING', verifiedAt: new Date(), updatedAt: new Date(0) }))
    const f = fixture(pending)
    f.provisioner.ensure.mockImplementation((trialId: string) => Promise.resolve({ trialId,
      state: trialId === 'provisioning-10' ? 'ready' : 'preparing', isolated: true, hosts: trialId === 'provisioning-10' ? [host] : [] }))
    await f.service.tick()
    expect(f.data.trialRegistration[10]!.status).toBe('PROVISIONING')
    await f.service.tick()
    expect(f.provisioner.ensure.mock.calls.map(call => call[0])).toContain('provisioning-10')
    expect(f.data.trialRegistration[10]!.status).toBe('ACTIVE')
  })
  it('keeps a queued trial queued when capacity is full', async () => {
    const f = fixture([trial({ status: 'QUEUED', verifiedAt: new Date() }), ...[1, 2].map(i => trial({ id: `active-${i}`, status: 'ACTIVE', verifiedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) }))])
    await f.service.tick()
    expect(f.provisioner.ensure).not.toHaveBeenCalled()
    expect(f.data.trialRegistration[0]!.status).toBe('QUEUED')
  })
  it('preparing provider does not start the trial clock or create users', async () => {
    const f = fixture([trial({ status: 'QUEUED', verifiedAt: new Date() })])
    f.provisioner.ensure.mockResolvedValue({ trialId: id, state: 'preparing', isolated: true, hosts: [] })
    await f.service.tick()
    expect(f.data.trialRegistration[0]).toMatchObject({ status: 'PROVISIONING', expiresAt: null })
    expect(f.data.user).toHaveLength(0)
  })
  it('provider failure retains retryable state and sanitized diagnostics', async () => {
    const f = fixture([trial({ status: 'QUEUED', verifiedAt: new Date() })])
    f.provisioner.ensure.mockRejectedValue(new Error('provider token=DO_NOT_STORE'))
    await f.service.tick()
    expect(f.data.trialRegistration[0]).toMatchObject({ status: 'PROVISIONING', lastError: 'RECONCILIATION_RETRY' })
    expect(JSON.stringify(f.data)).not.toContain('DO_NOT_STORE')
  })
  it('cancellation during provisioning prevents account activation and confirms compensating cleanup', async () => {
    const f = fixture([trial({ status: 'QUEUED', verifiedAt: new Date() })])
    f.provisioner.ensure.mockImplementation(async () => { await f.service.cancelById(id); return { trialId: id, state: 'ready', isolated: true, hosts: [host] } })
    await f.service.tick()
    expect(f.data.trialRegistration[0]!.status).toBe('REMOVED')
    expect(f.provisioner.remove).toHaveBeenCalledWith(id)
    expect(f.data.tenant).toHaveLength(0)
    await f.service.tick()
    expect(f.provisioner.remove).toHaveBeenCalledWith(id)
    expect(f.data.trialRegistration[0]!.status).toBe('REMOVED')
  })
  it('reconciles a lab that finishes provisioning after another worker already confirmed cancellation', async () => {
    const f = fixture([trial({ status: 'QUEUED', verifiedAt: new Date() })])
    let release!: () => void
    let entered!: () => void
    const began = new Promise<void>(resolve => { entered = resolve })
    const pending = new Promise<void>(resolve => { release = resolve })
    let infrastructureExists = false
    f.provisioner.ensure.mockImplementation(async () => {
      entered(); await pending; infrastructureExists = true
      return { trialId: id, state: 'ready', isolated: true, hosts: [host] }
    })
    f.provisioner.remove.mockImplementation(() => { infrastructureExists = false; return Promise.resolve() })
    const firstWorker = f.service.tick()
    await began
    await f.service.cancelById(id)
    await f.service.tick()
    expect(f.data.trialRegistration[0]!.status).toBe('REMOVED')
    release(); await firstWorker
    expect(f.data.tenant).toHaveLength(0)
    expect(infrastructureExists).toBe(false)
  })
  it('retries cleanup if late provisioning completes after removal and its compensating delete fails', async () => {
    const f = fixture([trial({ status: 'QUEUED', verifiedAt: new Date() })])
    let release!: () => void
    let entered!: () => void
    const began = new Promise<void>(resolve => { entered = resolve })
    const pending = new Promise<void>(resolve => { release = resolve })
    let infrastructureExists = false
    f.provisioner.ensure.mockImplementation(async () => {
      entered(); await pending; infrastructureExists = true
      return { trialId: id, state: 'ready', isolated: true, hosts: [host] }
    })
    let removalAttempts = 0
    f.provisioner.remove.mockImplementation(() => {
      removalAttempts++
      if (removalAttempts === 2) return Promise.reject(new Error('temporary provider failure'))
      infrastructureExists = false
      return Promise.resolve()
    })
    const firstWorker = f.service.tick()
    await began; await f.service.cancelById(id); await f.service.tick()
    release(); await firstWorker
    expect(infrastructureExists).toBe(true)
    await f.service.tick()
    expect(infrastructureExists).toBe(false)
    expect(f.data.trialRegistration[0]!.status).toBe('REMOVED')
  })
  it('rolls back account/host creation on database failure and retries the same infrastructure ID', async () => {
    const f = fixture([trial({ status: 'QUEUED', verifiedAt: new Date() })])
    f.db.host.create.mockRejectedValueOnce(new Error('database unavailable'))
    await f.service.tick()
    expect(f.data.tenant).toHaveLength(0)
    expect(f.data.user).toHaveLength(0)
    expect(f.data.trialRegistration[0]).toMatchObject({ status: 'PROVISIONING', lastError: 'RECONCILIATION_RETRY' })
    await f.service.tick()
    expect(f.data.trialRegistration[0]!.status).toBe('ACTIVE')
    expect(f.provisioner.ensure.mock.calls.map(call => call[0])).toEqual([id, id])
    expect(f.data.tenant).toHaveLength(1)
  })
  it('revokes only trial credentials before failed removal and retries removal', async () => {
    const f = fixture([trial({ status: 'EXPIRED', verifiedAt: new Date(), tenantId: 1 })])
    f.data.tenant.push({ id: 1, active: true }, { id: 99, active: true })
    f.data.user.push({ id: 1, tenantId: 1, active: true, passwordHash: 'trial-password' }, { id: 99, tenantId: 99, active: true, passwordHash: 'normal-password' })
    f.data.host.push({ id: 1, tenantId: 1, passwordEncrypted: 'cipher' })
    f.provisioner.remove.mockRejectedValueOnce(new Error('offline'))
    await f.service.tick()
    expect(f.data.trialRegistration[0]!.status).toBe('REMOVING')
    expect(f.data.user[0]).toMatchObject({ active: false, passwordHash: null })
    expect(f.data.user[1]).toMatchObject({ active: true, passwordHash: 'normal-password' })
    await f.service.tick()
    expect(f.data.trialRegistration[0]!.status).toBe('REMOVED')
  })
  it('blanks only exclusively trial-owned PEM keys before provider removal fails', async () => {
    const f = fixture([trial({ status: 'EXPIRED', verifiedAt: new Date(), tenantId: 1 })])
    f.data.tenant.push({ id: 1, active: true }, { id: 99, active: true })
    f.data.user.push({ id: 1, tenantId: 1, active: true }, { id: 99, tenantId: 99, active: true })
    for (const keyId of [1, 2, 3, 4, 5]) f.data.pemKey.push({ id: keyId, createdById: keyId === 2 ? 99 : 1,
      name: `Key ${keyId}`, encryptedKey: `cipher-${keyId}`, iv: `iv-${keyId}`, encryptedPassphrase: `phrase-${keyId}`, passphraseIv: `phrase-iv-${keyId}` })
    f.data.host.push({ id: 1, tenantId: 1, pemKeyId: 1 }, { id: 2, tenantId: 99, pemKeyId: 2 }, { id: 3, tenantId: 99, pemKeyId: 3 })
    f.data.bastionHost.push({ id: 1, tenantId: 99, systemPemKeyId: 4 })
    const preserved = structuredClone(f.data.pemKey.filter(key => [2, 3, 4].includes(Number(key.id))))
    f.provisioner.remove.mockRejectedValueOnce(new Error('offline'))
    await f.service.tick()
    expect(f.data.trialRegistration[0]!.status).toBe('REMOVING')
    for (const keyId of [1, 5]) expect(f.data.pemKey.find(key => key.id === keyId)).toMatchObject({
      name: 'Chave de teste revogada', encryptedKey: '', iv: '', encryptedPassphrase: null, passphraseIv: null,
    })
    expect(f.data.pemKey.filter(key => [2, 3, 4].includes(Number(key.id)))).toEqual(preserved)
    expect(f.data.user.find(user => user.id === 99)).toMatchObject({ active: true })
    expect(f.db.pemKey.updateMany).toHaveBeenCalledTimes(1)
    expect(f.provisioner.remove).toHaveBeenCalledExactlyOnceWith(id)
  })
  it('signup flag off does not stop expiry and removal', async () => {
    const f = fixture([trial({ status: 'ACTIVE', verifiedAt: new Date(), expiresAt: new Date(0) })])
    const disabled = new TrialService(f.db as unknown as PrismaClient, { registrationsEnabled: false, provisioner: f.provisioner })
    await expect(disabled.register(signup)).rejects.toThrow(/indisponíveis/)
    await disabled.tick()
    expect(f.data.trialRegistration[0]!.status).toBe('REMOVED')
  })
  it('allows consent revocation with an audit event without cancelling trial', async () => {
    const f = fixture([trial({ status: 'ACTIVE', marketingConsent: true, researchConsent: true })])
    await f.service.preferences(control, { marketingConsent: false, researchConsent: false })
    expect(f.data.trialRegistration[0]).toMatchObject({ status: 'ACTIVE', marketingConsent: false, researchConsent: false })
    expect(f.data.trialConsentEvent[0]).toMatchObject({ kind: 'PREFERENCES', marketing: false, research: false })
  })
  it('activation hashes password and cannot be replayed', async () => {
    const f = fixture([trial({ status: 'ACTIVE', tenantId: 1, expiresAt: new Date(Date.now() + 60_000) })])
    f.data.tenant.push({ id: 1, slug: 'trial-test' })
    f.data.user.push({ id: 1, tenantId: 1, email: 'visitor@example.com', active: false })
    await expect(f.service.activate(control, { password: 'DisposableSecret123!' })).resolves.toEqual({ tenantSlug: 'trial-test' })
    const storedHash = f.data.user[0]!.passwordHash
    if (typeof storedHash !== 'string') throw new Error('Expected bcrypt hash')
    expect(await bcrypt.compare('DisposableSecret123!', storedHash)).toBe(true)
    await expect(f.service.activate(control, { password: 'DisposableSecret123!' })).rejects.toThrow(/já ativada/)
  })
  it('expired and unknown management tokens cannot activate users', async () => {
    const f = fixture([trial({ status: 'ACTIVE', tenantId: 1, expiresAt: new Date(0) })])
    await expect(f.service.activate(control, { password: 'DisposableSecret123!' })).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 })
    await expect(f.service.status('ff'.repeat(32))).rejects.toThrow(/inválido/)
    expect(f.db.user.updateMany).not.toHaveBeenCalled()
  })
})

const guestControl = 'ef'.repeat(32)
function participant(extra: Row = {}): Row {
  return { id: 'guest-one', trialId: id, name: 'Colega', email: 'colleague@example.com', verificationHash: tokenHash(verification),
    verificationExpiresAt: new Date(Date.now() + 60_000), managementHash: tokenHash(guestControl), verifiedAt: new Date(),
    activatedAt: null, cancelledAt: null, userId: null, marketingConsent: false, researchConsent: false, ...extra }
}
function activeFixture() {
  const f = fixture([trial({ status: 'ACTIVE', tenantId: 1, activatedAt: new Date(), verifiedAt: new Date(), expiresAt: new Date(Date.now() + 86400_000) })])
  f.data.tenant.push({ id: 1, slug: 'trial-test', active: true })
  f.data.user.push({ id: 1, tenantId: 1, email: 'visitor@example.com', active: true, deletedAt: null })
  return f
}

describe('recovery links and participant invitations', () => {
  it('recovery rotates the owner management token without extending or restarting active trial', async () => {
    const f = activeFixture(); f.data.trialRegistration[0]!.updatedAt = new Date(Date.now() - 120_000)
    const deadline = comparable(f.data.trialRegistration[0]!.expiresAt)
    await f.service.register(signup)
    const link = new URL(f.mailer.send.mock.calls[0]![1])
    const raw = new URLSearchParams(link.hash.slice(1)).get('token')!
    const recovered = await f.service.verify(raw)
    expect(f.data.trialRegistration[0]!.status).toBe('ACTIVE')
    expect(comparable(f.data.trialRegistration[0]!.expiresAt)).toBe(deadline)
    await expect(f.service.status(control)).rejects.toThrow(/inválido/)
    await expect(f.service.status(recovered.accessToken)).resolves.toMatchObject({ owner: true, activated: true })
  })
  it('recovery of a removed trial never requeues its laboratory', async () => {
    const f = fixture([trial({ status: 'REMOVED', updatedAt: new Date(Date.now() - 120_000) })])
    await f.service.register(signup)
    const raw = new URLSearchParams(new URL(f.mailer.send.mock.calls[0]![1]).hash.slice(1)).get('token')!
    await f.service.verify(raw); await f.service.tick()
    expect(f.data.trialRegistration[0]!.status).toBe('REMOVED')
    expect(f.provisioner.ensure).not.toHaveBeenCalled()
  })
  it('invites without granting marketing consent on behalf of the guest', async () => {
    const f = activeFixture(); f.data.trialRegistration[0]!.marketingConsent = true
    await f.service.invite(control, { name: 'Colega', email: 'COLLEAGUE@example.com' })
    expect(f.data.trialParticipant[0]).toMatchObject({ email: 'colleague@example.com', marketingConsent: false, researchConsent: false, activatedAt: null })
    const raw = new URLSearchParams(new URL(f.mailer.send.mock.calls[0]![1]).hash.slice(1)).get('token')!
    expect(f.data.trialParticipant[0]!.verificationHash).toBe(tokenHash(raw))
    expect(JSON.stringify(f.data)).not.toContain(raw)
    const management = await f.service.verify(raw)
    await expect(f.service.status(management.accessToken)).resolves.toMatchObject({ owner: false, consentRequired: true })
  })
  it('pending invitations reserve quota and do not modify normal existing users', async () => {
    const f = activeFixture()
    await f.service.invite(control, { name: 'Colega', email: 'colleague@example.com' })
    await expect(f.service.invite(control, { name: 'Outro', email: 'other@example.com' })).rejects.toThrow(/Limite/)
    f.data.user.push({ id: 99, email: 'normal@example.com', tenantId: 99, active: true, deletedAt: null })
    await expect(f.service.invite(control, { name: 'Normal', email: 'normal@example.com' })).resolves.toHaveProperty('message')
    expect(f.data.user[1]).toMatchObject({ id: 99, tenantId: 99, active: true })
  })
  it('resending an expired invitation cannot steal a currently reserved slot', async () => {
    const f = activeFixture()
    f.data.trialParticipant.push(participant({ id: 'old', verifiedAt: null, verificationExpiresAt: new Date(0) }), participant({ id: 'reserved', email: 'reserved@example.com', verifiedAt: null }))
    await expect(f.service.invite(control, { name: 'Colega', email: 'colleague@example.com' })).rejects.toThrow(/Limite/)
  })
  it('verified but unactivated guests continue reserving their slot after the verification deadline', async () => {
    const f = activeFixture()
    f.data.trialParticipant.push(participant({ verificationExpiresAt: new Date(0) }))
    await expect(f.service.invite(control, { name: 'Outro', email: 'other@example.com' })).rejects.toThrow(/Limite/)
  })
  it('guest cannot invite others or cancel the owner trial', async () => {
    const f = activeFixture(); f.data.trialParticipant.push(participant())
    await expect(f.service.invite(guestControl, { name: 'Outro', email: 'other@example.com' })).rejects.toThrow(/Convites indisponíveis/)
    await f.service.cancel(guestControl)
    expect(f.data.trialParticipant[0]!.cancelledAt).toBeInstanceOf(Date)
    expect(f.data.trialRegistration[0]!.status).toBe('ACTIVE')
    expect(f.data.user[0]!.active).toBe(true)
    await expect(f.service.status(guestControl)).resolves.toMatchObject({ status: 'CANCELLED', owner: false })
    await expect(f.service.preferences(guestControl, { marketingConsent: false, researchConsent: false })).resolves.toEqual({ ok: true })
    await expect(f.service.activate(guestControl, { password: 'DisposableSecret123!', termsAccepted: true, privacyVersion: profile.privacyVersion })).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 })
    expect(f.data.user).toHaveLength(1)
  })
  it('cancellation re-reads a participant activated after the initial management-token lookup', async () => {
    const f = activeFixture(); f.data.trialParticipant.push(participant())
    const lookup = f.db.trialParticipant.findUnique.getMockImplementation()
    if (!lookup) throw new Error('Expected participant lookup implementation')
    f.db.trialParticipant.findUnique.mockImplementation(query => lookup(query).then(snapshot => {
      // Activation commits after lookup but before cancellation takes its row lock.
      f.data.trialParticipant[0]!.userId = 2
      f.data.trialParticipant[0]!.activatedAt = new Date()
      f.data.user.push({ id: 2, tenantId: 1, email: 'colleague@example.com', active: true, deletedAt: null })
      return snapshot
    }))
    await f.service.cancel(guestControl)
    expect(f.data.user.find(user => user.id === 2)).toMatchObject({ active: false, sessionVersion: 1 })
    expect(f.data.user.find(user => user.id === 1)).toMatchObject({ active: true })
    expect(f.data.trialRegistration[0]!.status).toBe('ACTIVE')
  })
  it('guest must accept own terms and can activate without marketing or research', async () => {
    const f = activeFixture(); f.data.trialParticipant.push(participant())
    await expect(f.service.activate(guestControl, { password: 'DisposableSecret123!' })).rejects.toThrow(/termos/)
    await expect(f.service.activate(guestControl, { password: 'DisposableSecret123!', termsAccepted: true, privacyVersion: 'old' })).rejects.toThrow(/termos/)
    await expect(f.service.activate(guestControl, { password: 'DisposableSecret123!', termsAccepted: true, privacyVersion: profile.privacyVersion })).resolves.toEqual({ tenantSlug: 'trial-test' })
    expect(f.data.user[1]).toMatchObject({ tenantId: 1, role: 'USER', active: true, canManageHosts: false })
    expect(f.data.trialParticipant[0]).toMatchObject({ marketingConsent: false, researchConsent: false })
    expect(f.data.trialConsentEvent[0]).toMatchObject({ kind: 'INVITATION_ACCEPTED', participantId: 'guest-one', marketing: false, research: false })
  })
  it('guest preference changes do not change owner preferences', async () => {
    const f = activeFixture(); f.data.trialRegistration[0]!.marketingConsent = true
    f.data.trialParticipant.push(participant({ marketingConsent: true }))
    await f.service.preferences(guestControl, { marketingConsent: false, researchConsent: false })
    expect(f.data.trialParticipant[0]!.marketingConsent).toBe(false)
    expect(f.data.trialRegistration[0]!.marketingConsent).toBe(true)
    expect(f.data.trialConsentEvent[0]!.participantId).toBe('guest-one')
  })
  it('revoked guests cannot verify an old invitation', async () => {
    const f = activeFixture(); f.data.trialParticipant.push(participant({ cancelledAt: new Date() }))
    // Owner verification hash is removed as it would be after initial verification.
    f.data.trialRegistration[0]!.verificationHash = null
    await expect(f.service.verify(verification)).rejects.toThrow(/Link inválido/)
  })
})
