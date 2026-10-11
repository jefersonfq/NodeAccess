import { reactive } from 'vue'
import type { SftpEntry } from '@nodeaccess/shared'

type SftpResult = { type: 'sftp_result'; requestId: string; ok: boolean; path?: string; home?: string; entries?: SftpEntry[]; code?: string; destinations?: FileDestination[]; localEditorAvailable?: boolean; command?: string; username?: string; bytes?: number; editId?: string }
type Transport = (message: string) => void
type Pending = { resolve: (value: SftpResult) => void; reject: (reason: Error) => void; timeout: ReturnType<typeof setTimeout>; owner: Transport }

export interface FileDestination { sessionId: number; hostId: number; name: string; username: string; ip: string }
export interface FileUtilityInput { operation: 'destinations' | 'copy' | 'command' | 'edit' | 'stop-edit' | 'resume-edit' | 'cancel'; path?: string; targetSessionId?: number; directory?: string; editId?: string }
export const terminalEdits = reactive(new Map<string, { editId: string; state: string; code?: string }>())
const channelListeners = new Set<() => void>()
export function subscribeTerminalChannels(listener: () => void): () => void { channelListeners.add(listener); return () => { channelListeners.delete(listener) } }
export function rememberTerminalEdit(id: number, path: string, editId: string): void { terminalEdits.set(`${id}:${path}`, { editId, state: 'preparing' }) }
const editListeners = new Map<number, Set<(event: Record<string, unknown>) => void>>()
export function subscribeTerminalEdits(id: number, listener: (event: Record<string, unknown>) => void): () => void {
  const listeners = editListeners.get(id) ?? new Set(); listeners.add(listener); editListeners.set(id, listeners)
  return () => { listeners.delete(listener); if (!listeners.size) editListeners.delete(id) }
}
export function fileUtilityViaTerminal(id: number, input: FileUtilityInput): Promise<SftpResult> { return request(id, { type: 'sftp_utility', ...input }) }

const transports = new Map<number, Transport>()
const pending = new Map<string, Pending>()
const REQUEST_TIMEOUT_MS = 4_000

export function registerTerminalSftpChannel(sessionId: number, send: (message: string) => void): () => void {
  transports.set(sessionId, send)
  for (const listener of channelListeners) listener()
  return () => {
    const ownsChannel = transports.get(sessionId) === send
    if (ownsChannel) transports.delete(sessionId)
    for (const [key, edit] of terminalEdits) if (ownsChannel && key.startsWith(`${sessionId}:`)) {
      edit.state = 'offline'
      const event = { type: 'sftp_edit_event', path: key.slice(`${sessionId}:`.length), editId: edit.editId, state: 'offline' }
      for (const listener of editListeners.get(sessionId) ?? []) listener(event)
    }
    for (const [key, request] of pending) {
      if (!key.startsWith(`${sessionId}:`) || request.owner !== send) continue
      clearTimeout(request.timeout); request.reject(new Error('Sessão SFTP encerrada')); pending.delete(key)
    }
  }
}

export function hasTerminalSftpChannel(sessionId?: number | null): boolean { return !!sessionId && transports.has(sessionId) }

export function handleTerminalSftpResult(sessionId: number | null, message: unknown): boolean {
  const event = message as Record<string, unknown>
  if (sessionId && event.type === 'sftp_edit_event') {
    const key = `${sessionId}:${String(event.path)}`
    const previous = terminalEdits.get(key)
    const code = event.state === 'error' ? (event.code === 'FILE_BACKUP_QUOTA' ? 'FILE_BACKUP_QUOTA' : previous?.code) : undefined
    terminalEdits.set(key, { editId: (typeof event.editId === 'string' && event.editId ? event.editId : previous?.editId) || '', state: String(event.state), code })
    if (code) event.code = code
    for (const listener of editListeners.get(sessionId) ?? []) listener(event); return true
  }
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

export async function listViaTerminalSftp(sessionId: number, path: string, signal?: AbortSignal, options: { prefix?: string; directoriesOnly?: boolean; limit?: number } = {}): Promise<{ entries: SftpEntry[]; path: string }> {
  const result = await requestWithTransientRetry(sessionId, { type: 'sftp_list', path, ...options }, signal)
  return { entries: result.entries ?? [], path: result.path ?? path }
}

export async function homeViaTerminalSftp(sessionId: number, signal?: AbortSignal): Promise<string> {
  const result = await requestWithTransientRetry(sessionId, { type: 'sftp_home' }, signal)
  return result.home ?? '/'
}

function request(sessionId: number, input: { type: 'sftp_list'; path: string; prefix?: string; directoriesOnly?: boolean; limit?: number } | { type: 'sftp_home' } | ({ type: 'sftp_utility' } & FileUtilityInput), signal?: AbortSignal): Promise<SftpResult> {
  const transport = transports.get(sessionId)
  if (!transport) return Promise.reject(new Error('SFTP_SESSION_UNAVAILABLE'))
  const requestId = crypto.randomUUID()
  const key = `${sessionId}:${requestId}`
  return new Promise((resolve, reject) => {
    const finishAbort = (): void => {
      const active = pending.get(key)
      if (!active) return
      clearTimeout(active.timeout); pending.delete(key); reject(new DOMException('aborted', 'AbortError'))
    }
    const timeout = setTimeout(() => {
      pending.delete(key); reject(new Error('SFTP_SESSION_TIMEOUT'))
    }, input.type === 'sftp_utility' ? 60_000 : REQUEST_TIMEOUT_MS)
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

async function requestWithTransientRetry(sessionId: number, input: Parameters<typeof request>[1], signal?: AbortSignal): Promise<SftpResult> {
  try { return await request(sessionId, input, signal) }
  catch (error) {
    if (signal?.aborted || !TRANSIENT_ERRORS.has(error instanceof Error ? error.message : '')) throw error
    await abortableDelay(75, signal)
    return request(sessionId, input, signal)
  }
}

function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'))
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')) }, { once: true })
  })
}
