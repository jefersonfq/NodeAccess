/** API startup barrier. Rotates even while the pilot is disabled, before serving routes. */
export class VaultFillRuntime {
  private started = false
  private available = false
  constructor(private readonly rotate: () => Promise<void>, private readonly startupTimeoutMs = 4000) {}
  ready(): boolean { return this.available }
  async initialize(): Promise<boolean> {
    if (this.started) return this.available
    this.started = true
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([this.rotate(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Fill startup timed out')), this.startupTimeoutMs)
      })])
      this.available = true
    } catch {
      // Keep the rest of the portal usable; delivery stays closed until a successful restart.
      this.available = false
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
    return this.available
  }
}
