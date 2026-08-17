export type IntegrationReadinessStatus =
  | 'disabled'
  | 'not_configured'
  | 'validation_required'
  | 'ready'
  | 'unhealthy'
  | 'stale'

export interface IntegrationReadinessInput {
  enabled: boolean
  configured: boolean
  healthStatus?: 'unknown' | 'healthy' | 'unhealthy' | undefined
  healthMessage?: string | null | undefined
  lastCheckedAt?: string | Date | null | undefined
  ttlMs: number
  now?: Date
}

export interface IntegrationReadiness {
  readinessStatus: IntegrationReadinessStatus
  operational: boolean
  readinessMessage: string | null
  healthExpiresAt: Date | null
}

export const INTEGRATION_HEALTH_TTL_MS = {
  openai: 5 * 60_000,
  local_ai: 5 * 60_000,
  jira: 15 * 60_000,
  ldap: 15 * 60_000,
  oidc: 15 * 60_000,
} as const

export function resolveIntegrationReadiness(input: IntegrationReadinessInput): IntegrationReadiness {
  if (!input.enabled) {
    return result('disabled', false, 'Integração desabilitada', null)
  }
  if (!input.configured) {
    return result('not_configured', false, 'Configuração obrigatória incompleta', null)
  }
  if (input.healthStatus === 'unhealthy') {
    return result('unhealthy', false, input.healthMessage ?? 'Último teste operacional falhou', expiry(input))
  }
  if (input.healthStatus !== 'healthy' || !input.lastCheckedAt) {
    return result('validation_required', false, 'Execute o teste operacional antes de disponibilizar a integração', null)
  }

  const expiresAt = expiry(input)
  if (!expiresAt || expiresAt.getTime() <= (input.now ?? new Date()).getTime()) {
    return result('stale', false, 'O teste operacional expirou; execute uma nova validação', expiresAt)
  }
  return result('ready', true, null, expiresAt)
}

function expiry(input: IntegrationReadinessInput): Date | null {
  if (!input.lastCheckedAt) return null
  const checkedAt = new Date(input.lastCheckedAt)
  if (Number.isNaN(checkedAt.getTime())) return null
  return new Date(checkedAt.getTime() + input.ttlMs)
}

function result(
  readinessStatus: IntegrationReadinessStatus,
  operational: boolean,
  readinessMessage: string | null,
  healthExpiresAt: Date | null,
): IntegrationReadiness {
  return { readinessStatus, operational, readinessMessage, healthExpiresAt }
}

export function invalidateIntegrationHealth<T extends object>(config: T): T & {
  healthStatus: 'unknown'
  healthMessage: string
  lastCheckedAt: null
} {
  return {
    ...config,
    healthStatus: 'unknown',
    healthMessage: 'Configuração alterada; execute um novo teste operacional',
    lastCheckedAt: null,
  }
}
