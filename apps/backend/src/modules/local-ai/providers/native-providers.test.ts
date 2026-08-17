import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNetworkProvider } from './network-provider.factory.js'

afterEach(() => vi.unstubAllGlobals())

describe('native AI provider adapters', () => {
  it('uses OpenAI Responses contract and extracts usage', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ output_text: 'ok', usage: { input_tokens: 4, output_tokens: 2 } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await createNetworkProvider('openai', 'https://api.openai.test/v1', 'secret').chat({ model: 'gpt-test', systemPrompt: 'system', userMessage: 'hello' })
    expect(result).toEqual({ answer: 'ok', usage: { inputTokens: 4, outputTokens: 2 } })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ model: 'gpt-test', instructions: 'system', input: 'hello' })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.openai.test/v1/responses')
  })

  it('uses Anthropic Messages contract', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'safe answer' }], usage: { input_tokens: 5, output_tokens: 3 } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await createNetworkProvider('anthropic', 'https://api.anthropic.test/v1', 'secret').chat({ model: 'claude-test', systemPrompt: 'system', userMessage: 'hello' })
    expect(result.answer).toBe('safe answer')
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'x-api-key': 'secret', 'anthropic-version': '2023-06-01' })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.anthropic.test/v1/messages')
  })

  it('keeps generic OpenAI-compatible deployments isolated behind the fallback adapter', () => {
    expect(createNetworkProvider('openai_compatible', 'https://gateway.test/v1', 'secret').constructor.name).toBe('OpenAiCompatibleProvider')
  })
})
