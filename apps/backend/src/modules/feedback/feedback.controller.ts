import type { FastifyReply, FastifyRequest } from 'fastify'
import type { FeedbackStatus, FeedbackType } from '@nodeaccess/shared'
import type { FeedbackService } from './feedback.service.js'

interface CreateFeedbackRequest {
  Body: {
    type: FeedbackType
    title: string
    message: string
    contextRoute?: string | null
    contextScreen?: string | null
  }
}

interface AdminListQuery {
  Querystring: {
    status?: FeedbackStatus
    type?: FeedbackType
    userId?: string
  }
}

interface UpdateFeedbackRequest {
  Params: { id: string }
  Body: {
    status: FeedbackStatus
    adminResponse?: string | null
  }
}

export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  async create(request: FastifyRequest<CreateFeedbackRequest>, reply: FastifyReply) {
    const feedback = await this.feedbackService.create(
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
      request.body,
    )
    return reply.status(201).send(feedback)
  }

  async listMine(request: FastifyRequest, reply: FastifyReply) {
    const feedbacks = await this.feedbackService.listMine(
      request.jwtUser!.tenantId,
      Number(request.jwtUser!.sub),
    )
    return reply.send(feedbacks)
  }

  async listForAdmin(request: FastifyRequest<AdminListQuery>, reply: FastifyReply) {
    const filters: {
      status?: FeedbackStatus
      type?: FeedbackType
      userId?: number
    } = {}

    if (request.query.status) filters.status = request.query.status
    if (request.query.type) filters.type = request.query.type
    if (request.query.userId) filters.userId = Number(request.query.userId)

    const feedbacks = await this.feedbackService.listForAdmin(request.jwtUser!.tenantId, filters)
    return reply.send(feedbacks)
  }

  async update(request: FastifyRequest<UpdateFeedbackRequest>, reply: FastifyReply) {
    const feedback = await this.feedbackService.update(
      request.jwtUser!.tenantId,
      Number(request.params.id),
      request.body,
    )
    return reply.send(feedback)
  }

  async delete(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const feedback = await this.feedbackService.delete(
      request.jwtUser!.tenantId,
      Number(request.params.id),
      Number(request.jwtUser!.sub),
    )
    return reply.send(feedback)
  }
}
