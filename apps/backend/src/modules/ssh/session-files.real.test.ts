import { SshSession } from './ssh.session.js'
import { encrypt } from '../../shared/crypto.js'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client, type SFTPWrapper } from 'ssh2'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionFileUtilities, type FileSession } from './session-file-utilities.js'
import { agentRegistry, type ActiveAgent } from '../agents/agent.registry.js'
import { SessionFiles, SESSION_FILE_LIMIT } from './session-files.js'

describe.skipIf(process.env.RUN_SFTP_REAL !== 'true')('authenticated session files on disposable OpenSSH', () => {
  const client = new Client(); let sftp: SFTPWrapper; let files: SessionFiles; let directory: string
  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => client.on('ready', resolve).on('error', reject).connect({ host: '127.0.0.1', port: 22283, username: 'sftptest', password: 'disposable-sftp-review', readyTimeout: 15000 }))
    sftp = await new Promise((resolve, reject) => client.sftp((error, wrapper) => error ? reject(error) : resolve(wrapper)))
    files = new SessionFiles(sftp)
    directory = `${await files.home()}/utilities-${randomUUID()}`
    await new Promise<void>((resolve, reject) => sftp.mkdir(directory, error => error ? reject(error) : resolve()))
  }, 20000)
  afterAll(async () => {
    if (directory) await new Promise<void>(resolve => client.exec(`rm -rf -- '${directory}'`, (error, stream) => error ? resolve() : (stream.resume(), stream.stderr.resume(), stream.on('close', () => resolve()))))
    client.end()
  }, 20000)
  it('creates private destination and refuses overwrite', async () => {
    const result = await files.create(directory, 'small.txt', Buffer.from('first'))
    const read = await files.read(result.path); expect(read.mode).toBe(0o600); expect(read.data.toString()).toBe('first')
    await expect(files.create(directory, 'small.txt', Buffer.from('second'))).rejects.toThrow()
    expect((await files.read(result.path)).data.toString()).toBe('first')
  })
  it('saves atomically with private backup and preserves original mode', async () => {
    const initial = await files.create(directory, 'edit.conf', Buffer.from('old'))
    const before = await files.read(initial.path)
    const saved = await files.save(initial.path, before.hash, Buffer.from('new'))
    expect((await files.read(initial.path)).data.toString()).toBe('new')
    expect((await files.read(initial.path)).mode).toBe(0o600)
    expect((await files.read(saved.backupPath)).data.toString()).toBe('old')
    expect((await files.read(saved.backupPath)).mode).toBe(0o600)
  })
  it('rejects stale revision without replacing destination', async () => {
    const initial = await files.read(`${directory}/edit.conf`)
    await files.save(initial.path, initial.hash, Buffer.from('external change'))
    await expect(files.save(initial.path, initial.hash, Buffer.from('stale'))).rejects.toThrow('FILE_CONFLICT')
    expect((await files.read(initial.path)).data.toString()).toBe('external change')
  })
  it('refuses oversized copies before creating destination', async () => {
    await expect(files.create(directory, 'oversize', Buffer.alloc(SESSION_FILE_LIMIT + 1))).rejects.toThrow('FILE_TOO_LARGE')
    await expect(files.read(`${directory}/oversize`)).rejects.toThrow()
  })
  it('refuses symlink files rather than overwriting their targets', async () => {
    await new Promise<void>((resolve, reject) => sftp.symlink(`${directory}/small.txt`, `${directory}/link`, error => error ? reject(error) : resolve()))
    await expect(files.read(`${directory}/link`)).rejects.toThrow('FILE_REGULAR_REQUIRED')
  })
  it('closing utility SFTP leaves the authenticated shell alive', async () => {
    const output: string[] = []
    const session = new SshSession({ send: data => output.push(data.toString()) }, {
      host: '127.0.0.1', port: 22283, username: 'sftptest', authType: 'PASSWORD', passwordEncrypted: JSON.stringify(encrypt('disposable-sftp-review')),
    })
    try {
      await session.connect()
      const utility = await session.sessionFiles()
      expect((await utility.read(`${directory}/small.txt`)).data.toString()).toBe('first')
      utility.close()
      session.write(Buffer.from("printf 'NA_UTILITY_PTY_ALIVE\n'\n"))
      await new Promise(resolve => setTimeout(resolve, 200))
      expect(output.join('')).toContain('NA_UTILITY_PTY_ALIVE')
      const reopened = await session.sessionFiles()
      expect(await reopened.home()).toMatch(/^\//)
      reopened.close()
    } finally { session.dispose() }
  })
  it('already canceled copy never publishes a destination', async () => {
    const controller = new AbortController(); controller.abort()
    await expect(files.create(directory, 'canceled.txt', Buffer.from('x'), controller.signal)).rejects.toThrow('FILE_CANCELLED')
    await expect(files.read(`${directory}/canceled.txt`)).rejects.toThrow()
  })

  it('syncs a local editor through the personal agent protocol and pauses on remote conflict', async () => {
    const { DesktopEdits } = createRequire(import.meta.url)('../../../../agent/src/desktop-edit.js')
    const root = await mkdtemp(join(tmpdir(), 'nodeaccess-edit-protocol-'))
    let localFile = ''
    let desktop: { handle(message: unknown): void; destroy(): void }
    class Socket extends EventEmitter {
      readyState = 1
      send(raw: string) { queueMicrotask(() => desktop.handle(JSON.parse(raw))) }
      close() { this.readyState = 3; this.emit('close', 1000) }
    }
    const socket = new Socket()
    desktop = new DesktopEdits({ readyState: 1, send: (raw: string) => queueMicrotask(() => socket.emit('message', Buffer.from(raw), false)) }, { platform: 'win32', root, launch: async (path: string) => { localFile = path } })
    const agent = { agentId: 987, userId: 987, tenantId: 987, name: 'disposable', agentType: 'PROXY_AGENT', agentMode: 'USER_BOUND', isDefault: false, platform: 'win32', desktopEditing: true, ws: socket, connectedAt: new Date() } as ActiveAgent
    agentRegistry.register(agent)
    const events: Record<string, unknown>[] = []; const audit: Record<string, unknown>[] = []
    const utility = new SessionFileUtilities()
    const path = `${directory}/protocol.conf`
    await files.create(directory, 'protocol.conf', Buffer.from('initial'))
    const source: FileSession = { sessionId: 987, hostId: 987, userId: 987, tenantId: 987, hostName: 'disposable', username: 'sftptest', ip: '127.0.0.1', port: 22283,
      files: async () => new SessionFiles(await new Promise<SFTPWrapper>((resolve, reject) => client.sftp((error, wrapper) => error ? reject(error) : resolve(wrapper)))),
      authorize: async () => {}, notify: event => { events.push(event) }, audit: async event => { audit.push(event) } }
    utility.register(source)
    const wait = async (condition: () => boolean) => {
      const deadline = Date.now() + 6000
      while (!condition()) { if (Date.now() > deadline) throw new Error('editor protocol timeout'); await new Promise(resolve => setTimeout(resolve, 25)) }
    }
    try {
      expect((await utility.execute(987, { operation: 'destinations' })).localEditorAvailable).toBe(true)
      const opened = await utility.execute(987, { operation: 'edit', path })
      await wait(() => !!localFile && events.some(event => event.state === 'editing'))
      const edited = 'modified\n' + 'x'.repeat(300000)
      await writeFile(localFile, edited)
      await wait(() => events.some(event => event.state === 'synced'))
      expect((await files.read(path)).data.toString()).toBe(edited)
      const saved = audit.find(event => event.operation === 'externalEditSave' && event.success)
      expect(saved?.backupPath).toBeTruthy()
      expect((await files.read(String(saved?.backupPath))).data.toString()).toBe('initial')
      const current = await files.read(path)
      await files.save(path, current.hash, Buffer.from('changed by another operator'))
      await writeFile(localFile, 'local unsent change')
      await wait(() => events.some(event => event.state === 'conflict'))
      expect((await files.read(path)).data.toString()).toBe('changed by another operator')
      await utility.execute(987, { operation: 'stop-edit', editId: opened.editId })
      expect(await readFile(localFile, 'utf8')).toBe('local unsent change')
      expect(socket.readyState).toBe(1)
    } finally {
      utility.unregister(987); desktop.destroy(); agentRegistry.unregister(agent); socket.close(); await rm(root, { recursive: true, force: true })
    }
  }, 20000)

})
