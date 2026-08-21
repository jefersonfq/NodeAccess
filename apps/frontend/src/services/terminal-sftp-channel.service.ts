import type { SftpEntry } from '@nodeaccess/shared'

type SftpResult = { type: 'sftp_result'; requestId: string; ok: boolean; path?: string; home?: string; entries?: SftpEntry[]; code?: string }
type Transport = (message: string) => void
type Pending = { resolve: (value: SftpResult) => void; reject: (reason: Error) => void; timeout: ReturnType<typeof setTimeout>; owner: Transport }

const transports = new Map<number, Transport>()
const pending = new Map<string, Pending>()
const REQUEST_TIMEOUT_MS = 4_000

export function registerTerminalSftpChannel(sessionId: number, send: (message: string) => void) {
  transports.set(sessionId, send)
  return () => {
    if (transports.get(sessionId) === send) transports.delete(sessionId)
    for (const [key, request] of pending) {
      if (!key.startsWith(`${sessionId}:`) || request.owner !== send) continue
      clearTimeout(request.timeout); request.reject(new Error('Sessão SFTP encerrada')); pending.delete(key)
    }
  }
}

export function hasTerminalSftpChannel(sessionId?: number | null) { return !!sessionId && transports.has(sessionId) }

export function handleTerminalSftpResult(sessionId: number | null, message: unknown) {
  const result = message as Partial<SftpResult>
  if (!sessionId || result.type !== 'sftp_result' || typeof result.requestId !== 'string') return false
  const key = `${sessionId}:${result.requestId}`
  const request = pending.get(key)
  if (!request) return true
  clearTimeout(request.timeout); pending.delete(key)
  if (result.ok) request.resolve(result as SftpResult)
  else request.reject(new Error(result.code ?? 'SFTP_OPERATION_FAILED'))
  return true
}

export async function listViaTerminalSftp(sessionId: number, path: string, signal?: AbortSignal, options: { prefix?: string; directoriesOnly?: boolean; limit?: number } = {}) {
  const result = await requestWithTransientRetry(sessionId, { type: 'sftp_list', path, ...options }, signal)
  return { entries: result.entries ?? [], path: result.path ?? path }
}

export async function homeViaTerminalSftp(sessionId: number, signal?: AbortSignal) {
  const result = await requestWithTransientRetry(sessionId, { type: 'sftp_home' }, signal)
  return result.home ?? '/'
}

function request(sessionId: number, input: { type: 'sftp_list'; path: string; prefix?: string; directoriesOnly?: boolean; limit?: number } | { type: 'sftp_home' }, signal?: AbortSignal): Promise<SftpResult> {
  const transport = transports.get(sessionId)
  if (!transport) return Promise.reject(new Error('SFTP_SESSION_UNAVAILABLE'))
  const requestId = crypto.randomUUID()
  const key = `${sessionId}:${requestId}`
  return new Promise((resolve, reject) => {
    const finishAbort = () => {
      const active = pending.get(key)
      if (!active) return
      clearTimeout(active.timeout); pending.delete(key); reject(new DOMException('aborted', 'AbortError'))
    }
    const timeout = setTimeout(() => {
      pending.delete(key); reject(new Error('SFTP_SESSION_TIMEOUT'))
    }, REQUEST_TIMEOUT_MS)
    pending.set(key, { resolve, reject, timeout, owner: transport })
    signal?.addEventListener('abort', finishAbort, { once: true })
    if (signal?.aborted) { finishAbort(); return }
    try { transport(JSON.stringify({ ...input, requestId })) }
    catch (error) {
      clearTimeout(timeout); pending.delete(key)
      reject(error instanceof Error ? error : new Error('SFTP_TRANSPORT_FAILED'))
    }
  })
}

const TRANSIENT_ERRORS = new Set(['SFTP_BUSY', 'SFTP_OPERATION_FAILED', 'SFTP_TRANSPORT_FAILED'])

async function requestWithTransientRetry(sessionId: number, input: Parameters<typeof request>[1], signal?: AbortSignal) {
  try { return await request(sessionId, input, signal) }
  catch (error) {
    if (signal?.aborted || !TRANSIENT_ERRORS.has(error instanceof Error ? error.message : '')) throw error
    await abortableDelay(75, signal)
    return request(sessionId, input, signal)
  }
}

function abortableDelay(milliseconds: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'))
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')) }, { once: true })
  })
}
