/** Large transfers use an idle deadline, never a fixed total duration. */
export async function withTransferDeadline<T>(operation: (context: { signal: AbortSignal; progress: () => void }) => Promise<T>, idleMs = 300_000): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const progress = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => controller.abort(), idleMs)
  }
  progress()
  try { return await operation({ signal: controller.signal, progress }) }
  finally { clearTimeout(timer) }
}
