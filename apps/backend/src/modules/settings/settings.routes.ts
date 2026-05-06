import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../../shared/guards.js'
import type { SettingsController } from './settings.controller.js'
import type {
  UpdateLicenseEntitlementsInput,
  UpdateSessionLimitsInput,
  UpdatePasswordPolicyInput,
  UpdateTenantSettingsInput,
} from './settings.service.js'

export async function settingsRoutes(app: FastifyInstance, controller: SettingsController): Promise<void> {
  /** GET /api/v1/settings — configurações do tenant (admin) */
  app.get('/', {
    preHandler: [requireAdmin],
    schema: {
      tags:     ['Settings'],
      summary:  'Configurações do sistema (admin)',
      security: [{ bearerAuth: [] }],
    },
    handler: controller.get.bind(controller),
  })

  app.patch<{ Body: UpdateLicenseEntitlementsInput }>('/license', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['Settings'],
      summary: 'Atualizar entitlements da licença do tenant',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['sessionAuditEnabled', 'sessionAuditAiEnabled', 'sessionAuditAiProvider', 'sessionAuditAiAutoSummaryEnabled', 'featureEntitlements', 'integrationEntitlements'],
        properties: {
          maxHosts: {
            anyOf: [
              { type: 'integer', minimum: 1 },
              { type: 'null' },
            ],
          },
          sessionAuditEnabled: {
            type: 'boolean',
          },
          sessionAuditAiEnabled: {
            type: 'boolean',
          },
          sessionAuditAiProvider: {
            type: 'string',
            enum: ['automatic', 'openai', 'local_ai'],
          },
          sessionAuditAiAutoSummaryEnabled: {
            type: 'boolean',
          },
          featureEntitlements: {
            type: 'object',
            additionalProperties: { type: 'boolean' },
          },
          integrationEntitlements: {
            type: 'object',
            additionalProperties: { type: 'boolean' },
          },
        },
      },
    },
    handler: controller.updateLicense.bind(controller),
  })

  app.patch<{ Body: UpdateSessionLimitsInput }>('/session-limits', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['Settings'],
      summary: 'Atualizar limites de sessão do tenant',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          maxPerUser:   { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
          maxPerTenant: { anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] },
        },
      },
    },
    handler: controller.updateSessionLimits.bind(controller),
  })

  app.patch<{ Body: UpdatePasswordPolicyInput }>('/password-policy', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['Settings'],
      summary: 'Atualizar política de senhas do tenant',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['minLength', 'regex', 'description'],
        properties: {
          minLength:   { type: 'integer', minimum: 1 },
          regex:       { type: 'string', minLength: 1 },
          description: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: controller.updatePasswordPolicy.bind(controller),
  })

  app.patch<{ Body: UpdateTenantSettingsInput }>('/tenant-settings', {
    preHandler: [requireAdmin],
    schema: {
      tags: ['Settings'],
      summary: 'Atualizar configurações do tenant (TOTP issuer etc.)',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['totpIssuer'],
        properties: {
          totpIssuer: { type: 'string', minLength: 1, maxLength: 100 },
        },
      },
    },
    handler: controller.updateTenantSettings.bind(controller),
  })
}
