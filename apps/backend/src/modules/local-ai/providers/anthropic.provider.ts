import type { LocalAiProvider, LocalAiProviderChatInput, LocalAiProviderChatOutput } from '../local-ai.provider.js'

export class AnthropicProvider implements LocalAiProvider {
  constructor(private readonly baseUrl: string, private readonly apiKey: string, private readonly timeoutMs = 60_000) {}

  async chat(input: LocalAiProviderChatInput): Promise<LocalAiProviderChatOutput> {
    const response = await this.request(input, false)
    if (!response.ok) throw new Error(`Anthropic Messages HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
    const payload = await response.json() as { content?: Array<{ type?: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } }
    const answer = payload.content?.find((item) => item.type === 'text')?.text?.trim()
    if (!answer) throw new Error('Anthropic Messages returned an empty answer')
    return { answer, usage: { ...(payload.usage?.input_tokens !== undefined ? { inputTokens: payload.usage.input_tokens } : {}), ...(payload.usage?.output_tokens !== undefined ? { outputTokens: payload.usage.output_tokens } : {}) } }
  }

  async *chatStream(input: LocalAiProviderChatInput): AsyncGenerator<string> {
    const response = await this.request(input, true)
    if (!response.ok) throw new Error(`Anthropic Messages HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
    if (!response.body) throw new Error('Anthropic Messages returned no response body')
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''
    while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const chunks = buffer.split('\n\n'); buffer = chunks.pop() ?? ''; for (const chunk of chunks) { const data = chunk.split('\n').find((line) => line.startsWith('data: '))?.slice(6); if (!data) continue; try { const event = JSON.parse(data) as { type?: string; delta?: { type?: string; text?: string } }; if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) yield event.delta.text } catch { /* ignore malformed provider event */ } } }
  }

  private request(input: LocalAiProviderChatInput, stream: boolean) {
    return fetch(`${this.baseUrl}/messages`, { method: 'POST', signal: providerSignal(input.signal, this.timeoutMs), headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: input.model, max_tokens: 4096, system: input.systemPrompt, messages: [{ role: 'user', content: input.userMessage }], stream }) })
  }
}

function providerSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (!signal) return timeout
  const controller = new AbortController()
  signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  timeout.addEventListener('abort', () => controller.abort(timeout.reason), { once: true })
  return controller.signal
}
