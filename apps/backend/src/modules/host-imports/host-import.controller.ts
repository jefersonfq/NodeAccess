import type { FastifyReply, FastifyRequest } from 'fastify'
import type { GuacamoleImportPreviewRequest, HostImportCommitRequest, HostImportPreviewRequest } from '@nodeaccess/shared'
import type { HostImportService } from './host-import.service.js'

export class HostImportController {
  constructor(private readonly service: HostImportService) {}

  async preview(request: FastifyRequest<{ Body: HostImportPreviewRequest }>, reply: FastifyReply): Promise<FastifyReply> {
    return reply.send(await this.service.preview(
      request.body,
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
      request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    ))
  }

  async commit(request: FastifyRequest<{ Body: HostImportCommitRequest }>, reply: FastifyReply): Promise<FastifyReply> {
    return reply.send(await this.service.commit(
      request.body.previewId,
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
      request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    ))
  }

  async history(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    return reply.send(await this.service.history(request.jwtUser!.tenantId))
  }

  async revert(request: FastifyRequest<{ Params: { id: number } }>, reply: FastifyReply): Promise<FastifyReply> {
    return reply.send(await this.service.revert(
      Number(request.params.id),
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
      request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    ))
  }

  async previewGuacamole(request: FastifyRequest<{ Body: GuacamoleImportPreviewRequest }>, reply: FastifyReply): Promise<FastifyReply> {
    return reply.send(await this.service.preview(
      { ...request.body, source: 'guacamole' },
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
      request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    ))
  }
}
