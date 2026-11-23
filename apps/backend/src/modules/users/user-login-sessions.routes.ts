import type { FastifyInstance, FastifyRequest } from 'fastify'
import { requireAdmin } from '../../shared/guards.js'
import type { UserLoginSessionsService } from './user-login-sessions.service.js'

const tag = ['Users']
const security = [{ bearerAuth: [] }]
const idParam = { type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 } } }
const sessionSchema = {
  type: 'object',
  properties: {
    ref: { type: 'string' }, authMethod: { type: 'string' }, ip: { type: ['string', 'null'] }, lastIp: { type: ['string', 'null'] },
    userAgent: { type: ['string', 'null'] }, createdAt: { type: 'integer' }, lastSeenAt: { type: 'integer' }, current: { type: 'boolean' },
  },
}
type Who = { tenantId: number; adminId: number; sid?: string | undefined }
const who = (request: FastifyRequest): Who => ({ tenantId: request.jwtUser!.tenantId, adminId: Number(request.jwtUser!.sub), sid: request.jwtUser!.sid })

/** NA-0187 — login sessions of the tenant's users (admin only, own tenant). */
export function userLoginSessionRoutes(app: FastifyInstance, service: UserLoginSessionsService): Promise<void> {
  app.get('/online', {
    preHandler: [requireAdmin],
    schema: { tags: tag, summary: 'Usuários online (admin)', security,
      response: { 200: { type: 'object', properties: { data: { type: 'array', items: { type: 'object',
        properties: { userId: { type: 'integer' }, sessions: { type: 'integer' }, lastSeenAt: { type: 'integer' } } } } } } } },
  }, async request => ({ data: await service.online(who(request).tenantId) }))

  app.get<{ Params: { id: number } }>('/:id/login-sessions', {
    preHandler: [requireAdmin],
    schema: { tags: tag, summary: 'Sessões de login do usuário (admin)', security, params: idParam,
      response: { 200: { type: 'object', properties: { data: { type: 'array', items: sessionSchema } } } } },
  }, async request => {
    const w = who(request)
    return { data: await service.list(w.tenantId, request.params.id, w.sid) }
  })

  app.delete<{ Params: { id: number; ref: string } }>('/:id/login-sessions/:ref', {
    preHandler: [requireAdmin],
    schema: { tags: tag, summary: 'Desconectar uma sessão de login (admin)', security,
      params: { type: 'object', required: ['id', 'ref'], properties: { id: { type: 'integer', minimum: 1 }, ref: { type: 'string', pattern: '^[0-9a-f]{32}$' } } } },
  }, async (request, reply) => {
    const w = who(request)
    await service.revoke(w.tenantId, w.adminId, request.params.id, request.params.ref, w.sid)
    return reply.status(204).send()
  })

  app.post<{ Params: { id: number } }>('/:id/login-sessions/revoke-all', {
    preHandler: [requireAdmin],
    schema: { tags: tag, summary: 'Desconectar todas as sessões do usuário (admin)', security, params: idParam },
  }, async (request, reply) => {
    const w = who(request)
    await service.revokeAll(w.tenantId, w.adminId, request.params.id)
    return reply.status(204).send()
  })
  return Promise.resolve()
}
