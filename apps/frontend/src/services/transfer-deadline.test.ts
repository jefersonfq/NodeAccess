import { afterEach, expect, it, vi } from 'vitest'
import { withTransferDeadline } from './transfer-deadline'
afterEach(() => vi.useRealTimers())
it('allows an active transfer to exceed the total idle duration and clears timers on completion', async () => {
  vi.useFakeTimers()
  let finish!: (value: string) => void
  let touch!: () => void
  let signal!: AbortSignal
  const pending = withTransferDeadline(context => { touch = context.progress; signal = context.signal; return new Promise<string>(resolve => { finish = resolve }) }, 100)
  for (let i = 0; i < 20; i++) { await vi.advanceTimersByTimeAsync(90); touch(); expect(signal.aborted).toBe(false) }
  finish('complete'); expect(await pending).toBe('complete'); expect(vi.getTimerCount()).toBe(0)
})
it('aborts a stalled transfer and cleans up without retrying its mutation', async () => {
  vi.useFakeTimers()
  const operation = vi.fn(({ signal }: { signal: AbortSignal }) => new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('idle timeout')))))
  const pending = withTransferDeadline(operation, 100)
  const assertion = expect(pending).rejects.toThrow('idle timeout')
  await vi.advanceTimersByTimeAsync(100); await assertion
  expect(operation).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
})
