import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client, type SFTPWrapper } from 'ssh2'
import { randomUUID } from 'node:crypto'
import { SessionFiles, EXTERNAL_BACKUPS_DIRECTORY_BYTES } from './session-files.js'

describe.skipIf(process.env.RUN_SFTP_REAL !== 'true')('external editor backup quotas on disposable OpenSSH', () => {
  const client = new Client()
  let sftp: SFTPWrapper; let files: SessionFiles; let directory: string
  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => client.on('ready', resolve).on('error', reject).connect({ host: '127.0.0.1', port: 22283, username: 'sftptest', password: 'disposable-sftp-review', readyTimeout: 15000 }))
    sftp = await new Promise((resolve, reject) => client.sftp((error, wrapper) => error ? reject(error) : resolve(wrapper)))
    files = new SessionFiles(sftp); directory = `${await files.home()}/quota-${randomUUID()}`
    await new Promise<void>((resolve, reject) => sftp.mkdir(directory, error => error ? reject(error) : resolve()))
  }, 20000)
  afterAll(async () => {
    if (directory) await new Promise<void>(resolve => client.exec(`rm -rf -- '${directory}'`, (error, stream) => error ? resolve() : (stream.resume(), stream.stderr.resume(), stream.on('close', () => resolve()))))
    client.end()
  }, 20000)
  it('pauses the 21st save without changing the original or removing any backup', async () => {
    const initial = await files.create(directory, 'many.conf', Buffer.from('version-0'))
    for (let i = 1; i <= 20; i++) {
      const current = await files.read(initial.path)
      await files.save(initial.path, current.hash, Buffer.from(`version-${i}`))
    }
    const current = await files.read(initial.path)
    await expect(files.save(initial.path, current.hash, Buffer.from('blocked'))).rejects.toThrow('FILE_BACKUP_QUOTA')
    expect((await files.read(initial.path)).data.toString()).toBe('version-20')
    const backups = await new Promise<unknown[]>((resolve, reject) => sftp.readdir(`${directory}/.nodeaccess-backups`, (error, entries) => error ? reject(error) : resolve(entries)))
    expect(backups).toHaveLength(20)
  }, 30000)
  it('checks the total directory byte budget before publishing another save', async () => {
    const backup = `${directory}/.nodeaccess-backups/other.conf.${Date.now()}.${randomUUID()}.external.bak`
    const handle = await new Promise<Buffer>((resolve, reject) => sftp.open(backup, 'wx', { mode: 0o600 }, (error, value) => error ? reject(error) : resolve(value)))
    await new Promise<void>((resolve, reject) => sftp.fsetstat(handle, { size: EXTERNAL_BACKUPS_DIRECTORY_BYTES }, error => error ? reject(error) : resolve()))
    await new Promise<void>((resolve, reject) => sftp.close(handle, error => error ? reject(error) : resolve()))
    const initial = await files.create(directory, 'budget.conf', Buffer.from('keep-original'))
    await expect(files.save(initial.path, initial.hash, Buffer.from('blocked'))).rejects.toThrow('FILE_BACKUP_QUOTA')
    expect((await files.read(initial.path)).data.toString()).toBe('keep-original')
  })
})
