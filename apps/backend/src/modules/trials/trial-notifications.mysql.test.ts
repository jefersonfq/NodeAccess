import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { deliverTrialNotices, type TrialNoticeSender } from './trial-notifications.js'

const connection = process.env.TRIAL_RETENTION_DATABASE_URL
const real = connection ? describe : describe.skip
real('operational trial mail with real MySQL queue claims', () => {
  let db: PrismaClient
  const ids: string[] = []
  const now = new Date('2030-01-10T12:00:00Z')
  beforeAll(async () => {
    const url = new URL(connection!)
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !['/na0068_retention', '/na0074_retention', '/nodeaccess_test_na0079'].includes(url.pathname)) throw new Error('Only the isolated local na0068_retention schema is accepted')
    db = new PrismaClient({ datasourceUrl: connection! })
    await db.$connect()
  })
  afterEach(async () => {
    await db.trialRegistration.deleteMany({ where: { id: { in: ids.splice(0) } } })
  })
  afterAll(async () => { await db?.$disconnect() })
  async function trial(extra: { status?: string; expiresAt?: Date; expiryNoticeHours?: number } = {}) {
    const id = randomUUID(); ids.push(id)
    return db.trialRegistration.create({ data: { id, status: extra.status ?? 'ACTIVE',
      email: `${id}@example.com`, name: 'Private recipient fixture', profileJson: { expiryNoticeHours: extra.expiryNoticeHours ?? 6, retentionDays: 17, privacyUrl: 'https://example.test/privacy-v1', termsUrl: 'https://example.test/terms-v1' },
      privacyVersion: 'fixture', marketingConsent: false, researchConsent: false,
      expiresAt: extra.expiresAt ?? new Date(now.getTime() + 48 * 3600_000),
    } })
  }
  it('sends ready without marketing consent and stores no recipient, body or SMTP secrets in the queue', async () => {
    const row = await trial()
    const send = vi.fn<TrialNoticeSender>(() => Promise.resolve())
    await deliverTrialNotices(db, send, now)
    expect(send).toHaveBeenCalledExactlyOnceWith(row.email, 'ready', row.expiresAt, { retentionDays: 17, privacyUrl: 'https://example.test/privacy-v1', termsUrl: 'https://example.test/terms-v1' })
    const notice = await db.trialNotification.findUniqueOrThrow({ where: { id: `${row.id}:ready` } })
    expect(notice).toMatchObject({ status: 'SENT', attempts: 1, sentAt: now, leaseUntil: null })
    expect(JSON.stringify(notice)).not.toContain(row.email)
    expect(JSON.stringify(notice)).not.toContain(row.name)
    expect(Object.keys(notice).sort()).toEqual(['attempts', 'id', 'kind', 'leaseUntil', 'nextAttemptAt', 'sentAt', 'status', 'trialId'].sort())
  })
  it('retains a failed send for retry and does not misreport delivery', async () => {
    const row = await trial()
    const send = vi.fn<TrialNoticeSender>().mockRejectedValueOnce(new Error('SMTP credential=DO_NOT_STORE')).mockResolvedValue(undefined)
    await deliverTrialNotices(db, send, now)
    const failed = await db.trialNotification.findUniqueOrThrow({ where: { id: `${row.id}:ready` } })
    expect(failed).toMatchObject({ status: 'PENDING', sentAt: null, leaseUntil: null, attempts: 1 })
    expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime())
    expect(JSON.stringify(failed)).not.toContain('DO_NOT_STORE')
    await deliverTrialNotices(db, send, new Date(now.getTime() + 1000))
    expect(send).toHaveBeenCalledTimes(1)
    await deliverTrialNotices(db, send, new Date(now.getTime() + 31_000))
    expect(send).toHaveBeenCalledTimes(2)
    expect(await db.trialNotification.findUniqueOrThrow({ where: { id: `${row.id}:ready` } })).toMatchObject({ status: 'SENT', attempts: 2, sentAt: new Date(now.getTime() + 31_000) })
  })
  it('only one worker claims a pending notification while another sender is still running', async () => {
    const row = await trial()
    let release!: () => void; let entered!: () => void
    const began = new Promise<void>(resolve => { entered = resolve })
    const blocked = new Promise<void>(resolve => { release = resolve })
    const send = vi.fn<TrialNoticeSender>(async () => { entered(); await blocked })
    const first = deliverTrialNotices(db, send, now)
    await began
    try {
      await deliverTrialNotices(db, send, now)
      expect(send).toHaveBeenCalledTimes(1)
    } finally { release(); await first }
    expect(await db.trialNotification.findUniqueOrThrow({ where: { id: `${row.id}:ready` } })).toMatchObject({ status: 'SENT', attempts: 1 })
  })
  it('concurrent discovery does not duplicate the durable job or reject one worker', async () => {
    const row = await trial()
    let reads = 0; let release!: () => void
    const bothRead = new Promise<void>(resolve => { release = resolve })
    const concurrent = db.$extends({ query: { trialRegistration: { async findMany({ args, query }) {
      const rows = await query(args)
      if (args.where?.notifications?.none?.kind === 'ready') {
        reads++; if (reads === 2) release()
        await bothRead
      }
      return rows
    } } } })
    const send = vi.fn<TrialNoticeSender>(() => Promise.resolve())
    const results = await Promise.allSettled([
      deliverTrialNotices(concurrent as unknown as PrismaClient, send, now),
      deliverTrialNotices(concurrent as unknown as PrismaClient, send, now),
    ])
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(send).toHaveBeenCalledTimes(1)
    expect(await db.trialNotification.count({ where: { trialId: row.id, kind: 'ready' } })).toBe(1)
  })
  it('a stale pending snapshot cannot bypass another worker SMTP backoff', async () => {
    const row = await trial()
    let snapshotRead!: () => void; let releaseSnapshot!: () => void
    const read = new Promise<void>(resolve => { snapshotRead = resolve })
    const blocked = new Promise<void>(resolve => { releaseSnapshot = resolve })
    const stale = db.$extends({ query: { trialNotification: { async findMany({ args, query }) {
      const rows = await query(args)
      snapshotRead()
      await blocked
      return rows
    } } } })
    const staleSend = vi.fn<TrialNoticeSender>(() => Promise.resolve())
    const waiting = deliverTrialNotices(stale as unknown as PrismaClient, staleSend, now)
    await read
    const failedSend = vi.fn<TrialNoticeSender>(() => Promise.reject(new Error('temporary SMTP failure')))
    try {
      await deliverTrialNotices(db, failedSend, now)
      expect(failedSend).toHaveBeenCalledTimes(1)
      expect(await db.trialNotification.findUniqueOrThrow({ where: { id: `${row.id}:ready` } }))
        .toMatchObject({ status: 'PENDING', attempts: 1, nextAttemptAt: new Date(now.getTime() + 30_000) })
    } finally { releaseSnapshot(); await waiting }
    expect(staleSend).not.toHaveBeenCalled()
    expect(await db.trialNotification.findUniqueOrThrow({ where: { id: `${row.id}:ready` } }))
      .toMatchObject({ status: 'PENDING', attempts: 1, sentAt: null, leaseUntil: null, nextAttemptAt: new Date(now.getTime() + 30_000) })
    await deliverTrialNotices(db, staleSend, new Date(now.getTime() + 30_000))
    expect(staleSend).toHaveBeenCalledExactlyOnceWith(row.email, 'ready', row.expiresAt, { retentionDays: 17, privacyUrl: 'https://example.test/privacy-v1', termsUrl: 'https://example.test/terms-v1' })
    expect(await db.trialNotification.findUniqueOrThrow({ where: { id: `${row.id}:ready` } }))
      .toMatchObject({ status: 'SENT', attempts: 2 })
  })
  it('a stale worker failure cannot release a newer worker lease', async () => {
    const row = await trial()
    let rejectFirst!: (error: Error) => void; let releaseSecond!: () => void
    let firstEntered!: () => void; let secondEntered!: () => void
    const firstBegan = new Promise<void>(resolve => { firstEntered = resolve })
    const secondBegan = new Promise<void>(resolve => { secondEntered = resolve })
    const firstSend = new Promise<void>((_resolve, reject) => { rejectFirst = reject })
    const secondSend = new Promise<void>(resolve => { releaseSecond = resolve })
    let calls = 0
    const send = vi.fn<TrialNoticeSender>(() => {
      calls++
      if (calls === 1) { firstEntered(); return firstSend }
      if (calls === 2) { secondEntered(); return secondSend }
      return Promise.resolve()
    })
    const first = deliverTrialNotices(db, send, now)
    await firstBegan
    const later = new Date(now.getTime() + 121_000)
    const second = deliverTrialNotices(db, send, later)
    await secondBegan
    try {
      const claimed = await db.trialNotification.findUniqueOrThrow({ where: { id: `${row.id}:ready` } })
      rejectFirst(new Error('late SMTP timeout'))
      await first
      const afterStale = await db.trialNotification.findUniqueOrThrow({ where: { id: `${row.id}:ready` } })
      expect(afterStale).toMatchObject({ status: 'PENDING', attempts: 2, leaseUntil: claimed.leaseUntil })
      await deliverTrialNotices(db, send, later)
      expect(send).toHaveBeenCalledTimes(2)
    } finally { releaseSecond(); await second }
    expect(await db.trialNotification.findUniqueOrThrow({ where: { id: `${row.id}:ready` } })).toMatchObject({ status: 'SENT', attempts: 2, sentAt: later })
  })
  it('reschedules an already queued expiry notice when the deadline has been extended', async () => {
    const row = await trial()
    await db.trialNotification.createMany({ data: [
      { id: `${row.id}:ready`, trialId: row.id, kind: 'ready', status: 'SENT', sentAt: now },
      { id: `${row.id}:expiring`, trialId: row.id, kind: 'expiring', status: 'PENDING', sentAt: null },
    ] })
    const send = vi.fn<TrialNoticeSender>(() => Promise.resolve())
    await deliverTrialNotices(db, send, now)
    const due = new Date(row.expiresAt!.getTime() - 6 * 3600_000)
    expect(send).not.toHaveBeenCalled()
    expect(await db.trialNotification.findUniqueOrThrow({ where: { id: `${row.id}:expiring` } })).toMatchObject({ status: 'PENDING', sentAt: null, nextAttemptAt: due })
    await deliverTrialNotices(db, send, due)
    expect(send).toHaveBeenCalledExactlyOnceWith(row.email, 'expiring', row.expiresAt, { retentionDays: 17, privacyUrl: 'https://example.test/privacy-v1', termsUrl: 'https://example.test/terms-v1' })
  })
  it('skips cancelled and expired trials without pretending SMTP delivery happened', async () => {
    const cancelled = await trial({ status: 'CANCELLED' })
    const expired = await trial({ expiresAt: new Date(now.getTime() - 1) })
    for (const row of [cancelled, expired]) await db.trialNotification.create({ data: { id: `${row.id}:ready`, trialId: row.id, kind: 'ready' } })
    const send = vi.fn<TrialNoticeSender>(() => Promise.resolve())
    await deliverTrialNotices(db, send, now)
    expect(send).not.toHaveBeenCalled()
    for (const row of [cancelled, expired]) expect(await db.trialNotification.findUniqueOrThrow({ where: { id: `${row.id}:ready` } })).toMatchObject({ status: 'SKIPPED', sentAt: null, leaseUntil: null, attempts: 1 })
    await deliverTrialNotices(db, send, new Date(now.getTime() + 60_000))
    for (const row of [cancelled, expired]) expect(await db.trialNotification.findUniqueOrThrow({ where: { id: `${row.id}:ready` } })).toMatchObject({ status: 'SKIPPED', attempts: 1 })
  })
  it('renewing the deadline does not send a second ready notice', async () => {
    const row = await trial()
    const send = vi.fn<TrialNoticeSender>(() => Promise.resolve())
    await deliverTrialNotices(db, send, now)
    await db.trialRegistration.update({ where: { id: row.id }, data: { expiresAt: new Date(now.getTime() + 72 * 3600_000) } })
    await deliverTrialNotices(db, send, new Date(now.getTime() + 60_000))
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('does not let one hundred not-yet-due short-window trials hide a due longer-window notice', async () => {
    const batch = Array.from({ length: 101 }, () => randomUUID()); ids.push(...batch)
    await db.trialRegistration.createMany({ data: batch.map((id, index) => ({
      id, name: 'Notice fairness fixture', email: `${id}@example.com`, status: 'ACTIVE', privacyVersion: 'fixture',
      profileJson: { expiryNoticeHours: index === 100 ? 23 : 1, ...{ retentionDays: 17, privacyUrl: 'https://example.test/privacy-v1', termsUrl: 'https://example.test/terms-v1' } },
      expiresAt: new Date(now.getTime() + (index === 100 ? 20 : 2) * 3600_000),
    })) })
    await db.trialNotification.createMany({ data: batch.map(id => ({ id: `${id}:ready`, trialId: id, kind: 'ready', status: 'SENT', sentAt: now })) })
    const send = vi.fn<TrialNoticeSender>(() => Promise.resolve())
    await deliverTrialNotices(db, send, now)
    expect(send).toHaveBeenCalledExactlyOnceWith(`${batch[100]!}@example.com`, 'expiring', new Date(now.getTime() + 20 * 3600_000), { retentionDays: 17, privacyUrl: 'https://example.test/privacy-v1', termsUrl: 'https://example.test/terms-v1' })
  })
  it('honors configured expiry lead time rather than sending the maximum window to everyone', async () => {
    const row = await trial({ expiresAt: new Date(now.getTime() + 3 * 3600_000), expiryNoticeHours: 2 })
    await db.trialNotification.create({ data: { id: `${row.id}:ready`, trialId: row.id, kind: 'ready', status: 'SENT', sentAt: now } })
    const send = vi.fn<TrialNoticeSender>(() => Promise.resolve())
    await deliverTrialNotices(db, send, now)
    expect(send).not.toHaveBeenCalled()
    await deliverTrialNotices(db, send, new Date(now.getTime() + 3600_000))
    expect(send).toHaveBeenCalledExactlyOnceWith(row.email, 'expiring', row.expiresAt, { retentionDays: 17, privacyUrl: 'https://example.test/privacy-v1', termsUrl: 'https://example.test/terms-v1' })
  })
})
