import type { FastifyRequest, FastifyReply } from 'fastify'
import type { WebhookDeliveryStatus } from '@nodeaccess/shared'
import type { CreateWebhookSubscriptionDto, UpdateWebhookSubscriptionDto } from '@nodeaccess/shared'
import type { WebhookService } from './webhook.service.js'

export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  async listSubscriptions(request: FastifyRequest, reply: FastifyReply) {
    const result = await this.webhookService.listSubscriptions(request.jwtUser!.tenantId)
    return reply.send(result)
  }

  async createSubscription(
    request: FastifyRequest<{ Body: CreateWebhookSubscriptionDto }>,
    reply: FastifyReply,
  ) {
    const result = await this.webhookService.createSubscription(
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
      request.body,
    )
    return reply.code(201).send(result)
  }

  async updateSubscription(
    request: FastifyRequest<{ Params: { id: string }; Body: UpdateWebhookSubscriptionDto }>,
    reply: FastifyReply,
  ) {
    const result = await this.webhookService.updateSubscription(
      Number(request.params.id),
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
      request.body,
    )
    return reply.send(result)
  }

  async pauseSubscription(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    await this.webhookService.pauseSubscription(
      Number(request.params.id),
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
    )
    return reply.code(204).send()
  }

  async activateSubscription(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    await this.webhookService.activateSubscription(
      Number(request.params.id),
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
    )
    return reply.code(204).send()
  }

  async rotateSecret(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const result = await this.webhookService.rotateSecret(
      Number(request.params.id),
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
    )
    return reply.send(result)
  }

  async deleteSubscription(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    await this.webhookService.deleteSubscription(
      Number(request.params.id),
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
    )
    return reply.code(204).send()
  }

  async listDeliveries(
    request: FastifyRequest<{ Params: { id: string }; Querystring: { status?: string } }>,
    reply: FastifyReply,
  ) {
    const status = request.query.status as WebhookDeliveryStatus | undefined
    const result = await this.webhookService.listDeliveries(
      Number(request.params.id),
      request.jwtUser!.tenantId,
      status ? { status } : {},
    )
    return reply.send(result)
  }

  async retryDelivery(
    request: FastifyRequest<{ Params: { id: string; deliveryId: string } }>,
    reply: FastifyReply,
  ) {
    await this.webhookService.retryDelivery(
      Number(request.params.deliveryId),
      request.jwtUser!.tenantId,
    )
    return reply.code(204).send()
  }

  async testDelivery(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const result = await this.webhookService.testDelivery(
      Number(request.params.id),
      request.jwtUser!.tenantId,
    )
    return reply.send(result)
  }
}
