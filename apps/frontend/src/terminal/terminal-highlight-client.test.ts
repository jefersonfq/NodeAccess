import { reactive } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HighlightPool, HighlightError, type HighlightWorker } from './terminal-highlight-client'
import { evaluateHighlights, type HighlightRequest } from './terminal-highlight-engine'
import type { TerminalHighlightRule } from '@nodeaccess/shared'
const rule: TerminalHighlightRule = { id: 'r', name: 'Error', pattern: 'ERROR', mode: 'literal', caseSensitive: true, wholeWord: false, foreground: 'red', background: null, bold: false, enabled: true, priority: 50 }
const request = (text = 'ERROR'): HighlightRequest => ({ rows: [{ key: '0', text, rules: [rule] }] })
class FakeWorker implements HighlightWorker {
  onmessage: HighlightWorker['onmessage'] = null
  onerror: HighlightWorker['onerror'] = null
  onmessageerror: HighlightWorker['onmessageerror'] = null
  posted: { id: number; request: HighlightRequest }[] = []
  terminate = vi.fn()
  postMessage(value: { id: number; request: HighlightRequest }): void { this.posted.push(structuredClone(value)) }
  ready(): void { this.onmessage?.({ data: { ready: true } } as MessageEvent) }
  reply(index = 0): void { const job = this.posted[index]; this.onmessage?.({ data: { id: job.id, result: evaluateHighlights(job.request) } } as MessageEvent) }
}
function fixture() {
  const workers: FakeWorker[] = []
  const pool = new HighlightPool(() => { const worker = new FakeWorker(); workers.push(worker); return worker })
  return { pool, workers }
}
afterEach(() => vi.useRealTimers())
describe('isolated highlight scheduling', () => {
  it('starts lazily, separates readiness and shares one worker across clients', async () => {
    const { pool, workers } = fixture(); const a = pool.client(), b = pool.client()
    expect(workers).toHaveLength(0)
    const first = a.run(request()), second = b.run(request())
    expect(workers).toHaveLength(1); expect(workers[0].posted).toHaveLength(0)
    workers[0].ready(); workers[0].reply(); workers[0].reply(1)
    expect((await first).rows[0].ranges).toHaveLength(1); await second
    a.dispose(); expect(workers[0].terminate).not.toHaveBeenCalled(); b.dispose(); expect(workers[0].terminate).toHaveBeenCalledOnce()
  })
  it('snapshots reactive Vue input into cloneable primitives before crossing the worker boundary', async () => {
    const { pool, workers } = fixture(); const a = pool.client()
    const source = reactive(request())
    const result = a.run(source); source.rows[0].text = 'changed'
    workers[0].ready(); workers[0].reply()
    expect((await result).rows[0].ranges).toHaveLength(1)
    expect(workers[0].posted[0].request.rows[0].text).toBe('ERROR'); a.dispose()
  })
  it('terminates a hung job and suspends all owners without recreating a worker', async () => {
    vi.useFakeTimers(); const { pool, workers } = fixture(); const a = pool.client(), b = pool.client()
    const first = a.run(request()).catch((error: unknown) => error as HighlightError); workers[0].ready()
    const healthy = b.run(request()).catch((error: unknown) => error as HighlightError); await vi.advanceTimersByTimeAsync(51)
    expect(await first).toMatchObject({ code: 'timeout' }); expect(workers[0].terminate).toHaveBeenCalledOnce()
    await expect(a.run(request())).rejects.toMatchObject({ code: 'timeout' })
    expect(await healthy).toMatchObject({ code: 'timeout' }); expect(workers).toHaveLength(1)
    for (let index = 0; index < 10; index++) await expect(a.run(request(), String(index))).rejects.toMatchObject({ code: 'timeout' })
    a.dispose(); b.dispose()
  })
  it('does not retry a queued job from the quarantined config', async () => {
    vi.useFakeTimers(); const { pool, workers } = fixture(); const a = pool.client()
    const old = a.run(request()).catch((error: unknown) => error as HighlightError); workers[0].ready()
    const newest = a.run(request('new ERROR')).catch((error: unknown) => error as HighlightError)
    await vi.advanceTimersByTimeAsync(51)
    expect(await old).toMatchObject({ code: 'superseded' }); expect(await newest).toMatchObject({ code: 'timeout' }); expect(workers).toHaveLength(1); a.dispose()
  })
  it('replaces pending input and never resolves stale active input to its owner', async () => {
    const { pool, workers } = fixture(); const a = pool.client()
    const old = a.run(request()).catch((error: unknown) => error as HighlightError); workers[0].ready()
    const pending = a.run(request('old ERROR')).catch((error: unknown) => error as HighlightError)
    const newest = a.run(request('latest ERROR'))
    workers[0].reply(); workers[0].reply(1)
    expect(await old).toMatchObject({ code: 'superseded' }); expect(await pending).toMatchObject({ code: 'superseded' })
    expect((await newest).rows[0].ranges[0].x).toBe(7); a.dispose()
  })
  it('invalidates old config without spawning overlapping workers before completion', async () => {
    const { pool, workers } = fixture(); const a = pool.client()
    const old = a.run(request(), 'tenant-a').catch((error: unknown) => error as HighlightError); workers[0].ready()
    const handler = workers[0].onmessage
    const fresh = a.run(request(), 'tenant-b'); expect(workers[0].terminate).not.toHaveBeenCalled()
    handler?.({ data: { id: 1, result: evaluateHighlights(request()) } } as MessageEvent)
    workers[0].reply(1); await fresh
    expect(await old).toMatchObject({ code: 'superseded' }); a.dispose()
  })
  it('rejects saturation beyond 32 pending owners without starting more workers', async () => {
    const { pool, workers } = fixture(); const clients = Array.from({ length: 33 }, () => pool.client())
    const results = clients.map(client => client.run(request()).catch((error: unknown) => error as HighlightError))
    expect(await results[32]).toMatchObject({ code: 'capacity' }); expect(workers).toHaveLength(1)
    clients.forEach(client => client.dispose()); await Promise.all(results)
  })
  it.each(['unavailable', 'failed'] as const)('fails closed for worker %s without synchronous fallback', async (code) => {
    const { pool, workers } = fixture(); const a = pool.client(); const result = a.run(request()).catch((error: unknown) => error as HighlightError)
    if (code === 'failed') workers[0].ready()
    workers[0].onerror?.(new Event('error') as ErrorEvent)
    expect(await result).toMatchObject({ code: code }); expect(workers[0].terminate).toHaveBeenCalledOnce(); a.dispose()
  })
  it('times out startup independently and disposes pending work', async () => {
    vi.useFakeTimers(); const { pool, workers } = fixture(); const a = pool.client()
    const result = a.run(request()).catch((error: unknown) => error as HighlightError)
    await vi.advanceTimersByTimeAsync(100); expect(workers[0].terminate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2901); expect(await result).toMatchObject({ code: 'unavailable' }); a.dispose()
  })
  it.each([request('x'.repeat(65537)), { rows: Array.from({ length: 41 }, () => request().rows[0]) }, { rows: Array.from({ length: 5 }, () => request('x'.repeat(65536)).rows[0]) }])('rejects oversized input before creating worker', async (input) => {
    const { pool, workers } = fixture(); const a = pool.client(); await expect(a.run(input)).rejects.toMatchObject({ code: 'input-limit' }); expect(workers).toHaveLength(0); a.dispose()
  })
  it('rejects post-dispose calls without transport or worker work', async () => {
    const { pool, workers } = fixture(); const a = pool.client(); a.dispose(); await expect(a.run(request())).rejects.toMatchObject({ code: 'disposed' }); expect(workers).toHaveLength(0)
  })
})
