import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { requireAuth, type JwtPayload } from './guards.js'
import { configureCurrentSessionReader } from '../modules/auth/current-session.js'
import { configureTrialPolicy, configureTrialUserReader } from '../modules/trials/trial-policy.js'
const token = { sub: '7', tenantId: 1, role: 'admin', isPlatformAdmin: false, canManageHosts: true, canViewLiveSessions: true, stage: 'authenticated', sessionVersion: 1 } as JwtPayload
beforeEach(() => {
  configureTrialPolicy(() => Promise.resolve(null))
  configureTrialUserReader(() => Promise.resolve(true))
  configureCurrentSessionReader(() => Promise.resolve({ tenantId: 1, active: true, deletedAt: null, tenantActive: true, targetTenantActive: true, sessionVersion: 2, role: 'ADMIN', isPlatformAdmin: false, canManageHosts: true, canViewLiveSessions: true }))
})
afterEach(() => configureCurrentSessionReader(undefined))
function check(path: string, payload = token) {
  return requireAuth({ method: 'POST', url: '/api/v1/auth/' + path, jwtVerify: () => Promise.resolve(payload) } as never, {} as never)
}
describe('Current session guard on authentication exits', () => {
  it('denies stale logout-all rather than invalidating a subsequent login', async () => {
    await expect(check('logout-all')).rejects.toMatchObject({ statusCode: 401 })
  })
  it('still allows local logout with a stale access token', async () => {
    await expect(check('logout')).resolves.toBeUndefined()
  })
  it('denies revoked delegated platform exit', async () => {
    await expect(check('platform/exit-tenant', { ...token, isPlatformAdmin: true, platformTenantId: 1, actingTenantId: 2, tenantId: 2, impersonatedByUserId: 7 })).rejects.toMatchObject({ statusCode: 401 })
  })
  it('accepts current logout-all', async () => {
    await expect(check('logout-all', { ...token, sessionVersion: 2 })).resolves.toBeUndefined()
  })
  it('accepts valid delegated logout-all and denies a forged origin or actor', async () => {
    configureCurrentSessionReader(() => Promise.resolve({ tenantId: 1, active: true, deletedAt: null,
      tenantActive: true, targetTenantActive: true, sessionVersion: 2, role: 'ADMIN',
      isPlatformAdmin: true, canManageHosts: true, canViewLiveSessions: true }))
    const delegated = { ...token, tenantId: 9, platformTenantId: 1, actingTenantId: 9,
      impersonatedByUserId: 7, isPlatformAdmin: true, sessionVersion: 2 }
    await expect(check('logout-all', delegated)).resolves.toBeUndefined()
    await expect(check('logout-all', { ...delegated, platformTenantId: 3 })).rejects.toMatchObject({ statusCode: 401 })
    await expect(check('logout-all', { ...delegated, impersonatedByUserId: 8 })).rejects.toMatchObject({ statusCode: 401 })
    await expect(check('logout-all', { ...delegated, sessionVersion: 1 })).rejects.toMatchObject({ statusCode: 401 })
  })

})
