import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_INSTALLATION_AUTH_POLICY,
  DEFAULT_TENANT_AUTH_POLICY,
  resolveTenantAuthPolicy,
} from './auth-policy.js'
import { TenantAuthPolicyController } from './tenant-auth-policy.controller.js'
import { tenantAuthPolicyRoutes } from './tenant-auth-policy.routes.js'
import type { TenantAuthPolicyService } from './tenant-auth-policy.service.js'

const responsePolicy = {
  requested: DEFAULT_TENANT_AUTH_POLICY,
  effective: resolveTenantAuthPolicy(DEFAULT_INSTALLATION_AUTH_POLICY, DEFAULT_TENANT_AUTH_POLICY),
  enforcementEnabled: false,
  ssoRequiredEnforced: true,
  localLoginEnforced: true,
  emailTenantDiscoveryEnforced: true,
  lockoutPolicyEnforced: true,
  tokenLifetimeEnforced: true,
}

async function appFor(role: 'admin' | 'user' = 'admin') {
  const service = {
    get: vi.fn().mockResolvedValue(responsePolicy),
    update: vi.fn().mockResolvedValue(responsePolicy),
    getBreakGlass: vi.fn().mockResolvedValue({ configured: false, userId: null, email: null, validatedAt: null }),
    validateBreakGlass: vi.fn().mockResolvedValue({ configured: true, userId: 20, email: 'rescue@example.test', validatedAt: new Date() }),
  }
  const app = Fastify()
  app.decorateRequest('jwtVerify', function () {
    return Promise.resolve({
      sub: '11', email: 'admin@example.test', role, isPlatformAdmin: false, tenantId: 7,
      canManageHosts: true, canViewLiveSessions: true, forcePasswordChange: false, stage: 'authenticated',
    })
  })
  await app.register(async (instance) => {
    await tenantAuthPolicyRoutes(instance, new TenantAuthPolicyController(service as unknown as TenantAuthPolicyService))
  })
  return { app, service }
}

describe('tenant authentication policy HTTP routes', () => {
  it('reads policy only from the authenticated tenant', async () => {
    const { app, service } = await appFor()
    try {
      const response = await app.inject({ method: 'GET', url: '/' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        enforcementEnabled: false,
        ssoRequiredEnforced: true,
        localLoginEnforced: true,
        emailTenantDiscoveryEnforced: true,
        lockoutPolicyEnforced: true,
        tokenLifetimeEnforced: true,
      })
      expect(service.get).toHaveBeenCalledWith(7)
    } finally { await app.close() }
  })

  it('forbids non-administrators', async () => {
    const { app, service } = await appFor('user')
    try {
      const response = await app.inject({ method: 'GET', url: '/' })
      expect(response.statusCode).toBe(403)
      expect(service.get).not.toHaveBeenCalled()
    } finally { await app.close() }
  })

  it.each([
    { ...DEFAULT_TENANT_AUTH_POLICY, lockoutMaxAttempts: 0 },
    { ...DEFAULT_TENANT_AUTH_POLICY, refreshTokenDays: 366 },
    { ...DEFAULT_TENANT_AUTH_POLICY, mfaRequired: 'yes' },
  ])('rejects policy values outside the public contract', async (payload) => {
    const { app, service } = await appFor()
    try {
      const response = await app.inject({ method: 'PUT', url: '/', payload })
      expect(response.statusCode).toBe(400)
      expect(service.update).not.toHaveBeenCalled()
    } finally { await app.close() }
  })

  it('forwards tenant and administrator identity on update', async () => {
    const { app, service } = await appFor()
    try {
      const response = await app.inject({ method: 'PUT', url: '/', payload: DEFAULT_TENANT_AUTH_POLICY })
      expect(response.statusCode).toBe(200)
      expect(service.update).toHaveBeenCalledWith(7, 11, DEFAULT_TENANT_AUTH_POLICY)
    } finally { await app.close() }
  })

  it('validates break-glass credentials inside the authenticated tenant', async () => {
    const { app, service } = await appFor()
    try {
      const response = await app.inject({
        method: 'POST', url: '/break-glass/validate',
        payload: { email: 'rescue@example.test', password: 'current-password' },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ configured: true, userId: 20 })
      expect(service.validateBreakGlass).toHaveBeenCalledWith(7, 11, 'rescue@example.test', 'current-password')
    } finally { await app.close() }
  })

  it('rejects malformed break-glass credentials before service execution', async () => {
    const { app, service } = await appFor()
    try {
      const response = await app.inject({ method: 'POST', url: '/break-glass/validate', payload: { email: 'invalid', password: '' } })
      expect(response.statusCode).toBe(400)
      expect(service.validateBreakGlass).not.toHaveBeenCalled()
    } finally { await app.close() }
  })
})
