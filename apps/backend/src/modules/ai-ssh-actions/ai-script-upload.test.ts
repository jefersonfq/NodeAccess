import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { SshIsolatedAiActionRunner } from './ai-ssh-action.execution.js'

function fixture(existing = false, destination = '/tmp/nodeaccess-ai-script-3.sh') {
  const content = 'printf safe', checksum = createHash('sha256').update(content).digest('hex')
  let stored = existing ? 'preexisting-content' : undefined
  const transport = {
    writeFile: vi.fn((_path: string, value: string, options: { flag?: string }, callback: (error?: Error) => void) => {
      if (stored !== undefined && options.flag === 'wx') return callback(new Error('File exists'))
      stored = value; callback()
    }),
    chmod: vi.fn((_path: string, _mode: number, callback: () => void) => callback()),
  }
  const runner = new SshIsolatedAiActionRunner({} as never)
  const exec = vi.fn(() => Promise.resolve({ output: checksum, exitCode: 0 }))
  Reflect.set(runner, 'execCommand', exec)
  const conn = { sftp: (callback: (error: null, client: typeof transport) => void) => callback(null, transport) }
  const uploadScript = Reflect.get(runner, 'uploadScript') as (connection: typeof conn, artifact: { content: string; checksum: string; destination: string }) => Promise<void>
  const upload = () => uploadScript.call(runner, conn, { content, checksum, destination })
  return { upload, transport, exec, stored: () => stored }
}

describe('approved script upload', () => {
  it('creates the remote artifact exclusively before checksum verification', async () => {
    const f = fixture()
    await f.upload()
    expect(f.stored()).toBe('printf safe')
    expect(f.transport.writeFile.mock.calls[0]?.[2]).toMatchObject({ flag: 'wx', mode: 0o700 })
    expect(f.exec).toHaveBeenCalledOnce()
  })
  it('accepts an approved random decimal destination and refuses to overwrite it on repeat', async () => {
    const f = fixture(false, '/tmp/nodeaccess-ai-script-340282366920938463463374607431768211455.sh')
    await f.upload()
    await expect(f.upload()).rejects.toThrow('File exists')
    expect(f.exec).toHaveBeenCalledOnce()
    expect(f.stored()).toBe('printf safe')
  })
  it('does not overwrite or chmod a preexisting destination and never reaches execution', async () => {
    const f = fixture(true)
    await expect(f.upload()).rejects.toThrow('File exists')
    expect(f.stored()).toBe('preexisting-content')
    expect(f.transport.chmod).not.toHaveBeenCalled()
    expect(f.exec).not.toHaveBeenCalled()
  })
})
