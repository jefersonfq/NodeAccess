import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import type { Redis } from 'ioredis'
import { requireAdmin } from '../../shared/guards.js'
import { buildObservabilitySnapshot } from './observability.service.js'

export async function observabilityRoutes(app: FastifyInstance, deps: { db: PrismaClient; redis: Redis }): Promise<void> {
  app.get('/summary', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['Observability'],
      summary: 'Resumo operacional do servidor e containers',
      security: [{ bearerAuth: [] }],
    },
  }, async (_request, reply) => {
    const snapshot = await buildObservabilitySnapshot({ deps })
    return reply.send(snapshot)
  })
}
