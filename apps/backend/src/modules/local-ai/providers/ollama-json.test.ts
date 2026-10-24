import { afterEach, describe, expect, it, vi } from 'vitest'
import { OllamaProvider } from './ollama.provider.js'
afterEach(() => vi.unstubAllGlobals())
describe('Ollama structured terminal response', () => {
  it.each([true, false])('only enables JSON for an explicit structured request: %s', async enabled => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({message:{content:'{}'}})))
    vi.stubGlobal('fetch', fetchMock)
    await new OllamaProvider('http://ollama.test').chat({model:'test',systemPrompt:'Return JSON',userMessage:'comando para ver portas no linux',...(enabled ? {responseFormat:'json' as const} : {})})
    const body = fetchMock.mock.calls[0]?.[1]?.body
    if (typeof body !== 'string') throw new Error('Expected JSON request body')
    const payload = JSON.parse(body) as Record<string, unknown>
    expect(payload.format).toBe(enabled ? 'json' : undefined)
  })
})
