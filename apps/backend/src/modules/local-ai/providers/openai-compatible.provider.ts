import { trialAiFetch } from '../../trials/trial-outbound.js'
import type { LocalAiProvider, LocalAiProviderChatInput, LocalAiProviderChatOutput } from '../local-ai.provider.js'

const PROVIDER_TIMEOUT_MS = 60_000

export class OpenAiCompatibleProvider implements LocalAiProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs = PROVIDER_TIMEOUT_MS,
    private readonly tenantId?: number,
  ) {}

  async chat(input: LocalAiProviderChatInput): Promise<LocalAiProviderChatOutput> {
    const response = await trialAiFetch(this.tenantId, `${this.baseUrl}/chat/completions`, {
      signal: providerSignal(input.signal, this.timeoutMs),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        temperature: 0.2,
        ...(input.responseFormat === 'json' ? { response_format: {type:'json_object'} } : {}),
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: input.userMessage },
        ],
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`OpenAI-compatible HTTP ${response.status}: ${body.slice(0, 300)}`)
    }

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const answer = payload.choices?.[0]?.message?.content?.trim()
    if (!answer) throw new Error('Network provider returned an empty answer')
    const usage = {
      ...(payload.usage?.prompt_tokens !== undefined ? { inputTokens: payload.usage.prompt_tokens } : {}),
      ...(payload.usage?.completion_tokens !== undefined ? { outputTokens: payload.usage.completion_tokens } : {}),
    }
    return { answer, ...(Object.keys(usage).length ? { usage } : {}) }
  }

  async *chatStream(input: LocalAiProviderChatInput): AsyncGenerator<string> {
    const response = await trialAiFetch(this.tenantId, `${this.baseUrl}/chat/completions`, {
      signal: providerSignal(input.signal, this.timeoutMs),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        temperature: 0.2,
        stream: true,
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: input.userMessage },
        ],
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`OpenAI-compatible HTTP ${response.status}: ${body.slice(0, 300)}`)
    }

    if (!response.body) throw new Error('Network provider returned no response body')

    const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === 'data: [DONE]') continue
        const data = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed
        try {
          const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }
          const token = parsed.choices?.[0]?.delta?.content
          if (token) yield token
        } catch {
          // linha malformada — ignora
        }
      }
    }
  }
}

function providerSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
}
