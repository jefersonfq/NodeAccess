export type LocalAiRoutedProvider = 'ollama' | 'openai_compatible'

export interface LocalAiProviderAttempt {
  provider: LocalAiRoutedProvider
  status: 'succeeded' | 'failed' | 'circuit_open'
  durationMs: number
  errorKind?: 'rate_limited' | 'timeout' | 'unavailable' | 'other'
}

interface CircuitState {
  failures: number
  openUntil: number
}

export class LocalAiProviderRouter {
  private readonly circuits = new Map<string, CircuitState>()

  constructor(private readonly options: {
    failureThreshold?: number
    cooldownMs?: number
    now?: () => number
  } = {}) {}

  async execute<T>(input: {
    tenantId: number
    candidates: LocalAiRoutedProvider[]
    operation: (provider: LocalAiRoutedProvider) => Promise<T>
  }): Promise<{ value: T; provider: LocalAiRoutedProvider; attempts: LocalAiProviderAttempt[] }> {
    const attempts: LocalAiProviderAttempt[] = []
    let lastError: unknown = new Error('Nenhum provider de IA disponível')
    for (const provider of input.candidates) {
      const key = `${input.tenantId}:${provider}`
      const circuit = this.circuits.get(key)
      if (circuit && circuit.openUntil > this.now()) {
        attempts.push({ provider, status: 'circuit_open', durationMs: 0 })
        continue
      }
      const startedAt = performance.now()
      try {
        const value = await input.operation(provider)
        this.circuits.delete(key)
        attempts.push({ provider, status: 'succeeded', durationMs: Math.round(performance.now() - startedAt) })
        return { value, provider, attempts }
      } catch (error) {
        lastError = error
        const nextFailures = (circuit?.failures ?? 0) + 1
        this.circuits.set(key, {
          failures: nextFailures,
          openUntil: nextFailures >= (this.options.failureThreshold ?? 3)
            ? this.now() + (this.options.cooldownMs ?? 30_000)
            : 0,
        })
        attempts.push({
          provider,
          status: 'failed',
          durationMs: Math.round(performance.now() - startedAt),
          errorKind: classifyProviderError(error),
        })
      }
    }
    throw Object.assign(lastError instanceof Error ? lastError : new Error('Falha nos providers de IA'), { providerAttempts: attempts })
  }

  reset(tenantId?: number): void {
    if (tenantId === undefined) this.circuits.clear()
    else for (const key of this.circuits.keys()) if (key.startsWith(`${tenantId}:`)) this.circuits.delete(key)
  }

  getCircuitStatus(tenantId: number, provider: LocalAiRoutedProvider): 'closed' | 'open' {
    const circuit = this.circuits.get(`${tenantId}:${provider}`)
    return circuit && circuit.openUntil > this.now() ? 'open' : 'closed'
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
}

function classifyProviderError(error: unknown): NonNullable<LocalAiProviderAttempt['errorKind']> {
  const message = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : String(error).toLowerCase()
  if (/http 429|rate.?limit/.test(message)) return 'rate_limited'
  if (/timeout|timed out|aborterror/.test(message)) return 'timeout'
  if (/http 5\d\d|econnrefused|fetch failed|unavailable/.test(message)) return 'unavailable'
  return 'other'
}
