import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  SessionCommandPolicyBindingInput,
  SessionCommandPolicyEvaluateInput,
  SessionCommandPolicyGroupInput,
  SessionCommandPolicyRuleInput,
  SessionCommandPolicyService,
} from './session-command-policy.service.js'

type PolicyParams = { policyGroupId: string }
type RuleParams = { policyGroupId: string; ruleId: string }
type BindingParams = { policyGroupId: string; bindingId: string }

export class SessionCommandPolicyController {
  constructor(private readonly service: SessionCommandPolicyService) {}

  async listGroups(request: FastifyRequest, reply: FastifyReply) {
    const data = await this.service.listGroups(request.jwtUser!.tenantId)
    return reply.send(data)
  }

  async evaluate(request: FastifyRequest<{ Body: SessionCommandPolicyEvaluateInput }>, reply: FastifyReply) {
    const data = await this.service.evaluate(request.jwtUser!.tenantId, request.body)
    return reply.send(data)
  }

  async createGroup(request: FastifyRequest<{ Body: SessionCommandPolicyGroupInput }>, reply: FastifyReply) {
    const data = await this.service.createGroup(request.jwtUser!.tenantId, request.body)
    return reply.status(201).send(data)
  }

  async updateGroup(request: FastifyRequest<{ Params: PolicyParams; Body: SessionCommandPolicyGroupInput }>, reply: FastifyReply) {
    const data = await this.service.updateGroup(request.jwtUser!.tenantId, Number(request.params.policyGroupId), request.body)
    return reply.send(data)
  }

  async deleteGroup(request: FastifyRequest<{ Params: PolicyParams }>, reply: FastifyReply) {
    await this.service.deleteGroup(request.jwtUser!.tenantId, Number(request.params.policyGroupId))
    return reply.status(204).send()
  }

  async listRules(request: FastifyRequest<{ Params: PolicyParams }>, reply: FastifyReply) {
    const data = await this.service.listRules(request.jwtUser!.tenantId, Number(request.params.policyGroupId))
    return reply.send(data)
  }

  async createRule(request: FastifyRequest<{ Params: PolicyParams; Body: SessionCommandPolicyRuleInput }>, reply: FastifyReply) {
    const data = await this.service.createRule(request.jwtUser!.tenantId, Number(request.params.policyGroupId), request.body)
    return reply.status(201).send(data)
  }

  async deleteRule(request: FastifyRequest<{ Params: RuleParams }>, reply: FastifyReply) {
    await this.service.deleteRule(request.jwtUser!.tenantId, Number(request.params.policyGroupId), Number(request.params.ruleId))
    return reply.status(204).send()
  }

  async listBindings(request: FastifyRequest<{ Params: PolicyParams }>, reply: FastifyReply) {
    const data = await this.service.listBindings(request.jwtUser!.tenantId, Number(request.params.policyGroupId))
    return reply.send(data)
  }

  async createBinding(request: FastifyRequest<{ Params: PolicyParams; Body: SessionCommandPolicyBindingInput }>, reply: FastifyReply) {
    const data = await this.service.createBinding(request.jwtUser!.tenantId, Number(request.params.policyGroupId), request.body)
    return reply.status(201).send(data)
  }

  async deleteBinding(request: FastifyRequest<{ Params: BindingParams }>, reply: FastifyReply) {
    await this.service.deleteBinding(request.jwtUser!.tenantId, Number(request.params.policyGroupId), Number(request.params.bindingId))
    return reply.status(204).send()
  }
}
