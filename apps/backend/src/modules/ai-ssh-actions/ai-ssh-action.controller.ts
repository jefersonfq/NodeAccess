import type { FastifyReply, FastifyRequest } from 'fastify'
import type { CreateAiSshActionRunDto } from '@nodeaccess/shared'
import type { AiSshActionService } from './ai-ssh-action.service.js'

interface HostParams {
  id: string
}

interface RunParams {
  runId: string
}

interface ApprovalBody {
  approvalReason?: string | null
}

export class AiSshActionController {
  constructor(private readonly service: AiSshActionService) {}

  async createForHost(request: FastifyRequest<{ Params: HostParams; Body: Omit<CreateAiSshActionRunDto, 'hostId'> }>, reply: FastifyReply) {
    const run = await this.service.createRequestedRun({
      tenantId: request.jwtUser!.tenantId,
      userId: Number(request.jwtUser!.sub),
      role: request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
      dto: {
        ...request.body,
        hostId: Number(request.params.id),
      },
    })
    return reply.status(201).send(run)
  }

  async listForHost(request: FastifyRequest<{ Params: HostParams }>, reply: FastifyReply) {
    const runs = await this.service.listForHost({
      hostId: Number(request.params.id),
      tenantId: request.jwtUser!.tenantId,
      userId: Number(request.jwtUser!.sub),
      role: request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    })
    return reply.send(runs)
  }

  async getById(request: FastifyRequest<{ Params: RunParams }>, reply: FastifyReply) {
    const run = await this.service.getById({
      id: Number(request.params.runId),
      tenantId: request.jwtUser!.tenantId,
      userId: Number(request.jwtUser!.sub),
      role: request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    })
    return reply.send(run)
  }

  async approve(request: FastifyRequest<{ Params: RunParams; Body: ApprovalBody }>, reply: FastifyReply) {
    const run = await this.service.approve({
      id: Number(request.params.runId),
      tenantId: request.jwtUser!.tenantId,
      adminId: Number(request.jwtUser!.sub),
      ...(request.body?.approvalReason !== undefined && { approvalReason: request.body.approvalReason }),
    })
    return reply.send(run)
  }

  async reject(request: FastifyRequest<{ Params: RunParams; Body: ApprovalBody }>, reply: FastifyReply) {
    const run = await this.service.reject({
      id: Number(request.params.runId),
      tenantId: request.jwtUser!.tenantId,
      adminId: Number(request.jwtUser!.sub),
      ...(request.body?.approvalReason !== undefined && { approvalReason: request.body.approvalReason }),
    })
    return reply.send(run)
  }

  async cancel(request: FastifyRequest<{ Params: RunParams }>, reply: FastifyReply) {
    const run = await this.service.cancel({
      id: Number(request.params.runId),
      tenantId: request.jwtUser!.tenantId,
      userId: Number(request.jwtUser!.sub),
      role: request.jwtUser!.role === 'admin' ? 'ADMIN' : 'USER',
    })
    return reply.send(run)
  }
}
