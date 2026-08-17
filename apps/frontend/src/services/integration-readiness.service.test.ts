import { describe, expect, it } from 'vitest'
import { integrationReadinessPresentation } from './integration-readiness.service'

describe('integration readiness presentation', () => {
  it('uses success exclusively for ready integrations', () => {
    expect(integrationReadinessPresentation('ready').tagType).toBe('success')
    for (const status of ['disabled', 'not_configured', 'validation_required', 'unhealthy', 'stale'] as const) {
      expect(integrationReadinessPresentation(status).tagType).not.toBe('success')
    }
  })
})
