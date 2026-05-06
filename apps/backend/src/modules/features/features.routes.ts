import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { requireAuth } from '../../shared/guards.js'
import { prisma } from '../../config/database.js'
import { env } from '../../config/env.js'

function parseBool(value: boolean | number | bigint | null | undefined): boolean {
  return value === true || value === 1 || value === BigInt(1)
}

function parseJsonRecord(value: unknown): Record<string, boolean> {
  if (!value) return {}
  try {
    const parsed = typeof value === 'string'
      ? JSON.parse(value) as Record<string, unknown>
      : value as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed).map(([key, raw]) => [key, raw === true]),
    )
  } catch {
    return {}
  }
}

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
      let license: {
        multiConnect: boolean
        sessionAuditEnabled: boolean
        sessionAuditAiEnabled: boolean
        maxHosts: number | null
        featureEntitlements: Record<string, boolean>
        integrationEntitlements: Record<string, boolean>
      } | null = null
      try {
        const rows = await prisma.$queryRaw<Array<{
          multiConnect: boolean | number | bigint
          sessionAuditEnabled: boolean | number | bigint
          sessionAuditAiEnabled: boolean | number | bigint
          maxHosts: number | null
          featureEntitlementsJson: string | null
          integrationEntitlementsJson: string | null
        }>>`
          SELECT
            multi_connect AS multiConnect,
            session_audit_enabled AS sessionAuditEnabled,
            session_audit_ai_enabled AS sessionAuditAiEnabled,
            max_hosts AS maxHosts,
            feature_entitlements_json AS featureEntitlementsJson,
            integration_entitlements_json AS integrationEntitlementsJson
          FROM licenses
          WHERE tenant_id = ${tenantId}
          LIMIT 1
        `

        const row = rows[0]
        license = row ? {
          multiConnect: parseBool(row.multiConnect),
          sessionAuditEnabled: parseBool(row.sessionAuditEnabled),
          sessionAuditAiEnabled: parseBool(row.sessionAuditAiEnabled),
          maxHosts: row.maxHosts,
          featureEntitlements: parseJsonRecord(row.featureEntitlementsJson),
          integrationEntitlements: parseJsonRecord(row.integrationEntitlementsJson),
        } : null
      } catch {
        const fallback = await prisma.license.findUnique({
          where:  { tenantId },
          select: { multiConnect: true },
        })
        license = fallback ? {
          ...fallback,
          sessionAuditEnabled: false,
          sessionAuditAiEnabled: false,
          maxHosts: null,
          featureEntitlements: {},
          integrationEntitlements: {},
        } : null
      }
      // Em desenvolvimento, permitimos forcar multi-connect via .env para testes locais.
      // A preferencia de produto continua sendo a licenca persistida no banco.
      const multiConnect =
        env.NODE_ENV === 'development'
          ? (env.LICENSE_MULTI_CONNECT || license?.multiConnect || false)
          : (license?.multiConnect ?? env.LICENSE_MULTI_CONNECT)

      return reply.send({
        multiConnect,
        maxHosts: license?.maxHosts ?? null,
        sessionAuditLicensed: license?.sessionAuditEnabled ?? false,
        sessionAuditAiLicensed: license?.sessionAuditAiEnabled ?? false,
        agentsLicensed: license?.featureEntitlements.agents ?? false,
        secretsLicensed: license?.featureEntitlements.secrets ?? false,
        snippetsLicensed: license?.featureEntitlements.snippets ?? false,
        portForwardingLicensed: license?.featureEntitlements.portForwarding ?? false,
        integrationsLicensed: license?.featureEntitlements.integrations ?? false,
        feedbackLicensed: license?.featureEntitlements.feedback ?? false,
        localAiLicensed: license?.featureEntitlements.localAi ?? false,
        mcpLicensed: license?.featureEntitlements.mcp ?? false,
        aiSshActionsLicensed: license?.featureEntitlements.aiSshActions ?? false,
        integrationProviders: license?.integrationEntitlements ?? {},
      })
    },
  })
}
