import { afterEach, describe, expect, it } from 'vitest'
import net from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diagnosticHosts, probeNativeSshGateway } from './native-ssh-gateway.diagnostics.js'
import { inspectHostKey } from './native-ssh-gateway.host-key.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('Native SSH Gateway diagnostics', () => {
  it('recognizes an SSH listener without attempting authentication', async () => {
    const server = net.createServer((socket) => socket.end('SSH-2.0-NodeAccess\r\n'))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('listener not available')

    try {
      const result = await probeNativeSshGateway('127.0.0.1', address.port, 1_000)
      expect(result).toMatchObject({ success: true, banner: 'SSH-2.0-NodeAccess' })
      expect(result.latencyMs).toBeTypeOf('number')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('uses only controlled internal candidates for wildcard listeners', () => {
    expect(diagnosticHosts('0.0.0.0')).toEqual(['ssh-gateway', '127.0.0.1'])
    expect(diagnosticHosts('10.0.0.8')).toEqual(['10.0.0.8', 'ssh-gateway', '127.0.0.1'])
  })

  it('reports missing, unreadable and invalid host keys with actionable states', () => {
    expect(inspectHostKey(undefined)).toMatchObject({ state: 'missing', key: null })
    expect(inspectHostKey('/path/that/does/not/exist')).toMatchObject({ state: 'unreadable', key: null })

    const directory = mkdtempSync(join(tmpdir(), 'nodeaccess-gateway-key-'))
    temporaryDirectories.push(directory)
    const invalidPath = join(directory, 'invalid-key')
    writeFileSync(invalidPath, 'not-a-private-key', { mode: 0o600 })
    expect(inspectHostKey(invalidPath)).toMatchObject({ state: 'invalid', permissionsSafe: true, key: null })
  })

  it('extracts algorithm and stable SHA256 fingerprint from a valid host key', () => {
    const result = inspectHostKey(join(process.cwd(), 'tools/load-tests/data/mock-ssh-host-key'))
    expect(result.state).toBe('valid')
    expect(result.algorithm).toMatch(/^ssh-/)
    expect(result.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]+$/)
    expect(result.key?.length).toBeGreaterThan(0)
  })
})
