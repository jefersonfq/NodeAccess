import { afterEach, describe, expect, it, vi } from 'vitest'
import { terminalAssistJsonSchema } from '../terminal-assist-contract.js'
import { OllamaProvider } from './ollama.provider.js'
import { createNetworkProvider } from './network-provider.factory.js'

afterEach(() => vi.unstubAllGlobals())

describe('native AI provider adapters', () => {
  it.each(['ollama','openai','openai_compatible','anthropic'])('uses a structured envelope for %s', async kind => {
    const fetchMock=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({message:{content:'{}'},output_text:'{}',content:[{type:'text',text:'{}'}],choices:[{message:{content:'{}'}}]})))
    vi.stubGlobal('fetch',fetchMock)
    const provider=kind==='ollama'?new OllamaProvider('http://fixture'):createNetworkProvider(kind,'http://fixture','secret')
    await provider.chat({model:'fixture',systemPrompt:'Return JSON',userMessage:'ports',responseFormat:'json',responseSchema:terminalAssistJsonSchema})
    const body = fetchMock.mock.calls[0]?.[1]?.body
    if (typeof body !== 'string') throw new Error('Expected JSON request body')
    const payload = JSON.parse(body) as Record<string, unknown>
    if(kind==='ollama')expect(payload.format).toEqual(terminalAssistJsonSchema)
    if(kind==='openai')expect(payload.text).toMatchObject({format:{type:'json_schema',schema:terminalAssistJsonSchema}})
    if(kind==='openai_compatible')expect(payload.response_format).toEqual({type:'json_object'})
    if(kind==='anthropic')expect(payload.output_config).toEqual({format:{type:'json_schema',schema:terminalAssistJsonSchema}})
  })
  it.each(['ollama','openai','openai_compatible','anthropic'])('forwards a pre-aborted request for %s', async kind => {
    const fetchMock=vi.fn<typeof fetch>().mockImplementation((_url,options)=>{try { options?.signal?.throwIfAborted() } catch (error) { return Promise.reject(error instanceof Error ? error : new Error('Aborted')) }; return Promise.resolve(new Response('{}'))})
    vi.stubGlobal('fetch',fetchMock)
    const controller=new AbortController();controller.abort()
    const provider=kind==='ollama'?new OllamaProvider('http://fixture'):createNetworkProvider(kind,'http://fixture','secret')
    await expect(provider.chat({model:'fixture',systemPrompt:'Return JSON',userMessage:'ports',signal:controller.signal})).rejects.toThrow()
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  })

  it('uses OpenAI Responses contract and extracts usage', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ output_text: 'ok', usage: { input_tokens: 4, output_tokens: 2 } }), { status: 200 })))
    vi.stubGlobal('fetch', fetchMock)
    const result = await createNetworkProvider('openai', 'https://api.openai.test/v1', 'secret').chat({ model: 'gpt-test', systemPrompt: 'system', userMessage: 'hello' })
    expect(result).toEqual({ answer: 'ok', usage: { inputTokens: 4, outputTokens: 2 } })
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ model: 'gpt-test', instructions: 'system', input: 'hello' })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.openai.test/v1/responses')
  })

  it('uses Anthropic Messages contract', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: 'safe answer' }], usage: { input_tokens: 5, output_tokens: 3 } }), { status: 200 })))
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
