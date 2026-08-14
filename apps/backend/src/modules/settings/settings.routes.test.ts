import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { SettingsController } from './settings.controller.js'
import { settingsRoutes } from './settings.routes.js'
import type { SettingsService } from './settings.service.js'

const payload = {
  maxUsers: 25, maxHosts: 20, multiConnect: true,
  sessionAuditEnabled: true, sessionAuditAiEnabled: false,
  sessionAuditAiProvider: 'automatic', sessionAuditAiAutoSummaryEnabled: false,
  featureEntitlements: { integrations: true }, integrationEntitlements: { jira: true },
}

async function appFor(isPlatformAdmin: boolean) {
  const license = { ...payload, activeUsers: 4, registeredHosts: 3, hasKey: false }
  const service = {
    get: vi.fn().mockResolvedValue({ tenant: { id: 7 }, environment: { features: {} }, license }),
    getPlatformSettings: vi.fn().mockReturnValue({ features: { localAi: false } }),
    getTenantLicense: vi.fn().mockResolvedValue(license),
    updateLicenseEntitlements: vi.fn().mockResolvedValue({ license }),
  }
  const app = Fastify()
  app.decorateRequest('jwtVerify', function () {
    return Promise.resolve({
      sub: '11', email: 'admin@example.test', role: 'admin', isPlatformAdmin, tenantId: 7,
      canManageHosts: true, canViewLiveSessions: true, forcePasswordChange: false, stage: 'authenticated',
    })
  })
  await app.register(async (instance) => {
    await settingsRoutes(instance, new SettingsController(service as unknown as SettingsService))
  })
  return { app, service }
}

describe('settings platform isolation routes', () => {
  it.each([
    ['GET', '/platform'],
    ['GET', '/platform/tenants/12/license'],
    ['PATCH', '/platform/tenants/12/license'],
    ['PATCH', '/license'],
  ] as const)('forbids tenant administrators on %s %s', async (method, url) => {
    const { app, service } = await appFor(false)
    try {
      const response = await app.inject({ method, url, payload: method === 'PATCH' ? payload : undefined })
      expect(response.statusCode).toBe(403)
      expect(service.updateLicenseEntitlements).not.toHaveBeenCalled()
    } finally { await app.close() }
  })

  it('updates the explicitly selected tenant as a platform administrator', async () => {
    const { app, service } = await appFor(true)
    try {
      const response = await app.inject({ method: 'PATCH', url: '/platform/tenants/12/license', payload })
      expect(response.statusCode).toBe(200)
      expect(service.updateLicenseEntitlements).toHaveBeenCalledWith(12, payload, 11)
    } finally { await app.close() }
  })

  it('does not disclose platform environment in tenant settings to a tenant administrator', async () => {
    const { app } = await appFor(false)
    try {
      const response = await app.inject({ method: 'GET', url: '/' })
      expect(response.statusCode).toBe(200)
      expect(response.json()).not.toHaveProperty('environment')
    } finally { await app.close() }
  })
})
