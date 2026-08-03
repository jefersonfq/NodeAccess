import { describe, expect, it, vi } from 'vitest'
import { SftpController } from './sftp.controller.js'
import { ForbiddenError } from '../../shared/errors.js'

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    jwtUser: { sub: '20', tenantId: 1, role: 'user', email: 'user@example.test' },
    params: { hostId: '10' },
    query: {},
    body: {},
    ...overrides,
  }
}

function makeReply() {
  const reply = {
    status: vi.fn(),
    header: vi.fn(),
    send: vi.fn(),
  }
  reply.status.mockReturnValue(reply)
  reply.header.mockReturnValue(reply)
  return reply
}

describe('SftpController audit', () => {
  it('audits writeFile metadata without logging file content', async () => {
    const sftp = {
      readFile: vi.fn()
        .mockResolvedValueOnce({
        content: 'password=old-secret\n',
        size: 20,
        truncated: false,
        modifiedAt: '2026-07-19T10:00:00.000Z',
        hash: 'old-hash',
        mode: 0o640,
        owner: 1000,
        group: 1001,
        accessedAt: '2026-07-19T09:00:00.000Z',
        accessedAtEpoch: 1784448000,
        modifiedAtEpoch: 1784455200,
        })
        .mockResolvedValueOnce({
          content: 'password=super-secret\n',
          size: Buffer.byteLength('password=super-secret\n', 'utf-8'),
          truncated: false,
          modifiedAt: '2026-07-19T10:01:00.000Z',
          hash: '41160aa6149d6bef85fabd79858df67fcf6f14a1490d9a373b15cfd52bfc0ad9',
          mode: 0o600,
          owner: 1000,
          group: 1001,
          accessedAt: '2026-07-19T09:01:00.000Z',
          accessedAtEpoch: 1784448060,
          modifiedAtEpoch: 1784455260,
        }),
      mkdir: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn().mockResolvedValue(undefined),
      applyFileMetadata: vi.fn().mockResolvedValue({
        mode: true,
        ownership: false,
        timestamps: true,
        skipped: [],
        errors: ['chown: permission denied'],
      }),
      rename: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    }
    const logRepo = {
      logAdminEvent: vi.fn().mockResolvedValue(undefined),
    }
    const controller = new SftpController(sftp as never, logRepo as never)
    const req = makeRequest({
      body: {
        path: '/etc/app.conf',
        content: 'password=super-secret\n',
        sessionId: 77,
        expectedHash: 'old-hash',
        expectedModifiedAt: '2026-07-19T10:00:00.000Z',
        expectedSize: 20,
      },
    })
    const reply = makeReply()

    await controller.writeFile(req as never, reply as never)

    expect(sftp.mkdir).toHaveBeenCalledWith(
      10,
      20,
      1,
      'user',
      '/etc/.nodeaccess-backups',
    )
    expect(sftp.upload).toHaveBeenNthCalledWith(
      1,
      10,
      20,
      1,
      'user',
      expect.stringMatching(/^\/etc\/\.nodeaccess-backups\/app\.conf\..+\.user-20\.backup\.bak$/),
      Buffer.from('password=old-secret\n', 'utf-8'),
    )
    expect(sftp.upload).toHaveBeenNthCalledWith(
      2,
      10,
      20,
      1,
      'user',
      expect.stringMatching(/^\/etc\/\.app\.conf\.nodeaccess-.+\.user-20\.tmp$/),
      Buffer.from('password=super-secret\n', 'utf-8'),
    )
    expect(sftp.applyFileMetadata).toHaveBeenCalledWith(
      10,
      20,
      1,
      'user',
      expect.stringMatching(/^\/etc\/\.app\.conf\.nodeaccess-.+\.user-20\.tmp$/),
      {
        mode: 0o640,
        owner: 1000,
        group: 1001,
        accessedAtEpoch: 1784448000,
        modifiedAtEpoch: 1784455200,
      },
    )
    expect(sftp.rename).toHaveBeenCalledWith(
      10,
      20,
      1,
      'user',
      expect.stringMatching(/^\/etc\/\.app\.conf\.nodeaccess-.+\.user-20\.tmp$/),
      '/etc/app.conf',
    )
    expect(reply.status).toHaveBeenCalledWith(204)
    expect(logRepo.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({
      adminId: 20,
      action: 'SFTP_OPERATION',
      targetType: 'Host',
      targetId: 10,
    }))

    const details = JSON.parse(logRepo.logAdminEvent.mock.calls[0][0].details)
    expect(details).toMatchObject({
      provider: 'sftp',
      action: 'writeFile',
      hostId: 10,
      path: '/etc/app.conf',
      success: true,
      sessionId: 77,
      size: Buffer.byteLength('password=super-secret\n', 'utf-8'),
      backupPath: expect.stringContaining('/etc/.nodeaccess-backups/app.conf.'),
      tempPath: expect.stringContaining('/etc/.app.conf.nodeaccess-'),
      beforeHash: 'old-hash',
      afterHash: '41160aa6149d6bef85fabd79858df67fcf6f14a1490d9a373b15cfd52bfc0ad9',
      beforeSize: 20,
      afterSize: Buffer.byteLength('password=super-secret\n', 'utf-8'),
      preservedMode: true,
      preservedOwnership: false,
      preservedTimestamps: true,
      metadataPreservationErrors: ['chown: permission denied'],
    })
    expect(details.diffPreviewMasked).toContain('password=[MASKED]')
    expect(JSON.stringify(details)).not.toContain('super-secret')
    expect(JSON.stringify(details)).not.toContain('old-secret')
  })

  it('falls back to unlink-rename when SFTP rename refuses to overwrite an existing file', async () => {
    const renameFailure = Object.assign(new Error('Failure'), { code: 4 })
    const sftp = {
      readFile: vi.fn()
        .mockResolvedValueOnce({
          content: 'mode=old\n',
          size: 9,
          truncated: false,
          modifiedAt: '2026-07-19T10:00:00.000Z',
          hash: 'old-hash',
          mode: 0o640,
          owner: 1000,
          group: 1001,
          accessedAt: '2026-07-19T09:00:00.000Z',
          accessedAtEpoch: 1784448000,
          modifiedAtEpoch: 1784455200,
        })
        .mockResolvedValueOnce({
          content: 'mode=new\n',
          size: Buffer.byteLength('mode=new\n', 'utf-8'),
          truncated: false,
          modifiedAt: '2026-07-19T10:01:00.000Z',
          hash: '2211f34275d400ced73eb57f59a7818778aaa600dd6a29e87ec11fe873828616',
          mode: 0o640,
          owner: 1000,
          group: 1001,
          accessedAt: '2026-07-19T09:01:00.000Z',
          accessedAtEpoch: 1784448060,
          modifiedAtEpoch: 1784455260,
        }),
      mkdir: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn().mockResolvedValue(undefined),
      applyFileMetadata: vi.fn().mockResolvedValue({
        mode: true,
        ownership: true,
        timestamps: true,
        skipped: [],
        errors: [],
      }),
      rename: vi.fn().mockRejectedValue(renameFailure),
      replaceExistingFile: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    }
    const logRepo = {
      logAdminEvent: vi.fn().mockResolvedValue(undefined),
    }
    const controller = new SftpController(sftp as never, logRepo as never)
    const req = makeRequest({
      body: {
        path: '/etc/app.conf',
        content: 'mode=new\n',
        expectedHash: 'old-hash',
        expectedModifiedAt: '2026-07-19T10:00:00.000Z',
        expectedSize: 9,
      },
    })
    const reply = makeReply()

    await controller.writeFile(req as never, reply as never)

    expect(sftp.rename).toHaveBeenCalledWith(
      10,
      20,
      1,
      'user',
      expect.stringMatching(/^\/etc\/\.app\.conf\.nodeaccess-.+\.user-20\.tmp$/),
      '/etc/app.conf',
    )
    expect(sftp.replaceExistingFile).toHaveBeenCalledWith(
      10,
      20,
      1,
      'user',
      expect.stringMatching(/^\/etc\/\.app\.conf\.nodeaccess-.+\.user-20\.tmp$/),
      '/etc/app.conf',
    )
    expect(sftp.delete).not.toHaveBeenCalled()
    expect(reply.status).toHaveBeenCalledWith(204)

    const details = JSON.parse(logRepo.logAdminEvent.mock.calls[0][0].details)
    expect(details).toMatchObject({
      action: 'writeFile',
      path: '/etc/app.conf',
      success: true,
      replaceStrategy: 'unlink-rename',
    })
  })

  it('audits failed SFTP operations as unsuccessful without blocking the error response', async () => {
    const sftp = {
      delete: vi.fn().mockRejectedValue(new ForbiddenError('Sem permissão para conectar a este host')),
    }
    const logRepo = {
      logAdminEvent: vi.fn().mockResolvedValue(undefined),
    }
    const controller = new SftpController(sftp as never, logRepo as never)
    const req = makeRequest({
      query: { path: '/var/log/app.log', sessionId: '88' },
    })
    const reply = makeReply()

    await controller.delete(req as never, reply as never)

    expect(reply.status).toHaveBeenCalledWith(403)
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      code: 'FORBIDDEN',
    }))
    expect(logRepo.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SFTP_OPERATION',
      targetType: 'Host',
      targetId: 10,
    }))

    const details = JSON.parse(logRepo.logAdminEvent.mock.calls[0][0].details)
    expect(details).toMatchObject({
      provider: 'sftp',
      action: 'delete',
      hostId: 10,
      path: '/var/log/app.log',
      success: false,
      sessionId: 88,
      errorMessage: 'Sem permissão para conectar a este host',
    })
  })

  it('downloads a NodeAccess backup with audit metadata', async () => {
    const backup = Buffer.from('backup-content\n', 'utf-8')
    const sftp = {
      download: vi.fn().mockResolvedValue(backup),
    }
    const logRepo = {
      logAdminEvent: vi.fn().mockResolvedValue(undefined),
    }
    const controller = new SftpController(sftp as never, logRepo as never)
    const req = makeRequest({
      query: {
        path: '/etc/app.conf',
        backupPath: '/etc/.nodeaccess-backups/app.conf.2026-07-19T10-00-00-000Z.user-20.backup.bak',
        sessionId: 91,
      },
    })
    const reply = makeReply()

    await controller.downloadBackup(req as never, reply as never)

    expect(sftp.download).toHaveBeenCalledWith(10, 20, 1, 'user', '/etc/.nodeaccess-backups/app.conf.2026-07-19T10-00-00-000Z.user-20.backup.bak')
    expect(reply.header).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="app.conf.2026-07-19T10-00-00-000Z.user-20.backup.bak"')
    expect(reply.header).toHaveBeenCalledWith('Content-Type', 'application/octet-stream')
    expect(reply.header).toHaveBeenCalledWith('Content-Length', backup.length)
    expect(reply.send).toHaveBeenCalledWith(backup)

    const details = JSON.parse(logRepo.logAdminEvent.mock.calls[0][0].details)
    expect(details).toMatchObject({
      provider: 'sftp',
      action: 'downloadBackup',
      hostId: 10,
      path: '/etc/app.conf',
      backupPath: '/etc/.nodeaccess-backups/app.conf.2026-07-19T10-00-00-000Z.user-20.backup.bak',
      success: true,
      sessionId: 91,
      size: backup.length,
    })
  })

  it('rejects downloadBackup when backup is outside the NodeAccess backup directory', async () => {
    const sftp = {
      download: vi.fn(),
    }
    const logRepo = {
      logAdminEvent: vi.fn().mockResolvedValue(undefined),
    }
    const controller = new SftpController(sftp as never, logRepo as never)
    const req = makeRequest({
      query: {
        path: '/etc/app.conf',
        backupPath: '/tmp/app.conf.bak',
      },
    })
    const reply = makeReply()

    await controller.downloadBackup(req as never, reply as never)

    expect(sftp.download).not.toHaveBeenCalled()
    expect(reply.status).toHaveBeenCalledWith(400)
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      code: 'SFTP_INVALID_BACKUP_PATH',
    }))
  })

  it('audits readFile metadata without logging file content', async () => {
    const sftp = {
      readFile: vi.fn().mockResolvedValue({
        content:   'token=do-not-log\n',
        size:      17,
        truncated: false,
        modifiedAt: '2026-07-19T10:00:00.000Z',
      hash: 'read-hash',
      mode: 0o600,
      owner: 1000,
      group: 1001,
      accessedAt: '2026-07-19T09:00:00.000Z',
      accessedAtEpoch: 1784448000,
      modifiedAtEpoch: 1784455200,
      }),
    }
    const logRepo = {
      logAdminEvent: vi.fn().mockResolvedValue(undefined),
    }
    const controller = new SftpController(sftp as never, logRepo as never)
    const req = makeRequest({
      query: { path: '/opt/app/.env', sessionId: 99 },
    })
    const reply = makeReply()

    await controller.readFile(req as never, reply as never)

    expect(reply.send).toHaveBeenCalledWith({
      content:   'token=do-not-log\n',
      size:      17,
      truncated: false,
      modifiedAt: '2026-07-19T10:00:00.000Z',
      hash: 'read-hash',
      mode: 0o600,
      owner: 1000,
      group: 1001,
      accessedAt: '2026-07-19T09:00:00.000Z',
      accessedAtEpoch: 1784448000,
      modifiedAtEpoch: 1784455200,
    })

    const details = JSON.parse(logRepo.logAdminEvent.mock.calls[0][0].details)
    expect(details).toMatchObject({
      provider: 'sftp',
      action: 'readFile',
      hostId: 10,
      path: '/opt/app/.env',
      success: true,
      sessionId: 99,
      size: 17,
    })
    expect(JSON.stringify(details)).not.toContain('do-not-log')
  })

  it('returns a clear SFTP permission error for create/write failures', async () => {
    const sftpError = Object.assign(new Error('Permission denied'), { code: 3 })
    const sftp = {
      createFile: vi.fn().mockRejectedValue(sftpError),
    }
    const logRepo = {
      logAdminEvent: vi.fn().mockResolvedValue(undefined),
    }
    const controller = new SftpController(sftp as never, logRepo as never)
    const req = makeRequest({
      query: { path: '/root/blocked.txt' },
    })
    const reply = makeReply()

    await controller.createFile(req as never, reply as never)

    expect(reply.status).toHaveBeenCalledWith(403)
    expect(reply.send).toHaveBeenCalledWith({
      code:    'SFTP_PERMISSION_DENIED',
      message: 'Permissão negada pelo servidor SFTP para este caminho. Verifique usuário SSH, dono do arquivo e permissões de escrita/leitura.',
    })

    const details = JSON.parse(logRepo.logAdminEvent.mock.calls[0][0].details)
    expect(details).toMatchObject({
      action: 'createFile',
      path: '/root/blocked.txt',
      success: false,
      errorMessage: 'Permission denied',
    })
  })

  it('blocks writeFile when the remote file changed since opening', async () => {
    const sftp = {
      readFile: vi.fn().mockResolvedValue({
        content: 'remote-change=true\n',
        size: 19,
        truncated: false,
        modifiedAt: '2026-07-19T11:00:00.000Z',
        hash: 'new-hash',
      }),
      mkdir: vi.fn(),
      upload: vi.fn(),
    }
    const logRepo = {
      logAdminEvent: vi.fn().mockResolvedValue(undefined),
    }
    const controller = new SftpController(sftp as never, logRepo as never)
    const req = makeRequest({
      body: {
        path: '/etc/app.conf',
        content: 'local-change=true\n',
        sessionId: 78,
        expectedHash: 'old-hash',
        expectedModifiedAt: '2026-07-19T10:00:00.000Z',
        expectedSize: 18,
      },
    })
    const reply = makeReply()

    await controller.writeFile(req as never, reply as never)

    expect(sftp.mkdir).not.toHaveBeenCalled()
    expect(sftp.upload).not.toHaveBeenCalled()
    expect(reply.status).toHaveBeenCalledWith(409)
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      code: 'SFTP_CONFLICT',
    }))

    const details = JSON.parse(logRepo.logAdminEvent.mock.calls[0][0].details)
    expect(details).toMatchObject({
      action: 'writeFile',
      path: '/etc/app.conf',
      success: false,
      sessionId: 78,
      errorMessage: 'O arquivo foi alterado no servidor desde que foi aberto. Recarregue o arquivo antes de salvar.',
    })
  })

  it('does not replace the final file when temporary validation fails', async () => {
    const sftp = {
      readFile: vi.fn()
        .mockResolvedValueOnce({
          content: 'mode=old\n',
          size: 9,
          truncated: false,
          modifiedAt: '2026-07-19T10:00:00.000Z',
          hash: 'old-hash',
        })
        .mockResolvedValueOnce({
          content: 'mode=corrupted\n',
          size: 15,
          truncated: false,
          modifiedAt: '2026-07-19T10:01:00.000Z',
          hash: 'unexpected-hash',
        }),
      mkdir: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
    }
    const logRepo = {
      logAdminEvent: vi.fn().mockResolvedValue(undefined),
    }
    const controller = new SftpController(sftp as never, logRepo as never)
    const req = makeRequest({
      body: {
        path: '/etc/app.conf',
        content: 'mode=new\n',
        expectedHash: 'old-hash',
        expectedSize: 9,
      },
    })
    const reply = makeReply()

    await controller.writeFile(req as never, reply as never)

    expect(sftp.rename).not.toHaveBeenCalled()
    expect(sftp.delete).toHaveBeenCalledWith(
      10,
      20,
      1,
      'user',
      expect.stringMatching(/^\/etc\/\.app\.conf\.nodeaccess-.+\.user-20\.tmp$/),
    )
    expect(reply.status).toHaveBeenCalledWith(422)
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      code: 'SFTP_TEMP_VALIDATION_FAILED',
    }))

    const details = JSON.parse(logRepo.logAdminEvent.mock.calls[0][0].details)
    expect(details).toMatchObject({
      action: 'writeFile',
      path: '/etc/app.conf',
      success: false,
      errorMessage: 'Falha ao validar o arquivo temporário antes da troca. O arquivo original não foi sobrescrito.',
    })
  })

  it('restores a NodeAccess backup with a pre-restore backup and audit metadata', async () => {
    const current = Buffer.from('current=true\n', 'utf-8')
    const backup = Buffer.from('current=false\n', 'utf-8')
    const sftp = {
      download: vi.fn()
        .mockResolvedValueOnce(current)
        .mockResolvedValueOnce(backup)
        .mockResolvedValueOnce(backup),
      mkdir: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    }
    const logRepo = {
      logAdminEvent: vi.fn().mockResolvedValue(undefined),
    }
    const controller = new SftpController(sftp as never, logRepo as never)
    const req = makeRequest({
      body: {
        path: '/etc/app.conf',
        backupPath: '/etc/.nodeaccess-backups/app.conf.2026-07-19T10-00-00-000Z.user-20.backup.bak',
        sessionId: 90,
      },
    })
    const reply = makeReply()

    await controller.restoreBackup(req as never, reply as never)

    expect(sftp.download).toHaveBeenNthCalledWith(1, 10, 20, 1, 'user', '/etc/app.conf')
    expect(sftp.upload).toHaveBeenNthCalledWith(
      1,
      10,
      20,
      1,
      'user',
      expect.stringMatching(/^\/etc\/\.nodeaccess-backups\/app\.conf\..+\.user-20\.pre-restore\.bak$/),
      current,
    )
    expect(sftp.download).toHaveBeenNthCalledWith(2, 10, 20, 1, 'user', '/etc/.nodeaccess-backups/app.conf.2026-07-19T10-00-00-000Z.user-20.backup.bak')
    expect(sftp.upload).toHaveBeenNthCalledWith(
      2,
      10,
      20,
      1,
      'user',
      expect.stringMatching(/^\/etc\/\.app\.conf\.nodeaccess-.+\.user-20\.tmp$/),
      backup,
    )
    expect(sftp.rename).toHaveBeenCalledWith(
      10,
      20,
      1,
      'user',
      expect.stringMatching(/^\/etc\/\.app\.conf\.nodeaccess-.+\.user-20\.tmp$/),
      '/etc/app.conf',
    )
    expect(reply.status).toHaveBeenCalledWith(204)

    const details = JSON.parse(logRepo.logAdminEvent.mock.calls[0][0].details)
    expect(details).toMatchObject({
      provider: 'sftp',
      action: 'restoreBackup',
      hostId: 10,
      path: '/etc/app.conf',
      success: true,
      sessionId: 90,
      backupPath: '/etc/.nodeaccess-backups/app.conf.2026-07-19T10-00-00-000Z.user-20.backup.bak',
      preRestoreBackupPath: expect.stringContaining('/etc/.nodeaccess-backups/app.conf.'),
      tempPath: expect.stringContaining('/etc/.app.conf.nodeaccess-'),
      beforeSize: current.length,
      afterSize: backup.length,
    })
  })

  it('rejects restoreBackup when backup is outside the NodeAccess backup directory', async () => {
    const sftp = {
      download: vi.fn(),
      upload: vi.fn(),
      rename: vi.fn(),
    }
    const logRepo = {
      logAdminEvent: vi.fn().mockResolvedValue(undefined),
    }
    const controller = new SftpController(sftp as never, logRepo as never)
    const req = makeRequest({
      body: {
        path: '/etc/app.conf',
        backupPath: '/tmp/other.conf.bak',
      },
    })
    const reply = makeReply()

    await controller.restoreBackup(req as never, reply as never)

    expect(sftp.download).not.toHaveBeenCalled()
    expect(sftp.upload).not.toHaveBeenCalled()
    expect(sftp.rename).not.toHaveBeenCalled()
    expect(reply.status).toHaveBeenCalledWith(400)
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      code: 'SFTP_INVALID_BACKUP_PATH',
    }))
  })

  it('returns a masked backup diff without raw secrets', async () => {
    const backup = Buffer.from('password=old-secret\nmode=prod\n', 'utf-8')
    const current = Buffer.from('password=new-secret\nmode=debug\n', 'utf-8')
    const sftp = {
      download: vi.fn()
        .mockResolvedValueOnce(backup)
        .mockResolvedValueOnce(current),
    }
    const logRepo = {
      logAdminEvent: vi.fn().mockResolvedValue(undefined),
    }
    const controller = new SftpController(sftp as never, logRepo as never)
    const req = makeRequest({
      query: {
        path: '/etc/app.conf',
        backupPath: '/etc/.nodeaccess-backups/app.conf.2026-07-19T10-00-00-000Z.user-20.backup.bak',
        sessionId: 92,
      },
    })
    const reply = makeReply()

    await controller.backupDiff(req as never, reply as never)

    expect(sftp.download).toHaveBeenNthCalledWith(1, 10, 20, 1, 'user', '/etc/.nodeaccess-backups/app.conf.2026-07-19T10-00-00-000Z.user-20.backup.bak')
    expect(sftp.download).toHaveBeenNthCalledWith(2, 10, 20, 1, 'user', '/etc/app.conf')
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      path: '/etc/app.conf',
      backupPath: '/etc/.nodeaccess-backups/app.conf.2026-07-19T10-00-00-000Z.user-20.backup.bak',
      beforeSize: backup.length,
      afterSize: current.length,
      changedLines: 2,
      addedLines: 2,
      removedLines: 2,
      truncated: false,
      skippedReason: null,
    }))

    const response = reply.send.mock.calls[0][0]
    expect(response.diffMasked).toContain('password=[MASKED]')
    expect(JSON.stringify(response)).not.toContain('old-secret')
    expect(JSON.stringify(response)).not.toContain('new-secret')

    const details = JSON.parse(logRepo.logAdminEvent.mock.calls[0][0].details)
    expect(details).toMatchObject({
      provider: 'sftp',
      action: 'viewBackupDiff',
      hostId: 10,
      path: '/etc/app.conf',
      backupPath: '/etc/.nodeaccess-backups/app.conf.2026-07-19T10-00-00-000Z.user-20.backup.bak',
      success: true,
      sessionId: 92,
      beforeSize: backup.length,
      afterSize: current.length,
      changedLines: 2,
    })
    expect(JSON.stringify(details)).not.toContain('old-secret')
    expect(JSON.stringify(details)).not.toContain('new-secret')
  })

  it('blocks writeFile before rename when strict metadata preservation fails', async () => {
    const sftp = {
      readFile: vi.fn()
        .mockResolvedValueOnce({
          content: 'mode=old\n',
          size: 9,
          truncated: false,
          modifiedAt: '2026-07-19T10:00:00.000Z',
          hash: 'old-hash',
          mode: 0o640,
          owner: 1000,
          group: 1001,
          accessedAt: '2026-07-19T09:00:00.000Z',
          accessedAtEpoch: 1784448000,
          modifiedAtEpoch: 1784455200,
        })
        .mockResolvedValueOnce({
          content: 'mode=new\n',
          size: Buffer.byteLength('mode=new\n', 'utf-8'),
          truncated: false,
          modifiedAt: '2026-07-19T10:01:00.000Z',
          hash: '2211f34275d400ced73eb57f59a7818778aaa600dd6a29e87ec11fe873828616',
          mode: 0o600,
          owner: 1000,
          group: 1001,
          accessedAt: '2026-07-19T09:01:00.000Z',
          accessedAtEpoch: 1784448060,
          modifiedAtEpoch: 1784455260,
        }),
      mkdir: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn().mockResolvedValue(undefined),
      applyFileMetadata: vi.fn().mockResolvedValue({
        mode: false,
        ownership: true,
        timestamps: true,
        skipped: [],
        errors: ['chmod: permission denied'],
      }),
      rename: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    }
    const logRepo = {
      logAdminEvent: vi.fn().mockResolvedValue(undefined),
    }
    const settingsRepo = {
      findSftpPolicySettings: vi.fn().mockResolvedValue({
        blockOnModePreservationFailure: true,
        blockOnOwnershipPreservationFailure: false,
        blockOnTimestampPreservationFailure: false,
        diffMaxBytes: 1_048_576,
        diffMaxLines: 400,
      }),
    }
    const controller = new SftpController(sftp as never, logRepo as never, settingsRepo as never)
    const req = makeRequest({
      body: {
        path: '/etc/app.conf',
        content: 'mode=new\n',
        expectedHash: 'old-hash',
        expectedModifiedAt: '2026-07-19T10:00:00.000Z',
        expectedSize: 9,
      },
    })
    const reply = makeReply()

    await controller.writeFile(req as never, reply as never)

    expect(sftp.rename).not.toHaveBeenCalled()
    expect(sftp.delete).toHaveBeenCalledWith(
      10,
      20,
      1,
      'user',
      expect.stringMatching(/^\/etc\/\.app\.conf\.nodeaccess-.+\.user-20\.tmp$/),
    )
    expect(reply.status).toHaveBeenCalledWith(422)
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      code: 'SFTP_METADATA_PRESERVATION_FAILED',
    }))
  })

  it('uses tenant SFTP policy limits when rendering backup diff', async () => {
    const backup = Buffer.from('a=1\nb=2\n', 'utf-8')
    const current = Buffer.from('a=3\nb=4\n', 'utf-8')
    const sftp = {
      download: vi.fn()
        .mockResolvedValueOnce(backup)
        .mockResolvedValueOnce(current),
    }
    const logRepo = {
      logAdminEvent: vi.fn().mockResolvedValue(undefined),
    }
    const settingsRepo = {
      findSftpPolicySettings: vi.fn().mockResolvedValue({
        blockOnModePreservationFailure: false,
        blockOnOwnershipPreservationFailure: false,
        blockOnTimestampPreservationFailure: false,
        diffMaxBytes: 1_048_576,
        diffMaxLines: 3,
      }),
    }
    const controller = new SftpController(sftp as never, logRepo as never, settingsRepo as never)
    const req = makeRequest({
      query: {
        path: '/etc/app.conf',
        backupPath: '/etc/.nodeaccess-backups/app.conf.2026-07-19T10-00-00-000Z.user-20.backup.bak',
      },
    })
    const reply = makeReply()

    await controller.backupDiff(req as never, reply as never)

    expect(settingsRepo.findSftpPolicySettings).toHaveBeenCalledWith(1)
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      changedLines: 2,
      truncated: true,
      skippedReason: 'diff-line-limit',
    }))
  })

  it('rejects backupDiff when backup is outside the NodeAccess backup directory', async () => {
    const sftp = {
      download: vi.fn(),
    }
    const logRepo = {
      logAdminEvent: vi.fn().mockResolvedValue(undefined),
    }
    const controller = new SftpController(sftp as never, logRepo as never)
    const req = makeRequest({
      query: {
        path: '/etc/app.conf',
        backupPath: '/tmp/app.conf.bak',
      },
    })
    const reply = makeReply()

    await controller.backupDiff(req as never, reply as never)

    expect(sftp.download).not.toHaveBeenCalled()
    expect(reply.status).toHaveBeenCalledWith(400)
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      code: 'SFTP_INVALID_BACKUP_PATH',
    }))
  })
})
