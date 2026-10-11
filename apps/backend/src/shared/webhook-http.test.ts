import { afterEach, expect, it, vi } from 'vitest'
import { promises as dns } from 'node:dns'
import { sendPublicWebhook } from './webhook-http.js'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('limits response consumption and forces redirects off', async () => {
  let cancelled = false
  const fetcher = vi.fn().mockResolvedValue(new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1024).fill(65)) },
    cancel() { cancelled = true },
  })))
  vi.stubGlobal('fetch', fetcher)
  const response = await sendPublicWebhook('https://8.8.8.8/', { redirect: 'follow', method: 'POST', body: '{}' })
  expect(response.snippet.length).toBe(512)
  expect(cancelled).toBe(true)
  expect(fetcher.mock.calls[0]![1]).toMatchObject({ redirect: 'error', dispatcher: expect.anything() as unknown })
})
it('actual fetch transport blocks DNS resolving to a private address', async () => {
  vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '127.0.0.1', family: 4 }] as never)
  await expect(sendPublicWebhook('http://receiver.invalid:19089/', { signal: AbortSignal.timeout(2000) })).rejects.toMatchObject({ cause: { name: 'SsrfBlockedError' } })
})
