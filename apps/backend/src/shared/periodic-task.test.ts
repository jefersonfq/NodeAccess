import { afterEach, expect, it, vi } from 'vitest'
import { PeriodicTask, drainWithin } from './periodic-task.js'
afterEach(() => vi.useRealTimers())
it('drains current work without scheduling another run', async () => {
  vi.useFakeTimers()
  let finish!: () => void
  const task = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const scheduler = new PeriodicTask(task, vi.fn())
  scheduler.start(10, 10)
  await vi.advanceTimersByTimeAsync(10)
  let stopped = false
  const drain = scheduler.stop().then(() => { stopped = true })
  expect(stopped).toBe(false)
  finish(); await drain
  await vi.advanceTimersByTimeAsync(100)
  expect(task).toHaveBeenCalledOnce()
})
it('bounds shutdown and clears the deadline timer after early completion', async () => {
  vi.useFakeTimers()
  expect(await drainWithin([Promise.resolve()], 100)).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
  const drain = drainWithin([new Promise(() => {})], 100)
  await vi.advanceTimersByTimeAsync(100)
  expect(await drain).toBe(false)
})
