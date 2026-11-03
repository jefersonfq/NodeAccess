import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { parseScimBearerToken, ScimError, ScimService } from './scim.service.js'

function harness(db: Record<string, unknown> = {}) {
  const entitlements = { requireIntegrationProvider: vi.fn().mockResolvedValue(undefined) }
  return { entitlements, service: new ScimService({ scimAuditEvent: { create: vi.fn().mockResolvedValue({}) }, ...db } as never, entitlements as never) }
}

describe('ScimService security contract', () => {
  it('fails closed when SCIM is not licensed', async () => {
    const { service, entitlements } = harness({ scimConfig: { findUnique: vi.fn() } })
    entitlements.requireIntegrationProvider.mockRejectedValue(new Error('not licensed'))
    await expect(service.getAdminConfig(7)).rejects.toThrow('not licensed')
    expect(entitlements.requireIntegrationProvider).toHaveBeenCalledWith(7, 'scim', expect.any(String))
  })

  it('rejects unsupported filters instead of broadening the query', async () => {
    const { service } = harness({ scimUser: { findMany: vi.fn() } })
    await expect(service.listUsers(7, 'displayName co "admin"')).rejects.toMatchObject({ status: 400, scimType: 'invalidFilter' })
  })

  it('requires an email-shaped userName', async () => {
    const { service } = harness({})
    await expect(service.createUser(7, { userName: 'not-an-email', password: 'ignored' })).rejects.toBeInstanceOf(ScimError)
  })

  it('increments session version when SCIM deactivates a user', async () => {
    const update = vi.fn().mockResolvedValue({})
    const db = {
      scimUser: { findFirst: vi.fn().mockResolvedValue({ id: 'u1', tenantId: 7, userId: 20, user: { active: true } }) },
      user: { update },
    }
    const { service } = harness(db)
    await service.patchUser(7, 'u1', [{ op: 'Replace', path: 'active', value: false }])
    expect(update).toHaveBeenCalledWith({ where: { id: 20 }, data: { active: false, licenseConsumed: false, sessionVersion: { increment: 1 } } })
  })
})


describe('SCIM adversarial input boundaries', () => {
  it('rejects oversized bearer whitespace before database access', async () => {
    const findFirst = vi.fn()
    const { service } = harness({ scimConfig: { findFirst } })
    await expect(service.authenticate('Bearer' + ' '.repeat(100_000))).rejects.toMatchObject({ status: 401 })
    expect(findFirst).not.toHaveBeenCalled()
  })
  it.each(['a@' + 'x'.repeat(100_000), 'a@@example.test', 'a@.x', 'a@x.', 'a @example.test'])(
    'rejects malformed email without persistence', async (userName) => {
      const { service } = harness({})
      await expect(service.createUser(7, { userName })).rejects.toMatchObject({ status: 400, scimType: 'invalidValue' })
    },
  )
})


describe('linear SCIM Bearer parser', () => {
  it('preserves the legacy grammar over bounded separator and token combinations', () => {
    for (const scheme of ['Bearer', 'BEARER', 'bEaReR', 'Basic', ' Bearer', 'BearerX']) {
      for (const separator of ['', ' ', '  ', '\t', '\r\n', '\u2028 ', ' \n ']) {
        for (const token of ['', 'synthetic-token', 'with space', ' ', '\t', '\n', 'token\n', 'token\r\n', 'x\u2028y']) {
          const header = scheme + separator + token
          expect(parseScimBearerToken(header), JSON.stringify(header)).toBe(header.match(/^Bearer\s+(.+)$/i)?.[1])
        }
      }
    }
    expect(parseScimBearerToken(undefined)).toBeUndefined()
  })
  it('scans long whitespace and malformed tails without retries', () => {
    expect(parseScimBearerToken('Bearer' + ' '.repeat(100_000) + 'token')).toBe('token')
    expect(parseScimBearerToken('Bearer' + ' '.repeat(100_000) + '\n')).toBeUndefined()
  })
  it('looks up the same extracted token hash and rejects invalid input before lookup', async () => {
    const findFirst = vi.fn().mockResolvedValue(null)
    const { service } = harness({ scimConfig: { findFirst } })
    await expect(service.authenticate('bEaReR\t  synthetic-token')).rejects.toMatchObject({ status: 401 })
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { enabled: true,
      tokenHash: createHash('sha256').update('synthetic-token').digest('hex') } }))
    findFirst.mockClear()
    await expect(service.authenticate('Bearer token\n')).rejects.toMatchObject({ status: 401 })
    expect(findFirst).not.toHaveBeenCalled()
  })
})
