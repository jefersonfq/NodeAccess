import { describe, expect, it, vi } from 'vitest'
import { DURATION_MS_BUCKETS } from '../../shared/metrics.js'
import { OidcObservability } from './oidc-observability.js'

describe('OidcObservability', () => {
  it('records only bounded operational labels for provider operations', () => {
    const registry = { inc: vi.fn(), observe: vi.fn() }
    const observability = new OidcObservability(registry)

    observability.operation('discovery', 'failure', 321)

    expect(registry.inc).toHaveBeenCalledWith(
      'nodeaccess_oidc_operations_total',
      expect.any(String),
      { operation: 'discovery', outcome: 'failure' },
    )
    expect(registry.observe).toHaveBeenCalledWith(
      'nodeaccess_oidc_operation_duration_ms',
      expect.any(String),
      DURATION_MS_BUCKETS,
      321,
      { operation: 'discovery', outcome: 'failure' },
    )
    const labels = registry.inc.mock.calls[0]?.[2]
    expect(labels).toEqual({ operation: 'discovery', outcome: 'failure' })
    expect(labels).not.toHaveProperty('tenant')
    expect(labels).not.toHaveProperty('issuer')
  })

  it.each(['success', 'local_mfa_required', 'rejected', 'error'] as const)(
    'records the safe login outcome %s',
    (outcome) => {
      const registry = { inc: vi.fn(), observe: vi.fn() }
      const observability = new OidcObservability(registry)

      observability.login(outcome)

      expect(registry.inc).toHaveBeenCalledWith(
        'nodeaccess_oidc_logins_total',
        expect.any(String),
        { outcome },
      )
    },
  )
})
