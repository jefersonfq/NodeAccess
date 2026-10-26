import type { LocalAiProvider } from '../local-ai.provider.js'
import { AnthropicProvider } from './anthropic.provider.js'
import { OpenAiCompatibleProvider } from './openai-compatible.provider.js'
import { OpenAiResponsesProvider } from './openai-responses.provider.js'

export function createNetworkProvider(kind: string | undefined, baseUrl: string, apiKey: string, tenantId?: number): LocalAiProvider {
  if (kind === 'openai') return new OpenAiResponsesProvider(baseUrl, apiKey, undefined, tenantId)
  if (kind === 'anthropic') return new AnthropicProvider(baseUrl, apiKey, undefined, tenantId)
  return new OpenAiCompatibleProvider(baseUrl, apiKey, undefined, tenantId)
}
