import type { FastifyRequest, FastifyReply } from 'fastify'
import type { UpsertOnePasswordDto, UpsertGoogleDto, UpsertLdapDto, UpsertOpenAiDto, UpsertLocalAiDto, UpsertJiraDto } from '@nodeaccess/shared'
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

  async getLdap(request: FastifyRequest, reply: FastifyReply) {
    const result = await this.integrationService.getLdapConfig(request.jwtUser!.tenantId)
    return reply.send(result)
  }

  async upsertLdap(request: FastifyRequest<{ Body: UpsertLdapDto }>, reply: FastifyReply) {
    const result = await this.integrationService.upsertLdap(request.jwtUser!.tenantId, request.body)
    return reply.send(result)
  }

  async testLdap(request: FastifyRequest<{ Body: UpsertLdapDto }>, reply: FastifyReply) {
    const result = await this.integrationService.testLdap(request.jwtUser!.tenantId, request.body)
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

  async getLocalAi(request: FastifyRequest, reply: FastifyReply) {
    const result = await this.integrationService.getLocalAiConfig(request.jwtUser!.tenantId)
    return reply.send(result)
  }

  async upsertLocalAi(request: FastifyRequest<{ Body: UpsertLocalAiDto }>, reply: FastifyReply) {
    const result = await this.integrationService.upsertLocalAi(request.jwtUser!.tenantId, request.body)
    return reply.send(result)
  }

  async testLocalAi(request: FastifyRequest, reply: FastifyReply) {
    const result = await this.integrationService.testLocalAi(request.jwtUser!.tenantId, Number(request.jwtUser!.sub))
    return reply.send(result)
  }

  async createLocalAiProxyLink(request: FastifyRequest, reply: FastifyReply) {
    const result = await this.integrationService.createLocalAiProxyLink(request.jwtUser!.tenantId, Number(request.jwtUser!.sub))
    return reply.send(result)
  }

  async getLocalAiRecentActivity(request: FastifyRequest, reply: FastifyReply) {
    const result = await this.integrationService.getLocalAiRecentActivity(request.jwtUser!.tenantId)
    return reply.send(result)
  }

  async proxyLocalAi(request: FastifyRequest<{ Querystring: { token: string } }>, reply: FastifyReply) {
    const result = await this.integrationService.proxyLocalAi(request.query.token)
    reply.code(result.statusCode)
    reply.header('content-type', result.contentType)
    return reply.send(result.body)
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

  async beginJiraOAuth(request: FastifyRequest, reply: FastifyReply) {
    const result = await this.integrationService.beginJiraOAuth(request.jwtUser!.tenantId, Number(request.jwtUser!.sub))
    return reply.send(result)
  }

  async completeJiraOAuth(request: FastifyRequest<{ Querystring: { code: string; state: string } }>, reply: FastifyReply) {
    const result = await this.integrationService.completeJiraOAuth(request.query.code, request.query.state)
    return reply.send(result)
  }

  async getJiraTicket(request: FastifyRequest<{ Params: { key: string } }>, reply: FastifyReply) {
    const result = await this.integrationService.getJiraTicket(request.jwtUser!.tenantId, request.params.key)
    return reply.send(result)
  }

  async getJiraSessionPolicy(request: FastifyRequest, reply: FastifyReply) {
    const hostId = Number((request.query as { hostId?: string }).hostId)
    return reply.send(await this.integrationService.getJiraSessionPolicy(request.jwtUser!.tenantId, Number(request.jwtUser!.sub), Number.isInteger(hostId) ? hostId : undefined))
  }

  async authorizeJiraSession(request: FastifyRequest<{ Body: { hostId: number; ticketKey?: string; interactionId?: string } }>, reply: FastifyReply) {
    return reply.send(await this.integrationService.authorizeJiraSession(
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
      request.body.hostId,
      request.body.ticketKey,
      request.body.interactionId,
    ))
  }
}
