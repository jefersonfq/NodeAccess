import { afterEach, expect, it, vi } from 'vitest'
import { SessionAuditAiWorker } from './session-audit-ai.worker.js'
import { env } from '../../config/env.js'
afterEach(() => vi.useRealTimers())
it('stops AI summary scheduling and drains the active tick before disconnect', async () => {
  vi.useFakeTimers()
  let release!: (value: number) => void
  const repo = { requeueStaleProcessingJobs: vi.fn(() => new Promise<number>(resolve => { release = resolve })), listPendingSummaryJobs: vi.fn(() => Promise.resolve([])) }
  const worker = new SessionAuditAiWorker(repo as never, {} as never, {} as never, {} as never, {} as never)
  worker.start()
  await vi.advanceTimersByTimeAsync(env.SESSION_AUDIT_AI_WORKER_INITIAL_DELAY_MS)
  let stopped = false
  const stop = worker.stop().then(() => { stopped = true })
  expect(stopped).toBe(false)
  release(0); await stop
  await vi.advanceTimersByTimeAsync(env.SESSION_AUDIT_AI_WORKER_POLL_MS * 3)
  expect(repo.requeueStaleProcessingJobs).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})
