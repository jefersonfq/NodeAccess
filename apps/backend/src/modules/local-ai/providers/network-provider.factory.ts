import type { LocalAiProvider } from '../local-ai.provider.js'
import { AnthropicProvider } from './anthropic.provider.js'
import { OpenAiCompatibleProvider } from './openai-compatible.provider.js'
import { OpenAiResponsesProvider } from './openai-responses.provider.js'

export function createNetworkProvider(kind: string | undefined, baseUrl: string, apiKey: string): LocalAiProvider {
  if (kind === 'openai') return new OpenAiResponsesProvider(baseUrl, apiKey)
  if (kind === 'anthropic') return new AnthropicProvider(baseUrl, apiKey)
  return new OpenAiCompatibleProvider(baseUrl, apiKey)
}
