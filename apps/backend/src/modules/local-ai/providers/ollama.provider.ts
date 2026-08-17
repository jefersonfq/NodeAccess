import type { LocalAiProvider, LocalAiProviderChatInput, LocalAiProviderChatOutput } from '../local-ai.provider.js'

const OLLAMA_CHAT_OPTIONS = { num_predict: 512, num_ctx: 2048 }
const PROVIDER_TIMEOUT_MS = 60_000

export class OllamaProvider implements LocalAiProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = PROVIDER_TIMEOUT_MS,
  ) {}

  async chat(input: LocalAiProviderChatInput): Promise<LocalAiProviderChatOutput> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      signal: providerSignal(input.signal, this.timeoutMs),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: input.model,
        stream: false,
        keep_alive: -1,
        options: OLLAMA_CHAT_OPTIONS,
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: input.userMessage },
        ],
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Ollama HTTP ${response.status}: ${body.slice(0, 300)}`)
    }

    const payload = await response.json() as {
      message?: { content?: string }
      prompt_eval_count?: number
      eval_count?: number
    }
    const answer = payload.message?.content?.trim()
    if (!answer) throw new Error('Ollama returned an empty answer')
    const usage = {
      ...(payload.prompt_eval_count !== undefined ? { inputTokens: payload.prompt_eval_count } : {}),
      ...(payload.eval_count !== undefined ? { outputTokens: payload.eval_count } : {}),
    }
    return { answer, ...(Object.keys(usage).length ? { usage } : {}) }
  }

  async *chatStream(input: LocalAiProviderChatInput): AsyncGenerator<string> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      signal: providerSignal(input.signal, this.timeoutMs),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: input.model,
        stream: true,
        keep_alive: -1,
        options: OLLAMA_CHAT_OPTIONS,
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: input.userMessage },
        ],
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Ollama HTTP ${response.status}: ${body.slice(0, 300)}`)
    }

    if (!response.body) throw new Error('Ollama returned no response body')

    const reader = response.body.getReader()
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
        if (!trimmed) continue
        try {
          const parsed = JSON.parse(trimmed) as { message?: { content?: string }; done?: boolean }
          if (parsed.message?.content) yield parsed.message.content
        } catch {
          // linha malformada — ignora
        }
      }
    }
  }
}

function providerSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (!signal) return timeout
  if (signal.aborted) return signal
  const controller = new AbortController()
  signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  timeout.addEventListener('abort', () => controller.abort(timeout.reason), { once: true })
  return controller.signal
}
