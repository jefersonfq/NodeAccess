import type { FastifyReply, FastifyRequest } from 'fastify'
import type { GuacamoleImportCommitRequest, GuacamoleImportPreviewRequest } from '@nodeaccess/shared'
import type { HostImportService } from './host-import.service.js'

export class HostImportController {
  constructor(private readonly service: HostImportService) {}

  async preview(request: FastifyRequest<{ Body: GuacamoleImportPreviewRequest }>, reply: FastifyReply) {
    return reply.send(await this.service.preview(
      request.body,
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
      request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    ))
  }

  async commit(request: FastifyRequest<{ Body: GuacamoleImportCommitRequest }>, reply: FastifyReply) {
    return reply.send(await this.service.commit(
      request.body.previewId,
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
      request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    ))
  }
}
