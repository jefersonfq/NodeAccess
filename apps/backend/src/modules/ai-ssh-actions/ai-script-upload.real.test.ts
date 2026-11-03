import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Client, type SFTPWrapper } from 'ssh2'
import { SshIsolatedAiActionRunner } from './ai-ssh-action.execution.js'

// Explicit opt-in: creates its own disposable OpenSSH, never accepts a user host.
describe.skipIf(process.env.RUN_AI_SCRIPT_SFTP_REAL !== 'true')('exclusive upload against disposable OpenSSH', () => {
  const image = 'nodeaccess-trial-ssh:2.1.0'
  const name = `nodeaccess-audit-sftp-${randomUUID()}`
  const network = `${name}-net`
  let containerCreated = false, networkCreated = false
  let setupDeadline = Number.POSITIVE_INFINITY
  let connection: Client | undefined, sftp: SFTPWrapper
  function docker(args: string[], input?: string): string {
    const remaining = Math.floor(setupDeadline - performance.now())
    if (remaining <= 0) throw new Error('Disposable setup deadline exceeded')
    const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: Math.min(20_000, remaining) })
    if (result.status !== 0) throw new Error(`Disposable Docker operation failed: ${args[0]}${args[0] === 'port' ? ` (${result.stderr.trim()})` : ''}`)
    return result.stdout.trim()
  }
  const write = (path: string, value: Buffer | string, mode = 0o600) => new Promise<void>((resolve, reject) => {
    sftp.writeFile(path, value, { mode, flag: 'wx' }, error => error ? reject(error) : resolve())
  })
  const read = (path: string) => new Promise<Buffer>((resolve, reject) => sftp.readFile(path, (error, value) => error ? reject(error) : resolve(value)))
  const mode = (path: string) => new Promise<number>((resolve, reject) => sftp.stat(path, (error, stat) => error ? reject(error) : resolve(stat.mode & 0o777)))

  beforeAll(async () => {
    setupDeadline = performance.now() + 25_000
    // Fail if the reviewed local image is unavailable; no pull/build/publication.
    const imageId = docker(['image', 'inspect', image, '--format', '{{.Id}}'])
    docker(['network', 'create', network]); networkCreated = true
    docker(['run', '--detach', '--rm', '--pull=never', '--name', name, '--network', network,
      '--publish', '127.0.0.1::2222', '--memory', '128m', '--cpus', '0.5', '--pids-limit', '64', imageId])
    containerCreated = true
    const password = randomBytes(24).toString('hex')
    docker(['exec', '-i', name, '/bin/sh'], `set -eu
while [ ! -d /run/sshd ]; do sleep 0.1; done
printf '%s\\n' 'demo:${password}' | chpasswd
ssh-keygen -A >/dev/null 2>&1
cat > /run/sshd_config <<'CONFIG'
Port 2222
ListenAddress 0.0.0.0
HostKey /etc/ssh/ssh_host_ed25519_key
PasswordAuthentication yes
PermitRootLogin no
AllowUsers demo
UsePAM no
AllowTcpForwarding no
X11Forwarding no
Subsystem sftp internal-sftp
CONFIG
touch /run/lab-ready
`)
    const publicKey = docker(['exec', name, 'cat', '/etc/ssh/ssh_host_ed25519_key.pub']).split(' ')[1]!
    const expectedHostHash = createHash('sha256').update(Buffer.from(publicKey, 'base64')).digest('hex')
    const binding = docker(['port', name, '2222/tcp'])
    if (!/^127\.0\.0\.1:\d+$/.test(binding)) throw new Error('Disposable SSH must bind loopback only')
    const port = Number(binding.split(':')[1])
    const connectDeadline = Math.min(setupDeadline, performance.now() + 15_000)
    while (performance.now() < connectDeadline) {
      const candidate = new Client()
      try {
        await new Promise<void>((resolve, reject) => {
          candidate.once('ready', resolve).once('error', reject).connect({ host: '127.0.0.1', port,
            username: 'demo', password, readyTimeout: Math.max(1, Math.min(2_000, Math.floor(connectDeadline - performance.now()))), hostHash: 'sha256',
            hostVerifier: hash => hash === expectedHostHash, algorithms: { serverHostKey: ['ssh-ed25519'] } })
        })
        connection = candidate; break
      } catch {
        candidate.destroy()
        const remaining = connectDeadline - performance.now()
        if (remaining > 0) await delay(Math.min(100, remaining))
      }
    }
    if (!connection) throw new Error('Disposable SSH unavailable within deadline')
    sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
      const timeout = setTimeout(() => { connection!.destroy(); reject(new Error('Disposable SFTP setup deadline exceeded')) }, Math.max(1, setupDeadline - performance.now()))
      connection!.sftp((error, client) => {
        clearTimeout(timeout)
        if (error) reject(error)
        else resolve(client)
      })
    })
  }, 30_000)

  afterAll(() => {
    setupDeadline = Number.POSITIVE_INFINITY
    sftp?.end(); connection?.destroy()
    try { if (containerCreated) docker(['rm', '--force', name]) }
    finally { if (networkCreated) docker(['network', 'rm', network]) }
  })

  it('creates 0600, preserves binary content and rejects a second write', async () => {
    const path = '/tmp/exclusive-data.bin', content = Buffer.concat([Buffer.from('ação\n'), randomBytes(65_536)])
    await write(path, content)
    expect(await mode(path)).toBe(0o600)
    expect(await read(path)).toEqual(content)
    await expect(write(path, 'replacement')).rejects.toBeDefined()
    expect(await read(path)).toEqual(content)
    expect(await mode(path)).toBe(0o600)
  })

  it('does not overwrite a preexisting file or follow a preexisting symlink', async () => {
    const path = '/tmp/preexisting.txt', link = '/tmp/preexisting-link'
    await write(path, 'preserve', 0o640)
    await expect(write(path, 'overwrite')).rejects.toBeDefined()
    await new Promise<void>((resolve, reject) => sftp.symlink(path, link, error => error ? reject(error) : resolve()))
    await expect(write(link, 'overwrite')).rejects.toBeDefined()
    expect(await read(path)).toEqual(Buffer.from('preserve'))
    expect(await mode(path)).toBe(0o640)
  })

  it('runs the actual artifact uploader with 0700 and real remote checksum, then refuses repeat', async () => {
    const runner = new SshIsolatedAiActionRunner({} as never)
    const content = '#!/bin/sh\nprintf synthetic-only\\n\n'
    const artifact = { destination: '/tmp/nodeaccess-ai-script-340282366920938463463374607431768211455.sh', content,
      checksum: createHash('sha256').update(content).digest('hex') }
    const upload = () => Reflect.get(runner, 'uploadScript').call(runner, connection, artifact) as Promise<void>
    await upload()
    expect(await read(artifact.destination)).toEqual(Buffer.from(content))
    expect(await mode(artifact.destination)).toBe(0o700)
    await expect(upload()).rejects.toBeDefined()
    expect(await read(artifact.destination)).toEqual(Buffer.from(content))
    expect(await mode(artifact.destination)).toBe(0o700)
  })
})
