import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../../shared/guards.js'
import type { HostLinkController } from './host-link.controller.js'
import type { CreateHostLinkDto, ResolvePublicHostLinkDto } from '@nodeaccess/shared'

const tag = ['HostLinks']

interface HostLinkIdParam { id: string }
interface HostLinkTokenParam { token: string }
interface HostLinkListQuery { hostId: number }
interface HostLinkPublicResolveRequest {
  Params: HostLinkTokenParam
  Body: ResolvePublicHostLinkDto
}

export async function hostLinkRoutes(app: FastifyInstance, controller: HostLinkController): Promise<void> {
  app.post('/', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Criar link de acesso ao host',
      description: 'Cria link interno ou JIT para acesso a host. Pode incluir expiracao, PIN, uso unico e auditoria conforme tipo e configuracao do tenant.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) =>
    controller.create(req as never as import('fastify').FastifyRequest<{ Body: CreateHostLinkDto }>, rep))

  app.get('/options', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Consultar opcoes de links de host',
      description: 'Retorna opcoes permitidas para criacao de links, incluindo configuracoes JIT do tenant.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) =>
    controller.options(req, rep))

  app.get('/', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Listar links de host',
      description: 'Lista links criados para um host ou visiveis ao usuario autenticado, respeitando permissoes.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) =>
    controller.list(req as never as import('fastify').FastifyRequest<{ Querystring: HostLinkListQuery }>, rep))

  app.get('/:token/resolve', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Resolver link autenticado de host',
      description: 'Valida um token de link interno e retorna o contexto necessario para abrir sessao propria no host.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) =>
    controller.resolve(req as never as import('fastify').FastifyRequest<{ Params: HostLinkTokenParam }>, rep))

  app.get('/:token/public-info', {
    schema: {
      tags: tag,
      summary: 'Consultar informacoes publicas de link JIT',
      description: 'Retorna metadados minimos de um link JIT publico antes da resolucao. Nao exige autenticacao e nao deve expor segredo do host.',
    },
  }, (req, rep) =>
    controller.publicInfo(req as never as import('fastify').FastifyRequest<{ Params: HostLinkTokenParam }>, rep))

  app.post('/:token/public-resolve', {
    schema: {
      tags: tag,
      summary: 'Resolver link JIT publico',
      description: 'Valida token e PIN quando configurado, marca uso do link JIT e prepara o contexto de acesso temporario.',
    },
  }, (req, rep) =>
    controller.resolvePublic(req as never as import('fastify').FastifyRequest<HostLinkPublicResolveRequest>, rep))

  app.delete('/:id', {
    preHandler: [requireAuth],
    schema: {
      tags: tag,
      summary: 'Revogar link de host',
      description: 'Revoga um link interno ou JIT. Sessoes JIT relacionadas podem ser encerradas conforme regra do backend.',
      security: [{ bearerAuth: [] }],
    },
  }, (req, rep) =>
    controller.revoke(req as never as import('fastify').FastifyRequest<{ Params: HostLinkIdParam }>, rep))
}
