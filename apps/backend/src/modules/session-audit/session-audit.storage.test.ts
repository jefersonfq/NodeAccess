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
  it('reads recorded paths after creating a new storage instance and changing the write root', async () => {
    temporary = await mkdtemp(join(tmpdir(), 'na-audit-restart-'))
    env.SESSION_AUDIT_STORAGE_DIR = join(temporary, 'old-root')
    const recorded = await new SessionAuditStorage().writeChunk(12, 1, 'retained history')
    env.SESSION_AUDIT_STORAGE_DIR = join(temporary, 'new-root')
    const restarted = new SessionAuditStorage()
    expect(await restarted.readChunk(recorded.storageKey)).toBe('retained history')
    const current = await restarted.writeChunk(12, 2, 'new event')
    expect(current.storageKey.startsWith(env.SESSION_AUDIT_STORAGE_DIR)).toBe(true)
    expect(await restarted.readChunk(current.storageKey)).toBe('new event')
    expect(await restarted.readChunk(recorded.storageKey)).toBe('retained history')
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
