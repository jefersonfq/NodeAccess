import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { requireAuth } from '../../shared/guards.js'
import { prisma } from '../../config/database.js'
import { env } from '../../config/env.js'

export async function featuresRoutes(app: FastifyInstance): Promise<void> {
  /** GET /api/v1/features — feature flags do tenant (qualquer usuário autenticado) */
  app.get('/', {
    preHandler: [requireAuth],
    schema: {
      tags:     ['Features'],
      summary:  'Feature flags do tenant',
      security: [{ bearerAuth: [] }],
    },
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { tenantId } = request.jwtUser!
      let license: { multiConnect: boolean; sessionAuditEnabled: boolean; sessionAuditAiEnabled: boolean } | null = null
      try {
        license = await prisma.license.findUnique({
          where:  { tenantId },
          select: { multiConnect: true, sessionAuditEnabled: true, sessionAuditAiEnabled: true },
        })
      } catch {
        const fallback = await prisma.license.findUnique({
          where:  { tenantId },
          select: { multiConnect: true },
        })
        license = fallback ? { ...fallback, sessionAuditEnabled: false, sessionAuditAiEnabled: false } : null
      }
      // Em desenvolvimento, permitimos forcar multi-connect via .env para testes locais.
      // A preferencia de produto continua sendo a licenca persistida no banco.
      const multiConnect =
        env.NODE_ENV === 'development'
          ? (env.LICENSE_MULTI_CONNECT || license?.multiConnect || false)
          : (license?.multiConnect ?? env.LICENSE_MULTI_CONNECT)

      return reply.send({
        multiConnect,
        sessionAuditLicensed: license?.sessionAuditEnabled ?? false,
        sessionAuditAiLicensed: license?.sessionAuditAiEnabled ?? false,
      })
    },
  })
}
