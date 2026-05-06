import type { FastifyReply, FastifyRequest } from 'fastify'
import type { AiSshActionCommandPolicyService, AiSshActionCommandPolicyDto } from './ai-ssh-action-command-policy.service.js'

type PolicyBody = Partial<AiSshActionCommandPolicyDto>
type EvaluateBody = { command?: string }

export class AiSshActionCommandPolicyController {
  constructor(private readonly service: AiSshActionCommandPolicyService) {}

  async get(request: FastifyRequest, reply: FastifyReply) {
    const data = await this.service.get({ tenantId: request.jwtUser!.tenantId })
    return reply.send(data)
  }

  async update(request: FastifyRequest<{ Body: PolicyBody }>, reply: FastifyReply) {
    const data = await this.service.update({
      tenantId: request.jwtUser!.tenantId,
      adminId: Number(request.jwtUser!.sub),
      ...(request.body.safePatterns !== undefined && { safePatterns: request.body.safePatterns }),
      ...(request.body.approvalPatterns !== undefined && { approvalPatterns: request.body.approvalPatterns }),
      ...(request.body.blockedPatterns !== undefined && { blockedPatterns: request.body.blockedPatterns }),
    })
    return reply.send(data)
  }

  async evaluate(request: FastifyRequest<{ Body: EvaluateBody }>, reply: FastifyReply) {
    const data = await this.service.evaluate({
      tenantId: request.jwtUser!.tenantId,
      command: request.body.command ?? '',
    })
    return reply.send(data)
  }
}
