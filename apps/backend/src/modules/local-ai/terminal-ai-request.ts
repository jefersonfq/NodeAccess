import type { IncomingMessage, ServerResponse } from 'node:http'
/** Request completion is not cancellation: observe aborted request / unfinished response only. */
export function terminalAiRequestScope(request: IncomingMessage, response: ServerResponse, timeoutMs = 20_000): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const cancel = (): void => controller.abort(new DOMException('Client disconnected', 'AbortError'))
  const close = (): void => { if (!response.writableEnded) cancel() }
  const timer = setTimeout(() => controller.abort(new DOMException('Terminal AI deadline', 'TimeoutError')), timeoutMs)
  timer.unref()
  request.once('aborted', cancel)
  response.once('close', close)
  if (request.aborted || response.destroyed) cancel()
  return { signal: controller.signal, dispose: (): void => {
    clearTimeout(timer)
    request.off('aborted', cancel)
    response.off('close', close)
  } }
}
