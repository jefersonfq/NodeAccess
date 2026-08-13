export class GatewayDrainState {
  private draining = false
  private activeConnections = 0

  begin(): void { this.draining = true }
  isDraining(): boolean { return this.draining }

  enter(): (() => void) | null {
    if (this.draining) return null
    this.activeConnections += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.activeConnections = Math.max(0, this.activeConnections - 1)
    }
  }

  activeCount(): number { return this.activeConnections }
}

export async function waitForGatewayDrain(
  activeCount: () => number,
  timeoutMs: number,
  pollMs = 250,
): Promise<number> {
  const deadline = Date.now() + timeoutMs
  while (activeCount() > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  return activeCount()
}
