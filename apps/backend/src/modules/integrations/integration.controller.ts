import type { FastifyRequest, FastifyReply } from 'fastify'
import type { UpsertOnePasswordDto, UpsertGoogleDto, UpsertOpenAiDto, UpsertJiraDto } from '@nodeaccess/shared'
import type { IntegrationService } from './integration.service.js'

export class IntegrationController {
  constructor(private readonly integrationService: IntegrationService) {}

  async list(request: FastifyRequest, reply: FastifyReply) {
    const result = await this.integrationService.list(request.jwtUser!.tenantId)
    return reply.send(result)
  }

  async upsertOnePassword(request: FastifyRequest<{ Body: UpsertOnePasswordDto }>, reply: FastifyReply) {
    const result = await this.integrationService.upsertOnePassword(
      request.jwtUser!.tenantId,
      request.body,
    )
    return reply.send(result)
  }

  async getGoogle(request: FastifyRequest, reply: FastifyReply) {
    const result = await this.integrationService.getGoogleConfig(request.jwtUser!.tenantId)
    return reply.send(result)
  }

  async upsertGoogle(request: FastifyRequest<{ Body: UpsertGoogleDto }>, reply: FastifyReply) {
    const result = await this.integrationService.upsertGoogle(request.jwtUser!.tenantId, request.body)
    return reply.send(result)
  }

  async syncGoogle(request: FastifyRequest, reply: FastifyReply) {
    const result = await this.integrationService.syncGoogle(request.jwtUser!.tenantId)
    return reply.send(result)
  }

  async getOpenAi(request: FastifyRequest, reply: FastifyReply) {
    const result = await this.integrationService.getOpenAiConfig(request.jwtUser!.tenantId)
    return reply.send(result)
  }

  async upsertOpenAi(request: FastifyRequest<{ Body: UpsertOpenAiDto }>, reply: FastifyReply) {
    const result = await this.integrationService.upsertOpenAi(request.jwtUser!.tenantId, request.body)
    return reply.send(result)
  }

  async testOpenAi(request: FastifyRequest, reply: FastifyReply) {
    const result = await this.integrationService.testOpenAi(request.jwtUser!.tenantId)
    return reply.send(result)
  }

  async getJira(request: FastifyRequest, reply: FastifyReply) {
    const result = await this.integrationService.getJiraConfig(request.jwtUser!.tenantId)
    return reply.send(result)
  }

  async upsertJira(request: FastifyRequest<{ Body: UpsertJiraDto }>, reply: FastifyReply) {
    const result = await this.integrationService.upsertJira(request.jwtUser!.tenantId, request.body)
    return reply.send(result)
  }

  async testJira(request: FastifyRequest, reply: FastifyReply) {
    const result = await this.integrationService.testJira(request.jwtUser!.tenantId)
    return reply.send(result)
  }

  async getJiraTicket(request: FastifyRequest<{ Params: { key: string } }>, reply: FastifyReply) {
    const result = await this.integrationService.getJiraTicket(request.jwtUser!.tenantId, request.params.key)
    return reply.send(result)
  }
}
