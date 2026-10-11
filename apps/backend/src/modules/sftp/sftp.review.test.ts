import Fastify from 'fastify'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { sftpRoutes } from './sftp.routes.js'
import { SftpController } from './sftp.controller.js'
import { SftpService } from './sftp.service.js'
import { settingsRoutes } from '../settings/settings.routes.js'
import { ForbiddenError } from '../../shared/errors.js'

// Regression tests for defects confirmed during the SFTP review.
describe('SFTP review: HTTP contract', () => {
  async function mkdirRequest(body: object, query = '') {
    const app = Fastify()
    app.decorateRequest('jwtVerify', async () => ({ sub: '20', tenantId: 1, role: 'user', stage: 'authenticated' }))
    const mkdir = vi.fn().mockResolvedValue(undefined)
    await sftpRoutes(app, new SftpController({ mkdir } as never))
    try {
      return { response: await app.inject({ method: 'POST', url: `/10/mkdir${query}`, payload: body }), mkdir }
    } finally { await app.close() }
  }

  it('accepts path in the declared request body', async () => {
    const { response, mkdir } = await mkdirRequest({ path: '/tmp/new', sessionId: 77 })
    expect(response.statusCode).toBe(204)
    expect(mkdir).toHaveBeenCalledWith(10, 20, 1, 'user', '/tmp/new')
  })

  it('rejects mkdir without a body path', async () => {
    const { response } = await mkdirRequest({}, '?path=%2Ftmp%2Fnew&sessionId=77')
    expect(response.statusCode).toBe(400)
  })
})

describe('SFTP review: editor byte boundaries', () => {
  async function read(chunks: Buffer[], statSize = chunks.reduce((n, c) => n + c.length, 0)) {
    const service = new SftpService({} as never, {} as never)
    const conn = { end: vi.fn() }
    vi.spyOn(service as any, 'openSftp').mockResolvedValue({
      conn, bastionConn: null,
      sftp: {
        stat: (_: string, callback: Function) => callback(null, { size: statSize }),
        createReadStream: () => Readable.from(chunks),
      },
    })
    const result = await service.readFile(10, 20, 1, 'user', '/tmp/review.txt')
    expect(conn.end).toHaveBeenCalledOnce()
    return result
  }

  it('reads exactly 1 MiB without marking truncation', async () => {
    const result = await read([Buffer.alloc(1_048_576, 'a')])
    expect(result.truncated).toBe(false)
    expect(result.content.length).toBe(1_048_576)
  })

  it('flags a chunk that crosses the 1 MiB boundary', async () => {
    expect((await read([Buffer.alloc(1_048_577, 'a')])).truncated).toBe(true)
  })

  it('SFTP-02: flags extra bytes after an exact 1 MiB chunk boundary', async () => {
    const result = await read([Buffer.alloc(1_048_576, 'a'), Buffer.from('TAIL')], 1_048_576)
    expect(result.truncated).toBe(true)
    expect(result.hash).toBeNull()
  })
})

describe('SFTP review: audit masking', () => {
  it('SFTP-03: masks a quoted secret containing spaces completely', () => {
    const controller = new SftpController({} as never)
    const masked = (controller as any).maskSensitiveLine('password="first second third"')
    expect(masked).not.toContain('second')
    expect(masked).not.toContain('third')
  })

  it('SFTP-03: masks JSON secret values', () => {
    const controller = new SftpController({} as never)
    expect((controller as any).maskSensitiveLine('"password": "CANARY-secret"')).not.toContain('CANARY-secret')
  })
  it.each([
    'password: |\n  CANARY-private',
    '-----BEGIN OPENSSH PRIVATE KEY-----\nCANARY-private\n-----END OPENSSH PRIVATE KEY-----',
    '"secret": {\n  "value": "CANARY-private"\n}',
  ])('suppresses multiline secrets in diff previews and backup diffs', content => {
    const controller = new SftpController({} as never) as any
    expect(controller.diffSummary('', content).diffPreviewMasked).not.toContain('CANARY-private')
    expect(controller.fullMaskedDiff(Buffer.from(''), Buffer.from(content), { diffMaxBytes: 1048576, diffMaxLines: 400 })).toMatchObject({ diffMasked: '', skippedReason: 'sensitive-content' })
  })
})

describe('SFTP review: authorization across operations', () => {
  it.each(['ping', 'list', 'download', 'upload', 'mkdir', 'rename', 'delete', 'createFile', 'readFile'] as const)(
    'rejects %s before resolving credentials when connect permission is absent', async operation => {
      const repo = { findHostWithCredentials: vi.fn().mockResolvedValue({ id: 10, tenantId: 7 }), hasEffectiveHostPermission: vi.fn().mockResolvedValue(false) }
      const credentials = { resolve: vi.fn() }
      const service = new SftpService(repo as never, credentials as never)
      await expect((service[operation] as Function).call(service, 10, 20, 7, 'user', '/tmp/file', Buffer.from('test'))).rejects.toBeInstanceOf(ForbiddenError)
      expect(repo.findHostWithCredentials).toHaveBeenCalledWith(10, 7)
      expect(repo.hasEffectiveHostPermission).toHaveBeenCalledWith(10, 7, 20, 'connect', 'USER')
      expect(credentials.resolve).not.toHaveBeenCalled()
    },
  )
})

describe('SFTP review: policy route', () => {
  const policy = { blockOnModePreservationFailure: true, blockOnOwnershipPreservationFailure: false, blockOnTimestampPreservationFailure: true, diffMaxBytes: 4096, diffMaxLines: 20 }
  async function update(role: string, payload: object) {
    const app = Fastify()
    app.decorateRequest('jwtVerify', async () => ({ sub: '20', tenantId: 7, role, stage: 'authenticated' }))
    app.setErrorHandler((error, _, reply) => reply.status(error.statusCode ?? 500).send({ message: error.message }))
    const saved = vi.fn(async (req, reply) => reply.send({ tenantId: req.jwtUser.tenantId, policy: req.body }))
    const controller = new Proxy({}, { get: (_, key) => key === 'updateSftpPolicySettings' ? saved : async () => ({}) })
    await settingsRoutes(app, controller as never)
    try { return { response: await app.inject({ method: 'PATCH', url: '/sftp-policy', payload }), saved } }
    finally { await app.close() }
  }

  it('keeps admin policy updates in the authenticated tenant', async () => {
    const { response } = await update('admin', policy)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ tenantId: 7, policy })
  })
  it('rejects a regular user', async () => {
    const { response, saved } = await update('user', policy)
    expect(response.statusCode).toBe(403)
    expect(saved).not.toHaveBeenCalled()
  })
  it.each([{ diffMaxBytes: 4095 }, { diffMaxBytes: 10_485_761 }, { diffMaxLines: 19 }, { diffMaxLines: 2001 }])('rejects out-of-range policy %j', async override => {
    const { response, saved } = await update('admin', { ...policy, ...override })
    expect(response.statusCode).toBe(400)
    expect(saved).not.toHaveBeenCalled()
  })
})

describe('SFTP review: failure feedback and audit', () => {
  it.each([
    [3, 'Permission denied', 403, 'SFTP_PERMISSION_DENIED'],
    [2, 'No such file', 404, 'SFTP_NOT_FOUND'],
    [4, 'Directory not empty', 409, 'SFTP_DIRECTORY_NOT_EMPTY'],
    [4, 'Disk quota exceeded', 507, 'SFTP_QUOTA_EXCEEDED'],
    [4, 'No space left on device', 507, 'SFTP_NO_SPACE_LEFT'],
    ['ECONNRESET', 'Connection reset', 503, 'SFTP_CONNECTION_LOST'],
  ])('maps %s/%s to %s/%s and audits the failed operation', async (code, message, status, expectedCode) => {
    const app = Fastify()
    app.decorateRequest('jwtVerify', async () => ({ sub: '20', tenantId: 7, role: 'user', stage: 'authenticated' }))
    const logs = { logAdminEvent: vi.fn().mockResolvedValue(undefined) }
    const service = { delete: vi.fn().mockRejectedValue(Object.assign(new Error(String(message)), { code })) }
    await sftpRoutes(app, new SftpController(service as never, logs as never))
    try {
      const response = await app.inject({ method: 'DELETE', url: '/10/file?path=%2Ftmp%2Freview&sessionId=77' })
      expect(response.statusCode).toBe(status)
      expect(response.json().code).toBe(expectedCode)
      expect(JSON.parse(logs.logAdminEvent.mock.calls[0][0].details)).toMatchObject({ action: 'delete', path: '/tmp/review', success: false, sessionId: 77 })
    } finally { await app.close() }
  })
})

it('blocks restoration and removes the temporary file when strict metadata preservation fails', async () => {
  const app = Fastify()
  app.decorateRequest('jwtVerify', async () => ({ sub: '20', tenantId: 7, role: 'user', stage: 'authenticated' }))
  const data = Buffer.from('original=true\n')
  const service = {
    statFile: vi.fn().mockResolvedValue({ mode: 0o600 }),
    download: vi.fn().mockResolvedValue(data),
    mkdir: vi.fn().mockResolvedValue(undefined),
    upload: vi.fn().mockResolvedValue(undefined),
    applyFileMetadata: vi.fn().mockResolvedValue({ mode: false, ownership: false, timestamps: false, skipped: [], errors: ['chmod denied'] }),
    rename: vi.fn(), delete: vi.fn().mockResolvedValue(undefined),
  }
  const settings = { findSftpPolicySettings: vi.fn().mockResolvedValue({ blockOnModePreservationFailure: true }) }
  await sftpRoutes(app, new SftpController(service as never, undefined, settings as never))
  try {
    const response = await app.inject({ method: 'POST', url: '/10/restore-backup', payload: {
      path: '/tmp/file', backupPath: '/tmp/.nodeaccess-backups/file.2026-10-03.user-20.backup.bak',
    } })
    expect(response.statusCode, response.body).toBe(422)
    expect(response.json().code).toBe('SFTP_METADATA_PRESERVATION_FAILED')
    expect(service.rename).not.toHaveBeenCalled()
    expect(service.delete).toHaveBeenCalledOnce()
    expect(service.upload.mock.calls.every(call => call[6]?.mode === 0o600 && call[6]?.flags === 'wx')).toBe(true)
  } finally { await app.close() }
})
