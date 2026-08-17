import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalAiProviderRouter } from '../local-ai-provider-router.js'
import { OpenAiCompatibleProvider } from './openai-compatible.provider.js'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

describe('provider failover over real HTTP transport', () => {
  it.each([
    { name: 'rate limit', status: 429, kind: 'rate_limited' },
    { name: 'provider unavailable', status: 503, kind: 'unavailable' },
  ])('falls back after $name', async ({ status, kind }) => {
    const failing = await startProvider((_request, response) => response.writeHead(status).end('provider error'))
    const healthy = await startProvider((_request, response) => respondOk(response, 'fallback-ok'))
    const providers = {
      ollama: new OpenAiCompatibleProvider(failing, 'test-key', 500),
      openai_compatible: new OpenAiCompatibleProvider(healthy, 'test-key', 500),
    }

    const result = await new LocalAiProviderRouter().execute({
      tenantId: 1,
      candidates: ['ollama', 'openai_compatible'],
      operation: (provider) => providers[provider].chat(prompt),
    })

    expect(result.value.answer).toBe('fallback-ok')
    expect(result.attempts).toEqual([
      expect.objectContaining({ provider: 'ollama', status: 'failed', errorKind: kind }),
      expect.objectContaining({ provider: 'openai_compatible', status: 'succeeded' }),
    ])
  })

  it('falls back on a provider timeout and accepts it again after recovery', async () => {
    let delayed = true
    const primaryUrl = await startProvider((_request, response) => {
      if (delayed) setTimeout(() => respondOk(response, 'late'), 150)
      else respondOk(response, 'primary-recovered')
    })
    const fallbackUrl = await startProvider((_request, response) => respondOk(response, 'fallback-ok'))
    const primary = new OpenAiCompatibleProvider(primaryUrl, 'test-key', 30)
    const fallback = new OpenAiCompatibleProvider(fallbackUrl, 'test-key', 100)
    let now = 1_000
    const router = new LocalAiProviderRouter({ failureThreshold: 1, cooldownMs: 50, now: () => now })

    const first = await router.execute({
      tenantId: 1,
      candidates: ['ollama', 'openai_compatible'],
      operation: (provider) => provider === 'ollama' ? primary.chat(prompt) : fallback.chat(prompt),
    })
    expect(first.provider).toBe('openai_compatible')
    expect(first.attempts[0]).toMatchObject({ errorKind: 'timeout' })

    delayed = false
    now += 51
    const recovered = await router.execute({
      tenantId: 1,
      candidates: ['ollama', 'openai_compatible'],
      operation: (provider) => provider === 'ollama' ? primary.chat(prompt) : fallback.chat(prompt),
    })
    expect(recovered.provider).toBe('ollama')
    expect(recovered.value.answer).toBe('primary-recovered')
  })

  it('cancels an active stream when the browser disconnects', async () => {
    const providerUrl = await startProvider((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"choices":[{"delta":{"content":"first"}}]}\n\n')
    })
    const provider = new OpenAiCompatibleProvider(providerUrl, 'test-key', 5_000)
    const abort = new AbortController()
    const stream = provider.chatStream({ ...prompt, signal: abort.signal })

    await expect(stream.next()).resolves.toMatchObject({ value: 'first', done: false })
    abort.abort()
    await expect(stream.next()).rejects.toMatchObject({ name: 'AbortError' })
  })
})

const prompt = { model: 'test-model', systemPrompt: 'system', userMessage: 'user' }

async function startProvider(handler: Parameters<typeof createServer>[0]): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test provider did not bind to a TCP port')
  return `http://127.0.0.1:${address.port}`
}

function respondOk(response: Parameters<NonNullable<Parameters<typeof createServer>[0]>>[1], answer: string): void {
  if (response.destroyed) return
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({
    choices: [{ message: { content: answer } }],
    usage: { prompt_tokens: 5, completion_tokens: 2 },
  }))
}
