export type TerminalAiFailure = 'timeout' | 'network' | 'format' | 'license' | 'permission' | 'rateLimit' | 'configuration' | 'unavailable'
export function terminalAiFailure(error: unknown): TerminalAiFailure {
  const value = error as {code?: string; response?: {status?: number; data?: {code?: string}}}
  const code = value?.response?.data?.code ?? value?.code
  const status = value?.response?.status
  if (code === 'AI_TIMEOUT' || code === 'ECONNABORTED' || code === 'ERR_CANCELED' || status === 504) return 'timeout'
  if (code === 'AI_RESPONSE_INVALID') return 'format'
  if (code === 'AI_LICENSE') return 'license'
  if (code === 'AI_PROVIDER_CONFIGURATION') return 'configuration'
  if (status === 401 || status === 403) return 'permission'
  if (status === 429) return 'rateLimit'
  if (!status) return 'network'
  return 'unavailable'
}
export function canRetryTerminalAi(failure: TerminalAiFailure): boolean {
  return !['license','permission','configuration'].includes(failure)
}
