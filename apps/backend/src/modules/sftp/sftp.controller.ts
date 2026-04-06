import { basename } from 'node:path'
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { SftpService } from './sftp.service.js'
import type { JwtPayload } from '../../shared/guards.js'
import { ForbiddenError } from '../../shared/errors.js'

interface HostParams {
  hostId: string
}

interface PathQuery {
  path: string
}

interface RenameQuery {
  oldPath: string
  newPath: string
}

export class SftpController {
  constructor(private readonly sftp: SftpService) {}

  async ping(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const user   = req.jwtUser as JwtPayload
      const hostId = Number((req.params as HostParams).hostId)
      const result = await this.sftp.ping(hostId, Number(user.sub), user.tenantId, user.role)
      await reply.send(result)
    } catch (err) {
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

      await reply
        .header('Content-Disposition', `attachment; filename="${basename(path)}"`)
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Length', buffer.length)
        .send(buffer)
    } catch (err) {
      this.handleError(err, reply)
    }
  }

  async upload(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const user   = req.jwtUser as JwtPayload
      const hostId = Number((req.params as HostParams).hostId)
      const path   = (req.query as PathQuery).path

      // Read multipart file
      const file   = await (req as any).file() as { toBuffer(): Promise<Buffer> } | undefined
      if (!file) {
        await reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'Nenhum arquivo enviado' })
        return
      }

      const data = await file.toBuffer()
      await this.sftp.upload(hostId, Number(user.sub), user.tenantId, user.role, path, data)
      await reply.status(204).send()
    } catch (err) {
      this.handleError(err, reply)
    }
  }

  async mkdir(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const user   = req.jwtUser as JwtPayload
      const hostId = Number((req.params as HostParams).hostId)
      const path   = ((req.body as PathQuery | undefined)?.path) ?? (req.query as PathQuery).path

      await this.sftp.mkdir(hostId, Number(user.sub), user.tenantId, user.role, path)
      await reply.status(204).send()
    } catch (err) {
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
      await reply.status(204).send()
    } catch (err) {
      this.handleError(err, reply)
    }
  }

  async delete(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const user   = req.jwtUser as JwtPayload
      const hostId = Number((req.params as HostParams).hostId)
      const path   = (req.query as PathQuery).path

      await this.sftp.delete(hostId, Number(user.sub), user.tenantId, user.role, path)
      await reply.status(204).send()
    } catch (err) {
      this.handleError(err, reply)
    }
  }

  async createFile(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const user   = req.jwtUser as JwtPayload
      const hostId = Number((req.params as HostParams).hostId)
      const path   = ((req.body as PathQuery | undefined)?.path) ?? (req.query as PathQuery).path

      await this.sftp.createFile(hostId, Number(user.sub), user.tenantId, user.role, path)
      await reply.status(204).send()
    } catch (err) {
      this.handleError(err, reply)
    }
  }

  async readFile(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const user   = req.jwtUser as JwtPayload
      const hostId = Number((req.params as HostParams).hostId)
      const path   = (req.query as PathQuery).path
      const result = await this.sftp.readFile(hostId, Number(user.sub), user.tenantId, user.role, path)
      await reply.send(result)
    } catch (err) {
      this.handleError(err, reply)
    }
  }

  async writeFile(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const user    = req.jwtUser as JwtPayload
      const hostId  = Number((req.params as HostParams).hostId)
      const { path, content } = req.body as { path: string; content: string }
      await this.sftp.upload(hostId, Number(user.sub), user.tenantId, user.role, path, Buffer.from(content, 'utf-8'))
      await reply.status(204).send()
    } catch (err) {
      this.handleError(err, reply)
    }
  }

  // ── Error handling ─────────────────────────────────────────────────────────

  private handleError(err: unknown, reply: FastifyReply): void {
    if (err instanceof ForbiddenError) {
      reply.status(403).send({ code: err.code, message: err.message })
      return
    }
    const message = err instanceof Error ? err.message : 'Erro interno'
    reply.status(500).send({ code: 'INTERNAL_ERROR', message })
  }
}
