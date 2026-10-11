import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { filePath, shellQuote, type SessionFiles } from './session-files.js'
import { startDesktopEdit } from '../agents/desktop-edit.bridge.js'
import { agentRegistry } from '../agents/agent.registry.js'

export interface FileSession {
  sessionId: number; hostId: number; userId: number; tenantId: number
  hostName: string; groupId?: number | null; username: string; ip: string; port: number
  files(): Promise<SessionFiles>
  authorize(): Promise<void>
  notify(event: Record<string, unknown>): void
  audit(details: Record<string, unknown>): Promise<void>
}
export interface FileUtilityInput {
  operation: 'destinations' | 'copy' | 'command' | 'edit' | 'stop-edit' | 'resume-edit' | 'cancel'
  path?: string; targetSessionId?: number; directory?: string; editId?: string
}
interface FileUtilityResult {
  localEditorAvailable?: boolean
  destinations?: { sessionId: number; hostId: number; name: string; username: string; ip: string }[]
  cancelRequested?: boolean; resumed?: boolean; stopped?: boolean
  editId?: string; command?: string; path?: string; username?: string; bytes?: number; hash?: string
}
export class SessionFileUtilities {
  private sessions = new Map<number, FileSession>()
  private savesInFlight = 0
  private controllers = new Map<number, AbortController>()
  private busy = new Set<number>()
  private edits = new Map<string, { owner: number; hostId: number; username: string; path: string; stop(): void; resume(): void }>()
  register(session: FileSession): void { this.sessions.set(session.sessionId, session) }
  unregister(id: number): void {
    this.sessions.delete(id)
    this.controllers.get(id)?.abort()
    for (const [key, edit] of this.edits) if (edit.owner === id) { edit.stop(); this.edits.delete(key) }
  }
  async execute(id: number, input: FileUtilityInput): Promise<FileUtilityResult> {
    const source = this.sessions.get(id)
    if (!source) throw new Error('FILE_SESSION_UNAVAILABLE')
    await source.authorize()
    if (input.operation === 'cancel') { this.controllers.get(id)?.abort(); return { cancelRequested: true } }
    if (input.operation === 'destinations') {
      const agent = agentRegistry.resolveForConnectionMode('AGENT_USER', source.userId, source.tenantId)?.agent
      return { localEditorAvailable: !!agent?.desktopEditing && agent.platform === 'win32' && agent.tenantId === source.tenantId, destinations: [...this.sessions.values()].filter(s => s.sessionId !== id && s.userId === source.userId && s.tenantId === source.tenantId)
        .sort((a, b) => a.hostName.localeCompare(b.hostName))
        .map(s => ({ sessionId: s.sessionId, hostId: s.hostId, name: s.hostName, username: s.username, ip: s.ip })) }
    }
    if (input.operation === 'stop-edit' || input.operation === 'resume-edit') {
      const edit = this.edits.get(input.editId ?? '')
      if (!edit || edit.owner !== id) throw new Error('FILE_SESSION_UNAVAILABLE')
      if (input.operation === 'resume-edit') { edit.resume(); return { resumed: true } }
      edit.stop(); this.edits.delete(input.editId!); await source.audit({ operation: 'externalEditStop', path: edit.path, success: true }); return { stopped: true }
    }
    if (this.busy.has(id) || this.busy.size >= 4) throw new Error('FILE_BUSY')
    this.busy.add(id)
    const controller = new AbortController()
    this.controllers.set(id, controller)
    const timeout = setTimeout(() => controller.abort(), 45_000)
    const operationId = randomUUID()
    const operation = ({ copy: 'copyToHost', command: 'directCommandPrepared', edit: 'externalEditOpen' } as Record<string, string>)[input.operation] ?? input.operation
    let path = ''
    let files: SessionFiles | undefined
    let destination: SessionFiles | undefined
    const cancel = (): void => { files?.close(); destination?.close() }
    controller.signal.addEventListener('abort', cancel, { once: true })
    try {
      path = filePath(input.path)
      await source.audit({ operation, operationId, path, state: 'started', success: false })
      files = await source.files()
      if (controller.signal.aborted) throw new Error('FILE_CANCELLED')
      if (input.operation === 'edit') {
        if ([...this.edits.values()].filter(e => e.owner === id).length >= 4) throw new Error('FILE_BUSY')
        if ([...this.edits.values()].some(e => e.hostId === source.hostId && e.username === source.username && e.path === path)) throw new Error('FILE_BUSY')
        const route = agentRegistry.resolveForConnectionMode('AGENT_USER', source.userId, source.tenantId)
        if (!route?.agent.desktopEditing || route.agent.platform !== 'win32' || route.agent.tenantId !== source.tenantId) throw new Error('FILE_PERSONAL_WINDOWS_AGENT_REQUIRED')
        const initial = await files.read(path)
        let revision = initial.hash
        let editId = ''
        const edit = startDesktopEdit(route.agent, { name: posix.basename(path), content: initial.data.toString('base64') }, async content => {
          if (this.sessions.get(id) !== source) throw new Error('FILE_SESSION_UNAVAILABLE')
          await source.authorize()
          if (this.savesInFlight >= 4) throw new Error('FILE_BUSY')
          this.savesInFlight++
          const saveOperationId = randomUUID()
          try {
            await source.audit({ operation: 'externalEditSave', operationId: saveOperationId, path, state: 'started', size: content.length, success: false })
            const editingFiles = await source.files()
            const saveTimeout = setTimeout(() => editingFiles.close(), 45000)
            let result
            try { result = await editingFiles.save(path, revision, content) } finally { clearTimeout(saveTimeout); editingFiles.close() }
            const previousRevision = revision
            revision = result.hash
            await source.audit({ operation: 'externalEditSave', operationId: saveOperationId, path, size: result.bytes, backupPath: result.backupPath, editorSave: true, beforeHash: previousRevision, afterHash: result.hash, preservedMode: true, preservedOwnership: true, preservedTimestamps: true, diffSkippedReason: 'external-editor', success: true })
          } catch (error) {
            await source.audit({ operation: 'externalEditSave', operationId: saveOperationId, path, success: false, errorMessage: error instanceof Error && /^FILE_[A-Z_]+$/.test(error.message) ? error.message : 'FILE_SAVE_FAILED' }).catch(() => {})
            throw error
          } finally { this.savesInFlight-- }
        }, event => {
          source.notify({ ...event, path, editId })
          if (['closed', 'declined', 'agent-unavailable', 'offline'].includes(String(event.state))) this.edits.delete(editId)
        })
        initial.data.fill(0)
        editId = edit.editId
        this.edits.set(edit.editId, { owner: id, hostId: source.hostId, username: source.username, path, stop: edit.stop, resume: edit.resume })
        try { await source.audit({ operation: 'externalEditOpen', operationId, path, success: true }) }
        catch (error) { edit.stop(); this.edits.delete(edit.editId); throw error }
        return { editId: edit.editId }
      }
      if (input.operation !== 'copy' && input.operation !== 'command') throw new Error('FILE_OPERATION_INVALID')
      const target = this.sessions.get(input.targetSessionId ?? 0)
      if (!target || target.sessionId === id || target.userId !== source.userId || target.tenantId !== source.tenantId) throw new Error('FILE_TARGET_UNAVAILABLE')
      await target.authorize()
      destination = await target.files()
      if (controller.signal.aborted) throw new Error('FILE_CANCELLED')
      const directory = input.directory ? filePath(input.directory) : await destination.home()
      const destinationPath = filePath(posix.join(directory, posix.basename(path)))
      if (source.hostId === target.hostId && path === destinationPath) throw new Error('FILE_SAME_PATH')
      if (input.operation === 'command') {
        if (!/^[\w.-]+$/.test(target.username) || !/^[\w.:-]+$/.test(target.ip)) throw new Error('FILE_COMMAND_UNAVAILABLE')
        const host = target.ip.includes(':') ? `[${target.ip}]` : target.ip
        const command = `scp -s -P ${target.port} -- ${shellQuote(path)} ${shellQuote(`${target.username}@${host}:${destinationPath}`)}`
        await source.audit({ operation: 'directCommandPrepared', operationId, path, destinationHostId: target.hostId, destinationPath, success: true, completionVerified: false })
        return { command, path: destinationPath, username: target.username }
      }
      const data = await files.read(path, controller.signal)
      // Revalidate immediately before writing, after reads/remote metadata lookups.
      await source.authorize(); await target.authorize()
      if (this.sessions.get(id) !== source || this.sessions.get(target.sessionId) !== target) throw new Error('FILE_SESSION_UNAVAILABLE')
      const result = await destination.create(directory, posix.basename(path), data.data, controller.signal)
      await source.audit({ operation: 'copyToHost', operationId, path, destinationHostId: target.hostId, destinationPath: result.path, destinationUsername: target.username, size: result.bytes, success: true })
      return { ...result, username: target.username }
    } catch (error) {
      await source.audit({ operation, operationId, path, success: false }).catch(() => {})
      if (controller.signal.aborted) throw new Error('FILE_CANCELLED')
      throw error
    } finally { clearTimeout(timeout); controller.signal.removeEventListener('abort', cancel); files?.close(); destination?.close(); this.controllers.delete(id); this.busy.delete(id) }
  }
}
