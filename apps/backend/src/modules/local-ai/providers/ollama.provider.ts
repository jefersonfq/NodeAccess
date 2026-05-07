import type { LocalAiProvider, LocalAiProviderChatInput, LocalAiProviderChatOutput } from '../local-ai.provider.js'

export class OllamaProvider implements LocalAiProvider {
  constructor(private readonly baseUrl: string) {}

  async chat(input: LocalAiProviderChatInput): Promise<LocalAiProviderChatOutput> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: input.model,
        stream: false,
        keep_alive: -1,
        options: { num_predict: 1024, num_ctx: 4096 },
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

    const payload = await response.json() as { message?: { content?: string } }
    const answer = payload.message?.content?.trim()
    if (!answer) throw new Error('Ollama returned an empty answer')
    return { answer }
  }

  async *chatStream(input: LocalAiProviderChatInput): AsyncGenerator<string> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: input.model,
        stream: true,
        keep_alive: -1,
        options: { num_predict: 1024, num_ctx: 4096 },
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
