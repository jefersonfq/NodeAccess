import type { FastifyInstance } from 'fastify'
import { requireAdmin } from '../../shared/guards.js'
import type { SettingsController } from './settings.controller.js'
import type { UpdateLicenseEntitlementsInput } from './settings.service.js'

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
        required: ['featureEntitlements', 'integrationEntitlements'],
        properties: {
          maxHosts: {
            anyOf: [
              { type: 'integer', minimum: 1 },
              { type: 'null' },
            ],
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
}
