/** Opt-in real SQL + API regression: admin-created SaaS tenants never become trials. */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import speakeasy from 'speakeasy'
import { TenantService } from '../tenants/tenant.service.js'
import { TenantRepository } from '../tenants/tenant.repository.js'

const enabled = process.env.TRIAL_NORMAL_REAL === '1'
describe.skipIf(!enabled)('normal administrative tenant after trial flag activation', () => {
  const db = new PrismaClient()
  let tenantId: number | undefined
  afterAll(async () => {
    if (tenantId) {
      await db.adminLog.deleteMany({ where: { admin: { tenantId } } })
      await db.authLog.deleteMany({ where: { user: { tenantId } } })
      await db.resourceAclEntry.deleteMany({ where: { tenantId } })
      await db.inventoryNode.deleteMany({ where: { tenantId, type: 'HOST' } })
      await db.inventoryNode.deleteMany({ where: { tenantId } })
      await db.host.deleteMany({ where: { tenantId } })
      await db.license.deleteMany({ where: { tenantId } })
      await db.user.deleteMany({ where: { tenantId } })
      await db.tenant.delete({ where: { id: tenantId } })
    }
    await db.$disconnect()
  })
  it('preserves ordinary temporary password, MFA, host creation and tenant data without trial metadata', async () => {
    const url = new URL(process.env.DATABASE_URL!)
    expect(url.hostname).toBe('127.0.0.1'); expect(url.port).toBe('32770'); expect(url.pathname).toBe('/na0068')
    expect(process.env.TRIAL_REGISTRATION_ENABLED).toBe('true')
    const slug = `saas-after-trial-${randomUUID().slice(0,8)}`
    const email = `${slug}@example.test`
    const created = await new TenantService(new TenantRepository(db)).create({ name: 'Ordinary SaaS after trial activation', slug, active: true, maxUsers: 5, firstAdmin: { name: 'Ordinary administrator', email } })
    tenantId = created.tenant.id
    let admin = await db.user.findFirstOrThrow({ where: { tenantId, email } })
    expect(admin).toMatchObject({ role: 'ADMIN', active: true, mfaEnabled: false, forcePasswordChange: true })
    expect(await db.trialRegistration.findUnique({ where: { tenantId } })).toBeNull()
    const post = (path: string, body: unknown, token?: string) => fetch(`http://127.0.0.1:3193/api/v1${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
    const login = await post('/auth/login', { email, password: created.firstAdminTemporaryPassword, tenantSlug: slug })
    expect(login.status).toBe(200)
    const loginBody = await login.json() as { requiresMfaSetup: boolean; tempToken: string }
    expect(loginBody.requiresMfaSetup).toBe(true)
    expect((await post('/auth/setup-totp', { setupToken: loginBody.tempToken })).status).toBe(200)
    admin = await db.user.findUniqueOrThrow({ where: { id: admin.id } })
    const confirmation = await post('/auth/confirm-totp', { setupToken: loginBody.tempToken, token: speakeasy.totp({ secret: admin.mfaSecret!, encoding: 'base32' }) })
    expect(confirmation.status).toBe(200)
    const tokens = await confirmation.json() as { accessToken: string }
    expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).mfaEnabled).toBe(true)
    // Inventory bootstrap is the same API used by the ordinary Hosts screen.
    const headers = { authorization: `Bearer ${tokens.accessToken}` }
    expect((await fetch('http://127.0.0.1:3193/api/v1/hosts', { headers })).status).toBe(200)
    const root = await db.inventoryNode.findFirstOrThrow({ where: { rootTenantId: tenantId } })
    const added = await post('/hosts', { name: 'Ordinary customer host', ip: '192.0.2.90', port: 22, sshUser: 'customer', authType: 'password', password: 'Synthetic-unused-host-2026', connectionMode: 'direct', scope: 'global', inventoryParentId: root.id }, tokens.accessToken)
    expect(added.status).toBe(201)
    expect(await db.host.count({ where: { tenantId, name: 'Ordinary customer host' } })).toBe(1)
    expect(await db.trialRegistration.findUnique({ where: { tenantId } })).toBeNull()
    expect((await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).active).toBe(true)
  }, 30000)
})
