import type { FastifyReply, FastifyRequest } from 'fastify'
import type {
  CreateInboundWebhookEndpointDto,
  InboundWebhookReceiptStatus,
  UpdateInboundWebhookEndpointDto,
} from '@nodeaccess/shared'
import type { InboundWebhookService } from './inbound-webhook.service.js'

export class InboundWebhookController {
  constructor(private readonly service: InboundWebhookService) {}

  async listEndpoints(request: FastifyRequest, reply: FastifyReply) {
    const result = await this.service.listEndpoints(request.jwtUser!.tenantId)
    return reply.send(result)
  }

  async createEndpoint(
    request: FastifyRequest<{ Body: CreateInboundWebhookEndpointDto }>,
    reply: FastifyReply,
  ) {
    const result = await this.service.createEndpoint(
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
      request.body,
    )
    return reply.send(result)
  }

  async updateEndpoint(
    request: FastifyRequest<{ Params: { id: string }; Body: UpdateInboundWebhookEndpointDto }>,
    reply: FastifyReply,
  ) {
    const result = await this.service.updateEndpoint(
      Number(request.params.id),
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
      request.body,
    )
    return reply.send(result)
  }

  async pauseEndpoint(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    await this.service.setEndpointStatus(Number(request.params.id), request.jwtUser!.tenantId, Number(request.jwtUser!.sub), 'PAUSED')
    return reply.status(204).send()
  }

  async activateEndpoint(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    await this.service.setEndpointStatus(Number(request.params.id), request.jwtUser!.tenantId, Number(request.jwtUser!.sub), 'ACTIVE')
    return reply.status(204).send()
  }

  async revokeEndpoint(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    await this.service.setEndpointStatus(Number(request.params.id), request.jwtUser!.tenantId, Number(request.jwtUser!.sub), 'REVOKED')
    return reply.status(204).send()
  }

  async listReceipts(
    request: FastifyRequest<{ Params: { id: string }; Querystring: { status?: InboundWebhookReceiptStatus } }>,
    reply: FastifyReply,
  ) {
    const result = await this.service.listReceipts(
      Number(request.params.id),
      request.jwtUser!.tenantId,
      request.query.status ? { status: request.query.status } : undefined,
    )
    return reply.send(result)
  }

  async ingest(
    request: FastifyRequest<{
      Params: { provider: string; endpointToken: string }
      Body: unknown
    }>,
    reply: FastifyReply,
  ) {
    const result = await this.service.ingest({
      provider: request.params.provider,
      endpointToken: request.params.endpointToken,
      body: request.body,
      headers: request.headers,
      sourceIp: request.ip,
    })
    return reply.status(result.accepted ? 202 : 400).send(result)
  }
}
