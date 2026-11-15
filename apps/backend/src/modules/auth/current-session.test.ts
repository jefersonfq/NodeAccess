import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertCurrentUserSession, assertCurrentUserVersion, configureCurrentSessionReader, type CurrentSessionState } from './current-session.js'
import type { JwtPayload } from '../../shared/guards.js'
const state = (): CurrentSessionState => ({ tenantId: 2, active: true, deletedAt: null, tenantActive: true,
  targetTenantActive: true, sessionVersion: 0, role: 'ADMIN', isPlatformAdmin: false, canManageHosts: true, canViewLiveSessions: true })
const token = (): JwtPayload => ({ sub: '7', tenantId: 2, stage: 'authenticated', email: 'synthetic@example.test',
  role: 'admin', isPlatformAdmin: false, canManageHosts: true, canViewLiveSessions: true, forcePasswordChange: false, sessionVersion: 0 })
describe('current authenticated session boundary', () => {
  beforeEach(() => configureCurrentSessionReader( () => Promise.resolve(state())))
  afterEach(() => configureCurrentSessionReader(undefined))
  it('accepts the current principal and legacy zero version, but not a revoked version', async () => {
    await expect(assertCurrentUserSession(token())).resolves.toBeUndefined()
    const legacy = token(); delete legacy.sessionVersion
    await expect(assertCurrentUserSession(legacy)).resolves.toBeUndefined()
    configureCurrentSessionReader( () => Promise.resolve(({ ...state(), sessionVersion: 1 })))
    await expect(assertCurrentUserSession(legacy)).rejects.toMatchObject({ statusCode: 401 })
    await expect(assertCurrentUserSession(token())).rejects.toMatchObject({ statusCode: 401 })
    await expect(assertCurrentUserSession({ ...token(), sessionVersion: 1 })).resolves.toBeUndefined()
  })
  it.each([{ active: false }, { deletedAt: new Date() }, { tenantActive: false }, { targetTenantActive: false },
    { role: 'USER' as const }, { canManageHosts: false }, { canViewLiveSessions: false }, { isPlatformAdmin: true }, { tenantId: 3 }])('rejects changed or unavailable account state %o', async change => {
    configureCurrentSessionReader( () => Promise.resolve(({ ...state(), ...change })))
    await expect(assertCurrentUserSession(token())).rejects.toMatchObject({ statusCode: 401 })
  })
  it('rejects missing users and malformed identities without querying storage', async () => {
    const reader = vi.fn( () => Promise.resolve(null)); configureCurrentSessionReader(reader)
    await expect(assertCurrentUserSession({ ...token(), sub: '0' })).rejects.toMatchObject({ statusCode: 401 })
    expect(reader).not.toHaveBeenCalled()
    await expect(assertCurrentUserSession(token())).rejects.toMatchObject({ statusCode: 401 })
  })
  it.each([null, '0', false, 1.5, -1])('rejects malformed session version %s before storage access', async version => {
    const reader = vi.fn(() => Promise.resolve(state()))
    configureCurrentSessionReader(reader)
    const malformed = { ...token(), sessionVersion: version } as unknown as JwtPayload
    await expect(assertCurrentUserSession(malformed)).rejects.toMatchObject({ statusCode: 401 })
    expect(reader).not.toHaveBeenCalled()
    configureCurrentSessionReader(undefined)
    await expect(assertCurrentUserSession(malformed)).rejects.toMatchObject({ statusCode: 401 })
  })
  it('fails closed when reader wiring or storage is unavailable', async () => {
    configureCurrentSessionReader(undefined)
    await expect(assertCurrentUserSession(token())).rejects.toMatchObject({ statusCode: 503 })
    configureCurrentSessionReader(() => Promise.reject(new Error('database unavailable')))
    await expect(assertCurrentUserSession(token())).rejects.toMatchObject({ statusCode: 503 })
  })
  it('validates delegated platform identity against its home tenant and current version', async () => {
    configureCurrentSessionReader( () => Promise.resolve(({ ...state(), isPlatformAdmin: true })))
    const delegated = { ...token(), tenantId: 9, actingTenantId: 9, platformTenantId: 2, impersonatedByUserId: 7, isPlatformAdmin: true }
    await expect(assertCurrentUserSession(delegated)).resolves.toBeUndefined()
    await expect(assertCurrentUserSession({ ...delegated, platformTenantId: 9 })).rejects.toMatchObject({ statusCode: 401 })
    await expect(assertCurrentUserSession({ ...delegated, impersonatedByUserId: 8 })).rejects.toMatchObject({ statusCode: 401 })
    configureCurrentSessionReader( () => Promise.resolve(({ ...state(), isPlatformAdmin: false })))
    await expect(assertCurrentUserSession(delegated)).rejects.toMatchObject({ statusCode: 401 })
  })
  it('rechecks native session version and tenant without a fabricated JWT', async () => {
    await expect(assertCurrentUserVersion(7, 2, 0)).resolves.toMatchObject({ role: 'ADMIN' })
    await expect(assertCurrentUserVersion(7, 3, 0)).rejects.toMatchObject({ statusCode: 401 })
    await expect(assertCurrentUserVersion(7, 2, 1)).rejects.toMatchObject({ statusCode: 401 })
  })
  it.each(['true', 1, null])('rejects malformed delegated boolean claims %s', async value => {
    configureCurrentSessionReader( () => Promise.resolve(({ ...state(), isPlatformAdmin: true })))
    const delegated = { ...token(), tenantId: 9, actingTenantId: 9, platformTenantId: 2, impersonatedByUserId: 7, isPlatformAdmin: true }
    for (const field of ['isPlatformAdmin', 'canManageHosts', 'canViewLiveSessions']) {
      await expect(assertCurrentUserSession({ ...delegated, [field]: value })).rejects.toMatchObject({ statusCode: 401 })
    }
  })

})
