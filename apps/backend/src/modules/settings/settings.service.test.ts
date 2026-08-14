import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.DATABASE_URL ||= 'mysql://user:pass@127.0.0.1:3306/nodeaccess_test'
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379'
  process.env.JWT_SECRET ||= 'test-jwt-secret-with-at-least-32-chars'
  process.env.PEM_ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  process.env.NODE_ENV ||= 'test'
})
import type { LogRepository } from '../logs/log.repository.js'
import type { SettingsRepository } from './settings.repository.js'
import { SettingsService, type UpdateLicenseEntitlementsInput } from './settings.service.js'

const input: UpdateLicenseEntitlementsInput = {
  maxUsers: 25,
  maxHosts: 20,
  multiConnect: true,
  sessionAuditEnabled: true,
  sessionAuditAiEnabled: true,
  sessionAuditAiProvider: 'automatic',
  sessionAuditAiAutoSummaryEnabled: true,
  featureEntitlements: { integrations: true, sessionAuditAiAutoSummary: true },
  integrationEntitlements: { jira: true, oidc: true },
}

function fixture(activeUsers = 4, hosts = 3) {
  const repository = {
    findTenantById: vi.fn().mockResolvedValue({ id: 7, name: 'Acme', slug: 'acme' }),
    findLicense: vi.fn().mockResolvedValue({
      maxUsers: 25, maxHosts: 20, multiConnect: false, sessionAuditEnabled: false,
      sessionAuditAiEnabled: false, sessionAuditAiProvider: 'automatic', featureEntitlements: { ha: true },
    }),
    countActiveUsers: vi.fn().mockResolvedValue(activeUsers),
    countHosts: vi.fn().mockResolvedValue(hosts),
    countActiveSessions: vi.fn().mockResolvedValue(0),
    updateLicenseEntitlements: vi.fn().mockResolvedValue(undefined),
  } as unknown as SettingsRepository
  const logs = { logAdminEvent: vi.fn().mockResolvedValue(undefined) } as unknown as LogRepository
  return { repository, logs, service: new SettingsService(repository, logs) }
}

describe('SettingsService tenant license boundaries', () => {
  it('rejects user quota below current active consumption without writing', async () => {
    const { service, repository } = fixture(12, 3)
    await expect(service.updateLicenseEntitlements(7, { ...input, maxUsers: 11 }, 9))
      .rejects.toThrow('consumo atual (12)')
    expect(repository.updateLicenseEntitlements).not.toHaveBeenCalled()
  })

  it('rejects host quota below current registered consumption without writing', async () => {
    const { service, repository } = fixture(4, 9)
    await expect(service.updateLicenseEntitlements(7, { ...input, maxHosts: 8 }, 9))
      .rejects.toThrow('consumo atual (9)')
    expect(repository.updateLicenseEntitlements).not.toHaveBeenCalled()
  })

  it('normalizes dependent entitlements server-side and preserves HA', async () => {
    const { service, repository, logs } = fixture()
    await service.updateLicenseEntitlements(7, {
      ...input,
      sessionAuditEnabled: false,
      featureEntitlements: { integrations: false, sessionAuditAiAutoSummary: true },
      integrationEntitlements: { jira: true, oidc: true },
    }, 9)

    expect(repository.updateLicenseEntitlements).toHaveBeenCalledWith(7, expect.objectContaining({
      maxUsers: 25,
      sessionAuditAiEnabled: false,
      featureEntitlements: expect.objectContaining({ ha: true, integrations: false, sessionAuditAiAutoSummary: false }),
      integrationEntitlements: expect.objectContaining({ jira: false, oidc: false }),
    }))
    expect(logs.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({
      adminId: 9, action: 'UPDATE_TENANT_LICENSE', targetType: 'Tenant', targetId: 7,
    }))
  })
})
