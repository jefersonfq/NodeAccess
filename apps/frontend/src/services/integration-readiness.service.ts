import type { IntegrationReadinessStatus } from '@nodeaccess/shared'

type TagType = 'default' | 'success' | 'warning' | 'error'

const presentation: Record<IntegrationReadinessStatus, { tagType: TagType; translationKey: string }> = {
  disabled: { tagType: 'warning', translationKey: 'admin.integrations.status.disabled' },
  not_configured: { tagType: 'default', translationKey: 'admin.integrations.status.notConfigured' },
  validation_required: { tagType: 'warning', translationKey: 'admin.integrations.status.validationRequired' },
  ready: { tagType: 'success', translationKey: 'admin.integrations.status.ready' },
  unhealthy: { tagType: 'error', translationKey: 'admin.integrations.status.unhealthy' },
  stale: { tagType: 'warning', translationKey: 'admin.integrations.status.stale' },
}

export function integrationReadinessPresentation(status: IntegrationReadinessStatus) {
  return presentation[status]
}
