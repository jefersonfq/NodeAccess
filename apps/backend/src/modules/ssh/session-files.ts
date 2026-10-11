import { createHash, randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import type { SFTPWrapper, Stats } from 'ssh2'

export const SESSION_FILE_LIMIT = 2 * 1024 * 1024
export const EXTERNAL_BACKUPS_PER_FILE = 20
export const EXTERNAL_BACKUPS_DIRECTORY_BYTES = 64 * 1024 * 1024
export function filePath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 4096 || /\p{Cc}/u.test(value)) throw new Error('FILE_PATH_INVALID')
  return posix.normalize(value)
}
export function shellQuote(value: string): string { return `'${value.replace(/'/g, `'"'"'`)}'` }
const hash = (data: Buffer): string => createHash('sha256').update(data).digest('hex')
function call<T>(run: (callback: (error: Error | undefined | null, result: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => run((error, result) => error ? reject(error) : resolve(result)))
}

/** Bounded operations on the authenticated terminal connection. Never resolves credentials. */
interface FileSnapshot { path: string; data: Buffer; hash: string; mode: number; uid: number; gid: number; atime: number; mtime: number }
interface FileWriteResult { path: string; bytes: number; hash: string }
export class SessionFiles {
  constructor(private readonly sftp: SFTPWrapper) {}
  private closed = false
  close(): void { if (!this.closed) { this.closed = true; try { this.sftp.end() } catch { /* already closed */ } } }
  async home(): Promise<string> {
    const path = await call<string>(cb => this.sftp.realpath('.', cb))
    return filePath(path)
  }
  async read(input: string, signal?: AbortSignal): Promise<FileSnapshot> {
    const path = filePath(input)
    if (signal?.aborted) throw new Error('FILE_CANCELLED')
    const attrs = await call<Stats>(cb => this.sftp.lstat(path, cb))
    if (!attrs.isFile()) throw new Error('FILE_REGULAR_REQUIRED')
    if (attrs.size > SESSION_FILE_LIMIT) throw new Error('FILE_TOO_LARGE')
    const data = await new Promise<Buffer>((resolve, reject) => {
      const stream = this.sftp.createReadStream(path)
      const abort = (): void => { stream.destroy(new Error('FILE_CANCELLED')) }
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
      const chunks: Buffer[] = []; let size = 0
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > SESSION_FILE_LIMIT) { stream.destroy(new Error('FILE_TOO_LARGE')); return }
        chunks.push(chunk)
      })
      stream.on('error', (error: Error) => { signal?.removeEventListener('abort', abort); reject(error) })
      stream.on('end', () => { signal?.removeEventListener('abort', abort); resolve(Buffer.concat(chunks)) })
    })
    const after = await call<Stats>(cb => this.sftp.lstat(path, cb))
    if (!after.isFile() || after.size !== data.length || after.mtime !== attrs.mtime || after.size !== attrs.size) throw new Error('FILE_CONFLICT')
    return { path, data, hash: hash(data), mode: attrs.mode & 0o7777, uid: attrs.uid, gid: attrs.gid, atime: attrs.atime, mtime: attrs.mtime }
  }
  async create(directory: string, name: string, data: Buffer, signal?: AbortSignal): Promise<FileWriteResult> {
    if (!name || name !== posix.basename(name) || name === '.' || name === '..') throw new Error('FILE_PATH_INVALID')
    const path = filePath(posix.join(filePath(directory), name))
    if (data.length > SESSION_FILE_LIMIT) throw new Error('FILE_TOO_LARGE')
    if (signal?.aborted) throw new Error('FILE_CANCELLED')
    const temporary = posix.join(posix.dirname(path), `.nodeaccess-copy-${randomUUID()}`)
    let created = false
    try {
      await new Promise<void>((resolve, reject) => {
        const stream = this.sftp.createWriteStream(temporary, { flags: 'wx', mode: 0o600 })
        const abort = (): void => { reject(new Error('FILE_CANCELLED')); stream.destroy() }
        stream.on('open', () => { created = true })
        stream.on('error', (error: Error) => { signal?.removeEventListener('abort', abort); reject(error) })
        stream.on('close', () => { signal?.removeEventListener('abort', abort); resolve() })
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) abort()
        else stream.end(data)
      })
      if (signal?.aborted) throw new Error('FILE_CANCELLED')
      // Atomic publication without overwrite. No unlink/rename race on the destination.
      try { await call<void>(cb => this.sftp.ext_openssh_hardlink(temporary, path, cb)) }
      catch (error) {
        const exists = await call<Stats>(cb => this.sftp.lstat(path, cb)).then(() => true).catch(() => false)
        if (exists) throw new Error('FILE_EXISTS')
        if (error instanceof Error && /support/i.test(error.message)) throw new Error('FILE_COPY_UNSUPPORTED')
        throw error
      }
      return { path, bytes: data.length, hash: hash(data) }
    } finally {
      if (created) await call<void>(cb => this.sftp.unlink(temporary, cb)).catch(() => {})
    }
  }
  private async ensureBackupCapacity(directory: string, originalName: string, nextBytes: number): Promise<void> {
    const handle = await call<Buffer>(cb => this.sftp.opendir(directory, cb))
    let scanned = 0; let count = 0; let bytes = 0
    try {
      for (;;) {
        const entries = await call<import('ssh2').FileEntryWithStats[] | false>(cb => this.sftp.readdir(handle, cb)).catch(error => {
          if ((error as { code?: number }).code === 1) return false as const // SSH_FX_EOF on a directory handle
          throw error
        })
        if (entries === false || entries.length === 0) break
        for (const entry of entries) {
          if (++scanned > 1024) throw new Error('FILE_BACKUP_QUOTA')
          const match = /^(.*)\.\d{13}\.[0-9a-f-]{36}\.external\.bak$/.exec(entry.filename)
          if (!match || !entry.attrs.isFile()) continue
          bytes += entry.attrs.size
          if (match[1] === originalName) count += 1
        }
      }
      if (count >= EXTERNAL_BACKUPS_PER_FILE || bytes + nextBytes > EXTERNAL_BACKUPS_DIRECTORY_BYTES) throw new Error('FILE_BACKUP_QUOTA')
    } finally { await call<void>(cb => this.sftp.close(handle, cb)).catch(() => {}) }
  }
  async save(input: string, baseHash: string, data: Buffer): Promise<FileWriteResult & { backupPath: string }> {
    const path = filePath(input)
    const before = await this.read(path)
    if (before.hash !== baseHash) throw new Error('FILE_CONFLICT')
    const backupDirectory = posix.join(posix.dirname(path), '.nodeaccess-backups')
    try { await call<void>(cb => this.sftp.mkdir(backupDirectory, { mode: 0o700 }, cb)) }
    catch {
      const directory = await call<Stats>(cb => this.sftp.lstat(backupDirectory, cb))
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('FILE_BACKUP_FAILED')
    }
    await this.ensureBackupCapacity(backupDirectory, posix.basename(path), before.data.length)
    const backup = await this.create(backupDirectory, `${posix.basename(path)}.${Date.now()}.${randomUUID()}.external.bak`, before.data)
    const temporary = `${path}.nodeaccess-${randomUUID()}`
    await this.create(posix.dirname(path), posix.basename(temporary), data)
    try {
      const verified = await this.read(temporary)
      if (verified.hash !== hash(data)) throw new Error('FILE_TEMP_INVALID')
      await call<void>(cb => this.sftp.chown(temporary, before.uid, before.gid, cb))
      await call<void>(cb => this.sftp.chmod(temporary, before.mode, cb))
      await call<void>(cb => this.sftp.utimes(temporary, before.atime, before.mtime, cb))
      const metadata = await call<Stats>(cb => this.sftp.lstat(temporary, cb))
      if ((metadata.mode & 0o7777) !== before.mode || metadata.uid !== before.uid || metadata.gid !== before.gid || metadata.atime !== before.atime || metadata.mtime !== before.mtime) throw new Error('FILE_METADATA_FAILED')
      if ((await this.read(path)).hash !== baseHash) throw new Error('FILE_CONFLICT')
      // Require server support: never unlink the original as an overwrite fallback.
      await call<void>(cb => this.sftp.ext_openssh_rename(temporary, path, cb))
      return { path, bytes: data.length, hash: hash(data), backupPath: backup.path }
    } finally { await call<void>(cb => this.sftp.unlink(temporary, cb)).catch(() => {}) }
  }
}
