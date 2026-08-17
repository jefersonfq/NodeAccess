import { describe, expect, it } from 'vitest'
import { invalidateIntegrationHealth, resolveIntegrationReadiness } from './integration-readiness.js'

const now = new Date('2026-08-15T12:00:00.000Z')

describe('integration readiness', () => {
  it.each([
    [{ enabled: false, configured: true }, 'disabled'],
    [{ enabled: true, configured: false }, 'not_configured'],
    [{ enabled: true, configured: true, healthStatus: 'unknown' as const }, 'validation_required'],
    [{ enabled: true, configured: true, healthStatus: 'unhealthy' as const }, 'unhealthy'],
  ])('resolves unavailable state %#', (partial, expected) => {
    const result = resolveIntegrationReadiness({ ...partial, ttlMs: 60_000, now })
    expect(result.readinessStatus).toBe(expected)
    expect(result.operational).toBe(false)
  })

  it('is ready only while a successful check is fresh', () => {
    const result = resolveIntegrationReadiness({
      enabled: true,
      configured: true,
      healthStatus: 'healthy',
      lastCheckedAt: '2026-08-15T11:59:30.000Z',
      ttlMs: 60_000,
      now,
    })
    expect(result).toMatchObject({ readinessStatus: 'ready', operational: true })
    expect(result.healthExpiresAt?.toISOString()).toBe('2026-08-15T12:00:30.000Z')
  })

  it('expires a formerly healthy integration', () => {
    expect(resolveIntegrationReadiness({
      enabled: true,
      configured: true,
      healthStatus: 'healthy',
      lastCheckedAt: '2026-08-15T11:58:00.000Z',
      ttlMs: 60_000,
      now,
    })).toMatchObject({ readinessStatus: 'stale', operational: false })
  })

  it('invalidates health after configuration changes', () => {
    expect(invalidateIntegrationHealth({ healthStatus: 'healthy', lastCheckedAt: now.toISOString(), model: 'a' })).toEqual({
      healthStatus: 'unknown',
      healthMessage: 'Configuração alterada; execute um novo teste operacional',
      lastCheckedAt: null,
      model: 'a',
    })
  })
})
