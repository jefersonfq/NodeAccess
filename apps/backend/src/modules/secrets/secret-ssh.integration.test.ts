import { generateKeyPairSync } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Client, Server } from 'ssh2'
import { encrypt } from '../../shared/crypto.js'
import { SecretService } from './secret.service.js'

const credentials = new Map([
  [101, { username: 'joao', password: 'CANARY-JOAO-ssh-1!' }],
  [102, { username: 'maria', password: 'CANARY-MARIA-ssh-2!' }],
])
let server: Server
let port: number

function secretRow(id: number, ownerUserId: number, revoked = false) {
  const credential = credentials.get(id)!
  const payload = encrypt(credential.password)
  return {
    id, tenantId: 7, alias: `ssh-${credential.username}`, description: null, scope: 'PERSONAL' as const,
    ownerUserId, groupId: null, createdByUserId: ownerUserId, createdByUsername: credential.username,
    source: 'MANUAL' as const, encryptedValue: payload.encrypted, iv: payload.iv,
    createdAt: new Date(), updatedAt: new Date(), rotatedAt: null, revokedAt: revoked ? new Date() : null,
  }
}

function connect(username: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    client.once('ready', () => { client.end(); resolve() })
    client.once('error', reject)
    client.connect({ host: '127.0.0.1', port, username, password, readyTimeout: 3000, hostVerifier: () => true })
  })
}

describe.skipIf(process.env.RUN_SECRET_SSH_REAL !== 'true')('Secret -> SSH real integration', () => {
  beforeAll(async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    server = new Server({ hostKeys: [privateKey.export({ type: 'pkcs1', format: 'pem' })] }, (client) => {
      client.on('authentication', (ctx) => {
        const valid = ctx.method === 'password'
          && [...credentials.values()].some((item) => item.username === ctx.username && item.password === ctx.password)
        valid ? ctx.accept() : ctx.reject()
      })
      client.on('ready', () => client.on('session', (accept) => accept()))
    })
    await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
    port = (server.address() as { port: number }).port
  })

  afterAll(async () => new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve()))

  it.each([[101, 41, 'joao'], [102, 42, 'maria']])('connects user-specific credential %s without exposing it in audit', async (secretId, userId, username) => {
    const row = secretRow(secretId, userId)
    const repo = { findUserGroupIds: vi.fn().mockResolvedValue([]), findAccessibleById: vi.fn().mockResolvedValue(row) }
    const logs = { logAdminEvent: vi.fn().mockResolvedValue(undefined) }
    const service = new SecretService(repo as never, logs as never, { requireFeature: vi.fn() } as never)
    const password = await service.resolveValueById(secretId, userId, 7, 'user', { resourceType: 'SshSession', hostId: 9 })
    await expect(connect(username, password)).resolves.toBeUndefined()
    expect(JSON.stringify(logs.logAdminEvent.mock.calls)).not.toContain(password)
  })

  it('rejects a revoked secret before opening SSH', async () => {
    const repo = { findUserGroupIds: vi.fn().mockResolvedValue([]), findAccessibleById: vi.fn().mockResolvedValue(secretRow(101, 41, true)) }
    const service = new SecretService(repo as never, { logAdminEvent: vi.fn() } as never, { requireFeature: vi.fn() } as never)
    await expect(service.resolveValueById(101, 41, 7, 'user', { resourceType: 'SshSession' }))
      .rejects.toMatchObject({ code: 'SECRET_REVOKED' })
  })

  it('proves an incorrect credential cannot authenticate', async () => {
    await expect(connect('joao', 'incorrect-CANARY')).rejects.toBeTruthy()
  })
})
