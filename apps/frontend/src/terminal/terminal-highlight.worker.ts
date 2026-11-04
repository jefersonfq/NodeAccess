import { evaluateHighlights, type HighlightRequest } from './terminal-highlight-engine'
const scope = globalThis as unknown as { postMessage: (value: unknown) => void; onmessage: ((event: MessageEvent<{ id: number; request: HighlightRequest }>) => void) | null }
scope.onmessage = ({ data }): void => {
  try { scope.postMessage({ id: data.id, result: evaluateHighlights(data.request) }) }
  catch { scope.postMessage({ id: data.id, error: true }) }
}
scope.postMessage({ ready: true })
