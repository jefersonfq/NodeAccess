import { basename, posix as posixPath } from 'node:path'
import { createHash } from 'node:crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { SftpMetadataPreservationResult, SftpService } from './sftp.service.js'
import type { LogRepository } from '../logs/log.repository.js'
import { DEFAULT_SFTP_POLICY_SETTINGS, type SettingsRepository, type SftpPolicySettings } from '../settings/settings.repository.js'
import type { JwtPayload } from '../../shared/guards.js'
import { AppError } from '../../shared/errors.js'

interface HostParams {
  hostId: string
}

interface PathQuery {
  path: string
  sessionId?: number | string | null
}

interface BackupQuery extends PathQuery {
  backupPath: string
}

interface RenameQuery {
  oldPath: string
  newPath: string
  sessionId?: number | string | null
}

interface WriteFileBody {
  path: string
  content: string
  sessionId?: number | string | null
  expectedHash?: string | null
  expectedModifiedAt?: string | null
  expectedSize?: number | null
}

interface RestoreBackupBody {
  path: string
  backupPath: string
  sessionId?: number | string | null
}

export class SftpController {
  constructor(
    private readonly sftp: SftpService,
    private readonly logRepo?: LogRepository,
    private readonly settingsRepo?: SettingsRepository,
  ) {}

  async ping(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const user   = req.jwtUser as JwtPayload
      const hostId = Number((req.params as HostParams).hostId)
      const result = await this.sftp.ping(hostId, Number(user.sub), user.tenantId, user.role)
      await reply.send(result)
    } catch (err) {
      await this.auditFailedOperation(req, 'download', {
        path: (req.query as Partial<PathQuery> | undefined)?.path ?? '',
        errorMessage: this.errorMessage(err),
      })
      this.handleError(err, reply)
    }
  }

  async list(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const user   = req.jwtUser as JwtPayload
      const hostId = Number((req.params as HostParams).hostId)
      const path   = (req.query as PathQuery).path ?? '/'

      const result = await this.sftp.list(hostId, Number(user.sub), user.tenantId, user.role, path)
      await reply.send(result)
    } catch (err) {
      this.handleError(err, reply)
    }
  }

  async download(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const user   = req.jwtUser as JwtPayload
      const hostId = Number((req.params as HostParams).hostId)
      const path   = (req.query as PathQuery).path

      const buffer = await this.sftp.download(hostId, Number(user.sub), user.tenantId, user.role, path)
      await this.auditOperation(user, hostId, 'download', {
        path,
        size: buffer.length,
        success: true,
        sessionId: this.sessionIdFromRequest(req),
      })

      await reply
        .header('Content-Disposition', `attachment; filename="${basename(path)}"`)
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Length', buffer.length)
        .send(buffer)
    } catch (err) {
      await this.auditFailedOperation(req, 'download', {
        path: (req.query as Partial<PathQuery> | undefined)?.path ?? '',
        errorMessage: this.errorMessage(err),
      })
      this.handleError(err, reply)
    }
  }

  async downloadBackup(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const user       = req.jwtUser as JwtPayload
      const hostId     = Number((req.params as HostParams).hostId)
      const { path, backupPath } = req.query as BackupQuery
      this.assertBackupPathAllowed(path, backupPath)

      const buffer = await this.sftp.download(hostId, Number(user.sub), user.tenantId, user.role, backupPath)
      await this.auditOperation(user, hostId, 'downloadBackup', {
        path,
        backupPath,
        size: buffer.length,
        success: true,
        sessionId: this.sessionIdFromRequest(req),
      })

      await reply
        .header('Content-Disposition', `attachment; filename="${basename(backupPath)}"`)
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Length', buffer.length)
        .send(buffer)
    } catch (err) {
      const backupPath = (req.query as { backupPath?: string } | undefined)?.backupPath
      await this.auditFailedOperation(req, 'downloadBackup', {
        path: (req.query as Partial<PathQuery> | undefined)?.path ?? '',
        ...(backupPath !== undefined ? { backupPath } : {}),
        errorMessage: this.errorMessage(err),
      })
      this.handleError(err, reply)
    }
  }

  async backupDiff(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const user       = req.jwtUser as JwtPayload
      const hostId     = Number((req.params as HostParams).hostId)
      const { path, backupPath } = req.query as BackupQuery
      this.assertBackupPathAllowed(path, backupPath)

      const [backup, current] = await Promise.all([
        this.sftp.download(hostId, Number(user.sub), user.tenantId, user.role, backupPath),
        this.sftp.download(hostId, Number(user.sub), user.tenantId, user.role, path),
      ])
      const sftpPolicy = await this.sftpPolicy(user.tenantId)
      const diff = this.fullMaskedDiff(backup, current, sftpPolicy)

      await this.auditOperation(user, hostId, 'viewBackupDiff', {
        path,
        backupPath,
        success: true,
        sessionId: this.sessionIdFromRequest(req),
        beforeSize: backup.length,
        afterSize: current.length,
        changedLines: diff.changedLines,
        addedLines: diff.addedLines,
        removedLines: diff.removedLines,
        diffSkippedReason: diff.skippedReason ?? undefined,
      })

      await reply.send({
        path,
        backupPath,
        beforeSize: backup.length,
        afterSize: current.length,
        beforeHash: this.hashBuffer(backup),
        afterHash: this.hashBuffer(current),
        changedLines: diff.changedLines,
        addedLines: diff.addedLines,
        removedLines: diff.removedLines,
        truncated: diff.truncated,
        skippedReason: diff.skippedReason,
        diffMasked: diff.diffMasked,
      })
    } catch (err) {
      const backupPath = (req.query as { backupPath?: string } | undefined)?.backupPath
      await this.auditFailedOperation(req, 'viewBackupDiff', {
        path: (req.query as Partial<PathQuery> | undefined)?.path ?? '',
        ...(backupPath !== undefined ? { backupPath } : {}),
        errorMessage: this.errorMessage(err),
      })
      this.handleError(err, reply)
    }
  }


  async upload(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const user   = req.jwtUser as JwtPayload
      const hostId = Number((req.params as HostParams).hostId)
      const path   = (req.query as PathQuery).path

      // Read multipart file
      const file   = await (req as any).file() as { filename?: string; toBuffer(): Promise<Buffer> } | undefined
      if (!file) {
        await reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'Nenhum arquivo enviado' })
        return
      }

      const data = await file.toBuffer()
      await this.sftp.upload(hostId, Number(user.sub), user.tenantId, user.role, path, data)
      await this.auditOperation(user, hostId, 'upload', {
        path,
        size: data.length,
        success: true,
        sessionId: this.sessionIdFromRequest(req),
        uploadFileName: file.filename,
      })
      await reply.status(204).send()
    } catch (err) {
      await this.auditFailedOperation(req, 'upload', {
        path: (req.query as Partial<PathQuery> | undefined)?.path ?? '',
        errorMessage: this.errorMessage(err),
      })
      this.handleError(err, reply)
    }
  }

  async mkdir(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const user   = req.jwtUser as JwtPayload
      const hostId = Number((req.params as HostParams).hostId)
      const path   = ((req.body as PathQuery | undefined)?.path) ?? (req.query as PathQuery).path

      await this.sftp.mkdir(hostId, Number(user.sub), user.tenantId, user.role, path)
      await this.auditOperation(user, hostId, 'mkdir', {
        path,
        success: true,
        sessionId: this.sessionIdFromRequest(req),
      })
      await reply.status(204).send()
    } catch (err) {
      await this.auditFailedOperation(req, 'mkdir', {
        path: ((req.body as Partial<PathQuery> | undefined)?.path) ?? (req.query as Partial<PathQuery> | undefined)?.path ?? '',
        errorMessage: this.errorMessage(err),
      })
      this.handleError(err, reply)
    }
  }

  async rename(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const user    = req.jwtUser as JwtPayload
      const hostId  = Number((req.params as HostParams).hostId)
      const body    = req.body as RenameQuery
      const oldPath = body.oldPath
      const newPath = body.newPath

      await this.sftp.rename(hostId, Number(user.sub), user.tenantId, user.role, oldPath, newPath)
      await this.auditOperation(user, hostId, 'rename', {
        path: oldPath,
        newPath,
        success: true,
        sessionId: this.sessionIdFromRequest(req),
      })
      await reply.status(204).send()
    } catch (err) {
      const body = req.body as Partial<RenameQuery> | undefined
      const details: { path: string; newPath?: string; errorMessage: string } = {
        path: body?.oldPath ?? '',
        errorMessage: this.errorMessage(err),
      }
      if (body?.newPath !== undefined) details.newPath = body.newPath
      await this.auditFailedOperation(req, 'rename', details)
      this.handleError(err, reply)
    }
  }

  async delete(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const user   = req.jwtUser as JwtPayload
      const hostId = Number((req.params as HostParams).hostId)
      const path   = (req.query as PathQuery).path

      await this.sftp.delete(hostId, Number(user.sub), user.tenantId, user.role, path)
      await this.auditOperation(user, hostId, 'delete', {
        path,
        success: true,
        sessionId: this.sessionIdFromRequest(req),
      })
      await reply.status(204).send()
    } catch (err) {
      await this.auditFailedOperation(req, 'delete', {
        path: (req.query as Partial<PathQuery> | undefined)?.path ?? '',
        errorMessage: this.errorMessage(err),
      })
      this.handleError(err, reply)
    }
  }

  async createFile(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const user   = req.jwtUser as JwtPayload
      const hostId = Number((req.params as HostParams).hostId)
      const path   = ((req.body as PathQuery | undefined)?.path) ?? (req.query as PathQuery).path

      await this.sftp.createFile(hostId, Number(user.sub), user.tenantId, user.role, path)
      await this.auditOperation(user, hostId, 'createFile', {
        path,
        success: true,
        sessionId: this.sessionIdFromRequest(req),
      })
      await reply.status(204).send()
    } catch (err) {
      await this.auditFailedOperation(req, 'createFile', {
        path: ((req.body as Partial<PathQuery> | undefined)?.path) ?? (req.query as Partial<PathQuery> | undefined)?.path ?? '',
        errorMessage: this.errorMessage(err),
      })
      this.handleError(err, reply)
    }
  }

  async readFile(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const user   = req.jwtUser as JwtPayload
      const hostId = Number((req.params as HostParams).hostId)
      const path   = (req.query as PathQuery).path
      const result = await this.sftp.readFile(hostId, Number(user.sub), user.tenantId, user.role, path)
      await this.auditOperation(user, hostId, 'readFile', {
        path,
        size: result.size,
        success: true,
        sessionId: this.sessionIdFromRequest(req),
      })
      await reply.send(result)
    } catch (err) {
      await this.auditFailedOperation(req, 'readFile', {
        path: (req.query as Partial<PathQuery> | undefined)?.path ?? '',
        errorMessage: this.errorMessage(err),
      })
      this.handleError(err, reply)
    }
  }

  async writeFile(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const user    = req.jwtUser as JwtPayload
      const hostId  = Number((req.params as HostParams).hostId)
      const { path, content, expectedHash, expectedModifiedAt, expectedSize } = req.body as WriteFileBody
      const userId = Number(user.sub)
      const before = await this.sftp.readFile(hostId, userId, user.tenantId, user.role, path)
      this.assertExpectedFileVersion(before, { expectedHash, expectedModifiedAt, expectedSize })

      if (before.truncated) {
        throw new AppError('Arquivo grande demais para salvamento seguro pelo editor web. Baixe e edite fora do NodeAccess ou reduza o arquivo.', 422, 'SFTP_FILE_TOO_LARGE')
      }

      const backupPath = this.buildBackupPath(path, userId)
      await this.ensureBackupDirectory(hostId, userId, user.tenantId, user.role, backupPath)
      await this.sftp.upload(hostId, userId, user.tenantId, user.role, backupPath, Buffer.from(before.content, 'utf-8'))

      const data = Buffer.from(content, 'utf-8')
      const tempPath = this.buildTempPath(path, userId)
      await this.sftp.upload(hostId, userId, user.tenantId, user.role, tempPath, data)
      const tempRead = await this.sftp.readFile(hostId, userId, user.tenantId, user.role, tempPath)
      const afterHash = this.hashContent(content)
      if (tempRead.truncated || tempRead.hash !== afterHash || tempRead.size !== data.length) {
        await this.deleteTempFileBestEffort(hostId, userId, user.tenantId, user.role, tempPath)
        throw new AppError('Falha ao validar o arquivo temporário antes da troca. O arquivo original não foi sobrescrito.', 422, 'SFTP_TEMP_VALIDATION_FAILED')
      }
      const metadataPreservation = await this.sftp.applyFileMetadata(hostId, userId, user.tenantId, user.role, tempPath, {
        mode: before.mode,
        owner: before.owner,
        group: before.group,
        accessedAtEpoch: before.accessedAtEpoch,
        modifiedAtEpoch: before.modifiedAtEpoch,
      }).catch((err: unknown) => ({
        mode:       false,
        ownership:  false,
        timestamps: false,
        skipped:    [],
        errors:     [`metadata: ${this.errorMessage(err)}`],
      }))
      const sftpPolicy = await this.sftpPolicy(user.tenantId)
      await this.assertMetadataPreservationPolicy(hostId, userId, user.tenantId, user.role, tempPath, metadataPreservation, sftpPolicy)
      const replaceStrategy = await this.replaceTempFile(hostId, userId, user.tenantId, user.role, tempPath, path, 'writeFile')
      await this.auditOperation(user, hostId, 'writeFile', {
        path,
        size: data.length,
        success: true,
        sessionId: this.sessionIdFromRequest(req),
        backupPath,
        beforeHash: before.hash ?? undefined,
        tempPath,
        afterHash,
        beforeSize: before.size,
        afterSize: data.length,
        preservedMode: metadataPreservation.mode,
        preservedOwnership: metadataPreservation.ownership,
        preservedTimestamps: metadataPreservation.timestamps,
        metadataPreservationSkipped: metadataPreservation.skipped,
        metadataPreservationErrors: metadataPreservation.errors,
        replaceStrategy,
        ...this.diffSummary(before.content, content),
      })
      await reply.status(204).send()
    } catch (err) {
      await this.auditFailedOperation(req, 'writeFile', {
        path: (req.body as { path?: string } | undefined)?.path ?? '',
        errorMessage: this.errorMessage(err),
      })
      this.handleError(err, reply)
    }
  }

  async restoreBackup(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const user   = req.jwtUser as JwtPayload
      const hostId = Number((req.params as HostParams).hostId)
      const userId = Number(user.sub)
      const { path, backupPath } = req.body as RestoreBackupBody
      this.assertBackupPathAllowed(path, backupPath)

      const current = await this.sftp.download(hostId, userId, user.tenantId, user.role, path)
      const preRestoreBackupPath = this.buildBackupPath(path, userId, 'pre-restore')
      await this.ensureBackupDirectory(hostId, userId, user.tenantId, user.role, preRestoreBackupPath)
      await this.sftp.upload(hostId, userId, user.tenantId, user.role, preRestoreBackupPath, current)

      const backup = await this.sftp.download(hostId, userId, user.tenantId, user.role, backupPath)
      const tempPath = this.buildTempPath(path, userId)
      await this.sftp.upload(hostId, userId, user.tenantId, user.role, tempPath, backup)
      const temp = await this.sftp.download(hostId, userId, user.tenantId, user.role, tempPath)
      const restoredHash = this.hashBuffer(backup)
      if (temp.length !== backup.length || this.hashBuffer(temp) !== restoredHash) {
        await this.deleteTempFileBestEffort(hostId, userId, user.tenantId, user.role, tempPath)
        throw new AppError('Falha ao validar o arquivo temporário da restauração. O arquivo original não foi sobrescrito.', 422, 'SFTP_RESTORE_TEMP_VALIDATION_FAILED')
      }

      const replaceStrategy = await this.replaceTempFile(hostId, userId, user.tenantId, user.role, tempPath, path, 'restoreBackup')

      await this.auditOperation(user, hostId, 'restoreBackup', {
        path,
        success: true,
        sessionId: this.sessionIdFromRequest(req),
        backupPath,
        tempPath,
        preRestoreBackupPath,
        beforeSize: current.length,
        afterSize: backup.length,
        afterHash: restoredHash,
        replaceStrategy,
      })
      await reply.status(204).send()
    } catch (err) {
      const backupPath = (req.body as { backupPath?: string } | undefined)?.backupPath
      await this.auditFailedOperation(req, 'restoreBackup', {
        path: (req.body as { path?: string } | undefined)?.path ?? '',
        ...(backupPath !== undefined ? { backupPath } : {}),
        errorMessage: this.errorMessage(err),
      })
      this.handleError(err, reply)
    }
  }

  // ── Error handling ─────────────────────────────────────────────────────────

  private handleError(err: unknown, reply: FastifyReply): void {
    if (err instanceof AppError) {
      reply.status(err.statusCode).send({ code: err.code, message: err.message })
      return
    }

    const sftpError = this.sftpErrorResponse(err)
    if (sftpError) {
      reply.status(sftpError.statusCode).send({ code: sftpError.code, message: sftpError.message })
      return
    }

    reply.status(500).send({ code: 'INTERNAL_ERROR', message: this.errorMessage(err) })
  }

  private errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : 'Erro interno'
  }

  private sftpErrorResponse(err: unknown): { statusCode: number; code: string; message: string } | null {
    const rawCode = typeof err === 'object' && err !== null && 'code' in err
      ? (err as { code?: unknown }).code
      : undefined
    const numericCode = typeof rawCode === 'number'
      ? rawCode
      : typeof rawCode === 'string' && rawCode.trim() !== ''
        ? Number(rawCode)
        : NaN
    const message = this.errorMessage(err)
    const normalizedMessage = message.toLowerCase()

    if (numericCode === 3 || /permission denied|access denied|eacces|eperm/.test(normalizedMessage)) {
      return {
        statusCode: 403,
        code:       'SFTP_PERMISSION_DENIED',
        message:    'Permissão negada pelo servidor SFTP para este caminho. Verifique usuário SSH, dono do arquivo e permissões de escrita/leitura.',
      }
    }

    if (numericCode === 2 || /no such file|not found|enoent/.test(normalizedMessage)) {
      return {
        statusCode: 404,
        code:       'SFTP_NOT_FOUND',
        message:    'Arquivo ou diretório não encontrado no servidor SFTP.',
      }
    }

    if (numericCode === 4 && /not empty|directory.*not empty|failure.*rmdir/.test(normalizedMessage)) {
      return {
        statusCode: 409,
        code:       'SFTP_DIRECTORY_NOT_EMPTY',
        message:    'A pasta não está vazia. Remova os arquivos internos ou use uma ação de exclusão recursiva quando disponível.',
      }
    }

    if (/failure.*quota|quota exceeded|disk quota/.test(normalizedMessage)) {
      return {
        statusCode: 507,
        code:       'SFTP_QUOTA_EXCEEDED',
        message:    'O servidor SFTP recusou a operação por limite de quota ou espaço disponível.',
      }
    }

    if (/no space left|enospc|disk full/.test(normalizedMessage)) {
      return {
        statusCode: 507,
        code:       'SFTP_NO_SPACE_LEFT',
        message:    'O servidor SFTP está sem espaço disponível para concluir a operação.',
      }
    }

    if (/connection.*(lost|closed|reset)|econnreset|timed out|timeout/.test(normalizedMessage)) {
      return {
        statusCode: 503,
        code:       'SFTP_CONNECTION_LOST',
        message:    'A conexão SFTP foi interrompida durante a operação. Tente novamente após validar a conectividade com o host.',
      }
    }

    return null
  }

  private assertExpectedFileVersion(
    actual: { hash: string | null; modifiedAt: string | null; size: number },
    expected: {
      expectedHash?: string | null | undefined
      expectedModifiedAt?: string | null | undefined
      expectedSize?: number | null | undefined
    },
  ): void {
    if (expected.expectedHash && actual.hash && expected.expectedHash !== actual.hash) {
      throw new AppError('O arquivo foi alterado no servidor desde que foi aberto. Recarregue o arquivo antes de salvar.', 409, 'SFTP_CONFLICT')
    }
    if (expected.expectedModifiedAt && actual.modifiedAt && expected.expectedModifiedAt !== actual.modifiedAt) {
      throw new AppError('O arquivo foi alterado no servidor desde que foi aberto. Recarregue o arquivo antes de salvar.', 409, 'SFTP_CONFLICT')
    }
    if (typeof expected.expectedSize === 'number' && actual.size !== expected.expectedSize) {
      throw new AppError('O arquivo foi alterado no servidor desde que foi aberto. Recarregue o arquivo antes de salvar.', 409, 'SFTP_CONFLICT')
    }
  }

  private async ensureBackupDirectory(
    hostId: number,
    userId: number,
    tenantId: number,
    role: string,
    backupPath: string,
  ): Promise<void> {
    const backupDir = posixPath.dirname(backupPath)
    try {
      await this.sftp.mkdir(hostId, userId, tenantId, role, backupDir)
    } catch (err) {
    if (!/exists|failure/i.test(this.errorMessage(err))) throw err
    }
  }

  private async replaceTempFile(
    hostId: number,
    userId: number,
    tenantId: number,
    role: string,
    tempPath: string,
    path: string,
    action: 'writeFile' | 'restoreBackup',
  ): Promise<'atomic-rename' | 'unlink-rename'> {
    try {
      await this.sftp.rename(hostId, userId, tenantId, role, tempPath, path)
      return 'atomic-rename'
    } catch (err) {
      if (!this.isGenericRenameFailure(err)) {
        await this.deleteTempFileBestEffort(hostId, userId, tenantId, role, tempPath)
        throw new AppError(this.renameFailureMessage(action, err), 409, this.renameFailureCode(action))
      }

      try {
        await this.sftp.replaceExistingFile(hostId, userId, tenantId, role, tempPath, path)
        return 'unlink-rename'
      } catch (fallbackErr) {
        await this.deleteTempFileBestEffort(hostId, userId, tenantId, role, tempPath)
        throw new AppError(
          `${this.renameFailureMessage(action, err)}. Também falhou a substituição compatível com servidores que não sobrescrevem no rename: ${this.errorMessage(fallbackErr)}`,
          409,
          this.renameFailureCode(action),
        )
      }
    }
  }

  private isGenericRenameFailure(err: unknown): boolean {
    const rawCode = typeof err === 'object' && err !== null && 'code' in err
      ? (err as { code?: unknown }).code
      : undefined
    const numericCode = typeof rawCode === 'number'
      ? rawCode
      : typeof rawCode === 'string' && rawCode.trim() !== ''
        ? Number(rawCode)
        : NaN
    const message = this.errorMessage(err).toLowerCase()
    if (/permission denied|access denied|eacces|eperm/.test(message)) return false
    return numericCode === 4 || /^failure$/.test(message) || /failure/i.test(message)
  }

  private renameFailureCode(action: 'writeFile' | 'restoreBackup'): string {
    return action === 'restoreBackup' ? 'SFTP_RESTORE_RENAME_FAILED' : 'SFTP_ATOMIC_RENAME_FAILED'
  }

  private renameFailureMessage(action: 'writeFile' | 'restoreBackup', err: unknown): string {
    return action === 'restoreBackup'
      ? `Falha ao restaurar backup no caminho final: ${this.errorMessage(err)}`
      : `Falha ao trocar arquivo temporário pelo arquivo final: ${this.errorMessage(err)}`
  }

  private buildBackupPath(path: string, userId: number, reason = 'backup'): string {
    const dir = posixPath.dirname(path)
    const file = posixPath.basename(path)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    return posixPath.join(dir, '.nodeaccess-backups', `${file}.${stamp}.user-${userId}.${reason}.bak`)
  }

  private buildTempPath(path: string, userId: number): string {
    const dir = posixPath.dirname(path)
    const file = posixPath.basename(path)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    return posixPath.join(dir, `.${file}.nodeaccess-${stamp}.user-${userId}.tmp`)
  }

  private async deleteTempFileBestEffort(
    hostId: number,
    userId: number,
    tenantId: number,
    role: string,
    tempPath: string,
  ): Promise<void> {
    await this.sftp.delete(hostId, userId, tenantId, role, tempPath).catch(() => { /* best-effort cleanup */ })
  }

  private hashContent(content: string): string {
    return createHash('sha256').update(Buffer.from(content, 'utf-8')).digest('hex')
  }

  private hashBuffer(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex')
  }

  private assertBackupPathAllowed(path: string, backupPath: string): void {
    const normalizedPath = posixPath.normalize(path)
    const normalizedBackupPath = posixPath.normalize(backupPath)
    const expectedBackupDir = `${posixPath.dirname(normalizedPath).replace(/\/$/, '')}/.nodeaccess-backups/`
    if (!normalizedBackupPath.startsWith(expectedBackupDir)) {
      throw new AppError('Backup inválido para este caminho. Só é possível restaurar arquivos em .nodeaccess-backups do mesmo diretório.', 400, 'SFTP_INVALID_BACKUP_PATH')
    }
    if (!normalizedBackupPath.endsWith('.bak')) {
      throw new AppError('Backup inválido para restauração.', 400, 'SFTP_INVALID_BACKUP_PATH')
    }
  }

  private diffSummary(before: string, after: string): {
    changedLines: number
    addedLines: number
    removedLines: number
    diffPreviewMasked: string
  } {
    const beforeLines = before.split(/\r?\n/)
    const afterLines = after.split(/\r?\n/)
    const max = Math.max(beforeLines.length, afterLines.length)
    let changedLines = 0
    let addedLines = 0
    let removedLines = 0
    const preview: string[] = []

    for (let i = 0; i < max; i++) {
      const oldLine = beforeLines[i]
      const newLine = afterLines[i]
      if (oldLine === newLine) continue
      changedLines++
      if (oldLine === undefined) addedLines++
      else if (newLine === undefined) removedLines++
      else { addedLines++; removedLines++ }
      if (preview.length < 20) {
        if (oldLine !== undefined) preview.push(`-${this.maskSensitiveLine(oldLine)}`)
        if (newLine !== undefined) preview.push(`+${this.maskSensitiveLine(newLine)}`)
      }
    }

    return {
      changedLines,
      addedLines,
      removedLines,
      diffPreviewMasked: preview.join('\n'),
    }
  }

  private fullMaskedDiff(before: Buffer, after: Buffer, policy: SftpPolicySettings): {
    changedLines: number
    addedLines: number
    removedLines: number
    diffMasked: string
    truncated: boolean
    skippedReason: string | null
  } {
    if (before.length > policy.diffMaxBytes || after.length > policy.diffMaxBytes) {
      return { changedLines: 0, addedLines: 0, removedLines: 0, diffMasked: '', truncated: true, skippedReason: 'file-too-large' }
    }
    if (before.includes(0) || after.includes(0)) {
      return { changedLines: 0, addedLines: 0, removedLines: 0, diffMasked: '', truncated: true, skippedReason: 'binary-file' }
    }

    const beforeLines = before.toString('utf-8').split(/\r?\n/)
    const afterLines = after.toString('utf-8').split(/\r?\n/)
    const max = Math.max(beforeLines.length, afterLines.length)
    let changedLines = 0
    let addedLines = 0
    let removedLines = 0
    let truncated = false
    const diff: string[] = []

    for (let i = 0; i < max; i++) {
      const oldLine = beforeLines[i]
      const newLine = afterLines[i]
      if (oldLine === newLine) continue
      changedLines++
      if (oldLine === undefined) addedLines++
      else if (newLine === undefined) removedLines++
      else { addedLines++; removedLines++ }

      if (diff.length >= policy.diffMaxLines) {
        truncated = true
        continue
      }
      diff.push(`@@ line ${i + 1} @@`)
      if (oldLine !== undefined && diff.length < policy.diffMaxLines) diff.push(`-${this.maskSensitiveLine(oldLine)}`)
      if (newLine !== undefined && diff.length < policy.diffMaxLines) diff.push(`+${this.maskSensitiveLine(newLine)}`)
    }

    return {
      changedLines,
      addedLines,
      removedLines,
      diffMasked: diff.join('\n'),
      truncated,
      skippedReason: truncated ? 'diff-line-limit' : null,
    }
  }

  private async sftpPolicy(tenantId: number): Promise<SftpPolicySettings> {
    if (!this.settingsRepo) return DEFAULT_SFTP_POLICY_SETTINGS
    return this.settingsRepo.findSftpPolicySettings(tenantId).catch(() => DEFAULT_SFTP_POLICY_SETTINGS)
  }

  private async assertMetadataPreservationPolicy(
    hostId: number,
    userId: number,
    tenantId: number,
    role: string,
    tempPath: string,
    metadataPreservation: SftpMetadataPreservationResult,
    policy: SftpPolicySettings,
  ): Promise<void> {
    const failures: string[] = []
    if (policy.blockOnModePreservationFailure && !metadataPreservation.mode) failures.push('permissões')
    if (policy.blockOnOwnershipPreservationFailure && !metadataPreservation.ownership) failures.push('proprietário/grupo')
    if (policy.blockOnTimestampPreservationFailure && !metadataPreservation.timestamps) failures.push('timestamps')
    if (failures.length === 0) return

    await this.deleteTempFileBestEffort(hostId, userId, tenantId, role, tempPath)
    throw new AppError(
      `Falha ao preservar ${failures.join(', ')} no arquivo temporário. O arquivo original não foi sobrescrito.`,
      422,
      'SFTP_METADATA_PRESERVATION_FAILED',
    )
  }

  private maskSensitiveLine(line: string): string {
    return line
      .replace(/((?:password|passwd|pwd|secret|token|api[_-]?key|private[_-]?key)\s*[:=]\s*)([^\s]+)/ig, '$1[MASKED]')
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, '$1[MASKED]')
  }

  private sessionIdFromRequest(req: FastifyRequest): number | undefined {
    const bodyValue = (req.body as { sessionId?: unknown } | undefined)?.sessionId
    const queryValue = (req.query as { sessionId?: unknown } | undefined)?.sessionId
    const value = bodyValue ?? queryValue
    if (value === undefined || value === null || value === '') return undefined
    const sessionId = Number(value)
    return Number.isInteger(sessionId) && sessionId > 0 ? sessionId : undefined
  }

  private async auditFailedOperation(
    req: FastifyRequest,
    action: 'download' | 'downloadBackup' | 'viewBackupDiff' | 'upload' | 'delete' | 'rename' | 'mkdir' | 'createFile' | 'readFile' | 'writeFile' | 'restoreBackup',
    details: {
      path: string
      newPath?: string
      backupPath?: string
      errorMessage: string
    },
  ): Promise<void> {
    if (!details.path) return
    const user = req.jwtUser as JwtPayload | undefined
    if (!user) return
    const hostId = Number((req.params as Partial<HostParams> | undefined)?.hostId)
    if (!Number.isFinite(hostId)) return
    await this.auditOperation(user, hostId, action, {
      path: details.path,
      success: false,
      sessionId: this.sessionIdFromRequest(req),
      ...(details.newPath !== undefined ? { newPath: details.newPath } : {}),
      ...(details.backupPath !== undefined ? { backupPath: details.backupPath } : {}),
      errorMessage: details.errorMessage,
    })
  }

  private async auditOperation(
    user: JwtPayload,
    hostId: number,
    action: 'download' | 'downloadBackup' | 'viewBackupDiff' | 'upload' | 'delete' | 'rename' | 'mkdir' | 'createFile' | 'readFile' | 'writeFile' | 'restoreBackup',
    details: {
      path: string
      success: boolean
      sessionId?: number | undefined
      size?: number
      newPath?: string
      errorMessage?: string
      backupPath?: string
      preRestoreBackupPath?: string
      tempPath?: string
      beforeHash?: string | undefined
      afterHash?: string
      beforeSize?: number
      afterSize?: number
      changedLines?: number
      addedLines?: number
      removedLines?: number
      diffPreviewMasked?: string
      diffSkippedReason?: string | undefined
      uploadFileName?: string | undefined
      preservedMode?: boolean
      preservedOwnership?: boolean
      preservedTimestamps?: boolean
      metadataPreservationSkipped?: string[]
      metadataPreservationErrors?: string[]
      replaceStrategy?: 'atomic-rename' | 'unlink-rename'
    },
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      provider: 'sftp',
      action,
      hostId,
      path: details.path,
      success: details.success,
    }
    if (details.size !== undefined) payload.size = details.size
    if (details.sessionId !== undefined) payload.sessionId = details.sessionId
    if (details.newPath !== undefined) payload.newPath = details.newPath
    if (details.errorMessage !== undefined) payload.errorMessage = details.errorMessage
    if (details.backupPath !== undefined) payload.backupPath = details.backupPath
    if (details.preRestoreBackupPath !== undefined) payload.preRestoreBackupPath = details.preRestoreBackupPath
    if (details.tempPath !== undefined) payload.tempPath = details.tempPath
    if (details.beforeHash !== undefined) payload.beforeHash = details.beforeHash
    if (details.afterHash !== undefined) payload.afterHash = details.afterHash
    if (details.beforeSize !== undefined) payload.beforeSize = details.beforeSize
    if (details.afterSize !== undefined) payload.afterSize = details.afterSize
    if (details.changedLines !== undefined) payload.changedLines = details.changedLines
    if (details.addedLines !== undefined) payload.addedLines = details.addedLines
    if (details.removedLines !== undefined) payload.removedLines = details.removedLines
    if (details.diffPreviewMasked !== undefined) payload.diffPreviewMasked = details.diffPreviewMasked
    if (details.diffSkippedReason !== undefined) payload.diffSkippedReason = details.diffSkippedReason
    if (details.uploadFileName !== undefined) payload.uploadFileName = details.uploadFileName
    if (details.preservedMode !== undefined) payload.preservedMode = details.preservedMode
    if (details.preservedOwnership !== undefined) payload.preservedOwnership = details.preservedOwnership
    if (details.preservedTimestamps !== undefined) payload.preservedTimestamps = details.preservedTimestamps
    if (details.metadataPreservationSkipped !== undefined) payload.metadataPreservationSkipped = details.metadataPreservationSkipped
    if (details.metadataPreservationErrors !== undefined) payload.metadataPreservationErrors = details.metadataPreservationErrors
    if (details.replaceStrategy !== undefined) payload.replaceStrategy = details.replaceStrategy

    await this.logRepo?.logAdminEvent({
      adminId: Number(user.sub),
      action: 'SFTP_OPERATION',
      targetType: 'Host',
      targetId: hostId,
      details: JSON.stringify(payload),
    }).catch(() => { /* best-effort audit */ })
  }
}
