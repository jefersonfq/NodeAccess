import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../../shared/guards.js'
import type {
  CreateSharedSessionDto,
  DenySharedSessionControlDto,
  GrantSharedSessionControlDto,
  RevokeSharedSessionControlDto,
  RequestSharedSessionControlDto,
} from '@nodeaccess/shared'
import type { SharedSessionController } from './shared-session.controller.js'

interface SharedSessionIdParam { id: string }
interface SharedSessionTokenParam { token: string }
interface SharedSessionControlTargetParam extends SharedSessionIdParam { userId: string }

const tag = ['SharedSessions']

export async function sharedSessionRoutes(app: FastifyInstance, controller: SharedSessionController): Promise<void> {
  app.post('/', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Criar sessao compartilhada',
      description: 'Cria uma sessao ao vivo para acompanhamento colaborativo de terminal a partir de uma sessao SSH ativa.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) =>
    controller.create(req as never as import('fastify').FastifyRequest<{ Body: CreateSharedSessionDto }>, rep))

  app.get('/', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Listar sessoes compartilhadas',
      description: 'Lista links/sessoes ao vivo visiveis ao usuario para gestao e acompanhamento.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) =>
    controller.list(req, rep))

  app.get('/:id', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Detalhar sessao compartilhada',
      description: 'Retorna estado, participantes e controle atual de uma sessao compartilhada visivel ao usuario.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) =>
    controller.getById(req as never as import('fastify').FastifyRequest<{ Params: SharedSessionIdParam }>, rep))

  app.post('/:token/resolve', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Resolver convite de sessao compartilhada',
      description: 'Valida token autenticado e retorna contexto para entrada em uma sessao compartilhada ao vivo.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) =>
    controller.resolve(req as never as import('fastify').FastifyRequest<{ Params: SharedSessionTokenParam }>, rep))

  app.delete('/:id', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Revogar sessao compartilhada',
      description: 'Revoga uma sessao compartilhada ativa e impede novos acessos pelo link.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) =>
    controller.revoke(req as never as import('fastify').FastifyRequest<{ Params: SharedSessionIdParam }>, rep))

  app.post('/:id/control/request', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Solicitar controle da sessao compartilhada',
      description: 'Registra pedido de controle temporario para participante de uma sessao compartilhada.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) =>
    controller.requestControl(req as never as import('fastify').FastifyRequest<{ Params: SharedSessionIdParam; Body: RequestSharedSessionControlDto }>, rep))

  app.post('/:id/control/grant/:userId', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Conceder controle da sessao compartilhada',
      description: 'Permite que o owner conceda controle temporario do terminal a um participante.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) =>
    controller.grantControl(req as never as import('fastify').FastifyRequest<{ Params: SharedSessionControlTargetParam; Body: GrantSharedSessionControlDto }>, rep))

  app.post('/:id/control/deny/:userId', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Negar pedido de controle',
      description: 'Nega pedido de controle de um participante e registra o evento para auditoria.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) =>
    controller.denyControl(req as never as import('fastify').FastifyRequest<{ Params: SharedSessionControlTargetParam; Body: DenySharedSessionControlDto }>, rep))

  app.post('/:id/control/revoke', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Retomar ou revogar controle',
      description: 'Revoga controle concedido e permite que o owner retome o terminal compartilhado.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) =>
    controller.revokeControl(req as never as import('fastify').FastifyRequest<{ Params: SharedSessionIdParam; Body: RevokeSharedSessionControlDto }>, rep))
}
