/** Non-overlapping scheduler with cancellation and a drainable in-flight task. */
export class PeriodicTask {
  private timer: ReturnType<typeof setTimeout> | undefined
  private active: Promise<void> | undefined
  private stopped = true
  constructor(private readonly task: () => Promise<void>, private readonly onError: (error: unknown) => void) {}
  start(initialDelayMs: number, intervalMs: number): void {
    if (!this.stopped) return
    this.stopped = false
    const tick = (): void => {
      if (this.stopped) return
      this.active = this.task().catch(this.onError).finally(() => {
        this.active = undefined
        if (!this.stopped) this.timer = setTimeout(tick, intervalMs)
      })
    }
    this.timer = setTimeout(tick, initialDelayMs)
  }
  async stop(): Promise<void> {
    this.stopped = true
    clearTimeout(this.timer)
    await this.active
  }
}

export async function drainWithin(tasks: Promise<unknown>[], timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.allSettled(tasks).then(() => true),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs) }),
    ])
  } finally { clearTimeout(timer) }
}
