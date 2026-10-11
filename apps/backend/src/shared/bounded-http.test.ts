import { afterEach, describe, expect, it, vi } from 'vitest'
import { boundedFetch, responsePrefix } from './bounded-http.js'
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('bounded external HTTP', () => {
  it('limits response snippets by bytes and cancels the rest', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(64 * 1024).fill(65)) }, cancel })
    expect(await responsePrefix(new Response(body), 512)).toHaveLength(512)
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('rejects oversized Jira bodies without retaining unbounded chunks', async () => {
    const cancel = vi.fn()
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(1025)) }, cancel })))))
    await expect(boundedFetch('https://test.invalid', {}, 1000, 1024)).rejects.toThrow('exceeds limit')
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('bounds stalled response bodies after headers', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url: unknown, options: RequestInit) => Promise.resolve(new Response(new ReadableStream({ start(controller) { options.signal?.addEventListener('abort', () => controller.error(new Error('deadline'))) } })))))
    const promise = boundedFetch('https://test.invalid', {}, 30)
    const assertion = expect(promise).rejects.toThrow('deadline')
    await vi.advanceTimersByTimeAsync(31)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })
  it('preserves valid JSON and status while releasing the transport', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"ok":true}', { status: 201 }))))
    const response = await boundedFetch('https://test.invalid', {})
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ ok: true })
  })
})
