import type { LocalAiProvider, LocalAiProviderChatInput, LocalAiProviderChatOutput } from '../local-ai.provider.js'

export class OpenAiResponsesProvider implements LocalAiProvider {
  constructor(private readonly baseUrl: string, private readonly apiKey: string, private readonly timeoutMs = 60_000) {}

  async chat(input: LocalAiProviderChatInput): Promise<LocalAiProviderChatOutput> {
    const response = await fetch(`${this.baseUrl}/responses`, {
      method: 'POST', signal: signalFor(input.signal, this.timeoutMs),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: input.model, instructions: input.systemPrompt, input: input.userMessage }),
    })
    if (!response.ok) throw new Error(`OpenAI Responses HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
    const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; usage?: { input_tokens?: number; output_tokens?: number } }
    const answer = payload.output_text?.trim() || payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text?.trim()
    if (!answer) throw new Error('OpenAI Responses returned an empty answer')
    return { answer, usage: { ...(payload.usage?.input_tokens !== undefined ? { inputTokens: payload.usage.input_tokens } : {}), ...(payload.usage?.output_tokens !== undefined ? { outputTokens: payload.usage.output_tokens } : {}) } }
  }

  async *chatStream(input: LocalAiProviderChatInput): AsyncGenerator<string> {
    const response = await fetch(`${this.baseUrl}/responses`, {
      method: 'POST', signal: signalFor(input.signal, this.timeoutMs),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: input.model, instructions: input.systemPrompt, input: input.userMessage, stream: true }),
    })
    if (!response.ok) throw new Error(`OpenAI Responses HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`)
    if (!response.body) throw new Error('OpenAI Responses returned no response body')
    for await (const event of sseEvents(response.body)) if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') yield event.delta
  }
}

async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader(); const decoder = new TextDecoder(); let buffer = ''
  while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const chunks = buffer.split('\n\n'); buffer = chunks.pop() ?? ''; for (const chunk of chunks) { const data = chunk.split('\n').find((line) => line.startsWith('data: '))?.slice(6); if (data && data !== '[DONE]') { try { yield JSON.parse(data) as Record<string, unknown> } catch { /* ignore malformed provider event */ } } } }
}

function signalFor(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (!signal) return timeout
  const controller = new AbortController()
  signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  timeout.addEventListener('abort', () => controller.abort(timeout.reason), { once: true })
  return controller.signal
}
