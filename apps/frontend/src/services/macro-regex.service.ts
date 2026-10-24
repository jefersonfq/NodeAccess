export type MacroMatcher = (pattern: string, text: string, caseSensitive: boolean, signal: AbortSignal) => Promise<number | null>

export function createMacroMatcher(onMatch?: (start: number | null, end: number | null) => void): { match: MacroMatcher; dispose: () => void } {
  let worker: Worker | null = null
  let pending: (() => void) | null = null
  const dispose = (): void => { pending?.(); worker?.terminate(); worker = null }
  const match: MacroMatcher = (pattern, text, caseSensitive, signal) => new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('cancelled')); return }
    worker ??= new Worker(new URL('./macro-regex.worker.ts', import.meta.url), { type: 'module' })
    const current = worker
    const finish = (error?: string, end: number | null = null): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      current.onmessage = null
      current.onerror = null
      pending = null
      if (error) { current.terminate(); if (worker === current) worker = null; reject(new Error(error)) }
      else resolve(end)
    }
    const abort = (): void => finish('cancelled')
    const timer = setTimeout(() => finish('regexBudget'), 1000)
    pending = abort
    signal.addEventListener('abort', abort, { once: true })
    current.onmessage = (event: MessageEvent<{ error?: string; start: number | null; end: number | null }>): void => {
      onMatch?.(event.data.start, event.data.end)
      finish(event.data.error, event.data.end)
    }
    current.onerror = (): void => finish('invalidRegex')
    current.postMessage({ pattern, text, caseSensitive })
  })
  return { match, dispose }
}
