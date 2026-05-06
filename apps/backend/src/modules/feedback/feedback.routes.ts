import type { FastifyInstance } from 'fastify'
import type { FeedbackStatus, FeedbackType } from '@nodeaccess/shared'
import { requireAdmin, requireAuth } from '../../shared/guards.js'
import type { FeedbackController } from './feedback.controller.js'

const feedbackTypeSchema = { type: 'string', enum: ['suggestion', 'problem', 'question'] } as const
const feedbackStatusSchema = { type: 'string', enum: ['new', 'in_review', 'accepted', 'not_planned', 'completed'] } as const

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

export async function feedbackRoutes(app: FastifyInstance, controller: FeedbackController): Promise<void> {
  app.post<CreateFeedbackRequest>('/', {
    preHandler: [requireAuth],
    schema: {
      tags: ['Feedback'],
      summary: 'Enviar feedback',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['type', 'title', 'message'],
        properties: {
          type: feedbackTypeSchema,
          title: { type: 'string', minLength: 4, maxLength: 120 },
          message: { type: 'string', minLength: 10, maxLength: 5000 },
          contextRoute: { type: 'string', maxLength: 190 },
          contextScreen: { type: 'string', maxLength: 190 },
        },
      },
    },
  }, (req, rep) => controller.create(req, rep))

  app.get('/mine', {
    preHandler: [requireAuth],
    schema: {
      tags: ['Feedback'],
      summary: 'Listar feedbacks do usuário autenticado',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) => controller.listMine(req, rep))

  app.get<AdminListQuery>('/admin', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['Feedback'],
      summary: 'Listar feedbacks do tenant para admins',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: feedbackStatusSchema,
          type: feedbackTypeSchema,
          userId: { type: 'string' },
        },
      },
    },
  }, (req, rep) => controller.listForAdmin(req, rep))

  app.patch<UpdateFeedbackRequest>('/admin/:id', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['Feedback'],
      summary: 'Atualizar status e resposta de um feedback',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: feedbackStatusSchema,
          adminResponse: { type: 'string', maxLength: 5000 },
        },
      },
    },
  }, (req, rep) => controller.update(req, rep))

  app.delete<{ Params: { id: string } }>('/admin/:id', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['Feedback'],
      summary: 'Excluir feedback com rastreabilidade',
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
    },
  }, (req, rep) => controller.delete(req, rep))
}
