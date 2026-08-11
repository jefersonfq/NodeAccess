import { DURATION_MS_BUCKETS, metrics } from '../../shared/metrics.js'

type OidcOperation = 'discovery' | 'token_exchange' | 'token_validation'
type OidcLoginOutcome = 'success' | 'local_mfa_required' | 'rejected' | 'error'

interface OidcMetricsRegistry {
  inc(name: string, help: string, labels?: Record<string, string>): void
  observe(name: string, help: string, buckets: number[], value: number, labels?: Record<string, string>): void
}

export class OidcObservability {
  constructor(private readonly registry: OidcMetricsRegistry = metrics) {}

  operation(operation: OidcOperation, outcome: 'success' | 'failure', durationMs: number): void {
    const labels = { operation, outcome }
    this.registry.inc(
      'nodeaccess_oidc_operations_total',
      'OIDC operations by stage and outcome without identity or tenant data',
      labels,
    )
    this.registry.observe(
      'nodeaccess_oidc_operation_duration_ms',
      'OIDC operation duration in milliseconds by stage and outcome',
      DURATION_MS_BUCKETS,
      durationMs,
      labels,
    )
  }

  login(outcome: OidcLoginOutcome): void {
    this.registry.inc(
      'nodeaccess_oidc_logins_total',
      'OIDC login completions by public-safe outcome',
      { outcome },
    )
  }
}

export const oidcObservability = new OidcObservability()
