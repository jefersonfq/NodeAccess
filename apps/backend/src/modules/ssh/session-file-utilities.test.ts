import { describe, it, expect, vi } from 'vitest'
import { SessionFileUtilities, type FileSession } from './session-file-utilities.js'
import { filePath, shellQuote, SESSION_FILE_LIMIT } from './session-files.js'

function fixture() {
  const utility = new SessionFileUtilities()
  const create = vi.fn().mockResolvedValue({ path: '/home/alice/file.txt', bytes: 5, hash: 'new' })
  const read = vi.fn().mockResolvedValue({ data: Buffer.from('hello'), hash: 'base' })
  const audit = vi.fn().mockResolvedValue(undefined)
  const authorize = vi.fn().mockResolvedValue(undefined)
  const source = { sessionId: 1, hostId: 10, userId: 2, tenantId: 3, hostName: 'source', username: 'alice', ip: '192.0.2.1', port: 22, files: vi.fn().mockResolvedValue({ read, close: vi.fn() }), authorize, notify: vi.fn(), audit } as unknown as FileSession
  const target = { ...source, sessionId: 2, hostId: 20, hostName: 'target', ip: '192.0.2.2', files: vi.fn().mockResolvedValue({ home: vi.fn().mockResolvedValue('/home/alice'), create, close: vi.fn() }) } as unknown as FileSession
  utility.register(source); utility.register(target)
  return { utility, source, target, create, read, audit, authorize }
}
describe('session file utilities', () => {
  it('returns only destinations owned by the same user and tenant', async () => {
    const f = fixture(); f.utility.register({ ...f.target, sessionId: 3, userId: 99 }); f.utility.register({ ...f.target, sessionId: 4, tenantId: 99 })
    expect((await f.utility.execute(1, { operation: 'destinations' })).destinations).toHaveLength(1)
    expect(f.source.files).not.toHaveBeenCalled()
  })
  it('copies to resolved home using authenticated connections and audits metadata', async () => {
    const f = fixture(); await f.utility.execute(1, { operation: 'copy', path: '/tmp/file.txt', targetSessionId: 2 })
    expect(f.create).toHaveBeenCalledWith('/home/alice', 'file.txt', Buffer.from('hello'), expect.any(AbortSignal))
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ operation: 'copyToHost', destinationUsername: 'alice', success: true }))
    expect(f.authorize).toHaveBeenCalledTimes(4)
  })
  it('rejects another user destination before reading or writing', async () => {
    const f = fixture(); f.utility.register({ ...f.target, userId: 99 })
    await expect(f.utility.execute(1, { operation: 'copy', path: '/tmp/file.txt', targetSessionId: 2 })).rejects.toThrow('FILE_TARGET_UNAVAILABLE')
    expect(f.read).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled()
  })
  it('does not silently use root when home lookup fails', async () => {
    const f = fixture(); f.target.files = vi.fn().mockResolvedValue({ home: vi.fn().mockRejectedValue(new Error('HOME_FAILED')), create: f.create, close: vi.fn() })
    await expect(f.utility.execute(1, { operation: 'copy', path: '/tmp/file.txt', targetSessionId: 2 })).rejects.toThrow('HOME_FAILED')
    expect(f.create).not.toHaveBeenCalled()
  })
  it('rejects revoked source access', async () => {
    const f = fixture(); f.authorize.mockRejectedValue(new Error('FILE_ACCESS_DENIED'))
    await expect(f.utility.execute(1, { operation: 'copy', path: '/tmp/file.txt', targetSessionId: 2 })).rejects.toThrow('FILE_ACCESS_DENIED')
    expect(f.create).not.toHaveBeenCalled()
  })
  it('releases busy slot after invalid path', async () => {
    const f = fixture()
    await expect(f.utility.execute(1, { operation: 'copy', path: 'relative', targetSessionId: 2 })).rejects.toThrow('FILE_PATH_INVALID')
    await expect(f.utility.execute(1, { operation: 'copy', path: '/tmp/file.txt', targetSessionId: 2 })).resolves.toHaveProperty('bytes', 5)
  })
  it('prepares quoted commands without reading large files or exposing secrets', async () => {
    const f = fixture(); const result = await f.utility.execute(1, { operation: 'command', path: "/tmp/a'$(id).txt", targetSessionId: 2 })
    expect(result.command).toMatch(/^scp -s -P /); expect(result.command).toContain(shellQuote("/tmp/a'$(id).txt")); expect(f.read).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled()
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ completionVerified: false }))
  })
  it('removes disconnected destinations', async () => {
    const f = fixture(); f.utility.unregister(2)
    expect((await f.utility.execute(1, { operation: 'destinations' })).destinations).toHaveLength(0)
  })
  it.each(['../file', '/tmp/a\n', '/tmp/a\0', '/tmp/a\r'])('rejects unsafe path %s', value => expect(() => filePath(value)).toThrow())
  it('does not advertise a local editor without a capable personal agent', async () => {
    const f = fixture()
    expect((await f.utility.execute(1, { operation: 'destinations' })).localEditorAvailable).toBe(false)
    await expect(f.utility.execute(1, { operation: 'edit', path: '/tmp/file.txt' })).rejects.toThrow('FILE_PERSONAL_WINDOWS_AGENT_REQUIRED')
    expect(f.read).not.toHaveBeenCalled()
  })
  it('requires persisted start evidence before reading or writing', async () => {
    const f = fixture(); f.audit.mockRejectedValue(new Error('AUDIT_UNAVAILABLE'))
    await expect(f.utility.execute(1, { operation: 'copy', path: '/tmp/file.txt', targetSessionId: 2 })).rejects.toThrow('AUDIT_UNAVAILABLE')
    expect(f.read).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled()
  })
  it('cancels the utility channel while a read is in flight', async () => {
    const f = fixture()
    let reading = false
    f.read.mockImplementation((_path: string, signal: AbortSignal) => new Promise((_resolve, reject) => { reading = true; signal.addEventListener('abort', () => reject(new Error('FILE_CANCELLED')), { once: true }) }))
    const copying = f.utility.execute(1, { operation: 'copy', path: '/tmp/file.txt', targetSessionId: 2 })
    for (let attempt = 0; !reading && attempt < 20; attempt++) await Promise.resolve()
    expect(reading).toBe(true)
    await f.utility.execute(1, { operation: 'cancel' })
    await expect(copying).rejects.toThrow('FILE_CANCELLED')
    expect(f.create).not.toHaveBeenCalled()
    expect((await f.utility.execute(1, { operation: 'destinations' })).destinations).toHaveLength(1)
  })
  it('sets an explicit bounded copy limit', () => expect(SESSION_FILE_LIMIT).toBe(2 * 1024 * 1024))
})
