/** Read at most limit bytes, cancelling the unused body instead of buffering it. */
export async function responsePrefix(response: Response, limit: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let result = ''
  try {
    while (bytes < limit) {
      const chunk = await reader.read()
      if (chunk.done) break
      const allowed = chunk.value.subarray(0, limit - bytes)
      bytes += allowed.length
      result += decoder.decode(allowed, { stream: true })
    }
    return result + decoder.decode()
  } finally {
    // A broken peer may never acknowledge cancellation. Do not wait for it.
    void reader.cancel().catch(() => {})
  }
}

/** Deadline includes body consumption; success never leaves an unread body/socket. */
export async function boundedFetch(url: string, init: RequestInit, timeoutMs = 30_000, maxBytes = 1024 * 1024): Promise<Response> {
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  init.signal?.addEventListener('abort', abort, { once: true })
  if (init.signal?.aborted) abort()
  const timer = setTimeout(abort, timeoutMs)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.body) return response
    reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let bytes = 0
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxBytes) throw new Error('HTTP response body exceeds limit')
      chunks.push(chunk.value)
    }
    const data = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength }
    return new Response(data, { status: response.status, statusText: response.statusText, headers: response.headers })
  } finally {
    clearTimeout(timer)
    init.signal?.removeEventListener('abort', abort)
    controller.abort()
    if (reader) void reader.cancel().catch(() => {})
  }
}
