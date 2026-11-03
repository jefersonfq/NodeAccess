import { afterEach, describe, expect, it } from 'vitest'
import { lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { env } from '../../config/env.js'
import { SessionAuditStorage } from './session-audit.storage.js'

let temporary: string | undefined
const original = env.SESSION_AUDIT_STORAGE_DIR
afterEach(async () => { env.SESSION_AUDIT_STORAGE_DIR = original; if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined })
describe('audit chunks on private storage', () => {
  it('roundtrips compressed content, supports same-sequence retry, and creates private files', async () => {
    temporary = await mkdtemp(join(tmpdir(), 'na-audit-storage-')); env.SESSION_AUDIT_STORAGE_DIR = join(temporary, 'audit')
    const storage = new SessionAuditStorage()
    const first = await storage.writeChunk(12, 1, 'first\n')
    const retry = await storage.writeChunk(12, 1, 'retry\n')
    expect(first.storageKey).toBe(retry.storageKey)
    expect(await storage.readChunk(retry.storageKey)).toBe('retry\n')
    expect((await lstat(retry.storageKey)).mode & 0o777).toBe(0o600)
  })
  it('rejects a planted destination symlink without modifying its target', async () => {
    temporary = await mkdtemp(join(tmpdir(), 'na-audit-storage-')); env.SESSION_AUDIT_STORAGE_DIR = join(temporary, 'audit')
    const storage = new SessionAuditStorage(), chunk = await storage.writeChunk(12, 1, 'safe')
    const target = join(temporary, 'untouched'); await writeFile(target, 'keep')
    await rm(chunk.storageKey); await symlink(target, chunk.storageKey)
    await expect(storage.writeChunk(12, 1, 'bad')).rejects.toThrow('unsafe')
    expect(await readFile(target, 'utf8')).toBe('keep')
  })
})
